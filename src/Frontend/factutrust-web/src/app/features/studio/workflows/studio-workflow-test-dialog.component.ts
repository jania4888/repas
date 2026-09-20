import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { StudioService } from '../studio.service';
import { CustomRecord } from '../studio.models';
import { STUDIO_WORKFLOW_LABELS } from './studio-workflow-labels';
import { workflowErrorMessage } from './studio-workflow-http.util';
import { WORKFLOW_TEST_VERDICTS, WorkflowTestResultDto } from './studio-workflows.models';
import { StudioWorkflowsService } from './studio-workflows.service';

/**
 * Dialogue « Tester sur un enregistrement » du concepteur de workflow (4.7c2, R17) — simulation pure
 * (route 4.7c1 `POST /workflows/{id}/test`), aucune écriture serveur. Extrait du concepteur en 4.7★3
 * (D-47-80) sans changement de comportement : gabarit, `data-testid`, libellés (`L.test.*`) et
 * classes CSS identiques ; le concepteur l'ouvre via `open()` (bouton `wf-test`).
 *
 * Entrées : `workflowId` (workflow enregistré — le bouton du concepteur est désactivé en création),
 * `entityKey` (table du workflow, porte la recherche) et `fields` (schéma normalisé — le premier
 * champ texte actif sert de libellé, D-44-24).
 */
@Component({
  selector: 'app-studio-workflow-test-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule, InputTextModule, MessageModule],
  template: `
    <p-dialog [header]="L.test.dialogTitle" [(visible)]="visible" [modal]="true"
      [style]="{ width: '42rem' }" styleClass="studio-theme" data-testid="wf-test-dialog">
      <p-message severity="info" [text]="L.test.banner" styleClass="wf-test-banner" data-testid="wf-test-banner" />
      <div class="wf-test-picker">
        <input pInputText type="text" class="wf-test-search" [ngModel]="testSearch()" (ngModelChange)="onTestSearch($event)"
          [placeholder]="L.test.searchPlaceholder" data-testid="wf-test-search" />
        @if (testSearching()) { <span class="wf-test-hint">{{ L.test.searching }}</span> }
      </div>
      <ul class="wf-test-records" data-testid="wf-test-records">
        @for (r of testRecords(); track r.id) {
          <li>
            <button type="button" class="wf-test-record" [class.wf-test-record--selected]="testRecord()?.id === r.id"
              (click)="pickTestRecord(r)">
              <span class="wf-test-record-label">{{ testRecordLabel(r) }}</span>
              <small class="wf-test-record-id" [title]="r.id">{{ shortRecordId(r.id) }}</small>
            </button>
          </li>
        } @empty {
          @if (!testSearching()) { <li class="wf-test-hint" data-testid="wf-test-empty">{{ L.test.noRecords }}</li> }
        }
      </ul>
      <button pButton type="button" icon="fa-solid fa-play" [label]="L.test.run" data-testid="wf-test-run"
        [loading]="testRunning()" [disabled]="!testRecord() || testRunning()" (click)="runTest()"></button>
      @if (testError()) {
        <p-message severity="error" [text]="testError()!" styleClass="wf-test-msg" data-testid="wf-test-error" />
      }
      @if (testTrace(); as trace) {
        <div class="wf-test-trace" data-testid="wf-test-trace">
          @if (trace.warnings.length) {
            <ul class="wf-test-warnings" data-testid="wf-test-warnings">
              @for (w of trace.warnings; track w) { <li><i class="fa-solid fa-triangle-exclamation"></i> {{ w }}</li> }
            </ul>
          }
          <ol class="wf-trace">
            @for (step of trace.steps; track $index) {
              <li class="wf-trace-row wf-trace-row--{{ testVerdictClass(step.verdict) }}" [attr.data-verdict]="step.verdict">
                <i [class]="testVerdictIcon(step.verdict)"></i>
                <span class="wf-trace-name">{{ step.label ?? step.key }} <small>({{ step.type }})</small></span>
                <span class="wf-trace-verdict">{{ testVerdictLabel(step.verdict) }}</span>
                @if (step.detail) { <div class="wf-trace-detail">{{ step.detail }}</div> }
                @if (step.rendered) {
                  <details class="wf-trace-rendered"><summary>{{ L.test.rendered }}</summary><pre>{{ step.rendered | json }}</pre></details>
                }
              </li>
            }
          </ol>
          <div class="wf-trace-summary" data-testid="wf-test-summary">
            {{ trace.evaluatedSteps }} {{ L.test.evaluatedSuffix }}
            @if (trace.suspended) { — {{ L.test.suspendedSuffix }} }
          </div>
        </div>
      }
    </p-dialog>
  `,
  styleUrl: './studio-workflow-test-dialog.scss'
})
export class StudioWorkflowTestDialogComponent {
  private readonly studio = inject(StudioService);
  private readonly workflowsSvc = inject(StudioWorkflowsService);

