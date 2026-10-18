using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Shared plumbing for the <c>TenantUsersController</c> / security-stamp revocation integration tests
/// (plan §6 Phase 2, §7.1.D-H). Requires a real SQL Server (see
/// <c>ConnectionStrings__MasterConnection</c> / <c>ConnectionStrings__DefaultTenantConnection</c> env
/// vars) — company registration provisions a real tenant database.
/// </summary>
public static class TenantUsersTestSupport
{
    /// <summary>
    /// Mirrors the API's global JSON options (<c>Program.cs</c> <c>AddJsonOptions</c>): camelCase
    /// property names, but enum VALUES are serialised verbatim in their C# (PascalCase) name — the
    /// API deliberately does NOT lower-case enum values (see the comment above
    /// <c>JsonStringEnumConverter</c> registration in <c>Program.cs</c>: forcing camelCase there
    /// breaks status-conditional UI comparisons). Using the default <c>ReadFromJsonAsync&lt;T&gt;()</c>
    /// options (no camelCase property policy, no string-enum converter) throws
    /// <c>JsonException</c> on <c>UserDto.Role</c> — this mirrors the real wire format instead.
    /// </summary>
    public static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    /// <summary>
    /// Registers a brand-new company (real tenant DB provisioning via <c>POST /api/auth/register</c>)
    /// and returns the resulting admin's access token/ids. This is the ONLY way to obtain an
    /// Administrator session that can successfully pass <c>TenantMiddleware</c> (resolvable tenant
    /// connection string) — a forged JWT for a nonexistent tenant would 500 there.
    /// Transient failures (client timeout, HTTP error, 5xx) are retried up to 3 times with a
    /// fresh company per attempt; a 4xx validation failure throws immediately.
    /// </summary>
    public static async Task<RegisteredCompany> RegisterCompanyAsync(HttpClient client)
    {
        // Le provisionnement LocalDB derrière l'inscription est l'opération la plus lourde de
        // la suite : sous CI Windows il échoue parfois de façon transitoire (expiration du
        // client, 500 sur contention SQL). Trois tentatives bornées, avec une société unique
        // à chaque essai ; seules les défaillances transitoires sont rejouées — un 400 de
        // validation (régression réelle) échoue immédiatement.
        const int maxAttempts = 3;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await RegisterCompanyOnceAsync(client);
            }
            catch (Exception ex) when (attempt < maxAttempts && IsTransientRegistrationFailure(ex))
            {
                await Task.Delay(TimeSpan.FromSeconds(5));
            }
        }
    }

    private static bool IsTransientRegistrationFailure(Exception ex) =>
        ex is TaskCanceledException or HttpRequestException or TransientRegistrationException;

    /// <summary>Inscription rejetée par une erreur 5xx transitoire (contention LocalDB CI).</summary>
    private sealed class TransientRegistrationException(string message) : Exception(message);

    private static async Task<RegisteredCompany> RegisterCompanyOnceAsync(HttpClient client)
    {
        var unique = Guid.NewGuid().ToString("N")[..12];
        var nifDigits = (Convert.ToUInt64(unique, 16) % 10_000_000_000UL).ToString("D10");
        var dto = new RegisterDto
        {
            Email = $"admin-{unique}@example.com",
            Password = "SecurePass123!",
            ConfirmPassword = "SecurePass123!",
            FirstName = "Admin",
            LastName = "Test",
            CompanyName = $"Société Test {unique}",
            Nif = $"{nifDigits[..7]}/A/B/C/{nifDigits[7..]}",
            TaxRegime = TaxRegime.RealRegime,
            Street = "1 rue Test",
            City = "Tunis",
            PostalCode = "1000",
            Governorate = "Tunis",
            CompanyEmail = $"contact-{unique}@example.com",
            Phone = "71123456"
        };

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<ApiResponse<AuthResponseDto>>(ApiJsonOptions);
        if (!response.IsSuccessStatusCode || body?.Data is null)
        {
            var message =
                $"Company registration failed (status={response.StatusCode}): " +
                $"{string.Join(";", body?.Errors ?? Array.Empty<string>())}";
            if ((int)response.StatusCode >= 500)
            {
                throw new TransientRegistrationException(message);
            }

            throw new InvalidOperationException(message);
        }

        return new RegisteredCompany(
            body.Data.AccessToken,
            body.Data.User.TenantId,
            body.Data.User.Id,
            dto.Email);
    }

    public static HttpClient WithBearer(this HttpClient client, string accessToken)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return client;
    }

    /// <summary>Standard password used everywhere in this test support for newly created users.</summary>
    public const string DefaultPassword = "SecurePass123!";

    /// <summary>Logs in via <c>POST /api/auth/login</c> and returns the fresh access token.</summary>
    public static async Task<string> LoginAsync(HttpClient client, string email, string password = DefaultPassword)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/login", new LoginDto { Email = email, Password = password }, ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<ApiResponse<AuthResponseDto>>(ApiJsonOptions);
        if (!response.IsSuccessStatusCode || body?.Data is null)
        {
            throw new InvalidOperationException(
                $"Login failed for {email} (status={response.StatusCode}): " +
                $"{string.Join(";", body?.Errors ?? Array.Empty<string>())}");
        }

        return body.Data.AccessToken;
    }

    /// <summary>
    /// Creates a second Administrator on the caller's tenant via <c>POST /api/tenant-users</c> (used
    /// by <c>_adminClient</c>-style callers, plan §7.1.G — needs a SECOND active admin to test
    /// concurrent last-admin demotion). Returns the plaintext email so the caller can log in as this
    /// user separately (<see cref="LoginAsync"/>).
    /// </summary>
    public static async Task<string> CreateAdditionalAdminAsync(HttpClient adminClient)
    {
        var unique = Guid.NewGuid().ToString("N")[..12];
        var email = $"admin2-{unique}@example.com";
        var request = new CreateTenantUserRequest
        {
            Email = email,
            FirstName = "Second",
            LastName = "Admin",
            Password = DefaultPassword,
            Role = UserRole.Administrator
        };

        var response = await adminClient.PostAsJsonAsync("/api/tenant-users", request, ApiJsonOptions);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            throw new InvalidOperationException($"Second admin creation failed (status={response.StatusCode}): {body}");
        }

        return email;
    }

    /// <summary>Fetches the tenant's user list (<c>GET /api/tenant-users</c>) for the caller's tenant.</summary>
    public static async Task<IReadOnlyList<TenantUserListItemDto>> GetUsersAsync(HttpClient adminClient)
    {
        var response = await adminClient.GetAsync("/api/tenant-users");
        if (!response.IsSuccessStatusCode)
        {
            // A 401 (e.g. this exact token's security stamp was just revoked by a concurrent
            // mutation) or 403 carries no JSON body worth parsing — fail on the status alone rather
            // than letting ReadFromJsonAsync throw an unrelated JsonException on an empty body.
            throw new InvalidOperationException($"Listing tenant users failed (status={response.StatusCode})");
        }

        var body = await response.Content.ReadFromJsonAsync<ApiResponse<IReadOnlyList<TenantUserListItemDto>>>(ApiJsonOptions);
        if (body?.Data is null)
            throw new InvalidOperationException("Listing tenant users returned an empty payload");
        return body.Data;
    }

    /// <summary>
    /// Creates a persisted, active user directly via <see cref="UserManager{TUser}"/> (no full
    /// registration flow — this is only used for authorization-boundary tests that never reach
    /// <c>TenantMiddleware</c>, e.g. non-admin 403 checks) and forges a signed JWT with a real
    /// SecurityStamp so it survives <c>OnTokenValidated</c>. Mirrors
    /// <c>PlatformApiIntegrationTests.CreateTenantAdministratorAsync</c>.
    /// </summary>
    public static async Task<string> CreatePersistedUserJwtAsync(
        WebApplicationFactory<Program> factory, UserRole role, Guid? tenantId = null, bool isActive = true)
    {
        using var scope = factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();

        var unique = Guid.NewGuid().ToString("N")[..12];
        var effectiveTenantId = tenantId ?? Guid.NewGuid();
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = $"tenant-user-{unique}@example.com",
            Email = $"tenant-user-{unique}@example.com",
            EmailConfirmed = true,
            FirstName = "Test",
            LastName = role.ToString(),
            TenantId = effectiveTenantId,
            IsActive = isActive
        };

        var createResult = await userManager.CreateAsync(user, "SecurePass123!");
        Assert.True(createResult.Succeeded, string.Join(";", createResult.Errors.Select(e => e.Description)));

        var roleResult = await userManager.AddToRoleAsync(user, role.ToString());
        Assert.True(roleResult.Succeeded, string.Join(";", roleResult.Errors.Select(e => e.Description)));

        var stamp = await userManager.GetSecurityStampAsync(user);

        return CreateSignedJwt(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Role, role.ToString()),
            new Claim("tenant_id", effectiveTenantId.ToString()),
            new Claim(AuthClaimTypes.SecurityStamp, stamp)
        });
    }

    public static string CreateSignedJwt(IEnumerable<Claim> claims)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(
            ChannelsDisabledWebApplicationFactory.TestJwtSecretKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: "FactuTrust",
            audience: "FactuTrust-API",
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Reads back every <c>AuditLogs</c> row from the tenant's ISOLATED database (plan §7.1.H), in
    /// insertion order. Mirrors how production code resolves a tenant's connection string
    /// (<c>ITenantService.GetConnectionStringAsync</c> — the same call <c>TenantMiddleware</c> makes)
    /// rather than depending on any ambient <c>ITenantContext</c>, since this runs OUTSIDE an HTTP
    /// request. Read-only, brand-new <see cref="TenantDbContext"/> instance, never shared with the
    /// app's own DI-scoped contexts.
    /// </summary>
    public static async Task<IReadOnlyList<AuditLog>> GetTenantAuditLogsAsync(
        WebApplicationFactory<Program> factory, Guid tenantId)
    {
        using var scope = factory.Services.CreateScope();
        var tenantService = scope.ServiceProvider.GetRequiredService<FactuTrust.Application.Common.Interfaces.ITenantService>();
        var connectionString = await tenantService.GetConnectionStringAsync(tenantId)
            ?? throw new InvalidOperationException($"No connection string resolvable for tenant {tenantId}");

        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        await using var context = new TenantDbContext(options);

        return await context.AuditLogs.AsNoTracking()
            .OrderBy(a => a.CreatedAt)
            .ThenBy(a => a.Id)
            .ToListAsync();
    }

    public sealed record RegisteredCompany(string AccessToken, Guid TenantId, Guid AdminUserId, string AdminEmail);
}
