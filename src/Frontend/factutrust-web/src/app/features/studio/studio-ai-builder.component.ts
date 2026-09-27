import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { Textarea } from 'primeng/textarea';
import { AiStreamService } from '@features/ai-assistant/services/ai-stream.service';
import { AssistantMode, ChatRequest, ChatStreamEvent } from '@features/ai-assistant/models/ai-chat.models';
import { StudioNavService } from './studio-nav.service';
import {
  StudioAiBuildService, StudioPlanEntity, StudioPlanEvent, StudioPlanSummary,
  StudioReportFailureEvent, StudioReportResultEvent, StudioReportSuggestion
} from './studio-ai-build.service';
import { DynamicReportComponent } from '@shared/studio-runtime/dynamic-report.component';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { classifyStudioFailure, StudioFailureView } from './studio-ai-failure.util';

/*
 * Page legacy de l'assistant Studio. Depuis la refonte Studio IA (P1), `/studio/ai` passe par
 * `ai/studio-ai-entry.component.ts` qui n'affiche cette page que lorsque le workbench Studio IA est
 * désactivé côté serveur (`EnableStudioAiWorkbench=false`) ou que les capacités sont indisponibles.
 * Ne pas y ajouter de fonctionnalité : l'atelier (`ai/studio-ai-page.component.ts`) est la cible.
 */

interface NavAction { label: string; route: string; }
interface BuildStep { phase: string; label: string; status: string; entityRef?: string; }

/**
 * Élément du fil de conversation. Les tableaux et les cartes d'échec en font PARTIE : tant qu'ils
 * vivaient dans un emplacement unique en bas de page, la question suivante les effaçait — l'état
 * calculé disparaissait sous les yeux de l'utilisateur, qui en concluait qu'aucun rapport ne sortait
 * jamais. Chaque résultat reste désormais attaché à la question qui l'a produit.
 *
 * Champs optionnels plutôt qu'union discriminée : le gabarit affine par `@if (item.report; as r)`,
 * ce qui reste lisible et sûr pour la vérification de types des templates.
 */
interface TimelineItem {
  kind: 'text' | 'report' | 'failure';
  role?: 'user' | 'assistant';
  text?: string;
  report?: StudioReportResultEvent;
  failure?: StudioReportFailureEvent;
}

/**
 * Étapes du flux : `idle` → `planning` (l'IA rédige) → `awaiting_confirmation` (aperçu affiché,
 * flux plan activé côté serveur) → `executing` (endpoint de confirmation, progression live).
 * Sans le flux d'aperçu, on passe directement de `planning` à `idle` (comportement historique).
 */
type BuilderState = 'idle' | 'planning' | 'awaiting_confirmation' | 'executing';

