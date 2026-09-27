import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { ChartCardComponent } from '@shared/components/dashboard/chart-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import {
  ContractEvolutionPoint,
  ContractScheduleEntry,
  RecurringContractDetail
} from '@core/services/recurring-contract.service';
import { daysUntil, evolutionChartData } from '../contract-detail.vm';
import { formatContractAmount } from '../recurring-contracts.ui-utils';

/** Onglet « Aperçu » de la fiche contrat (maquette détail — overview). */
@Component({
  selector: 'app-contract-overview-tab',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule, RouterModule, ChartModule, TableModule,
    ChartCardComponent, ButtonComponent, EmptyStateComponent, StatusBadgeComponent, SkeletonComponent
  ],
  template: `
    <div class="overview-grid">
      <section class="ft-card-block">
        <h3 class="block-title"><i class="pi pi-info-circle"></i> Informations générales</h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="label">Client</span>
            <a class="value link" [routerLink]="['/clients', contract.clientId]">{{ contract.clientName }}</a>
          </div>
          <div class="info-row">
            <span class="label">Référence</span>
            <span class="value">{{ contract.reference || '—' }}</span>
          </div>
          <div class="info-row">
            <span class="label">Périodicité</span>
            <span class="value">{{ contract.billingFrequencyDisplay }} (jour {{ contract.billingDayOfMonth }})</span>
          </div>
          <div class="info-row">
            <span class="label">Début / Fin</span>
            <span class="value">
              {{ contract.startDate | date:'dd/MM/yyyy' }} →
              {{ contract.endDate ? (contract.endDate | date:'dd/MM/yyyy') : 'Sans fin' }}
            </span>
          </div>
          <div class="info-row">
            <span class="label">Prochaine facturation</span>
            <span class="value">{{ contract.nextBillingDate ? (contract.nextBillingDate | date:'dd/MM/yyyy') : '—' }}</span>
          </div>
          <div class="info-row">
            <span class="label">Dernière période facturée</span>
            <span class="value">{{ contract.lastBilledPeriodEnd ? (contract.lastBilledPeriodEnd | date:'dd/MM/yyyy') : '—' }}</span>
          </div>
          @if (contract.sourceQuoteId) {
            <div class="info-row">
              <span class="label">Devis d'origine</span>
              <a class="value link" [routerLink]="['/quotes', contract.sourceQuoteId]">Voir le devis</a>
            </div>
          }
          <div class="info-row">
            <span class="label">Frais d'installation facturés</span>
            <span class="value">
              <app-status-badge
                [status]="contract.setupFeeBilled ? 'active' : 'inactive'"
                [label]="contract.setupFeeBilled ? 'Oui' : 'Non'"
                [showIcon]="false">
              </app-status-badge>
            </span>
          </div>
          @if (contract.notes) {
            <div class="info-row info-row--full">
              <span class="label">Description</span>
              <span class="value notes">{{ contract.notes }}</span>
            </div>
          }
        </div>
      </section>

      <section class="ft-card-block">
        <div class="block-head">
          <h3 class="block-title"><i class="pi pi-calendar"></i> Échéances à venir</h3>
          @if (schedule && schedule.length > 0) {
            <app-button variant="ghost" size="sm" icon="pi-arrow-right" iconPos="right" (clicked)="viewSchedule.emit()">
              Tout voir
            </app-button>
          }
        </div>
        @if (scheduleLoading) {
          <div class="stack">
            <app-skeleton height="1.75rem"></app-skeleton>
            <app-skeleton height="1.75rem"></app-skeleton>
            <app-skeleton height="1.75rem"></app-skeleton>
          </div>
        } @else if (schedule === null) {
          <p class="placeholder-note">Échéancier prévisionnel disponible prochainement.</p>
        } @else if (upcoming.length === 0) {
          <p class="placeholder-note">Aucune échéance à venir.</p>
        } @else {
          <div class="schedule-list">
            @for (e of upcoming; track e.periodFrom + e.periodTo) {
              <div class="schedule-item">
                <div class="schedule-item__date">
                  <i class="pi pi-calendar"></i>
                  <span>{{ e.date | date:'dd/MM/yyyy' }}</span>
                </div>
                <span class="schedule-item__desc">{{ e.description }}</span>
                <span class="schedule-item__amount">{{ formatContractAmount(e.estimatedAmountHT, contract.currency) }}</span>
                <span class="schedule-item__pill">Dans {{ daysUntil(e.date) }} j</span>
              </div>
            }
          </div>
        }
      </section>

      <app-chart-card title="Évolution" subtitle="Montants facturés — 6 derniers mois" class="overview-grid__chart">
        @if (evolutionLoading) {
          <app-skeleton height="260px" shape="rounded"></app-skeleton>
        } @else if (evolution === null) {
          <app-empty-state
            icon="pi-chart-line"
            iconSize="1.5rem"
            title="Graphique disponible prochainement"
            description="L'historique mensuel sera disponible après la mise à jour du serveur."
            [showAction]="false">
          </app-empty-state>
        } @else {
          <p-chart type="line" [data]="evolutionChartData(evolution)" [options]="evolutionOptions" [style]="{ height: '260px' }"></p-chart>
        }
      </app-chart-card>

      <section class="ft-card-block">
        <div class="block-head">
          <h3 class="block-title"><i class="pi pi-list"></i> Services inclus</h3>
          <app-button variant="ghost" size="sm" icon="pi-arrow-right" iconPos="right" (clicked)="viewServices.emit()">
            Gérer
          </app-button>
        </div>
        @if (contract.lines.length === 0) {
          <p class="placeholder-note">Aucune ligne de service.</p>
        } @else {
          <p-table [value]="contract.lines" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th style="width: 70px">Qté</th>
                <th style="width: 120px">Prix HT</th>
                <th style="width: 80px">TVA</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-line>
              <tr>
                <td>{{ (line.lineTypeDisplay | backendLabel) || line.lineType }}</td>
                <td>
                  {{ line.description }}
                  @if (line.lineType === 'UsageMetered') {
                    <div class="line-sub">
                      Métrique : {{ line.usageMetricName || '—' }}
                      · Inclus : {{ line.includedQuantity ?? '—' }}
                      · Dépasst : {{ line.overageUnitPriceHT != null ? formatContractAmount(line.overageUnitPriceHT, contract.currency) : '—' }}
                    </div>
                  }
                </td>
                <td>{{ line.quantity }}</td>
                <td class="amount">{{ line.unitPriceHT | currency:contract.currency:'symbol':'1.3-3' }}</td>
                <td>{{ line.vatRate }}%</td>
              </tr>
            </ng-template>
          </p-table>
        }
      </section>

      <section class="ft-card-block">
        <h3 class="block-title"><i class="pi pi-folder"></i> Documents</h3>
        <p class="placeholder-note">Le dépôt de documents arrive en phase 2.</p>
        <app-button variant="outline" size="sm" icon="pi-plus" [disabled]="true">
          Ajouter un document
        </app-button>
      </section>
    </div>
  `,
  styles: [`
    .overview-grid {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
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

    .block-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-2);

      .block-title { margin-bottom: 0; }
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0 var(--spacing-6);

      @media (max-width: 640px) { grid-template-columns: 1fr; }
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: var(--spacing-3);
      padding: var(--spacing-2) 0;
      border-bottom: 1px solid var(--color-neutral-100);

      &:last-child { border-bottom: none; }

      .label { color: var(--color-neutral-600); font-size: var(--font-size-sm); }
      .value { font-weight: var(--font-weight-medium); color: var(--color-neutral-900); text-align: right; }
      .value.link { color: var(--color-primary-600); text-decoration: none; }
      .value.link:hover { text-decoration: underline; }
      .value.notes { white-space: pre-wrap; font-weight: var(--font-weight-normal); }
    }

    .info-row--full { grid-column: 1 / -1; }

    .stack { display: flex; flex-direction: column; gap: var(--spacing-2); }

    .placeholder-note {
      margin: 0;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-sm);
    }

    .schedule-list { display: flex; flex-direction: column; }

    .schedule-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-2) 0;
      border-bottom: 1px solid var(--color-neutral-100);
      font-size: var(--font-size-sm);

      &:last-child { border-bottom: none; }
    }

    .schedule-item__date {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      color: var(--color-text-secondary);
      min-width: 96px;

      .pi { color: var(--color-primary-600); }
    }

    .schedule-item__desc { flex: 1; color: var(--color-text-primary); min-width: 0; }

    .schedule-item__amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-medium);
      white-space: nowrap;
    }

    .schedule-item__pill {
      background: var(--color-primary-50);
      color: var(--color-primary-700);
      border-radius: var(--radius-full);
      padding: 0 var(--spacing-2);
      font-size: var(--font-size-xs);
      white-space: nowrap;
    }

    .line-sub {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      white-space: nowrap;
    }
  `]
})
export class ContractOverviewTabComponent {
  @Input({ required: true }) contract!: RecurringContractDetail;
  @Input() schedule: ContractScheduleEntry[] | null = null;
  @Input() evolution: ContractEvolutionPoint[] | null = null;
  @Input() scheduleLoading = false;
  @Input() evolutionLoading = false;
  @Output() viewSchedule = new EventEmitter<void>();
  @Output() viewServices = new EventEmitter<void>();

  protected readonly daysUntil = daysUntil;
  protected readonly formatContractAmount = formatContractAmount;

  readonly evolutionOptions = {
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } }
    }
  };

  /** Top 3 des échéances à partir d'aujourd'hui (le backend renvoie l'échéancier par date décroissante). */
  get upcoming(): ContractScheduleEntry[] {
    const today = new Date().toISOString().slice(0, 10);
    return (this.schedule ?? [])
      .filter(e => (e.date ?? '').slice(0, 10) >= today)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      .slice(0, 3);
  }

  protected readonly evolutionChartData = evolutionChartData;
}
