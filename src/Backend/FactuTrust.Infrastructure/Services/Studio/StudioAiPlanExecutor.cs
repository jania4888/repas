using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Entities;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Reports;
using FactuTrust.Application.Features.Studio.Views;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Studio;

/// <summary>
/// Exécute un plan Studio IA confirmé par l'utilisateur. Routage par nature de plan :
/// CreateSystem → <see cref="StudioAiSystemOrchestrator"/> (rollback conservé) ;
/// CreateApp → création directe table + champs + rapport (mêmes commandes que studio_generate_app) ;
/// Workflow → <see cref="StudioAiWorkflowExecutor"/> (tout-ou-rien, workflows créés inactifs, PR 4.3f).
/// Orchestration mince uniquement — toute la validation/quotas/permissions/audit reste dans les
/// commandes CQRS Studio sous-jacentes.
/// </summary>
public sealed class StudioAiPlanExecutor : IStudioAiPlanExecutor
{
    private readonly IMediator _mediator;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioQuotaService? _quota;
    private readonly ISqlSchemaProvider? _sqlSchema;
    private readonly OllamaSettings? _settings;
    private readonly ICustomEntityRepository? _entities;

    public StudioAiPlanExecutor(
        IMediator mediator,
        ICurrentUser currentUser,
        IStudioQuotaService? quota = null,
        ISqlSchemaProvider? sqlSchema = null,
        IOptions<OllamaSettings>? settings = null,
        ICustomEntityRepository? entities = null)
    {
        _mediator = mediator;
        _currentUser = currentUser;
        _quota = quota;
        _sqlSchema = sqlSchema;
        _settings = settings?.Value;
        _entities = entities;
    }

    public async Task<(bool Success, string? Error, object? Payload)> ExecuteAsync(
        StudioAiBuildPlan plan, IStudioBuildProgress? progress, CancellationToken cancellationToken)
    {
        switch (plan.Kind)
        {
            case StudioAiPlanKind.CreateSystem:
            {
                if (!StudioAiSystemSpec.TryParse(plan.SpecJson, out var spec, out var error) || spec is null)
                    return (false, error ?? "Spécification système invalide.", null);
                var orchestrator = new StudioAiSystemOrchestrator(_mediator, _currentUser, _quota, _settings);
                return await orchestrator.ExecuteAsync(spec, progress, cancellationToken);
            }
            case StudioAiPlanKind.CreateApp:
            {
                if (!StudioAiAppSpec.TryParse(plan.SpecJson, out var spec, out var error) || spec is null)
                    return (false, error ?? "Spécification d'application invalide.", null);
                return await ExecuteAppAsync(spec, progress, cancellationToken);
            }
            case StudioAiPlanKind.Amendment:
            {
                if (!StudioAiAmendmentSpec.TryParse(plan.SpecJson, out var spec, out var error) || spec is null)
                    return (false, error ?? "Spécification de modification invalide.", null);
                var executor = new StudioAiAmendmentExecutor(_mediator, _currentUser, _settings, _entities);
                return await executor.ExecuteAsync(spec, progress, cancellationToken);
            }
            case StudioAiPlanKind.View:
            {
                if (!StudioAiViewSpec.TryParse(plan.SpecJson, out var spec, out var error) || spec is null)
                    return (false, error ?? "Spécification de fenêtre invalide.", null);
                return await ExecuteViewAsync(spec, plan.TenantId, progress, cancellationToken);
            }
            case StudioAiPlanKind.Report:
            {
                if (!StudioAiReportSpec.TryParse(plan.SpecJson, out var spec, out var error) || spec is null)
                    return (false, error ?? "Spécification d'état invalide.", null);
                return await ExecuteReportAsync(spec, progress, cancellationToken);
            }
            case StudioAiPlanKind.RecordView:
            {
                if (!StudioAiRecordViewSpec.TryParse(plan.SpecJson, out var spec, out var error) || spec is null)
                    return (false, error ?? "Spécification de vue enregistrée invalide.", null);
                return await ExecuteRecordViewAsync(spec, progress, cancellationToken);
            }
            case StudioAiPlanKind.Workflow:
            {
                // PR 4.3f — fail-closed (D-43-22, D-43-29) : règle UNIQUE des trois drapeaux (moteur, outil IA,
                // aperçu) — un plan confirmé (ou rejoué) après l'extinction de l'un d'eux ne crée rien.
                if (_settings is null || !StudioAiPlanCreation.WorkflowToolsEnabled(_settings))
                    return (false, "Les workflows Studio ne sont pas activés.", null);
                if (!StudioAiWorkflowSpec.TryParse(plan.SpecJson, out var spec, out var error) || spec is null)
                    return (false, error ?? "Spécification de workflows invalide.", null);
                var executor = new StudioAiWorkflowExecutor(_mediator);
                return await executor.ExecuteAsync(spec, progress, cancellationToken);
            }
            default:
                return (false, $"Type de plan non pris en charge : {plan.Kind}.", null);
        }
    }

