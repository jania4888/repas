import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  DEPRECIATION_METHOD_LABELS,
  DepreciationRateCategoryDto,
  FIXED_ASSET_STATUS_LABELS,
  FixedAssetDto,
  FixedAssetStatus,
  FixedAssetsService
} from '../services/fixed-assets.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-fixed-assets-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    EmptyStateComponent,
    AccountingStatusBannerComponent
  ],
  template: `
    <app-page-header
      title="Immobilisations" i18n-title="@@accounting.fixed-assets.immobilisations.1e4cbe01"
      subtitle="Registre des actifs et suivi des amortissements (norme tunisienne)" i18n-subtitle="@@accounting.fixed-assets.registre.des.actifs.et.suivi.des.amortis.087acaf5" />

    <div class="card accounting-filters-card">
      <div class="accounting-filter-row">
        <input
          type="search"
          class="accounting-filter-input"
          placeholder="Rechercher (désignation, n° inventaire)" i18n-placeholder="@@accounting.fixed-assets.rechercher.designation.n.inventaire.cc557d2d"
          [(ngModel)]="search"
          (keyup.enter)="reload()" />
        <select class="accounting-filter-input" [(ngModel)]="statusFilter" (ngModelChange)="reload()">
          <option [ngValue]="null" i18n="@@accounting.fixed-assets.tous.les.statuts.2d5088af">Tous les statuts</option>
          <option [ngValue]="FixedAssetStatus.Draft" i18n="@@accounting.fixed-assets.brouillon.57d2d7a7">Brouillon</option>
          <option [ngValue]="FixedAssetStatus.InService" i18n="@@accounting.fixed-assets.en.service.0b067773">En service</option>
          <option [ngValue]="FixedAssetStatus.FullyDepreciated" i18n="@@accounting.fixed-assets.totalement.amorti.ede655ed">Totalement amorti</option>
          <option [ngValue]="FixedAssetStatus.Disposed" i18n="@@accounting.fixed-assets.cede.51eca68c">Cédé</option>
        </select>
        <select class="accounting-filter-input" [(ngModel)]="categoryFilter" (ngModelChange)="reload()">
          <option [ngValue]="null" i18n="@@accounting.fixed-assets.toutes.les.categories.ac8ab261">Toutes les catégories</option>
          <option *ngFor="let c of categories()" [ngValue]="c.id">{{ c.label }}</option>
        </select>
        <input
          type="number"
          class="accounting-filter-input year-input"
          placeholder="Exercice" i18n-placeholder="@@accounting.fixed-assets.exercice.e171e2b0"
          min="2000"
          max="2100"
          [(ngModel)]="fiscalYearFilter"
          (keyup.enter)="reload()" />
        <app-button variant="secondary" icon="pi pi-refresh" type="button" (click)="reload()" [disabled]="loading()" i18n="@@accounting.fixed-assets.actualiser.9d3b2a7d"> Actualiser </app-button>
        <app-button variant="primary" icon="pi pi-plus" type="button" routerLink="/accounting/fixed-assets/new" i18n="@@accounting.fixed-assets.nouvelle.immobilisation.477db87f"> Nouvelle immobilisation </app-button>
        <app-button variant="secondary" icon="pi pi-calculator" type="button" routerLink="/accounting/fixed-assets/depreciation-run" i18n="@@accounting.fixed-assets.dotations.751a01e7"> Dotations </app-button>
        <app-button variant="secondary" icon="pi pi-table" type="button" routerLink="/accounting/fixed-assets/amortization-table" i18n="@@accounting.fixed-assets.tableau.amortissements.0ddccc41"> Tableau amortissements </app-button>
        <app-button variant="secondary" icon="pi pi-cog" type="button" routerLink="/accounting/fixed-assets/settings" i18n="@@accounting.fixed-assets.exercice.comptable.7d7b9297"> Exercice comptable </app-button>
      </div>
    </div>

    <app-accounting-status-banner [message]="error() ?? ''" variant="error" *ngIf="error()" />

    <div class="card" *ngIf="!loading() && items().length === 0">
      <app-empty-state
        icon="pi pi-building"
        title="Aucune immobilisation" i18n-title="@@accounting.fixed-assets.aucune.immobilisation.f9c26485"
        message="Créez votre premier actif pour générer un tableau d'amortissement." i18n-message="@@accounting.fixed-assets.creez.votre.premier.actif.pour.generer.u.09ff9ba8" />
    </div>

    <div class="card" *ngIf="items().length > 0">
      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@accounting.fixed-assets.n.inventaire.160c8b37">N° inventaire</th>
            <th i18n="@@accounting.fixed-assets.designation.63a9062c">Désignation</th>
            <th i18n="@@accounting.fixed-assets.categorie.6b38300a">Catégorie</th>
            <th i18n="@@accounting.fixed-assets.methode.2e94172a">Méthode</th>
            <th class="text-right" i18n="@@accounting.fixed-assets.valeur.origine.785a30c3">Valeur origine</th>
            <th class="text-right" i18n="@@accounting.fixed-assets.amort.cumules.885e6cf3">Amort. cumulés</th>
            <th class="text-right" i18n="@@accounting.fixed-assets.vnc.8a77613b">VNC</th>
            <th i18n="@@accounting.fixed-assets.taux.18bc95b8">Taux</th>
            <th i18n="@@accounting.fixed-assets.statut.659499f3">Statut</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td><code>{{ row.inventoryNumber }}</code></td>
            <td>{{ row.label }}</td>
            <td>{{ row.depreciationRateCategoryLabel }}</td>
            <td>{{ methodLabel(row) }}</td>
            <td class="text-right">{{ row.totalCapitalizedCost | number: '1.3-3' }}</td>
            <td class="text-right">{{ row.accumulatedDepreciation | number: '1.3-3' }}</td>
            <td class="text-right">{{ row.netBookValue | number: '1.3-3' }}</td>
            <td>{{ row.depreciationRatePercent | number: '1.2-2' }} %</td>
            <td><span class="status-pill">{{ statusLabel(row) }}</span></td>
            <td>
              <a [routerLink]="['/accounting/fixed-assets', row.id]" class="link-action" i18n="@@accounting.fixed-assets.ouvrir.42c07747">Ouvrir</a>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="footer">
          <tr class="totals-row">
            <td colspan="4" i18n="@@accounting.fixed-assets.totaux.page.bab590e3"><strong>Totaux page {{ page() }} / {{ totalPages() }}</strong></td>
            <td class="text-right"><strong>{{ totals().origin | number: '1.3-3' }}</strong></td>
            <td class="text-right"><strong>{{ totals().accumulated | number: '1.3-3' }}</strong></td>
            <td class="text-right"><strong>{{ totals().nbv | number: '1.3-3' }}</strong></td>
            <td colspan="3"></td>
          </tr>
        </ng-template>
      </p-table>

      <div class="pagination-bar">
        <span class="page-info" i18n="@@accounting.fixed-assets.immobilisation.s.page.5e90e05f">
          {{ totalCount() }} immobilisation(s) — page {{ page() }} / {{ totalPages() }}
        </span>
        <div class="page-actions">
          <app-button variant="secondary" type="button" (click)="prevPage()" [disabled]="loading() || page() <= 1" i18n="@@accounting.fixed-assets.precedent.a527f171"> Précédent </app-button>
          <app-button variant="secondary" type="button" (click)="nextPage()" [disabled]="loading() || page() >= totalPages()" i18n="@@accounting.fixed-assets.suivant.596d29a7"> Suivant </app-button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .accounting-filter-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      .year-input {
        max-width: 110px;
      }
      .text-right {
        text-align: right;
      }
      .status-pill {
        display: inline-block;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        background: #e0f2fe;
        color: #0369a1;
        font-size: 0.8rem;
      }
      .link-action {
        color: var(--primary-color, #2563eb);
        text-decoration: none;
        font-weight: 500;
      }
      .totals-row td {
        font-weight: var(--font-weight-bold);
        background: var(--color-background-subtle);
        border-top: 2px solid var(--color-border-default);
      }
      .pagination-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 0.75rem;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .page-info {
        font-size: 0.85rem;
        color: #64748b;
      }
      .page-actions {
        display: flex;
        gap: 0.5rem;
      }
    `
  ]
})
export class FixedAssetsListComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(FixedAssetsService);

  readonly FixedAssetStatus = FixedAssetStatus;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly items = signal<FixedAssetDto[]>([]);
  readonly categories = signal<DepreciationRateCategoryDto[]>([]);
  readonly page = signal(1);
  readonly totalCount = signal(0);
  readonly pageSize = 25;

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));
  readonly totals = computed(() => {
    const rows = this.items();
    return {
      origin: rows.reduce((s, r) => s + r.totalCapitalizedCost, 0),
      accumulated: rows.reduce((s, r) => s + r.accumulatedDepreciation, 0),
      nbv: rows.reduce((s, r) => s + r.netBookValue, 0)
    };
  });

  search = '';
  statusFilter: FixedAssetStatus | null = null;
  categoryFilter: string | null = null;
  fiscalYearFilter: number | null = null;

  ngOnInit(): void {
    this.api.getRateCategories().subscribe({
      next: res => this.categories.set(res.data ?? []),
      error: () => this.categories.set([])
    });
    this.load();
  }

  reload(): void {
    this.page.set(1);
    this.load();
  }

  prevPage(): void {
    if (this.page() > 1) {
      this.page.update(p => p - 1);
      this.load();
    }
  }

  nextPage(): void {
    if (this.page() < this.totalPages()) {
      this.page.update(p => p + 1);
      this.load();
    }
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .list({
        page: this.page(),
        pageSize: this.pageSize,
        status: this.statusFilter === null ? undefined : this.statusFilter,
        categoryId: this.categoryFilter ?? undefined,
        fiscalYear: this.fiscalYearFilter ?? undefined,
        search: this.search.trim() || undefined
      })
      .subscribe({
        next: res => {
          this.items.set(res.data?.items ?? []);
          this.totalCount.set(res.data?.totalCount ?? 0);
          this.loading.set(false);
        },
        error: err => {
          this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.fixed-assets-list.ts.impossible.de.charger.le.registre.des.im.82b892b0:Impossible de charger le registre des immobilisations.`));
          this.loading.set(false);
        }
      });
  }

  statusLabel(row: FixedAssetDto): string {
    return FIXED_ASSET_STATUS_LABELS[row.status] ?? '—';
  }

  methodLabel(row: FixedAssetDto): string {
    return DEPRECIATION_METHOD_LABELS[row.depreciationMethod] ?? $localize`:@@ui.tern.lineaire.a5db4c:Linéaire`;
  }
}
