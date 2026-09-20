using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Entities;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Application.Features.Studio.Forms;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Relations;
using FactuTrust.Application.Features.Studio.Reports;
using FactuTrust.Application.Features.Studio.Systems;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Infrastructure.Services.Studio;

/// <summary>
/// Applique une modification approuvée sur une table Studio existante. Orchestration mince au-dessus
/// des commandes CQRS Studio : aucune logique métier ajoutée (validation, quotas, permissions et audit
/// restent dans les handlers).
///
/// Contrairement à la création, il n'y a PAS d'annulation globale : chaque opération est atomique et
/// déjà auditée individuellement, et l'utilisateur a validé l'aperçu. Une opération en échec est
/// rapportée puis on poursuit avec les suivantes ; le rapport final liste ce qui est passé et ce qui
/// ne l'est pas. Le schéma réel est RELU ici : ce que l'exécution résout est l'état courant, pas
/// l'instantané du moment de l'aperçu.
/// </summary>
public sealed class StudioAiAmendmentExecutor
{
    private readonly IMediator _mediator;
    private readonly ICurrentUser _currentUser;
    private readonly OllamaSettings? _settings;
    private readonly ICustomEntityRepository? _entities;

    /// <param name="settings">
    /// Drapeaux Studio (<see cref="OllamaSettings.EnableStudioManyToMany"/>,
    /// <see cref="OllamaSettings.EnableStudioRecordViews"/>) lus par les opérations gardées (3.1d).
    /// <see langword="null"/> ⇒ drapeaux considérés coupés (fail-closed).
    /// </param>
    /// <param name="entities">
    /// Dépôt des tables, utilisé pour résoudre la cible d'une relation (3.1d). <see langword="null"/> ⇒
    /// l'ajout de relation est rapporté « skipped ».
    /// </param>
    public StudioAiAmendmentExecutor(
        IMediator mediator,
        ICurrentUser currentUser,
        OllamaSettings? settings = null,
        ICustomEntityRepository? entities = null)
    {
        _mediator = mediator;
        _currentUser = currentUser;
        _settings = settings;
        _entities = entities;
    }

