import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ReplenishmentKpi } from '../../../models/forecasting.models';
import { QuantityFormatPipe } from '../../../pipes/quantity-format.pipe';

/**
 * Top dashboard strip showing the 4 main KPIs of the replenishment board:
 * pending count, urgent count, out-of-stock count, estimated value to order,
 * plus the service-level / stock-out percentages.
 */
@Component({
  selector: 'app-replenishment-kpi-bar',
  standalone: true,
  imports: [CommonModule, QuantityFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="kpi-bar" role="region" aria-label="Indicateurs clés du module Réapprovisionnement" i18n-aria-label="@@forecasting.pages.indicateurs.cles.du.module.reapprovisionnement.d6b7128e">
      @if (kpi; as k) {
        <div class="kpi-tile">
          <span class="label" i18n="@@forecasting.pages.en.attente.5231158f">En attente</span>
          <span class="value">{{ k.pendingCount }}</span>
          <span class="hint" i18n="@@forecasting.pages.recommandations.a.traiter.4761a209">Recommandations à traiter</span>
        </div>
        <div class="kpi-tile urgent" [class.empty]="k.urgentCount === 0">
          <span class="label" i18n="@@forecasting.pages.urgent.ecb26f46">Urgent</span>
          <span class="value">{{ k.urgentCount }}</span>
          <span class="hint" i18n="@@forecasting.pages.moins.que.le.lead.time.f6d339ff">Moins que le lead time</span>
        </div>
        <div class="kpi-tile danger" [class.empty]="k.outOfStockCount === 0">
          <span class="label" i18n="@@forecasting.pages.rupture.fda77001">Rupture</span>
          <span class="value">{{ k.outOfStockCount }}</span>
          <span class="hint" i18n="@@forecasting.pages.stock.effectif.a.0.5dfb3f4f">Stock effectif à 0</span>
        </div>
        <div class="kpi-tile">
          <span class="label" i18n="@@forecasting.pages.a.commander.1616893e">À commander</span>
          <span class="value">
            {{ k.estimatedValueToOrder | qtyFmt: null }} <small class="ccy">{{ k.currency }}</small>
          </span>
          <span class="hint" i18n="@@forecasting.pages.estimation.valeur.d.achat.22ff238c">Estimation valeur d'achat</span>
        </div>
        <div class="kpi-tile">
          <span class="label" i18n="@@forecasting.pages.taux.de.service.e609027c">Taux de service</span>
          <span class="value">{{ k.serviceLevelPercent | qtyFmt: null }} %</span>
          <span class="hint" i18n="@@forecasting.pages.approximation.tenant.ee3c748e">Approximation tenant</span>
        </div>
      } @else {
        <div class="kpi-loading" aria-busy="true" i18n="@@forecasting.pages.chargement.des.indicateurs.b4327e74">Chargement des indicateurs…</div>
      }
    </div>
  `,
  styles: [`
    .kpi-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: .75rem; margin-bottom: 1rem; }
    .kpi-tile { background: white; border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; padding: .65rem .85rem; display: flex; flex-direction: column; gap: .2rem; }
    .kpi-tile.urgent { background: #fff7ed; border-color: #fed7aa; }
    .kpi-tile.urgent.empty { background: white; border-color: var(--color-neutral-200, #e5e7eb); }
    .kpi-tile.danger { background: #fef2f2; border-color: #fecaca; }
    .kpi-tile.danger.empty { background: white; border-color: var(--color-neutral-200, #e5e7eb); }
    .kpi-tile .label { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: var(--color-neutral-500, #9ca3af); }
    .kpi-tile .value { font-size: 1.5rem; font-weight: 700; color: var(--color-neutral-900, #111827); font-variant-numeric: tabular-nums; }
    .kpi-tile .hint { font-size: .7rem; color: var(--color-neutral-500, #9ca3af); }
    .kpi-tile .ccy { font-size: .9rem; font-weight: 600; color: var(--color-neutral-500, #6b7280); margin-left: .15rem; }
    .kpi-tile.urgent .value { color: #c2410c; }
    .kpi-tile.danger .value { color: var(--color-danger-700, #b91c1c); }
    .kpi-loading { grid-column: 1 / -1; padding: 1rem; background: var(--color-neutral-50, #f9fafb); border: 1px dashed var(--color-neutral-200, #e5e7eb); border-radius: 8px; color: var(--color-neutral-500, #9ca3af); font-style: italic; text-align: center; }
  `]
})
export class ReplenishmentKpiBarComponent {
  /** KPI snapshot — null while the parent is loading or KPI flag is off. */
  @Input() kpi: ReplenishmentKpi | null = null;
}
