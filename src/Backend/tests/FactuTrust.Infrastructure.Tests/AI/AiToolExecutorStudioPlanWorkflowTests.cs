using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.AI;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// PR 4.3d2 — outil <c>studio_plan_workflow</c> dans <see cref="AiToolExecutor"/> : garde des trois
/// drapeaux (fail-closed, aucun appel MediatR), permission <c>DesignEntities</c> via <c>AuthorizeTool</c>
/// (dépendance 4.3d1), erreurs FR de parsing et du planner (aucun plan créé), puis création d'un plan
/// <c>Workflow</c> avec spec canonique et résumé <c>summary.workflows</c> (contrat § D).
/// </summary>
public sealed class AiToolExecutorStudioPlanWorkflowTests
{
    /// <summary>Spec nominale (motif <c>StudioAiWorkflowSpecTests</c>) : un workflow manuel « Relance » sur « factures ».</summary>
    private const string RelanceSpec = """
        { "workflows": [ { "entityKey": "factures", "name": "Relance", "trigger": "manual",
          "steps": [ { "type": "notify", "to": { "kind": "startedBy" }, "title": "Relance" } ] } ] }
        """;

    private readonly Mock<IMediator> _mediator = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<ILogger<AiToolExecutor>> _logger = new();

    public AiToolExecutorStudioPlanWorkflowTests()
    {
        _currentUser.Setup(x => x.UserId).Returns(Guid.NewGuid());
        _currentUser.Setup(x => x.TenantId).Returns(Guid.NewGuid());
        _currentUser.Setup(x => x.Email).Returns("test@example.com");
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
    }

    private static OllamaSettings AllFlagsOn() => new()
    {
        EnableMutationTools = true,
        EnableStudioAiTools = true,
        EnableStudioAiPlanPreview = true,
        EnableStudioWorkflows = true,
        EnableStudioAiWorkflowTools = true
    };

    private AiToolExecutor CreateExecutor(OllamaSettings settings) => new(
        _mediator.Object,
        _logger.Object,
        TimeProvider.System,
        _currentUser.Object,
        Options.Create(settings));

    private static Dictionary<string, object?> Args(string specJson) => new() { ["spec_json"] = specJson };

    private Task<AiToolResult> Execute(OllamaSettings settings, string specJson) =>
        CreateExecutor(settings).ExecuteAsync("studio_plan_workflow", Args(specJson), AiToolExecutionContext.Empty, CancellationToken.None);

    /// <summary>Schéma réel « factures » (motif <c>SetupInterventionsSchema</c>) : champs <c>statut</c> et <c>montant</c>.</summary>
    private void SetupFacturesSchema()
    {
        var now = DateTime.UtcNow;
        var fields = new List<CustomFieldDto>
        {
            new(Guid.NewGuid(), "statut", "Statut", CustomFieldType.Select, false, false, 1, null,
                new List<SelectOptionDto> { new("brouillon", "Brouillon"), new("validee", "Validée"), new("payee", "Payée") }, null, true),
            new(Guid.NewGuid(), "montant", "Montant", CustomFieldType.Number, false, false, 2, null, null, null, true)
        };
        _mediator.Setup(m => m.Send(
                It.Is<GetCustomEntitySchemaQuery>(q => q.EntityKey == "factures"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new CustomEntitySchemaDto(
                new CustomEntityDto(Guid.NewGuid(), "factures", "Facture", "Factures", null, null, true, fields.Count, null, now, now),
                fields, new FormLayout())));
    }

    private void VerifyNoPlanCreated() =>
        _mediator.Verify(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()), Times.Never);

