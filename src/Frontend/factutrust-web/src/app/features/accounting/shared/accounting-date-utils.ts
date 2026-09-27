// `formatLocalDate` (YYYY-MM-DD sans décalage fuseau) vit désormais dans @core/utils/date.util
// (source unique). Réexporté ici pour préserver les imports existants du module comptabilité.
import { formatLocalDate } from '@core/utils/date.util';
export { formatLocalDate };

/**
 * Parse une chaîne YYYY-MM-DD (input type="date") en Date locale minuit.
 */
export function parseLocalDateString(ymd: string): Date {
  const parts = ymd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
    return new Date(NaN);
  }
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}

export function validateDateRange(from: Date, to: Date): { valid: boolean; message?: string } {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { valid: false, message: $localize`:@@accounting.accounting-date-utils.ts.dates.invalides.d5c40044:Dates invalides.` };
  }
  if (from.getTime() > to.getTime()) {
    return { valid: false, message: $localize`:@@accounting.accounting-date-utils.ts.la.date.de.debut.doit.etre.anterieure.ou.709070bf:La date de début doit être antérieure ou égale à la date de fin.` };
  }
  return { valid: true };
}

export function todayLocalYmd(): string {
  return formatLocalDate(new Date());
}

export function firstDayOfMonthLocalYmd(): string {
  const t = new Date();
  return formatLocalDate(new Date(t.getFullYear(), t.getMonth(), 1));
}

export function firstDayOfYearLocalYmd(): string {
  const t = new Date();
  return formatLocalDate(new Date(t.getFullYear(), 0, 1));
}