    /// <summary>
    /// Création d'une table simple — mêmes commandes et même tolérance que
    /// <c>AiToolExecutor.HandleStudioGenerateApp</c> (chemin direct conservé intact), avec en plus
    /// la progression live pour le flux plan → confirmation.
    /// </summary>
    private async Task<(bool Success, string? Error, object? Payload)> ExecuteAppAsync(
        ParsedAppSpec spec, IStudioBuildProgress? progress, CancellationToken cancellationToken)
    {
        void Report(string phase, string label, string status, string? detail = null) =>
            progress?.Report(new StudioBuildStep(phase, label, status, null, detail));

        Report("creating_entity", $"Table « {spec.EntityDisplayName} »", "running");
        var existing = await _mediator.Send(new ListCustomEntitiesQuery(true), cancellationToken);
        var usedKeys = existing.IsSuccess
            ? existing.Value.Select(e => e.Key).ToHashSet(StringComparer.Ordinal)
            : new HashSet<string>(StringComparer.Ordinal);
        var entityKey = UniqueEntityKey(spec.EntityDisplayName, usedKeys);

        var entityResult = await _mediator.Send(new CreateCustomEntityCommand(
            new CreateCustomEntityRequest(entityKey, spec.EntityDisplayName, spec.EntityDisplayNamePlural,
                spec.Icon, spec.Description)), cancellationToken);
        if (!entityResult.IsSuccess)
        {
            Report("failed", "Échec – création de la table", "error", entityResult.Error.Description);
            return (false, entityResult.Error.Description, null);
        }

        var entity = entityResult.Value;
        Report("creating_entity", $"Table « {spec.EntityDisplayName} »", "done");

        var created = new List<string>();
        var warnings = new List<string>();
        Report("creating_fields", $"Champs de « {spec.EntityDisplayName} »", "running");
        foreach (var f in spec.Fields)
        {
            var req = new CreateCustomFieldRequest(f.Key, f.Label, f.FieldType, f.Required, f.Unique, null, f.Options, null, f.Config);
            var fr = await _mediator.Send(new CreateCustomFieldCommand(entity.Id, req), cancellationToken);
            if (fr.IsSuccess) created.Add(f.Label);
            else warnings.Add($"Champ « {f.Label} » ignoré : {fr.Error.Description}");
        }
        Report("creating_fields", $"Champs de « {spec.EntityDisplayName} »", "done");

        string? reportName = null;
        if (spec.Report is not null && _currentUser.HasPermission(Permissions.Studio.DesignReports))
        {
            Report("creating_report", $"Rapport « {spec.Report.DisplayName} »", "running");
            var def = new ReportDefinition
            {
                Fields = spec.Report.Fields,
                Filters = spec.Report.Filters,
                Grouping = spec.Report.Grouping,
                Aggregations = spec.Report.Aggregations,
                Sort = spec.Report.Sort
            };
            var rr = await _mediator.Send(new UpsertCustomReportCommand(null,
                new SaveCustomReportRequest(null, spec.Report.DisplayName,
                    CustomReportDataSourceKind.CustomEntity, entity.Key, def)), cancellationToken);
            if (rr.IsSuccess)
            {
                reportName = rr.Value.DisplayName;
                Report("creating_report", $"Rapport « {spec.Report.DisplayName} »", "done");
            }
            else
            {
                warnings.Add($"Rapport « {spec.Report.DisplayName} » ignoré : {rr.Error.Description}");
                Report("creating_report", $"Rapport « {spec.Report.DisplayName} »", "error", rr.Error.Description);
            }
        }

        Report("completed", "Table créée", "done");

        var payload = new
        {
            success = true,
            entityKey = entity.Key,
            displayName = entity.DisplayName,
            fieldsCreated = created.Count,
            reportCreated = reportName,
            warnings,
            openUrl = $"/studio/d/{entity.Key}",
            message = $"Table « {entity.DisplayName} » créée avec {created.Count} champ(s)"
                + (reportName is not null ? $", plus le rapport « {reportName} »." : ".")
        };
        return (true, null, payload);
    }

