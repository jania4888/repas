using System.Text;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

// ── Export ───────────────────────────────────────────────────────────────────

/// <summary>
/// « Modèle Intégration DM » — export : rend la configuration du dossier au format d'échange.
/// </summary>
/// <remarks>
/// Lecture sous <c>accounting:read</c>, comme la configuration elle-même, et disponible
/// <b>drapeau éteint</b> : le fichier n'est que le reflet de données déjà lisibles à l'écran, et un
/// cabinet qui prépare le paramétrage d'un dossier avant activation doit pouvoir l'emporter.
/// </remarks>
public sealed record ExportMonthlyDeclarationModelQuery
    : IRequest<Result<MonthlyDeclarationModelFileDto>>;

public sealed class ExportMonthlyDeclarationModelQueryHandler
    : IRequestHandler<ExportMonthlyDeclarationModelQuery, Result<MonthlyDeclarationModelFileDto>>
{
    private readonly IMonthlyDeclarationConfigRepository _config;

    public ExportMonthlyDeclarationModelQueryHandler(IMonthlyDeclarationConfigRepository config)
    {
        _config = config;
    }

    public async Task<Result<MonthlyDeclarationModelFileDto>> Handle(
        ExportMonthlyDeclarationModelQuery request, CancellationToken cancellationToken)
    {
        // `includeInactive: true` — le modèle doit rendre la configuration telle qu'elle est.
        // Omettre les rubriques désactivées les ferait revenir actives au prochain import.
        var rubrics = await _config.GetRubricsAsync(includeInactive: true, cancellationToken);
        var families = await _config.GetFamilySettingsAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var content = MonthlyDeclarationModel.Serialize(rubrics, families, now);

        return Result.Success(new MonthlyDeclarationModelFileDto
        {
            FileName = $"modele-dm-{now:yyyyMMdd}.json",
            Content = content
        });
    }
}

// ── Import ───────────────────────────────────────────────────────────────────

/// <summary>
/// « Modèle Intégration DM » — import : applique un fichier de modèle au dossier courant.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tout ou rien à l'analyse.</b> Une seule entrée fautive fait échouer le fichier entier, et le
/// refus nomme les entrées en cause. C'est l'inverse de la politique de l'amorçage, qui ignore une
/// entrée fautive — et c'est délibéré : l'amorçage tourne tout seul sur un catalogue que personne
/// n'a demandé, tandis qu'ici l'utilisateur a choisi un fichier et attend de savoir ce qu'il
/// contient. Un import à moitié appliqué laisserait une configuration dont personne ne sait
/// dans quel état elle est.
/// </para>
/// <para>
/// L'écriture, elle, reste « insérer ou remplacer, jamais supprimer en masse » : une rubrique du
/// dossier absente du fichier n'est pas touchée. Un modèle partiel complète une configuration, il
/// ne la remplace pas.
/// </para>
/// </remarks>
public sealed record ImportMonthlyDeclarationModelCommand(ImportMonthlyDeclarationModelRequest Request)
    : IRequest<Result<MonthlyDeclarationModelImportResultDto>>;

