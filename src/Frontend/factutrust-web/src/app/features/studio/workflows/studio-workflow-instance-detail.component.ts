import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { TimelineModule } from 'primeng/timeline';
import { TooltipModule } from 'primeng/tooltip';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AuthService } from '@core/services/auth.service';
import { STUDIO_WORKFLOW_LABELS, STEP_TYPE_ICONS, stepTypeLabel } from './studio-workflow-labels';
import { workflowErrorMessage } from './studio-workflow-http.util';
import { StudioWorkflowStatusTagComponent } from './studio-workflow-status-tag.component';
import {
  WORKFLOW_LIMITS,
  WorkflowApprovalDto,
  WorkflowInstanceDetailDto,
  WorkflowInstanceDto,
  approvalStatusSeverity,
  isOpenInstance,
  stepRunStatusSeverity
} from './studio-workflows.models';
import { StudioWorkflowsService } from './studio-workflows.service';

/**
 * Libellés FR locaux absents de `STUDIO_WORKFLOW_LABELS` (4.4a1, non modifié dans cette
 * tranche — même motif que `DESIGNER_LABELS` du concepteur 4.4e1 et `PANEL_LABELS` du
 * panneau d'instances 4.4e2). L'annexe cite `L.instances.title` / `notFound` / `forbidden` /
 * `loadError` / `remindHint` / `readOnly` / `actionError`, qui n'existent pas :
 * - `title` (résumé des toasts) ⇒ `L.instances.detail` (« Détail »), le plus proche existant ;
 * - les autres sont locaux ci-dessous. À centraliser si la partie B en a besoin.
 */
const DETAIL_LABELS = {
  notFound: 'Instance introuvable.',
  forbidden: 'Détail indisponible.',
  loadError: 'Chargement du détail impossible.',
  retry: 'Réessayer',
  remindHint: 'Possible quand l\'instance attend une approbation.',
  readOnly: 'Lecture seule : votre rôle ne permet pas d\'agir sur cette instance.',
  actionError: 'Action impossible.',
  system: 'Système',
  completedAt: 'Terminé le',
  origin: 'Instance d\'origine',
  open: 'Ouvrir',
  confirmCancel: 'Confirmer l\'annulation',
  back: 'Retour'
} as const;

/**
 * Détail d'une instance de workflow en `p-drawer` droit (4.4f ; maquettes
 * `d44-workflows-instance-detail.html` / `-failed.html`), piloté par `[(instanceId)]`
 * (le concepteur l'alimente depuis `?instance=<id>`, D20 — la remise à `null` retire le
 * paramètre). API FIGÉE pour la partie B (onglet Workflows de la fiche 4.4h2, page
 * d'approbations 4.4g2/h1) : `instanceId` model, `changed` (après annulation/relance
 * réussie), `closed` (à la fermeture), `entityKey` input optionnel pour le lien fiche
 * (le DTO ne porte que `entityDefinitionId`, D-44-24).
 * Contenu : résumé (D19), `p-timeline` des étapes exécutées (icône `STEP_TYPE_ICONS`,
 * sévérité `stepRunStatusSeverity`, libellés FR), approbations, puis actions gardées par
 * `custom_records:write` : « Relancer les approbateurs » (409 ⇒ toast warn « … déjà
 * relancés il y a moins de 24 h ») et « Annuler l'instance » (motif optionnel saisi
 * INLINE dans le drawer, ≤ 500 caractères — D-44-26, pas de `ConfirmationService.prompt`).
 * S-base : `context` JAMAIS rendu (mention discrète en pied) ; `result` d'étape non
 * affiché ; `getInstance` est une route de CONCEPTION (policy `studio:design_entities`,
 * D-44-25) sans `skipErrorUi` ⇒ 404/403/autre mappés en message inline.
 * Bi-mode (4.5d2, D-45-F04) : quand `entityKey` ET `recordId` sont fournis (onglet Workflows
 * de la fiche, page approbations), le drawer passe par la route RUNTIME
 * `records/{entityKey}/{recordId}/workflow-instances/{id}` (policy `custom_records:read`,
 * 404 hors couple) et masque « Ouvrir l'origine » (la route conception exige `design_entities`).
 */
