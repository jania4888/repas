import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ContractKpiVm } from '../contract-detail.vm';
import { formatContractAmount } from '../recurring-contracts.ui-utils';

/** Bande de 5 cartes KPI de la fiche contrat (maquette détail). */
@Component({
  selector: 'app-contract-kpi-strip',
  standalone: true,
  imports: [CommonModule, StatCardComponent],
  template: `
    <div class="kpi-grid">
      <app-stat-card
        label="Montant du contrat" i18n-label="Montant du contrat"
        [value]="formatContractAmount(kpi.contractTotalHT, currency)"
        icon="pi-wallet"
        variant="primary"
        tone="primary">
        @if (kpi.monthlyEquivalentHT != null) {
          <span class="kpi-sub">≈ {{ formatContractAmount(kpi.monthlyEquivalentHT, currency) }}/mois</span>
        }
      </app-stat-card>

      <app-stat-card
        label="Prochaine échéance" i18n-label="Prochaine échéance"
        [value]="kpi.nextBillingDate ? ((kpi.nextBillingDate | date:'dd/MM/yyyy') ?? '—') : '—'"
        icon="pi-calendar"
        variant="primary"
        tone="violet">
        @if (kpi.daysUntilNext != null) {
          @if (kpi.daysUntilNext >= 0) {
            <span class="kpi-sub">Dans {{ kpi.daysUntilNext }} j</span>
          } @else {
            <span class="kpi-sub kpi-sub--late">En retard de {{ -kpi.daysUntilNext }} j</span>
          }
        }
      </app-stat-card>

      <app-stat-card
        label="Fréquence" i18n-label="Fréquence"
        [value]="kpi.frequencyLabel || '—'"
        icon="pi-sync"
        variant="primary"
        tone="teal">
        <span class="kpi-sub">Le {{ kpi.billingDayOfMonth }} du mois</span>
      </app-stat-card>

      <app-stat-card
        label="Durée" i18n-label="Durée"
        [value]="kpi.durationMonths != null ? kpi.durationMonths + loc_ui_tern_mois_e570fc : loc_ui_tern_indeterminee_d12dcb"
        icon="pi-hourglass"
        variant="primary"
        tone="orange">
        <span class="kpi-sub">{{ kpi.periodLabel }}</span>
      </app-stat-card>

      <app-stat-card
        label="Renouvellement" i18n-label="Renouvellement"
        [value]="kpi.autoRenew ? loc_ui_tern_automatique_f8a3c3 : loc_ui_tern_manuel_6c1cc0"
        icon="pi-refresh"
        [variant]="kpi.autoRenew ? 'success' : 'warning'">
        <span class="kpi-sub">Préavis {{ kpi.noticePeriodDays }} j</span>
      </app-stat-card>
    </div>
  `,
  styles: [`
    .kpi-grid {
      display: grid;
      // 200px minimum : en dessous, les montants longs (« 4 748,387 TND ») et les intitulés
      // (« RENOUVELLEMENT ») se coupent au milieu d'un mot/nombre.
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-5);
    }

    .kpi-sub {
      display: block;
      margin-top: var(--spacing-1);
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .kpi-sub--late { color: var(--color-error-600, #dc2626); }
  `]
})
export class ContractKpiStripComponent {
  readonly loc_ui_tern_mois_e570fc = $localize`:@@ui.tern.mois.e570fc: mois`;
  readonly loc_ui_tern_indeterminee_d12dcb = $localize`:@@ui.tern.indeterminee.d12dcb:Indéterminée`;
  readonly loc_ui_tern_automatique_f8a3c3 = $localize`:@@ui.tern.automatique.f8a3c3:Automatique`;
  readonly loc_ui_tern_manuel_6c1cc0 = $localize`:@@ui.tern.manuel.6c1cc0:Manuel`;
  @Input({ required: true }) kpi!: ContractKpiVm;
  @Input() currency = 'TND';

  protected readonly formatContractAmount = formatContractAmount;
}
