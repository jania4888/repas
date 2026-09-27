/// <reference types="@angular/localize" />
import {
  AssistantProgressStep,
  AssistantProgressTimeline,
  ActiveToolCall
} from '../models/ai-chat.models';

const phaseLabels: Record<string, string> = {
  provider_availability: $localize`:@@ai-assistant.assistant-progress-display.ts.initialisation.de.l.assistant.80cecbaf:Initialisation de l'assistant`,
  conversation_load_or_create: $localize`:@@ai-assistant.assistant-progress-display.ts.preparation.de.l.echange.93148072:Préparation de l'échange`,
  build_system_prompt: 'Analyse de votre contexte',
  llm_stream_round: $localize`:@@ai-assistant.assistant-progress-display.ts.redaction.de.la.reponse.2717a9a2:Rédaction de la réponse`,
  ollama_queue_wait: $localize`:@@ai-assistant.assistant-progress-display.ts.file.d.attente.du.modele.local.cfa44a52:File d'attente du modèle local`,
  llm_forced_synthesis: $localize`:@@ai-assistant.assistant-progress-display.ts.synthese.de.la.reponse.33ef7ca1:Synthèse de la réponse`,
  persist_conversation: $localize`:@@ai-assistant.assistant-progress-display.ts.finalisation.de.la.reponse.3725527a:Finalisation de la réponse`,
  total_request: $localize`:@@ai-assistant.assistant-progress-display.ts.reponse.prete.dcb81431:Réponse prête`
};

