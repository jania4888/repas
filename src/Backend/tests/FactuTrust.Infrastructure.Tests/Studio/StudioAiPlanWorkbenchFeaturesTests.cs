using System.Text.Json;
using System.Text.Json.Nodes;
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
/// « Workbench » du plan Studio IA (B-P0-03/B-P0-04) : lecture de la spec canonique, réécriture
/// serveur (re-parse + résumé recalculé, concurrence RowVersion, audit), liste paginée des plans
/// de l'utilisateur et purge des plans en attente. Style et helpers repris de
/// <see cref="StudioAiPlanFeaturesTests"/> (mocks Moq, <c>PendingPlan()</c>, <c>SetupGet(plan)</c>).
/// </summary>
public sealed class StudioAiPlanWorkbenchFeaturesTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<IStudioAiBuildPlanRepository> _plans = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ICurrentUser> _currentUser = new();

    private const string LegacySpec = """
    {
      "system": { "displayName": "Gestion des congés" },
      "entities": [
        { "ref": "employes", "displayName": "Employés", "fields": [ { "label": "Nom", "type": "text" } ] }
      ]
    }
    """;

    private const string UpdatedSpec = """
    {
      "system": { "displayName": "Gestion des absences" },
      "entities": [
        { "ref": "employes", "displayName": "Employés", "fields": [
          { "key": "nom", "label": "Nom", "type": "text", "required": true } ] },
        { "ref": "absences", "displayName": "Absences", "fields": [
          { "key": "employe", "label": "Employé", "type": "relation", "relationTo": "employes" },
          { "key": "motif", "label": "Motif", "type": "select", "options": [ { "value": "maladie", "label": "Maladie" } ] } ] }
      ]
    }
    """;

    public StudioAiPlanWorkbenchFeaturesTests()
    {
        _currentUser.Setup(x => x.TenantId).Returns(TenantId);
        _currentUser.Setup(x => x.UserId).Returns(UserId);
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
        _plans.Setup(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()))
            .ReturnsAsync(true);
    }

    // ---- GetSpec ----

    [Fact]
    public async Task GetSpec_returns_the_canonical_spec_of_an_owned_pending_plan()
    {
        var plan = PendingPlan(); // spec brute, clés non explicites
        SetupGet(plan);

        var result = await GetSpecHandler().Handle(new GetStudioAiPlanSpecQuery(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(StudioAiPlanKind.CreateSystem.ToString(), result.Value.Kind);
        Assert.Equal(StudioAiPlanStatus.Pending.ToString(), result.Value.Status);
        // Forme canonique : clé de champ explicite émise pour chaque champ.
        var canonical = StudioAiSpecCanonical.CanonicalFor(plan.Kind, plan.SpecJson, out _);
        Assert.NotNull(canonical);
        Assert.Contains("\"key\": \"nom\"", canonical, StringComparison.Ordinal);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(canonical), result.Value.Spec));
    }

    [Fact]
    public async Task GetSpec_of_another_users_plan_is_not_found()
    {
        var plan = StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.CreateSystem, LegacySpec, "{}",
            Guid.NewGuid(), StudioAiPlanDefaults.Lifetime); // autre créateur
        SetupGet(plan);

        var result = await GetSpecHandler().Handle(new GetStudioAiPlanSpecQuery(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("NotFound", result.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    // ---- UpdateSpec ----

    [Fact]
    public async Task UpdateSpec_reparses_recomputes_summary_and_audits()
    {
        var plan = PendingPlan();
        SetupGet(plan);

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, UpdatedSpec, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Spec persistée = forme canonique de la NOUVELLE spec (re-parsée côté serveur).
        Assert.Equal(StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, UpdatedSpec, out _), plan.SpecJson);
        // Résumé recalculé côté serveur : nouveau titre et deux tables.
        Assert.Contains("Gestion des absences", plan.SummaryJson, StringComparison.Ordinal);
        Assert.Equal(plan.SummaryJson, result.Value.Plan.SummaryJson);
        // Audit d'édition écrit (empreintes, pas le contenu complet).
        _audit.Verify(a => a.LogAsync("Studio.AiPlan.Updated", "StudioAiBuildPlan", plan.Id,
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
        _plans.Verify(p => p.TryUpdateAsync(plan, It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Once);
    }

    [Fact]
    public async Task UpdateSpec_ignores_client_supplied_summary_json()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        // La commande ne transporte aucun SummaryJson : même une clé parasite dans la spec est éliminée.
        const string specWithStraySummary = """
        { "system": { "displayName": "Congés propres" }, "summaryJson": "{\"title\":\"FAUX\"}",
          "entities": [ { "ref": "a", "displayName": "A", "fields": [ { "label": "Nom" } ] } ] }
        """;

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, specWithStraySummary, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Le résumé est recalculé côté serveur (sérialisé en JSON échappé : on compare la valeur parsée).
        var title = JsonNode.Parse(plan.SummaryJson)?["title"]?.GetValue<string>();
        Assert.Equal("Congés propres", title);
        Assert.DoesNotContain("FAUX", plan.SummaryJson, StringComparison.Ordinal);
        Assert.DoesNotContain("summaryJson", plan.SpecJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UpdateSpec_rejects_spec_over_size_limit()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        var tooBig = "{\"system\":\"" + new string('a', StudioAiPlanWorkbench.MaxSpecJsonLength) + "\"}";

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, tooBig, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.specJson", result.Error.Code);
        Assert.Contains("256 Ko", result.Error.Description, StringComparison.Ordinal);
        _plans.Verify(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Never);
    }

    [Fact]
    public async Task UpdateSpec_rejects_invalid_spec()
    {
        var plan = PendingPlan();
        SetupGet(plan);

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, "{ pas du json", RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.specJson", result.Error.Code);
        _plans.Verify(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Never);
        _audit.Verify(a => a.LogAsync("Studio.AiPlan.Updated", It.IsAny<string>(), It.IsAny<Guid?>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateSpec_rejects_reserved_field_key()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        const string spec = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "a", "displayName": "A", "fields": [ { "key": "id", "label": "Identifiant" } ] } ] }
        """;

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, spec, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.specJson", result.Error.Code);
        Assert.Contains("réservée", result.Error.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UpdateSpec_rejects_more_than_eight_entities()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        var entities = string.Join(", ", Enumerable.Range(1, 9)
            .Select(i => $"{{ \"ref\": \"t{i}\", \"displayName\": \"T{i}\", \"fields\": [ {{ \"label\": \"Nom\" }} ] }}"));
        var spec = $"{{ \"system\": {{ \"displayName\": \"Trop\" }}, \"entities\": [ {entities} ] }}";

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, spec, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.specJson", result.Error.Code);
        Assert.Contains("8", result.Error.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UpdateSpec_of_executed_plan_is_conflict()
    {
        var plan = PendingPlan();
        plan.MarkExecuting();
        SetupGet(plan);

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, UpdatedSpec, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        _plans.Verify(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Never);
    }

    [Fact]
    public async Task UpdateSpec_of_expired_plan_is_conflict()
    {
        var plan = PendingPlan(lifetime: TimeSpan.FromMinutes(-1));
        SetupGet(plan);

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, UpdatedSpec, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Contains("expiré", result.Error.Description, StringComparison.Ordinal);
        _plans.Verify(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Never);
    }

    [Fact]
    public async Task UpdateSpec_with_stale_rowversion_is_conflict_and_writes_nothing()
    {
        var plan = PendingPlan();
        SetupGet(plan);
        // Le plan a été modifié depuis la lecture du client : la persistance refuse la mise à jour.
        _plans.Setup(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()))
            .ReturnsAsync(false);

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, UpdatedSpec, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Contains("Rechargez-le", result.Error.Description, StringComparison.Ordinal);
        _audit.Verify(a => a.LogAsync("Studio.AiPlan.Updated", It.IsAny<string>(), It.IsAny<Guid?>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateSpec_does_not_extend_expiry()
    {
        var plan = PendingPlan(lifetime: TimeSpan.FromMinutes(30));
        SetupGet(plan);
        var expiresAt = plan.ExpiresAt;

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, UpdatedSpec, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(expiresAt, plan.ExpiresAt); // ni le statut ni l'échéance ne bougent
        Assert.Equal(StudioAiPlanStatus.Pending, plan.Status);
    }

    [Fact]
    public async Task UpdateSpec_of_non_creation_kind_is_validation()
    {
        // L'aperçu d'une modification/fenêtre/état se résout contre le schéma réel : pas éditable en P0.
        var plan = StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.Amendment,
            "{ \"target\": { \"entityKey\": \"a\" }, \"operations\": [ { \"op\": \"update_entity\", \"displayName\": \"B\" } ] }",
            "{}", UserId, StudioAiPlanDefaults.Lifetime);
        SetupGet(plan);

        var result = await UpdateHandler().Handle(
            new UpdateStudioAiPlanSpecCommand(plan.Id, plan.SpecJson, RowVersionToken()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
    }

    // ---- List ----

    [Fact]
    public async Task List_filters_by_owner_tenant_status_kind_with_clamped_paging()
    {
        Guid? capturedTenant = null;
        string? capturedUser = null;
        StudioAiPlanStatus? capturedStatus = null;
        StudioAiPlanKind? capturedKind = null;
        var capturedPage = 0;
        var capturedPageSize = 0;
        _plans.Setup(p => p.ListByOwnerAsync(It.IsAny<Guid>(), It.IsAny<string>(),
                It.IsAny<StudioAiPlanStatus?>(), It.IsAny<StudioAiPlanKind?>(),
                It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .Callback((Guid t, string u, StudioAiPlanStatus? s, StudioAiPlanKind? k, int pg, int ps, CancellationToken _) =>
            { capturedTenant = t; capturedUser = u; capturedStatus = s; capturedKind = k; capturedPage = pg; capturedPageSize = ps; })
            .ReturnsAsync((Array.Empty<StudioAiBuildPlan>(), 0));

        // Noms d'enum insensibles à la casse ; page 0 et pageSize 500 bornés par le handler.
        var result = await ListHandler().Handle(
            new ListStudioAiPlansQuery("pending", "createsystem", Page: 0, PageSize: 500), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(TenantId, capturedTenant);
        Assert.Equal(UserId.ToString(), capturedUser);
        Assert.Equal(StudioAiPlanStatus.Pending, capturedStatus);
        Assert.Equal(StudioAiPlanKind.CreateSystem, capturedKind);
        Assert.Equal(1, capturedPage);
        Assert.Equal(StudioAiPlanWorkbench.MaxPageSize, capturedPageSize);
        Assert.Equal(50, result.Value.PageSize);
    }

    [Fact]
    public async Task List_clamps_page_size_to_fifty_and_defaults_to_twenty()
    {
        var captured = new List<int>();
        _plans.Setup(p => p.ListByOwnerAsync(It.IsAny<Guid>(), It.IsAny<string>(),
                It.IsAny<StudioAiPlanStatus?>(), It.IsAny<StudioAiPlanKind?>(),
                It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .Callback((Guid t, string u, StudioAiPlanStatus? s, StudioAiPlanKind? k, int pg, int ps, CancellationToken _) => captured.Add(ps))
            .ReturnsAsync((Array.Empty<StudioAiBuildPlan>(), 0));

        await ListHandler().Handle(new ListStudioAiPlansQuery(null, null, 1, 51), CancellationToken.None);
        await ListHandler().Handle(new ListStudioAiPlansQuery(null, null, 1, 0), CancellationToken.None);

        Assert.Equal(new[] { 50, 20 }, captured);
    }

    [Fact]
    public async Task List_with_invalid_status_filter_is_validation_error()
    {
        var result = await ListHandler().Handle(
            new ListStudioAiPlansQuery("EnCours", null, 1, 20), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.status", result.Error.Code);
        _plans.Verify(p => p.ListByOwnerAsync(It.IsAny<Guid>(), It.IsAny<string>(),
            It.IsAny<StudioAiPlanStatus?>(), It.IsAny<StudioAiPlanKind?>(),
            It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task List_with_invalid_kind_filter_is_validation_error()
    {
        var result = await ListHandler().Handle(
            new ListStudioAiPlansQuery(null, "Systeme", 1, 20), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
    }

    [Fact]
    public async Task List_orders_items_as_returned_and_maps_summary_fields()
    {
        var overdue = PendingPlan(lifetime: TimeSpan.FromMinutes(-5));
        var completed = PendingPlan();
        completed.MarkCompleted("{\"systemKey\":\"conges\"}");
        // Tri CreatedAt desc assuré par le dépôt : le handler préserve l'ordre reçu.
        _plans.Setup(p => p.ListByOwnerAsync(TenantId, UserId.ToString(), null, null, 1, 20, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new StudioAiBuildPlan[] { completed, overdue }, 2));

        var result = await ListHandler().Handle(new ListStudioAiPlansQuery(null, null, 1, 20), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.TotalCount);
        var first = result.Value.Items[0];
        Assert.Equal(completed.Id, first.Id);
        Assert.Equal(StudioAiPlanStatus.Completed.ToString(), first.Status);
        Assert.Equal("conges", first.SystemKey); // extrait de ResultJson
        // Plan Pending échu : présenté « Expired » sans écriture (état persistant intact).
        var second = result.Value.Items[1];
        Assert.Equal(StudioAiPlanStatus.Expired.ToString(), second.Status);
        Assert.Equal(StudioAiPlanStatus.Pending, overdue.Status);
        _plans.Verify(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Never);
    }

    [Fact]
    public async Task List_items_never_contain_spec_json()
    {
        var plan = StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.CreateSystem,
            "{ \"system\": { \"displayName\": \"MARQUEUR_SPEC_SECRET\" }, \"entities\": [] }",
            "{ \"title\": \"Congés\", \"entities\": [ {}, {} ] }", UserId, StudioAiPlanDefaults.Lifetime);
        _plans.Setup(p => p.ListByOwnerAsync(TenantId, UserId.ToString(), null, null, 1, 20, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new StudioAiBuildPlan[] { plan }, 1));

        var result = await ListHandler().Handle(new ListStudioAiPlansQuery(null, null, 1, 20), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var item = result.Value.Items[0];
        Assert.Equal("Congés", item.Title);
        Assert.Equal(2, item.EntityCount);
        var serialized = JsonSerializer.Serialize(result.Value.Items);
        Assert.DoesNotContain("MARQUEUR_SPEC_SECRET", serialized, StringComparison.Ordinal);
        Assert.DoesNotContain("specJson", serialized, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task List_maps_relation_and_view_counts_from_summary()
    {
        var plan = StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.CreateSystem, LegacySpec,
            "{ \"title\": \"Congés\", \"entities\": [ { \"viewCount\": 1 }, {} ], \"relations\": [ {}, {} ] }",
            UserId, StudioAiPlanDefaults.Lifetime);
        _plans.Setup(p => p.ListByOwnerAsync(TenantId, UserId.ToString(), null, null, 1, 20, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new StudioAiBuildPlan[] { plan }, 1));

        var result = await ListHandler().Handle(new ListStudioAiPlansQuery(null, null, 1, 20), CancellationToken.None);

        var item = Assert.Single(result.Value.Items);
        Assert.Equal(2, item.EntityCount);
        Assert.Equal(2, item.RelationCount);
        Assert.Equal(1, item.ViewCount); // somme des entities[].viewCount (le second est absent ⇒ 0)
    }

    [Fact]
    public async Task List_tolerates_missing_view_count_and_relations()
    {
        var plan = StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.CreateSystem, LegacySpec,
            "{ \"title\": \"Congés\", \"entities\": [ {} ] }", UserId, StudioAiPlanDefaults.Lifetime);
        _plans.Setup(p => p.ListByOwnerAsync(TenantId, UserId.ToString(), null, null, 1, 20, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new StudioAiBuildPlan[] { plan }, 1));

        var result = await ListHandler().Handle(new ListStudioAiPlansQuery(null, null, 1, 20), CancellationToken.None);

        var item = Assert.Single(result.Value.Items);
        Assert.Equal(0, item.RelationCount);
        Assert.Equal(0, item.ViewCount);
        Assert.False(item.Replayable); // Pending non expiré
    }

    [Fact]
    public async Task List_reads_open_url_from_result_json_or_system_url()
    {
        var withOpenUrl = PendingPlan();
        withOpenUrl.MarkCompleted("{\"openUrl\":\"/studio/d/tickets\"}");
        var withSystemUrl = PendingPlan();
        withSystemUrl.MarkCompleted("{\"systemUrl\":\"/studio/systems/conges\"}");
        var withSystemKeyOnly = PendingPlan();
        withSystemKeyOnly.MarkCompleted("{\"systemKey\":\"conges\"}");
        var withoutResult = PendingPlan();
        withoutResult.MarkCancelled();
        _plans.Setup(p => p.ListByOwnerAsync(TenantId, UserId.ToString(), null, null, 1, 20, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new StudioAiBuildPlan[] { withOpenUrl, withSystemUrl, withSystemKeyOnly, withoutResult }, 4));

        var result = await ListHandler().Handle(new ListStudioAiPlansQuery(null, null, 1, 20), CancellationToken.None);

        Assert.Equal("/studio/d/tickets", result.Value.Items[0].OpenUrl);
        Assert.Equal("/studio/systems/conges", result.Value.Items[1].OpenUrl);
        // CreateSystem n'émet que systemKey : repli déterministe côté lecture.
        Assert.Equal("/studio/systems/conges", result.Value.Items[2].OpenUrl);
        Assert.Null(result.Value.Items[3].OpenUrl);
    }

    [Fact]
    public async Task List_exposes_error_message_and_replayable_flag()
    {
        var failed = PendingPlan();
        failed.MarkFailed("Échec de création de la colonne.");
        var pending = PendingPlan();
        var overdue = PendingPlan(lifetime: TimeSpan.FromMinutes(-5));
        _plans.Setup(p => p.ListByOwnerAsync(TenantId, UserId.ToString(), null, null, 1, 20, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new StudioAiBuildPlan[] { failed, pending, overdue }, 3));

        var result = await ListHandler().Handle(new ListStudioAiPlansQuery(null, null, 1, 20), CancellationToken.None);

        Assert.Equal("Échec de création de la colonne.", result.Value.Items[0].ErrorMessage);
        Assert.True(result.Value.Items[0].Replayable); // Failed ⇒ rejouable
        Assert.False(result.Value.Items[1].Replayable); // Pending non expiré ⇒ non rejouable
        Assert.True(result.Value.Items[2].Replayable); // Pending échu (présenté Expired) ⇒ rejouable
    }

    // ---- CancelPending ----

    [Fact]
    public async Task CancelPending_cancels_only_own_pending_plans()
    {
        var first = PendingPlan();
        var second = PendingPlan();
        _plans.Setup(p => p.ListPendingByOwnerAsync(TenantId, UserId.ToString(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new StudioAiBuildPlan[] { first, second });

        var result = await CancelPendingHandler().Handle(new CancelPendingStudioAiPlansCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value);
        Assert.Equal(StudioAiPlanStatus.Cancelled, first.Status);
        Assert.Equal(StudioAiPlanStatus.Cancelled, second.Status);
        // Le dépôt est interrogé pour le couple (tenant, utilisateur) — filtre propriétaire + Pending non expiré.
        _plans.Verify(p => p.ListPendingByOwnerAsync(TenantId, UserId.ToString(), It.IsAny<CancellationToken>()), Times.Once);
        _audit.Verify(a => a.LogAsync("Studio.AiPlan.Cancelled", "StudioAiBuildPlan", It.IsAny<Guid?>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task CancelPending_skips_a_plan_that_loses_the_concurrency_race()
    {
        var cancelled = PendingPlan();
        var raced = PendingPlan();
        _plans.Setup(p => p.ListPendingByOwnerAsync(TenantId, UserId.ToString(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new StudioAiBuildPlan[] { cancelled, raced });
        _plans.Setup(p => p.TryUpdateAsync(raced, It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()))
            .ReturnsAsync(false);

        var result = await CancelPendingHandler().Handle(new CancelPendingStudioAiPlansCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value); // le perdant de la course n'est pas compté
    }

    [Fact]
    public async Task CancelPending_without_design_permission_is_unauthorized()
    {
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(false);

        var result = await CancelPendingHandler().Handle(new CancelPendingStudioAiPlansCommand(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
        _plans.Verify(p => p.ListPendingByOwnerAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- Helpers ----

    private static StudioAiBuildPlan PendingPlan(TimeSpan? lifetime = null) =>
        StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.CreateSystem, LegacySpec,
            "{ \"title\": \"Gestion des congés\", \"entities\": [ {} ] }", UserId,
            lifetime ?? StudioAiPlanDefaults.Lifetime);

    private static string RowVersionToken() => Convert.ToBase64String(new byte[] { 0, 0, 0, 0, 0, 0, 0, 42 });

    private void SetupGet(StudioAiBuildPlan plan) =>
        _plans.Setup(p => p.GetByIdAsync(TenantId, plan.Id, It.IsAny<CancellationToken>())).ReturnsAsync(plan);

    private GetStudioAiPlanSpecQueryHandler GetSpecHandler() => new(_plans.Object, _currentUser.Object);

    private UpdateStudioAiPlanSpecCommandHandler UpdateHandler() => new(_plans.Object, _audit.Object, _currentUser.Object);

    private ListStudioAiPlansQueryHandler ListHandler() => new(_plans.Object, _currentUser.Object);

    private CancelPendingStudioAiPlansCommandHandler CancelPendingHandler() => new(_plans.Object, _audit.Object, _currentUser.Object);
}