@Component({
  selector: 'app-studio-workflow-instance-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, FormsModule, RouterLink,
    ButtonModule, DrawerModule, MessageModule, SkeletonModule, TagModule, TextareaModule, TimelineModule, TooltipModule,
    StudioWorkflowStatusTagComponent
  ],
  template: `
    <p-drawer [visible]="visible()" (visibleChange)="$event || close()" position="right" [modal]="true"
      [blockScroll]="true" styleClass="studio-theme wf-instance-drawer" [style]="{ width: '480px' }" appendTo="body">
      <ng-template pTemplate="header">
        <div class="wf-detail-head">
          @if (instance(); as i) {
            <app-studio-workflow-status-tag [status]="i.status" />
            <span class="wf-detail-head__name">{{ i.workflowName ?? '—' }}</span>
            <span class="wf-detail-head__ver">v{{ i.definitionVersion }}</span>
          } @else {
            <span>{{ L.instances.detail }}</span>
          }
        </div>
      </ng-template>

      @if (loading()) {
        <div class="wf-detail-skel" data-testid="wf-detail-loading">
          <p-skeleton height="2rem" />
          <p-skeleton height="6rem" />
          <p-skeleton height="10rem" />
          <p-skeleton height="6rem" />
        </div>
      } @else if (error()) {
        <div class="wf-detail-error" data-testid="wf-detail-error">
          <p-message severity="warn" [text]="error()!" styleClass="wf-detail-msg" />
          <button pButton type="button" size="small" [outlined]="true" [label]="localLabels.retry"
            data-testid="wf-detail-retry" (click)="retry()"></button>
        </div>
      } @else if (instance()) {
        <!-- l'alias « as » n'est permis que sur le bloc @if principal : @if imbriqué. -->
        @if (instance(); as i) {
        <dl class="wf-inst-summary" data-testid="wf-detail-summary">
          <dt>{{ L.instances.startedAt }}</dt>
          <dd>{{ i.startedAt | date:'dd/MM/yyyy HH:mm' }}</dd>
          <dt>{{ L.instances.startedBy }}</dt>
          <!-- 4.6c1 (D-46-F03) : nom lisible (4.6b1), guid en repli, « Système » si null. -->
          <dd [attr.data-testid]="'wf-detail-started-by-' + i.id">{{ i.startedByName ?? i.startedBy ?? localLabels.system }}</dd>
          <dt>{{ L.designer.trigger }}</dt>
          <dd>{{ L.triggers[i.trigger] }}</dd>
          <dt>{{ L.instances.currentStep }}</dt>
          <dd>{{ i.currentStepKey ?? '—' }}</dd>
          <dt>{{ L.instances.dueAt }}</dt>
          <dd>{{ i.dueAt ? (i.dueAt | date:'dd/MM/yyyy HH:mm') : '—' }}</dd>
          <dt>{{ localLabels.completedAt }}</dt>
          <dd>{{ i.completedAt ? (i.completedAt | date:'dd/MM/yyyy HH:mm') : '—' }}</dd>
          <dt>{{ L.approvals.columns.record }}</dt>
          <dd>
            @if (entityKey(); as ek) {
              <a [routerLink]="['/studio/records', ek, i.recordId]" [title]="i.recordId"
                data-testid="wf-detail-record">{{ shortId(i.recordId) }}</a>
            } @else {
              <span [title]="i.recordId">{{ shortId(i.recordId) }}</span>
            }
          </dd>
          @if (i.originInstanceId && !scope()) {
            <dt>{{ localLabels.origin }}</dt>
            <dd>
              <button pButton type="button" size="small" [text]="true" [label]="localLabels.open"
                data-testid="wf-detail-origin" (click)="openOrigin(i.originInstanceId!)"></button>
              <span class="wf-detail-muted">· {{ i.depth }}</span>
            </dd>
          }
        </dl>

        @if (i.error) {
          <p-message severity="error" [text]="i.error!" styleClass="wf-detail-msg" data-testid="wf-detail-failure" />
        }

        <h3 class="wf-detail-sec">{{ L.instances.timeline }}</h3>
        <p-timeline [value]="events()" align="left" styleClass="wf-detail-timeline">
          <ng-template pTemplate="marker" let-e>
            <span class="wf-marker" [attr.data-severity]="e.severity"><i [class]="e.icon" aria-hidden="true"></i></span>
          </ng-template>
          <ng-template pTemplate="content" let-e>
            <div class="wf-ev">
              <div class="wf-ev__l1">
                <span class="wf-ev__type">{{ stepTypeLabel(e.stepType) }}</span>
                <code class="wf-ev__key">{{ e.stepKey }}</code>
                <p-tag [severity]="e.severity" [value]="e.label" />
              </div>
              @if (e.outcome) {
                <div class="wf-ev__outcome">{{ e.outcome }}</div>
              }
              <div class="wf-ev__when">{{ e.startedAt | date:'dd/MM HH:mm' }} → {{ e.finishedAt | date:'dd/MM HH:mm' }}</div>
              @if (e.error) {
                <small class="wf-issue">{{ e.error }}</small>
              }
            </div>
          </ng-template>
        </p-timeline>

        <h3 class="wf-detail-sec">{{ L.instances.approvals }}</h3>
        @if (!approvals().length) {
          <p class="wf-detail-muted" data-testid="wf-detail-no-approvals">{{ L.instances.noApprovals }}</p>
        } @else {
          <ul class="wf-appr" data-testid="wf-detail-approvals">
            @for (a of approvals(); track a.id) {
              <li class="wf-appr__item">
                <div class="wf-appr__l1">
                  <span class="wf-appr__title">{{ a.title }}</span>
                  <p-tag [severity]="approvalStatusSeverity(a.status)" [value]="L.approvalStatus[a.status]" />
                </div>
                <div class="wf-appr__meta">
                  {{ assigneeLabel(a) }}
                  @if (a.dueAt) {
                    · {{ L.instances.dueAt }} {{ a.dueAt | date:'dd/MM/yyyy HH:mm' }}
                  }
                </div>
                @if (a.decidedAt) {
                  <div class="wf-appr__meta">{{ a.decidedBy ?? '—' }} · {{ a.decidedAt | date:'dd/MM/yyyy HH:mm' }}</div>
                }
                @if (a.comment) {
                  <blockquote class="wf-appr__comment">{{ a.comment }}</blockquote>
                }
              </li>
            }
          </ul>
        }

        @if (canWrite()) {
          <div class="wf-inst-actions" data-testid="wf-detail-actions">
            @if (cancelMode()) {
              <textarea pTextarea rows="2" maxlength="500" [ngModel]="reason()" (ngModelChange)="reason.set($event)"
                [placeholder]="L.instances.cancelReason" data-testid="wf-cancel-reason"></textarea>
              <small class="wf-detail-muted">{{ reason().length }}/{{ limits.maxCancelReason }}</small>
              <div class="wf-inst-actions__row">
                <button pButton type="button" severity="danger" [label]="localLabels.confirmCancel" [loading]="busy()"
                  data-testid="wf-cancel-confirm" (click)="cancel()"></button>
                <button pButton type="button" [outlined]="true" [label]="localLabels.back" [disabled]="busy()"
                  data-testid="wf-cancel-back" (click)="cancelMode.set(false)"></button>
              </div>
            } @else {
              <button pButton type="button" [outlined]="true" icon="fa-solid fa-bell" [label]="L.instances.remind"
                [disabled]="!canRemind() || busy()" [pTooltip]="localLabels.remindHint" [tooltipDisabled]="canRemind()"
                data-testid="wf-remind" (click)="remind()"></button>
              <button pButton type="button" severity="danger" [outlined]="true" icon="fa-solid fa-ban"
                [label]="L.instances.cancel" [disabled]="!canCancel() || busy()"
                data-testid="wf-cancel" (click)="cancelMode.set(true)"></button>
            }
          </div>
        } @else {
          <p class="wf-detail-muted" data-testid="wf-detail-readonly">{{ localLabels.readOnly }}</p>
        }
        <p class="wf-detail-muted wf-detail-context">{{ L.instances.context }}</p>
        }
      }
    </p-drawer>
  `,
  styles: [`
    .wf-detail-head { display: flex; align-items: center; gap: .5rem; min-width: 0; }
    .wf-detail-head__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wf-detail-head__ver { color: var(--text-color-secondary); font-size: .8rem; font-weight: 400; }
    .wf-detail-skel { display: flex; flex-direction: column; gap: .75rem; }
    .wf-detail-error { display: flex; flex-direction: column; align-items: flex-start; gap: .5rem; }
    .wf-detail-sec { margin: 1.25rem 0 .5rem; font-size: .9375rem; font-weight: 600; }
    .wf-detail-muted { color: var(--text-color-secondary); font-size: .8rem; }
    .wf-detail-context { margin-top: 1rem; }
    .wf-inst-summary { display: grid; grid-template-columns: max-content 1fr; gap: .25rem .75rem; margin: 0; }
    .wf-inst-summary dt { color: var(--text-color-secondary); font-size: .8rem; }
    .wf-inst-summary dd { margin: 0; font-size: .875rem; min-width: 0; }
    .wf-marker { display: inline-flex; width: 1.75rem; height: 1.75rem; border-radius: 50%; align-items: center; justify-content: center; background: var(--surface-100); }
    .wf-marker[data-severity="danger"] { background: var(--red-100); color: var(--red-600); }
    .wf-marker[data-severity="success"] { background: var(--green-100); color: var(--green-700); }
    .wf-marker[data-severity="warn"] { background: var(--orange-100); color: var(--orange-600); }
    .wf-ev { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
    .wf-ev__l1 { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .wf-ev__type { font-weight: 600; font-size: .875rem; }
    .wf-ev__key { font-size: .75rem; color: var(--text-color-secondary); }
    .wf-ev__outcome { font-size: .8125rem; color: var(--text-color-secondary); }
    .wf-ev__when { font-size: .75rem; color: var(--text-color-secondary); }
    .wf-issue { color: var(--red-500); }
    .wf-appr { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .75rem; }
    .wf-appr__item { border: 1px solid var(--surface-200); border-radius: var(--border-radius, .5rem); padding: .625rem .75rem; }
    .wf-appr__l1 { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
    .wf-appr__title { font-weight: 600; font-size: .875rem; }
    .wf-appr__meta { font-size: .8125rem; color: var(--text-color-secondary); margin-top: .15rem; }
    .wf-appr__comment { margin: .4rem 0 0; padding-left: .625rem; border-left: 3px solid var(--surface-300); font-size: .8125rem; font-style: italic; }
    .wf-inst-actions { display: flex; flex-direction: column; gap: .5rem; margin-top: 1.25rem; padding-top: .75rem; border-top: 1px solid var(--surface-200); }
    .wf-inst-actions__row { display: flex; gap: .5rem; }
    @media (max-width: 639.98px) { ::ng-deep .wf-instance-drawer.p-drawer { width: 100% !important; } }
  `]
})
export class StudioWorkflowInstanceDetailComponent {
  private readonly workflowsSvc = inject(StudioWorkflowsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(MessageService);

  /** Ouvert ⇔ non nul ; le composant le remet à `null` à la fermeture (le parent retire `?instance=`). */
  readonly instanceId = model<string | null>(null);
  /** Clé de la table pour le lien « fiche » (le DTO ne porte que `entityDefinitionId` — D-44-24). */
  readonly entityKey = input<string | null>(null);
  /**
   * Identifiant de l'enregistrement (portée fiche, 4.5d2) : avec `entityKey`, bascule le
   * chargement sur la route runtime `custom_records:read` (4.5b) ; `null` ⇒ route conception.
   */
  readonly recordId = input<string | null>(null);
  /** Émis après une annulation/relance réussie (le parent rafraîchit ses listes). */
  readonly changed = output<WorkflowInstanceDto>();
  /** Émis à la fermeture (partie B : `(closed)="openInstanceId.set(null)"`). */
  readonly closed = output<void>();

  protected readonly L = STUDIO_WORKFLOW_LABELS;
  protected readonly localLabels = DETAIL_LABELS;
  protected readonly limits = WORKFLOW_LIMITS;
  protected readonly stepTypeLabel = stepTypeLabel;
  protected readonly approvalStatusSeverity = approvalStatusSeverity;

  protected readonly detail = signal<WorkflowInstanceDetailDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly cancelMode = signal(false);
  protected readonly reason = signal('');

  protected readonly canWrite = computed(() => this.auth.hasPermission(PERMISSIONS.customData.recordsWrite));
  protected readonly instance = computed(() => this.detail()?.instance ?? null);
  protected readonly isOpen = computed(() => {
    const i = this.instance();
    return !!i && isOpenInstance(i.status);
  });
  protected readonly canCancel = computed(() => this.canWrite() && this.isOpen());
  protected readonly canRemind = computed(() => this.canWrite() && this.instance()?.status === 'waiting_approval');
  protected readonly visible = computed(() => this.instanceId() !== null);
  /** Étapes exécutées enrichies pour la timeline (icône, sévérité, libellés FR traduits). */
  protected readonly events = computed(() =>
    (this.detail()?.steps ?? []).map(s => ({
      ...s,
      icon: STEP_TYPE_ICONS[s.stepType],
      severity: stepRunStatusSeverity(s.status),
      label: STUDIO_WORKFLOW_LABELS.stepRunStatus[s.status],
      outcome: s.outcome ? STUDIO_WORKFLOW_LABELS.outcomes[s.outcome] : null
    }))
  );
  protected readonly approvals = computed(() => this.detail()?.approvals ?? []);

  /**
   * Portée figée à l'ouverture (revue 4.5i★, D-45-29) : `{ entityKey, recordId }` lus quand `instanceId`
   * change, pour qu'un « Réessayer » ou un rechargement 409 garde la route runtime même si l'hôte
   * (« Mes approbations ») a perdu sa sélection entre-temps — sinon bascule vers la route de conception ⇒ 403 lecteur.
   */
  protected readonly scope = signal<{ entityKey: string; recordId: string } | null>(null);

  constructor() {
    effect(() => {
      const id = this.instanceId();
      untracked(() => {
        const ek = this.entityKey();
        const rid = this.recordId();
        this.scope.set(id && ek && rid ? { entityKey: ek, recordId: rid } : null);
        id ? this.load(id) : this.reset();
      });
    });
  }

  private reset(): void {
    this.detail.set(null);
    this.loading.set(false);
    this.error.set(null);
    this.busy.set(false);
    this.cancelMode.set(false);
    this.reason.set('');
  }

  /**
   * GET de conception (policy `studio:design_entities`, D-44-25) SANS `skipErrorUi` (le
   * service n'en pose pas sur `getInstance`) : l'intercepteur global affiche son toast et
   * le drawer montre un message inline — 403 possible pour un non-concepteur (partie B).
   * Portée fiche (`entityKey` + `recordId`, 4.5d2) : route runtime (4.5b, `custom_records:read`)
   * avec `skipErrorUi` — même gestion 404 / 403 / autre en message inline.
   */
  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.cancelMode.set(false);
    this.reason.set('');
    const scope = this.scope();
    const src$ = scope ? this.workflowsSvc.getRecordInstance(scope.entityKey, scope.recordId, id) : this.workflowsSvc.getInstance(id);
    src$.subscribe({
      next: r => { this.detail.set(r.data ?? null); this.loading.set(false); },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(
          err.status === 404 ? this.localLabels.notFound
            : err.status === 403 ? this.localLabels.forbidden
              : this.localLabels.loadError
        );
      }
    });
  }

  /** Bouton « Réessayer » de l'état d'erreur. */
  protected retry(): void {
    const id = this.instanceId();
    if (id) this.load(id);
  }

  /** Fermeture (croix du drawer, clic sur le masque, Échap) : notifie le parent. */
  protected close(): void {
    this.instanceId.set(null);
    this.closed.emit();
  }

  /** Lien « Ouvrir » l'instance d'origine : recharge le drawer sur cette instance. */
  protected openOrigin(id: string): void {
    this.instanceId.set(id);
  }

  /** Annulation avec motif optionnel (borné à 500 côté saisie ET à l'envoi — défense en profondeur). */
  protected cancel(): void {
    const i = this.instance();
    if (!this.canCancel() || this.busy() || !i) return;
    this.busy.set(true);
    const reason = this.reason().trim().slice(0, WORKFLOW_LIMITS.maxCancelReason) || null;
    this.workflowsSvc.cancelInstance(i.id, reason).subscribe({
      next: r => {
        this.busy.set(false);
        this.cancelMode.set(false);
        this.reason.set('');
        if (r.data) { this.patchInstance(r.data); this.changed.emit(r.data); }
        this.toast.add({ severity: 'success', summary: this.L.instances.detail, detail: this.L.instances.cancelled });
      },
      // 409 « Cette instance est déjà terminée. » (StudioWorkflowRuntimeFeatures.cs) — message serveur affiché tel quel.
      error: (err: HttpErrorResponse) => this.fail(err, this.L.instances.cancelConflict)
    });
  }

  /** Relance des approbateurs ; 409 « … déjà été relancés il y a moins de 24 h. » */
  protected remind(): void {
    const i = this.instance();
    if (!this.canRemind() || this.busy() || !i) return;
    this.busy.set(true);
    this.workflowsSvc.remindApprovers(i.id).subscribe({
      next: r => {
        this.busy.set(false);
        if (r.data) { this.patchInstance(r.data); this.changed.emit(r.data); }
        this.toast.add({ severity: 'success', summary: this.L.instances.detail, detail: this.L.instances.reminded });
      },
      error: (err: HttpErrorResponse) => this.fail(err, this.L.instances.remindConflict)
    });
  }

  /** `cancelInstance`/`remindApprovers` sont en `skipErrorUi` (4.4a2, D-44-03) ⇒ toasts locaux (§0.5). */
  private fail(err: HttpErrorResponse, conflictLabel: string): void {
    this.busy.set(false);
    const msg = workflowErrorMessage(err);
    if (err.status === 409) {
      // Le message serveur est déjà en français et précis : affiché tel quel, le libellé local sert de repli.
      this.toast.add({ severity: 'warn', summary: this.L.instances.detail, detail: msg || conflictLabel });
      const id = this.instance()?.id;
      if (id) this.load(id);   // état probablement changé : recharger
    } else if (err.status === 404) {
      this.error.set(this.localLabels.notFound);
    } else {
      this.toast.add({ severity: 'error', summary: this.L.instances.detail, detail: msg || this.localLabels.actionError });
    }
  }

  /** Applique l'instance renvoyée par l'écriture puis recharge le déroulé (approbations annulées, LastRemindedAt). */
  private patchInstance(i: WorkflowInstanceDto): void {
    const d = this.detail();
    if (d) this.detail.set({ ...d, instance: i });
    this.load(i.id);
  }

  /** Identifiant tronqué (pas de libellé dans le DTO — D-44-24) ; le `title` porte l'identifiant complet. */
  protected shortId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) + '…' : id;
  }

  /** Assigné : identifiant utilisateur tronqué ou rôle traduit (`L.roles`). */
  protected assigneeLabel(a: WorkflowApprovalDto): string {
    if (a.assigneeUserId) return this.shortId(a.assigneeUserId);
    if (a.assigneeRole) return (STUDIO_WORKFLOW_LABELS.roles as Record<string, string>)[a.assigneeRole] ?? a.assigneeRole;
    return '—';
  }
}
