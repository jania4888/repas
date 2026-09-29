/** Backend messages for empty sales invoice / credit note period reports (French wire text). */
const INVOICE_REPORT_EMPTY_MESSAGES = [
  'Aucune facture pour cette période.',
  'Aucun avoir pour cette période.'
] as const;

const DELIVERY_NOTE_REPORT_EMPTY_MESSAGE = 'Aucun bon de livraison pour cette période.';

/** Invoice list filter value for {@link InvoiceStatus.Cancelled} (PDF état excludes cancelled documents). */
export const INVOICE_LIST_STATUS_CANCELLED = 7;

export function isEmptyInvoiceReportError(message: string | undefined): boolean {
  if (!message?.trim()) {
    return false;
  }
  const normalized = message.trim();
  return INVOICE_REPORT_EMPTY_MESSAGES.some((m) => normalized === m || normalized.includes(m));
}

export function isEmptyDeliveryNoteReportError(message: string | undefined): boolean {
  if (!message?.trim()) {
    return false;
  }
  const normalized = message.trim();
  return normalized === DELIVERY_NOTE_REPORT_EMPTY_MESSAGE || normalized.includes(DELIVERY_NOTE_REPORT_EMPTY_MESSAGE);
}
