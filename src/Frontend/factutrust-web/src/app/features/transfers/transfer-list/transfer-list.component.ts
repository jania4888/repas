import { Component, OnInit, inject, signal, DestroyRef, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { StockTransferService, StockTransferListDto } from '@core/services/stock-transfer.service';
import { StockService, Warehouse } from '@core/services/stock.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';

@Component({
  selector: 'app-transfer-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TableModule, SelectModule, ButtonModule, TagModule, ToastModule, TableTotalsBarComponent],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>
    <div class="page-container">
      <div class="page-header">
        <div>
          <h1 i18n="@@transfers.transfer-list.transferts.entre.entrepots.5043bd7d">Transferts entre entrepôts</h1>
          <p class="text-muted" i18n="@@transfers.transfer-list.gerez.les.transferts.de.stock.entre.vos.entrepot.13ea9820">Gérez les transferts de stock entre vos entrepôts</p>
        </div>
        @if (canCreateTransfer()) {
          <a routerLink="create" class="btn-primary">
            <i class="fas fa-plus"></i> Nouveau transfert
          </a>
        }
      </div>

      <div class="card filters-card">
        <div class="filters-grid" role="search" aria-label="Filtres des transferts" i18n-aria-label="Filtres des transferts">
          <div class="filter-field">
            <label class="filter-label" id="filter-status-label" for="filter-status" i18n="@@transfers.transfer-list.statut.659499f3">Statut</label>
            <p-select inputId="filter-status"
              [options]="statusOptions"
              [(ngModel)]="statusFilter"
              optionLabel="label"
              optionValue="value"
              placeholder="Tous les statuts" i18n-placeholder="Tous les statuts"
              [showClear]="true"
              [style]="{ width: '100%' }"
              appendTo="body"
              ariaLabelledBy="filter-status-label">
            </p-select>
          </div>
          <div class="filter-field">
            <label class="filter-label" id="filter-wh-label" for="filter-warehouse" i18n="@@transfers.transfer-list.entrepot.source.ou.destination.d06d0c18">Entrepôt (source ou destination)</label>
            <p-select inputId="filter-warehouse"
              [options]="warehouseOptions"
              [(ngModel)]="warehouseFilter"
              optionLabel="label"
              optionValue="value"
              placeholder="Tous les entrepôts" i18n-placeholder="Tous les entrepôts"
              [showClear]="true"
              [filter]="warehouseOptions.length > 20"
              filterBy="label"
              [resetFilterOnHide]="true"
              filterPlaceholder="Rechercher…"
              [style]="{ width: '100%' }"
              appendTo="body"
              ariaLabelledBy="filter-wh-label">
            </p-select>
          </div>
          <div class="filter-field">
            <label class="filter-label" for="filter-from" i18n="@@transfers.transfer-list.du.84814985">Du</label>
            <input id="filter-from" type="date" class="date-input" [(ngModel)]="fromDate" />
          </div>
          <div class="filter-field">
            <label class="filter-label" for="filter-to" i18n="@@transfers.transfer-list.au.7a1732d5">Au</label>
            <input id="filter-to" type="date" class="date-input" [(ngModel)]="toDate" />
          </div>
          <div class="filter-actions">
            <button pButton type="button" label="Appliquer" icon="pi pi-filter" (click)="loadTransfers()"></button>
            <button pButton type="button" label="Réinitialiser" class="p-button-outlined" (click)="resetFilters()"></button>
          </div>
        </div>
      </div>

      <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

      <div class="card">
        <p-table [value]="transfers()" [paginator]="true" [rows]="20"
                 [loading]="loading()" styleClass="p-datatable-sm"
                 [rowHover]="true" [showCurrentPageReport]="true"
                 currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} transferts">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@transfers.transfer-list.numero.15e73db0">Numéro</th>
              <th i18n="@@transfers.transfer-list.date.eb9a4bc1">Date</th>
              <th i18n="@@transfers.transfer-list.source.6da13add">Source</th>
              <th i18n="@@transfers.transfer-list.destination.d4271349">Destination</th>
              <th i18n="@@transfers.transfer-list.lignes.41c7025e">Lignes</th>
              <th i18n="@@transfers.transfer-list.statut.659499f3">Statut</th>
              <th i18n="@@transfers.transfer-list.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-transfer>
            <tr>
              <td><a [routerLink]="[transfer.id]" class="link-primary">{{ transfer.number }}</a></td>
              <td>{{ transfer.transferDate | date:'dd/MM/yyyy' }}</td>
              <td>{{ transfer.sourceWarehouseName }}</td>
              <td>{{ transfer.destinationWarehouseName }}</td>
              <td>{{ transfer.lineCount }}</td>
              <td><span class="status-badge" [ngClass]="transfer.statusCss">{{ transfer.statusDisplay }}</span></td>
              <td><a [routerLink]="[transfer.id]" class="btn-icon" [attr.aria-label]="'Voir le transfert ' + transfer.number"><i class="fas fa-eye" aria-hidden="true"></i></a></td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="7" class="text-center py-4" i18n="@@transfers.transfer-list.aucun.transfert.trouve.7189631d">Aucun transfert trouvé</td></tr>
          </ng-template>
        </p-table>
      </div>
    </div>
  `,
  styles: [`
    .page-container { padding: 1.5rem; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
    .page-header h1 { font-size: 1.5rem; font-weight: 600; margin: 0; }
    .text-muted { color: var(--text-secondary, #64748b); font-size: 0.875rem; margin-top: 0.25rem; }
    .card { background: white; border-radius: 0.75rem; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .filters-card { margin-bottom: 1rem; }
    .filters-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
      gap: 1rem;
      align-items: end;
    }
    @media (max-width: 768px) {
      .filters-grid { grid-template-columns: 1fr; }
    }
    .filter-field { min-width: 0; }
    .filter-label { display: block; font-size: 0.75rem; font-weight: 600; color: var(--text-secondary, #64748b); margin-bottom: 0.375rem; }
    .date-input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.375rem; font-size: 0.875rem; }
    .filter-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .btn-primary { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.625rem 1.25rem; background: var(--color-primary-600, #2563eb); color: white; border-radius: 0.5rem; text-decoration: none; font-weight: 500; font-size: 0.875rem; }
    .btn-icon { color: var(--text-secondary); }
    @media (max-width: 768px) {
      .page-header { flex-direction: column; align-items: stretch; gap: 1rem; }
      .page-header .btn-primary { justify-content: center; }
    }
    .link-primary { color: var(--color-primary-600, #2563eb); text-decoration: none; font-weight: 500; }
    .status-badge { padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 500; }
    .status-draft { background: #f1f5f9; color: #475569; }
    .status-confirmed { background: #dbeafe; color: #1d4ed8; }
    .status-transit { background: #fef3c7; color: #92400e; }
    .status-completed { background: #dcfce7; color: #166534; }
    .status-cancelled { background: #fee2e2; color: #991b1b; }
  `]
})
export class TransferListComponent implements OnInit {
  private transferService = inject(StockTransferService);
  private stockService = inject(StockService);
  private messageService = inject(MessageService);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);

  canCreateTransfer = computed(() => this.auth.hasPermission(PERMISSIONS.stockTransfers.create));

  transfers = signal<StockTransferListDto[]>([]);
  loading = signal(true);

  /** Totaux de la zone, calculés sur les lignes filtrées (tout est chargé côté client). */
  summaryMetrics = computed<TotalMetric[]>(() => {
    const rows = this.transfers();
    const statusLower = (t: StockTransferListDto) => (t.status || '').toLowerCase();
    return [
      { label: 'Transferts', value: rows.length, format: 'number', icon: 'pi-arrows-h', tone: 'primary' },
      { label: 'Lignes', value: rows.reduce((acc, t) => acc + t.lineCount, 0), format: 'number', icon: 'pi-list', tone: 'cyan' },
      { label: 'En transit', value: rows.filter(t => statusLower(t).includes('transit')).length, format: 'number', icon: 'pi-truck', tone: 'amber' },
      { label: 'Terminés', value: rows.filter(t => statusLower(t).includes('complet')).length, format: 'number', icon: 'pi-check-circle', tone: 'emerald' }
    ];
  });

  statusFilter: string | null = null;
  warehouseFilter: string | null = null;
  fromDate: string | null = null;
  toDate: string | null = null;

  warehouseOptions: { label: string; value: string }[] = [];

  readonly statusOptions: { label: string; value: string }[] = [
    { label: 'Brouillon', value: 'Draft' },
    { label: 'Confirmé', value: 'Confirmed' },
    { label: 'En transit', value: 'InTransit' },
    { label: 'Terminé', value: 'Completed' },
    { label: 'Annulé', value: 'Cancelled' }
  ];

  ngOnInit() {
    this.stockService.getWarehouses(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        const data = res.data as Warehouse[] | undefined;
        this.warehouseOptions = (data ?? []).map((w) => {
          let label = `${w.name}${w.isDefault ? ' (défaut)' : ''}`;
          if (!w.isActive) {
            label += ' — Inactif';
          }
          return { label, value: w.id };
        });
      },
      error: () => {
        this.messageService.add({ severity: 'warn', summary: 'Entrepôts', detail: 'Impossible de charger la liste des entrepôts' });
      }
    });
    this.loadTransfers();
  }

  resetFilters() {
    this.statusFilter = null;
    this.warehouseFilter = null;
    this.fromDate = null;
    this.toDate = null;
    this.loadTransfers();
  }

  loadTransfers() {
    this.loading.set(true);
    const params: {
      status?: string;
      warehouseId?: string;
      fromDate?: string;
      toDate?: string;
    } = {};
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.warehouseFilter) params.warehouseId = this.warehouseFilter;
    if (this.fromDate) params.fromDate = this.fromDate;
    if (this.toDate) params.toDate = this.toDate;

    this.transferService.getStockTransfers(params).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.transfers.set(res.data || []);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: err.error?.error || err.error?.message || 'Impossible de charger les transferts'
        });
      }
    });
  }
}
