using System.Globalization;
using ClosedXML.Excel;
using CsvHelper;
using CsvHelper.Configuration;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
// Alias distinct : le namespace enfant FactuTrust.Infrastructure.Services.Email masque le value object.
using EmailVo = FactuTrust.Domain.ValueObjects.Email;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Reprise de dossier ÉTENDUE : plan comptable, plan tiers, balance d'ouverture. Séparé de
/// <see cref="JournalImportService"/> (import d'écritures) pour ne rien altérer de l'existant.
/// Même patron : aperçu (dry-run) → commit tout-ou-rien (un seul <c>SaveChanges</c>). Strictement
/// ADDITIF : un élément déjà présent est ignoré, jamais écrasé.
/// </summary>
public sealed class ReferenceDataImportService : IReferenceDataImportService
{
    private const int SampleSize = 20;

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly IAccountingPeriodService _periodService;
    private readonly AccountingSettings _settings;

    public ReferenceDataImportService(
        ITenantDbContextFactory contextFactory,
        IAccountingPeriodService periodService,
        IOptions<AccountingSettings> settings)
    {
        _contextFactory = contextFactory;
        _periodService = periodService;
        _settings = settings.Value;
    }

    // Surcharges historiques : délèguent sans table de correspondance (comportement inchangé).
    public Task<Result<ReferenceImportPreviewDto>> PreviewAsync(
        byte[] content, ReferenceImportTarget target, JournalImportFormat format,
        int? fiscalYear = null, CancellationToken cancellationToken = default)
        => PreviewAsync(content, target, format, fiscalYear, null, cancellationToken);

    public Task<Result<ReferenceImportCommitResultDto>> CommitAsync(
        byte[] content, ReferenceImportTarget target, JournalImportFormat format,
        int? fiscalYear = null, CancellationToken cancellationToken = default)
        => CommitAsync(content, target, format, fiscalYear, null, cancellationToken);

    public async Task<Result<ReferenceImportPreviewDto>> PreviewAsync(
        byte[] content, ReferenceImportTarget target, JournalImportFormat format,
        int? fiscalYear, byte[]? accountMappingContent, CancellationToken cancellationToken = default)
    {
        if (!_settings.DossierImportEnabled)
            return Result.Failure<ReferenceImportPreviewDto>(Error.Validation("Import", "La reprise de dossier par import n'est pas activée."));

        var prepared = await PrepareAsync(content, target, format, fiscalYear, accountMappingContent, cancellationToken);
        if (prepared.IsFailure)
            return Result.Failure<ReferenceImportPreviewDto>(prepared.Error);

        return Result.Success(prepared.Value.Preview);
    }

    public async Task<Result<ReferenceImportCommitResultDto>> CommitAsync(
        byte[] content, ReferenceImportTarget target, JournalImportFormat format,
        int? fiscalYear, byte[]? accountMappingContent, CancellationToken cancellationToken = default)
    {
        if (!_settings.DossierImportEnabled)
            return Result.Failure<ReferenceImportCommitResultDto>(Error.Validation("Import", "La reprise de dossier par import n'est pas activée."));

        var prepared = await PrepareAsync(content, target, format, fiscalYear, accountMappingContent, cancellationToken);
        if (prepared.IsFailure)
            return Result.Failure<ReferenceImportCommitResultDto>(prepared.Error);

        if (!prepared.Value.Preview.CanCommit)
        {
            var first = prepared.Value.Preview.Issues.FirstOrDefault(i => i.IsBlocking);
            return Result.Failure<ReferenceImportCommitResultDto>(Error.Validation("Import",
                first is not null ? $"Import refusé : {first.Ref} — {first.Message}" : "Import refusé : aucune donnée exploitable."));
        }

        await using var ctx = _contextFactory.CreateContext();
        var result = target switch
        {
            ReferenceImportTarget.ChartOfAccounts => await CommitChartAsync(ctx, prepared.Value.Rows, cancellationToken),
            ReferenceImportTarget.ThirdParties => await CommitThirdPartiesAsync(ctx, prepared.Value.Rows, cancellationToken),
            ReferenceImportTarget.OpeningBalance => await CommitOpeningBalanceAsync(ctx, prepared.Value.Rows, fiscalYear!.Value, cancellationToken),
            _ => Result.Failure<ReferenceImportCommitResultDto>(Error.Validation("Target", "Cible d'import inconnue."))
        };
        return result;
    }