    public async Task<(bool Success, string? Error, object? Payload)> ExecuteAsync(
        ParsedAmendmentSpec spec, IStudioBuildProgress? progress, CancellationToken ct)
    {
        void Report(string phase, string label, string status, string? detail = null) =>
            progress?.Report(new StudioBuildStep(phase, label, status, spec.TargetEntityRef, detail));

        Report("loading_schema", "Lecture de la table", "running");
        var schemaResult = await _mediator.Send(new GetCustomEntitySchemaQuery(spec.TargetEntityRef), ct);
        if (!schemaResult.IsSuccess)
        {
            Report("failed", "Table introuvable", "error", schemaResult.Error.Description);
            return (false, $"Table « {spec.TargetEntityRef} » introuvable : {schemaResult.Error.Description}", null);
        }

        var schema = schemaResult.Value;
        var entityId = schema.Entity.Id;
        var fields = schema.Fields.Where(f => f.IsActive).ToList();
        var usedKeys = schema.Fields.Select(f => f.Key).ToHashSet(StringComparer.Ordinal);
        Report("loading_schema", "Lecture de la table", "done");

        var applied = new List<string>();
        var warnings = new List<string>(spec.Warnings);

        foreach (var op in spec.Operations)
        {
            switch (op)
            {
                case AddFieldOp add:
                    await ApplyAddFieldAsync(add, entityId, usedKeys, applied, warnings, Report, ct);
                    break;
                case UpdateFieldOp upd:
                    await ApplyUpdateFieldAsync(upd, fields, applied, warnings, Report, ct);
                    break;
                case RemoveFieldOp rem:
                    await ApplyRemoveFieldAsync(rem, fields, applied, warnings, Report, ct);
                    break;
                case UpdateEntityOp ent:
                    await ApplyUpdateEntityAsync(ent, schema, applied, warnings, Report, ct);
                    break;
                case SetFormOp form:
                    await ApplySetFormAsync(form, entityId, fields, applied, warnings, Report, ct);
                    break;
                case SetReportOp report:
                    await ApplySetReportAsync(report, schema.Entity.Key, fields, applied, warnings, Report, ct);
                    break;
                case ReorderFieldsOp reorder:
                    await ApplyReorderFieldsAsync(reorder, entityId, fields, applied, warnings, Report, ct);
                    break;
                case ChangeFieldTypeOp changeType:
                    await ApplyChangeFieldTypeAsync(changeType, entityId, fields, applied, warnings, Report, ct);
                    break;
                case AssignSystemOp assign:
                    await ApplyAssignSystemAsync(assign, schema.Entity, applied, warnings, Report, ct);
                    break;
                case AddRelationOp relation:
                    await ApplyAddRelationAsync(relation, schema, usedKeys, applied, warnings, Report, ct);
                    break;
                case SetViewOp view:
                    await ApplySetViewAsync(view, schema, applied, warnings, Report, ct);
                    break;
                case SetAutomationOp:
                {
                    // Automatisations : toujours non exécutables (phase 4 du programme) — JAMAIS
                    // silencieux : étape « skipped » explicite + avertissement, et le plan échoue en
                    // « Aucune modification applicable » si rien d'autre n'est appliqué.
                    warnings.Add($"Opération « set_automation » ignorée : les automatisations ne sont pas encore créées par l'assistant.");
                    Report("skipped_automation", "Automatisation", "skipped",
                        "Les automatisations ne sont pas encore créées par l'assistant : étape ignorée.");
                    break;
                }
                default:
                    // Défensif : le parseur (liste blanche stricte) ne produit que les ops ci-dessus ;
                    // atteindre ce cas signifie qu'une opération a été ajoutée à la spec SANS son
                    // exécution. Erreur de programmation : échec bruyant, jamais un saut silencieux
                    // d'une modification pourtant validée par l'utilisateur.
                    throw new InvalidOperationException(
                        $"Opération d'amendement « {op.Op} » ({op.GetType().Name}) sans exécution implémentée.");
            }
        }

        if (applied.Count == 0)
        {
            var reason = warnings.Count > 0 ? string.Join(" ", warnings) : "Aucune modification applicable.";
            Report("failed", "Aucune modification appliquée", "error", reason);
            return (false, reason, null);
        }

        Report("completed", "Modifications appliquées", "done");

        var payload = new
        {
            success = true,
            entityKey = schema.Entity.Key,
            displayName = schema.Entity.DisplayName,
            appliedCount = applied.Count,
            applied,
            warnings,
            openUrl = $"/studio/d/{schema.Entity.Key}",
            message = $"{applied.Count} modification(s) appliquée(s) sur « {schema.Entity.DisplayName} »."
                + (warnings.Count > 0 ? $" {warnings.Count} élément(s) ignoré(s)." : string.Empty)
        };
        return (true, null, payload);
    }

    private async Task ApplyAddFieldAsync(
        AddFieldOp add, Guid entityId, HashSet<string> usedKeys, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        var label = add.Field.Label;
        var key = UniqueKey(add.Field.Key, usedKeys);
        var request = new CreateCustomFieldRequest(key, label, add.Field.FieldType,
            add.Field.Required, add.Field.Unique, null, add.Field.Options, null, add.Field.Config);

        await RunStepAsync("adding_field", $"Champ « {label} »",
            () => _mediator.Send(new CreateCustomFieldCommand(entityId, request), ct),
            applied, warnings, report,
            $"Champ « {label} » ajouté.", $"Champ « {label} » non ajouté",
            onSuccess: () => usedKeys.Add(key));
    }

    private async Task ApplyUpdateFieldAsync(
        UpdateFieldOp op, IReadOnlyList<CustomFieldDto> fields, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        var target = ResolveOrWarn(op.FieldRef, fields, warnings, "modification ignorée");
        if (target is null) return;

        // Les options ajoutées complètent la liste existante (jamais de remplacement destructif :
        // une valeur déjà saisie dans un enregistrement doit rester interprétable).
        var options = MergeOptions(target.Options, op.AddOptions);
        var request = new UpdateCustomFieldRequest(
            op.Label?.Trim() is { Length: > 0 } newLabel ? newLabel : target.Label,
            op.Required ?? target.IsRequired,
            op.Unique ?? target.IsUnique,
            target.Rules,
            options,
            target.Relation,
            IsActive: true,
            Config: null);

        await RunStepAsync("updating_field", $"Champ « {target.Label} »",
            () => _mediator.Send(new UpdateCustomFieldCommand(target.Id, request), ct),
            applied, warnings, report,
            $"Champ « {target.Label} » modifié.", $"Champ « {target.Label} » non modifié");
    }

