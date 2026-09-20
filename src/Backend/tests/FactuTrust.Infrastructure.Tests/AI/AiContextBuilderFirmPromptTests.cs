using System.Reflection;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// Lot 1.1 — non-régression du prompt de base dédié FirmMission. Le prompt firm (variantes complète
/// ET compacte) ne doit contenir AUCUN nom d'outil tenant (<c>get_sales_revenue</c>,
/// <c>get_stock_snapshot</c>, <c>generate_dashboard_config</c>, <c>resolve_reporting_period</c>) et
/// doit contenir le guide firm (les outils <c>get_firm_*</c> réels). Les prompts des autres scopes
/// (tenant, <see cref="AssistantAgentScope.None"/>) restent produits par le chemin d'origine — on
/// vérifie qu'ils conservent leurs outils tenant et n'empruntent PAS le guide firm (la dispatch
/// FirmMission n'affecte que ce scope). <see cref="AiContextBuilder"/> SystemPromptCacheRevision
/// doit être incrémentée à chaque changement de contenu ("v4" depuis le digest Studio, PR 1.2).
/// </summary>
public sealed class AiContextBuilderFirmPromptTests
{
    private static AiContextBuilder Build(OllamaSettings settings)
    {
        var companyRepo = new Mock<ICompanyRepository>();
        companyRepo.Setup(r => r.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Company?)null);

        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(Guid.NewGuid());

        return new AiContextBuilder(
            companyRepo.Object,
            tenant.Object,
            new MemoryCache(new MemoryCacheOptions()),
            Mock.Of<IOllamaInferenceProfileResolver>(),
            Options.Create(settings),
            TimeProvider.System);
    }

    private static readonly string[] TenantToolNames =
        { "get_sales_revenue", "get_stock_snapshot", "generate_dashboard_config", "resolve_reporting_period" };

    [Fact]
    public async Task Firm_mission_full_prompt_excludes_tenant_tools_and_contains_firm_guide()
    {
        var builder = Build(new OllamaSettings
        {
            UseCompactChatPrompt = false,
            UseCompactChatPromptOnCpu = false // force la variante complète quel que soit le profil
        });

        var prompt = await builder.BuildSystemPromptAsync(
            AssistantMode.Default, screenId: null, AssistantAgentScope.FirmMission);

        foreach (var tenantTool in TenantToolNames)
            Assert.DoesNotContain(tenantTool, prompt);
        Assert.Contains("get_firm_portfolio_overview", prompt);
        Assert.Contains("get_firm_dossier_health", prompt);
    }

    [Fact]
    public async Task Firm_mission_compact_prompt_excludes_tenant_tools_and_contains_firm_guide()
    {
        var builder = Build(new OllamaSettings { UseCompactChatPrompt = true });

        var prompt = await builder.BuildSystemPromptAsync(
            AssistantMode.Default, screenId: null, AssistantAgentScope.FirmMission);

        foreach (var tenantTool in TenantToolNames)
            Assert.DoesNotContain(tenantTool, prompt);
        Assert.Contains("get_firm_portfolio_overview", prompt);
    }

    [Fact]
    public async Task Tenant_none_prompt_keeps_tenant_tools_and_does_not_use_firm_guide()
    {
        // Non-régression : le chemin tenant (scope None) reste produit par le core d'origine et
        // conserve ses outils tenant ; il n'emprunte PAS le guide firm.
        var builder = Build(new OllamaSettings
        {
            UseCompactChatPrompt = false,
            UseCompactChatPromptOnCpu = false
        });

        var prompt = await builder.BuildSystemPromptAsync(
            AssistantMode.Default, screenId: null, AssistantAgentScope.None);

        Assert.Contains("get_sales_revenue", prompt);
        Assert.DoesNotContain("get_firm_portfolio_overview", prompt);
    }

    [Fact]
    public async Task Firm_mission_prompt_differs_from_tenant_prompt()
    {
        // La dispatch FirmMission produit un prompt distinct du prompt tenant.
        var firmPrompt = await Build(new OllamaSettings
            {
                UseCompactChatPrompt = false,
                UseCompactChatPromptOnCpu = false
            }).BuildSystemPromptAsync(AssistantMode.Default, null, AssistantAgentScope.FirmMission);

        var tenantPrompt = await Build(new OllamaSettings
            {
                UseCompactChatPrompt = false,
                UseCompactChatPromptOnCpu = false
            }).BuildSystemPromptAsync(AssistantMode.Default, null, AssistantAgentScope.None);

        Assert.NotEqual(firmPrompt, tenantPrompt);
    }

    [Fact]
    public void System_prompt_cache_revision_is_incremented_to_v9()
    {
        // Sans incrément, la clé de cache ne hashe pas le contenu : l'ancien prompt resterait servi
        // jusqu'au TTL. Le digest Studio (PR 1.2) imposait "v3" → "v4" ; la règle 11 « existingKey »
        // (PR 1.3) "v4" → "v5" ; la règle 13 « vues enregistrées » (PR 2.4) "v5" → "v6" ; la règle 8
        // enrichie (amendements PR 3.1b) "v6" → "v7" ; la règle 14 « workflows » (PR 4.3e) impose
        // "v7" → "v8" ; la règle 14 qui propose le déclencheur planifié (4.7 suite, clôture de
        // l'écart D-47-73) impose "v8" → "v9".
        var field = typeof(AiContextBuilder).GetField(
            "SystemPromptCacheRevision",
            BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(field);
        Assert.Equal("v9", (string)field!.GetRawConstantValue()!);
    }
}
