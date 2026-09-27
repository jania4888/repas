import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  InventoryService,
  PhysicalInventoryDetailDto,
  InventoryStatus
} from '@core/services/inventory.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-inventory-detail',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    RouterModule,
    ButtonModule,
    CardModule,
    TableModule,
    SkeletonModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    StatusBadgeComponent,
    EmptyStateComponent
  ],
  templateUrl: './inventory-detail.component.html',
  styleUrl: './inventory-detail.component.scss'
})
export class InventoryDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inventoryService = inject(InventoryService);
  private errorHandler = inject(ErrorHandlerService);

  loading = signal(true);
  notFound = signal(false);
  inventory = signal<PhysicalInventoryDetailDto | null>(null);

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const inv = this.inventory();
    return [
      { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
      { label: 'Inventaire', route: '/inventory' },
      { label: inv?.reference ?? $localize`:@@ui.tern.detail.7ce06a:Détail` }
    ];
  });

  progressPercent = computed(() => {
    const inv = this.inventory();
    if (!inv?.totalProducts) return 0;
    return (inv.countedProducts / inv.totalProducts) * 100;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }
    this.inventoryService.getInventoryById(id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.inventory.set(response.data);
        } else {
          this.notFound.set(true);
        }
        this.loading.set(false);
      },
      error: (error) => {
        const msg = this.errorHandler.extractErrorMessage(error);
        if (error?.status === 404 || msg?.toLowerCase().includes('not found')) {
          this.notFound.set(true);
        }
        this.loading.set(false);
      }
    });
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
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  getDiffAriaLabel(difference: number): string {
    if (difference > 0) return `Écart: surplus ${difference}`;
    if (difference < 0) return `Écart: manquant ${Math.abs(difference)}`;
    return 'Écart: nul';
  }

  goToList(): void {
    this.router.navigate(['/inventory']);
  }
}
