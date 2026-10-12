import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { InvoiceListComponent } from './invoice-list.component';
import { InvoiceDetailComponent } from '../invoice-detail/invoice-detail.component';
import { InvoiceService, InvoiceListItem, InvoiceListSummary } from '@core/services/invoice.service';
import { ClientService } from '@core/services/client.service';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { StockService } from '@core/services/stock.service';
import { ProductService } from '@core/services/product.service';
import { AiScreenAnalysisService } from '@features/ai-assistant/services/ai-screen-analysis.service';

interface ListMocks {
  getInvoices: jasmine.Spy;
  getInvoicesSummary: jasmine.Spy;
  navigate: jasmine.Spy;
}

function invoiceItem(overrides: Partial<InvoiceListItem>): InvoiceListItem {
  return {
    id: 'inv-1',
    number: 'FAC-2026-000001',
    type: 'INVOICE',
    isCreditNote: false,
    issueDate: '2026-10-04',
    dueDate: null,
    status: 'Payée',
    statusCssClass: 'paid',
    clientName: 'Client passager',
    totalAmount: 137.85,
    subTotal: 115.84,
    currency: 'TND',
    isOverdue: false,
    totalPaid: 137.85,
    remainingAmount: 0,
    ...overrides
  };
}

function summary(overrides: Partial<InvoiceListSummary> = {}): InvoiceListSummary {
  return {
    count: 3,
    totalTtc: 100,
    totalHt: 60,
    totalVat: 40,
    totalPaid: 0,
    totalRemaining: 100,
    overdueCount: 0,
    currency: 'TND',
    realizedRevenueHt: 60,
    invoicesHt: 115.84,
    creditNotesHt: -55.84,
    ...overrides
  };
}

