/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ProductService, ProductAttributeDto } from '@core/services/product.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ConfirmationService } from '@core/services/confirmation.service';

@Component({
  selector: 'app-product-attribute-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    InputTextModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Axes de variantes" i18n-title="@@settings.variant-axes.axes.de.variantes.dcc95d91"
      subtitle="Définissez les axes (taille, couleur, etc.) et leurs valeurs pour générer les SKU." i18n-subtitle="@@settings.variant-axes.definissez.les.axes.taille.couleur.etc.e.296792cc">
      <app-button variant="outline" icon="pi-arrow-left" iconPos="left" routerLink="/settings" i18n="@@settings.variant-axes.retour.e5befb1f"> Retour </app-button>
      @if (canCreate()) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" routerLink="new" i18n="@@settings.variant-axes.nouvel.axe.09ff15dd"> Nouvel axe </app-button>
      }
    </app-page-header>

    <div class="ft-filters">
      <span class="p-input-icon-left flex-1">
        <i class="pi pi-search"></i>
        <input
          pInputText
          type="text"
          placeholder="Rechercher par code ou nom..." i18n-placeholder="@@settings.variant-axes.rechercher.par.code.ou.nom.5764fbc6"
          [(ngModel)]="searchTerm"
          class="w-full" />
      </span>
    </div>

    <div class="ft-table-card">
      @if (loading() && attributes().length === 0) {
        <app-skeleton-table [rows]="5" [columns]="[{ width: '20%' }, { width: '30%' }, { width: '30%' }, { width: '20%' }]">
        </app-skeleton-table>
      } @else if (filteredAttributes().length === 0) {
        <app-empty-state
          icon="pi-th-large"
          title="Aucun axe de variantes" i18n-title="@@settings.variant-axes.aucun.axe.de.variantes.4eaf2472"
          description="Créez des axes (taille, couleur, etc.) pour générer des variantes de produits." i18n-description="@@settings.variant-axes.creez.des.axes.taille.couleur.etc.pour.g.6a52ece6" />
      } @else {
        <p-table [value]="filteredAttributes()" [rowHover]="true" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@settings.variant-axes.code.adac6937">Code</th>
              <th i18n="@@settings.variant-axes.nom.7ff20370">Nom</th>
              <th i18n="@@settings.variant-axes.valeurs.1f2cbf36">Valeurs</th>
              <th class="actions-col" i18n="@@settings.variant-axes.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-attr>
            <tr>
              <td><code>{{ attr.code }}</code></td>
              <td>{{ attr.name }}</td>
              <td i18n="@@settings.variant-axes.valeur.s.7b227d5c">{{ attr.values.length }} valeur(s)</td>
              <td class="actions-col">
                @if (canUpdate()) {
                  <app-button variant="ghost" size="sm" icon="pi-pencil" [routerLink]="[attr.id, 'edit']" i18n="@@settings.variant-axes.modifier.f260e757"> Modifier </app-button>
                }
                @if (canDelete()) {
                  <app-button variant="ghost" size="sm" icon="pi-trash" (clicked)="confirmDelete(attr)" i18n="@@settings.variant-axes.supprimer.1acfc1c7"> Supprimer </app-button>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
  `,
  styles: [`
    .ft-filters { margin-bottom: 1rem; }
    .actions-col { width: 200px; text-align: right; }
    .ft-table-card {
      background: var(--surface-card, #fff);
      border-radius: 8px;
      padding: 1rem;
    }
  `]
})
export class ProductAttributeListComponent implements OnInit {
  private productService = inject(ProductService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private auth = inject(AuthService);
  private confirmationService = inject(ConfirmationService);

  loading = signal(false);
  attributes = signal<ProductAttributeDto[]>([]);
  searchTerm = '';

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@settings.product-attribute-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.product-attribute-list.ts.parametres.ef8f0121:Paramètres`, route: '/settings' },
    { label: $localize`:@@settings.product-attribute-list.ts.axes.de.variantes.dcc95d91:Axes de variantes` }
  ];

  filteredAttributes = computed(() => {
    const term = this.searchTerm.trim().toLowerCase();
    const items = this.attributes();
    if (!term) return items;
    return items.filter(
      a => a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term)
    );
  });

  canCreate = () => this.auth.hasPermission(PERMISSIONS.products.create);
  canUpdate = () => this.auth.hasPermission(PERMISSIONS.products.update);
  canDelete = () => this.auth.hasPermission(PERMISSIONS.products.delete);

  ngOnInit(): void {
    this.loadAttributes();
  }

  private loadAttributes(): void {
    this.loading.set(true);
    this.productService.listAttributes().subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.attributes.set(res.data);
      },
      error: err => {
        this.loading.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-attribute-list.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  confirmDelete(attr: ProductAttributeDto): void {
    this.confirmationService.confirm({
      header: $localize`:@@settings.product-attribute-list.ts.supprimer.l.axe.0c38a872:Supprimer l'axe`,
      message: $localize`:@@settings.product-attribute-list.ts.supprimer.l.axe.name.cette.action.est.ir.69a23600:Supprimer l'axe « ${attr.name}:name: » ? Cette action est irréversible.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@product-attribute-list.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@product-attribute-list.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.productService.deleteAttribute(attr.id).subscribe({
          next: res => {
            if (res.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@product-attribute-list.component.summary.Supprimé:Supprimé`,
                detail: $localize`:@@product-attribute-list.component.detail.Axe_de_variantes:Axe de variantes supprimé`
              });
              this.loadAttributes();
            }
          },
          error: err => {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-attribute-list.component.summary.Erreur:Erreur`,
              detail: this.errorHandler.extractErrorMessage(err)
            });
          }
        });
      }
    });
  }
}
