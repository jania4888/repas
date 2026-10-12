/**
 * Configuration des blocs réorganisables du tableau de bord (drag & drop).
 *
 * Le tableau de bord est composé d'un ensemble de « blocs » de premier niveau
 * dont l'utilisateur peut choisir l'ordre. L'ordre est persisté (backend + cache
 * localStorage) puis réconcilié au chargement via {@link reconcileOrder} afin
 * qu'un ajout/retrait de bloc dans une version ultérieure ne casse jamais une
 * disposition enregistrée.
 *
 * NB : la granularité retenue est « sections principales » — la grille basse
 * (Factures / Top clients / Devis / Activité) reste un seul bloc `bottom-grid`.
 */

export type DashboardBlockId =
  | 'kpi'
  | 'sector'
  | 'recommendations'
  | 'urgent'
  | 'quick-actions'
  | 'accounting'
  | 'crm'
  | 'chart'
  | 'bottom-grid';

export interface DashboardBlockDef {
  id: DashboardBlockId;
  /** Libellé affiché sur la poignée de glissement en mode personnalisation. */
  label: string;
}

/**
 * Définition canonique des blocs, dans l'ordre par défaut.
 * L'ordre de ce tableau fait foi pour la disposition initiale et la réconciliation.
 */
export const DASHBOARD_BLOCK_DEFS: readonly DashboardBlockDef[] = [
  { id: 'kpi', label: $localize`:@@dashboard.dashboard-layout.ts.indicateurs.cles.ad2f0ef9:Indicateurs clés` },
  { id: 'sector', label: $localize`:@@dashboard.dashboard-layout.ts.apercu.sectoriel.modules.56344376:Aperçu sectoriel & modules` },
  { id: 'recommendations', label: $localize`:@@dashboard.dashboard-layout.ts.recommande.pour.vous.46f2c609:Recommandé pour vous` },
  { id: 'urgent', label: $localize`:@@dashboard.dashboard-layout.ts.actions.requises.3ec278be:Actions requises` },
  { id: 'quick-actions', label: $localize`:@@dashboard.dashboard-layout.ts.actions.rapides.abe69a9c:Actions rapides` },
  { id: 'accounting', label: $localize`:@@dashboard.dashboard-layout.ts.comptabilite.20af7266:Comptabilité` },
  { id: 'crm', label: $localize`:@@dashboard.dashboard-layout.ts.crm.commercial.96a9fcf3:CRM Commercial` },
  { id: 'chart', label: $localize`:@@dashboard.dashboard-layout.ts.evolution.du.ca.ht.ba8a25a8:Évolution du CA HT` },
  { id: 'bottom-grid', label: $localize`:@@dashboard.dashboard-layout.ts.factures.clients.activite.f33b98f9:Factures, clients & activité` }
];

/** Ordre par défaut des identifiants de blocs. */
export const DEFAULT_DASHBOARD_BLOCK_ORDER: readonly DashboardBlockId[] =
  DASHBOARD_BLOCK_DEFS.map((d) => d.id);

const VALID_IDS = new Set<string>(DEFAULT_DASHBOARD_BLOCK_ORDER);

export function isDashboardBlockId(value: unknown): value is DashboardBlockId {
  return typeof value === 'string' && VALID_IDS.has(value);
}

/** Renvoie le libellé d'un bloc. */
export function blockLabel(id: DashboardBlockId): string {
  return DASHBOARD_BLOCK_DEFS.find((d) => d.id === id)?.label ?? id;
}

/**
 * Réconcilie un ordre stocké (potentiellement obsolète) avec la liste canonique :
 * - conserve l'ordre des identifiants connus (en ignorant les doublons) ;
 * - insère les blocs connus manquants à leur position par défaut ;
 * - ignore les identifiants inconnus.
 *
 * Garantit toujours un tableau contenant exactement une fois chaque bloc connu.
 */
export function reconcileOrder(stored: readonly string[] | null | undefined): DashboardBlockId[] {
  const result: DashboardBlockId[] = [];
  const seen = new Set<DashboardBlockId>();

  for (const id of stored ?? []) {
    if (isDashboardBlockId(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }

  DEFAULT_DASHBOARD_BLOCK_ORDER.forEach((id, defaultIdx) => {
    if (seen.has(id)) return;
    // Insère le bloc manquant avant le premier bloc présent dont l'index par
    // défaut est plus grand, afin de préserver sa position relative d'origine.
    let insertAt = result.length;
    for (let i = 0; i < result.length; i++) {
      if (DEFAULT_DASHBOARD_BLOCK_ORDER.indexOf(result[i]) > defaultIdx) {
        insertAt = i;
        break;
      }
    }
    result.splice(insertAt, 0, id);
    seen.add(id);
  });

  return result;
}

/**
 * Déplace `movedId` à la position de `targetId` dans l'ordre complet (sémantique
 * identique à `moveItemInArray` du CDK : retrait puis insertion à l'index cible).
 * Travaille par identifiant — robuste même quand certains blocs sont masqués
 * dans la liste rendue.
 */
export function reorderFullOrder(
  order: readonly DashboardBlockId[],
  movedId: DashboardBlockId,
  targetId: DashboardBlockId
): DashboardBlockId[] {
  const from = order.indexOf(movedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) {
    return [...order];
  }
  const copy = [...order];
  copy.splice(from, 1);
  copy.splice(to, 0, movedId);
  return copy;
}
