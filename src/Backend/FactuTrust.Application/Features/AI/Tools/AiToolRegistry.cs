using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.AI.Tools;

/// <summary>
/// Famille d'outils Studio à exposer, déduite de l'intention de l'utilisateur.
/// <see cref="None"/> conserve le catalogue historique à l'identique.
/// </summary>
public enum StudioToolFocus
{
    None = 0,
    /// <summary>Analyse : outils d'états uniquement.</summary>
    Report,
    /// <summary>Construction : tables, systèmes, modifications, fenêtres — sans les états.</summary>
    Build
}

public static class AiToolRegistry
{
    private static readonly HashSet<string> ComplianceToolNames = new(StringComparer.Ordinal)
    {
        "resolve_reporting_period",
        "compliance_check_invoice",
        "get_client_aging",
        "get_client_balances",
        "get_supplier_balances",
        "propose_client_actions",
        "propose_follow_up_prompts",
        "get_accounting_dashboard"
    };

    private static readonly HashSet<string> ScreenAnalysisToolNames = new(StringComparer.Ordinal)
    {
        "resolve_reporting_period",
        "get_sales_revenue",
        "get_commercial_profit",
        "get_client_payments",
        "get_client_balances",
        "get_client_aging",
        "get_stock_snapshot",
        "get_accounting_dashboard",
        "get_supplier_balances",
        "generate_dashboard_config",
        "propose_client_actions",
        "propose_follow_up_prompts",
        "forecast_revenue",
        "get_replenishment_recommendations",
        "get_promotion_recommendations",
        "get_abc_xyz_classification"
    };

    /// <summary>
    /// Focused catalogue for the Studio "AI builder" surface (generation / report / extraction).
    /// Note : <c>studio_build_report</c>, <c>studio_extract_record</c>, <c>studio_list_custom_tables</c>
    /// et <c>studio_query_records</c> figuraient ici sans avoir jamais eu de définition dans
    /// <see cref="All"/> — ils filtraient donc dans le vide. Retirés (comportement inchangé) ; les
    /// états sont désormais servis par <see cref="StudioReportToolNames"/>.
    /// </summary>
    private static readonly HashSet<string> StudioBuilderToolNames = new(StringComparer.Ordinal)
    {
        "studio_generate_app",
        "studio_generate_system",
        "propose_follow_up_prompts"
    };

    /// <summary>
    /// Variante « plan → aperçu → confirmation » du catalogue StudioBuilder : les outils de génération
    /// directe sont remplacés par les outils de PLAN (l'exécution passe par l'endpoint REST de
    /// confirmation, jamais par le LLM). Activée par <c>EnableStudioAiPlanPreview</c>.
    /// </summary>
    private static readonly HashSet<string> StudioBuilderPlanToolNames = new(StringComparer.Ordinal)
    {
        "studio_plan_app",
        "studio_plan_system",
        "propose_follow_up_prompts"
    };

    /// <summary>Modification de l'existant (EnableStudioAiModifyTools) : lecture du schéma + plan de diff.</summary>
    private static readonly HashSet<string> StudioModifyToolNames = new(StringComparer.Ordinal)
    {
        "studio_get_table_schema",
        "studio_plan_changes"
    };

    /// <summary>Fenêtres sur des tables réelles (EnableStudioAiViewTools) : introspection + plan de vue.</summary>
    private static readonly HashSet<string> StudioViewToolNames = new(StringComparer.Ordinal)
    {
        "studio_list_sql_tables",
        "studio_plan_view"
    };

    /// <summary>
    /// États sur les tables réelles (EnableStudioAiReportTools) : catalogue des sources, description
    /// d'une source, exécution en lecture seule, et plan d'enregistrement. Contrairement aux fenêtres,
    /// ces outils sont disponibles MÊME sans le flux d'aperçu : <c>studio_run_report</c> ne crée rien,
    /// il répond. Seul <c>studio_plan_report</c> exige l'aperçu.
    /// </summary>
    private static readonly HashSet<string> StudioReportToolNames = new(StringComparer.Ordinal)
    {
        "studio_list_report_sources",
        "studio_describe_report_source",
        "studio_run_report",
        "studio_plan_report"
    };

    /// <summary>Outils utiles quelle que soit l'intention Studio : jamais retirés par le focus.</summary>
    private static readonly HashSet<string> StudioCrossCuttingToolNames = new(StringComparer.Ordinal)
    {
        "propose_follow_up_prompts"
    };

    /// <summary>
    /// Vues enregistrées proposées par l'IA (PR 2.4, <c>EnableStudioAiRecordViewTools</c>) : un seul
    /// outil de plan, exposé seulement dans le flux d'aperçu (comme <c>studio_plan_view</c>).
    /// </summary>
    public static readonly HashSet<string> StudioRecordViewToolNames = new(StringComparer.Ordinal)
    {
        "studio_plan_record_view"
    };

    /// <summary>
    /// Workflows proposés par l'IA (PR 4.3, <c>EnableStudioAiWorkflowTools</c>) : un seul outil de plan,
    /// exposé seulement dans le flux d'aperçu (comme <c>studio_plan_record_view</c>).
    /// </summary>
    public static readonly HashSet<string> StudioWorkflowToolNames = new(StringComparer.Ordinal)
    {
        "studio_plan_workflow"
    };

    /// <summary>
    /// R7 — outils dont le résultat est poussé au frontend comme événement <c>studio_plan</c>
    /// (carte d'aperçu Valider/Annuler). PR 2.4 : la liste est centralisée ici et couvre désormais
    /// AUSSI <c>studio_plan_changes</c> et <c>studio_plan_view</c> (ils produisaient déjà un plan
    /// confirmable mais leur événement n'était pas émis — changement observable voulu, un seul
    /// événement par appel d'outil). PR 4.3 : + <c>studio_plan_workflow</c>.
    /// </summary>
    public static readonly HashSet<string> StudioPlanEmittingTools = new(StringComparer.Ordinal)
    {
        "studio_plan_app",
        "studio_plan_system",
        "studio_plan_report",
        "studio_plan_changes",
        "studio_plan_view",
        "studio_plan_record_view",
        "studio_plan_workflow"
    };

    /// <param name="enableMutationTools">When false, tools with <see cref="AiToolDefinition.IsMutating"/> are excluded.</param>
    /// <param name="agentScope">
    /// Expert de module optionnel : ne restreint le catalogue qu'en mode Default (les autres modes ont déjà
    /// leur sous-ensemble focalisé). None = comportement historique inchangé.
    /// </param>
    /// <param name="studioPlanPreview">
    /// Quand true, le mode StudioBuilder expose les outils de plan (aperçu + confirmation) à la place des
    /// outils de génération directe. False (défaut) = catalogue historique strictement inchangé.
    /// </param>
    /// <param name="studioReportTools">
    /// États sur les tables réelles. Additif et indépendant de l'aperçu : <c>studio_run_report</c> est
    /// en lecture seule. False (défaut) = catalogue strictement inchangé.
    /// </param>
    /// <param name="studioFocus">
    /// Restreint le catalogue StudioBuilder à la famille d'outils correspondant à l'intention détectée.
    /// Le catalogue complet (11 outils ≈ 9 100 caractères de schémas) sature le budget de contexte et
    /// noie les bons outils ; le focus le divise par trois. <see cref="StudioToolFocus.None"/> (défaut)
    /// = catalogue strictement inchangé.
    /// </param>
    /// <param name="studioRecordViewTools">
    /// Vues enregistrées proposées par l'IA (PR 2.4). Additif, en fin de signature : les appels
    /// existants (positionnels jusqu'à <paramref name="studioFocus"/>) restent valides.
    /// False (défaut) = catalogue strictement inchangé.
    /// </param>
    /// <param name="studioWorkflowTools">
    /// Workflows proposés par l'IA (PR 4.3). Additif, en fin de signature, même garde que
    /// <paramref name="studioRecordViewTools"/> : exposé seulement avec le flux d'aperçu.
    /// False (défaut) = catalogue strictement inchangé.
    /// </param>
    public static IReadOnlyList<AiToolDefinition> GetDefinitionsForMode(
        AssistantMode mode,
        bool enableMutationTools,
        AssistantAgentScope agentScope = AssistantAgentScope.None,
        bool studioPlanPreview = false,
        bool studioModifyTools = false,
        bool studioViewTools = false,
        bool studioReportTools = false,
        StudioToolFocus studioFocus = StudioToolFocus.None,
        bool studioRecordViewTools = false,
        bool studioWorkflowTools = false)
    {
        var studioSet = studioPlanPreview ? StudioBuilderPlanToolNames : StudioBuilderToolNames;
        // Modification et fenêtres ne sont proposées qu'en mode aperçu (rien ne s'applique sans validation).
        if (studioPlanPreview && (studioModifyTools || studioViewTools))
        {
            var expanded = new HashSet<string>(StudioBuilderPlanToolNames, StringComparer.Ordinal);
            if (studioModifyTools) expanded.UnionWith(StudioModifyToolNames);
            if (studioViewTools) expanded.UnionWith(StudioViewToolNames);
            studioSet = expanded;
        }
        // Vues enregistrées (PR 2.4) : même garde que les fenêtres — le plan exige le flux d'aperçu.
        if (studioPlanPreview && studioRecordViewTools)
        {
            var expanded = new HashSet<string>(studioSet, StringComparer.Ordinal);
            expanded.UnionWith(StudioRecordViewToolNames);
            studioSet = expanded;
        }
        // Workflows (PR 4.3) : même garde que les vues enregistrées — le plan exige le flux d'aperçu.
        if (studioPlanPreview && studioWorkflowTools)
        {
            var expanded = new HashSet<string>(studioSet, StringComparer.Ordinal);
            expanded.UnionWith(StudioWorkflowToolNames);
            studioSet = expanded;
        }
        if (studioReportTools)
        {
            var withReports = new HashSet<string>(studioSet, StringComparer.Ordinal);
            withReports.UnionWith(StudioReportToolNames);
            // Sans le flux d'aperçu, le plan d'état n'a pas de chemin de confirmation : on ne l'expose pas.
            if (!studioPlanPreview) withReports.Remove("studio_plan_report");
            studioSet = withReports;
        }
        // Focus : ne montrer que la famille d'outils correspondant à l'intention. Le modèle choisit
        // beaucoup mieux parmi 5 outils que parmi 11, et le budget de contexte respire.
        if (mode == AssistantMode.StudioBuilder && studioFocus != StudioToolFocus.None)
        {
            var focused = new HashSet<string>(studioSet, StringComparer.Ordinal);
            if (studioFocus == StudioToolFocus.Report)
            {
                // Ne garder que les outils d'états (s'ils sont activés) + les outils transverses.
                focused.IntersectWith(StudioReportToolNames.Concat(StudioCrossCuttingToolNames));
            }
            else
            {
                // Construction : retirer les outils d'états, garder tout le reste.
                focused.ExceptWith(StudioReportToolNames);
            }
            // Un focus qui ne laisserait rien d'actionnable serait pire que pas de focus du tout.
            if (focused.Any(name => !StudioCrossCuttingToolNames.Contains(name)))
                studioSet = focused;
        }
        IEnumerable<AiToolDefinition> q = mode switch
        {
            AssistantMode.Compliance => All.Where(t => ComplianceToolNames.Contains(t.Name)),
            AssistantMode.ScreenAnalysis => All.Where(t => ScreenAnalysisToolNames.Contains(t.Name)),
            AssistantMode.StudioBuilder => All.Where(t => studioSet.Contains(t.Name)),
            _ => All
        };
        if (mode == AssistantMode.Default && agentScope != AssistantAgentScope.None)
        {
            var scopeToolNames = AiAgentScopeCatalog.GetToolNames(agentScope);
            q = q.Where(t => scopeToolNames.Contains(t.Name));
        }
        if (!enableMutationTools)
            q = q.Where(t => !t.IsMutating);
        return q.ToList();
    }

