import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { StudioWorkflowInstanceDetailComponent } from './studio-workflow-instance-detail.component';
import { WorkflowInstanceDetailDto, WorkflowInstanceDto } from './studio-workflows.models';

const API = `${environment.apiUrl}/studio`;

const inst = (over: Partial<WorkflowInstanceDto> = {}): WorkflowInstanceDto => ({
  id: 'i1', workflowDefinitionId: 'w1', entityDefinitionId: 'e1', workflowKey: 'validation_devis',
  workflowName: 'Validation devis', definitionVersion: 3, recordId: '9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
  trigger: 'on_create', status: 'waiting_approval', currentStepIndex: 1, currentStepKey: 'approval_1',
  dueAt: '2026-09-20T09:42:00', startedBy: null, startedAt: '2026-09-17T09:42:00', completedAt: null,
  depth: 0, originInstanceId: null, error: null,
  ...over
});

/** Détail d'instance en attente d'approbation (annexe 4.4f) ; `context.secret` ne doit JAMAIS être rendu (S-base). */
const DETAIL: WorkflowInstanceDetailDto = {
  instance: inst(),
  steps: [
    { stepIndex: 0, stepKey: 'condition_1', stepType: 'condition', status: 'succeeded', outcome: 'continue', result: null, error: null, startedAt: '2026-09-17T09:42:00', finishedAt: '2026-09-17T09:42:01' },
    { stepIndex: 1, stepKey: 'approval_1', stepType: 'approval', status: 'suspended', outcome: 'suspend', result: null, error: null, startedAt: '2026-09-17T09:42:01', finishedAt: '2026-09-17T09:42:01' }
  ],
  approvals: [
    { id: 'a1', instanceId: 'i1', stepKey: 'approval_1', assigneeUserId: null, assigneeRole: 'Administrator', title: 'Validation du responsable', message: null, status: 'pending', decidedBy: null, decidedAt: null, comment: null, dueAt: null, createdAt: '2026-09-17T09:42:01', rowVersion: 'rv1' }
  ],
  context: { secret: 'x' }
};

/** Hôte de test du contrat figé de la partie B : `[(instanceId)]`, `(changed)`, `(closed)`, `[entityKey]` ; `[recordId]` (portée fiche, 4.5d2). */
@Component({
  standalone: true,
  imports: [StudioWorkflowInstanceDetailComponent],
  template: `<app-studio-workflow-instance-detail [(instanceId)]="instanceId" entityKey="devis" [recordId]="recordId()"
    (changed)="changed.push($event)" (closed)="closedCount = closedCount + 1" />`
})
class TestHost {
  readonly instanceId = signal<string | null>(null);
  readonly recordId = signal<string | null>(null);
  readonly changed: WorkflowInstanceDto[] = [];
  closedCount = 0;
}

