import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService, User } from '@core/services/auth.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { InvoiceService } from '@core/services/invoice.service';
import { StockService } from '@core/services/stock.service';
import { DeliveryNoteService } from '@features/delivery-notes/services/delivery-note.service';
import { DashboardService } from './services/dashboard.service';
import { AccountingService } from '@features/accounting/services/accounting.service';
import { CrmService } from '@features/crm/services/crm.service';
import { PurchaseOrderService } from '@core/services/purchase-order.service';
import { ProjectApiService } from '@features/projects/project-api.service';
import { RecurringContractService } from '@core/services/recurring-contract.service';
import { AppModule } from '@core/models/app-module';
import { DashboardComponent } from './dashboard.component';

/**
 * §7.3.3 — Tableau de bord en permissions mixtes.
 *
 * On garde AuthService réel (piloté par `effectivePermissions`/`enabledModuleIds` d'un `User`
 * mocké) pour que tous les computed de gating (canReadInvoices, showStockUrgent, hasAccountingModule…)
 * se comportent exactement comme en production. Les autres services métier sont des spies pour
 * observer précisément quels appels partent.
 */

const ALL_MODULES = Object.values(AppModule).filter((v): v is number => typeof v === 'number');

function makeUser(
  effectivePermissions: string[],
  enabledModuleIds: number[] = ALL_MODULES,
  companySegment: string | null = null
): User {
  return {
    id: 'u-1',
    email: 'u@test.c',
    firstName: 'A',
    lastName: 'B',
    fullName: 'A B',
    role: 'Custom',
    roleDisplay: 'Personnalisé',
    tenantId: '00000000-0000-0000-0000-000000000001',
    companyName: 'Ste Test',
    tenantKind: 'Company',
    twoFactorEnabled: false,
    enabledModuleIds,
    effectivePermissions,
    companySegment
  };
}

function setUser(auth: AuthService, u: User): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

const emptyApiOk = of({ success: true, data: { items: [] }, message: null, errors: [] as string[] });

