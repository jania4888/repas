using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FactuTrust.API.Controllers;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.SectorConfiguration;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Sector-aware registration wizard — serialization contract (plan §3 C2, §6.1 B8). Plain unit
/// test, no host/DB: proves old <c>RegisterDto</c> JSON payloads (no sector fields) still bind with
/// nulls, and that unknown extra members in a payload are tolerated (forward compatibility).
/// </summary>
public sealed class RegisterDtoSectorSerializationTests
{
    /// <summary>Mirrors Program.cs's <c>AddJsonOptions</c> (camelCase property names).</summary>
    private static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    [Fact]
    public void Legacy_payload_without_sector_fields_binds_with_null_sector_properties()
    {
        const string legacyJson = """
        {
            "email": "old@example.com",
            "password": "SecurePass123!",
            "confirmPassword": "SecurePass123!",
            "firstName": "Old",
            "lastName": "Client",
            "companyName": "Société Legacy",
            "nif": "1234567/A/B/C/000",
            "taxRegime": 0,
            "street": "1 rue Test",
            "city": "Tunis",
            "governorate": "Tunis",
            "companyEmail": "contact@example.com",
            "phone": "71123456"
        }
        """;

        var dto = JsonSerializer.Deserialize<RegisterDto>(legacyJson, ApiJsonOptions);

        Assert.NotNull(dto);
        Assert.Null(dto!.CompanySegment);
        Assert.Null(dto.BusinessDomain);
        Assert.Null(dto.EnabledModules);
    }

    [Fact]
    public void Payload_with_unknown_extra_members_is_tolerated()
    {
        const string forwardCompatJson = """
        {
            "email": "new@example.com",
            "password": "SecurePass123!",
            "confirmPassword": "SecurePass123!",
            "firstName": "New",
            "lastName": "Client",
            "companyName": "Société Future",
            "nif": "1234567/A/B/C/000",
            "taxRegime": 0,
            "street": "1 rue Test",
            "city": "Tunis",
            "governorate": "Tunis",
            "companyEmail": "contact@example.com",
            "phone": "71123456",
            "companySegment": "commerce",
            "businessDomain": "autre",
            "enabledModules": [0, 1, 2],
            "someFutureFieldNotYetImplemented": { "nested": true }
        }
        """;

        var dto = JsonSerializer.Deserialize<RegisterDto>(forwardCompatJson, ApiJsonOptions);

        Assert.NotNull(dto);
        Assert.Equal("commerce", dto!.CompanySegment);
        Assert.Equal("autre", dto.BusinessDomain);
        Assert.Equal(new[] { 0, 1, 2 }, dto.EnabledModules);
    }
}

/// <summary>
/// Sector-aware registration wizard — public catalog endpoint (plan §6.1 B6, §8). Controller unit
/// test (direct instantiation, no host/DB) — avoids requiring SQL Server just to prove a purely
/// static, parameter-less response.
/// </summary>
public sealed class PublicSectorCatalogControllerTests
{
    private static PublicSectorCatalogController NewController(bool enabled = true)
    {
        return new PublicSectorCatalogController(
            Options.Create(new RegistrationSectorOptions { Enabled = enabled }),
            new FactuTrust.Infrastructure.Services.SectorCatalog.StaticSectorCatalogProvider());
    }

    [Fact]
    public void Get_returns_6_segments_and_10_domains_when_enabled()
    {
        var controller = NewController();

        var result = Assert.IsType<Microsoft.AspNetCore.Mvc.OkObjectResult>(controller.Get());
        // PublicSectorCatalogController lives in namespace FactuTrust.API.Controllers, where an
        // unqualified `ApiResponse<T>` resolves to the *local* record defined alongside
        // InventoryController (Success/Data/Message/Error) rather than
        // FactuTrust.Application.DTOs.ApiResponse<T> — same convention as PublicStorefrontController.
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<SectorCatalogDto>>(result.Value);

        Assert.NotNull(body.Data);
        Assert.Equal(6, body.Data!.Segments.Count);
        Assert.Equal(10, body.Data.Domains.Count);
        Assert.DoesNotContain(body.Data.Modules, m => m.Code == "Honoraires");
    }

    [Fact]
    public void Get_returns_404_when_flag_disabled()
    {
        var controller = NewController(enabled: false);

        Assert.IsType<Microsoft.AspNetCore.Mvc.NotFoundResult>(controller.Get());
    }

