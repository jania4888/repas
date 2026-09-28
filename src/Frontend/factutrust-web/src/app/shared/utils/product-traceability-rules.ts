import type { StockFeatures } from '@core/services/stock.service';
import {
  COSTING_AVERAGE,
  COSTING_FIFO,
  COSTING_LIFO,
  PICKING_FEFO,
  PICKING_FIFO_PHYSICAL,
  PICKING_MANUAL,
  PICKING_NONE,
  TRACKING_MODE_LOT,
  TRACKING_MODE_NONE,
  TRACKING_MODE_SERIAL,
  coercePickingPolicy,
  coerceTrackingMode
} from './stock-traceability.utils';

export interface SelectOption<T = number> {
  label: string;
  value: T;
  disabled?: boolean;
}

export interface TraceabilityFormState {
  category: string;
  isStockManaged: boolean;
  trackingMode: number;
  hasExpiryTracking: boolean;
  pickingPolicy: number;
  costingMethod: number;
  expiryAlertDays: number | null;
}

export const DEFAULT_TRACEABILITY_STATE: Pick<
  TraceabilityFormState,
  'trackingMode' | 'hasExpiryTracking' | 'pickingPolicy' | 'costingMethod' | 'expiryAlertDays'
> = {
  trackingMode: TRACKING_MODE_NONE,
  hasExpiryTracking: false,
  pickingPolicy: PICKING_NONE,
  costingMethod: COSTING_AVERAGE,
  expiryAlertDays: null
};

export function isTraceabilitySectionVisible(
  category: string,
  features: StockFeatures | null,
  canMutate: boolean
): boolean {
  if (!features || !canMutate || category !== 'Produit') return false;
  return (
    features.lotTrackingEnabled
    || features.serialTrackingEnabled
    || features.expiryTrackingEnabled
    || features.fifoLifoValuationEnabled
  );
}

export function isTraceabilityEditable(
  category: string,
  isStockManaged: boolean
): boolean {
  return category === 'Produit' && isStockManaged;
}

export function getTrackingModeOptions(
  features: StockFeatures | null,
  currentMode?: number
): SelectOption[] {
  const mode = coerceTrackingMode(currentMode);
  const options: SelectOption[] = [{ label: $localize`:@@shared.product-traceability-rules.ts.aucun.b2ed82f1:Aucun`, value: TRACKING_MODE_NONE }];

  if (features?.lotTrackingEnabled || mode === TRACKING_MODE_LOT) {
    options.push({
      label: $localize`:@@shared.product-traceability-rules.ts.lot.4a211932:Lot`,
      value: TRACKING_MODE_LOT,
      disabled: !features?.lotTrackingEnabled
    });
  }

  if (features?.serialTrackingEnabled || mode === TRACKING_MODE_SERIAL) {
    options.push({
      label: $localize`:@@shared.product-traceability-rules.ts.n.de.serie.6b826381:N° de série`,
      value: TRACKING_MODE_SERIAL,
      disabled: !features?.serialTrackingEnabled
    });
  }

  return options;
}

export function showPickingField(trackingMode: unknown): boolean {
  return coerceTrackingMode(trackingMode) === TRACKING_MODE_LOT;
}

export function showExpiryFields(
  trackingMode: unknown,
  features: StockFeatures | null
): boolean {
  if (!features?.expiryTrackingEnabled) return false;
  const mode = coerceTrackingMode(trackingMode);
  return mode === TRACKING_MODE_LOT || mode === TRACKING_MODE_SERIAL;
}

export function getPickingPolicyOptions(
  trackingMode: unknown,
  hasExpiryTracking: boolean
): SelectOption[] {
  if (!showPickingField(trackingMode)) return [];

  return [
    { label: $localize`:@@shared.product-traceability-rules.ts.manuel.choix.du.lot.a.la.sortie.9adf0874:Manuel (choix du lot à la sortie)`, value: PICKING_NONE },
    {
      label: $localize`:@@shared.product-traceability-rules.ts.fefo.peremption.5413473d:FEFO (péremption)`,
      value: PICKING_FEFO,
      disabled: !hasExpiryTracking
    },
    { label: $localize`:@@shared.product-traceability-rules.ts.fifo.physique.d9dcd776:FIFO physique`, value: PICKING_FIFO_PHYSICAL }
  ];
}

export function getCostingMethodOptions(
  features: StockFeatures | null,
  isEditMode: boolean,
  originalCostingMethod: number
): SelectOption[] {
  if (!features?.fifoLifoValuationEnabled) {
    return [{ label: 'CMUP', value: COSTING_AVERAGE }];
  }

  const lockAverage = isEditMode
    && (originalCostingMethod === COSTING_FIFO || originalCostingMethod === COSTING_LIFO);

  return [
    { label: 'CMUP', value: COSTING_AVERAGE, disabled: lockAverage },
    { label: 'FIFO', value: COSTING_FIFO },
    { label: $localize`:@@shared.product-traceability-rules.ts.lifo.attention.comptes.statutaires.52268aff:LIFO (attention comptes statutaires)`, value: COSTING_LIFO }
  ];
}