@Component({
  selector: 'app-studio-ai-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ButtonModule, Textarea, StudioPageShellComponent, DynamicReportComponent],
  template: `
    <app-studio-page-shell
      title="Assistant Studio (IA)" i18n-title="Assistant Studio (IA)"
      subtitle="Décrivez un système ou une table — l'IA crée tables, relations, formulaires et données de référence."
      [breadcrumbs]="breadcrumbs">

      <div class="sab-layout">
        <div class="sab-chat">
          @if (lines().length === 0 && !busy()) {
            <p class="sab-welcome" i18n="@@studio.studio-ai-builder.comment.puis.je.vous.aider.aujourd.hui.93af16b7">Comment puis-je vous aider aujourd'hui ?</p>
            <div class="sab-examples">
              @for (ex of examples; track ex) {
                <button type="button" class="sab-chip" (click)="useExample(ex)">{{ ex }}</button>
              }
            </div>
          }
          @for (item of lines(); track $index) {
            @if (item.kind === 'text') {
              <div class="sab-line" [class.sab-line--user]="item.role === 'user'">{{ item.text }}</div>
            }
            @if (item.report; as report) {
              <div class="sab-report">
                <div class="sab-report__head">
                  <div>
                    <h4>{{ report.title }}</h4>
                    <p class="sab-report__hint">Source : {{ report.sourceLabel }} — calculé à l'instant, rien n'est enregistré.</p>
                  </div>
                  <button pButton type="button" class="p-button-sm p-button-outlined" icon="fa-solid fa-floppy-disk"
                    label="Enregistrer comme état" i18n-label="Enregistrer comme état" [disabled]="busy()" (click)="saveReportAsState(report)"></button>
                </div>
                @for (w of report.warnings; track w) {
                  <p class="sab-plan__warning"><i class="fa-solid fa-triangle-exclamation"></i> {{ w }}</p>
                }
                <app-dynamic-report [result]="report.result" [exportName]="report.title"></app-dynamic-report>
              </div>
            }
            @if (item.failure; as failure) {
              <div class="sab-failure">
                <div class="sab-failure__head">
                  <i class="fa-solid fa-circle-exclamation"></i>
                  <div>
                    <p class="sab-failure__eyebrow">{{ failureView(failure).eyebrow }}</p>
                    <h4>{{ failureView(failure).title }}</h4>
                    <p class="sab-failure__reason">{{ failureView(failure).message }}</p>
                  </div>
                </div>
                @if (failure.title || failure.periodLabel) {
                  <p class="sab-failure__attempt">
                    Tenté :
                    @if (failure.title) { <strong>{{ failure.title }}</strong> }
                    @if (failure.periodLabel) { <span> — période : {{ failure.periodLabel }}</span> }
                  </p>
                }
                <p class="sab-failure__hint">{{ failureView(failure).hint }}</p>
                @if (failureView(failure).showSuggestions && failure.suggestions.length) {
                  <p class="sab-failure__suggest-hint" i18n="@@studio.studio-ai-builder.etats.suggeres.5fa9359e">États suggérés :</p>
                  <div class="sab-examples">
                    @for (s of failure.suggestions; track s.preset) {
                      <button type="button" class="sab-chip" [disabled]="busy()"
                        (click)="useSuggestion(s)">{{ s.label }}</button>
                    }
                  </div>
                }
                <div class="sab-failure__actions">
                  @if (failureView(failure).retryable) {
                    <button pButton type="button" class="p-button-sm p-button-outlined"
                      icon="fa-solid fa-rotate-right" label="Réessayer" i18n-label="Réessayer"
                      [disabled]="busy() || !lastUserMessage" (click)="retry()"></button>
                  }
                </div>
              </div>
            }
          }

          @if (suggestions().length) {
            <div class="sab-examples">
              @for (s of suggestions(); track s) {
                <button type="button" class="sab-chip" [disabled]="busy()"
                  (click)="usePromptSuggestion(s)">{{ s }}</button>
              }
            </div>
          }

          @if (plan(); as p) {
            <div class="sab-plan">
              <div class="sab-plan__head">
                <i class="fa-solid fa-clipboard-check"></i>
                <div>
                  <h4>{{ p.summary.title }}</h4>
                  <p class="sab-plan__hint" i18n="@@studio.studio-ai-builder.rien.n.est.encore.cree.verifiez.puis.validez.0729fcab">Rien n'est encore créé — vérifiez puis validez.</p>
                </div>
              </div>
              <ul class="sab-plan__steps">
                @for (s of p.summary.steps; track s.key) {
                  <li>
                    <span class="sab-plan__label">{{ s.label }}</span>
                    <span class="sab-plan__detail">{{ s.detail }}</span>
                  </li>
                }
              </ul>
              @if (p.summary.entities.length) {
                <div class="sab-plan__entities">
                  @for (e of p.summary.entities; track e.displayName) {
                    <span class="sab-chip sab-chip--static">{{ entityChip(e) }}</span>
                  }
                </div>
              }
              @for (w of p.summary.warnings; track w) {
                <p class="sab-plan__warning"><i class="fa-solid fa-triangle-exclamation"></i> {{ w }}</p>
              }
              @if (p.summary.sample; as sample) {
                <div class="sab-plan__sample">
                  <h5 i18n="@@studio.studio-ai-builder.apercu.des.donnees.reelles.8f1ca5c0">Aperçu des données réelles</h5>
                  <app-dynamic-report [result]="sample" exportName="apercu-etat"></app-dynamic-report>
                </div>
              }
              @if (state() === 'awaiting_confirmation') {
                <div class="sab-plan__actions">
                  <button pButton type="button" icon="fa-solid fa-check"
                    [label]="p.summary.kind === 'Report' ? loc_ui_tern_valider_et_enregistrer_f19a56 : loc_ui_tern_valider_et_creer_bdef68"
                    (click)="confirmPlan()"></button>
                  <button pButton type="button" class="p-button-text" icon="fa-solid fa-xmark" label="Annuler" i18n-label="Annuler"
                    (click)="cancelPlan()"></button>
                </div>
              }
            </div>
          }

          @if (buildSteps().length) {
            <div class="sab-progress">
              <h4 i18n="@@studio.studio-ai-builder.construction.da33e1b7">Construction</h4>
              @for (s of buildSteps(); track s.phase + s.label) {
                <div class="sab-step">
                  <i class="fa-solid" [class.fa-spinner]="s.status === 'running'" [class.fa-spin]="s.status === 'running'"
                    [class.fa-check]="s.status === 'done'" [class.fa-triangle-exclamation]="s.status === 'error'"></i>
                  {{ s.label }}
                </div>
              }
            </div>
          }
          @if (busy()) {
            <p class="sab-status"><i class="fa-solid fa-spinner fa-spin"></i> {{ status() }}</p>
          }
        </div>

        <div class="sab-compose">
          <textarea pTextarea [(ngModel)]="prompt" rows="2" class="sab-input" [disabled]="busy()"
            placeholder="Ex. : Créer un système de gestion de congés avec plusieurs tables..." i18n-placeholder="Ex. : Créer un système de gestion de congés avec plusieurs tables..."
            (keydown.enter)="onComposerEnter($event)"></textarea>
          <div class="sab-compose__actions">
            <button pButton type="button" icon="fa-solid fa-paper-plane" label="Envoyer" i18n-label="Envoyer"
              [disabled]="busy() || !prompt.trim()" (click)="send()"></button>
          </div>
        </div>

        @if (actions().length) {
          <div class="sab-nav">
            @for (a of actions(); track a.route) {
              <button pButton type="button" class="p-button-outlined p-button-sm"
                icon="fa-solid fa-arrow-right" [label]="a.label" (click)="go(a)"></button>
            }
          </div>
        }
        @if (error()) {
          <p class="sab-error"><i class="fa-solid fa-triangle-exclamation"></i> {{ error() }}</p>
        }
      </div>
    </app-studio-page-shell>
  `,
  styles: [`
    .sab-layout { display: flex; flex-direction: column; gap: 1rem; max-width: 920px; min-height: 420px; }
    .sab-chat { flex: 1; display: flex; flex-direction: column; gap: .75rem; }
    .sab-welcome { font-size: 1.25rem; margin: 0; }
    .sab-examples { display: flex; flex-wrap: wrap; gap: .4rem; }
    .sab-chip { border: 1px solid var(--surface-300); background: var(--surface-50); border-radius: 999px;
      padding: .35rem .75rem; font-size: .82rem; cursor: pointer; text-align: left; }
    .sab-chip--static { cursor: default; }
    .sab-line { white-space: pre-wrap; padding: .75rem 1rem; border-radius: 10px; background: var(--surface-50);
      border: 1px solid var(--surface-200); line-height: 1.5; max-width: 95%; }
    .sab-line--user { align-self: flex-end; background: var(--primary-50); border-color: var(--primary-100); }
    .sab-plan { border: 1px solid var(--primary-200); background: var(--primary-50); border-radius: 10px; padding: 1rem; }
    .sab-plan__head { display: flex; gap: .75rem; align-items: flex-start; }
    .sab-plan__head h4 { margin: 0; font-size: 1rem; }
    .sab-plan__hint { margin: .15rem 0 0; font-size: .82rem; color: var(--text-color-secondary); }
    .sab-plan__steps { list-style: none; margin: .75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
    .sab-plan__steps li { display: flex; justify-content: space-between; gap: 1rem; font-size: .9rem;
      border-bottom: 1px dashed var(--surface-300); padding-bottom: .3rem; }
    .sab-plan__sample { margin-top: .75rem; }
    .sab-plan__sample h5 { margin: 0 0 .4rem; font-size: .85rem; color: var(--text-color-secondary); }
    .sab-report { border: 1px solid var(--surface-200); background: var(--surface-0); border-radius: 10px; padding: 1rem; }
    .sab-report__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
      margin-bottom: .75rem; flex-wrap: wrap; }
    .sab-report__head h4 { margin: 0; font-size: 1rem; }
    .sab-report__hint { margin: .15rem 0 0; font-size: .82rem; color: var(--text-color-secondary); }
    .sab-plan__label { font-weight: 600; }
    .sab-plan__detail { color: var(--text-color-secondary); text-align: right; }
    .sab-plan__entities { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .75rem; }
    .sab-plan__warning { margin: .5rem 0 0; font-size: .85rem; color: var(--orange-600); }
    .sab-plan__actions { display: flex; gap: .5rem; margin-top: 1rem; }
    .sab-progress { border: 1px solid var(--surface-200); border-radius: 10px; padding: .75rem 1rem; }
    .sab-progress h4 { margin: 0 0 .5rem; font-size: .95rem; }
    .sab-step { display: flex; align-items: center; gap: .5rem; font-size: .9rem; padding: .2rem 0; }
    .sab-compose { display: flex; flex-direction: column; gap: .5rem; border-top: 1px solid var(--surface-200); padding-top: .75rem; }
    .sab-input { width: 100%; }
    .sab-compose__actions { display: flex; justify-content: flex-end; }
    .sab-status { color: var(--text-color-secondary); }
    .sab-nav { display: flex; flex-wrap: wrap; gap: .5rem; }
    .sab-error { color: var(--red-500); }
    .sab-failure { border: 1px solid var(--red-200, #fecaca); background: var(--red-50, #fef2f2);
      border-radius: 10px; padding: 1rem; }
    .sab-failure__head { display: flex; gap: .75rem; align-items: flex-start; }
    .sab-failure__head h4 { margin: 0; font-size: 1rem; }
    .sab-failure__head i { color: var(--red-500); margin-top: .2rem; }
    .sab-failure__eyebrow { margin: 0; font-size: .74rem; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--text-color-secondary); }
    .sab-failure__reason { margin: .15rem 0 0; font-size: .9rem; line-height: 1.45; }
    .sab-failure__attempt { margin: .75rem 0 0; font-size: .85rem; color: var(--text-color-secondary); }
    .sab-failure__hint { margin: .9rem 0 .4rem; font-size: .85rem; color: var(--text-color-secondary); }
    .sab-failure__suggest-hint { margin: .9rem 0 .4rem; font-size: .85rem; color: var(--text-color-secondary); }
    .sab-failure__actions { display: flex; gap: .5rem; margin-top: 1rem; }
  `]
})
export class StudioAiBuilderComponent {
  readonly loc_ui_tern_valider_et_enregistrer_f19a56 = $localize`:@@ui.tern.valider.et.enregistrer.f19a56:Valider et enregistrer`;
  readonly loc_ui_tern_valider_et_creer_bdef68 = $localize`:@@ui.tern.valider.et.creer.bdef68:Valider et créer`;
  private readonly stream = inject(AiStreamService);
  private readonly builds = inject(StudioAiBuildService);
  private readonly router = inject(Router);
  private readonly studioNav = inject(StudioNavService);