    // ── Préparation partagée (lecture + validation) ───────────────────────────

    private sealed record Prepared(ReferenceImportPreviewDto Preview, List<Dictionary<string, string>> Rows);

    private async Task<Result<Prepared>> PrepareAsync(
        byte[] content, ReferenceImportTarget target, JournalImportFormat format, int? fiscalYear,
        byte[]? accountMappingContent, CancellationToken ct)
    {
        if (format == JournalImportFormat.Fec)
            return Result.Failure<Prepared>(Error.Validation("Format", "Le format FEC ne s'applique qu'à l'import d'écritures."));

        if (target == ReferenceImportTarget.OpeningBalance && fiscalYear is null)
            return Result.Failure<Prepared>(Error.Validation("FiscalYear", "L'exercice est obligatoire pour importer une balance d'ouverture."));

        var (synonyms, required, expected) = Schema(target);
        var (rows, readIssues) = ReadRows(content, format, synonyms, required, expected);

        var issues = new List<ImportIssueDto>(readIssues);

        // Table de correspondance facultative : traduit la colonne « compte » AVANT toute validation.
        // Sans table, aucune traduction — comportement historique strict.
        var mapping = await ApplyAccountMappingAsync(rows, target, accountMappingContent, format, issues, ct);

        var existing = 0;
        if (rows.Count > 0)
        {
            var validation = target switch
            {
                ReferenceImportTarget.ChartOfAccounts => await ValidateChartAsync(rows, ct),
                ReferenceImportTarget.ThirdParties => await ValidateThirdPartiesAsync(rows, ct),
                ReferenceImportTarget.OpeningBalance => await ValidateOpeningBalanceAsync(rows, fiscalYear!.Value, ct),
                _ => (new List<ImportIssueDto>(), 0)
            };
            issues.AddRange(validation.Item1);
            existing = validation.Item2;
        }

        var blocking = issues.Count(i => i.IsBlocking);
        var sample = BuildSample(target, rows);

        var preview = new ReferenceImportPreviewDto
        {
            Target = target,
            TotalRows = rows.Count,
            ValidRows = Math.Max(0, rows.Count - blocking),
            RowsWithErrors = blocking,
            ExistingRows = existing,
            CanCommit = blocking == 0 && rows.Count > 0,
            Issues = issues,
            Sample = sample,
            MappedAccountCount = mapping?.AppliedCount ?? 0,
            UnusedMappings = mapping?.UnusedSources ?? Array.Empty<string>()
        };
        return Result.Success(new Prepared(preview, rows));
    }

    /// <summary>
    /// Applique la table de correspondance à la colonne « compte » des lignes lues, EN PLACE et
    /// AVANT validation. Ne concerne que les cibles portant des numéros de compte (plan comptable et
    /// balance d'ouverture) — le plan tiers n'en a pas. Une CIBLE absente du plan comptable est une
    /// anomalie bloquante (erreur de table, pas de données).
    /// </summary>
    private async Task<AccountMappingTable?> ApplyAccountMappingAsync(
        List<Dictionary<string, string>> rows,
        ReferenceImportTarget target,
        byte[]? accountMappingContent,
        JournalImportFormat format,
        List<ImportIssueDto> issues,
        CancellationToken ct)
    {
        if (accountMappingContent is not { Length: > 0 })
            return null;

        if (target == ReferenceImportTarget.ThirdParties)
        {
            issues.Add(new ImportIssueDto
            {
                Ref = "correspondance",
                Message = "La table de correspondance de comptes ne s'applique pas à l'import du plan tiers.",
                IsBlocking = true
            });
            return null;
        }

        var (table, mappingIssues) = AccountMappingTable.Parse(accountMappingContent, format);
        issues.AddRange(mappingIssues);
        if (table is null)
            return null;

        await using (var ctx = _contextFactory.CreateContext())
        {
            var known = await ctx.ChartOfAccounts.AsNoTracking()
                .Select(c => c.AccountNumber)
                .ToListAsync(ct);
            var knownSet = new HashSet<string>(known, StringComparer.Ordinal);

            // Pour le plan comptable, la cible EST créée par l'import : on n'exige pas sa présence
            // préalable. Pour la balance d'ouverture, elle doit déjà exister.
            if (target == ReferenceImportTarget.OpeningBalance)
            {
                foreach (var missing in table.TargetAccounts.Where(t => !knownSet.Contains(t)))
                {
                    issues.Add(new ImportIssueDto
                    {
                        Ref = "correspondance",
                        Message = $"Le compte cible {missing} de la table de correspondance est absent du plan comptable.",
                        IsBlocking = true
                    });
                }
            }
        }

        foreach (var row in rows)
        {
            if (!row.TryGetValue("compte", out var account) || string.IsNullOrWhiteSpace(account))
                continue;
            row["compte"] = table.Translate(account);
        }

        return table;
    }

