import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule } from 'primeng/chart';
import { TooltipModule } from 'primeng/tooltip';
import { ChartCardComponent } from '@shared/components/dashboard/chart-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ContractFinancialSummary, RecurringContractDetail } from '@core/services/recurring-contract.service';
import { donutChartData, renewalDeadlineOf } from '../contract-detail.vm';
import { formatContractAmount } from '../recurring-contracts.ui-utils';

export type ContractSideAction = 'invoice' | 'reminder' | 'download' | 'clone' | 'cancel';

/**
 * Colonne droite persistante de la fiche contrat : résumé financier (donut),
 * informations de renouvellement et actions rapides. Composant « bête » : il émet
 * les intentions, la page parente exécute (confirmations, appels API, toasts).
 */
@Component({
  selector: 'app-contract-side-panel',
  standalone: true,
  imports: [CommonModule, ChartModule, TooltipModule, ChartCardComponent, ButtonComponent, EmptyStateComponent],
  template: `
    <app-chart-card
      title="Résumé financier" i18n-title="@@recurring-contracts.components.resume.financier.00e0cf1c"
      [subtitle]="summary && summary.isOpenEnded ? loc_ui_tern_12_prochains_mois_contrat_sans_fin_225ba2 : undefined">
      @if (summary; as s) {
        <div class="donut-wrap">
          <p-chart
            type="doughnut"
            [data]="donutData"
            [options]="donutOptions"
            [style]="{ height: '180px' }">
          </p-chart>
          <div class="donut-center" aria-hidden="true">
            <span class="donut-center__value">{{ s.percentInvoiced | number:'1.0-0' }}%</span>
            <span class="donut-center__label" i18n="@@recurring-contracts.components.facture.55e253e6">Facturé</span>
          </div>
        </div>
        <div class="fin-rows">
          <div class="fin-row">
            <span i18n="@@recurring-contracts.components.total.contrat.4977cc50">Total contrat</span>
            <strong>{{ formatContractAmount(s.totalContractAmount, s.currency) }}</strong>
          </div>
          <div class="fin-row">
            <span i18n="@@recurring-contracts.components.deja.facture.363ed4bc">Déjà facturé</span>
            <strong>{{ formatContractAmount(s.totalInvoicedAmount, s.currency) }}</strong>
          </div>
          <div class="fin-row">
            <span i18n="@@recurring-contracts.components.reste.a.facturer.401f18d8">Reste à facturer</span>
            <strong>{{ formatContractAmount(s.remainingAmount, s.currency) }}</strong>
          </div>
        </div>
      } @else {
        <app-empty-state
          icon="pi-chart-pie"
          iconSize="1.5rem"
          title="Résumé disponible prochainement" i18n-title="@@recurring-contracts.components.resume.disponible.prochainement.2a743add"
          description="Le résumé financier sera disponible après la mise à jour du serveur."
          [showAction]="false">
        </app-empty-state>
      }
    </app-chart-card>

    <section class="ft-card-block">
      <h3 class="block-title"><i class="pi pi-refresh"></i> Informations de renouvellement</h3>
      <div class="info-row"><span class="label" i18n="@@recurring-contracts.components.mode.a7b93d21">Mode</span><span class="value">{{ contract.autoRenew ? loc_ui_tern_automatique_f8a3c3 : loc_ui_tern_manuel_6c1cc0 }}</span></div>
      <div class="info-row"><span class="label" i18n="@@recurring-contracts.components.preavis.ccd8b5f5">Préavis</span><span class="value">{{ contract.noticePeriodDays }} jours</span></div>
      <div class="info-row">
        <span class="label" i18n="@@recurring-contracts.components.date.limite.44cce6d3">Date limite</span>
        @let deadline = renewalDeadlineOf(contract);
        <span class="value">{{ deadline ? (deadline | date:'dd/MM/yyyy') : '—' }}</span>
      </div>
    </section>

    <section class="ft-card-block">
      <h3 class="block-title"><i class="pi pi-bolt"></i> Actions rapides</h3>
      <div class="quick-actions">
        @if (canTriggerBilling && contract.status === 'Active') {
          <app-button variant="outline" size="sm" icon="pi-file-edit" [disabled]="actionInProgress" (clicked)="actionTriggered.emit('invoice')" i18n="@@recurring-contracts.components.generer.une.facture.9b204490"> Générer une facture </app-button>
        }
        <app-button
          variant="outline"
          size="sm"
          icon="pi-envelope"
          [disabled]="true"
          pTooltip="Disponible prochainement" i18n-pTooltip="@@recurring-contracts.components.disponible.prochainement.96420607"
          tooltipPosition="left" i18n="@@recurring-contracts.components.envoyer.un.rappel.80e49875"> Envoyer un rappel </app-button>
        <app-button
          variant="outline"
          size="sm"
          icon="pi-download"
          [disabled]="true"
          pTooltip="Disponible prochainement" i18n-pTooltip="@@recurring-contracts.components.disponible.prochainement.96420607"
          tooltipPosition="left" i18n="@@recurring-contracts.components.telecharger.le.contrat.9eca7c98"> Télécharger le contrat </app-button>
        @if (canCreate) {
          <app-button variant="outline" size="sm" icon="pi-copy" [disabled]="actionInProgress" (clicked)="actionTriggered.emit('clone')" i18n="@@recurring-contracts.components.cloner.le.contrat.0beaa2d4"> Cloner le contrat </app-button>
        }
        @if (canManage && (contract.status === 'Active' || contract.status === 'Suspended')) {
          <app-button variant="danger" size="sm" icon="pi-times" [disabled]="actionInProgress" (clicked)="actionTriggered.emit('cancel')" i18n="@@recurring-contracts.components.resilier.le.contrat.aa98822d"> Résilier le contrat </app-button>
        }
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .donut-wrap {
      position: relative;
      max-width: 220px;
      margin: 0 auto;
    }

    .donut-center {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      /* Le centre du donut occupe ~70% haut de la zone (légende en bas) : on remonte un peu. */
      padding-bottom: 2.5rem;
    }

    .donut-center__value {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
    }

    .donut-center__label {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .fin-rows { margin-top: var(--spacing-3); }

    .fin-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-2) 0;
      border-bottom: 1px solid var(--color-neutral-100);
      font-size: var(--font-size-sm);

      &:last-child { border-bottom: none; }

      span { color: var(--color-text-secondary); }

      strong {
        font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
        color: var(--color-text-primary);
      }
    }

    .ft-card-block {
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-soft-sm, var(--shadow-sm));
      padding: var(--spacing-4);
    }

    .block-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-700);
      text-transform: uppercase;
      letter-spacing: 0.05em;

      .pi { color: var(--color-primary-600); }
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-2) 0;
      border-bottom: 1px solid var(--color-neutral-100);

      &:last-child { border-bottom: none; }

      .label { color: var(--color-neutral-600); font-size: var(--font-size-sm); }
      .value { font-weight: var(--font-weight-medium); color: var(--color-neutral-900); }
    }

    .quick-actions {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);

      app-button { width: 100%; }
    }
  `]
})
export class ContractSidePanelComponent {
  readonly loc_ui_tern_12_prochains_mois_contrat_sans_fin_225ba2 = $localize`:@@ui.tern.12.prochains.mois.contrat.sans.fin.225ba2:12 prochains mois (contrat sans fin)`;
  readonly loc_ui_tern_automatique_f8a3c3 = $localize`:@@ui.tern.automatique.f8a3c3:Automatique`;
  readonly loc_ui_tern_manuel_6c1cc0 = $localize`:@@ui.tern.manuel.6c1cc0:Manuel`;
  @Input({ required: true }) contract!: RecurringContractDetail;