  readonly breadcrumbs = STUDIO_BREADCRUMBS.aiBuilder();
  readonly examples = [
    'Créer un système de gestion de congés avec plusieurs tables liées',
    'Crée une table pour suivre les contrats clients avec date de début, date de fin, montant et statut',
    'Table de suivi des congés : employé, type, date début, date fin, nombre de jours, approuvé'
  ];

  prompt = '';
  /** Dernier message envoyé : sert au bouton « Réessayer » après un échec d'état. */
  lastUserMessage = '';
  private conversationId?: string;
  private assistantBuffer = '';

  /** Fil complet : texte, tableaux et cartes d'échec, dans l'ordre où ils sont arrivés. */
  readonly lines = signal<TimelineItem[]>([]);
  /** Formulations proposées quand la demande est comprise mais la ventilation absente. */
  readonly suggestions = signal<string[]>([]);
  readonly buildSteps = signal<BuildStep[]>([]);
  readonly state = signal<BuilderState>('idle');
  readonly status = signal('Analyse…');
  readonly actions = signal<NavAction[]>([]);
  readonly error = signal<string | null>(null);
  readonly plan = signal<StudioPlanEvent | null>(null);
  /** Résultat d'un état calculé en lecture seule : affiché tel quel, rien n'est persisté. */
  readonly reportResult = signal<StudioReportResultEvent | null>(null);
  /** Échec d'un état : la carte porte la raison et des reformulations, jamais un message brut. */
  readonly reportFailure = signal<StudioReportFailureEvent | null>(null);

