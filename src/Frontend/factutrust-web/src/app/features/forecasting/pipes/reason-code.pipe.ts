import { Pipe, PipeTransform } from '@angular/core';

/**
 * Translates backend reason codes (e.g. <c>"OutOfStock"</c>, <c>"DailyDemand:0.56"</c>) to user-facing
 * French strings. Mirrors the logic that used to live inline in <c>ReplenishmentBoardComponent.formatReasonCode</c>
 * — extracted here so it is reusable, testable and i18n-ready (Phase 8 will swap the dictionary
 * for a translation key lookup).
 *
 * Unknown codes are returned unchanged so the backend can ship new codes without an immediate
 * front-end deploy (forward-compatible).
 */
@Pipe({
  name: 'reasonCode',
  standalone: true,
  pure: true
})
export class ReasonCodePipe implements PipeTransform {
  // Static dictionary of fixed translations. Add new entries as the backend grows the vocabulary.
  // Keys are case-sensitive on purpose to match the backend's PascalCase output.
  private static readonly STATIC_TRANSLATIONS: Readonly<Record<string, string>> = {
    OutOfStock: $localize`:@@forecasting.reason-code.pipe.ts.rupture.de.stock.7703fca2:Rupture de stock`,
    BelowSafetyStock: $localize`:@@forecasting.reason-code.pipe.ts.sous.le.stock.de.securite.4d5df634:Sous le stock de sécurité`,
    AtOrBelowReorderPoint: $localize`:@@forecasting.reason-code.pipe.ts.au.point.de.commande.03e1a203:Au point de commande`,
    BelowUserMinimumStock: $localize`:@@forecasting.reason-code.pipe.ts.sous.le.stock.min.configure.d3d3b614:Sous le stock min. configuré`,
    SeasonalUpcomingEvent: $localize`:@@forecasting.reason-code.pipe.ts.evenement.saisonnier.a.venir.287314ec:Événement saisonnier à venir`
  };

  transform(code: string | null | undefined): string {
    if (!code) return '';

    // Codes shaped "Key:value" — e.g. "DailyDemand:0.56" — are split on the FIRST ':' only.
    const sepIdx = code.indexOf(':');
    const key = sepIdx >= 0 ? code.substring(0, sepIdx) : code;
    const rawValue = sepIdx >= 0 ? code.substring(sepIdx + 1) : null;

    const fixed = ReasonCodePipe.STATIC_TRANSLATIONS[key];
    if (fixed) return fixed;

    if (key === 'DailyDemand') {
      // Number('') === 0 en JS : une valeur vide/espaces n'est PAS un nombre — on la traite comme telle.
      const num = rawValue !== null && rawValue.trim() !== '' ? Number(rawValue) : Number.NaN;
      const formatted = isFinite(num)
        ? num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : (rawValue ?? '?');
      return `Demande quotidienne : ${formatted} u/j`;
    }

    // Unknown code (e.g. future backend addition) — return raw so the user/tester sees it.
    return code;
  }
}
