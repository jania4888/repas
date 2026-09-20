using System.Text.Json.Nodes;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Outils Studio « plan → aperçu → confirmation » : l'IA PRÉPARE un plan (persisté, en attente),
/// l'utilisateur le valide dans l'interface, et l'exécution passe par un endpoint REST déterministe
/// (<c>StudioAiPlansController</c>) — jamais par le LLM. Orchestration mince, aucune logique métier.
/// </summary>
public sealed partial class AiToolExecutor
{
    private async Task<AiToolResult> HandleStudioPlanApp(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!_ollamaSettings.EnableStudioAiPlanPreview)
            return AiToolResult.Error("Le flux d'aperçu Studio n'est pas activé.");

        var specJson = GetStringArg(args, "spec_json");
        if (!StudioAiAppSpec.TryParse(specJson, out var spec, out var parseError) || spec is null)
            return AiToolResult.Error(parseError ?? "Spécification d'application invalide.");

        var duplicates = await StudioAiPlanCreation.DetectDuplicatesAsync(
            StudioAiPlanKind.CreateApp, specJson!, _customEntities, _currentUser, ct);
        return await CreatePlanAsync(StudioAiPlanKind.CreateApp, specJson!, StudioAiPlanSummary.ForApp(spec, duplicates), ct);
    }

    private async Task<AiToolResult> HandleStudioPlanSystem(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!_ollamaSettings.EnableStudioAiPlanPreview)
            return AiToolResult.Error("Le flux d'aperçu Studio n'est pas activé.");
        if (!_ollamaSettings.EnableStudioSystemGeneration)
            return AiToolResult.Error("La génération de systèmes multi-tables n'est pas activée.");

        var specJson = GetStringArg(args, "spec_json");
        if (!StudioAiSystemSpec.TryParse(specJson, out var spec, out var parseError) || spec is null)
            return AiToolResult.Error(parseError ?? "Spécification système invalide.");

        var duplicates = await StudioAiPlanCreation.DetectDuplicatesAsync(
            StudioAiPlanKind.CreateSystem, specJson!, _customEntities, _currentUser, ct);
        return await CreatePlanAsync(StudioAiPlanKind.CreateSystem, specJson!, StudioAiPlanSummary.ForSystem(spec, duplicates), ct);
    }

    private async Task<AiToolResult> HandleStudioPlanChanges(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!_ollamaSettings.EnableStudioAiPlanPreview)
            return AiToolResult.Error("Le flux d'aperçu Studio n'est pas activé.");
        if (!_ollamaSettings.EnableStudioAiModifyTools)
            return AiToolResult.Error("La modification de tables par l'assistant n'est pas activée.");

        var specJson = GetStringArg(args, "spec_json");
        if (!StudioAiAmendmentSpec.TryParse(specJson, out var spec, out var parseError) || spec is null)
            return AiToolResult.Error(parseError ?? "Spécification de modification invalide.");

        // Le diff est calculé contre le schéma RÉEL : ce que l'utilisateur valide est ce qui sera appliqué.
        var schemaResult = await _mediator.Send(new GetCustomEntitySchemaQuery(spec.TargetEntityRef), ct);
        if (!schemaResult.IsSuccess)
            return AiToolResult.Error($"Table « {spec.TargetEntityRef} » introuvable. Vérifiez son nom avec studio_get_table_schema.");

        // Les ops add_relation (N-N) et set_view sont en plus sous leurs drapeaux fonctionnels :
        // drapeau coupé ⇒ op écartée de l'aperçu avec un avertissement explicite.
        var preview = StudioAiAmendmentPlanner.BuildPreview(spec, schemaResult.Value,
            _ollamaSettings.EnableStudioManyToMany, _ollamaSettings.EnableStudioRecordViews);
        if (preview.Items.Count == 0)
        {
            var reason = preview.Warnings.Count > 0
                ? string.Join(" ", preview.Warnings)
                : "Aucune modification applicable sur cette table.";
            return AiToolResult.Error(reason);
        }

        return await CreatePlanAsync(StudioAiPlanKind.Amendment, specJson!,
            StudioAiAmendmentPlanner.ToSummaryJson(preview), ct);
    }

    /// <summary>
    /// Schéma réel d'une table personnalisée (lecture seule) : ancre le modèle sur les vraies clés et
    /// libellés AVANT qu'il ne propose une modification, au lieu de les deviner.
    /// </summary>
    private async Task<AiToolResult> HandleStudioGetTableSchema(Dictionary<string, object?> args, CancellationToken ct)
    {
        var entityKey = GetStringArg(args, "entity_key");
        if (string.IsNullOrWhiteSpace(entityKey))
            return AiToolResult.Error("entity_key est requis (clé de la table personnalisée).");

        var result = await _mediator.Send(new GetCustomEntitySchemaQuery(entityKey!.Trim()), ct);
        if (!result.IsSuccess)
            return AiToolResult.Error($"Table « {entityKey} » introuvable.");

        var schema = result.Value;
        var payload = new
        {
            entityKey = schema.Entity.Key,
            displayName = schema.Entity.DisplayName,
            fields = schema.Fields.Where(f => f.IsActive).Select(f => new
            {
                key = f.Key,
                label = f.Label,
                type = f.FieldType.ToString(),
                required = f.IsRequired,
                unique = f.IsUnique,
                options = f.Options?.Select(o => o.Value).ToList()
            }).ToList(),
            formSections = schema.Form.Sections.Count
        };
        return AiToolResult.Ok(Serialize(payload));
    }

    private async Task<AiToolResult> HandleStudioPlanView(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!_ollamaSettings.EnableStudioAiPlanPreview)
            return AiToolResult.Error("Le flux d'aperçu Studio n'est pas activé.");
        if (!_ollamaSettings.EnableStudioAiViewTools)
            return AiToolResult.Error("La création de fenêtres par l'assistant n'est pas activée.");
        if (_sqlSchema is null || !StudioContext.TryGet(_currentUser, out var tenantId, out _, out _))
            return AiToolResult.Error("Introspection des tables indisponible.");

        var specJson = GetStringArg(args, "spec_json");
        if (!StudioAiViewSpec.TryParse(specJson, out var spec, out var parseError) || spec is null)
            return AiToolResult.Error(parseError ?? "Spécification de fenêtre invalide.");

        // Le fournisseur renvoie null pour une table interdite ou absente : deny-by-default.
        var columns = await _sqlSchema.ListColumnsAsync(tenantId, spec.Table, ct);
        if (columns is null)
            return AiToolResult.Error($"Table « {spec.Table} » non autorisée ou introuvable. Listez les tables avec studio_list_sql_tables.");

        var (definition, warnings) = StudioAiViewSpec.ResolveAgainstSchema(spec, columns);
        if (definition.Columns.Count == 0)
            return AiToolResult.Error($"Aucune colonne reconnue sur la table « {spec.Table} ».");

        return await CreatePlanAsync(StudioAiPlanKind.View, specJson!,
            StudioAiPlanSummary.ForView(spec.Title, spec.Table, definition, warnings), ct);
    }

    /// <summary>
    /// PR 2.4 — plan d'une VUE ENREGISTRÉE sur une table Studio existante : garde des trois drapeaux,
    /// schéma RÉEL relu (la vue est résolue contre les vraies clés, avec avertissements), spec
    /// persistée en forme canonique, résumé reflétant la résolution (mode éventuellement dégradé).
    /// </summary>
    private async Task<AiToolResult> HandleStudioPlanRecordView(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!StudioAiPlanCreation.RecordViewToolsEnabled(_ollamaSettings))
            return AiToolResult.Error("Les vues enregistrées par l'IA ne sont pas activées.");

        var specJson = GetStringArg(args, "spec_json");
        if (!StudioAiRecordViewSpec.TryParse(specJson, out var spec, out var parseError) || spec is null)
            return AiToolResult.Error(parseError ?? "Spécification de vue enregistrée invalide.");
        if (string.IsNullOrWhiteSpace(spec.EntityKey))
            return AiToolResult.Error("La vue enregistrée exige la clé de la table cible (« entity »).");

        var schemaResult = await _mediator.Send(new GetCustomEntitySchemaQuery(spec.EntityKey), ct);
        if (!schemaResult.IsSuccess)
            return AiToolResult.Error($"Table « {spec.EntityKey} » introuvable. Vérifiez son nom avec studio_get_table_schema.");

        var schema = schemaResult.Value;
        var (mode, definition, warnings) = StudioAiRecordViewSpec.ResolveAgainstSchema(spec, schema.Fields);
        return await CreatePlanAsync(StudioAiPlanKind.RecordView,
            StudioAiSpecCanonical.CanonicalRecordView(spec),
            StudioAiPlanSummary.ForRecordView(
                StudioAiRecordViewSpec.ApplyResolution(spec, mode, definition), schema.Entity.DisplayName, warnings), ct);
    }

    /// <summary>
    /// PR 4.3 — plan de WORKFLOWS sur des tables Studio existantes : garde des trois drapeaux
    /// (StudioAiPlanCreation.WorkflowToolsEnabled), schémas RÉELS relus (≤ 5 tables distinctes,
    /// séquentiel), contrôles bloquants du planner (table/champ/action/approbateur), spec persistée en
    /// forme canonique, résumé contrat § D (summary.workflows). Rien n'est créé avant confirmation.
    /// </summary>
    private async Task<AiToolResult> HandleStudioPlanWorkflow(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!StudioAiPlanCreation.WorkflowToolsEnabled(_ollamaSettings))
            return AiToolResult.Error("Les workflows générés par l'IA ne sont pas activés.");

        var specJson = GetStringArg(args, "spec_json");
        if (!StudioAiWorkflowSpec.TryParse(specJson, out var spec, out var parseError) || spec is null)
            return AiToolResult.Error(parseError ?? "Spécification de workflows invalide.");

        var schemas = new Dictionary<string, CustomEntitySchemaDto>(StringComparer.Ordinal);
        foreach (var entityKey in spec.Workflows.Select(w => w.EntityKey).Distinct(StringComparer.Ordinal))
        {
            var schemaResult = await _mediator.Send(new GetCustomEntitySchemaQuery(entityKey), ct);
            if (schemaResult.IsSuccess) schemas[entityKey] = schemaResult.Value;
            // Échec ⇒ table absente du dictionnaire ⇒ erreur bloquante FR côté planner.
        }

        var review = StudioAiWorkflowPlanner.Review(spec, schemas, AiToolRegistry.GetToolDefinition);
        if (review.IsBlocked)
            return AiToolResult.Error(Truncate(string.Join(" ", review.BlockingErrors)
                + " Vérifiez les noms avec studio_get_table_schema.", 600));

        return await CreatePlanAsync(StudioAiPlanKind.Workflow,
            StudioAiSpecCanonical.CanonicalWorkflow(spec),
            StudioAiPlanSummary.ForWorkflow(spec, schemas, review.Warnings), ct);
    }

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..(max - 1)] + "…";

    /// <summary>Tables SQL consultables (liste blanche vivante) — ancre le modèle sur le schéma réel.</summary>
    private async Task<AiToolResult> HandleStudioListSqlTables(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (_sqlSchema is null || !StudioContext.TryGet(_currentUser, out var tenantId, out _, out _))
            return AiToolResult.Error("Introspection des tables indisponible.");

        var table = GetStringArg(args, "table");
        if (!string.IsNullOrWhiteSpace(table))
        {
            var columns = await _sqlSchema.ListColumnsAsync(tenantId, table!.Trim(), ct);
            if (columns is null)
                return AiToolResult.Error($"Table « {table} » non autorisée ou introuvable.");
            return AiToolResult.Ok(Serialize(new
            {
                table = table.Trim(),
                columns = columns.Select(c => new { name = c.Name, type = c.DataType, format = c.SuggestedFormat }).ToList()
            }));
        }

        var tables = await _sqlSchema.ListTablesAsync(tenantId, ct);
        return AiToolResult.Ok(Serialize(new { tables = tables.Select(t => t.Name).ToList() }));
    }

    private async Task<AiToolResult> CreatePlanAsync(
        StudioAiPlanKind kind, string specJson, string summaryJson, CancellationToken ct)
    {
        var planResult = await _mediator.Send(new CreateStudioAiPlanCommand(kind, specJson, summaryJson), ct);
        if (!planResult.IsSuccess)
            return AiToolResult.Error(planResult.Error.Description);

        var dto = planResult.Value;
        var payload = new
        {
            success = true,
            requiresConfirmation = true,
            planId = dto.Id,
            kind = dto.Kind,
            status = dto.Status,
            expiresAt = dto.ExpiresAt,
            summary = JsonNode.Parse(dto.SummaryJson),
            message = "Plan prêt. L'utilisateur doit VALIDER l'aperçu avant toute création — rien n'a encore été créé."
        };
        return AiToolResult.Ok(Serialize(payload));
    }
}
