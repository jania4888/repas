using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

/// <inheritdoc />
public sealed class FirmDelegatedAccessProjector : IFirmDelegatedAccessProjector
{
    private readonly MasterDbContext _masterContext;
    private readonly AccountingFirmsOptions _accountingFirmsOptions;

    public FirmDelegatedAccessProjector(
        MasterDbContext masterContext,
        IOptions<AccountingFirmsOptions> accountingFirmsOptions)
    {
        _masterContext = masterContext;
        _accountingFirmsOptions = accountingFirmsOptions.Value;
    }

    public async Task<FirmDelegatedAccessProjection> ProjectAsync(
        UserRole role,
        Guid firmTenantId,
        Guid contextTenantId,
        CancellationToken cancellationToken = default)
    {
        var contextTenant = await _masterContext.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == contextTenantId, cancellationToken);

        // Seuls les dossiers gérés PAR CE CABINET (créés par lui, sans compte plateforme).
        var isFirmManaged = contextTenant?.ManagedByFirmTenantId == firmTenantId;

        var (permissions, moduleIds) = FirmDelegatedAccess.ApplyAiAccountingFlag(
            FirmDelegatedAccess.BuildDelegatedPermissions(role),
            FirmDelegatedAccess.BuildDelegatedModuleIds(isFirmManaged),
            _accountingFirmsOptions.AiAccountingEnabled);

        if (!isFirmManaged)
            moduleIds = await AppendProjectsIfClientLicensedAsync(contextTenantId, moduleIds, cancellationToken);

        return new FirmDelegatedAccessProjection(
            isFirmManaged,
            contextTenant?.CompanyName,
            permissions,
            moduleIds);
    }

    /// <summary>
    /// Adds <see cref="AppModule.Projects"/> only when the client tenant's plan or override includes it.
    /// Firm-managed dossiers stay on the accounting/payroll dump (no Projects in V1).
    /// </summary>
    private async Task<IReadOnlyList<int>> AppendProjectsIfClientLicensedAsync(
        Guid clientTenantId,
        IReadOnlyList<int> moduleIds,
        CancellationToken cancellationToken)
    {
        if (moduleIds.Contains((int)AppModule.Projects))
            return moduleIds;

        var now = DateTime.UtcNow;
        var overrideRow = await _masterContext.TenantModuleOverrides.AsNoTracking()
            .Where(o => o.TenantId == clientTenantId && o.Module == (int)AppModule.Projects)
            .Where(o => o.ExpiresAt == null || o.ExpiresAt > now)
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        bool licensed;
        if (overrideRow is not null)
        {
            licensed = overrideRow.IsEnabled;
        }
        else
        {
            var planId = await _masterContext.Subscriptions.AsNoTracking()
                .Where(s => s.TenantId == clientTenantId)
                .Select(s => s.PlanId)
                .FirstOrDefaultAsync(cancellationToken);

            if (planId is null || planId == Guid.Empty)
                licensed = false;
            else
                licensed = await _masterContext.PlanModules.AsNoTracking()
                    .AnyAsync(
                        m => m.PlanId == planId.Value && m.Module == (int)AppModule.Projects && m.IsIncluded,
                        cancellationToken);
        }

        if (!licensed)
            return moduleIds;

        var list = moduleIds.ToList();
        list.Add((int)AppModule.Projects);
        return list;
    }
}