    [Fact]
    public void Get_includes_domainCodes_but_empty_moduleDependencies_with_static_provider()
    {
        var controller = NewController();

        var result = Assert.IsType<Microsoft.AspNetCore.Mvc.OkObjectResult>(controller.Get());
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<SectorCatalogDto>>(result.Value);

        Assert.NotNull(body.Data);
        // Phase 1 dynamic configuration (plan §3.1/§3.2): DomainCodes now mirrors each segment's
        // catalog matrix (SegmentDefinition.AllowedDomainCodes), not "10 for every segment".
        Assert.All(body.Data!.Segments, s =>
        {
            var expected = SectorConfigurationCatalog.Segments.Single(seg => seg.Code == s.Code).AllowedDomainCodes;
            Assert.Equal(expected.Count, s.DomainCodes.Count);
            Assert.Contains(BusinessDomains.Autre, s.DomainCodes);
        });
        // Review R1 (rollback contract): the static provider always reports EMPTY module
        // dependencies, even though the catalog itself declares 4 approved edges — Phase 2
        // dependency-closure pulling is a DB-gated feature. With UseDbRules=false (this
        // controller/provider's only mode), the rollback to Phase 1 behavior must be complete.
        Assert.Empty(body.Data.ModuleDependencies);
    }

    [Fact]
    public void Get_response_is_backward_compatible_superset()
    {
        // Phase 1 shape: no DomainCodes/ModuleDependencies members. Deserializing a Phase 2
        // response into this narrower record proves the extra members are purely additive.
        var controller = NewController();
        var result = Assert.IsType<Microsoft.AspNetCore.Mvc.OkObjectResult>(controller.Get());
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<SectorCatalogDto>>(result.Value);

        var json = JsonSerializer.Serialize(body.Data, ApiJsonOptions);
        var legacyShape = JsonSerializer.Deserialize<LegacySectorCatalogDto>(json, ApiJsonOptions);

        Assert.NotNull(legacyShape);
        Assert.Equal(6, legacyShape!.Segments.Count);
        Assert.Equal(10, legacyShape.Domains.Count);
    }

    private static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private sealed record LegacySectorCatalogDto
    {
        public required IReadOnlyList<LegacySectorSegmentDto> Segments { get; init; }
        public required IReadOnlyList<object> Domains { get; init; }
        public required IReadOnlyList<object> Modules { get; init; }
    }

    private sealed record LegacySectorSegmentDto
    {
        public required string Code { get; init; }
        public required string LabelFr { get; init; }
        public required string DescriptionFr { get; init; }
        public required string IconKey { get; init; }
        public required int SortOrder { get; init; }
        public required IReadOnlyList<int> CoreModuleIds { get; init; }
        public required IReadOnlyList<int> RecommendedModuleIds { get; init; }
        public string? DefaultWarehouseName { get; init; }
    }
}

/// <summary>
/// Sector-aware registration wizard — SQL-dependent integration facts (plan §6.1 B8). Requires a
/// real SQL Server reachable at host bootstrap (master DB + Hangfire storage), mirroring
/// <see cref="RegisterCompanyPerformanceTests"/>'s opt-in gate. Set
/// <c>RUN_SECTOR_REGISTRATION_SQL_TESTS=1</c> to execute; absent (the sandbox default), every fact
/// returns immediately without attempting to build the host — this is the "skip cleanly without
/// SQL" strategy for this new test file (deviation from the plan's assumption that SQL is always
/// reachable — see final report).
/// </summary>
[Collection("SqlServerIntegration")]
public sealed class RegisterSectorConfigurationSqlTests : IClassFixture<ChannelsDisabledWebApplicationFactory>
{
    private static bool ShouldRun => Environment.GetEnvironmentVariable("RUN_SECTOR_REGISTRATION_SQL_TESTS") == "1";

    private readonly ChannelsDisabledWebApplicationFactory _factory;

