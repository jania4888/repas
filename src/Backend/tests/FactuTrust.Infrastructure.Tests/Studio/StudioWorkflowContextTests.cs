using System.Text;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StudioWorkflowContextTests
{
    [Fact]
    public void Serialize_drops_previous_first_when_over_64_kb()
    {
        var previous = new JsonObject { ["data"] = new string('x', 70 * 1024) };
        var context = StudioWorkflowContext.Create(Guid.NewGuid(), "commandes", null, null, previous);

        var result = context.Serialize();

        Assert.True(result.IsSuccess);
        Assert.Null(context.Previous);
        Assert.DoesNotContain(new string('x', 100), result.Value);
        Assert.True(Encoding.UTF8.GetByteCount(result.Value) <= StudioWorkflowContext.MaxBytes);
    }

    [Fact]
    public void Serialize_then_truncates_results_to_2_kb()
    {
        // 5 Ko previous + 70 Ko result : after dropping previous the context is still > 64 Ko,
        // so the 2 KB per-result truncation must kick in.
        var json = $$"""
        {
          "version": 1,
          "record": { "id": "{{Guid.NewGuid()}}", "entityKey": "commandes" },
          "startedBy": { "id": null, "email": null },
          "previous": { "data": "{{new string('x', 5 * 1024)}}" },
          "approval": {},
          "results": { "etape1": "{{new string('y', 70 * 1024)}}" },
          "vars": {}
        }
        """;
        var context = StudioWorkflowContext.Parse(json);

        var result = context.Serialize();

        Assert.True(result.IsSuccess);
        Assert.Null(context.Previous);
        var truncated = Assert.IsAssignableFrom<JsonValue>(context.Results["etape1"]);
        Assert.Equal(StudioWorkflowContext.MaxResultBytes, truncated.GetValue<string>().Length);
        Assert.True(Encoding.UTF8.GetByteCount(result.Value) <= StudioWorkflowContext.MaxBytes);
    }

    [Fact]
    public void Serialize_fails_with_the_frozen_message_when_still_too_big()
    {
        // 40 results just under the 2 Ko cap : truncation cannot shrink them further.
        var context = StudioWorkflowContext.Create(
            Guid.NewGuid(), "commandes", null, null,
            new JsonObject { ["data"] = new string('x', 1024) });
        for (var i = 0; i < 40; i++)
            context.SetResult($"etape_{i:d2}", JsonValue.Create(new string('y', 1900)));

        var result = context.Serialize();

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.context", result.Error.Code);
        Assert.Equal("Contexte d'exécution trop volumineux (64 Ko).", result.Error.Description);
    }

    [Fact]
    public void Parse_of_garbage_yields_an_empty_v1_context()
    {
        var context = StudioWorkflowContext.Parse("{ pas du json");

        Assert.NotNull(context.Root);
        Assert.Null(context.Previous);
        Assert.Empty(context.Approval);
        Assert.Empty(context.Results);
        Assert.Empty(context.Vars);
        Assert.Null(context.Resolve("_record.id"));

        var result = context.Serialize();
        Assert.True(result.IsSuccess);
        Assert.Contains("\"version\":1", result.Value);
    }
}
