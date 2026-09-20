using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Commands;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Gardes des quatre pièges qui transformaient tout échec du mode Studio en message générique
/// « Je n'ai pas réussi à créer ce système », y compris sur une demande d'état.
/// </summary>
public sealed class StudioSilentFailureGuardsTests
{
    // ---- C3 : le repli de redaction doit franchir le seuil de « réponse significative » ----

    [Fact]
    public void The_redaction_fallback_clears_the_meaningful_text_threshold()
    {
        var threshold = new OllamaSettings().MinAssistantTextCharsForCompleteResponse;

        Assert.True(
            AssistantVisibleContentFormatter.HasMeaningfulAssistantText(
                AssistantVisibleContentFormatter.StudioRedactionFallback, threshold),
            $"Le repli fait {AssistantVisibleContentFormatter.StudioRedactionFallback.Length} caractères "
            + $"pour un seuil de {threshold} : il retomberait dans le filet anti-silence.");
    }

    [Fact]
    public void A_fully_internal_answer_yields_the_neutral_fallback()
    {
        // Réponse entièrement « interne » : la redaction vide tout et doit rendre un texte utilisable.
        var redacted = AssistantVisibleContentFormatter.RedactStudioInternalLeaks(
            "studio_run_report\nstudio_plan_report");

        Assert.Equal(AssistantVisibleContentFormatter.StudioRedactionFallback, redacted);
    }

