using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Enums;
using Xunit;
using static FactuTrust.Application.Features.Studio.Ai.StudioAiWorkflowPlanner;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 4.3c — <see cref="StudioAiWorkflowPlanner"/> : contrôles légers à l'aperçu contre le schéma réel
/// (table introuvable/inactive, champ inconnu dans <c>update_field.set</c> / <c>condition.filters</c> /
/// <c>triggerConfig.field</c>, action ERP inconnue ou non pontable, lanceur approbateur), tolérance des
/// préfixes runtime et « créés inactifs » ajouté aux plans acceptés. Depuis 4.7b5 : un déclencheur
/// planifié sans cron valide (<c>triggerConfig.cron</c>, 5 champs UTC) bloque le plan.
/// </summary>
public sealed class StudioAiWorkflowPlannerTests
{
    private static readonly Func<string, AiToolDefinition?> RealActions = AiToolRegistry.GetToolDefinition;

    [Fact]
    public void Review_passes_and_adds_inactive_warning_when_entity_fields_and_action_are_known()
    {
        var spec = Parse("""
        { "workflows": [ { "entityKey": "factures", "name": "Validation", "trigger": "on_create", "steps": [
            { "key": "maj_statut", "type": "update_field", "set": { "statut": "validee" } },
            { "key": "creer_produit", "type": "erp_action", "action": "create_product",
              "mapping": { "code": "{{record.numero}}", "name": "Produit", "unit_price": 10, "vat_rate_percent": 19 } }
        ] } ] }
        """);
        var schemas = new Dictionary<string, CustomEntitySchemaDto> { ["factures"] = Schema("factures", "Facture") };

        var review = Review(spec, schemas, RealActions);

        Assert.False(review.IsBlocked);
        Assert.Empty(review.BlockingErrors);
        var warning = Assert.Single(review.Warnings);
        Assert.Equal(InactiveWarning, warning);
        Assert.Equal(InactiveWarning, review.Warnings[^1]);
    }

    [Fact]
    public void Review_blocks_unknown_entity_inactive_entity_and_unknown_field()
    {
        var spec = Parse("""
        { "workflows": [
            { "entityKey": "inconnue", "name": "Table absente", "trigger": "manual",
              "steps": [ { "key": "attente", "type": "wait", "hours": 1 } ] },
            { "entityKey": "archives", "name": "Table inactive", "trigger": "manual",
              "steps": [ { "key": "attente", "type": "wait", "hours": 1 } ] },
            { "entityKey": "factures", "name": "Champ inconnu", "trigger": "on_update",
              "steps": [ { "key": "maj", "type": "update_field", "set": { "champ_inconnu": 1 } } ] },
            { "entityKey": "factures", "name": "Déclencheur inconnu", "trigger": "field_changed",
              "triggerConfig": { "field": "inexistant", "to": "payee" },
              "steps": [ { "key": "attente", "type": "wait", "hours": 1 } ] }
        ] }
        """);
        var schemas = new Dictionary<string, CustomEntitySchemaDto>
        {
            ["factures"] = Schema("factures", "Facture"),
            ["archives"] = Schema("archives", "Archive", isActive: false)
        };

        var review = Review(spec, schemas, RealActions);

        Assert.True(review.IsBlocked);
        Assert.Equal(4, review.BlockingErrors.Count);
        Assert.Contains(review.BlockingErrors, e => e.Contains("« Table absente »") && e.Contains("table « inconnue » introuvable ou inactive"));
        Assert.Contains(review.BlockingErrors, e => e.Contains("« Table inactive »") && e.Contains("table « archives » introuvable ou inactive"));
        Assert.Contains(review.BlockingErrors, e => e.Contains("étape « maj »") && e.Contains("champ « champ_inconnu » inconnu dans « Facture »"));
        Assert.Contains(review.BlockingErrors, e => e.Contains("« Déclencheur inconnu »") && e.Contains("champ déclencheur « inexistant » n'existe pas dans « Facture »"));
        // Plan refusé : pas d'avertissement « créés inactifs ».
        Assert.DoesNotContain(InactiveWarning, review.Warnings);
    }

    [Fact]
    public void Review_blocks_unknown_or_non_bridgeable_action()
    {
        var spec = Parse("""
        { "workflows": [ { "entityKey": "factures", "name": "Actions", "trigger": "manual", "steps": [
            { "key": "interne", "type": "erp_action", "action": "studio_plan_app", "mapping": {} },
            { "key": "absente", "type": "erp_action", "action": "inexistante", "mapping": {} }
        ] } ] }
        """);
        var schemas = new Dictionary<string, CustomEntitySchemaDto> { ["factures"] = Schema("factures", "Facture") };

        // studio_plan_app est mutant mais interne (studio_*) ⇒ non pontable ; inexistante n'est pas résolue.
        Assert.NotNull(AiToolRegistry.GetToolDefinition("studio_plan_app"));
        Assert.Null(AiToolRegistry.GetToolDefinition("inexistante"));

        var review = Review(spec, schemas, RealActions);

        Assert.True(review.IsBlocked);
        Assert.Equal(2, review.BlockingErrors.Count);
        Assert.All(review.BlockingErrors, e => Assert.Contains("inconnue ou non autorisée", e));
        Assert.Contains(review.BlockingErrors, e => e.Contains("étape « interne »") && e.Contains("action ERP « studio_plan_app »"));
        Assert.Contains(review.BlockingErrors, e => e.Contains("étape « absente »") && e.Contains("action ERP « inexistante »"));
    }

