namespace FactuTrust.Application.Features.AI;

/// <summary>
/// Libellés métier français des outils internes de l'assistant. Source de vérité unique pour la
/// SUBSTITUTION des identifiants techniques (snake_case) dans la prose visible : un nom d'outil ne
/// doit JAMAIS atteindre l'utilisateur (cf. <see cref="AssistantVisibleContentFormatter.SanitizeInternalToolNames"/>).
/// Miroir backend du map de chips <c>assistant-progress-display.ts</c> — garder les deux alignés.
/// Un test d'exhaustivité garantit que chaque outil de <see cref="Tools.AiToolRegistry.All"/> a un libellé.
/// </summary>
public static class AiToolFrenchLabels
{
    /// <summary>Libellé générique pour un identifiant interne inconnu (jamais montrer le token brut).</summary>
    public const string GenericLabel = "une analyse interne";

    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        // ── Lecture / rapports ────────────────────────────────────────────────
        ["resolve_reporting_period"] = "la résolution de la période",
        ["get_sales_revenue"] = "l'analyse du chiffre d'affaires",
        ["get_client_payments"] = "la recherche des paiements",
        ["get_client_balances"] = "le calcul des soldes clients",
        ["get_commercial_profit"] = "l'analyse des marges",
        ["get_stock_snapshot"] = "l'état du stock",
        ["get_product_performance"] = "l'analyse de performance produits",
        ["get_basket_metrics"] = "les métriques du panier moyen",
        ["get_accounting_dashboard"] = "le tableau de bord comptable",
        ["get_client_aging"] = "la balance âgée clients",
        ["get_product_sales_trend"] = "les tendances des ventes",
        ["get_supplier_balances"] = "les soldes fournisseurs",
        ["get_products_never_sold"] = "l'analyse des produits non vendus",
        ["get_stock_movements"] = "les mouvements de stock",
        ["generate_dashboard_config"] = "la génération du tableau de bord",
        ["propose_client_actions"] = "les actions de navigation",
        ["propose_follow_up_prompts"] = "les suggestions de suite",
        ["compliance_check_invoice"] = "le contrôle de conformité",

        // ── Fiches produits / catégories ─────────────────────────────────────
        ["get_product_by_id"] = "la consultation d'un produit",
        ["create_product"] = "la création de produit",
        ["update_product"] = "la mise à jour de produit",
        ["delete_product"] = "la suppression de produit",
        ["get_product_categories"] = "les catégories de produits",
        ["create_product_category"] = "la création de catégorie",
        ["update_product_category"] = "la mise à jour de catégorie",

        // ── Devis / factures ─────────────────────────────────────────────────
        ["accept_quote"] = "l'acceptation du devis",
        ["reject_quote"] = "le refus du devis",
        ["send_quote"] = "l'envoi du devis",
        ["record_invoice_payment"] = "l'enregistrement du paiement",
        ["search_invoices"] = "la recherche de factures",
        ["get_invoice_by_id"] = "la consultation d'une facture",
        ["validate_invoice"] = "la validation de facture",
        ["sign_invoice"] = "la signature de facture",
        ["send_invoice_email"] = "l'envoi de facture par e-mail",
        ["search_quotes"] = "la recherche de devis",
        ["get_quote_by_id"] = "la consultation d'un devis",
        ["generate_invoice"] = "la génération de facture",

        // ── Clients / fournisseurs ───────────────────────────────────────────
        ["search_clients"] = "la recherche de clients",
        ["get_client_by_id"] = "la consultation d'un client",
        ["create_client"] = "la création de client",
        ["update_client"] = "la mise à jour de client",
        ["delete_client"] = "la suppression de client",
        ["search_suppliers"] = "la recherche de fournisseurs",
        ["get_supplier_by_id"] = "la consultation d'un fournisseur",
        ["create_supplier"] = "la création de fournisseur",
        ["update_supplier"] = "la mise à jour de fournisseur",
        ["delete_supplier"] = "la suppression de fournisseur",

