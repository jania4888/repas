import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  Output,
  inject,
  signal
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ForecastingService } from '../../services/forecasting.service';
import { ReplenishmentDecisionAudit, ReplenishmentStatus } from '../../models/forecasting.models';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';

/**
 * Read-only timeline of every audit row written for a given recommendation
 * (fetched from GET /v2/{id}/history). Used to expose "who did what & when"
 * for compliance & support.
 */
@Component({
  selector: 'app-decision-history-modal',
  standalone: true,
  imports: [CommonModule, DatePipe, FocusTrapDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="onCancel()" role="presentation">
      <div
        class="modal-panel"
        appFocusTrap
        (click)="$event.stopPropagation()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title">
        <header class="modal-header">
          <div>
            <h3 id="history-modal-title" i18n="@@forecasting.components.historique.des.decisions.af5ea832">Historique des décisions</h3>
            <span class="modal-subtitle" *ngIf="productName">{{ productName }}</span>
          </div>
          <button class="close-btn" type="button" (click)="onCancel()" aria-label="Fermer" i18n-aria-label="Fermer">
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </header>

        <div class="modal-body">
          @if (loading()) {
            <div class="state" i18n="@@forecasting.components.chargement.01cba1df">Chargement…</div>
          } @else if (rows().length === 0) {
            <div class="state empty" i18n="@@forecasting.components.aucune.decision.enregistree.pour.cette.recommand.236fa87f">Aucune décision enregistrée pour cette recommandation.</div>
          } @else {
            <ol class="timeline" aria-label="Historique des actions" i18n-aria-label="Historique des actions">
              @for (row of rows(); track row.id) {
                <li class="entry" [class.entry-revert]="row.actionType === 'Revert'">
                  <div class="badge action" [attr.data-action]="row.actionType">
                    <i class="pi" [ngClass]="iconFor(row.actionType)" aria-hidden="true"></i>
                    {{ actionLabel(row.actionType) }}
                  </div>
                  <div class="meta">
                    <div class="transition">
                      <span class="status status-{{ row.fromStatus }}">{{ statusLabel(row.fromStatus) }}</span>
                      <i class="pi pi-arrow-right" aria-hidden="true"></i>
                      <span class="status status-{{ row.toStatus }}">{{ statusLabel(row.toStatus) }}</span>
                    </div>
                    <div class="who">
                      <ng-container i18n="@@forecasting.components.par.e79113f5"> par </ng-container> <strong>{{ row.actorUserId }}</strong>
                      <span class="when">le {{ row.actedAt | date: 'dd/MM/yyyy HH:mm' }}</span>
                    </div>
                    @if (row.reason) {
                      <div class="reason">« {{ row.reason }} »</div>
                    }
                    @if (row.payloadJson) {
                      <pre class="payload" aria-label="Détails de l'action" i18n-aria-label="Détails de l'action">{{ formatPayload(row.payloadJson) }}</pre>
                    }
                  </div>
                </li>
              }
            </ol>
          }
        </div>

        <footer class="modal-footer">
          <button class="btn btn-secondary" type="button" (click)="onCancel()" i18n="@@forecasting.components.fermer.5ab4ec64">Fermer</button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal-panel { background: white; border-radius: 10px; width: 100%; max-width: 640px; box-shadow: 0 20px 60px rgba(0,0,0,.18); display: flex; flex-direction: column; max-height: 90vh; }
    .modal-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.25rem 1.25rem .75rem; border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); }
    .modal-header h3 { margin: 0 0 .15rem; font-size: 1.1rem; font-weight: 600; color: var(--color-neutral-900, #111827); }
    .modal-subtitle { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
    .close-btn { background: none; border: none; cursor: pointer; padding: .25rem .5rem; color: var(--color-neutral-400, #9ca3af); font-size: 1.1rem; }
    .modal-body { padding: 1rem 1.25rem; overflow-y: auto; }
    .state { padding: 1rem; color: var(--color-neutral-600, #6b7280); font-style: italic; text-align: center; }
    .state.empty { background: var(--color-neutral-50, #f9fafb); border: 1px dashed var(--color-neutral-300, #d1d5db); border-radius: 8px; }
    .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .75rem; }
    .entry { display: grid; grid-template-columns: 120px 1fr; gap: .75rem; padding: .65rem; border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; }
    .entry-revert { border-style: dashed; }
    .badge.action { display: inline-flex; align-items: center; gap: .35rem; padding: .25rem .55rem; border-radius: 6px; background: var(--color-neutral-100, #f3f4f6); color: var(--color-neutral-700, #374151); font-size: .75rem; font-weight: 600; height: fit-content; white-space: nowrap; }
    .badge.action[data-action="Approve"] { background: #d1fae5; color: #065f46; }
    .badge.action[data-action="Dismiss"] { background: #fee2e2; color: #991b1b; }
    .badge.action[data-action="LinkPO"] { background: #dbeafe; color: #1e40af; }
    .badge.action[data-action="Override"] { background: #fef3c7; color: #92400e; }
    .badge.action[data-action="Revert"] { background: #e0e7ff; color: #3730a3; }
    .meta { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; }
    .transition { display: flex; align-items: center; gap: .35rem; }
    .status { padding: .1rem .45rem; border-radius: 999px; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-approved { background: #d1fae5; color: #065f46; }
    .status-dismissed { background: #e5e7eb; color: #4b5563; }
    .status-ordered { background: #dbeafe; color: #1e40af; }
    .status-superseded { background: #fce7f3; color: #831843; }
    .who { color: var(--color-neutral-600, #6b7280); }
    .when { margin-left: .25rem; }
    .reason { color: var(--color-neutral-700, #374151); font-style: italic; }
    .payload { background: var(--color-neutral-50, #f9fafb); border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 4px; padding: .35rem .55rem; font-size: .7rem; color: var(--color-neutral-700, #374151); white-space: pre-wrap; margin: 0; overflow-x: auto; }
    .modal-footer { display: flex; justify-content: flex-end; gap: .5rem; padding: .75rem 1.25rem 1rem; border-top: 1px solid var(--color-neutral-200, #e5e7eb); }
    .btn { padding: .5rem 1rem; border-radius: 6px; border: 1px solid var(--color-neutral-300, #d1d5db); background: white; color: var(--color-neutral-800, #1f2937); cursor: pointer; font-size: .9rem; font-weight: 500; }
    .btn:hover { background: var(--color-neutral-50, #f9fafb); }
  `]
})
export class DecisionHistoryModalComponent implements OnInit {
  @Input({ required: true }) recommendationId!: string;
  @Input() productName?: string | null;

  @Output() cancel = new EventEmitter<void>();

  private readonly forecastingService = inject(ForecastingService);

  readonly rows = signal<ReplenishmentDecisionAudit[]>([]);
  readonly loading = signal<boolean>(false);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await firstValueFrom(this.forecastingService.getReplenishmentHistory(this.recommendationId));
      this.rows.set(data ?? []);
    } catch {
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  onCancel(): void { this.cancel.emit(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.onCancel(); }

  statusLabel(s: ReplenishmentStatus): string {
    return ({
      pending: 'En attente',
      approved: 'Approuvée',
      dismissed: 'Écartée',
      ordered: 'Commandée',
      superseded: 'Remplacée'
    } as Record<ReplenishmentStatus, string>)[s] ?? s;
  }

  actionLabel(actionType: string): string {
    switch (actionType) {
      case 'Approve':     return 'Approuvée';
      case 'Dismiss':     return 'Écartée';
      case 'Override':    return 'Modifiée';
      case 'LinkPO':      return 'BC créé';
      case 'Revert':      return 'Annulée';
      case 'AttachNotes': return 'Notes';
      case 'Generate':    return 'Générée';
      default:            return actionType;
    }
  }

  iconFor(actionType: string): string {
    switch (actionType) {
      case 'Approve':     return 'pi-check';
      case 'Dismiss':     return 'pi-times';
      case 'Override':    return 'pi-pencil';
      case 'LinkPO':      return 'pi-shopping-cart';
      case 'Revert':      return 'pi-replay';
      case 'AttachNotes': return 'pi-file';
      case 'Generate':    return 'pi-refresh';
      default:            return 'pi-info-circle';
    }
  }

  formatPayload(json: string): string {
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  }
}
