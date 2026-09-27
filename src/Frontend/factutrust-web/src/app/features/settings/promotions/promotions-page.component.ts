/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PricingService, Promotion } from '@core/services/pricing.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { PromotionPeriodBarComponent } from './promotion-period-bar.component';
import {
  PromotionFormDialogComponent,
  PromotionFormValue,
  toCreateRequest,
  toUpdateRequest
} from './promotion-form-dialog.component';
import {
  PromotionScopeFilter,
  PromotionStatusFilter,
  discountLabel,
  filterPromotions,
  lifecycleLabel,
  lifecycleSeverity,
  promotionLifecycle
} from './promotions.utils';

interface FilterOption<T extends string> {
  label: string;
  value: T;
}

@Component({
  selector: 'app-promotions-page',
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
    SelectModule,
    IconFieldModule,
    InputIconModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    PromotionPeriodBarComponent,
    PromotionFormDialogComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Promotions" i18n-title="@@settings.promotions.promotions.086e09b4"
      subtitle="Remises temporaires appliquées après le prix. Elles ne remplacent pas les grilles : un document émis garde sa remise quand la promotion se termine.">
      <div class="header-actions">
        <p-button label="Retour" i18n-label="@@settings.promotions.retour.e5befb1f" icon="pi pi-arrow-left" [outlined]="true" routerLink="/settings"></p-button>
        @if (canCreate()) {
          <app-button variant="primary" icon="pi-plus" iconPos="left" (clicked)="openCreate()" i18n="@@settings.promotions.nouvelle.promotion.32d11180"> Nouvelle promotion </app-button>
        }
      </div>
    </app-page-header>

    @if (!loading() && promotions().length > 0) {
      <div class="ft-page-section ft-filters">
        <p-iconfield iconPosition="left" class="ft-filters__search">
          <p-inputicon styleClass="pi pi-search" />
          <input
            pInputText
            type="search"
            placeholder="Rechercher par nom ou portée…" i18n-placeholder="@@settings.promotions.rechercher.par.nom.ou.portee.1e787156"
            [(ngModel)]="searchQueryModel"
            (ngModelChange)="searchQuery.set($event)"
            aria-label="Rechercher une promotion" i18n-aria-label="@@settings.promotions.rechercher.une.promotion.4dc198a1" />
        </p-iconfield>
        <p-select
          [options]="statusOptions"
          [(ngModel)]="statusFilterModel"
          (ngModelChange)="statusFilter.set($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="État" i18n-placeholder="@@settings.promotions.etat.d3b28a2a"
          appendTo="body"></p-select>
        <p-select
          [options]="scopeOptions"
          [(ngModel)]="scopeFilterModel"
          (ngModelChange)="scopeFilter.set($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="Portée" i18n-placeholder="@@settings.promotions.portee.f42a1d5d"
          appendTo="body"></p-select>
        @if (hasActiveFilters()) {
          <button type="button" class="ft-filters__reset" (click)="resetFilters()">
            <i class="pi pi-times" aria-hidden="true"></i>
            Réinitialiser
          </button>
        }
      </div>
    }

    @if (loading()) {
      <app-skeleton-table [columns]="skeletonColumns" [rows]="5"></app-skeleton-table>
    } @else if (promotions().length === 0) {
      <app-empty-state
        icon="pi-megaphone"
        title="Aucune promotion" i18n-title="@@settings.promotions.aucune.promotion.99506024"
        message="Créez une promotion datée pour appliquer une remise temporaire.">
      </app-empty-state>
    } @else if (filteredPromotions().length === 0) {
      <app-empty-state
        icon="pi-filter-slash"
        title="Aucun résultat" i18n-title="@@settings.promotions.aucun.resultat.9e524fe1"
        message="Aucune promotion ne correspond à vos filtres.">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table
          [value]="filteredPromotions()"
          [rowHover]="true"
          styleClass="ft-table"
          [sortField]="'startsOn'"
          [sortOrder]="-1">
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="name"><ng-container i18n="@@settings.promotions.nom.7ff20370">Nom </ng-container> <p-sortIcon field="name"></p-sortIcon></th>
              <th i18n="@@settings.promotions.portee.f42a1d5d">Portée</th>
              <th pSortableColumn="startsOn"><ng-container i18n="@@settings.promotions.periode.de2110b7">Période </ng-container> <p-sortIcon field="startsOn"></p-sortIcon></th>
              <th class="ft-num" i18n="@@settings.promotions.remise.ce12d942">Remise</th>
              <th class="ft-num" pSortableColumn="minQuantity">
                <ng-container i18n="@@settings.promotions.qte.min.ebdef318"> Qté min. </ng-container> <p-sortIcon field="minQuantity"></p-sortIcon>
              </th>
              <th class="ft-num" pSortableColumn="priority">
                <ng-container i18n="@@settings.promotions.priorite.eede91d2"> Priorité </ng-container> <p-sortIcon field="priority"></p-sortIcon>
              </th>
              <th i18n="@@settings.promotions.etat.d3b28a2a">État</th>
              <th class="ft-actions-col" i18n="@@settings.promotions.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-promo>
            <tr>
              <td>
                <strong>{{ promo.name }}</strong>
              </td>
              <td class="ft-muted">{{ promo.scopeLabel }}</td>
              <td>
                <app-promotion-period-bar [promo]="promo"></app-promotion-period-bar>
              </td>
              <td class="ft-num">
                <p-tag severity="info" [value]="discountLabel(promo)"></p-tag>
              </td>
              <td class="ft-num">{{ promo.minQuantity | number: '1.0-4' }}</td>
              <td class="ft-num">{{ promo.priority }}</td>
              <td>
                <p-tag
                  [severity]="lifecycleSeverity(lifecycleOf(promo))"
                  [value]="lifecycleLabel(lifecycleOf(promo))"
                  [pTooltip]="lifecycleTooltip(promo)"></p-tag>
              </td>
              <td class="ft-actions-col">
                @if (canUpdate()) {
                  <button
                    pButton
                    type="button"
                    icon="pi pi-pencil"
                    class="p-button-text p-button-sm"
                    pTooltip="Modifier" i18n-pTooltip="@@settings.promotions.modifier.f260e757"
                    (click)="openEdit(promo)"></button>
                }
                @if (canDelete()) {
                  <button
                    pButton
                    type="button"
                    icon="pi pi-trash"
                    class="p-button-text p-button-sm p-button-danger"
                    pTooltip="Supprimer" i18n-pTooltip="@@settings.promotions.supprimer.1acfc1c7"
                    (click)="confirmDelete(promo)"></button>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <app-promotion-form-dialog
      [(visible)]="dialogVisible"
      [editing]="editing"
      [saving]="saving()"
      (save)="onSave($event)"></app-promotion-form-dialog>
  `,
  styles: [
    `
      .header-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-3);
      }

      .ft-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-3);
        margin-bottom: var(--spacing-4);
      }

      .ft-filters__search {
        flex: 1 1 14rem;
        min-width: 12rem;
      }
    `
  ]
})
export class PromotionsPageComponent implements OnInit {
  private readonly pricingService = inject(PricingService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly auth = inject(AuthService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly promotions = signal<Promotion[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly searchQuery = signal('');
  readonly statusFilter = signal<PromotionStatusFilter>('all');
  readonly scopeFilter = signal<PromotionScopeFilter>('all');

  searchQueryModel = '';
  statusFilterModel: PromotionStatusFilter = 'all';
  scopeFilterModel: PromotionScopeFilter = 'all';

  dialogVisible = false;
  editing: Promotion | null = null;

  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.pricing.create));
  readonly canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.pricing.update));
  readonly canDelete = computed(() => this.auth.hasPermission(PERMISSIONS.pricing.delete));

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Paramètres', route: '/settings' },
    { label: 'Promotions' }
  ];

  readonly statusOptions: FilterOption<PromotionStatusFilter>[] = [
    { label: 'Tous les états', value: 'all' },
    { label: 'En cours', value: 'running' },
    { label: 'À venir', value: 'upcoming' },
    { label: 'Expirées', value: 'expired' },
    { label: 'Désactivées', value: 'disabled' },
    { label: 'Hors période', value: 'outOfWindow' }
  ];

  readonly scopeOptions: FilterOption<PromotionScopeFilter>[] = [
    { label: 'Toutes les portées', value: 'all' },
    { label: 'Produit ciblé', value: 'product' },
    { label: 'Catégorie ciblée', value: 'category' },
    { label: 'Client ciblé', value: 'client' },
    { label: 'Globale', value: 'global' }
  ];

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '16%' },
    { width: '14%' },
    { width: '22%' },
    { width: '10%' },
    { width: '8%' },
    { width: '8%' },
    { width: '10%' },
    { width: '8%' }
  ];

  readonly filteredPromotions = computed(() =>
    filterPromotions(this.promotions(), {
      search: this.searchQuery(),
      status: this.statusFilter(),
      scope: this.scopeFilter()
    })
  );

  readonly discountLabel = discountLabel;
  readonly lifecycleLabel = lifecycleLabel;
  readonly lifecycleSeverity = lifecycleSeverity;

  ngOnInit(): void {
    this.load();
  }

  lifecycleOf(promo: Promotion) {
    return promotionLifecycle(promo);
  }

  lifecycleTooltip(promo: Promotion): string {
    const lifecycle = promotionLifecycle(promo);
    if (lifecycle === 'outOfWindow') {
      return 'Promotion active mais en dehors de sa fenêtre : elle n\'applique aucune remise aujourd\'hui.';
    }
    return '';
  }

  hasActiveFilters(): boolean {
    return !!this.searchQuery().trim() || this.statusFilter() !== 'all' || this.scopeFilter() !== 'all';
  }

  resetFilters(): void {
    this.searchQueryModel = '';
    this.statusFilterModel = 'all';
    this.scopeFilterModel = 'all';
    this.searchQuery.set('');
    this.statusFilter.set('all');
    this.scopeFilter.set('all');
  }

  load(): void {
    this.loading.set(true);
    this.pricingService.getPromotions().subscribe({
      next: res => {
        this.promotions.set(res.data ?? []);
        this.loading.set(false);
      },
      error: err => {
        this.showError(err, 'Impossible de charger les promotions');
        this.errorHandler.logError('Failed to load promotions', err);
        this.promotions.set([]);
        this.loading.set(false);
      }
    });
  }

  openCreate(): void {
    this.editing = null;
    this.dialogVisible = true;
  }

  openEdit(promo: Promotion): void {
    this.editing = promo;
    this.dialogVisible = true;
  }

  onSave(value: PromotionFormValue): void {
    this.saving.set(true);

    const done = {
      next: () => {
        this.toastService.add({
          severity: 'success',
          summary: $localize`:@@promotions-page.component.summary.Succès:Succès`,
          detail: this.editing ? $localize`:@@ui.tern.promotion.mise.a.jour.3ccdcf:Promotion mise à jour.` : $localize`:@@ui.tern.promotion.creee.f84ced:Promotion créée.`
        });
        this.dialogVisible = false;
        this.saving.set(false);
        this.load();
      },
      error: (err: unknown) => {
        this.showError(err, 'Enregistrement impossible');
        this.errorHandler.logError('Save promotion failed', err);
        this.saving.set(false);
      }
    };

    if (this.editing) {
      this.pricingService.updatePromotion(this.editing.id, toUpdateRequest(value)).subscribe(done);
    } else {
      this.pricingService.createPromotion(toCreateRequest(value)).subscribe(done);
    }
  }

  confirmDelete(promo: Promotion): void {
    this.confirmationService.confirm({
      header: 'Supprimer la promotion',
      message: `Supprimer « ${promo.name} » ? Les documents déjà émis gardent leur remise.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@promotions-page.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@promotions-page.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.remove(promo)
    });
  }

  private remove(promo: Promotion): void {
    this.pricingService.deletePromotion(promo.id).subscribe({
      next: () => {
        this.toastService.add({ severity: 'success', summary: $localize`:@@promotions-page.component.summary.Succès:Succès`, detail: $localize`:@@promotions-page.component.detail.Promotion_suppri:Promotion supprimée.` });
        this.load();
      },
      error: err => {
        this.showError(err, 'Suppression impossible');
        this.errorHandler.logError('Delete promotion failed', err);
      }
    });
  }

  private showError(err: unknown, fallback: string): void {
    const msg = this.errorHandler.extractErrorMessage(err);
    this.toastService.add({ severity: 'error', summary: $localize`:@@promotions-page.component.summary.Erreur:Erreur`, detail: msg || fallback });
  }
}
