using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Accounting;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

public sealed class BankAccountChartProvisioningService : IBankAccountChartProvisioningService
{
    private const string DefaultParentTnd = "5321";
    private const string DefaultParentFx = "5324";

    /// <summary>Longueur du suffixe séquentiel : 5321 + 4 chiffres = 8, le plafond exact.</summary>
    private const int SuffixLength = 4;
    private const string SuffixFormat = "0000";

    private readonly ITenantDbContextFactory _contextFactory;

    public BankAccountChartProvisioningService(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<Result<string?>> ResolveChartAccountNumberAsync(
        BankAccount bankAccount,
        string? requestedChartAccountNumber,
        bool autoCreate,
        CancellationToken cancellationToken = default)
    {
        if (!string.IsNullOrWhiteSpace(requestedChartAccountNumber))
        {
            var normalized = requestedChartAccountNumber.Trim();
            var validate = await ValidateChartAccountNumberAsync(normalized, cancellationToken);
            if (validate.IsFailure)
                return Result.Failure<string?>(validate.Error);
            return Result.Success<string?>(normalized);
        }

        if (!autoCreate)
            return Result.Success<string?>(null);

        await using var ctx = _contextFactory.CreateContext();
        var parent = ResolveParentAccount(bankAccount.Currency);
        var parentRow = await ctx.ChartOfAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.AccountNumber == parent && a.IsActive, cancellationToken);
        if (parentRow is null)
            return Result.Failure<string?>(Error.Validation("ChartOfAccount",
                $"Le compte parent {parent} est absent du plan comptable."));

        var nextNumber = await AllocateNextAuxiliaryNumberAsync(ctx, parent, cancellationToken);
        if (nextNumber is null)
            return Result.Failure<string?>(Error.Validation("ChartOfAccount",
                $"Plus aucun compte auxiliaire libre sous {parent} : la numérotation est saturée "
                + $"dans la limite de {AccountNumberRules.MaxDigits} chiffres."));

        var label = BuildLabel(bankAccount);
        var create = ChartOfAccount.Create(
            nextNumber,
            label,
            accountClass: 5,
            parentAccountNumber: parent,
            natureType: AccountNatureType.Debit,
            isSystem: false,
            accountType: AccountType.General,
            isAuxiliary: true,
            affectationAccountNumber: parent);

        if (create.IsFailure)
            return Result.Failure<string?>(create.Error);

        var entity = create.Value;
        entity.SetAuditInfo("system", false);
        ctx.ChartOfAccounts.Add(entity);
        await ctx.SaveChangesAsync(cancellationToken);
        return Result.Success<string?>(nextNumber);
    }

    public async Task<Result> ValidateChartAccountNumberAsync(string chartAccountNumber, CancellationToken cancellationToken = default)
    {
        var normalized = chartAccountNumber.Trim();
        if (!normalized.StartsWith("532", StringComparison.Ordinal))
            return Result.Failure(Error.Validation("ChartOfAccountNumber",
                "Le compte comptable lié doit appartenir à la classe banques (532…)."));

        await using var ctx = _contextFactory.CreateContext();
        var exists = await ctx.ChartOfAccounts.AsNoTracking()
            .AnyAsync(a => a.AccountNumber == normalized && a.IsActive, cancellationToken);
        if (!exists)
            return Result.Failure(Error.Validation("ChartOfAccountNumber",
                $"Le compte {normalized} n'existe pas dans le plan comptable."));

        return Result.Success();
    }

    private static string ResolveParentAccount(string currency) =>
        string.Equals(currency, "TND", StringComparison.OrdinalIgnoreCase) ? DefaultParentTnd : DefaultParentFx;

    private static string BuildLabel(BankAccount bankAccount)
    {
        var suffix = bankAccount.Designation ?? MaskRib(bankAccount.Rib);
        return $"{bankAccount.BankName} — {suffix}";
    }

    private static string MaskRib(string? rib)
    {
        if (string.IsNullOrEmpty(rib)) return "sans RIB";
        if (rib.Length <= 4) return rib;
        return "…" + rib[^4..];
    }

    /// <summary>
    /// Premier suffixe à quatre chiffres libre sous <paramref name="parent"/>, ou <c>null</c> quand
    /// la numérotation est saturée.
    /// </summary>
    /// <remarks>
    /// On repart du premier suffixe libre au lieu de « le plus grand + 1 » : « 0000 » est un format
    /// de largeur <b>minimale</b>, pas une troncature, si bien que l'ancienne version débordait à
    /// 9 caractères passé 9 999 comptes — au-delà du plafond de
    /// <see cref="AccountNumberRules.MaxDigits"/> chiffres.
    /// </remarks>
    private static async Task<string?> AllocateNextAuxiliaryNumberAsync(
        Persistence.TenantDbContext ctx, string parent, CancellationToken cancellationToken)
    {
        var taken = (await ctx.ChartOfAccounts.AsNoTracking()
                .Where(a => a.AccountNumber.StartsWith(parent))
                .Select(a => a.AccountNumber)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var suffixLength = AccountNumberRules.MaxDigits - AccountNumberRules.DigitCount(parent);
        if (suffixLength < SuffixLength)
            return null;

        var max = (int)Math.Pow(10, SuffixLength) - 1;
        for (var i = 1; i <= max; i++)
        {
            var candidate = parent
                + i.ToString(SuffixFormat, System.Globalization.CultureInfo.InvariantCulture);
            if (!taken.Contains(candidate))
                return candidate;
        }

        return null;
    }
}
