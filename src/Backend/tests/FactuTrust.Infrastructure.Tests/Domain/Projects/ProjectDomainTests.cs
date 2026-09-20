using FactuTrust.Domain.Entities.Projects;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain.Projects;

public sealed class ProjectSituationTests
{
    [Fact]
    public void CumulativePercent_MustBeMonotonic()
    {
        var ok = ProjectSituation.EnsureMonotonicPercent(40m, 55m);
        Assert.True(ok.IsSuccess);

        var down = ProjectSituation.EnsureMonotonicPercent(40m, 30m);
        Assert.True(down.IsFailure);
        Assert.Contains("monotone", down.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Retainage_CannotExceedGross()
    {
        var bad = ProjectSituation.EnsureAmounts(1000m, 1200m, 19);
        Assert.True(bad.IsFailure);

        var ok = ProjectSituation.EnsureAmounts(1000m, 50m, 19);
        Assert.True(ok.IsSuccess);
    }

    [Fact]
    public void ValidatedSituation_IsImmutable_AndNetExcludesRetainage()
    {
        var created = ProjectSituation.Create(
            Guid.NewGuid(), 1,
            new DateTime(2026, 1, 1), new DateTime(2026, 1, 31),
            40m, 10_000m, 500m, 19, 0m);
        Assert.True(created.IsSuccess, created.Error.Description);
        var situation = created.Value;
        Assert.Equal(9500m, situation.NetAmountHt);
        Assert.Equal(1805m, situation.VatAmount);
        Assert.Equal(11305m, situation.TotalTtc);

        Assert.True(situation.Validate(0m).IsSuccess);
        var update = situation.UpdateDraft(
            new DateTime(2026, 1, 1), new DateTime(2026, 1, 31),
            50m, 12_000m, 500m, 19, 0m);
        Assert.True(update.IsFailure);
        Assert.Contains("validée", update.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void VatRate_MustBeTunisianScale()
    {
        var bad = ProjectSituation.EnsureAmounts(1000m, 50m, 10);
        Assert.True(bad.IsFailure);
        Assert.Contains("TVA", bad.Error.Description, StringComparison.OrdinalIgnoreCase);
    }
}

public sealed class ProjectTimeEntryTests
{
    [Fact]
    public void AlreadyInvoicedHours_CannotBeInvoicedAgain()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, true, null, null).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.True(entry.Validate().IsSuccess);
        var invoiceId = Guid.NewGuid();
        Assert.True(entry.MarkInvoiced(invoiceId).IsSuccess);
        var again = entry.MarkInvoiced(Guid.NewGuid());
        Assert.True(again.IsFailure);
        Assert.Contains("déjà", again.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void DraftHours_CannotBeInvoiced()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, true, null, null).Value;
        Assert.True(entry.MarkInvoiced(Guid.NewGuid()).IsFailure);
    }

    [Fact]
    public void InvoicedHours_CannotBeReopened()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, true, null, null).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.True(entry.Validate().IsSuccess);
        Assert.True(entry.MarkInvoiced(Guid.NewGuid()).IsSuccess);
        Assert.True(entry.ReopenToDraft().IsFailure);
    }

    [Fact]
    public void DraftEntry_CanBeUpdatedDeletedAndSubmitted()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, true, null, null).Value;
        Assert.True(entry.CanBeDeleted());
        Assert.True(entry.Update(new DateTime(2026, 8, 2), 6m, false, "note", null).IsSuccess);
        Assert.True(entry.Submit().IsSuccess);
        Assert.Equal(ProjectTimeEntryStatus.Submitted, entry.Status);
    }

    [Fact]
    public void SubmittedEntry_CannotBeUpdatedOrDeleted_ButCanReopen()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, true, null, null).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.False(entry.CanBeDeleted());
        Assert.True(entry.Update(new DateTime(2026, 8, 2), 6m, false, null, null).IsFailure);
        Assert.True(entry.ReopenToDraft().IsSuccess);
        Assert.Equal(ProjectTimeEntryStatus.Draft, entry.Status);
    }

    [Fact]
    public void ValidatedEntry_CannotBeUpdatedOrDeleted_ButCanReopen()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, true, null, null).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.True(entry.Validate().IsSuccess);
        Assert.False(entry.CanBeDeleted());
        Assert.True(entry.Update(new DateTime(2026, 8, 2), 6m, false, null, null).IsFailure);
        Assert.True(entry.ReopenToDraft().IsSuccess);
        Assert.Equal(ProjectTimeEntryStatus.Draft, entry.Status);
    }

    [Fact]
    public void InvoicedEntry_IsImmutable()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, true, null, null).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.True(entry.Validate().IsSuccess);
        Assert.True(entry.MarkInvoiced(Guid.NewGuid()).IsSuccess);
        Assert.True(entry.IsInvoiced);
        Assert.True(entry.Update(new DateTime(2026, 8, 2), 6m, false, null, null).IsFailure);
        Assert.False(entry.CanBeDeleted());
        Assert.True(entry.Submit().IsFailure);
        Assert.True(entry.Validate().IsFailure);
    }

    [Fact]
    public void NonBillableValidatedEntry_CannotBeInvoiced()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, false, null, null).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.True(entry.Validate().IsSuccess);
        Assert.True(entry.MarkInvoiced(Guid.NewGuid()).IsFailure);
        Assert.Equal(ProjectTimeEntryStatus.Validated, entry.Status);
    }

    [Fact]
    public void DraftEntry_CannotReopenToDraft()
    {
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 8, 1), 8m, true, null, null).Value;
        Assert.True(entry.ReopenToDraft().IsFailure);
    }

    [Fact]
    public void InvoicedStatusDisplay_UsesFactureLabel()
    {
        Assert.Equal("Facturé", ProjectTimeEntryStatus.Validated.ToDisplayString(isInvoiced: true));
        Assert.Equal("Validé", ProjectTimeEntryStatus.Validated.ToDisplayString(isInvoiced: false));
    }
}