describe('DashboardComponent — gating par permission (§7.3.3)', () => {
  let getInvoices: jasmine.Spy;
  let getStockAlerts: jasmine.Spy;
  let getDeliveryNotes: jasmine.Spy;
  let getAccountingDashboard: jasmine.Spy;
  let getMyReminders: jasmine.Spy;
  let getOpportunities: jasmine.Spy;
  let loadDashboardData: jasmine.Spy;
  let selectedWarehouseId: jasmine.Spy;

  function configure() {
    getInvoices = jasmine.createSpy('getInvoices').and.returnValue(emptyApiOk);
    getStockAlerts = jasmine.createSpy('getStockAlerts').and.returnValue(
      of({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] })
    );
    getDeliveryNotes = jasmine.createSpy('getDeliveryNotes').and.returnValue(
      of({ success: true, data: { items: [] }, message: null, errors: [] })
    );
    getAccountingDashboard = jasmine.createSpy('getAccountingDashboard').and.returnValue(
      of({ success: true, data: {}, message: null, errors: [] })
    );
    getMyReminders = jasmine.createSpy('getMyReminders').and.returnValue(
      of({ success: true, data: [], message: null, errors: [] })
    );
    getOpportunities = jasmine.createSpy('getOpportunities').and.returnValue(
      of({ success: true, data: [], message: null, errors: [] })
    );
    loadDashboardData = jasmine.createSpy('loadDashboardData').and.returnValue(
      of({
        allInvoices: [],
        recentInvoices: [],
        allQuotes: [],
        recentQuotes: [],
        topClients: [],
        monthlyRevenue: [],
        recentActivity: [],
        kpiTrends: { revenueChange: undefined, salesTodayChange: undefined, pendingChange: undefined },
        kpiSparklines: { revenue: [], salesToday: [], currentMonth: [], pending: [] },
        activeQuotesCount: 0,
        revenueKpis: { totalHt: null, monthToDateHt: null, previousMonthToDateHt: null }
      })
    );
    selectedWarehouseId = jasmine.createSpy('selectedWarehouseId').and.returnValue(null);

    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: InvoiceService, useValue: { getInvoices } },
        { provide: StockService, useValue: { getStockAlerts } },
        { provide: DeliveryNoteService, useValue: { getDeliveryNotes } },
        { provide: DashboardService, useValue: { loadDashboardData } },
        { provide: AccountingService, useValue: { getDashboard: getAccountingDashboard } },
        { provide: CrmService, useValue: { getMyReminders, getOpportunities } },
        { provide: WarehouseContextService, useValue: { selectedWarehouseId } }
      ]
    });
  }

  it('profil « Commercial étendu » (invoices ✗, quotes ✓, clients ✓, stock ✗, comptabilité ✗, CRM ✗): ' +
    'aucun appel invoices/stock/comptabilité/CRM, blocs CA/impayées absents, bloc Devis présent', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['quotes:read', 'clients:read'], []));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    // (i) aucune requête invoices n'est émise par le composant lui-même
    // (le service dashboard est mocké et vérifié séparément dans dashboard.service.spec.ts —
    // ici on vérifie les 3 chemins additionnels propres au composant).
    expect(getStockAlerts).not.toHaveBeenCalled();
    expect(getDeliveryNotes).not.toHaveBeenCalled();
    expect(getAccountingDashboard).not.toHaveBeenCalled();
    expect(getMyReminders).not.toHaveBeenCalled();
    expect(getOpportunities).not.toHaveBeenCalled();

    // (ii) gating des computed exposés au template
    expect(component.canReadInvoices()).toBeFalse();
    expect(component.canReadQuotes()).toBeTrue();
    expect(component.canReadClients()).toBeTrue();
    expect(component.showStockUrgent()).toBeFalse();
    expect(component.showDeliveryUrgent()).toBeFalse();
    expect(component.hasAccountingModule()).toBeFalse();
    expect(component.hasCrmModule()).toBeFalse();

    // (iii) blocs DOM : KPI CA / Factures impayées absents, Devis récents présent
    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).not.toContain("Chiffre d'affaires");
    expect(html).not.toContain('Factures impayées');
    expect(html).toContain('Devis récents');
  });

  it('loadStockAlerts() ne fait aucun appel sans showStockUrgent()', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['invoices:read'], []));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.showStockUrgent()).toBeFalse();
    expect(getStockAlerts).not.toHaveBeenCalled();
  });

  it('loadPendingDeliveries() ne fait aucun appel sans showDeliveryUrgent()', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['invoices:read'], ALL_MODULES));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.showDeliveryUrgent()).toBeFalse();
    expect(getDeliveryNotes).not.toHaveBeenCalled();
  });

  it('Phase 2 — showDeliveryUrgent/showInvoiceUrgent restent false si le module Sales ' +
    'est désactivé même quand la permission est présente (défense en profondeur, cf. showStockUrgent)', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    // Permissions présentes mais module Sales absent des modules activés : les deux computed
    // doivent rester false, à l'image de showStockUrgent (AppModule.Stock).
    setUser(
      auth,
      makeUser(
        ['invoices:read', 'delivery_notes:read'],
        ALL_MODULES.filter((m) => m !== AppModule.Sales)
      )
    );

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.showDeliveryUrgent()).toBeFalse();
    expect(component.showInvoiceUrgent()).toBeFalse();
    expect(getDeliveryNotes).not.toHaveBeenCalled();
  });

  it('loadAccountingKpis() a un early-return sans hasAccountingModule (pas d\'appel API)', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    // Module Accounting non activé -> hasAccountingModule() est false même avec la permission.
    setUser(auth, makeUser(['accounting:read'], []));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.hasAccountingModule()).toBeFalse();
    expect(getAccountingDashboard).not.toHaveBeenCalled();
  });

  it('loadCrmKpis() a un early-return sans hasCrmModule (pas d\'appel API)', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['crm:read'], []));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.hasCrmModule()).toBeFalse();
    expect(getMyReminders).not.toHaveBeenCalled();
    expect(getOpportunities).not.toHaveBeenCalled();
  });

  it('profil « Auditeur » (toutes les permissions en lecture) : tous les blocs rendus, tous les appels partent', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(
      auth,
      makeUser(
        [
          'invoices:read',
          'quotes:read',
          'clients:read',
          'stock:read',
          'delivery_notes:read',
          'accounting:read',
          'crm:read'
        ],
        ALL_MODULES
      )
    );

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.canReadInvoices()).toBeTrue();
    expect(component.canReadQuotes()).toBeTrue();
    expect(component.canReadClients()).toBeTrue();
    expect(component.showStockUrgent()).toBeTrue();
    expect(component.showDeliveryUrgent()).toBeTrue();
    expect(component.hasAccountingModule()).toBeTrue();
    expect(component.hasCrmModule()).toBeTrue();

    expect(getStockAlerts).toHaveBeenCalled();
    expect(getDeliveryNotes).toHaveBeenCalled();
    expect(getAccountingDashboard).toHaveBeenCalled();
    expect(getMyReminders).toHaveBeenCalled();
    expect(getOpportunities).toHaveBeenCalled();

    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain("Chiffre d'affaires");
    expect(html).toContain('Factures impayées');
    expect(html).toContain('Devis récents');
  });

  it('affiche la carte « CA HT du mois en cours » avec revenueKpis.monthToDateHt (serveur), pas le TTC', () => {
    configure();
    getInvoices.and.returnValue(of({
      success: true,
      data: {
        items: [
          // Si la carte retombait sur le TTC/allInvoices, elle afficherait cette valeur-ci.
          { id: '1', number: 'FAC-1', type: 'INVOICE', isCreditNote: false, issueDate: '2026-01-01', dueDate: null, status: 'Payée', statusCssClass: '', clientName: 'C', totalAmount: 999, currency: 'TND', isOverdue: false, totalPaid: 0, remainingAmount: 0 }
        ]
      },
      message: null,
      errors: [] as string[]
    }));
    loadDashboardData.and.returnValue(
      of({
        allInvoices: [],
        recentInvoices: [],
        allQuotes: [],
        recentQuotes: [],
        topClients: [],
        monthlyRevenue: [],
        recentActivity: [],
        kpiTrends: { revenueChange: undefined, salesTodayChange: undefined, pendingChange: undefined },
        kpiSparklines: { revenue: [], salesToday: [], currentMonth: [], pending: [] },
        activeQuotesCount: 0,
        revenueKpis: { totalHt: 1234.567, monthToDateHt: 345.123, previousMonthToDateHt: 300 }
      })
    );
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['invoices:read'], ALL_MODULES));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.totalRevenue()).toContain('234');
    expect(component.totalRevenue()).toContain('567');
    expect(component.totalRevenue()).toContain('TND');
    expect(component.currentMonthRevenue()).toContain('345');
    expect(component.currentMonthRevenue()).toContain('123');
    expect(component.currentMonthRevenue()).toContain('TND');
    // 300 (previousMonthToDateHt) should never leak into the formatted display.
    expect(component.currentMonthRevenue()).not.toContain('300');

    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('CA HT du mois en cours');
    expect(html).toContain("Chiffre d'affaires HT");
    expect(html).not.toContain('999');
  });
});

