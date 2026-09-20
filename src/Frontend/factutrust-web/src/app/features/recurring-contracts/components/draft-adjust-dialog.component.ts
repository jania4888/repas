import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { Observable, throwError } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import {
  AdjustableRecurringDraft,
  AdjustableRecurringDraftLine,
  IssuedRecurringInvoice,
  RecurringContractService
} from '@core/services/recurring-contract.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import {
  calculateLineFodecAmounts,
  DEFAULT_FODEC_RATE_PERCENT,
  roundTnd
} from '../../invoices/invoice-wizard/services/invoice-wizard-calculation.utils';
import { periodAmountMonthlyEstimate } from '../recurring-contracts.ui-utils';

interface EditableDraftLine {
  index: number;
  productId: string | null;
  productName: string | null;
  designation: string;
  quantity: number;
  unitPriceHT: number;
  vatRate: number;
  fodecApplicable: boolean;
}

/**
 * Modal d'ajustement limité d'un brouillon d'échéance récurrente.
 * N'ouvre pas le wizard ; n'émet que via {@link RecurringContractService.issueBillingRun}.
 */
@Component({
  selector: 'app-draft-adjust-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonComponent, TableTotalsBarComponent],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      header="Ajustement du brouillon"
      [style]="{ width: '56rem' }"
      [draggable]="false"
      [resizable]="false"
      (onShow)="onShow()"
      (onHide)="close()">
      @if (loading()) {
        <p class="status-line">Chargement du brouillon…</p>
      } @else if (loadError()) {
        <p class="status-line status-line--error">{{ loadError() }}</p>
      } @else {
        @if (draft()) {
          @for (line of lines; track line.index; let i = $index) {
            <div class="line-card">
              <div class="grid">
                <label>Produit
                  <input class="ft-input" [value]="line.productName || '— Aucun —'" disabled />
                </label>
                <label class="span-2">Description
                  <input
                    class="ft-input"
                    placeholder="Description"
                    [(ngModel)]="line.designation"
                    [name]="'adjDesc' + i" />
                </label>
                <label>Qté
                  <input
                    class="ft-input"
                    type="number"
                    min="0.001"
                    step="0.001"
                    [(ngModel)]="line.quantity"
                    [name]="'adjQty' + i" />
                </label>
                <label>Prix unitaire HT
                  <input
                    class="ft-input"
                    type="number"
                    min="0"
                    step="0.001"
                    [(ngModel)]="line.unitPriceHT"
                    [name]="'adjPrice' + i" />
                </label>
                <label>TVA %
                  <select
                    class="ft-input"
                    [(ngModel)]="line.vatRate"
                    [name]="'adjVat' + i">
                    @for (rate of vatRates; track rate) {
                      <option [ngValue]="rate">{{ rate }} %</option>
                    }
                  </select>
                </label>
              </div>
            </div>
          }

          <app-table-totals-bar [metrics]="totalsMetrics()"></app-table-totals-bar>
        }
      }

      <ng-template pTemplate="footer">
        <app-button variant="outline" (clicked)="close()" [disabled]="busy()">Annuler</app-button>
        <app-button
          variant="secondary"
          icon="pi-save"
          [disabled]="!canPersist() || busy()"
          (clicked)="save()">
          {{ saving() ? 'Enregistrement…' : 'Enregistrer les modifications' }}
        </app-button>
        <app-button
          variant="primary"
          icon="pi-check"
          [disabled]="!canPersist() || busy()"
          (clicked)="confirmIssue()">
          {{ issuing() ? 'Émission…' : 'Émettre' }}
        </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: var(--spacing-3);
    }

    .span-2 { grid-column: span 2; }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .ft-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-family: inherit;
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
    }

    .ft-input:disabled {
      background: var(--color-background-subtle);
      color: var(--color-text-secondary);
      cursor: not-allowed;
    }

    .line-card {
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
      background: var(--color-background-subtle);
    }

    .status-line { margin: 0; color: var(--color-text-secondary); }
    .status-line--error { color: var(--color-error-600, #b91c1c); }

    app-table-totals-bar { display: block; margin-top: var(--spacing-2); }
  `]
})
export class DraftAdjustDialogComponent {
  @Input() billingRunId: string | null = null;
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() saved = new EventEmitter<void>();
  @Output() issued = new EventEmitter<IssuedRecurringInvoice>();

  private readonly service = inject(RecurringContractService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmation = inject(ConfirmationService);

  private snapshotJson = '';

  readonly draft = signal<AdjustableRecurringDraft | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly issuing = signal(false);
  readonly busy = computed(() => this.loading() || this.saving() || this.issuing());

  lines: EditableDraftLine[] = [];
  readonly vatRates = [0, 7, 13, 19] as const;

  totalsMetrics(): TotalMetric[] {
    const currency = this.draft()?.currency ?? 'TND';
    const live = this.computeLiveTotals();
    return [
      { label: 'Total HT', value: live.ht, format: 'currency', currency, icon: 'pi-calculator', tone: 'primary' },
      { label: 'TVA', value: live.vat, format: 'currency', currency, icon: 'pi-percentage', tone: 'cyan' },
      { label: 'Total TTC', value: live.ttc, format: 'currency', currency, icon: 'pi-wallet', tone: 'emerald' },
      {
        label: 'Estimation mensuelle',
        value: live.monthly,
        format: 'currency',
        currency,
        icon: 'pi-sync',
        tone: 'violet',
        hint: 'Montant de cette échéance ramené au mois'
      }
    ];
  }

  canPersist(): boolean {
    return !!this.draft() && this.lines.length > 0 && this.lines.every(l =>
      Number(l.quantity) > 0
      && Number(l.unitPriceHT) >= 0
      && this.vatRates.includes(Number(l.vatRate) as 0 | 7 | 13 | 19));
  }

  onShow(): void {
    this.load();
  }

  close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  save(): void {
    this.persist().subscribe({
      next: () => {
        this.toast.add({
          severity: 'success',
          summary: 'Brouillon mis à jour',
          detail: 'Les modifications ont été enregistrées. L\'échéance reste en brouillon.'
        });
        this.close();
        this.saved.emit();
      },
      error: err => this.onPersistError('RecurringContracts: adjust draft', err)
    });
  }

  confirmIssue(): void {
    if (!this.canPersist() || !this.billingRunId) return;
    this.confirmation.confirm({
      header: 'Confirmer l\'émission',
      message: 'Une fois validée, cette facture ne pourra plus être modifiée. Confirmer l\'émission ?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Émettre la facture',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-success',
      size: 'md',
      accept: () => this.issue()
    });
  }

  private load(): void {
    if (!this.billingRunId) {
      this.loadError.set('Échéance introuvable.');
      return;
    }

    this.loading.set(true);
    this.loadError.set(null);
    this.draft.set(null);
    this.lines = [];

    this.service.getAdjustableDraft(this.billingRunId).subscribe({
      next: draft => {
        this.draft.set(draft);
        this.lines = draft.lines.map(l => this.toEditable(l));
        this.snapshotJson = this.serializeLines();
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.errorHandler.logError('RecurringContracts: adjustable draft', err);
        this.loadError.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  private persist(): Observable<AdjustableRecurringDraft> {
    if (!this.billingRunId || !this.canPersist()) {
      return throwError(() => new Error('Brouillon non ajustable'));
    }

    this.saving.set(true);
    return this.service.adjustDraftLines(this.billingRunId, this.lines.map(l => ({
      index: l.index,
      designation: (l.designation ?? '').trim(),
      quantity: Number(l.quantity),
      unitPriceHT: Number(l.unitPriceHT),
      vatRate: Number(l.vatRate)
    }))).pipe(
      tap(updated => {
        this.draft.set(updated);
        this.lines = updated.lines.map(l => this.toEditable(l));
        this.snapshotJson = this.serializeLines();
        this.saving.set(false);
      })
    );
  }

  private issue(): void {
    if (!this.billingRunId) return;
    const runId = this.billingRunId;

    const runIssue = (): void => {
      this.issuing.set(true);
      this.service.issueBillingRun(runId).subscribe({
        next: issued => {
          this.issuing.set(false);
          this.toast.add({
            severity: 'success',
            summary: 'Facture émise',
            detail: `Facture ${issued.invoiceNumber} émise.`
          });
          this.close();
          this.issued.emit(issued);
        },
        error: err => {
          this.issuing.set(false);
          this.errorHandler.logError('RecurringContracts: issue from adjust modal', err);
          this.toast.add({
            severity: 'error',
            summary: 'Émission impossible',
            detail: this.errorHandler.extractErrorMessage(err)
          });
        }
      });
    };

    if (this.isDirty()) {
      this.persist().subscribe({
        next: () => runIssue(),
        error: err => this.onPersistError('RecurringContracts: adjust before issue', err)
      });
      return;
    }

    runIssue();
  }

  private isDirty(): boolean {
    return this.serializeLines() !== this.snapshotJson;
  }

  private serializeLines(): string {
    return JSON.stringify(this.lines.map(l => ({
      index: l.index,
      designation: (l.designation ?? '').trim(),
      quantity: Number(l.quantity),
      unitPriceHT: Number(l.unitPriceHT),
      vatRate: Number(l.vatRate)
    })));
  }

  private toEditable(line: AdjustableRecurringDraftLine): EditableDraftLine {
    return {
      index: line.index,
      productId: line.productId ?? null,
      productName: line.productName ?? null,
      designation: line.designation ?? '',
      quantity: line.quantity,
      unitPriceHT: line.unitPriceHT,
      vatRate: line.vatRate,
      fodecApplicable: line.fodecApplicable
    };
  }

  private computeLiveTotals(): { ht: number; vat: number; ttc: number; monthly: number } {
    let ht = 0;
    let vat = 0;
    let ttc = 0;
    for (const line of this.lines) {
      const lineHt = roundTnd(Number(line.quantity || 0) * Number(line.unitPriceHT || 0));
      const amounts = calculateLineFodecAmounts(
        lineHt,
        Number(line.vatRate || 0),
        line.fodecApplicable,
        DEFAULT_FODEC_RATE_PERCENT
      );
      ht = roundTnd(ht + lineHt);
      vat = roundTnd(vat + amounts.vatAmount);
      ttc = roundTnd(ttc + amounts.totalTTC);
    }
    const frequency = this.draft()?.contractBillingFrequency ?? 'Monthly';
    return { ht, vat, ttc, monthly: periodAmountMonthlyEstimate(ht, frequency) };
  }

  private onPersistError(context: string, err: unknown): void {
    this.saving.set(false);
    this.issuing.set(false);
    this.errorHandler.logError(context, err);
    this.toast.add({
      severity: 'error',
      summary: 'Enregistrement impossible',
      detail: this.errorHandler.extractErrorMessage(err)
    });
  }
}
