using System.Diagnostics;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Constants;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.SectorConfiguration;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.MultiTenancy;

/// <summary>
/// Service for managing tenant databases.
/// </summary>
public sealed class TenantService : ITenantService
{
    // La chaîne de connexion d'un tenant ne change qu'à sa création : le cache évite
    // un aller-retour base master + un déchiffrement DataProtection à CHAQUE requête
    // authentifiée (TenantMiddleware). TTL de sûreté aligné sur TenantMigrationGuard.
    private const string ConnectionStringCacheKeyPrefix = "TenantService.ConnectionString.";
    private static readonly TimeSpan ConnectionStringCacheDuration = TimeSpan.FromMinutes(15);

    private readonly MasterDbContext _masterContext;
    private readonly IDataProtector _protector;
    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _cache;
    private readonly ILogger<TenantService> _logger;
    private readonly TenantDatabaseProvisioner _provisioner;
    private readonly ITenantRuntimeCatalogSeeder _runtimeCatalogSeeder;
    private readonly ISectorDataTemplateApplier? _sectorTemplateApplier;

    public TenantService(
        MasterDbContext masterContext,
        IDataProtectionProvider dataProtectionProvider,
        IConfiguration configuration,
        IMemoryCache cache,
        ILogger<TenantService> logger,
        TenantDatabaseProvisioner provisioner,
        ITenantRuntimeCatalogSeeder runtimeCatalogSeeder,
        ISectorDataTemplateApplier? sectorTemplateApplier = null)
    {
        _masterContext = masterContext;
        _protector = dataProtectionProvider.CreateProtector("TenantConnectionStrings");
        _configuration = configuration;
        _cache = cache;
        _logger = logger;
        _provisioner = provisioner;
        _runtimeCatalogSeeder = runtimeCatalogSeeder;
        _sectorTemplateApplier = sectorTemplateApplier;
    }

    public async Task<string?> GetConnectionStringAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var cacheKey = $"{ConnectionStringCacheKeyPrefix}{tenantId}";
        if (_cache.TryGetValue(cacheKey, out string? cached))
            return cached;

