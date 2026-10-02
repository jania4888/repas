using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>Journal acceptable pour les écritures d'un relevé bancaire.</summary>
internal static class BankJournalRules
{
    public const string DefaultBankJournalCode = "JB";
    private const string TreasuryFamilyCode = "TRE";
    private const string CashJournalCode = "JC";

    /// <summary>Journal actif de la famille Trésorerie, hors journal de caisse ; « JB » si le catalogue est vide.</summary>
    public static async Task<bool> IsBankJournalAsync(TenantDbContext ctx, string code, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code) || code == CashJournalCode)
            return false;
        if (!await ctx.Journals.AsNoTracking().AnyAsync(cancellationToken))
            return code == DefaultBankJournalCode;

        var treasuryFamilyId = await ctx.JournalFamilies.AsNoTracking()
            .Where(f => f.Code == TreasuryFamilyCode)
            .Select(f => (Guid?)f.Id)
            .FirstOrDefaultAsync(cancellationToken);
        return await ctx.Journals.AsNoTracking()
            .AnyAsync(j => j.Code == code && j.IsActive && j.FamilyId == treasuryFamilyId, cancellationToken);
    }
}