  /**
   * Résumé financier exposé via setter : les données du donut sont calculées
   * UNE fois par changement d'input et non à chaque cycle de détection de
   * changements. Un binding `[data]="donutChartData(s)"` produirait une
   * nouvelle référence à chaque cycle, et le setter `data` de p-chart
   * (PrimeNG 19) appelle `reinit()` (destroy + recréation du chart) →
   * clignotement du donut à chaque interaction.
   */
  @Input()
  set summary(value: ContractFinancialSummary | null) {
    this._summary = value;
    this.donutData = value ? donutChartData(value) : null;
  }
  get summary(): ContractFinancialSummary | null {
    return this._summary;
  }
  private _summary: ContractFinancialSummary | null = null;

  /** Données du donut, référence stable entre deux changements de `summary`. */
  donutData: { labels: string[]; datasets: unknown[] } | null = null;
  /** Gardes de permission (miroir de l'en-tête de page) — sans elles, aucun bouton d'action. */
  @Input() canManage = false;
  @Input() canTriggerBilling = false;
  @Input() canCreate = false;
  /** Désactive les actions pendant un appel API en cours. */
  @Input() actionInProgress = false;
  @Output() actionTriggered = new EventEmitter<ContractSideAction>();

  protected readonly formatContractAmount = formatContractAmount;

  readonly donutOptions = {
    cutout: '70%',
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } }
    }
  };

  protected readonly renewalDeadlineOf = renewalDeadlineOf;
}
