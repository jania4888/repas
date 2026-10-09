using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Banking;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Services.Accounting;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Infrastructure.Services;

public sealed class BankGlTreasuryProjectionService : IBankGlTreasuryProjectionService
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly IEnsureDefaultCompanyService _companies;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _audit;
    private readonly ILogger<BankGlTreasuryProjectionService> _logger;

    public BankGlTreasuryProjectionService(
        ITenantDbContextFactory contextFactory,
        IEnsureDefaultCompanyService companies,
        ICurrentUser currentUser,
        IAuditService audit,
        ILogger<BankGlTreasuryProjectionService> logger)
    {
        _contextFactory = contextFactory;
        _companies = companies;
        _currentUser = currentUser;
        _audit = audit;
        _logger = logger;
    }

    public async Task<Result<BankGlProjectionEnsureResult>> EnsureForChartAccountAsync(
        ChartOfAccount account,
        BankGlProjectionIdentity? identity,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure<BankGlProjectionEnsureResult>(Error.Unauthorized("Tenant manquant"));

        if (!BankGlAccountRules.IsProvisionableLeaf(account.AccountNumber, account.IsActive))
            return Result.Success(new BankGlProjectionEnsureResult(0, 1));

        var company = await _companies.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (company.IsFailure)
            return Result.Failure<BankGlProjectionEnsureResult>(company.Error);

        await using var ctx = _contextFactory.CreateContext();
        var existing = await ctx.BankAccounts
            .FirstOrDefaultAsync(b => b.CompanyId == company.Value && b.ChartOfAccountNumber == account.AccountNumber, cancellationToken);

        if (existing is null)
        {
            var created = BuildProjection(company.Value, account, identity);
            if (created.IsFailure)
                return Result.Failure<BankGlProjectionEnsureResult>(created.Error);

            created.Value.SetAuditInfo(_currentUser.Email ?? "system", false);
            ctx.BankAccounts.Add(created.Value);
            await ctx.SaveChangesAsync(cancellationToken);
            await AuditCreatedAsync(created.Value, cancellationToken);
            return Result.Success(new BankGlProjectionEnsureResult(1, 0));
        }

        var enriched = TryEnrich(existing, account, identity);
        if (enriched.IsFailure)
            return Result.Failure<BankGlProjectionEnsureResult>(enriched.Error);

        if (enriched.Value)
        {
            existing.SetAuditInfo(_currentUser.Email ?? "system", true);
            await ctx.SaveChangesAsync(cancellationToken);
            await AuditUpdatedAsync(existing, cancellationToken);
        }

        return Result.Success(new BankGlProjectionEnsureResult(0, 1));
    }

    public async Task<Result<BankGlProjectionEnsureResult>> EnsureMissingAsync(CancellationToken cancellationToken = default)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure<BankGlProjectionEnsureResult>(Error.Unauthorized("Tenant manquant"));

        var company = await _companies.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (company.IsFailure)
            return Result.Failure<BankGlProjectionEnsureResult>(company.Error);

        await using var ctx = _contextFactory.CreateContext();
        var leaves = (await ctx.ChartOfAccounts.AsNoTracking()
                .Where(a => a.IsActive && (a.AccountNumber.StartsWith("5321") || a.AccountNumber.StartsWith("5324")))
                .ToListAsync(cancellationToken))
            .Where(a => BankGlAccountRules.IsProvisionableLeafNumber(a.AccountNumber))
            .ToList();

        var linked = (await ctx.BankAccounts.AsNoTracking()
                .Where(b => b.CompanyId == company.Value && b.ChartOfAccountNumber != null)
                .Select(b => b.ChartOfAccountNumber!)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var created = new List<BankAccount>();
        foreach (var leaf in leaves)
        {
            if (!linked.Add(leaf.AccountNumber))
                continue;

            var projection = BuildProjection(company.Value, leaf, identity: null);
            if (projection.IsFailure)
            {
                _logger.LogWarning("Projection ignorée pour {Account}: {Error}", leaf.AccountNumber, projection.Error.Description);
                continue;
            }

            projection.Value.SetAuditInfo(_currentUser.Email ?? "system", false);
            ctx.BankAccounts.Add(projection.Value);
            created.Add(projection.Value);
        }

        if (created.Count > 0)
            await ctx.SaveChangesAsync(cancellationToken);

        foreach (var account in created)
            await AuditCreatedAsync(account, cancellationToken);

        return Result.Success(new BankGlProjectionEnsureResult(created.Count, leaves.Count - created.Count));
    }

    public async Task<Result> SyncActiveFlagAsync(string accountNumber, bool isActive, CancellationToken cancellationToken = default)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure(Error.Unauthorized("Tenant manquant"));

        if (!BankGlAccountRules.IsProvisionableLeafNumber(accountNumber))
            return Result.Success();

        var company = await _companies.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (company.IsFailure)
            return Result.Failure(company.Error);

        await using var ctx = _contextFactory.CreateContext();
        var rows = await ctx.BankAccounts
            .Where(b => b.CompanyId == company.Value && b.ChartOfAccountNumber == accountNumber.Trim())
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return Result.Success();

        foreach (var row in rows)
            row.SetActive(isActive);

        await ctx.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> SyncLabelAsync(string accountNumber, string oldLabel, string newLabel, CancellationToken cancellationToken = default)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure(Error.Unauthorized("Tenant manquant"));

        if (!BankGlAccountRules.IsProvisionableLeafNumber(accountNumber))
            return Result.Success();

        var company = await _companies.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (company.IsFailure)
            return Result.Failure(company.Error);

        await using var ctx = _contextFactory.CreateContext();
        var rows = await ctx.BankAccounts
            .Where(b => b.CompanyId == company.Value && b.ChartOfAccountNumber == accountNumber.Trim())
            .ToListAsync(cancellationToken);

        foreach (var row in rows)
            row.SyncChartLabel(oldLabel, newLabel);

        if (rows.Count > 0)
            await ctx.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<ImportableBankAccountDto>>> ListImportableAsync(CancellationToken cancellationToken = default)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure<IReadOnlyList<ImportableBankAccountDto>>(Error.Unauthorized("Tenant manquant"));

        var company = await _companies.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (company.IsFailure)
            return Result.Failure<IReadOnlyList<ImportableBankAccountDto>>(company.Error);

        await using var ctx = _contextFactory.CreateContext();
        var rows = await ctx.BankAccounts.AsNoTracking()
            .Where(b => b.CompanyId == company.Value
                && b.IsActive
                && b.ChartOfAccountNumber != null
                && b.ChartOfAccountNumber.StartsWith("532"))
            .OrderByDescending(b => b.IsDefault)
            .ThenBy(b => b.BankName)
            .ToListAsync(cancellationToken);

        IReadOnlyList<ImportableBankAccountDto> list = rows.Select(b => new ImportableBankAccountDto
        {
            Id = b.Id,
            BankName = b.BankName,
            Designation = b.Designation,
            ChartOfAccountNumber = b.ChartOfAccountNumber!,
            Currency = b.Currency,
            IsActive = b.IsActive,
            IsDefault = b.IsDefault,
            HasBankingIdentity = b.HasBankingIdentity,
            RibMasked = MaskRib(b.Rib)
        }).ToList();

        return Result.Success(list);
    }

    private static Result<BankAccount> BuildProjection(Guid companyId, ChartOfAccount account, BankGlProjectionIdentity? identity)
    {
        var code = BankGlBankCodeResolver.Resolve(identity?.BankCode, account.Label);
        return BankAccount.CreateFromChartProjection(
            companyId,
            account.AccountNumber,
            account.Label,
            code,
            BankGlAccountRules.ResolveProjectionCurrency(account.AccountNumber, identity?.Currency),
            account.IsActive,
            identity?.Rib,
            identity?.Iban,
            identity?.SwiftBic);
    }

    /// <returns>true si une écriture est nécessaire.</returns>
    private static Result<bool> TryEnrich(BankAccount existing, ChartOfAccount account, BankGlProjectionIdentity? identity)
    {
        if (identity is null || (string.IsNullOrWhiteSpace(identity.Rib) && string.IsNullOrWhiteSpace(identity.Iban)))
            return Result.Success(false);

        if (existing.HasBankingIdentity)
            return Result.Success(false);

        var code = BankGlBankCodeResolver.Resolve(identity.BankCode, account.Label);
        var name = string.Equals(code, "AUTRE", StringComparison.OrdinalIgnoreCase) ? account.Label : existing.BankName;
        if (name.Length > 100)
            name = name[..100];

        var complete = existing.CompleteBankingIdentity(code, name, identity.Rib ?? "", identity.Iban ?? "", swiftBic: identity.SwiftBic);
        if (complete.IsFailure)
            return Result.Failure<bool>(complete.Error);

        existing.SetCurrency(BankGlAccountRules.ResolveProjectionCurrency(account.AccountNumber, identity.Currency));
        return Result.Success(true);
    }

    private Task AuditCreatedAsync(BankAccount account, CancellationToken cancellationToken) =>
        _audit.LogAsync(
            AuditActions.BankAccount.Created,
            "BankAccount",
            account.Id,
            newValues: new { bankCode = account.BankCode, chartOfAccountNumber = account.ChartOfAccountNumber, projection = true },
            cancellationToken: cancellationToken);

    private Task AuditUpdatedAsync(BankAccount account, CancellationToken cancellationToken) =>
        _audit.LogAsync(
            AuditActions.BankAccount.Updated,
            "BankAccount",
            account.Id,
            newValues: new { bankCode = account.BankCode, chartOfAccountNumber = account.ChartOfAccountNumber },
            cancellationToken: cancellationToken);

    private static string? MaskRib(string? rib)
    {
        if (string.IsNullOrWhiteSpace(rib) || rib.Length < 4)
            return null;
        return "…" + rib[^4..];
    }
}
