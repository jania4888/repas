import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardModule } from 'primeng/card';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { environment } from '@environments/environment';
import { StockFeaturesStore } from '@core/services/stock-features-store.service';

interface SettingItem {
  title: string;
  description: string;
  icon: string;
  route: string;
  color: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    
    <app-page-header 
      title="Paramètres" i18n-title="@@settings.settings.parametres.ef8f0121" 
      subtitle="Configurez votre compte et votre entreprise" i18n-subtitle="@@settings.settings.configurez.votre.compte.et.votre.entrepr.e7a5b642">
    </app-page-header>

    <div class="settings-grid">
      @for (item of settingsItems(); track item.route) {
        <a [routerLink]="item.route" class="settings-card">
          <div class="card-icon" [style.background]="item.color">
            <i [class]="item.icon"></i>
          </div>
          <div class="card-content">
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
          </div>
          <i class="pi pi-chevron-right card-arrow"></i>
        </a>
      }
    </div>
  `,
  styles: [`
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: var(--spacing-4);
    }

    .settings-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      padding: var(--spacing-5);
      background: white;
      border-radius: var(--radius-xl);
      border: 1px solid var(--color-neutral-200);
      text-decoration: none;
      transition: all var(--transition-fast);

      &:hover {
        border-color: var(--color-primary-300);
        box-shadow: var(--shadow-md);
        transform: translateY(-2px);
      }
    }

    .card-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: var(--radius-xl);
      flex-shrink: 0;

      i {
        font-size: 1.5rem;
        color: white;
      }
    }

    .card-content {
      flex: 1;

      h3 {
        margin: 0 0 var(--spacing-1);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-900);
      }

      p {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--color-neutral-500);
      }
    }

    .card-arrow {
      color: var(--color-neutral-400);
      font-size: var(--font-size-lg);
    }
  `]
})
export class SettingsComponent {
  private readonly auth = inject(AuthService);
  private readonly stockFeaturesStore = inject(StockFeaturesStore);

  constructor() {
    this.stockFeaturesStore.ensureLoaded();
  }

  breadcrumbItems = computed<BreadcrumbItem[]>(() => [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres' }
  ]);

  settingsItems = computed<SettingItem[]>(() => {
    this.stockFeaturesStore.features();
    const items: SettingItem[] = [
      {
        title: 'Mon profil',
        description: 'Gérez vos informations personnelles et sécurité',
        icon: 'pi pi-user',
        route: 'profile',
        color: 'var(--color-primary-500)'
      },
      {
        title: 'Mon entreprise',
        description: 'Informations légales et paramètres de facturation',
        icon: 'pi pi-building',
        route: 'company',
        color: 'var(--color-success-500)'
      }
    ];

    if (environment.channelsEnabled) {
      items.push({
        title: 'WhatsApp',
        description: 'Liez votre WhatsApp à l’assistant IA et recevez vos rappels fiscaux',
        icon: 'pi pi-whatsapp',
        route: 'channels',
        color: 'var(--color-success-600)'
      });
    }

    if (this.auth.isAdmin()) {
      items.push({
        title: 'Utilisateurs et rôles',
        description: 'Invitez votre équipe et définissez les modules accessibles',
        icon: 'pi pi-users',
        route: 'users',
        color: 'var(--color-primary-600)'
      });
      if (environment.accountingFirmsEnabled) {
        items.push({
          title: 'Cabinet comptable',
          description: 'Confiez la gestion comptable à un cabinet partenaire',
          icon: 'pi pi-briefcase',
          route: 'accounting-firm',
          color: 'var(--color-info-600)'
        });
      }
    }

    if (this.auth.hasPermission(PERMISSIONS.storefront.manage)) {
      items.push({
        title: 'Vitrine publique & rue 3D',
        description: 'Opt-in vitrine modérée, produits publics et présence sur la Rue InstaFact',
        icon: 'pi pi-shop',
        route: 'storefront',
        color: 'var(--color-primary-500)'
      });
    }

    if (this.auth.hasPermission(PERMISSIONS.pricing.read)) {
      items.push({
        title: 'Promotions',
        description: 'Remises temporaires appliquées après le prix sur vos documents de vente',
        icon: 'pi pi-megaphone',
        route: 'promotions',
        color: 'var(--color-primary-500)'
      });
    }

    if (this.auth.hasPermission(PERMISSIONS.products.read) && this.stockFeaturesStore.productVariantsEnabled()) {
      items.push({
        title: 'Axes de variantes',
        description: 'Définissez les axes (taille, couleur, etc.) et leurs valeurs pour générer les SKU.',
        icon: 'pi pi-th-large',
        route: 'variant-axes',
        color: 'var(--color-primary-500)'
      });
    }

    if (this.canReadTenantSettings()) {
      items.push(
        {
          title: 'Modules',
          description: 'Activez ou désactivez les fonctionnalités de votre espace',
          icon: 'pi pi-th-large',
          route: 'modules',
          color: 'var(--color-primary-500)'
        },
        {
          title: 'Mon abonnement',
          description: 'Gérez votre forfait et vos options',
          icon: 'pi pi-credit-card',
          route: 'subscription',
          color: 'var(--color-warning-500)'
        },
        {
          title: 'Taxes et TVA',
          description: 'Configurez vos taxes, timbres fiscaux et taux de TVA',
          icon: 'pi pi-percentage',
          route: 'taxes',
          color: 'var(--color-info-500)'
        },
        {
          title: 'Entrepôts',
          description: 'Ajoutez et gérez vos lieux de stockage et dépôts',
          icon: 'pi pi-box',
          route: 'warehouses',
          color: 'var(--color-neutral-600)'
        },
        {
          title: 'Numérotations',
          description: 'Configurez le format de numérotation et le numéro de départ pour chaque type de document',
          icon: 'pi pi-sort-numeric-down',
          route: 'numbering',
          color: 'var(--color-primary-500)'
        },
        {
          title: 'Modèles de documents',
          description: 'Choisissez le modèle visuel d’impression de chaque type de document (factures, avoirs, devis, BL…)',
          icon: 'pi pi-palette',
          route: 'templates',
          color: 'var(--color-info-500)'
        },
        {
          title: 'Conditions de règlement',
          description: 'Délai, échéance et escompte. Texte imprimé sur les documents et calcul de la balance âgée.',
          icon: 'pi pi-calendar',
          route: 'payment-terms',
          color: 'var(--color-success-500)'
        },
      );
    }

    return items;
  });

  /**
   * Legacy sessions without `effectivePermissions` keep full access.
   * When scoped, `settings:read` is required for tenant-level settings cards.
   */
  private canReadTenantSettings(): boolean {
    const raw = this.auth.user()?.effectivePermissions;
    if (raw === undefined || raw === null) {
      return true;
    }
    return this.auth.hasPermission(PERMISSIONS.settings.read);
  }
}
