using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed class VatDeclarationRepository : IVatDeclarationRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public VatDeclarationRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<VatDeclaration?> GetByYearMonthAsync(int year, int month, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        // Le détail par rubrique est chargé avec la déclaration : c'est lui qui fait foi à
        // l'édition d'une période déposée, et une lecture séparée rouvrirait la porte à un
        // affichage où l'en-tête est celui du dépôt et les lignes celles d'aujourd'hui.
        return await ctx.VatDeclarations
            .Include(v => v.Lines)
            .FirstOrDefaultAsync(v => v.Year == year && v.Month == month, cancellationToken);
    }

    public async Task<IReadOnlyList<VatDeclaration>> GetByYearAsync(
        int year, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        return await ctx.VatDeclarations
            .AsNoTracking()
            .Where(v => v.Year == year)
            .OrderBy(v => v.Month)
            .ToListAsync(cancellationToken);
    }

    public async Task<VatDeclaration> AddAsync(VatDeclaration entity, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        ctx.VatDeclarations.Add(entity);
        await ctx.SaveChangesAsync(cancellationToken);
        return entity;
    }

    /// <summary>
    /// Réécrit la déclaration et son détail par rubrique.
    /// </summary>
    /// <remarks>
    /// Les lignes existantes sont purgées puis réinsérées : le détail est un instantané que la
    /// sauvegarde régénère, pas un ensemble d'objets à rapprocher un à un. Les rapprocher exigerait
    /// une identité de ligne stable entre deux calculs, que rien ne garantit dès qu'une rubrique est
    /// ajoutée ou retirée de la configuration.
    /// </remarks>
    public async Task UpdateAsync(VatDeclaration entity, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var existingLines = await ctx.VatDeclarationLines
            .Where(l => l.VatDeclarationId == entity.Id)
            .ToListAsync(cancellationToken);
        ctx.VatDeclarationLines.RemoveRange(existingLines);

        ctx.VatDeclarations.Update(entity);
        foreach (var line in entity.Lines)
            ctx.Entry(line).State = EntityState.Added;

        await ctx.SaveChangesAsync(cancellationToken);
    }
}