    // ── Schémas de colonnes par cible ─────────────────────────────────────────
    // internal (et non private) : réutilisé par la migration assistée (Services/Migration) pour
    // proposer un mapping de colonnes SANS dupliquer les synonymes — source unique de vérité.
    internal static (Dictionary<string, string[]> Synonyms, string[] Required, string Expected) Schema(ReferenceImportTarget target) => target switch
    {
        ReferenceImportTarget.ChartOfAccounts => (
            new Dictionary<string, string[]>
            {
                ["compte"] = new[] { "compte", "numero", "numerocompte", "account", "num" },
                ["libelle"] = new[] { "libelle", "intitule", "label", "nom", "designation" },
                ["classe"] = new[] { "classe", "class" },
                ["nature"] = new[] { "nature", "sens" }
            },
            new[] { "compte", "libelle", "classe" },
            "compte, libelle, classe (nature optionnelle : debit/credit)"),

        ReferenceImportTarget.ThirdParties => (
            new Dictionary<string, string[]>
            {
                ["type"] = new[] { "type", "categorie", "sens" },
                ["nom"] = new[] { "nom", "name", "raisonsociale", "libelle" },
                ["email"] = new[] { "email", "mail", "courriel", "mel" },
                ["rue"] = new[] { "rue", "adresse", "street", "adresse1" },
                ["ville"] = new[] { "ville", "city" },
                ["gouvernorat"] = new[] { "gouvernorat", "governorate", "region", "etat" },
                ["nif"] = new[] { "nif", "matricule", "matriculefiscal", "identifiant", "mf" },
                ["telephone"] = new[] { "telephone", "tel", "phone", "gsm" }
            },
            new[] { "type", "nom", "rue", "ville", "gouvernorat" },
            "type (client/fournisseur), nom, rue, ville, gouvernorat (email, nif, telephone optionnels)"),

        _ => ( // OpeningBalance
            new Dictionary<string, string[]>
            {
                ["compte"] = new[] { "compte", "numero", "numerocompte", "account", "num" },
                ["debit"] = new[] { "debit", "debiteur", "d" },
                ["credit"] = new[] { "credit", "crediteur", "c" }
            },
            new[] { "compte" },
            "compte, debit, credit")
    };

    // ── Validation par cible (retourne anomalies + nombre d'éléments déjà présents) ──

