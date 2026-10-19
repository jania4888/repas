import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';
import { PurchaseReceiptImportDialogComponent } from './purchase-receipt-import-dialog.component';
import { PurchaseReceiptImportService } from '../../services/purchase-receipt-import.service';
import { InvoiceImportService } from '@features/invoices/invoice-wizard/services/invoice-import.service';
import { PurchaseReceiptImportEvent, PurchaseReceiptImportProposal } from '../../models/purchase-receipt-import.models';

function sampleProposal(): PurchaseReceiptImportProposal {
  return {
    extractionProvider: 'llm-vision',
    ocrApplied: false,
    documentType: 'PurchaseInvoice',
    documentNumber: 'FA-1',
    header: {
      receiptDate: '2026-10-01',
      deliveryNoteNumber: null,
      supplierReference: null,
      currency: 'TND',
      suggestedNotes: null,
      suggestedWarehouseId: null
    },
    supplier: {
      matchOutcome: 'NotFound',
      supplierId: null,
      supplierName: null,
      extractedName: null,
      extractedNif: null,
      candidates: [],
      prefill: null
    },
    lines: [],
    documentTotals: { totalHt: null, totalVat: null, fodecAmount: null, fiscalStampAmount: null, withholdingAmount: null, totalTtc: null, vatBreakdown: [] },
    expectedReceiptTotals: { subTotal: 0, totalVat: 0, totalAmount: 0 },
    confidence: 'high',
    warnings: [],
    canCreateSupplier: true,
    canCreateProduct: true
  };
}

function pdfFile(name = 'bl.pdf'): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

function fileEvent(file: File | undefined): Event {
  const input = document.createElement('input');
  input.type = 'file';
  if (file) {
    Object.defineProperty(input, 'files', { value: [file] });
  }
  return { target: input } as unknown as Event;
}

