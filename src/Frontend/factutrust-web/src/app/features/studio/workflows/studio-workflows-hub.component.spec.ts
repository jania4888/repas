import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { ConfirmationService } from '@core/services/confirmation.service';
import { environment } from '@environments/environment';
import { StudioWorkflowsHubComponent } from './studio-workflows-hub.component';
import { STUDIO_WORKFLOW_LABELS } from './studio-workflow-labels';
import { WorkflowDefinitionDto, WorkflowDefinitionListItemDto } from './studio-workflows.models';
import { CustomEntity } from '../studio.models';

const API = `${environment.apiUrl}/studio`;

const entities = [
  { id: 'e1', key: 'devis', displayName: 'Devis', kind: 'Standard' },
  { id: 'e2', key: 'factures', displayName: 'Factures', kind: 'Standard' },
  { id: 'e3', key: 'devis_factures', displayName: 'Liaison', kind: 'Junction' }
] as CustomEntity[];

const wf = (over: Partial<WorkflowDefinitionDto> = {}): WorkflowDefinitionDto => ({
  id: 'w1', entityDefinitionId: 'e1', key: 'validation_devis', name: 'Validation devis', description: null,
  trigger: 'on_create', triggerConfig: null, steps: { version: 1, steps: [] }, stepCount: 5, version: 1,
  isActive: true, openInstances: 0, createdAt: '2026-09-01', updatedAt: '2026-09-10', rowVersion: 'r1',
  ...over
});

/** Ligne de la liste globale (4.5c2) : définition + table porteuse. */
const item = (over: Partial<WorkflowDefinitionDto> = {}, entityKey = 'devis', entityDisplayName = 'Devis'): WorkflowDefinitionListItemDto =>
  ({ workflow: wf(over), entityKey, entityDisplayName });

/** Réponse `PagedResult` de la liste globale (4.5f ; 4.6a1 : `page`/`pageSize` reflètent la requête). */
const paged = (items: WorkflowDefinitionListItemDto[], totalCount = items.length, page = 1, pageSize = 50) => ({
  success: true,
  data: { items, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize), hasNextPage: page * pageSize < totalCount, hasPreviousPage: page > 1 },
  message: null, error: null
});