export function showCostingMethodDropdown(features: StockFeatures | null): boolean {
  return !!features?.fifoLifoValuationEnabled;
}

export function getTrackingModeHint(): string {
  return $localize`:@@shared.product-traceability-rules.ts.definit.si.les.mouvements.exigent.un.lot.7552007a:Définit si les mouvements exigent un lot ou un numéro de série.`;
}

export function getPickingPolicyHint(hasExpiryTracking: boolean): string {
  if (!hasExpiryTracking) {
    return $localize`:@@shared.product-traceability-rules.ts.lot.uniquement.activez.le.suivi.dluo.pou.7f43ede8:Lot uniquement. Activez le suivi DLUO pour utiliser FEFO.`;
  }
  return $localize`:@@shared.product-traceability-rules.ts.lot.uniquement.fefo.lots.les.plus.proche.7238bf50:Lot uniquement. FEFO : lots les plus proches de la péremption en premier.`;
}

export function getCostingMethodHint(): string {
  return $localize`:@@shared.product-traceability-rules.ts.cmup.recommande.comptes.statutaires.tn.l.f65605fd:CMUP recommandé (comptes statutaires TN). LIFO : usage interne uniquement.`;
}

export interface NormalizeTraceabilityResult {
  state: Pick<
    TraceabilityFormState,
    'trackingMode' | 'hasExpiryTracking' | 'pickingPolicy' | 'costingMethod' | 'expiryAlertDays'
  >;
  /** True when FEFO was auto-switched to FIFO physical */
  fefoDowngraded: boolean;
}

export function normalizeTraceabilityForm(
  state: TraceabilityFormState,
  features: StockFeatures | null
): NormalizeTraceabilityResult {
  let fefoDowngraded = false;

  if (!isTraceabilityEditable(state.category, state.isStockManaged)) {
    return { state: { ...DEFAULT_TRACEABILITY_STATE }, fefoDowngraded: false };
  }

  let trackingMode = coerceTrackingMode(state.trackingMode);
  let pickingPolicy = coercePickingPolicy(state.pickingPolicy);
  let hasExpiryTracking = !!state.hasExpiryTracking;
  let expiryAlertDays = state.expiryAlertDays;
  let costingMethod = state.costingMethod ?? COSTING_AVERAGE;

  if (pickingPolicy === PICKING_MANUAL) {
    pickingPolicy = PICKING_NONE;
  }

  const trackingOptions = getTrackingModeOptions(features, trackingMode);
  if (!trackingOptions.some(o => o.value === trackingMode && !o.disabled)) {
    trackingMode = TRACKING_MODE_NONE;
  }

  if (trackingMode === TRACKING_MODE_NONE) {
    pickingPolicy = PICKING_NONE;
    hasExpiryTracking = false;
    expiryAlertDays = null;
  } else if (trackingMode === TRACKING_MODE_SERIAL) {
    pickingPolicy = PICKING_NONE;
  }

  if (!features?.expiryTrackingEnabled) {
    hasExpiryTracking = false;
    expiryAlertDays = null;
  }

  if (!showPickingField(trackingMode)) {
    pickingPolicy = PICKING_NONE;
  }

  if (pickingPolicy === PICKING_FEFO && !hasExpiryTracking) {
    pickingPolicy = PICKING_FIFO_PHYSICAL;
    fefoDowngraded = true;
  }

  if (!features?.fifoLifoValuationEnabled) {
    costingMethod = COSTING_AVERAGE;
  } else if (costingMethod !== COSTING_FIFO && costingMethod !== COSTING_LIFO) {
    costingMethod = COSTING_AVERAGE;
  }

  return {
    state: {
      trackingMode,
      hasExpiryTracking,
      pickingPolicy,
      costingMethod,
      expiryAlertDays
    },
    fefoDowngraded
  };
}

export function formatTrackingModeLabel(mode: unknown): string {
  const m = coerceTrackingMode(mode);
  if (m === TRACKING_MODE_LOT) return $localize`:@@shared.product-traceability-rules.ts.lot.4a211932:Lot`;
  if (m === TRACKING_MODE_SERIAL) return $localize`:@@shared.product-traceability-rules.ts.n.de.serie.6b826381:N° de série`;
  return $localize`:@@shared.product-traceability-rules.ts.aucun.suivi.25d943ac:Aucun suivi`;
}

export function formatPickingPolicyLabel(policy: unknown): string {
  const p = coercePickingPolicy(policy);
  if (p === PICKING_FEFO) return $localize`:@@shared.product-traceability-rules.ts.fefo.peremption.5413473d:FEFO (péremption)`;
  if (p === PICKING_FIFO_PHYSICAL) return $localize`:@@shared.product-traceability-rules.ts.fifo.physique.d9dcd776:FIFO physique`;
  if (p === PICKING_MANUAL || p === PICKING_NONE) return $localize`:@@shared.product-traceability-rules.ts.manuel.choix.du.lot.620f4076:Manuel (choix du lot)`;
  return '—';
}

export function formatCostingMethodLabel(method: number | undefined | null): string {
  if (method === COSTING_FIFO) return 'FIFO';
  if (method === COSTING_LIFO) return 'LIFO';
  return 'CMUP';
}
