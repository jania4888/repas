import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DrawerModule } from 'primeng/drawer';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AuthService } from '@core/services/auth.service';
import { ViewportService } from '@core/services/viewport.service';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { StudioPageShellComponent } from '../shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from '../shared/studio-breadcrumb.util';
import { StudioRecordTab, StudioRecordTabsComponent } from '../shared/studio-record-tabs.component';
import { STUDIO_WORKFLOW_LABELS } from '../workflows/studio-workflow-labels';
import { workflowErrorMessage } from '../workflows/studio-workflow-http.util';
import { StudioWorkflowInstanceDetailComponent } from '../workflows/studio-workflow-instance-detail.component';
import { StudioWorkflowsService } from '../workflows/studio-workflows.service';
import { StudioApprovalDetailPanelComponent } from './studio-approval-detail-panel.component';
import { StudioApprovalsBadgeService } from './studio-approvals-badge.service';
import { ApprovalDueState, ApprovalRow, approvalKpis, dueLabel, dueState, toApprovalRow } from './studio-approvals.util';

/**
 * Page « Mes approbations » `/studio/approvals` (4.4g2 ; maquettes `d44-approvals-page.html`
 * / `d44-approvals-readonly.html`) : trois KPI (« À traiter », « En retard », « Sous 24 h » — D17),
 * tableau des approbations en attente (`listMyApprovals()` ⇒ lignes `ApprovalRow` aplaties, D-44-80)
 * et décision Approuver / Refuser en dialog avec commentaire (obligatoire au refus).
 * Les boutons de décision et le lien vers la fiche ne sont rendus qu'avec `custom_records:write`
 * (R17, D-44-53 : la route `edit` exige `recordsWrite`) ; sinon la page est en lecture seule.
 * Colonne « Demandé par » = `startedByName ?? '—'` (4.5e, D-45-F06 — D-44-79 levé par 4.5a2) ;
 * « Lancé le » affiche `startedAt`. Après une décision : retrait local de la ligne + `badge.refresh()` ;
 * après un 409/404 (déjà traitée / plus assignée), rechargement complet de la liste
 * (D-44-55, vérité serveur).
 * 4.4h1 : bouton « Détail » par ligne (rendu aussi en lecture seule, D-44-57) ouvrant le
 * panneau `app-studio-approval-detail-panel` — colonne fixe 372 px à partir de 1 280 px
 * (signal `wide` sur `matchMedia`, D-44-56), `p-drawer` en dessous ; le bouton
 * « Voir l'instance » du panneau est rendu pour tout lecteur (4.5d3, D-45-F05 — D-44-82 levé)
 * et ouvre EN PLACE le drawer 4.4f `[(instanceId)]` (D-44-83 : l'item ne porte pas
 * `workflowDefinitionId`) en portée fiche : `[entityKey]` + `[recordId]` de la ligne
 * sélectionnée ⇒ route runtime `custom_records:read` (4.5b/4.5d2, 404 hors couple) — son
 * état inline « Instance introuvable. » / « Détail indisponible. » couvre les courses.
 */