/**
 * Tâche 1.7 du plan — Dashboard : ne plus afficher de sections vides ou hors-sujet.
 * (a) « Actions rapides » masqué au profit d'un état vide utile quand aucune action
 *     n'est visible (permissions/modules insuffisants).
 * (b) Cartes latérales « Livraisons en attente » / « Devis en cours » conditionnées
 *     aux modules (Stock / Ventes) au lieu de toujours s'afficher.
 */
describe('DashboardComponent — tâche 1.7 (sections vides / cartes hors-sujet)', () => {
  function configure() {
    const emptyOk = () => of({ success: true, data: { items: [] }, message: null, errors: [] as string[] });
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: InvoiceService, useValue: { getInvoices: jasmine.createSpy().and.returnValue(emptyOk()) } },
        { provide: StockService, useValue: { getStockAlerts: jasmine.createSpy().and.returnValue(of({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] })) } },
        { provide: DeliveryNoteService, useValue: { getDeliveryNotes: jasmine.createSpy().and.returnValue(emptyOk()) } },
        {
          provide: DashboardService,
          useValue: {
            loadDashboardData: jasmine.createSpy().and.returnValue(
              of({
                allInvoices: [],
                recentInvoices: [],
                allQuotes: [],
                recentQuotes: [],
                topClients: [],
                monthlyRevenue: [],
                recentActivity: [],
                kpiTrends: { revenueChange: undefined, salesTodayChange: undefined, pendingChange: undefined },
                kpiSparklines: { revenue: [], salesToday: [], currentMonth: [], pending: [] },
                activeQuotesCount: 0,
                revenueKpis: { totalHt: null, monthToDateHt: null, previousMonthToDateHt: null }
              })
            )
          }
        },
        { provide: AccountingService, useValue: { getDashboard: jasmine.createSpy().and.returnValue(of({ success: true, data: {}, message: null, errors: [] })) } },
        { provide: CrmService, useValue: { getMyReminders: jasmine.createSpy().and.returnValue(of({ success: true, data: [], message: null, errors: [] })), getOpportunities: jasmine.createSpy().and.returnValue(of({ success: true, data: [], message: null, errors: [] })) } },
        { provide: WarehouseContextService, useValue: { selectedWarehouseId: jasmine.createSpy().and.returnValue(null) } }
      ]
    });
  }

  it('nouveau tenant sans permission « actions rapides » : affiche l\'état vide utile, pas de bloc vide', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    // Aucune des permissions dont dépendent les actions rapides.
    setUser(auth, makeUser([], [AppModule.Administration]));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.hasAnyQuickAction()).toBeFalse();

    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('Activez des modules pour voir vos actions rapides.');
    expect(html).not.toContain('Créer une facture');
    expect(html).not.toContain('Nouveau devis');
  });

  it('affiche les actions rapides dès qu\'au moins une permission les autorise', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['clients:read'], [AppModule.Administration, AppModule.Clients]));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.hasAnyQuickAction()).toBeTrue();

    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).not.toContain('Activez des modules pour voir vos actions rapides.');
    expect(html).toContain('Mes clients');
  });

  it('masque la carte « Livraisons en attente » quand le module Ventes est désactivé', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['delivery_notes:read'], ALL_MODULES.filter((m) => m !== AppModule.Sales)));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.showPendingDeliveriesSideCard()).toBeFalse();
    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).not.toContain('Livraisons en attente');
  });

  it('affiche la carte « Livraisons en attente » quand le module Ventes est actif', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['delivery_notes:read'], ALL_MODULES));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.showPendingDeliveriesSideCard()).toBeTrue();
    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('Livraisons en attente');
  });

  it('masque la carte « Devis en cours » quand le module Ventes est désactivé', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['quotes:read'], ALL_MODULES.filter((m) => m !== AppModule.Sales)));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.showActiveQuotesSideCard()).toBeFalse();
    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).not.toContain('Devis en cours');
  });

  it('affiche la carte « Devis en cours » quand le module Ventes est actif', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['quotes:read'], ALL_MODULES));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.showActiveQuotesSideCard()).toBeTrue();
    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('Devis en cours');
  });
});