    private async Task ApplyRemoveFieldAsync(
        RemoveFieldOp op, IReadOnlyList<CustomFieldDto> fields, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        var target = ResolveOrWarn(op.FieldRef, fields, warnings, "retrait ignoré");
        if (target is null) return;

        // La commande désactive le champ sans toucher aux données déjà saisies.
        await RunStepAsync("removing_field", $"Champ « {target.Label} »",
            () => _mediator.Send(new DeleteCustomFieldCommand(target.Id), ct),
            applied, warnings, report,
            $"Champ « {target.Label} » retiré (données conservées).", $"Champ « {target.Label} » non retiré");
    }

    private async Task ApplyUpdateEntityAsync(
        UpdateEntityOp op, CustomEntitySchemaDto schema, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        var entity = schema.Entity;
        var request = new UpdateCustomEntityRequest(
            op.DisplayName?.Trim() is { Length: > 0 } name ? name : entity.DisplayName,
            op.DisplayNamePlural?.Trim() is { Length: > 0 } plural ? plural : entity.DisplayNamePlural,
            op.Icon?.Trim() is { Length: > 0 } icon ? icon : entity.Icon,
            op.Description?.Trim() is { Length: > 0 } desc ? desc : entity.Description,
            IsActive: true);

        await RunStepAsync("updating_entity", "Propriétés de la table",
            () => _mediator.Send(new UpdateCustomEntityCommand(entity.Id, request), ct),
            applied, warnings, report,
            "Propriétés de la table mises à jour.", "Table non modifiée");
    }

    private async Task ApplySetFormAsync(
        SetFormOp op, Guid entityId, IReadOnlyList<CustomFieldDto> fields, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        // Un plan Amendment n'exige que `design_entities` : la sous-opération `set_form` doit vérifier
        // son propre droit (même règle que `set_report` ↔ `design_reports`). La commande le revérifie
        // aussi ; ici on évite d'annoncer une étape qui sera refusée.
        if (!_currentUser.HasPermission(Permissions.Studio.DesignForms))
        {
            warnings.Add("Formulaire ignoré : permission de conception des formulaires absente.");
            return;
        }

        var layout = StudioAiAmendmentPlanner.ResolveForm(op.FormNode, fields);
        if (layout is null)
        {
            warnings.Add("Formulaire non modifié : aucun champ reconnu dans la mise en page.");
            return;
        }

        await RunStepAsync("updating_form", "Formulaire",
            () => _mediator.Send(new UpsertDefaultFormCommand(entityId, new SaveFormLayoutRequest(layout, null)), ct),
            applied, warnings, report,
            "Formulaire réorganisé.", "Formulaire non modifié");
    }

    private async Task ApplySetReportAsync(
        SetReportOp op, string entityKey, IReadOnlyList<CustomFieldDto> fields, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        if (!_currentUser.HasPermission(Permissions.Studio.DesignReports))
        {
            warnings.Add("État ignoré : permission de conception des rapports absente.");
            return;
        }

        var definition = StudioAiAmendmentPlanner.ResolveReport(op.ReportNode, fields);
        if (definition is null)
        {
            warnings.Add("État ignoré : aucun champ reconnu dans la définition.");
            return;
        }

        var displayName = string.IsNullOrWhiteSpace(op.DisplayName) ? "Rapport" : op.DisplayName!.Trim();

        await RunStepAsync("updating_report", $"État « {displayName} »",
            () => _mediator.Send(new UpsertCustomReportCommand(null,
                new SaveCustomReportRequest(null, displayName, CustomReportDataSourceKind.CustomEntity, entityKey, definition)), ct),
            applied, warnings, report,
            $"État « {displayName} » créé.", $"État « {displayName} » non créé");
    }

    // ---- PR 3.1c : réorganisation, changement de type, rattachement à un système ----

