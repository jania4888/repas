using System.Security.Claims;
using FactuTrust.API.Authorization;
using FactuTrust.Domain.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FactuTrust.API.Tests;

public sealed class FirmNativeContextAuthorizationHandlerTests
{
    private static ClaimsPrincipal BuildUser(
        string tenantKind,
        string? accessMode,
        string? contextTenantId = null)
    {
        var id = new ClaimsIdentity("Bearer");
        id.AddClaim(new Claim(AuthClaimTypes.TenantKind, tenantKind));
        if (!string.IsNullOrEmpty(accessMode))
            id.AddClaim(new Claim(AuthClaimTypes.AccessMode, accessMode));
        if (!string.IsNullOrEmpty(contextTenantId))
            id.AddClaim(new Claim(AuthClaimTypes.ContextTenantId, contextTenantId));
        return new ClaimsPrincipal(id);
    }

    private static async Task<bool> EvaluateAsync(ClaimsPrincipal user)
    {
        var handler = new FirmNativeContextAuthorizationHandler();
        var ctx = new AuthorizationHandlerContext(
            new IAuthorizationRequirement[] { new FirmNativeContextRequirement() },
            user,
            resource: null);

        await handler.HandleAsync(ctx);
        return ctx.HasSucceeded;
    }

    [Fact]
    public async Task Succeeds_for_native_accounting_firm()
    {
        Assert.True(await EvaluateAsync(BuildUser("accountingFirm", "native")));
    }

    [Fact]
    public async Task Succeeds_for_accounting_firm_without_access_mode_claim()
    {
        Assert.True(await EvaluateAsync(BuildUser("accountingFirm", accessMode: null)));
    }

    [Fact]
    public async Task Fails_for_delegated_accounting_firm()
    {
        Assert.False(await EvaluateAsync(
            BuildUser("accountingFirm", "delegated", Guid.NewGuid().ToString())));
    }

    /// <summary>
    /// Cas subtil : un jeton délégué AMPUTÉ de son `context_tenant_id` ne doit pas être pris pour une
    /// session native — c'est pourquoi la politique native n'est pas la négation de la politique déléguée.
    /// </summary>
    [Fact]
    public async Task Fails_for_delegated_accounting_firm_without_context_tenant()
    {
        Assert.False(await EvaluateAsync(BuildUser("accountingFirm", "delegated")));
    }

    [Fact]
    public async Task Fails_for_company_user()
    {
        Assert.False(await EvaluateAsync(BuildUser("company", "native")));
    }

    [Fact]
    public async Task Fails_for_anonymous_user()
    {
        Assert.False(await EvaluateAsync(new ClaimsPrincipal(new ClaimsIdentity())));
    }

    /// <summary>
    /// Deuxième maillon : la POLITIQUE telle qu'elle est câblée dans Program.cs, résolue par le vrai
    /// <see cref="IAuthorizationService"/>. `FirmDashboardController` porte
    /// `[Authorize(Policy = PermissionPolicies.FirmNativeContext)]` : refuser cette politique ici
    /// équivaut au 403 sur `GET /api/firm/dashboard`.
    ///
    /// Un test HTTP de bout en bout (WebApplicationFactory) serait rouge sur ce poste faute de SQL
    /// Server — même raison que <see cref="FeatureLevelAuthorizationTests"/>.
    /// </summary>
    private static IAuthorizationService BuildRealAuthorizationService()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorizationCore(options =>
        {
            options.AddPolicy(PermissionPolicies.FirmNativeContext, policy =>
                policy.RequireAuthenticatedUser()
                    .AddRequirements(new FirmNativeContextRequirement()));
        });
        services.AddSingleton<IAuthorizationHandler, FirmNativeContextAuthorizationHandler>();
        return services.BuildServiceProvider().GetRequiredService<IAuthorizationService>();
    }

    [Fact]
    public async Task Firm_dashboard_policy_denies_a_delegated_session_and_allows_a_native_one()
    {
        var auth = BuildRealAuthorizationService();

        var delegated = await auth.AuthorizeAsync(
            BuildUser("accountingFirm", "delegated", Guid.NewGuid().ToString()),
            resource: null,
            PermissionPolicies.FirmNativeContext);
        Assert.False(delegated.Succeeded);

        var native = await auth.AuthorizeAsync(
            BuildUser("accountingFirm", "native"),
            resource: null,
            PermissionPolicies.FirmNativeContext);
        Assert.True(native.Succeeded);
    }
}
