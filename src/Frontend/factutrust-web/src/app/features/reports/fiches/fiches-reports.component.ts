import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { formatLocalDate } from '@core/utils/date.util';
import { FichesReportsService, FichesReportsData } from '../services/fiches-reports.service';
import { ReportsApiService, ClientBalanceReportRow } from '@core/services/reports-api.service';
import { PartyBalancesTableComponent, PartyBalanceRow } from '../shared/party-balances-table.component';
import { mapClientBalanceRows } from '../shared/party-balances.util';

@Component({
  selector: 'app-fiches-reports',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TableModule,
    TabsModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent,
    PartyBalancesTableComponent
  ],
  template: `
    <app-page-header 
      title="Rapports Fiches" i18n-title="@@reports.fiches.rapports.fiches.e0b32117" 
      subtitle="Analysez vos clients et produits - CA par client, stock par produit" i18n-subtitle="@@reports.fiches.analysez.vos.clients.et.produits.ca.par.bbf10197">
      <app-button 
        variant="secondary"
        icon="pi-download"
        iconPos="left"
        (click)="onExport()" i18n="@@reports.fiches.exporter.0cd84bdc"> Exporter </app-button>
    </app-page-header>

    @if (loading()) {
      <div class="stats-grid">
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
      </div>
    } @else if (reportsData()) {
      <div class="stats-grid">
        <app-stat-card
          label="Nombre de clients" i18n-label="@@reports.fiches.nombre.de.clients.6540723d"
          [value]="reportsData()!.totalClients"
          icon="pi-users"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Nombre de produits" i18n-label="@@reports.fiches.nombre.de.produits.aade46f3"
          [value]="reportsData()!.totalProducts"
          icon="pi-cube"
          variant="primary">
        </app-stat-card>
      </div>

      <p-tabs class="ft-tabs" [lazy]="true">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-users"></i><span i18n="@@reports.fiches.clients.28e22fe3">Clients</span></p-tab>
          <p-tab [value]="1"><i class="pi pi-cube"></i><span i18n="@@reports.fiches.produits.48000473">Produits</span></p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
          <div class="tab-content">
            <div class="section">
              <div class="section-header">
                <h2 class="section-title" i18n="@@reports.fiches.top.clients.par.chiffre.d.affaires.aedddf9b">Top clients par chiffre d'affaires</h2>
                <span class="section-subtitle" i18n="@@reports.fiches.clients.avec.le.plus.de.revenus.generes.6fea69e4">Clients avec le plus de revenus générés</span>
              </div>
              @if (!reportsData()?.topClientsByRevenue?.length) {
                <div class="empty-placeholder">
                  <i class="pi pi-info-circle"></i>
                  <p i18n="@@reports.fiches.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
                  <p class="empty-hint" i18n="@@reports.fiches.les.clients.avec.des.factures.apparaitront.ici.1fd98a6c">Les clients avec des factures apparaîtront ici.</p>
                </div>
              } @else {
                <p-table 
                  [value]="reportsData()!.topClientsByRevenue" 
                  styleClass="p-datatable-sm reports-table"
                  aria-label="Tableau des meilleurs clients" i18n-aria-label="@@reports.fiches.tableau.des.meilleurs.clients.d678aea7">
                  <ng-template pTemplate="header">
                    <tr>
                      <th i18n="@@reports.fiches.client.1bdd79b1">Client</th>
                      <th i18n="@@reports.fiches.code.adac6937">Code</th>
                      <th class="text-right" i18n="@@reports.fiches.factures.da35e4f2">Factures</th>
                      <th class="text-right" i18n="@@reports.fiches.chiffre.d.affaires.0a341b9f">Chiffre d'affaires</th>
                      <th></th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-client>
                    <tr>
                      <td><span class="client-name">{{ client.name }}</span></td>
                      <td><span class="client-code">{{ client.code }}</span></td>
                      <td class="text-right">{{ client.totalInvoices }}</td>
                      <td class="text-right amount">{{ client.totalRevenue | number:'1.3-3' }} {{ reportsData()!.currency }}</td>
                      <td>
                        <app-button 
                          variant="ghost" 
                          size="sm" 
                          icon="pi-eye" 
                          [iconOnly]="true"
                          [routerLink]="['/clients', client.id]"
                          ariaLabel="Voir le client" i18n-ariaLabel="@@reports.fiches.voir.le.client.fd1e4588">
                        </app-button>
                      </td>
                    </tr>
                  </ng-template>
                </p-table>
              }
            </div>
            <div class="section" id="soldes-client">
              <div class="section-header">
                <h2 class="section-title" i18n="@@reports.fiches.soldes.client.ef2e0f4b">Soldes client</h2>
                <span class="section-subtitle" i18n="@@reports.fiches.total.facture.total.paye.et.solde.par.client.4116de44">Total facturé, total payé et solde par client</span>
                <a class="section-link" routerLink="/reports/client-balances" i18n="@@reports.fiches.voir.la.fenetre.dediee.f4185a4c">Voir la fenêtre dédiée</a>
              </div>
              <app-party-balances-table
                [rows]="clientBalanceRows()"
                [loading]="clientBalancesLoading()"
                partyLabel="Client"
                emptyMessage="Aucun solde client" i18n-emptyMessage="@@reports.fiches.aucun.solde.client.adab3cf6"
                ariaLabel="Soldes clients" i18n-ariaLabel="@@reports.fiches.soldes.clients.e8313ea0">
              </app-party-balances-table>
            </div>
          </div>
        </p-tabpanel>

        <p-tabpanel [value]="1">
          <div class="tab-content">
            <div class="section">
              <div class="section-header">
                <h2 class="section-title" i18n="@@reports.fiches.produits.avec.stock.c8b52f24">Produits avec stock</h2>
                <span class="section-subtitle" i18n="@@reports.fiches.produits.ayant.du.stock.tries.par.valeur.76f96dd6">Produits ayant du stock, triés par valeur</span>
              </div>
              @if (!reportsData()?.productsWithStock?.length) {
                <div class="empty-placeholder">
                  <i class="pi pi-info-circle"></i>
                  <p i18n="@@reports.fiches.aucun.produit.avec.du.stock.5f4c0567">Aucun produit avec du stock</p>
                  <p class="empty-hint" i18n="@@reports.fiches.enregistrez.des.mouvements.de.stock.pour.voir.le.3dc6f866">Enregistrez des mouvements de stock pour voir les produits ici.</p>
                </div>
              } @else {
                <p-table 
                  [value]="reportsData()!.productsWithStock" 
                  styleClass="p-datatable-sm reports-table"
                  aria-label="Tableau des produits avec stock" i18n-aria-label="@@reports.fiches.tableau.des.produits.avec.stock.113eac7b">
                  <ng-template pTemplate="header">
                    <tr>
                      <th i18n="@@reports.fiches.produit.ff673dc2">Produit</th>
                      <th i18n="@@reports.fiches.code.adac6937">Code</th>
                      <th i18n="@@reports.fiches.type.3deb7456">Type</th>
                      <th class="text-right" i18n="@@reports.fiches.quantite.09a38fda">Quantité</th>
                      <th class="text-right" i18n="@@reports.fiches.valeur.stock.73676303">Valeur stock</th>
                      <th></th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-product>
                    <tr>
                      <td><span class="product-name">{{ product.name }}</span></td>
                      <td><span class="product-code">{{ product.code }}</span></td>
                      <td>{{ product.category }}</td>
                      <td class="text-right">{{ product.quantityOnHand }}</td>
                      <td class="text-right amount">{{ product.stockValue | number:'1.3-3' }} {{ reportsData()!.currency }}</td>
                      <td>
                        <app-button 
                          variant="ghost" 
                          size="sm" 
                          icon="pi-eye" 
                          [iconOnly]="true"
                          [routerLink]="['/products', product.id, 'edit']"
                          ariaLabel="Voir le produit" i18n-ariaLabel="@@reports.fiches.voir.le.produit.90a3f052">
                        </app-button>
                      </td>
                    </tr>
                  </ng-template>
                </p-table>
              }
            </div>
          </div>
        </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    }
  `,
  styles: [`
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
    }

    .stat-skeleton {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      height: 120px;
      border: 1px solid var(--color-border-subtle);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    .tab-content { padding-top: var(--spacing-4); }

    .section {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
    }

    .section-header {
      margin-bottom: var(--spacing-6);
      padding-bottom: var(--spacing-4);
      border-bottom: 2px solid var(--color-border-subtle);
    }

    .section-title {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin: 0;
    }

    .section-title::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 24px;
      background: linear-gradient(180deg, #6366f1, #4f46e5);
      border-radius: var(--radius-full);
      margin-right: var(--spacing-2);
      vertical-align: middle;
    }

    .section-subtitle { font-size: var(--font-size-sm); color: var(--color-text-secondary); width: 100%; display: block; }
    .section-link {
      display: inline-block;
      margin-top: var(--spacing-2);
      font-size: var(--font-size-sm);
      color: var(--color-primary-600);
      text-decoration: none;
    }
    .section-link:hover { text-decoration: underline; }

    .empty-placeholder {
      padding: var(--spacing-8);
      text-align: center;
      color: var(--color-text-secondary);
    }

    .empty-hint { font-size: var(--font-size-sm); margin-top: var(--spacing-2); opacity: 0.8; }

    .client-name, .product-name { font-weight: var(--font-weight-medium); color: var(--color-text-primary); }
    .client-code, .product-code { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .text-right { text-align: right; }
    .amount { font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }

    :host ::ng-deep .reports-table {
      .p-datatable-thead > tr > th {
        background: var(--color-neutral-50);
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        text-transform: uppercase;
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 2px solid var(--color-border-default);
      }
      .p-datatable-tbody > tr > td { padding: var(--spacing-4) var(--spacing-3); border-bottom: 1px solid var(--color-border-subtle); font-size: var(--font-size-sm); vertical-align: middle; }
      .p-datatable-tbody > tr:hover { background: var(--color-primary-50); }
    }

    @media (max-width: 768px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .section { padding: var(--spacing-4); }
      .section-title { font-size: var(--font-size-xl); }
      .section-title::before { display: none; }
    }
  `]
})
export class FichesReportsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  reportsService = inject(FichesReportsService);
  reportsApi = inject(ReportsApiService);

  loading = signal(true);
  reportsData = signal<FichesReportsData | null>(null);
  clientBalances = signal<ClientBalanceReportRow[]>([]);
  clientBalancesLoading = signal(false);
  clientBalanceRows = computed<PartyBalanceRow[]>(() => mapClientBalanceRows(this.clientBalances()));

  ngOnInit(): void {
    this.loadReportsData();
    this.loadClientBalances();
    this.route.queryParamMap.subscribe(params => {
      if (params.get('tab') === 'soldes-client') {
        setTimeout(() => {
          document.getElementById('soldes-client')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
    });
  }

  private loadClientBalances(): void {
    this.clientBalancesLoading.set(true);
    this.reportsApi.getClientBalances().subscribe({
      next: (res) => {
        this.clientBalances.set(res.success && res.data ? res.data : []);
        this.clientBalancesLoading.set(false);
      },
      error: () => { this.clientBalances.set([]); this.clientBalancesLoading.set(false); }
    });
  }

  loadReportsData(): void {
    this.loading.set(true);
    this.reportsService.loadReportsData().subscribe({
      next: (data) => {
        this.reportsData.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  onExport(): void {
    const data = this.reportsData();
    if (!data) return;

    const rows: string[][] = [];
    rows.push(['Rapports Fiches InstaFact', '']);
    rows.push(['Indicateurs', 'Valeur']);
    rows.push(['Nombre de clients', data.totalClients.toString()]);
    rows.push(['Nombre de produits', data.totalProducts.toString()]);
    rows.push(['']);
    rows.push(['Top clients par CA', '', '', '']);
    rows.push(['Client', 'Code', 'Factures', 'Chiffre d\'affaires']);
    data.topClientsByRevenue.forEach(c => {
      rows.push([c.name, c.code, c.totalInvoices.toString(), `${c.totalRevenue.toFixed(3)} ${data.currency}`]);
    });
    rows.push(['']);
    rows.push(['Produits avec stock', '', '', '', '']);
    rows.push(['Produit', 'Code', 'Catégorie', 'Quantité', 'Valeur stock']);
    data.productsWithStock.forEach(p => {
      rows.push([p.name, p.code, p.category, p.quantityOnHand.toString(), `${p.stockValue.toFixed(3)} ${data.currency}`]);
    });

    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapports-fiches-${formatLocalDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
