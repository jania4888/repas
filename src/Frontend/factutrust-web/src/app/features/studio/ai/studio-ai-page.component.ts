import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { ChatAttachment } from '@features/ai-assistant/models/ai-chat.models';
import { StudioAiBuildService } from '../studio-ai-build.service';
import { StudioPageShellComponent } from '../shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from '../shared/studio-breadcrumb.util';
import { StudioAiCapabilitiesService } from './studio-ai-capabilities.service';
import { STUDIO_AI_LABELS, StudioAiIntentCardDef, formatLabel } from './studio-ai-labels';
import { StudioAiSendOptions, StudioAiSessionStore, parsePlanSummary } from './studio-ai-session.store';
import { studioAiHttpError } from './studio-ai-spec.util';
import { ImportCustomSystemRequest, StudioAiIntent, StudioAiPlanListItemDto, StudioAiPreviewTab, StudioTemplateListItemDto } from './studio-ai.models';
import { StudioAiComposerComponent } from './composer/studio-ai-composer.component';
import { StudioAiIntentCardsComponent } from './composer/studio-ai-intent-cards.component';
import { StudioAiConversationComponent } from './conversation/studio-ai-conversation.component';
import { StudioAiDuplicateDialogComponent, StudioAiDuplicateRequest } from './import-export/studio-ai-duplicate-dialog.component';
import { StudioAiExportDialogComponent } from './import-export/studio-ai-export-dialog.component';
import { StudioAiImportDialogComponent } from './import-export/studio-ai-import-dialog.component';
import { StudioAiConfirmDialogComponent } from './preview/studio-ai-confirm-dialog.component';
import { StudioAiPreviewComponent } from './preview/studio-ai-preview.component';
import { StudioAiProgressComponent } from './preview/studio-ai-progress.component';
import { StudioAiResultCardComponent } from './preview/studio-ai-result-card.component';
import { StudioAiHeaderComponent } from './studio-ai-header.component';
import { StudioAiRailComponent } from './rail/studio-ai-rail.component';

/** Onglet d'aperçu ouvert par défaut selon l'intention choisie dans les cartes. */
const INTENT_TO_TAB: Partial<Record<StudioAiIntent, StudioAiPreviewTab>> = {
  table: 'tables',
  relations: 'relations',
  form: 'forms',
  reference_data: 'seed',
  report: 'reports',
  workflow: 'workflow'
};

/**
 * Atelier Studio IA (`/studio/ai` quand le workbench est activé) — coquille 3 colonnes (PR 1.4) :
 * en-tête, colonne principale (composer + cartes ↔ aperçu ↔ progression ↔ résultat, avec le fil de
 * conversation), rail droit (modèles, actions rapides, historique, promo).
 *
 * Composition « bête » : le store porte tout l'état de session ; cette page choisit seulement quoi
 * afficher et relie les sorties des composants aux méthodes du store. Le store est fourni ICI (pas
 * en root) : quitter la page réinitialise l'atelier.
 *
 * Paramètres d'URL consommés une fois puis retirés : `?intent=` (carte présélectionnée, A20),
 * `?template=<key>` (plan depuis la bibliothèque), `?plan=<id>` (reprise depuis « Mes projets »),
 * `?duplicate=<key>` (dialog Dupliquer prérempli depuis le hub d'un système — N7, fail-closed sur l'export).
 */