    private async Task ApplyReorderFieldsAsync(
        ReorderFieldsOp op, Guid entityId, IReadOnlyList<CustomFieldDto> fields, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        // Même règle que l'aperçu (StudioAiAmendmentPlanner) : les champs cités d'abord, dans l'ordre
        // demandé, puis les champs non cités dans leur ordre actuel ; une référence introuvable est
        // retirée avec un avertissement. La commande exige la liste COMPLÈTE des ids actifs.
        var ordered = new List<Guid>();
        foreach (var raw in op.FieldRefs)
        {
            var target = StudioAiAmendmentPlanner.ResolveField(raw, fields);
            if (target is null)
            {
                warnings.Add($"Champ « {raw} » introuvable : retiré de la réorganisation.");
                continue;
            }
            if (!ordered.Contains(target.Id)) ordered.Add(target.Id);
        }

        if (ordered.Count == 0)
        {
            warnings.Add("Réorganisation des champs ignorée : aucun champ reconnu.");
            return;
        }

        foreach (var f in fields.OrderBy(f => f.SortOrder))
            if (!ordered.Contains(f.Id)) ordered.Add(f.Id);

        await RunStepAsync("reordering_fields", "Ordre des champs",
            () => _mediator.Send(new ReorderCustomFieldsCommand(entityId, new ReorderCustomFieldsRequest(ordered)), ct),
            applied, warnings, report,
            "Champs réorganisés.", "Champs non réorganisés");
    }

    private async Task ApplyChangeFieldTypeAsync(
        ChangeFieldTypeOp op, Guid entityId, IReadOnlyList<CustomFieldDto> fields, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        var target = ResolveOrWarn(op.FieldRef, fields, warnings, "changement de type ignoré");
        if (target is null) return;

        // La politique Lossless / RequiresEmptyTable / Forbidden (matrice D4) est appliquée par le
        // handler, qui recompte les enregistrements au moment réel : un refus remonte ici comme une
        // étape « error » sans interrompre les opérations suivantes.
        var request = new ChangeCustomFieldTypeRequest(
            op.FieldType,
            op.Options,
            Rules: null,
            op.Relation,
            op.Config is null ? null : new Dictionary<string, System.Text.Json.Nodes.JsonNode?>(op.Config));

        await RunStepAsync("changing_field_type", $"Type de « {target.Label} »",
            () => _mediator.Send(new ChangeCustomFieldTypeCommand(entityId, target.Id, request), ct),
            applied, warnings, report,
            $"Champ « {target.Label} » converti en {StudioAiAmendmentPlanner.TypeLabel(op.FieldType)}.",
            $"Type de « {target.Label} » non modifié");
    }

    private async Task ApplyAssignSystemAsync(
        AssignSystemOp op, CustomEntityDto entity, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        var label = op.SystemRef is null ? "Détachement du système" : $"Système « {op.SystemRef} »";
        report("assigning_system", label, "running", null);

        Guid? systemId = null;
        if (op.SystemRef is not null)
        {
            var system = await _mediator.Send(new GetCustomSystemByKeyQuery(op.SystemRef), ct);
            if (!system.IsSuccess)
            {
                warnings.Add($"Système « {op.SystemRef} » introuvable : rattachement ignoré.");
                report("assigning_system", label, "error", system.Error.Description);
                return;
            }
            systemId = system.Value.System.Id;
        }

        ReportOutcome(await _mediator.Send(new AssignEntityToSystemCommand(entity.Id, systemId), ct),
            "assigning_system", label, applied, warnings, report,
            op.SystemRef is null
                ? "Table détachée de son système."
                : $"Table rattachée au système « {op.SystemRef} ».",
            "Rattachement au système non appliqué");
    }

    // ---- PR 3.1d : ajout de relation, vue enregistrée (automatisation : toujours ignorée) ----