public sealed class ImportMonthlyDeclarationModelCommandHandler
    : IRequestHandler<ImportMonthlyDeclarationModelCommand, Result<MonthlyDeclarationModelImportResultDto>>
{
    private readonly IMonthlyDeclarationModelImporter _importer;
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public ImportMonthlyDeclarationModelCommandHandler(
        IMonthlyDeclarationModelImporter importer,
        IMonthlyDeclarationConfigRepository config,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _importer = importer;
        _config = config;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result<MonthlyDeclarationModelImportResultDto>> Handle(
        ImportMonthlyDeclarationModelCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.ConfigurableLinesActive)
            return Result.Failure<MonthlyDeclarationModelImportResultDto>(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure<MonthlyDeclarationModelImportResultDto>(MonthlyDeclarationGuard.WriteDenied);

        var content = request.Request.Content ?? string.Empty;
        if (Encoding.UTF8.GetByteCount(content) > MonthlyDeclarationModel.MaxDocumentBytes)
        {
            return Result.Failure<MonthlyDeclarationModelImportResultDto>(Error.Validation(
                "Content",
                $"Le fichier dépasse {MonthlyDeclarationModel.MaxDocumentBytes / 1024} Ko."));
        }

        var parsed = MonthlyDeclarationModel.Parse(content);
        if (parsed.IsFailure)
            return Result.Failure<MonthlyDeclarationModelImportResultDto>(parsed.Error);

        var model = parsed.Value;
        if (model.Rejected.Count > 0)
        {
            // Le refus porte le détail : sans lui, « fichier invalide » obligerait à chercher
            // l'entrée fautive à la main dans un document de plusieurs centaines de lignes.
            var detail = string.Join(
                " ", model.Rejected.Take(5).Select(r => $"[{r.Code}] {r.Reason}"));
            var more = model.Rejected.Count > 5 ? $" (+{model.Rejected.Count - 5} autre(s))" : string.Empty;

            return Result.Failure<MonthlyDeclarationModelImportResultDto>(Error.Validation(
                "Content",
                $"{model.Rejected.Count} entrée(s) du fichier sont refusées ; rien n'a été importé. {detail}{more}"));
        }

        var guard = await GuardCardinalityAsync(model, cancellationToken);
        if (guard.IsFailure)
            return Result.Failure<MonthlyDeclarationModelImportResultDto>(guard.Error);

        // Un fichier antérieur à la version 2 — export v1 ou catalogue v1 — porte toutes ses
        // familles à « non incluse » : les appliquer décocherait le dossier entier. Elles sont
        // ignorées ; ses rubriques identiques au catalogue v1 passent en v2 si la montée est permise.
        var isLegacyFile = !MonthlyDeclarationModel.IsCurrentFormat(model);
        var families = isLegacyFile ? Array.Empty<MonthlyDeclarationFamilyDraft>() : model.Families;

        if (!isLegacyFile && !request.Request.ConfirmFamilyExclusions)
        {
            var exclusions = await ExcludedFamiliesAsync(families, cancellationToken);
            if (exclusions.Count > 0)
            {
                return Result.Failure<MonthlyDeclarationModelImportResultDto>(Error.Validation(
                    "Families",
                    $"Le fichier décocherait {(exclusions.Count == 1 ? "la famille" : "les familles")} "
                    + $"« {string.Join(" », « ", exclusions)} », aujourd'hui "
                    + $"{(exclusions.Count == 1 ? "incluse" : "incluses")} : le dossier cesserait de "
                    + $"{(exclusions.Count == 1 ? "la" : "les")} déclarer. Confirmez l'exclusion pour importer."));
            }
        }

        var upgradeToV2 = isLegacyFile && _settings.MonthlyDeclarationCatalogV2UpgradeEnabled
            ? new MonthlyDeclarationImportUpgrade(_settings.TclRatePercent)
            : null;

        var outcome = await _importer.ImportAsync(
            model.Rubrics, families, request.Request.Overwrite, cancellationToken, upgradeToV2);
        if (outcome.IsFailure)
            return Result.Failure<MonthlyDeclarationModelImportResultDto>(outcome.Error);

        var applied = outcome.Value;

        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationConfigImported,
            nameof(MonthlyDeclarationRubric), Guid.Empty,
            newValues: new
            {
                model.ModelVersion,
                model.CatalogVersion,
                request.Request.Overwrite,
                applied.Inserted,
                applied.Replaced,
                applied.FamiliesChanged,
                FamilyInclusionsIgnored = isLegacyFile && model.Families.Count > 0,
                UpgradedFamilies = (applied.UpgradedFamilies ?? []).Select(f => f.ToString()),
                SkippedCodes = applied.SkippedCodes,
                UnknownAccounts = applied.UnknownAccounts
            },
            cancellationToken: cancellationToken);

        return Result.Success(new MonthlyDeclarationModelImportResultDto
        {
            Inserted = applied.Inserted,
            Replaced = applied.Replaced,
            SkippedCodes = applied.SkippedCodes,
            UnknownAccounts = applied.UnknownAccounts,
            FamiliesChanged = applied.FamiliesChanged,
            UpgradedFamilies = (applied.UpgradedFamilies ?? []).Select(f => (int)f).ToList(),
            FamilyInclusionsIgnored = isLegacyFile && model.Families.Count > 0
        });
    }

    /// <summary>
    /// Le plafond se mesure sur les rubriques qui seraient <b>créées</b>, pas sur la taille du
    /// fichier : réimporter un modèle déjà appliqué n'ajoute rien et ne doit pas être refusé parce
    /// que le dossier frôle la limite.
    /// </summary>
    /// <summary>Familles aujourd'hui incluses que le fichier décocherait, par leur libellé d'onglet.</summary>
    private async Task<IReadOnlyList<string>> ExcludedFamiliesAsync(
        IReadOnlyList<MonthlyDeclarationFamilyDraft> families, CancellationToken cancellationToken)
    {
        if (!families.Any(f => !f.IsIncluded))
            return Array.Empty<string>();

        var included = (await _config.GetFamilySettingsAsync(cancellationToken))
            .Where(f => f.IsIncluded)
            .Select(f => f.Family)
            .ToHashSet();

        return families
            .Where(f => !f.IsIncluded && included.Contains(f.Family))
            .Select(f => f.Family.ToDisplayString())
            .Distinct()
            .ToList();
    }

    private async Task<Result> GuardCardinalityAsync(
        MonthlyDeclarationModelParse model, CancellationToken cancellationToken)
    {
        var existing = await _config.GetRubricsAsync(includeInactive: true, cancellationToken);
        var known = existing.Select(r => r.Code).ToHashSet(StringComparer.Ordinal);
        var newCodes = model.Rubrics.Count(r => !known.Contains(r.Code));

        if (existing.Count + newCodes <= MonthlyDeclarationGuard.MaxRubricsPerTenant)
            return Result.Success();

        return Result.Failure(Error.Validation(
            "Rubrics",
            $"L'import porterait le dossier à {existing.Count + newCodes} rubriques, au-delà des "
            + $"{MonthlyDeclarationGuard.MaxRubricsPerTenant} autorisées."));
    }
}
