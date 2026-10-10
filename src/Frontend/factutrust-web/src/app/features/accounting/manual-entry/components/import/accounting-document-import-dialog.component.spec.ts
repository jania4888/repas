import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { AccountingDocumentImportDialogComponent } from './accounting-document-import-dialog.component';
import { AccountingDocumentImportService } from '../../services/accounting-document-import.service';
import { AccountingService } from '../../../services/accounting.service';
import { TaxService } from '@core/services/tax.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { ClientService } from '@core/services/client.service';
import { SupplierService } from '@core/services/supplier.service';
import { JournalEntryProposal } from '../../models/accounting-document-import.models';
import { ImportProposalEditorComponent } from './import-proposal-editor.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ACCOUNTING_DOCUMENT_MAX_BYTES } from './accounting-document-preview.util';

function sampleProposal(): JournalEntryProposal {
  return {
    direction: 'PURCHASE',
    directionReason: null,
    journalCode: 'JA',
    entryDate: '2026-08-01',
    label: 'Facture',
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

describe('AccountingDocumentImportDialogComponent', () => {
  let fixture: ComponentFixture<AccountingDocumentImportDialogComponent>;
  let component: AccountingDocumentImportDialogComponent;
  let proposeSpy: jasmine.Spy;

  beforeEach(async () => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:preview-test');
    spyOn(URL, 'revokeObjectURL');
    proposeSpy = jasmine.createSpy('propose').and.returnValue(of(sampleProposal()));

    await TestBed.configureTestingModule({
      imports: [AccountingDocumentImportDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AccountingDocumentImportService,
          useValue: {
            capabilities: () => of({ enabled: true, aiFallbackAvailable: true }),
            propose: proposeSpy
          }
        },
        {
          provide: AccountingService,
          useValue: {
            // Le store de référence charge aussi les devises depuis ce service.
            getCurrencies: () => of({ success: true, data: [] }),
            getChartOfAccounts: () =>
              of({
                success: true,
                data: [{ id: '1', accountNumber: '607', label: 'Achats', accountClass: 6, isActive: true, isSystem: false, natureType: 0, level: 1 }]
              }),
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
    });

    TestBed.overrideComponent(AccountingDocumentImportDialogComponent, {
      set: {
        providers: [
          {
            provide: AccountingDocumentImportService,
            useValue: {
              capabilities: () => of({ enabled: true, aiFallbackAvailable: true }),
              propose: proposeSpy
            }
          }
        ]
      }
    });

    await TestBed.compileComponents();

    fixture = TestBed.createComponent(AccountingDocumentImportDialogComponent);
    component = fixture.componentInstance;
    component.visible = true;
    fixture.detectChanges();
  });

  it('canApplyNow is false when proposal has blocking diagnostic', () => {
    component.proposal.set({
      ...sampleProposal(),
      diagnostics: [{ severity: 'blocking', code: 'PeriodClosed', message: 'Clôturé', relatedLineIndex: null }],
      hasBlockingDiagnostic: true
    });
    component.phase.set('review');
    fixture.detectChanges();
    expect(component.canApplyNow()).toBe(false);
  });

  it('changeDirection asks confirmation when manual edits exist', () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    component.proposal.set(sampleProposal());
    component.phase.set('review');
    component['currentFile'] = new File(['x'], 'test.pdf');
    fixture.detectChanges();

    component.proposalEditor = {
      hasManualEdits: () => true
    } as ImportProposalEditorComponent;

    component.changeDirection('SALE');
    expect(confirmSpy).toHaveBeenCalled();
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it('shows a preview and does not propose until the user analyzes', async () => {
    const file = pdfFile();
    await component.onFileSelected(fileEvent(file));
    fixture.detectChanges();

    expect(component.phase()).toBe('preview');
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('object')).not.toBeNull();

    component.analyze();
    expect(proposeSpy).toHaveBeenCalledOnceWith(file);
    expect(component.phase()).toBe('review');
  });

  it('rejects an oversized file before any preview url or propose call', async () => {
    const oversized = {
      name: 'gros.pdf',
      size: ACCOUNTING_DOCUMENT_MAX_BYTES + 1,
      slice: () => new Blob()
    } as unknown as File;

    await component.onFileSelected(fileEvent(oversized));
    fixture.detectChanges();

    expect(component.phase()).toBe('error');
    expect(component.rejection()).toBe('too-large');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Fichier trop volumineux');
  });

  it('rejects a PDF whose bytes are HTML', async () => {
    const file = new File(['<!doctype html>'], 'note.pdf', { type: 'text/html' });
    await component.onFileSelected(fileEvent(file));
    fixture.detectChanges();

    expect(component.phase()).toBe('error');
    expect(component.rejection()).toBe('signature');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('object')).toBeNull();
  });

  it('returns to the preview when analysis is cancelled and ignores a late response', async () => {
    const pending = new Subject<ReturnType<typeof sampleProposal>>();
    proposeSpy.and.returnValue(pending.asObservable());
    const file = pdfFile();
    await component.onFileSelected(fileEvent(file));
    component.analyze();
    expect(component.phase()).toBe('extracting');

    component.cancelImport();
    expect(component.phase()).toBe('preview');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    pending.next(sampleProposal());
    expect(component.phase()).toBe('preview');
    expect(component.proposal()).toBeNull();
  });

  it('revokes the object url when the dialog closes', async () => {
    await component.onFileSelected(fileEvent(pdfFile()));
    component.onHide();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:preview-test');
  });

  it('revokes the object url on destroy', async () => {
    await component.onFileSelected(fileEvent(pdfFile()));
    component.ngOnDestroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:preview-test');
  });

  it('applies the original File after preview', async () => {
    const file = pdfFile();
    const emitted: { proposal: ReturnType<typeof sampleProposal>; file: File }[] = [];
    component.applied.subscribe((event) => emitted.push(event));

    await component.onFileSelected(fileEvent(file));
    component.analyze();
    fixture.detectChanges();
    component.proposalEditor = {
      getMergedProposal: () => sampleProposal(),
      isBalanced: () => true,
      hasManualEdits: () => false
    } as ImportProposalEditorComponent;

    component.apply();
    expect(emitted.length).toBe(1);
    expect(emitted[0].file).toBe(file);
    expect(emitted[0].proposal.pieceRef).toBe('FAC-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:preview-test');
  });

  it('keeps the current phase when the file picker is cancelled', () => {
    component.phase.set('review');
    component.proposal.set(sampleProposal());
    fixture.detectChanges();

    component.chooseFile();
    component.onFileSelected(fileEvent(undefined));
    expect(component.phase()).toBe('review');
    expect(component.proposal()?.pieceRef).toBe('FAC-1');
  });

  it('shows an Office file without an image or pdf viewer and still allows analysis', async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])], 'facture.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    await component.onFileSelected(fileEvent(file));
    fixture.detectChanges();

    expect(component.phase()).toBe('preview');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('object')).toBeNull();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Analyser la facture');
    expect(fixture.nativeElement.textContent).toContain('Aperçu visuel indisponible');
    expect(proposeSpy).not.toHaveBeenCalled();
  });
});

function pdfFile(): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'facture.pdf', {
    type: 'application/pdf'
  });
}

function fileEvent(file: File | undefined): Event {
  return { target: { files: file ? [file] : [], value: 'x' } } as unknown as Event;
}