    /// <summary>
    /// Enregistre un état sur les tables réelles. Passe par <c>UpsertCustomReportCommand</c> — la MÊME
    /// commande que le concepteur humain : validation de source, permissions et audit sont mutualisés,
    /// et l'état créé par l'IA est en tout point un état Studio ordinaire.
    /// </summary>
    private async Task<(bool Success, string? Error, object? Payload)> ExecuteReportAsync(
        ParsedReportSpec spec, IStudioBuildProgress? progress, CancellationToken ct)
    {
        void Report(string phase, string label, string status, string? detail = null) =>
            progress?.Report(new StudioBuildStep(phase, label, status, null, detail));

        var (factTable, definition) = StudioAiReportSpec.Materialize(spec);

        Report("creating_report", $"État « {spec.Title} »", "running");
        var result = await _mediator.Send(new UpsertCustomReportCommand(null,
            new SaveCustomReportRequest(null, spec.Title, CustomReportDataSourceKind.SqlQuery, factTable, definition)), ct);
        if (!result.IsSuccess)
        {
            Report("creating_report", $"État « {spec.Title} »", "error", result.Error.Description);
            return (false, result.Error.Description, null);
        }
        Report("creating_report", $"État « {spec.Title} »", "done");
        Report("completed", "État créé", "done");

        var report = result.Value;
        var payload = new
        {
            success = true,
            reportId = report.Id,
            reportKey = report.Key,
            displayName = report.DisplayName,
            source = factTable,
            warnings = spec.Warnings,
            openUrl = $"/studio/reports/{report.Id}/view",
            message = $"État « {report.DisplayName} » créé sur « {factTable} »."
        };
        return (true, null, payload);
    }

    /// <summary>
    /// Crée une vue enregistrée sur une table Studio EXISTANTE (PR 2.4) : le schéma est RELU ici
    /// (champs et vues présentes), la spec du modèle est confrontée aux vraies clés avec
    /// avertissements, puis la création passe par <c>CreateCustomRecordViewCommand</c> — la MÊME
    /// commande que le concepteur humain (validation, quota, audit mutualisés).
    /// </summary>
    private async Task<(bool Success, string? Error, object? Payload)> ExecuteRecordViewAsync(
        ParsedRecordViewSpec spec, IStudioBuildProgress? progress, CancellationToken ct)
    {
        void Report(string phase, string label, string status, string? detail = null) =>
            progress?.Report(new StudioBuildStep(phase, label, status, null, detail));

        if (string.IsNullOrWhiteSpace(spec.EntityKey))
            return (false, "La vue enregistrée n'indique pas de table cible.", null);

        Report("reading_schema", $"Lecture de « {spec.EntityKey} »", "running");
        var schemaResult = await _mediator.Send(new GetCustomEntitySchemaQuery(spec.EntityKey), ct);
        if (!schemaResult.IsSuccess)
        {
            Report("failed", "Table introuvable", "error", spec.EntityKey);
            return (false, schemaResult.Error.Description, null);
        }
        var schema = schemaResult.Value;
        Report("reading_schema", $"Lecture de « {schema.Entity.Key} »", "done");

        var (mode, definition, warnings) = StudioAiRecordViewSpec.ResolveAgainstSchema(spec, schema.Fields);
        var key = StudioAiRecordViewSpec.SlugKey(
            spec.DisplayName, schema.Views.Select(v => v.Key).ToHashSet(StringComparer.Ordinal));

        Report("creating_record_view", $"Vue « {spec.DisplayName} »", "running");
        var result = await _mediator.Send(new CreateCustomRecordViewCommand(schema.Entity.Key,
            new SaveCustomRecordViewRequest(key, spec.DisplayName, mode, definition, spec.IsDefault)), ct);
        if (!result.IsSuccess)
        {
            Report("creating_record_view", $"Vue « {spec.DisplayName} »", "error", result.Error.Description);
            return (false, result.Error.Description, null);
        }
        Report("creating_record_view", $"Vue « {spec.DisplayName} »", "done");
        Report("completed", "Vue enregistrée créée", "done");

        var view = result.Value;
        var payload = new
        {
            success = true,
            viewId = view.Id,
            viewKey = view.Key,
            entityKey = schema.Entity.Key,
            mode = mode.ToString(),
            openUrl = $"/studio/d/{schema.Entity.Key}?view={view.Id}",
            warnings,
            message = $"Vue « {view.DisplayName} » créée."
        };
        return (true, null, payload);
    }

