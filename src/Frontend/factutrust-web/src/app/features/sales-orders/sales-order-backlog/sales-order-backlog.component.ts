/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { SalesOrderService, SalesOrderBacklogRow } from '@core/services/sales-order.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-sales-order-backlog',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    TagModule,
    TooltipModule,
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
      title="Carnet de commandes" i18n-title="@@sales-orders.sales-order-backlog.carnet.de.commandes.ec641454"
      subtitle="Ce qui est engagé et pas encore livré, ligne par ligne. Seules les commandes confirmées ou partiellement livrées y figurent." i18n-subtitle="@@sales-orders.sales-order-backlog.ce.qui.est.engage.et.pas.encore.livre.li.73c66779">
      <app-button variant="secondary" icon="pi-arrow-left" iconPos="left" routerLink="/sales-orders" i18n="@@sales-orders.sales-order-backlog.retour.aux.commandes.68a21472"> Retour aux commandes </app-button>
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__row">
        <div class="ft-field">
          <label for="bl-due" i18n="@@sales-orders.sales-order-backlog.echeance.avant.le.35f3bb29">Échéance avant le</label>
          <input id="bl-due" type="date" pInputText [(ngModel)]="dueBefore" (change)="load()" />
          <small class="ft-hint" i18n="@@sales-orders.sales-order-backlog.ne.garder.que.ce.qui.doit.etre.livre.avant.cette.28428eae">Ne garder que ce qui doit être livré avant cette date.</small>
        </div>

        <div class="ft-field ft-field--actions">
          <app-button variant="secondary" (clicked)="resetFilters()" i18n="@@sales-orders.sales-order-backlog.reinitialiser.e0e2ad54">Réinitialiser</app-button>
        </div>
      </div>
    </div>

    @if (rows().length > 0) {
      <app-table-totals-bar [metrics]="totalMetrics()"></app-table-totals-bar>
    }

    @if (loading()) {
      <app-skeleton-table [columns]="skeletonColumns" [rows]="8"></app-skeleton-table>
    } @else if (rows().length === 0) {
      <app-empty-state
        icon="pi-check-circle"
        title="Carnet vide" i18n-title="@@sales-orders.sales-order-backlog.carnet.vide.28ec78c4"
        message="Aucune quantité engagée ne reste à livrer." i18n-message="@@sales-orders.sales-order-backlog.aucune.quantite.engagee.ne.reste.a.livre.238594a0">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table [value]="rows()" [rowHover]="true" [paginator]="true" [rows]="25" styleClass="ft-table">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@sales-orders.sales-order-backlog.commande.47844341">Commande</th>
              <th i18n="@@sales-orders.sales-order-backlog.livraison.prevue.dc15f458">Livraison prévue</th>
              <th i18n="@@sales-orders.sales-order-backlog.client.1bdd79b1">Client</th>
              <th i18n="@@sales-orders.sales-order-backlog.produit.ff673dc2">Produit</th>
              <th class="ft-num" i18n="@@sales-orders.sales-order-backlog.commande.e460aa50">Commandé</th>
              <th class="ft-num" i18n="@@sales-orders.sales-order-backlog.livre.0a1317e9">Livré</th>
              <th class="ft-num" i18n="@@sales-orders.sales-order-backlog.reste.68135bb8">Reste</th>
              <th class="ft-num" i18n="@@sales-orders.sales-order-backlog.valeur.ht.8807b7ab">Valeur HT</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-row>
            <tr [class.ft-row--late]="row.isLate">
              <td>
                <a [routerLink]="['/sales-orders', row.salesOrderId]" class="ft-link">
                  {{ row.orderNumber }}
                </a>
              </td>
              <td>
                @if (row.expectedDeliveryDate) {
                  {{ row.expectedDeliveryDate | date: 'dd/MM/yyyy' }}
                  @if (row.isLate) {
                    <p-tag severity="danger" value="En retard" pTooltip="Échéance dépassée." i18n-pTooltip="@@sales-orders.sales-order-backlog.echeance.depassee.528917a7"></p-tag>
                  }
                } @else {
                  <span class="ft-muted" i18n="@@sales-orders.sales-order-backlog.non.datee.5a5eade0">Non datée</span>
                }
              </td>
              <td>{{ row.clientName }}</td>
              <td>
                <span class="ft-muted">{{ row.productCode }}</span> — {{ row.productName }}
              </td>
              <td class="ft-num">{{ row.orderedQuantity | number: '1.0-4' }}</td>
              <td class="ft-num">{{ row.deliveredQuantity | number: '1.0-4' }}</td>
              <td class="ft-num"><strong>{{ row.pendingQuantity | number: '1.0-4' }}</strong></td>
              <td class="ft-num">{{ row.pendingAmountHt | number: '1.3-3' }}</td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }
  `
})
export class SalesOrderBacklogComponent implements OnInit {
  private readonly salesOrderService = inject(SalesOrderService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly rows = signal<SalesOrderBacklogRow[]>([]);
  readonly loading = signal(true);

  dueBefore = '';

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@sales-orders.sales-order-backlog.ts.ventes.9087fc4f:Ventes` },
    { label: $localize`:@@sales-orders.sales-order-backlog.ts.commandes.clients.928f824a:Commandes clients`, route: '/sales-orders' },
    { label: $localize`:@@sales-orders.sales-order-backlog.ts.carnet.5e843afe:Carnet` }
  ];

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '12%' },
    { width: '13%' },
    { width: '18%' },
    { width: '25%' },
    { width: '8%' },
    { width: '8%' },
    { width: '8%' },
    { width: '8%' }
  ];

  /** Le retard est mis en avant : c'est ce qui appelle une action, pas le volume global. */
  readonly totalMetrics = computed<TotalMetric[]>(() => {
    const all = this.rows();
    const late = all.filter(r => r.isLate);
    const totalValue = all.reduce((sum, r) => sum + r.pendingAmountHt, 0);
    const lateValue = late.reduce((sum, r) => sum + r.pendingAmountHt, 0);

    return [
      { label: $localize`:@@sales-orders.sales-order-backlog.ts.lignes.en.attente.a7206ff9:Lignes en attente`, value: all.length, format: 'number', icon: 'pi-list' },
      { label: $localize`:@@sales-orders.sales-order-backlog.ts.valeur.du.carnet.681b29e1:Valeur du carnet`, value: totalValue, format: 'currency', tone: 'primary' },
      {
        label: $localize`:@@sales-orders.sales-order-backlog.ts.lignes.en.retard.93f7ff67:Lignes en retard`,
        value: late.length,
        format: 'number',
        tone: late.length > 0 ? 'rose' : 'emerald',
        icon: 'pi-exclamation-triangle'
      },
      {
        label: $localize`:@@sales-orders.sales-order-backlog.ts.valeur.en.retard.b4c148a0:Valeur en retard`,
        value: lateValue,
        format: 'currency',
        tone: lateValue > 0 ? 'rose' : 'emerald'
      }
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.salesOrderService.getBacklog(null, this.dueBefore || null).subscribe({
      next: res => {
        this.rows.set(res.data ?? []);
        this.loading.set(false);
      },
      error: err => {
        const msg = this.errorHandler.extractErrorMessage(err);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@sales-order-backlog.component.summary.Erreur:Erreur`,
          detail: msg || $localize`:@@sales-orders.sales-order-backlog.ts.impossible.de.charger.le.carnet.de.comma.ddb2d8de:Impossible de charger le carnet de commandes`
        });
        this.errorHandler.logError('Failed to load sales order backlog', err);
        this.rows.set([]);
        this.loading.set(false);
      }
    });
  }

  resetFilters(): void {
    this.dueBefore = '';
    this.load();
  }
}
