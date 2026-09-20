import { Component, input, model, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AuthService } from '@core/services/auth.service';
import { ViewportService } from '@core/services/viewport.service';
import { StudioApprovalsPageComponent } from './studio-approvals-page.component';
import { StudioApprovalsBadgeService } from './studio-approvals-badge.service';
import { STUDIO_WORKFLOW_LABELS } from '../workflows/studio-workflow-labels';
import { StudioWorkflowInstanceDetailComponent } from '../workflows/studio-workflow-instance-detail.component';
import type { WorkflowApprovalInboxItemDto, WorkflowInstanceDto } from '../workflows/studio-workflows.models';

const API = `${environment.apiUrl}/studio`;
const labels = STUDIO_WORKFLOW_LABELS.approvals;

/**
 * Bouchon du drawer d'instance 4.4f (API figée H-8 + `recordId` 4.5d2) : la page le rend
 * pour tout lecteur (4.5d3) et le vrai drawer appellerait la route runtime à l'ouverture —
 * neutralisé ici, on vérifie seulement les inputs transmis.
 */
@Component({
  selector: 'app-studio-workflow-instance-detail',
  standalone: true,
  template: ''
})
class InstanceDetailStubComponent {
  readonly instanceId = model<string | null>(null);
  readonly entityKey = input<string | null>(null);
  readonly recordId = input<string | null>(null);
  readonly changed = output<WorkflowInstanceDto>();
  readonly closed = output<void>();
}

/** Item de boîte de réception au format H-1 (forme imbriquée, annexe 4.4g2) ; `startedByName` (4.5a2) connu pour `a1` seulement. */
function inboxItem(id = 'a1', dueAt: string | null = null): WorkflowApprovalInboxItemDto {
  return {
    approval: {
      id, instanceId: 'i1', stepKey: 'approval_1', title: 'Valider le devis', status: 'pending',
      dueAt, createdAt: '2026-09-17T08:00:00Z', comment: null, message: 'Merci de relire',
      assigneeUserId: null, assigneeRole: 'Administrator', decidedBy: null, decidedAt: null, rowVersion: 'v1'
    },
    instanceId: 'i1', workflowKey: 'validation_devis', workflowName: 'Validation devis',
    entityKey: 'devis', entityName: 'Devis', recordId: 'r1', recordLabel: 'DEV-001',
    startedBy: null, startedAt: '2026-09-16T09:00:00Z',
    startedByName: id === 'a1' ? 'Alice Martin' : null
  };
}