    public static AiToolDefinition? GetToolDefinition(string toolName) =>
        All.FirstOrDefault(t => string.Equals(t.Name, toolName, StringComparison.OrdinalIgnoreCase));

    // Descriptions condensées (Phase 2 / 8A) : verbiage réduit, mais TOUTES les directives sont conservées
    // (format yyyy-MM-dd, dériver du CONTEXTE TEMPOREL ou de resolve_reporting_period, « ne pas inventer d'année »
    // = garde anti-hallucination de date). Ces chaînes étant répétées sur de nombreux outils, leur condensation
    // allège le catalogue d'outils envoyé à chaque requête.
    private static readonly string FromDateDesc =
        "Date de début (yyyy-MM-dd). Dériver du CONTEXTE TEMPOREL ou de resolve_reporting_period ; ne pas inventer d'année.";

    private static readonly string ToDateDesc =
        "Date de fin (yyyy-MM-dd). Dériver du CONTEXTE TEMPOREL ou de resolve_reporting_period ; ne pas inventer d'année.";

    private static readonly string AsOfDateDesc =
        "Date de référence (yyyy-MM-dd, optionnel — défaut : aujourd'hui pour l'état du stock actuel). Dériver du CONTEXTE TEMPOREL ; ne pas inventer d'année ; jamais dans le futur.";

    private static readonly string FromDateOptionalDesc =
        "Date de début (yyyy-MM-dd, optionnel). Si besoin, dériver du CONTEXTE TEMPOREL ou de resolve_reporting_period.";

    private static readonly string ToDateOptionalDesc =
        "Date de fin (yyyy-MM-dd, optionnel). Si besoin, dériver du CONTEXTE TEMPOREL ou de resolve_reporting_period.";

    private static readonly string PeriodPresetParamDesc =
        "Preset de période (optionnel, défaut current_month) : today, yesterday, current_month, last_month, last_7_days, last_30_days, current_quarter, last_completed_quarter, year_to_date.";

    private static readonly string RankingTopNParamDesc =
        "Nombre max de lignes du classement, triées par montant décroissant (optionnel, défaut 50, max 200). Ex. 5 pour « top 5 ».";