describe('StudioWorkflowInstanceDetailComponent', () => {
  let canWrite = true;
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;
  let httpMock: HttpTestingController;
  let addSpy: jasmine.Spy;

  function setup(): void {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: AuthService, useValue: { hasPermission: () => canWrite } }
      ]
    });
    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    addSpy = spyOn(TestBed.inject(MessageService), 'add');
    fixture.detectChanges();
  }

  /**
   * Panneau du drawer du test courant. `appendTo="body"` déporte le panneau hors de
   * `fixture.nativeElement` et la suppression différée par l'animation de sortie peut laisser
   * des panneaux résiduels des tests précédents : on cible toujours le DERNIER panneau du
   * document (le nôtre, le plus récent) — cf. purge en afterEach.
   */
  function panel(): HTMLElement {
    const panels = document.querySelectorAll<HTMLElement>('.wf-instance-drawer');
    const p = panels.item(panels.length - 1);
    expect(p).withContext('panneau du drawer présent').toBeTruthy();
    return p;
  }

  function qs<T extends HTMLElement>(selector: string): T | null {
    return panel().querySelector<T>(selector);
  }

  /** Ouvre le drawer sur l'instance et répond au GET de détail. */
  function open(id: string, detail: WorkflowInstanceDetailDto = DETAIL): void {
    host.instanceId.set(id);
    fixture.detectChanges();
    httpMock.expectOne(`${API}/workflows/instances/${id}`)
      .flush({ success: true, data: detail, message: null, error: null });
    fixture.detectChanges();
  }

  /** Clic sur un bouton du drawer courant. */
  function click(testid: string): void {
    const el = qs<HTMLElement>(`[data-testid="${testid}"]`);
    expect(el).withContext(`bouton ${testid} présent`).not.toBeNull();
    el!.click();
    fixture.detectChanges();
  }

  function flushReload(detail: WorkflowInstanceDetailDto = DETAIL): void {
    httpMock.expectOne(`${API}/workflows/instances/i1`).flush({ success: true, data: detail, message: null, error: null });
    fixture.detectChanges();
  }

  afterEach(async () => {
    httpMock.verify();
    // Laisse les animations du drawer (entrée/sortie, appendTo="body") se vider AVANT la
    // destruction, sinon un panneau résiduel peut être ré-inséré dans `body` après la purge
    // et polluer les specs suivantes (motif `whenStable` de studio-ai-confirm-dialog.spec).
    await fixture.whenStable();
    fixture.destroy();
    document.querySelectorAll('.wf-instance-drawer, .p-drawer-mask, .p-overlay-mask')
      .forEach(el => el.remove());
  });

  it('affiche le nom du lanceur quand startedByName est servi, le guid sinon (4.6c1)', () => {
    setup();
    open('i1', { ...DETAIL, instance: inst({ startedBy: 'u-42', startedByName: 'Alice Martin' }) });
    expect(qs('[data-testid="wf-detail-started-by-i1"]')?.textContent?.trim()).toBe('Alice Martin');

    host.instanceId.set(null);
    fixture.detectChanges();
    open('i1', { ...DETAIL, instance: inst({ startedBy: 'u-42' }) });
    expect(qs('[data-testid="wf-detail-started-by-i1"]')?.textContent?.trim()).toBe('u-42');
  });

  it('charge le détail quand instanceId est posé et se vide à la fermeture', () => {
    setup();
    httpMock.expectNone(r => r.url.includes('/workflows/instances/'));   // fermé : aucune requête

    open('i1');
    expect(qs('[data-testid="wf-detail-summary"]')).not.toBeNull();
    expect(qs('[data-testid="wf-detail-record"]')?.getAttribute('href'))
      .toBe('/studio/records/devis/9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f');

    // 4.6c1 : « Démarré par » = nom du lanceur (4.6b1) ; « Système » quand ni nom ni guid.
    expect(qs('[data-testid="wf-detail-started-by-i1"]')?.textContent?.trim()).toBe('Système');

    // Croix de fermeture du drawer (p-drawer la rend dans l'en-tête, après le template custom).
    const closeBtn = qs<HTMLButtonElement>('.p-drawer-header button');
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();
    fixture.detectChanges();

    expect(host.instanceId()).toBeNull();          // le model est remis à null pour le parent
    expect(host.closedCount).toBe(1);              // sortie `closed` émise une seule fois
    const comp = fixture.debugElement.query(By.directive(StudioWorkflowInstanceDetailComponent)).componentInstance;
    expect((comp as unknown as { detail: () => unknown }).detail()).toBeNull();   // réinitialisé
  });

  it('rend une entrée de déroulé par étape avec statut et résultat traduits', () => {
    setup();
    open('i1');
    expect(panel().querySelectorAll('.wf-marker').length).toBe(2);
    const timeline = qs('.wf-detail-timeline');
    expect(timeline).not.toBeNull();
    expect(timeline!.textContent).toContain('condition_1');
    expect(timeline!.textContent).toContain('Terminée');    // stepRunStatus.succeeded
    expect(timeline!.textContent).toContain('En attente');  // stepRunStatus.suspended
    expect(timeline!.textContent).toContain('Continuer');   // outcomes.continue
    expect(timeline!.textContent).toContain('Suspendre');   // outcomes.suspend
    expect(timeline!.textContent).toContain('Condition');   // stepTypeLabel
  });

  it('n\'affiche jamais le contexte', () => {
    setup();
    open('i1');
    expect(panel().textContent).not.toContain('secret');
    expect(qs('.wf-detail-context')?.textContent).toContain('Contexte masqué');
  });

  it('affiche les actions seulement avec custom_records:write', () => {
    canWrite = false;
    setup();
    open('i1');
    expect(qs('[data-testid="wf-detail-actions"]')).toBeNull();
    expect(qs('[data-testid="wf-remind"]')).toBeNull();
    expect(qs('[data-testid="wf-cancel"]')).toBeNull();
    expect(qs('[data-testid="wf-detail-readonly"]')).not.toBeNull();

    // La permission est figée à l'évaluation du computed : nouvelle configuration TestBed.
    fixture.destroy();
    document.querySelectorAll('.wf-instance-drawer, .p-drawer-mask, .p-overlay-mask').forEach(el => el.remove());
    TestBed.resetTestingModule();
    canWrite = true;
    setup();
    open('i1');
    expect(qs('[data-testid="wf-remind"]')).not.toBeNull();
    expect(qs('[data-testid="wf-cancel"]')).not.toBeNull();
    expect(qs('[data-testid="wf-detail-readonly"]')).toBeNull();
  });

  it('désactive Relancer hors waiting_approval et Annuler si l\'instance est terminée', () => {
    setup();
    open('i1', { ...DETAIL, instance: inst({ status: 'completed', currentStepKey: null, completedAt: '2026-09-17T11:00:00' }) });
    const remind = qs<HTMLButtonElement>('[data-testid="wf-remind"]');
    const cancel = qs<HTMLButtonElement>('[data-testid="wf-cancel"]');
    expect(remind).not.toBeNull();
    expect(cancel).not.toBeNull();
    expect(remind!.disabled).toBeTrue();
    expect(cancel!.disabled).toBeTrue();
  });

  it('annule avec motif tronqué à 500 caractères et émet changed', () => {
    setup();
    open('i1');
    click('wf-cancel');
    const ta = qs<HTMLTextAreaElement>('[data-testid="wf-cancel-reason"]');
    expect(ta).not.toBeNull();
    // Affectation programmatique : `maxlength` ne borne pas ⇒ le `slice(0, 500)` défensif fait foi.
    ta!.value = 'x'.repeat(600);
    ta!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(panel().textContent).toContain('600/500');   // compteur reflète la saisie brute

    click('wf-cancel-confirm');
    const req = httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/workflows/instances/i1/cancel`);
    expect(req.request.body).toEqual({ reason: 'x'.repeat(500) });
    req.flush({ success: true, data: inst({ status: 'cancelled', completedAt: '2026-09-17T12:00:00' }), message: null, error: null });
    fixture.detectChanges();

    expect(host.changed.length).toBe(1);
    expect(host.changed[0].status).toBe('cancelled');
    expect(addSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'success', detail: 'Instance annulée.' }));
    flushReload();   // patchInstance recharge le déroulé
    expect(host.instanceId()).toBe('i1');          // le drawer reste ouvert
  });

  it('409 à l\'annulation ⇒ toast warn avec le message serveur et rechargement', () => {
    setup();
    open('i1');
    click('wf-cancel');
    click('wf-cancel-confirm');   // motif vide ⇒ reason null
    const req = httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/workflows/instances/i1/cancel`);
    expect(req.request.body).toEqual({ reason: null });
    req.flush({ success: false, error: 'Cette instance est déjà terminée.', message: null }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(addSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'warn', detail: 'Cette instance est déjà terminée.' }));
    flushReload();   // l'état a probablement changé : GET de rechargement
    expect(host.changed.length).toBe(0);
  });

  it('relance les approbateurs et 409 < 24 h ⇒ toast warn', () => {
    setup();
    open('i1');
    click('wf-remind');
    const req = httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/workflows/instances/i1/remind`);
    expect(req.request.body).toEqual({});
    req.flush({ success: true, data: inst(), message: null, error: null });
    fixture.detectChanges();
    expect(host.changed.length).toBe(1);
    expect(addSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'success', detail: 'Rappel envoyé.' }));
    flushReload();

    // Variante 409 « déjà relancés il y a moins de 24 h » : message serveur affiché tel quel.
    addSpy.calls.reset();
    click('wf-remind');
    httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/workflows/instances/i1/remind`)
      .flush({ success: false, error: 'Les approbateurs de cette instance ont déjà été relancés il y a moins de 24 h.', message: null }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(addSpy).toHaveBeenCalledWith(jasmine.objectContaining({
      severity: 'warn',
      detail: 'Les approbateurs de cette instance ont déjà été relancés il y a moins de 24 h.'
    }));
    flushReload();
  });

  it('charge par la route runtime records/{entityKey}/{recordId}/workflow-instances/{id} quand recordId est fourni', () => {
    setup();
    host.recordId.set('r1');
    host.instanceId.set('inst-1');
    fixture.detectChanges();

    httpMock.expectNone(`${API}/workflows/instances/inst-1`);   // pas de route conception en portée fiche
    const req = httpMock.expectOne(`${API}/records/devis/r1/workflow-instances/inst-1`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: { ...DETAIL, instance: inst({ id: 'inst-1' }) }, message: null, error: null });
    fixture.detectChanges();

    expect(qs('[data-testid="wf-detail-summary"]')).not.toBeNull();
    expect(qs('[data-testid="wf-detail-record"]')?.getAttribute('href'))
      .toBe('/studio/records/devis/9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f');
  });

  it('404 sur la route runtime (instance hors couple) ⇒ message « introuvable » inline', () => {
    setup();
    host.recordId.set('r1');
    host.instanceId.set('inst-9');
    fixture.detectChanges();
    httpMock.expectOne(`${API}/records/devis/r1/workflow-instances/inst-9`)
      .flush({ success: false, error: 'gone', message: null }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(qs('[data-testid="wf-detail-error"]')?.textContent).toContain('Instance introuvable.');
    expect(qs('[data-testid="wf-detail-summary"]')).toBeNull();
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("masque le bouton d'origine en portée fiche (la route conception exige design_entities)", () => {
    setup();
    const withOrigin: WorkflowInstanceDetailDto = { ...DETAIL, instance: inst({ depth: 1, originInstanceId: 'i0' }) };

    // Portée conception : bouton présent.
    open('i1', withOrigin);
    expect(qs('[data-testid="wf-detail-origin"]')).not.toBeNull();

    // Portée fiche : bouton masqué (le rechargement passe par la route runtime).
    host.recordId.set('r1');
    host.instanceId.set('i2');
    fixture.detectChanges();
    httpMock.expectOne(`${API}/records/devis/r1/workflow-instances/i2`)
      .flush({ success: true, data: { ...withOrigin, instance: inst({ id: 'i2', depth: 1, originInstanceId: 'i0' }) }, message: null, error: null });
    fixture.detectChanges();
    expect(qs('[data-testid="wf-detail-summary"]')).not.toBeNull();
    expect(qs('[data-testid="wf-detail-origin"]')).toBeNull();
  });

  it("garde la portée fiche au « Réessayer » même si l'hôte a perdu recordId entre-temps (D-45-29)", () => {
    setup();
    host.recordId.set('r1');
    host.instanceId.set('inst-1');
    fixture.detectChanges();
    httpMock.expectOne(`${API}/records/devis/r1/workflow-instances/inst-1`)
      .flush({ success: false, error: 'boom', message: null }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(qs('[data-testid="wf-detail-error"]')).not.toBeNull();

    // L'hôte (« Mes approbations ») remet sa sélection à null pendant que le tiroir reste ouvert.
    host.recordId.set(null);
    fixture.detectChanges();
    click('wf-detail-retry');

    // La route runtime figée à l'ouverture est réutilisée : jamais la route de conception (403 lecteur).
    httpMock.expectNone(`${API}/workflows/instances/inst-1`);
    httpMock.expectOne(`${API}/records/devis/r1/workflow-instances/inst-1`)
      .flush({ success: true, data: { ...DETAIL, instance: inst({ id: 'inst-1' }) }, message: null, error: null });
    fixture.detectChanges();
    expect(qs('[data-testid="wf-detail-summary"]')).not.toBeNull();
  });

  it('404 au chargement ⇒ message « introuvable » sans planter', () => {
    setup();
    host.instanceId.set('i9');
    fixture.detectChanges();
    httpMock.expectOne(`${API}/workflows/instances/i9`)
      .flush({ success: false, error: 'gone', message: null }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    const err = qs('[data-testid="wf-detail-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain('Instance introuvable.');
    expect(qs('[data-testid="wf-detail-summary"]')).toBeNull();
    expect(addSpy).not.toHaveBeenCalled();   // erreur inline, pas de toast local
  });
});
