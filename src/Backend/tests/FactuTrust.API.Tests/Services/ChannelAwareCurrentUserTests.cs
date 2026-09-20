using System.Security.Claims;
using FactuTrust.API.Services;
using FactuTrust.API.Services.Channels;
using FactuTrust.Application.Common.Identity;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Enums;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace FactuTrust.API.Tests.Services;

/// <summary>
/// Ordre de priorité du décorateur : impersonation (workflow) &gt; canal &gt; claims HTTP.
/// Les deux AsyncLocal sont remis à zéro en <c>finally</c> pour ne pas fuir vers d'autres tests.
/// </summary>
public sealed class ChannelAwareCurrentUserTests
{
    private static readonly Guid HttpUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid HttpTenantId = Guid.Parse("11111111-2222-2222-2222-222222222222");
    private static readonly Guid ChannelUserId = Guid.Parse("22222222-1111-1111-1111-111111111111");
    private static readonly Guid ChannelTenantId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid WorkflowUserId = Guid.Parse("33333333-1111-1111-1111-111111111111");
    private static readonly Guid WorkflowTenantId = Guid.Parse("33333333-2222-2222-2222-222222222222");
    private static readonly Guid PortalClientId = Guid.Parse("44444444-4444-4444-4444-444444444444");

    private static ChannelAwareCurrentUser Build(bool portal = false)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, HttpUserId.ToString()),
            new(ClaimTypes.Email, "http@instafact.tn"),
            new("tenant_id", HttpTenantId.ToString()),
            new(ClaimTypes.Role, UserRole.Administrator.ToString()),
            new(AuthClaimTypes.Permission, "invoices:read"),
        };
        if (portal)
        {
            claims.Add(new Claim(AuthClaimTypes.IsPortal, "true"));
            claims.Add(new Claim(AuthClaimTypes.ClientId, PortalClientId.ToString()));
        }

        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"))
        };
        context.Request.Headers["User-Agent"] = "xunit";
        context.Request.Headers["X-Forwarded-For"] = "203.0.113.7";

        return new ChannelAwareCurrentUser(new CurrentUser(new HttpContextAccessor { HttpContext = context }));
    }

    private static ChannelUserSnapshot Channel() => new(
        ChannelUserId, ChannelTenantId, "channel@instafact.tn", UserRole.Accountant,
        new HashSet<string>(StringComparer.Ordinal) { "ai:chat" });

    private static ImpersonatedUserSnapshot Workflow() => new(
        WorkflowUserId, WorkflowTenantId, "workflow@instafact.tn", UserRole.SalesRep,
        new HashSet<string>(StringComparer.Ordinal) { "studio:records_write" },
        "studio-workflow:0123456789abcdef0123456789abcdef");

    [Fact]
    public void Impersonation_snapshot_wins_over_channel_and_http()
    {
        var user = Build();
        try
        {
            ChannelUserContext.Set(Channel());
            using (ImpersonatedUserContext.Enter(Workflow()))
            {
                Assert.Equal(WorkflowUserId, user.UserId);
                Assert.Equal(WorkflowTenantId, user.TenantId);
                Assert.Equal("workflow@instafact.tn", user.Email);
                Assert.Equal(UserRole.SalesRep, user.Role);
                Assert.True(user.IsAuthenticated);

                // Jamais de repli : ni la permission du canal ni celle des claims HTTP ne passent.
                Assert.True(user.HasPermission("studio:records_write"));
                Assert.False(user.HasPermission("ai:chat"));
                Assert.False(user.HasPermission("invoices:read"));
            }

            // Sortie de l'impersonation ⇒ le canal reprend la main.
            Assert.Equal(ChannelUserId, user.UserId);
        }
        finally
        {
            ChannelUserContext.Clear();
        }
    }

    [Fact]
    public void Channel_snapshot_wins_over_http_when_no_impersonation()
    {
        var user = Build();
        try
        {
            ChannelUserContext.Set(Channel());

            Assert.Null(ImpersonatedUserContext.Current);
            Assert.Equal(ChannelUserId, user.UserId);
            Assert.Equal(ChannelTenantId, user.TenantId);
            Assert.Equal("channel@instafact.tn", user.Email);
            Assert.Equal(UserRole.Accountant, user.Role);
            Assert.True(user.IsAuthenticated);
            Assert.True(user.HasPermission("ai:chat"));
            Assert.False(user.HasPermission("invoices:read"));
            Assert.Null(user.IpAddress);
            Assert.Null(user.UserAgent);
        }
        finally
        {
            ChannelUserContext.Clear();
        }
    }

    [Fact]
    public void Falls_back_to_http_claims_when_no_snapshot_is_set()
    {
        Assert.Null(ChannelUserContext.Current);
        Assert.Null(ImpersonatedUserContext.Current);
        var user = Build();

        Assert.Equal(HttpUserId, user.UserId);
        Assert.Equal(HttpTenantId, user.TenantId);
        Assert.Equal("http@instafact.tn", user.Email);
        Assert.Equal(UserRole.Administrator, user.Role);
        Assert.True(user.IsAuthenticated);
        Assert.True(user.HasPermission("invoices:read"));
        Assert.False(user.HasPermission("studio:records_write"));
        Assert.Equal("203.0.113.7", user.IpAddress);
        Assert.Equal("xunit", user.UserAgent);
        Assert.False(user.IsClientPortal);
        Assert.Null(user.PortalClientId);
    }

    [Fact]
    public void Impersonation_reports_no_portal_context_and_null_ip_and_user_agent()
    {
        // Le contexte HTTP appelant est un utilisateur PORTAIL : rien de tout cela ne doit fuir dans le workflow.
        var user = Build(portal: true);
        Assert.True(user.IsClientPortal);
        Assert.Equal(PortalClientId, user.PortalClientId);

        using (ImpersonatedUserContext.Enter(Workflow()))
        {
            Assert.False(user.IsClientPortal);
            Assert.Null(user.PortalClientId);
            Assert.False(user.IsAccountingFirmDelegatedContext);
            Assert.Null(user.IpAddress);
            Assert.Null(user.UserAgent);
        }

        Assert.True(user.IsClientPortal);
        Assert.Equal("203.0.113.7", user.IpAddress);
    }

    [Fact]
    public void Channel_snapshot_also_masks_the_portal_http_context()
    {
        // Même verrouillage que sous impersonation : le contexte portail HTTP ne fuit pas dans le canal.
        var user = Build(portal: true);
        Assert.True(user.IsClientPortal);
        try
        {
            ChannelUserContext.Set(Channel());

            Assert.False(user.IsClientPortal);
            Assert.Null(user.PortalClientId);
            Assert.False(user.IsAccountingFirmDelegatedContext);
            Assert.Null(user.IpAddress);
        }
        finally
        {
            ChannelUserContext.Clear();
        }

        Assert.True(user.IsClientPortal);
    }

    [Fact]
    public void Impersonation_snapshot_with_empty_permissions_never_falls_back()
    {
        // Permissions vides sur l'instantané : ni le canal ni les claims HTTP ne servent de repli.
        var user = Build();
        var empty = new ImpersonatedUserSnapshot(
            WorkflowUserId, WorkflowTenantId, "workflow@instafact.tn", UserRole.SalesRep,
            new HashSet<string>(StringComparer.Ordinal), "studio-workflow:0123456789abcdef0123456789abcdef");
        try
        {
            ChannelUserContext.Set(Channel());
            using (ImpersonatedUserContext.Enter(empty))
            {
                Assert.True(user.IsAuthenticated);
                Assert.False(user.HasPermission("studio:records_write"));
                Assert.False(user.HasPermission("ai:chat"));
                Assert.False(user.HasPermission("invoices:read"));
            }
        }
        finally
        {
            ChannelUserContext.Clear();
        }
    }
}
