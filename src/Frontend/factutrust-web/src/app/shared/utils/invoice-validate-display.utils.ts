export type LineImpactTone = 'ok' | 'warning' | 'error' | 'muted';
export type LineImpactQuantityKind = 'none' | 'remaining' | 'available';

export interface ValidateLineAvailabilityView {
  isStockManaged: boolean;
  isAvailable: boolean;
  alertLevel: string;
  humanMessage: string;
  availableQuantity: number;
  remainingAfterSale: number;
}

export interface LineImpactDisplay {
  tone: LineImpactTone;
  text: string;
  quantity: number | null;
  quantityKind: LineImpactQuantityKind;
}

export function lineImpactDisplay(
  detail: ValidateLineAvailabilityView | undefined
): LineImpactDisplay {
  if (!detail || !detail.isStockManaged) {
    return { tone: 'muted', text: '—', quantity: null, quantityKind: 'none' };
  }

  if (!detail.isAvailable) {
    return {
      tone: 'error',
      text: $localize`:@@shared.invoice-validate-display.ts.stock.insuffisant.995fd9ad:Stock insuffisant`,
      quantity: detail.availableQuantity,
      quantityKind: 'available'
    };
  }

  if (detail.alertLevel === 'warning') {
    return {
      tone: 'warning',
      text: detail.humanMessage || '—',
      quantity: null,
      quantityKind: 'none'
    };
  }

  if (detail.alertLevel === 'error') {
    return {
      tone: 'error',
      text: detail.humanMessage || $localize`:@@shared.invoice-validate-display.ts.stock.insuffisant.995fd9ad:Stock insuffisant`,
      quantity: null,
      quantityKind: 'none'
    };
  }

  return {
    tone: 'ok',
    text: $localize`:@@shared.invoice-validate-display.ts.restera.a725d6b8:Restera`,
    quantity: detail.remainingAfterSale,
    quantityKind: 'remaining'
  };
}

export function isValidateLineInsufficient(
  detail: ValidateLineAvailabilityView | undefined
): boolean {
  if (!detail) return false;
  return detail.alertLevel === 'error' || detail.isAvailable === false;
}

export function isValidateLineWarning(
  detail: ValidateLineAvailabilityView | undefined
): boolean {
  if (!detail) return false;
  return detail.alertLevel === 'warning' && detail.isAvailable !== false;
}