        // ── Livraisons / commandes / factures fournisseurs ───────────────────
        ["search_delivery_notes"] = "la recherche de bons de livraison",
        ["get_delivery_note_by_id"] = "la consultation d'un bon de livraison",
        ["search_purchase_orders"] = "la recherche de bons de commande",
        ["get_purchase_order_by_id"] = "la consultation d'un bon de commande",
        ["confirm_purchase_order"] = "la confirmation du bon de commande",
        ["cancel_purchase_order"] = "l'annulation du bon de commande",
        ["search_supplier_invoices"] = "la recherche de factures fournisseurs",
        ["get_supplier_invoice_by_id"] = "la consultation d'une facture fournisseur",
        ["record_supplier_payment"] = "l'enregistrement du paiement fournisseur",
        ["cancel_supplier_invoice"] = "l'annulation de la facture fournisseur",
        ["create_cash_expense"] = "l'enregistrement d'une dépense",

        // ── Agent « Chef de mission » (périmètre cabinet) ──────────────────────
        ["get_firm_portfolio_overview"] = "la vue d'ensemble du portefeuille",
        ["get_firm_fiscal_deadlines"] = "la revue des échéances fiscales",
        ["get_firm_dossier_health"] = "l'analyse de risque des dossiers",
        ["get_firm_collaborator_workload"] = "la répartition de la charge",
        ["send_fiscal_deadline_reminder"] = "l'envoi d'un rappel d'échéance",

        // ── Stock / entrepôts ────────────────────────────────────────────────
        ["get_warehouses"] = "la liste des entrepôts",
        ["create_warehouse"] = "la création d'entrepôt",
        ["record_stock_entry"] = "l'entrée de stock",
        ["record_stock_exit"] = "la sortie de stock",
        ["adjust_stock"] = "l'ajustement de stock",

        // ── CRM ──────────────────────────────────────────────────────────────
        ["search_crm_activities"] = "la recherche d'activités CRM",
        ["search_crm_opportunities"] = "la recherche d'opportunités",
        ["create_crm_activity"] = "la création d'activité CRM",
        ["create_crm_opportunity"] = "la création d'opportunité",

        // ── Prévisions IA ────────────────────────────────────────────────────
        ["forecast_revenue"] = "la prévision du chiffre d'affaires",
        ["get_cash_flow_forecast"] = "la trésorerie prévisionnelle",
        ["get_cash_flow_lines"] = "le détail des flux de trésorerie attendus",
        ["forecast_product_demand"] = "la prévision de la demande produit",
        ["get_replenishment_recommendations"] = "les recommandations de réapprovisionnement",
        ["get_promotion_recommendations"] = "les recommandations de promotion",
        ["get_abc_xyz_classification"] = "le classement ABC/XYZ des produits",
        ["get_tunisian_commercial_calendar"] = "le calendrier commercial tunisien",
        ["analyze_seasonal_impact"] = "l'analyse de l'impact saisonnier",
        ["simulate_promotion_impact"] = "la simulation d'impact de promotion",
        ["prepare_purchase_order_from_replenishment"] = "la préparation du bon de commande de réappro",
        ["prepare_promotion_application"] = "la préparation de la promotion",

        // ── Studio ───────────────────────────────────────────────────────────
        ["studio_generate_app"] = "la génération d'application Studio",
        ["studio_generate_system"] = "la génération de système Studio",
        ["studio_plan_app"] = "la préparation d'un plan de table Studio",
        ["studio_plan_system"] = "la préparation d'un plan de système Studio",
        ["studio_plan_changes"] = "la préparation d'une modification Studio",
        ["studio_get_table_schema"] = "la lecture du schéma d'une table Studio",
        ["studio_plan_view"] = "la préparation d'une fenêtre Studio",
        ["studio_list_sql_tables"] = "la liste des tables consultables",
        ["studio_list_report_sources"] = "la liste des états et sources disponibles",
        ["studio_describe_report_source"] = "la lecture des champs d'une source d'états",
        ["studio_run_report"] = "le calcul d'un état",
        ["studio_plan_report"] = "la préparation d'un état Studio",
        ["studio_plan_record_view"] = "la préparation d'une vue enregistrée",
        ["studio_plan_workflow"] = "la préparation d'un workflow"
    };

    /// <summary>Libellé FR de l'outil, ou libellé générique si l'identifiant est inconnu.</summary>
    public static string Describe(string toolName) =>
        Labels.TryGetValue(toolName, out var label) ? label : GenericLabel;
}
