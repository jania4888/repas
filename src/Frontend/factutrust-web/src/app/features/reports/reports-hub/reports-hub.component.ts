import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AppModule } from '@core/models/app-module';

interface ReportLink {
  label: string;
  route?: string;
  queryParams?: Record<string, string>;
  comingSoon?: boolean;
}

interface ReportCard {
  title: string;
  icon: string;
  links: ReportLink[];
  /** User must have every module enabled (AND), plus `reports:view` at hub level. */
  modules?: AppModule[];
}

@Component({
  selector: 'app-reports-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PageHeaderComponent],
  template: `
    <app-page-header
      title="Rapports" i18n-title="@@reports.reports-hub.rapports.db7d9fbb"
      subtitle="Accédez à tous les rapports et états de la plateforme" i18n-subtitle="@@reports.reports-hub.accedez.a.tous.les.rapports.et.etats.de.aa0bb5d1">
    </app-page-header>

    <div class="hub-search" *ngIf="showSearch">
      <div class="search-input-wrap">
        <i class="pi pi-search search-icon" aria-hidden="true"></i>
        <input
          type="search"
          [(ngModel)]="searchQuery"
          (ngModelChange)="onSearchChange()"
          class="search-input"
          placeholder="Rechercher un rapport..." i18n-placeholder="@@reports.reports-hub.rechercher.un.rapport.9cfd1f1d"
          aria-label="Rechercher un rapport" i18n-aria-label="@@reports.reports-hub.rechercher.un.rapport.9bea5179">
      </div>
    </div>

    <div class="cards-grid" role="list">
      @for (card of filteredCards; track card.title) {
        <section class="report-card" [attr.aria-label]="card.title" role="listitem">
          <h2 class="card-title">
            <i class="pi" [class]="card.icon" aria-hidden="true"></i>
            {{ card.title }}
          </h2>
          <ul class="report-links" role="list">
            @for (link of card.links; track link.label) {
              <li class="report-link-item">
                @if (link.comingSoon) {
                  <span class="report-link report-link--disabled">
                    {{ link.label }}
                    <span class="badge-coming" i18n="@@reports.reports-hub.bientot.a60303f4">Bientôt</span>
                  </span>
                } @else if (link.route) {
                  <a [routerLink]="link.route" [queryParams]="link.queryParams" class="report-link" [attr.aria-label]="loc_ui_tern_acceder_a_54eb6e + link.label">
                    {{ link.label }}
                  </a>
                } @else {
                  <span class="report-link">{{ link.label }}</span>
                }
              </li>
            }
          </ul>
        </section>
      }
    </div>

    @if (filteredCards.length === 0) {
      <div class="empty-state" role="status">
        <i class="pi pi-search empty-icon"></i>
        <p i18n="@@reports.reports-hub.aucun.rapport.ne.correspond.a.votre.recherche.9353e0e9">Aucun rapport ne correspond à votre recherche.</p>
      </div>
    }
  `,
  styles: [`
    .hub-search {
      margin-bottom: var(--spacing-6);
    }

    .search-input-wrap {
      position: relative;
      max-width: 400px;
    }

    .search-icon {
      position: absolute;
      left: var(--spacing-4);
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-text-secondary);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      padding: var(--spacing-3) var(--spacing-4) var(--spacing-3) 2.75rem;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-background);
      color: var(--color-text-primary);
      font-size: var(--font-size-base);
      transition: border-color var(--transition-fast);
    }

    .search-input:focus {
      outline: none;
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px rgba(var(--color-primary-500-rgb, 59, 130, 246), 0.1);
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: var(--spacing-6);
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .report-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      border: 1px solid var(--color-border-subtle);
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--transition-normal), border-color var(--transition-normal);
    }

    .report-card:hover {
      box-shadow: var(--shadow-md);
      border-color: var(--color-border-default);
    }

    .card-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-4);
      padding-bottom: var(--spacing-4);
      border-bottom: 2px solid var(--color-border-subtle);
    }

    .card-title .pi {
      font-size: 1.25rem;
      color: var(--color-primary-500);
    }

    .report-links {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .report-link-item {
      margin: 0;
      padding: 0;
    }

    .report-link-item + .report-link-item {
      margin-top: var(--spacing-2);
    }

    .report-link {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) 0;
      color: var(--color-primary-600);
      text-decoration: none;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      transition: color var(--transition-fast);
      cursor: pointer;
    }

    a.report-link:hover {
      color: var(--color-primary-700);
      text-decoration: underline;
    }

    .report-link--disabled {
      color: var(--color-text-secondary);
      cursor: default;
    }

    .badge-coming {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      padding: 2px 8px;
      border-radius: var(--radius-full);
      background: var(--color-warning-100);
      color: var(--color-warning-700);
    }

    .empty-state {
      text-align: center;
      padding: var(--spacing-12);
      color: var(--color-text-secondary);
    }

    .empty-icon {
      font-size: 3rem;
      margin-bottom: var(--spacing-4);
      opacity: 0.5;
    }
  `]
})
export class ReportsHubComponent {
  readonly loc_ui_tern_acceder_a_54eb6e = $localize`:@@ui.tern.acceder.a.54eb6e:Accéder à `;
  private readonly auth = inject(AuthService);