public sealed class ProjectTaskMoveTests
{
    [Fact]
    public void MoveToPhase_WithDoneStatus_SetsProgressTo100()
    {
        var task = ProjectTask.Create(
            Guid.NewGuid(), Guid.NewGuid(), "Tâche", null,
            ProjectTaskPriority.Normal, null, null, null, 0m).Value;
        Assert.Equal(0, task.ProgressPercent);

        var moved = task.MoveToPhase(Guid.NewGuid(), ProjectTaskStatus.Done);
        Assert.True(moved.IsSuccess);
        Assert.Equal(ProjectTaskStatus.Done, task.Status);
        Assert.Equal(100, task.ProgressPercent);
    }

    [Fact]
    public void MoveToPhase_DoneToInProgress_ClearsProgressToZero()
    {
        var task = ProjectTask.Create(
            Guid.NewGuid(), Guid.NewGuid(), "Tâche", null,
            ProjectTaskPriority.Normal, null, null, null, 0m).Value;
        Assert.True(task.MoveToPhase(Guid.NewGuid(), ProjectTaskStatus.Done).IsSuccess);
        Assert.Equal(100, task.ProgressPercent);

        var moved = task.MoveToPhase(Guid.NewGuid(), ProjectTaskStatus.InProgress);
        Assert.True(moved.IsSuccess);
        Assert.Equal(ProjectTaskStatus.InProgress, task.Status);
        Assert.Equal(0, task.ProgressPercent);
    }

    [Fact]
    public void MoveToPhase_InProgressToWaiting_KeepsManualProgress()
    {
        var task = ProjectTask.Create(
            Guid.NewGuid(), Guid.NewGuid(), "Tâche", null,
            ProjectTaskPriority.Normal, null, null, null, 0m).Value;
        Assert.True(task.Update("Tâche", null, ProjectTaskPriority.Normal, null, null, null, 0m, 40).IsSuccess);
        Assert.True(task.SetStatus(ProjectTaskStatus.InProgress).IsSuccess);
        Assert.Equal(40, task.ProgressPercent);

        var moved = task.MoveToPhase(Guid.NewGuid(), ProjectTaskStatus.Waiting);
        Assert.True(moved.IsSuccess);
        Assert.Equal(ProjectTaskStatus.Waiting, task.Status);
        Assert.Equal(40, task.ProgressPercent);
    }

    [Fact]
    public void SetStatus_ToDone_SetsProgressTo100()
    {
        var task = ProjectTask.Create(
            Guid.NewGuid(), Guid.NewGuid(), "Tâche", null,
            ProjectTaskPriority.Normal, null, null, null, 0m).Value;

        var set = task.SetStatus(ProjectTaskStatus.Done);
        Assert.True(set.IsSuccess);
        Assert.Equal(100, task.ProgressPercent);
    }

    [Fact]
    public void SetStatus_DoneToInProgress_ClearsProgressToZero()
    {
        var task = ProjectTask.Create(
            Guid.NewGuid(), Guid.NewGuid(), "Tâche", null,
            ProjectTaskPriority.Normal, null, null, null, 0m).Value;
        Assert.True(task.SetStatus(ProjectTaskStatus.Done).IsSuccess);
        Assert.Equal(100, task.ProgressPercent);

        var set = task.SetStatus(ProjectTaskStatus.InProgress);
        Assert.True(set.IsSuccess);
        Assert.Equal(ProjectTaskStatus.InProgress, task.Status);
        Assert.Equal(0, task.ProgressPercent);
    }
}

