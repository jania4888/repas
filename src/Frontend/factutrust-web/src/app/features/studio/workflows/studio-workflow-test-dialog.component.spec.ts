import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { environment } from '@environments/environment';
import { CustomField } from '@shared/studio-runtime/studio-runtime.models';
import { StudioWorkflowTestDialogComponent } from './studio-workflow-test-dialog.component';
import { WorkflowTestResultDto } from './studio-workflows.models';
import { CustomRecord } from '../studio.models';

const API = `${environment.apiUrl}/studio`;

const fields = [
  { id: 'f1', key: 'nom', label: 'Nom', fieldType: 0, isRequired: false, isActive: true },
  { id: 'f2', key: 'montant', label: 'Montant', fieldType: 2, isRequired: false, isActive: true }
] as CustomField[];

/**
 * Dialogue « Tester sur un enregistrement » (4.7c2) — cas déplacés à l'identique depuis
 * `studio-workflow-designer.component.spec.ts` lors de l'extraction du composant (4.7★3, D-47-80) :
 * mêmes requêtes attendues, mêmes `data-testid`, mêmes invariants (R17 : aucune écriture).
 * Entrées posées comme le concepteur le fait : workflow `w1` de la table `clients`, schéma à deux champs.
 */
describe('StudioWorkflowTestDialogComponent — dialogue « Tester » (4.7c2)', () => {
  let fixture: ComponentFixture<StudioWorkflowTestDialogComponent>;
  let component: StudioWorkflowTestDialogComponent;
  let httpMock: HttpTestingController;

  /** Enregistrement candidat : le champ titre « nom » (premier champ texte actif du schéma) porte le libellé. */
  const record1 = { id: 'rec-0000-1111-2222', data: { nom: 'Client Dupont', montant: 150 }, createdAt: '', updatedAt: '' } as CustomRecord;
  const record2 = { id: 'rec-9999-8888-7777', data: { montant: 40 }, createdAt: '', updatedAt: '' } as CustomRecord;

  /** Trace couvrant les quatre verdicts figés (would_run / skipped / would_suspend / would_fail). */
  const trace: WorkflowTestResultDto = {
    recordId: record1.id, entityKey: 'clients', evaluatedSteps: 3, suspended: true,
    steps: [
      { key: 'condition_1', type: 'condition', label: 'Montant élevé', verdict: 'would_run', detail: 'Condition remplie (match = all).', rendered: { passed: true, match: 'all' } },
      { key: 'notifie', type: 'notify', label: null, verdict: 'skipped', detail: 'Sautée par le branchement de « condition_1 ».', rendered: null },
      { key: 'inconnue', type: 'mystery', label: null, verdict: 'would_fail', detail: 'Type d\u2019étape inconnu : « mystery ».', rendered: null },
      { key: 'valide', type: 'approval', label: 'Validation', verdict: 'would_suspend', detail: 'Approbation assignée au rôle « Admin ».', rendered: { title: 'Validation devis' } }
    ],
    warnings: ['Sorties fictives : « _results.fact.* » ne sera renseigné qu\u2019à l\u2019exécution réelle.']
  };

  const flushRecords = (items: CustomRecord[], search?: string) => {
    const req = httpMock.expectOne(r =>
      r.method === 'GET' && r.url === `${API}/records/clients`
      && r.params.get('page') === '1' && r.params.get('pageSize') === '10'
      && (search === undefined || r.params.get('search') === search));
    req.flush({ success: true, data: { items, page: 1, pageSize: 10, totalCount: items.length, totalPages: 1, hasPreviousPage: false, hasNextPage: false }, message: null, error: null });
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StudioWorkflowTestDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()]
    });
    fixture = TestBed.createComponent(StudioWorkflowTestDialogComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('workflowId', 'w1');
    fixture.componentRef.setInput('entityKey', 'clients');
    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('ouvre le dialogue : 10 enregistrements chargés, recherche anti-rebond 300 ms, libellés par champ titre', fakeAsync(() => {
    component.open();
    flushRecords([record1, record2]);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-test-banner"]'))).not.toBeNull();
    expect(component.testRecords().length).toBe(2);
    expect(component.testRecordLabel(record1)).toBe('Client Dupont');
    expect(component.testRecordLabel(record2)).toBe('rec-9999…');

    component.onTestSearch('dup');
    tick(299);
    httpMock.expectNone(r => r.url === `${API}/records/clients`);
    tick(1);
    flushRecords([record1], 'dup');
    expect(component.testRecords().length).toBe(1);
  }));

  it('lance la simulation : POST { recordId } puis trace rendue avec les 4 verdicts, sans aucun appel d\u2019écriture', fakeAsync(() => {
    component.open();
    flushRecords([record1]);
    component.pickTestRecord(record1);
    component.runTest();

    const post = httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/workflows/w1/test`);
    expect(post.request.body).toEqual({ recordId: record1.id });
    post.flush({ success: true, data: trace, message: null, error: null });
    fixture.detectChanges();
    tick();

    expect(component.testTrace()?.recordId).toBe(record1.id);
    const rows = fixture.debugElement.queryAll(By.css('.wf-trace-row'));
    expect(rows.length).toBe(4);
    expect(fixture.debugElement.query(By.css('.wf-trace-row[data-verdict="would_run"] i.fa-check'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.wf-trace-row[data-verdict="skipped"] i.fa-forward'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.wf-trace-row[data-verdict="would_fail"] i.fa-xmark'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.wf-trace-row[data-verdict="would_suspend"] i.fa-pause'))).not.toBeNull();
    // Détail en sous-ligne, valeurs rendues repliées, avertissements et bandeau de simulation.
    expect(fixture.debugElement.query(By.css('.wf-trace-detail'))?.nativeElement.textContent).toContain('match = all');
    expect(fixture.debugElement.query(By.css('.wf-trace-rendered pre'))?.nativeElement.textContent).toContain('"passed": true');
    expect(fixture.debugElement.queryAll(By.css('[data-testid="wf-test-warnings"] li')).length).toBe(1);
    expect(fixture.debugElement.query(By.css('[data-testid="wf-test-summary"]'))?.nativeElement.textContent).toContain('3');

    // Invariant R17 : la simulation n'émet AUCUNE écriture (instances, cancel, approve, PUT/DELETE…).
    httpMock.expectNone(r => (r.method === 'POST' || r.method === 'PUT' || r.method === 'DELETE') && !r.url.endsWith('/test'));
  }));

  // 4.7★2 (S12) : le détail et les valeurs rendues viennent du serveur (données d'enregistrement interpolées) —
  // ils doivent rester du texte (interpolation Angular), jamais du HTML interprété.
  it('échappe le HTML contenu dans le détail et les valeurs rendues de la trace (aucun élément injecté)', fakeAsync(() => {
    const hostile = '<img src=x onerror="alert(1)"><b>gras</b>';
    const hostileTrace: WorkflowTestResultDto = {
      ...trace, evaluatedSteps: 1, suspended: false, warnings: [`Avertissement ${hostile}`],
      steps: [{ key: 'notifie', type: 'notify', label: `Étape ${hostile}`, verdict: 'would_run',
        detail: `Notification « ${hostile} »`, rendered: { title: hostile, body: `<script>alert(2)</script>` } }]
    };
    component.open();
    flushRecords([record1]);
    component.pickTestRecord(record1);
    component.runTest();
    httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/workflows/w1/test`)
      .flush({ success: true, data: hostileTrace, message: null, error: null });
    fixture.detectChanges();
    tick();

    const dialog = fixture.debugElement.query(By.css('[data-testid="wf-test-trace"]')).nativeElement as HTMLElement;
    expect(dialog.querySelectorAll('img, b, script').length).toBe(0);
    expect(fixture.debugElement.query(By.css('.wf-trace-detail')).nativeElement.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(fixture.debugElement.query(By.css('.wf-trace-rendered pre')).nativeElement.textContent).toContain('<script>alert(2)</script>');
    const warnings = fixture.debugElement.query(By.css('[data-testid="wf-test-warnings"]')).nativeElement as HTMLElement;
    expect(warnings.querySelectorAll('img, b').length).toBe(0);
    expect(warnings.textContent).toContain('<b>gras</b>');
  }));

  it('affiche l\u2019erreur 404 inline quand l\u2019enregistrement a disparu', fakeAsync(() => {
    component.open();
    flushRecords([record1]);
    component.pickTestRecord(record1);
    component.runTest();

    httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/workflows/w1/test`)
      .flush({ success: false, data: null, error: 'Enregistrement introuvable.', message: null }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    tick();

    expect(component.testTrace()).toBeNull();
    expect(component.testError()).toBe('Enregistrement introuvable.');
    const inline = fixture.debugElement.query(By.css('[data-testid="wf-test-error"]'));
    expect(inline).not.toBeNull();
    expect(inline.nativeElement.textContent).toContain('Enregistrement introuvable.');
  }));
});
