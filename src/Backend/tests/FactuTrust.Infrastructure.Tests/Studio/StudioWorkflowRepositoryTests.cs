using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories.Studio;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 4.1c : <see cref="StudioWorkflowRepository"/> contre un SQL Server RÉEL.
/// Vérifie l'isolement par tenant (TenantId dans chaque requête), le masquage des définitions
/// supprimées (filtre global + index unique filtré), la concurrence optimiste sur RowVersion,
/// l'ordre et la borne <c>Math.Clamp(max, 1, 200)</c> des instances, le prédicat de chaîne
/// d'origine et le tri des exécutions d'étapes. Une base dédiée par classe
/// (<see cref="SqlTestDatabase"/>) ; <c>Skipped</c> explicite sans SQL.
/// </summary>
public sealed class StudioWorkflowRepositoryTests : IClassFixture<StudioWorkflowRepositoryTests.SqlFixture>
{
    private const string SkipMessage = "SQL Server/LocalDB indisponible dans ce bac à sable.";

    private readonly SqlFixture _sql;

    public StudioWorkflowRepositoryTests(SqlFixture sql) => _sql = sql;

    [SkippableFact]
    public async Task Definitions_are_isolated_by_tenant_and_soft_deleted_ones_are_hidden()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var activeA = NewDefinition(tenantA, entityId, "active_a");
        var deletedA = NewDefinition(tenantA, entityId, "deleted_a");
        deletedA.SoftDelete(null);
        var otherTenant = NewDefinition(tenantB, entityId, "active_a"); // même clé, autre tenant : autorisé.

        await repo.AddDefinitionAsync(activeA);
        await repo.AddDefinitionAsync(deletedA);
        await repo.AddDefinitionAsync(otherTenant);

        var listA = await repo.ListByEntityAsync(tenantA, entityId);
        Assert.Equal(new[] { activeA.Id }, listA.Select(d => d.Id).ToArray());

        var listB = await repo.ListByEntityAsync(tenantB, entityId);
        Assert.Equal(new[] { otherTenant.Id }, listB.Select(d => d.Id).ToArray());

