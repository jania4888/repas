using System.Security.Claims;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;

namespace FactuTrust.API.Middleware;

/// <summary>
/// Blocks mutating requests in delegated firm context except accounting, fiscal, payroll and AI endpoints.
/// AI business restrictions (Accounting scope only, invoice import) are enforced in
/// controllers/handlers — not in this middleware. PowerPoint export is allowed for the
/// Comptabilité assistant already in delegated scope.
/// </summary>
public sealed class DelegatedAccessMiddleware
{
    private static readonly HashSet<string> AllowedWritePrefixes = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/accounting",
        "/api/bank-reconciliation",
        "/api/withholding-tax",
        // Payroll (RH & Paie) is a delegated-firm responsibility: the accounting firm must be able
        // to manage employees, run payroll and file social declarations on behalf of client dossiers.
        "/api/payroll",
        // Accounting-firm AI assistant (chat, warm-up, document extract, conversation management,
        // PowerPoint export). Invoice import remains guarded at controller level.
        "/api/ai"
    };

    /// <summary>
    /// Session / UX home-tenant writes allowed in delegated mode:
    /// exit/switch dossier, token refresh, and in-app notifications
    /// (Master DB UserNotifications keyed by home tenant_id — not client ERP data).
    /// </summary>
    private static readonly HashSet<string> AllowedDelegatedSessionPrefixes = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/firm/context",
        "/api/auth/refresh",
        "/api/auth/logout",
        "/api/notifications",
        "/api/me/onboarding"
    };

    /// <summary>
    /// Exception de LECTURE à la fermeture de l'espace cabinet : la liste des dossiers du portefeuille
    /// est consommée par des écrans DU DOSSIER (duplication d'une configuration de déclaration depuis
    /// un autre dossier, sélecteur de société des échanges). La fermer casserait ces fonctions sans
    /// rapport avec le symptôme corrigé ; la portée du collaborateur est déjà appliquée côté service.
    /// Les invitations (`firm/incoming`) et toutes les écritures restent fermées.
    /// </summary>
    private static readonly HashSet<string> DelegatedReadableFirmPrefixes = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/firm-assignments/firm/clients"
    };

    /// <summary>
    /// Espace CABINET : interdit tant que la session est positionnée sur un dossier client, lectures
    /// comprises. Sans cela, <c>GET /api/firm/dashboard</c> répondait 200 avec les données du cabinet
    /// (tous les dossiers, échéances, heures facturables) sous un jeton délégué — le court-circuit des
    /// GET plus bas laissait passer toute la zone.
    ///
    /// <c>/api/firm/context</c> en est volontairement absent : quitter ou changer de dossier doit
    /// rester possible, c'est la seule sortie du mode délégué.
    /// Attention : <c>/api/firm/payroll</c> (paie interne du cabinet) n'est pas <c>/api/payroll</c>
    /// (paie du dossier client, elle autorisée) ; <c>/api/firm-assignments</c> et
    /// <c>/api/accounting-firms</c> ne sont pas sous <c>/api/firm/</c>.
    /// </summary>
    private static readonly HashSet<string> NativeOnlyPrefixes = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/firm/dashboard",
        "/api/firm/governance",
        "/api/firm/fiscal-schedule",
        "/api/firm/payroll",
        "/api/firm/users",
        "/api/firm/managed-clients",
        "/api/firm/revision",
        "/api/firm/ai",
        "/api/firm-assignments",
        "/api/accounting-firms"
    };

    private static readonly HashSet<string> BlockedPrefixes = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/tenant-users",
        "/api/firm/users",
        "/api/studio",
        "/api/storefront",
        "/api/pos"
    };

    private readonly RequestDelegate _next;

    public DelegatedAccessMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            await _next(context);
            return;
        }

        var accessMode = context.User.FindFirstValue(AuthClaimTypes.AccessMode);
        if (!string.Equals(accessMode, "delegated", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var method = context.Request.Method;
        var path = context.Request.Path.Value ?? "";

        // Testé AVANT la zone cabinet : sortir du dossier, changer de dossier et rafraîchir la
        // session doivent rester possibles, quelle que soit la méthode.
        if (AllowedDelegatedSessionPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
        {
            await _next(context);
            return;
        }

        // Lectures de l'espace cabinet explicitement nécessaires à des écrans du dossier.
        if ((HttpMethods.IsGet(method) || HttpMethods.IsHead(method))
            && DelegatedReadableFirmPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
        {
            await _next(context);
            return;
        }

        // Zone cabinet : refusée aussi en lecture, contrairement au reste de ce middleware.
        if (NativeOnlyPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
        {
            await WriteForbiddenAsync(
                context,
                "Espace cabinet indisponible en mode dossier client. Quittez le dossier pour y revenir.");
            return;
        }

        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
        {
            await _next(context);
            return;
        }

        foreach (var blocked in BlockedPrefixes)
        {
            if (path.StartsWith(blocked, StringComparison.OrdinalIgnoreCase))
            {
                await WriteForbiddenAsync(context, "Action interdite en mode dossier client délégué.");
                return;
            }
        }

        var allowed = AllowedWritePrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase));
        if (!allowed)
        {
            await WriteForbiddenAsync(context, "Modification interdite en mode dossier client (lecture seule hors comptabilité/fiscal).");
            return;
        }

        await _next(context);
    }

    private static async Task WriteForbiddenAsync(HttpContext context, string message)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/json; charset=utf-8";
        var response = ApiResponse<object>.Fail(message);
        await context.Response.WriteAsync(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
    }
}
