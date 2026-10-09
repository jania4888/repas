using System.Reflection;
using System.Security.Claims;
using FactuTrust.API.Middleware;
using FactuTrust.Domain.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Verrou anti-régression : tout contrôleur de l'ESPACE CABINET doit être refusé quand la session est
/// positionnée sur un dossier client. Un nouveau contrôleur `api/firm/...` oublié dans
/// `DelegatedAccessMiddleware.NativeOnlyPrefixes` fait échouer ce test au lieu de rouvrir
/// silencieusement les données du cabinet depuis un dossier.
///
/// Le test n'inspecte pas la liste de préfixes (privée) : il rejoue le middleware sur la route réelle
/// de chaque contrôleur, donc il valide le comportement, pas le câblage.
/// </summary>
public sealed class FirmAreaRouteCoverageTests
{
    /// <summary>Seule sortie du mode délégué : doit rester accessible, sinon on ne peut plus quitter un dossier.</summary>
    private static readonly string[] DelegatedAllowedRoutes = ["api/firm/context"];

    private static IEnumerable<string> FirmAreaRoutes()
    {
        var assembly = typeof(FactuTrust.API.Middleware.DelegatedAccessMiddleware).Assembly;

        return assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t) && !t.IsAbstract)
            .Select(t => t.GetCustomAttribute<RouteAttribute>()?.Template)
            .Where(template => !string.IsNullOrEmpty(template))
            .Select(template => template!.Trim('/'))
            .Where(template => template.StartsWith("api/firm", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(t => t, StringComparer.OrdinalIgnoreCase);
    }

    private static async Task<(int StatusCode, bool NextCalled)> InvokeDelegatedAsync(string path)
    {
        var nextCalled = false;
        RequestDelegate next = ctx =>
        {
            nextCalled = true;
            ctx.Response.StatusCode = StatusCodes.Status200OK;
            return Task.CompletedTask;
        };

        var identity = new ClaimsIdentity("Bearer");
        identity.AddClaim(new Claim(AuthClaimTypes.AccessMode, "delegated"));
        identity.AddClaim(new Claim(AuthClaimTypes.TenantKind, "accountingFirm"));
        identity.AddClaim(new Claim(AuthClaimTypes.ContextTenantId, Guid.NewGuid().ToString()));

        var context = new DefaultHttpContext
        {
            Request = { Method = HttpMethods.Get, Path = "/" + path },
            User = new ClaimsPrincipal(identity)
        };

        await new DelegatedAccessMiddleware(next).InvokeAsync(context);
        return (context.Response.StatusCode, nextCalled);
    }

    [Fact]
    public void Firm_area_controllers_are_discoverable()
    {
        // Garde-fou du test lui-même : si la réflexion ne trouve plus rien, il ne prouverait plus rien.
        Assert.NotEmpty(FirmAreaRoutes());
    }

    [Fact]
    public async Task Every_firm_area_route_is_refused_while_a_dossier_is_open()
    {
        var leaks = new List<string>();

        foreach (var route in FirmAreaRoutes())
        {
            if (DelegatedAllowedRoutes.Contains(route, StringComparer.OrdinalIgnoreCase))
                continue;

            var (statusCode, nextCalled) = await InvokeDelegatedAsync(route);
            if (nextCalled || statusCode != StatusCodes.Status403Forbidden)
                leaks.Add(route);
        }

        Assert.True(
            leaks.Count == 0,
            "Routes de l'espace cabinet encore servies sous un jeton délégué : " + string.Join(", ", leaks));
    }

    [Fact]
    public async Task Leaving_the_dossier_stays_possible()
    {
        var (statusCode, nextCalled) = await InvokeDelegatedAsync("api/firm/context");

        Assert.True(nextCalled);
        Assert.Equal(StatusCodes.Status200OK, statusCode);
    }
}
