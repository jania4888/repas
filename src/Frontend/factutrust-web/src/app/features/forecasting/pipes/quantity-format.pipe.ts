import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a numeric quantity for display, using French locale (comma decimal separator)
 * and choosing 0 vs. 2 decimals based on the product's unit (discrete units like "Pièce"
 * round to integers; continuous units like "Kg" keep 2 decimals).
 *
 * Usage in templates: <c>{{ qty | qtyFmt: productUnit }}</c>.
 *
 * Extracted from <c>ReplenishmentBoardComponent.qtyFormat</c> for reuse + testability.
 * The AI payload continues to send raw numeric values (the pipe only affects rendering).
 */
@Pipe({
  name: 'qtyFmt',
  standalone: true,
  pure: true
})
export class QuantityFormatPipe implements PipeTransform {
  // Case-insensitive list of unit labels that should be displayed as integers (no decimals).
  private static readonly DISCRETE_UNITS: ReadonlySet<string> = new Set([
    'unité', 'unite', 'u',
    'pièce', 'piece', 'pièces', 'pieces',
    'pcs', 'pc', 'pce'
  ]);

  transform(qty: number | null | undefined, unit: string | null | undefined): string {
    if (qty === null || qty === undefined || !isFinite(qty)) return '0';
    const digits = QuantityFormatPipe.isDiscreteUnit(unit) ? 0 : 2;
    return qty.toLocaleString('fr-FR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  static isDiscreteUnit(unit: string | null | undefined): boolean {
    if (!unit) return false;
    return QuantityFormatPipe.DISCRETE_UNITS.has(unit.trim().toLowerCase());
  }

  /** Numeric qty for editable fields — mirrors {@link transform} rounding rules. */
  static toEditableQuantity(qty: number, unit: string | null | undefined): number {
    if (!isFinite(qty)) return 0;
    if (QuantityFormatPipe.isDiscreteUnit(unit)) {
      return Math.round(qty);
    }
    return Math.round(qty * 100) / 100;
  }
}
