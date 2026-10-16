import { ChangeDetectionStrategy, Component, ElementRef, effect, input, model, output, viewChild } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DynamicReportComponent } from '@shared/studio-runtime/dynamic-report.component';
import { StudioReportFailureEvent, StudioReportSuggestion } from '../../studio-ai-build.service';
import { StudioFailureView, classifyStudioFailure } from '../../studio-ai-failure.util';
import { StudioAiTimelineItem } from '../studio-ai-session.store';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';

/**
 * Fil de conversation repliable de l'atelier (plan P1 §4.4).
 *
 * Les trois rendus de la page legacy sont conservés à l'identique — bulle de texte, tableau d'état
 * (`DynamicReportComponent`) et carte d'échec classée par `classifyStudioFailure` : un résultat
 * reste attaché à la question qui l'a produit, et la lecture d'un échec (précision nécessaire,
 * refus, fournisseur indisponible…) ne régresse pas vers un message serveur brut.
 *
 * Aucun store injecté : la page passe les signaux et reçoit les intentions (`retry`, prompts).
 */
@Component({
  selector: 'app-studio-ai-conversation',
  standalone: true,
  imports: [ButtonModule, DynamicReportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="saic">
      <header class="saic__head">
        <h4 class="saic__title">
          <i class="fa-solid fa-comments" aria-hidden="true"></i> {{ labels.conversation.title }}
          @if (items().length) { <span class="saic__count">{{ items().length }}</span> }
        </h4>
        <button
          type="button"
          class="saic__toggle"
          [attr.aria-expanded]="!collapsed()"
          (click)="collapsed.set(!collapsed())">
          {{ collapsed() ? labels.conversation.show : labels.conversation.hide }}
        </button>
      </header>

      @if (!collapsed()) {
        <div #scroller class="saic__body">
          @for (item of items(); track $index) {
            @if (item.kind === 'text' || item.kind === 'system') {
              <div
                class="saic__bubble"
                [attr.data-timeline-index]="$index"
                [class.saic__bubble--user]="item.role === 'user'"
                [class.saic__bubble--system]="item.kind === 'system'">
                @if (item.kind === 'text') {
                  <span class="saic__author">{{ item.role === 'user' ? labels.conversation.you : labels.conversation.assistant }}</span>
                }
                <p class="saic__text">{{ item.text }}</p>
              </div>
            }

            @if (item.report; as report) {
              <div class="saic__report" [attr.data-timeline-index]="$index">
                <div class="saic__report-head">
                  <h5 class="saic__report-title">{{ report.title }}</h5>
                  <button
                    pButton
                    type="button"
                    class="p-button-sm p-button-outlined"
                    icon="fa-solid fa-floppy-disk"
                    [label]="labels.conversation.saveReport"
                    [disabled]="busy()"
                    (click)="saveReport(report.title)"></button>
                </div>
                @for (warning of report.warnings; track warning) {
                  <p class="saic__warning"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{ warning }}</p>
                }
                <app-dynamic-report [result]="report.result" [exportName]="report.title" />
              </div>
            }

            @if (item.failure; as failure) {
              @let view = failureView(failure);
              <div class="saic__failure" [attr.data-timeline-index]="$index">
                <p class="saic__failure-eyebrow">{{ view.eyebrow }}</p>
                <h5 class="saic__failure-title">{{ view.title }}</h5>
                <p class="saic__text">{{ view.message }}</p>
                <p class="saic__hint">{{ view.hint }}</p>
                @if (view.showSuggestions && failure.suggestions.length) {
                  <div class="saic__chips">
                    @for (suggestion of failure.suggestions; track suggestion.preset) {
                      <button type="button" class="saic__chip" [disabled]="busy()" (click)="pickSuggestion(suggestion)">
                        {{ suggestion.label }}
                      </button>
                    }
                  </div>
                }
                @if (view.retryable) {
                  <button
                    pButton
                    type="button"
                    class="p-button-sm p-button-outlined saic__retry"
                    icon="fa-solid fa-rotate-right"
                    [label]="labels.conversation.retry"
                    [disabled]="busy() || !lastPrompt()"
                    (click)="retry.emit()"></button>
                }
              </div>
            }
          }

          @if (suggestions().length) {
            <p class="saic__chips-title">{{ labels.conversation.suggestions }}</p>
            <div class="saic__chips">
              @for (prompt of suggestions(); track prompt) {
                <button type="button" class="saic__chip" [disabled]="busy()" (click)="usePrompt.emit(prompt)">{{ prompt }}</button>
              }
            </div>
          }

          @if (busy()) {
            <p class="saic__status" role="status" aria-live="polite">
              <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
              {{ status() || labels.conversation.preparing }}
            </p>
          }

          @if (error(); as message) {
            <p class="saic__error" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{ message }}</p>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .saic {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-lg);
      background: var(--color-background-elevated, #fff);
    }
    .saic__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-3);
      padding: var(--spacing-3);
    }
    .saic__title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-700);
    }
    .saic__count {
      font-size: 0.6875rem;
      padding: 0 var(--spacing-2);
      border-radius: 999px;
      background: var(--color-neutral-100, #f1f5f9);
      color: var(--color-neutral-500);
    }
    .saic__toggle {
      border: none;
      background: none;
      padding: 0;
      cursor: pointer;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-primary-600);
    }
    .saic__body {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      max-height: 26rem;
      overflow-y: auto;
      padding: 0 var(--spacing-3) var(--spacing-3);
    }
    .saic__bubble {
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md, 8px);
      background: var(--color-neutral-50, #f8fafc);
    }
    .saic__bubble--user { background: var(--color-primary-50, #eef2ff); }
    .saic__bubble--system { background: transparent; font-style: italic; }
    .saic__author {
      display: block;
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-neutral-500);
    }
    .saic__text, .saic__hint, .saic__status, .saic__warning, .saic__error, .saic__chips-title {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
      white-space: pre-wrap;
    }
    .saic__hint, .saic__status, .saic__chips-title { color: var(--color-neutral-500); }
    .saic__error { color: var(--color-danger-600, #dc2626); }
    .saic__warning { color: var(--color-warning-700, #b45309); }
    .saic__report, .saic__failure {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-3);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-md, 8px);
    }
    .saic__failure { border-color: var(--color-danger-200, #fecaca); background: var(--color-danger-50, #fef2f2); }
    .saic__report-head { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-3); }
    .saic__report-title, .saic__failure-title {
      margin: 0;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800, #1e293b);
    }
    .saic__failure-eyebrow {
      margin: 0;
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-danger-600, #dc2626);
    }
    .saic__chips { display: flex; flex-wrap: wrap; gap: var(--spacing-2); }
    .saic__chip {
      padding: 2px var(--spacing-3);
      border-radius: 999px;
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-elevated, #fff);
      cursor: pointer;
      font-size: var(--font-size-sm);
      color: var(--color-primary-600);
    }
    .saic__chip:disabled { cursor: not-allowed; opacity: 0.6; }
    .saic__retry { align-self: flex-start; }
  `]
})
export class StudioAiConversationComponent {
  readonly items = input<StudioAiTimelineItem[]>([]);
  readonly suggestions = input<string[]>([]);
  readonly status = input('');
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  /** Dernière demande envoyée : sans elle, « Réessayer » n'a rien à rejouer. */
  readonly lastPrompt = input('');
  /** Replié par défaut quand un plan est affiché ; la page pilote l'état (deux-sens). */
  readonly collapsed = model(false);

  readonly retry = output<void>();
  /** Reformulation issue d'une carte d'échec (le prompt prêt à envoyer). */
  readonly useSuggestion = output<string>();
  /** Puce `suggested_prompts` ou « Enregistrer comme état ». */
  readonly usePrompt = output<string>();

  protected readonly labels = STUDIO_AI_LABELS;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // Le DOM du nouvel élément existe à la micro-tâche suivante. On aligne alors la dernière
    // question en haut du fil : caler sur scrollHeight montrait la fin du tableau, et
    // scrollIntoView ferait défiler la page entière.
    effect(() => {
      this.items();
      const el = this.scroller()?.nativeElement;
      if (!el) return;
      queueMicrotask(() => this.anchorToLatestQuestion(el));
    });
  }

  /** Défilement limité à `.saic__body` : la dernière bulle utilisateur, sinon le dernier élément. */
  private anchorToLatestQuestion(el: HTMLElement): void {
    if (!el.isConnected) return;
    const nodes = el.querySelectorAll<HTMLElement>('[data-timeline-index]');
    if (!nodes.length) return;
    let target = nodes[nodes.length - 1];
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].classList.contains('saic__bubble--user')) {
        target = nodes[i];
        break;
      }
    }
    el.scrollTop = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  }

  /**
   * Lecture « métier » d'un échec, déléguée à `classifyStudioFailure` (comportement legacy) : le
   * titre, la prochaine étape, la présence de « Réessayer » et des suggestions dépendent de la
   * catégorie plutôt que d'un texte unique.
   */
  protected failureView(failure: StudioReportFailureEvent): StudioFailureView {
    return classifyStudioFailure({
      message: failure.message,
      code: failure.code,
      stage: failure.stage,
      retryable: failure.retryable,
      fromReportTool: true
    });
  }

  protected pickSuggestion(suggestion: StudioReportSuggestion): void {
    this.useSuggestion.emit(suggestion.prompt);
  }

  /** « Enregistrer comme état » repasse par l'assistant (aucune écriture directe depuis le client). */
  protected saveReport(title: string): void {
    this.usePrompt.emit(formatLabel(STUDIO_AI_LABELS.conversation.saveReportPrompt, { title }));
  }
}
