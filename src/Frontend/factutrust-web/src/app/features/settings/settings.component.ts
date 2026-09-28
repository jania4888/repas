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
    { label: $localize`:@@settings.settings.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.settings.ts.parametres.ef8f0121:Paramètres` }
  ]);

  settingsItems = computed<SettingItem[]>(() => {
    this.stockFeaturesStore.features();
    const items: SettingItem[] = [
      {
        title: $localize`:@@settings.settings.ts.mon.profil.faa6d321:Mon profil`,
        description: $localize`:@@settings.settings.ts.gerez.vos.informations.personnelles.et.s.310a808a:Gérez vos informations personnelles et sécurité`,
        icon: 'pi pi-user',
        route: 'profile',
        color: 'var(--color-primary-500)'
      },
      {
        title: $localize`:@@settings.settings.ts.mon.entreprise.e950c285:Mon entreprise`,
        description: $localize`:@@settings.settings.ts.informations.legales.et.parametres.de.fa.e681adc6:Informations légales et paramètres de facturation`,
        icon: 'pi pi-building',
        route: 'company',
        color: 'var(--color-success-500)'
      }
    ];

    if (environment.channelsEnabled) {
      items.push({
        title: 'WhatsApp',
        description: $localize`:@@settings.settings.ts.liez.votre.whatsapp.a.l.assistant.ia.et.c0db259d:Liez votre WhatsApp à l’assistant IA et recevez vos rappels fiscaux`,
        icon: 'pi pi-whatsapp',
        route: 'channels',
        color: 'var(--color-success-600)'
      });
    }

    if (this.auth.isAdmin()) {
      items.push({
        title: $localize`:@@settings.settings.ts.utilisateurs.et.roles.57ee1f2a:Utilisateurs et rôles`,
        description: $localize`:@@settings.settings.ts.invitez.votre.equipe.et.definissez.les.m.e7ea7cec:Invitez votre équipe et définissez les modules accessibles`,
        icon: 'pi pi-users',
        route: 'users',
        color: 'var(--color-primary-600)'
      });
      if (environment.accountingFirmsEnabled) {
        items.push({
          title: $localize`:@@settings.settings.ts.cabinet.comptable.0b9c6d02:Cabinet comptable`,
          description: $localize`:@@settings.settings.ts.confiez.la.gestion.comptable.a.un.cabine.ca773c22:Confiez la gestion comptable à un cabinet partenaire`,
          icon: 'pi pi-briefcase',
          route: 'accounting-firm',
          color: 'var(--color-info-600)'
        });
      }
    }

    if (this.auth.hasPermission(PERMISSIONS.storefront.manage)) {
      items.push({
        title: $localize`:@@settings.settings.ts.vitrine.publique.rue.3d.2f3995b8:Vitrine publique & rue 3D`,
        description: $localize`:@@settings.settings.ts.opt.in.vitrine.moderee.produits.publics.a692d61d:Opt-in vitrine modérée, produits publics et présence sur la Rue InstaFact`,
        icon: 'pi pi-shop',
        route: 'storefront',
        color: 'var(--color-primary-500)'
      });
    }

    if (this.auth.hasPermission(PERMISSIONS.pricing.read)) {
      items.push({
        title: $localize`:@@settings.settings.ts.promotions.086e09b4:Promotions`,
        description: $localize`:@@settings.settings.ts.remises.temporaires.appliquees.apres.le.38e57241:Remises temporaires appliquées après le prix sur vos documents de vente`,
        icon: 'pi pi-megaphone',
        route: 'promotions',
        color: 'var(--color-primary-500)'
      });
    }

    if (this.auth.hasPermission(PERMISSIONS.products.read) && this.stockFeaturesStore.productVariantsEnabled()) {
      items.push({
        title: $localize`:@@settings.settings.ts.axes.de.variantes.dcc95d91:Axes de variantes`,
        description: $localize`:@@settings.settings.ts.definissez.les.axes.taille.couleur.etc.e.3abcd724:Définissez les axes (taille, couleur, etc.) et leurs valeurs pour générer les SKU.`,
        icon: 'pi pi-th-large',
        route: 'variant-axes',
        color: 'var(--color-primary-500)'
      });
    }

    if (this.canReadTenantSettings()) {
      items.push(
        {
          title: $localize`:@@settings.settings.ts.modules.04e9462c:Modules`,
          description: $localize`:@@settings.settings.ts.activez.ou.desactivez.les.fonctionnalite.2a299e22:Activez ou désactivez les fonctionnalités de votre espace`,
          icon: 'pi pi-th-large',
          route: 'modules',
          color: 'var(--color-primary-500)'
        },
        {
          title: $localize`:@@settings.settings.ts.mon.abonnement.d248414d:Mon abonnement`,
          description: $localize`:@@settings.settings.ts.gerez.votre.forfait.et.vos.options.2dbbb145:Gérez votre forfait et vos options`,
          icon: 'pi pi-credit-card',
          route: 'subscription',
          color: 'var(--color-warning-500)'
        },
        {
          title: $localize`:@@settings.settings.ts.taxes.et.tva.08d48b76:Taxes et TVA`,
          description: $localize`:@@settings.settings.ts.configurez.vos.taxes.timbres.fiscaux.et.64aabcd1:Configurez vos taxes, timbres fiscaux et taux de TVA`,
          icon: 'pi pi-percentage',
          route: 'taxes',
          color: 'var(--color-info-500)'
        },
        {
          title: $localize`:@@settings.settings.ts.entrepots.c0906d10:Entrepôts`,
          description: $localize`:@@settings.settings.ts.ajoutez.et.gerez.vos.lieux.de.stockage.e.5c25172f:Ajoutez et gérez vos lieux de stockage et dépôts`,
          icon: 'pi pi-box',
          route: 'warehouses',
          color: 'var(--color-neutral-600)'
        },
        {
          title: $localize`:@@settings.settings.ts.numerotations.f8fd8b5e:Numérotations`,
          description: $localize`:@@settings.settings.ts.configurez.le.format.de.numerotation.et.b1f9976f:Configurez le format de numérotation et le numéro de départ pour chaque type de document`,
          icon: 'pi pi-sort-numeric-down',
          route: 'numbering',
          color: 'var(--color-primary-500)'
        },
        {
          title: $localize`:@@settings.settings.ts.modeles.de.documents.4875ffe8:Modèles de documents`,
          description: $localize`:@@settings.settings.ts.choisissez.le.modele.visuel.d.impression.5001fd53:Choisissez le modèle visuel d’impression de chaque type de document (factures, avoirs, devis, BL…)`,
          icon: 'pi pi-palette',
          route: 'templates',
          color: 'var(--color-info-500)'
        },
        {
          title: $localize`:@@settings.settings.ts.conditions.de.reglement.84c9c451:Conditions de règlement`,
          description: $localize`:@@settings.settings.ts.delai.echeance.et.escompte.texte.imprime.261afda4:Délai, échéance et escompte. Texte imprimé sur les documents et calcul de la balance âgée.`,
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
