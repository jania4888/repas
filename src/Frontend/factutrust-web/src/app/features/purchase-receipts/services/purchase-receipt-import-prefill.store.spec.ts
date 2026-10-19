import { PurchaseReceiptImportPrefillStore, PurchaseReceiptImportPayload } from './purchase-receipt-import-prefill.store';

describe('PurchaseReceiptImportPrefillStore', () => {
  let store: PurchaseReceiptImportPrefillStore;

  beforeEach(() => {
    store = new PurchaseReceiptImportPrefillStore();
  });

  function makePayload(): PurchaseReceiptImportPayload {
    return {
      proposal: {} as PurchaseReceiptImportPayload['proposal'],
      file: new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })
    };
  }

  it('n’a rien en attente au départ', () => {
    expect(store.hasPending).toBeFalse();
    expect(store.consume()).toBeNull();
  });

  it('set() dépose une proposition, hasPending devient vrai', () => {
    const payload = makePayload();
    store.set(payload);
    expect(store.hasPending).toBeTrue();
  });

  it('consume() renvoie la proposition déposée puis vide le store (consommation unique)', () => {
    const payload = makePayload();
    store.set(payload);

    expect(store.consume()).toBe(payload);
    expect(store.hasPending).toBeFalse();
    expect(store.consume()).toBeNull();
  });

  it('clear() efface la proposition sans la renvoyer', () => {
    store.set(makePayload());
    store.clear();
    expect(store.hasPending).toBeFalse();
    expect(store.consume()).toBeNull();
  });
});
