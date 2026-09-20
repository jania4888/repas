import { ReportColumn, ReportResult } from '@shared/studio-runtime/studio-runtime.models';
import { StudioSpecEntity, StudioSpecReport, StudioSpecReportMeasure } from '../studio-ai.models';

/** Mesures d'agrégation calculables côté client (clés `fn` de la spec canonique). */
const SUPPORTED_MEASURE_FNS = new Set(['count', 'sum', 'avg', 'min', 'max']);

/**
 * Échantillon de rapport calculé localement pour le mode Tester (3.4f2) — **aucun appel réseau**.
 *
 * Agrégation simple à partir des données de départ : regroupement sur le PREMIER champ `groupBy`
 * du rapport (1 niveau, ordre de première apparition) puis mesures `count`/`sum`/`avg`/`min`/`max`
 * par groupe. Les valeurs non numériques sont ignorées par `sum`/`avg`/`min`/`max` et les chaînes
 * numériques coercées : aucune exception sur des données de départ exotiques. `count` sans champ
 * compte les lignes du groupe, avec champ les lignes où la valeur est renseignée.
 *
 * Les colonnes sont `[dimension?, ...mesures]` (`ReportColumn` du runtime) et `totalRows` est le
 * nombre de lignes agrégées ; aucune ligne « Total » n'est ajoutée (le composant de rapport reste
 * seul responsable de son rendu). `null` quand il n'y a aucune ligne de départ ou rien à agréger.
 */
export function sampleFromSeed(
  report: StudioSpecReport,
  entity: StudioSpecEntity,
  seed: Record<string, unknown>[]
): ReportResult | null {
  const rows = seed ?? [];
  if (rows.length === 0) return null;

  const groupField = report.groupBy?.[0];
  const seen = new Set<string>();
  const measures = (report.measures ?? []).filter(measure => {
    if (!measure || !SUPPORTED_MEASURE_FNS.has(String(measure.fn).toLowerCase())) return false;
    const key = measureKey(measure);
    if (seen.has(key)) return false; // doublon fn+champ : la clé de colonne resterait unique
    seen.add(key);
    return true;
  });
  if (!groupField && measures.length === 0) return null;

  const columns: ReportColumn[] = [];
  if (groupField) {
    columns.push({ key: groupField, label: fieldLabel(entity, groupField), kind: 'dimension' });
  }
  for (const measure of measures) {
    columns.push({ key: measureKey(measure), label: measureLabel(entity, measure), kind: 'measure' });
  }

  const groups = new Map<string, { value: unknown; rows: Record<string, unknown>[] }>();
  for (const row of rows) {
    const value = groupField ? row[groupField] : null;
    const key = valueKey(value);
    let group = groups.get(key);
    if (!group) {
      group = { value: value ?? null, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  const resultRows: Record<string, unknown>[] = [];
  for (const group of groups.values()) {
    const out: Record<string, unknown> = {};
    if (groupField) out[groupField] = group.value;
    for (const measure of measures) {
      out[measureKey(measure)] = aggregate(measure, group.rows);
    }
    resultRows.push(out);
  }

  return { columns, rows: resultRows, totalRows: resultRows.length };
}

/** Libellé d'un champ de l'entité (repli sur la clé), même convention que l'onglet Rapports. */
function fieldLabel(entity: StudioSpecEntity, key: string): string {
  return entity.fields?.find(f => f.key === key)?.label || key;
}

/** Libellé d'une mesure : `sum (Nombre de jours)`, `count` — convention de l'onglet Rapports. */
function measureLabel(entity: StudioSpecEntity, measure: StudioSpecReportMeasure): string {
  return measure.field ? `${measure.fn} (${fieldLabel(entity, measure.field)})` : measure.fn;
}

/** Clé de colonne unique d'une mesure : `count`, `sum_nb_jours`, … */
function measureKey(measure: StudioSpecReportMeasure): string {
  return measure.field ? `${measure.fn}_${measure.field}` : measure.fn;
}

/** Valeur agrégée d'une mesure sur un groupe ; `null` quand rien de numérique à agréger. */
function aggregate(measure: StudioSpecReportMeasure, rows: Record<string, unknown>[]): number | null {
  const fn = String(measure.fn).toLowerCase();
  if (fn === 'count') {
    return measure.field
      ? rows.filter(row => row[measure.field!] !== null && row[measure.field!] !== undefined && row[measure.field!] !== '').length
      : rows.length;
  }
  const values = rows
    .map(row => toNumber(measure.field ? row[measure.field] : null))
    .filter((n): n is number => n !== null);
  if (values.length === 0) return null;
  switch (fn) {
    case 'sum': return values.reduce((a, b) => a + b, 0);
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min': return Math.min(...values);
    case 'max': return Math.max(...values);
    default: return null; // fn déjà filtrée — garde défensive
  }
}

/** Coercition défensive : nombres et chaînes numériques acceptés, tout le reste ignoré. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Clé de regroupement stable ; les valeurs nulles forment un groupe unique. */
function valueKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return '';
    }
  }
  return String(value);
}
