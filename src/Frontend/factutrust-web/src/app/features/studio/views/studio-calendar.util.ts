import { RECORD_VIEW_LIMITS, RecordViewCalendarEventDto } from './studio-record-views.models';

/**
 * Grille mois/semaine « maison » du calendrier des vues enregistrées (2.5b) — aucune dépendance externe
 * (budget SCSS/JS du module Studio). Toutes les dates manipulées sont date-only (minuit local) ;
 * `toIsoDate` produit le format `yyyy-MM-dd` attendu par `RecordViewRunRequest.rangeStart/rangeEnd`
 * (`DateOnly` côté backend).
 */

export type CalendarMode = 'month' | 'week';

export interface CalendarRange {
  start: Date;
  end: Date;
}

/** Minuit local pour l'année/mois/jour de `date` (efface heure/minute/seconde). */
export function dateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const d = dateOnly(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Lundi de la semaine ISO contenant `date`. */
export function startOfWeekMonday(date: Date): Date {
  const d = dateOnly(date);
  const day = d.getDay(); // 0=dimanche .. 6=samedi
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Dimanche de la semaine ISO contenant `date`. */
export function endOfWeekSunday(date: Date): Date {
  return addDays(startOfWeekMonday(date), 6);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse une date ISO `yyyy-MM-dd` en minuit LOCAL (évite le décalage d'un jour de
 * `new Date('yyyy-MM-dd')`, interprété en UTC, dans les fuseaux négatifs).
 */
export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export function daysBetweenInclusive(start: Date, end: Date): number {
  const ms = dateOnly(end).getTime() - dateOnly(start).getTime();
  return Math.round(ms / 86400000) + 1;
}

/** Borne défensive à `maxDays` (R : `RECORD_VIEW_LIMITS.maxCalendarDays` = 92) : tronque la fin si dépassée. */
export function clampRange(range: CalendarRange, maxDays: number = RECORD_VIEW_LIMITS.maxCalendarDays): CalendarRange {
  if (daysBetweenInclusive(range.start, range.end) <= maxDays) return range;
  return { start: range.start, end: addDays(range.start, maxDays - 1) };
}

/** Plage mois : du lundi de la 1re semaine du mois au dimanche de la dernière (≤ 42 jours, 6 semaines). */
export function monthRange(anchor: Date): CalendarRange {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return clampRange({ start: startOfWeekMonday(first), end: endOfWeekSunday(last) });
}

/** Plage semaine : 7 jours, du lundi au dimanche de la semaine contenant `anchor`. */
export function weekRange(anchor: Date): CalendarRange {
  const start = startOfWeekMonday(anchor);
  return { start, end: addDays(start, 6) };
}

export function rangeForMode(mode: CalendarMode, anchor: Date): CalendarRange {
  return mode === 'month' ? monthRange(anchor) : weekRange(anchor);
}

/** Tous les jours de `range`, bornes incluses (date-only). */
export function rangeDays(range: CalendarRange): Date[] {
  const days: Date[] = [];
  let cursor = dateOnly(range.start);
  const end = dateOnly(range.end);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Découpe `days` en semaines de 7 (rendu de la grille mois). */
export function chunkWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** Navigation : mois précédent/suivant ou semaine précédente/suivante. */
export function shiftAnchor(anchor: Date, mode: CalendarMode, direction: 1 | -1): Date {
  if (mode === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
  return addDays(anchor, 7 * direction);
}

/**
 * Un événement couvre `day` (inclus) si sa date de début (ou de fin, quand fournie) l'englobe.
 * Répartition « simple » d'un événement multi-jours (R : affiché sur chaque jour couvert) — comparaison
 * lexicographique sur `yyyy-MM-dd` (pas de fuseau à gérer, DateOnly côté backend).
 */
export function eventCoversDay(event: Pick<RecordViewCalendarEventDto, 'start' | 'end'>, day: Date): boolean {
  const dayIso = toIsoDate(day);
  const start = event.start.slice(0, 10);
  const end = (event.end ?? event.start).slice(0, 10);
  return dayIso >= start && dayIso <= end;
}

export function eventsForDay(events: RecordViewCalendarEventDto[], day: Date): RecordViewCalendarEventDto[] {
  return events.filter(e => eventCoversDay(e, day));
}

export function isMultiDay(event: Pick<RecordViewCalendarEventDto, 'start' | 'end'>): boolean {
  if (!event.end) return false;
  return event.end.slice(0, 10) !== event.start.slice(0, 10);
}

/**
 * Échelle de couleur déterministe (hachage simple de la valeur) — indépendante des libellés métier :
 * la même valeur produit toujours le même index de palette, sans configuration ni appel réseau.
 */
export function colorScaleIndex(value: string, paletteSize: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return paletteSize > 0 ? hash % paletteSize : 0;
}
