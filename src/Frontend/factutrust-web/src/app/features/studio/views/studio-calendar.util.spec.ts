import {
  addDays, chunkWeeks, clampRange, colorScaleIndex, daysBetweenInclusive, endOfWeekSunday,
  eventCoversDay, eventsForDay, isMultiDay, isSameDay, monthRange, rangeDays, rangeForMode,
  shiftAnchor, startOfWeekMonday, toIsoDate, weekRange
} from './studio-calendar.util';
import { RecordViewCalendarEventDto } from './studio-record-views.models';

describe('studio-calendar.util', () => {
  it('startOfWeekMonday / endOfWeekSunday retournent le lundi et le dimanche de la semaine ISO', () => {
    // Mercredi 16 septembre 2026
    const d = new Date(2026, 8, 16);
    expect(toIsoDate(startOfWeekMonday(d))).toBe('2026-09-14');
    expect(toIsoDate(endOfWeekSunday(d))).toBe('2026-09-20');
  });

  it('startOfWeekMonday gère un dimanche (jour 0)', () => {
    const sunday = new Date(2026, 8, 20);
    expect(toIsoDate(startOfWeekMonday(sunday))).toBe('2026-09-14');
  });

  it('monthRange couvre du lundi de la 1re semaine au dimanche de la dernière, ≤ 42 jours', () => {
    // Septembre 2026 : le 1er est un mardi, le 30 un mercredi.
    const range = monthRange(new Date(2026, 8, 15));
    expect(toIsoDate(range.start)).toBe('2026-08-31'); // lundi précédant le 1er septembre
    expect(toIsoDate(range.end)).toBe('2026-10-04'); // dimanche suivant le 30 septembre
    expect(daysBetweenInclusive(range.start, range.end)).toBeLessThanOrEqual(42);
    expect(daysBetweenInclusive(range.start, range.end) % 7).toBe(0);
  });

  it('monthRange traverse une frontière d’année (décembre → janvier)', () => {
    const range = monthRange(new Date(2026, 11, 10)); // décembre 2026
    expect(range.start.getFullYear()).toBe(2026);
    expect(range.end.getFullYear()).toBe(2027);
    expect(daysBetweenInclusive(range.start, range.end)).toBeLessThanOrEqual(42);
  });

  it('weekRange couvre exactement 7 jours (lundi → dimanche)', () => {
    const range = weekRange(new Date(2026, 8, 16));
    expect(toIsoDate(range.start)).toBe('2026-09-14');
    expect(toIsoDate(range.end)).toBe('2026-09-20');
    expect(daysBetweenInclusive(range.start, range.end)).toBe(7);
    expect(rangeDays(range).length).toBe(7);
  });

  it('rangeForMode délègue à monthRange/weekRange selon le mode', () => {
    const anchor = new Date(2026, 8, 16);
    expect(toIsoDate(rangeForMode('week', anchor).start)).toBe(toIsoDate(weekRange(anchor).start));
    expect(toIsoDate(rangeForMode('month', anchor).start)).toBe(toIsoDate(monthRange(anchor).start));
  });

  it('clampRange tronque une plage dépassant 92 jours', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31); // 365 jours
    const clamped = clampRange({ start, end }, 92);
    expect(daysBetweenInclusive(clamped.start, clamped.end)).toBe(92);
  });

  it('clampRange laisse une plage déjà conforme inchangée', () => {
    const range = weekRange(new Date(2026, 8, 16));
    expect(clampRange(range, 92)).toEqual(range);
  });

  it('chunkWeeks découpe les jours du mois en semaines de 7', () => {
    const range = monthRange(new Date(2026, 8, 15));
    const weeks = chunkWeeks(rangeDays(range));
    expect(weeks.every(w => w.length === 7)).toBe(true);
    expect(weeks.length * 7).toBe(daysBetweenInclusive(range.start, range.end));
  });

  it('shiftAnchor avance/recule d’un mois ou d’une semaine', () => {
    const anchor = new Date(2026, 8, 16);
    expect(shiftAnchor(anchor, 'month', 1).getMonth()).toBe(9);
    expect(shiftAnchor(anchor, 'month', -1).getMonth()).toBe(7);
    expect(toIsoDate(shiftAnchor(anchor, 'week', 1))).toBe(toIsoDate(addDays(anchor, 7)));
  });

  it('shiftAnchor mois gère la frontière d’année', () => {
    const anchor = new Date(2026, 11, 1);
    const next = shiftAnchor(anchor, 'month', 1);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
  });

  it('eventCoversDay couvre chaque jour d’un événement multi-jours', () => {
    const event: RecordViewCalendarEventDto = { recordId: 'r1', title: 'X', start: '2026-09-10', end: '2026-09-12' };
    expect(eventCoversDay(event, new Date(2026, 8, 10))).toBe(true);
    expect(eventCoversDay(event, new Date(2026, 8, 11))).toBe(true);
    expect(eventCoversDay(event, new Date(2026, 8, 12))).toBe(true);
    expect(eventCoversDay(event, new Date(2026, 8, 13))).toBe(false);
    expect(eventCoversDay(event, new Date(2026, 8, 9))).toBe(false);
  });

  it('eventCoversDay gère un événement sans fin (jour unique)', () => {
    const event: RecordViewCalendarEventDto = { recordId: 'r1', title: 'X', start: '2026-09-10', end: null };
    expect(eventCoversDay(event, new Date(2026, 8, 10))).toBe(true);
    expect(eventCoversDay(event, new Date(2026, 8, 11))).toBe(false);
  });

  it('eventsForDay filtre les événements touchant un jour donné', () => {
    const events: RecordViewCalendarEventDto[] = [
      { recordId: 'r1', title: 'A', start: '2026-09-10', end: null },
      { recordId: 'r2', title: 'B', start: '2026-09-10', end: '2026-09-11' },
      { recordId: 'r3', title: 'C', start: '2026-09-12', end: null }
    ];
    expect(eventsForDay(events, new Date(2026, 8, 10)).map(e => e.recordId)).toEqual(['r1', 'r2']);
    expect(eventsForDay(events, new Date(2026, 8, 12)).map(e => e.recordId)).toEqual(['r3']);
  });

  it('isMultiDay distingue un événement ponctuel d’un événement étalé', () => {
    expect(isMultiDay({ start: '2026-09-10', end: null })).toBe(false);
    expect(isMultiDay({ start: '2026-09-10', end: '2026-09-10' })).toBe(false);
    expect(isMultiDay({ start: '2026-09-10', end: '2026-09-11' })).toBe(true);
  });

  it('isSameDay compare année/mois/jour uniquement', () => {
    expect(isSameDay(new Date(2026, 8, 10, 3), new Date(2026, 8, 10, 23))).toBe(true);
    expect(isSameDay(new Date(2026, 8, 10), new Date(2026, 8, 11))).toBe(false);
  });

  it('toIsoDate produit yyyy-MM-dd avec zéros de tête', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('colorScaleIndex est déterministe et borné à la taille de la palette', () => {
    const size = 8;
    const a = colorScaleIndex('Terminée', size);
    const b = colorScaleIndex('Terminée', size);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(size);
    // Deux valeurs différentes n'ont pas nécessairement le même index, mais restent dans la borne.
    expect(colorScaleIndex('À planifier', size)).toBeLessThan(size);
  });
});