    private async Task<(List<ImportIssueDto>, int)> ValidateChartAsync(List<Dictionary<string, string>> rows, CancellationToken ct)
    {
        var issues = new List<ImportIssueDto>();
        await using var ctx = _contextFactory.CreateContext();
        var existingAccounts = await ctx.ChartOfAccounts.AsNoTracking().Select(c => c.AccountNumber).ToListAsync(ct);
        var existingSet = new HashSet<string>(existingAccounts, StringComparer.Ordinal);

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var existing = 0;
        var n = 1;
        foreach (var row in rows)
        {
            n++;
            var account = row.GetValueOrDefault("compte", string.Empty).Trim();
            var reference = $"ligne {n}";

            if (!account.All(char.IsDigit) || account.Length == 0)
                issues.Add(Blocking(reference, $"Numéro de compte « {account} » invalide (chiffres uniquement)."));
            else if (!seen.Add(account))
                issues.Add(Blocking(reference, $"Compte {account} en doublon dans le fichier."));
            else if (existingSet.Contains(account))
                existing++;

            if (string.IsNullOrWhiteSpace(row.GetValueOrDefault("libelle", string.Empty)))
                issues.Add(Blocking(reference, "Libellé obligatoire."));

            var classeStr = row.GetValueOrDefault("classe", string.Empty).Trim();
            if (!int.TryParse(classeStr, out var classe) || classe is < 1 or > 7)
                issues.Add(Blocking(reference, $"Classe « {classeStr} » invalide (1 à 7)."));
        }
        return (issues, existing);
    }

    private async Task<(List<ImportIssueDto>, int)> ValidateThirdPartiesAsync(List<Dictionary<string, string>> rows, CancellationToken ct)
    {
        var issues = new List<ImportIssueDto>();
        await using var ctx = _contextFactory.CreateContext();
        var existingClients = await ctx.Clients.AsNoTracking().Select(c => c.Name).ToListAsync(ct);
        var existingSuppliers = await ctx.Suppliers.AsNoTracking().Select(s => s.Name).ToListAsync(ct);
        var clientSet = new HashSet<string>(existingClients, StringComparer.OrdinalIgnoreCase);
        var supplierSet = new HashSet<string>(existingSuppliers, StringComparer.OrdinalIgnoreCase);

        var existing = 0;
        var n = 1;
        foreach (var row in rows)
        {
            n++;
            var reference = $"ligne {n}";
            var kind = ResolveThirdPartyKind(row.GetValueOrDefault("type", string.Empty));
            if (kind is null)
                issues.Add(Blocking(reference, "Type invalide (attendu : client ou fournisseur)."));

            var name = row.GetValueOrDefault("nom", string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(name))
                issues.Add(Blocking(reference, "Nom obligatoire."));

            // Email facultatif : une cellule vide est acceptée, un format invalide bloque la ligne.
            var emailRaw = row.GetValueOrDefault("email", string.Empty);
            if (!string.IsNullOrWhiteSpace(emailRaw) && EmailVo.Create(emailRaw).IsFailure)
                issues.Add(Blocking(reference, "Email invalide."));
            if (string.IsNullOrWhiteSpace(row.GetValueOrDefault("rue", string.Empty))
                || string.IsNullOrWhiteSpace(row.GetValueOrDefault("ville", string.Empty))
                || string.IsNullOrWhiteSpace(row.GetValueOrDefault("gouvernorat", string.Empty)))
                issues.Add(Blocking(reference, "Adresse incomplète (rue, ville et gouvernorat obligatoires)."));

            if (kind == ThirdPartyKind.Client && clientSet.Contains(name)) existing++;
            else if (kind == ThirdPartyKind.Supplier && supplierSet.Contains(name)) existing++;
        }
        return (issues, existing);
    }

