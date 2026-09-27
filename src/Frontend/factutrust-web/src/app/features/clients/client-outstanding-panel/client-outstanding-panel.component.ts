import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ProgressBarModule } from 'primeng/progressbar';
import { SkeletonModule } from 'primeng/skeleton';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ClientOutstanding } from '@core/services/client.service';

@Component({
  selector: 'app-client-outstanding-panel',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ProgressBarModule,
    SkeletonModule,
    StatCardComponent
  ],
  template: `
    @if (loading) {
      <div class="ft-panel encours-panel">
        <div class="ft-panel__header">
          <h3 class="ft-panel__title" i18n="@@clients.client-outstanding-panel.encours.ba3d7159">Encours</h3>
        </div>
        <div class="encours-kpi-grid">
          @for (i of [1, 2, 3, 4]; track i) {
            <p-skeleton height="6.5rem" borderRadius="1rem"></p-skeleton>
          }
        </div>
        <p-skeleton height="2.5rem" styleClass="mt-3" borderRadius="0.5rem"></p-skeleton>
      </div>
    } @else if (outstanding) {
      <div class="ft-panel encours-panel" [class.encours-panel--over]="outstanding.isOverLimit">
        <div class="ft-panel__header">
          <h3 class="ft-panel__title" i18n="@@clients.client-outstanding-panel.encours.ba3d7159">Encours</h3>
          <a class="encours-edit-link" [routerLink]="editLink" aria-label="Modifier le plafond" i18n-aria-label="Modifier le plafond">
            <i class="pi pi-pencil" aria-hidden="true"></i>
            Modifier le plafond
          </a>
        </div>

        @if (outstanding.isOverLimit) {
          <div class="ft-alert ft-alert--warning">
            <i class="pi pi-exclamation-triangle"></i>
            <span>
              <ng-container i18n="@@clients.client-outstanding-panel.encours.de.df77802b"> Encours de </ng-container> <strong>{{ formatAmount(outstanding.totalOutstanding) }} {{ outstanding.currency }}</strong>
              au-delà du plafond de {{ formatAmount(outstanding.creditLimit!) }} {{ outstanding.currency }}.
              <span class="ft-muted" i18n="@@clients.client-outstanding-panel.information.seulement.aucune.vente.n.est.bloquee.bab57933">Information seulement : aucune vente n'est bloquée.</span>
            </span>
          </div>
        }

        @if (outstanding.overdueAmount > 0) {
          <div class="ft-alert ft-alert--danger">
            <i class="pi pi-clock"></i>
            <span>
              <strong>{{ formatAmount(outstanding.overdueAmount) }} {{ outstanding.currency }}</strong>
              échus depuis plus de 30 jours.
            </span>
          </div>
        }

        <div class="encours-kpi-grid">
          <app-stat-card
            label="Factures non soldées" i18n-label="Factures non soldées"
            [value]="formatAmount(outstanding.unpaidInvoicesAmount) + ' ' + outstanding.currency"
            icon="pi-file"
            variant="primary">
            <span class="encours-kpi-sub">{{ outstanding.unpaidInvoiceCount }} facture(s)</span>
          </app-stat-card>

          <app-stat-card
            label="Commandes non facturées" i18n-label="Commandes non facturées"
            [value]="formatAmount(outstanding.confirmedOrdersAmount) + ' ' + outstanding.currency"
            icon="pi-shopping-cart"
            variant="warning">
          </app-stat-card>

          <app-stat-card
            label="Encours total" i18n-label="Encours total"
            [value]="formatAmount(outstanding.totalOutstanding) + ' ' + outstanding.currency"
            icon="pi-wallet"
            [variant]="outstanding.isOverLimit ? 'error' : 'primary'"
            [featured]="true">
          </app-stat-card>

          <app-stat-card
            label="Marge restante" i18n-label="Marge restante"
            [value]="marginDisplay"
            icon="pi-shield"
            [variant]="marginVariant">
          </app-stat-card>
        </div>

        <div class="encours-plafond">
          @if (outstanding.creditLimit === null) {
            <div class="encours-plafond__empty">
              <span class="ft-muted" i18n="@@clients.client-outstanding-panel.aucun.plafond.defini.f42b48bf">Aucun plafond défini.</span>
              <a class="encours-edit-link" [routerLink]="editLink" i18n="@@clients.client-outstanding-panel.definir.un.plafond.75174fc0">Définir un plafond</a>
            </div>
          } @else {
            <div class="encours-plafond__meta">
              <span class="ft-info__label" i18n="@@clients.client-outstanding-panel.plafond.527e038e">Plafond</span>
              <span class="encours-plafond__value ft-mono">
                {{ formatAmount(outstanding.creditLimit) }} {{ outstanding.currency }}
                <span class="encours-plafond__pct" [class.ft-amount--danger]="outstanding.isOverLimit">
                  {{ utilizationPercent() | number: '1.0-0' }} % utilisé
                </span>
              </span>
            </div>
            <p-progressBar
              [value]="utilizationBarValue()"
              [showValue]="false"
              [styleClass]="outstanding.isOverLimit ? loc_ui_tern_encours_progress_encours_progress_over_b0a1e5 : 'encours-progress'">
            </p-progressBar>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .encours-panel {
      margin-top: 0;
    }

    .encours-panel--over {
      border-left-color: var(--color-warning-500, #f59e0b);
    }

    .encours-edit-link {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1, 0.25rem);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-primary-600, #2563eb);
      text-decoration: none;
      white-space: nowrap;

      &:hover {
        text-decoration: underline;
      }

      i {
        font-size: 0.85em;
      }
    }

    .encours-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--spacing-4, 1rem);
      margin-bottom: var(--spacing-4, 1rem);

      @media (max-width: 1200px) {
        grid-template-columns: repeat(2, 1fr);
      }

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .encours-kpi-sub {
      display: block;
      margin-top: var(--spacing-1, 0.25rem);
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-text-secondary, #64748b);
    }

    .encours-plafond {
      padding-top: var(--spacing-2, 0.5rem);
    }

    .encours-plafond__empty {
      display: flex;
      align-items: center;
      gap: var(--spacing-3, 0.75rem);
      flex-wrap: wrap;
    }

    .encours-plafond__meta {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--spacing-3, 0.75rem);
      margin-bottom: var(--spacing-2, 0.5rem);
    }

    .encours-plafond__value {
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
    }

    .encours-plafond__pct {
      margin-left: var(--spacing-2, 0.5rem);
      color: var(--color-text-secondary, #64748b);
      font-weight: var(--font-weight-medium, 500);
    }

    :host ::ng-deep {
      .encours-progress .p-progressbar-value {
        background: var(--color-primary-500, #3b82f6);
      }

      .encours-progress--over .p-progressbar-value {
        background: var(--color-error-500, #ef4444);
      }

      .encours-progress.p-progressbar,
      .encours-progress--over.p-progressbar {
        height: 0.5rem;
        border-radius: 999px;
        background: var(--color-neutral-100, #f1f5f9);
      }

      /* Marge négative : montant en rouge (sémantique risque crédit). */
      .encours-kpi-grid .stat-card--error .stat-value {
        color: var(--color-error-700, #b91c1c);
      }
    }

    .mt-3 {
      margin-top: var(--spacing-3, 0.75rem);
    }
  `]
})
export class ClientOutstandingPanelComponent {
  readonly loc_ui_tern_encours_progress_encours_progress_over_b0a1e5 = "encours-progress encours-progress--over";
  @Input() outstanding: ClientOutstanding | null = null;
  @Input() loading = false;
  /** Relative router link to the client edit form (default: sibling "edit"). */
  @Input() editLink: string | any[] = 'edit';

  get marginDisplay(): string {
    const enc = this.outstanding;
    if (!enc || enc.availableCredit === null) return '—';
    return `${this.formatAmount(enc.availableCredit)} ${enc.currency}`;
  }

  get marginVariant(): 'primary' | 'success' | 'warning' | 'error' {
    const enc = this.outstanding;
    if (!enc || enc.availableCredit === null) return 'primary';
    if (enc.availableCredit < 0) return 'error';
    return 'success';
  }

  formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-TN', {
      style: 'decimal',
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(amount);
  }

  utilizationPercent(): number {
    const enc = this.outstanding;
    if (!enc || enc.creditLimit == null || enc.creditLimit <= 0) return 0;
    return (enc.totalOutstanding / enc.creditLimit) * 100;
  }

  /** Cap at 100 for the progress bar visual; percent label can exceed 100. */
  utilizationBarValue(): number {
    return Math.min(100, Math.max(0, this.utilizationPercent()));
  }
}
