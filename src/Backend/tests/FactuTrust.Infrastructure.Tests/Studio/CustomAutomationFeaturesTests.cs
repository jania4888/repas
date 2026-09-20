using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.Studio.Automations;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — 4.3g : le pont « automatisations » historique s'aligne sur le catalogue d'actions des
/// workflows (<see cref="StudioBridgeActionCatalog.IsBridgeable"/> : mutant <b>et</b> hors <c>studio_*</c>).
/// Catalogue exposé sans outil <c>studio_*</c> ; création d'une automatisation ciblant <c>studio_plan_app</c>
/// refusée en <c>Validation.action</c> avant tout accès à la table.
/// </summary>
public sealed class CustomAutomationFeaturesTests
{
    [Fact]
    public async Task ListAutomationActions_excludes_studio_plan_tools_and_keeps_mutating_erp_actions()
    {
        var result = await new ListAutomationActionsQueryHandler().Handle(new ListAutomationActionsQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        var actions = result.Value;

        Assert.DoesNotContain(actions, a => a.Name.StartsWith("studio_", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(actions, a => a.Name == "create_product");
        Assert.All(actions, a => Assert.True(AiToolRegistry.GetToolDefinition(a.Name)!.IsMutating));
        Assert.Equal(StudioBridgeActionCatalog.List().Count, actions.Count);
    }

    [Fact]
    public async Task Upsert_automation_with_studio_plan_app_action_returns_Validation_action()
    {
        var currentUser = new Mock<ICurrentUser>();
        currentUser.Setup(u => u.TenantId).Returns(Guid.NewGuid());
        currentUser.Setup(u => u.UserId).Returns(Guid.NewGuid());
        var repo = new Mock<ICustomAutomationRepository>(MockBehavior.Strict);
        var entities = new Mock<ICustomEntityRepository>(MockBehavior.Strict);

        var handler = new UpsertAutomationCommandHandler(repo.Object, entities.Object, currentUser.Object);
        var command = new UpsertAutomationCommand(
            Guid.NewGuid(), null,
            new SaveAutomationRequest("Test", StudioAutomationTrigger.OnCreate, "studio_plan_app", null, false, true));

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.action", result.Error.Code);
        Assert.Equal("Action ERP inconnue ou non autorisée.", result.Error.Description);
        // Le contrôle de l'action précède l'accès à la table : aucune lecture d'entité.
        entities.Verify(e => e.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
