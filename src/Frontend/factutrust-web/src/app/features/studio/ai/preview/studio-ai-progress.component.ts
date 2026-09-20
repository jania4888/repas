import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioBuildStep } from '../studio-ai.models';

/**
 * Timeline verticale de l'intégration (plan P1 §8.3, capture 2775).
 *
 * Les étapes arrivent au fil du flux SSE : `N` est donc le nombre d'étapes DÉJÀ connues, pas un
 * total théorique — c'est volontaire, le serveur seul sait combien d'étapes il produira.
 * La zone `aria-live="polite"` annonce l'étape en cours aux lecteurs d'écran, avec le rappel
 * « Ne fermez pas cette page. ».
 */
@Component({
  selector: 'app-studio-ai-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="saip">
      <header class="saip__head">
        <h4 class="saip__title"><i class="fa-solid fa-hammer" aria-hidden="true"></i> {{ labels.progress.title }}</h4>
        <span class="saip__count">{{ doneCount() }} / {{ total() }}</span>
        @if (viewSteps().length > 0) {
          <span class="saip__chip" data-phase="views">{{ labels.progress.views }} {{ viewsDone() }}/{{ viewSteps().length }}</span>
        }
      </header>

      <div class="saip__bar" role="progressbar" [attr.aria-valuenow]="doneCount()" aria-valuemin="0" [attr.aria-valuemax]="total()">
        <span class="saip__bar-fill" [style.width.%]="percent()"></span>
      </div>

      <ol class="saip__steps">
        @for (step of steps(); track step.phase + step.label; let i = $index) {
          <li class="saip__step" [class.saip__step--running]="step.status === 'running'"
              [class.saip__step--done]="step.status === 'done'"
              [class.saip__step--error]="step.status === 'error'"
              [class.saip__step--skipped]="step.status === 'skipped'">
            <span class="saip__icon" aria-hidden="true">
              @switch (step.status) {
                @case ('running') { <i class="fa-solid fa-spinner fa-spin"></i> }
                @case ('done') { <i class="fa-solid fa-circle-check"></i> }
                @case ('error') { <i class="fa-solid fa-circle-xmark"></i> }
                @case ('skipped') { <i class="fa-solid fa-forward"></i> }
                @default { <i class="fa-regular fa-circle"></i> }
              }
            </span>
            <span class="saip__body">
              <span class="saip__label">{{ step.label }}</span>
              @if (step.detail) {
                <span class="saip__detail">{{ step.detail }}</span>
              } @else if (step.status === 'skipped') {
                <span class="saip__detail">{{ labels.progress.stepSkipped }}</span>
              }
              <span class="saip__position">{{ stepPosition(i) }}</span>
            </span>
          </li>
        }
      </ol>

      <p class="saip__live" role="status" aria-live="polite">
        <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
        @if (currentLabel(); as current) {
          <span class="saip__current">{{ labels.progress.step }} {{ current }}</span>
        }
        <span class="saip__hint">{{ labels.progress.dontClose }}</span>
      </p>
    </section>
  `,
  styles: [`
    .saip { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .saip__head { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-3); }
    .saip__title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0;
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800, #1e293b);
    }
    .saip__count { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-primary-600); }
    .saip__chip {
      padding: 1px var(--spacing-2);
      border-radius: 999px;
      background: var(--color-primary-50, #eef2ff);
      color: var(--color-primary-700, #4338ca);
      font-size: var(--font-size-xs, 0.75rem);
      font-weight: var(--font-weight-medium);
    }
    .saip__bar {
      height: 6px;
      border-radius: 999px;
      background: var(--color-neutral-100, #f1f5f9);
      overflow: hidden;
    }
    .saip__bar-fill { display: block; height: 100%; background: var(--color-primary-600); transition: width 0.3s ease; }
    .saip__steps { display: flex; flex-direction: column; gap: var(--spacing-2); margin: 0; padding: 0; list-style: none; }
    .saip__step {
      display: flex;
      gap: var(--spacing-3);
      align-items: flex-start;
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md, 8px);
      background: var(--color-neutral-50, #f8fafc);
    }
    .saip__step--done { background: var(--color-success-50, #f0fdf4); }
    .saip__step--running { background: var(--color-primary-50, #eef2ff); }
    .saip__step--error { background: var(--color-danger-50, #fef2f2); }
    .saip__step--skipped { background: var(--color-neutral-100, #f1f5f9); opacity: 0.75; }
    .saip__icon { color: var(--color-neutral-500); }
    .saip__step--done .saip__icon { color: var(--color-success-600, #16a34a); }
    .saip__step--running .saip__icon { color: var(--color-primary-600); }
    .saip__step--error .saip__icon { color: var(--color-danger-600, #dc2626); }
    .saip__step--skipped .saip__icon { color: var(--color-neutral-400, #94a3b8); }
    .saip__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .saip__label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-neutral-700); }
    .saip__detail, .saip__position, .saip__live { font-size: var(--font-size-sm); color: var(--color-neutral-500); }
    .saip__live { display: flex; flex-wrap: wrap; gap: var(--spacing-2); margin: 0; align-items: center; }
    .saip__current { font-weight: var(--font-weight-medium); color: var(--color-neutral-700); }
  `]
})
export class StudioAiProgressComponent {
  readonly steps = input<StudioBuildStep[]>([]);

  protected readonly labels = STUDIO_AI_LABELS;

  protected readonly total = computed(() => this.steps().length);
  // `skipped` (PR 2.5) compte comme terminé : la barre ne reste jamais bloquée sur une étape ignorée.
  protected readonly doneCount = computed(() => this.steps().filter(s => s.status === 'done' || s.status === 'skipped').length);
  /** Étapes de vues (`creating_views`, nom de phase émis par `StudioAiSystemOrchestrator`). */
  protected readonly viewSteps = computed(() => this.steps().filter(s => s.phase === 'creating_views'));
  protected readonly viewsDone = computed(() => this.viewSteps().filter(s => s.status === 'done' || s.status === 'skipped').length);
  protected readonly percent = computed(() => {
    const total = this.total();
    return total === 0 ? 0 : Math.round((this.doneCount() / total) * 100);
  });
  /** Étape annoncée : celle en cours, sinon la dernière reçue (fin de flux). */
  protected readonly currentLabel = computed(() => {
    const steps = this.steps();
    const running = steps.find(s => s.status === 'running');
    return (running ?? steps[steps.length - 1])?.label ?? '';
  });

  protected stepPosition(index: number): string {
    return formatLabel(STUDIO_AI_LABELS.progress.stepCount, { current: index + 1, total: this.total() });
  }
}
