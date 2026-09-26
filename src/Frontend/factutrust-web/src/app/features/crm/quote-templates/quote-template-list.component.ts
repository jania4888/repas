import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { CrmService, QuoteTemplateDto } from '../services/crm.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

interface ActiveFilterOption {
  label: string;
  value: boolean | null;
}

@Component({
  selector: 'app-quote-template-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    InputSwitchModule,
    TooltipModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    StatusBadgeComponent,
    TableTotalsBarComponent,
  ],
  template: `
    <p-toast></p-toast>
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Modèles de devis" i18n-title="Modèles de devis"
      subtitle="Modèles réutilisables pour accélérer la création de devis et harmoniser vos offres.">
      @if (canCreate()) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" routerLink="new" i18n="@@crm.quote-templates.nouveau.modele.c5b99d5d">Nouveau modèle</app-button>
      }
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            type="button"
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="Réinitialiser les filtres">
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
            placeholder="Rechercher par nom ou description…" i18n-placeholder="Rechercher par nom ou description…"
            [(ngModel)]="searchTerm"
            (input)="onSearchInput()"
            class="w-full" />
        </span>
        <p-select
          [options]="activeFilterOptions"
          [(ngModel)]="selectedActiveFilter"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts" i18n-placeholder="Tous les statuts"
          [showClear]="true"
          (onChange)="load()">
        </p-select>
      </div>
    </div>

    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

    <div class="ft-table-card">
      @if (initialLoad()) {
        <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
      } @else {
        <p-table
          [value]="items()"
          [paginator]="true"
          [rows]="10"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} modèles"
          [loading]="loading()"
          styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@crm.quote-templates.nom.7ff20370">Nom</th>
              <th i18n="@@crm.quote-templates.description.55f8ebc8">Description</th>
              <th i18n="@@crm.quote-templates.validite.8be7d506">Validité</th>
              <th i18n="@@crm.quote-templates.lignes.41c7025e">Lignes</th>
              <th i18n="@@crm.quote-templates.utilisations.67a8be8f">Utilisations</th>
              <th i18n="@@crm.quote-templates.actif.2eb75f84">Actif</th>
              <th style="width: 140px" i18n="@@crm.quote-templates.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-t>
            <tr>
              <td style="font-weight: 600">{{ t.name }}</td>
              <td>{{ t.description || '—' }}</td>
              <td>{{ t.defaultValidityDays }} j.</td>
              <td>{{ t.lines?.length ?? 0 }}</td>
              <td>{{ t.usageCount }}</td>
              <td>
                @if (canUpdate()) {
                  <p-inputSwitch
                    [ngModel]="t.isActive"
                    (ngModelChange)="onToggleActive(t, $event)"
                    [inputId]="'act-' + t.id"
                    [attr.aria-label]="'Activer ou désactiver ' + t.name" />
                } @else {
                  <app-status-badge
                    [status]="t.isActive ? 'active' : 'inactive'"
                    [label]="t.isActive ? 'Oui' : 'Non'"
                    [showIcon]="true">
                  </app-status-badge>
                }
              </td>
              <td>
                <div class="actions">
                  @if (canUpdate()) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      icon="pi-pencil"
                      [iconOnly]="true"
                      [iconAlwaysVisible]="true"
                      pTooltip="Modifier"
                      [routerLink]="[t.id, 'edit']"
                      ariaLabel="Modifier le modèle">
                    </app-button>
                  }
                  @if (canDelete()) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      icon="pi-trash"
                      [iconOnly]="true"
                      [iconAlwaysVisible]="true"
                      pTooltip="Supprimer"
                      (click)="confirmDelete(t)"
                      ariaLabel="Supprimer le modèle">
                    </app-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="text-center p-6">
                <app-empty-state
                  illustration="empty-quotes.svg"
                  title="Aucun modèle de devis" i18n-title="Aucun modèle de devis"
                  description="Créez un modèle pour préremplir lignes, notes et conditions lors de la création d'un devis."
                  [showAction]="canCreate()"
                  actionLabel="Créer un modèle"
                  actionRoute="new">
                </app-empty-state>
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>

    @if (error()) {
      <p class="text-danger p-3" role="alert">{{ error() }}</p>
    }

  `,
  styles: [
    `
      .flex-1 {
        flex: 1;
        min-width: 200px;
      }
      .actions {
        display: flex;
        gap: var(--spacing-1);
      }
      .text-center {
        text-align: center;
      }
      .p-6 {
        padding: var(--spacing-6);
      }
      .text-danger {
        color: var(--color-error-600);
      }
    `,
  ],
})
export class QuoteTemplateListComponent implements OnInit, OnDestroy {
  private readonly crm = inject(CrmService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmationService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  private readonly search$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  readonly items = signal<QuoteTemplateDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly initialLoad = signal(true);

  /** Totaux de la zone, calculés sur les modèles filtrés (chargés côté client). */
  readonly summaryMetrics = computed<TotalMetric[]>(() => {
    const rows = this.items();
    return [
      { label: 'Modèles', value: rows.length, format: 'number', icon: 'pi-copy', tone: 'primary' },
      { label: 'Actifs', value: rows.filter(t => t.isActive).length, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: 'Utilisations', value: rows.reduce((acc, t) => acc + (t.usageCount ?? 0), 0), format: 'number', icon: 'pi-chart-line', tone: 'cyan' }
    ];
  });

  searchTerm = '';
  selectedActiveFilter: boolean | null = null;

  readonly activeFilterOptions: ActiveFilterOption[] = [
    { label: 'Actifs uniquement', value: true },
    { label: 'Inactifs uniquement', value: false },
  ];

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'CRM Commercial', route: '/crm/dashboard' },
    { label: 'Modèles de devis' },
  ];

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '18%' },
    { width: '22%' },
    { width: '10%' },
    { width: '8%' },
    { width: '10%' },
    { width: '12%' },
    { width: '120px' },
  ];

  canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.crm.create));
  canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.crm.update));
  canDelete = computed(() => this.auth.hasPermission(PERMISSIONS.crm.delete));

  ngOnInit(): void {
    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => this.load());
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(): void {
    this.search$.next(this.searchTerm.trim());
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm.trim() || this.selectedActiveFilter !== null;
  }

  activeFiltersCount(): number {
    let c = 0;
    if (this.searchTerm.trim()) c++;
    if (this.selectedActiveFilter !== null) c++;
    return c;
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedActiveFilter = null;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const opts: { activeOnly?: boolean; search?: string } = {};
    if (this.selectedActiveFilter !== null) opts.activeOnly = this.selectedActiveFilter;
    if (this.searchTerm.trim()) opts.search = this.searchTerm.trim();

    this.crm.getQuoteTemplates(opts).subscribe({
      next: (r) => {
        this.loading.set(false);
        this.initialLoad.set(false);
        if (r.success && r.data) this.items.set(r.data);
        else this.error.set(r.error ?? 'Erreur lors du chargement');
      },
      error: (err) => {
        this.loading.set(false);
        this.initialLoad.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err));
      },
    });
  }

  onToggleActive(t: QuoteTemplateDto, value: boolean): void {
    if (!this.canUpdate()) return;
    const prev = t.isActive;
    this.crm.setQuoteTemplateActive(t.id, value).subscribe({
      next: (res) => {
        if (res.success) {
          this.items.update((list) =>
            list.map((x) => (x.id === t.id ? { ...x, isActive: value } : x))
          );
          this.toast.add({
            severity: 'success',
            summary: 'Statut mis à jour',
            detail: value ? 'Modèle activé.' : 'Modèle désactivé.',
          });
        } else {
          this.items.update((list) =>
            list.map((x) => (x.id === t.id ? { ...x, isActive: prev } : x))
          );
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.error ?? 'Échec' });
        }
      },
      error: (err) => {
        this.items.update((list) =>
          list.map((x) => (x.id === t.id ? { ...x, isActive: prev } : x))
        );
        this.toast.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err),
        });
      },
    });
  }

  confirmDelete(t: QuoteTemplateDto): void {
    this.confirm.confirm({
      header: 'Supprimer le modèle',
      message: `Supprimer « ${t.name} » ? Cette action est irréversible.`,
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.crm.deleteQuoteTemplate(t.id).subscribe({
          next: (res) => {
            if (res.success) {
              this.items.update((list) => list.filter((x) => x.id !== t.id));
              this.toast.add({ severity: 'success', summary: 'Supprimé', detail: 'Modèle supprimé.' });
            } else {
              this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.error ?? 'Échec' });
            }
          },
          error: (err) =>
            this.toast.add({
              severity: 'error',
              summary: 'Erreur',
              detail: this.errorHandler.extractErrorMessage(err),
            }),
        });
      },
    });
  }
}