  protected readonly L = STUDIO_WORKFLOW_LABELS;

  /** Workflow enregistré à simuler (`null` en création : `runTest()` est alors inerte). */
  readonly workflowId = input.required<string | null>();
  /** Clé de la table du workflow (`null` tant que le schéma n'est pas chargé : recherche inerte). */
  readonly entityKey = input.required<string | null>();
  /** Champs du schéma, fieldType normalisé (D-44-14). */
  readonly fields = input.required<CustomField[]>();

  /** Recherche anti-rebond 300 ms (D-44-86) — branchée dans le constructeur. */
  private readonly testSearchQuery$ = new Subject<string>();

  readonly visible = signal(false);
  readonly testSearch = signal('');
  readonly testSearching = signal(false);
  readonly testRecords = signal<CustomRecord[]>([]);
  readonly testRecord = signal<CustomRecord | null>(null);
  readonly testRunning = signal(false);
  readonly testTrace = signal<WorkflowTestResultDto | null>(null);
  readonly testError = signal<string | null>(null);

  constructor() {
    this.testSearchQuery$.pipe(debounceTime(300), takeUntilDestroyed()).subscribe(q => this.searchTestRecords(q));
  }

  /** Ouvre le dialogue : sélection et résultat précédents oubliés, recherche relancée avec le texte courant. */
  open(): void {
    this.visible.set(true);
    this.testRecord.set(null);
    this.testTrace.set(null);
    this.testError.set(null);
    this.searchTestRecords(this.testSearch().trim());
  }

  onTestSearch(value: string): void {
    this.testSearch.set(value);
    this.testSearchQuery$.next(value.trim());
  }

  pickTestRecord(record: CustomRecord): void {
    this.testRecord.set(record);
    this.testTrace.set(null);
    this.testError.set(null);
  }

  runTest(): void {
    const id = this.workflowId();
    const record = this.testRecord();
    if (!id || !record || this.testRunning()) return;
    this.testRunning.set(true);
    this.testTrace.set(null);
    this.testError.set(null);
    this.workflowsSvc.testWorkflow(id, record.id).subscribe({
      next: res => { this.testRunning.set(false); this.testTrace.set(res.data ?? null); },
      error: err => { this.testRunning.set(false); this.testError.set(workflowErrorMessage(err) || this.L.test.error); }
    });
  }

  /** Libellé d'un enregistrement candidat : premier champ texte actif renseigné, sinon identifiant tronqué (D-44-24). */
  testRecordLabel(record: CustomRecord): string {
    const titleKey = this.fields().find(f => f.isActive && f.fieldType === CustomFieldType.Text)?.key;
    const value = titleKey && record.data ? record.data[titleKey] : null;
    if (typeof value === 'string' && value.trim()) return value;
    return this.shortRecordId(record.id);
  }

  shortRecordId(id: string): string { return id.length > 8 ? id.slice(0, 8) + '…' : id; }

  testVerdictIcon(verdict: string): string {
    switch (verdict) {
      case WORKFLOW_TEST_VERDICTS.wouldRun: return 'fa-solid fa-check';
      case WORKFLOW_TEST_VERDICTS.skipped: return 'fa-solid fa-forward';
      case WORKFLOW_TEST_VERDICTS.wouldSuspend: return 'fa-solid fa-pause';
      default: return 'fa-solid fa-xmark';
    }
  }

  testVerdictClass(verdict: string): string {
    switch (verdict) {
      case WORKFLOW_TEST_VERDICTS.wouldRun: return 'run';
      case WORKFLOW_TEST_VERDICTS.skipped: return 'skip';
      case WORKFLOW_TEST_VERDICTS.wouldSuspend: return 'suspend';
      default: return 'fail';
    }
  }

  testVerdictLabel(verdict: string): string {
    const v = this.L.test.verdicts;
    switch (verdict) {
      case WORKFLOW_TEST_VERDICTS.wouldRun: return v.wouldRun;
      case WORKFLOW_TEST_VERDICTS.skipped: return v.skipped;
      case WORKFLOW_TEST_VERDICTS.wouldSuspend: return v.wouldSuspend;
      default: return v.wouldFail;
    }
  }

  private searchTestRecords(query: string): void {
    const entityKey = this.entityKey();
    if (!entityKey) return;
    this.testSearching.set(true);
    this.studio.listRecords(entityKey, query || null, 1, 10).subscribe({
      next: res => { this.testSearching.set(false); this.testRecords.set(res.data?.items ?? []); },
      error: () => { this.testSearching.set(false); this.testRecords.set([]); }
    });
  }
}