  /** Le compositeur est verrouillé tant qu'un plan attend une décision ou qu'un travail est en cours. */
  busy(): boolean { return this.state() !== 'idle'; }

  useExample(ex: string): void { this.prompt = ex; }

  send(): void {
    const message = this.prompt.trim();
    if (!message || this.busy()) return;

    this.lines.update(l => [...l, { kind: 'text', role: 'user', text: message }]);
    this.lastUserMessage = message;
    this.prompt = '';
    this.state.set('planning');
    this.status.set('Analyse de votre demande…');
    this.actions.set([]);
    this.error.set(null);
    this.buildSteps.set([]);
    this.plan.set(null);
    this.reportResult.set(null);
    this.reportFailure.set(null);
    this.suggestions.set([]);
    this.assistantBuffer = '';

    const request: ChatRequest = {
      message,
      conversationId: this.conversationId,
      options: { assistantMode: AssistantMode.StudioBuilder }
    };

    this.stream.streamChat(request).subscribe({
      next: ev => this.handleEvent(ev),
      error: e => this.fail(e?.message ?? $localize`:@@ui.tern.echec.de.la.generation.94609f:Échec de la génération.`),
      complete: () => this.settleAfterChat()
    });
  }

  confirmPlan(): void {
    const current = this.plan();
    if (!current || this.state() !== 'awaiting_confirmation') return;

    this.state.set('executing');
    this.status.set('Création en cours…');
    this.error.set(null);
    this.buildSteps.set([]);

    this.builds.confirm(current.planId).subscribe({
      next: ev => this.handleConfirmEvent(ev),
      error: e => this.failExecution(e?.message ?? $localize`:@@ui.tern.echec.de.l.execution.du.plan.b3595f:Échec de l'exécution du plan.`),
      complete: () => {
        if (this.state() === 'executing') this.state.set('idle');
        this.studioNav.refresh();
      }
    });
  }

