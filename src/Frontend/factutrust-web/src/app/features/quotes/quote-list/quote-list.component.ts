import { Component, OnInit, inject, signal, computed } from '@angular/core';
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
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { formatLocalDate } from '@core/utils/date.util';
import {
  QuoteService,
  QuoteListItem,
  QuoteSearchParams,
  QuoteListSummary,
} from '@core/services/quote.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { take } from 'rxjs/operators';
import {
  applyQuoteListFiltersFromQuery,
  isActiveQuoteStatus
} from '@core/utils/list-filter-from-query';

interface StatusOption {
  label: string;
  value: number | null;
}

@Component({
  selector: 'app-quote-list',
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
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    StatusBadgeComponent,
    TableTotalsBarComponent,
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Devis" i18n-title="Devis"
      subtitle="Créez, envoyez et transformez vos devis en factures">
      @if (canCreateQuote()) {
        <app-button
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@quotes.quote-list.creer.un.devis.426c5610">Créer un devis</app-button>
      }
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="Réinitialiser les filtres">
            <i class="pi pi-times"></i>
            Réinitialiser ({{ activeFiltersCount() }})
          </button>
        }
      </div>
      <div class="ft-filters__row">
        <span class="p-input-icon-left">
          <i class="pi pi-search"></i>
          <input
            pInputText
            type="text"
            placeholder="Rechercher..." i18n-placeholder="Rechercher..."
            [(ngModel)]="searchTerm"
            (input)="onSearch()" />
        </span>
        <p-select
          [options]="statusOptions"
          [(ngModel)]="selectedStatus"
          placeholder="Tous les statuts" i18n-placeholder="Tous les statuts"
          [showClear]="true"
          (onChange)="onSearch()">
        </p-select>
        <p-datepicker
          [(ngModel)]="dateRange"
          selectionMode="range"
          [readonlyInput]="true"
          placeholder="Période" i18n-placeholder="Période"
          dateFormat="dd/mm/yy"
          [showClear]="true"
          (onSelect)="onSearch()">
        </p-datepicker>
      </div>
    </div>

    @if (!activeOnly) {
      <!-- Totaux (calculés côté backend sur l'ensemble filtré, pas seulement la page) -->
      <app-table-totals-bar
        [metrics]="summaryMetrics()"
        [loading]="summaryLoading()">
      </app-table-totals-bar>
    }

    <div class="ft-table-card">
      @if (initialLoad()) {
      <app-skeleton-table
          [rows]="5"
          [columns]="skeletonColumns">
        </app-skeleton-table>
      } @else {
        <p-table
          [value]="quotes()"
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} devis"
          (onLazyLoad)="onPageChange($event)"
          [loading]="loading()"
          styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@quotes.quote-list.numero.15e73db0">Numéro</th>
              <th i18n="@@quotes.quote-list.client.1bdd79b1">Client</th>
              <th i18n="@@quotes.quote-list.date.eb9a4bc1">Date</th>
              <th i18n="@@quotes.quote-list.validite.jusqu.au.b8609845">Validité jusqu'au</th>
              <th i18n="@@quotes.quote-list.montant.4adcd9fc">Montant</th>
              <th i18n="@@quotes.quote-list.statut.659499f3">Statut</th>
              <th style="width: 120px" i18n="@@quotes.quote-list.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-quote>
            <tr [class.expired]="quote.isExpired && !quote.isConverted">
              <td>
                <a [routerLink]="[quote.id]" class="quote-number">
                  {{ quote.number }}
                </a>
              </td>
              <td>{{ quote.clientName }}</td>
              <td>{{ quote.issueDate | date:'dd/MM/yyyy' }}</td>
              <td>
                <span [class.text-error]="quote.isExpired && !quote.isConverted">
                  {{ quote.expiryDate | date:'dd/MM/yyyy' }}
                </span>
              </td>
              <td class="amount">
                {{ quote.totalAmount | number:'1.3-3' }} {{ quote.currency }}
              </td>
              <td>
                <app-status-badge
                  [status]="getStatusBadgeStatus(quote.status)"
                  [label]="quote.status">
                </app-status-badge>
              </td>
              <td>
                <div class="actions">
                  <app-button
                    variant="ghost"
                    size="sm"
                    icon="pi-eye"
                    [iconOnly]="true"
                    [iconAlwaysVisible]="true"
                    pTooltip="Voir"
                    [routerLink]="[quote.id]"
                    ariaLabel="Voir le devis">
                  </app-button>
                  <app-button
                    variant="ghost"
                    size="sm"
                    icon="pi-download"
                    [iconOnly]="true"
                    [iconAlwaysVisible]="true"
                    pTooltip="Télécharger PDF"
                    (click)="downloadPdf(quote)"
                    ariaLabel="Télécharger le PDF">
                  </app-button>
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="text-center p-6">
                <app-empty-state
                  illustration="empty-quotes.svg"
                  title="Aucun devis" i18n-title="Aucun devis"
                  description="Créez votre premier devis pour vos clients."
                  [showAction]="canCreateQuote()"
                  actionLabel="Créer un devis"
                  actionRoute="new">
                </app-empty-state>
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
  `,
  styles: [
    `
      .quote-number {
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary-600);
      }
      .amount {
        font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
        font-weight: var(--font-weight-medium);
      }
      .actions {
        display: flex;
        gap: var(--spacing-1);
      }
      tr.expired {
        background: var(--color-warning-50);
      }
      .text-error {
        color: var(--color-error-600);
      }
      .text-center {
        text-align: center;
      }
      .p-6 {
        padding: var(--spacing-6);
      }
    `,
  ],
})
export class QuoteListComponent implements OnInit {
  private quoteService = inject(QuoteService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  canCreateQuote = computed(() => this.auth.hasPermission(PERMISSIONS.quotes.create));

  loading = signal(true);
  initialLoad = signal(true);
  quotes = signal<QuoteListItem[]>([]);
  totalRecords = signal(0);

  /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
  summary = signal<QuoteListSummary | null>(null);
  summaryLoading = signal(false);

  summaryMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    const currency = s?.currency ?? 'TND';
    return [
      { label: 'Devis', value: s?.count, format: 'number', icon: 'pi-file', tone: 'primary' },
      { label: 'Total TTC', value: s?.totalTtc, format: 'currency', currency, icon: 'pi-wallet', tone: 'primary' },
      { label: 'Total HT', value: s?.totalHt, format: 'currency', currency, icon: 'pi-calculator', tone: 'cyan' },
      { label: 'Acceptés', value: s?.acceptedCount, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: 'Expirés', value: s?.expiredCount, format: 'number', icon: 'pi-exclamation-triangle', tone: 'rose' }
    ];
  });

  searchTerm = '';
  selectedStatus: number | null = null;
  activeOnly = false;
  dateRange: Date[] = [];
  page = 1;
  pageSize = 20;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Devis' },
  ];

  skeletonColumns: SkeletonColumn[] = [
    { width: '120px' },
    { width: '200px' },
    { width: '100px' },
    { width: '120px' },
    { width: '120px' },
    { width: '120px' },
    { width: '100px' },
  ];

  statusOptions: StatusOption[] = [
    { label: 'Brouillon', value: 0 },
    { label: 'Envoyé', value: 1 },
    { label: 'Accepté', value: 2 },
    { label: 'Refusé', value: 3 },
    { label: 'Expiré', value: 4 },
    { label: 'Facturé', value: 5 },
    { label: 'Annulé', value: 6 },
  ];

  private isLoadingQuotes = false;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(take(1)).subscribe((paramMap) => {
      const applied = applyQuoteListFiltersFromQuery(paramMap, {
        selectedStatus: this.selectedStatus,
        activeOnly: this.activeOnly,
        search: this.searchTerm || null
      });
      this.selectedStatus = applied.selectedStatus;
      this.activeOnly = applied.activeOnly;
      if (applied.search) {
        this.searchTerm = applied.search;
      }
    });
    this.loading.set(true);
    this.loadQuotes();
  }

  loadQuotes(): void {
    // Éviter les appels multiples simultanés
    if (this.isLoadingQuotes) {
      return;
    }

    this.isLoadingQuotes = true;
    this.loading.set(true);
    const params: QuoteSearchParams = {
      search: this.searchTerm || undefined,
      status: this.activeOnly ? undefined : (this.selectedStatus ?? undefined),
      fromDate: this.dateRange[0] ? formatLocalDate(this.dateRange[0]) : undefined,
      toDate: this.dateRange[1] ? formatLocalDate(this.dateRange[1]) : undefined,
      page: this.activeOnly ? 1 : this.page,
      pageSize: this.activeOnly ? 200 : this.pageSize,
    };
    // Totaux conformes aux filtres (hors mode activeOnly, filtré côté client).
    if (!this.activeOnly) {
      this.loadSummary(params);
    }
    this.quoteService.getQuotes(params).subscribe({
      next: (res) => {
        if (res.success) {
          const items = this.activeOnly
            ? res.data.items.filter((q) => isActiveQuoteStatus(q.status))
            : res.data.items;
          this.quotes.set(items);
          this.totalRecords.set(this.activeOnly ? items.length : res.data.totalCount);
        }
        this.loading.set(false);
        this.initialLoad.set(false);
        this.isLoadingQuotes = false;
      },
      error: (error) => {
        this.loading.set(false);
        this.initialLoad.set(false);
        this.isLoadingQuotes = false;

        // En cas d'erreur 429, ne pas réessayer immédiatement pour éviter les boucles
        if (error?.status === 429) {
          console.warn('Rate limit atteint pour quotes. Arrêt des tentatives.');
          // Ne pas déclencher de nouveau chargement automatique
          return;
        }
      },
    });
  }

  /** Totaux conformes aux filtres ; échec silencieux pour ne pas perturber la liste. */
  private loadSummary(params: QuoteSearchParams): void {
    this.summaryLoading.set(true);
    this.quoteService.getQuotesSummary({ ...params, skipGlobalErrorUi: true }).subscribe({
      next: (response) => {
        this.summary.set(response.success && response.data ? response.data : null);
        this.summaryLoading.set(false);
      },
      error: () => {
        this.summary.set(null);
        this.summaryLoading.set(false);
      }
    });
  }

  onSearch(): void {
    this.page = 1;
    this.isLoadingQuotes = false;
    this.loadQuotes();
  }

  onPageChange(event: { first?: number; rows?: number | null }): void {
    // Éviter les appels si déjà en cours de chargement
    if (this.isLoadingQuotes) {
      return;
    }

    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    const newPage = rows ? Math.floor(first / rows) + 1 : 1;
    const newPageSize = rows || this.pageSize;

    // Ne recharger que si la page ou la taille a changé
    if (newPage !== this.page || newPageSize !== this.pageSize) {
      this.page = newPage;
      this.pageSize = newPageSize;
      this.loadQuotes();
    }
  }

  downloadPdf(quote: QuoteListItem): void {
    this.quoteService.downloadPdf(quote.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Devis_${quote.number}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
    });
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm || this.selectedStatus !== null || this.activeOnly || this.dateRange?.length > 0;
  }

  activeFiltersCount(): number {
    let c = 0;
    if (this.searchTerm) c++;
    if (this.selectedStatus !== null) c++;
    if (this.activeOnly) c++;
    if (this.dateRange?.length) c++;
    return c;
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = null;
    this.activeOnly = false;
    this.dateRange = [];
    this.onSearch();
  }

  getStatusBadgeStatus(status: string): StatusBadgeStatus {
    // Map quote status strings to StatusBadgeStatus
    const statusLower = status.toLowerCase();
    if (statusLower.includes('brouillon') || statusLower.includes('draft')) return 'draft';
    if (statusLower.includes('envoyé') || statusLower.includes('sent')) return 'sent';
    if (statusLower.includes('accepté') || statusLower.includes('accepted')) return 'accepted';
    if (statusLower.includes('refusé') || statusLower.includes('rejected')) return 'rejected';
    if (statusLower.includes('expiré') || statusLower.includes('expired')) return 'expired';
    if (statusLower.includes('facturé') || statusLower.includes('transformé') || statusLower.includes('converted')) return 'converted';
    if (statusLower.includes('annulé') || statusLower.includes('cancelled')) return 'cancelled';
    return 'draft';
  }
}
