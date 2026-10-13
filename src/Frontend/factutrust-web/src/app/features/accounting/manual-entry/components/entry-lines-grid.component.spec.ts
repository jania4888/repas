import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EntryLinesGridComponent } from './entry-lines-grid.component';
import { EntryFormStore } from '../services/entry-form.store';
import { EntryReferenceStore } from '../services/entry-reference.store';
import { VatAssistService } from '../services/vat-assist.service';
import { createEmptyLine } from '../models/entry-form.model';

describe('EntryLinesGridComponent', () => {
  let fixture: ComponentFixture<EntryLinesGridComponent>;
  let store: EntryFormStore;

  const refsMock = {
    vatRates: signal([{ id: '1', percent: 19, label: '19%' }]),
    thirdPartySuggestions: signal([]),
    filterAccounts: () => [],
    searchThirdParties: jasmine.createSpy('searchThirdParties'),
    accounts: () => []
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntryLinesGridComponent],
      providers: [
        provideNoopAnimations(),
        EntryFormStore,
        { provide: EntryReferenceStore, useValue: refsMock },
        { provide: VatAssistService, useValue: { applyVatToLine: jasmine.createSpy('applyVatToLine') } }
      ]
    }).compileComponents();

    store = TestBed.inject(EntryFormStore);
    fixture = TestBed.createComponent(EntryLinesGridComponent);
    fixture.detectChanges();
  });

  it('renders lines grid title and scrollable table', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Lignes d'écriture");
    expect(el.querySelector('.entry-lines-table')).toBeTruthy();
    expect(el.querySelector('.p-datatable-scrollable')).toBeTruthy();
  });

  it('renders autocomplete fields', () => {
    const autocompletes = fixture.nativeElement.querySelectorAll('p-autocomplete');
    expect(autocompletes.length).toBeGreaterThanOrEqual(2);
  });

  it('renders accounting amount inputs for debit and credit', () => {
    const amountInputs = fixture.nativeElement.querySelectorAll('app-accounting-amount-input');
    expect(amountInputs.length).toBeGreaterThanOrEqual(4);
  });

  it('shows TVA column by default', () => {
    expect(fixture.nativeElement.textContent).toContain('TVA');
  });

  it('hides TVA column when disabled in store', () => {
    store.columnVisibility.update(v => ({ ...v, vat: false }));
    fixture.detectChanges();
    const headers = fixture.nativeElement.querySelector('.p-datatable-scrollable-header, .p-datatable-thead');
    expect(headers?.textContent ?? '').not.toContain('TVA');
  });

  it('shows custom title when title input is set', () => {
    fixture.componentRef.setInput('title', 'Écriture proposée — journal JA');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Écriture proposée — journal JA');
  });

  it('uses compact scroll height when compactMode is true', () => {
    fixture.componentRef.setInput('compactMode', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.compactMode()).toBe(true);
  });

  /**
   * La puce « Solde » affichait le montant saisi avec le libellé de la devise de tenue :
   * « Solde 600,000 TND » pour un solde de 600,00 EUR.
   */
  describe('devise de l’écriture', () => {
    function fill(): void {
      store.lines.set([
        { ...createEmptyLine(), accountNumber: '164', debit: 1000, credit: null },
        { ...createEmptyLine(), accountNumber: '452', debit: null, credit: 400 }
      ]);
    }

    function chipText(): string {
      const el = fixture.nativeElement as HTMLElement;
      return el.querySelector('.lines-grid__balance-chip')?.textContent ?? '';
    }

    function headerText(): string {
      const el = fixture.nativeElement as HTMLElement;
      return el.querySelector('.p-datatable-thead')?.textContent ?? '';
    }

    it('libelle le solde en dinar en devise de tenue', () => {
      fill();
      fixture.detectChanges();

      expect(chipText()).toContain('TND');
    });

    it('libelle le solde dans la devise de saisie, jamais en dinar', () => {
      store.currency.set('EUR');
      store.currencyDecimals.set(2);
      store.exchangeRate.set(3.29);
      fill();
      fixture.detectChanges();

      expect(chipText()).toContain('EUR');
      expect(chipText()).not.toContain('TND');
    });

    it('distingue les colonnes saisies des colonnes de contre-valeur', () => {
      store.currency.set('EUR');
      store.currencyDecimals.set(2);
      store.exchangeRate.set(3.29);
      fill();
      fixture.detectChanges();

      // Sans suffixe, deux colonnes « Débit » se suivaient sans rien qui les sépare.
      expect(headerText()).toContain('Débit (EUR)');
      expect(headerText()).toContain('Débit (TND)');
    });
  });

  describe('édition dans la modale d’import', () => {
    it('met à jour le compte tapé directement, sans sélection', () => {
      fixture.componentInstance.onAccountInput(0, '6071');
      expect(store.lines()[0].accountNumber).toBe('6071');
    });

    it('ignore la valeur objet émise par la sélection', () => {
      store.updateLine(0, { accountNumber: '607' });
      fixture.componentInstance.onAccountInput(0, { accountNumber: '401', label: 'X' } as never);
      expect(store.lines()[0].accountNumber).toBe('607');
    });

    it('préfixe les identifiants quand idPrefix est fourni', () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('#lines-title')).not.toBeNull();
      fixture.componentRef.setInput('idPrefix', 'ipe-');
      fixture.detectChanges();
      expect(el.querySelector('#lines-title')).toBeNull();
      expect(el.querySelector('#ipe-lines-title')).not.toBeNull();
      expect(el.querySelector('[id^="debit-"], [id^="credit-"]')).toBeNull();
    });

    it('suit les lignes par identifiant client', () => {
      const line = createEmptyLine();
      expect(fixture.componentInstance.trackLine(0, line)).toBe(line.clientLineId);
      expect(fixture.componentInstance.trackLine(3, { ...line, lineLabel: 'modifié' })).toBe(line.clientLineId);
    });

    it('garde le focus et l’élément du libellé pendant la frappe', () => {
      const el = fixture.nativeElement as HTMLElement;
      const before = el.querySelectorAll<HTMLInputElement>('tbody tr')[0].querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
      expect(before).toBeTruthy();
      before!.focus();
      store.updateLine(0, { lineLabel: 'A' });
      fixture.detectChanges();
      store.updateLine(0, { lineLabel: 'AB' });
      fixture.detectChanges();
      const after = el.querySelectorAll<HTMLInputElement>('tbody tr')[0].querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
      expect(after).toBe(before);
      expect(document.activeElement).toBe(before);
    });
  });

  it('ne relance pas l’assistant TVA en validant une ligne de TVA importée (régression double TVA)', () => {
    const vatAssist = TestBed.inject(VatAssistService) as unknown as { applyVatToLine: jasmine.Spy };
    vatAssist.applyVatToLine.calls.reset();
    store.applyDocumentProposal({
      journalCode: 'JA', entryDate: '2026-08-01', label: 'Facture', pieceRef: null, pieceDate: null, totalDebit: 119,
      thirdParty: null, extraction: { totalHt: 100, totalVat: 19, totalTtc: 119 },
      lines: [
        { accountNumber: '607', label: 'HT', debit: 100, credit: 0, vatRatePercent: null, thirdPartyId: null, thirdPartyKind: null },
        { accountNumber: '43666', label: 'TVA 19 %', debit: 19, credit: 0, vatRatePercent: 19, thirdPartyId: null, thirdPartyKind: null },
        { accountNumber: '4011', label: 'Fournisseur', debit: 0, credit: 119, vatRatePercent: null, thirdPartyId: null, thirdPartyKind: null }
      ]
    });
    fixture.detectChanges();
    fixture.componentInstance.onDebitCommit(1);
    fixture.componentInstance.onDebitCommit(0);
    expect(vatAssist.applyVatToLine).not.toHaveBeenCalled();
    expect(store.lines().length).toBe(3);
    expect(store.lines().some(l => l.isVatGenerated)).toBe(false);
  });
});