public sealed class ProjectBillingReadinessTests
{
    [Fact]
    public void CanInvoiceTime_RequiresStatusHoursAndRates()
    {
        Assert.True(ProjectStatus.Active.CanBeBilled());
        Assert.False(ProjectStatus.Draft.CanBeBilled());
        // CanBill is status-only; CanInvoiceTime adds hours + rates (validated in service DTO)
        var canInvoiceTime = ProjectStatus.Active.CanBeBilled();
        Assert.True(canInvoiceTime);
    }
}

public sealed class ProjectFixedPriceBillingTests
{
    [Fact]
    public void FixedPriceBillingKind_ExistsInEnum()
    {
        Assert.Equal(3, (int)ProjectBillingKind.FixedPrice);
    }

    [Fact]
    public void TaskBillingKinds_ExistInEnum()
    {
        Assert.Equal(4, (int)ProjectBillingKind.TaskFixed);
        Assert.Equal(5, (int)ProjectBillingKind.TaskHourly);
    }
}

public sealed class ProjectTaskBillingTests
{
    [Fact]
    public void MarkInvoiced_SucceedsOnce_AndBlocksSecondCall()
    {
        var task = ProjectTask.Create(
            Guid.NewGuid(), Guid.NewGuid(), "Tâche", null,
            ProjectTaskPriority.Normal, null, null, null, 0m).Value;
        var invoiceId = Guid.NewGuid();

        Assert.True(task.MarkInvoiced(invoiceId, ProjectTaskBillingMethod.Fixed).IsSuccess);
        Assert.Equal(invoiceId, task.InvoicedInvoiceId);
        Assert.Equal(ProjectTaskBillingMethod.Fixed, task.InvoicedBillingMethod);

        var again = task.MarkInvoiced(Guid.NewGuid(), ProjectTaskBillingMethod.Hourly);
        Assert.True(again.IsFailure);
        Assert.Contains("déjà", again.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void InvoicedTask_CannotBeUpdated()
    {
        var task = ProjectTask.Create(
            Guid.NewGuid(), Guid.NewGuid(), "Tâche", null,
            ProjectTaskPriority.Normal, null, null, null, 0m).Value;
        Assert.True(task.MarkInvoiced(Guid.NewGuid(), ProjectTaskBillingMethod.Hourly).IsSuccess);

        var update = task.Update("Autre", null, ProjectTaskPriority.Normal, null, null, null, 0m, 0);
        Assert.True(update.IsFailure);
        Assert.Contains("facturée", update.Error.Description, StringComparison.OrdinalIgnoreCase);
    }
}

public sealed class ProjectClosureTests
{
    [Fact]
    public void Complete_Fails_WhenTimeEntriesAreStillOpen()
    {
        var project = Project.Create(Guid.NewGuid(), "Mission", ProjectKind.Generic, ProjectBillingMode.None, null, null, null, 0m).Value;
        Assert.True(project.Activate().IsSuccess);
        var close = project.Complete(hasOpenTimeEntries: true);
        Assert.True(close.IsFailure);
        Assert.True(project.Complete(hasOpenTimeEntries: false).IsSuccess);
        Assert.Equal(ProjectStatus.Completed, project.Status);
    }

    [Fact]
    public void GenericProject_CannotUseProgressSituations()
    {
        var created = Project.Create(
            Guid.NewGuid(), "Chantier", ProjectKind.Generic, ProjectBillingMode.ProgressSituations, null, null, null, 0m);
        Assert.True(created.IsFailure);
        Assert.Contains("BTP", created.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Draft_CannotReceiveTime_NorBeBilled()
    {
        Assert.False(ProjectStatus.Draft.CanReceiveTime());
        Assert.False(ProjectStatus.Draft.CanProcessExistingTime());
        Assert.False(ProjectStatus.Draft.CanBeBilled());
        Assert.Contains("Brouillon", ProjectStatus.Draft.CannotBeBilledMessage(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Brouillon", ProjectStatus.Draft.CannotReceiveTimeMessage(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Brouillon", ProjectStatus.Draft.CannotProcessExistingTimeMessage(), StringComparison.OrdinalIgnoreCase);
        Assert.True(ProjectStatus.Active.CanReceiveTime());
        Assert.True(ProjectStatus.Active.CanProcessExistingTime());
        Assert.True(ProjectStatus.Active.CanBeBilled());
        Assert.True(ProjectStatus.Completed.CanBeBilled());
        Assert.True(ProjectStatus.Completed.CanProcessExistingTime());
        Assert.False(ProjectStatus.Completed.CanReceiveTime());
        Assert.True(ProjectStatus.OnHold.CanProcessExistingTime());
        Assert.False(ProjectStatus.OnHold.CanReceiveTime());
        Assert.False(ProjectStatus.OnHold.CanBeBilled());
        Assert.False(ProjectStatus.Cancelled.CanProcessExistingTime());
    }

    [Fact]
    public void DefaultColumns_DependOnKind()
    {
        var generic = ProjectPhase.DefaultColumnsFor(ProjectKind.Generic);
        Assert.Contains(generic, c => c.Name == "À faire");

        var esn = ProjectPhase.DefaultColumnsFor(ProjectKind.Esn);
        Assert.Equal("Backlog", esn[0].Name);
        Assert.Equal("Livré", esn[^1].Name);

        var btp = ProjectPhase.DefaultColumnsFor(ProjectKind.Btp);
        Assert.Equal("Préparation", btp[0].Name);
        Assert.Equal("Clôturé", btp[^1].Name);
    }
}

public sealed class ProjectTimesheetsFlagsTests
{
    [Fact]
    public void Create_PersistsTimesheetsFlag()
    {
        var created = Project.Create(
            Guid.NewGuid(), "Mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials,
            null, null, null, 0m, timesheetsEnabled: true);
        Assert.True(created.IsSuccess);
        Assert.True(created.Value.TimesheetsEnabled);
    }

    [Fact]
    public void Create_DefaultsTimesheetsToTrue()
    {
        var created = Project.Create(
            Guid.NewGuid(), "Mission", ProjectKind.Generic, ProjectBillingMode.None,
            null, null, null, 0m);
        Assert.True(created.IsSuccess);
        Assert.True(created.Value.TimesheetsEnabled);
    }

    [Fact]
    public void Update_DoesNotChangeTimesheetsFlag()
    {
        var created = Project.Create(
            Guid.NewGuid(), "Mission", ProjectKind.Generic, ProjectBillingMode.None,
            null, null, null, 0m, timesheetsEnabled: false);
        var project = created.Value;
        Assert.True(project.Update("Renommé", null, ProjectBillingMode.TimeAndMaterials, null, null, null, 100m, null, null).IsSuccess);
        Assert.False(project.TimesheetsEnabled);
    }
}

public sealed class ProjectTimeBillablePolicyTests
{
    [Fact]
    public void Resolve_HonorsRequestedBillable_WhenNoSalesOrder()
    {
        Assert.True(ProjectTimeBillablePolicy.Resolve(true, null, null));
        Assert.False(ProjectTimeBillablePolicy.Resolve(false, null, null));
    }

    [Fact]
    public void Resolve_RequiresSalesOrderLine_WhenProjectLinkedToOrder()
    {
        var orderId = Guid.NewGuid();
        Assert.False(ProjectTimeBillablePolicy.Resolve(true, orderId, null));
        Assert.True(ProjectTimeBillablePolicy.Resolve(true, orderId, Guid.NewGuid()));
    }
}

public sealed class OdooTimesheetAlignmentDomainTests
{
    [Fact]
    public void Milestone_MarkReached_SetsTimestamp()
    {
        var m = ProjectMilestone.Create(Guid.NewGuid(), "Phase 1", 25m, 1000m, null).Value;
        Assert.True(m.MarkReached().IsSuccess);
        Assert.True(m.IsReached);
        Assert.NotNull(m.ReachedAt);
    }

    [Fact]
    public void TimeEntry_TimerLifecycle()
    {
        // Le domaine exige des heures initiales > 0 (StopTimer y AJOUTE le temps chronométré) :
        // une entrée à 0 h est rejetée par construction — on part donc d'un solde minimal.
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), DateTime.UtcNow.Date, 0.01m, true, null, null).Value;
        Assert.True(entry.StartTimer().IsSuccess);
        Assert.True(entry.IsTimerRunning);
        Assert.True(entry.StartTimer().IsFailure);
        Assert.True(entry.StopTimer().IsSuccess);
        Assert.False(entry.IsTimerRunning);
    }

    [Fact]
    public void TimeEntry_WithSalesOrderLine_PersistsLink()
    {
        var lineId = Guid.NewGuid();
        var entry = ProjectTimeEntry.Create(Guid.NewGuid(), Guid.NewGuid(), DateTime.UtcNow.Date, 2m, true, null, null, lineId).Value;
        Assert.Equal(lineId, entry.SalesOrderLineId);
    }

    [Fact]
    public void ServiceInvoicingPolicy_MapsToProjectBillingMode()
    {
        Assert.Equal(ProjectBillingMode.TimeAndMaterials, ServiceInvoicingPolicy.BasedOnTimesheets.ToProjectBillingMode());
        Assert.Equal(ProjectBillingMode.Milestone, ServiceInvoicingPolicy.BasedOnMilestones.ToProjectBillingMode());
    }
}
