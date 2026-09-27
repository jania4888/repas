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
import { AgingTableComponent } from '../shared/aging-table.component';
import {
  buildPartyBalanceSummaryMetrics,
  exportPartyBalancesCsv,
  filterPartyBalanceRows,
  mapClientBalanceRows
} from '../shared/party-balances.util';

@Component({
  selector: 'app-client-balances',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    TableTotalsBarComponent,
    PartyBalancesTableComponent,
    AgingTableComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Solde par client" i18n-title="@@reports.client-balances.solde.par.client.dc39ad70"
      subtitle="Solde commercial (facturé − payé) par client" i18n-subtitle="@@reports.client-balances.solde.commercial.facture.paye.par.client.fde9bbdf">
      <app-button
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        (click)="onPrint()"
        ariaLabel="Imprimer les soldes clients" i18n-ariaLabel="@@reports.client-balances.imprimer.les.soldes.clients.a58071ed" i18n="@@reports.client-balances.imprimer.5382c09d"> Imprimer </app-button>
      <app-button
        variant="secondary"
        icon="pi-download"
        iconPos="left"
        (click)="onExport()"
        ariaLabel="Exporter les soldes clients en CSV" i18n-ariaLabel="@@reports.client-balances.exporter.les.soldes.clients.en.csv.95521e88" i18n="@@reports.client-balances.exporter.0cd84bdc"> Exporter </app-button>
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@reports.client-balances.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button class="ft-filters__reset" (click)="resetFilters()" aria-label="Réinitialiser les filtres" i18n-aria-label="@@reports.client-balances.reinitialiser.les.filtres.d8915f02" i18n="@@reports.client-balances.reinitialiser.c77ef305">
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
            pInputText
            class="filter-input"
            placeholder="Rechercher un client..." i18n-placeholder="@@reports.client-balances.rechercher.un.client.37880794"
            [ngModel]="search()"
            (ngModelChange)="search.set($event)"
            aria-label="Rechercher un client" i18n-aria-label="@@reports.client-balances.rechercher.un.client.723cebe6" />
        </span>
        <label class="filter-toggle">
          <input
            type="checkbox"
            [ngModel]="hideZeroBalances()"
            (ngModelChange)="hideZeroBalances.set($event)" /><ng-container i18n="@@reports.client-balances.masquer.les.soldes.a.zero.f97078e9">
          Masquer les soldes à zéro
        </ng-container></label>
      </div>
    </div>

    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

    <div class="ft-table-card" id="print-area">
      <app-party-balances-table
        [rows]="filteredRows()"
        [loading]="loading()"
        partyLabel="Client"
        [showActions]="true"
        emptyMessage="Aucun solde client" i18n-emptyMessage="@@reports.client-balances.aucun.solde.client.adab3cf6"
        ariaLabel="Soldes par client" i18n-ariaLabel="@@reports.client-balances.soldes.par.client.c72acad8"
        (viewInvoices)="onViewInvoices($event)"
        (viewParty)="onViewParty($event)">
      </app-party-balances-table>
    </div>

    <!--
      Balance âgée commerciale (lot 6) : ce qui décompose le solde par ancienneté. Muet si le
      backend ne porte pas encore les tranches — un rapport ancien se comporte alors comme
      avant, sans zone vide.
    -->
    <div class="ft-table-card aging-card">
      <h3 class="aging-card__title" i18n="@@reports.client-balances.balance.agee.a.partir.de.la.date.d.echea.85b7d1e0">
        <i class="pi pi-clock"></i> Balance âgée
        <small>À partir de la date d'échéance (DueDate).</small>
      </h3>
      <app-aging-table [rows]="filteredRows()" partyLabel="Client"></app-aging-table>
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
    .aging-card { margin-top: var(--spacing-4); }
    .aging-card__title {
      display: flex; align-items: baseline; gap: var(--spacing-2);
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-base);
      color: var(--color-text-primary);
    }
    .aging-card__title small {
      font-weight: 400;
      color: var(--color-text-secondary);
      font-size: var(--font-size-xs);
    }
    @media print {
      :host ::ng-deep app-breadcrumb,
      :host ::ng-deep app-page-header,
      :host ::ng-deep .ft-filters,
      :host ::ng-deep .actions-cell { display: none !important; }
    }
  `]
})
export class ClientBalancesComponent implements OnInit {
  private readonly reportsApi = inject(ReportsApiService);
  private readonly router = inject(Router);

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@reports.client-balances.ts.accueil.a8ff8fd2:Accueil`, route: '/' },
    { label: $localize`:@@reports.client-balances.ts.ventes.9087fc4f:Ventes`, route: '/invoices' },
    { label: $localize`:@@reports.client-balances.ts.solde.par.client.dc39ad70:Solde par client` }
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
    exportPartyBalancesCsv(this.filteredRows(), 'Client', 'soldes-clients');
  }

  onPrint(): void {
    window.print();
  }

  onViewInvoices(row: PartyBalanceRow): void {
    void this.router.navigate(['/invoices/unpaid'], { queryParams: { clientId: row.partyId } });
  }

  onViewParty(row: PartyBalanceRow): void {
    void this.router.navigate(['/clients', row.partyId]);
  }

  private load(): void {
    this.loading.set(true);
    this.reportsApi.getClientBalances().subscribe({
      next: (res) => {
        this.allRows.set(res.success && res.data ? mapClientBalanceRows(res.data) : []);
        this.loading.set(false);
      },
      error: () => {
        this.allRows.set([]);
        this.loading.set(false);
      }
    });
  }
}