    [Fact]
    public void The_neutral_fallback_presumes_neither_a_table_nor_a_report()
    {
        var text = AssistantVisibleContentFormatter.StudioRedactionFallback;
        Assert.Contains("table", text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("état", text, StringComparison.OrdinalIgnoreCase);
    }

    // ---- C5 : la synthèse forcée revit en mode Studio ----

    [Fact]
    public void Forced_synthesis_is_available_in_studio_even_without_tools()
    {
        // Configuration réelle : ForceFinalSynthesisOnlyAfterTools = true, aucun outil exécuté.
        Assert.True(SendChatMessageHandler.ShouldForceFinalSynthesis(
            isScreenAnalysis: false,
            forceEnabled: true,
            meaningfulResponseDelivered: false,
            toolsWereExecuted: false,
            onlyAfterTools: true,
            screenAnalysisForceFinalSynthesisEnabled: false,
            isStudioBuilder: true));
    }

    [Fact]
    public void Other_modes_keep_the_historical_semantics()
    {
        // Même situation hors Studio : le comportement d'avant est conservé à l'identique.
        Assert.False(SendChatMessageHandler.ShouldForceFinalSynthesis(
            isScreenAnalysis: false,
            forceEnabled: true,
            meaningfulResponseDelivered: false,
            toolsWereExecuted: false,
            onlyAfterTools: true,
            screenAnalysisForceFinalSynthesisEnabled: false));

        // Une réponse déjà délivrée n'est jamais réécrite, Studio compris.
        Assert.False(SendChatMessageHandler.ShouldForceFinalSynthesis(
            isScreenAnalysis: false,
            forceEnabled: true,
            meaningfulResponseDelivered: true,
            toolsWereExecuted: false,
            onlyAfterTools: true,
            screenAnalysisForceFinalSynthesisEnabled: false,
            isStudioBuilder: true));
    }

    // ---- C6 : le message suit l'intention de la DEMANDE ----

    [Fact]
    public void The_user_message_decides_the_wording_when_the_model_produced_nothing()
    {
        Assert.Equal(
            StudioTextToolCallRecovery.ReformulateReportMessage,
            StudioTextToolCallRecovery.ResolveReformulateMessage(
                toolName: null, content: null, userMessage: "créer un rapport détaillé de ventes d'articles"));

        Assert.Equal(
            StudioTextToolCallRecovery.ReformulateMessage,
            StudioTextToolCallRecovery.ResolveReformulateMessage(
                toolName: null, content: null, userMessage: "crée une table Employés avec les champs nom et poste"));
    }

    [Fact]
    public void The_tool_name_still_wins_over_the_user_message()
    {
        Assert.Equal(
            StudioTextToolCallRecovery.ReformulateReportMessage,
            StudioTextToolCallRecovery.ResolveReformulateMessage(
                "studio_plan_report", content: null, userMessage: "crée une table avec les champs nom et date"));
    }

    // ---- C7 : une spécification d'état écrite en prose est récupérée ----

    [Theory]
    [InlineData("""{"preset":"ventes_par_produit","from":"2026-01-01","to":"2026-03-31"}""")]
    [InlineData("""{"source":"InvoiceLines","groupBy":["InvoiceLines_ProductName"]}""")]
    [InlineData("""{"source":"InvoiceLines","measures":[{"field":"InvoiceLines_Total","fn":"sum"}]}""")]
    public void A_bare_report_spec_is_recovered_into_a_tool_call(string json)
    {
        Assert.True(StudioTextToolCallRecovery.TryExtractBareStudioSpec(json, out var kind, out var spec));
        Assert.Equal(BareStudioSpecKind.Report, kind);
        Assert.False(string.IsNullOrWhiteSpace(spec));

        // Un état écrit en prose se CALCULE : jamais un enregistrement implicite.
        Assert.Equal("studio_run_report", StudioTextToolCallRecovery.ResolveToolName(kind, planPreview: true));
        Assert.Equal("studio_run_report", StudioTextToolCallRecovery.ResolveToolName(kind, planPreview: false));
    }

    [Fact]
    public void A_source_without_any_analysis_shape_is_not_a_report_spec()
    {
        Assert.False(StudioTextToolCallRecovery.TryExtractBareStudioSpec(
            """{"source":"InvoiceLines"}""", out _, out _));
    }

    [Fact]
    public void Table_and_system_specs_keep_their_historical_routing()
    {
        Assert.True(StudioTextToolCallRecovery.TryExtractBareStudioSpec(
            """{"entity":{"displayName":"X"},"fields":[{"label":"A","type":"text"}]}""",
            out var appKind, out _));
        Assert.Equal(BareStudioSpecKind.App, appKind);

        Assert.True(StudioTextToolCallRecovery.TryExtractBareStudioSpec(
            """{"system":{"displayName":"X"},"entities":[{"ref":"a","displayName":"A"}]}""",
            out var systemKind, out _));
        Assert.Equal(BareStudioSpecKind.System, systemKind);
    }

    // ---- C2 : le focus du catalogue est additif et réversible ----

    private static IReadOnlyList<string> Catalogue(StudioToolFocus focus) =>
        AiToolRegistry.GetDefinitionsForMode(
                AssistantMode.StudioBuilder, enableMutationTools: true,
                agentScope: AssistantAgentScope.None,
                studioPlanPreview: true, studioModifyTools: true, studioViewTools: true,
                studioReportTools: true, studioFocus: focus)
            .Select(t => t.Name)
            .ToList();

    [Fact]
    public void Focus_none_keeps_the_full_catalogue()
    {
        var full = Catalogue(StudioToolFocus.None);
        Assert.Contains("studio_plan_system", full);
        Assert.Contains("studio_run_report", full);
        Assert.Contains("studio_plan_view", full);
    }

    [Fact]
    public void Report_focus_hides_the_construction_tools()
    {
        var report = Catalogue(StudioToolFocus.Report);

        Assert.Contains("studio_run_report", report);
        Assert.Contains("studio_list_report_sources", report);
        Assert.Contains("propose_follow_up_prompts", report);

        Assert.DoesNotContain("studio_plan_system", report);
        Assert.DoesNotContain("studio_plan_app", report);
        Assert.DoesNotContain("studio_plan_view", report);
        Assert.DoesNotContain("studio_plan_changes", report);

        // Le catalogue focalisé pèse nettement moins : c'est tout l'objet de la manœuvre.
        Assert.True(report.Count < Catalogue(StudioToolFocus.None).Count);
    }

    [Fact]
    public void Build_focus_hides_the_report_tools()
    {
        var build = Catalogue(StudioToolFocus.Build);

        Assert.Contains("studio_plan_system", build);
        Assert.DoesNotContain("studio_run_report", build);
        Assert.DoesNotContain("studio_plan_report", build);
    }

    [Fact]
    public void A_focus_that_would_empty_the_catalogue_is_ignored()
    {
        // Outils d'états désactivés + focus Report : mieux vaut le catalogue complet qu'un modèle
        // sans aucun outil actionnable.
        var names = AiToolRegistry.GetDefinitionsForMode(
                AssistantMode.StudioBuilder, enableMutationTools: true,
                agentScope: AssistantAgentScope.None,
                studioPlanPreview: true, studioModifyTools: false, studioViewTools: false,
                studioReportTools: false, studioFocus: StudioToolFocus.Report)
            .Select(t => t.Name)
            .ToList();

        Assert.Contains("studio_plan_app", names);
    }

    // ---- PR 2.4 : une vue enregistrée dégradée n'est JAMAIS silencieuse ----

    private static readonly IReadOnlyList<CustomFieldDto> ViewFields =
    [
        new CustomFieldDto(Guid.NewGuid(), "titre", "Titre", CustomFieldType.Text, false, false, 1, null, null, null, true),
        new CustomFieldDto(Guid.NewGuid(), "statut", "Statut", CustomFieldType.Select, false, false, 2, null,
            new List<SelectOptionDto> { new("ouvert", "Ouvert") }, null, true),
        new CustomFieldDto(Guid.NewGuid(), "echeance", "Échéance", CustomFieldType.Date, false, false, 3, null, null, null, true),
        new CustomFieldDto(Guid.NewGuid(), "score", "Score", CustomFieldType.Formula, false, false, 4, null, null, null, true),
    ];

    /// <summary>Chaque scénario de dégradation doit produire AU MOINS un avertissement explicite.</summary>
    [Theory]
    // colonne / filtre / tri inconnus
    [InlineData("""{"entity":"t","name":"v","columns":["fantome"]}""")]
    [InlineData("""{"entity":"t","name":"v","filters":[{"field":"fantome","op":"eq","value":1}]}""")]
    [InlineData("""{"entity":"t","name":"v","sort":[{"field":"fantome"}]}""")]
    // opérateur incompatible avec le type (gte sur un texte)
    [InlineData("""{"entity":"t","name":"v","filters":[{"field":"titre","op":"gte","value":1}]}""")]
    // tri sur champ calculé
    [InlineData("""{"entity":"t","name":"v","sort":[{"field":"score"}]}""")]
    // kanban sans regroupement / calendrier sans champ date : dégradés en Liste
    [InlineData("""{"entity":"t","name":"v","mode":"kanban"}""")]
    [InlineData("""{"entity":"t","name":"v","mode":"calendar","start":"titre"}""")]
    public void A_degraded_record_view_spec_always_emits_a_warning(string specJson)
    {
        Assert.True(StudioAiRecordViewSpec.TryParse(specJson, out var spec, out var error), error);

        var (_, _, warnings) = StudioAiRecordViewSpec.ResolveAgainstSchema(spec!, ViewFields);

        Assert.NotEmpty(warnings);
        Assert.All(warnings, w => Assert.False(string.IsNullOrWhiteSpace(w)));
    }

    [Fact]
    public void A_well_formed_record_view_spec_emits_no_warning()
    {
        // Contrepoint : une spec entièrement valide ne doit PAS être avertie (bruit = silence futur).
        Assert.True(StudioAiRecordViewSpec.TryParse(
            """{"entity":"t","name":"Kanban","mode":"kanban","columns":["titre","statut"],"groupBy":"statut"}""",
            out var spec, out var error), error);

        var (mode, _, warnings) = StudioAiRecordViewSpec.ResolveAgainstSchema(spec!, ViewFields);

        Assert.Equal(CustomRecordViewMode.Kanban, mode);
        Assert.Empty(warnings);
    }

    // ---- PR 3.1b : une opération d'amendement ignorée ou inapplicable n'est JAMAIS silencieuse ----

    private static CustomEntitySchemaDto AmendmentSchema() => new(
        new CustomEntityDto(Guid.NewGuid(), "contrats", "Contrat", "Contrats", null, null, true, 2, null,
            DateTime.UtcNow, DateTime.UtcNow),
        new[]
        {
            new CustomFieldDto(Guid.NewGuid(), "nom", "Nom", CustomFieldType.Text, false, false, 1, null, null, null, true),
            new CustomFieldDto(Guid.NewGuid(), "statut", "Statut", CustomFieldType.Select, false, false, 2, null,
                new List<SelectOptionDto> { new("actif", "Actif") }, null, true)
        },
        new FormLayout());

    /// <summary>Chaque op 3.1b mal formée est écartée au parsing avec un avertissement non vide.</summary>
    [Theory]
    [InlineData("""{ "op": "reorder_fields", "fields": [] }""")]
    [InlineData("""{ "op": "change_field_type", "key": "nom", "type": "wizard" }""")]
    [InlineData("""{ "op": "change_field_type" }""")]
    [InlineData("""{ "op": "add_relation", "kind": "one_to_one", "target": "clients" }""")]
    [InlineData("""{ "op": "add_relation" }""")]
    [InlineData("""{ "op": "assign_system" }""")]
    [InlineData("""{ "op": "set_view", "mode": "kanban" }""")]
    public void A_malformed_pr31b_amendment_op_is_dropped_with_a_warning(string opJson)
    {
        var json = $$"""{ "target": { "entityKey": "contrats" }, "operations": [ {{opJson}}, { "op": "remove_field", "key": "nom" } ] }""";

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);

        Assert.Single(spec!.Operations); // seule l'opération valide survit
        Assert.NotEmpty(spec.Warnings);
        Assert.All(spec.Warnings, w => Assert.False(string.IsNullOrWhiteSpace(w)));
    }