    [Fact]
    public void Review_blocks_started_by_assignee_on_approval()
    {
        var spec = Parse("""
        { "workflows": [ { "entityKey": "factures", "name": "Approbations", "trigger": "on_create", "steps": [
            { "key": "auto_validation", "type": "approval", "assignee": { "kind": "startedBy" }, "title": "Se valider" },
            { "key": "validation_manager", "type": "approval", "assignee": { "kind": "role", "value": "Manager" }, "title": "À valider" }
        ] } ] }
        """);
        var schemas = new Dictionary<string, CustomEntitySchemaDto> { ["factures"] = Schema("factures", "Facture") };

        var review = Review(spec, schemas, RealActions);

        Assert.True(review.IsBlocked);
        var error = Assert.Single(review.BlockingErrors);
        Assert.Contains("étape « auto_validation »", error);
        Assert.Contains("le lanceur (« startedBy ») ne peut pas être l'approbateur", error);
        Assert.DoesNotContain(review.BlockingErrors, e => e.Contains("validation_manager"));
    }

    [Fact]
    public void Review_tolerates_runtime_prefixes_in_condition_filters()
    {
        var spec = Parse("""
        { "workflows": [
            { "entityKey": "factures", "name": "Relance hebdo", "trigger": "scheduled",
              "triggerConfig": { "cron": "0 6 * * *" },
              "steps": [ { "key": "attente", "type": "wait", "hours": 1 } ] },
            { "entityKey": "factures", "name": "Contrôle", "trigger": "manual", "steps": [
                { "key": "si", "type": "condition", "filters": [
                    { "field": "statut", "op": "eq", "value": "validee" },
                    { "field": "_previous.statut", "op": "eq", "value": "brouillon" },
                    { "field": "_approval.valid.status", "op": "eq", "value": "approved" },
                    { "field": "_results.fact.id", "op": "isNotEmpty" }
                ], "onFalse": "stop" },
                { "key": "attente", "type": "wait", "hours": 1 }
            ] }
        ] }
        """);
        Assert.Equal(2, spec.Workflows.Count);
        Assert.Empty(spec.Warnings);
        var schemas = new Dictionary<string, CustomEntitySchemaDto> { ["factures"] = Schema("factures", "Facture") };

        var review = Review(spec, schemas, RealActions);

        Assert.False(review.IsBlocked);
        Assert.Empty(review.BlockingErrors);
        // 4.7b5 : le parseur n'a plus d'avertissement propre ; reste « créés inactifs ».
        Assert.Equal([InactiveWarning], review.Warnings);
    }

    [Fact]
    public void Review_blocks_a_scheduled_workflow_without_a_valid_cron()
    {
        var spec = Parse("""
        { "workflows": [
            { "entityKey": "factures", "name": "Sans cron", "trigger": "scheduled",
              "steps": [ { "key": "attente", "type": "wait", "hours": 1 } ] },
            { "entityKey": "factures", "name": "Cron invalide", "trigger": "scheduled",
              "triggerConfig": { "cron": "61 * * * *" },
              "steps": [ { "key": "attente", "type": "wait", "hours": 1 } ] } ] }
        """);
        var schemas = new Dictionary<string, CustomEntitySchemaDto> { ["factures"] = Schema("factures", "Facture") };

        var review = Review(spec, schemas, RealActions);

        Assert.True(review.IsBlocked);
        Assert.Equal(2, review.BlockingErrors.Count);
        Assert.All(review.BlockingErrors, e => Assert.Contains("cron", e));
        Assert.Contains("« Sans cron »", review.BlockingErrors[0]);
        Assert.Contains("« Cron invalide »", review.BlockingErrors[1]);
    }

    // ---------------------------------------------------------------- helpers

    private static ParsedWorkflowPlanSpec Parse(string json)
    {
        Assert.True(StudioAiWorkflowSpec.TryParse(json, out var spec, out var error), error);
        return spec!;
    }

    /// <summary>Schéma minimal d'une table (numero, montant, statut) — motif de StudioAiPlanExecutorTests.SetupInterventionsSchema.</summary>
    private static CustomEntitySchemaDto Schema(string key, string displayName, bool isActive = true)
    {
        var now = DateTime.UtcNow;
        var fields = new List<CustomFieldDto>
        {
            new(Guid.NewGuid(), "numero", "Numéro", CustomFieldType.Text, false, false, 1, null, null, null, true),
            new(Guid.NewGuid(), "montant", "Montant", CustomFieldType.Number, false, false, 2, null, null, null, true),
            new(Guid.NewGuid(), "statut", "Statut", CustomFieldType.Select, false, false, 3, null,
                new List<SelectOptionDto> { new("brouillon", "Brouillon"), new("validee", "Validée"), new("payee", "Payée") }, null, true)
        };
        return new CustomEntitySchemaDto(
            new CustomEntityDto(Guid.NewGuid(), key, displayName, displayName + "s", null, null, isActive, fields.Count, null, now, now),
            fields, new FormLayout());
    }
}
