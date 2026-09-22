using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.MultiTenancy;

/// <summary>
/// Implémentation de <see cref="ITenantRuntimeCatalogSeeder"/> : ouvre un contexte tenant isolé sur
/// la chaîne de connexion fournie et délègue à <see cref="TenantRuntimeCatalogBootstrapper"/>.
/// </summary>
/// <remarks>
/// Le contexte est construit ici, et non injecté : au provisionnement la chaîne de connexion n'est
/// pas encore enregistrée en base master, et le bootstrapper ouvre ses propres transactions — il ne
/// doit donc jamais s'exécuter sur l'unité de travail ambiante.
/// </remarks>
public sealed class TenantRuntimeCatalogSeeder : ITenantRuntimeCatalogSeeder
{
    private readonly ILogger<TenantRuntimeCatalogSeeder> _logger;

    public TenantRuntimeCatalogSeeder(ILogger<TenantRuntimeCatalogSeeder> logger)
    {
        _logger = logger;
    }

    public async Task<TenantRuntimeCatalogReport> EnsureAsync(
        string connectionString,
        bool authorizeChartRemap = false,
        CancellationToken cancellationToken = default)
    {
        await using var context = CreateContext(connectionString);
        return await TenantRuntimeCatalogBootstrapper.EnsureAsync(
            context,
            authorizeChartRemap ? ChartMigrationMode.Authorized : ChartMigrationMode.AutoSafe,
            cancellationToken,
            _logger);
    }

    public async Task<TenantRuntimeCatalogReport> InspectAsync(
        string connectionString,
        CancellationToken cancellationToken = default)
    {
        await using var context = CreateContext(connectionString);
        return await Nct01ChartMigrationService.InspectAsync(context, cancellationToken);
    }

    private static TenantDbContext CreateContext(string connectionString) =>
        new(new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString, b => b.MigrationsAssembly(typeof(TenantDbContext).Assembly.FullName))
            .Options);
}
