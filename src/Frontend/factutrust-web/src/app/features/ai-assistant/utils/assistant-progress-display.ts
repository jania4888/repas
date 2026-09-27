/// <reference types="@angular/localize" />
import {
  AssistantProgressStep,
  AssistantProgressTimeline,
  ActiveToolCall
} from '../models/ai-chat.models';

const phaseLabels: Record<string, string> = {
  provider_availability: "Initialisation de l'assistant",
  conversation_load_or_create: "Pr\u00e9paration de l'\u00e9change",
  build_system_prompt: 'Analyse de votre contexte',
  llm_stream_round: 'R\u00e9daction de la r\u00e9ponse',
  ollama_queue_wait: 'File d\'attente du mod\u00e8le local',
  llm_forced_synthesis: 'Synth\u00e8se de la r\u00e9ponse',
  persist_conversation: 'Finalisation de la r\u00e9ponse',
  total_request: 'R\u00e9ponse pr\u00eate'
};

const toolLabels: Record<string, string> = {
  get_sales_revenue: "Analyse du chiffre d'affaires",
  get_client_payments: 'Recherche des paiements',
  get_client_balances: 'Calcul des soldes clients',
  get_commercial_profit: 'Analyse des marges',
  get_stock_snapshot: '\u00c9tat du stock',
  get_product_performance: 'Performance produits',
  get_basket_metrics: 'M\u00e9triques panier moyen',
  get_accounting_dashboard: 'Tableau de bord comptable',
  get_client_aging: 'Balance \u00e2g\u00e9e clients',
  get_product_sales_trend: 'Tendances des ventes',
  get_supplier_balances: 'Soldes fournisseurs',
  get_products_never_sold: 'Produits non vendus',
  get_stock_movements: 'Mouvements de stock',
  generate_dashboard_config: 'G\u00e9n\u00e9ration du tableau de bord',
  resolve_reporting_period: 'R\u00e9solution de la p\u00e9riode',
  propose_client_actions: 'Actions de navigation',
  propose_follow_up_prompts: 'Suggestions de suite',
  compliance_check_invoice: 'Contr\u00f4le de conformit\u00e9',
  get_revenue: "Analyse du chiffre d'affaires",
  get_accounting_summary: $localize`:@@assistant-progress-display.summary.Synth_u00e8se_co:Synth\u00e8se comptable`,
  get_financial_summary: $localize`:@@assistant-progress-display.summary.Synth_u00e8se_fi:Synth\u00e8se financi\u00e8re`,
  get_cash_flow_summary: $localize`:@@assistant-progress-display.summary.synthese.de.tresorerie.6d9f17c5:Synth\u00e8se de tr\u00e9sorerie`,
  get_cashflow_summary: $localize`:@@assistant-progress-display.summary.synthese.de.tresorerie.6d9f17c5:Synth\u00e8se de tr\u00e9sorerie`,
  get_client_balance_summary: $localize`:@@assistant-progress-display.summary.Synth_u00e8se_so:Synth\u00e8se soldes clients`,
  get_stock_summary: $localize`:@@assistant-progress-display.summary.Synth_u00e8se_du:Synth\u00e8se du stock`,
  get_sales_summary: $localize`:@@assistant-progress-display.summary.synthese.des.ventes.538241e2:Synth\u00e8se des ventes`,
  get_sales_by_date_range: 'Ventes par p\u00e9riode',
  get_sales_by_category: 'Ventes par cat\u00e9gorie',
  get_sales_by_product: 'Ventes par produit',
  // \u2500\u2500 Pr\u00e9visions IA \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  forecast_revenue: "Pr\u00e9vision du chiffre d'affaires",
  get_cash_flow_forecast: 'Tr\u00e9sorerie pr\u00e9visionnelle',
  get_cash_flow_lines: 'D\u00e9tail des flux de tr\u00e9sorerie attendus',
  forecast_product_demand: 'Pr\u00e9vision de la demande produit',
  get_replenishment_recommendations: 'Recommandations de r\u00e9approvisionnement',
  get_promotion_recommendations: 'Recommandations de promotion',
  get_abc_xyz_classification: 'Classement ABC/XYZ',
  get_tunisian_commercial_calendar: 'Calendrier commercial tunisien',
  analyze_seasonal_impact: "Analyse de l'impact saisonnier",
  simulate_promotion_impact: "Simulation d'impact de promotion",
  prepare_purchase_order_from_replenishment: 'Pr\u00e9paration bon de commande r\u00e9appro',
  prepare_promotion_application: 'Pr\u00e9paration de promotion',
  // \u2500\u2500 Fiches / recherche \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  get_product_by_id: 'Consultation produit',
  create_product: 'Cr\u00e9ation de produit',
  update_product: 'Mise \u00e0 jour de produit',
  delete_product: 'Suppression de produit',
  get_product_categories: 'Cat\u00e9gories de produits',
  create_product_category: 'Cr\u00e9ation de cat\u00e9gorie',
  update_product_category: 'Mise \u00e0 jour de cat\u00e9gorie',
  search_clients: 'Recherche de clients',
  get_client_by_id: 'Consultation client',
  create_client: 'Cr\u00e9ation de client',
  update_client: 'Mise \u00e0 jour de client',
  delete_client: 'Suppression de client',
  search_suppliers: 'Recherche de fournisseurs',
  get_supplier_by_id: 'Consultation fournisseur',
  create_supplier: 'Cr\u00e9ation de fournisseur',
  update_supplier: 'Mise \u00e0 jour de fournisseur',
  delete_supplier: 'Suppression de fournisseur',
  // \u2500\u2500 Documents de vente / achat \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  search_invoices: 'Recherche de factures',
  get_invoice_by_id: 'Consultation facture',
  validate_invoice: 'Validation de facture',
  sign_invoice: 'Signature de facture',
  send_invoice_email: 'Envoi de facture par e-mail',
  generate_invoice: 'G\u00e9n\u00e9ration de facture',
  record_invoice_payment: 'Enregistrement du paiement',
  search_quotes: 'Recherche de devis',
  get_quote_by_id: 'Consultation devis',
  accept_quote: 'Acceptation du devis',
  reject_quote: 'Refus du devis',
  send_quote: 'Envoi du devis',
  search_delivery_notes: 'Recherche de bons de livraison',
  get_delivery_note_by_id: 'Consultation bon de livraison',
  search_purchase_orders: 'Recherche de bons de commande',
  get_purchase_order_by_id: 'Consultation bon de commande',
  confirm_purchase_order: 'Confirmation bon de commande',
  cancel_purchase_order: 'Annulation bon de commande',
  search_supplier_invoices: 'Recherche factures fournisseurs',
  get_supplier_invoice_by_id: 'Consultation facture fournisseur',
  record_supplier_payment: 'Paiement fournisseur',
  cancel_supplier_invoice: 'Annulation facture fournisseur',
  create_cash_expense: "Enregistrement d'une d\u00e9pense",
  // \u2500\u2500 Stock / entrep\u00f4ts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  get_warehouses: 'Liste des entrep\u00f4ts',
  create_warehouse: "Cr\u00e9ation d'entrep\u00f4t",
  record_stock_entry: 'Entr\u00e9e de stock',
  record_stock_exit: 'Sortie de stock',
  adjust_stock: 'Ajustement de stock',
  // \u2500\u2500 CRM / Studio \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  search_crm_activities: "Recherche d'activit\u00e9s CRM",
  search_crm_opportunities: "Recherche d'opportunit\u00e9s",
  create_crm_activity: "Cr\u00e9ation d'activit\u00e9 CRM",
  create_crm_opportunity: "Cr\u00e9ation d'opportunit\u00e9",
  studio_generate_app: "G\u00e9n\u00e9ration d'application Studio",
  studio_generate_system: 'G\u00e9n\u00e9ration de syst\u00e8me Studio',
  // ── Cabinet / chef de mission ──────────────────────────────────────────
  get_firm_portfolio_overview: 'Vue d\'ensemble du portefeuille',
  get_firm_fiscal_deadlines: '\u00c9ch\u00e9ancier fiscal consolid\u00e9',
  get_firm_dossier_health: 'Sant\u00e9 des dossiers',
  get_firm_collaborator_workload: 'R\u00e9partition de la charge',
  send_fiscal_deadline_reminder: 'Rappel d\'\u00e9ch\u00e9ance fiscale'
};

