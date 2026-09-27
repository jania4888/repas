/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { PaginatorModule } from 'primeng/paginator';
import { ToastModule } from 'primeng/toast';
import { MenuModule } from 'primeng/menu';
import { ToastService } from '@core/services/toast.service';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import {
  InventoryService,
  PhysicalInventoryListDto,
  InventoryStatus,
  InventorySearchParams,
  InventoryListSummary
} from '@core/services/inventory.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { formatLocalDate } from '@core/utils/date.util';

interface StatusOption {
  label: string;
  value: InventoryStatus | null;
}

@Component({
  selector: 'app-inventory-list',
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
    DatePickerModule,
    PaginatorModule,
    ToastModule,
    MenuModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    StatusBadgeComponent,
    TableTotalsBarComponent
  ],
  templateUrl: './inventory-list.component.html',
  styleUrl: './inventory-list.component.scss'
})
export class InventoryListComponent implements OnInit, OnDestroy {
  private inventoryService = inject(InventoryService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private auth = inject(AuthService);

  canCreateInventory = computed(() => this.auth.hasPermission(PERMISSIONS.inventory.create));
  canUpdateInventory = computed(() => this.auth.hasPermission(PERMISSIONS.inventory.update));

  loading = signal(true);
  initialLoad = signal(true);
  inventories = signal<PhysicalInventoryListDto[]>([]);
  totalRecords = signal(0);
  errorMessage = signal<string | null>(null);

  /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
  summary = signal<InventoryListSummary | null>(null);
  summaryLoading = signal(false);

  summaryMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    return [
      { label: $localize`:@@inventory.list.metric.inventaires:Inventaires`, value: s?.count, format: 'number', icon: 'pi-box', tone: 'primary' },
      { label: $localize`:@@inventory.list.metric.en-cours:En cours`, value: s?.inProgressCount, format: 'number', icon: 'pi-spinner', tone: 'amber' },
      { label: $localize`:@@inventory.list.metric.valides:Validés`, value: s?.validatedCount, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: $localize`:@@inventory.list.metric.produits:Produits`, value: s?.totalProducts, format: 'number', icon: 'pi-database', tone: 'cyan' }
    ];
  });

  searchTerm = '';
  selectedStatus: InventoryStatus | null = null;
  dateRange: Date[] | null = [];
  page = 1;
  pageSize = 10;

  private searchSubject = new Subject<string>();
  private subscriptions = new Subscription();
  private isLoadingInProgress = false;
  private lastErrorTime = 0;
  private readonly ERROR_DEBOUNCE_MS = 2000;
  private readonly SEARCH_DEBOUNCE_MS = 500;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Inventaire' }
  ];

  skeletonColumns: SkeletonColumn[] = [
    { width: '120px' },
    { width: '100px' },
    { width: '180px' },
    { width: '100px' },
    { width: '80px' },
    { width: '100px' }
  ];

  statusOptions: StatusOption[] = [
    { label: $localize`:@@inventory.list.filter.tous:Tous`, value: null },
    { label: $localize`:@@inventory.list.filter.en-cours:En cours`, value: InventoryStatus.InProgress },
    { label: $localize`:@@inventory.list.filter.valide:Valide`, value: InventoryStatus.Validated },
    { label: $localize`:@@inventory.list.filter.annule:Annulé`, value: InventoryStatus.Cancelled }
  ];

  ngOnInit(): void {
    this.subscriptions.add(
      this.searchSubject.pipe(
        debounceTime(this.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged()
      ).subscribe(() => {
        this.page = 1;
        this.loadInventories();
      })
    );
    this.loadInventories();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  loadInventories(): void {
    if (this.isLoadingInProgress) return;
    this.isLoadingInProgress = true;
    this.loading.set(true);
    this.errorMessage.set(null);

    const params: InventorySearchParams = {
      search: this.searchTerm || undefined,
      status: this.selectedStatus ?? undefined,
      fromDate: this.dateRange?.[0] ? formatLocalDate(this.dateRange[0]) : undefined,
      toDate: this.dateRange?.[1] ? formatLocalDate(this.dateRange[1]) : undefined,
      page: this.page,
      pageSize: this.pageSize
    };

    this.loadSummary(params);

    this.inventoryService.getInventories(params).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.inventories.set(response.data.items ?? []);
          this.totalRecords.set(response.data.totalCount ?? 0);
        } else {
          const errorMsg = (response as { error?: string }).error || 'Impossible de charger les inventaires';
          this.errorMessage.set(errorMsg);
          this.showErrorToast(errorMsg);
        }
        this.loading.set(false);
        this.initialLoad.set(false);
        this.isLoadingInProgress = false;
      },
      error: (error) => {
        this.loading.set(false);
        this.initialLoad.set(false);
        this.isLoadingInProgress = false;
        const errorMsg = this.errorHandler.extractErrorMessage(error) || 'Impossible de charger les inventaires';
        this.errorMessage.set(errorMsg);
        this.showErrorToast(errorMsg);
      }
    });
  }

  /** Totaux conformes aux filtres ; échec silencieux pour ne pas perturber la liste. */
  private loadSummary(params: InventorySearchParams): void {
    this.summaryLoading.set(true);
    this.inventoryService.getInventoriesSummary(params).subscribe({
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
    this.searchSubject.next(this.searchTerm);
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadInventories();
  }

  onPageChange(event: TableLazyLoadEvent): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    this.page = Math.floor(first / rows) + 1;
    this.pageSize = rows;
    this.loadInventories();
  }

  private showErrorToast(message: string): void {
    const now = Date.now();
    if (now - this.lastErrorTime < this.ERROR_DEBOUNCE_MS) return;
    this.lastErrorTime = now;
    this.toastService.add({
      key: 'inventory-list-error',
      severity: 'error',
      summary: $localize`:@@inventory-list.component.summary.Erreur:Erreur`,
      detail: message,
      life: 5000
    });
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm || this.selectedStatus !== null || (this.dateRange?.length ?? 0) > 0;
  }

  activeFiltersCount(): number {
    let count = 0;
    if (this.searchTerm) count++;
    if (this.selectedStatus !== null) count++;
    if ((this.dateRange?.length ?? 0) > 0) count++;
    return count;
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = null;
    this.dateRange = [];
    this.page = 1;
    this.loadInventories();
  }

  getStatusBadgeStatus(status: InventoryStatus): StatusBadgeStatus {
    const statusMap: Record<InventoryStatus, StatusBadgeStatus> = {
      [InventoryStatus.InProgress]: 'pending',
      [InventoryStatus.Validated]: 'validated',
      [InventoryStatus.Cancelled]: 'cancelled'
    };
    return statusMap[status] ?? 'draft';
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
