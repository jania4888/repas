import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { formatLocalDate } from '@core/utils/date.util';
import { StockReportsService, StockReportsData } from '../services/stock-reports.service';
import { ReportsApiService, StockMovementReportRow, StockMovementsReportResult, StockSnapshotRow } from '@core/services/reports-api.service';

@Component({
  selector: 'app-stock-reports',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent
  ],
  template: `
    <app-page-header 
      title="Rapports Stock" i18n-title="@@reports.stock.rapports.stock.00f72cdf" 
      subtitle="Vue d'ensemble de votre stock, sa valeur et les alertes de rupture" i18n-subtitle="@@reports.stock.vue.d.ensemble.de.votre.stock.sa.valeur.088e4413">
      <app-button 
        variant="secondary"
        icon="pi-download"
        iconPos="left"
        (click)="onExport()" i18n="@@reports.stock.exporter.0cd84bdc"> Exporter </app-button>
    </app-page-header>

    @if (!loading() && reportsData()?.summaryText) {
      <div class="summary-block" role="status" aria-live="polite">
        <i class="pi pi-info-circle summary-icon"></i>
        <p class="summary-text">{{ reportsData()!.summaryText }}</p>
      </div>
    }

    @if (loading()) {
      <div class="stats-grid">
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
      </div>
    } @else if (reportsData()) {
      <div class="stats-grid">
        <app-stat-card
          label="Valeur totale du stock" i18n-label="@@reports.stock.valeur.totale.du.stock.c8ecd08b"
          [value]="reportsData()!.totalStockValue"
          icon="pi-dollar"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="Produits en stock" i18n-label="@@reports.stock.produits.en.stock.3254e52b"
          [value]="reportsData()!.productCount"
          icon="pi-cubes"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Alertes rupture" i18n-label="@@reports.stock.alertes.rupture.5a3c5b24"
          [value]="reportsData()!.alertCount"
          icon="pi-exclamation-triangle"
          [variant]="reportsData()!.alertCount > 0 ? 'error' : 'success'">
        </app-stat-card>
        <app-stat-card
          label="Produits en rupture" i18n-label="@@reports.stock.produits.en.rupture.7407ec48"
          [value]="reportsData()!.outOfStockCount"
          icon="pi-times-circle"
          [variant]="reportsData()!.outOfStockCount > 0 ? 'error' : 'success'">
        </app-stat-card>
      </div>
    }

    <div class="reports-grid">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.stock.valeur.par.entrepot.1386a343">Valeur par entrepôt</h2>
          <span class="section-subtitle" i18n="@@reports.stock.repartition.de.la.valeur.du.stock.par.emplacemen.6e0fcbc3">Répartition de la valeur du stock par emplacement</span>
        </div>
        @if (loading()) {
          <div class="loading-placeholder">
            <i class="pi pi-spin pi-spinner"></i>
            <span i18n="@@reports.stock.chargement.a209b664">Chargement...</span>
          </div>
        } @else if (!reportsData()?.warehouseValues?.length) {
          <div class="empty-placeholder">
            <i class="pi pi-info-circle"></i>
            <p i18n="@@reports.stock.aucun.entrepot.avec.du.stock.d33473d5">Aucun entrepôt avec du stock</p>
            <p class="empty-hint" i18n="@@reports.stock.creez.des.entrepots.et.enregistrez.des.mouvement.7e4736a4">Créez des entrepôts et enregistrez des mouvements de stock pour voir les données ici.</p>
          </div>
        } @else {
          <p-table 
            [value]="reportsData()!.warehouseValues" 
            styleClass="p-datatable-sm reports-table"
            aria-label="Tableau de la valeur par entrepôt" i18n-aria-label="@@reports.stock.tableau.de.la.valeur.par.entrepot.a66c0c28">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@reports.stock.entrepot.c349c0bc">Entrepôt</th>
                <th class="text-right" i18n="@@reports.stock.produits.48000473">Produits</th>
                <th class="text-right" i18n="@@reports.stock.valeur.totale.9927915b">Valeur totale</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                <td><span class="warehouse-name">{{ row.warehouseName }}</span> <span class="warehouse-code">({{ row.warehouseCode }})</span></td>
                <td class="text-right">{{ row.itemCount }}</td>
                <td class="text-right amount">{{ row.totalValue | number:'1.3-3' }} {{ reportsData()!.currency }}</td>
              </tr>
            </ng-template>
          </p-table>
        }
      </div>

      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.stock.produits.en.rupture.7407ec48">Produits en rupture</h2>
          <span class="section-subtitle" i18n="@@reports.stock.produits.sans.stock.disponible.24b3b108">Produits sans stock disponible</span>
        </div>
        @if (loading()) {
          <div class="loading-placeholder">
            <i class="pi pi-spin pi-spinner"></i>
            <span i18n="@@reports.stock.chargement.a209b664">Chargement...</span>
          </div>
        } @else if (!reportsData()?.outOfStockItems?.length) {
          <div class="empty-placeholder success-msg">
            <i class="pi pi-check-circle"></i>
            <p i18n="@@reports.stock.aucun.produit.en.rupture.c77371ae">Aucun produit en rupture</p>
            <p class="empty-hint" i18n="@@reports.stock.tous.vos.produits.ont.du.stock.disponible.830160b7">Tous vos produits ont du stock disponible.</p>
          </div>
        } @else {
          <p-table 
            [value]="reportsData()!.outOfStockItems" 
            styleClass="p-datatable-sm reports-table"
            aria-label="Tableau des produits en rupture" i18n-aria-label="@@reports.stock.tableau.des.produits.en.rupture.972c1bb5">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@reports.stock.produit.ff673dc2">Produit</th>
                <th i18n="@@reports.stock.entrepot.c349c0bc">Entrepôt</th>
                <th class="text-right" i18n="@@reports.stock.stock.actuel.294a897a">Stock actuel</th>
                <th class="text-right" i18n="@@reports.stock.seuil.min.fef8bbc7">Seuil min.</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-alert>
              <tr>
                <td>
                  <a [routerLink]="['/stock']" class="product-link">{{ alert.productName }}</a>
                  <span class="product-code">({{ alert.productCode }})</span>
                </td>
                <td>{{ alert.warehouseName }}</td>
                <td class="text-right amount-error">{{ alert.quantityOnHand }}</td>
                <td class="text-right">{{ alert.minimumStock }}</td>
              </tr>
            </ng-template>
          </p-table>
        }
      </div>
    </div>

    @if (!loading() && reportsData()?.lowStockItems?.length) {
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.stock.produits.en.stock.faible.c4569df4">Produits en stock faible</h2>
          <span class="section-subtitle" i18n="@@reports.stock.produits.proches.du.seuil.minimum.9d589f5d">Produits proches du seuil minimum</span>
        </div>
        <p-table 
          [value]="reportsData()!.lowStockItems" 
          styleClass="p-datatable-sm reports-table"
          aria-label="Tableau des produits en stock faible" i18n-aria-label="@@reports.stock.tableau.des.produits.en.stock.faible.6a06ce88">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.stock.produit.ff673dc2">Produit</th>
              <th i18n="@@reports.stock.entrepot.c349c0bc">Entrepôt</th>
              <th class="text-right" i18n="@@reports.stock.stock.actuel.294a897a">Stock actuel</th>
              <th class="text-right" i18n="@@reports.stock.seuil.min.fef8bbc7">Seuil min.</th>
              <th class="text-right" i18n="@@reports.stock.manquant.1bdbb1bb">Manquant</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-alert>
            <tr>
              <td>
                <a [routerLink]="['/stock']" class="product-link">{{ alert.productName }}</a>
                <span class="product-code">({{ alert.productCode }})</span>
              </td>
              <td>{{ alert.warehouseName }}</td>
              <td class="text-right amount-warning">{{ alert.quantityOnHand }}</td>
              <td class="text-right">{{ alert.minimumStock }}</td>
              <td class="text-right">{{ alert.deficit }}</td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.stock.mouvement.detaille.de.stock.89c0156d">Mouvement détaillé de stock</h2>
        <span class="section-subtitle" i18n="@@reports.stock.historique.des.mouvements.avec.filtre.periode.et.19f5aecd">Historique des mouvements avec filtre période et entrepôt</span>
      </div>
      <div class="filter-row">
        <div class="filter-group">
          <label for="movFrom" class="filter-label" i18n="@@reports.stock.du.84814985">Du</label>
          <input type="date" id="movFrom" [(ngModel)]="movementsFrom" (ngModelChange)="onMovementsFilterChange()" class="filter-input" />
        </div>
        <div class="filter-group">
          <label for="movTo" class="filter-label" i18n="@@reports.stock.au.7a1732d5">Au</label>
          <input type="date" id="movTo" [(ngModel)]="movementsTo" (ngModelChange)="onMovementsFilterChange()" class="filter-input" />
        </div>
        <div class="filter-group">
          <label for="movWh" class="filter-label" i18n="@@reports.stock.entrepot.c349c0bc">Entrepôt</label>
          <select id="movWh" [(ngModel)]="movementsWarehouseId" (ngModelChange)="onMovementsFilterChange()" class="filter-select">
            <option value="" i18n="@@reports.stock.tous.b97ae3b4">Tous</option>
            @for (w of reportsData()?.warehouseValues ?? []; track w.warehouseId) {
              <option [value]="w.warehouseId">{{ w.warehouseName }}</option>
            }
          </select>
        </div>
      </div>
      @if (stockMovementsLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.stock.chargement.a209b664">Chargement...</span></div>
      } @else if (!stockMovementsResult()?.items?.length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.stock.aucun.mouvement.sur.la.periode.0c965385">Aucun mouvement sur la période</p></div>
      } @else {
        <p-table [value]="stockMovementsResult()!.items" styleClass="p-datatable-sm reports-table" aria-label="Mouvements de stock" i18n-aria-label="@@reports.stock.mouvements.de.stock.b5ee405b">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.stock.date.eb9a4bc1">Date</th>
              <th i18n="@@reports.stock.produit.ff673dc2">Produit</th>
              <th i18n="@@reports.stock.entrepot.c349c0bc">Entrepôt</th>
              <th i18n="@@reports.stock.type.3deb7456">Type</th>
              <th i18n="@@reports.stock.motif.2a198f47">Motif</th>
              <th class="text-right" i18n="@@reports.stock.quantite.09a38fda">Quantité</th>
              <th class="text-right" i18n="@@reports.stock.cout.unit.3b6db3fe">Coût unit.</th>
              <th i18n="@@reports.stock.reference.f8130bb0">Référence</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.occurredAt | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ row.productName }} <span class="product-code">({{ row.productCode }})</span></td>
              <td>{{ row.warehouseName }}</td>
              <td>{{ row.typeDisplay | backendLabel }}</td>
              <td>{{ row.reasonDisplay | backendLabel }}</td>
              <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
              <td class="text-right amount">{{ row.unitCost | number:'1.3-3' }}</td>
              <td>{{ row.reference ?? '-' }}</td>
            </tr>
          </ng-template>
        </p-table>
        <div class="pagination-row">
          <span class="pagination-info" i18n="@@reports.stock.page.35d494ca">Page {{ stockMovementsResult()!.page }} / {{ totalMovementPages() }}</span>
          <div class="pagination-btns">
            <button type="button" class="pagination-btn" [disabled]="stockMovementsResult()!.page <= 1" (click)="movementsPagePrev()" i18n="@@reports.stock.prec.92be5b53">Préc.</button>
            <button type="button" class="pagination-btn" [disabled]="stockMovementsResult()!.page >= totalMovementPages()" (click)="movementsPageNext()" i18n="@@reports.stock.suiv.284b830f">Suiv.</button>
          </div>
        </div>
      }
    </div>

    <div class="section" id="stock-snapshot">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.stock.etat.de.stock.a.une.date.anterieure.7165a79c">État de stock à une date antérieure</h2>
        <span class="section-subtitle" i18n="@@reports.stock.snapshot.des.quantites.a.une.date.donnee.7f79facb">Snapshot des quantités à une date donnée</span>
      </div>
      <div class="filter-row">
        <div class="filter-group">
          <label for="snapshotDate" class="filter-label" i18n="@@reports.stock.date.eb9a4bc1">Date</label>
          <input
            type="date"
            id="snapshotDate"
            [(ngModel)]="snapshotDate"
            [max]="maxSnapshotDate"
            class="filter-input"
            aria-describedby="snapshotDateHint" />
          <span id="snapshotDateHint" class="filter-hint" i18n="@@reports.stock.date.au.soir.de.laquelle.afficher.l.etat.du.stoc.10f2da4e">Date au soir de laquelle afficher l'état du stock</span>
        </div>
        <div class="filter-group">
          <label for="snapshotWh" class="filter-label" i18n="@@reports.stock.entrepot.c349c0bc">Entrepôt</label>
          <select id="snapshotWh" [(ngModel)]="snapshotWarehouseId" class="filter-select" aria-label="Filtrer par entrepôt" i18n-aria-label="@@reports.stock.filtrer.par.entrepot.89121026">
            <option value="" i18n="@@reports.stock.tous.b97ae3b4">Tous</option>
            @for (w of reportsData()?.warehouseValues ?? []; track w.warehouseId) {
              <option [value]="w.warehouseId">{{ w.warehouseName }}</option>
            }
          </select>
        </div>
        <div class="filter-group">
          <app-button variant="primary" icon="pi-search" iconPos="left" (click)="loadStockSnapshot()" i18n="@@reports.stock.voir.le.rapport.3537fe96">Voir le rapport</app-button>
        </div>
      </div>
      @if (snapshotError()) {
        <p class="snapshot-error" role="alert">{{ snapshotError() }}</p>
      }
      @if (snapshotLoading()) {
        <div class="loading-placeholder">
          <i class="pi pi-spin pi-spinner"></i>
          <span i18n="@@reports.stock.chargement.du.snapshot.d092827d">Chargement du snapshot...</span>
        </div>
      } @else if (snapshotRows() !== null && snapshotRows()!.length === 0) {
        <div class="empty-placeholder">
          <i class="pi pi-info-circle"></i>
          <p i18n="@@reports.stock.aucun.stock.a.cette.date.c7e91d37">Aucun stock à cette date</p>
          <p class="empty-hint" i18n="@@reports.stock.aucun.mouvement.enregistre.avant.le.pour.6dc47f0c">Aucun mouvement enregistré avant le {{ snapshotDate | date:'dd/MM/yyyy' }} pour les critères choisis.</p>
        </div>
      } @else if (snapshotRows() !== null && snapshotRows()!.length > 0) {
        <p-table
          [value]="snapshotRows()!"
          styleClass="p-datatable-sm reports-table"
          aria-label="État de stock à la date sélectionnée" i18n-aria-label="@@reports.stock.etat.de.stock.a.la.date.selectionnee.cd17d10f">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.stock.produit.ff673dc2">Produit</th>
              <th i18n="@@reports.stock.code.adac6937">Code</th>
              <th i18n="@@reports.stock.entrepot.c349c0bc">Entrepôt</th>
              <th class="text-right" i18n="@@reports.stock.quantite.09a38fda">Quantité</th>
              <th class="text-right" i18n="@@reports.stock.cout.unitaire.3735acf6">Coût unitaire</th>
              <th class="text-right" i18n="@@reports.stock.valeur.totale.9927915b">Valeur totale</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td><span class="product-name">{{ row.productName }}</span></td>
              <td><span class="product-code">{{ row.productCode }}</span></td>
              <td>{{ row.warehouseName }}</td>
              <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
              <td class="text-right amount">{{ row.unitCost | number:'1.3-3' }}</td>
              <td class="text-right amount">{{ row.totalValue | number:'1.3-3' }}</td>
            </tr>
          </ng-template>
        </p-table>
      } @else {
        <div class="empty-placeholder">
          <i class="pi pi-calendar"></i>
          <p i18n="@@reports.stock.choisissez.une.date.et.cliquez.sur.voir.le.rappo.1d8c8663">Choisissez une date et cliquez sur « Voir le rapport »</p>
          <p class="empty-hint" i18n="@@reports.stock.la.date.doit.etre.anterieure.ou.egale.a.aujourd..8e5fea12">La date doit être antérieure ou égale à aujourd'hui.</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .summary-block {
      background: var(--color-primary-50);
      border-radius: var(--radius-lg);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      border: 1px solid var(--color-primary-100);
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
    }

    .summary-icon { color: var(--color-primary-600); font-size: 1.25rem; flex-shrink: 0; }
    .summary-text { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.5; }

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

    .reports-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: var(--spacing-6);
      margin-bottom: var(--spacing-6);
    }

    .section {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--spacing-2);
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
      background: linear-gradient(180deg, #f59e0b, #d97706);
      border-radius: var(--radius-full);
      margin-right: var(--spacing-2);
      vertical-align: middle;
    }

    .section-subtitle { font-size: var(--font-size-sm); color: var(--color-text-secondary); width: 100%; }

    .loading-placeholder, .empty-placeholder {
      padding: var(--spacing-8);
      text-align: center;
      color: var(--color-text-secondary);
    }

    .empty-placeholder.success-msg i { color: var(--color-success-500); }
    .empty-hint { font-size: var(--font-size-sm); margin-top: var(--spacing-2); opacity: 0.8; }

    .warehouse-name, .product-name { font-weight: var(--font-weight-medium); color: var(--color-text-primary); }
    .warehouse-code { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .product-link { font-weight: var(--font-weight-semibold); color: var(--color-primary-600); text-decoration: none; }
    .product-link:hover { text-decoration: underline; }
    .product-code { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-left: var(--spacing-1); }
    .text-right { text-align: right; }
    .amount { font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .amount-error { color: var(--color-error-600); font-weight: var(--font-weight-semibold); }
    .amount-warning { color: var(--color-warning-600); font-weight: var(--font-weight-semibold); }

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

    .filter-row { display: flex; flex-wrap: wrap; gap: var(--spacing-4); margin-bottom: var(--spacing-4); align-items: center; }
    .filter-group { display: flex; align-items: center; gap: var(--spacing-2); }
    .filter-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
    .filter-input, .filter-select { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); font-size: var(--font-size-sm); }
    .pagination-row { display: flex; justify-content: space-between; align-items: center; margin-top: var(--spacing-4); padding-top: var(--spacing-4); border-top: 1px solid var(--color-border-subtle); }
    .pagination-info { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .pagination-btns { display: flex; gap: var(--spacing-2); }
    .pagination-btn { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background); cursor: pointer; font-size: var(--font-size-sm); }
    .pagination-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .filter-hint { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-left: var(--spacing-2); }
    .snapshot-error { color: var(--color-error-600); font-size: var(--font-size-sm); margin: var(--spacing-2) 0; }

    @media (max-width: 1024px) { .reports-grid { grid-template-columns: 1fr; } }
    @media (max-width: 768px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .section { padding: var(--spacing-4); }
      .section-title { font-size: var(--font-size-xl); }
      .section-title::before { display: none; }
    }
  `]
})
export class StockReportsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  reportsService = inject(StockReportsService);
  reportsApi = inject(ReportsApiService);

  loading = signal(true);
  reportsData = signal<StockReportsData | null>(null);
  stockMovementsResult = signal<StockMovementsReportResult | null>(null);
  stockMovementsLoading = signal(false);
  movementsFrom = '';
  movementsTo = '';
  movementsWarehouseId = '';
  movementsPage = 1;
  readonly movementsPageSize = 20;

  snapshotDate = '';
  snapshotWarehouseId = '';
  snapshotLoading = signal(false);
  snapshotRows = signal<StockSnapshotRow[] | null>(null);
  snapshotError = signal<string | null>(null);
  get maxSnapshotDate(): string {
    return formatLocalDate(new Date());
  }

  totalMovementPages = () => {
    const r = this.stockMovementsResult();
    if (!r || r.totalCount === 0) return 1;
    return Math.ceil(r.totalCount / r.pageSize);
  };

  ngOnInit(): void {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    this.movementsTo = formatLocalDate(to);
    this.movementsFrom = formatLocalDate(from);
    this.loadReportsData();
    this.loadStockMovements();
    this.route.queryParamMap.subscribe(params => {
      if (params.get('section') === 'snapshot') {
        setTimeout(() => {
          document.getElementById('stock-snapshot')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
    });
  }

  onMovementsFilterChange(): void {
    this.movementsPage = 1;
    this.loadStockMovements();
  }

  loadStockMovements(): void {
    this.stockMovementsLoading.set(true);
    this.reportsApi.getStockMovements({
      from: this.movementsFrom || undefined,
      to: this.movementsTo || undefined,
      warehouseId: this.movementsWarehouseId || undefined,
      page: this.movementsPage,
      pageSize: this.movementsPageSize
    }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.stockMovementsResult.set(res.data);
        } else {
          this.stockMovementsResult.set(null);
        }
        this.stockMovementsLoading.set(false);
      },
      error: () => { this.stockMovementsResult.set(null); this.stockMovementsLoading.set(false); }
    });
  }

  movementsPagePrev(): void {
    if (this.stockMovementsResult() && this.stockMovementsResult()!.page > 1) {
      this.movementsPage = this.stockMovementsResult()!.page - 1;
      this.loadStockMovements();
    }
  }

  movementsPageNext(): void {
    const r = this.stockMovementsResult();
    if (r && r.page < this.totalMovementPages()) {
      this.movementsPage = r.page + 1;
      this.loadStockMovements();
    }
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

  loadStockSnapshot(): void {
    this.snapshotError.set(null);
    const dateStr = this.snapshotDate?.trim();
    if (!dateStr) {
      this.snapshotError.set('Choisissez une date.');
      return;
    }
    const chosen = new Date(dateStr);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    chosen.setHours(23, 59, 59, 999);
    if (chosen > today) {
      this.snapshotError.set('Choisissez une date antérieure ou égale à aujourd\'hui.');
      return;
    }
    this.snapshotLoading.set(true);
    this.reportsApi.getStockSnapshot({
      asOf: dateStr,
      warehouseId: this.snapshotWarehouseId || undefined
    }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.snapshotRows.set(res.data);
        } else {
          this.snapshotRows.set([]);
        }
        this.snapshotLoading.set(false);
      },
      error: () => {
        this.snapshotRows.set(null);
        this.snapshotError.set('Impossible de charger le rapport. Réessayez plus tard.');
        this.snapshotLoading.set(false);
      }
    });
  }

  onExport(): void {
    const data = this.reportsData();
    if (!data) return;

    const rows: string[][] = [];
    rows.push(['Rapports Stock InstaFact', '']);
    rows.push(['Indicateurs', 'Valeur']);
    rows.push(['Valeur totale du stock', data.totalStockValue]);
    rows.push(['Produits en stock', data.productCount.toString()]);
    rows.push(['Alertes rupture', data.alertCount.toString()]);
    rows.push(['Produits en rupture', data.outOfStockCount.toString()]);
    rows.push(['']);
    rows.push(['Valeur par entrepôt', '', '']);
    rows.push(['Entrepôt', 'Produits', 'Valeur totale']);
    data.warehouseValues.forEach(wv => {
      rows.push([wv.warehouseName, wv.itemCount.toString(), `${wv.totalValue.toFixed(3)} ${data.currency}`]);
    });
    rows.push(['']);
    rows.push(['Produits en rupture', '', '', '']);
    rows.push(['Produit', 'Code', 'Entrepôt', 'Stock actuel']);
    data.outOfStockItems.forEach(a => {
      rows.push([a.productName, a.productCode, a.warehouseName, a.quantityOnHand.toString()]);
    });

    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapports-stock-${formatLocalDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