describe('InvoiceListComponent', () => {
  let fixture: ComponentFixture<InvoiceListComponent>;
  let component: InvoiceListComponent;
  let mocks: ListMocks;

  function createComponent(routeData: Record<string, unknown>, queryParams: Record<string, string> = {}): void {
    const getInvoices = jasmine.createSpy('getInvoices').and.returnValue(
      of({ success: true, data: { items: [], totalCount: 0 } })
    );
    const getInvoicesSummary = jasmine.createSpy('getInvoicesSummary').and.returnValue(
      of({ success: true, data: summary() })
    );
    mocks = { getInvoices, getInvoicesSummary, navigate: undefined as unknown as jasmine.Spy };

    TestBed.configureTestingModule({
      imports: [InvoiceListComponent],
      providers: [
        // InvoiceImportDialogComponent (template) injecte InvoiceImportService → HttpClient.
        provideHttpClient(),
        // Router réel (routerLink du gabarit appelle createUrlTree) ; navigate est espionné.
        provideRouter([]),
        { provide: InvoiceService, useValue: { getInvoices, getInvoicesSummary, downloadPdf: () => of(new Blob()), downloadReportPdf: () => of(new Blob()) } },
        { provide: ClientService, useValue: { getClients: () => of({ success: true, data: { items: [] } }) } },
        { provide: PrintPreviewService, useValue: { openPdfForPrintPreview: () => undefined } },
        { provide: ToastService, useValue: { add: () => undefined } },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage: () => 'err' } },
        {
          provide: AuthService,
          useValue: {
            isFirmDelegatedReadonly: () => false,
            isAccountingFirm: () => false,
            isDelegatedMode: () => false,
            hasPermission: () => true,
            hasAllPermissions: () => true
          }
        },
        { provide: NgbModal, useValue: { open: () => ({ result: Promise.resolve(null) }) } },
        // Le bouton « Analyser avec l'assistant IA » l'injecte ; sans stub, sa chaîne
        // (AiVolatileAnalysisStore) exige les événements de navigation complets.
        { provide: AiScreenAnalysisService, useValue: {} },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: routeData, paramMap: convertToParamMap({}) },
            data: of(routeData),
            queryParamMap: of(convertToParamMap(queryParams))
          }
        }
      ]
    });

    mocks.navigate = spyOn(TestBed.inject(Router), 'navigate').and.returnValue(Promise.resolve(true));

    fixture = TestBed.createComponent(InvoiceListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  describe('revenue mode (/invoices/revenue)', () => {
    it('requests invoices and summary without type and with realizedRevenueOnly: true', () => {
      createComponent({ revenueMode: true });

      const listParams = mocks.getInvoices.calls.mostRecent().args[0];
      expect(listParams.type).toBeUndefined();
      expect(listParams.realizedRevenueOnly).toBe(true);
      expect(listParams.unpaidOnly).toBeUndefined();

      const summaryParams = mocks.getInvoicesSummary.calls.mostRecent().args[0];
      expect(summaryParams.type).toBeUndefined();
      expect(summaryParams.realizedRevenueOnly).toBe(true);
    });

    it('reads realizedRevenueOnly=false from the query string', () => {
      createComponent({ revenueMode: true }, { realizedRevenueOnly: 'false' });

      expect(component.realizedRevenueOnly()).toBe(false);
      expect(mocks.getInvoices.calls.mostRecent().args[0].realizedRevenueOnly).toBe(false);
    });

    it('writes realizedRevenueOnly=false to the URL when the checkbox is unchecked', () => {
      createComponent({ revenueMode: true });

      component.onRealizedRevenueOnlyChange(false);

      expect(component.realizedRevenueOnly()).toBe(false);
      const navArgs = mocks.navigate.calls.mostRecent().args[1] as { queryParams: Record<string, unknown> };
      expect(navArgs.queryParams['realizedRevenueOnly']).toBe('false');
      expect(mocks.getInvoices.calls.mostRecent().args[0].realizedRevenueOnly).toBe(false);
    });

    it('queues a reload with the latest filters when the checkbox toggles during loading', () => {
      createComponent({ revenueMode: true });
      const initialCalls = mocks.getInvoices.calls.count();

      // Requête en vol : la réponse n'arrive que lorsque le Subject émet.
      const inFlight = new Subject<unknown>();
      mocks.getInvoices.and.returnValue(inFlight.asObservable());
      component.loadInvoices();
      expect(mocks.getInvoices.calls.count()).toBe(initialCalls + 1);

      // Basculer la case pendant le chargement ne doit pas lancer une requête parallèle…
      component.onRealizedRevenueOnlyChange(false);
      expect(mocks.getInvoices.calls.count()).toBe(initialCalls + 1);

      // … mais rejouer le chargement avec les filtres les plus récents à la fin de la requête.
      inFlight.next({ success: true, data: { items: [], totalCount: 0 } });
      expect(mocks.getInvoices.calls.count()).toBe(initialCalls + 2);
      expect(mocks.getInvoices.calls.mostRecent().args[0].realizedRevenueOnly).toBe(false);
    });

    it('counts the checkbox as an active filter only when unchecked', () => {
      createComponent({ revenueMode: true });
      expect(component.hasActiveFilters()).toBe(false);

      component.onRealizedRevenueOnlyChange(false);
      expect(component.hasActiveFilters()).toBe(true);
      expect(component.activeFiltersCount()).toBe(1);
    });

    it('resetFilters restores the checkbox to true', () => {
      createComponent({ revenueMode: true });
      component.onRealizedRevenueOnlyChange(false);
      expect(component.realizedRevenueOnly()).toBe(false);

      component.resetFilters();

      expect(component.realizedRevenueOnly()).toBe(true);
      const navArgs = mocks.navigate.calls.mostRecent().args[1] as { queryParams: Record<string, unknown> };
      expect(navArgs.queryParams['realizedRevenueOnly']).toBe('true');
      expect(mocks.getInvoices.calls.mostRecent().args[0].realizedRevenueOnly).toBe(true);
    });

    it('removes realizedRevenueOnly from the URL outside revenue mode', () => {
      createComponent({});
      component.onFilterChange();

      const navArgs = mocks.navigate.calls.mostRecent().args[1] as { queryParams: Record<string, unknown> };
      expect(navArgs.queryParams['realizedRevenueOnly']).toBeNull();
    });

    it('renders the Type and Montant HT columns only in revenue mode', () => {
      createComponent({ revenueMode: true });
      fixture.detectChanges();
      const headers = Array.from(fixture.nativeElement.querySelectorAll('th')).map((th) => (th as HTMLElement).textContent ?? '');
      expect(headers.some((h) => h.includes('Type'))).toBe(true);
      expect(headers.some((h) => h.includes('Montant HT'))).toBe(true);
      expect(headers.some((h) => h.includes('Montant TTC'))).toBe(true);
    });

    it('does not render the revenue columns in the invoices mode', () => {
      createComponent({});
      fixture.detectChanges();
      const headers = Array.from(fixture.nativeElement.querySelectorAll('th')).map((th) => (th as HTMLElement).textContent ?? '');
      expect(headers.some((h) => h.includes('Type'))).toBe(false);
      expect(headers.some((h) => h.includes('Montant HT'))).toBe(false);
      expect(headers.some((h) => h.includes('Montant TTC'))).toBe(false);
    });

    it('shows the Type chip and the signed HT amount per row', () => {
      createComponent({ revenueMode: true });
      component.invoices.set([
        invoiceItem({}),
        invoiceItem({ id: 'avo-1', number: 'AVO-2026-000019', type: 'CREDIT_NOTE', isCreditNote: true, status: 'Validée', subTotal: -2759.013 })
      ]);
      component.initialLoad.set(false);
      fixture.detectChanges();

      const chips = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('td.cell-type .doc-type-chip')
      ).map((el) => (el.textContent ?? '').trim());
      expect(chips).toEqual(['Facture', 'Avoir']);

      // Montant HT = 6e cellule en mode revenue (assertion indépendante de la locale).
      const rows = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
      expect(rows.length).toBe(2);
      const htCellText = (rows[1].querySelectorAll('td')[5].textContent ?? '').replace(/[^0-9-]/g, '');
      expect(htCellText).toBe('-2759013');

      expect(component.revenueAmountHtOf(invoiceItem({ subTotal: undefined }))).toBe(0);
    });

    it('computes Total CA HT from realizedRevenueHt and highlights it', () => {
      createComponent({ revenueMode: true });
      component.summary.set(summary({ realizedRevenueHt: -4113.538, totalHt: 7000 }));

      const metrics = component.summaryMetrics();
      const totalCaHt = metrics.find((m) => m.label === 'Total CA HT');
      expect(totalCaHt?.value).toBe(-4113.538);
      expect(totalCaHt?.accent).toBe(true);
      expect(totalCaHt?.hint).toBe('Payée + Validée');
      expect(metrics.map((m) => m.label)).toEqual([
        'Documents',
        'Total CA HT',
        'Total factures HT',
        'Total avoirs HT',
        'Total TTC'
      ]);
    });

    it('falls back to totalHt for Total CA HT only while the filter is on', () => {
      createComponent({ revenueMode: true });
      // Simule une API ancienne sans realizedRevenueHt (fenêtre de déploiement) : le set du
      // signal évite le rechargement (le mock renverrait un résumé complet).
      const legacySummary = summary();
      delete legacySummary.realizedRevenueHt;
      component.summary.set(legacySummary);

      expect(component.summaryMetrics().find((m) => m.label === 'Total CA HT')?.value).toBe(legacySummary.totalHt);

      component.realizedRevenueOnly.set(false);
      expect(component.summaryMetrics().find((m) => m.label === 'Total CA HT')?.value).toBeUndefined();
    });

    it('greys out and flags rows outside Payée + Validée when the filter is off', () => {
      createComponent({ revenueMode: true });
      component.onRealizedRevenueOnlyChange(false);
      const signed = invoiceItem({ status: 'Signée' });
      const paid = invoiceItem({ id: 'inv-2', status: 'Payée' });

      expect(component.isExcludedFromRevenue(signed)).toBe(true);
      expect(component.isExcludedFromRevenue(paid)).toBe(false);

      component.invoices.set([signed]);
      component.initialLoad.set(false);
      fixture.detectChanges();

      const excludedRow = fixture.nativeElement.querySelector('tr.row-excluded');
      expect(excludedRow).not.toBeNull();
      expect(excludedRow.textContent).toContain('Non compté dans le CA');
    });

    it('never excludes rows while the filter is on', () => {
      createComponent({ revenueMode: true });
      expect(component.isExcludedFromRevenue(invoiceItem({ status: 'Signée' }))).toBe(false);
    });

    it('links rows to /invoices/revenue/:id', () => {
      createComponent({ revenueMode: true });
      expect(component.invoiceDetailLink(invoiceItem({ id: 'abc' }))).toEqual(['/invoices', 'revenue', 'abc']);
    });

    it('prints the report without type, honoring the checkbox, with the factures+avoirs prefix', () => {
      const downloadReportPdf = jasmine.createSpy('downloadReportPdf').and.returnValue(of(new Blob(['x'])));
      const openPdfForPrintPreview = jasmine.createSpy('openPdfForPrintPreview');
      createComponent({ revenueMode: true });
      (TestBed.inject(InvoiceService) as unknown as { downloadReportPdf: jasmine.Spy }).downloadReportPdf = downloadReportPdf;
      (TestBed.inject(PrintPreviewService) as unknown as { openPdfForPrintPreview: jasmine.Spy }).openPdfForPrintPreview = openPdfForPrintPreview;

      component.summary.set(summary({ count: 2 }));
      component.onRealizedRevenueOnlyChange(false);
      component.printInvoiceReport();

      expect(downloadReportPdf).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, false);
      expect(openPdfForPrintPreview.calls.mostRecent().args[1]).toContain('Etat_factures_avoirs_ventes');
    });

    it('extends the AI analyze payload with the revenue figures', () => {
      createComponent({ revenueMode: true });
      component.summary.set(summary({ realizedRevenueHt: 12, invoicesHt: 20, creditNotesHt: -8 }));

      const payload = component.buildInvoiceAnalyzePayload();
      // wrapLegacyAnalyzePayload structure is factory-owned; locate our keys regardless of nesting.
      const serialized = JSON.stringify(payload);
      expect(serialized).toContain('"realizedRevenueOnly":true');
      expect(serialized).toContain('"realizedRevenueHt":12');
      expect(serialized).toContain('"invoicesHt":20');
      expect(serialized).toContain('"creditNotesHt":-8');
      expect(serialized).toContain('revenue-document-list');
    });
  });

  describe('other modes — non regression', () => {
    it('invoices mode still sends type INVOICE without realizedRevenueOnly', () => {
      createComponent({});
      const params = mocks.getInvoices.calls.mostRecent().args[0];
      expect(params.type).toBe('INVOICE');
      expect(params.realizedRevenueOnly).toBeUndefined();
    });

    it('creditNotes mode still sends type CREDIT_NOTE', () => {
      createComponent({ creditNotesOnly: true });
      const params = mocks.getInvoices.calls.mostRecent().args[0];
      expect(params.type).toBe('CREDIT_NOTE');
      expect(params.realizedRevenueOnly).toBeUndefined();
    });

    it('unpaid mode still sends type INVOICE with unpaidOnly', () => {
      createComponent({ unpaidOnly: true });
      const params = mocks.getInvoices.calls.mostRecent().args[0];
      expect(params.type).toBe('INVOICE');
      expect(params.unpaidOnly).toBe(true);
      expect(params.realizedRevenueOnly).toBeUndefined();
    });

    it('keeps 5 default summary tiles outside revenue mode', () => {
      createComponent({ creditNotesOnly: true });
      const labels = component.summaryMetrics().map((m) => m.label);
      expect(labels).not.toContain('Total CA HT');
      expect(labels).toContain('Avoirs');
    });
  });
});

