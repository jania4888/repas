import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { STUDIO_WORKFLOW_LABELS } from '../workflows/studio-workflow-labels';
import { approvalStatusSeverity } from '../workflows/studio-workflows.models';
import { ApprovalRow, dueLabel, dueState } from './studio-approvals.util';

/**
 * Panneau de détail d'une approbation (4.4h1 ; maquette `d44-approvals-panel.html`) —
 * composant de PRÉSENTATION pur (aucun appel réseau, D21 : toutes les données viennent
 * de la ligne `ApprovalRow` déjà chargée par la page). Rendu en colonne fixe 372 px
 * à partir de 1 280 px, dans un `p-drawer` en dessous (le conteneur est choisi par la
 * page, D-44-56).
 * Boutons Approuver / Refuser seulement avec `canDecide` (mêmes règles que 4.4g2, R17) —
 * ils rouvrent le dialog de décision de la page (commentaire obligatoire au refus) ;
 * sinon note « lecture seule » (D-44-57 : le panneau reste accessible en lecture).
 * « Voir l'instance » rendu pour tout lecteur (4.5d3, D-45-F05 : la page ouvre le drawer
 * 4.4f EN PLACE en portée fiche — route runtime `custom_records:read`, 4.5d2) et émet
 * l'`instanceId` (pas de lien `/studio/workflows/:id?instance=` : l'item ne porte pas
 * `workflowDefinitionId`, D-44-83).
 * D-44-81 : statut d'approbation rendu par un `p-tag` local (`approvalStatusSeverity`
 * + `STUDIO_WORKFLOW_LABELS.approvalStatus`) — `app-studio-workflow-status-tag`
 * n'accepte que `WorkflowInstanceStatus` (H-7). Le libellé « Échéance » réutilise
 * `labels.colDue` (`approvals.due` = gabarit « Dans {value} » de 4.4a1, non écrasé).
 */
@Component({
  selector: 'app-studio-approval-detail-panel',
  standalone: true,
  imports: [ButtonModule, TagModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sapd' },
  template: `
    <header class="sapd__head">
      <div>
        <h3 class="sapd__title">{{ item().workflowName }}</h3>
        <p class="studio-muted">{{ item().stepTitle }}</p>
      </div>
      <p-button icon="fa-solid fa-xmark" [rounded]="true" [text]="true" severity="secondary" [ariaLabel]="labels.close" (onClick)="close.emit()" />
    </header>
    <p-tag [value]="statusLabel()" [severity]="statusSeverity()" [rounded]="true" [attr.data-status]="item().status" />
    <dl class="sapd__facts">
      <dt>{{ labels.record }}</dt>
      <dd>{{ item().recordLabel ?? item().recordId }} <span class="studio-muted">({{ item().entityName }})</span></dd>
      <dt>{{ labels.startedAt }}</dt>
      <dd>{{ item().startedAt | date:'dd/MM/yyyy HH:mm' }}</dd>
      <dt>{{ labels.requestedBy }}</dt>
      <dd data-testid="sapd-requested-by">{{ item().startedByName ?? '—' }}</dd>
      <dt>{{ labels.requestedAt }}</dt>
      <dd>{{ item().createdAt | date:'dd/MM/yyyy HH:mm' }}</dd>
      <dt>{{ labels.colDue }}</dt>
      <dd><p-tag [severity]="dueSeverity()" [value]="dueText()" /></dd>
      @if (item().message) {
        <dt>{{ labels.requestComment }}</dt>
        <dd class="sapd__comment">{{ item().message }}</dd>
      }
    </dl>
    <p-button class="sapd__link" [label]="labels.openInstance" icon="fa-solid fa-diagram-project" [text]="true" size="small"
      (onClick)="openInstance.emit(item().instanceId)" data-testid="sapd-instance" />
    @if (canDecide()) {
      <footer class="sapd__actions">
        <p-button [label]="labels.reject" icon="fa-solid fa-xmark" severity="danger" [outlined]="true" [disabled]="busy()" (onClick)="reject.emit(item())" />
        <p-button [label]="labels.approve" icon="fa-solid fa-check" severity="success" [disabled]="busy()" (onClick)="approve.emit(item())" />
      </footer>
    } @else {
      <p class="sap-readonly" role="note">{{ labels.readOnly }}</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .sapd__head { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }
    .sapd__title { margin: 0; font-size: 1.05rem; }
    .sapd__head .studio-muted { margin: .125rem 0 0; }
    .sapd__facts { display: grid; grid-template-columns: max-content 1fr; gap: .375rem .75rem; margin: .75rem 0; }
    .sapd__facts dt { color: var(--studio-muted, var(--color-neutral-500)); font-size: var(--font-size-sm); }
    .sapd__facts dd { margin: 0; }
    .sapd__comment { white-space: pre-line; }
    .sapd__link { margin-bottom: .5rem; }
    .sapd__actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1rem; }
    .sap-readonly { color: var(--studio-muted, var(--color-neutral-500)); }
  `]
})
export class StudioApprovalDetailPanelComponent {
  readonly item = input.required<ApprovalRow>();
  readonly canDecide = input(false);
  readonly busy = input(false);
  readonly nowMs = input(Date.now());
  readonly approve = output<ApprovalRow>();
  readonly reject = output<ApprovalRow>();
  readonly openInstance = output<string>();          // instanceId ⇒ la page ouvre le drawer 4.4f
  readonly close = output<void>();

  readonly labels = STUDIO_WORKFLOW_LABELS.approvals;
  readonly statusLabel = computed(() => STUDIO_WORKFLOW_LABELS.approvalStatus[this.item().status] ?? this.item().status);
  readonly statusSeverity = computed(() => approvalStatusSeverity(this.item().status));               // 4.4a1 (H-11)
  readonly dueText = computed(() => dueLabel(this.item().dueAt, this.nowMs()));
  readonly dueSeverity = computed(() => { const s = dueState(this.item().dueAt, this.nowMs()); return s === 'late' ? 'danger' : s === 'soon' ? 'warn' : 'secondary'; });
}
