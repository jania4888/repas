using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Contrôles communs au chemin PDF/IA (<see cref="BankStatementImportService"/>) et au chemin
/// CSV/XLSX (<c>BankStatementTabularImportService</c>) : compte bancaire, lecture bornée d'un flux,
/// doublon de fichier déjà importé. Partagés pour ne pas dupliquer la logique entre les deux services.
/// </summary>
internal static class BankStatementImportGuards
{
    /// <summary>Compte bancaire actif, lié à un compte 532, en dinars — sinon l'erreur à renvoyer au client.</summary>
    public static Error? CheckBankAccount(BankAccount? account)
    {
        if (account is null)
            return new Error(BankStatementImportErrorCodes.BankAccountNotFound, "Compte bancaire introuvable.");
        if (!account.IsActive)
            return new Error(BankStatementImportErrorCodes.BankAccountInactive, "Ce compte bancaire est désactivé.");
        if (string.IsNullOrWhiteSpace(account.ChartOfAccountNumber))
            return new Error(BankStatementImportErrorCodes.BankAccountWithoutGlAccount,
                "Ce compte bancaire n'est relié à aucun compte comptable 532 : reliez-le avant d'importer un relevé.");
        if (!string.Equals(account.Currency, "TND", StringComparison.OrdinalIgnoreCase))
            return new Error(BankStatementImportErrorCodes.CurrencyNotSupported,
                "Seuls les comptes en dinars (TND) sont pris en charge par l'import de relevés.");
        return null;
    }

    /// <summary>Lit au plus <paramref name="max"/> octets ; <c>null</c> si le flux dépasse cette borne.</summary>
    public static async Task<byte[]?> ReadBoundedAsync(Stream stream, long max, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > max)
                return null;
            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    /// <summary>Vrai si un relevé porte déjà ce hash de fichier pour ce compte bancaire (doublon).</summary>
    public static Task<bool> IsAlreadyImportedAsync(TenantDbContext ctx, Guid bankAccountId, string fileHash, CancellationToken cancellationToken) =>
        ctx.BankStatements.AsNoTracking().AnyAsync(s => s.BankAccountId == bankAccountId && s.SourceFileHash == fileHash, cancellationToken);

    /// <summary>Purge par lots les sessions non confirmées expirées (fichier supprimé après la ligne, pour ne jamais laisser une ligne sans fichier).</summary>
    public static async Task PurgeExpiredAsync(TenantDbContext ctx, BankStatementFileStore files, int batchSize, DateTime now, CancellationToken cancellationToken)
    {
        var expired = await ctx.BankStatementImportSessions
            .Where(s => s.Status != BankStatementImportSessionStatus.Confirmed && s.ExpiresAt < now)
            .OrderBy(s => s.ExpiresAt)
            .Take(batchSize)
            .ToListAsync(cancellationToken);
        if (expired.Count == 0)
            return;

        foreach (var session in expired)
            ctx.BankStatementImportSessions.Remove(session);
        await ctx.SaveChangesAsync(cancellationToken);
        foreach (var session in expired)
            files.TryDelete(session.StoragePath);
    }
}