    public RegisterSectorConfigurationSqlTests(ChannelsDisabledWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static RegisterDto BuildDto(string unique, string? segment = null, string? domain = null, int[]? enabledModules = null, string? warehouseName = null, char nifCategory = 'A')
    {
        var nifDigits = (Convert.ToUInt64(unique, 16) % 10_000_000_000UL).ToString("D10");
        return new RegisterDto
        {
            Email = $"sector-{unique}@example.com",
            Password = "SecurePass123!",
            ConfirmPassword = "SecurePass123!",
            FirstName = "Sector",
            LastName = "Test",
            CompanyName = $"Société Sector {unique}",
            Nif = $"{nifDigits[..7]}/{nifCategory}/B/C/{nifDigits[7..]}",
            TaxRegime = TaxRegime.RealRegime,
            Street = "1 rue Test",
            City = "Tunis",
            PostalCode = "1000",
            Governorate = "Tunis",
            CompanyEmail = $"contact-sector-{unique}@example.com",
            Phone = "71123456",
            WarehouseName = warehouseName,
            CompanySegment = segment,
            BusinessDomain = domain,
            EnabledModules = enabledModules
        };
    }

    /// <summary>Reads the tenant's persisted sector classification straight from the master DB.</summary>
    private static async Task<(string? Segment, string? Domain)> GetTenantSectorClassificationAsync(
        WebApplicationFactory<Program> factory, Guid tenantId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
        var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId)
            ?? throw new InvalidOperationException($"Tenant {tenantId} not found in master DB");
        return (tenant.CompanySegment, tenant.BusinessDomain);
    }

    /// <summary>Counts persisted UserModuleGrant rows for a user, straight from the master DB.</summary>
    private static async Task<int> CountUserModuleGrantsAsync(WebApplicationFactory<Program> factory, Guid userId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
        return await db.UserModuleGrants.AsNoTracking().CountAsync(g => g.UserId == userId);
    }

    /// <summary>
    /// Reads the default warehouse's name straight from the tenant's ISOLATED database — mirrors
    /// <c>TenantUsersTestSupport.GetTenantAuditLogsAsync</c>'s pattern of resolving the connection
    /// string via <c>ITenantService</c> rather than any ambient tenant context.
    /// </summary>
    private static async Task<string?> GetTenantDefaultWarehouseNameAsync(
        WebApplicationFactory<Program> factory, Guid tenantId)
    {
        using var scope = factory.Services.CreateScope();
        var tenantService = scope.ServiceProvider.GetRequiredService<FactuTrust.Application.Common.Interfaces.ITenantService>();
        var connectionString = await tenantService.GetConnectionStringAsync(tenantId)
            ?? throw new InvalidOperationException($"No connection string resolvable for tenant {tenantId}");

        var options = new DbContextOptionsBuilder<TenantDbContext>().UseSqlServer(connectionString).Options;
        await using var context = new TenantDbContext(options);

        var warehouse = await context.Warehouses.AsNoTracking().FirstOrDefaultAsync(w => w.IsDefault);
        return warehouse?.Name;
    }

    [Fact]
    public async Task Register_primary_regression_gate_legacy_shaped_payload_gets_all_18_modules_and_no_grant_rows()
    {
        if (!ShouldRun) return;

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(unique);

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);
        Assert.Equal(18, body!.Data!.User.EnabledModuleIds.Count);

        // Legacy-shaped payload (no sector fields, no enabledModules) must leave zero footprint:
        // no grant rows, no persisted sector classification on the tenant.
        var grantCount = await CountUserModuleGrantsAsync(_factory, body.Data.User.Id);
        Assert.Equal(0, grantCount);

