using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Copie la configuration de la déclaration mensuelle d'un dossier du cabinet vers le dossier
/// courant.
/// </summary>
/// <remarks>
/// <para>
/// <b>La source n'est jamais prise au mot.</b> L'identifiant reçu est confronté au portefeuille du
/// cabinet appelant — liaison active — puis au périmètre du collaborateur. Sans ce contrôle, la
/// fonction serait une lecture arbitraire dans la base d'un autre dossier ; avec lui, elle ne peut
/// lire que ce que l'appelant a déjà le droit d'ouvrir.
/// </para>
/// <para>
/// La lecture se fait sur un contexte <b>isolé</b>, qui ne rejoint jamais la transaction ambiante de
/// la destination, et en lecture seule. L'écriture se fait en une seule opération sur la
/// destination, avec de <b>nouveaux identifiants</b> : les espaces de clés des deux bases sont
/// indépendants, et recopier un identifiant rendrait les deux dossiers indiscernables dans un
/// export d'audit.
/// </para>
/// <para>
/// Aucune transaction distribuée : l'enregistrement unique côté destination et la politique
/// « insérer ou remplacer, jamais supprimer en masse » rendent l'opération <b>rejouable</b>, ce qui
/// en tient lieu.
/// </para>
/// </remarks>
public sealed class MonthlyDeclarationConfigDuplicator : IMonthlyDeclarationConfigDuplicator
{
    private readonly MasterDbContext _master;
    private readonly ITenantService _tenantService;
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ICurrentUser _currentUser;
    private readonly ITenantMigrationGuard? _migrationGuard;

    /// <param name="migrationGuard">
    /// Facultatif : absent hors exécution (outillage EF), où la duplication ne s'exécute pas.
    /// </param>
    public MonthlyDeclarationConfigDuplicator(
        MasterDbContext master,
        ITenantService tenantService,
        ITenantDbContextFactory contextFactory,
        ICurrentUser currentUser,
        ITenantMigrationGuard? migrationGuard = null)
    {
        _master = master;
        _tenantService = tenantService;
        _contextFactory = contextFactory;
        _currentUser = currentUser;
        _migrationGuard = migrationGuard;
    }

    public async Task<Result<MonthlyDeclarationDuplicationResultDto>> DuplicateAsync(
        Guid sourceCompanyTenantId,
        bool overwrite,
        CancellationToken cancellationToken = default)
    {
        if (sourceCompanyTenantId == Guid.Empty)
        {
            return Result.Failure<MonthlyDeclarationDuplicationResultDto>(
                Error.Validation("SourceCompanyTenantId", "Le dossier source est obligatoire."));
        }

        if (_currentUser.TenantId is not { } firmTenantId || firmTenantId == Guid.Empty)
        {
            return Result.Failure<MonthlyDeclarationDuplicationResultDto>(
                Error.Forbidden("Cabinet appelant introuvable."));
        }

        var authorized = await IsInFirmPortfolioAsync(firmTenantId, sourceCompanyTenantId, cancellationToken);
        if (!authorized)
        {
            // Message volontairement identique à celui d'un dossier inexistant : distinguer les deux
            // révélerait l'existence de dossiers d'autres cabinets.
            return Result.Failure<MonthlyDeclarationDuplicationResultDto>(
                Error.Forbidden("Dossier source introuvable dans le portefeuille du cabinet."));
        }

        var connectionString = await _tenantService.GetConnectionStringAsync(
            sourceCompanyTenantId, cancellationToken);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return Result.Failure<MonthlyDeclarationDuplicationResultDto>(
                Error.NotFound("Base du dossier source introuvable."));
        }

        // Les migrations d'un dossier s'appliquent à sa première requête. Un dossier source que
        // personne n'a ouvert depuis le dernier déploiement n'a pas encore les colonnes que le
        // modèle lit : on les lui applique d'abord, sans quoi la lecture échouerait sur une colonne
        // inconnue.
        if (_migrationGuard is not null)
        {
            var migrated = await _migrationGuard.EnsureMigrationsAppliedAsync(sourceCompanyTenantId, cancellationToken);
            if (migrated.IsFailure)
                return Result.Failure<MonthlyDeclarationDuplicationResultDto>(migrated.Error);
        }