/** Pr\u00e9fixes techniques retir\u00e9s par le repli \u00ab prettifi\u00e9 \u00bb (nom d'outil inconnu du map). */
const TOOL_NAME_PREFIX = /^(get|forecast|propose|resolve|generate|analyze|simulate|compliance|studio|create|record|update|delete|search|send|accept|reject|validate|sign|confirm|cancel|adjust|prepare)_/;

export function getAssistantPhaseLabel(code: string): string {
  return phaseLabels[code] || code.replace(/_/g, ' ');
}

/** True si l'outil poss\u00e8de un libell\u00e9 explicite (sinon le repli prettifi\u00e9 s'applique). */
export function hasToolLabel(name: string): boolean {
  return !!toolLabels[name];
}

/**
 * Libell\u00e9 m\u00e9tier FR d'un outil. Repli : nom \u00ab prettifi\u00e9 \u00bb (pr\u00e9fixe technique retir\u00e9,
 * underscores \u2192 espaces, capitalis\u00e9) \u2014 un identifiant snake_case brut ne doit JAMAIS s'afficher.
 */
export function getAiToolDisplayLabel(name: string): string {
  const known = toolLabels[name];
  if (known) {
    return known;
  }
  const cleaned = name.replace(TOOL_NAME_PREFIX, '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'Analyse interne';
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export interface DedupedToolSource {
  toolName: string;
  label: string;
  count: number;
}

/**
 * Agr\u00e8ge les sources par outil en pr\u00e9servant l'ordre d'apparition (\u00ab Pr\u00e9vision du CA \u00d73 \u00bb
 * au lieu de trois chips identiques).
 */
export function dedupeToolSources(
  sources: ReadonlyArray<{ toolName: string }> | null | undefined
): DedupedToolSource[] {
  const out: DedupedToolSource[] = [];
  const byName = new Map<string, DedupedToolSource>();
  for (const s of sources ?? []) {
    const existing = byName.get(s.toolName);
    if (existing) {
      existing.count++;
      continue;
    }
    const entry: DedupedToolSource = {
      toolName: s.toolName,
      label: getAiToolDisplayLabel(s.toolName),
      count: 1
    };
    byName.set(s.toolName, entry);
    out.push(entry);
  }
  return out;
}

export function formatDurationMs(durationMs?: number | null): string {
  if (durationMs == null || Number.isNaN(durationMs) || durationMs < 0) {
    return '';
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)} s`;
  }

  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 1000)} s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

export function getAssistantProgressSummary(
  progress: AssistantProgressTimeline | undefined,
  toolCalls: ActiveToolCall[] | undefined
): string {
  const steps = progress?.steps ?? [];
  const completedSteps = steps.filter(step => step.status === 'completed').length;
  const completedTools = (toolCalls ?? []).filter(toolCall => toolCall.status === 'completed').length;
  const lastElapsed = [...steps]
    .reverse()
    .find(step => typeof step.elapsedMs === 'number')?.elapsedMs;

  const parts: string[] = [];
  if (completedSteps > 0) {
    parts.push(`${completedSteps} \u00e9tape${completedSteps > 1 ? 's' : ''}`);
  }
  if (completedTools > 0) {
    parts.push(`${completedTools} consultation${completedTools > 1 ? 's' : ''}`);
  }
  if (typeof lastElapsed === 'number') {
    const formatted = formatDurationMs(lastElapsed);
    if (formatted) {
      parts.push(formatted);
    }
  }

  return parts.length > 0 ? $localize`:@@ai-assistant.assistant-progress-display.ts.reponse.preparee.en.join.d9d038ee:R\u00e9ponse pr\u00e9par\u00e9e en ${parts.join(' \u00b7 ')}:join:` : '';
}

export function getAssistantStepMeta(step: AssistantProgressStep): string {
  const parts: string[] = [];
  const detail = formatAssistantStepDetail(step);
  if (detail) {
    parts.push(detail);
  }

  if (typeof step.round === 'number' && step.round > 1) {
    parts.push(`it\u00e9ration ${step.round}`);
  }

  const elapsed = formatDurationMs(step.elapsedMs);
  if (elapsed) {
    parts.push(elapsed);
  }

  const firstToken = formatDurationMs(step.firstTokenMs);
  if (firstToken) {
    parts.push(`premiers mots en ${firstToken}`);
  }

  if (step.hadToolCalls === true) {
    parts.push('avec consultations m\u00e9tier');
  }

  return parts.join(' \u00b7 ');
}

function formatAssistantStepDetail(step: AssistantProgressStep): string {
  switch (step.code) {
    case 'provider_availability':
      return formatProviderDetail(step.detail, step.status);
    case 'conversation_load_or_create':
      if (step.detail === 'nouvelle conversation') {
        return $localize`:@@ai-assistant.assistant-progress-display.ts.nouvel.echange.initialise.7d5e9708:Nouvel échange initialisé`;
      }
      if (step.detail === 'conversation existante') {
        return $localize`:@@ai-assistant.assistant-progress-display.ts.historique.retrouve.53bb2d88:Historique retrouvé`;
      }
      return $localize`:@@ai-assistant.assistant-progress-display.ts.contexte.de.conversation.pret.e8b99295:Contexte de conversation prêt`;
    case 'build_system_prompt':
      if (step.detail === 'Compliance') {
        return $localize`:@@ai-assistant.assistant-progress-display.ts.verifications.renforcees.activees.1d0b3903:Vérifications renforcées activées`;
      }
      return $localize`:@@ai-assistant.assistant-progress-display.ts.contexte.metier.enrichi.02d1ef22:Contexte métier enrichi`;
    case 'llm_stream_round':
      return step.status === 'running' ? $localize`:@@ai-assistant.assistant-progress-display.ts.le.modele.formule.la.reponse.184633a8:Le modèle formule la réponse` : '';
    case 'llm_forced_synthesis':
      return step.status === 'running' ? $localize`:@@ai-assistant.assistant-progress-display.ts.consolidation.des.resultats.bc959d8d:Consolidation des résultats` : '';
    case 'persist_conversation':
      return $localize`:@@ai-assistant.assistant-progress-display.ts.reponse.enregistree.7b21f542:Réponse enregistrée`;
    case 'total_request':
      return $localize`:@@ai-assistant.assistant-progress-display.ts.prete.a.etre.lue.a7652036:Prête à être lue`;
    default:
      return step.detail?.trim() ?? '';
  }
}

function formatProviderDetail(detail: string | undefined, status: AssistantProgressStep['status']): string {
  if (status === 'failed') {
    return $localize`:@@ai-assistant.assistant-progress-display.ts.service.ou.modele.indisponible.13684d3f:Service ou modèle indisponible`;
  }

  if (detail?.startsWith('ollama:')) {
    return $localize`:@@ai-assistant.assistant-progress-display.ts.modele.local.pret.81ba850f:Modèle local prêt`;
  }

  if (detail?.startsWith('openrouter:')) {
    return $localize`:@@ai-assistant.assistant-progress-display.ts.modele.cloud.pret.ef0967f8:Modèle cloud prêt`;
  }

  if (detail?.startsWith('modal:')) {
    return $localize`:@@ai-assistant.assistant-progress-display.ts.modele.cloud.pret.ef0967f8:Modèle cloud prêt`;
  }

  if (detail?.startsWith('cursor:')) {
    return $localize`:@@ai-assistant.assistant-progress-display.ts.modele.cursor.pret.19689eb7:Modèle Cursor prêt`;
  }

  return $localize`:@@ai-assistant.assistant-progress-display.ts.connexion.etablie.a5c17ab3:Connexion établie`;
}