describe('StudioWorkflowsHubComponent', () => {
  let fixture: ComponentFixture<StudioWorkflowsHubComponent>;
  let component: StudioWorkflowsHubComponent;
  let httpMock: HttpTestingController;
  let toastSpy: jasmine.Spy;

  function setup(query: Record<string, string> = {}): void {
    TestBed.configureTestingModule({
      imports: [StudioWorkflowsHubComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: ConfirmationService, useValue: { confirm: jasmine.createSpy('confirm').and.callFake((c: { accept: () => void }) => c.accept()) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } }
      ]
    });
    toastSpy = spyOn(TestBed.inject(MessageService), 'add');
    fixture = TestBed.createComponent(StudioWorkflowsHubComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === `${API}/entities`).flush({ success: true, data: entities, message: null, error: null });
  }

  /**
   * Répond à la requête globale `GET workflows` (4.6a1 : page + taille fixe 50, `search` optionnel)
   * puis relance le rendu.
   */
  function flushAll(
    items: WorkflowDefinitionListItemDto[],
    totalCount = items.length,
    expected: { page?: string; search?: string | null } = {}
  ): void {
    const req = httpMock.expectOne(r =>
      r.method === 'GET' && r.url === `${API}/workflows`
      && r.params.get('page') === (expected.page ?? '1')
      && r.params.get('pageSize') === '50'
      && (expected.search === undefined || r.params.get('search') === expected.search));
    req.flush(paged(items, totalCount, Number(req.request.params.get('page'))));
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('liste tous les workflows du tenant en une requête GET workflows?page=1&pageSize=50 et affiche la table porteuse', () => {
    setup();
    flushAll([item({ id: 'w2', name: 'Relance facture' }, 'factures', 'Factures'), item()]);

    httpMock.expectNone(r => r.url.startsWith(`${API}/entities/`) && r.url.endsWith('/workflows'));   // plus de forkJoin par table
    // 4.6a1 : la page est affichée dans l'ordre du serveur (nom croissant) — pas de re-tri local par table.
    expect(component.workflows().map(w => `${w.entityName}/${w.name}`)).toEqual(['Factures/Relance facture', 'Devis/Validation devis']);
    expect(component.totalCount()).toBe(2);
    expect(fixture.debugElement.query(By.css('p-paginator'))).toBeNull();   // totalCount ≤ pageSize ⇒ pas de paginator
    // data-testid figés (consommés par les tests Playwright de 4.4l1).
    expect(fixture.debugElement.query(By.css('[data-testid="wf-hub-new"]'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-hub-row-w1"]'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-hub-toggle-w1"]'))).not.toBeNull();
  });

  it('héberge le p-toast des messages de la page (D-44-95 : succès/erreurs des écritures visibles)', () => {
    setup();
    flushAll([item()]);

    expect(fixture.debugElement.query(By.css('p-toast'))).not.toBeNull();
    // Un toast de succès (bascule) trouve bien son hôte : l'appel MessageService part déjà (spy du describe).
    component.toggle(component.workflows()[0], false);
    httpMock.expectOne(`${API}/workflows/w1/toggle`).flush({ success: true, data: wf({ isActive: false }), message: null, error: null });
    expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'success' }));
  });

  it('filtre par table via ?entity= avec GET entities/{id}/workflows (chemin conservé, sans paginator)', () => {
    setup({ entity: 'e1' });
    httpMock.expectNone(r => r.url === `${API}/workflows`);
    httpMock.expectOne(`${API}/entities/e1/workflows`).flush({ success: true, data: [wf()], message: null, error: null });
    fixture.detectChanges();

    expect(component.entityId()).toBe('e1');
    expect(component.workflows().length).toBe(1);
    expect(component.workflows()[0].entityName).toBe('Devis');
    expect(component.totalCount()).toBe(1);
    expect(fixture.debugElement.query(By.css('p-paginator'))).toBeNull();
  });

  it('en mode ?entity=, la recherche reste locale (aucune requête serveur)', fakeAsync(() => {
    setup({ entity: 'e1' });
    httpMock.expectOne(`${API}/entities/e1/workflows`).flush({
      success: true,
      data: [wf(), wf({ id: 'w2', key: 'relance_devis', name: 'Relance devis' })],
      message: null, error: null
    });
    fixture.detectChanges();

    component.onSearchInput('relance');
    tick(300);
    fixture.detectChanges();

    httpMock.expectNone(r => r.url === `${API}/workflows`);
    expect(component.visible().map(w => w.id)).toEqual(['w2']);
    expect(component.counter()).toBe(1);
  }));

  it('affiche le paginator quand totalCount dépasse la page et le compteur lit totalCount', () => {
    setup();
    flushAll([item()], 250);

    const paginator = fixture.debugElement.query(By.css('[data-testid="wf-hub-paginator"]'));
    expect(paginator).not.toBeNull();
    expect(component.totalCount()).toBe(250);
    const count = fixture.debugElement.query(By.css('.studio-toolbar .studio-muted'));
    expect((count.nativeElement as HTMLElement).textContent).toContain('250 workflow(s)');
    expect(fixture.debugElement.query(By.css('[data-testid="wf-hub-row-w1"]'))).not.toBeNull();   // la page reste affichée
  });

  it('change de page : une requête ?page=2&pageSize=50 est émise', () => {
    setup();
    flushAll([item()], 120);

    component.onPage({ page: 1, first: 50, rows: 50, pageCount: 3 });
    flushAll([item({ id: 'w51', key: 'workflow_51', name: 'Workflow 51' })], 120, { page: '2' });

    expect(component.page()).toBe(2);
    expect(fixture.debugElement.query(By.css('[data-testid="wf-hub-row-w51"]'))).not.toBeNull();
  });

  it('recherche serveur : après debounce, une requête ?search=…&page=1 est émise', fakeAsync(() => {
    setup();
    flushAll([item()], 120);
    component.onPage({ page: 1, first: 50, rows: 50, pageCount: 3 });
    flushAll([item({ id: 'w51', key: 'workflow_51', name: 'Workflow 51' })], 120, { page: '2' });

    component.onSearchInput('  relance ');
    tick(299);
    httpMock.expectNone(r => r.url === `${API}/workflows`);   // debounce pas encore écoulé
    tick(1);
    flushAll([item({ id: 'w9', key: 'relance_facture', name: 'Relance facture' }, 'factures', 'Factures')], 1, { page: '1', search: 'relance' });

    expect(component.page()).toBe(1);   // toute recherche ramène à la page 1
    expect(component.searchServer()).toBe('relance');
    expect(component.counter()).toBe(1);
  }));

  it('une recherche vidée repart sans paramètre search', fakeAsync(() => {
    setup();
    flushAll([item()]);

    component.onSearchInput('devis');
    tick(300);
    flushAll([item()], 1, { search: 'devis' });
    component.onSearchInput('');
    tick(300);
    flushAll([item(), item({ id: 'w2', key: 'relance_facture', name: 'Relance facture' }, 'factures', 'Factures')], 2, { search: null });

    expect(component.searchServer()).toBeNull();
  }));

  it("affiche le toast d'erreur et une liste vide quand GET workflows échoue (500 ou 404 drapeau coupé)", () => {
    setup();
    httpMock.expectOne(r => r.method === 'GET' && r.url === `${API}/workflows`).flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.workflows().length).toBe(0);
    expect(component.totalCount()).toBe(0);
    expect(component.loading()).toBeFalse();
    expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'error', detail: STUDIO_WORKFLOW_LABELS.hub.loadError }));
  });

  it("active/désactive via POST toggle et restaure l'état sur 409", () => {
    setup();
    flushAll([item()]);

    component.toggle(component.workflows()[0], false);
    httpMock.expectOne(`${API}/workflows/w1/toggle`).flush(
      { success: false, error: 'conflit' },
      { status: 409, statusText: 'Conflict' }
    );

    expect(component.workflows()[0].isActive).toBe(true);
    expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'warn', detail: STUDIO_WORKFLOW_LABELS.designer.conflict }));
  });

  it("supprime après confirmation et affiche le nombre d'instances annulées", () => {
    setup();
    flushAll([item({ openInstances: 2 })]);

    component.remove(component.workflows()[0]);
    httpMock.expectOne(`${API}/workflows/w1`).flush({ success: true, data: { cancelledInstances: 2 }, message: null, error: null });
    // Rechargement après suppression.
    flushAll([]);

    expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'success', detail: '2 instance(s) annulée(s).' }));
    expect(component.workflows().length).toBe(0);
  });
});

