/// <reference types="@angular/localize" />
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { PaginatorModule } from 'primeng/paginator';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { RecordPaymentDialogComponent } from '@shared/components/record-payment-dialog/record-payment-dialog.component';
import { InvoicePaymentsPanelComponent } from '@shared/components/invoice-payments-panel/invoice-payments-panel.component';
import { InvoiceService, InvoiceListItem } from '@core/services/invoice.service';
import { SupplierInvoiceService, SupplierInvoiceListItem, isSupplierInvoicePaid } from '@core/services/supplier-invoice.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { formatLocalDate } from '@core/utils/date.util';
import { Subscription } from 'rxjs';

export type PaymentViewType = 'client' | 'supplier';

export interface PaymentListItem {
  id: string;
  type: 'client' | 'supplier';
  number: string;
  counterpartyName: string;
  issueDate: string;
  dueDate: string | null;
  totalAmount: number;
  currency: string;
  status: string;
  statusCssClass?: string;
  paidAt: string | null;
  isOverdue: boolean;
  detailRoute: string[];
  totalPaid?: number;
  remainingAmount?: number;
}

const CLIENT_STATUS_OPTIONS: { label: string; value: string | null }[] = [
  { label: $localize`:@@payments.client.filter.tous:Tous les statuts`, value: null },
  { label: $localize`:@@payments.client.filter.payee:Payée`, value: 'Payée' },
  { label: $localize`:@@payments.client.filter.partielle:Partiellement payée`, value: 'Partiellement payée' },
  { label: $localize`:@@payments.client.filter.attente:En attente`, value: 'En attente' },
  { label: $localize`:@@payments.client.filter.signee:Signée`, value: 'Signée' },
  { label: $localize`:@@payments.client.filter.validee:Validée`, value: 'Validée' },
  { label: $localize`:@@payments.client.filter.brouillon:Brouillon`, value: 'Brouillon' },
  { label: $localize`:@@payments.client.filter.retard:En retard`, value: 'En retard' }
];

const SUPPLIER_STATUS_OPTIONS: { label: string; value: string | null }[] = [
  { label: $localize`:@@payments.supplier.filter.tous:Tous les statuts`, value: null },
  { label: $localize`:@@payments.supplier.filter.payee:Payée`, value: 'Payée' },
  { label: $localize`:@@payments.supplier.filter.partielle:Partiellement payée`, value: 'Partiellement payée' },
  { label: $localize`:@@payments.supplier.filter.attente:En attente`, value: 'En attente' }
];