@Component({
  selector: 'app-studio-ai-page',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ButtonModule,
    TooltipModule,
    StudioPageShellComponent,
    StudioAiHeaderComponent,
    StudioAiRailComponent,
    StudioAiComposerComponent,
    StudioAiIntentCardsComponent,
    StudioAiConversationComponent,
    StudioAiConfirmDialogComponent,
    StudioAiExportDialogComponent,
    StudioAiImportDialogComponent,
    StudioAiDuplicateDialogComponent,
    StudioAiPreviewComponent,
    StudioAiProgressComponent,
    StudioAiResultCardComponent
  ],
  providers: [StudioAiSessionStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './studio-ai-page.component.html',
  styleUrl: './studio-ai-page.component.scss'
})
export class StudioAiPageComponent {
  readonly store = inject(StudioAiSessionStore);
  readonly capabilities = inject(StudioAiCapabilitiesService);
  private readonly builds = inject(StudioAiBuildService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly labels = STUDIO_AI_LABELS;
  readonly breadcrumbs = STUDIO_BREADCRUMBS.aiBuilder();

  /** Texte injecté dans le composer au clic d'une carte d'intention (ou du CTA promo). */
  readonly prefill = signal<string | null>(null);
  readonly pendingIntent = signal<StudioAiIntent | null>(null);
  readonly previewTab = signal<StudioAiPreviewTab>('overview');
  readonly confirmVisible = signal(false);
  readonly conversationCollapsed = signal(false);
  /** Dialog Exporter (JSON) : clé préréglée depuis la carte résultat, `null` depuis le rail (p-select). */
  readonly exportVisible = signal(false);
  readonly exportKey = signal<string | null>(null);
  /** Dialog Importer (JSON) : fermé automatiquement quand le plan importé est ouvert. */
  readonly importVisible = signal(false);
  /** Dialog Dupliquer : clé préréglée depuis la carte résultat / `?duplicate=`, `null` depuis le rail. */
  readonly duplicateVisible = signal(false);
  readonly duplicateKey = signal<string | null>(null);

  /** Modèles du catalogue pour le rail (chargés une fois si `templatesEnabled`). */
  readonly templates = signal<StudioTemplateListItemDto[]>([]);
  readonly templatesLoading = signal(false);
  readonly templatesError = signal<string | null>(null);

  private railLoaded = false;
  private importSubmitted = false;

  /** Ce que la colonne principale affiche. */
  readonly mainView = computed<'compose' | 'preview' | 'progress' | 'result'>(() => {
    const phase = this.store.phase();
    if (phase === 'executing') return 'progress';
    if (phase === 'completed' && this.store.result()) return 'result';
    if (this.store.hasPlan()) return 'preview';
    return 'compose';
  });

  /** La conversation n'a d'intérêt qu'une fois la première demande envoyée. */
  readonly showConversation = computed(() => this.store.timeline().length > 0 || this.store.busy());

  /** Un plan en attente ne bloque plus la saisie (A19 : confirmation à l'envoi). */
  readonly composerDisabled = computed(() => this.store.busy());

  /** Bandeau D3 : l'avancé était demandé, le serveur a répondu avec le standard. */
  readonly modelFallbackText = computed(() => {
    const reason = this.store.advancedModelFallbackReason();
    const why = (reason && this.labels.model.fallbackReason[reason]) || this.labels.model.fallbackGeneric;
    return `${this.labels.model.fallbackTitle} : ${why}`;
  });

  constructor() {
    effect(() => {
      if (this.capabilities.state() !== 'ready' || this.railLoaded) return;
      this.railLoaded = true;
      const caps = this.capabilities.capabilities();
      if (caps.planPreviewEnabled) this.store.loadHistory();
      if (caps.templatesEnabled) this.loadTemplates();
    });

    // Import soumis : le dialog se ferme dès que le store a ouvert le plan (phase ≠ planning, sans erreur).
    effect(() => {
      const phase = this.store.phase();
      const error = this.store.error();
      if (this.importSubmitted && phase !== 'planning') {
        this.importSubmitted = false;
        if (!error) this.importVisible.set(false);
      }
    });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => this.applyQueryParams(params));
  }

  // ---- Composer & cartes ------------------------------------------------------------------------------

  pickIntent(card: StudioAiIntentCardDef): void {
    if (!card.available) return;
    this.pendingIntent.set(card.intent);
    this.previewTab.set(INTENT_TO_TAB[card.intent] ?? 'overview');
    // Nouvelle référence à chaque clic pour que le composer réagisse même si le texte est identique.
    this.prefill.set(card.prompt);
  }

  submit(payload: { text: string; attachments: ChatAttachment[] }): void {
    this.requestSend(payload.text, { intent: this.pendingIntent(), attachments: payload.attachments });
    this.prefill.set(null);
  }

  usePrompt(text: string): void {
    this.requestSend(text, { intent: this.pendingIntent() });
  }