    /// <summary>
    /// Chaque op 3.1b inapplicable (référence inconnue, drapeau fonctionnel coupé) produit un
    /// avertissement non vide à l'aperçu — jamais une disparition silencieuse.
    /// </summary>
    [Theory]
    // référence de champ inconnue
    [InlineData("""{ "op": "reorder_fields", "fields": ["fantome"] }""")]
    [InlineData("""{ "op": "change_field_type", "key": "fantome", "type": "decimal" }""")]
    // drapeaux fonctionnels coupés (EnableStudioManyToMany / EnableStudioRecordViews)
    [InlineData("""{ "op": "add_relation", "kind": "many_to_many", "target": "clients" }""")]
    [InlineData("""{ "op": "set_view", "mode": "list", "displayName": "Toutes" }""")]
    public void An_inapplicable_pr31b_amendment_op_warns_in_the_preview(string opJson)
    {
        Assert.True(StudioAiAmendmentSpec.TryParse(
            $$"""{ "target": { "entityKey": "contrats" }, "operations": [ {{opJson}} ] }""",
            out var spec, out var error), error);

        var preview = StudioAiAmendmentPlanner.BuildPreview(spec!, AmendmentSchema());

        Assert.NotEmpty(preview.Warnings);
        Assert.All(preview.Warnings, w => Assert.False(string.IsNullOrWhiteSpace(w)));
    }

