import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { environment } from '@environments/environment';
import { StudioWorkflowInstancesPanelComponent } from './studio-workflow-instances-panel.component';
import { WorkflowInstanceDto } from './studio-workflows.models';

const API = `${environment.apiUrl}/studio`;

const inst = (over: Partial<WorkflowInstanceDto> = {}): WorkflowInstanceDto => ({
  id: 'i1', workflowDefinitionId: 'w1', entityDefinitionId: 'e1', workflowKey: 'validation_devis',
  workflowName: 'Validation devis', definitionVersion: 1, recordId: '9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
  trigger: 'on_create', status: 'running', currentStepIndex: 0, currentStepKey: null, dueAt: null,
  startedBy: null, startedAt: '2026-09-17T10:00:00', completedAt: null, depth: 0,
  originInstanceId: null, error: null,
  ...over
});

/** Enveloppe `PagedResult` camelCase servie par la route 4.7a1 (`?page=&pageSize=`). */
const page = (items: WorkflowInstanceDto[], totalCount: number, pageNumber = 1, pageSize = 20) => ({
  success: true,
  data: {
    items, page: pageNumber, pageSize, totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
    hasPreviousPage: pageNumber > 1,
    hasNextPage: pageNumber * pageSize < totalCount
  },
  message: null, error: null
});

