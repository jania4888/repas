using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Accès à la configuration de la déclaration mensuelle du dossier. Un contexte par appel, comme
/// les autres dépôts du module comptabilité.
/// </summary>
public sealed class MonthlyDeclarationConfigRepository : IMonthlyDeclarationConfigRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public MonthlyDeclarationConfigRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<IReadOnlyList<MonthlyDeclarationFamilySetting>> GetFamilySettingsAsync(
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.MonthlyDeclarationFamilySettings
            .AsNoTracking()
            .OrderBy(f => f.Family)
            .ToListAsync(cancellationToken);
    }

    public async Task<MonthlyDeclarationFamilySetting?> GetFamilySettingAsync(
        MonthlyDeclarationFamily family, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.MonthlyDeclarationFamilySettings
            .FirstOrDefaultAsync(f => f.Family == family, cancellationToken);
    }

    public async Task SaveFamilySettingAsync(
        MonthlyDeclarationFamilySetting setting, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var exists = await context.MonthlyDeclarationFamilySettings
            .AnyAsync(f => f.Id == setting.Id, cancellationToken);

        if (exists)
            context.MonthlyDeclarationFamilySettings.Update(setting);
        else
            context.MonthlyDeclarationFamilySettings.Add(setting);

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<MonthlyDeclarationRubric>> GetRubricsAsync(
        bool includeInactive, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.MonthlyDeclarationRubrics
            .AsNoTracking()
            .Include(r => r.Accounts)
            .AsQueryable();

        if (!includeInactive)
            query = query.Where(r => r.IsActive);

        return await query
            .OrderBy(r => r.Family)
            .ThenBy(r => r.DisplayOrder)
            .ThenBy(r => r.Code)
            .ToListAsync(cancellationToken);
    }

    public async Task<MonthlyDeclarationRubric?> GetRubricByIdAsync(
        Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.MonthlyDeclarationRubrics
            .Include(r => r.Accounts)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
    }

    public async Task<MonthlyDeclarationRubric?> GetRubricByCodeAsync(
        string code, CancellationToken cancellationToken = default)
    {
        var normalized = (code ?? string.Empty).Trim().ToUpperInvariant();
        await using var context = _contextFactory.CreateContext();
        return await context.MonthlyDeclarationRubrics
            .Include(r => r.Accounts)
            .FirstOrDefaultAsync(r => r.Code == normalized, cancellationToken);
    }

    public async Task<int> CountRubricsAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.MonthlyDeclarationRubrics.CountAsync(cancellationToken);
    }

    public async Task AddRubricAsync(
        MonthlyDeclarationRubric rubric, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.MonthlyDeclarationRubrics.Add(rubric);
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Réécrit la rubrique et sa sélection de comptes en une transaction implicite.
    /// </summary>
    /// <remarks>
    /// Les comptes sont purgés puis réinsérés plutôt que rapprochés un à un : l'agrégat a déjà
    /// reconstruit la liste, et un rapprochement ligne à ligne réintroduirait la question de
    /// l'identité d'un compte — question qui n'a pas de réponse, un compte de rubrique n'ayant
    /// d'existence que par son couple (rôle, numéro).
    /// </remarks>
    public async Task UpdateRubricAsync(
        MonthlyDeclarationRubric rubric, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var existingAccounts = await context.MonthlyDeclarationRubricAccounts
            .Where(a => a.RubricId == rubric.Id)
            .ToListAsync(cancellationToken);
        context.MonthlyDeclarationRubricAccounts.RemoveRange(existingAccounts);

        context.MonthlyDeclarationRubrics.Update(rubric);
        foreach (var account in rubric.Accounts)
            context.Entry(account).State = EntityState.Added;

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> IsCatalogAppliedAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.MonthlyDeclarationRubricSeedLogs
            .AsNoTracking()
            .AnyAsync(l => l.CatalogVersion == MonthlyDeclarationCatalogReset.ResetVersion, cancellationToken);
    }

    public async Task DeleteRubricAsync(
        MonthlyDeclarationRubric rubric, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.MonthlyDeclarationRubrics.Remove(rubric);
        await context.SaveChangesAsync(cancellationToken);
    }
}