  /** CTA promo : prérempli le composer sans rien envoyer. */
  tryPrompt(text: string): void {
    this.pendingIntent.set('system');
    this.previewTab.set('overview');
    this.prefill.set(text);
  }

  setAdvancedModel(on: boolean): void {
    this.store.setAdvancedModel(on);
  }

  /**
   * A19 : envoyer alors qu'une proposition attend la validation demande confirmation ; accepter
   * abandonne le plan (annulé côté serveur, rien n'est créé) puis envoie.
   */
  private requestSend(text: string, options: StudioAiSendOptions): void {
    if (!text.trim() || this.store.busy()) return;
    if (!this.store.hasPlan()) {
      this.store.send(text, options);
      return;
    }
    this.confirmAction({
      header: this.labels.page.pendingPlanTitle,
      message: this.labels.page.pendingPlanMessage,
      acceptLabel: this.labels.page.pendingPlanAccept,
      accept: () => this.store.abandonPlanAndSend(text, options)
    });
  }

  /** Toutes les modales de l'atelier partagent le libellé d'abandon et la taille (libellés FR longs). */
  private confirmAction(opts: { header: string; message: string; acceptLabel: string; accept: () => void }): void {
    this.confirmation.confirm({ ...opts, rejectLabel: this.labels.page.pendingPlanReject, size: 'md' });
  }

  // ---- Plan ----------------------------------------------------------------------------------------------

  openConfirm(): void {
    if (this.store.canConfirm()) this.confirmVisible.set(true);
  }

  confirm(): void {
    this.confirmVisible.set(false);
    this.store.confirm();
  }

  /** « Nouvelle demande » (en-tête / carte résultat) : confirmation seulement si un plan serait perdu. */
  newRequest(): void {
    if (this.store.hasPlan()) {
      this.confirmAction({
        header: this.labels.rail.resetTitle,
        message: this.labels.rail.resetConfirm,
        acceptLabel: this.labels.page.resetConversation,
        accept: () => this.doReset()
      });
      return;
    }
    this.doReset();
  }

  /** « Réinitialiser la conversation » du rail (R20) : toujours confirmée, toast avec le nombre de plans annulés. */
  resetFromRail(): void {
    this.confirmAction({
      header: this.labels.rail.resetTitle,
      message: this.labels.rail.resetConfirm,
      acceptLabel: this.labels.rail.resetConversation,
      accept: () => this.doReset(true)
    });
  }

  private doReset(notify = false): void {
    this.pendingIntent.set(null);
    this.previewTab.set('overview');
    this.prefill.set(null);
    this.store.resetConversation(count => {
      if (!notify) return;
      this.toast.add({
        severity: 'success',
        summary: this.labels.rail.resetConversation,
        detail: count > 0 ? formatLabel(this.labels.rail.resetDone, { count }) : this.labels.rail.resetNoPlan
      });
    });
  }

  // ---- Rail : modèles, historique ---------------------------------------------------------------------------

  useTemplate(key: string): void {
    if (this.store.busy()) return;
    if (this.store.hasPlan()) {
      this.confirmAction({
        header: this.labels.rail.templates,
        message: this.labels.rail.replaceCurrent,
        acceptLabel: this.labels.rail.use,
        accept: () => this.store.createFromTemplate(key)
      });
      return;
    }
    this.store.createFromTemplate(key);
  }

  /** Rouvre un plan `Pending` de l'historique (résumé complet via `GET {id}`). */
  openHistoryPlan(item: StudioAiPlanListItemDto): void {
    if (this.store.busy() || item.status !== 'Pending') return;
    if (this.store.plan()?.planId === item.id) return;
    const open = () => this.openPlanById(item.id);
    if (this.store.hasPlan()) {
      this.confirmAction({
        header: this.labels.rail.history,
        message: this.labels.rail.replaceCurrent,
        acceptLabel: this.labels.rail.openPlan,
        accept: open
      });
      return;
    }
    open();
  }