    private async Task<(List<ImportIssueDto>, int)> ValidateOpeningBalanceAsync(List<Dictionary<string, string>> rows, int fiscalYear, CancellationToken ct)
    {
        var issues = new List<ImportIssueDto>();
        await using var ctx = _contextFactory.CreateContext();

        // Garde : refus si un à-nouveau existe déjà pour cet exercice (import ou génération).
        var sourceId = OpeningBalanceSourceId(fiscalYear - 1);
        var alreadyHasOpening = await ctx.JournalEntries.AsNoTracking()
            .AnyAsync(e => e.SourceEntityType == AccountingService.SourceOpeningBalance
                           && e.SourceEntityId == sourceId, ct);
        if (alreadyHasOpening)
            issues.Add(Blocking("exercice", $"Une balance d'ouverture existe déjà pour l'exercice {fiscalYear}. Supprimez-la avant de réimporter."));

        var accounts = await ctx.ChartOfAccounts.AsNoTracking().Select(c => new { c.AccountNumber, c.IsActive }).ToListAsync(ct);
        var accountMap = accounts.ToDictionary(a => a.AccountNumber, a => a.IsActive, StringComparer.Ordinal);

        decimal totalDebit = 0, totalCredit = 0;
        var n = 1;
        foreach (var row in rows)
        {
            n++;
            var reference = $"ligne {n}";
            var account = row.GetValueOrDefault("compte", string.Empty).Trim();
            TabularFileParsing.TryParseAmount(row.GetValueOrDefault("debit", string.Empty), out var debit);
            TabularFileParsing.TryParseAmount(row.GetValueOrDefault("credit", string.Empty), out var credit);

            if (string.IsNullOrWhiteSpace(account))
                issues.Add(Blocking(reference, "Compte obligatoire."));
            else if (!accountMap.TryGetValue(account, out var isActive))
                issues.Add(Blocking(reference, $"Compte {account} absent du plan comptable."));
            else if (!isActive)
                issues.Add(Blocking(reference, $"Compte {account} désactivé."));

            if (debit < 0 || credit < 0)
                issues.Add(Blocking(reference, "Les montants doivent être positifs ou nuls."));
            if (debit > 0 && credit > 0)
                issues.Add(Blocking(reference, "Une ligne ne peut pas avoir simultanément un débit et un crédit."));

            totalDebit += debit;
            totalCredit += credit;
        }

        if (rows.Count < 2)
            issues.Add(Blocking("balance", "Une balance d'ouverture requiert au moins deux lignes."));
        if (Math.Round(totalDebit - totalCredit, 3) != 0m)
            issues.Add(Blocking("balance", $"Balance déséquilibrée (débit {totalDebit:0.###} ≠ crédit {totalCredit:0.###})."));

        return (issues, 0);
    }

    // ── Commit par cible ──────────────────────────────────────────────────────

    private static async Task<Result<ReferenceImportCommitResultDto>> CommitChartAsync(
        Persistence.TenantDbContext ctx, List<Dictionary<string, string>> rows, CancellationToken ct)
    {
        var existingSet = new HashSet<string>(
            await ctx.ChartOfAccounts.Select(c => c.AccountNumber).ToListAsync(ct), StringComparer.Ordinal);

        var created = 0;
        var skipped = 0;
        foreach (var row in rows)
        {
            var account = row.GetValueOrDefault("compte", string.Empty).Trim();
            if (existingSet.Contains(account)) { skipped++; continue; }

            var classe = int.Parse(row.GetValueOrDefault("classe", "0"), CultureInfo.InvariantCulture);
            var nature = ResolveNature(row.GetValueOrDefault("nature", string.Empty), classe);
            var create = ChartOfAccount.Create(account, row.GetValueOrDefault("libelle", string.Empty).Trim(), classe, null, nature);
            if (create.IsFailure)
                return Result.Failure<ReferenceImportCommitResultDto>(Error.Validation("Import", $"Compte {account} : {create.Error.Description}"));

            var entity = create.Value;
            entity.SetAuditInfo("system", false);
            ctx.ChartOfAccounts.Add(entity);
            existingSet.Add(account);
            created++;
        }

        await ctx.SaveChangesAsync(ct);
        return Result.Success(new ReferenceImportCommitResultDto { CreatedCount = created, SkippedCount = skipped });
    }

