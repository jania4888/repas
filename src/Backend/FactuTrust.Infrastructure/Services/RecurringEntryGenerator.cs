using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Génère les écritures des modèles récurrents échus. Opère ENTIÈREMENT dans le
/// <see cref="TenantDbContext"/> fourni (utilisable depuis un job multi-tenant hors requête HTTP,
/// comme depuis l'action « Générer maintenant ») : période assurée en contexte, numérotation via
/// <c>JournalEntrySequences</c> (pattern JournalImportService), et <c>MarkRun</c> avancé dans le
/// MÊME SaveChanges que l'écriture — l'idempotence tient à cette atomicité.
/// </summary>
public sealed class RecurringEntryGenerator
{
    public const string SourceRecurringTemplate = "RecurringTemplate";

    private readonly ILogger<RecurringEntryGenerator> _logger;

    public RecurringEntryGenerator(ILogger<RecurringEntryGenerator> logger)
    {
        _logger = logger;
    }

    /// <summary>Génère toutes les occurrences échues (NextRunDate ≤ today) des modèles actifs. Renvoie le nombre d'écritures créées.</summary>
    public async Task<int> GenerateDueEntriesAsync(
        TenantDbContext ctx, AccountingSettings settings, DateTime today, CancellationToken cancellationToken = default)
    {
        var due = await ctx.JournalEntryTemplates
            .Include(t => t.Lines)
            .Where(t => t.IsActive
                        && t.RecurrenceFrequency != RecurrenceFrequency.None
                        && t.NextRunDate != null && t.NextRunDate <= today.Date)
            .ToListAsync(cancellationToken);

        var generated = 0;
        foreach (var template in due)
        {
            try
            {
                // Rattrape les échéances en retard une par une (job quotidien : borné en pratique).
                while (template.NextRunDate is { } occurrence && occurrence <= today.Date)
                {
                    var result = await GenerateOccurrenceAsync(ctx, settings, template, occurrence, cancellationToken);
                    if (result.IsFailure)
                    {
                        _logger.LogWarning(
                            "Recurring template {TemplateId} ({Name}): occurrence {Date} skipped — {Reason}",
                            template.Id, template.Name, occurrence, result.Error.Description);
                        break; // on retentera au prochain passage (NextRunDate inchangé)
                    }
                    generated++;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Recurring template {TemplateId} ({Name}) failed", template.Id, template.Name);
            }
        }

        return generated;
    }

    /// <summary>
    /// Génère UNE occurrence du modèle à la date donnée puis avance l'échéance — le tout dans un
    /// seul SaveChanges. Si la période de l'occurrence est clôturée, l'écriture est datée du jour
    /// (même repli que l'extourne). L'écriture naît <see cref="JournalEntryStatus.Validee"/> :
    /// <paramref name="settings"/> est conservé pour les appelants, le brouillard ne s'applique pas
    /// à un modèle récurrent.
    /// </summary>
    public async Task<Result<Guid>> GenerateOccurrenceAsync(
        TenantDbContext ctx,
        AccountingSettings settings,
        JournalEntryTemplate template,
        DateTime occurrenceDate,
        CancellationToken cancellationToken = default)
    {
        // Signature stable pour le job et l'action « Générer maintenant ».
        // Le brouillard ne décide plus du statut d'un modèle récurrent.
        _ = settings;

        if (!template.IsRecurring)
            return Result.Failure<Guid>(Error.Validation("Recurrence", "Ce modèle n'est pas planifié."));

        var lines = template.Lines
            .OrderBy(l => l.LineNumber)
            .Select(l => new JournalLineInput(
                l.AccountNumber,
                string.IsNullOrWhiteSpace(l.LineLabelTemplate) ? template.Name : l.LineLabelTemplate!,
                l.FixedDebit ?? 0m,
                l.FixedCredit ?? 0m,
                null,
                ThirdPartyKind.None))
            .ToList();

        if (lines.Count < 2 || lines.Any(l => l.Debit == 0m && l.Credit == 0m))
            return Result.Failure<Guid>(Error.Validation("Recurrence",
                "Le modèle n'est plus entièrement chiffré : corrigez ses lignes ou désactivez la récurrence."));

        // Comptes actifs uniquement (même règle que la saisie manuelle).
        var accountNumbers = lines.Select(l => l.AccountNumber).Distinct().ToList();
        var accounts = await ctx.ChartOfAccounts.AsNoTracking()
            .Where(c => accountNumbers.Contains(c.AccountNumber))
            .ToDictionaryAsync(c => c.AccountNumber, cancellationToken);
        foreach (var acc in accountNumbers)
        {
            if (!accounts.TryGetValue(acc, out var account))
                return Result.Failure<Guid>(Error.Validation("AccountNumber", $"Le compte {acc} n'existe pas dans le plan comptable."));
            if (!account.IsActive)
                return Result.Failure<Guid>(Error.Validation("AccountNumber", $"Le compte {acc} est désactivé."));
        }

        // Période de l'occurrence, créée au besoin ; repli sur aujourd'hui si clôturée.
        var entryDate = occurrenceDate.Date;
        var period = await EnsureOpenPeriodAsync(ctx, entryDate, cancellationToken);
        if (period is null)
        {
            entryDate = DateTime.UtcNow.Date;
            period = await EnsureOpenPeriodAsync(ctx, entryDate, cancellationToken);
            if (period is null)
                return Result.Failure<Guid>(Error.Validation("Period", "Aucune période ouverte pour générer l'écriture."));
        }

        // Numérotation atomique avec l'écriture (même contexte, même SaveChanges).
        var sequence = await ctx.JournalEntrySequences
            .FirstOrDefaultAsync(s => s.JournalCode == template.JournalCode && s.FiscalYear == entryDate.Year, cancellationToken);
        if (sequence is null)
        {
            sequence = JournalEntrySequence.Create(template.JournalCode, entryDate.Year);
            sequence.SetAuditInfo("system", isUpdate: false);
            ctx.JournalEntrySequences.Add(sequence);
        }
        var number = sequence.Next();

        var label = string.IsNullOrWhiteSpace(template.LabelTemplate) ? template.Name : template.LabelTemplate!;
        label = $"{label} — {occurrenceDate:MM/yyyy}";

        var create = JournalEntry.Create(
            number,
            template.JournalCode,
            entryDate,
            label,
            period.Id,
            isAutoGenerated: true,
            SourceRecurringTemplate,
            template.Id,
            lines,
            Money.DefaultCurrency,
            reversesEntryId: null,
            initialStatus: JournalEntryStatus.Validee);

        if (create.IsFailure)
            return Result.Failure<Guid>(create.Error);

        var entry = create.Value;
        entry.SetAuditInfo("system", false);
        ctx.JournalEntries.Add(entry);

        template.MarkRun(occurrenceDate);
        template.SetAuditInfo("system", isUpdate: true);

        await ctx.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Recurring entry generated: template {TemplateId} ({Name}) → {Journal} n°{Number} dated {Date}",
            template.Id, template.Name, template.JournalCode, number, entryDate);

        return Result.Success(entry.Id);
    }

    /// <summary>Période mensuelle de la date, créée si absente ; null si clôturée.</summary>
    private static async Task<AccountingPeriod?> EnsureOpenPeriodAsync(TenantDbContext ctx, DateTime date, CancellationToken ct)
    {
        var period = await ctx.AccountingPeriods
            .FirstOrDefaultAsync(p => p.FiscalYear == date.Year && p.Month == date.Month, ct);
        if (period is null)
        {
            var start = new DateTime(date.Year, date.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var end = new DateTime(date.Year, date.Month, DateTime.DaysInMonth(date.Year, date.Month), 0, 0, 0, DateTimeKind.Utc);
            period = AccountingPeriod.Create(date.Year, date.Month, start, end);
            period.SetAuditInfo("system", false);
            ctx.AccountingPeriods.Add(period);
        }

        return period.IsClosed ? null : period;
    }
}