describe('PurchaseReceiptImportDialogComponent', () => {
  let fixture: ComponentFixture<PurchaseReceiptImportDialogComponent>;
  let component: PurchaseReceiptImportDialogComponent;
  let importDocumentSpy: jasmine.Spy;
  let capabilitiesSpy: jasmine.Spy;
  let warmUpSpy: jasmine.Spy;

  beforeEach(async () => {
    importDocumentSpy = jasmine.createSpy('importDocument').and.returnValue(of<PurchaseReceiptImportEvent>({ kind: 'done', proposal: sampleProposal() }));
    capabilitiesSpy = jasmine.createSpy('capabilities').and.returnValue(of({
      available: true,
      extractionProvider: 'docstrange',
      ocrAvailable: true,
      visionCapable: true,
      externalProcessing: true,
      maxFileBytes: 10_485_760,
      acceptedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
      canCreateSupplier: true,
      canCreateProduct: true,
      canAttach: true
    }));
    warmUpSpy = jasmine.createSpy('warmUpModel').and.returnValue(of({ ready: true }));

    await TestBed.configureTestingModule({
      imports: [PurchaseReceiptImportDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PurchaseReceiptImportService, useValue: { importDocument: importDocumentSpy, capabilities: capabilitiesSpy } },
        { provide: InvoiceImportService, useValue: { warmUpModel: warmUpSpy } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PurchaseReceiptImportDialogComponent);
    component = fixture.componentInstance;
  });

  function open(): void {
    component.visible = true;
    fixture.detectChanges();
  }

  it("charge les capacités à l'ouverture et affiche la mention de transmission externe quand externalProcessing est vrai", () => {
    open();
    expect(capabilitiesSpy).toHaveBeenCalled();
    expect(component.externalProcessing()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain("sera transmis à un service d'extraction externe");
  });

  it("déclenche le réchauffement du modèle IA uniquement quand extractionProvider vaut 'llm'", () => {
    capabilitiesSpy.and.returnValue(of({ available: true, extractionProvider: 'llm', externalProcessing: false, canCreateSupplier: true, canCreateProduct: true, canAttach: true }));
    open();
    expect(warmUpSpy).toHaveBeenCalled();
  });

  it("ne déclenche pas le réchauffement du modèle quand extractionProvider vaut 'docstrange'", () => {
    open();
    expect(warmUpSpy).not.toHaveBeenCalled();
  });

  it('rejette un fichier dont le format est non supporté sans appeler importDocument', () => {
    open();
    const file = new File(['x'], 'rapport.docx', { type: 'application/msword' });
    component.onFileSelected(fileEvent(file));
    fixture.detectChanges();

    expect(component.phase()).toBe('error');
    expect(component.errorMessage()).toContain('Format non supporté');
    expect(importDocumentSpy).not.toHaveBeenCalled();
  });

  it('rejette un fichier trop volumineux (> 10 Mo) sans appeler importDocument', () => {
    open();
    const big = { name: 'gros.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 } as unknown as File;
    component.onFileSelected(fileEvent(big));
    fixture.detectChanges();

    expect(component.phase()).toBe('error');
    expect(component.errorMessage()).toContain('volumineux');
    expect(component.errorMessage()).toContain('10');
    expect(importDocumentSpy).not.toHaveBeenCalled();
  });

  it('respecte capabilities.maxFileBytes quand le backend déclare un plafond différent', () => {
    capabilitiesSpy.and.returnValue(of({
      available: true,
      extractionProvider: 'docstrange',
      externalProcessing: true,
      maxFileBytes: 2 * 1024 * 1024,
      canCreateSupplier: true,
      canCreateProduct: true,
      canAttach: true
    }));
    open();

    const justOver = { name: 'moyen.pdf', type: 'application/pdf', size: 2 * 1024 * 1024 + 1 } as unknown as File;
    component.onFileSelected(fileEvent(justOver));
    fixture.detectChanges();

    expect(component.phase()).toBe('error');
    expect(component.errorMessage()).toContain('2 Mo');
    expect(importDocumentSpy).not.toHaveBeenCalled();
  });

  it('accepte un fichier sous le plafond déclaré même si la valeur par défaut diffère', () => {
    capabilitiesSpy.and.returnValue(of({
      available: true,
      extractionProvider: 'docstrange',
      externalProcessing: true,
      maxFileBytes: 20 * 1024 * 1024,
      canCreateSupplier: true,
      canCreateProduct: true,
      canAttach: true
    }));
    open();

    const big = { name: 'gros-mais-ok.pdf', type: 'application/pdf', size: 15 * 1024 * 1024 } as unknown as File;
    component.onFileSelected(fileEvent(big));

    expect(component.phase()).toBe('uploading');
    expect(importDocumentSpy).toHaveBeenCalled();
  });

  it('la phase uploading propose aussi « Annuler » et revient à l’état initial', () => {
    const events = new Subject<PurchaseReceiptImportEvent>();
    importDocumentSpy.and.returnValue(events.asObservable());
    open();

    component.onFileSelected(fileEvent(pdfFile()));
    fixture.detectChanges();
    expect(component.phase()).toBe('uploading');

    const cancelBtn = (fixture.nativeElement as HTMLElement).querySelector('.pid-state app-button');
    expect(cancelBtn?.textContent).toContain('Annuler');

    component.cancelImport();
    fixture.detectChanges();
    expect(component.phase()).toBe('idle');
    events.next({ kind: 'done', proposal: sampleProposal() });
    expect(component.phase()).toBe('idle');
  });

  it('passe par uploading puis analysing puis émet "imported" avec la proposition et le fichier', () => {
    const events = new Subject<PurchaseReceiptImportEvent>();
    importDocumentSpy.and.returnValue(events.asObservable());
    open();

    const emitted: { proposal: PurchaseReceiptImportProposal; file: File }[] = [];
    component.imported.subscribe((e) => emitted.push(e));

    const file = pdfFile();
    component.onFileSelected(fileEvent(file));
    expect(component.phase()).toBe('uploading');
    expect(component.selectedFileName()).toBe('bl.pdf');

    events.next({ kind: 'upload', percent: 50 });
    expect(component.uploadPercent()).toBe(50);
    expect(component.phase()).toBe('uploading');

    events.next({ kind: 'analysing' });
    expect(component.phase()).toBe('analysing');

    const proposal = sampleProposal();
    events.next({ kind: 'done', proposal });

    expect(emitted.length).toBe(1);
    expect(emitted[0].proposal).toBe(proposal);
    expect(emitted[0].file).toBe(file);
  });

  it("repasse en phase 'error' avec le message du service quand l'import échoue", () => {
    importDocumentSpy.and.returnValue(throwError(() => new Error("Le service d'extraction documentaire est indisponible.")));
    open();

    component.onFileSelected(fileEvent(pdfFile()));
    fixture.detectChanges();

    expect(component.phase()).toBe('error');
    expect(component.errorMessage()).toBe("Le service d'extraction documentaire est indisponible.");
  });

  it('cancelImport désabonne le flux en cours et revient à la phase idle', () => {
    const events = new Subject<PurchaseReceiptImportEvent>();
    importDocumentSpy.and.returnValue(events.asObservable());
    open();

    component.onFileSelected(fileEvent(pdfFile()));
    events.next({ kind: 'analysing' });
    expect(component.phase()).toBe('analysing');

    component.cancelImport();
    expect(component.phase()).toBe('idle');
    expect(component.selectedFileName()).toBeNull();

    events.next({ kind: 'done', proposal: sampleProposal() });
    expect(component.phase()).toBe('idle');
  });

  it("manualEntryClicked émet 'manualEntry' et ferme la modale", () => {
    open();
    let manualEntryCount = 0;
    let visibleChangedTo: boolean | undefined;
    component.manualEntry.subscribe(() => manualEntryCount++);
    component.visibleChange.subscribe((v) => (visibleChangedTo = v));

    component.manualEntryClicked();

    expect(manualEntryCount).toBe(1);
    expect(visibleChangedTo).toBe(false);
    expect(component.visible).toBe(false);
  });

  it('onHide désabonne le flux en cours et émet visibleChange(false)', () => {
    const events = new Subject<PurchaseReceiptImportEvent>();
    importDocumentSpy.and.returnValue(events.asObservable());
    open();
    component.onFileSelected(fileEvent(pdfFile()));

    let visibleChangedTo: boolean | undefined;
    component.visibleChange.subscribe((v) => (visibleChangedTo = v));
    component.onHide();

    expect(visibleChangedTo).toBe(false);

    // Un évènement tardif après fermeture ne doit plus modifier l'état affiché.
    events.next({ kind: 'done', proposal: sampleProposal() });
    expect(component.phase()).toBe('uploading');
  });

  it("l'intervalle d'écoulement du temps avance le libellé de progression pendant l'analyse", fakeAsync(() => {
    const events = new Subject<PurchaseReceiptImportEvent>();
    importDocumentSpy.and.returnValue(events.asObservable());
    open();
    component.onFileSelected(fileEvent(pdfFile()));
    events.next({ kind: 'analysing' });

    tick(1000);
    expect(component.elapsedSeconds()).toBe(1);

    component.cancelImport();
    tick(5000);
    // cancelImport arrête le minuteur mais ne remet pas le compteur à zéro ; il ne doit plus avancer.
    expect(component.elapsedSeconds()).toBe(1);
  }));

  it("ouvrir une seconde fois réinitialise l'état précédent", () => {
    open();
    component.onFileSelected(fileEvent(new File(['x'], 'bad.docx', { type: 'application/msword' })));
    expect(component.phase()).toBe('error');

    component.visible = false;
    fixture.detectChanges();
    component.visible = true;
    fixture.detectChanges();

    expect(component.phase()).toBe('idle');
    expect(component.errorMessage()).toBeNull();
    expect(component.selectedFileName()).toBeNull();
  });
});