    private static async Task<Result<ReferenceImportCommitResultDto>> CommitThirdPartiesAsync(
        Persistence.TenantDbContext ctx, List<Dictionary<string, string>> rows, CancellationToken ct)
    {
        var clientNames = new HashSet<string>(await ctx.Clients.Select(c => c.Name).ToListAsync(ct), StringComparer.OrdinalIgnoreCase);
        var supplierNames = new HashSet<string>(await ctx.Suppliers.Select(s => s.Name).ToListAsync(ct), StringComparer.OrdinalIgnoreCase);

        var created = 0;
        var skipped = 0;
        foreach (var row in rows)
        {
            var kind = ResolveThirdPartyKind(row.GetValueOrDefault("type", string.Empty))!.Value;
            var name = row.GetValueOrDefault("nom", string.Empty).Trim();

            var address = Address.Create(
                row.GetValueOrDefault("rue", string.Empty).Trim(),
                row.GetValueOrDefault("ville", string.Empty).Trim(),
                row.GetValueOrDefault("gouvernorat", string.Empty).Trim());
            var email = EmailVo.CreateOptional(row.GetValueOrDefault("email", string.Empty));
            if (address.IsFailure || email.IsFailure)
                return Result.Failure<ReferenceImportCommitResultDto>(Error.Validation("Import", $"Tiers « {name} » : coordonnées invalides."));

            NIF? nif = null;
            var nifRaw = row.GetValueOrDefault("nif", string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(nifRaw))
            {
                var nifResult = NIF.Create(nifRaw);
                if (nifResult.IsSuccess) nif = nifResult.Value;
            }

            PhoneNumber? phone = null;
            var phoneRaw = row.GetValueOrDefault("telephone", string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(phoneRaw))
            {
                var phoneResult = PhoneNumber.Create(phoneRaw);
                if (phoneResult.IsSuccess) phone = phoneResult.Value;
            }

            if (kind == ThirdPartyKind.Client)
            {
                if (clientNames.Contains(name)) { skipped++; continue; }
                // Type professionnel seulement si un NIF valide est fourni (Business l'exige) ;
                // sinon particulier, sans NIF — jamais d'échec de création ni de NIF fictif.
                var clientType = nif is not null ? ClientType.Business : ClientType.Individual;
                var create = Client.Create(name, clientType, address.Value, email.Value, nif, phone);
                if (create.IsFailure)
                    return Result.Failure<ReferenceImportCommitResultDto>(Error.Validation("Import", $"Client « {name} » : {create.Error.Description}"));
                var entity = create.Value;
                entity.SetAuditInfo("system", false);
                ctx.Clients.Add(entity);
                clientNames.Add(name);
            }
            else
            {
                if (supplierNames.Contains(name)) { skipped++; continue; }
                var supplierType = nif is not null ? SupplierType.Business : SupplierType.Individual;
                var create = Supplier.Create(name, supplierType, address.Value, email.Value, nif, phone);
                if (create.IsFailure)
                    return Result.Failure<ReferenceImportCommitResultDto>(Error.Validation("Import", $"Fournisseur « {name} » : {create.Error.Description}"));
                var entity = create.Value;
                entity.SetAuditInfo("system", false);
                ctx.Suppliers.Add(entity);
                supplierNames.Add(name);
            }
            created++;
        }

        await ctx.SaveChangesAsync(ct);
        return Result.Success(new ReferenceImportCommitResultDto { CreatedCount = created, SkippedCount = skipped });
    }

    private async Task<Result<ReferenceImportCommitResultDto>> CommitOpeningBalanceAsync(
        Persistence.TenantDbContext ctx, List<Dictionary<string, string>> rows, int fiscalYear, CancellationToken ct)
    {
        var jan1 = new DateTime(fiscalYear, 1, 1);
        var period = await _periodService.EnsureOpenPeriodAsync(jan1, ct);
        if (period.IsFailure)
            return Result.Failure<ReferenceImportCommitResultDto>(period.Error);

        var lines = new List<JournalLineInput>();
        foreach (var row in rows)
        {
            var account = row.GetValueOrDefault("compte", string.Empty).Trim();
            TabularFileParsing.TryParseAmount(row.GetValueOrDefault("debit", string.Empty), out var debit);
            TabularFileParsing.TryParseAmount(row.GetValueOrDefault("credit", string.Empty), out var credit);
            if (debit == 0m && credit == 0m) continue;
            lines.Add(new JournalLineInput(account, $"À-nouveau importé {fiscalYear} — {account}",
                Math.Round(debit, 3), Math.Round(credit, 3), null, ThirdPartyKind.None));
        }

        if (lines.Count < 2)
            return Result.Failure<ReferenceImportCommitResultDto>(Error.Validation("Import", "Aucune ligne d'à-nouveau exploitable."));

        // Numérotation dans le même contexte (atomique avec l'écriture).
        var seq = await ctx.JournalEntrySequences.FirstOrDefaultAsync(s => s.JournalCode == "JAN" && s.FiscalYear == fiscalYear, ct);
        if (seq is null)
        {
            seq = JournalEntrySequence.Create("JAN", fiscalYear);
            seq.SetAuditInfo("system", false);
            ctx.JournalEntrySequences.Add(seq);
        }
        var number = seq.Next();

        // Même source que les à-nouveaux générés (exclusion mutuelle avec GenerateOpeningEntriesAsync,
        // et reconnaissance par l'ancrage des soldes du lot 0).
        var create = JournalEntry.Create(
            number, "JAN", jan1, $"Balance d'ouverture importée — Exercice {fiscalYear}",
            period.Value.Id, isAutoGenerated: false,
            AccountingService.SourceOpeningBalance, OpeningBalanceSourceId(fiscalYear - 1),
            lines, Money.DefaultCurrency, reversesEntryId: null, initialStatus: JournalEntryStatus.Brouillon);
        if (create.IsFailure)
            return Result.Failure<ReferenceImportCommitResultDto>(create.Error);

        var entry = create.Value;
        entry.SetAuditInfo("system", false);
        ctx.JournalEntries.Add(entry);

        await ctx.SaveChangesAsync(ct);
        return Result.Success(new ReferenceImportCommitResultDto { CreatedCount = lines.Count, SkippedCount = 0 });
    }

