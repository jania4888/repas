/// <reference types="@angular/localize" />
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { SupplierService, SupplierListItem, SupplierSearchParams, SupplierType, SupplierListSummary } from '@core/services/supplier.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { applySupplierListFiltersFromQuery } from '@core/utils/list-filter-from-query';
import { take } from 'rxjs/operators';

interface TypeOption {
    label: string;
    value: SupplierType | null;
}

interface StatusOption {
    label: string;
    value: boolean | null;
}

@Component({
    selector: 'app-supplier-list',
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
      title="Fournisseurs" i18n-title="@@suppliers.supplier-list.fournisseurs.06b6d88c"
      subtitle="Gérez vos fournisseurs pour les bons de commande." i18n-subtitle="@@suppliers.supplier-list.gerez.vos.fournisseurs.pour.les.bons.de.561fe7a4">
      @if (canCreateSupplier()) {
        <app-button
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@suppliers.supplier-list.ajouter.un.fournisseur.cfb5e618"> Ajouter un fournisseur </app-button>
      }
    </app-page-header>

    <!-- Filters -->
    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@suppliers.supplier-list.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="@@suppliers.supplier-list.reinitialiser.les.filtres.d8915f02" i18n="@@suppliers.supplier-list.reinitialiser.9637f51e">
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
            placeholder="Rechercher par nom, email ou NIF…" i18n-placeholder="@@suppliers.supplier-list.rechercher.par.nom.email.ou.nif.e25e488c"
            [(ngModel)]="searchTerm"
            (input)="onSearchInput($event)"
            class="w-full">
        </span>

        <p-select
          [options]="typeOptions"
          [(ngModel)]="selectedType"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les types" i18n-placeholder="@@suppliers.supplier-list.tous.les.types.5a6be24d"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>

        <p-select
          [options]="statusOptions"
          [(ngModel)]="selectedStatus"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts" i18n-placeholder="@@suppliers.supplier-list.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>
      </div>
    </div>

    <!-- Totaux (calculés côté backend sur l'ensemble filtré, pas seulement la page) -->
    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="summaryLoading()"></app-table-totals-bar>

    <!-- Table -->
    <div class="ft-table-card">
      @if (loading() && suppliers().length === 0) {
        <app-skeleton-table
          [rows]="5"
          [columns]="skeletonColumns">
        </app-skeleton-table>
      } @else {
        <p-table
          [value]="suppliers()"
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} fournisseurs" i18n-currentPageReportTemplate="@@suppliers.supplier-list.affichage.de.first.a.last.sur.totalrecords.fourn.72f8264d"
          (onLazyLoad)="onPageChange($event)"
          [loading]="loading()"
          [first]="(page - 1) * pageSize"
          [rowHover]="true"
          styleClass="p-datatable-sm">

        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="name"><ng-container i18n="@@suppliers.supplier-list.nom.7ff20370">Nom </ng-container> <p-sortIcon field="name"></p-sortIcon></th>
            <th i18n="@@suppliers.supplier-list.contact.b37456c4">Contact</th>
            <th i18n="@@suppliers.supplier-list.nif.77124a3a">NIF</th>
            <th i18n="@@suppliers.supplier-list.type.3deb7456">Type</th>
            <th i18n="@@suppliers.supplier-list.localisation.84e3d483">Localisation</th>
            <th style="width: 120px" i18n="@@suppliers.supplier-list.delai.paiement.bfca1de5">Délai paiement</th>
            <th style="width: 80px" i18n="@@suppliers.supplier-list.statut.659499f3">Statut</th>
            <th style="width: 100px" i18n="@@suppliers.supplier-list.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-supplier>
          <tr>
            <td>
              <div class="supplier-name">
                <a [routerLink]="[supplier.id]" class="name-link">{{ supplier.name }}</a>
                @if (supplier.contactPerson) {
                  <span class="contact-person">{{ supplier.contactPerson }}</span>
                }
              </div>
            </td>
            <td>
              <div class="contact-info">
                @if (supplier.email) {
                  <a [href]="'mailto:' + supplier.email" class="email">{{ supplier.email }}</a>
                } @else {
                  <span class="email" i18n="@@suppliers.supplier-list.text.1b93795b">—</span>
                }
                <span class="phone">{{ supplier.phone || '-' }}</span>
              </div>
            </td>
            <td>
              <span class="nif">{{ supplier.nif || '-' }}</span>
            </td>
            <td>
              <p-tag
                [value]="supplier.typeDisplay"
                [severity]="getTypeSeverity(supplier.type)">
              </p-tag>
            </td>
            <td>
              <span class="location">{{ supplier.city }}, {{ supplier.governorate }}</span>
            </td>
            <td class="text-center">
              <span class="payment-term">{{ supplier.paymentTermDays }}j</span>
            </td>
            <td>
              <p-tag
                [value]="supplier.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033"
                [severity]="supplier.isActive ? 'success' : 'secondary'">
              </p-tag>
            </td>
            <td>
              <div class="actions">
                <app-button
                  variant="ghost"
                  size="sm"
                  icon="pi-eye"
                  [iconOnly]="true"
                  [routerLink]="supplier.id"
                  ariaLabel="Voir le fournisseur" i18n-ariaLabel="@@suppliers.supplier-list.voir.le.fournisseur.f9af0e37">
                </app-button>
                @if (canEditSupplier()) {
                  <app-button
                    variant="ghost"
                    size="sm"
                    icon="pi-pencil"
                    [iconOnly]="true"
                    [routerLink]="[supplier.id, 'edit']"
                    ariaLabel="Modifier le fournisseur" i18n-ariaLabel="@@suppliers.supplier-list.modifier.le.fournisseur.df265ac3">
                  </app-button>
                }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="8" class="text-center p-6">
              <app-empty-state
                title="Aucun fournisseur" i18n-title="@@suppliers.supplier-list.aucun.fournisseur.44a1e39f"
                description="Ajoutez votre premier fournisseur pour créer des bons de commande." i18n-description="@@suppliers.supplier-list.ajoutez.votre.premier.fournisseur.pour.c.a43e54d7"
                [showAction]="canCreateSupplier()"
                actionLabel="Ajouter un fournisseur" i18n-actionLabel="@@suppliers.supplier-list.ajouter.un.fournisseur.e17d0606"
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
    .supplier-name {
      display: flex;
      flex-direction: column;
      gap: 2px;

      .name-link {
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary-600);
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }
      }

      .contact-person {
        font-size: var(--font-size-xs);
        color: var(--color-neutral-500);
      }
    }

    .contact-info {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      .email {
        color: var(--color-primary-600);
        font-size: var(--font-size-sm);
      }

      .phone {
        color: var(--color-neutral-600);
        font-size: var(--font-size-sm);
      }
    }

    .nif {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
    }

    .location {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .payment-term {
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
    }

    .actions {
      display: flex;
      gap: var(--spacing-1);
    }
  `]
})
export class SupplierListComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
    private supplierService = inject(SupplierService);
    private toastService = inject(ToastService);
    private auth = inject(AuthService);
    private route = inject(ActivatedRoute);

    canCreateSupplier = computed(() => this.auth.hasPermission(PERMISSIONS.suppliers.create));
    canEditSupplier = computed(() => this.auth.hasPermission(PERMISSIONS.suppliers.update));

    private destroy$ = new Subject<void>();
    private searchSubject = new Subject<string>();
    private initialLoadDone = false;
    private isFirstLoad = true;

    loading = signal(true);
  initialLoad = signal(true);
    suppliers = signal<SupplierListItem[]>([]);
    totalRecords = signal(0);

    /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
    summary = signal<SupplierListSummary | null>(null);
    summaryLoading = signal(false);

    summaryMetrics = computed<TotalMetric[]>(() => {
        const s = this.summary();
        return [
            { label: $localize`:@@suppliers.supplier-list.ts.fournisseurs.06b6d88c:Fournisseurs`, value: s?.count, format: 'number', icon: 'pi-truck', tone: 'primary' },
            { label: $localize`:@@suppliers.supplier-list.ts.actifs.4fc3a980:Actifs`, value: s?.activeCount, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
            { label: $localize`:@@suppliers.supplier-list.ts.inactifs.41c2d03e:Inactifs`, value: s?.inactiveCount, format: 'number', icon: 'pi-ban', tone: 'neutral' }
        ];
    });

    searchTerm = '';
    selectedType: SupplierType | null = null;
    selectedStatus: boolean | null = null;
    page = 1;
    pageSize = 20;

    breadcrumbItems: BreadcrumbItem[] = [
        { label: $localize`:@@suppliers.supplier-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
        { label: $localize`:@@suppliers.supplier-list.ts.achats.ee5b078c:Achats` },
        { label: $localize`:@@suppliers.supplier-list.ts.fournisseurs.06b6d88c:Fournisseurs` }
    ];

    skeletonColumns: SkeletonColumn[] = [
        { width: '200px' },
        { width: '180px' },
        { width: '120px' },
        { width: '100px' },
        { width: '150px' },
        { width: '100px' },
        { width: '80px' },
        { width: '100px' }
    ];

    typeOptions: TypeOption[] = [
        { label: $localize`:@@suppliers.supplier-list.ts.particulier.281680dd:Particulier`, value: SupplierType.Individual },
        { label: $localize`:@@suppliers.supplier-list.ts.entreprise.d03e74b6:Entreprise`, value: SupplierType.Business }
    ];

    statusOptions: StatusOption[] = [
        { label: $localize`:@@suppliers.supplier-list.ts.actifs.4fc3a980:Actifs`, value: true },
        { label: $localize`:@@suppliers.supplier-list.ts.inactifs.41c2d03e:Inactifs`, value: false }
    ];

    ngOnInit(): void {
        this.route.queryParamMap.pipe(take(1)).subscribe((paramMap) => {
            const applied = applySupplierListFiltersFromQuery(paramMap, {
                search: this.searchTerm || null
            });
            if (applied.search) {
                this.searchTerm = applied.search;
            }
        });

        this.searchSubject
            .pipe(
                debounceTime(300),
                distinctUntilChanged(),
                takeUntil(this.destroy$)
            )
            .subscribe(() => this.onSearch());

        this.loadSuppliers();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.searchSubject.complete();
    }

    /** Totaux conformes aux filtres ; échec silencieux pour ne pas perturber la liste. */
    private loadSummary(params: SupplierSearchParams): void {
        this.summaryLoading.set(true);
        this.supplierService.getSuppliersSummary(params).subscribe({
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

    loadSuppliers(): void {
        if (this.loading() && this.suppliers().length > 0) return;

        this.loading.set(true);

        const params: SupplierSearchParams = {
            search: this.searchTerm || undefined,
            type: this.selectedType ?? undefined,
            isActive: this.selectedStatus ?? undefined,
            page: this.page,
            pageSize: this.pageSize
        };

        this.loadSummary(params);

        this.supplierService.getSuppliers(params).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.suppliers.set(response.data.items);
                    this.totalRecords.set(response.data.totalCount);
                    this.initialLoadDone = true;
                }
                this.loading.set(false);
        this.initialLoad.set(false);
            },
            error: (error) => {
                this.loading.set(false);
        this.initialLoad.set(false);
                this.toastService.add({
                    severity: 'error',
                    summary: $localize`:@@supplier-list.component.summary.Erreur:Erreur`,
                    detail: error?.error?.errors?.[0] || $localize`:@@suppliers.supplier-list.ts.impossible.de.charger.les.fournisseurs.33d5b97f:Impossible de charger les fournisseurs`
                });
            }
        });
    }

    onSearchInput(event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.searchSubject.next(value);
    }

    onSearch(): void {
        this.page = 1;
        this.loadSuppliers();
    }

    onPageChange(event: any): void {
        const first = event.first ?? 0;
        const rows = event.rows ?? this.pageSize;
        this.page = rows ? Math.floor(first / rows) + 1 : 1;
        this.pageSize = rows || this.pageSize;

        if (this.isFirstLoad && first === 0 && this.initialLoadDone) {
            this.isFirstLoad = false;
            return;
        }

        this.loadSuppliers();
        this.isFirstLoad = false;
    }

    getTypeSeverity(type: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
        return type === 'Business' ? 'success' : 'info';
    }

    hasActiveFilters(): boolean {
        return !!this.searchTerm || this.selectedType !== null || this.selectedStatus !== null;
    }

    activeFiltersCount(): number {
        let count = 0;
        if (this.searchTerm) count++;
        if (this.selectedType !== null) count++;
        if (this.selectedStatus !== null) count++;
        return count;
    }

    onFilterChange(): void {
        this.page = 1;
        this.loadSuppliers();
    }

    resetFilters(): void {
        this.searchTerm = '';
        this.selectedType = null;
        this.selectedStatus = null;
        this.page = 1;
        this.loadSuppliers();
    }
}