    // ---- PR 4.1i : la publication des workflows n'est JAMAIS silencieuse (P15) ----

    /// <summary>
    /// Les 3 handlers d'enregistrements (Create/Update/Patch) acceptent un
    /// <c>ILogger&lt;T&gt;?</c> en dernier paramètre OPTIONNEL (défaut null) : la publication des
    /// workflows est journalisée quand un logger est injecté, sans casser les ctors existants (R7).
    /// </summary>
    [Fact]
    public void Record_handlers_accept_an_optional_logger_for_workflow_publication()
    {
        var handlerTypes = new[]
        {
            typeof(CreateCustomRecordCommandHandler),
            typeof(UpdateCustomRecordCommandHandler),
            typeof(PatchCustomRecordCommandHandler)
        };

        foreach (var handlerType in handlerTypes)
        {
            var ctor = Assert.Single(handlerType.GetConstructors());
            var last = ctor.GetParameters().Last();
            Assert.Equal(typeof(ILogger<>).MakeGenericType(handlerType), last.ParameterType);
            Assert.True(last.IsOptional, $"{handlerType.Name} : le logger doit être optionnel (P15).");
            Assert.Null(last.DefaultValue);
        }
    }

    /// <summary>
    /// Garde-fou source : <c>StudioWorkflowLifecycle</c> journalise tout échec de publication en
    /// <c>LogWarning</c> et ne contient aucun <c>catch { }</c> vide (contrairement au Pont legacy,
    /// dont le catch vide est assumé — cf. <c>StudioRecordLifecycle</c>).
    /// </summary>
    [Fact]
    public void Workflow_lifecycle_never_swallows_silently()
    {
        var source = File.ReadAllText(LocateStudioWorkflowLifecycleFile());

        Assert.Contains("LogWarning", source, StringComparison.Ordinal);
        Assert.DoesNotContain("catch { }", source, StringComparison.Ordinal);
    }

    private static string LocateStudioWorkflowLifecycleFile()
    {
        // Remonte depuis le dossier du binaire de test jusqu'à trouver
        // src/Backend/FactuTrust.Application/Features/Studio/Workflows/StudioWorkflowLifecycle.cs.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(
                dir.FullName, "src", "Backend", "FactuTrust.Application", "Features", "Studio",
                "Workflows", "StudioWorkflowLifecycle.cs");
            if (File.Exists(candidate))
                return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException(
            "StudioWorkflowLifecycle.cs introuvable (remontée depuis AppContext.BaseDirectory).");
    }
}
