import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
    selector: 'app-analytics-hub',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
    <div class="analytics-hub">
      <!-- Navigation Tabs -->
      <nav class="analytics-nav" aria-label="Navigation des états analytiques" i18n-aria-label="@@reports.analytics.navigation.des.etats.analytiques.b0a208df">
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

      <!-- Router Outlet for child views -->
      <div class="analytics-content">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
    styles: [`
    .analytics-hub {
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ── Navigation Tabs ────────────────────────────────────── */
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
      background: linear-gradient(90deg, var(--color-primary-500), var(--color-primary-400));
      transform: scaleX(0);
      transition: transform 0.3s ease;
    }

    .nav-tab:hover {
      border-color: var(--color-primary-300);
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
      color: var(--color-text-primary);
    }

    .nav-tab:hover::before {
      transform: scaleX(1);
    }

    .nav-tab.active {
      border-color: var(--color-primary-500);
      background: linear-gradient(135deg, var(--color-background-elevated), var(--color-primary-50));
      color: var(--color-primary-700);
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
      color: var(--color-primary-600);
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

    /* ── Content ────────────────────────────────────────────── */
    .analytics-content {
      animation: slideUp 0.3s ease-out;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Responsive ─────────────────────────────────────────── */
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

    /* ── Print ──────────────────────────────────────────────── */
    @media print {
      .analytics-nav {
        display: none !important;
      }
    }
  `]
})
export class AnalyticsHubComponent {
    tabs = [
        {
            id: 'revenue',
            label: 'Chiffre d\'affaires',
            description: 'Suivez l\'évolution de votre CA par période, client et produit',
            icon: 'pi-dollar',
            route: '/reports/analytics/revenue',
            exact: false
        },
        {
            id: 'sales',
            label: 'Analyse des ventes',
            description: 'Top produits, marges, panier moyen et taux de conversion',
            icon: 'pi-chart-bar',
            route: '/reports/analytics/sales',
            exact: false
        },
        {
            id: 'clients',
            label: 'Analyse clients',
            description: 'Classement clients, actifs/inactifs et impayés',
            icon: 'pi-users',
            route: '/reports/analytics/clients',
            exact: false
        }
    ];
}