/**
 * Plan v1 §2.5 — Dashboard adaptatif : widgets sectoriels + actions rapides
 * dérivées des modules actifs. Vérifie qu'un tenant Commerce·Textile ne voit
 * pas de KPI Projets, qu'un tenant BTP voit bien le KPI Projets, et qu'aucun
 * bloc ne s'affiche vide.
 */
describe('DashboardComponent — plan v1 §2.5 (dashboard adaptatif sectoriel)', () => {
  let getPurchaseOrdersSummary: jasmine.Spy;
  let projectDashboard: jasmine.Spy;
  let recurringContractList: jasmine.Spy;

  function configure() {
    const emptyOk = () => of({ success: true, data: { items: [] }, message: null, errors: [] as string[] });

    getPurchaseOrdersSummary = jasmine.createSpy('getPurchaseOrdersSummary').and.returnValue(
      of({
        success: true,
        data: { count: 2, totalTtc: 0, totalHt: 0, totalVat: 0, receivedCount: 0, pendingCount: 2, currency: 'TND' },
        message: null,
        errors: []
      })
    );
    projectDashboard = jasmine.createSpy('dashboard').and.returnValue(
      of({
        success: true,
        data: { activeProjects: 5, openTasks: 0, overdueTasks: 0, uninvoicedBillableHours: 0 },
        message: null,
        errors: []
      })
    );
    recurringContractList = jasmine.createSpy('list').and.returnValue(
      of({ items: [], page: 1, pageSize: 1, totalCount: 3, totalPages: 1, hasPreviousPage: false, hasNextPage: false })
    );

    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: InvoiceService, useValue: { getInvoices: jasmine.createSpy().and.returnValue(emptyOk()) } },
        {
          provide: StockService,
          useValue: {
            getStockAlerts: jasmine
              .createSpy()
              .and.returnValue(of({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] }))
          }
        },
        { provide: DeliveryNoteService, useValue: { getDeliveryNotes: jasmine.createSpy().and.returnValue(emptyOk()) } },
        {
          provide: DashboardService,
          useValue: {
            loadDashboardData: jasmine.createSpy().and.returnValue(
              of({
                allInvoices: [],
                recentInvoices: [],
                allQuotes: [],
                recentQuotes: [],
                topClients: [],
                monthlyRevenue: [],
                recentActivity: [],
                kpiTrends: { revenueChange: undefined, salesTodayChange: undefined, pendingChange: undefined },
                kpiSparklines: { revenue: [], salesToday: [], currentMonth: [], pending: [] },
                activeQuotesCount: 0,
                revenueKpis: { totalHt: null, monthToDateHt: null, previousMonthToDateHt: null }
              })
            )
          }
        },
        { provide: AccountingService, useValue: { getDashboard: jasmine.createSpy().and.returnValue(of({ success: true, data: {}, message: null, errors: [] })) } },
        {
          provide: CrmService,
          useValue: {
            getMyReminders: jasmine.createSpy().and.returnValue(of({ success: true, data: [], message: null, errors: [] })),
            getOpportunities: jasmine.createSpy().and.returnValue(of({ success: true, data: [], message: null, errors: [] }))
          }
        },
        { provide: WarehouseContextService, useValue: { selectedWarehouseId: jasmine.createSpy().and.returnValue(null) } },
        { provide: PurchaseOrderService, useValue: { getPurchaseOrdersSummary } },
        { provide: ProjectApiService, useValue: { dashboard: projectDashboard } },
        { provide: RecurringContractService, useValue: { list: recurringContractList } }
      ]
    });
  }

  it("Commerce · Textile : affiche les KPI ruptures/achats, n'affiche PAS le KPI Projets", () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['stock:read', 'purchase_orders:read'], ALL_MODULES, 'commerce'));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    const ids = component.sectorKpiWidgets().map((w) => w.widgetId);
    expect(ids).toContain('commerce-stock-ruptures');
    expect(ids).toContain('commerce-purchases-pending');
    expect(ids).not.toContain('services-btp-active-projects');

    expect(getPurchaseOrdersSummary).toHaveBeenCalled();
    expect(projectDashboard).not.toHaveBeenCalled();

    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('Ruptures / stock faible');
    expect(html).toContain('Achats en cours');
    expect(html).not.toContain('Projets actifs');
  });

  it('BTP & Construction : affiche le KPI Projets actifs, pas de widget Commerce', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['projects:read', 'recurring_contracts:read'], ALL_MODULES, 'btp-construction'));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    const ids = component.sectorKpiWidgets().map((w) => w.widgetId);
    expect(ids).toContain('services-btp-active-projects');
    expect(ids).toContain('services-btp-recurring-contracts');
    expect(ids).not.toContain('commerce-stock-ruptures');

    expect(projectDashboard).toHaveBeenCalled();
    expect(recurringContractList).toHaveBeenCalled();
    expect(getPurchaseOrdersSummary).not.toHaveBeenCalled();

    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('Projets actifs');
    expect(html).toContain('5');
  });

  it("aucun bloc « Aperçu sectoriel & modules » vide : le bloc « Modules actifs » s'affiche toujours", () => {
    configure();
    const auth = TestBed.inject(AuthService);
    // Segment « entreprise » générique : aucun widget KPI sectoriel ne correspond.
    setUser(auth, makeUser([], [AppModule.Administration], 'entreprise'));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.sectorKpiWidgets()).toEqual([]);
    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('Modules actifs');
    expect(html).toContain('Gérer mes modules');
  });

  it('module Stock actif + permission ⇒ action rapide « Entrée de stock » visible dans le bloc Actions rapides', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    setUser(auth, makeUser(['stock_vouchers:create'], ALL_MODULES, 'commerce'));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.canUseStockEntryQuickAction()).toBeTrue();
    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('Entrée de stock');
  });
});
