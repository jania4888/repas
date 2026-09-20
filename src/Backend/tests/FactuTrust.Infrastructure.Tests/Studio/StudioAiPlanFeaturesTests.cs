using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Cycle de vie d'un plan Studio IA : création → aperçu → confirmation/annulation, avec les gardes
/// (expiration, double confirmation via RowVersion, permissions) qui protègent des créations
/// accidentelles ou dupliquées.
/// </summary>
public sealed class StudioAiPlanFeaturesTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<IStudioAiBuildPlanRepository> _plans = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IStudioAiPlanExecutor> _executor = new();

    public StudioAiPlanFeaturesTests()
    {
        _currentUser.Setup(x => x.TenantId).Returns(TenantId);
        _currentUser.Setup(x => x.UserId).Returns(UserId);
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
        _plans.Setup(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()))
            .ReturnsAsync(true);
    }

    [Fact]
    public async Task Create_persists_a_pending_plan_with_its_summary()
    {
        StudioAiBuildPlan? saved = null;
        _plans.Setup(p => p.AddAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>()))
            .Callback((StudioAiBuildPlan p, CancellationToken _) => saved = p)
            .Returns(Task.CompletedTask);

        var result = await CreateHandler().Handle(
            new CreateStudioAiPlanCommand(StudioAiPlanKind.CreateSystem, "{\"system\":{}}", "{\"title\":\"Congés\"}"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(StudioAiPlanStatus.Pending.ToString(), result.Value.Status);
        Assert.NotNull(saved);
        Assert.Equal(TenantId, saved!.TenantId);
        Assert.True(saved.ExpiresAt > saved.CreatedAt);
    }

    [Fact]
    public async Task Create_without_design_permission_is_refused()
    {
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(false);

        var result = await CreateHandler().Handle(
            new CreateStudioAiPlanCommand(StudioAiPlanKind.CreateApp, "{}", "{}"), CancellationToken.None);

        Assert.True(result.IsFailure);
        _plans.Verify(p => p.AddAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Confirm_executes_the_plan_and_marks_it_completed()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        _executor.Setup(e => e.ExecuteAsync(plan, It.IsAny<IStudioBuildProgress?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((true, (string?)null, (object?)new { systemKey = "conges" }));

        var result = await ConfirmHandler().Handle(new ConfirmStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(StudioAiPlanStatus.Completed, plan.Status);
        Assert.Contains("conges", plan.ResultJson);
        _executor.Verify(e => e.ExecuteAsync(plan, It.IsAny<IStudioBuildProgress?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Confirm_of_an_expired_plan_creates_nothing()
    {
        var plan = PendingPlan(lifetime: TimeSpan.FromMinutes(-1));
        SetupGet(plan);

        var result = await ConfirmHandler().Handle(new ConfirmStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("expiré", result.Error.Description);
        Assert.Equal(StudioAiPlanStatus.Expired, plan.Status);
        _executor.Verify(e => e.ExecuteAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<IStudioBuildProgress?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Concurrent_confirm_loses_the_rowversion_race_and_executes_nothing()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        // Une autre requête a déjà fait passer le plan en Executing : la mise à jour échoue.
        _plans.Setup(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()))
            .ReturnsAsync(false);

        var result = await ConfirmHandler().Handle(new ConfirmStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        _executor.Verify(e => e.ExecuteAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<IStudioBuildProgress?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Confirm_of_an_already_completed_plan_is_refused()
    {
        var plan = PendingPlan();
        plan.MarkCompleted(null);
        SetupGet(plan);

        var result = await ConfirmHandler().Handle(new ConfirmStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        _executor.Verify(e => e.ExecuteAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<IStudioBuildProgress?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task An_exception_escaping_the_executor_marks_the_plan_failed_instead_of_wedging_it_executing()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        _executor.Setup(e => e.ExecuteAsync(plan, It.IsAny<IStudioBuildProgress?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("op inconnue"));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            ConfirmHandler().Handle(new ConfirmStudioAiPlanCommand(plan.Id), CancellationToken.None));

        // Le plan est marqué Failed (et donc ni annulable à tort ni figé) malgré l'exception.
        Assert.Equal(StudioAiPlanStatus.Failed, plan.Status);
        _plans.Verify(p => p.TryUpdateAsync(plan, It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Exactly(2));
    }

    [Fact]
    public async Task Failed_execution_marks_the_plan_failed_and_surfaces_the_real_error()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        _executor.Setup(e => e.ExecuteAsync(plan, It.IsAny<IStudioBuildProgress?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((false, "Limite du plan atteinte : 50 tables maximum.", (object?)null));

        var result = await ConfirmHandler().Handle(new ConfirmStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("Limite du plan", result.Error.Description);
        Assert.Equal(StudioAiPlanStatus.Failed, plan.Status);
    }

    [Fact]
    public async Task Cancel_leaves_the_plan_unexecuted()
    {
        var plan = PendingPlan();
        SetupGet(plan);

        var result = await CancelHandler().Handle(new CancelStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(StudioAiPlanStatus.Cancelled, plan.Status);
        _executor.Verify(e => e.ExecuteAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<IStudioBuildProgress?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Get_reports_an_overdue_pending_plan_as_expired_without_writing()
    {
        var plan = PendingPlan(lifetime: TimeSpan.FromMinutes(-5));
        SetupGet(plan);

        var result = await new GetStudioAiPlanQueryHandler(_plans.Object, _currentUser.Object)
            .Handle(new GetStudioAiPlanQuery(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(StudioAiPlanStatus.Expired.ToString(), result.Value.Status);
        Assert.Equal(StudioAiPlanStatus.Pending, plan.Status); // état persistant intact
        _plans.Verify(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Never);
    }

    [Fact]
    public async Task Plan_of_another_tenant_is_not_found()
    {
        _plans.Setup(p => p.GetByIdAsync(TenantId, It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((StudioAiBuildPlan?)null);

        var result = await ConfirmHandler().Handle(new ConfirmStudioAiPlanCommand(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("NotFound", result.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(StudioAiPlanKind.View, Permissions.Studio.DesignForms)]
    // PR 2.4 : une vue enregistrée relève de la conception des affichages, comme une fenêtre.
    [InlineData(StudioAiPlanKind.RecordView, Permissions.Studio.DesignForms)]
    [InlineData(StudioAiPlanKind.Report, Permissions.Studio.DesignReports)]
    [InlineData(StudioAiPlanKind.CreateSystem, Permissions.Studio.DesignEntities)]
    [InlineData(StudioAiPlanKind.CreateApp, Permissions.Studio.DesignEntities)]
    [InlineData(StudioAiPlanKind.Amendment, Permissions.Studio.DesignEntities)]
    public void RequiredPermission_maps_each_plan_kind(StudioAiPlanKind kind, string expected) =>
        Assert.Equal(expected, StudioAiPlanDefaults.RequiredPermission(kind));

    // PR 3.2 : tout état terminal est rejouable ; un Pending échu l'est aussi, un Pending vivant non.
    [Theory]
    [InlineData(StudioAiPlanStatus.Completed, false, true)]
    [InlineData(StudioAiPlanStatus.Failed, false, true)]
    [InlineData(StudioAiPlanStatus.Cancelled, false, true)]
    [InlineData(StudioAiPlanStatus.Expired, false, true)]
    [InlineData(StudioAiPlanStatus.Pending, false, false)]
    [InlineData(StudioAiPlanStatus.Pending, true, true)]
    [InlineData(StudioAiPlanStatus.Executing, false, false)]
    [InlineData(StudioAiPlanStatus.Executing, true, false)]
    public void IsReplayable_follows_status_and_expiry(StudioAiPlanStatus status, bool pastExpiry, bool expected)
    {
        var plan = PendingPlan();
        switch (status)
        {
            case StudioAiPlanStatus.Completed: plan.MarkCompleted(null); break;
            case StudioAiPlanStatus.Failed: plan.MarkFailed("échec"); break;
            case StudioAiPlanStatus.Cancelled: plan.MarkCancelled(); break;
            case StudioAiPlanStatus.Expired: plan.MarkExpired(); break;
            case StudioAiPlanStatus.Executing: plan.MarkExecuting(); break;
        }

        var utcNow = pastExpiry ? plan.ExpiresAt.AddMinutes(1) : DateTime.UtcNow;

        Assert.Equal(expected, StudioAiPlanDefaults.IsReplayable(plan, utcNow));
    }

    private static StudioAiBuildPlan PendingPlan(TimeSpan? lifetime = null) =>
        StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.CreateSystem, "{\"system\":{}}", "{}", UserId,
            lifetime ?? StudioAiPlanDefaults.Lifetime);

    private void SetupGet(StudioAiBuildPlan plan) =>
        _plans.Setup(p => p.GetByIdAsync(TenantId, plan.Id, It.IsAny<CancellationToken>())).ReturnsAsync(plan);

    private CreateStudioAiPlanCommandHandler CreateHandler() =>
        new(_plans.Object, _audit.Object, _currentUser.Object);

    /// <summary>
    /// PR 4.3 : la nature Workflow vaut 6 (persistée en <c>int</c>, sans migration) et relève de la
    /// conception des tables (D-11 — cas explicite, pas le cas par défaut).
    /// </summary>
    [Fact]
    public void Workflow_kind_has_value_6_and_requires_design_entities()
    {
        Assert.Equal(6, (int)StudioAiPlanKind.Workflow);
        Assert.Equal(Permissions.Studio.DesignEntities, StudioAiPlanDefaults.RequiredPermission(StudioAiPlanKind.Workflow));
    }

    private ConfirmStudioAiPlanCommandHandler ConfirmHandler() =>
        new(_plans.Object, _executor.Object, _audit.Object, _currentUser.Object);

    private CancelStudioAiPlanCommandHandler CancelHandler() =>
        new(_plans.Object, _audit.Object, _currentUser.Object);
}