@Component({
  selector: 'app-payments',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    DatePickerModule,
    PaginatorModule,
    TooltipModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent,
    StatusBadgeComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    RecordPaymentDialogComponent,
    InvoicePaymentsPanelComponent
  ],
  template: `
    <app-page-header 
      [title]="pageTitle()" 
      [subtitle]="pageSubtitle()">
    </app-page-header>

    <!-- Statistics Cards -->
    @if (loading()) {
      <div class="stats-grid">
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
      </div>
    } @else {
      <div class="stats-grid">
        <app-stat-card
          label="Total payé" i18n-label="Total payé"
          [value]="totalPaid()"
          icon="pi-dollar"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="En attente" i18n-label="En attente"
          [value]="pendingAmount()"
          icon="pi-clock"
          variant="warning">
        </app-stat-card>
        <app-stat-card
          label="Factures payées" i18n-label="Factures payées"
          [value]="paidCount()"
          icon="pi-check-circle"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="En retard" i18n-label="En retard"
          [value]="overdueCount()"
          icon="pi-exclamation-triangle"
          variant="error">
        </app-stat-card>
      </div>
    }

    <!-- Filters -->
    <div class="filters-card">
      <div class="filters-header">
        <h3 class="filters-title" i18n="@@payments.payments.filtres.2a8e76e0">Filtres</h3>
        @if (hasActiveFilters()) {
          <button 
            class="filters-reset" 
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="Réinitialiser les filtres">
            <i class="pi pi-times"></i>
            Réinitialiser
          </button>
        }
      </div>
      <div class="filters-row">
        <span class="p-input-icon-left">
          <i class="pi pi-search"></i>
          <input 
            pInputText 
            type="text" 
            [placeholder]="searchPlaceholder()" 
            [ngModel]="searchTerm()"
            (ngModelChange)="searchTerm.set($event)">
        </span>

        <p-select 
          [options]="statusOptions()" 
          [(ngModel)]="selectedStatus"
          placeholder="Tous les statuts" i18n-placeholder="Tous les statuts"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>

        <p-datepicker 
          [(ngModel)]="dateRange" 
          selectionMode="range"
          [readonlyInput]="true"
          placeholder="Période" i18n-placeholder="Période"
          dateFormat="dd/mm/yy"
          (onSelect)="onFilterChange()"
          [showClear]="true">
        </p-datepicker>
      </div>
    </div>

    <!-- Payments Table -->
    @if (initialLoad()) {
      <app-skeleton-table 
        [rows]="10" 
        [columns]="skeletonColumns">
      </app-skeleton-table>
    } @else {
      <p-table 
          [loading]="loading()" 
        [value]="filteredPayments()" 
        styleClass="p-datatable-sm payments-table"
        [paginator]="true"
        [rows]="pageSize"
        [rowsPerPageOptions]="[10, 25, 50, 100]"
        [totalRecords]="totalRecords()"
        (onPage)="onPageChange($event)"
        [lazy]="false">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 160px" i18n="@@payments.payments.numero.facture.3b95a188">Numéro facture</th>
            <th i18n="@@payments.payments.contrepartie.3dc41f76">Contrepartie</th>
            <th style="width: 110px" i18n="@@payments.payments.date.emission.ce5148a7">Date émission</th>
            <th style="width: 110px" i18n="@@payments.payments.date.echeance.ca5badb1">Date échéance</th>
            <th style="width: 130px" class="text-right" i18n="@@payments.payments.montant.4adcd9fc">Montant</th>
            <th style="width: 120px" i18n="@@payments.payments.statut.659499f3">Statut</th>
            <th style="width: 110px" i18n="@@payments.payments.date.paiement.715f33be">Date paiement</th>
            <th style="width: 100px"></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-payment>
          <tr [routerLink]="payment.detailRoute" class="table-row">
            <td>
              <a [routerLink]="payment.detailRoute" class="invoice-link" (click)="$event.stopPropagation()">
                {{ payment.number }}
              </a>
            </td>
            <td>
              <span class="counterparty-name">{{ payment.counterpartyName }}</span>
            </td>
            <td>
              <span class="invoice-date">{{ payment.issueDate | date:'dd/MM/yyyy' }}</span>
            </td>
            <td>
              <span class="invoice-date" [class.overdue]="payment.isOverdue">
                {{ payment.dueDate ? (payment.dueDate | date:'dd/MM/yyyy') : '-' }}
              </span>
            </td>
            <td class="amount text-right">{{ payment.totalAmount | number:'1.3-3' }} {{ payment.currency }}</td>
            <td>
              <app-status-badge 
                [status]="getStatusBadgeStatus(payment.status)"
                [label]="payment.status">
              </app-status-badge>
            </td>
            <td>
              <span class="payment-date" *ngIf="payment.paidAt">
                {{ payment.paidAt | date:'dd/MM/yyyy' }}
              </span>
              <span class="payment-date-empty" *ngIf="!payment.paidAt">-</span>
            </td>
            <td>
              <div class="row-actions">
                <app-button
                  variant="ghost"
                  size="sm"
                  icon="pi-list"
                  [iconOnly]="true"
                  [iconAlwaysVisible]="true"
                  pTooltip="Voir les paiements" i18n-pTooltip="Voir les paiements"
                  ariaLabel="Voir les paiements de la facture"
                  (click)="openPaymentsPanel(payment); $event.stopPropagation()">
                </app-button>
                @if (canRecordPayment(payment)) {
                  <app-button 
                    variant="primary"
                    size="sm"
                    icon="pi-wallet"
                    [iconOnly]="true"
                    pTooltip="Enregistrer un paiement" i18n-pTooltip="Enregistrer un paiement"
                    ariaLabel="Enregistrer un paiement"
                    (click)="openRecordPaymentDialog(payment); $event.stopPropagation()">
                  </app-button>
                }
                <app-button 
                  variant="ghost"
                  size="sm"
                  icon="pi-eye"
                  [iconOnly]="true"
                  [iconAlwaysVisible]="true"
                  [routerLink]="payment.detailRoute"
                  pTooltip="Voir la facture" i18n-pTooltip="Voir la facture"
                  ariaLabel="Voir la facture"
                  (click)="$event.stopPropagation()">
                </app-button>
              </div>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="8" class="text-center p-4">
              <app-empty-state
                illustration="empty-payments.svg"
                title="Aucun paiement trouvé" i18n-title="Aucun paiement trouvé"
                description="Aucun paiement ne correspond à vos critères de recherche."
                actionLabel="Voir toutes les factures"
                [actionRoute]="emptyStateActionRoute()">
              </app-empty-state>
            </td>
          </tr>
        </ng-template>
      </p-table>
    }

    @if (showPaymentsPanel && selectedPaymentForPanel()) {
      <app-invoice-payments-panel
        [invoice]="selectedPaymentForPanel()!"
        (closed)="showPaymentsPanel = false; selectedPaymentForPanel.set(null)"
        (paymentRecorded)="onPaymentRecordedFromPanel()">
      </app-invoice-payments-panel>
    }

    <app-record-payment-dialog
      [(visible)]="recordPaymentDialogVisible"
      [invoiceId]="selectedPaymentForDialog()?.id ?? ''"
      [invoiceNumber]="selectedPaymentForDialog()?.number ?? ''"
      [totalAmount]="selectedPaymentForDialog()?.totalAmount ?? 0"
      [totalPaid]="selectedPaymentForDialog()?.totalPaid ?? 0"
      [remainingAmount]="selectedPaymentForDialog()?.remainingAmount ?? selectedPaymentForDialog()?.totalAmount ?? 0"
      [currency]="selectedPaymentForDialog()?.currency ?? loc_ui_tern_tnd_51da21"
      [invoiceType]="selectedPaymentForDialog()?.type ?? 'client'"
      (paymentRecorded)="onPaymentRecorded()">
    </app-record-payment-dialog>
  `,
  styles: [`
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      animation: fadeInUp 0.4s ease-out;
    }

    .stat-skeleton {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      height: 120px;
      border: 1px solid var(--color-border-subtle);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .filters-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
    }

    .filters-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-4);
    }

    .filters-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0;
    }

    .filters-reset {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      background: transparent;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .filters-reset:hover {
      background: var(--color-neutral-50);
      border-color: var(--color-primary-500);
      color: var(--color-primary-600);
    }

    .filters-row {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      gap: var(--spacing-3);
    }

    .p-input-icon-left {
      width: 100%;
      position: relative;
    }

    .p-input-icon-left i {
      position: absolute;
      left: var(--spacing-3);
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-text-secondary);
    }

    .p-input-icon-left input {
      width: 100%;
      padding-left: var(--spacing-8);
    }

    /* Table improvements */
    :host ::ng-deep .payments-table {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
      overflow: hidden;

      .p-datatable-thead > tr > th {
        background: var(--color-neutral-50);
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 2px solid var(--color-border-default);
        position: sticky;
        top: 0;
        z-index: 1;
      }

      .p-datatable-tbody > tr.table-row {
        transition: all var(--transition-fast);
        cursor: pointer;
        border-left: 3px solid transparent;
      }

      .p-datatable-tbody > tr.table-row:hover {
        background: linear-gradient(90deg, var(--color-primary-50) 0%, transparent 100%);
        border-left-color: var(--color-primary-500);
        transform: translateX(4px);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
      }

      .p-datatable-tbody > tr.table-row > td {
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 1px solid var(--color-border-subtle);
        vertical-align: middle;
      }

      .p-datatable-tbody > tr.table-row:last-child > td {
        border-bottom: none;
      }
    }

    .counterparty-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .row-actions {
      display: flex;
      gap: var(--spacing-1);
      align-items: center;
    }

    .invoice-date {
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }

    .invoice-date.overdue {
      color: var(--color-error-600);
      font-weight: var(--font-weight-semibold);
    }

    .text-right {
      text-align: right;
    }

    .invoice-link {
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      text-decoration: none;
      transition: all var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
    }

    .invoice-link:hover {
      color: var(--color-primary-700);
      text-decoration: underline;
    }

    .invoice-link::before {
      content: '#';
      opacity: 0.5;
      font-weight: var(--font-weight-normal);
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      font-size: var(--font-size-base);
    }

    .payment-date {
      color: var(--color-success-600);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
    }

    .payment-date-empty {
      color: var(--color-text-tertiary);
      font-size: var(--font-size-sm);
    }

    /* Responsive adjustments */
    @media (max-width: 1024px) {
      .filters-row {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .stats-grid {
        grid-template-columns: 1fr;
        gap: var(--spacing-3);
      }

      .filters-card {
        padding: var(--spacing-3);
      }
    }
  `]
})
export class PaymentsComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_tnd_51da21 = $localize`:@@ui.tern.tnd.51da21:TND`;
  private invoiceService = inject(InvoiceService);
  private supplierInvoiceService = inject(SupplierInvoiceService);
  private toastService = inject(ToastService);
  private route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private routeDataSubscription: Subscription | null = null;

  paymentType = signal<PaymentViewType>('client');
  loading = signal(true);
  initialLoad = signal(true);
  payments = signal<PaymentListItem[]>([]);
  searchTerm = signal('');
  selectedStatus: string | null = null;
  dateRange: Date[] | null = null;
  pageSize = 10;
  currentPage = 0;
  recordPaymentDialogVisible = false;
  selectedPaymentForDialog = signal<PaymentListItem | null>(null);
  showPaymentsPanel = false;
  selectedPaymentForPanel = signal<PaymentListItem | null>(null);

  pageTitle = computed(() =>
    this.paymentType() === 'client' ? $localize`:@@ui.tern.paiements.clients.79a7e3:Paiements clients` : $localize`:@@ui.tern.paiements.fournisseurs.416577:Paiements fournisseurs`
  );

  pageSubtitle = computed(() =>
    this.paymentType() === 'client'
      ? $localize`:@@ui.tern.suivez.et.gerez.les.paiements.de.vos.factu.e2c239:Suivez et gérez les paiements de vos factures clients. Cliquez sur une facture pour voir les détails, ou sur l'icône paiement pour enregistrer directement.`
      : $localize`:@@ui.tern.suivez.et.gerez.les.paiements.de.vos.factu.14dc96:Suivez et gérez les paiements de vos factures fournisseurs. Cliquez sur une facture pour voir les détails, ou sur l'icône paiement pour enregistrer directement.`
  );

  searchPlaceholder = computed(() =>
    this.paymentType() === 'client'
      ? $localize`:@@ui.tern.rechercher.par.numero.client.3adaec:Rechercher par numéro, client...`
      : $localize`:@@ui.tern.rechercher.par.numero.fournisseur.ee355a:Rechercher par numéro, fournisseur...`
  );

  statusOptions = computed(() =>
    this.paymentType() === 'client' ? CLIENT_STATUS_OPTIONS : SUPPLIER_STATUS_OPTIONS
  );

  emptyStateActionRoute = computed(() =>
    this.paymentType() === 'client' ? '/invoices' : '/supplier-invoices'
  );

  skeletonColumns: SkeletonColumn[] = [
    { width: '160px' },
    { width: '180px' },
    { width: '100px' },
    { width: '100px' },
    { width: '120px' },
    { width: '100px' },
    { width: '100px' },
    { width: '100px' }
  ];

  ngOnInit(): void {
    const data = this.route.snapshot.data as { paymentType?: PaymentViewType };
    if (data.paymentType) {
      this.paymentType.set(data.paymentType);
    }
    this.routeDataSubscription = this.route.data.subscribe((data: { paymentType?: PaymentViewType }) => {
      if (data.paymentType) {
        this.paymentType.set(data.paymentType);
        this.loadPayments();
      }
    });
    this.loadPayments();
  }

  ngOnDestroy(): void {
    this.routeDataSubscription?.unsubscribe();
  }

  loadPayments(): void {
    this.loading.set(true);
    const type = this.paymentType();

    if (type === 'client') {
      const params: Record<string, unknown> = { pageSize: 1000 };
      if (this.selectedStatus !== null) {
        const clientStatusMap: Record<string, number> = {
          'Payée': 4, 'Partiellement payée': 5, 'Signée': 2, 'Validée': 1, 'Brouillon': 0, 'En retard': 6
        };
        const numStatus = clientStatusMap[this.selectedStatus];
        if (numStatus !== undefined) params['status'] = numStatus;
      }
      if (this.dateRange && this.dateRange.length === 2) {
        params['fromDate'] = formatLocalDate(this.dateRange[0]);
        params['toDate'] = formatLocalDate(this.dateRange[1]);
      }
      this.invoiceService.getInvoices(params as import('@core/services/invoice.service').InvoiceSearchParams).subscribe({
        next: (res: { success: boolean; data?: { items: InvoiceListItem[] } }) => {
          const items = res.success && res.data
            ? this.mapClientInvoicesToPayments(res.data.items).sort(
                (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()
              )
            : [];
          this.payments.set(items);
          this.loading.set(false);
          this.initialLoad.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.initialLoad.set(false);
        }
      });
    } else {
      const params: Record<string, unknown> = { pageSize: 1000 };
      if (this.selectedStatus !== null) {
        if (this.selectedStatus === 'Payée') params['status'] = 1;
        else if (this.selectedStatus === 'En attente') params['status'] = 0;
        else if (this.selectedStatus === 'Partiellement payée') params['status'] = 3;
      }
      if (this.dateRange && this.dateRange.length === 2) {
        params['fromDate'] = formatLocalDate(this.dateRange[0]);
        params['toDate'] = formatLocalDate(this.dateRange[1]);
      }
      this.supplierInvoiceService.getSupplierInvoices(params as import('@core/services/supplier-invoice.service').SupplierInvoiceSearchParams).subscribe({
        next: (res: { success: boolean; data?: { items: SupplierInvoiceListItem[] } }) => {
          const items = res.success && res.data
            ? this.mapSupplierInvoicesToPayments(res.data.items).sort(
                (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()
              )
            : [];
          this.payments.set(items);
          this.loading.set(false);
          this.initialLoad.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.initialLoad.set(false);
        }
      });
    }
  }

  private mapClientInvoicesToPayments(invoices: InvoiceListItem[]): PaymentListItem[] {
    return invoices.map(inv => ({
      id: inv.id,
      type: 'client' as const,
      number: inv.number,
      counterpartyName: inv.clientName,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      totalAmount: inv.totalAmount,
      currency: inv.currency,
      status: inv.status,
      statusCssClass: inv.statusCssClass,
      paidAt: inv.paidAt ?? null,
      isOverdue: inv.isOverdue,
      detailRoute: ['/invoices', inv.id],
      totalPaid: inv.totalPaid,
      remainingAmount: inv.remainingAmount
    }));
  }

  private mapSupplierInvoicesToPayments(invoices: SupplierInvoiceListItem[]): PaymentListItem[] {
    return invoices.map(inv => {
      const isPaid = isSupplierInvoicePaid(inv.status);
      const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
      const isOverdue = dueDate ? dueDate < new Date() && !isPaid : false;
      return {
        id: inv.id,
        type: 'supplier' as const,
        number: inv.invoiceNumber,
        counterpartyName: inv.supplierName,
        issueDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        totalAmount: inv.totalTTC,
        currency: 'TND',
        status: inv.statusDisplay,
        statusCssClass: inv.statusCss,
        paidAt: inv.paidAt ?? null,
        isOverdue,
        detailRoute: ['/supplier-invoices', inv.id],
        totalPaid: inv.totalPaid,
        remainingAmount: inv.remainingAmount
      };
    });
  }

  onSearch(): void {
    // La recherche est gérée par le computed filteredPayments
  }

  onFilterChange(): void {
    this.loadPayments();
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus = null;
    this.dateRange = null;
    this.loadPayments();
  }

  onPageChange(event: any): void {
    this.currentPage = event.page;
    this.pageSize = event.rows;
  }

  hasActiveFilters = computed(() => {
    return this.searchTerm().length > 0 ||
           this.selectedStatus !== null ||
           (this.dateRange !== null && this.dateRange.length === 2);
  });

  filteredPayments = computed(() => {
    let filtered = this.payments();
    const search = this.searchTerm().toLowerCase();
    const status = this.selectedStatus;

    if (search) {
      filtered = filtered.filter(p =>
        p.number.toLowerCase().includes(search) ||
        p.counterpartyName.toLowerCase().includes(search)
      );
    }

    if (status !== null) {
      filtered = filtered.filter(p => p.status === status);
    }

    return filtered;
  });

  totalRecords = computed(() => {
    return this.filteredPayments().length;
  });

  // Statistiques calculées
  totalPaid = computed(() => {
    const payments = this.payments();
    const paid = payments.filter(p => p.paidAt != null);
    const total = paid.reduce((sum, p) => sum + p.totalAmount, 0);
    const currency = payments.length > 0 ? payments[0].currency : 'TND';
    const formatted = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(total);
    return `${formatted} ${currency}`;
  });

  pendingAmount = computed(() => {
    const payments = this.payments();
    const pending = payments.filter(p => p.paidAt == null);
    const total = pending.reduce((sum, p) => sum + p.totalAmount, 0);
    const currency = payments.length > 0 ? payments[0].currency : 'TND';
    const formatted = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(total);
    return `${formatted} ${currency}`;
  });

  paidCount = computed(() => {
    return this.payments().filter(p => p.paidAt != null).length;
  });

  overdueCount = computed(() => {
    return this.payments().filter(p => p.isOverdue).length;
  });

  canRecordPayment(payment: PaymentListItem): boolean {
    if (this.auth.isFirmDelegatedReadonly()) return false;
    if (payment.type === 'client') {
      return ['Signée', 'Validée', 'Partiellement payée', 'En retard'].includes(payment.status);
    }
    return payment.type === 'supplier' && ['En attente', 'Partiellement payée'].includes(payment.status);
  }

  openRecordPaymentDialog(payment: PaymentListItem): void {
    if (this.auth.isFirmDelegatedReadonly()) return;
    this.selectedPaymentForDialog.set(payment);
    this.recordPaymentDialogVisible = true;
  }

  openPaymentsPanel(payment: PaymentListItem): void {
    this.selectedPaymentForPanel.set(payment);
    this.showPaymentsPanel = true;
  }

  onPaymentRecordedFromPanel(): void {
    this.toastService.add({
      severity: 'success',
      summary: $localize`:@@payments.component.summary.Succès:Succès`,
      detail: $localize`:@@payments.component.detail.Paiement_enregis:Paiement enregistré avec succès`
    });
    this.loadPayments();
  }

  onPaymentRecorded(): void {
    this.toastService.add({
      severity: 'success',
      summary: $localize`:@@payments.component.summary.Succès:Succès`,
      detail: $localize`:@@payments.component.detail.Paiement_enregis:Paiement enregistré avec succès`
    });
    this.selectedPaymentForDialog.set(null);
    this.loadPayments();
  }

  getStatusBadgeStatus(status: string): 'paid' | 'pending' | 'overdue' | 'draft' | 'sent' | 'cancelled' | 'validated' | 'signed' {
    const statusMap: Record<string, 'paid' | 'pending' | 'overdue' | 'draft' | 'sent' | 'cancelled' | 'validated' | 'signed'> = {
      'Payée': 'paid',
      'Partiellement payée': 'pending',
      'VALIDÉE': 'validated',
      'Validée': 'validated',
      'Signée': 'signed',
      'En attente': 'pending',
      'En retard': 'overdue',
      'Brouillon': 'draft',
      'Annulée': 'cancelled'
    };
    return statusMap[status] || 'draft';
  }
}