    private async Task ApplyAddRelationAsync(
        AddRelationOp op, CustomEntitySchemaDto schema, HashSet<string> usedKeys, List<string> applied,
        List<string> warnings, Action<string, string, string, string?> report, CancellationToken ct)
    {
        var label = $"Relation vers « {op.TargetRef} »";

        // Drapeau plusieurs-à-plusieurs coupé (ou settings absents) ⇒ « skipped » SANS lecture ni
        // envoi (fail-closed) — même garde que l'aperçu (StudioAiAmendmentPlanner).
        if (op.Kind == EntityRelationKinds.ManyToMany && _settings?.EnableStudioManyToMany != true)
        {
            warnings.Add($"Relation vers « {op.TargetRef} » ignorée : les relations plusieurs-à-plusieurs ne sont pas activées.");
            report("adding_relation", label, "skipped",
                "Les relations plusieurs-à-plusieurs ne sont pas activées.");
            return;
        }

        // La cible est résolue contre le dépôt RÉEL : l'aperçu (planificateur pur) ne pouvait pas
        // vérifier son existence ni son caractère « standard ». Dépôt ou tenant indisponible ⇒
        // fail-closed : étape « skipped », aucun envoi.
        var target = _entities is null || _currentUser.TenantId is not { } tenantId
            ? null
            : await _entities.GetByKeyAsync(tenantId, op.TargetRef, ct);
        if (target is null)
        {
            var why = _entities is null
                ? "dépôt des tables indisponible"
                : $"table « {op.TargetRef} » introuvable";
            warnings.Add($"Relation vers « {op.TargetRef} » ignorée : {why}.");
            report("adding_relation", label, "skipped", $"Relation ignorée : {why}.");
            return;
        }
        if (target.Kind == CustomEntityKind.Junction)
        {
            // Même refus que CreateManyToManyRelationCommand / le concepteur : une jonction ne se relie pas.
            warnings.Add($"Relation vers « {op.TargetRef} » ignorée : une table de jonction ne peut pas être reliée.");
            report("adding_relation", label, "skipped", "La table cible est une table de jonction.");
            return;
        }

        if (op.Kind == EntityRelationKinds.ManyToMany)
        {
            await RunStepAsync("adding_relation", label,
                () => _mediator.Send(new CreateManyToManyRelationCommand(schema.Entity.Id,
                    new CreateManyToManyRelationRequest(target.Id, op.Label, op.JunctionName, null)), ct),
                applied, warnings, report,
                $"Relation plusieurs-à-plusieurs avec « {target.DisplayName} » créée.",
                $"Relation vers « {op.TargetRef} » non créée");
            return;
        }

        // N-1 : un champ RelationCustom porté par la table modifiée — la MÊME commande que
        // l'ajout de champ du concepteur (validation, quotas, audit mutualisés).
        var fieldLabel = string.IsNullOrWhiteSpace(op.Label) ? target.DisplayName : op.Label!.Trim();
        var key = UniqueKey(StudioAiAppSpec.SlugKey(fieldLabel), usedKeys);
        var request = new CreateCustomFieldRequest(key, fieldLabel, CustomFieldType.RelationCustom,
            false, false, null, null, new RelationRefDto("custom", target.Key), null);

        await RunStepAsync("adding_relation", label,
            () => _mediator.Send(new CreateCustomFieldCommand(schema.Entity.Id, request), ct),
            applied, warnings, report,
            $"Relation plusieurs-à-un vers « {target.DisplayName} » ajoutée (champ « {fieldLabel} »).",
            $"Relation vers « {op.TargetRef} » non ajoutée",
            onSuccess: () => usedKeys.Add(key));
    }