  cancelPlan(): void {
    const current = this.plan();
    if (!current) return;

    this.builds.cancel(current.planId).subscribe({
      next: () => {
        this.plan.set(null);
        this.state.set('idle');
        this.lines.update(l => [...l, { kind: 'text', role: 'assistant', text: 'Plan annulé. Rien n\'a été créé.' }]);
      },
      error: () => {
        // L'annulation serveur a échoué (plan déjà traité) : on referme quand même l'aperçu local.
        this.plan.set(null);
        this.state.set('idle');
      }
    });
  }

  go(a: NavAction): void { this.router.navigate([a.route]); }

  private handleEvent(ev: ChatStreamEvent): void {
    switch (ev.type) {
      case 'tool_call_start':
        this.status.set('Préparation en cours…');
        break;
      case 'content':
        if (ev.content) this.assistantBuffer += ev.content;
        break;
      case 'content_replace':
        // Un échec d'état est déjà porté par sa carte : le répéter en bulle d'assistant ferait
        // passer un message d'erreur pour une réponse.
        if (ev.content != null && !this.reportFailure()) this.assistantBuffer = this.strip(ev.content);
        break;
      case 'studio_plan':
        this.applyPlan(ev.content);
        break;
      case 'studio_report_result':
        this.applyReportResult(ev.content);
        break;
      case 'studio_report_error':
        this.applyReportFailure(ev.content);
        break;
      case 'suggested_prompts':
        this.applySuggestions(ev.suggestedPrompts);
        break;
      case 'studio_progress':
        this.applyProgress(ev.content);
        break;
      case 'client_actions':
        this.actions.set(this.parseActions(ev.clientActions));
        break;
      case 'error':
        this.fail(ev.error ?? $localize`:@@ui.tern.une.erreur.est.survenue.9a1331:Une erreur est survenue.`);
        break;
      case 'done':
        if (ev.conversationId) this.conversationId = ev.conversationId;
        this.flushAssistantText();
        // Sans flux d'aperçu, la création a déjà eu lieu pendant le chat : on rafraîchit la nav.
        if (!this.plan()) this.studioNav.refresh();
        break;
    }
  }

  private handleConfirmEvent(ev: ChatStreamEvent): void {
    switch (ev.type) {
      case 'studio_progress':
        this.applyProgress(ev.content);
        break;
      case 'studio_result':
        this.plan.set(null);
        this.lines.update(l => [...l, { kind: 'text', role: 'assistant', text: 'Création terminée.' }]);
        break;
      case 'error':
        this.failExecution(ev.error ?? $localize`:@@ui.tern.echec.de.l.execution.du.plan.b3595f:Échec de l'exécution du plan.`);
        break;
      case 'done':
        if (this.state() === 'executing') this.state.set('idle');
        break;
    }
  }