@Component({
  selector: 'app-studio-approvals-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, FormsModule, RouterLink,
    ButtonModule, DialogModule, DrawerModule, TableModule, TagModule, TextareaModule, ToastModule,
    StudioPageShellComponent, SkeletonTableComponent, StudioApprovalDetailPanelComponent, StudioWorkflowInstanceDetailComponent,
    StudioRecordTabsComponent
  ],
  template: `
    <app-studio-page-shell [title]="labels.title" [subtitle]="labels.subtitle" [breadcrumbs]="breadcrumbs">
      <div studioActions class="studio-head-actions">
        <p-button [label]="labels.refresh" icon="fa-solid fa-rotate" severity="secondary" [outlined]="true"
          [loading]="loading()" (onClick)="load()" data-testid="sap-refresh" />
      </div>
      <p-toast styleClass="studio-theme" />

      <section class="sap-kpis" aria-label="Indicateurs">
        <article class="sap-kpi" data-testid="sap-kpi-pending">
          <span class="sap-kpi__value">{{ kpis().pending }}</span>
          <span class="sap-kpi__label">{{ labels.kpiPending }}</span>
        </article>
        <article class="sap-kpi sap-kpi--late" data-testid="sap-kpi-late">
          <span class="sap-kpi__value">{{ kpis().late }}</span>
          <span class="sap-kpi__label">{{ labels.kpiLate }}</span>
        </article>
        <article class="sap-kpi sap-kpi--soon" data-testid="sap-kpi-soon">
          <span class="sap-kpi__value">{{ kpis().soon }}</span>
          <span class="sap-kpi__label">{{ labels.kpiSoon }}</span>
        </article>
      </section>

      @if (!canDecide()) {
        <p class="sap-readonly" role="note"><i class="fa-solid fa-lock" aria-hidden="true"></i> {{ labels.readOnly }}</p>
      }

      <!-- 4.7 « v1.1 » (ap-f, D-47-60/61) : onglets — « Déléguées » désactivé « Bientôt » (aucune
           délégation dans le domaine), « Historique » chargé paresseusement à la 1ʳᵉ activation. -->
      <app-studio-record-tabs [tabs]="tabs()" [(active)]="activeTab" [ariaLabel]="labels.title" />

      @if (activeTab() === 'pending') {
      @if (error(); as message) {
        <div class="sai-banner sai-banner--error" role="alert">
          {{ message }}
          <p-button [label]="labels.retry" [text]="true" (onClick)="load()" data-testid="sap-retry" />
        </div>
      } @else if (loading()) {
        <app-skeleton-table [rows]="5" [columns]="skeletonColumns" />
      } @else {
        <div class="sap-layout" [class.sap-layout--panel]="wide() && selected()">
          <div class="ft-table-card">
            <p-table [value]="items()" dataKey="id" styleClass="p-datatable-sm" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th>{{ labels.colWorkflow }}</th>
                <th>{{ labels.colRecord }}</th>
                <th>{{ labels.colStartedAt }}</th>
                <th>{{ labels.colRequestedBy }}</th>
                <th>{{ labels.colRequestedAt }}</th>
                <th>{{ labels.colDue }}</th>
                <th class="sap-actions-col">{{ labels.colActions }}</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-item>
              <tr [attr.data-testid]="'sap-row-' + item.id" [class.sap-row--selected]="selected()?.id === item.id">
                <td>
                  <strong>{{ item.workflowName }}</strong>
                  <div class="studio-muted">{{ item.stepTitle }}</div>
                </td>
                <td>
                  @if (canDecide()) {
                    <a [routerLink]="recordLink(item)">{{ item.recordLabel ?? item.recordId }}</a>
                  } @else {
                    {{ item.recordLabel ?? item.recordId }}
                  }
                  <div class="studio-muted">{{ item.entityName }}</div>
                </td>
                <td>{{ item.startedAt | date:'dd/MM/yyyy HH:mm' }}</td>
                <td [attr.data-testid]="'sap-requested-by-' + item.id">{{ item.startedByName ?? '—' }}</td>
                <td>{{ item.createdAt | date:'dd/MM/yyyy HH:mm' }}</td>
                <td>
                  <p-tag [severity]="dueState(item) === 'late' ? 'danger' : dueState(item) === 'soon' ? 'warn' : 'secondary'"
                    [value]="dueLabel(item)" />
                </td>
                <td class="sap-actions-col">
                  <p-button [label]="labels.detail" icon="fa-solid fa-eye" size="small" severity="secondary" [text]="true"
                    (onClick)="select(item)" [attr.data-testid]="'sap-detail-' + item.id" />
                  @if (canDecide()) {
                    <p-button [label]="labels.approve" icon="fa-solid fa-check" size="small" severity="success" [outlined]="true"
                      (onClick)="openDecision(item, 'approve')" [attr.data-testid]="'sap-approve-' + item.id" />
                    <p-button [label]="labels.reject" icon="fa-solid fa-xmark" size="small" severity="danger" [outlined]="true"
                      (onClick)="openDecision(item, 'reject')" [attr.data-testid]="'sap-reject-' + item.id" />
                  }
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="7" class="ft-empty">
                  <i class="fa-solid fa-inbox" aria-hidden="true"></i> {{ labels.empty }}
                  <div class="studio-muted">{{ labels.emptyHint }}</div>
                </td>
              </tr>
            </ng-template>
          </p-table>
          </div>
          @if (selected(); as sel) {
            @if (wide()) {
              <aside class="sap-panel" data-testid="sap-panel-column">
                <app-studio-approval-detail-panel [item]="sel" [canDecide]="canDecide()" [busy]="busy()" [nowMs]="now()"
                  (approve)="openDecision($event, 'approve')" (reject)="openDecision($event, 'reject')" (openInstance)="openInstanceId.set($event)" (close)="clearSelection()" />
              </aside>
            }
          }
        </div>
      }
      } @else if (activeTab() === 'history') {
        <!-- Onglet « Historique » : mes décisions passées (route 4.7p1, forme inbox). -->
        @if (historyError(); as hError) {
          <div class="sai-banner sai-banner--error" role="alert">
            {{ hError }}
            <p-button [label]="labels.retry" [text]="true" (onClick)="loadHistory()" data-testid="sap-history-retry" />
          </div>
        } @else if (historyLoading()) {
          <app-skeleton-table [rows]="5" [columns]="historySkeletonColumns" />
        } @else {
          <div class="ft-table-card">
            <p-table [value]="historyItems()" dataKey="id" styleClass="p-datatable-sm" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th>{{ labels.colWorkflow }}</th>
                  <th>{{ labels.colRecord }}</th>
                  <th>{{ labels.colRequestedBy }}</th>
                  <th>{{ labels.colDecidedAt }}</th>
                  <th>{{ labels.colDecision }}</th>
                  <th>{{ labels.colComment }}</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-item>
                <tr [attr.data-testid]="'sap-history-row-' + item.id">
                  <td>
                    <strong>{{ item.workflowName }}</strong>
                    <div class="studio-muted">{{ item.stepTitle }}</div>
                  </td>
                  <td>
                    @if (canDecide()) {
                      <a [routerLink]="recordLink(item)">{{ item.recordLabel ?? item.recordId }}</a>
                    } @else {
                      {{ item.recordLabel ?? item.recordId }}
                    }
                    <div class="studio-muted">{{ item.entityName }}</div>
                  </td>
                  <td>{{ item.startedByName ?? '—' }}</td>
                  <td [attr.data-testid]="'sap-history-decided-' + item.id">{{ item.decidedAt | date:'dd/MM/yyyy HH:mm' }}</td>
                  <td>
                    <p-tag [severity]="item.status === 'approved' ? 'success' : 'danger'"
                      [value]="item.status === 'approved' ? labels.decisionApproved : labels.decisionRejected"
                      [attr.data-testid]="'sap-history-decision-' + item.id" />
                  </td>
                  <td [attr.data-testid]="'sap-history-comment-' + item.id">
                    <span [attr.title]="item.comment">{{ truncateComment(item.comment) }}</span>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="6" class="ft-empty">
                    <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> {{ labels.historyEmpty }}
                    <div class="studio-muted">{{ labels.historyEmptyHint }}</div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        }
      }
    </app-studio-page-shell>

    @if (selected(); as sel) {
      @if (!wide()) {
        <p-drawer [visible]="true" (visibleChange)="$event || clearSelection()" position="right" appendTo="body" styleClass="studio-theme sap-drawer"
          [style]="{ width: '420px', maxWidth: '100vw' }">
          <app-studio-approval-detail-panel [item]="sel" [canDecide]="canDecide()" [busy]="busy()" [nowMs]="now()"
            (approve)="openDecision($event, 'approve')" (reject)="openDecision($event, 'reject')" (openInstance)="openInstanceId.set($event)" (close)="clearSelection()" />
        </p-drawer>
      }
    }
    <!-- 4.4f (drawer 480 px, appendTo body) : changed ⇒ l'approbation a pu être annulée avec l'instance ⇒ rechargement + badge.
         4.5d3 : portée fiche (entityKey + recordId de la ligne sélectionnée ⇒ route runtime custom_records:read, 4.5d2) -->
    <app-studio-workflow-instance-detail [(instanceId)]="openInstanceId" [entityKey]="selected()?.entityKey ?? null" [recordId]="selected()?.recordId ?? null"
      (changed)="onInstanceChanged()" />

    <p-dialog [visible]="dialogVisible()" (visibleChange)="$event || closeDecision()" [modal]="true" [draggable]="false"
      appendTo="body" styleClass="studio-theme" [style]="{ width: '480px', maxWidth: '95vw' }"
      [header]="decision()?.kind === 'approve' ? labels.approveTitle : labels.rejectTitle">
      @if (decision(); as d) {
        <p class="sap-dialog__context">{{ d.item.workflowName }} · {{ d.item.stepTitle }} · {{ d.item.recordLabel ?? d.item.recordId }}</p>
        @if (d.item.message) {
          <blockquote class="sap-dialog__message">{{ d.item.message }}</blockquote>
        }
        <label class="sap-dialog__label" for="sap-comment">{{ d.kind === 'reject' ? labels.commentRequired : labels.commentOptional }}</label>
        <textarea id="sap-comment" pTextarea rows="4" [ngModel]="comment()" (ngModelChange)="comment.set($event)"
          [disabled]="busy()" maxlength="1000"></textarea>
        @if (commentMissing()) {
          <small class="sap-dialog__error" role="alert">{{ labels.commentMissing }}</small>
        }
        <div class="sap-dialog__actions">
          <p-button [label]="labels.cancel" severity="secondary" [text]="true" [disabled]="busy()" (onClick)="closeDecision()" />
          <p-button [label]="d.kind === 'approve' ? labels.approve : labels.reject" [severity]="d.kind === 'approve' ? 'success' : 'danger'"
            [disabled]="commentMissing() || busy()" [loading]="busy()" (onClick)="confirmDecision()" data-testid="sap-confirm" />
        </div>
      }
    </p-dialog>
  `,
  styles: [`
    .sap-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin-bottom: 1rem; }
    .sap-kpi { border: 1px solid var(--studio-border, var(--color-border-subtle, #e2e8f0)); border-radius: .75rem; padding: .875rem 1rem; }
    .sap-kpi__value { display: block; font-size: 1.5rem; font-weight: 700; line-height: 1.2; }
    .sap-kpi__label { color: var(--studio-muted, var(--color-neutral-500)); font-size: var(--font-size-sm); }
    .sap-kpi--late .sap-kpi__value { color: var(--p-red-600, #dc2626); }
    .sap-kpi--soon .sap-kpi__value { color: var(--p-amber-600, #d97706); }
    .sap-actions-col { white-space: nowrap; width: 1%; }
    .sap-actions-col p-button + p-button { margin-left: .5rem; }
    .sap-readonly { color: var(--studio-muted, var(--color-neutral-500)); }
    .sai-banner { display: flex; align-items: center; gap: .75rem; padding: .75rem 1rem; border-radius: .5rem; margin-bottom: 1rem; }
    .sai-banner--error { background: #fef2f2; color: #991b1b; }
    .ft-empty { text-align: center; color: var(--text-color-secondary); padding: 2rem; }
    .sap-dialog__context { margin-top: 0; font-weight: 600; }
    .sap-dialog__message { border-left: 3px solid var(--studio-border, var(--color-border-subtle, #e2e8f0)); margin: .5rem 0; padding: .25rem .75rem; color: var(--studio-muted, var(--color-neutral-500)); }
    .sap-dialog__label { display: block; font-weight: 600; font-size: var(--font-size-sm); margin: .75rem 0 .375rem; }
    .sap-dialog__error { display: block; color: var(--p-red-600, #dc2626); margin-top: .375rem; }
    .sap-dialog__actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1rem; }
    .sap-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; align-items: start; }
    .sap-layout--panel { grid-template-columns: minmax(0, 1fr) 372px; }
    .sap-panel { position: sticky; top: 1rem; border: 1px solid var(--studio-border, var(--color-border-subtle, #e2e8f0)); border-radius: .75rem; padding: 1rem; background: var(--studio-surface, var(--color-neutral-50, #f8fafc)); }
    .sap-row--selected > td { background: var(--studio-surface-hover, var(--color-neutral-100, #f1f5f9)); }
  `]
})
export class StudioApprovalsPageComponent implements OnInit {
  private readonly workflows = inject(StudioWorkflowsService);
  private readonly auth = inject(AuthService);
  private readonly badge = inject(StudioApprovalsBadgeService);
  private readonly toast = inject(MessageService);

