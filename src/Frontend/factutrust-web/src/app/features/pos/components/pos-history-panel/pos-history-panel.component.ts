import { Component, inject, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PosHistoryService } from '../../services/pos-history.service';
import { PosRegisterSessionService, ZReportListItemDto } from '../../services/pos-register-session.service';
import { InvoiceService } from '@core/services/invoice.service';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';

@Component({
  selector: 'app-pos-history-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="history-panel" (click)="onClose.emit()">
      <div class="history-panel__content" (click)="$event.stopPropagation()">
        <div class="history-panel__header">
          <h3 class="history-panel__title" i18n="@@pos.components.historique.du.jour.d4f3dc0e">Historique du jour</h3>
          <button class="history-panel__close" (click)="onClose.emit()" aria-label="Fermer" i18n-aria-label="Fermer">
            <i class="pi pi-times"></i>
          </button>
        </div>
        <div class="history-panel__chips">
          <button type="button" class="history-panel__chip" [class.history-panel__chip--active]="historyService.activeFilter() === 'today'" (click)="historyService.setFilter('today')" i18n="@@pos.components.aujourd.hui.baca97f6">Aujourd'hui</button>
          <button type="button" class="history-panel__chip" [class.history-panel__chip--active]="historyService.activeFilter() === 'session'" (click)="showThisSession()" i18n="@@pos.components.cette.session.8976ccb7">Cette session</button>
        </div>

        @if (historyService.isLoading()) {
          <div class="history-panel__loading">
            <i class="pi pi-spin pi-spinner"></i>
            <span i18n="@@pos.components.chargement.a209b664">Chargement...</span>
          </div>
        } @else if (historyService.todayTransactions().length === 0) {
          <div class="history-panel__empty">
            <i class="pi pi-inbox"></i>
            <p>{{ historyService.activeFilter() === 'session' ? 'Aucune transaction dans cette session' : 'Aucune transaction aujourd\'hui' }}</p>
          </div>
        } @else {
          <div class="history-panel__summary">
            <span>{{ historyService.todayCount() }} facture(s)</span>
            <span class="history-panel__total">{{ formatAmount(historyService.todayTotal()) }} TND</span>
          </div>
          <div class="history-panel__list">
            @for (inv of historyService.todayTransactions(); track inv.id) {
              <div class="history-panel__item">
                <div class="history-panel__item-info">
                  <span class="history-panel__item-number">{{ inv.number }}</span>
                  <span class="history-panel__item-client">{{ inv.clientName }}</span>
                  <span class="history-panel__item-amount">{{ formatAmount(inv.totalAmount) }} TND</span>
                </div>
                <div class="history-panel__item-actions">
                  <button type="button" class="history-panel__btn" (click)="reprint(inv.id)" title="Reimprimer" i18n-title="Reimprimer">
                    <i class="pi pi-print"></i>
                  </button>
                </div>
              </div>
            }
          </div>
        }

        <button type="button" class="history-panel__refresh" (click)="historyService.refreshHistory()">
          <i class="pi pi-refresh"></i> Actualiser
        </button>

        <div class="history-panel__z">
          <h4 i18n="@@pos.components.clotures.z.30.jours.50c327b2">Clôtures Z (30 jours)</h4>
          @if (zReports.length === 0) {
            <p class="history-panel__z-empty" i18n="@@pos.components.aucune.cloture.sur.la.periode.350ca2f8">Aucune clôture sur la période.</p>
          } @else {
            <ul>
              @for (z of zReports; track z.id) {
                <li>{{ z.number }} — {{ z.cashRegisterName }} — {{ z.generatedAt | date:'short' }}</li>
              }
            </ul>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .history-panel {
      position: fixed;
      inset: 0;
      z-index: 600;
      display: flex;
      justify-content: flex-end;
      background: rgba(15, 23, 42, 0.25);
      backdrop-filter: blur(4px);
      animation: fadeIn 200ms ease-out;
    }

    .history-panel__content {
      width: 100%;
      max-width: 420px;
      background: var(--color-white);
      box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slideInRight 250ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .history-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-5);
      border-bottom: 1px solid var(--color-border-subtle);
    }

    .history-panel__title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      margin: 0;
      color: var(--color-text-primary);
    }

    .history-panel__chips {
      display: flex;
      gap: var(--spacing-2);
      padding: 0 var(--spacing-5) var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
    }

    .history-panel__chip {
      border: 1px solid var(--color-border-subtle);
      background: var(--color-white);
      color: var(--color-text-secondary);
      border-radius: 999px;
      padding: 0.35rem 0.85rem;
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    .history-panel__chip--active {
      background: var(--color-primary-50, #eff6ff);
      border-color: var(--color-primary, #2563eb);
      color: var(--color-primary, #2563eb);
      font-weight: var(--font-weight-semibold);
    }

    .history-panel__close {
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .history-panel__loading,
    .history-panel__empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-10);
      color: var(--color-text-tertiary);
      gap: var(--spacing-4);
    }

    .history-panel__empty i {
      font-size: 3rem;
      opacity: 0.5;
    }

    .history-panel__summary {
      display: flex;
      justify-content: space-between;
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
    }

    .history-panel__total {
      font-variant-numeric: tabular-nums;
      color: var(--color-primary-600);
    }

    .history-panel__list {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-3);
    }

    .history-panel__item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
      margin-bottom: var(--spacing-2);
    }

    .history-panel__item-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .history-panel__item-number {
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .history-panel__item-client {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .history-panel__item-amount {
      font-size: var(--font-size-sm);
      font-variant-numeric: tabular-nums;
      color: var(--color-text-secondary);
    }

    .history-panel__btn {
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-primary-50);
      color: var(--color-primary-600);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .history-panel__btn:hover {
      background: var(--color-primary-100);
    }

    .history-panel__refresh {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
      border-top: 1px solid var(--color-border-subtle);
      border: none;
      background: var(--color-neutral-50);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    .history-panel__refresh:hover {
      background: var(--color-neutral-100);
    }

    .history-panel__z {
      padding: var(--spacing-4);
      border-top: 1px solid var(--color-border-subtle);
      font-size: var(--font-size-sm);
    }
    .history-panel__z h4 {
      margin: 0 0 var(--spacing-2);
    }
    .history-panel__z ul {
      margin: 0;
      padding-left: 1.1rem;
    }
    .history-panel__z-empty {
      color: var(--color-text-tertiary);
      margin: 0;
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
export class PosHistoryPanelComponent implements OnInit {
  @Output() onClose = new EventEmitter<void>();

  readonly historyService = inject(PosHistoryService);
  private readonly invoiceService = inject(InvoiceService);
  private readonly printPreviewService = inject(PrintPreviewService);
  private readonly warehouseContext = inject(WarehouseContextService);
  private readonly registerSession = inject(PosRegisterSessionService);
  zReports: ZReportListItemDto[] = [];

  ngOnInit(): void {
    this.historyService.loadHistory();
    this.loadZReports();
  }

  private loadZReports(): void {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    this.registerSession.listZReports(from, to, this.registerSession.selectedRegisterId()).subscribe({
      next: list => {
        this.zReports = list;
      }
    });
  }

  showThisSession(): void {
    const warehouseId = this.warehouseContext.selectedWarehouseId();
    if (!warehouseId) {
      this.historyService.setSessionInvoiceIds([]);
      this.historyService.setFilter('session');
      return;
    }

    this.registerSession.getXReport(warehouseId).subscribe({
      next: report => {
        this.historyService.setSessionInvoiceIds(report.invoiceIds ?? []);
        this.historyService.setFilter('session');
      },
      error: () => {
        this.historyService.setSessionInvoiceIds([]);
        this.historyService.setFilter('session');
      }
    });
  }

  reprint(invoiceId: string): void {
    this.invoiceService.downloadPdf(invoiceId).subscribe({
      next: blob => this.printPreviewService.openPdfForPrintPreview(blob, `facture-${invoiceId}.pdf`)
    });
  }

  formatAmount(amount: number): string {
    return amount.toLocaleString('fr-TN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }
}
