using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.Studio.Workflows;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StudioBridgeActionCatalogTests
{
    [Fact]
    public void Generate_invoice_is_bridgeable()
    {
        var tool = AiToolRegistry.GetToolDefinition("generate_invoice");
        Assert.NotNull(tool);
        Assert.True(tool!.IsMutating);
        Assert.True(StudioBridgeActionCatalog.IsBridgeable(tool));

        var resolved = StudioBridgeActionCatalog.Resolve("generate_invoice");
        Assert.NotNull(resolved);
        Assert.Equal("generate_invoice", resolved!.Name);

        // List() exposes bridgeable tools only, sorted by name (Ordinal)
        var list = StudioBridgeActionCatalog.List();
        Assert.Contains(list, t => t.Name == "generate_invoice");
        Assert.All(list, t => Assert.True(t.IsMutating));
        Assert.DoesNotContain(list, t => t.Name.StartsWith("studio_", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(
            list.Select(t => t.Name).OrderBy(n => n, StringComparer.Ordinal).ToList(),
            list.Select(t => t.Name).ToList());
    }

    [Fact]
    public void Studio_plan_changes_is_not_bridgeable()
    {
        var tool = AiToolRegistry.GetToolDefinition("studio_plan_changes");
        Assert.NotNull(tool);
        Assert.False(StudioBridgeActionCatalog.IsBridgeable(tool!));
        Assert.Null(StudioBridgeActionCatalog.Resolve("studio_plan_changes"));
    }

    [Fact]
    public void Read_only_tools_are_not_bridgeable()
    {
        var tool = AiToolRegistry.GetToolDefinition("get_sales_revenue");
        Assert.NotNull(tool);
        Assert.False(tool!.IsMutating);
        Assert.False(StudioBridgeActionCatalog.IsBridgeable(tool));
        Assert.Null(StudioBridgeActionCatalog.Resolve("get_sales_revenue"));
    }

    [Fact]
    public void Resolve_returns_null_for_unknown_and_studio_tools()
    {
        // no tool named studio_create_* exists in the registry: this only covers the unknown case
        Assert.Null(StudioBridgeActionCatalog.Resolve("studio_create_table"));
        // a real studio_* tool covers the prefix rule
        Assert.Null(StudioBridgeActionCatalog.Resolve("studio_plan_changes"));
        Assert.Null(StudioBridgeActionCatalog.Resolve("no_such_tool"));
        Assert.Null(StudioBridgeActionCatalog.Resolve(null));
    }
}