  readonly labels = STUDIO_WORKFLOW_LABELS.approvals;
  readonly breadcrumbs = STUDIO_BREADCRUMBS.approvals();                       // déclaré par 4.4d (H-6)
  readonly skeletonColumns = [{ width: '20%' }, { width: '20%' }, { width: '11%' }, { width: '13%' }, { width: '11%' }, { width: '10%' }, { width: '15%' }];
  readonly historySkeletonColumns = [{ width: '22%' }, { width: '22%' }, { width: '14%' }, { width: '14%' }, { width: '12%' }, { width: '16%' }];

  // 4.7 « v1.1 » (ap-f) — onglets de la page. KPI = inbox, toujours visibles en tête.
  readonly activeTab = signal<'pending' | 'delegated' | 'history'>('pending');
  readonly tabs = computed<StudioRecordTab[]>(() => [
    { key: 'pending', label: this.labels.tabPending, badge: this.items().length || null },   // D-44-58 : badge masqué à 0
    { key: 'delegated', label: this.labels.tabDelegated, disabled: true, title: this.labels.delegatedSoon },
    { key: 'history', label: this.labels.tabHistory }
  ]);
  readonly historyItems = signal<ApprovalRow[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal<string | null>(null);
  private historyRequested = false;

  readonly items = signal<ApprovalRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly kpis = computed(() => approvalKpis(this.items(), this.now()));
  readonly canDecide = computed(() => this.auth.hasPermission(PERMISSIONS.customData.recordsWrite));   // R17
  readonly decision = signal<{ item: ApprovalRow; kind: 'approve' | 'reject' } | null>(null);
  readonly comment = signal('');
  readonly busy = signal(false);
  readonly commentMissing = computed(() => this.decision()?.kind === 'reject' && this.comment().trim().length === 0);
  readonly dialogVisible = computed(() => this.decision() !== null);

  // 4.4h1 — sélection + panneau de détail (D-44-56/57) + hôte du drawer d'instance 4.4f (H-8)
  readonly selected = signal<ApprovalRow | null>(null);
  /** Drawer d'instance en portée fiche (4.5d3) : posé depuis le panneau de la ligne sélectionnée ⇒ `selected()` est toujours défini. */
  readonly openInstanceId = signal<string | null>(null);
  /** 4.6T2 (D-44-56) : largeur via ViewportService (seuil 1 280 px inchangé, nettoyage automatique). */
  readonly wide = inject(ViewportService).isWide;

  ngOnInit(): void { this.load(); }

  constructor() {
    // Chargement paresseux de l'historique à la première activation de l'onglet (une seule fois,
    // sauf erreur ⇒ « Réessayer » relance explicitement).
    effect(() => {
      if (this.activeTab() === 'history' && !this.historyRequested) {
        this.historyRequested = true;
        this.loadHistory();
      }
    });
  }

  loadHistory(): void {
    this.historyLoading.set(true);
    this.historyError.set(null);
    this.workflows.listMyApprovalHistory().subscribe({                      // GET workflows/approvals/mine/history?max=50 (skipErrorUi)
      next: res => {
        this.historyItems.set(res.success ? (res.data ?? []).map(toApprovalRow) : []);
        this.historyLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.historyError.set(workflowErrorMessage(err) || this.labels.historyLoadError);
        this.historyLoading.set(false);
      }
    });
  }

  truncateComment(comment: string | null): string {
    if (!comment) return '—';
    return comment.length > 80 ? comment.slice(0, 80) + '…' : comment;
  }

  select(item: ApprovalRow): void { this.selected.set(item); }
  clearSelection(): void { this.selected.set(null); }

  /** Après annulation/relance depuis le drawer 4.4f : rechargement de la boîte + badge. */
  onInstanceChanged(): void {
    this.load();
    this.badge.refresh();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.workflows.listMyApprovals().subscribe({                              // GET workflows/approvals/mine?max=50 (skipErrorUi côté service)
      next: res => {
        const list = res.success ? (res.data ?? []).map(toApprovalRow) : [];
        this.items.set(list);
        this.selected.update(s => (s && list.some(i => i.id === s.id) ? s : null));   // la ligne sélectionnée a pu disparaître (décision ailleurs, instance annulée)
        this.now.set(Date.now());
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(workflowErrorMessage(err) || this.labels.loadError);
        this.loading.set(false);
      }
    });
  }

  openDecision(item: ApprovalRow, kind: 'approve' | 'reject'): void {
    this.comment.set('');
    this.decision.set({ item, kind });
  }

  closeDecision(): void {
    if (!this.busy()) this.decision.set(null);
  }

  confirmDecision(): void {
    const d = this.decision();
    if (!d || this.commentMissing() || this.busy()) return;
    const comment = this.comment().trim();
    const call = d.kind === 'approve' ? this.workflows.approve(d.item.id, comment || null) : this.workflows.reject(d.item.id, comment);   // signatures 4.4a2 (H-2)
    this.busy.set(true);
    call.subscribe({
      next: () => {
        this.items.update(list => list.filter(i => i.id !== d.item.id));
        if (this.selected()?.id === d.item.id) this.selected.set(null);
        this.toast.add({ severity: 'success', summary: this.labels.title, detail: d.kind === 'approve' ? this.labels.approved : this.labels.rejected });
        this.badge.refresh();
        this.busy.set(false);
        this.decision.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.decision.set(null);
        const detail = err.status === 409 ? this.labels.alreadyDecided : err.status === 404 ? this.labels.notAssigned : (workflowErrorMessage(err) || this.labels.decisionError);
        this.toast.add({ severity: 'warn', summary: this.labels.title, detail });   // écritures en skipErrorUi ⇒ toast local (H-2)
        if (err.status === 409 || err.status === 404) this.load();
      }
    });
  }

  dueState(item: ApprovalRow): ApprovalDueState { return dueState(item.dueAt, this.now()); }
  dueLabel(item: ApprovalRow): string { return dueLabel(item.dueAt, this.now()); }
  recordLink(item: ApprovalRow): string[] { return ['/studio', 'd', item.entityKey, item.recordId, 'edit']; }
}