const toolLabels: Record<string, string> = {
  get_sales_revenue: $localize`:@@ai-assistant.assistant-progress-display.ts.analyse.du.chiffre.d.affaires.410b1469:Analyse du chiffre d'affaires`,
  get_client_payments: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.des.paiements.78c98f3e:Recherche des paiements`,
  get_client_balances: $localize`:@@ai-assistant.assistant-progress-display.ts.calcul.des.soldes.clients.d237ee88:Calcul des soldes clients`,
  get_commercial_profit: $localize`:@@ai-assistant.assistant-progress-display.ts.analyse.des.marges.4b5ec940:Analyse des marges`,
  get_stock_snapshot: $localize`:@@ai-assistant.assistant-progress-display.ts.etat.du.stock.62ac65c5:État du stock`,
  get_product_performance: 'Performance produits',
  get_basket_metrics: $localize`:@@ai-assistant.assistant-progress-display.ts.metriques.panier.moyen.48d4fb3b:Métriques panier moyen`,
  get_accounting_dashboard: $localize`:@@ai-assistant.assistant-progress-display.ts.tableau.de.bord.comptable.18888eab:Tableau de bord comptable`,
  get_client_aging: $localize`:@@ai-assistant.assistant-progress-display.ts.balance.agee.clients.3cd4b5ab:Balance âgée clients`,
  get_product_sales_trend: $localize`:@@ai-assistant.assistant-progress-display.ts.tendances.des.ventes.666dfb86:Tendances des ventes`,
  get_supplier_balances: 'Soldes fournisseurs',
  get_products_never_sold: $localize`:@@ai-assistant.assistant-progress-display.ts.produits.non.vendus.441c9561:Produits non vendus`,
  get_stock_movements: $localize`:@@ai-assistant.assistant-progress-display.ts.mouvements.de.stock.b5ee405b:Mouvements de stock`,
  generate_dashboard_config: $localize`:@@ai-assistant.assistant-progress-display.ts.generation.du.tableau.de.bord.cfe06101:Génération du tableau de bord`,
  resolve_reporting_period: $localize`:@@ai-assistant.assistant-progress-display.ts.resolution.de.la.periode.1cc29edb:Résolution de la période`,
  propose_client_actions: $localize`:@@ai-assistant.assistant-progress-display.ts.actions.de.navigation.296aaf7d:Actions de navigation`,
  propose_follow_up_prompts: 'Suggestions de suite',
  compliance_check_invoice: $localize`:@@ai-assistant.assistant-progress-display.ts.controle.de.conformite.2a504799:Contrôle de conformité`,
  get_revenue: $localize`:@@ai-assistant.assistant-progress-display.ts.analyse.du.chiffre.d.affaires.410b1469:Analyse du chiffre d'affaires`,
  get_accounting_summary: $localize`:@@assistant-progress-display.summary.Synth_u00e8se_co:Synth\u00e8se comptable`,
  get_financial_summary: $localize`:@@assistant-progress-display.summary.Synth_u00e8se_fi:Synth\u00e8se financi\u00e8re`,
  get_cash_flow_summary: $localize`:@@assistant-progress-display.summary.synthese.de.tresorerie.6d9f17c5:Synth\u00e8se de tr\u00e9sorerie`,
  get_cashflow_summary: $localize`:@@assistant-progress-display.summary.synthese.de.tresorerie.6d9f17c5:Synth\u00e8se de tr\u00e9sorerie`,
  get_client_balance_summary: $localize`:@@assistant-progress-display.summary.Synth_u00e8se_so:Synth\u00e8se soldes clients`,
  get_stock_summary: $localize`:@@assistant-progress-display.summary.Synth_u00e8se_du:Synth\u00e8se du stock`,
  get_sales_summary: $localize`:@@assistant-progress-display.summary.synthese.des.ventes.538241e2:Synth\u00e8se des ventes`,
  get_sales_by_date_range: $localize`:@@ai-assistant.assistant-progress-display.ts.ventes.par.periode.7e86e7f4:Ventes par période`,
  get_sales_by_category: $localize`:@@ai-assistant.assistant-progress-display.ts.ventes.par.categorie.96f427dd:Ventes par catégorie`,
  get_sales_by_product: $localize`:@@ai-assistant.assistant-progress-display.ts.ventes.par.produit.13988394:Ventes par produit`,
  // \u2500\u2500 Pr\u00e9visions IA \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  forecast_revenue: $localize`:@@ai-assistant.assistant-progress-display.ts.prevision.du.chiffre.d.affaires.ba938250:Prévision du chiffre d'affaires`,
  get_cash_flow_forecast: $localize`:@@ai-assistant.assistant-progress-display.ts.tresorerie.previsionnelle.0fa48711:Trésorerie prévisionnelle`,
  get_cash_flow_lines: $localize`:@@ai-assistant.assistant-progress-display.ts.detail.des.flux.de.tresorerie.attendus.7183e694:Détail des flux de trésorerie attendus`,
  forecast_product_demand: $localize`:@@ai-assistant.assistant-progress-display.ts.prevision.de.la.demande.produit.224eacd3:Prévision de la demande produit`,
  get_replenishment_recommendations: $localize`:@@ai-assistant.assistant-progress-display.ts.recommandations.de.reapprovisionnement.cc4d4889:Recommandations de réapprovisionnement`,
  get_promotion_recommendations: $localize`:@@ai-assistant.assistant-progress-display.ts.recommandations.de.promotion.24094511:Recommandations de promotion`,
  get_abc_xyz_classification: 'Classement ABC/XYZ',
  get_tunisian_commercial_calendar: 'Calendrier commercial tunisien',
  analyze_seasonal_impact: $localize`:@@ai-assistant.assistant-progress-display.ts.analyse.de.l.impact.saisonnier.98bdca90:Analyse de l'impact saisonnier`,
  simulate_promotion_impact: $localize`:@@ai-assistant.assistant-progress-display.ts.simulation.d.impact.de.promotion.75328ef5:Simulation d'impact de promotion`,
  prepare_purchase_order_from_replenishment: $localize`:@@ai-assistant.assistant-progress-display.ts.preparation.bon.de.commande.reappro.6622f100:Préparation bon de commande réappro`,
  prepare_promotion_application: $localize`:@@ai-assistant.assistant-progress-display.ts.preparation.de.promotion.a37b235c:Préparation de promotion`,
  // \u2500\u2500 Fiches / recherche \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  get_product_by_id: $localize`:@@ai-assistant.assistant-progress-display.ts.consultation.produit.6b83260f:Consultation produit`,
  create_product: $localize`:@@ai-assistant.assistant-progress-display.ts.creation.de.produit.dfd2ecfc:Création de produit`,
  update_product: $localize`:@@ai-assistant.assistant-progress-display.ts.mise.a.jour.de.produit.a92a660d:Mise à jour de produit`,
  delete_product: $localize`:@@ai-assistant.assistant-progress-display.ts.suppression.de.produit.5332c035:Suppression de produit`,
  get_product_categories: $localize`:@@ai-assistant.assistant-progress-display.ts.categories.de.produits.cea43669:Catégories de produits`,
  create_product_category: $localize`:@@ai-assistant.assistant-progress-display.ts.creation.de.categorie.969097c9:Création de catégorie`,
  update_product_category: $localize`:@@ai-assistant.assistant-progress-display.ts.mise.a.jour.de.categorie.0f8c8275:Mise à jour de catégorie`,
  search_clients: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.de.clients.3952dcbd:Recherche de clients`,
  get_client_by_id: $localize`:@@ai-assistant.assistant-progress-display.ts.consultation.client.9dc1af8e:Consultation client`,
  create_client: $localize`:@@ai-assistant.assistant-progress-display.ts.creation.de.client.5705cba7:Création de client`,
  update_client: $localize`:@@ai-assistant.assistant-progress-display.ts.mise.a.jour.de.client.9f7cba1d:Mise à jour de client`,
  delete_client: $localize`:@@ai-assistant.assistant-progress-display.ts.suppression.de.client.e0113dc2:Suppression de client`,
  search_suppliers: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.de.fournisseurs.13952b22:Recherche de fournisseurs`,
  get_supplier_by_id: $localize`:@@ai-assistant.assistant-progress-display.ts.consultation.fournisseur.abdb5834:Consultation fournisseur`,
  create_supplier: $localize`:@@ai-assistant.assistant-progress-display.ts.creation.de.fournisseur.a2921a89:Création de fournisseur`,
  update_supplier: $localize`:@@ai-assistant.assistant-progress-display.ts.mise.a.jour.de.fournisseur.942bfaf8:Mise à jour de fournisseur`,
  delete_supplier: $localize`:@@ai-assistant.assistant-progress-display.ts.suppression.de.fournisseur.16a6178e:Suppression de fournisseur`,
  // \u2500\u2500 Documents de vente / achat \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  search_invoices: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.de.factures.68300d12:Recherche de factures`,
  get_invoice_by_id: $localize`:@@ai-assistant.assistant-progress-display.ts.consultation.facture.9a9aa2ed:Consultation facture`,
  validate_invoice: $localize`:@@ai-assistant.assistant-progress-display.ts.validation.de.facture.88fd89e6:Validation de facture`,
  sign_invoice: $localize`:@@ai-assistant.assistant-progress-display.ts.signature.de.facture.ededf6be:Signature de facture`,
  send_invoice_email: $localize`:@@ai-assistant.assistant-progress-display.ts.envoi.de.facture.par.e.mail.26369f2f:Envoi de facture par e-mail`,
  generate_invoice: $localize`:@@ai-assistant.assistant-progress-display.ts.generation.de.facture.88de42d4:Génération de facture`,
  record_invoice_payment: $localize`:@@ai-assistant.assistant-progress-display.ts.enregistrement.du.paiement.b36de109:Enregistrement du paiement`,
  search_quotes: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.de.devis.ca85511e:Recherche de devis`,
  get_quote_by_id: 'Consultation devis',
  accept_quote: $localize`:@@ai-assistant.assistant-progress-display.ts.acceptation.du.devis.e46dd30d:Acceptation du devis`,
  reject_quote: $localize`:@@ai-assistant.assistant-progress-display.ts.refus.du.devis.d65fd7b3:Refus du devis`,
  send_quote: $localize`:@@ai-assistant.assistant-progress-display.ts.envoi.du.devis.df95953d:Envoi du devis`,
  search_delivery_notes: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.de.bons.de.livraison.27aa4605:Recherche de bons de livraison`,
  get_delivery_note_by_id: $localize`:@@ai-assistant.assistant-progress-display.ts.consultation.bon.de.livraison.797bf5ef:Consultation bon de livraison`,
  search_purchase_orders: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.de.bons.de.commande.112b2b4f:Recherche de bons de commande`,
  get_purchase_order_by_id: $localize`:@@ai-assistant.assistant-progress-display.ts.consultation.bon.de.commande.47c9c63f:Consultation bon de commande`,
  confirm_purchase_order: $localize`:@@ai-assistant.assistant-progress-display.ts.confirmation.bon.de.commande.a5a3eef6:Confirmation bon de commande`,
  cancel_purchase_order: $localize`:@@ai-assistant.assistant-progress-display.ts.annulation.bon.de.commande.3aac012b:Annulation bon de commande`,
  search_supplier_invoices: 'Recherche factures fournisseurs',
  get_supplier_invoice_by_id: $localize`:@@ai-assistant.assistant-progress-display.ts.consultation.facture.fournisseur.9e3dfb6f:Consultation facture fournisseur`,
  record_supplier_payment: $localize`:@@ai-assistant.assistant-progress-display.ts.paiement.fournisseur.1dd14397:Paiement fournisseur`,
  cancel_supplier_invoice: $localize`:@@ai-assistant.assistant-progress-display.ts.annulation.facture.fournisseur.de3f0b14:Annulation facture fournisseur`,
  create_cash_expense: $localize`:@@ai-assistant.assistant-progress-display.ts.enregistrement.d.une.depense.df5dded4:Enregistrement d'une dépense`,
  // \u2500\u2500 Stock / entrep\u00f4ts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  get_warehouses: $localize`:@@ai-assistant.assistant-progress-display.ts.liste.des.entrepots.e4e1d3be:Liste des entrepôts`,
  create_warehouse: $localize`:@@ai-assistant.assistant-progress-display.ts.creation.d.entrepot.6730825e:Création d'entrepôt`,
  record_stock_entry: $localize`:@@ai-assistant.assistant-progress-display.ts.entree.de.stock.8c8e1df1:Entrée de stock`,
  record_stock_exit: $localize`:@@ai-assistant.assistant-progress-display.ts.sortie.de.stock.81497eb8:Sortie de stock`,
  adjust_stock: $localize`:@@ai-assistant.assistant-progress-display.ts.ajustement.de.stock.e20cadba:Ajustement de stock`,
  // \u2500\u2500 CRM / Studio \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  search_crm_activities: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.d.activites.crm.578ad514:Recherche d'activités CRM`,
  search_crm_opportunities: $localize`:@@ai-assistant.assistant-progress-display.ts.recherche.d.opportunites.697e086f:Recherche d'opportunités`,
  create_crm_activity: $localize`:@@ai-assistant.assistant-progress-display.ts.creation.d.activite.crm.1a2a375a:Création d'activité CRM`,
  create_crm_opportunity: $localize`:@@ai-assistant.assistant-progress-display.ts.creation.d.opportunite.23ebc62f:Création d'opportunité`,
  studio_generate_app: $localize`:@@ai-assistant.assistant-progress-display.ts.generation.d.application.studio.a2078d95:Génération d'application Studio`,
  studio_generate_system: $localize`:@@ai-assistant.assistant-progress-display.ts.generation.de.systeme.studio.85c89bef:Génération de système Studio`,
  // ── Cabinet / chef de mission ──────────────────────────────────────────
  get_firm_portfolio_overview: $localize`:@@ai-assistant.assistant-progress-display.ts.vue.d.ensemble.du.portefeuille.f1f7f43c:Vue d'ensemble du portefeuille`,
  get_firm_fiscal_deadlines: $localize`:@@ai-assistant.assistant-progress-display.ts.echeancier.fiscal.consolide.4ce2317c:Échéancier fiscal consolidé`,
  get_firm_dossier_health: $localize`:@@ai-assistant.assistant-progress-display.ts.sante.des.dossiers.33a26f2b:Santé des dossiers`,
  get_firm_collaborator_workload: $localize`:@@ai-assistant.assistant-progress-display.ts.repartition.de.la.charge.531ad5dc:Répartition de la charge`,
  send_fiscal_deadline_reminder: $localize`:@@ai-assistant.assistant-progress-display.ts.rappel.d.echeance.fiscale.eb3e5a51:Rappel d'échéance fiscale`
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
