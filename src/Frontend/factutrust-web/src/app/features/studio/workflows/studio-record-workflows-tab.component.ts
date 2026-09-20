import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { ApiResponse } from '@core/services/client.service';
import { STUDIO_WORKFLOW_LABELS } from './studio-workflow-labels';
import { workflowErrorMessage } from './studio-workflow-http.util';
import { StudioWorkflowInstanceDetailComponent } from './studio-workflow-instance-detail.component';
import { StudioWorkflowStatusTagComponent } from './studio-workflow-status-tag.component';
import { RunnableWorkflowDto, WORKFLOW_LIMITS, WorkflowInstanceDto, isOpenInstance } from './studio-workflows.models';
import { StudioWorkflowsService } from './studio-workflows.service';

/**
 * Onglet « Workflows » de la fiche enregistrement (4.4h2 ; maquette
 * `d44-approvals-record-tab.html`) : les instances de l'enregistrement (sonde
 * `listRecordInstances` portée par la fiche — 403/404 ⇒ l'onglet n'est pas rendu du tout,
 * fail-closed silencieux D21), le lancement manuel (`listRunnableWorkflows` + `runWorkflow`
 * PAR CLÉ — D-44-84, 201 ; 409 ⇒ « déjà en cours », 400 quota ⇒ message serveur D-44-02) et,
 * sur les instances ouvertes (`isOpenInstance`, 4.4a1 H-11), « Annuler » / « Relancer les
 * approbateurs ». Actions d'écriture rendues seulement avec `custom_records:write` (R17) ;
 * « Détail » rendu pour tout lecteur (4.5d3, D-45-F05 — D-44-82 levé) — il ouvre le drawer
 * 4.4f en place (`[(instanceId)]` + `[entityKey]` + `[recordId]` ⇒ route runtime
 * `custom_records:read` 4.5b/4.5d2, appelée seulement à l'ouverture) ;
 * `(changed)` de l'onglet ou du drawer ⇒ la fiche relance la sonde.
 * Écart maquette (annexe fait foi) : le lancement passe par un `p-dialog` (select + confirmer)
 * au lieu de la carte inline de la maquette ; colonnes « Démarré le » + « Échéance » (la
 * maquette combinait « Démarré par / le »).
 */
