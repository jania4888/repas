import { CommonModule } from '@angular/common';
import { Component, Input, NgZone, OnChanges, OnDestroy, OnInit, SimpleChanges, inject } from '@angular/core';
import {
  ActiveToolCall,
  AssistantProgressStep,
  AssistantProgressTimeline
} from '../../models/ai-chat.models';
import {
  formatDurationMs,
  getAiToolDisplayLabel,
  getAssistantProgressSummary,
  getAssistantStepMeta
} from '../../utils/assistant-progress-display';

@Component({
  selector: 'app-assistant-progress-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (showCard()) {
      <section
        class="progress-card"
        [class.streaming]="isStreaming"
        [class.compact]="isCompactMode()">
        <div
          class="progress-header"
          [class.clickable]="canToggleDetails() && !isStreaming"
          [attr.role]="canToggleDetails() && !isStreaming ? 'button' : null"
          [attr.tabindex]="canToggleDetails() && !isStreaming ? '0' : null"
          [attr.aria-expanded]="canToggleDetails() && !isStreaming ? detailsExpanded : null"
          (click)="onHeaderClick()"
          (keydown)="onHeaderKeydown($event)">
          <div class="progress-heading">
            <div class="progress-title">
              @if (isStreaming) {
                <span class="ai-typing" aria-hidden="true">
                  <span class="ai-typing-dot"></span>
                  <span class="ai-typing-dot"></span>
                  <span class="ai-typing-dot"></span>
                </span>
              }
              {{ cardTitle() }}
            </div>
            <div class="progress-subtitle">
              {{ isStreaming ? currentStatusText() : completedStatusText() }}
            </div>
          </div>

          @if (!isStreaming && canToggleDetails()) {
            <button
              type="button"
              class="toggle-btn"
              (click)="toggleDetails(); $event.stopPropagation()"
              [attr.aria-expanded]="detailsExpanded">
              <span>{{ detailsExpanded ? 'Masquer' : 'Voir le d&#233;tail' }}</span>
              <i
                class="fa-solid fa-chevron-down toggle-icon"
                [class.expanded]="detailsExpanded"
                aria-hidden="true"></i>
            </button>
          }
        </div>

        <div
          class="progress-body-shell"
          [class.expanded]="showDetails()"
          [attr.aria-hidden]="!showDetails()">
          <div class="progress-body">
            @if (showNote()) {
              <div class="progress-note" i18n="@@ai-assistant.components.nous.affichons.les.grandes.233.tapes.pour.expliq.8ab532c8">Nous affichons les grandes &#233;tapes pour expliquer l'attente, sans exposer le raisonnement interne.</div>
            }

            @if (steps.length) {
              <ol class="progress-list" role="list">
                @for (step of steps; track step.key) {
                  <li
                    class="progress-step"
                    [class.running]="step.status === 'running'"
                    [class.failed]="step.status === 'failed'"
                    [class.cancelled]="step.status === 'cancelled'">
                    <span class="step-icon" aria-hidden="true">
                      @if (step.status === 'running') {
                        <i class="fa-solid fa-spinner fa-spin"></i>
                      } @else if (step.status === 'failed') {
                        <i class="fa-solid fa-circle-exclamation"></i>
                      } @else if (step.status === 'cancelled') {
                        <i class="fa-solid fa-ban"></i>
                      } @else {
                        <i class="fa-solid fa-check"></i>
                      }
                    </span>
                    <span class="step-body">
                      <span class="step-label">{{ step.label }}</span>
                      @if (stepMeta(step); as meta) {
                        <span class="step-meta">{{ meta }}</span>
                      }
                    </span>
                  </li>
                }
              </ol>
            }

            @if (toolCalls.length) {
              <div class="tools-block">
                <div class="tools-title" i18n="@@ai-assistant.components.consultations.effectu.233.es.2202fec9">Consultations effectu&#233;es</div>
                <div class="tools-list" role="list">
                  @for (toolCall of toolCalls; track toolCall.callId) {
                    <div
                      class="tool-chip"
                      [class.running]="toolCall.status === 'running'"
                      [class.cancelled]="toolCall.status === 'cancelled'"
                      role="listitem">
                      @if (toolCall.status === 'running') {
                        <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                      } @else if (toolCall.status === 'cancelled') {
                        <i class="fa-solid fa-ban" aria-hidden="true"></i>
                      } @else {
                        <i class="fa-solid fa-check" aria-hidden="true"></i>
                      }
                      <span class="tool-chip-label">
                        <span>{{ toolLabel(toolCall.name) }}</span>
                        @if (toolCall.status === 'completed' && toolElapsed(toolCall); as elapsed) {
                          <span class="tool-chip-duration">{{ elapsed }}</span>
                        }
                      </span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </section>
    }
  `,
  styles: [`
    .progress-card {
      margin-bottom: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      background: linear-gradient(180deg, #ffffff 0%, var(--color-neutral-50, #f9fafb) 100%);
      transition:
        padding 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease,
        background 0.18s ease;
    }

    .progress-card.streaming {
      position: relative;
      overflow: hidden;
      border-color: var(--ai-accent-200, #ddd6fe);
      background: linear-gradient(180deg, #ffffff 0%, var(--ai-accent-50, #f5f3ff) 100%);
    }

    .progress-card.streaming::after {
      content: '';
      position: absolute;
      left: 0;
      bottom: 0;
      height: 2px;
      width: 40%;
      background: var(--ai-gradient, linear-gradient(90deg, #8b5cf6, #d946ef));
      animation: aiIndeterminate 1.4s ease-in-out infinite;
    }

    @keyframes aiIndeterminate {
      0%   { transform: translateX(-110%); }
      100% { transform: translateX(360%); }
    }

    .progress-card.streaming .progress-title {
      color: var(--ai-accent-600, #7c3aed);
    }

    .ai-typing {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      margin-right: 6px;
      vertical-align: middle;
    }

    .ai-typing-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--ai-accent-500, #8b5cf6);
      animation: aiTyping 1.4s infinite ease-in-out both;
    }

    .ai-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .ai-typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes aiTyping {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    .progress-card.compact {
      padding: 8px 10px;
      border-color: #dbe4f0;
      background: linear-gradient(180deg, #ffffff 0%, #fbfcfe 52%, #f4f8ff 100%);
      box-shadow:
        0 1px 2px rgba(15, 23, 42, 0.05),
        0 10px 24px rgba(15, 23, 42, 0.04);
    }

    .progress-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      border-radius: 10px;
      transition:
        background-color 0.18s ease,
        box-shadow 0.18s ease,
        transform 0.18s ease;
    }

    .progress-header.clickable {
      cursor: pointer;
    }

    .progress-header.clickable:hover {
      background: rgba(37, 99, 235, 0.04);
    }

    .progress-card.compact .progress-header {
      padding: 2px 4px;
      margin: -2px -4px 0;
    }

    .progress-card.compact .progress-header.clickable:hover {
      background: rgba(37, 99, 235, 0.055);
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.18);
    }

    .progress-header.clickable:focus-visible {
      outline: none;
      background: rgba(37, 99, 235, 0.05);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      transform: translateY(-1px);
    }

    .progress-card.compact .progress-header.clickable:focus-visible {
      background: rgba(37, 99, 235, 0.06);
      box-shadow:
        0 0 0 3px rgba(37, 99, 235, 0.12),
        0 8px 18px rgba(37, 99, 235, 0.08);
    }

    .progress-heading {
      min-width: 0;
    }

    .progress-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--color-neutral-900, #111827);
    }

    .progress-card.compact .progress-title {
      font-size: 12px;
      color: #0f172a;
    }

    .progress-subtitle {
      margin-top: 2px;
      font-size: 12px;
      color: var(--color-neutral-600, #4b5563);
    }

    .progress-card.compact .progress-subtitle {
      margin-top: 1px;
      color: #475569;
    }

    .progress-note {
      margin-top: 0;
      margin-bottom: 8px;
      font-size: 11px;
      color: var(--color-neutral-500, #6b7280);
    }

    .progress-body-shell {
      display: grid;
      grid-template-rows: 0fr;
      opacity: 0;
      transform: translateY(-4px);
      margin-top: 0;
      transition:
        grid-template-rows 0.22s ease,
        opacity 0.18s ease,
        transform 0.22s ease,
        margin-top 0.22s ease;
    }

    .progress-body-shell.expanded {
      grid-template-rows: 1fr;
      opacity: 1;
      transform: translateY(0);
      margin-top: 8px;
    }

    .progress-body {
      min-height: 0;
      overflow: hidden;
    }

    .toggle-btn {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--ai-accent-600, #7c3aed);
      background: var(--ai-accent-50, #f5f3ff);
      border: 1px solid var(--ai-accent-200, #ddd6fe);
      border-radius: 999px;
      cursor: pointer;
    }

    .progress-card.compact .toggle-btn {
      padding: 3px 9px;
      color: #1e40af;
      background: rgba(255, 255, 255, 0.92);
      border-color: rgba(148, 163, 184, 0.35);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    }

    .progress-card.compact .toggle-btn:hover {
      background: #fff;
      border-color: rgba(37, 99, 235, 0.24);
    }

    .toggle-icon {
      transition: transform 0.2s ease;
    }

    .toggle-icon.expanded {
      transform: rotate(180deg);
    }

    .progress-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .progress-step {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      color: var(--color-neutral-700, #374151);
    }

    .step-icon {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      flex-shrink: 0;
      margin-top: 0;
      /* État « terminé » par défaut (icône check) — pastille violette pleine */
      background: var(--ai-accent-500, #8b5cf6);
      border: 2px solid var(--ai-accent-500, #8b5cf6);
      color: #fff;
    }

    .progress-step.running .step-icon {
      background: #fff;
      border-color: var(--ai-accent-500, #8b5cf6);
      color: var(--ai-accent-600, #7c3aed);
    }

    .progress-step.failed .step-icon {
      background: var(--color-error-500, #ef4444);
      border-color: var(--color-error-500, #ef4444);
      color: #fff;
    }

    .progress-step.cancelled .step-icon {
      background: #fff;
      border-color: var(--color-warning-500, #f59e0b);
      color: var(--color-warning-600, #d97706);
    }

    .step-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .step-label {
      font-weight: 600;
      color: var(--color-neutral-800, #1f2937);
    }

    .step-meta {
      font-size: 11px;
      color: var(--color-neutral-500, #6b7280);
    }

    .tools-block {
      margin-top: 10px;
    }

    .tools-title {
      margin-bottom: 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-neutral-500, #6b7280);
    }

    .tools-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .tool-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      background: var(--color-neutral-100, #f3f4f6);
      color: var(--color-neutral-700, #374151);
      border: 1px solid var(--color-neutral-200, #e5e7eb);
    }

    .tool-chip.running {
      background: var(--ai-accent-50, #f5f3ff);
      color: var(--ai-accent-600, #7c3aed);
      border-color: var(--ai-accent-200, #ddd6fe);
    }

    .tool-chip.cancelled {
      color: var(--color-neutral-500, #6b7280);
      font-style: italic;
    }

    .tool-chip-label {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
    }

    .tool-chip-duration {
      font-size: 11px;
      font-weight: 400;
      color: var(--color-neutral-500, #6b7280);
    }

    @media (prefers-reduced-motion: reduce) {
      .progress-card,
      .progress-body-shell,
      .toggle-icon {
        transition: none;
      }
    }
  `]
})
export class AssistantProgressTimelineComponent implements OnChanges, OnInit, OnDestroy {
  @Input() progress?: AssistantProgressTimeline;
  @Input() toolCalls: ActiveToolCall[] = [];
  @Input() isStreaming = false;
  @Input() connectingToModel = false;

  detailsExpanded = false;

  // Chronomètre live de l'étape en cours : on n'a pas d'event "tick" du backend, donc on
  // capture localement le timestamp de bascule en running et on affiche la durée écoulée
  // jusqu'au prochain event de phase. setInterval(1s) déclenche le change detection via
  // Zone.js — pas de logique dans le callback, juste un battement.
  private readonly ngZone = inject(NgZone);
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private runningStepKey: string | null = null;
  private runningStepStartedAt: number | null = null;
  private connectingStartedAt: number | null = null;

  get steps(): AssistantProgressStep[] {
    return this.progress?.steps ?? [];
  }

  ngOnInit(): void {
    this.syncLiveTimer();
  }

  ngOnDestroy(): void {
    this.clearLiveTimer();
  }

  private syncLiveTimer(): void {
    if (this.isStreaming || this.connectingToModel) {
      if (this.timerHandle !== null) {
        return;
      }
      this.ngZone.runOutsideAngular(() => {
        this.timerHandle = setInterval(() => {
          this.ngZone.run(() => {});
        }, 1000);
      });
      return;
    }

    this.clearLiveTimer();
  }

  private clearLiveTimer(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isStreaming']) {
      if (this.isStreaming) {
        this.detailsExpanded = true;
      } else if (changes['isStreaming'].previousValue === true) {
        this.detailsExpanded = false;
      }
      this.syncLiveTimer();
    }

    if (changes['connectingToModel']) {
      if (this.connectingToModel) {
        this.connectingStartedAt = Date.now();
      } else {
        this.connectingStartedAt = null;
      }
      this.syncLiveTimer();
    }

    // Suivi du startedAt de l'étape running courante : dès qu'elle change ou disparaît,
    // on remet à zéro pour ne pas mélanger les durées.
    if (changes['progress']) {
      const currentRunning = [...this.steps].reverse().find(s => s.status === 'running');
      const newKey = currentRunning?.key ?? null;
      if (newKey !== this.runningStepKey) {
        this.runningStepKey = newKey;
        this.runningStepStartedAt = newKey ? Date.now() : null;
      }
    }
  }

  private liveElapsedMs(): number | null {
    if (this.runningStepStartedAt === null) {
      return null;
    }
    return Date.now() - this.runningStepStartedAt;
  }

  showCard(): boolean {
    return this.connectingToModel || this.steps.length > 0 || this.toolCalls.length > 0;
  }

  showDetails(): boolean {
    return this.isStreaming || this.detailsExpanded;
  }

  showNote(): boolean {
    return this.isStreaming || this.detailsExpanded;
  }

  isCompactMode(): boolean {
    return !this.isStreaming && !this.detailsExpanded;
  }

  canToggleDetails(): boolean {
    return this.steps.length + this.toolCalls.length > 0;
  }

  toggleDetails(): void {
    this.detailsExpanded = !this.detailsExpanded;
  }

  onHeaderClick(): void {
    if (!this.isStreaming && this.canToggleDetails() && !this.detailsExpanded) {
      this.detailsExpanded = true;
    }
  }

  onHeaderKeydown(event: KeyboardEvent): void {
    if (!this.isStreaming && this.canToggleDetails() && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.toggleDetails();
    }
  }

  cardTitle(): string {
    if (this.isStreaming) {
      return 'Analyse en cours';
    }

    return this.detailsExpanded ? '\u00c9tapes du traitement' : 'R\u00e9ponse pr\u00eate';
  }

  currentStatusText(): string {
    const runningStep = [...this.steps].reverse().find(step => step.status === 'running');
    if (runningStep) {
      const meta = this.stepMeta(runningStep);
      const composed = meta ? `${runningStep.label} \u00b7 ${meta}` : runningStep.label;

      // Chronom\u00e8tre live : si l'\u00e9tape en cours dure plus d'une seconde, on l'affiche en mm:ss.
      const liveMs = this.liveElapsedMs();
      const liveStr = liveMs !== null && liveMs >= 1000 ? formatDurationMs(liveMs) : null;

      if (runningStep.code === 'llm_stream_round' && liveMs !== null && liveMs >= 5000) {
        const time = liveStr ? ` (${liveStr})` : '';
        return `${composed}${time} \u2014 traitement en cours, merci de patienter`;
      }

      if (runningStep.code === 'ollama_queue_wait' && liveMs !== null && liveMs >= 1000) {
        const time = liveStr ? ` (${liveStr})` : '';
        return `${composed}${time} \u2014 un autre traitement se termine`;
      }

      return liveStr ? `${composed} \u00b7 ${liveStr}` : composed;
    }
    if (this.connectingToModel) {
      const liveMs = this.connectingStartedAt !== null
        ? Date.now() - this.connectingStartedAt
        : null;
      if (liveMs !== null && liveMs >= 3000) {
        return `Chargement du mod\u00e8le local en cours (${formatDurationMs(liveMs)})`;
      }
      return "L'assistant se pr\u00e9pare";
    }
    return 'Pr\u00e9paration en cours';
  }

  completedStatusText(): string {
    return getAssistantProgressSummary(this.progress, this.toolCalls) || 'R\u00e9ponse pr\u00e9par\u00e9e';
  }

  stepMeta(step: AssistantProgressStep): string {
    return getAssistantStepMeta(step);
  }

  toolLabel(name: string): string {
    return getAiToolDisplayLabel(name);
  }

  toolElapsed(toolCall: ActiveToolCall): string {
    return formatDurationMs(toolCall.elapsedMs);
  }
}
