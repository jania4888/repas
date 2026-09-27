import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { ReportsApiService } from '@core/services/reports-api.service';
import {
  PartyBalancesTableComponent,
  PartyBalanceRow
} from '../shared/party-balances-table.component';
import {
  buildPartyBalanceSummaryMetrics,
  exportPartyBalancesCsv,
  filterPartyBalanceRows,
  mapSupplierBalanceRows
} from '../shared/party-balances.util';

@Component({
  selector: 'app-supplier-balances',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    TableTotalsBarComponent,
    PartyBalancesTableComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Solde par fournisseur" i18n-title="@@reports.supplier-balances.solde.par.fournisseur.7b26b81c"
      subtitle="Solde commercial (facturé − payé) par fournisseur">
      <app-button
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        (click)="onPrint()"
        ariaLabel="Imprimer les soldes fournisseurs" i18n="@@reports.supplier-balances.imprimer.5382c09d"> Imprimer </app-button>
      <app-button
        variant="secondary"
        icon="pi-download"
        iconPos="left"
        (click)="onExport()"
        ariaLabel="Exporter les soldes fournisseurs en CSV" i18n="@@reports.supplier-balances.exporter.0cd84bdc"> Exporter </app-button>
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button class="ft-filters__reset" (click)="resetFilters()" aria-label="Réinitialiser les filtres" i18n-aria-label="@@reports.supplier-balances.reinitialiser.les.filtres.d8915f02">
            <i class="pi pi-times"></i>
            Réinitialiser
          </button>
        }
      </div>
      <div class="ft-filters__row">
        <span class="p-input-icon-left">
          <i class="pi pi-search"></i>
          <input
            type="text"
            class="filter-input"
            placeholder="Rechercher un fournisseur..." i18n-placeholder="@@reports.supplier-balances.rechercher.un.fournisseur.95eafd92"
            [ngModel]="search()"
            (ngModelChange)="search.set($event)"
            aria-label="Rechercher un fournisseur" i18n-aria-label="@@reports.supplier-balances.rechercher.un.fournisseur.c3611217" />
        </span>
        <label class="filter-toggle">
          <input
            type="checkbox"
            [ngModel]="hideZeroBalances()"
            (ngModelChange)="hideZeroBalances.set($event)" />
          Masquer les soldes à zéro
        </label>
      </div>
    </div>

    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

    <div class="ft-table-card" id="print-area">
      <app-party-balances-table
        [rows]="filteredRows()"
        [loading]="loading()"
        partyLabel="Fournisseur"
        [showActions]="true"
        emptyMessage="Aucun solde fournisseur" i18n-emptyMessage="@@reports.supplier-balances.aucun.solde.fournisseur.6ed70d5f"
        ariaLabel="Soldes par fournisseur"
        (viewInvoices)="onViewInvoices($event)"
        (viewParty)="onViewParty($event)">
      </app-party-balances-table>
    </div>
  `,
  styles: [`
    .filter-input {
      width: 100%;
      min-width: 220px;
      padding: var(--spacing-2) var(--spacing-3) var(--spacing-2) var(--spacing-8);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
    }
    .filter-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      white-space: nowrap;
      cursor: pointer;
    }
    .ft-table-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4);
      border: 1px solid var(--color-border-subtle);
      box-shadow: var(--shadow-sm);
    }
    @media print {
      :host ::ng-deep app-breadcrumb,
      :host ::ng-deep app-page-header,
      :host ::ng-deep .ft-filters,
      :host ::ng-deep .actions-cell { display: none !important; }
    }
  `]
})
export class SupplierBalancesComponent implements OnInit {
  private readonly reportsApi = inject(ReportsApiService);
  private readonly router = inject(Router);

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Accueil', route: '/' },
    { label: 'Achats', route: '/supplier-invoices' },
    { label: 'Solde par fournisseur' }
  ];

  loading = signal(true);
  allRows = signal<PartyBalanceRow[]>([]);
  search = signal('');
  hideZeroBalances = signal(true);

  filteredRows = computed(() =>
    filterPartyBalanceRows(this.allRows(), this.search(), this.hideZeroBalances())
  );

  summaryMetrics = computed(() => buildPartyBalanceSummaryMetrics(this.filteredRows()));

  ngOnInit(): void {
    this.load();
  }

  hasActiveFilters(): boolean {
    return this.search().trim().length > 0 || !this.hideZeroBalances();
  }

  resetFilters(): void {
    this.search.set('');
    this.hideZeroBalances.set(true);
  }

  onExport(): void {
    exportPartyBalancesCsv(this.filteredRows(), 'Fournisseur', 'soldes-fournisseurs');
  }

  onPrint(): void {
    window.print();
  }

  onViewInvoices(row: PartyBalanceRow): void {
    void this.router.navigate(['/supplier-invoices/unpaid'], {
      queryParams: { supplierId: row.partyId }
    });
  }

  onViewParty(row: PartyBalanceRow): void {
    void this.router.navigate(['/suppliers', row.partyId]);
  }

  private load(): void {
    this.loading.set(true);
    this.reportsApi.getSupplierBalances().subscribe({
      next: (res) => {
        this.allRows.set(res.success && res.data ? mapSupplierBalanceRows(res.data) : []);
        this.loading.set(false);
      },
      error: () => {
        this.allRows.set([]);
        this.loading.set(false);
      }
    });
  }
}
