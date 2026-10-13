import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, of, Subject } from 'rxjs';
import { ImportProposalEditorComponent } from './import-proposal-editor.component';
import { AccountingService } from '../../../services/accounting.service';
import { TaxService } from '@core/services/tax.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { ClientService } from '@core/services/client.service';
import { SupplierService } from '@core/services/supplier.service';
import { JournalEntryProposal } from '../../models/accounting-document-import.models';
import { EntryFormStore } from '../../services/entry-form.store';

function sampleProposal(): JournalEntryProposal {
  return {
    direction: 'PURCHASE',
    directionReason: null,
    journalCode: 'JA',
    entryDate: '2026-08-01',
    label: 'Facture test',
    pieceRef: 'FAC-1',
    pieceDate: '2026-08-01',
    thirdParty: null,
    lines: [
      {
        accountNumber: '607',
        accountLabel: 'Achats',
        accountStatus: 'found',
        role: 'expense',
        label: 'HT',
        debit: 100,
        credit: 0,
        vatRatePercent: null,
        thirdPartyId: null,
        thirdPartyKind: null
      },
      {
        accountNumber: '4011',
        accountLabel: 'Fournisseurs',
        accountStatus: 'found',
        role: 'thirdparty',
        label: 'Fournisseur',
        debit: 0,
        credit: 100,
        vatRatePercent: null,
        thirdPartyId: null,
        thirdPartyKind: null
      }
    ],
    totalDebit: 100,
    totalCredit: 100,
    documentTotalTtc: 100,
    extraction: {
      documentType: 'INVOICE',
      documentNumber: 'FAC-1',
      issueDate: '2026-08-01',
      dueDate: null,
      documentStatus: null,
      currency: 'TND',
      seller: null,
      buyer: null,
      lines: [],
      vatBreakdown: [],
      totalHt: 100,
      totalVat: 0,
      fodecAmount: null,
      fiscalStampAmount: null,
      withholdingAmount: null,
      totalTtc: 100,
      confidence: 'high',
      warnings: [],
      extractionMethod: 'native-pdf',
      ocrApplied: false,
      vatBreakdownRecomputed: false
    },
    diagnostics: [],
    hasBlockingDiagnostic: false
  };
}

type ChartResponse = { success: boolean; data: unknown[] };

describe('ImportProposalEditorComponent', () => {
  let fixture: ComponentFixture<ImportProposalEditorComponent>;
  let component: ImportProposalEditorComponent;
  let chartOfAccounts: () => Observable<ChartResponse>;
  let applySpy: jasmine.Spy;

  function create(proposal: JournalEntryProposal = sampleProposal()): void {
    fixture = TestBed.createComponent(ImportProposalEditorComponent);
    component = fixture.componentInstance;
    applySpy = spyOn(store(), 'applyDocumentProposal').and.callThrough();
    fixture.componentRef.setInput('proposal', proposal);
    fixture.detectChanges();
  }

  function store(): EntryFormStore {
    return fixture.debugElement.injector.get(EntryFormStore);
  }

  beforeEach(async () => {
    chartOfAccounts = () =>
      of({
        success: true,
        data: [{ id: '1', accountNumber: '607', label: 'Achats', accountClass: 6, isActive: true, isSystem: false, natureType: 0, level: 1 }]
      });
    await TestBed.configureTestingModule({
      imports: [ImportProposalEditorComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AccountingService,
          useValue: {
            // Le store de référence charge aussi les devises depuis ce service.
            getCurrencies: () => of({ success: true, data: [] }),
            getChartOfAccounts: () => chartOfAccounts(),
            getPeriods: () => of({ success: true, data: [] }),
            getJournals: () => of({ success: true, data: [{ code: 'JA', label: 'Achats' }] })
          }
        },
        {
          provide: TaxService,
          useValue: {
            getVatRates: () => of({ success: true, data: [{ id: '1', percent: 19, label: '19%' }] })
          }
        },
        {
          provide: BankAccountService,
          useValue: { list: () => of({ success: true, data: [] }) }
        },
        {
          provide: ClientService,
          useValue: { getClients: () => of({ success: true, data: { items: [] } }) }
        },
        {
          provide: SupplierService,
          useValue: { getSuppliers: () => of({ success: true, data: { items: [] } }) }
        }
      ]
    }).compileComponents();
  });

  it('initializes from proposal and exposes merged label', () => {
    create();
    const merged = component.getMergedProposal();
    expect(merged.label).toBe('Facture test');
    expect(merged.lines.length).toBe(2);
    expect(component.isBalanced()).toBe(true);
  });

  it('reports manual edits after label change', () => {
    create();
    expect(component.hasManualEdits()).toBe(false);
    const labelDe = fixture.debugElement.query(By.css('#ipe-eh-label'));
    labelDe.triggerEventHandler('ngModelChange', 'Libellé modifié');
    fixture.detectChanges();
    expect(component.hasManualEdits()).toBe(true);
    expect(component.getMergedProposal().label).toBe('Libellé modifié');
  });

  it('applies the proposal once on first render', () => {
    create();
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it('applies a new proposal when the input changes', () => {
    create();
    fixture.componentRef.setInput('proposal', { ...sampleProposal(), label: 'Nouvelle analyse' });
    fixture.detectChanges();
    expect(applySpy).toHaveBeenCalledTimes(2);
    expect(component.mergedProposal()?.label).toBe('Nouvelle analyse');
  });

  it('recomputes account controls when the chart of accounts arrives', () => {
    const chart$ = new Subject<ChartResponse>();
    chartOfAccounts = () => chart$.asObservable();
    create();

    expect(component.refsLoading()).toBe(true);
    expect(component.accountsAvailable()).toBe(false);
    expect(component.mergedProposal()?.diagnostics.some(d => d.code === 'AccountMissing')).toBe(false);

    chart$.next({ success: true, data: [] });
    chart$.complete();
    fixture.detectChanges();

    expect(component.refsLoading()).toBe(false);
    expect(component.mergedProposal()?.diagnostics.filter(d => d.code === 'AccountMissing').length).toBe(2);
    expect(component.mergedProposal()?.hasBlockingDiagnostic).toBe(true);
  });

  it('reports manual edits and recomputes after a store update', () => {
    create();
    store().updateLine(0, { debit: 90 });
    fixture.detectChanges();
    expect(component.manualEdits()).toBe(true);
    expect(component.balanced()).toBe(false);
    expect(component.balanceGap()).toBe(-10);
    expect(component.mergedProposal()?.totalDebit).toBe(90);
  });

  it('leaves the entry date empty when the document has none', () => {
    create({ ...sampleProposal(), entryDate: null });
    expect(store().entryDate()).toBe('');
    expect(component.manualEdits()).toBe(false);
    expect(component.mergedProposal()?.diagnostics.some(d => d.code === 'MissingIssueDate')).toBe(true);
  });

  it('renders only prefixed ids and a neutral balanced label', () => {
    create();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#eh-label')).toBeNull();
    expect(el.querySelector('#lines-title')).toBeNull();
    expect(el.querySelector('#debit-0')).toBeNull();
    expect(el.querySelector('#ipe-eh-label')).not.toBeNull();
    expect(el.querySelector('#ipe-lines-title')).not.toBeNull();
    expect(el.textContent).toContain('Écriture équilibrée');
    expect(el.textContent).not.toContain('vous pouvez enregistrer');
  });
});