@Component({
  selector: 'app-studio-record-workflows-tab',
  standalone: true,
  imports: [
    DatePipe, FormsModule,
    ButtonModule, DialogModule, SelectModule, TableModule, TextareaModule, TooltipModule,
    StudioWorkflowStatusTagComponent, StudioWorkflowInstanceDetailComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="srw-head">
      <p class="studio-muted">{{ labels.hint }}</p>
      @if (canWrite()) {
        <p-button [label]="labels.run" icon="fa-solid fa-play" size="small" (onClick)="openRun()" data-testid="srw-run" />
      }
    </div>
    <div class="ft-table-card">
      <p-table [value]="instances()" dataKey="id" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ labels.colWorkflow }}</th><th>{{ labels.colStatus }}</th><th>{{ labels.colStep }}</th>
            <th>{{ labels.colStarted }}</th><th>{{ labels.colRequestedBy }}</th><th>{{ labels.colDue }}</th>
            <th><span class="sr-only">{{ labels.colActions }}</span></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr [attr.data-testid]="'srw-row-' + row.id">
            <td>{{ row.workflowName }}</td>
            <td><app-studio-workflow-status-tag [status]="row.status" /></td>
            <td>{{ row.currentStepKey ?? '—' }}</td>
            <td>{{ row.startedAt | date:'dd/MM/yyyy HH:mm' }}</td>
            <!-- 4.6c1 (D-46-F03) : nom du lanceur (4.6b1) ; « — » si inconnu ou backend non déployé. -->
            <td [attr.data-testid]="'srw-requested-by-' + row.id">{{ row.startedByName ?? '—' }}</td>
            <td>{{ row.dueAt ? (row.dueAt | date:'dd/MM/yyyy HH:mm') : '—' }}</td>
            <td class="srw-actions">
              <p-button icon="fa-solid fa-eye" [text]="true" size="small" [pTooltip]="labels.detail"
                [attr.aria-label]="labels.detail" (onClick)="openInstanceId.set(row.id)" [attr.data-testid]="'srw-detail-' + row.id" />
              @if (canWrite() && isOpen(row)) {
                <p-button icon="fa-solid fa-bell" [text]="true" size="small" [pTooltip]="labels.remind"
                  [attr.aria-label]="labels.remind" (onClick)="remind(row)" [attr.data-testid]="'srw-remind-' + row.id" />
                <p-button icon="fa-solid fa-ban" [text]="true" size="small" severity="danger" [pTooltip]="labels.cancel"
                  [attr.aria-label]="labels.cancel" (onClick)="cancel(row)" [attr.data-testid]="'srw-cancel-' + row.id" />
              }
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="7" class="ft-empty">{{ labels.empty }}</td></tr>
        </ng-template>
      </p-table>
    </div>
    <!-- 4.6d2 (D-44-96) : confirmation d'annulation INLINE avec motif optionnel — même motif et libellés
         que le tiroir (D-44-26, pas de ConfirmationService.prompt). -->
    @if (cancelTarget(); as target) {
      <div class="srw-cancel" data-testid="srw-cancel-panel" role="group" [attr.aria-label]="labels.cancelConfirmTitle"
        (keydown.escape)="closeCancel()">
        <p class="srw-cancel__title">{{ labels.cancelConfirmTitle }} <strong>{{ target.workflowName }}</strong></p>
        <textarea pTextarea rows="2" [attr.maxlength]="limits.maxCancelReason" [ngModel]="cancelReason()"
          (ngModelChange)="cancelReason.set($event)" [placeholder]="labels.cancelReason"
          [attr.aria-label]="labels.cancelReason" data-testid="srw-cancel-reason"></textarea>
        <small class="studio-muted">{{ cancelReason().length }}/{{ limits.maxCancelReason }}</small>
        <div class="srw-cancel__row">
          <p-button severity="danger" size="small" [label]="labels.cancelConfirm" [loading]="busy()"
            (onClick)="confirmCancel()" data-testid="srw-cancel-confirm" />
          <p-button [outlined]="true" size="small" [label]="labels.cancelBack" [disabled]="busy()"
            (onClick)="closeCancel()" data-testid="srw-cancel-back" />
        </div>
      </div>
    }
    <p-dialog [visible]="runOpen()" (visibleChange)="$event || closeRun()" [modal]="true" appendTo="body"
      styleClass="studio-theme" [header]="labels.runTitle" [style]="{ width: '440px', maxWidth: '95vw' }">
      <p-select [options]="runnable()" optionLabel="name" optionValue="key" [ngModel]="runKey()"
        (ngModelChange)="runKey.set($event)" [placeholder]="labels.runPlaceholder" [attr.aria-label]="labels.runPlaceholder" appendTo="body"
        panelStyleClass="studio-theme" [loading]="runnableLoading()" data-testid="srw-run-select" />
      @if (!runnableLoading() && runnable().length === 0) {
        <p class="studio-muted">{{ labels.runEmpty }}</p>
      }
      <div class="srw-dialog__actions">
        <p-button [label]="labels.close" severity="secondary" [text]="true" (onClick)="closeRun()" />
        <p-button [label]="labels.run" icon="fa-solid fa-play" [disabled]="!runKey() || busy()" [loading]="busy()"
          (onClick)="confirmRun()" data-testid="srw-run-confirm" />
      </div>
    </p-dialog>
    <!-- 4.4f (H-8) : model() two-way ; le drawer n'appelle la route qu'à l'ouverture explicite.
         4.5d3 : portée fiche (entityKey + recordId ⇒ route runtime custom_records:read, 4.5d2) -->
    <app-studio-workflow-instance-detail [(instanceId)]="openInstanceId" [entityKey]="entityKey()" [recordId]="recordId()"
      (changed)="changed.emit()" (closed)="openInstanceId.set(null)" />
  `,
  // studio-layout.scss fournit .studio-muted (encapsulation émulée — même motif que
  // l'onglet « Liés » 2.5e2) ; .ft-table-card vient de la couche design globale.
  styleUrl: '../shared/studio-layout.scss',
  styles: [`
    .srw-cancel { display: flex; flex-direction: column; gap: var(--spacing-2, .5rem); margin-top: var(--spacing-3, .75rem); padding: var(--spacing-3, .75rem); border: 1px solid var(--color-border-subtle, #e5e7eb); border-radius: var(--radius-md, 8px); }
    .srw-cancel__title { margin: 0; font-weight: 600; }
    .srw-cancel__row { display: flex; gap: var(--spacing-2, .5rem); }
  `, `
    .srw-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .75rem; }
    .srw-head p { margin: 0; }
    .srw-actions { display: flex; gap: .25rem; justify-content: flex-end; }
    .srw-dialog__actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1rem; }
    .ft-empty { text-align: center; color: var(--text-color-secondary); padding: 2rem; }
  `]
})
export class StudioRecordWorkflowsTabComponent {
  readonly entityKey = input.required<string>();
  readonly recordId = input.required<string>();
  readonly instances = input<WorkflowInstanceDto[]>([]);
  readonly canWrite = input(false);
  /** La fiche recharge la sonde (une instance lancée, annulée ou relancée). */
  readonly changed = output<void>();

  private readonly workflows = inject(StudioWorkflowsService);
  /** D-44-89 : le `<p-toast>` est porté par la fiche hôte (`studio-record-form.component.ts:33`) ; `MessageService` est root. */
  private readonly toast = inject(MessageService);

  readonly labels = STUDIO_WORKFLOW_LABELS.recordTab;
  readonly runOpen = signal(false);
  readonly runnable = signal<RunnableWorkflowDto[]>([]);
  readonly runnableLoading = signal(false);
  readonly runKey = signal<string | null>(null);
  readonly busy = signal(false);
  readonly openInstanceId = signal<string | null>(null);
  protected readonly limits = WORKFLOW_LIMITS;
  /** 4.6d2 (D-44-96) : instance en cours d'annulation (confirmation inline) + motif saisi. */
  readonly cancelTarget = signal<WorkflowInstanceDto | null>(null);
  readonly cancelReason = signal('');

  isOpen(row: WorkflowInstanceDto): boolean { return isOpenInstance(row.status); }

  openRun(): void {
    this.runOpen.set(true);
    this.runnableLoading.set(true);
    this.runKey.set(null);
    this.workflows.listRunnableWorkflows(this.entityKey()).subscribe({
      next: res => { this.runnable.set(res.success ? (res.data ?? []) : []); this.runnableLoading.set(false); },
      error: () => { this.runnable.set([]); this.runnableLoading.set(false); }
    });
  }

  closeRun(): void { if (!this.busy()) this.runOpen.set(false); }

  confirmRun(): void {
    const key = this.runKey();
    if (!key || this.busy()) return;   // revue ★ 4.6 : même garde anti double envoi que cancel/remind
    this.busy.set(true);
    // POST records/{entityKey}/{recordId}/workflows/{key}/run — 201 (adressage PAR CLÉ, D-44-84)
    this.workflows.runWorkflow(this.entityKey(), this.recordId(), key).subscribe({
      next: () => {
        this.busy.set(false);
        this.runOpen.set(false);
        this.toast.add({ severity: 'success', summary: this.labels.title, detail: this.labels.started });
        this.changed.emit();
      },
      // 400 quota 200 instances ⇒ message serveur (D-44-02) ; 409 ⇒ « déjà en cours »
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.toast.add({ severity: 'warn', summary: this.labels.title, detail: err.status === 409 ? this.labels.alreadyRunning : (workflowErrorMessage(err) || this.labels.runError) });
      }
    });
  }

  /** 4.6d2 (D-44-96) : ouvre la confirmation inline (le motif repart vide pour chaque cible).
   *  Revue ★ 4.6 : aucun changement de cible tant qu'une action est en cours. */
  cancel(row: WorkflowInstanceDto): void {
    if (this.busy()) return;
    this.cancelReason.set('');
    this.cancelTarget.set(row);
  }

  /** Ferme la confirmation (bouton « Retour » ou Échap) ; ignorée tant qu'une action est en cours. */
  closeCancel(): void { if (!this.busy()) this.cancelTarget.set(null); }

  /** Annulation confirmée : motif optionnel borné à 500 côté saisie ET à l'envoi (même défense que le tiroir). */
  confirmCancel(): void {
    const target = this.cancelTarget();
    if (!target) return;
    const reason = this.cancelReason().trim().slice(0, WORKFLOW_LIMITS.maxCancelReason) || null;
    this.act(this.workflows.cancelInstance(target.id, reason), this.labels.cancelled, () => this.cancelTarget.set(null));
  }

  remind(row: WorkflowInstanceDto): void { this.act(this.workflows.remindApprovers(row.id), this.labels.reminded); }        // 409 « < 24 h » ⇒ message serveur

  private act(call: Observable<ApiResponse<WorkflowInstanceDto>>, okDetail: string, onSuccess?: () => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.add({ severity: 'success', summary: this.labels.title, detail: okDetail });
        onSuccess?.();
        this.changed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.toast.add({ severity: 'warn', summary: this.labels.title, detail: workflowErrorMessage(err) || this.labels.actionError });
      }
    });
  }
}
