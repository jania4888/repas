import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-purchases-analytics-hub',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="purchases-analytics-hub">
      <nav class="analytics-nav" aria-label="Navigation des états analytiques achats" i18n-aria-label="@@reports.purchases-analytics.navigation.des.etats.analytiques.achats.a83eec15">
        <div class="nav-tabs">
          @for (tab of tabs; track tab.id) {
            <a
              class="nav-tab"
              [routerLink]="tab.route"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: tab.exact }">
              <i class="pi" [class]="tab.icon"></i>
              <span class="tab-label">{{ tab.label }}</span>
              <span class="tab-desc">{{ tab.description }}</span>
            </a>
          }
        </div>
      </nav>
      <div class="analytics-content">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .purchases-analytics-hub {
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .analytics-nav {
      margin-bottom: var(--spacing-6);
    }

    .nav-tabs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--spacing-3);
    }

    .nav-tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: var(--spacing-5) var(--spacing-4);
      border-radius: var(--radius-xl);
      background: var(--color-background-elevated);
      border: 2px solid var(--color-border-subtle);
      text-decoration: none;
      color: var(--color-text-secondary);
      transition: all 0.3s ease;
      cursor: pointer;
      box-shadow: var(--shadow-sm);
      position: relative;
      overflow: hidden;
    }

    .nav-tab::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      transform: scaleX(0);
      transition: transform 0.3s ease;
    }

    .nav-tab:hover {
      border-color: #93c5fd;
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
      color: var(--color-text-primary);
    }

    .nav-tab:hover::before {
      transform: scaleX(1);
    }

    .nav-tab.active {
      border-color: #3b82f6;
      background: linear-gradient(135deg, var(--color-background-elevated), rgba(59, 130, 246, 0.08));
      color: #1d4ed8;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
    }

    .nav-tab.active::before {
      transform: scaleX(1);
    }

    .nav-tab .pi {
      font-size: 1.5rem;
      margin-bottom: var(--spacing-2);
      transition: transform 0.3s ease;
    }

    .nav-tab:hover .pi,
    .nav-tab.active .pi {
      transform: scale(1.15);
    }

    .nav-tab.active .pi {
      color: #2563eb;
    }

    .tab-label {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      margin-bottom: var(--spacing-1);
    }

    .tab-desc {
      font-size: var(--font-size-xs);
      opacity: 0.8;
      line-height: 1.4;
    }

    .analytics-content {
      animation: slideUp 0.3s ease-out;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 768px) {
      .nav-tabs {
        grid-template-columns: 1fr;
        gap: var(--spacing-2);
      }
      .nav-tab {
        flex-direction: row;
        text-align: left;
        padding: var(--spacing-4);
        gap: var(--spacing-3);
      }
      .nav-tab .pi {
        font-size: 1.25rem;
        margin-bottom: 0;
      }
      .tab-desc {
        display: none;
      }
    }

    @media print {
      .analytics-nav {
        display: none !important;
      }
    }
  `]
})
export class PurchasesAnalyticsHubComponent {
  tabs = [
    {
      id: 'expenses',
      label: $localize`:@@reports.purchases-analytics-hub.ts.depenses.fb667434:Dépenses`,
      description: $localize`:@@reports.purchases-analytics-hub.ts.evolution.des.depenses.et.comparaison.pa.5ffbe878:Évolution des dépenses et comparaison par période`,
      icon: 'pi-dollar',
      route: '/reports/purchases-analytics/expenses',
      exact: false
    },
    {
      id: 'suppliers',
      label: $localize`:@@reports.purchases-analytics-hub.ts.analyse.fournisseurs.496355ab:Analyse fournisseurs`,
      description: $localize`:@@reports.purchases-analytics-hub.ts.classement.part.des.achats.et.indicateur.3cbbbd58:Classement, part des achats et indicateurs par fournisseur`,
      icon: 'pi-building',
      route: '/reports/purchases-analytics/suppliers',
      exact: false
    },
    {
      id: 'orders',
      label: $localize`:@@reports.purchases-analytics-hub.ts.analyse.des.commandes.575afd26:Analyse des commandes`,
      description: $localize`:@@reports.purchases-analytics-hub.ts.taux.de.conversion.bons.de.commande.fact.d22aedce:Taux de conversion bons de commande → facture, délais et panier moyen`,
      icon: 'pi-shopping-cart',
      route: '/reports/purchases-analytics/orders',
      exact: false
    }
  ];
}