        var source = await ReadSourceAsync(connectionString, cancellationToken);
        if (source.Count == 0)
        {
            return Result.Failure<MonthlyDeclarationDuplicationResultDto>(
                Error.Validation("Source", "Le dossier source ne porte aucune rubrique à copier."));
        }

        return await WriteAsync(source, overwrite, cancellationToken);
    }

    /// <summary>
    /// Le dossier source appartient-il au portefeuille actif du cabinet, et au périmètre du
    /// collaborateur ? Les deux conditions comptent : un gestionnaire voit tout le portefeuille, un
    /// comptable seulement les dossiers qui lui sont affectés.
    /// </summary>
    private async Task<bool> IsInFirmPortfolioAsync(
        Guid firmTenantId, Guid sourceCompanyTenantId, CancellationToken cancellationToken)
    {
        var assigned = await _master.FirmClientAssignments
            .AsNoTracking()
            .AnyAsync(
                a => a.FirmTenantId == firmTenantId
                     && a.CompanyTenantId == sourceCompanyTenantId
                     && a.Status == FirmAssignmentStatus.Active,
                cancellationToken);

        if (!assigned)
            return false;

        if (!_currentUser.TryGetAccessScope(out var scope))
            return true;

        // Contrat tri-état : null = aucun filtre (gestionnaire), ensemble vide = aucun dossier.
        var accessible = await FirmDossierAccessService.GetAccessibleCompanyTenantIdsAsync(
            _master, firmTenantId, scope, cancellationToken);

        return accessible is null || accessible.Contains(sourceCompanyTenantId);
    }

    /// <summary>Lit la configuration du dossier source, en lecture seule et hors transaction ambiante.</summary>
    private async Task<IReadOnlyList<MonthlyDeclarationRubricDraft>> ReadSourceAsync(
        string connectionString, CancellationToken cancellationToken)
    {
        await using var source = _contextFactory.CreateIsolatedContext(connectionString);

        var rubrics = await source.MonthlyDeclarationRubrics
            .AsNoTracking()
            .Include(r => r.Accounts)
            .OrderBy(r => r.Family)
            .ThenBy(r => r.DisplayOrder)
            .ToListAsync(cancellationToken);

        return rubrics
            .Select(r => new MonthlyDeclarationRubricDraft(
                r.Family, r.Code, r.Label, r.ReportCode, r.GrossKind, r.WithheldKind,
                r.GrossSide, r.WithheldSide, r.RatePercent, r.FixedGrossAmount, r.FixedWithheldAmount,
                r.PayrollComponent, r.WithheldPayrollComponent, r.EffectiveFrom, r.EffectiveTo,
                r.DisplayOrder,
                // La duplication ne dit rien de l'état actif : une rubrique nouvelle arrive active,
                // et une rubrique déjà présente garde l'état que le dossier lui a donné.
                IsActive: null,
                r.Accounts.Select(a => new RubricAccountInput(a.Role, a.AccountNumber, a.MatchMode)).ToList(),
                r.GrossDocumentSource,
                r.WithheldDocumentSource))
            .ToList();
    }

    /// <summary>
    /// Écrit dans la destination par le point d'écriture commun à la duplication et à l'import de
    /// modèle. Les inclusions de familles ne sont pas transportées : la duplication reprend le
    /// paramétrage, pas la décision d'inclure une famille dans la déclaration du dossier.
    /// </summary>
    private async Task<Result<MonthlyDeclarationDuplicationResultDto>> WriteAsync(
        IReadOnlyList<MonthlyDeclarationRubricDraft> source, bool overwrite, CancellationToken cancellationToken)
    {
        await using var destination = _contextFactory.CreateContext();

        var applied = await MonthlyDeclarationConfigWriter.ApplyAsync(
            destination, source, [], overwrite, _currentUser.Email ?? "system", cancellationToken);
        if (applied.IsFailure)
            return Result.Failure<MonthlyDeclarationDuplicationResultDto>(applied.Error);

        return Result.Success(new MonthlyDeclarationDuplicationResultDto
        {
            Inserted = applied.Value.Inserted,
            Replaced = applied.Value.Replaced,
            SkippedCodes = applied.Value.SkippedCodes,
            UnknownAccounts = applied.Value.UnknownAccounts
        });
    }
}
