/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { CheckboxModule } from 'primeng/checkbox';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import {
  SalesOrderService,
  SalesOrderListItem,
  SalesOrderListSummary,
  SalesOrderStatus,
  SalesOrderSearchParams
} from '@core/services/sales-order.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface StatusOption {
  label: string;
  value: SalesOrderStatus | null;
}

@Component({
  selector: 'app-sales-order-list',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TagModule,
    TooltipModule,
    CheckboxModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Commandes clients" i18n-title="@@sales-orders.sales-order-list.commandes.clients.928f824a"
      subtitle="L'engagement ferme entre le devis et la livraison. Le carnet mesure ce qui reste à livrer." i18n-subtitle="@@sales-orders.sales-order-list.l.engagement.ferme.entre.le.devis.et.la.6c0250a2">
      <app-button variant="secondary" icon="pi-list" iconPos="left" routerLink="backlog" i18n="@@sales-orders.sales-order-list.carnet.de.commandes.ec641454"> Carnet de commandes </app-button>
      @if (canCreate()) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" routerLink="new" i18n="@@sales-orders.sales-order-list.nouvelle.commande.061f365b"> Nouvelle commande </app-button>
      }
    </app-page-header>

    <!-- Filtres -->
    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@sales-orders.sales-order-list.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
      </div>

      <div class="ft-filters__row">
        <div class="ft-field">
          <label for="so-search" i18n="@@sales-orders.sales-order-list.recherche.787b5492">Recherche</label>
          <input
            id="so-search"
            pInputText
            [(ngModel)]="searchTerm"
            (keyup.enter)="applyFilters()"
            placeholder="N° de commande, référence, client" i18n-placeholder="@@sales-orders.sales-order-list.n.de.commande.reference.client.737d086c" />
        </div>

        <div class="ft-field">
          <label for="so-status" i18n="@@sales-orders.sales-order-list.statut.659499f3">Statut</label>
          <p-select
            inputId="so-status"
            [options]="statusOptions"
            [(ngModel)]="selectedStatus"
            optionLabel="label"
            optionValue="value"
            (onChange)="applyFilters()"
            appendTo="body"></p-select>
        </div>

        <div class="ft-field">
          <label for="so-from" i18n="@@sales-orders.sales-order-list.du.84814985">Du</label>
          <input id="so-from" type="date" pInputText [(ngModel)]="fromDate" (change)="applyFilters()" />
        </div>

        <div class="ft-field">
          <label for="so-to" i18n="@@sales-orders.sales-order-list.au.7a1732d5">Au</label>
          <input id="so-to" type="date" pInputText [(ngModel)]="toDate" (change)="applyFilters()" />
        </div>

        <div class="ft-field ft-field--inline">
          <p-checkbox
            inputId="so-open"
            [(ngModel)]="openOnly"
            [binary]="true"
            (onChange)="applyFilters()"></p-checkbox>
          <label
            for="so-open"
            pTooltip="Masque les commandes soldées, annulées ou closes : il ne reste que celles qui pèsent sur le carnet." i18n-pTooltip="@@sales-orders.sales-order-list.masque.les.commandes.soldees.annulees.ou.closes.bcce2dba" i18n="@@sales-orders.sales-order-list.en.cours.seulement.e6580b49"> En cours seulement </label>
        </div>

        <div class="ft-field ft-field--actions">
          <app-button variant="secondary" (clicked)="resetFilters()" i18n="@@sales-orders.sales-order-list.reinitialiser.e0e2ad54">Réinitialiser</app-button>
        </div>
      </div>
    </div>

    @if (summary(); as s) {
      <app-table-totals-bar [metrics]="totalMetrics()"></app-table-totals-bar>
    }

    @if (loading()) {
      <app-skeleton-table [columns]="skeletonColumns" [rows]="8"></app-skeleton-table>
    } @else if (orders().length === 0) {
      <app-empty-state
        icon="pi-shopping-cart"
        title="Aucune commande" i18n-title="@@sales-orders.sales-order-list.aucune.commande.3dfe8fbd"
        message="Créez une commande client, ou convertissez un devis accepté." i18n-message="@@sales-orders.sales-order-list.creez.une.commande.client.ou.convertisse.0f1ffc08">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table
          [value]="orders()"
          [rowHover]="true"
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalCount()"
          [first]="(page - 1) * pageSize"
          (onLazyLoad)="onLazyLoad($event)"
          styleClass="ft-table">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@sales-orders.sales-order-list.n.754e6095">N°</th>
              <th i18n="@@sales-orders.sales-order-list.date.eb9a4bc1">Date</th>
              <th i18n="@@sales-orders.sales-order-list.client.1bdd79b1">Client</th>
              <th i18n="@@sales-orders.sales-order-list.livraison.prevue.dc15f458">Livraison prévue</th>
              <th class="ft-num" i18n="@@sales-orders.sales-order-list.total.ttc.9e80ff7c">Total TTC</th>
              <th class="ft-num" i18n="@@sales-orders.sales-order-list.reste.a.livrer.ht.7864f5dd">Reste à livrer HT</th>
              <th i18n="@@sales-orders.sales-order-list.statut.659499f3">Statut</th>
              <th class="ft-actions-col"></th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-order>
            <tr>
              <td>
                <a [routerLink]="[order.id]" class="ft-link">{{ order.number }}</a>
                @if (order.sourceQuoteId) {
                  <i
                    class="pi pi-file-import ft-icon-hint"
                    pTooltip="Issue d'un devis" i18n-pTooltip="@@sales-orders.sales-order-list.issue.d.un.devis.0423cc82"></i>
                }
              </td>
              <td>{{ order.orderDate | date: 'dd/MM/yyyy' }}</td>
              <td>{{ order.clientName }}</td>
              <td>
                @if (order.expectedDeliveryDate) {
                  <span [class.ft-late]="isLate(order)">
                    {{ order.expectedDeliveryDate | date: 'dd/MM/yyyy' }}
                  </span>
                  @if (isLate(order)) {
                    <i
                      class="pi pi-exclamation-triangle ft-icon-warn"
                      pTooltip="Date de livraison dépassée alors qu'il reste à livrer." i18n-pTooltip="@@sales-orders.sales-order-list.date.de.livraison.depassee.alors.qu.il.reste.a.l.1600dd21"></i>
                  }
                } @else {
                  <span class="ft-muted" i18n="@@sales-orders.sales-order-list.text.1b93795b">—</span>
                }
              </td>
              <td class="ft-num">{{ order.totalAmount | number: '1.3-3' }}</td>
              <td class="ft-num">
                @if (order.backlogAmountHt > 0) {
                  <strong>{{ order.backlogAmountHt | number: '1.3-3' }}</strong>
                } @else {
                  <span class="ft-muted" i18n="@@sales-orders.sales-order-list.text.1b93795b">—</span>
                }
              </td>
              <td>
                <p-tag [severity]="statusSeverity(order.status)" [value]="order.statusDisplay | backendLabel"></p-tag>
                @if (order.isStockReserved) {
                  <i
                    class="pi pi-box ft-icon-hint"
                    pTooltip="Stock réservé pour cette commande." i18n-pTooltip="@@sales-orders.sales-order-list.stock.reserve.pour.cette.commande.22553b65"></i>
                }
              </td>
              <td class="ft-actions-col">
                <button
                  pButton
                  type="button"
                  icon="pi pi-eye"
                  class="p-button-text p-button-sm"
                  pTooltip="Ouvrir" i18n-pTooltip="@@sales-orders.sales-order-list.ouvrir.42c07747"
                  [routerLink]="[order.id]"></button>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }
  `
})
export class SalesOrderListComponent implements OnInit {
  private readonly salesOrderService = inject(SalesOrderService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly auth = inject(AuthService);

  readonly orders = signal<SalesOrderListItem[]>([]);
  readonly summary = signal<SalesOrderListSummary | null>(null);
  readonly totalCount = signal(0);
  readonly loading = signal(true);

  searchTerm = '';
  selectedStatus: SalesOrderStatus | null = null;
  fromDate = '';
  toDate = '';
  openOnly = false;
  page = 1;
  pageSize = 20;

  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.salesOrders.create));

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Ventes' },
    { label: 'Commandes clients' }
  ];

  readonly statusOptions: StatusOption[] = [
    { label: $localize`:@@sales-orders.list.filter.tous:Tous`, value: null },
    { label: $localize`:@@sales-orders.list.filter.brouillon:Brouillon`, value: 'Draft' },
    { label: $localize`:@@sales-orders.list.filter.confirmee:Confirmée`, value: 'Confirmed' },
    { label: $localize`:@@sales-orders.list.filter.partielle:Partiellement livrée`, value: 'PartiallyDelivered' },
    { label: $localize`:@@sales-orders.list.filter.livree:Livrée`, value: 'Delivered' },
    { label: $localize`:@@sales-orders.list.filter.soldee:Soldée`, value: 'Completed' },
    { label: $localize`:@@sales-orders.list.filter.annulee:Annulée`, value: 'Cancelled' },
    { label: $localize`:@@sales-orders.list.filter.close:Close`, value: 'Closed' }
  ];

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '12%' },
    { width: '10%' },
    { width: '22%' },
    { width: '12%' },
    { width: '12%' },
    { width: '12%' },
    { width: '15%' },
    { width: '5%' }
  ];

  /**
   * Le carnet est mis en avant : c'est la raison d'être du module. Les totaux viennent du
   * serveur et portent sur tout le jeu filtré, pas sur la page affichée.
   */
  readonly totalMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    if (!s) return [];

    return [
      { label: 'Commandes', value: s.count, format: 'number', icon: 'pi-shopping-cart' },
      { label: 'Total HT', value: s.totalHt, format: 'currency', currency: s.currency },
      { label: 'Total TTC', value: s.totalTtc, format: 'currency', currency: s.currency },
      {
        label: 'Carnet',
        value: s.backlogAmountHt,
        format: 'currency',
        currency: s.currency,
        tone: 'amber',
        icon: 'pi-clock',
        hint: 'Reste à livrer HT'
      },
      { label: 'En cours', value: s.openCount, format: 'number', tone: 'cyan' }
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  private currentParams(): SalesOrderSearchParams {
    return {
      search: this.searchTerm || undefined,
      status: this.selectedStatus,
      fromDate: this.fromDate || null,
      toDate: this.toDate || null,
      openOnly: this.openOnly,
      page: this.page,
      pageSize: this.pageSize
    };
  }

  load(): void {
    this.loading.set(true);
    const params = this.currentParams();

    this.salesOrderService.getSalesOrders(params).subscribe({
      next: res => {
        this.orders.set(res.data?.items ?? []);
        this.totalCount.set(res.data?.totalCount ?? 0);
        this.loading.set(false);
      },
      error: err => {
        this.showError(err, 'Impossible de charger les commandes');
        this.errorHandler.logError('Failed to load sales orders', err);
        this.orders.set([]);
        this.totalCount.set(0);
        this.loading.set(false);
      }
    });

    this.salesOrderService.getSalesOrdersSummary(params).subscribe({
      next: res => this.summary.set(res.data ?? null),
      error: err => {
        // Le bandeau de totaux est un confort : son échec ne doit pas masquer la liste.
        this.errorHandler.logError('Failed to load sales order summary', err);
        this.summary.set(null);
      }
    });
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = null;
    this.fromDate = '';
    this.toDate = '';
    this.openOnly = false;
    this.applyFilters();
  }

  onLazyLoad(event: TableLazyLoadEvent): void {
    const rows = event.rows ?? this.pageSize;
    const first = event.first ?? 0;
    const nextPage = rows ? Math.floor(first / rows) + 1 : 1;

    // PrimeNG déclenche un premier onLazyLoad au montage : sans ce garde, la liste se
    // chargerait deux fois (ngOnInit + ce premier événement).
    if (nextPage === this.page && rows === this.pageSize) return;

    this.page = nextPage;
    this.pageSize = rows;
    this.load();
  }

  isLate(order: SalesOrderListItem): boolean {
    if (!order.expectedDeliveryDate || !order.isOpen) return false;
    return new Date(order.expectedDeliveryDate) < new Date(new Date().toDateString());
  }

  statusSeverity(status: SalesOrderStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    switch (status) {
      case 'Draft':
        return 'secondary';
      case 'Confirmed':
        return 'info';
      case 'PartiallyDelivered':
        return 'warning';
      case 'Delivered':
        return 'info';
      case 'Completed':
        return 'success';
      case 'Cancelled':
        return 'danger';
      case 'Closed':
        return 'secondary';
      default:
        return 'secondary';
    }
  }

  private showError(err: unknown, fallback: string): void {
    const msg = this.errorHandler.extractErrorMessage(err);
    this.toastService.add({ severity: 'error', summary: $localize`:@@sales-order-list.component.summary.Erreur:Erreur`, detail: msg || fallback });
  }
}