    [Fact]
    public async Task Studio_plan_workflow_returns_error_when_flag_is_off_without_calling_mediator()
    {
        var settings = AllFlagsOn();
        settings.EnableStudioAiWorkflowTools = false;

        var result = await Execute(settings, RelanceSpec);

        Assert.False(result.Success);
        Assert.Contains("ne sont pas activés", result.ErrorMessage);
        // Fail-closed : ni relecture de schéma ni création de plan — aucun Send, quel qu'il soit.
        _mediator.Verify(m => m.Send(It.IsAny<GetCustomEntitySchemaQuery>(), It.IsAny<CancellationToken>()), Times.Never);
        VerifyNoPlanCreated();
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Studio_plan_workflow_is_denied_without_design_entities_permission()
    {
        // Prouve la dépendance 4.3d1 : la définition enregistrée porte RequiredPermission = DesignEntities,
        // donc AuthorizeTool refuse AVANT tout dispatch (S-base).
        _currentUser.Setup(x => x.HasPermission(Permissions.Studio.DesignEntities)).Returns(false);

        var result = await Execute(AllFlagsOn(), RelanceSpec);

        Assert.False(result.Success);
        Assert.Equal(AiToolExecutor.PermissionDeniedMessage, result.ErrorMessage);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Studio_plan_workflow_returns_french_error_on_invalid_spec()
    {
        var result = await Execute(AllFlagsOn(), "{ \"workflows\": [] }");

        Assert.False(result.Success);
        Assert.Equal("La spec ne contient aucun workflow.", result.ErrorMessage);
        VerifyNoPlanCreated();
    }

    [Fact]
    public async Task Studio_plan_workflow_blocks_on_unknown_field_without_creating_plan()
    {
        SetupFacturesSchema();
        const string spec = """
            { "workflows": [ { "entityKey": "factures", "name": "Maj", "trigger": "manual",
              "steps": [ { "key": "maj", "type": "update_field", "set": { "inexistant": 1 } } ] } ] }
            """;

        var result = await Execute(AllFlagsOn(), spec);

        Assert.False(result.Success);
        Assert.Contains("champ « inexistant » inconnu", result.ErrorMessage);
        Assert.Contains("studio_get_table_schema", result.ErrorMessage);
        // Le schéma réel a bien été relu, mais le plan n'est jamais créé.
        _mediator.Verify(m => m.Send(It.Is<GetCustomEntitySchemaQuery>(q => q.EntityKey == "factures"), It.IsAny<CancellationToken>()), Times.Once);
        VerifyNoPlanCreated();
    }

    [Fact]
    public async Task Studio_plan_workflow_creates_plan_kind_workflow_with_canonical_spec_and_summary()
    {
        SetupFacturesSchema();
        CreateStudioAiPlanCommand? captured = null;
        var planId = Guid.NewGuid();
        _mediator.Setup(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CreateStudioAiPlanCommand c, CancellationToken _) =>
            {
                captured = c;
                return Result.Success(new StudioAiPlanDto(
                    planId, "Workflow", "Pending", c.SummaryJson, null, null,
                    DateTime.UtcNow, DateTime.UtcNow.AddMinutes(30), null));
            });

        var result = await Execute(AllFlagsOn(), RelanceSpec);

        Assert.True(result.Success, result.ErrorMessage);
        Assert.NotNull(captured);
        Assert.Equal(StudioAiPlanKind.Workflow, captured!.Kind);

        Assert.True(StudioAiWorkflowSpec.TryParse(RelanceSpec, out var parsed, out var parseError), parseError);
        Assert.Equal(StudioAiSpecCanonical.CanonicalWorkflow(parsed!), captured.SpecJson);
        Assert.Contains("\"workflows\":[{\"key\":\"relance\"", captured.SummaryJson);
        Assert.Contains("\"isActive\":false", captured.SummaryJson);

        using var doc = JsonDocument.Parse(result.Data);
        var root = doc.RootElement;
        Assert.True(root.GetProperty("success").GetBoolean());
        Assert.True(root.GetProperty("requiresConfirmation").GetBoolean());
        Assert.Equal("Workflow", root.GetProperty("kind").GetString());
        Assert.Equal("Pending", root.GetProperty("status").GetString());
        Assert.Equal(planId, root.GetProperty("planId").GetGuid());
        Assert.Equal("relance", root.GetProperty("summary").GetProperty("workflows")[0].GetProperty("key").GetString());
    }
}