        var tenantConnection = await _masterContext.TenantConnectionStrings
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId, cancellationToken);

        if (tenantConnection is null)
            return null; // Échec non mis en cache : un tenant tout juste provisionné doit être vu immédiatement.

        try
        {
            var connectionString = _protector.Unprotect(tenantConnection.EncryptedConnectionString);
            _cache.Set(cacheKey, connectionString, ConnectionStringCacheDuration);
            return connectionString;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to decrypt connection string for tenant {TenantId}", tenantId);
            return null;
        }
    }

    public async Task<string> CreateTenantDatabaseAsync(Guid tenantId, string databaseName, string? warehouseName = null, CancellationToken cancellationToken = default)
    {
        var masterConnectionString = GetMasterConnectionString();

        var builder = new SqlConnectionStringBuilder(masterConnectionString)
        {
            InitialCatalog = databaseName
        };

        var tenantConnectionString = builder.ConnectionString;

        var sw = Stopwatch.StartNew();
        await _provisioner.ProvisionNewTenantDatabaseAsync(
            masterConnectionString,
            databaseName,
            tenantId,
            cancellationToken);
        LogProvisionStep("Provision", sw.ElapsedMilliseconds, tenantId, databaseName);

        sw.Restart();
        await SeedDefaultWarehouseAsync(tenantConnectionString, warehouseName, cancellationToken);
        LogProvisionStep("SeedWarehouse", sw.ElapsedMilliseconds, tenantId, databaseName);

        sw.Restart();
        await SeedDefaultPassengerClientAsync(tenantConnectionString, cancellationToken);
        LogProvisionStep("SeedPassengerClient", sw.ElapsedMilliseconds, tenantId, databaseName);

        sw.Restart();
        await SeedWithholdingTaxSystemTypesAsync(tenantConnectionString, cancellationToken);
        LogProvisionStep("SeedWithholding", sw.ElapsedMilliseconds, tenantId, databaseName);

        // AVANT les modèles sectoriels : ceux-ci n'ajoutent un compte que s'il est absent, et
        // certains (341) figurent déjà dans le catalogue NCT 01.
        sw.Restart();
        var catalogsSeeded = await TrySeedRuntimeCatalogsAsync(tenantId, tenantConnectionString, cancellationToken);
        LogProvisionStep("SeedRuntimeCatalogs", sw.ElapsedMilliseconds, tenantId, databaseName);

        sw.Restart();
        await ApplySectorDataTemplatesAsync(tenantId, tenantConnectionString, cancellationToken);
        LogProvisionStep("SectorTemplates", sw.ElapsedMilliseconds, tenantId, databaseName);

        var encryptedConnectionString = _protector.Protect(tenantConnectionString);

        var tenantConnection = new TenantConnectionString
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            EncryptedConnectionString = encryptedConnectionString,
            CreatedAt = DateTime.UtcNow
        };

        _masterContext.TenantConnectionStrings.Add(tenantConnection);
        await _masterContext.SaveChangesAsync(cancellationToken);
        _cache.Remove($"{ConnectionStringCacheKeyPrefix}{tenantId}");
        MarkAppliedIfComplete(tenantId, catalogsSeeded);

        _logger.LogInformation(
            "Created database {DatabaseName} for tenant {TenantId} with default warehouse, passenger client, and withholding tax catalog",
            databaseName,
            tenantId);

        return tenantConnectionString;
    }

    public async Task<string> CreateAccountingFirmDatabaseAsync(Guid tenantId, string databaseName, CancellationToken cancellationToken = default)
    {
        var masterConnectionString = GetMasterConnectionString();

        var builder = new SqlConnectionStringBuilder(masterConnectionString)
        {
            InitialCatalog = databaseName
        };

        var tenantConnectionString = builder.ConnectionString;

        await _provisioner.ProvisionNewTenantDatabaseAsync(
            masterConnectionString,
            databaseName,
            tenantId,
            cancellationToken);

        // La base du cabinet porte sa propre comptabilité (paie interne, échéancier fiscal) : elle a
        // besoin du plan NCT 01 comme n'importe quel dossier, alors qu'elle ne sortait jusqu'ici que
        // des migrations EF.
        var catalogsSeeded = await TrySeedRuntimeCatalogsAsync(tenantId, tenantConnectionString, cancellationToken);

        var encryptedConnectionString = _protector.Protect(tenantConnectionString);

        var tenantConnection = new TenantConnectionString
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            EncryptedConnectionString = encryptedConnectionString,
            CreatedAt = DateTime.UtcNow
        };

        _masterContext.TenantConnectionStrings.Add(tenantConnection);
        await _masterContext.SaveChangesAsync(cancellationToken);
        _cache.Remove($"{ConnectionStringCacheKeyPrefix}{tenantId}");
        MarkAppliedIfComplete(tenantId, catalogsSeeded);

        _logger.LogInformation("Created lightweight database {DatabaseName} for accounting firm tenant {TenantId}", databaseName, tenantId);

        return tenantConnectionString;
    }

    public Task TryDropDatabaseAsync(string databaseName, CancellationToken cancellationToken = default)
    {
        var masterConnectionString = GetMasterConnectionString();
        return _provisioner.TryDropDatabaseAsync(masterConnectionString, databaseName, cancellationToken);
    }

    public Task EnsureTenantTemplateAsync(CancellationToken cancellationToken = default)
    {
        var masterConnectionString = GetMasterConnectionString();
        return _provisioner.EnsureTenantTemplateAsync(masterConnectionString, cancellationToken);
    }

    /// <summary>
    /// Plan §2.4 — re-seeds the tenant DB's fiscal catalogs after a <see cref="TaxRegime"/> change.
    /// Purely additive: reuses the same idempotent initializers run at tenant creation, so existing
    /// rows a bookkeeper already customized (e.g. <c>IncomeTaxYearParameter.IsUserModified</c>) are
    /// never overwritten and no business data (invoices, journal entries) is touched. Appends a
    /// hash-chained audit row to the tenant DB (best-effort — an audit failure never fails the
    /// re-seed itself, mirroring <see cref="TenantSectorReconfigurationService"/>'s fault isolation).
    /// </summary>
    public async Task<FiscalReSeedResultDto> ReSeedFiscalParametersAsync(
        Guid tenantId,
        TaxRegime oldRegime,
        TaxRegime newRegime,
        string? companySegment,
        CancellationToken cancellationToken = default)
    {
        var connectionString = await GetConnectionStringAsync(tenantId, cancellationToken)
            ?? throw new InvalidOperationException($"Chaîne de connexion introuvable pour l'entreprise {tenantId}");

        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString, b => b.MigrationsAssembly(typeof(TenantDbContext).Assembly.FullName))
            .Options;

        var updatedItems = new List<string>();

        await using (var context = new TenantDbContext(options))
        {
            if (await WithholdingTaxCatalogInitializer.EnsureSystemTypesSeededAsync(context, cancellationToken))
                updatedItems.Add("Catalogue des types de retenue à la source (TEJ)");

            if (await WithholdingFiscalYearParameterInitializer.EnsureDefaultsSeededAsync(context, cancellationToken))
                updatedItems.Add("Paramètres de retenue à la source par exercice");

            if (await IncomeTaxYearParameterInitializer.EnsureDefaultsSeededAsync(context, cancellationToken))
                updatedItems.Add("Paramètres d'impôt sur les sociétés / IRPP par exercice");
        }

        _logger.LogInformation(
            "TenantService.ReSeedFiscalParameters: tenant {TenantId} {OldRegime}->{NewRegime} updated={UpdatedCount}",
            tenantId, oldRegime, newRegime, updatedItems.Count);

        await WriteFiscalReSeedAuditAsync(connectionString, tenantId, oldRegime, newRegime, updatedItems, cancellationToken);

        var warning = UsualTaxRegimeCatalog.IsAtypical(companySegment, newRegime)
            ? $"Le régime « {newRegime.ToDisplayString()} » est inhabituel pour le secteur d'activité de cette société. Vérifiez que ce choix est intentionnel."
            : null;

        return new FiscalReSeedResultDto
        {
            UpdatedItems = updatedItems,
            Warning = warning
        };
    }

    /// <summary>Best-effort hash-chained audit row for a fiscal re-seed (plan §2.4) — never throws.</summary>
    private async Task WriteFiscalReSeedAuditAsync(
        string connectionString,
        Guid tenantId,
        TaxRegime oldRegime,
        TaxRegime newRegime,
        IReadOnlyList<string> updatedItems,
        CancellationToken cancellationToken)
    {
        try
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseSqlServer(connectionString, b => b.MigrationsAssembly(typeof(TenantDbContext).Assembly.FullName))
                .Options;

            await using var context = new TenantDbContext(options);

            var previousHash = await context.AuditLogs
                .AsNoTracking()
                .OrderByDescending(a => a.CreatedAt)
                .ThenByDescending(a => a.Id)
                .Select(a => a.Hash)
                .FirstOrDefaultAsync(cancellationToken) ?? "GENESIS";

            var oldValues = System.Text.Json.JsonSerializer.Serialize(new { taxRegime = oldRegime.ToString() });
            var newValues = System.Text.Json.JsonSerializer.Serialize(new { taxRegime = newRegime.ToString(), updatedItems });

            var auditLog = AuditLog.Create(
                tenantId: tenantId,
                userId: null,
                userEmail: "system",
                action: "fiscal-reseed-tax-regime-change",
                entityType: "Tenant",
                entityId: tenantId,
                oldValues: oldValues,
                newValues: newValues,
                ipAddress: "system",
                userAgent: null,
                previousHash: previousHash);

            context.AuditLogs.Add(auditLog);
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Fiscal re-seed audit logging failed for tenant {TenantId}", tenantId);
        }
    }

    private string GetMasterConnectionString() =>
        _configuration.GetConnectionString("MasterConnection")
        ?? throw new InvalidOperationException("Chaîne de connexion maître introuvable");

    public async Task<bool> DatabaseExistsAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var connectionString = await GetConnectionStringAsync(tenantId, cancellationToken);
        
        if (string.IsNullOrEmpty(connectionString))
            return false;

        try
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task ApplyMigrationsAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var connectionString = await GetConnectionStringAsync(tenantId, cancellationToken);
        
        if (string.IsNullOrEmpty(connectionString))
            throw new InvalidOperationException($"Chaîne de connexion introuvable pour l'entreprise {tenantId}");

        await ApplyMigrationsToNewDatabaseAsync(connectionString, cancellationToken);
        _cache.Remove($"{TenantMigrationGuard.CacheKeyPrefix}{tenantId}");
    }

    /// <summary>
    /// Pose les catalogues que les migrations EF ne sèment pas — au premier rang le plan comptable
    /// NCT 01 (623 comptes) — sur la base tout juste provisionnée.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Indispensable quelle que soit la stratégie de provisionnement.</b> En
    /// <c>Strategy=Migrate</c> (valeur de production), la base ne contient que la seed « hybride
    /// PCG » d'environ 210 comptes ; en <c>TemplateClone</c>, elle peut hériter d'un <c>.bak</c>
    /// antérieur au catalogue. Sans cet appel, le dossier naît — et reste — sur le plan hérité.
    /// </para>
    /// <para>
    /// <b>Un échec ne fait jamais échouer la création du dossier</b> : le provisionnement tourne à
    /// l'intérieur de la transaction master de l'inscription, et lever ici détruirait la base tout
    /// juste créée pour un défaut rattrapable. L'échec est journalisé en <c>LogError</c> et le
    /// garde de migration reprend la main au premier appel du dossier.
    /// </para>
    /// </remarks>
    /// <returns><c>true</c> si le plan du dossier est bien en NCT 01 à la sortie.</returns>
    internal async Task<bool> TrySeedRuntimeCatalogsAsync(
        Guid tenantId, string connectionString, CancellationToken cancellationToken)
    {
        try
        {
            var report = await _runtimeCatalogSeeder.EnsureAsync(
                connectionString, authorizeChartRemap: false, cancellationToken);

            _logger.LogInformation(
                "Catalogues runtime posés pour {TenantId} : plan {Verdict} ({Outcome}), {Accounts} comptes.",
                tenantId,
                report.Verdict,
                report.ChartOutcome,
                report.AccountCount);

            return string.Equals(report.Verdict, "nct01", StringComparison.Ordinal);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Catalogues runtime non posés pour {TenantId} : le dossier reste sur le plan comptable "
                + "hérité jusqu'au rattrapage par TenantMigrationGuard au premier appel.",
                tenantId);
            return false;
        }
    }

    /// <summary>
    /// Ne court-circuite le garde de migration que si le dossier est réellement complet. Le marquer
    /// systématiquement — ce qu'on faisait — neutralisait pendant une heure le seul rattrapage
    /// capable de poser le plan comptable NCT 01.
    /// </summary>
    internal void MarkAppliedIfComplete(Guid tenantId, bool catalogsSeeded)
    {
        if (catalogsSeeded)
        {
            TenantMigrationGuard.MarkApplied(_cache, tenantId);
            return;
        }

        _cache.Remove($"{TenantMigrationGuard.CacheKeyPrefix}{tenantId}");
    }

    private void LogProvisionStep(string step, long durationMs, Guid tenantId, string databaseName)
    {
        _logger.LogInformation(
            "TenantProvision.Step={Step} DurationMs={DurationMs} TenantId={TenantId} DatabaseName={DatabaseName}",
            step,
            durationMs,
            tenantId,
            databaseName);
    }

    private async Task ApplyMigrationsToNewDatabaseAsync(string connectionString, CancellationToken cancellationToken)
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString, b => b.MigrationsAssembly(typeof(TenantDbContext).Assembly.FullName))
            .Options;

        await using var context = new TenantDbContext(options);
        await context.Database.MigrateAsync(cancellationToken);
    }

    private async Task SeedDefaultWarehouseAsync(string connectionString, string? warehouseName, CancellationToken cancellationToken)
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString)
            .Options;

        await using var context = new TenantDbContext(options);

        // Check if any warehouse already exists
        var existingDefault = await context.Warehouses.FirstOrDefaultAsync(w => w.IsDefault, cancellationToken);
        if (existingDefault != null)
        {
            // If user provided a specific name, ensure it is set
            if (!string.IsNullOrWhiteSpace(warehouseName))
            {
                var trimmedName = warehouseName.Trim();
                if (existingDefault.Name != trimmedName)
                {
                    _logger.LogInformation("Updating default warehouse name from '{OldName}' to '{NewName}'", existingDefault.Name, trimmedName);
                    existingDefault.Update(trimmedName, existingDefault.Address);
                    await context.SaveChangesAsync(cancellationToken);
                }
            }
            
            _logger.LogDebug("Default warehouse already exists");
            return;
        }

        // Create default warehouse with user-provided name or default
        var defaultName = string.IsNullOrWhiteSpace(warehouseName) 
            ? "Entrepôt Principal" 
            : warehouseName.Trim();

        var warehouseResult = Domain.Entities.Warehouse.Create(
            code: "PRINCIPAL",
            name: defaultName,
            address: null,
            isDefault: true);

        if (warehouseResult.IsFailure)
        {
            _logger.LogError("Failed to create default warehouse: {Error}", warehouseResult.Error.Description);
            return;
        }

        context.Warehouses.Add(warehouseResult.Value);
        await context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Created default warehouse '{WarehouseName}' for new tenant", defaultName);
    }

    private async Task SeedDefaultPassengerClientAsync(string connectionString, CancellationToken cancellationToken)
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString)
            .Options;

        await using var context = new TenantDbContext(options);

        var passengerEmail = DefaultPassengerClient.Email.Trim().ToLowerInvariant();
        var alreadyExists = await context.Clients
            .AnyAsync(c => EF.Property<string>(c.Email!, "Value") == passengerEmail, cancellationToken);
        if (alreadyExists)
        {
            _logger.LogDebug("Default passenger client already exists");
            return;
        }

        var addressResult = Address.Create("Non renseigné", "Tunis", "Tunis");
        if (addressResult.IsFailure)
        {
            _logger.LogError("Failed to create address for default passenger client: {Error}", addressResult.Error.Description);
            return;
        }

        var emailResult = Email.Create(DefaultPassengerClient.Email);
        if (emailResult.IsFailure)
        {
            _logger.LogError("Failed to create email for default passenger client: {Error}", emailResult.Error.Description);
            return;
        }

        var clientResult = Client.Create(
            DefaultPassengerClient.Name,
            ClientType.Individual,
            addressResult.Value,
            emailResult.Value,
            nif: null,
            phone: null,
            contactPerson: null,
            notes: null);

        if (clientResult.IsFailure)
        {
            _logger.LogError("Failed to create default passenger client: {Error}", clientResult.Error.Description);
            return;
        }

        var client = clientResult.Value;
        client.SetAuditInfo("system");
        context.Clients.Add(client);
        await context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Created default passenger client '{ClientName}' for new tenant", DefaultPassengerClient.Name);
    }

    /// <summary>
    /// Applique les modèles de données sectoriels correspondant à la classification du tenant
    /// (plan §WP-B6). Additif uniquement, jamais bloquant : un échec est journalisé (sans PII) et
    /// n'empêche pas la création du tenant — le modèle pourra être réappliqué plus tard (WP-B7).
    /// Aucun effet quand <see cref="_sectorTemplateApplier"/> est absent (DI non configurée, ex.
    /// tests instanciant <see cref="TenantService"/> directement) ou quand le tenant n'a pas encore
    /// de classification sectorielle (dossiers comptables : <see cref="CreateAccountingFirmDatabaseAsync"/>
    /// ne l'appelle pas du tout).
    /// </summary>
    private async Task ApplySectorDataTemplatesAsync(Guid tenantId, string connectionString, CancellationToken cancellationToken)
    {
        if (_sectorTemplateApplier is null)
            return;

        try
        {
            var tenant = await _masterContext.Tenants
                .AsNoTracking()
                .Where(t => t.Id == tenantId)
                .Select(t => new { t.CompanySegment, t.BusinessDomain })
                .FirstOrDefaultAsync(cancellationToken);

            if (tenant is null)
                return;

            await _sectorTemplateApplier.ApplyAsync(
                tenantId,
                connectionString,
                tenant.CompanySegment,
                tenant.BusinessDomain,
                dryRun: false,
                cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Sector template application failed for tenant {TenantId}", tenantId);
        }
    }

    private async Task SeedWithholdingTaxSystemTypesAsync(string connectionString, CancellationToken cancellationToken)
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString, b => b.MigrationsAssembly(typeof(TenantDbContext).Assembly.FullName))
            .Options;

        await using var context = new TenantDbContext(options);
        await WithholdingTaxCatalogInitializer.EnsureSystemTypesSeededAsync(context, cancellationToken);
        await WithholdingFiscalYearParameterInitializer.EnsureDefaultsSeededAsync(context, cancellationToken);
        await IncomeTaxYearParameterInitializer.EnsureDefaultsSeededAsync(context, cancellationToken);
    }
}

