import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { StudioPlanSummary } from '../../studio-ai-build.service';
import { StudioAiNavAction } from '../studio-ai-session.store';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import {
  StudioAppBuildResult, StudioBuildResult, StudioSpecCounters, StudioSystemBuildResult, StudioWorkflowBuildResult,
  isSystemBuildResult, isWorkflowBuildResult
} from '../studio-ai.models';

/**
 * Carte de résultat après intégration (plan P1 §8.4, capture 2776).
 *
 * Deux formes de résultat coexistent : un plan `CreateSystem` renvoie un système et ses entités,
 * un plan `CreateApp` une seule table. On branche sur `isSystemBuildResult` plutôt que sur le
 * `kind` du plan : c'est le payload réellement reçu qui décide de ce qu'on peut ouvrir.
 * Un plan `Workflow` (4.3f1) renvoie `workflows[]` (créés inactifs) : puces + note, bouton
 * principal « Ouvrir le workflow » vers `/studio/workflows/{workflows[0].id}` (D-44-72/73).
 *
 * Le composant n'ouvre rien lui-même (aucun `Router` injecté) : il émet l'URL et la page navigue.
 */
@Component({
  selector: 'app-studio-ai-result-card',
  standalone: true,
  imports: [ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sair" [class.sair--failed]="failed()">
      <header class="sair__head">
        <i class="sair__icon" [class]="failed() ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-check'" aria-hidden="true"></i>
        <div>
          <h4 class="sair__title">{{ title() }}</h4>
          @if (subtitle(); as sub) { <p class="sair__meta">{{ sub }}</p> }
        </div>
      </header>

      @if (counters(); as c) {
        @if (!workflowResult()) {
          <ul class="sair__counters" [attr.aria-label]="labels.result.counters">
            <li>{{ c.entities }} {{ labels.preview.tables }}</li>
            <li>{{ c.fields }} {{ labels.preview.fields }}</li>
            <li>{{ c.relations }} {{ labels.preview.relations }}</li>
            <li>{{ c.forms }} {{ labels.preview.forms }}</li>
            <li>{{ c.reports }} {{ labels.preview.reports }}</li>
            <li>{{ c.views }} {{ labels.result.views }}</li>
            <li>{{ c.seedRecords }} {{ labels.preview.seedRecords }}</li>
            <li>{{ c.workflows }} {{ labels.result.workflows }}</li>
          </ul>
        }
      }

      @if (workflowResult(); as wf) {
        <ul class="sair__chips" data-testid="sair-workflows">
          @for (w of wf.workflows; track w.id) {
            <li class="sair__chip"><i class="fa-solid fa-route" aria-hidden="true"></i> {{ w.name }} <span class="sai-code">{{ w.key }}</span></li>
          }
        </ul>
        <p class="sair__note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> {{ labels.result.workflowsInactiveHint }}</p>
      }

      @if (entities().length) {
        <ul class="sair__entities">
          @for (entity of entities(); track entity.entityKey) {
            <li class="sair__chip">
              <span class="sair__chip-name">{{ entity.displayName }}</span>
              @if (entity.openUrl) {
                <button type="button" class="sair__chip-link" (click)="open.emit(entity.openUrl)">
                  {{ labels.result.open }}
                </button>
              }
            </li>
          }
        </ul>
      }

      @if (warnings().length) {
        <div class="sair__warnings">
          <p class="sair__warnings-title">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{ labels.result.vigilance }}
          </p>
          <ul>
            @for (warning of warnings(); track warning) { <li>{{ warning }}</li> }
          </ul>
        </div>
      }

      <div class="sair__actions">
        @if (primaryUrl(); as url) {
          <button
            pButton
            type="button"
            class="p-button-sm sair__open"
            icon="fa-solid fa-arrow-up-right-from-square"
            [label]="primaryLabel()"
            (click)="open.emit(url)"></button>
        }
        @if (exportKey(); as key) {
          <button
            pButton
            type="button"
            class="p-button-sm p-button-outlined"
            icon="fa-solid fa-file-export"
            data-action="export"
            [label]="labels.result.exportJson"
            (click)="exportSystem.emit(key)"></button>
          <button
            pButton
            type="button"
            class="p-button-sm p-button-outlined"
            icon="fa-solid fa-copy"
            data-action="duplicate"
            [label]="labels.result.duplicate"
            (click)="duplicate.emit(key)"></button>
        }
        @if (replayable()) {
          <button
            pButton
            type="button"
            class="p-button-sm p-button-outlined"
            icon="fa-solid fa-rotate-right"
            data-action="replay"
            [label]="labels.result.replay"
            (click)="replay.emit()"></button>
        }
        @for (action of actions(); track action.route) {
          <button
            pButton
            type="button"
            class="p-button-sm p-button-outlined"
            icon="fa-solid fa-arrow-right"
            [label]="action.label"
            (click)="navigate.emit(action)"></button>
        }
        <button
          pButton
          type="button"
          class="p-button-sm p-button-text sair__new"
          icon="fa-solid fa-plus"
          [label]="labels.result.newRequest"
          (click)="newRequest.emit()"></button>
      </div>
    </section>
  `,
  styles: [`
    .sair {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      border: 1px solid var(--color-success-200, #bbf7d0);
      border-radius: var(--radius-lg);
      background: var(--color-success-50, #f0fdf4);
    }
    .sair--failed { border-color: var(--color-danger-200, #fecaca); background: var(--color-danger-50, #fef2f2); }
    .sair__head { display: flex; gap: var(--spacing-3); align-items: flex-start; }
    .sair__icon { color: var(--color-success-600, #16a34a); font-size: 1.25rem; }
    .sair--failed .sair__icon { color: var(--color-danger-600, #dc2626); }
    .sair__title {
      margin: 0;
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800, #1e293b);
    }
    .sair__meta { margin: 2px 0 0; font-size: var(--font-size-sm); color: var(--color-neutral-500); }
    .sair__counters {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: var(--spacing-1) var(--spacing-3);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
    }
    .sair__counters li::before { content: '✓ '; color: var(--color-success-600, #16a34a); }
    .sair__entities { display: flex; flex-wrap: wrap; gap: var(--spacing-2); margin: 0; padding: 0; list-style: none; }
    .sair__chips { display: flex; flex-wrap: wrap; gap: var(--spacing-2); margin: 0; padding: 0; list-style: none; }
    .sair__note { margin: 0; font-size: var(--font-size-sm); color: var(--color-neutral-600); }
    .sai-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--font-size-xs, 0.75rem); color: var(--color-neutral-700, #374151); }
    .sair__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: 2px var(--spacing-3);
      border-radius: 999px;
      background: var(--color-background-elevated, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      font-size: var(--font-size-sm);
    }
    .sair__chip-name { font-weight: var(--font-weight-medium); color: var(--color-neutral-700); }
    .sair__chip-link {
      border: none;
      background: none;
      padding: 0;
      cursor: pointer;
      color: var(--color-primary-600);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
    }
    .sair__warnings { font-size: var(--font-size-sm); color: var(--color-warning-700, #b45309); }
    .sair__warnings-title { margin: 0 0 var(--spacing-2); font-weight: var(--font-weight-semibold); }
    .sair__warnings ul { margin: 0; padding-left: var(--spacing-4); display: flex; flex-direction: column; gap: 2px; }
    .sair__actions { display: flex; flex-wrap: wrap; gap: var(--spacing-2); }
  `]
})
export class StudioAiResultCardComponent {
  readonly result = input<StudioBuildResult | null>(null);
  /** Liens proposés par l'assistant (`client_actions`) rendus à côté du bouton principal. */
  readonly actions = input<StudioAiNavAction[]>([]);
  /** Compteurs de la spec appliquée (8 puces) ; `null` ⇒ aucune puce. */
  readonly counters = input<StudioSpecCounters | null>(null);
  /** Résumé du plan (k1) : libellés de table des workflows créés (`entityDisplayName`, D-44-73). */
  readonly summary = input<StudioPlanSummary | null>(null);
  /** Export/duplication : fail-closed sur le flag `systemExportEnabled` (fourni par la page). */
  readonly exportEnabled = input(false);
  readonly replayable = input(false);

  /** URL à ouvrir (système, table ou entité) — la page navigue. */
  readonly open = output<string>();
  readonly navigate = output<StudioAiNavAction>();
  readonly newRequest = output<void>();
  /** Clé du système créé — la page ouvre le dialog Exporter / Dupliquer. */
  readonly exportSystem = output<string>();
  readonly duplicate = output<string>();
  readonly replay = output<void>();

  protected readonly labels = STUDIO_AI_LABELS;

  private readonly systemResult = computed<StudioSystemBuildResult | null>(() => {
    const result = this.result();
    return isSystemBuildResult(result) ? result : null;
  });
  private readonly appResult = computed<StudioAppBuildResult | null>(() => {
    const result = this.result();
    return result && !isSystemBuildResult(result) && !isWorkflowBuildResult(result) ? result : null;
  });
  protected readonly workflowResult = computed<StudioWorkflowBuildResult | null>(() => {
    const result = this.result();
    return isWorkflowBuildResult(result) ? result : null;
  });

  /** Un résultat système explicitement `success=false` est rendu en carte rouge (§8.6). */
  protected readonly failed = computed(() => this.systemResult()?.success === false);

  protected readonly title = computed(() => {
    const system = this.systemResult();
    if (system) return formatLabel(STUDIO_AI_LABELS.result.systemCreated, { name: system.displayName });
    const wf = this.workflowResult();
    if (wf) {
      return wf.workflows.length === 1
        ? formatLabel(STUDIO_AI_LABELS.result.workflowCreated, { name: wf.workflows[0].name })
        : formatLabel(STUDIO_AI_LABELS.result.workflowsCreated, { count: String(wf.workflows.length) });
    }
    const app = this.appResult();
    if (app) return formatLabel(STUDIO_AI_LABELS.result.tableCreated, { name: app.displayName });
    return '';
  });

  /** Ligne de compteurs : étapes terminées et nombre de tables (capture 2776). */
  protected readonly subtitle = computed(() => {
    const system = this.systemResult();
    if (system) {
      const steps = system.buildSteps?.length ?? 0;
      const parts = [`${system.entityCount} ${STUDIO_AI_LABELS.preview.tables}`];
      if (steps) parts.unshift(`${steps} ${STUDIO_AI_LABELS.result.stepsDone}`);
      return parts.join(' · ');
    }
    const wf = this.workflowResult();
    if (wf) {
      if (wf.workflows.length !== 1) {
        const total = wf.workflows.reduce((sum, w) => sum + w.stepCount, 0);
        return `${total} ${STUDIO_AI_LABELS.result.steps}`;
      }
      const w = wf.workflows[0];
      return `${w.stepCount} ${STUDIO_AI_LABELS.result.steps} · ${this.entityLabel(w.entityKey)}`;
    }
    const app = this.appResult();
    if (!app) return '';
    const fields = app.fieldsCreated ?? 0;
    return fields ? `${fields} ${STUDIO_AI_LABELS.preview.fields}` : app.message;
  });

  /**
   * Libellé de la table cible d'un workflow créé (D-44-73) : le résultat 4.3f1 ne porte que la
   * clé — le libellé est lu dans `summary.workflows[]`/`summary.entities[]` (k1), repli sur la clé.
   */
  private entityLabel(key: string): string {
    const summary = this.summary();
    return summary?.workflows?.find(w => w.entityKey === key)?.entityDisplayName
      ?? summary?.entities?.[0]?.displayName
      ?? key;
  }

  /** Clé exportable : flag actif ET résultat système avec clé (fail-closed). */
  protected readonly exportKey = computed(() => (this.exportEnabled() && this.systemResult()?.systemKey) || null);

  protected readonly entities = computed(() => this.systemResult()?.entities ?? []);
  protected readonly warnings = computed(() => this.result()?.warnings ?? []);

  protected readonly primaryUrl = computed(() => {
    const first = this.workflowResult()?.workflows[0];
    return this.systemResult()?.systemUrl ?? this.appResult()?.openUrl ?? (first ? `/studio/workflows/${first.id}` : '');
  });
  protected readonly primaryLabel = computed(() =>
    this.workflowResult()
      ? STUDIO_AI_LABELS.result.openWorkflow
      : this.systemResult() ? STUDIO_AI_LABELS.result.openSystem : STUDIO_AI_LABELS.result.openTable
  );
}