  entityChip(e: StudioPlanEntity): string {
    const base = `${e.displayName} · ${e.fieldCount} champ(s)`;
    return e.relationCount > 0 ? $localize`:@@ui.tern.ph.ph.relation.s.d41dd1:${base}:p0:, ${e.relationCount}:p1: relation(s)` : base;
  }

  private applyPlan(json: string | undefined): void {
    if (!json) return;
    try {
      const payload = JSON.parse(json) as StudioPlanEvent;
      if (!payload?.planId || !payload.summary) return;
      // Tolérance : le backend peut sérialiser `summary` en objet ou en chaîne JSON.
      payload.summary = (typeof payload.summary === 'string'
        ? JSON.parse(payload.summary as unknown as string)
        : payload.summary) as StudioPlanSummary;
      payload.summary.steps ??= [];
      payload.summary.entities ??= [];
      payload.summary.warnings ??= [];
      this.plan.set(payload);
      this.state.set('awaiting_confirmation');
      this.status.set('En attente de votre validation…');
    } catch {
      // Payload de plan illisible : on laisse le flux se terminer normalement.
    }
  }

  private applyReportResult(json: string | undefined): void {
    if (!json) return;
    try {
      const payload = JSON.parse(json) as StudioReportResultEvent;
      if (!payload?.result?.columns) return;
      payload.warnings ??= [];
      this.reportResult.set(payload);
      this.lines.update(l => [...l, { kind: 'report', report: payload }]);
    } catch {
      // Payload illisible : on laisse le flux se terminer, le texte de l'assistant reste affiché.
    }
  }

  private applyReportFailure(json: string | undefined): void {
    if (!json) return;
    try {
      const payload = JSON.parse(json) as StudioReportFailureEvent;
      if (!payload?.message) return;
      payload.suggestions ??= [];
      this.reportFailure.set(payload);
      this.lines.update(l => [...l, { kind: 'failure', failure: payload }]);
      // La carte remplace la bulle : ce qui avait déjà été accumulé n'a plus lieu d'être affiché.
      this.assistantBuffer = '';
    } catch {
      // Payload illisible : le flux se termine normalement, le texte de l'assistant reste affiché.
    }
  }

  /**
   * Lecture « métier » d'une carte d'échec. Pure et déléguée à `classifyStudioFailure` : le titre,
   * le message, la prochaine étape et la présence du bouton « Réessayer » dépendent de la catégorie
   * (précision, refus, fournisseur, délai, désactivé, session, serveur) au lieu d'un texte unique
   * « L'état n'a pas pu être calculé » avec un message serveur brut. Un code serveur explicite, s'il
   * est émis, prime ; sinon une heuristique locale classe le message déjà fourni par le protocole.
   */
  failureView(failure: StudioReportFailureEvent): StudioFailureView {
    return classifyStudioFailure({
      message: failure.message,
      code: failure.code,
      stage: failure.stage,
      retryable: failure.retryable,
      fromReportTool: true
    });
  }

  /** Rejoue la dernière demande à l'identique après un échec. */
  retry(): void {
    if (this.busy() || !this.lastUserMessage) return;
    this.prompt = this.lastUserMessage;
    this.send();
  }

  /** Adopte une reformulation proposée par la carte d'échec. */
  useSuggestion(suggestion: StudioReportSuggestion): void {
    if (this.busy()) return;
    this.prompt = suggestion.prompt;
    this.send();
  }