    public static IReadOnlyList<AiToolDefinition> All { get; } = new List<AiToolDefinition>
    {
        new()
        {
            Name = "resolve_reporting_period",
            Description =
                "Calcule les bornes from_date / to_date (calendrier Tunis) pour une période prédéfinie. Optionnel : les outils get_* acceptent directement preset ou dates. Retourne fromDate, toDate et label.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["preset"] = new()
                {
                    Type = "string",
                    Description =
                        "today = aujourd'hui ; yesterday = hier ; current_month = ce mois-ci ; last_month = mois dernier ; last_7_days = 7 derniers jours ; last_30_days = 30 jours glissants ; current_quarter = trimestre en cours ; last_completed_quarter = dernier trimestre civil complété ; year_to_date = depuis le 1er janvier.",
                    AllowedValues = new()
                    {
                        ReportingPeriodResolver.PresetToday,
                        ReportingPeriodResolver.PresetYesterday,
                        ReportingPeriodResolver.PresetCurrentMonth,
                        ReportingPeriodResolver.PresetLastMonth,
                        ReportingPeriodResolver.PresetLast7Days,
                        ReportingPeriodResolver.PresetLast30Days,
                        ReportingPeriodResolver.PresetCurrentQuarter,
                        ReportingPeriodResolver.PresetLastCompletedQuarter,
                        ReportingPeriodResolver.PresetYearToDate
                    }
                }
            },
            RequiredParameters = new() { "preset" }
        },
        new()
        {
            Name = "get_sales_revenue",
            Description =
                "Chiffre d'affaires (CA) total des ventes facturées par période, regroupé par produit, catégorie, client, ou produit+client. UTILISER pour : CA, revenus, volume de ventes, meilleurs clients par CA. NE PAS utiliser pour : marges, paiements reçus, stock.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["preset"] = new() { Type = "string", Description = PeriodPresetParamDesc },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["group_by"] = new() { Type = "string", Description = "Regroupement : Product, Category, Client, ProductAndClient. Utiliser 'Client' pour les meilleurs/pires clients par CA.", AllowedValues = new() { "Product", "Category", "Client", "ProductAndClient" } },
                ["top_n"] = new() { Type = "integer", Description = RankingTopNParamDesc }
            }
        },
        new()
        {
            Name = "get_client_payments",
            Description = "Paiements clients ENCAISSÉS sur une période. UTILISER pour : encaissements, règlements reçus. NE PAS utiliser pour : CA ou factures émises.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["preset"] = new() { Type = "string", Description = PeriodPresetParamDesc },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc }
            }
        },
        new()
        {
            Name = "get_client_balances",
            Description = "Soldes IMPAYÉS par client (créances). UTILISER pour : qui doit combien, créances. NE PAS utiliser pour : CA ou revenus.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["top_n"] = new() { Type = "integer", Description = RankingTopNParamDesc }
            }
        },
        new()
        {
            Name = "get_commercial_profit",
            Description =
                "Marges commerciales (prix vente - prix achat) par période, regroupées par produit, ligne, mois ou pièce. UTILISER pour : rentabilité, marges. NE PAS utiliser pour : CA brut.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["preset"] = new() { Type = "string", Description = PeriodPresetParamDesc },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["group_by"] = new() { Type = "string", Description = "Regroupement : Product, Line, Month, Piece", AllowedValues = new() { "Product", "Line", "Month", "Piece" } }
            }
        },
        new()
        {
            Name = "get_stock_snapshot",
            Description = "État du stock à une date. UTILISER UNIQUEMENT pour : quantités en stock, inventaire, ruptures. NE PAS utiliser pour : ventes, CA, paiements.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["as_of_date"] = new() { Type = "string", Description = AsOfDateDesc },
                ["warehouse_id"] = new() { Type = "string", Description = "ID de l'entrepôt (optionnel, GUID)" }
            }
        },
        new()
        {
            Name = "get_product_performance",
            Description =
                "Classement des produits par performance (CA, marge, part du CA) sur une période. UTILISER pour : meilleurs/pires produits, ranking. NE PAS utiliser pour : CA total global.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["preset"] = new() { Type = "string", Description = PeriodPresetParamDesc },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["top_n"] = new() { Type = "integer", Description = RankingTopNParamDesc }
            }
        },
        new()
        {
            Name = "get_basket_metrics",
            Description =
                "Panier moyen (montant moyen par facture, nombre moyen de lignes). UTILISER UNIQUEMENT pour : analyse du panier moyen. NE PAS utiliser pour : CA total.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["preset"] = new() { Type = "string", Description = PeriodPresetParamDesc },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc }
            }
        },
        new()
        {
            Name = "get_accounting_dashboard",
            Description = "Résumé comptable global (totaux, soldes, TVA). UTILISER pour : vue d'ensemble comptable. NE PAS utiliser pour : CA détaillé par période.",
            Parameters = new Dictionary<string, AiToolParameter>()
        },
        new()
        {
            Name = "get_client_aging",
            Description = "Balance âgée des clients (créances par tranche d'ancienneté). UTILISER pour : retards de paiement, ancienneté des créances. NE PAS utiliser pour : CA ou paiements reçus.",
            Parameters = new Dictionary<string, AiToolParameter>()
        },
        new()
        {
            Name = "get_product_sales_trend",
            Description =
                "Tendances mensuelles des ventes par produit. UTILISER pour : évolution, tendances. NE PAS utiliser pour : CA total d'une période.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["preset"] = new() { Type = "string", Description = PeriodPresetParamDesc },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc }
            }
        },
        new()
        {
            Name = "get_supplier_balances",
            Description = "Soldes dus aux fournisseurs. UTILISER pour : dettes fournisseurs. NE PAS utiliser pour : clients, CA, ventes.",
            Parameters = new Dictionary<string, AiToolParameter>()
        },
        new()
        {
            Name = "get_products_never_sold",
            Description =
                "Produits actifs sans vente sur une période. UTILISER pour : produits dormants, stock mort. NE PAS utiliser pour : performance ou CA.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["preset"] = new() { Type = "string", Description = PeriodPresetParamDesc },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc }
            }
        },
        new()
        {
            Name = "get_stock_movements",
            Description = "Mouvements de stock (entrées/sorties) sur une période. UTILISER pour : flux de stock. NE PAS utiliser pour : ventes ou CA.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["warehouse_id"] = new() { Type = "string", Description = "ID de l'entrepôt (optionnel, GUID)" }
            }
        },
        new()
        {
            Name = "generate_dashboard_config",
            Description =
                "Générer une configuration JSON de tableau de bord dynamique basée sur les données analysées. Utilisez ce tool quand l'utilisateur demande un tableau de bord, des graphiques ou des visualisations. Le JSON retourné contient des sections de type 'kpi_card', 'table' ou 'chart'. Pour les données chiffrées, s'appuyer sur les outils métier avec des dates issues de resolve_reporting_period si la période est relative.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["title"] = new() { Type = "string", Description = "Titre du tableau de bord" },
                ["sections_json"] = new()
                {
                    Type = "string",
                    Description =
                        "JSON array des sections. Chaque section a un 'type' (kpi_card, table, chart), un 'title', et un 'data' objet. Pour kpi_card: {value, label, trend?, unit?}. Pour table: {columns: [{key, label}], rows: [{...}]}. Optionnellement chaque ligne peut inclure une clé '_links' : objet { [clé colonne]: { \"route\": \"/chemin\", \"queryParams\"?: { \"id\": \"guid\" } } } pour des cellules cliquables (routes internes uniquement). Pour chart: {chartType: 'bar'|'line'|'pie'|'doughnut', labels: [...], datasets: [{label, data: [...]}]}."
                }
            },
            RequiredParameters = new() { "title", "sections_json" }
        },
        new()
        {
            Name = "propose_client_actions",
            Description =
                "Proposer jusqu'à 5 actions de navigation dans l'application FactuTrust (boutons pour l'utilisateur). Chaque action : label court, route (chemin interne commençant par /, sans domaine), queryParams optionnels (objet clé-valeur). Exemples de routes : /invoices, /quotes, /crm/activities, /dashboard, /clients, /accounting/ledger. Ne pas inclure d'URLs externes ni javascript:. Utiliser après avoir identifié une entité pertinente.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["actions_json"] = new()
                {
                    Type = "string",
                    Description =
                        "Tableau JSON d'objets { \"label\": string, \"route\": string, \"queryParams\"?: { \"clé\": \"valeur\" } }. Maximum 5 entrées."
                }
            },
            RequiredParameters = new() { "actions_json" }
        },
        new()
        {
            Name = "propose_follow_up_prompts",
            Description =
                "Proposer jusqu'à 5 questions de suivi (chips) que l'utilisateur peut envoyer en un clic. Formuler des questions courtes et pertinentes par rapport à l'analyse en cours (ex. « Détail par entrepôt », « Articles en rupture »). Pas de HTML ni de liens externes.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["prompts_json"] = new()
                {
                    Type = "string",
                    Description = "Tableau JSON de chaînes de caractères (max 5, chaque max 200 caractères)."
                }
            },
            RequiredParameters = new() { "prompts_json" }
        },
        new()
        {
            Name = "compliance_check_invoice",
            Description =
                "Analyse de cohérence et points de vigilance sur une facture de vente (lecture seule). invoice_id ou invoice_number optionnels — si omis, la facture la plus récente est analysée. Retourne un résumé structuré (état, lignes, client, totaux, mentions manquantes éventuelles).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["invoice_id"] = new()
                {
                    Type = "string",
                    Description = "Identifiant interne de la facture (optionnel)."
                },
                ["invoice_number"] = new()
                {
                    Type = "string",
                    Description = "Numéro de facture, ex. FAC-2026-000123 (optionnel)."
                }
            },
            RequiredParameters = new()
        },
        new()
        {
            Name = "get_product_by_id",
            Description =
                "Obtenir le détail d'un produit par son GUID. Lecture seule. Demander le code ou l'identifiant à l'utilisateur si inconnu.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "Identifiant unique (GUID) du produit." }
            },
            RequiredParameters = new() { "product_id" },
            IsMutating = false,
            RequiredPermission = Permissions.Products.Read
        },
        new()
        {
            Name = "create_product",
            Description =
                "Créer un produit ou service. Champs obligatoires : code, name, unit_price, vat_rate_percent (0, 7, 13 ou 19). Si le code n'est pas fourni par l'utilisateur, le demander explicitement. type = Product ou Service (défaut Product). category_id optionnel (sinon catégorie par défaut du tenant).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["code"] = new() { Type = "string", Description = "Code article unique." },
                ["name"] = new() { Type = "string", Description = "Libellé du produit." },
                ["unit_price"] = new() { Type = "number", Description = "Prix de vente unitaire HT (>= 0)." },
                ["vat_rate_percent"] = new()
                {
                    Type = "integer",
                    Description = "Taux TVA tunisien : 0, 7, 13 ou 19.",
                    AllowedValues = new() { "0", "7", "13", "19" }
                },
                ["type"] = new()
                {
                    Type = "string",
                    Description = "Product (physique) ou Service.",
                    AllowedValues = new() { "Product", "Service" }
                },
                ["description"] = new() { Type = "string", Description = "Description (optionnel)." },
                ["purchase_price"] = new() { Type = "number", Description = "Prix d'achat (optionnel)." },
                ["unit"] = new() { Type = "string", Description = "Unité de mesure (optionnel)." },
                ["is_stock_managed"] = new() { Type = "boolean", Description = "Gestion de stock (optionnel)." },
                ["category_id"] = new() { Type = "string", Description = "GUID catégorie (optionnel)." }
            },
            RequiredParameters = new() { "code", "name", "unit_price", "vat_rate_percent" },
            IsMutating = true,
            RequiredPermission = Permissions.Products.Create
        },
        new()
        {
            Name = "update_product",
            Description =
                "Mettre à jour un produit existant. Fournir product_id et au minimum name, unit_price, vat_rate_percent. Les champs optionnels absents conservent les valeurs actuelles du produit.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "GUID du produit." },
                ["name"] = new() { Type = "string", Description = "Libellé." },
                ["unit_price"] = new() { Type = "number", Description = "Prix unitaire HT (>= 0)." },
                ["vat_rate_percent"] = new()
                {
                    Type = "integer",
                    Description = "0, 7, 13 ou 19.",
                    AllowedValues = new() { "0", "7", "13", "19" }
                },
                ["description"] = new() { Type = "string", Description = "Description (optionnel, écrase si fourni)." },
                ["purchase_price"] = new() { Type = "number", Description = "Prix d'achat (optionnel)." },
                ["unit"] = new() { Type = "string", Description = "Unité (optionnel)." },
                ["is_stock_managed"] = new() { Type = "boolean", Description = "Gestion stock (optionnel)." },
                ["category_id"] = new() { Type = "string", Description = "GUID catégorie (optionnel)." }
            },
            RequiredParameters = new() { "product_id", "name", "unit_price", "vat_rate_percent" },
            IsMutating = true,
            RequiredPermission = Permissions.Products.Update
        },
        new()
        {
            Name = "delete_product",
            Description = "Supprimer un produit (échoue s'il est utilisé sur des factures).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "GUID du produit." }
            },
            RequiredParameters = new() { "product_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Products.Delete
        },
        new()
        {
            Name = "accept_quote",
            Description = "Marquer un devis comme accepté.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["quote_id"] = new() { Type = "string", Description = "GUID du devis." }
            },
            RequiredParameters = new() { "quote_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Quotes.Update
        },
        new()
        {
            Name = "reject_quote",
            Description = "Rejeter un devis. Raison optionnelle.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["quote_id"] = new() { Type = "string", Description = "GUID du devis." },
                ["reason"] = new() { Type = "string", Description = "Motif (optionnel)." }
            },
            RequiredParameters = new() { "quote_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Quotes.Update
        },
        new()
        {
            Name = "send_quote",
            Description = "Envoyer un devis au client (même flux que l'UI).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["quote_id"] = new() { Type = "string", Description = "GUID du devis." }
            },
            RequiredParameters = new() { "quote_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Quotes.Update
        },
        new()
        {
            Name = "record_invoice_payment",
            Description =
                "Enregistrer un paiement sur une facture client. payment_date (yyyy-MM-dd), amount et method recommandés. method : Cash, BankTransfer, Check, Card, MobilePayment, Other.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["invoice_id"] = new() { Type = "string", Description = "GUID de la facture." },
                ["payment_date"] = new() { Type = "string", Description = "Date d'encaissement yyyy-MM-dd." },
                ["amount"] = new() { Type = "number", Description = "Montant (optionnel selon règles métier)." },
                ["method"] = new()
                {
                    Type = "string",
                    Description = "Moyen de paiement.",
                    AllowedValues = new()
                    {
                        "Cash", "BankTransfer", "Check", "Card", "MobilePayment", "Other"
                    }
                },
                ["reference"] = new() { Type = "string", Description = "Référence bancaire/chèque (optionnel)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." },
                ["client_withholding_amount"] = new() { Type = "number", Description = "Retenue à la source (optionnel)." }
            },
            RequiredParameters = new() { "invoice_id", "payment_date" },
            IsMutating = true,
            RequiredPermission = Permissions.Payments.Create
        },

        // ────────── Catégories de produits ──────────
        new()
        {
            Name = "get_product_categories",
            Description = "Lister toutes les catégories de produits. Retourne code, nom, ordre d'affichage et statut actif.",
            Parameters = new Dictionary<string, AiToolParameter>(),
            IsMutating = false,
            RequiredPermission = Permissions.Products.Read
        },
        new()
        {
            Name = "create_product_category",
            Description = "Créer une catégorie de produits. Champs obligatoires : code, name. display_order optionnel (entier).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["code"] = new() { Type = "string", Description = "Code unique de la catégorie." },
                ["name"] = new() { Type = "string", Description = "Nom de la catégorie." },
                ["display_order"] = new() { Type = "integer", Description = "Ordre d'affichage (optionnel, défaut 0)." }
            },
            RequiredParameters = new() { "code", "name" },
            IsMutating = true,
            RequiredPermission = Permissions.Products.Create
        },
        new()
        {
            Name = "update_product_category",
            Description = "Mettre à jour une catégorie de produits. Fournir category_id, name. display_order et is_active optionnels.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["category_id"] = new() { Type = "string", Description = "GUID de la catégorie." },
                ["name"] = new() { Type = "string", Description = "Nom de la catégorie." },
                ["display_order"] = new() { Type = "integer", Description = "Ordre d'affichage (optionnel)." },
                ["is_active"] = new() { Type = "boolean", Description = "Actif/inactif (optionnel)." }
            },
            RequiredParameters = new() { "category_id", "name" },
            IsMutating = true,
            RequiredPermission = Permissions.Products.Update
        },

        // ────────── Clients ──────────
        new()
        {
            Name = "search_clients",
            Description = "Rechercher des clients avec filtres optionnels. Retourne une liste paginée (nom, email, ville, CA total). UTILISER pour trouver un client par nom ou email.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["search"] = new() { Type = "string", Description = "Terme de recherche (nom, email, NIF)." },
                ["is_active"] = new() { Type = "boolean", Description = "Filtrer par statut actif (optionnel)." },
                ["page"] = new() { Type = "integer", Description = "Page (défaut 1)." },
                ["page_size"] = new() { Type = "integer", Description = "Taille de page (défaut 20, max 50)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.Clients.Read
        },
        new()
        {
            Name = "get_client_by_id",
            Description = "Obtenir le détail d'un client par son GUID. Retourne nom, type, NIF, adresse, email, téléphone, notes.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["client_id"] = new() { Type = "string", Description = "Identifiant unique (GUID) du client." }
            },
            RequiredParameters = new() { "client_id" },
            IsMutating = false,
            RequiredPermission = Permissions.Clients.Read
        },
        new()
        {
            Name = "create_client",
            Description = "Créer un client. Champs obligatoires : name, email, street, city, governorate. type : Individual ou Business (défaut Individual). nif obligatoire pour Business.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["name"] = new() { Type = "string", Description = "Nom ou raison sociale." },
                ["email"] = new() { Type = "string", Description = "Email du client." },
                ["type"] = new() { Type = "string", Description = "Individual ou Business.", AllowedValues = new() { "Individual", "Business" } },
                ["nif"] = new() { Type = "string", Description = "Matricule fiscal (obligatoire pour Business)." },
                ["street"] = new() { Type = "string", Description = "Adresse (rue)." },
                ["city"] = new() { Type = "string", Description = "Ville." },
                ["governorate"] = new() { Type = "string", Description = "Gouvernorat." },
                ["phone"] = new() { Type = "string", Description = "Téléphone (optionnel)." },
                ["contact_person"] = new() { Type = "string", Description = "Personne de contact (optionnel)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." }
            },
            RequiredParameters = new() { "name", "email", "street", "city", "governorate" },
            IsMutating = true,
            RequiredPermission = Permissions.Clients.Create
        },
        new()
        {
            Name = "update_client",
            Description = "Mettre à jour un client existant. Fournir client_id et les champs à modifier.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["client_id"] = new() { Type = "string", Description = "GUID du client." },
                ["name"] = new() { Type = "string", Description = "Nom ou raison sociale." },
                ["email"] = new() { Type = "string", Description = "Email." },
                ["street"] = new() { Type = "string", Description = "Adresse (rue)." },
                ["city"] = new() { Type = "string", Description = "Ville." },
                ["governorate"] = new() { Type = "string", Description = "Gouvernorat." },
                ["phone"] = new() { Type = "string", Description = "Téléphone (optionnel)." },
                ["contact_person"] = new() { Type = "string", Description = "Personne de contact (optionnel)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." },
                ["is_active"] = new() { Type = "boolean", Description = "Actif/inactif (optionnel)." }
            },
            RequiredParameters = new() { "client_id", "name", "email", "street", "city", "governorate" },
            IsMutating = true,
            RequiredPermission = Permissions.Clients.Update
        },
        new()
        {
            Name = "delete_client",
            Description = "Supprimer un client (échoue s'il a des factures).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["client_id"] = new() { Type = "string", Description = "GUID du client." }
            },
            RequiredParameters = new() { "client_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Clients.Delete
        },

        // ────────── Fournisseurs ──────────
        new()
        {
            Name = "search_suppliers",
            Description = "Rechercher des fournisseurs avec filtres optionnels. Retourne une liste paginée.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["search"] = new() { Type = "string", Description = "Terme de recherche (nom, email, NIF)." },
                ["is_active"] = new() { Type = "boolean", Description = "Filtrer par statut actif (optionnel)." },
                ["page"] = new() { Type = "integer", Description = "Page (défaut 1)." },
                ["page_size"] = new() { Type = "integer", Description = "Taille de page (défaut 20, max 50)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.Suppliers.Read
        },
        new()
        {
            Name = "get_supplier_by_id",
            Description = "Obtenir le détail d'un fournisseur par son GUID.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["supplier_id"] = new() { Type = "string", Description = "Identifiant unique (GUID) du fournisseur." }
            },
            RequiredParameters = new() { "supplier_id" },
            IsMutating = false,
            RequiredPermission = Permissions.Suppliers.Read
        },
        new()
        {
            Name = "create_supplier",
            Description = "Créer un fournisseur. Champs obligatoires : name, email, street, city, governorate.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["name"] = new() { Type = "string", Description = "Nom ou raison sociale." },
                ["email"] = new() { Type = "string", Description = "Email." },
                ["street"] = new() { Type = "string", Description = "Adresse (rue)." },
                ["city"] = new() { Type = "string", Description = "Ville." },
                ["governorate"] = new() { Type = "string", Description = "Gouvernorat." },
                ["nif"] = new() { Type = "string", Description = "Matricule fiscal (optionnel)." },
                ["phone"] = new() { Type = "string", Description = "Téléphone (optionnel)." },
                ["contact_person"] = new() { Type = "string", Description = "Personne de contact (optionnel)." },
                ["payment_term_days"] = new() { Type = "integer", Description = "Délai de paiement en jours (défaut 30)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." }
            },
            RequiredParameters = new() { "name", "email", "street", "city", "governorate" },
            IsMutating = true,
            RequiredPermission = Permissions.Suppliers.Create
        },
        new()
        {
            Name = "update_supplier",
            Description = "Mettre à jour un fournisseur existant.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["supplier_id"] = new() { Type = "string", Description = "GUID du fournisseur." },
                ["name"] = new() { Type = "string", Description = "Nom ou raison sociale." },
                ["email"] = new() { Type = "string", Description = "Email." },
                ["street"] = new() { Type = "string", Description = "Adresse (rue)." },
                ["city"] = new() { Type = "string", Description = "Ville." },
                ["governorate"] = new() { Type = "string", Description = "Gouvernorat." },
                ["phone"] = new() { Type = "string", Description = "Téléphone (optionnel)." },
                ["contact_person"] = new() { Type = "string", Description = "Personne de contact (optionnel)." },
                ["payment_term_days"] = new() { Type = "integer", Description = "Délai de paiement en jours." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." }
            },
            RequiredParameters = new() { "supplier_id", "name", "email", "street", "city", "governorate" },
            IsMutating = true,
            RequiredPermission = Permissions.Suppliers.Update
        },
        new()
        {
            Name = "delete_supplier",
            Description = "Supprimer un fournisseur (échoue s'il a des commandes ou factures).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["supplier_id"] = new() { Type = "string", Description = "GUID du fournisseur." }
            },
            RequiredParameters = new() { "supplier_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Suppliers.Delete
        },

        // ────────── Factures de vente ──────────
        new()
        {
            Name = "search_invoices",
            Description = "Rechercher des factures de vente avec filtres optionnels. Retourne une liste paginée (numéro, date, client, montant, statut).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["search"] = new() { Type = "string", Description = "Terme de recherche (numéro, client)." },
                ["status"] = new() { Type = "string", Description = "Statut : Draft, Validated, Sent, Paid, Cancelled.", AllowedValues = new() { "Draft", "Validated", "Sent", "Paid", "Cancelled" } },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["client_id"] = new() { Type = "string", Description = "GUID du client (optionnel)." },
                ["unpaid_only"] = new() { Type = "boolean", Description = "Uniquement les factures impayées (optionnel)." },
                ["page"] = new() { Type = "integer", Description = "Page (défaut 1)." },
                ["page_size"] = new() { Type = "integer", Description = "Taille de page (défaut 20, max 50)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.Invoices.Read
        },
        new()
        {
            Name = "get_invoice_by_id",
            Description = "Obtenir le détail complet d'une facture par son GUID (lignes, client, totaux, paiements).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["invoice_id"] = new() { Type = "string", Description = "Identifiant unique (GUID) de la facture." }
            },
            RequiredParameters = new() { "invoice_id" },
            IsMutating = false,
            RequiredPermission = Permissions.Invoices.Read
        },
        new()
        {
            Name = "validate_invoice",
            Description = "Valider une facture brouillon (passe en statut Validé).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["invoice_id"] = new() { Type = "string", Description = "GUID de la facture." }
            },
            RequiredParameters = new() { "invoice_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Invoices.Update
        },
        new()
        {
            Name = "sign_invoice",
            Description = "Signer électroniquement une facture. Retourne le hash de signature.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["invoice_id"] = new() { Type = "string", Description = "GUID de la facture." }
            },
            RequiredParameters = new() { "invoice_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Invoices.Sign
        },
        new()
        {
            Name = "send_invoice_email",
            Description = "Envoyer une facture par email au client.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["invoice_id"] = new() { Type = "string", Description = "GUID de la facture." }
            },
            RequiredParameters = new() { "invoice_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Invoices.Send
        },

        // ────────── Devis ──────────
        new()
        {
            Name = "search_quotes",
            Description = "Rechercher des devis avec filtres optionnels. Retourne une liste paginée.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["search"] = new() { Type = "string", Description = "Terme de recherche (numéro, client)." },
                ["status"] = new() { Type = "string", Description = "Statut : Draft, Sent, Accepted, Rejected, Expired, Cancelled.", AllowedValues = new() { "Draft", "Sent", "Accepted", "Rejected", "Expired", "Cancelled" } },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["client_id"] = new() { Type = "string", Description = "GUID du client (optionnel)." },
                ["page"] = new() { Type = "integer", Description = "Page (défaut 1)." },
                ["page_size"] = new() { Type = "integer", Description = "Taille de page (défaut 20, max 50)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.Quotes.Read
        },
        new()
        {
            Name = "get_quote_by_id",
            Description = "Obtenir le détail complet d'un devis par son GUID (lignes, client, totaux).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["quote_id"] = new() { Type = "string", Description = "Identifiant unique (GUID) du devis." }
            },
            RequiredParameters = new() { "quote_id" },
            IsMutating = false,
            RequiredPermission = Permissions.Quotes.Read
        },

        // ────────── Bons de livraison ──────────
        new()
        {
            Name = "search_delivery_notes",
            Description = "Rechercher des bons de livraison avec filtres optionnels.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["search"] = new() { Type = "string", Description = "Terme de recherche (numéro, client)." },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["client_id"] = new() { Type = "string", Description = "GUID du client (optionnel)." },
                ["page"] = new() { Type = "integer", Description = "Page (défaut 1)." },
                ["page_size"] = new() { Type = "integer", Description = "Taille de page (défaut 20, max 50)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.DeliveryNotes.Read
        },
        new()
        {
            Name = "get_delivery_note_by_id",
            Description = "Obtenir le détail d'un bon de livraison par son GUID.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["delivery_note_id"] = new() { Type = "string", Description = "Identifiant unique (GUID) du bon de livraison." }
            },
            RequiredParameters = new() { "delivery_note_id" },
            IsMutating = false,
            RequiredPermission = Permissions.DeliveryNotes.Read
        },

        // ────────── Commandes fournisseurs ──────────
        new()
        {
            Name = "search_purchase_orders",
            Description = "Rechercher des commandes fournisseurs avec filtres optionnels.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["search"] = new() { Type = "string", Description = "Terme de recherche (numéro, fournisseur)." },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["supplier_id"] = new() { Type = "string", Description = "GUID du fournisseur (optionnel)." },
                ["page"] = new() { Type = "integer", Description = "Page (défaut 1)." },
                ["page_size"] = new() { Type = "integer", Description = "Taille de page (défaut 20, max 50)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.PurchaseOrders.Read
        },
        new()
        {
            Name = "get_purchase_order_by_id",
            Description = "Obtenir le détail d'une commande fournisseur par son GUID.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["purchase_order_id"] = new() { Type = "string", Description = "Identifiant unique (GUID) de la commande." }
            },
            RequiredParameters = new() { "purchase_order_id" },
            IsMutating = false,
            RequiredPermission = Permissions.PurchaseOrders.Read
        },
        new()
        {
            Name = "confirm_purchase_order",
            Description = "Confirmer une commande fournisseur (passe en statut Confirmé).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["purchase_order_id"] = new() { Type = "string", Description = "GUID de la commande." }
            },
            RequiredParameters = new() { "purchase_order_id" },
            IsMutating = true,
            RequiredPermission = Permissions.PurchaseOrders.Update
        },
        new()
        {
            Name = "cancel_purchase_order",
            Description = "Annuler une commande fournisseur. Motif optionnel.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["purchase_order_id"] = new() { Type = "string", Description = "GUID de la commande." },
                ["reason"] = new() { Type = "string", Description = "Motif d'annulation (optionnel)." }
            },
            RequiredParameters = new() { "purchase_order_id" },
            IsMutating = true,
            RequiredPermission = Permissions.PurchaseOrders.Update
        },

        // ────────── Factures fournisseurs ──────────
        new()
        {
            Name = "search_supplier_invoices",
            Description = "Rechercher des factures fournisseurs avec filtres optionnels.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["search"] = new() { Type = "string", Description = "Terme de recherche (numéro, fournisseur)." },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc },
                ["supplier_id"] = new() { Type = "string", Description = "GUID du fournisseur (optionnel)." },
                ["page"] = new() { Type = "integer", Description = "Page (défaut 1)." },
                ["page_size"] = new() { Type = "integer", Description = "Taille de page (défaut 20, max 50)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.SupplierInvoices.Read
        },
        new()
        {
            Name = "get_supplier_invoice_by_id",
            Description = "Obtenir le détail d'une facture fournisseur par son GUID.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["supplier_invoice_id"] = new() { Type = "string", Description = "Identifiant unique (GUID) de la facture fournisseur." }
            },
            RequiredParameters = new() { "supplier_invoice_id" },
            IsMutating = false,
            RequiredPermission = Permissions.SupplierInvoices.Read
        },
        new()
        {
            Name = "record_supplier_payment",
            Description = "Enregistrer un paiement sur une facture fournisseur. payment_date (yyyy-MM-dd) obligatoire. amount, method optionnels.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["supplier_invoice_id"] = new() { Type = "string", Description = "GUID de la facture fournisseur." },
                ["payment_date"] = new() { Type = "string", Description = "Date de paiement yyyy-MM-dd." },
                ["amount"] = new() { Type = "number", Description = "Montant (optionnel)." },
                ["method"] = new()
                {
                    Type = "string",
                    Description = "Moyen de paiement.",
                    AllowedValues = new() { "Cash", "BankTransfer", "Check", "Card", "MobilePayment", "Other" }
                },
                ["reference"] = new() { Type = "string", Description = "Référence (optionnel)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." }
            },
            RequiredParameters = new() { "supplier_invoice_id", "payment_date" },
            IsMutating = true,
            RequiredPermission = Permissions.SupplierInvoices.Update
        },
        new()
        {
            Name = "cancel_supplier_invoice",
            Description = "Annuler une facture fournisseur. Motif obligatoire.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["supplier_invoice_id"] = new() { Type = "string", Description = "GUID de la facture fournisseur." },
                ["reason"] = new() { Type = "string", Description = "Motif d'annulation." }
            },
            RequiredParameters = new() { "supplier_invoice_id", "reason" },
            IsMutating = true,
            RequiredPermission = Permissions.SupplierInvoices.Update
        },

        // ────────── Stock & Entrepôts ──────────
        new()
        {
            Name = "get_warehouses",
            Description = "Lister tous les entrepôts actifs. Retourne nom, code, adresse, statut par défaut.",
            Parameters = new Dictionary<string, AiToolParameter>(),
            IsMutating = false,
            RequiredPermission = Permissions.Stock.Read
        },
        new()
        {
            Name = "create_warehouse",
            Description = "Créer un entrepôt. Champs obligatoires : code, name. address et is_default optionnels.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["code"] = new() { Type = "string", Description = "Code unique de l'entrepôt (max 20 car.)." },
                ["name"] = new() { Type = "string", Description = "Nom de l'entrepôt." },
                ["address"] = new() { Type = "string", Description = "Adresse (optionnel)." },
                ["is_default"] = new() { Type = "boolean", Description = "Définir comme entrepôt par défaut (optionnel)." }
            },
            RequiredParameters = new() { "code", "name" },
            IsMutating = true,
            RequiredPermission = Permissions.Stock.Create
        },
        new()
        {
            Name = "record_stock_entry",
            Description = "MUTATION : ENREGISTRE / ÉCRIT une entrée de stock (achat, retour client, stock initial). product_id, quantity et unit_cost obligatoires. NE LIT PAS le stock — pour consulter ou afficher l'état du stock actuel, utiliser get_stock_snapshot.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "GUID du produit." },
                ["warehouse_id"] = new() { Type = "string", Description = "GUID de l'entrepôt (optionnel, défaut = entrepôt par défaut)." },
                ["quantity"] = new() { Type = "number", Description = "Quantité (> 0)." },
                ["unit_cost"] = new() { Type = "number", Description = "Coût unitaire (>= 0)." },
                ["reason"] = new()
                {
                    Type = "string",
                    Description = "Raison : Purchase, CustomerReturn, InitialStock.",
                    AllowedValues = new() { "Purchase", "CustomerReturn", "InitialStock" }
                },
                ["reference"] = new() { Type = "string", Description = "Référence (optionnel)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." }
            },
            RequiredParameters = new() { "product_id", "quantity", "unit_cost" },
            IsMutating = true,
            RequiredPermission = Permissions.Stock.Create
        },
        new()
        {
            Name = "record_stock_exit",
            Description = "Enregistrer une sortie manuelle de stock (dommage, retour fournisseur). NE PAS utiliser pour les ventes (automatique via facturation).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "GUID du produit." },
                ["warehouse_id"] = new() { Type = "string", Description = "GUID de l'entrepôt (optionnel)." },
                ["quantity"] = new() { Type = "number", Description = "Quantité (> 0)." },
                ["reason"] = new()
                {
                    Type = "string",
                    Description = "Raison : Damage, SupplierReturn.",
                    AllowedValues = new() { "Damage", "SupplierReturn" }
                },
                ["reference"] = new() { Type = "string", Description = "Référence (optionnel)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." }
            },
            RequiredParameters = new() { "product_id", "quantity", "reason" },
            IsMutating = true,
            RequiredPermission = Permissions.Stock.Create
        },
        new()
        {
            Name = "adjust_stock",
            Description = "Corriger le stock d'un produit (ajustement d'inventaire). Définit la nouvelle quantité réelle.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "GUID du produit." },
                ["warehouse_id"] = new() { Type = "string", Description = "GUID de l'entrepôt (optionnel)." },
                ["new_quantity"] = new() { Type = "number", Description = "Nouvelle quantité réelle (>= 0)." },
                ["notes"] = new() { Type = "string", Description = "Notes / justification (optionnel)." }
            },
            RequiredParameters = new() { "product_id", "new_quantity" },
            IsMutating = true,
            RequiredPermission = Permissions.Stock.Update
        },

        // ────────── CRM ──────────
        new()
        {
            Name = "search_crm_activities",
            Description = "Rechercher des activités CRM (appels, rendez-vous, tâches). Filtres optionnels par client, utilisateur, statut.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["client_id"] = new() { Type = "string", Description = "GUID du client (optionnel)." },
                ["completed"] = new() { Type = "boolean", Description = "true = terminées, false = en cours (optionnel)." },
                ["search_subject"] = new() { Type = "string", Description = "Recherche par sujet (optionnel)." },
                ["page"] = new() { Type = "integer", Description = "Page (défaut 1)." },
                ["page_size"] = new() { Type = "integer", Description = "Taille de page (défaut 20)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.CRM.Read
        },
        new()
        {
            Name = "search_crm_opportunities",
            Description = "Rechercher des opportunités CRM (pipeline commercial). Filtres par étape, client.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["stage"] = new()
                {
                    Type = "string",
                    Description = "Étape : Prospecting, Qualification, Proposal, Negotiation, ClosedWon, ClosedLost.",
                    AllowedValues = new() { "Prospecting", "Qualification", "Proposal", "Negotiation", "ClosedWon", "ClosedLost" }
                },
                ["client_id"] = new() { Type = "string", Description = "GUID du client (optionnel)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.CRM.Read
        },
        new()
        {
            Name = "create_crm_activity",
            Description = "Créer une activité CRM (appel, rendez-vous, email, tâche). subject et client_id obligatoires.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["type"] = new()
                {
                    Type = "integer",
                    Description = "Type d'activité : 0=Appel, 1=Email, 2=Rendez-vous, 3=Tâche, 4=Note.",
                    AllowedValues = new() { "0", "1", "2", "3", "4" }
                },
                ["subject"] = new() { Type = "string", Description = "Sujet de l'activité." },
                ["client_id"] = new() { Type = "string", Description = "GUID du client." },
                ["description"] = new() { Type = "string", Description = "Description détaillée (optionnel)." },
                ["priority"] = new()
                {
                    Type = "integer",
                    Description = "Priorité : 0=Basse, 1=Normale, 2=Haute, 3=Urgente.",
                    AllowedValues = new() { "0", "1", "2", "3" }
                },
                ["due_date"] = new() { Type = "string", Description = "Date d'échéance yyyy-MM-dd (optionnel)." },
                ["opportunity_id"] = new() { Type = "string", Description = "GUID de l'opportunité liée (optionnel)." }
            },
            RequiredParameters = new() { "subject", "client_id" },
            IsMutating = true,
            RequiredPermission = Permissions.CRM.Create
        },
        new()
        {
            Name = "create_crm_opportunity",
            Description = "Créer une opportunité CRM (pipeline commercial). title, client_id, expected_amount obligatoires.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["title"] = new() { Type = "string", Description = "Titre de l'opportunité." },
                ["client_id"] = new() { Type = "string", Description = "GUID du client." },
                ["expected_amount"] = new() { Type = "number", Description = "Montant espéré (TND)." },
                ["probability"] = new() { Type = "integer", Description = "Probabilité de succès en % (0-100, défaut 50)." },
                ["expected_close_date"] = new() { Type = "string", Description = "Date de clôture prévue yyyy-MM-dd (optionnel)." },
                ["source"] = new() { Type = "string", Description = "Source du lead (optionnel)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." }
            },
            RequiredParameters = new() { "title", "client_id", "expected_amount" },
            IsMutating = true,
            RequiredPermission = Permissions.CRM.Create
        },

        // ════════════════════════════════════════════════════════════════════
        //  Module AI Forecasting — Prévisions IA Ventes & Stock
        //  Append-only : ne JAMAIS modifier les tools ci-dessus.
        //  Le LLM doit toujours appeler ces tools — il ne calcule jamais lui-même.
        // ════════════════════════════════════════════════════════════════════

        new()
        {
            Name = "forecast_revenue",
            Description =
                "PRÉVISION FUTURE UNIQUEMENT. NE PAS utiliser pour le CA passé ou présent, ni pour classer / identifier les meilleurs clients existants — pour cela utiliser get_sales_revenue (group_by=Client). " +
                "Prévision déterministe du chiffre d'affaires futur (TND) pour un périmètre (global, catégorie, produit, entrepôt, client). " +
                "Méthodes utilisées : SMA / Holt / Holt-Winters multiplicatif selon la profondeur d'historique, ajustées par le calendrier commercial tunisien (Ramadan, Aïd, soldes officielles, rentrée, etc.). " +
                "Retourne Expected/Low/High (intervalle 95%), méthode utilisée, niveau de confiance, et un détail par mois. " +
                "NE JAMAIS inventer les chiffres — toujours appeler ce tool.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["scope_type"] = new()
                {
                    Type = "string",
                    Description = "Périmètre du forecast.",
                    AllowedValues = new() { "Global", "Category", "Product", "Warehouse", "Client" }
                },
                ["scope_id"] = new() { Type = "string", Description = "GUID du périmètre (obligatoire si scope_type ≠ Global)." },
                ["horizon"] = new()
                {
                    Type = "string",
                    Description = "Horizon : Week (7j), Month (30j), Quarter (90j) ou Custom (alors fournir from/to).",
                    AllowedValues = new() { "Week", "Month", "Quarter", "Custom" }
                },
                ["from_date"] = new() { Type = "string", Description = "Début (yyyy-MM-dd, requis pour Custom)." },
                ["to_date"] = new() { Type = "string", Description = "Fin (yyyy-MM-dd, requis pour Custom)." }
            },
            RequiredParameters = new() { "scope_type", "horizon" },
            IsMutating = false,
            RequiredPermission = Permissions.Forecasting.View
        },

        // ════════════════════════════════════════════════════════════════════
        //  Trésorerie prévisionnelle
        // ════════════════════════════════════════════════════════════════════

        new()
        {
            Name = "get_cash_flow_forecast",
            Description =
                "TRÉSORERIE FUTURE UNIQUEMENT. NE PAS utiliser pour un solde bancaire actuel ni pour l'encours client — pour cela utiliser get_accounting_dashboard ou get_client_balances. " +
                "Projection du solde de trésorerie (TND) sur un horizon en mois : solde d'ouverture comptable, encaissements et décaissements attendus mois par mois, solde de fin de période. " +
                "Retourne aussi trois scénarios probabilisés (optimiste / réaliste / pessimiste), les alertes de tension datées et les facteurs d'influence. " +
                "Les montants proviennent des factures clients et fournisseurs, des effets, de la paie, de l'échéancier fiscal, des emprunts et des engagements récurrents. " +
                "NE JAMAIS inventer ces chiffres — toujours appeler ce tool.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["horizon_months"] = new()
                {
                    Type = "integer",
                    Description = "Nombre de mois projetés (1 à 12). Défaut : 6."
                }
            },
            RequiredParameters = new(),
            IsMutating = false,
            RequiredPermission = Permissions.TreasuryForecast.View
        },

        new()
        {
            Name = "get_cash_flow_lines",
            Description =
                "Détail des flux de trésorerie attendus d'une projection : chaque échéance avec son tiers, sa date contractuelle, sa date réellement attendue, son montant et sa probabilité. " +
                "UTILISER pour répondre à « quelles factures rentrent en août ? » ou « d'où vient ce décaissement ? ». " +
                "NE PAS utiliser pour un total de période — get_cash_flow_forecast le fournit déjà agrégé.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["direction"] = new()
                {
                    Type = "string",
                    Description = "Sens du flux.",
                    AllowedValues = new() { "inflow", "outflow" }
                },
                ["source_type"] = new()
                {
                    Type = "string",
                    Description = "Origine métier du flux.",
                    AllowedValues = new()
                    {
                        "client_invoice", "client_effet", "supplier_invoice", "supplier_effet",
                        "payroll", "payroll_contribution", "fiscal_obligation", "loan_installment",
                        "recurring_commitment"
                    }
                },
                ["from_date"] = new() { Type = "string", Description = "Début de la fenêtre (yyyy-MM-dd)." },
                ["to_date"] = new() { Type = "string", Description = "Fin de la fenêtre (yyyy-MM-dd)." },
                ["top_n"] = new() { Type = "integer", Description = "Nombre de flux retournés (1 à 50). Défaut : 20." }
            },
            RequiredParameters = new(),
            IsMutating = false,
            RequiredPermission = Permissions.TreasuryForecast.View
        },

        new()
        {
            Name = "forecast_product_demand",
            Description =
                "PRÉVISION FUTURE UNIQUEMENT. NE PAS utiliser pour consulter ou afficher le stock actuel — pour cela utiliser get_stock_snapshot. " +
                "Prévision déterministe de la demande (quantités) pour un produit, sur un horizon donné. " +
                "Retourne quantité attendue, intervalle Low/High, stock actuel, jours de stock restants et quantité de réappro suggérée.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "GUID du produit." },
                ["horizon"] = new()
                {
                    Type = "string",
                    Description = "Week / Month / Quarter.",
                    AllowedValues = new() { "Week", "Month", "Quarter" }
                }
            },
            RequiredParameters = new() { "product_id", "horizon" },
            IsMutating = false,
            RequiredPermission = Permissions.Forecasting.View
        },

        new()
        {
            Name = "get_replenishment_recommendations",
            Description =
                "Recommandations actives de réapprovisionnement (produits à recommander urgemment). Filtres optionnels par entrepôt / statut. " +
                "Pour chaque ligne : produit, qté recommandée, point de commande (ROP), stock de sécurité, lead time, codes de raison.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["warehouse_id"] = new() { Type = "string", Description = "GUID entrepôt (optionnel)." },
                ["status"] = new()
                {
                    Type = "string",
                    Description = "Statut (par défaut Pending).",
                    AllowedValues = new() { "Pending", "Approved", "Dismissed", "Ordered", "Superseded" }
                },
                ["top_n"] = new() { Type = "integer", Description = "Nombre max de lignes (défaut 20, max 200)." }
            },
            IsMutating = false,
            RequiredPermission = Permissions.Forecasting.View
        },

        new()
        {
            Name = "get_promotion_recommendations",
            Description =
                "Suggestions de promotions / remises actives, basées sur dormance, surstock, classification ABC/XYZ et calendrier tunisien. " +
                "Chaque ligne contient : type (Destockage, Surstock, CrossSell, PrePic, Saisonnier, MargePush), remise suggérée, période de validité, raison textuelle, code événement lié.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "Filtre produit (optionnel)." },
                ["category_id"] = new() { Type = "string", Description = "Filtre catégorie (optionnel)." },
                ["from_date"] = new() { Type = "string", Description = FromDateOptionalDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateOptionalDesc }
            },
            IsMutating = false,
            RequiredPermission = Permissions.Forecasting.View
        },

        new()
        {
            Name = "get_abc_xyz_classification",
            Description =
                "Matrice ABC × XYZ des produits sur les 12 derniers mois. ABC = contribution au CA (A=top 80%, B=80-95%, C=long tail). " +
                "XYZ = variabilité de la demande (X=stable, Y=variable, Z=erratique). Retourne la matrice 9 cellules + liste des produits.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["warehouse_id"] = new() { Type = "string", Description = "GUID entrepôt (optionnel, filtre par stock présent)." },
                ["abc_class"] = new()
                {
                    Type = "string",
                    Description = "Filtre classe ABC (optionnel).",
                    AllowedValues = new() { "A", "B", "C", "Unclassified" }
                },
                ["xyz_class"] = new()
                {
                    Type = "string",
                    Description = "Filtre classe XYZ (optionnel).",
                    AllowedValues = new() { "X", "Y", "Z", "Unclassified" }
                }
            },
            IsMutating = false,
            RequiredPermission = Permissions.Forecasting.View
        },

        new()
        {
            Name = "get_tunisian_commercial_calendar",
            Description =
                "Calendrier commercial tunisien sur la période demandée : fêtes civiles fixes (1-jan, Indépendance, République…), fêtes religieuses lunaires (Ramadan, Aïd, Mouled, Ras El Am Hijri), périodes commerciales (Soldes hiver/été, Rentrée scolaire, Black Friday) et saisons climatiques. " +
                "Source : table embarquée 2024-2030 + règles civiles encodées.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["from_date"] = new() { Type = "string", Description = FromDateDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateDesc }
            },
            RequiredParameters = new() { "from_date", "to_date" },
            IsMutating = false,
            RequiredPermission = Permissions.Forecasting.View
        },

        new()
        {
            Name = "analyze_seasonal_impact",
            Description =
                "Analyse l'impact saisonnier d'une période sur un produit ou une catégorie : facteur multiplicatif moyen, événements applicables, baseline vs ajusté.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "GUID produit (ou category_id obligatoire)." },
                ["category_id"] = new() { Type = "string", Description = "GUID catégorie (ou product_id obligatoire)." },
                ["from_date"] = new() { Type = "string", Description = FromDateDesc },
                ["to_date"] = new() { Type = "string", Description = ToDateDesc }
            },
            RequiredParameters = new() { "from_date", "to_date" },
            IsMutating = false,
            RequiredPermission = Permissions.Forecasting.View
        },

        new()
        {
            Name = "simulate_promotion_impact",
            Description =
                "Simule l'effet d'une remise donnée pendant N jours pour un produit : CA sans/avec promo, marge, uplift, élasticité approximée (-1.5 retail). " +
                "Aucune mutation, calcul uniquement.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["product_id"] = new() { Type = "string", Description = "GUID du produit." },
                ["discount_percent"] = new() { Type = "number", Description = "Remise en % (0..90)." },
                ["duration_days"] = new() { Type = "integer", Description = "Durée en jours (1..90)." }
            },
            RequiredParameters = new() { "product_id", "discount_percent", "duration_days" },
            IsMutating = false,
            RequiredPermission = Permissions.Forecasting.View
        },

        new()
        {
            Name = "prepare_purchase_order_from_replenishment",
            Description =
                "Prépare un BROUILLON de bon de commande à partir de recommandations de réapprovisionnement. " +
                "Aucun bon de commande n'est validé : l'utilisateur DOIT confirmer dans l'UI (Génération auto avec confirmation).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["recommendation_ids_csv"] = new()
                {
                    Type = "string",
                    Description = "Liste des GUID de recommandations séparés par virgule (max 200)."
                }
            },
            RequiredParameters = new() { "recommendation_ids_csv" },
            IsMutating = true,
            RequiredPermission = Permissions.Forecasting.Manage
        },

        new()
        {
            Name = "prepare_promotion_application",
            Description =
                "Prépare un brouillon de remise à partir d'une recommandation promotion. " +
                "La remise n'est PAS activée — l'utilisateur la valide via le catalogue (Génération auto avec confirmation).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["promotion_recommendation_id"] = new() { Type = "string", Description = "GUID de la recommandation promotion." }
            },
            RequiredParameters = new() { "promotion_recommendation_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Forecasting.Manage
        },

        // ════════════════════════════════════════════════════════════════════
        //  Studio IA-native — génération low-code par langage naturel
        //  Append-only : ne JAMAIS modifier les tools ci-dessus.
        // ════════════════════════════════════════════════════════════════════
        new()
        {
            Name = "studio_generate_app",
            Description =
                "Crée une TABLE personnalisée (entité Studio) à partir d'une description : entité + champs (+ rapport de départ optionnel). "
                + "Fournir UN seul argument `spec_json` (chaîne JSON), schéma : "
                + "{ \"entity\": { \"displayName\": string, \"displayNamePlural\"?: string, \"icon\"?: string, \"description\"?: string }, "
                + "\"fields\": [ { \"label\": string, \"type\": string, \"required\"?: bool, \"unique\"?: bool, "
                + "\"options\"?: [ { \"value\": string, \"label\": string } ] } ], "
                + "\"report\"?: { \"displayName\": string, \"groupBy\": [labels], \"measures\": [ { \"field\": label, \"fn\": \"sum|avg|count|min|max\" } ], "
                + "\"columns\"?: [labels] (rapport de détail), \"filters\"?: [ { \"field\": label, \"op\": \"eq|neq|gt|gte|lt|lte|contains|in|between\", \"value\": any, \"value2\"?: any } ], "
                + "\"sort\"?: [ { \"field\": label, \"dir\": \"asc|desc\" } ] } }. "
                + "Types de champ autorisés : text, multilinetext, number, decimal, money, percentage, rating, boolean, date, datetime, select, multiselect, qrcode, barcode, autonumber, attachment, signature. "
                + "Pour select/multiselect, fournir `options`. N'émets QU'UN seul appel à cet outil.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON de la table (entity + fields + report optionnel) conforme au schéma de la description."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignEntities
        },
        new()
        {
            Name = "studio_generate_system",
            Description =
                "Crée un SYSTÈME COMPLET multi-tables liées (Notion-style) : système + entités + relations + formulaires + rapports + données de référence. "
                + "Utiliser quand l'utilisateur demande plusieurs tables liées, un « système », ou des relations entre entités. "
                + "Fournir UN seul argument `spec_json` (chaîne JSON) : "
                + "{ \"system\": { \"displayName\": string, \"icon\"?: string, \"description\"?: string, \"onboarding\"?: [string] }, "
                + "\"entities\": [ { \"ref\": string, \"displayName\": string, \"fields\": [ { \"label\": string, \"type\": string, "
                + "\"relationTo\"?: ref, \"options\"?: [...] } ], "
                + "\"form\"?: { \"sections\": [ { \"title\"?: string, \"fields\": [ clé | { \"field\": clé, \"width\": \"half|full\", \"label\"?: string } ] } ] }, "
                + "\"report\"?: { \"displayName\", \"groupBy\"?, \"measures\"?, \"columns\"?, \"filters\"?: [{ \"field\", \"op\": \"eq|neq|gt|gte|lt|lte|contains|in|between\", \"value\", \"value2\"? }], \"sort\"?: [{ \"field\", \"dir\": \"asc|desc\" }] } } ], "
                + "\"seed\"?: [ { \"entityRef\": ref, \"records\": [ { fieldKey: value } ] } ] }. "
                + "Types : text, date, select, relation (avec relationTo), money, boolean, etc. "
                + "Un `select` porte `options` et JAMAIS `relationTo` ; `relationTo` ne sert qu'à lier une autre table. "
                + "Dans `seed`, omets les champs relation. N'émets QU'UN seul appel.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON du système multi-tables conforme au schéma."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignEntities
        },

        // ════════════════════════════════════════════════════════════════════
        //  Studio « plan → aperçu → confirmation » — l'IA PRÉPARE un plan, rien
        //  n'est créé tant que l'utilisateur n'a pas validé l'aperçu (endpoint
        //  REST déterministe). Exposés uniquement quand EnableStudioAiPlanPreview
        //  est actif (le catalogue StudioBuilder substitue alors les generate_*).
        //  Append-only.
        // ════════════════════════════════════════════════════════════════════
        new()
        {
            Name = "studio_plan_app",
            Description =
                "PRÉPARE un plan de création d'une TABLE personnalisée soumis à VALIDATION utilisateur (rien n'est créé immédiatement). "
                + "Même schéma `spec_json` que studio_generate_app : "
                + "{ \"entity\": { \"displayName\": string, \"displayNamePlural\"?: string, \"icon\"?: string, \"description\"?: string }, "
                + "\"fields\": [ { \"label\": string, \"type\": string, \"required\"?: bool, \"unique\"?: bool, \"options\"?: [...] } ], "
                + "\"report\"?: { \"displayName\": string, \"groupBy\": [labels], \"measures\": [ { \"field\": label, \"fn\": \"sum|avg|count|min|max\" } ], "
                + "\"columns\"?: [labels], \"filters\"?: [ { \"field\": label, \"op\": \"eq|neq|gt|gte|lt|lte|contains|in|between\", \"value\": any, \"value2\"?: any } ], "
                + "\"sort\"?: [ { \"field\": label, \"dir\": \"asc|desc\" } ] } }. "
                + "Types de champ autorisés : text, multilinetext, number, decimal, money, percentage, rating, boolean, date, datetime, select, multiselect, qrcode, barcode, autonumber, attachment, signature. "
                + "Après l'appel, un APERÇU est montré à l'utilisateur qui valide ou annule. N'émets QU'UN seul appel.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON de la table (entity + fields + report optionnel) conforme au schéma de la description."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignEntities
        },
        new()
        {
            Name = "studio_plan_system",
            Description =
                "PRÉPARE un plan de création d'un SYSTÈME multi-tables soumis à VALIDATION utilisateur (rien n'est créé immédiatement). "
                + "Utiliser quand l'utilisateur demande plusieurs tables liées, un « système », ou des relations entre entités. "
                + "Même schéma `spec_json` que studio_generate_system : "
                + "{ \"system\": { \"displayName\": string, \"icon\"?: string, \"description\"?: string, \"onboarding\"?: [string] }, "
                + "\"entities\": [ { \"ref\": string, \"displayName\": string, \"fields\": [ { \"label\": string, \"type\": string, "
                + "\"relationTo\"?: ref, \"options\"?: [...] } ], "
                + "\"form\"?: { \"sections\": [ { \"title\"?: string, \"fields\": [ clé | { \"field\": clé, \"width\": \"half|full\", \"label\"?: string } ] } ] }, "
                + "\"report\"?: { \"displayName\", \"groupBy\"?, \"measures\"?, \"columns\"?, \"filters\"?, \"sort\"? } } ], "
                + "\"seed\"?: [ { \"entityRef\": ref, \"records\": [ { fieldKey: value } ] } ], "
                + "\"relations\"?: [ { \"kind\": \"many_to_many\", \"from\": ref, \"to\": ref, \"label\"?: string, \"junctionName\"?: string } ] }. "
                + "Un `select` porte `options` et JAMAIS `relationTo` ; `relationTo` ne sert qu'à lier une autre table ou une source ERP (clients/products). "
                + "Après l'appel, un APERÇU est montré à l'utilisateur qui valide ou annule. N'émets QU'UN seul appel.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON du système multi-tables conforme au schéma."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignEntities
        },
        new()
        {
            Name = "studio_get_table_schema",
            Description =
                "Lit le SCHÉMA RÉEL d'une table personnalisée existante (clés, libellés, types, options). "
                + "À APPELER AVANT toute modification pour t'appuyer sur les vraies clés au lieu de les deviner. "
                + "Lecture seule : ne modifie rien.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["entity_key"] = new() { Type = "string", Description = "Clé de la table personnalisée (ex. « contrats »)." }
            },
            RequiredParameters = new() { "entity_key" },
            RequiredPermission = Permissions.Studio.DesignEntities
        },
        new()
        {
            Name = "studio_plan_changes",
            Description =
                "PRÉPARE un plan de MODIFICATION d'une table personnalisée EXISTANTE, soumis à validation utilisateur "
                + "(rien n'est modifié immédiatement). UTILISER pour « ajoute un champ X sur la table Y », "
                + "« rends le champ Z obligatoire », « réorganise le formulaire », « ajoute un état ». "
                + "Appelle d'abord studio_get_table_schema pour connaître les vraies clés. "
                + "Fournir UN seul argument `spec_json` : "
                + "{ \"target\": { \"entityKey\": string }, \"operations\": [ "
                + "{ \"op\": \"add_field\", \"label\": string, \"type\": string, \"required\"?: bool, \"options\"?: [...] } | "
                + "{ \"op\": \"update_field\", \"key\": clé, \"label\"?: string, \"required\"?: bool, \"unique\"?: bool, \"addOptions\"?: [...] } | "
                + "{ \"op\": \"remove_field\", \"key\": clé } | "
                + "{ \"op\": \"update_entity\", \"displayName\"?: string, \"icon\"?: string, \"description\"?: string } | "
                + "{ \"op\": \"set_form\", \"sections\": [ { \"title\"?: string, \"fields\": [ clé | { \"field\": clé, \"width\": \"half|full\" } ] } ] } | "
                + "{ \"op\": \"set_report\", \"displayName\": string, \"definition\": { \"groupBy\"?, \"measures\"?, \"columns\"?, \"filters\"?, \"sort\"? } } | "
                + "{ \"op\": \"reorder_fields\", \"fields\": [ clé… ] } | "
                + "{ \"op\": \"change_field_type\", \"key\": clé, \"type\": string, \"options\"?: [...] } (refusé si des données seraient perdues) | "
                + "{ \"op\": \"add_relation\", \"kind\": \"many_to_one\"|\"many_to_many\", \"target\": clé, \"label\"?: string, \"junctionName\"?: string } | "
                + "{ \"op\": \"assign_system\", \"system\": clé | \"none\" } | "
                + "{ \"op\": \"set_view\", \"mode\": \"list\"|\"kanban\"|\"calendar\", \"displayName\": string, \"columns\"?: [...], \"groupBy\"?: clé Select, \"start\"?: clé Date } | "
                + "{ \"op\": \"set_automation\", … } (acceptée mais ignorée : non prise en charge en v1) ] }. "
                + "Maximum 20 opérations. La SUPPRESSION d'une table ou d'un système est IMPOSSIBLE par cet outil. "
                + "Retirer un champ le masque seulement : les données saisies sont conservées.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON de la modification (target + operations) conforme au schéma."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignEntities
        },

        new()
        {
            Name = "studio_list_sql_tables",
            Description =
                "Liste les TABLES de la base consultables pour créer une FENÊTRE, ou — si `table` est fourni — "
                + "les colonnes de cette table. À APPELER AVANT studio_plan_view pour t'appuyer sur les vrais "
                + "noms au lieu de les deviner. Lecture seule.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["table"] = new() { Type = "string", Description = "Nom de table (optionnel) : renvoie alors ses colonnes." }
            },
            RequiredParameters = new(),
            RequiredPermission = Permissions.Studio.DesignForms
        },
        new()
        {
            Name = "studio_plan_view",
            Description =
                "PRÉPARE un plan de création d'une FENÊTRE (vue LECTURE SEULE sur une table existante de la base), "
                + "soumis à validation utilisateur. UTILISER pour « affiche-moi un écran des factures avec date, client et total ». "
                + "Appelle d'abord studio_list_sql_tables pour connaître les vrais noms. "
                + "Fournir UN seul argument `spec_json` : "
                + "{ \"title\": string, \"table\": string, \"columns\": [ nomColonne | { \"name\": string, \"label\"?: string, "
                + "\"format\"?: \"text|date|datetime|number|money|boolean|uuid|status|fk\" } ], \"search\"?: bool }. "
                + "Omettre `columns` affiche toutes les colonnes. Une fenêtre n'écrit JAMAIS de données.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON de la fenêtre (title + table + columns) conforme au schéma."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignForms
        },
        new()
        {
            Name = "studio_plan_record_view",
            Description =
                "PRÉPARE un plan de création d'une VUE ENREGISTRÉE (liste, kanban ou calendrier) sur une table "
                + "Studio EXISTANTE, soumis à validation utilisateur (rien n'est créé immédiatement). UTILISER pour "
                + "« un kanban des interventions par statut », « un calendrier des échéances », « une liste filtrée "
                + "des contrats actifs ». Appelle d'abord studio_get_table_schema pour connaître les VRAIES clés "
                + "de champ. Fournir UN seul argument `spec_json` : "
                + "{ \"entity\": clé de la table, \"name\": libellé de la vue, \"mode\": \"list\"|\"kanban\"|\"calendar\", "
                + "\"columns\"?: [ clés de champ ], "
                + "\"filters\"?: [ { \"field\": clé, \"op\": \"eq|neq|contains|gt|gte|lt|lte|in|is_empty|is_not_empty|between\", \"value\"?: any } ], "
                + "\"sort\"?: [ { \"field\": clé, \"desc\"?: bool } ], "
                + "\"groupBy\"?: clé d'un champ select (OBLIGATOIRE en kanban), "
                + "\"start\"?: clé d'un champ date (OBLIGATOIRE en calendrier), \"end\"?: clé d'un champ date (optionnel), "
                + "\"title\"?: clé du champ titre, \"isDefault\"?: bool }. "
                + "Une vue n'écrit JAMAIS de données ; une table inexistante doit d'abord être créée.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON de la vue enregistrée (entity + name + mode) conforme au schéma."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignForms
        },
        new()
        {
            Name = "studio_plan_workflow",
            Description =
                "PRÉPARE un plan de WORKFLOWS (automatisations « quand X arrive, fais Y puis Z ») sur des tables "
                + "Studio EXISTANTES, soumis à validation utilisateur (rien n'est créé immédiatement ; les workflows "
                + "sont créés INACTIFS, l'utilisateur les active après relecture). UTILISER pour « validation d'une "
                + "dépense au-delà de 1000 », « relance 7 jours après échéance », « facturer à la fin d'une intervention ». "
                + "Appelle d'abord studio_get_table_schema pour connaître les VRAIES clés de champ. Fournir UN seul "
                + "argument `spec_json` : { \"workflows\": [ { \"entityKey\": clé de la table, \"name\": libellé, "
                + "\"trigger\": \"on_create\"|\"on_update\"|\"field_changed\"|\"manual\"|\"scheduled\", "
                + "\"triggerConfig\"?: pour field_changed { \"field\", \"from\"?, \"to\"? } ; pour scheduled { \"cron\", \"filters\"? } "
                + "(déclencheur planifié : cron de 5 champs REQUIS, fuseau UTC — ex. \"0 6 * * 1\" = chaque lundi à 06:00 UTC), "
                + "\"steps\": [ { \"type\": \"condition\"|\"update_field\"|\"erp_action\"|\"notify\"|\"approval\"|\"wait\"|\"create_record\", … } ] } ] } "
                + "(5 workflows max).",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON des workflows ({ workflows: [ { entityKey, name, trigger, steps } ] })."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignEntities
        },

        // ════════════════════════════════════════════════════════════════════
        //  Studio « états » — analyses sur les tables RÉELLES de la solution.
        //  Le modèle ne produit jamais de SQL : il nomme un état prêt à l'emploi
        //  ou une source + des champs, confrontés au schéma vivant. Append-only.
        // ════════════════════════════════════════════════════════════════════
        new()
        {
            Name = "studio_list_report_sources",
            Description =
                "Liste les ÉTATS PRÊTS À L'EMPLOI (ventes par produit, par client, par mois, achats, stock, "
                + "encaissements…) et les SOURCES de données analysables, avec leur domaine. "
                + "À APPELER EN PREMIER quand l'utilisateur demande un rapport, un état, une analyse ou des "
                + "statistiques et que tu ne sais pas quelle source utiliser. Lecture seule.",
            Parameters = new Dictionary<string, AiToolParameter>(),
            RequiredParameters = new(),
            RequiredPermission = Permissions.Studio.DesignReports
        },
        new()
        {
            Name = "studio_describe_report_source",
            Description =
                "Renvoie les CHAMPS RÉELS d'une source d'états (clés au format `Table_Colonne`). "
                + "À APPELER AVANT studio_run_report / studio_plan_report quand tu n'utilises PAS un état prêt "
                + "à l'emploi, pour t'appuyer sur les vraies clés au lieu de les deviner. "
                + "Les clés suffixées `__month`, `__quarter`, `__year` regroupent par période. Lecture seule.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["source"] = new() { Type = "string", Description = "Nom de la source (ex. InvoiceLines), tel que listé par studio_list_report_sources." }
            },
            RequiredParameters = new() { "source" },
            RequiredPermission = Permissions.Studio.DesignReports
        },
        new()
        {
            Name = "studio_run_report",
            Description =
                "EXÉCUTE un état et renvoie le tableau de résultats à afficher dans la conversation. "
                + "N'enregistre RIEN. UTILISER pour « montre-moi les ventes par produit ce trimestre ». "
                + "Fournir UN seul argument `spec_json` : "
                + "{ \"title\": string, \"preset\"?: clé d'état prêt à l'emploi, \"source\"?: table, "
                + "\"groupBy\"?: [clés], \"measures\"?: [ { \"field\": clé, \"fn\": \"sum|avg|count|min|max\" } ], "
                + "\"columns\"?: [clés] (état de détail, si pas de groupBy), "
                + "\"filters\"?: [ { \"field\": clé, \"op\": \"eq|neq|gt|gte|lt|lte|contains|in|between\", \"value\": any, \"value2\"?: any } ], "
                + "\"sort\"?: [ { \"field\": clé, \"dir\": \"asc|desc\" } ], \"from\"?: \"yyyy-MM-dd\", \"to\"?: \"yyyy-MM-dd\" }. "
                + "PRÉFÈRE `preset` : c'est exact et cela tient en un seul appel. Dériver les dates du CONTEXTE "
                + "TEMPOREL ; ne pas inventer d'année. N'émets QU'UN seul appel.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON de l'état (preset OU source + groupBy/measures) conforme au schéma."
                }
            },
            RequiredParameters = new() { "spec_json" },
            RequiredPermission = Permissions.Studio.DesignReports
        },
        new()
        {
            Name = "studio_plan_report",
            Description =
                "PRÉPARE l'ENREGISTREMENT d'un état comme état Studio réutilisable, soumis à VALIDATION "
                + "utilisateur (rien n'est créé immédiatement). UTILISER quand l'utilisateur demande de "
                + "« créer », « enregistrer » ou « garder » un rapport. Même schéma `spec_json` que "
                + "studio_run_report. L'aperçu montre un échantillon des vraies données.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["spec_json"] = new()
                {
                    Type = "string",
                    Description = "Spécification JSON de l'état, identique à celle de studio_run_report."
                }
            },
            RequiredParameters = new() { "spec_json" },
            IsMutating = true,
            RequiredPermission = Permissions.Studio.DesignReports
        },

        // ════════════════════════════════════════════════════════════════════
        //  Studio « pont ERP » — actions métier déclenchées par un enregistrement
        //  (utilisables aussi directement par l'assistant). Append-only.
        // ════════════════════════════════════════════════════════════════════
        new()
        {
            Name = "generate_invoice",
            Description =
                "Génère une FACTURE client (mono-ligne) via le moteur de facturation. UTILISER pour transformer un "
                + "enregistrement (abonnement, commande…) en facture réelle. Fournir client_id (GUID), product_id (GUID) et quantity.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["client_id"] = new() { Type = "string", Description = "GUID du client à facturer." },
                ["product_id"] = new() { Type = "string", Description = "GUID du produit/service facturé (ligne unique)." },
                ["quantity"] = new() { Type = "number", Description = "Quantité (> 0)." },
                ["issue_date"] = new() { Type = "string", Description = "Date d'émission yyyy-MM-dd (optionnel, défaut aujourd'hui)." },
                ["due_date"] = new() { Type = "string", Description = "Date d'échéance yyyy-MM-dd (optionnel)." },
                ["unit_price"] = new() { Type = "number", Description = "Prix unitaire HT personnalisé (optionnel ; sinon prix du produit)." },
                ["discount_percent"] = new() { Type = "number", Description = "Remise en % (optionnel, 0-100)." },
                ["reference"] = new() { Type = "string", Description = "Référence externe (optionnel)." }
            },
            RequiredParameters = new() { "client_id", "product_id", "quantity" },
            IsMutating = true,
            RequiredPermission = Permissions.Invoices.Create
        },
        new()
        {
            Name = "create_cash_expense",
            Description =
                "Enregistre une DÉPENSE de caisse (qui passe automatiquement l'écriture comptable). UTILISER pour "
                + "transformer un enregistrement « Dépense » en opération réelle. Fournir amount (> 0) et label.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["amount"] = new() { Type = "number", Description = "Montant de la dépense (> 0)." },
                ["label"] = new() { Type = "string", Description = "Libellé de la dépense." },
                ["expense_date"] = new() { Type = "string", Description = "Date yyyy-MM-dd (optionnel, défaut aujourd'hui)." },
                ["method"] = new()
                {
                    Type = "string",
                    Description = "Moyen de paiement (optionnel, défaut Cash).",
                    AllowedValues = new() { "Cash", "BankTransfer", "Check", "Card", "MobilePayment", "Other" }
                },
                ["category"] = new() { Type = "string", Description = "Catégorie de dépense (optionnel ; nom d'énumération, ex. SuppliesAndConsumables, RentPayment, UtilitiesAndEnergy)." },
                ["reference"] = new() { Type = "string", Description = "Référence (optionnel)." },
                ["notes"] = new() { Type = "string", Description = "Notes (optionnel)." }
            },
            RequiredParameters = new() { "amount", "label" },
            IsMutating = true,
            RequiredPermission = Permissions.Payments.Create
        },

        // ───────────────────────── Agent « Chef de mission » (périmètre CABINET) ─────────────────────────
        // Ces outils sont les seuls du catalogue à lire PLUSIEURS dossiers. Ils ne passent jamais par
        // ITenantContext : le fan-out est explicite et borné par l'ACL du demandeur. Ils ne sont exposés
        // qu'au scope FirmMission (cf. AiAgentScopeCatalog) et restent invisibles pour une société.
        new()
        {
            Name = "get_firm_portfolio_overview",
            Description =
                "Vue d'ensemble du portefeuille du CABINET : nombre de dossiers actifs, échéances fiscales en retard "
                + "et à venir avec les montants, dossiers sans écriture depuis 30 jours, déclarations TVA en brouillon. "
                + "UTILISER pour : « où en est mon cabinet », « combien de retards », état général. "
                + "NE PAS utiliser pour le détail d'un dossier précis (voir get_firm_dossier_health).",
            Parameters = new Dictionary<string, AiToolParameter>()
        },
        new()
        {
            Name = "get_firm_fiscal_deadlines",
            Description =
                "Liste les échéances fiscales du portefeuille, triées par urgence, avec le dossier concerné et le "
                + "collaborateur responsable. UTILISER pour : « quelles échéances sont en retard », « qu'est-ce qui "
                + "tombe cette semaine », « les échéances de tel dossier ». Renvoie aussi le total correspondant "
                + "quand la liste est tronquée.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["only_overdue"] = new() { Type = "boolean", Description = "true pour ne garder que les échéances déjà en retard (optionnel, défaut false)." },
                ["within_days"] = new() { Type = "integer", Description = "Fenêtre à venir en jours (optionnel, défaut 30, max 365). Ignoré si only_overdue est true." },
                ["obligation_type"] = new()
                {
                    Type = "string",
                    Description = "Filtrer sur un type d'obligation (optionnel).",
                    AllowedValues = new()
                    {
                        "MonthlyDeclaration", "ProvisionalCorporateTaxInstallment", "WithholdingTax", "Fodec",
                        "QuarterlyVat", "FinancialStatements", "SemiAnnualFinancialStatements",
                        "PersonalIncomeTaxInstallment", "CnssDtsQuarterly", "PayrollIrppWithholding",
                        "CnssMonthlyRemittance", "Other"
                    }
                },
                ["company_name"] = new() { Type = "string", Description = "Nom (ou fragment) du dossier client pour restreindre la liste (optionnel)." },
                ["top_n"] = new() { Type = "integer", Description = "Nombre max de lignes (optionnel, défaut 20, max 50)." }
            }
        },
        new()
        {
            Name = "get_firm_dossier_health",
            Description =
                "Classe les dossiers du cabinet par niveau de risque : retards fiscaux et montants exposés, absence "
                + "d'écriture depuis 30 jours, déclarations TVA en brouillon, gestionnaire affecté. "
                + "UTILISER pour : « quels dossiers sont à risque », « lesquels surveiller cette semaine », « dossiers en souffrance ».",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["top_n"] = new() { Type = "integer", Description = "Nombre max de dossiers (optionnel, défaut 10, max 50)." }
            }
        },
        new()
        {
            Name = "get_firm_collaborator_workload",
            Description =
                "Répartition de la charge entre collaborateurs du cabinet : nombre de dossiers suivis, échéances en "
                + "retard et à venir dont chacun est responsable. Signale aussi les échéances sans responsable désigné. "
                + "UTILISER pour : « qui est surchargé », « comment se répartit la charge », « qui suit quoi ».",
            Parameters = new Dictionary<string, AiToolParameter>()
        },
        new()
        {
            Name = "send_fiscal_deadline_reminder",
            Description =
                "Envoie un rappel au collaborateur responsable d'une échéance fiscale précise. UTILISER uniquement "
                + "après avoir identifié l'échéance via get_firm_fiscal_deadlines et confirmé l'intention de l'utilisateur. "
                + "Un seul rappel par échéance et par jour.",
            Parameters = new Dictionary<string, AiToolParameter>
            {
                ["deadline_id"] = new() { Type = "string", Description = "Identifiant de l'échéance, tel que renvoyé par get_firm_fiscal_deadlines." },
                ["company_tenant_id"] = new() { Type = "string", Description = "Identifiant du dossier de l'échéance, tel que renvoyé par get_firm_fiscal_deadlines." }
            },
            RequiredParameters = new() { "deadline_id", "company_tenant_id" },
            IsMutating = true,
            RequiredPermission = Permissions.Firm.AiRemind
        }
    };
}