  showSearch = true;
  searchQuery = '';

  private readonly allCards: ReportCard[] = [
    {
      title: 'Rapport de vente',
      icon: 'pi-chart-line',
      modules: [AppModule.Reports, AppModule.Sales],
      links: [
        { label: 'Vente par client', route: '/reports/sales' },
        { label: 'Détails ventes par ligne produit', route: '/reports/sales' },
        { label: 'Transactions clients', route: '/reports/sales' },
        { label: 'TVA ventes', route: '/reports/sales' },
        { label: 'Total des retenues pour les clients', route: '/reports/sales', queryParams: { tab: 'retenues-clients' } }
      ]
    },
    {
      title: 'Rapport d\'achat',
      icon: 'pi-shopping-cart',
      modules: [AppModule.Reports, AppModule.Purchases],
      links: [
        { label: 'Achat par fournisseur', route: '/reports/purchases' },
        { label: 'Détails d\'achat par ligne produit', route: '/reports/purchases' },
        { label: 'Transactions fournisseurs', route: '/reports/purchases' },
        { label: 'TVA achats', route: '/reports/purchases' },
        { label: 'Total des retenues pour les fournisseurs', route: '/reports/purchases', queryParams: { tab: 'retenues-fournisseurs' } }
      ]
    },
    {
      title: 'Détails ventes par ligne produit',
      icon: 'pi-list',
      modules: [AppModule.Reports, AppModule.Sales],
      links: [
        { label: 'Chiffre d\'affaires par produit', route: '/reports/sales-by-line' },
        { label: 'Chiffre d\'affaires par Catégorie', route: '/reports/sales-by-line' },
        { label: 'Chiffre d\'affaires par produit par client', route: '/reports/sales-by-line' }
      ]
    },
    {
      title: 'Rapport Clients',
      icon: 'pi-users',
      modules: [AppModule.Reports, AppModule.Clients],
      links: [
        { label: 'Soldes client', route: '/reports/client-balances' },
        { label: 'Chiffre d\'affaires par client', route: '/reports/fiches' }
      ]
    },
    {
      title: 'Rapport Fournisseur',
      icon: 'pi-truck',
      modules: [AppModule.Reports, AppModule.Purchases],
      links: [
        { label: 'Soldes fournisseur', route: '/reports/supplier-balances' },
        { label: 'Chiffre d\'affaires par fournisseur', route: '/reports/purchases' }
      ]
    },
    {
      title: 'Rapport Stock',
      icon: 'pi-box',
      modules: [AppModule.Reports, AppModule.Stock],
      links: [
        { label: 'Mouvement détaillé de stock', route: '/reports/stock' },
        { label: 'Etat de stock à une date antérieure', route: '/reports/stock', queryParams: { section: 'snapshot' } }
      ]
    },
    {
      title: 'Rapport Paiement',
      icon: 'pi-wallet',
      modules: [AppModule.Reports, AppModule.Treasury],
      links: [
        { label: 'Paiement Clients', route: '/reports/payments' },
        { label: 'Paiements fournisseurs', route: '/reports/payments' },
        { label: 'Facture clients non payées depuis plus d\'un mois', route: '/reports/sales' }
      ]
    },
    {
      title: 'Rapport Bénéfices',
      icon: 'pi-percentage',
      modules: [AppModule.Reports, AppModule.Sales],
      links: [
        { label: 'Bénéfice commerciale par pièce', route: '/reports/profit' },
        { label: 'Bénéfice commerciale mensuel', route: '/reports/profit' },
        { label: 'Bénéfice commercial par ligne', route: '/reports/profit' },
        { label: 'Bénéfice commercial par produit', route: '/reports/profit' }
      ]
    },
    {
      title: 'Rapports décisionnels ventes produits',
      icon: 'pi-chart-bar',
      modules: [AppModule.Reports, AppModule.Sales],
      links: [
        { label: 'Performance produits, tendances, panier, produits jamais vendus, CA par catégorie', route: '/reports/product-sales-analytics' }
      ]
    }
  ];

  /** Cards visible for current user (modules + `reports:view`). */
  readonly visibleCards = computed(() => {
    this.auth.user();
    if (!this.auth.hasPermission(PERMISSIONS.reports.view)) {
      return [] as ReportCard[];
    }
    return this.allCards.filter(
      card => !card.modules?.length || card.modules.every(m => this.auth.hasModule(m))
    );
  });

  get filteredCards(): ReportCard[] {
    const q = this.searchQuery?.trim().toLowerCase();
    const base = this.visibleCards();
    if (!q) return base;
    return base
      .map(card => ({
        ...card,
        links: card.links.filter(l => l.label.toLowerCase().includes(q))
      }))
      .filter(card => card.links.length > 0);
  }

  onSearchChange(): void {
    // Filtering is reactive via getter
  }
}
