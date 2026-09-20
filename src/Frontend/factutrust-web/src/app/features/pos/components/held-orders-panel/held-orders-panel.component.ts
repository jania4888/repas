import { Component, inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PosHeldOrdersService, HeldOrder } from '../../services/pos-held-orders.service';
import { PosStateService } from '../../services/pos-state.service';
import { ConfirmationService } from '@core/services/confirmation.service';

@Component({
  selector: 'app-held-orders-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="held-panel" (click)="onClose.emit()">
      <div class="held-panel__content" (click)="$event.stopPropagation()">
        <div class="held-panel__header">
          <h3 class="held-panel__title">Commandes en attente</h3>
          <button class="held-panel__close" (click)="onClose.emit()" aria-label="Fermer">
            <i class="pi pi-times"></i>
          </button>
        </div>

        @if (heldService.heldOrdersList().length === 0) {
          <div class="held-panel__empty">
            <i class="pi pi-inbox"></i>
            <p>Aucune commande en attente</p>
          </div>
        } @else {
          <div class="held-panel__list">
            @for (order of heldService.heldOrdersList(); track order.id) {
              <div class="held-panel__item">
                <div class="held-panel__item-info">
                  <span class="held-panel__item-label">{{ order.label }}</span>
                  <span class="held-panel__item-total">{{ formatAmount(order.totalTTC) }} TND</span>
                  <span class="held-panel__item-date">{{ formatDate(order.heldAt) }}</span>
                </div>
                <div class="held-panel__item-actions">
                  <button
                    class="held-panel__btn held-panel__btn--primary"
                    (click)="recallOrder(order)"
                    type="button">
                    <i class="pi pi-replay"></i> Rappeler
                  </button>
                  <button
                    class="held-panel__btn held-panel__btn--danger"
                    (click)="deleteOrder(order.id)"
                    type="button"
                    aria-label="Supprimer">
                    <i class="pi pi-trash"></i>
                  </button>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .held-panel {
      position: fixed;
      inset: 0;
      z-index: 600;
      display: flex;
      justify-content: flex-end;
      background: rgba(15, 23, 42, 0.25);
      backdrop-filter: blur(4px);
      animation: fadeIn 200ms ease-out;
    }

    .held-panel__content {
      width: 100%;
      max-width: 420px;
      background: var(--color-white);
      box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slideInRight 250ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .held-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-5);
      border-bottom: 1px solid var(--color-border-subtle);
    }

    .held-panel__title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      margin: 0;
      color: var(--color-text-primary);
    }

    .held-panel__close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .held-panel__close:hover {
      background: var(--color-neutral-200);
      color: var(--color-text-primary);
    }

    .held-panel__empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-10);
      color: var(--color-text-tertiary);
    }

    .held-panel__empty i {
      font-size: 3rem;
      margin-bottom: var(--spacing-4);
      opacity: 0.5;
    }

    .held-panel__list {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-3);
    }

    .held-panel__item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      border-radius: var(--radius-xl);
      border: 1px solid var(--color-border-subtle);
      margin-bottom: var(--spacing-3);
      background: var(--color-neutral-50);
    }

    .held-panel__item:last-child {
      margin-bottom: 0;
    }

    .held-panel__item-label {
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .held-panel__item-total {
      font-family: 'JetBrains Mono', monospace;
      font-variant-numeric: tabular-nums;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-bold);
      color: var(--color-primary-600);
    }

    .held-panel__item-date {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .held-panel__item-actions {
      display: flex;
      gap: var(--spacing-2);
    }

    .held-panel__btn {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      border: none;
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .held-panel__btn--primary {
      background: var(--color-primary-500);
      color: var(--color-white);
    }

    .held-panel__btn--primary:hover {
      background: var(--color-primary-600);
    }

    .held-panel__btn--danger {
      background: var(--color-neutral-100);
      color: var(--color-error-600);
    }

    .held-panel__btn--danger:hover {
      background: var(--color-error-50);
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideInRight {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
  `]
})
export class HeldOrdersPanelComponent {
  @Output() onClose = new EventEmitter<void>();
  @Output() onRecall = new EventEmitter<void>();

  readonly heldService = inject(PosHeldOrdersService);
  private readonly posState = inject(PosStateService);
  private readonly confirmationService = inject(ConfirmationService);

  recallOrder(order: HeldOrder): void {
    const apply = () => {
      void this.heldService.recallOrder(order.id).then(ok => {
        if (ok) {
          this.onRecall.emit();
          this.onClose.emit();
        }
      });
    };

    if (this.posState.isDirty() && this.posState.lines().length > 0) {
      this.confirmationService.confirm({
        header: 'Remplacer la commande ?',
        message: 'La commande en cours sera remplacée. Continuer ?',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Continuer',
        rejectLabel: 'Annuler',
        accept: apply
      });
      return;
    }
    apply();
  }

  deleteOrder(id: string): void {
    this.confirmationService.confirm({
      header: 'Supprimer la commande ?',
      message: 'Supprimer cette commande en attente ?',
      icon: 'pi pi-trash',
      acceptButtonStyleClass: 'btn-danger',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      accept: () => this.heldService.deleteHeldOrder(id)
    });
  }

  formatAmount(amount: number): string {
    return amount.toLocaleString('fr-TN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('fr-TN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