    private async Task ApplySetViewAsync(
        SetViewOp op, CustomEntitySchemaDto schema, List<string> applied, List<string> warnings,
        Action<string, string, string, string?> report, CancellationToken ct)
    {
        var spec = op.View;
        var label = $"Vue « {spec.DisplayName} »";

        // Un plan Amendment n'exige que `design_entities` : la création d'une vue relève de
        // `design_forms` (policy StudioRecordViewsController / plan RecordView). Même règle que
        // `set_form` : on évite d'annoncer une étape qui sera refusée.
        if (!_currentUser.HasPermission(Permissions.Studio.DesignForms))
        {
            warnings.Add($"Vue « {spec.DisplayName} » ignorée : permission de conception des formulaires absente.");
            return;
        }

        // Drapeau coupé (ou settings absents) ⇒ « skipped » SANS envoi (fail-closed).
        if (_settings?.EnableStudioRecordViews != true)
        {
            warnings.Add($"Vue « {spec.DisplayName} » ignorée : les vues enregistrées ne sont pas activées.");
            report("creating_record_view", label, "skipped", "Les vues enregistrées ne sont pas activées.");
            return;
        }

        // MÊME séquence que StudioAiPlanExecutor.ExecuteRecordViewAsync : la spec est RERÉSOLUE
        // contre le schéma réel (l'aperçu a pu vieillir), les dégradations restent des
        // avertissements, et la clé sluguée ne percute aucune vue existante.
        var (mode, definition, viewWarnings) = StudioAiRecordViewSpec.ResolveAgainstSchema(spec, schema.Fields);
        foreach (var viewWarning in viewWarnings) warnings.Add(viewWarning);
        var key = StudioAiRecordViewSpec.SlugKey(
            spec.DisplayName, schema.Views.Select(v => v.Key).ToHashSet(StringComparer.Ordinal));

        await RunStepAsync("creating_record_view", label,
            () => _mediator.Send(new CreateCustomRecordViewCommand(schema.Entity.Key,
                new SaveCustomRecordViewRequest(key, spec.DisplayName, mode, definition, spec.IsDefault)), ct),
            applied, warnings, report,
            $"Vue « {spec.DisplayName} » créée.", $"Vue « {spec.DisplayName} » non créée");
    }

    // ---- Ossature partagée des étapes ----

    /// <summary>
    /// Exécute une étape « running → done/error » : succès ⇒ <paramref name="onSuccess"/> puis message
    /// dans <paramref name="applied"/> ; échec ⇒ avertissement « {failurePrefix} : … » et étape
    /// « error » — sans interrompre les opérations suivantes.
    /// </summary>
    private static async Task RunStepAsync<T>(
        string phase, string label, Func<Task<T>> send,
        List<string> applied, List<string> warnings, Action<string, string, string, string?> report,
        string appliedMessage, string failurePrefix, Action? onSuccess = null) where T : Result
    {
        report(phase, label, "running", null);
        ReportOutcome(await send(), phase, label, applied, warnings, report, appliedMessage, failurePrefix, onSuccess);
    }

    /// <summary>Conclusion d'une étape déjà annoncée (ex. après une résolution préalable).</summary>
    private static void ReportOutcome(
        Result result, string phase, string label,
        List<string> applied, List<string> warnings, Action<string, string, string, string?> report,
        string appliedMessage, string failurePrefix, Action? onSuccess = null)
    {
        if (result.IsSuccess)
        {
            onSuccess?.Invoke();
            applied.Add(appliedMessage);
            report(phase, label, "done", null);
        }
        else
        {
            warnings.Add($"{failurePrefix} : {result.Error.Description}");
            report(phase, label, "error", result.Error.Description);
        }
    }

    /// <summary>Résout une référence brute de champ ; introuvable ⇒ avertissement « … : {action}. » et null.</summary>
    private static CustomFieldDto? ResolveOrWarn(
        string fieldRef, IReadOnlyList<CustomFieldDto> fields, List<string> warnings, string action)
    {
        var target = StudioAiAmendmentPlanner.ResolveField(fieldRef, fields);
        if (target is null) warnings.Add($"Champ « {fieldRef} » introuvable : {action}.");
        return target;
    }

    private static IReadOnlyList<SelectOptionDto>? MergeOptions(
        IReadOnlyList<SelectOptionDto>? existing, IReadOnlyList<SelectOptionDto>? added)
    {
        if (added is null || added.Count == 0) return existing;
        var merged = new List<SelectOptionDto>(existing ?? Array.Empty<SelectOptionDto>());
        var seen = merged.Select(o => o.Value).ToHashSet(StringComparer.Ordinal);
        foreach (var o in added)
            if (seen.Add(o.Value)) merged.Add(o);
        return merged;
    }

    private static string UniqueKey(string baseKey, HashSet<string> used)
    {
        if (string.IsNullOrEmpty(baseKey) || !StudioKey.IsValidShape(baseKey)) baseKey = "champ";
        var key = baseKey;
        var i = 1;
        while (used.Contains(key)) key = $"{baseKey}_{++i}";
        return key;
    }
}
