import { AssistantAgentScope } from '../models/ai-chat.models';

/**
 * Source de vérité UI des assistants experts par module : identité, suggestions, préfixes de routes
 * pour l'auto-scope de la bulle flottante et slugs des pages dédiées (/ai-assistant/<slug>).
 * Le backend garde sa propre source de vérité (AiAgentScopeCatalog) pour outils et personas.
 */
export interface AgentSuggestionCategory {
  id: string;
  label: string;
  questions: readonly string[];
}

export interface AgentScopeConfig {
  scope: AssistantAgentScope;
  /** Segment d'URL de la page dédiée : /ai-assistant/<slug>. */
  slug: string;
  /** Titre de page/onglet — « Assistant IA Ventes ». */
  title: string;
  /** Nom affiché dans le header du panneau — « Expert Ventes ». */
  expertName: string;
  /** Icône Font Awesome de l'entrée sidebar et du badge. */
  icon: string;
  /** Suggestions du scope affichées sur l'écran d'accueil du panneau. */
  suggestions: string[];
  /**
   * Catalogue groupé (optionnel). Absent = rendu historique en liste plate.
   * Quand présent, `suggestions` doit être l'aplatissement de ces catégories.
   */
  suggestionCategories?: readonly AgentSuggestionCategory[];
  /** Préfixes de routes du module (auto-scope de la bulle flottante). */
  routePrefixes: string[];
}

export const AGENT_SCOPE_CONFIGS: readonly AgentScopeConfig[] = [
  {
    scope: AssistantAgentScope.Sales,
    slug: 'ventes',
    title: $localize`:@@ai-assistant.agent-scopes.ts.assistant.ia.ventes.8797c882:Assistant IA Ventes`,
    expertName: 'Expert Ventes',
    icon: 'fa-solid fa-bag-shopping',
    suggestions: [
      "Quel est mon chiffre d'affaires ce mois-ci ?",
      'Quels sont mes 5 meilleurs clients ce trimestre ?',
      'Quelles factures sont en retard de paiement ?',
      'Quels produits se vendent le mieux ?'
    ],
    routePrefixes: ['/quotes', '/delivery-notes', '/invoices']
  },
  {
    scope: AssistantAgentScope.Purchases,
    slug: 'achats',
    title: $localize`:@@ai-assistant.agent-scopes.ts.assistant.ia.achats.cb6a295f:Assistant IA Achats`,
    expertName: 'Expert Achats',
    icon: 'fa-solid fa-cart-shopping',
    suggestions: [
      'Quelles factures fournisseurs ai-je payées ce mois-ci ?',
      'Quels bons de commande sont en attente ?',
      'Quelles sont les recommandations de réapprovisionnement ?',
      'Quels sont mes soldes fournisseurs ?'
    ],
    routePrefixes: ['/suppliers', '/purchase-orders', '/supplier-invoices']
  },
  {
    scope: AssistantAgentScope.Stock,
    slug: 'stock',
    title: $localize`:@@ai-assistant.agent-scopes.ts.assistant.ia.stock.2e2231a4:Assistant IA Stock`,
    expertName: 'Expert Stock',
    icon: 'fa-solid fa-boxes-stacked',
    suggestions: [
      "Affiche-moi l'état du stock actuel",
      'Quels produits sont en rupture ou presque finis ?',
      'Quels produits ne se sont jamais vendus ?',
      'Montre-moi la classification ABC/XYZ de mes produits'
    ],
    routePrefixes: ['/stock', '/transfers', '/inventory']
  },
  {
    scope: AssistantAgentScope.Accounting,
    slug: 'comptabilite',
    title: $localize`:@@ai-assistant.agent-scopes.ts.assistant.ia.comptabilite.2ed53fa2:Assistant IA Comptabilité`,
    expertName: 'Expert Comptabilité',
    icon: 'fa-solid fa-calculator',
    suggestions: [
      'Montre-moi le tableau de bord comptable',
      'Quels sont mes soldes clients et fournisseurs ?',
      'Vérifie la conformité de ma dernière facture',
      'Quelles sont mes créances de plus de 90 jours ?'
    ],
    routePrefixes: ['/accounting']
  },
  {
    scope: AssistantAgentScope.Treasury,
    slug: 'tresorerie',
    title: $localize`:@@ai-assistant.agent-scopes.ts.assistant.ia.tresorerie.f655f0f1:Assistant IA Trésorerie`,
    expertName: 'Expert Trésorerie',
    icon: 'fa-solid fa-credit-card',
    // Exactement quatre suggestions, comme tous les experts : la barre de suggestions a une
    // hauteur fixe et le contrat est verrouillé par agent-scopes.config.spec.ts.
    suggestions: [
      'Quels encaissements ai-je reçus ce mois-ci ?',
      'Quelles sont mes créances de plus de 90 jours ?',
      'Vais-je manquer de trésorerie dans les prochains mois ?',
      'Quels clients dois-je relancer en priorité ?'
    ],
    routePrefixes: ['/payments', '/treasury']
  },
  {
    scope: AssistantAgentScope.Crm,
    slug: 'crm',
    title: $localize`:@@ai-assistant.agent-scopes.ts.assistant.ia.crm.d5b38665:Assistant IA CRM`,
    expertName: 'Expert CRM',
    icon: 'fa-solid fa-handshake',
    suggestions: [
      'Quelles opportunités sont ouvertes actuellement ?',
      'Quelles activités sont prévues cette semaine ?',
      'Quels clients dois-je relancer ?',
      'Résume mon pipeline commercial'
    ],
    routePrefixes: ['/crm']
  }
];

