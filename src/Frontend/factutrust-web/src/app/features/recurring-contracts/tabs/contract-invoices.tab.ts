/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, Input, OnChanges, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import {
  LinkedInvoice,
  RecurringContractDetail,
  RecurringContractService
} from '@core/services/recurring-contract.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { invoiceBadgeStatus } from '../recurring-contracts.ui-utils';

/** Onglet « Factures » : factures réellement émises depuis ce contrat (endpoint phase 2). */
@Component({
  selector: 'app-contract-invoices-tab',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule, RouterModule, TableModule,
    ButtonComponent, EmptyStateComponent, StatusBadgeComponent, SkeletonTableComponent
  ],
  template: `
    <div class="section-header">
      <h3>Factures liées</h3>
    </div>

    @if (loading()) {
      <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
    } @else if (invoices() === null) {
      <app-empty-state
        icon="pi-receipt"
        title="Factures liées disponibles prochainement"
        description="La liste des factures liées sera disponible après la mise à jour du serveur."
        [showAction]="false">
      </app-empty-state>
    } @else if (invoices()!.length === 0) {
      <app-empty-state
        icon="pi-receipt"
        title="Aucune facture"
        description="Aucune facture n'a encore été émise depuis ce contrat. Les factures de période s'émettent depuis Brouillons à valider."
        [showAction]="false">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table [value]="invoices()!" styleClass="p-datatable-sm" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th>Numéro</th>
              <th style="width: 120px">Date émission</th>
              <th style="width: 120px">Échéance</th>
              <th style="width: 130px">Total HT</th>
              <th style="width: 130px">Total TTC</th>
              <th style="width: 150px">Statut</th>
              <th style="width: 80px">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-inv>
            <tr>
              <td>
                <a [routerLink]="['/invoices', inv.invoiceId]" class="invoice-number">{{ inv.number }}</a>
                @if (inv.isCreditNote) {
                  <span class="credit-note-tag">Avoir</span>
                }
              </td>
              <td>{{ inv.date | date:'dd/MM/yyyy' }}</td>
              <td>{{ inv.dueDate ? (inv.dueDate | date:'dd/MM/yyyy') : '—' }}</td>
              <td class="amount">{{ inv.amountHT | currency:contract.currency:'symbol':'1.3-3' }}</td>
              <td class="amount">{{ inv.amountTTC | currency:contract.currency:'symbol':'1.3-3' }}</td>
              <td>
                <app-status-badge [status]="invoiceBadgeStatus(inv.status)" [label]="inv.statusDisplay | backendLabel">
                </app-status-badge>
              </td>
              <td>
                <app-button
                  variant="ghost"
                  size="sm"
                  icon="pi-eye"
                  [iconOnly]="true"
                  [routerLink]="['/invoices', inv.invoiceId]"
                  ariaLabel="Voir la facture">
                </app-button>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }
  `,
  styles: [`
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-4);

      h3 { margin: 0; font-size: var(--font-size-lg); color: var(--color-neutral-800); }
    }

    .invoice-number {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      font-size: var(--font-size-sm);
      text-decoration: none;
    }

    .invoice-number:hover { text-decoration: underline; }

    .credit-note-tag {
      margin-left: var(--spacing-2);
      padding: 0 var(--spacing-2);
      border-radius: var(--radius-full);
      background: var(--color-warning-50, #fffbeb);
      color: var(--color-warning-700, #b45309);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-medium);
      white-space: nowrap;
    }
  `]
})
export class ContractInvoicesTabComponent implements OnInit, OnChanges {
  @Input({ required: true }) contract!: RecurringContractDetail;
  @Input() refreshToken = 0;

  private readonly service = inject(RecurringContractService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly invoices = signal<LinkedInvoice[] | null>([]);
  readonly loading = signal(true);
  private initialized = false;

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '140px' }, { width: '120px' }, { width: '120px' }, { width: '130px' }, { width: '130px' }, { width: '150px' }, { width: '80px' }
  ];

  protected readonly invoiceBadgeStatus = invoiceBadgeStatus;

  ngOnInit(): void {
    this.initialized = true;
    this.load();
  }

  ngOnChanges(): void {
    if (this.initialized) this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.getLinkedInvoices(this.contract.id).subscribe({
      next: invoices => {
        this.invoices.set(invoices);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.errorHandler.logError('RecurringContracts: linked invoices', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-invoices.tab.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }
}