  /** « Rejouer » un plan de l'historique : nouveau plan via `POST {id}/replay` (409 ⇒ `labels.replay.conflict`, géré par le store). */
  replayHistoryPlan(item: StudioAiPlanListItemDto): void {
    if (this.store.busy()) return;
    const replay = () => this.store.replay(item.id);
    if (this.store.hasPlan()) {
      this.confirmAction({
        header: this.labels.rail.history,
        message: this.labels.rail.replaceCurrent,
        acceptLabel: this.labels.replay.action,
        accept: replay
      });
      return;
    }
    replay();
  }

  private openPlanById(planId: string): void {
    this.builds.getPlan(planId).subscribe({
      next: res => {
        const plan = res?.success ? res.data : null;
        const summary = plan ? parsePlanSummary(plan.summaryJson) : null;
        if (!plan || !summary) { this.store.error.set(this.labels.errors.planNotFound); return; }
        if (plan.status !== 'Pending') { this.store.error.set(this.labels.errors.planNotPending); return; }
        this.store.openPlan(plan.id, plan.kind, summary, plan.expiresAt);
        this.previewTab.set('overview');
      },
      error: err => this.store.error.set(studioAiHttpError(err, 'plan'))
    });
  }

  private loadTemplates(): void {
    this.templatesLoading.set(true);
    this.templatesError.set(null);
    this.builds.listTemplates().subscribe({
      next: res => {
        this.templatesLoading.set(false);
        this.templates.set(res?.success && Array.isArray(res.data) ? res.data : []);
      },
      error: () => {
        this.templatesLoading.set(false);
        this.templatesError.set(this.labels.rail.templatesLoadFailed);
      }
    });
  }

  /** Ouvre le dialog Exporter (JSON) ; `key` null ⇒ choix du système dans le dialog (Q2 a). */
  openExport(key: string | null): void {
    this.exportKey.set(key);
    this.exportVisible.set(true);
  }

  /** « Rejouer » depuis la carte résultat : nouveau plan à partir de la spec du plan courant. */
  replayCurrent(): void {
    const plan = this.store.plan();
    if (!plan || this.store.busy()) return;
    this.store.replay(plan.planId);
  }

  /** Ouvre le dialog Importer (JSON) depuis le rail. */
  /** Ouvre le dialog Importer ; une erreur antérieure du store ne doit pas s'y afficher. */
  openImport(): void {
    this.store.error.set(null);
    this.importVisible.set(true);
  }

  /** Ouvre le dialog Dupliquer ; `key` null ⇒ choix du système dans le dialog. */
  openDuplicate(key: string | null): void {
    this.duplicateKey.set(key);
    this.duplicateVisible.set(true);
  }

  /** `POST systems/import` via le store ; le dialog reste ouvert (erreur affichée) jusqu'à l'ouverture du plan. */
  submitImport(req: ImportCustomSystemRequest): void {
    if (this.store.busy()) return;
    this.importSubmitted = true;
    this.store.importSystem(req);
  }

  /** `POST systems/{key}/duplicate` via le store ; la proposition s'ouvre dans l'aperçu. */
  submitDuplicate(req: StudioAiDuplicateRequest): void {
    if (this.store.busy()) return;
    this.duplicateVisible.set(false);
    this.store.duplicateSystem(req.key, req.displayName);
  }

  // ---- Paramètres d'URL ------------------------------------------------------------------------------------

  private applyQueryParams(params: ParamMap): void {
    const intent = params.get('intent');
    const template = params.get('template');
    const plan = params.get('plan');
    const duplicate = params.get('duplicate');
    if (!intent && !template && !plan && !duplicate) return;

    if (intent) {
      const card = this.labels.intents.find(c => c.intent === intent);
      if (card) this.pickIntent(card);
    }
    if (template) this.useTemplate(template);
    else if (plan) this.openPlanById(plan);
    // Fail-closed : sans export activé, le paramètre est simplement ignoré (et effacé).
    if (duplicate && this.capabilities.capabilities().systemExportEnabled) this.openDuplicate(duplicate);

    // Consommés une fois : un rechargement ne doit pas recréer un plan ni rouvrir un ancien.
    void this.router
      .navigate([], { relativeTo: this.route, queryParams: { intent: null, template: null, plan: null, duplicate: null }, queryParamsHandling: 'merge', replaceUrl: true })
      .catch(() => undefined);
  }
}