    // ── Lecture tabulaire générique (CSV / Excel) ─────────────────────────────
    // Déléguée à TabularRowReader (extraction verbatim, partagée avec AccountMappingTable).

    private static (List<Dictionary<string, string>> Rows, List<ImportIssueDto> Issues) ReadRows(
        byte[] content, JournalImportFormat format, IReadOnlyDictionary<string, string[]> synonyms, string[] required, string expected)
        => TabularRowReader.Read(content, format, synonyms, required, expected);

    // ── Utilitaires ───────────────────────────────────────────────────────────

    private static IReadOnlyList<ReferenceImportRowDto> BuildSample(ReferenceImportTarget target, List<Dictionary<string, string>> rows) =>
        rows.Take(SampleSize).Select((row, i) => new ReferenceImportRowDto
        {
            Ref = $"ligne {i + 2}",
            Summary = target switch
            {
                ReferenceImportTarget.ChartOfAccounts => $"{row.GetValueOrDefault("compte")} — {row.GetValueOrDefault("libelle")}",
                ReferenceImportTarget.ThirdParties => $"{row.GetValueOrDefault("type")} : {row.GetValueOrDefault("nom")}",
                _ => $"{row.GetValueOrDefault("compte")} — D {row.GetValueOrDefault("debit")} / C {row.GetValueOrDefault("credit")}"
            }
        }).ToList();

    private static ThirdPartyKind? ResolveThirdPartyKind(string value)
    {
        var v = TabularFileParsing.Normalize(value);
        if (v is "client" or "clients" or "c" or "1") return ThirdPartyKind.Client;
        if (v is "fournisseur" or "fournisseurs" or "f" or "supplier" or "2") return ThirdPartyKind.Supplier;
        return null;
    }

    private static AccountNatureType ResolveNature(string value, int classe)
    {
        var v = TabularFileParsing.Normalize(value);
        if (v is "credit" or "crediteur" or "c" or "1") return AccountNatureType.Credit;
        if (v is "debit" or "debiteur" or "d" or "0") return AccountNatureType.Debit;
        // Défaut par classe quand la nature n'est pas fournie : capitaux (1) et produits (7) au crédit.
        return classe is 1 or 7 ? AccountNatureType.Credit : AccountNatureType.Debit;
    }

    /// <summary>Réplique déterministe de la clé de source des à-nouveaux (cf. AccountingService.GuidFromFiscalYear).</summary>
    private static Guid OpeningBalanceSourceId(int fiscalYear)
    {
        var bytes = new byte[16];
        BitConverter.GetBytes(fiscalYear).CopyTo(bytes, 0);
        bytes[4] = 0xA0;
        bytes[5] = 0x0B;
        return new Guid(bytes);
    }

    private static ImportIssueDto Blocking(string reference, string message) =>
        new() { Ref = reference, Message = message, IsBlocking = true };
}
