/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { ProductCategoryService, ProductCategory, UpdateProductCategoryRequest } from '@core/services/product-category.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface StatusOption {
  label: string;
  value: boolean | null;
}

@Component({
  selector: 'app-product-category-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TagModule,
    TooltipModule,
    ToastModule,
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
      title="Catégories" i18n-title="@@product-categories.product-category-list.categories.d463d7d2"
      subtitle="Gérez les catégories de vos produits pour les classer dans le catalogue." i18n-subtitle="@@product-categories.product-category-list.gerez.les.categories.de.vos.produits.pou.cb58d006">
      @if (canCreateCategory()) {
        <app-button
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@product-categories.product-category-list.nouvelle.categorie.8c5f928e"> Nouvelle catégorie </app-button>
      }
    </app-page-header>

    <!-- Filters -->
    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@product-categories.product-category-list.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="@@product-categories.product-category-list.reinitialiser.les.filtres.d8915f02" i18n="@@product-categories.product-category-list.reinitialiser.9637f51e">
            <i class="pi pi-times"></i>
            Réinitialiser ({{ activeFiltersCount() }})
          </button>
        }
      </div>
      <div class="ft-filters__row">
        <span class="p-input-icon-left flex-1">
          <i class="pi pi-search"></i>
          <input
            pInputText
            type="text"
            placeholder="Rechercher par code ou nom..." i18n-placeholder="@@product-categories.product-category-list.rechercher.par.code.ou.nom.5764fbc6"
            [(ngModel)]="searchTerm"
            (input)="onFilterChange()"
            class="w-full">
        </span>
        <p-select
          [options]="statusOptions"
          [(ngModel)]="selectedStatus"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts" i18n-placeholder="@@product-categories.product-category-list.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>
      </div>
    </div>

    <!-- Totaux filtrés (conformes aux filtres ; liste chargée côté client) -->
    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

    <!-- Table -->
    <div class="ft-table-card">
      @if (loading() && categories().length === 0) {
        <app-skeleton-table
          [rows]="5"
          [columns]="skeletonColumns">
        </app-skeleton-table>
      } @else {
        <p-table
          [value]="filteredCategories()"
          [loading]="loading()"
          [paginator]="filteredCategories().length > 10"
          [rows]="20"
          [rowHover]="true"
          styleClass="p-datatable-sm">

          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="code" style="width: 140px"><ng-container i18n="@@product-categories.product-category-list.code.adac6937">Code </ng-container> <p-sortIcon field="code"></p-sortIcon></th>
              <th pSortableColumn="name"><ng-container i18n="@@product-categories.product-category-list.nom.7ff20370">Nom </ng-container> <p-sortIcon field="name"></p-sortIcon></th>
              <th pSortableColumn="displayOrder" style="width: 140px"><ng-container i18n="@@product-categories.product-category-list.ordre.d.affichage.6978b883">Ordre d'affichage </ng-container> <p-sortIcon field="displayOrder"></p-sortIcon></th>
              <th style="width: 100px" i18n="@@product-categories.product-category-list.statut.659499f3">Statut</th>
              <th style="width: 140px" class="text-right" i18n="@@product-categories.product-category-list.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-cat>
            <tr>
              <td>
                <code class="category-code">{{ cat.code }}</code>
              </td>
              <td>
                <span class="category-name">{{ cat.name }}</span>
              </td>
              <td>{{ cat.displayOrder }}</td>
              <td>
                <p-tag
                  [value]="cat.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033"
                  [severity]="cat.isActive ? 'success' : 'secondary'">
                </p-tag>
              </td>
              <td>
                <div class="actions justify-end">
                  @if (toggleLoading().has(cat.id)) {
                    <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
                  } @else if (canUpdateCategory()) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      [icon]="cat.isActive ? 'pi-ban' : 'pi-check-circle'"
                      [iconOnly]="true"
                      [pTooltip]="cat.isActive ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_activer_b96fa7"
                      tooltipPosition="top"
                      (click)="toggleActive(cat)"
                      [attr.aria-label]="cat.isActive ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_activer_b96fa7">
                    </app-button>
                  }
                  @if (canUpdateCategory()) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      icon="pi-pencil"
                      [iconOnly]="true"
                      [routerLink]="[cat.id, 'edit']"
                      ariaLabel="Modifier la catégorie" i18n-ariaLabel="@@product-categories.product-category-list.modifier.la.categorie.23404212">
                    </app-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5" class="text-center p-6">
                <app-empty-state
                  [icon]="'pi-tags'"
                  title="Aucune catégorie" i18n-title="@@product-categories.product-category-list.aucune.categorie.33bf71cf"
                  description="Créez des catégories pour classer vos produits (ex. General, Services, Marchandises)." i18n-description="@@product-categories.product-category-list.creez.des.categories.pour.classer.vos.pr.bdc32a9f"
                  [showAction]="canCreateCategory()"
                  actionLabel="Nouvelle catégorie" i18n-actionLabel="@@product-categories.product-category-list.nouvelle.categorie.6f837723"
                  actionRoute="new">
                </app-empty-state>
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
  `,
  styles: [`
    .flex-1 { flex: 1; min-width: 200px; }

    .category-code {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-size: var(--font-size-sm);
      background: var(--color-neutral-100);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-sm);
    }

    .category-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-900);
    }

    .actions {
      display: flex;
      gap: var(--spacing-1);
    }

    .justify-end {
      justify-content: flex-end;
    }

    .text-right {
      text-align: right;
    }
  `]
})
export class ProductCategoryListComponent implements OnInit {
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_desactiver_d28397 = $localize`:@@ui.tern.desactiver.d28397:Désactiver`;
  readonly loc_ui_tern_activer_b96fa7 = $localize`:@@ui.tern.activer.b96fa7:Activer`;
  private productCategoryService = inject(ProductCategoryService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private auth = inject(AuthService);

  canCreateCategory = computed(() => this.auth.hasPermission(PERMISSIONS.products.create));
  canUpdateCategory = computed(() => this.auth.hasPermission(PERMISSIONS.products.update));

  loading = signal(true);
  categories = signal<ProductCategory[]>([]);
  toggleLoading = signal<Set<string>>(new Set());

  searchTerm = '';
  selectedStatus: boolean | null = null;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Catégories' }
  ];

  skeletonColumns: SkeletonColumn[] = [
    { width: '140px' },
    { width: '200px' },
    { width: '140px' },
    { width: '100px' },
    { width: '140px' }
  ];

  statusOptions: StatusOption[] = [
    { label: 'Actifs', value: true },
    { label: 'Inactifs', value: false }
  ];

  hasActiveFilters = computed(() => {
    return !!(this.searchTerm || this.selectedStatus !== null);
  });

  activeFiltersCount = computed(() => {
    let count = 0;
    if (this.searchTerm) count++;
    if (this.selectedStatus !== null) count++;
    return count;
  });

  filteredCategories = computed(() => {
    const list = this.categories();
    let result = list;
    const term = this.searchTerm?.trim()?.toLowerCase();
    if (term) {
      result = result.filter(
        c => c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term)
      );
    }
    if (this.selectedStatus !== null) {
      result = result.filter(c => c.isActive === this.selectedStatus);
    }
    return result;
  });

  /** Totaux de la zone, calculés sur les catégories filtrées (liste chargée côté client). */
  summaryMetrics = computed<TotalMetric[]>(() => {
    const rows = this.filteredCategories();
    return [
      { label: 'Catégories', value: rows.length, format: 'number', icon: 'pi-tags', tone: 'primary' },
      { label: 'Actives', value: rows.filter(c => c.isActive).length, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: 'Inactives', value: rows.filter(c => !c.isActive).length, format: 'number', icon: 'pi-ban', tone: 'neutral' }
    ];
  });

  ngOnInit(): void {
    this.loadCategories();
  }

  loadCategories(): void {
    this.loading.set(true);
    this.productCategoryService.getCategoryList().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.categories.set(response.data);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-category-list.component.summary.Erreur:Erreur`,
            detail: response.errors?.join(', ') || 'Impossible de charger les catégories'
          });
          this.categories.set([]);
        }
        this.loading.set(false);
      },
      error: (err) => {
        const msg = this.errorHandler.extractErrorMessage(err);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-category-list.component.summary.Erreur:Erreur`,
          detail: msg || 'Impossible de charger les catégories'
        });
        this.errorHandler.logError('Failed to load product categories', err);
        this.categories.set([]);
        this.loading.set(false);
      }
    });
  }

  onFilterChange(): void {
    // Filtering is done via computed filteredCategories()
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = null;
  }

  toggleActive(cat: ProductCategory): void {
    this.toggleLoading.update(s => new Set(s).add(cat.id));
    const body: UpdateProductCategoryRequest = {
      name: cat.name,
      displayOrder: cat.displayOrder,
      isActive: !cat.isActive
    };
    this.productCategoryService.updateCategory(cat.id, body).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.categories.update(list =>
            list.map(c => (c.id === cat.id ? { ...c, ...response.data } : c))
          );
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@product-category-list.component.summary.Succès:Succès`,
            detail: body.isActive ? $localize`:@@ui.tern.categorie.activee.c0381e:Catégorie activée.` : $localize`:@@ui.tern.categorie.desactivee.a1e015:Catégorie désactivée.`
          });
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-category-list.component.summary.Erreur:Erreur`,
            detail: response.errors?.join(', ') || response.message || 'Action impossible'
          });
        }
        this.toggleLoading.update(s => { const n = new Set(s); n.delete(cat.id); return n; });
      },
      error: (err) => {
        const msg = this.errorHandler.extractErrorMessage(err);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-category-list.component.summary.Erreur:Erreur`,
          detail: msg || 'Action impossible'
        });
        this.errorHandler.logError('Toggle category active failed', err);
        this.toggleLoading.update(s => { const n = new Set(s); n.delete(cat.id); return n; });
      }
    });
  }
}