/**
 * Catalogue d'accueil du Chef de mission. Une seule source : `suggestions` est l'aplatissement.
 * Les 4 questions historiques sont conservées mot pour mot.
 */
export const FIRM_MISSION_SUGGESTION_CATEGORIES: readonly AgentSuggestionCategory[] = [
  {
    id: 'overview',
    label: $localize`:@@ai-assistant.agent-scopes.ts.vue.d.ensemble.23bca783:Vue d'ensemble`,
    questions: [
      "Où en est le portefeuille du cabinet aujourd'hui ?",
      "Combien d'échéances sont en retard, pour quel montant, et chez combien de clients ?",
      'Combien de dossiers ont une échéance dans les 7 prochains jours ?',
      'Combien de déclarations TVA sont encore en brouillon ?'
    ]
  },
  {
    id: 'deadlines',
    label: $localize`:@@ai-assistant.agent-scopes.ts.echeances.fiscales.cbcbb519:Échéances fiscales`,
    questions: [
      'Quelles échéances sont en retard et chez quels clients ?',
      'Quelles échéances tombent cette semaine ?',
      'Quelles échéances arrivent dans les 30 prochains jours ?',
      'Quelles obligations de TVA trimestrielle arrivent dans les 15 prochains jours ?'
    ]
  },
  {
    id: 'risk',
    label: $localize`:@@ai-assistant.agent-scopes.ts.risque.et.activite.des.dossiers.60158f72:Risque et activité des dossiers`,
    questions: [
      'Quels dossiers sont les plus à risque cette semaine ?',
      "Quels dossiers n'ont pas eu d'écriture depuis un mois ?",
      'Quels dossiers ont des déclarations TVA en brouillon ?',
      'Classe les dossiers par niveau de risque et explique pourquoi.'
    ]
  },
  {
    id: 'workload',
    label: $localize`:@@ai-assistant.agent-scopes.ts.charge.des.collaborateurs.ea594410:Charge des collaborateurs`,
    questions: [
      'Comment se répartit la charge entre mes collaborateurs ?',
      'Qui est le plus chargé en échéances en retard ?',
      "Combien d'échéances n'ont pas de responsable désigné ?",
      'Qui suit le plus de dossiers actuellement ?'
    ]
  },
  {
    id: 'review',
    label: $localize`:@@ai-assistant.agent-scopes.ts.revue.et.priorites.27b8bdc1:Revue et priorités`,
    questions: [
      'Prépare-moi la revue hebdomadaire du cabinet.',
      'Quelles sont les 3 actions prioritaires cette semaine ?',
      'Y a-t-il des dossiers inactifs ou des échéances sans responsable à traiter ?'
    ]
  }
];