describe('InvoiceDetailComponent — back route from the revenue view', () => {
  beforeEach(() => {
    // Le gabarit complet est hors sujet ici : seuls listBackRoute/breadcrumbItems sont testés.
    TestBed.overrideComponent(InvoiceDetailComponent, { set: { template: '' } });
  });

  function createDetail(routeData: Record<string, unknown>): InvoiceDetailComponent {
    TestBed.configureTestingModule({
      imports: [InvoiceDetailComponent],
      providers: [
        { provide: InvoiceService, useValue: { getInvoice: () => of({ success: false }) } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: ConfirmationService, useValue: {} },
        { provide: ToastService, useValue: { add: () => undefined } },
        { provide: AuthService, useValue: { isFirmDelegatedReadonly: () => false, hasPermission: () => true, hasAllPermissions: () => true } },
        { provide: StockService, useValue: {} },
        { provide: ProductService, useValue: {} },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage: () => 'err' } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: routeData, paramMap: convertToParamMap({ id: 'inv-1' }) }
          }
        }
      ]
    });
    const fixture = TestBed.createComponent(InvoiceDetailComponent);
    return fixture.componentInstance;
  }

  it('returns to /invoices/revenue when the route carries revenueMode', () => {
    const component = createDetail({ revenueMode: true });
    expect(component.listBackRoute).toBe('/invoices/revenue');

    const crumbs = component.breadcrumbItems().map((c) => c.label);
    expect(crumbs).toEqual(['Tableau de bord', 'Factures', 'Factures et avoirs', 'Document']);
    const revenueCrumb = component.breadcrumbItems()[2];
    expect(revenueCrumb.route).toBe('/invoices/revenue');
  });

  it('keeps the existing back routes in the other modes', () => {
    // Un seul module de test : le getter lit route.snapshot.data à chaque appel.
    const data: Record<string, unknown> = {};
    const component = createDetail(data);

    expect(component.listBackRoute).toBe('/invoices');

    data['unpaidOnly'] = true;
    expect(component.listBackRoute).toBe('/invoices/unpaid');

    delete data['unpaidOnly'];
    data['creditNotesOnly'] = true;
    expect(component.listBackRoute).toBe('/invoices/credit-notes');
  });
});
