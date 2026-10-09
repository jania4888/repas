import { FirmClientDossier } from '@core/services/firm-assignment.service';
import { normalizeSearchText } from '@core/utils/search-text-normalize';

/** Bornage de la saisie de recherche (caractères), appliqué aussi côté fonction pure. */
export const FIRM_CLIENT_SEARCH_MAX = 80;

export type FirmClientKindFilter = 'all' | 'firmManaged' | 'platform';

export interface FirmClientFilterCriteria {
  /** Texte libre : société ou nom du gestionnaire. */
  q: string;
  /** `all`, `awaiting`, ou nom affiché exact issu de la liste déjà chargée. */
  manager: string;
  /** `all`, `absent`, ou statut DP `0` | `1` | `2` | `9`. */
  dpStatus: string;
  kind: FirmClientKindFilter;
}

const DP_STATUS_VALUES = new Set(['0', '1', '2', '9']);

export function sanitizeFirmClientSearch(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').replace(/\p{Cc}/gu, '').trim();
  return cleaned.length > FIRM_CLIENT_SEARCH_MAX
    ? cleaned.slice(0, FIRM_CLIENT_SEARCH_MAX)
    : cleaned;
}

export function isFirmClientAwaitingAssignment(row: FirmClientDossier): boolean {
  if (row.isAwaitingAccountantAssignment === true) return true;
  return !(row.assignedAccountantName ?? '').trim();
}

export function uniqueManagers(rows: readonly FirmClientDossier[] | null | undefined): string[] {
  if (!rows?.length) return [];
  const names = new Set<string>();
  for (const row of rows) {
    if (!row || isFirmClientAwaitingAssignment(row)) continue;
    const name = (row.assignedAccountantName ?? '').trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
}

export function hasActiveFirmClientFilters(criteria: FirmClientFilterCriteria): boolean {
  return sanitizeFirmClientSearch(criteria.q).length > 0
    || criteria.manager !== 'all'
    || criteria.dpStatus !== 'all'
    || criteria.kind !== 'all';
}

function normalizeField(value: string | null | undefined): string {
  return normalizeSearchText((value ?? '').replace(/\p{Cc}/gu, ''));
}

function matchesText(row: FirmClientDossier, q: string): boolean {
  if (!q) return true;
  const company = normalizeField(row.companyName);
  const manager = normalizeField(row.assignedAccountantName);
  return company.includes(q) || manager.includes(q);
}

function matchesManager(row: FirmClientDossier, manager: string): boolean {
  if (manager === 'all') return true;
  if (manager === 'awaiting') return isFirmClientAwaitingAssignment(row);
  if (isFirmClientAwaitingAssignment(row)) return false;
  return (row.assignedAccountantName ?? '').trim() === manager;
}

function matchesDp(row: FirmClientDossier, dpStatus: string): boolean {
  if (dpStatus === 'all') return true;
  if (dpStatus === 'absent') return row.hasPermanentFile !== true;
  const status = Number(dpStatus);
  return row.hasPermanentFile === true && row.permanentFileStatus === status;
}

function matchesKind(row: FirmClientDossier, kind: FirmClientKindFilter): boolean {
  if (kind === 'all') return true;
  if (kind === 'firmManaged') return row.isFirmManaged === true;
  return row.isFirmManaged !== true;
}

/**
 * Sous-filtre local. Ne consulte ni le réseau ni d'autres champs que le nom
 * de société et le gestionnaire (pas d'identifiants techniques).
 */
export function filterFirmClientDossiers(
  rows: readonly FirmClientDossier[] | null | undefined,
  criteria: FirmClientFilterCriteria
): FirmClientDossier[] {
  if (!rows?.length) return [];
  if (criteria.kind !== 'all' && criteria.kind !== 'firmManaged' && criteria.kind !== 'platform') {
    return [];
  }
  if (criteria.dpStatus !== 'all'
    && criteria.dpStatus !== 'absent'
    && !DP_STATUS_VALUES.has(criteria.dpStatus)) {
    return [];
  }

  const q = normalizeSearchText(sanitizeFirmClientSearch(criteria.q));
  const result: FirmClientDossier[] = [];
  for (const row of rows) {
    if (!row) continue;
    if (!matchesText(row, q)) continue;
    if (!matchesManager(row, criteria.manager)) continue;
    if (!matchesDp(row, criteria.dpStatus)) continue;
    if (!matchesKind(row, criteria.kind)) continue;
    result.push(row);
  }
  return result;
}