  private applySuggestions(json: string | undefined): void {
    if (!json) return;
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed))
        this.suggestions.set(parsed.filter((s): s is string => typeof s === 'string'));
    } catch {
      // Payload illisible : pas de puces, le texte de l'assistant suffit.
    }
  }

  /** Adopte une formulation proposée après une demande de précision. */
  usePromptSuggestion(text: string): void {
    if (this.busy()) return;
    this.prompt = text;
    this.send();
  }

  /** Entrée envoie ; Maj+Entrée insère un retour à la ligne. */
  onComposerEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.send();
  }

  /**
   * Transforme le résultat affiché en état Studio enregistré : on renvoie la MÊME demande à
   * l'assistant en lui demandant de la conserver, ce qui passe par `studio_plan_report` et donc par
   * l'aperçu et la validation — aucun raccourci d'écriture depuis le client.
   */
  saveReportAsState(target?: StudioReportResultEvent): void {
    const report = target ?? this.reportResult();
    if (!report || this.busy()) return;
    this.prompt = `Enregistre cet état : ${report.title}`;
    this.send();
  }

  private applyProgress(json: string | undefined): void {
    if (!json) return;
    try {
      const step = JSON.parse(json) as BuildStep;
      this.buildSteps.update(steps => {
        const i = steps.findIndex(x => x.phase === step.phase && x.label === step.label);
        if (i >= 0) { const copy = [...steps]; copy[i] = step; return copy; }
        return [...steps, step];
      });
    } catch { /* ignore malformed progress */ }
  }

  /** Fin du flux de chat : on ne rend la main que si aucun plan n'attend de décision. */
  private settleAfterChat(): void {
    if (this.state() === 'planning') this.state.set('idle');
  }

  private flushAssistantText(): void {
    const finalText = this.strip(this.assistantBuffer);
    if (finalText) this.lines.update(l => [...l, { kind: 'text', role: 'assistant', text: finalText }]);
    this.assistantBuffer = '';
  }

  /** Échec pendant la phase de chat : un plan déjà reçu reste validable. */
  private fail(message: string): void {
    this.error.set(message);
    this.state.set(this.plan() ? 'awaiting_confirmation' : 'idle');
  }

  /**
   * Échec pendant l'exécution : le plan est consommé côté serveur (statut Failed) — le proposer à
   * nouveau renverrait un conflit. On referme l'aperçu et on invite implicitement à reformuler.
   */
  private failExecution(message: string): void {
    this.error.set(message);
    this.plan.set(null);
    this.state.set('idle');
  }

  private parseActions(json: string | undefined): NavAction[] {
    if (!json) return [];
    try {
      const arr = JSON.parse(json);
      return Array.isArray(arr)
        ? arr.filter(a => typeof a?.label === 'string' && typeof a?.route === 'string' && a.route.startsWith('/'))
        : [];
    } catch { return []; }
  }

  private strip(text: string): string {
    return stripStudioAssistantText(text);
  }
}

/** Visible-text sanitizer for Studio AI bubbles. Exported for unit tests. */
export function stripStudioAssistantText(text: string): string {
  // Hide internal leaks: closed fences, unclosed ```json tails, bare entity/system specs,
  // and tool-call envelopes. Then drop prose lines that name studio_* or mention JSON.
  let noFences = text
    .replace(/```ft-meta[\s\S]*?```/g, '')
    .replace(/```dashboard[\s\S]*?```/g, '')
    .replace(/```json[\s\S]*?```/gi, '')
    .replace(/```[\s\S]*?"(?:system|entities)"[\s\S]*?```/gi, '')
    .replace(/```(?:json|ft-meta|dashboard)?[\s\S]*$/gi, '')
    .replace(/\{\s*"(?:type|name)"\s*:[\s\S]*?"name"\s*:\s*"studio_[\s\S]*?"arguments"[\s\S]*?\}\s*\}/gi, '')
    .replace(/\{\s*"name"\s*:\s*"studio_[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/gi, '');
  noFences = stripBareStudioJsonObjects(noFences);
  return noFences
    .split('\n')
    .filter(line => !/studio_[a-z_]+/i.test(line) && !/\bjson\b/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripBareStudioJsonObjects(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const extracted = extractBalancedObject(text, i);
      if (extracted && isBareStudioSpec(extracted.value)) {
        i = extracted.end;
        continue;
      }
      if (!extracted && looksLikeStudioSpecSlice(text.slice(i))) {
        break;
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

function extractBalancedObject(text: string, start: number): { value: string; end: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return { value: text.slice(start, i + 1), end: i + 1 };
      }
    }
  }
  return null;
}

function isBareStudioSpec(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return false;
    if ('name' in parsed && 'arguments' in parsed) return false;
    const entity = parsed['entity'];
    const fields = parsed['fields'];
    if (entity && typeof entity === 'object' && Array.isArray(fields) && fields.length > 0) return true;
    const system = parsed['system'];
    const entities = parsed['entities'];
    return !!(system && typeof system === 'object' && Array.isArray(entities) && entities.length > 0);
  } catch {
    return false;
  }
}

function looksLikeStudioSpecSlice(slice: string): boolean {
  return /"entity"/.test(slice) || (/"system"/.test(slice) && /"entities"/.test(slice));
}
