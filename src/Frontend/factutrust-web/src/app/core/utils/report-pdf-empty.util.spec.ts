import {
  isEmptyDeliveryNoteReportError,
  isEmptyInvoiceReportError
} from './report-pdf-empty.util';

describe('report-pdf-empty.util', () => {
  it('detects empty invoice report messages', () => {
    expect(isEmptyInvoiceReportError('Aucune facture pour cette période.')).toBe(true);
    expect(isEmptyInvoiceReportError('Aucun avoir pour cette période.')).toBe(true);
    expect(isEmptyInvoiceReportError('Trop de factures. Réduisez la période.')).toBe(false);
  });

  it('detects empty delivery note report messages', () => {
    expect(isEmptyDeliveryNoteReportError('Aucun bon de livraison pour cette période.')).toBe(true);
    expect(isEmptyDeliveryNoteReportError('Erreur serveur')).toBe(false);
  });
});