// D-44-87 / D-44-92 : 4.4d importait `ConfirmationService` depuis `primeng/api` (jamais fourni) ⇒
// NullInjectorError au runtime sur /studio/workflows, alors que Karma restait vert grâce au stub
// `{ provide: ConfirmationService, useValue: … }` du describe ci-dessus. Ce describe n'en fournit
// volontairement AUCUN : le composant doit se créer avec le wrapper ng-bootstrap fourni à la racine.
describe('StudioWorkflowsHubComponent — injection réelle du ConfirmationService', () => {
  it('se crée avec le ConfirmationService du wrapper fourni à la racine et lui délègue la confirmation de suppression (régression D-44-87)', () => {
    TestBed.configureTestingModule({
      imports: [StudioWorkflowsHubComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } }
      ]
    });
    const confirmSvc = TestBed.inject(ConfirmationService);
    expect(confirmSvc).toBeInstanceOf(ConfirmationService);
    const confirmSpy = spyOn(confirmSvc, 'confirm'); // pas de modale ng-bootstrap réelle dans le test

    const fixture = TestBed.createComponent(StudioWorkflowsHubComponent);
    const httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === `${API}/entities`).flush({ success: true, data: entities, message: null, error: null });
    httpMock.expectOne(r => r.method === 'GET' && r.url === `${API}/workflows`).flush(paged([item()]));   // liste globale paginée
    fixture.detectChanges();

    fixture.componentInstance.remove(fixture.componentInstance.workflows()[0]);

    expect(confirmSpy).toHaveBeenCalledWith(jasmine.objectContaining({
      header: STUDIO_WORKFLOW_LABELS.hub.deleteTitle,
      acceptLabel: STUDIO_WORKFLOW_LABELS.hub.delete
    }));
    httpMock.expectNone(`${API}/workflows/w1`); // rien n'est supprimé tant que la confirmation n'est pas acceptée
    httpMock.verify();
  });
});
