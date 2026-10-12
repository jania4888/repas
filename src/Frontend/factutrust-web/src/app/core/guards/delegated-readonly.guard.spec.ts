import { isDelegatedWritePath } from './delegated-readonly.guard';

describe('isDelegatedWritePath', () => {
  it('allows the sales credit-notes list (read)', () => {
    expect(isDelegatedWritePath('/invoices/credit-notes')).toBe(false);
    expect(isDelegatedWritePath('/invoices/credit-notes/abc-id')).toBe(false);
  });

  it('blocks credit-note creation routes', () => {
    expect(isDelegatedWritePath('/invoices/credit-note/new')).toBe(true);
    expect(isDelegatedWritePath('/invoices/inv-1/credit-note')).toBe(true);
  });

  it('still blocks generic /new and /edit write suffixes', () => {
    expect(isDelegatedWritePath('/invoices/new')).toBe(true);
    expect(isDelegatedWritePath('/invoices/new/draft/1')).toBe(true);
    expect(isDelegatedWritePath('/clients/c1/edit')).toBe(true);
  });

  it('allows regular invoice list and detail', () => {
    expect(isDelegatedWritePath('/invoices')).toBe(false);
    expect(isDelegatedWritePath('/invoices/unpaid')).toBe(false);
    expect(isDelegatedWritePath('/invoices/inv-1')).toBe(false);
  });

  it('allows the revenue view (Factures et avoirs) list and detail', () => {
    expect(isDelegatedWritePath('/invoices/revenue')).toBe(false);
    expect(isDelegatedWritePath('/invoices/revenue/inv-1')).toBe(false);
  });
});