/**
 * Agent « Chef de mission » — délibérément HORS de `AGENT_SCOPE_CONFIGS`.
 *
 * Ce n'est pas un expert de module d'une société : il vit côté cabinet, sous /firm/assistant, et
 * n'a pas de page /ai-assistant/<slug>. Le garder à part évite trois effets de bord : la génération
 * automatique d'une route /ai-assistant/chef-de-mission (AI_ASSISTANT_ROUTES mappe ce tableau),
 * la résolution de ce scope depuis une URL de société, et la rupture des invariants de comptage
 * de `agent-scopes.config.spec.ts`.
 */
export const FIRM_AGENT_SCOPE_CONFIG: AgentScopeConfig = {
  scope: AssistantAgentScope.FirmMission,
  slug: 'chef-de-mission',
  title: $localize`:@@ai-assistant.agent-scopes.ts.assistant.chef.de.mission.1d92fc76:Assistant Chef de mission`,
  expertName: 'Chef de mission',
  icon: 'fa-solid fa-user-tie',
  suggestionCategories: FIRM_MISSION_SUGGESTION_CATEGORIES,
  suggestions: FIRM_MISSION_SUGGESTION_CATEGORIES.flatMap(c => [...c.questions]),
  routePrefixes: ['/firm/assistant']
};

/** Recherche par scope, experts de module ET agent cabinet. */
export function getAgentScopeConfig(scope: AssistantAgentScope): AgentScopeConfig | undefined {
  if (scope === AssistantAgentScope.FirmMission) {
    return FIRM_AGENT_SCOPE_CONFIG;
  }
  return AGENT_SCOPE_CONFIGS.find(c => c.scope === scope);
}

/**
 * Recherche par slug, restreinte aux experts de module : sert uniquement à résoudre
 * `/ai-assistant/<slug>`, où l'agent cabinet n'a rien à faire.
 */
export function getAgentScopeConfigBySlug(slug: string): AgentScopeConfig | undefined {
  return AGENT_SCOPE_CONFIGS.find(c => c.slug === slug);
}

/** Vrai si `url` est la route `prefix` ou une de ses sous-routes (segments exacts, query string ignorée). */
function matchesPrefix(url: string, prefix: string): boolean {
  if (!url.startsWith(prefix)) {
    return false;
  }
  const rest = url.charAt(prefix.length);
  return rest === '' || rest === '/' || rest === '?' || rest === '#';
}

/**
 * Résout le scope expert depuis l'URL courante :
 * 1. `/ai-assistant/<slug>` → scope explicite de la page dédiée ;
 * 2. préfixe d'un module (ex. /invoices) → scope suggéré pour la bulle flottante ;
 * 3. sinon None (assistant global) — y compris `/ai-assistant` seul et /dashboard.
 */
export function resolveScopeFromUrl(
  url: string | null | undefined,
  options?: { firmDelegated?: boolean }
): AssistantAgentScope {
  if (options?.firmDelegated) {
    return AssistantAgentScope.Accounting;
  }

  if (!url) {
    return AssistantAgentScope.None;
  }
  const path = url.split('?')[0].split('#')[0];

  const aiPrefix = '/ai-assistant/';
  if (path.startsWith(aiPrefix)) {
    const slug = path.slice(aiPrefix.length).split('/')[0];
    return getAgentScopeConfigBySlug(slug)?.scope ?? AssistantAgentScope.None;
  }

  for (const config of AGENT_SCOPE_CONFIGS) {
    if (config.routePrefixes.some(prefix => matchesPrefix(path, prefix))) {
      return config.scope;
    }
  }
  return AssistantAgentScope.None;
}