describe('StudioWorkflowInstancesPanelComponent (4.7a2 — historique paginé)', () => {
  let fixture: ComponentFixture<StudioWorkflowInstancesPanelComponent>;
  let httpMock: HttpTestingController;

  function setup(workflowId: string | null = 'w1'): void {
    TestBed.configureTestingModule({
      imports: [StudioWorkflowInstancesPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideNoopAnimations()]
    });
    fixture = TestBed.createComponent(StudioWorkflowInstancesPanelComponent);
    fixture.componentRef.setInput('workflowId', workflowId);
    fixture.componentRef.setInput('entityKey', 'devis');
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('charge la page 1 (20 par page) et affiche le total serveur ; clic et lien de fiche', () => {
    setup('w1');
    fixture.componentRef.setInput('openCount', 3);
    fixture.detectChanges();
    const req = httpMock.expectOne(r =>
      r.url === `${API}/workflows/w1/instances` && r.params.get('page') === '1' && r.params.get('pageSize') === '20');
    expect(req.request.method).toBe('GET');
    req.flush(page([inst({ id: 'i1' }), inst({ id: 'i2', status: 'completed' })], 25));
    fixture.detectChanges();

    // Le badge vient de l'entrée openCount (pas d'un comptage local sur la page — D-47-F02).
    const badge = fixture.debugElement.query(By.css('[data-testid="wf-instances-open-count"]'));
    expect(badge).not.toBeNull();
    expect((badge.nativeElement as HTMLElement).textContent?.trim()).toBe('3');

    // Il reste 23 instances ⇒ « Charger plus » visible avec le reste calculé du total serveur.
    const more = fixture.debugElement.query(By.css('[data-testid="wf-instances-more"]'));
    expect(more).not.toBeNull();
    expect((more.nativeElement as HTMLElement).textContent).toContain('encore 23');

    const openSpy = jasmine.createSpy('open');
    fixture.componentInstance.open.subscribe(openSpy);
    const row = fixture.debugElement.query(By.css('[data-testid="wf-instance-i1"]'));
    expect(row).not.toBeNull();
    (row.nativeElement as HTMLElement).click();
    expect(openSpy).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 'i1' }));

    // Identifiant tronqué (D-44-24) + lien « Ouvrir la fiche » vers la route de redirection.
    expect((row.nativeElement as HTMLElement).textContent).toContain('9f1c2d3e…');
    const link = fixture.debugElement.query(By.css('[data-testid="wf-instance-open-i1"]'));
    expect(link).not.toBeNull();
    expect((link.nativeElement as HTMLAnchorElement).getAttribute('href')).toBe('/studio/records/devis/9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f');
  });

  it('« Charger plus » émet page=2 et accumule les lignes', () => {
    setup('w1');
    httpMock.expectOne(r => r.url === `${API}/workflows/w1/instances`)
      .flush(page(Array.from({ length: 20 }, (_, k) => inst({ id: `p1-${k}` })), 22));
    fixture.detectChanges();

    const more = fixture.debugElement.query(By.css('[data-testid="wf-instances-more"]'));
    expect((more.nativeElement as HTMLElement).textContent).toContain('encore 2');
    (more.nativeElement as HTMLElement).click();
    const req2 = httpMock.expectOne(r =>
      r.url === `${API}/workflows/w1/instances` && r.params.get('page') === '2' && r.params.get('pageSize') === '20');
    req2.flush(page([inst({ id: 'p2-0' }), inst({ id: 'p2-1' })], 22, 2));
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.wf-inst__item')).length).toBe(22);
    expect(fixture.debugElement.query(By.css('[data-testid="wf-instance-p2-1"]'))).not.toBeNull();
    // Tout est chargé ⇒ le bouton disparaît.
    expect(fixture.debugElement.query(By.css('[data-testid="wf-instances-more"]'))).toBeNull();
  });

  it('le bouton « Charger plus » disparaît quand tout est chargé dès la page 1', () => {
    setup('w1');
    httpMock.expectOne(r => r.url === `${API}/workflows/w1/instances`)
      .flush(page([inst(), inst({ id: 'i2' })], 2));
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[data-testid="wf-instances-more"]'))).toBeNull();
  });

  it('refreshToken recharge depuis la page 1 (accumulation réinitialisée)', () => {
    setup('w1');
    httpMock.expectOne(r => r.url === `${API}/workflows/w1/instances`)
      .flush(page([inst({ id: 'old' })], 1));
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-instance-old"]'))).not.toBeNull();

    fixture.componentRef.setInput('refreshToken', 1);
    fixture.detectChanges();
    const req = httpMock.expectOne(r =>
      r.url === `${API}/workflows/w1/instances` && r.params.get('page') === '1' && r.params.get('pageSize') === '20');
    req.flush(page([], 0));
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[data-testid="wf-instance-old"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-instances-empty"]'))).not.toBeNull();
  });

  it('badge = entrée openCount même sans instance chargée (pas de comptage local)', () => {
    setup('w1');
    fixture.componentRef.setInput('openCount', 7);
    httpMock.expectOne(r => r.url === `${API}/workflows/w1/instances`)
      .flush(page([inst({ id: 'i1', status: 'completed' })], 1));
    fixture.detectChanges();

    const badge = fixture.debugElement.query(By.css('[data-testid="wf-instances-open-count"]'));
    expect(badge).not.toBeNull();
    expect((badge.nativeElement as HTMLElement).textContent?.trim()).toBe('7');
  });

  // 4.7★2 (S12) — verrous complémentaires du panneau.
  it('badge masqué quand openCount vaut 0, même si la page chargée contient des instances en cours (D-47-F02)', () => {
    setup('w1');
    httpMock.expectOne(r => r.url === `${API}/workflows/w1/instances`)
      .flush(page([inst({ id: 'i1', status: 'running' }), inst({ id: 'i2', status: 'waiting_approval' })], 2));
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[data-testid="wf-instances-open-count"]'))).toBeNull();
    expect(fixture.debugElement.queryAll(By.css('.wf-inst__item')).length).toBe(2);
  });

  it('« Charger plus » passe en état de chargement et ignore un second clic tant que la page 2 est en vol', () => {
    setup('w1');
    httpMock.expectOne(r => r.url === `${API}/workflows/w1/instances`)
      .flush(page(Array.from({ length: 20 }, (_, k) => inst({ id: `p1-${k}` })), 45));
    fixture.detectChanges();

    const more = () => fixture.debugElement.query(By.css('[data-testid="wf-instances-more"]')).nativeElement as HTMLButtonElement;
    expect(more().classList.contains('p-button-loading')).toBeFalse();
    more().click();
    more().click(); // second clic pendant le vol : aucune requête supplémentaire (garde loadingMore)
    fixture.detectChanges();

    const req2 = httpMock.expectOne(r =>
      r.url === `${API}/workflows/w1/instances` && r.params.get('page') === '2' && r.params.get('pageSize') === '20');
    expect(more().classList.contains('p-button-loading')).toBeTrue();
    expect(more().classList.contains('p-disabled')).toBeTrue();

    req2.flush(page(Array.from({ length: 20 }, (_, k) => inst({ id: `p2-${k}` })), 45, 2));
    fixture.detectChanges();

    expect(more().classList.contains('p-button-loading')).toBeFalse();
    expect(more().textContent).toContain('encore 5');
    expect(fixture.debugElement.queryAll(By.css('.wf-inst__item')).length).toBe(40);
    httpMock.expectNone(r => r.params.get('page') === '3');
  });

  it('affiche l\'état vide sans requête quand workflowId est nul', () => {
    setup(null);
    httpMock.expectNone(r => r.url.includes('/instances'));
    expect(fixture.debugElement.query(By.css('[data-testid="wf-instances-unsaved"]'))).not.toBeNull();
  });
});