    /// <summary>
    /// Crée une fenêtre (vue lecture seule). Le schéma est RELU ici : la table et les colonnes sont
    /// revalidées par le fournisseur gardé au moment de l'exécution, pas seulement à l'aperçu.
    /// </summary>
    private async Task<(bool Success, string? Error, object? Payload)> ExecuteViewAsync(
        ParsedViewSpec spec, Guid tenantId, IStudioBuildProgress? progress, CancellationToken ct)
    {
        void Report(string phase, string label, string status, string? detail = null) =>
            progress?.Report(new StudioBuildStep(phase, label, status, null, detail));

        if (_sqlSchema is null)
            return (false, "Introspection des tables indisponible.", null);

        Report("reading_schema", $"Lecture de « {spec.Table} »", "running");
        var columns = await _sqlSchema.ListColumnsAsync(tenantId, spec.Table, ct);
        if (columns is null)
        {
            Report("failed", "Table non autorisée", "error", spec.Table);
            return (false, $"Table « {spec.Table} » non autorisée ou introuvable.", null);
        }
        Report("reading_schema", $"Lecture de « {spec.Table} »", "done");

        var (definition, warnings) = StudioAiViewSpec.ResolveAgainstSchema(spec, columns);
        if (definition.Columns.Count == 0)
            return (false, $"Aucune colonne reconnue sur la table « {spec.Table} ».", null);

        Report("creating_view", $"Fenêtre « {spec.Title} »", "running");
        var result = await _mediator.Send(new UpsertCustomViewCommand(null,
            new SaveCustomViewRequest(null, spec.Title, spec.Table, definition)), ct);
        if (!result.IsSuccess)
        {
            Report("creating_view", $"Fenêtre « {spec.Title} »", "error", result.Error.Description);
            return (false, result.Error.Description, null);
        }
        Report("creating_view", $"Fenêtre « {spec.Title} »", "done");
        Report("completed", "Fenêtre créée", "done");

        var view = result.Value;
        var payload = new
        {
            success = true,
            viewKey = view.Key,
            displayName = view.DisplayName,
            table = view.SourceTable,
            columnCount = definition.Columns.Count,
            warnings,
            openUrl = $"/studio/v/{view.Key}",
            message = $"Fenêtre « {view.DisplayName} » créée sur « {view.SourceTable} » "
                + $"avec {definition.Columns.Count} colonne(s)."
        };
        return (true, null, payload);
    }

    private static string UniqueEntityKey(string displayName, HashSet<string> used)
    {
        var baseKey = StudioAiAppSpec.SlugKey(displayName);
        if (string.IsNullOrEmpty(baseKey) || !StudioKey.IsValidShape(baseKey)) baseKey = "table";
        var key = baseKey;
        var i = 1;
        while (used.Contains(key)) key = $"{baseKey}_{++i}";
        return key;
    }
}