        Assert.Null(await repo.GetDefinitionAsync(tenantB, activeA.Id));
        Assert.Null(await repo.GetDefinitionAsync(tenantA, deletedA.Id));
        Assert.NotNull(await repo.GetDefinitionAsync(tenantA, activeA.Id));
    }

    [SkippableFact]
    public async Task Filtered_unique_key_allows_reuse_after_soft_delete()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var deleted = NewDefinition(tenantId, entityId, "reuse");
        deleted.SoftDelete(null);
        await repo.AddDefinitionAsync(deleted);

        // L'index unique filtré ([IsDeleted] = 0) ignore la ligne supprimée : la clé est réutilisable.
        var active = NewDefinition(tenantId, entityId, "reuse");
        await repo.AddDefinitionAsync(active);

        var duplicate = NewDefinition(tenantId, entityId, "reuse");
        await Assert.ThrowsAsync<DbUpdateException>(() => repo.AddDefinitionAsync(duplicate));
    }

    [SkippableFact]
    public async Task Update_with_stale_row_version_throws_concurrency_exception()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var definition = NewDefinition(tenantId, entityId, "concurrency");
        await repo.AddDefinitionAsync(definition);

        var loaded = await repo.GetDefinitionAsync(tenantId, definition.Id);
        Assert.NotNull(loaded);
        loaded!.Update("Nouveau nom", null, StudioWorkflowTriggerKind.OnCreate, "{}", "[]", null);

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(
            () => repo.UpdateDefinitionWithConcurrencyAsync(loaded, new byte[] { 0xDE, 0xAD, 0xBE, 0xEF }));
    }

    [SkippableFact]
    public async Task List_active_by_trigger_returns_only_active_definitions_of_that_trigger()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var activeOnCreate = NewDefinition(tenantId, entityId, "on_create_active", isActive: true, StudioWorkflowTriggerKind.OnCreate);
        var inactiveOnCreate = NewDefinition(tenantId, entityId, "on_create_inactive", isActive: false, StudioWorkflowTriggerKind.OnCreate);
        var activeOnUpdate = NewDefinition(tenantId, entityId, "on_update_active", isActive: true, StudioWorkflowTriggerKind.OnUpdate);

        await repo.AddDefinitionAsync(activeOnCreate);
        await repo.AddDefinitionAsync(inactiveOnCreate);
        await repo.AddDefinitionAsync(activeOnUpdate);

        var list = await repo.ListActiveByTriggerAsync(tenantId, entityId, StudioWorkflowTriggerKind.OnCreate);

        Assert.Equal(new[] { activeOnCreate.Id }, list.Select(d => d.Id).ToArray());
    }

    [SkippableFact]
    public async Task Instances_for_record_are_ordered_newest_first_and_clamped()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var definition = NewDefinition(tenantId, entityId, "inst_clamp");
        await repo.AddDefinitionAsync(definition);

        var recordId = Guid.NewGuid();
        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            var instance = NewInstance(tenantId, definition, recordId);
            await repo.AddInstanceAsync(instance);
            ids.Add(instance.Id);
        }

        var two = await repo.ListInstancesForRecordAsync(tenantId, recordId, 2);
        Assert.Equal(2, two.Count);
        Assert.True(two[0].StartedAt >= two[1].StartedAt);

        // max = 0 est borné à 1 (Math.Clamp(max, 1, 200)).
        var clampedToOne = await repo.ListInstancesForRecordAsync(tenantId, recordId, 0);
        Assert.Single(clampedToOne);

        // max = 999 est borné à 200 : les 5 instances reviennent, plus récentes d'abord.
        var all = await repo.ListInstancesForRecordAsync(tenantId, recordId, 999);
        Assert.Equal(ids.ToHashSet(), all.Select(i => i.Id).ToHashSet());
        Assert.Equal(all.Select(i => i.StartedAt).OrderByDescending(t => t), all.Select(i => i.StartedAt));
    }

    // 4.7a1 / D-47-B01 — pagination des instances d'une définition (skip/take) + total dédié.
    [SkippableFact]
    public async Task Instances_for_definition_are_paginated_newest_first_and_counted()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var definition = NewDefinition(tenantId, entityId, "inst_paged");
        var other = NewDefinition(tenantId, entityId, "inst_paged_other");
        await repo.AddDefinitionAsync(definition);
        await repo.AddDefinitionAsync(other);

        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            var instance = NewInstance(tenantId, definition, Guid.NewGuid());
            await repo.AddInstanceAsync(instance);
            ids.Add(instance.Id);
        }
        await repo.AddInstanceAsync(NewInstance(tenantId, other, Guid.NewGuid())); // hors périmètre : autre définition

        Assert.Equal(5, await repo.CountInstancesForDefinitionAsync(tenantId, definition.Id));

        var page1 = await repo.ListInstancesForDefinitionAsync(tenantId, definition.Id, skip: 0, take: 3);
        var page2 = await repo.ListInstancesForDefinitionAsync(tenantId, definition.Id, skip: 3, take: 3);
        Assert.Equal(3, page1.Count);
        Assert.Equal(2, page2.Count);
        // L'union des pages = les 5 instances de la définition (celle de l'autre définition n'apparaît jamais).
        Assert.Equal(ids.ToHashSet(), page1.Concat(page2).Select(i => i.Id).ToHashSet());
        Assert.Equal(page1.Select(i => i.StartedAt).OrderByDescending(t => t), page1.Select(i => i.StartedAt));

        // take = 0 est borné à 1 (Math.Clamp(take, 1, 200)).
        Assert.Single(await repo.ListInstancesForDefinitionAsync(tenantId, definition.Id, skip: 0, take: 0));
    }

    [SkippableFact]
    public async Task Has_open_instance_in_chain_detects_running_waiting_and_origin_links()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var definition = NewDefinition(tenantId, entityId, "chain");
        await repo.AddDefinitionAsync(definition);
        var recordId = Guid.NewGuid();

        // En cours ⇒ chaîne ouverte.
        var first = NewInstance(tenantId, definition, recordId);
        await repo.AddInstanceAsync(first);
        Assert.True(await repo.HasOpenInstanceInChainAsync(tenantId, definition.Id, recordId, null));

        // En attente ⇒ toujours ouverte.
        first.Suspend(StudioWorkflowInstanceStatus.Waiting, null, "{}");
        await repo.UpdateInstanceAsync(first);
        Assert.True(await repo.HasOpenInstanceInChainAsync(tenantId, definition.Id, recordId, null));

        // Terminée ⇒ fermée.
        first.Complete("{}");
        await repo.UpdateInstanceAsync(first);
        Assert.False(await repo.HasOpenInstanceInChainAsync(tenantId, definition.Id, recordId, null));

        // Chaîne d'origine : un enfant en cours dont OriginInstanceId correspond.
        var child = NewInstance(tenantId, definition, recordId, depth: 1, originInstanceId: first.Id);
        await repo.AddInstanceAsync(child);
        Assert.True(await repo.HasOpenInstanceInChainAsync(tenantId, definition.Id, recordId, first.Id));
        // … ou dont l'Id lui-même correspond à l'origine demandée.
        Assert.True(await repo.HasOpenInstanceInChainAsync(tenantId, definition.Id, recordId, child.Id));
        // Origine inconnue ⇒ aucune instance ouverte dans cette chaîne.
        Assert.False(await repo.HasOpenInstanceInChainAsync(tenantId, definition.Id, recordId, Guid.NewGuid()));
    }

    [SkippableFact]
    public async Task Count_open_instances_for_definition_ignores_terminal_ones()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var definition = NewDefinition(tenantId, entityId, "count_open");
        await repo.AddDefinitionAsync(definition);

        var running = NewInstance(tenantId, definition, Guid.NewGuid());
        var waiting = NewInstance(tenantId, definition, Guid.NewGuid());
        waiting.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, DateTime.UtcNow.AddHours(1), "{}");
        var completed = NewInstance(tenantId, definition, Guid.NewGuid());
        completed.Complete("{}");

        await repo.AddInstanceAsync(running);
        await repo.AddInstanceAsync(waiting);
        await repo.AddInstanceAsync(completed);

        Assert.Equal(2, await repo.CountOpenInstancesForDefinitionAsync(tenantId, definition.Id));
    }

    [SkippableFact]
    public async Task Step_runs_are_listed_by_index_and_approvals_by_instance()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var definition = NewDefinition(tenantId, entityId, "runs");
        await repo.AddDefinitionAsync(definition);
        var instance = NewInstance(tenantId, definition, Guid.NewGuid());
        await repo.AddInstanceAsync(instance);
        var otherInstance = NewInstance(tenantId, definition, Guid.NewGuid());
        await repo.AddInstanceAsync(otherInstance);

        // Insertions volontairement désordonnées.
        var now = DateTime.UtcNow;
        await repo.AddStepRunAsync(StudioWorkflowStepRun.Record(
            tenantId, instance.Id, 2, "step_c", "notify", StudioWorkflowStepRunStatus.Succeeded,
            StudioWorkflowStepOutcome.Continue, null, null, null, now, now, null));
        await repo.AddStepRunAsync(StudioWorkflowStepRun.Record(
            tenantId, instance.Id, 0, "step_a", "condition", StudioWorkflowStepRunStatus.Succeeded,
            StudioWorkflowStepOutcome.Continue, null, null, null, now, now, null));
        await repo.AddStepRunAsync(StudioWorkflowStepRun.Record(
            tenantId, instance.Id, 1, "step_b", "update_field", StudioWorkflowStepRunStatus.Skipped,
            StudioWorkflowStepOutcome.Skip, null, null, null, now, now, null));

        var runs = await repo.ListStepRunsAsync(tenantId, instance.Id);
        Assert.Equal(new[] { 0, 1, 2 }, runs.Select(r => r.StepIndex).ToArray());

        var pending1 = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_a", null, "Administrators", "Approbation 1", null, null);
        var pending2 = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_c", null, "Administrators", "Approbation 2", null, null);
        var decided = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_b", null, "Administrators", "Approbation 3", null, null);
        decided.Decide(StudioWorkflowApprovalStatus.Approved, Guid.NewGuid(), null, DateTime.UtcNow);
        var otherInstancePending = StudioWorkflowApproval.Create(tenantId, otherInstance.Id, "step_a", null, "Administrators", "Approbation 4", null, null);

        await repo.AddApprovalAsync(pending1);
        await repo.AddApprovalAsync(pending2);
        await repo.AddApprovalAsync(decided);
        await repo.AddApprovalAsync(otherInstancePending);

        var pendingApprovals = await repo.ListPendingApprovalsForInstanceAsync(tenantId, instance.Id);
        Assert.Equal(
            new HashSet<Guid> { pending1.Id, pending2.Id },
            pendingApprovals.Select(a => a.Id).ToHashSet());
    }

    [SkippableFact]
    public async Task ListApprovalsForInstanceAsync_returns_every_status_ordered_by_creation()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var definition = NewDefinition(tenantId, entityId, "all_approvals");
        await repo.AddDefinitionAsync(definition);
        var instance = NewInstance(tenantId, definition, Guid.NewGuid());
        await repo.AddInstanceAsync(instance);

        var otherDefinition = NewDefinition(otherTenantId, entityId, "all_approvals");
        await repo.AddDefinitionAsync(otherDefinition);
        var otherTenantInstance = NewInstance(otherTenantId, otherDefinition, Guid.NewGuid());
        await repo.AddInstanceAsync(otherTenantInstance);

        var now = DateTime.UtcNow;
        var pending = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_c", null, "Administrators", "Approbation en attente", null, null);
        SetCreatedAt(pending, now.AddMinutes(-1));
        var approved = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_a", null, "Administrators", "Approbation approuvée", null, null);
        SetCreatedAt(approved, now.AddMinutes(-3));
        approved.Decide(StudioWorkflowApprovalStatus.Approved, Guid.NewGuid(), null, now);
        var cancelled = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_b", null, "Administrators", "Approbation annulée", null, null);
        SetCreatedAt(cancelled, now.AddMinutes(-2));
        cancelled.Cancel(now);
        // Même instance Id impossible pour un autre tenant : on vérifie le filtre tenant sur une instance étrangère.
        var foreign = StudioWorkflowApproval.Create(otherTenantId, otherTenantInstance.Id, "step_a", null, "Administrators", "Étrangère", null, null);

        // Insertions volontairement désordonnées.
        await repo.AddApprovalAsync(pending);
        await repo.AddApprovalAsync(cancelled);
        await repo.AddApprovalAsync(approved);
        await repo.AddApprovalAsync(foreign);

        var all = await repo.ListApprovalsForInstanceAsync(tenantId, instance.Id);

        Assert.Equal(new[] { approved.Id, cancelled.Id, pending.Id }, all.Select(a => a.Id).ToArray());
        Assert.Equal(
            new[] { StudioWorkflowApprovalStatus.Approved, StudioWorkflowApprovalStatus.Cancelled, StudioWorkflowApprovalStatus.Pending },
            all.Select(a => a.Status).ToArray());

        var onlyPending = await repo.ListPendingApprovalsForInstanceAsync(tenantId, instance.Id);
        Assert.Equal(new[] { pending.Id }, onlyPending.Select(a => a.Id).ToArray());

        Assert.Empty(await repo.ListApprovalsForInstanceAsync(otherTenantId, instance.Id));
        Assert.Empty(await repo.ListApprovalsForInstanceAsync(tenantId, otherTenantInstance.Id));
    }

    // ---- Runtime (4.2c1) ----

    [SkippableFact]
    public async Task ListDueAsync_returns_waiting_due_instances_and_skips_waiting_approval_with_pending_approval()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();
        var definition = NewDefinition(tenantId, entityId, "due");
        await repo.AddDefinitionAsync(definition);

        var now = DateTime.UtcNow;

        // Waiting échue ⇒ à reprendre.
        var waitingDue = NewInstance(tenantId, definition, Guid.NewGuid());
        waitingDue.Suspend(StudioWorkflowInstanceStatus.Waiting, now.AddMinutes(-10), "{}");
        await repo.AddInstanceAsync(waitingDue);

        // WaitingApproval échue mais approbation encore en attente ⇒ PAS de reprise (D-04).
        var approvalPending = NewInstance(tenantId, definition, Guid.NewGuid());
        approvalPending.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, now.AddMinutes(-8), "{}");
        await repo.AddInstanceAsync(approvalPending);
        await repo.AddApprovalAsync(StudioWorkflowApproval.Create(
            tenantId, approvalPending.Id, "step_a", null, "Administrators", "À décider", null, now.AddHours(1)));

        // WaitingApproval échue dont l'approbation est déjà décidée ⇒ à reprendre.
        var approvalDecided = NewInstance(tenantId, definition, Guid.NewGuid());
        approvalDecided.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, now.AddMinutes(-6), "{}");
        await repo.AddInstanceAsync(approvalDecided);
        var decided = StudioWorkflowApproval.Create(
            tenantId, approvalDecided.Id, "step_a", null, "Administrators", "Décidée", null, null);
        decided.Decide(StudioWorkflowApprovalStatus.Approved, Guid.NewGuid(), null, now);
        await repo.AddApprovalAsync(decided);

        var due = await repo.ListDueAsync(tenantId, now, 50);

        // Tri DueAt croissant ; l'instance encore en attente d'une décision est exclue.
        Assert.Equal(new[] { waitingDue.Id, approvalDecided.Id }, due.Select(i => i.Id).ToArray());
    }

    [SkippableFact]
    public async Task ListDueAsync_ignores_other_tenants_and_future_due_dates()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();
        var definition = NewDefinition(tenantId, entityId, "due_scope");
        await repo.AddDefinitionAsync(definition);
        var otherDefinition = NewDefinition(otherTenantId, entityId, "due_scope");
        await repo.AddDefinitionAsync(otherDefinition);

        var now = DateTime.UtcNow;

        var future = NewInstance(tenantId, definition, Guid.NewGuid());
        future.Suspend(StudioWorkflowInstanceStatus.Waiting, now.AddHours(2), "{}");
        await repo.AddInstanceAsync(future);

        var noDueDate = NewInstance(tenantId, definition, Guid.NewGuid());
        noDueDate.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, null, "{}");
        await repo.AddInstanceAsync(noDueDate);

        var foreign = NewInstance(otherTenantId, otherDefinition, Guid.NewGuid());
        foreign.Suspend(StudioWorkflowInstanceStatus.Waiting, now.AddMinutes(-5), "{}");
        await repo.AddInstanceAsync(foreign);

        Assert.Empty(await repo.ListDueAsync(tenantId, now, 50));
    }

    [SkippableFact]
    public async Task ListStaleLeasesAsync_returns_only_open_instances_leased_before_threshold()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();
        var definition = NewDefinition(tenantId, entityId, "stale");
        await repo.AddDefinitionAsync(definition);

        var now = DateTime.UtcNow;
        var lease = TimeSpan.FromMinutes(30);

        // Bail ancien sur instance ouverte ⇒ à récupérer.
        var stale = NewInstance(tenantId, definition, Guid.NewGuid());
        Assert.True(stale.TryLease(now.AddHours(-2), lease));
        await repo.AddInstanceAsync(stale);

        // Bail encore frais ⇒ pas de récupération.
        var fresh = NewInstance(tenantId, definition, Guid.NewGuid());
        Assert.True(fresh.TryLease(now, lease));
        await repo.AddInstanceAsync(fresh);

        // Bail ancien mais instance terminée (Complete ne relâche pas le bail) ⇒ hors périmètre.
        var terminal = NewInstance(tenantId, definition, Guid.NewGuid());
        Assert.True(terminal.TryLease(now.AddHours(-3), lease));
        terminal.Complete("{}");
        await repo.AddInstanceAsync(terminal);

        // Jamais de bail ⇒ rien à récupérer.
        var unleased = NewInstance(tenantId, definition, Guid.NewGuid());
        await repo.AddInstanceAsync(unleased);

        var staleList = await repo.ListStaleLeasesAsync(tenantId, now.AddMinutes(-31), 50);

        Assert.Equal(new[] { stale.Id }, staleList.Select(i => i.Id).ToArray());
    }

    [SkippableFact]
    public async Task ListExpiredApprovalsAsync_returns_pending_past_due_only()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();
        var definition = NewDefinition(tenantId, entityId, "expired");
        await repo.AddDefinitionAsync(definition);
        var otherDefinition = NewDefinition(otherTenantId, entityId, "expired");
        await repo.AddDefinitionAsync(otherDefinition);
        var instance = NewInstance(tenantId, definition, Guid.NewGuid());
        await repo.AddInstanceAsync(instance);
        var otherInstance = NewInstance(otherTenantId, otherDefinition, Guid.NewGuid());
        await repo.AddInstanceAsync(otherInstance);

        var now = DateTime.UtcNow;

        var expired = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_a", null, "Administrators", "Échue", null, now.AddHours(-1));
        var future = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_b", null, "Administrators", "Pas encore échue", null, now.AddHours(2));
        var noDueDate = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_c", null, "Administrators", "Sans échéance", null, null);
        var decided = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_d", null, "Administrators", "Déjà décidée", null, now.AddHours(-3));
        decided.Decide(StudioWorkflowApprovalStatus.Rejected, Guid.NewGuid(), null, now);
        var foreign = StudioWorkflowApproval.Create(otherTenantId, otherInstance.Id, "step_a", null, "Administrators", "Étrangère échue", null, now.AddHours(-2));
        await repo.AddApprovalAsync(expired);
        await repo.AddApprovalAsync(future);
        await repo.AddApprovalAsync(noDueDate);
        await repo.AddApprovalAsync(decided);
        await repo.AddApprovalAsync(foreign);

        var expiredList = await repo.ListExpiredApprovalsAsync(tenantId, now, 50);

        Assert.Equal(new[] { expired.Id }, expiredList.Select(a => a.Id).ToArray());
    }

    [SkippableFact]
    public async Task ListPendingApprovalsForUserAsync_and_count_match_by_user_or_role_and_ignore_decided()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();
        var definition = NewDefinition(tenantId, entityId, "for_user");
        await repo.AddDefinitionAsync(definition);
        var otherDefinition = NewDefinition(otherTenantId, entityId, "for_user");
        await repo.AddDefinitionAsync(otherDefinition);
        var instance = NewInstance(tenantId, definition, Guid.NewGuid());
        await repo.AddInstanceAsync(instance);
        var otherInstance = NewInstance(otherTenantId, otherDefinition, Guid.NewGuid());
        await repo.AddInstanceAsync(otherInstance);

        var now = DateTime.UtcNow;
        var userId = Guid.NewGuid();

        var direct = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_a", userId, null, "Directe", null, now.AddHours(4));
        var byRole = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_b", null, "Administrators", "Par rôle", null, now.AddHours(1));
        var other = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_c", Guid.NewGuid(), "Auditors", "Pour un autre", null, now.AddHours(2));
        var decided = StudioWorkflowApproval.Create(tenantId, instance.Id, "step_d", userId, null, "Décidée", null, null);
        decided.Decide(StudioWorkflowApprovalStatus.Approved, Guid.NewGuid(), null, now);
        var foreign = StudioWorkflowApproval.Create(otherTenantId, otherInstance.Id, "step_a", userId, null, "Étrangère", null, null);
        await repo.AddApprovalAsync(direct);
        await repo.AddApprovalAsync(byRole);
        await repo.AddApprovalAsync(other);
        await repo.AddApprovalAsync(decided);
        await repo.AddApprovalAsync(foreign);

        var list = await repo.ListPendingApprovalsForUserAsync(tenantId, userId, "Administrators", 50);
        // Tri DueAt croissant : byRole (+1 h) avant direct (+4 h).
        Assert.Equal(new[] { byRole.Id, direct.Id }, list.Select(a => a.Id).ToArray());
        Assert.Equal(2, await repo.CountPendingApprovalsForUserAsync(tenantId, userId, "Administrators"));

        // Sans rôle : seules les assignations directes.
        var directOnly = await repo.ListPendingApprovalsForUserAsync(tenantId, userId, null, 50);
        Assert.Equal(new[] { direct.Id }, directOnly.Select(a => a.Id).ToArray());
        Assert.Equal(1, await repo.CountPendingApprovalsForUserAsync(tenantId, userId, null));
    }

    [SkippableFact]
    public async Task PurgeTerminalOlderThanAsync_deletes_instances_with_step_runs_and_approvals_and_keeps_open_and_recent()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();
        var definition = NewDefinition(tenantId, entityId, "purge");
        await repo.AddDefinitionAsync(definition);
        var otherDefinition = NewDefinition(otherTenantId, entityId, "purge");
        await repo.AddDefinitionAsync(otherDefinition);

        var now = DateTime.UtcNow;
        var threshold = now.AddDays(-30);

        async Task<StudioWorkflowInstance> AddTerminalAsync(StudioWorkflowInstance instance)
        {
            await repo.AddInstanceAsync(instance);
            // Complete/Fail/Cancel datent à UtcNow : on vieillit au-delà du seuil.
            SetProperty(instance, nameof(StudioWorkflowInstance.CompletedAt), now.AddDays(-40));
            await repo.UpdateInstanceAsync(instance);
            return instance;
        }

        var completed = NewInstance(tenantId, definition, Guid.NewGuid());
        completed.Complete("{}");
        await AddTerminalAsync(completed);
        var failed = NewInstance(tenantId, definition, Guid.NewGuid());
        failed.Fail("boom");
        await AddTerminalAsync(failed);
        var cancelled = NewInstance(tenantId, definition, Guid.NewGuid());
        cancelled.Cancel("plus utile");
        await AddTerminalAsync(cancelled);

        // Enfants d'une instance purgée : ils doivent partir avec elle (pas de FK).
        await repo.AddStepRunAsync(StudioWorkflowStepRun.Record(
            tenantId, completed.Id, 0, "step_a", "notify", StudioWorkflowStepRunStatus.Succeeded,
            StudioWorkflowStepOutcome.Continue, null, null, null, now.AddDays(-40), now.AddDays(-40), null));
        await repo.AddApprovalAsync(StudioWorkflowApproval.Create(
            tenantId, completed.Id, "step_b", null, "Administrators", "Historique", null, null));

        // Récente (au-dessus du seuil) et encore ouverte : conservées.
        var recent = NewInstance(tenantId, definition, Guid.NewGuid());
        recent.Complete("{}");
        await repo.AddInstanceAsync(recent);
        var open = NewInstance(tenantId, definition, Guid.NewGuid());
        await repo.AddInstanceAsync(open);

        // Autre tenant, pourtant ancienne : conservée.
        var foreign = NewInstance(otherTenantId, otherDefinition, Guid.NewGuid());
        foreign.Complete("{}");
        await repo.AddInstanceAsync(foreign);
        SetProperty(foreign, nameof(StudioWorkflowInstance.CompletedAt), now.AddDays(-40));
        await repo.UpdateInstanceAsync(foreign);

        var purged = await repo.PurgeTerminalOlderThanAsync(tenantId, threshold, 500);

        Assert.Equal(3, purged);
        Assert.Null(await repo.GetInstanceAsync(tenantId, completed.Id));
        Assert.Null(await repo.GetInstanceAsync(tenantId, failed.Id));
        Assert.Null(await repo.GetInstanceAsync(tenantId, cancelled.Id));
        Assert.Empty(await repo.ListStepRunsAsync(tenantId, completed.Id));
        Assert.Empty(await repo.ListApprovalsForInstanceAsync(tenantId, completed.Id));
        Assert.NotNull(await repo.GetInstanceAsync(tenantId, recent.Id));
        Assert.NotNull(await repo.GetInstanceAsync(tenantId, open.Id));
        Assert.NotNull(await repo.GetInstanceAsync(otherTenantId, foreign.Id));
    }

    [SkippableFact]
    public async Task TryLeaseInstanceAsync_second_lease_on_stale_row_version_returns_false()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();
        var definition = NewDefinition(tenantId, entityId, "lease");
        await repo.AddDefinitionAsync(definition);
        var instance = NewInstance(tenantId, definition, Guid.NewGuid());
        await repo.AddInstanceAsync(instance);

        var now = DateTime.UtcNow;
        var lease = TimeSpan.FromMinutes(30);

        // Deux lectures du même enregistrement (deux workers concurrents).
        var first = await repo.GetInstanceAsync(tenantId, instance.Id);
        var second = await repo.GetInstanceAsync(tenantId, instance.Id);
        Assert.NotNull(first);
        Assert.NotNull(second);

        // Premier arrivé : bail posé.
        Assert.True(await repo.TryLeaseInstanceAsync(first!, now, lease));

        // Second : son RowVersion est périmé ⇒ course perdue, false sans exception.
        Assert.False(await repo.TryLeaseInstanceAsync(second!, now, lease));

        // Relecture : le bail du premier est bien en base et encore frais ⇒ refus en mémoire.
        var reloaded = await repo.GetInstanceAsync(tenantId, instance.Id);
        Assert.NotNull(reloaded!.LeasedAt);
        Assert.False(await repo.TryLeaseInstanceAsync(reloaded, now.AddMinutes(5), lease));
    }

    // ---- Catalogue tenant (4.5c1) ----

    [SkippableFact]
    public async Task ListByTenantAsync_joins_active_non_junction_tables_filters_by_search_and_orders_by_table_then_name()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var clients = NewEntity(tenantA, "clients", "Clients");
        var fournisseurs = NewEntity(tenantA, "fournisseurs", "Fournisseurs");
        var archives = NewEntity(tenantA, "archives", "Archives");
        archives.Update("Archives", "Archives", null, null, isActive: false, null);
        var corbeille = NewEntity(tenantA, "corbeille", "Corbeille");
        corbeille.SoftDelete(null);
        var jonction = NewEntity(tenantA, "clients_tags", "Clients ↔ Tags", CustomEntityKind.Junction);
        var clientsB = NewEntity(tenantB, "clients", "Clients");
        await SeedEntitiesAsync(clients, fournisseurs, archives, corbeille, jonction, clientsB);

        // Tenant A : 2 définitions actives + 1 inactive (listée) + 1 supprimée (masquée) sur « Clients », 1 sur « Fournisseurs ».
        var relance = StudioWorkflowDefinition.Create(tenantA, clients.Id, "relance", "Relance", null, StudioWorkflowTriggerKind.OnCreate, "{}", "[]", true, null);
        var accueil = StudioWorkflowDefinition.Create(tenantA, clients.Id, "accueil", "Accueil", null, StudioWorkflowTriggerKind.OnCreate, "{}", "[]", true, null);
        var zeta = StudioWorkflowDefinition.Create(tenantA, clients.Id, "zeta", "Zeta", null, StudioWorkflowTriggerKind.OnUpdate, "{}", "[]", false, null);
        var supprimee = NewDefinition(tenantA, clients.Id, "supprimee");
        supprimee.SoftDelete(null);
        var validation = StudioWorkflowDefinition.Create(tenantA, fournisseurs.Id, "validation", "Validation", null, StudioWorkflowTriggerKind.OnCreate, "{}", "[]", true, null);
        // Exclues par la jointure : table inactive, table supprimée, table de jonction, table inconnue, autre tenant.
        var surArchives = NewDefinition(tenantA, archives.Id, "sur_archives");
        var surCorbeille = NewDefinition(tenantA, corbeille.Id, "sur_corbeille");
        var surJonction = NewDefinition(tenantA, jonction.Id, "sur_jonction");
        var orpheline = NewDefinition(tenantA, Guid.NewGuid(), "orpheline");
        var relanceB = StudioWorkflowDefinition.Create(tenantB, clientsB.Id, "relance", "Relance", null, StudioWorkflowTriggerKind.OnCreate, "{}", "[]", true, null);
        foreach (var d in new[] { relance, accueil, zeta, supprimee, validation, surArchives, surCorbeille, surJonction, orpheline, relanceB })
            await repo.AddDefinitionAsync(d);

        var page = await repo.ListByTenantAsync(tenantA, null, 0, 50);
        Assert.Equal(
            new[] { ("Clients", "Accueil"), ("Clients", "Relance"), ("Clients", "Zeta"), ("Fournisseurs", "Validation") },
            page.Select(r => (r.EntityDisplayName, r.Definition.Name)).ToArray());
        Assert.All(page.Where(r => r.EntityDisplayName == "Clients"), r => Assert.Equal("clients", r.EntityKey));
        Assert.Equal(4, await repo.CountByTenantAsync(tenantA, null));

        // Pagination stable sur le même tri.
        var second = await repo.ListByTenantAsync(tenantA, null, 1, 2);
        Assert.Equal(new[] { relance.Id, zeta.Id }, second.Select(r => r.Definition.Id).ToArray());

        // Recherche sur le nom ou la clé (espaces ignorés), même filtre pour le total.
        Assert.Equal(new[] { validation.Id }, (await repo.ListByTenantAsync(tenantA, "  Valid ", 0, 50)).Select(r => r.Definition.Id).ToArray());
        Assert.Equal(1, await repo.CountByTenantAsync(tenantA, "Valid"));
        Assert.Equal(new[] { accueil.Id }, (await repo.ListByTenantAsync(tenantA, "accu", 0, 50)).Select(r => r.Definition.Id).ToArray());
        Assert.Empty(await repo.ListByTenantAsync(tenantA, "introuvable", 0, 50));
        Assert.Equal(0, await repo.CountByTenantAsync(tenantA, "introuvable"));

        // Tenant B ne voit que sa propre définition.
        Assert.Equal(new[] { relanceB.Id }, (await repo.ListByTenantAsync(tenantB, null, 0, 50)).Select(r => r.Definition.Id).ToArray());
    }

    [SkippableFact]
    public async Task CountOpenInstancesForDefinitionsAsync_groups_open_instances_per_definition_and_omits_zero_and_other_tenants()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var repo = _sql.NewRepository();

        var first = NewDefinition(tenantId, entityId, "first");
        var second = NewDefinition(tenantId, entityId, "second");
        var third = NewDefinition(tenantId, entityId, "third");
        var foreign = NewDefinition(otherTenantId, entityId, "first");
        foreach (var d in new[] { first, second, third, foreign })
            await repo.AddDefinitionAsync(d);

        var running = NewInstance(tenantId, first, Guid.NewGuid());
        var waiting = NewInstance(tenantId, first, Guid.NewGuid());
        waiting.Suspend(StudioWorkflowInstanceStatus.Waiting, DateTime.UtcNow.AddHours(1), "{}");
        var waitingApproval = NewInstance(tenantId, first, Guid.NewGuid());
        waitingApproval.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, DateTime.UtcNow.AddHours(1), "{}");
        var completed = NewInstance(tenantId, first, Guid.NewGuid());
        completed.Complete("{}");
        var failed = NewInstance(tenantId, first, Guid.NewGuid());
        failed.Fail("boom");
        var secondRunning = NewInstance(tenantId, second, Guid.NewGuid());
        var secondCancelled = NewInstance(tenantId, second, Guid.NewGuid());
        secondCancelled.Cancel(null);
        var foreignRunning = NewInstance(otherTenantId, foreign, Guid.NewGuid());
        foreach (var i in new[] { running, waiting, waitingApproval, completed, failed, secondRunning, secondCancelled, foreignRunning })
            await repo.AddInstanceAsync(i);

        var counts = await repo.CountOpenInstancesForDefinitionsAsync(
            tenantId, new[] { first.Id, first.Id, second.Id, third.Id, foreign.Id });

        Assert.Equal(new Dictionary<Guid, int> { [first.Id] = 3, [second.Id] = 1 }, counts);
        Assert.False(counts.ContainsKey(third.Id));
        Assert.False(counts.ContainsKey(foreign.Id));

        Assert.Empty(await repo.CountOpenInstancesForDefinitionsAsync(tenantId, Array.Empty<Guid>()));
    }

    private static CustomEntityDefinition NewEntity(Guid tenantId, string key, string displayName, CustomEntityKind kind = CustomEntityKind.Standard)
        => CustomEntityDefinition.Create(tenantId, key, displayName, displayName, null, null, null, null, kind);

    /// <summary>Semis direct (le dépôt des tables n'est pas sous test) : contexte court sur la même base.</summary>
    private async Task SeedEntitiesAsync(params CustomEntityDefinition[] entities)
    {
        await using var context = new TenantDbContext(_sql.Options);
        context.CustomEntityDefinitions.AddRange(entities);
        await context.SaveChangesAsync();
    }

    private static void SetCreatedAt(StudioWorkflowApproval approval, DateTime createdAt)
        => typeof(StudioWorkflowApproval).GetProperty(nameof(StudioWorkflowApproval.CreatedAt))!.SetValue(approval, createdAt);

    private static void SetProperty<TEntity>(TEntity entity, string propertyName, object? value)
        => typeof(TEntity).GetProperty(propertyName)!.SetValue(entity, value);

    private static StudioWorkflowDefinition NewDefinition(
        Guid tenantId, Guid entityId, string key, bool isActive = true,
        StudioWorkflowTriggerKind trigger = StudioWorkflowTriggerKind.OnCreate)
        => StudioWorkflowDefinition.Create(tenantId, entityId, key, $"Workflow {key}", null, trigger, "{}", "[]", isActive, null);

    private static StudioWorkflowInstance NewInstance(
        Guid tenantId, StudioWorkflowDefinition definition, Guid recordId, int depth = 0, Guid? originInstanceId = null)
        => StudioWorkflowInstance.Start(
            tenantId, definition, recordId, StudioWorkflowTriggerKind.OnCreate, null, "{}", depth, originInstanceId);

    // ---- fixture ----

    /// <summary>Une base SQL dédiée à la classe (tables issues du modèle EF, tranche 4.1b1).</summary>
    public sealed class SqlFixture : IDisposable
    {
        private readonly SqlTestDatabase _db = new(nameof(StudioWorkflowRepositoryTests));

        public SqlFixture()
        {
            if (!_db.CanRun)
                return;

            Options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseSqlServer(_db.ConnectionString!)
                .Options;
            Factory = new SingleConnectionTenantDbContextFactory(Options);
        }

        public bool CanRun => _db.CanRun;
        public DbContextOptions<TenantDbContext> Options { get; } = null!;
        public ITenantDbContextFactory Factory { get; } = null!;

        public StudioWorkflowRepository NewRepository() => new(Factory);

        public void Dispose() => _db.Dispose();

        private sealed class SingleConnectionTenantDbContextFactory : ITenantDbContextFactory
        {
            private readonly DbContextOptions<TenantDbContext> _options;
            public SingleConnectionTenantDbContextFactory(DbContextOptions<TenantDbContext> options) => _options = options;
            public TenantDbContext CreateContext() => new(_options);
        }
    }
}