describe('StudioApprovalsPageComponent', () => {
  let fixture: ComponentFixture<StudioApprovalsPageComponent>;
  let component: StudioApprovalsPageComponent;
  let httpMock: HttpTestingController;
  let toastSpy: jasmine.Spy;
  let badgeRefresh: jasmine.Spy;
  let perms: Set<string>;
  /** 4.6T2 : `wide` vient de ViewportService — stubbé par un signal piloté par les tests (D-44-56). */
  let wideStub: WritableSignal<boolean>;

  function setup(): void {
    wideStub = signal(false);
    TestBed.configureTestingModule({
      imports: [StudioApprovalsPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: ViewportService, useValue: { isWide: wideStub } },
        { provide: AuthService, useValue: { hasPermission: (p: string) => perms.has(p) } },
        { provide: StudioApprovalsBadgeService, useValue: { refresh: (badgeRefresh = jasmine.createSpy('refresh')) } }
      ]
    });
    TestBed.overrideComponent(StudioApprovalsPageComponent, {
      remove: { imports: [StudioWorkflowInstanceDetailComponent] },
      add: { imports: [InstanceDetailStubComponent] }
    });
    toastSpy = spyOn(TestBed.inject(MessageService), 'add');
    fixture = TestBed.createComponent(StudioApprovalsPageComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();   // ngOnInit ⇒ GET approvals/mine
  }

  afterEach(async () => {
    httpMock.verify();
    // Dialog ET drawer (4.4h1) montés avec appendTo="body" : on les referme et on laisse
    // leurs animations de sortie se terminer AVANT la destruction du TestBed (sinon
    // NG0205 « injecteur détruit » en console), puis purge défensive (cf. note 4.4f).
    component.decision.set(null);
    component.selected.set(null);
    component.openInstanceId.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    document.querySelectorAll('.p-dialog, .p-dialog-mask, .p-drawer, .p-drawer-mask').forEach(el => el.remove());
  });

  /** Répond au GET de la boîte de réception (prédicat : URL sans les query params). */
  function flushInbox(items: WorkflowApprovalInboxItemDto[]): void {
    httpMock.expectOne(r => r.method === 'GET' && r.url === `${API}/workflows/approvals/mine`)
      .flush({ success: true, data: items, message: null, error: null });
    fixture.detectChanges();
  }

  /** Clic sur un bouton de ligne de la table (hôte p-button ⇒ bouton interne). */
  function clickRowButton(testid: string): void {
    const host = fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
    expect(host).withContext(`bouton ${testid} présent`).not.toBeNull();
    ((host!.querySelector('button') as HTMLElement | null) ?? host!).click();
    fixture.detectChanges();
  }

  /** Bouton de confirmation du dialog (monté dans document.body via appendTo). */
  function confirmButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('[data-testid="sap-confirm"] button');
  }

  it('charge la boîte et calcule les KPI À traiter / En retard / Sous 24 h', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    flushInbox([
      inboxItem('a1', new Date(Date.now() - 3_600_000).toISOString()),        // en retard
      inboxItem('a2', new Date(Date.now() + 2 * 3_600_000).toISOString()),    // sous 24 h
      inboxItem('a3', new Date(Date.now() + 3 * 86_400_000).toISOString())    // plus tard
    ]);

    expect(component.kpis()).toEqual({ pending: 3, late: 1, soon: 1 });
    const text = (testid: string) => ((fixture.nativeElement.querySelector(`[data-testid="${testid}"] .sap-kpi__value`) as HTMLElement).textContent ?? '').trim();
    expect(text('sap-kpi-pending')).toBe('3');
    expect(text('sap-kpi-late')).toBe('1');
    expect(text('sap-kpi-soon')).toBe('1');
    expect(fixture.nativeElement.querySelector('[data-testid="sap-row-a1"]')).not.toBeNull();
  });

  it("affiche l'état vide quand aucune approbation n'est en attente", () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    flushInbox([]);

    const empty = fixture.nativeElement.querySelector('.ft-empty') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain(labels.empty);
    expect(empty.textContent).toContain(labels.emptyHint);
    expect(empty.getAttribute('colspan')).toBe('7');   // 7 colonnes depuis « Demandé par » (4.5e)
  });

  it('affiche la colonne « Demandé par » avec le nom du demandeur et — quand il est inconnu', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead]);
    setup();
    flushInbox([inboxItem('a1'), inboxItem('a2')]);

    const headers = Array.from(fixture.nativeElement.querySelectorAll('thead th') as NodeListOf<HTMLElement>).map(th => th.textContent?.trim());
    expect(headers).toContain(labels.colRequestedBy);   // « Demandé par »
    expect(headers.length).toBe(7);
    expect((fixture.nativeElement.querySelector('[data-testid="sap-requested-by-a1"]') as HTMLElement).textContent?.trim()).toBe('Alice Martin');
    expect((fixture.nativeElement.querySelector('[data-testid="sap-requested-by-a2"]') as HTMLElement).textContent?.trim()).toBe('—');
  });

  it('masque Approuver / Refuser et affiche la note lecture seule sans custom_records:write', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead]);
    setup();
    flushInbox([inboxItem('a1')]);

    expect(component.canDecide()).toBe(false);
    expect(fixture.nativeElement.querySelector('.sap-readonly')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="sap-approve-a1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="sap-reject-a1"]')).toBeNull();
    // D-44-53 : pas de lien vers la fiche (la route edit exige recordsWrite)
    expect(fixture.nativeElement.querySelector('[data-testid="sap-row-a1"] a')).toBeNull();
  });

  it('exige un motif pour refuser', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    flushInbox([inboxItem('a1')]);

    clickRowButton('sap-reject-a1');
    expect(component.decision()?.kind).toBe('reject');
    expect(confirmButton()).not.toBeNull();
    expect(confirmButton()!.disabled).toBeTrue();          // commentaire vide ⇒ confirmation bloquée

    component.comment.set('Trop cher');
    fixture.detectChanges();
    expect(confirmButton()!.disabled).toBeFalse();
  });

  it('approuve, retire la ligne et rafraîchit le badge', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    flushInbox([inboxItem('a1'), inboxItem('a2')]);

    clickRowButton('sap-approve-a1');
    expect(component.decision()?.kind).toBe('approve');
    confirmButton()!.click();

    const req = httpMock.expectOne(`${API}/workflows/approvals/a1/approve`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ comment: null });
    req.flush({ success: true, data: null, message: null, error: null });
    fixture.detectChanges();

    expect(component.items().map(i => i.id)).toEqual(['a2']);
    expect(badgeRefresh).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'success', detail: labels.approved }));
    expect(component.decision()).toBeNull();
  });

  it('signale une demande déjà traitée (409) et recharge la liste', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    flushInbox([inboxItem('a1')]);

    clickRowButton('sap-reject-a1');
    component.comment.set('Trop cher');
    fixture.detectChanges();
    confirmButton()!.click();

    const req = httpMock.expectOne(`${API}/workflows/approvals/a1/reject`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ comment: 'Trop cher' });
    req.flush({ success: false, data: null, message: null, error: 'déjà traitée' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'warn', detail: labels.alreadyDecided }));
    // D-44-55 : rechargement complet (vérité serveur) plutôt que retrait local
    httpMock.expectOne(r => r.method === 'GET' && r.url === `${API}/workflows/approvals/mine`)
      .flush({ success: true, data: [], message: null, error: null });
    fixture.detectChanges();
    expect(component.items()).toEqual([]);
  });

  it('ouvre le détail en colonne fixe au-delà de 1 280 px', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    flushInbox([inboxItem('a1')]);

    wideStub.set(true);                                             // D-44-56 : bascule pilotée par le stub ViewportService (4.6T2)
    clickRowButton('sap-detail-a1');

    expect(component.selected()?.id).toBe('a1');
    expect(fixture.nativeElement.querySelector('[data-testid="sap-panel-column"]')).not.toBeNull();
    expect((fixture.nativeElement.querySelector('.sap-layout') as HTMLElement).classList).toContain('sap-layout--panel');
    expect((fixture.nativeElement.querySelector('[data-testid="sap-row-a1"]') as HTMLElement).classList).toContain('sap-row--selected');
    expect(document.querySelector('.p-drawer')).toBeNull();          // pas de tiroir en mode large
  });

  it('ouvre le détail dans un drawer sous 1 280 px et le ferme', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    flushInbox([inboxItem('a1')]);

    wideStub.set(false);
    clickRowButton('sap-detail-a1');

    expect(fixture.nativeElement.querySelector('[data-testid="sap-panel-column"]')).toBeNull();
    const drawer = document.querySelector('.p-drawer') as HTMLElement;   // appendTo="body"
    expect(drawer).not.toBeNull();
    expect(drawer.textContent).toContain('Validation devis');

    component.clearSelection();
    fixture.detectChanges();
    expect(component.selected()).toBeNull();
    expect(document.querySelector('.p-drawer')).toBeNull();
  });

  it("ouvre le drawer d'instance pour un lecteur custom_records:read en lui passant entityKey et recordId", () => {
    perms = new Set([PERMISSIONS.customData.recordsRead]);
    setup();
    flushInbox([inboxItem('a1')]);

    wideStub.set(true);
    clickRowButton('sap-detail-a1');
    expect(component.selected()?.recordId).toBe('r1');

    // « Voir l'instance » rendu sans studio:design_entities (D-44-82 levé) et ouvre le drawer en place.
    clickRowButton('sapd-instance');

    const stub = fixture.debugElement.query(By.css('app-studio-workflow-instance-detail'))?.componentInstance as InstanceDetailStubComponent | undefined;
    expect(stub).withContext('drawer rendu').toBeDefined();
    expect(stub!.instanceId()).toBe('i1');
    expect(stub!.entityKey()).toBe('devis');
    expect(stub!.recordId()).toBe('r1');
  });

  it("affiche l'erreur et Réessayer quand le chargement échoue", () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    httpMock.expectOne(r => r.method === 'GET' && r.url === `${API}/workflows/approvals/mine`)
      .flush('panne', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.sai-banner--error') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain(labels.loadError);

    const retry = fixture.nativeElement.querySelector('[data-testid="sap-retry"] button') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    retry.click();
    flushInbox([inboxItem('a1')]);

    expect(fixture.nativeElement.querySelector('.sai-banner--error')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="sap-row-a1"]')).not.toBeNull();
  });

  // ---- 4.7 « v1.1 » (ap-f, D-47-60/61) : onglets « Déléguées » (Bientôt) et « Historique » ----

  /** Décision passée au format H-1 (même forme que l'inbox). */
  function historyItem(id: string, status: 'approved' | 'rejected', comment: string | null,
                       startedByName: string | null = 'Alice Martin'): WorkflowApprovalInboxItemDto {
    const item = inboxItem(id);
    item.approval = {
      ...item.approval, status, comment,
      decidedBy: 'u-me', decidedAt: status === 'approved' ? '2026-09-17T15:30:00Z' : '2026-09-18T09:05:00Z'
    };
    item.startedByName = startedByName;
    return item;
  }

  function flushHistory(items: WorkflowApprovalInboxItemDto[]): void {
    httpMock.expectOne(r => r.method === 'GET' && r.url === `${API}/workflows/approvals/mine/history`)
      .flush({ success: true, data: items, message: null, error: null });
    fixture.detectChanges();
  }

  function clickTab(key: string): void {
    (fixture.nativeElement.querySelector(`[data-testid="studio-tab-${key}"]`) as HTMLElement).click();
    fixture.detectChanges();
  }

  it('onglet « Historique » : chargé à la première activation seulement, statut et date affichés', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead, PERMISSIONS.customData.recordsWrite]);
    setup();
    flushInbox([inboxItem('a1')]);
    httpMock.expectNone(r => r.url === `${API}/workflows/approvals/mine/history`);   // paresseux

    clickTab('history');
    flushHistory([historyItem('h1', 'rejected', 'Non justifié.'), historyItem('h2', 'approved', null, null)]);

    const row = fixture.nativeElement.querySelector('[data-testid="sap-history-row-h1"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Alice Martin');
    expect(fixture.nativeElement.querySelector('[data-testid="sap-history-decided-h1"]').textContent).toContain('18/09/2026');
    expect(fixture.nativeElement.querySelector('[data-testid="sap-history-decision-h1"]').textContent)
      .toContain(labels.decisionRejected);
    expect(fixture.nativeElement.querySelector('[data-testid="sap-history-decision-h2"]').textContent)
      .toContain(labels.decisionApproved);
    expect(fixture.nativeElement.querySelector('[data-testid="sap-history-comment-h1"]').textContent)
      .toContain('Non justifié.');
    expect(fixture.nativeElement.querySelector('[data-testid="sap-history-comment-h2"]').textContent)
      .toContain('—');

    // Retour « À traiter » puis « Historique » : aucune nouvelle requête.
    clickTab('pending');
    expect(fixture.nativeElement.querySelector('[data-testid="sap-row-a1"]')).not.toBeNull();
    clickTab('history');
    httpMock.expectNone(r => r.url === `${API}/workflows/approvals/mine/history`);
    expect(fixture.nativeElement.querySelector('[data-testid="sap-history-row-h1"]')).not.toBeNull();
  });

  it('onglet « Déléguées » : désactivé avec infobulle « Bientôt », jamais activé', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead]);
    setup();
    flushInbox([]);

    const tab = fixture.nativeElement.querySelector('[data-testid="studio-tab-delegated"]') as HTMLButtonElement;
    expect(tab.disabled).toBeTrue();
    expect(tab.title).toBe(labels.delegatedSoon);
    tab.click();
    fixture.detectChanges();
    expect(component.activeTab()).toBe('pending');
  });

  it('onglet « Historique » : erreur ⇒ bannière + Réessayer', () => {
    perms = new Set([PERMISSIONS.customData.recordsRead]);
    setup();
    flushInbox([]);
    clickTab('history');
    httpMock.expectOne(r => r.method === 'GET' && r.url === `${API}/workflows/approvals/mine/history`)
      .flush('panne', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.sai-banner--error') as HTMLElement;
    expect(banner.textContent).toContain(labels.historyLoadError);

    (fixture.nativeElement.querySelector('[data-testid="sap-history-retry"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    flushHistory([historyItem('h1', 'approved', 'Vu.')]);
    expect(fixture.nativeElement.querySelector('.sai-banner--error')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="sap-history-row-h1"]')).not.toBeNull();
  });
});