        var (segment, domain) = await GetTenantSectorClassificationAsync(_factory, body.Data.User.TenantId);
        Assert.Null(segment);
        Assert.Null(domain);
    }

    [Fact]
    public async Task Register_with_segment_domain_and_modules_persists_and_narrows_enabled_modules_on_login()
    {
        if (!ShouldRun) return;

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(
            unique,
            segment: CompanySegments.Commerce,
            domain: BusinessDomains.Autre,
            enabledModules: new[] { (int)AppModule.Stock });

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);

        // Narrowed set = core (6) + Stock = 7 modules.
        var expectedModuleIds = new[]
        {
            (int)AppModule.Administration, (int)AppModule.Clients, (int)AppModule.Products,
            (int)AppModule.Sales, (int)AppModule.Treasury, (int)AppModule.Reports, (int)AppModule.Stock
        };
        Assert.Equal(expectedModuleIds.OrderBy(x => x), body!.Data!.User.EnabledModuleIds.OrderBy(x => x));

        // The tenant row must persist the RESOLVED codes.
        var (segment, domain) = await GetTenantSectorClassificationAsync(_factory, body.Data.User.TenantId);
        Assert.Equal(CompanySegments.Commerce, segment);
        Assert.Equal(BusinessDomains.Autre, domain);

        // A subsequent login must return the exact same narrowed + forced-core module set — proves
        // the grant rows (not just the register response) are what drives EnabledModuleIds.
        var loginResponse = await client.PostAsJsonAsync(
            "/api/auth/login",
            new LoginDto { Email = dto.Email, Password = dto.Password },
            TenantUsersTestSupport.ApiJsonOptions);
        var loginBody = await loginResponse.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
        Assert.NotNull(loginBody?.Data);
        Assert.Equal(expectedModuleIds.OrderBy(x => x), loginBody!.Data!.User.EnabledModuleIds.OrderBy(x => x));
    }

    [Fact]
    public async Task Login_after_sector_registration_returns_companySegment_and_businessDomain_in_userDto()
    {
        if (!ShouldRun) return;

        // Phase 2 (§WP-B8): the register response AND a subsequent login must surface the tenant's
        // persisted sector classification on the UserDto (propagated from the tenant row).
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(
            unique,
            segment: CompanySegments.Commerce,
            domain: BusinessDomains.Autre,
            enabledModules: new[] { (int)AppModule.Stock });

        var registerResponse = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);
        Assert.Equal(HttpStatusCode.Created, registerResponse.StatusCode);
        Assert.NotNull(registerBody?.Data);
        Assert.Equal(CompanySegments.Commerce, registerBody!.Data!.User.CompanySegment);
        Assert.Equal(BusinessDomains.Autre, registerBody.Data.User.BusinessDomain);

        var loginResponse = await client.PostAsJsonAsync(
            "/api/auth/login",
            new LoginDto { Email = dto.Email, Password = dto.Password },
            TenantUsersTestSupport.ApiJsonOptions);
        var loginBody = await loginResponse.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
        Assert.NotNull(loginBody?.Data);
        Assert.Equal(CompanySegments.Commerce, loginBody!.Data!.User.CompanySegment);
        Assert.Equal(BusinessDomains.Autre, loginBody.Data.User.BusinessDomain);
    }

    [Fact]
    public async Task Register_with_flag_disabled_ignores_sector_fields_and_persists_null_classification()
    {
        if (!ShouldRun) return;

        // Review §item 1a/1b: with the kill-switch off, AuthController must persist NULL sector
        // classification (never the raw dto values) and ApplyModuleSelectionAsync must write zero
        // grant rows — even though this payload supplies a valid segment/domain/enabledModules,
        // exactly as a stale/misbehaving client might after the flag is toggled off mid-rollout.
        using var disabledFactory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Features:RegistrationSector:Enabled"] = "false"
                });
            });
        });

        var client = ChannelsDisabledWebApplicationFactory.WithClientTimeout(
            disabledFactory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }));
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(
            unique,
            segment: CompanySegments.Commerce,
            domain: BusinessDomains.Autre,
            enabledModules: new[] { (int)AppModule.Stock });

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);

        // Flag off ⇒ exact legacy behavior: all 18 modules, no grant rows, no persisted sector data.
        Assert.Equal(18, body!.Data!.User.EnabledModuleIds.Count);

        var grantCount = await CountUserModuleGrantsAsync(disabledFactory, body.Data.User.Id);
        Assert.Equal(0, grantCount);

        var (segment, domain) = await GetTenantSectorClassificationAsync(disabledFactory, body.Data.User.TenantId);
        Assert.Null(segment);
        Assert.Null(domain);
    }

    [Fact]
    public async Task Register_unknown_segment_returns_400_French()
    {
        if (!ShouldRun) return;

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(unique, segment: "not-a-real-segment");

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // AuthController.Register lives in FactuTrust.API.Controllers, where an unqualified
        // ApiResponse<T> resolves to the LOCAL Controllers-namespace record (Error, singular) —
        // not FactuTrust.Application.DTOs.ApiResponse<T> (Errors, list). Deserialize as the real
        // wire type so the message assertion actually reads the field the server wrote.
        var body = await response.Content.ReadFromJsonAsync<FactuTrust.API.Controllers.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);
        Assert.NotNull(body);
        Assert.False(body!.Success);
        Assert.Equal("Type de société invalide.", body.Error);
    }

    /// <summary>
    /// Register_retourne_400_pour_un_couple_segment_domaine_incoherent (plan §3.5): the segment↔domain
    /// matrix link is enforced at registration for an incoherent couple (btp-construction never
    /// lists alimentation-agroalimentaire) — proved end-to-end, not just at the service layer.
    /// </summary>
    [Fact]
    public async Task Register_retourne_400_pour_un_couple_segment_domaine_incoherent()
    {
        if (!ShouldRun) return;

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(
            unique,
            segment: CompanySegments.BtpConstruction,
            domain: BusinessDomains.AlimentationAgroalimentaire);

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<FactuTrust.API.Controllers.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);
        Assert.NotNull(body);
        Assert.False(body!.Success);
        Assert.Equal("Domaine d'activité non disponible pour ce type de société.", body.Error);
    }

    [Fact]
    public async Task Register_unknown_module_ids_are_rejected_with_400()
    {
        if (!ShouldRun) return;

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(unique, enabledModules: new[] { 9999, -1 });

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);

        // Plan §1.2 "fin des rejets silencieux": unknown AppModule ids are no longer silently
        // dropped — the endpoint rejects them with a 400 and a French message listing the ids.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var content = await response.Content.ReadAsStringAsync();
        Assert.Contains("Modules invalides", content);
    }

    [Fact]
    public async Task Register_commerce_segment_without_warehouse_name_defaults_to_Magasin_principal()
    {
        if (!ShouldRun) return;

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(unique, segment: CompanySegments.Commerce, warehouseName: null);

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);

        var warehouseName = await GetTenantDefaultWarehouseNameAsync(_factory, body!.Data!.User.TenantId);
        Assert.Equal("Magasin principal", warehouseName);
    }

    /// <summary>
    /// Régression : un NIF réel dont la lettre de catégorie sort de la table A–G (ici « P »)
    /// déclenchait « votre NIF indique la catégorie P (Inconnu) et non une association » alors
    /// que rien ne permettait de conclure. Une lettre non interprétable ⇒ aucun avertissement.
    /// </summary>
    [Fact]
    public async Task Register_association_segment_with_unknown_nif_category_emits_no_warning()
    {
        if (!ShouldRun) return;

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(unique, segment: CompanySegments.Association, domain: BusinessDomains.Autre, nifCategory: 'P');

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);
        Assert.DoesNotContain(body!.Data!.WarningDetails, w => w.Code == RegistrationWarningCodes.NifSegmentMismatch);
        Assert.DoesNotContain(body.Data.Warnings, w => w.Contains("Inconnu", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Une catégorie CONNUE et non associative reste signalée — et l'avertissement est typé,
    /// avec `Warnings` (contrat historique) strictement dérivé de `WarningDetails`.
    /// </summary>
    [Fact]
    public async Task Register_association_segment_with_known_non_association_category_emits_typed_warning()
    {
        if (!ShouldRun) return;

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(unique, segment: CompanySegments.Association, domain: BusinessDomains.Autre, nifCategory: 'C');

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);

        var nifWarning = Assert.Single(body!.Data!.WarningDetails, w => w.Code == RegistrationWarningCodes.NifSegmentMismatch);
        Assert.Equal(RegistrationWarningSeverities.Warning, nifWarning.Severity);
        Assert.Contains(nifWarning.Message, body.Data.Warnings);
        Assert.Equal(body.Data.WarningDetails.Select(w => w.Message), body.Data.Warnings);
    }

    [Fact]
    public async Task RegisterFirm_is_unaffected_and_persists_null_sector_classification()
    {
        if (!ShouldRun) return;

        // RegisterFirm has zero changes in Phase 1 (plan §3 C7, §6.1 B5) — this is a pure
        // regression guard, not a new capability test.
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var unique = Guid.NewGuid().ToString("N")[..12];
        var nifDigits = (Convert.ToUInt64(unique, 16) % 10_000_000_000UL).ToString("D10");
        var dto = new RegisterAccountingFirmDto
        {
            Email = $"firm-sector-{unique}@example.com",
            Password = "SecurePass123!",
            ConfirmPassword = "SecurePass123!",
            FirstName = "Firm",
            LastName = "Admin",
            FirmName = $"Cabinet Sector {unique}",
            Nif = $"{nifDigits[..7]}/A/B/C/{nifDigits[7..]}",
            Street = "1 rue Test",
            City = "Tunis",
            PostalCode = "1000",
            Governorate = "Tunis",
            FirmEmail = $"contact-firm-sector-{unique}@example.com",
            Phone = "71123456"
        };

        var response = await client.PostAsJsonAsync("/api/auth/register-firm", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<FactuTrust.Application.DTOs.ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);

        // Firm tenants are firm-native (Honoraires) and never get a sector classification — the
        // propagated UserDto fields must be null (§WP-B8 regression guard).
        Assert.Null(body!.Data!.User.CompanySegment);
        Assert.Null(body.Data.User.BusinessDomain);

        var (segment, domain) = await GetTenantSectorClassificationAsync(_factory, body!.Data!.User.TenantId);
        Assert.Null(segment);
        Assert.Null(domain);
    }
}
