import { ParamMap } from '@angular/router';
import { DeliveryNoteStatus } from '../../features/delivery-notes/models/delivery-note.model';

export function parseSearchQueryParam(params: ParamMap): string | null {
  const raw = params.get('search');
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseDateQueryParam(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export interface InvoiceListFilterState {
  selectedStatus: number | null;
  dateRange: Date[] | null;
  selectedClientId: string | null;
  search: string | null;
  /**
   * Vue « Factures et avoirs » uniquement : filtre « Comptés dans le CA (Payée + Validée) ».
   * Optionnel pour ne pas impacter les autres modes de la liste. Le paramètre d'URL
   * `realizedRevenueOnly=false` le désactive ; toute autre valeur (ou son absence) garde
   * l'état courant, dont la valeur par défaut est `true` côté composant.
   */
  realizedRevenueOnly?: boolean;
}

export function applyInvoiceListFiltersFromQuery(
  params: ParamMap,
  state: InvoiceListFilterState
): InvoiceListFilterState {
  const next: InvoiceListFilterState = {
    selectedStatus: state.selectedStatus,
    dateRange: state.dateRange ? [...state.dateRange] : null,
    selectedClientId: state.selectedClientId,
    search: state.search,
    realizedRevenueOnly: state.realizedRevenueOnly
  };

  const statusRaw = params.get('status');
  if (statusRaw !== null && statusRaw !== '') {
    const status = Number(statusRaw);
    if (!Number.isNaN(status)) {
      next.selectedStatus = status;
    }
  }

  const fromDate = parseDateQueryParam(params.get('fromDate'));
  const toDate = parseDateQueryParam(params.get('toDate'));
  if (fromDate || toDate) {
    next.dateRange = [fromDate ?? toDate!, toDate ?? fromDate!];
  }

  const clientId = params.get('clientId');
  if (clientId) {
    next.selectedClientId = clientId;
  }

  const search = parseSearchQueryParam(params);
  if (search) {
    next.search = search;
  }

  const realizedRevenueOnlyRaw = params.get('realizedRevenueOnly');
  if (realizedRevenueOnlyRaw !== null) {
    next.realizedRevenueOnly = realizedRevenueOnlyRaw !== 'false';
  }

  return next;
}

export interface ClientListFilterState {
  search: string | null;
}

export function applyClientListFiltersFromQuery(
  params: ParamMap,
  state: ClientListFilterState
): ClientListFilterState {
  const search = parseSearchQueryParam(params);
  if (search) {
    return { search };
  }
  return { search: state.search };
}

export interface ProductListFilterState {
  search: string | null;
}

export function applyProductListFiltersFromQuery(
  params: ParamMap,
  state: ProductListFilterState
): ProductListFilterState {
  const search = parseSearchQueryParam(params);
  if (search) {
    return { search };
  }
  return { search: state.search };
}

export interface SupplierListFilterState {
  search: string | null;
}

export function applySupplierListFiltersFromQuery(
  params: ParamMap,
  state: SupplierListFilterState
): SupplierListFilterState {
  const search = parseSearchQueryParam(params);
  if (search) {
    return { search };
  }
  return { search: state.search };
}

export interface SupplierInvoiceListFilterState {
  selectedStatus: number | null;
  selectedSupplierId: string | null;
  search: string | null;
}

export function applySupplierInvoiceListFiltersFromQuery(
  params: ParamMap,
  state: SupplierInvoiceListFilterState
): SupplierInvoiceListFilterState {
  const next: SupplierInvoiceListFilterState = {
    selectedStatus: state.selectedStatus,
    selectedSupplierId: state.selectedSupplierId,
    search: state.search
  };

  const statusRaw = params.get('status');
  if (statusRaw !== null && statusRaw !== '') {
    const status = Number(statusRaw);
    if (!Number.isNaN(status)) {
      next.selectedStatus = status;
    }
  }

  const supplierId = params.get('supplierId');
  if (supplierId) {
    next.selectedSupplierId = supplierId;
  }

  const search = parseSearchQueryParam(params);
  if (search) {
    next.search = search;
  }

  return next;
}

export interface DeliveryNoteListFilterState {
  selectedStatus: DeliveryNoteStatus | null;
  search: string | null;
}

const DELIVERY_NOTE_STATUSES = new Set<string>(Object.values(DeliveryNoteStatus));

export function applyDeliveryNoteListFiltersFromQuery(
  params: ParamMap,
  state: DeliveryNoteListFilterState
): DeliveryNoteListFilterState {
  const next: DeliveryNoteListFilterState = {
    selectedStatus: state.selectedStatus,
    search: state.search
  };

  const statusRaw = params.get('status');
  if (statusRaw && DELIVERY_NOTE_STATUSES.has(statusRaw)) {
    next.selectedStatus = statusRaw as DeliveryNoteStatus;
  }

  const search = parseSearchQueryParam(params);
  if (search) {
    next.search = search;
  }

  return next;
}

export interface QuoteListFilterState {
  selectedStatus: number | null;
  activeOnly: boolean;
  search: string | null;
}

export function isActiveQuoteStatus(status: string | undefined | null): boolean {
  const s = (status?.toLowerCase() || '').normalize('NFD').replace(/\p{M}/gu, '');
  return (
    s.includes('brouillon') ||
    s.includes('draft') ||
    s.includes('envoye') ||
    s.includes('sent') ||
    s.includes('en attente') ||
    s.includes('pending')
  );
}

export function applyQuoteListFiltersFromQuery(
  params: ParamMap,
  state: QuoteListFilterState
): QuoteListFilterState {
  const next: QuoteListFilterState = {
    selectedStatus: state.selectedStatus,
    activeOnly: state.activeOnly,
    search: state.search
  };

  if (params.get('activeOnly') === '1') {
    next.activeOnly = true;
    next.selectedStatus = null;
    return next;
  }

  const statusRaw = params.get('status');
  if (statusRaw !== null && statusRaw !== '') {
    const status = Number(statusRaw);
    if (!Number.isNaN(status)) {
      next.selectedStatus = status;
      next.activeOnly = false;
    }
  }

  const search = parseSearchQueryParam(params);
  if (search) {
    next.search = search;
  }

  return next;
}

export interface ProjectListFilterState {
  search: string | null;
  status: string | null;
  kind: string | null;
  clientId: string | null;
}

export function applyProjectListFiltersFromQuery(
  params: ParamMap,
  state: ProjectListFilterState
): ProjectListFilterState {
  const next: ProjectListFilterState = { ...state };
  const search = parseSearchQueryParam(params);
  if (search) next.search = search;

  const status = params.get('status');
  if (status) next.status = status;

  const kind = params.get('kind');
  if (kind) next.kind = kind;

  const clientId = params.get('clientId');
  if (clientId) next.clientId = clientId;

  return next;
}