import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { CashFlowThresholds } from '../../models/cash-forecast.models';
import {
  formatAmount,
  positionZoneLabel,
  resolvePositionZone
} from '../cash-forecast.view-model';

/**
 * Jauge « Position de trésorerie » : demi-cercle à trois zones (critique, vigilance, confort) et
 * aiguille positionnée sur le solde prévisionnel.
 *
 * Écrite en SVG plutôt qu'avec un doughnut Chart.js : la graduation doit refléter des seuils
 * métier saisis par l'utilisateur, pas des parts d'un total. Un doughnut aurait imposé de
 * fabriquer des segments proportionnels sans rapport avec les montants réels.
 */
@Component({
  selector: 'app-cash-position-gauge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="gauge" role="img" [attr.aria-label]="ariaLabel()">
      <svg viewBox="0 0 200 118" class="gauge__svg">
        <!-- Zones : rouge jusqu'au seuil critique, orange jusqu'au confort, vert au-delà. -->
        <path [attr.d]="arcPath(0, 0.33)" class="gauge__arc gauge__arc--critical" />
        <path [attr.d]="arcPath(0.33, 0.67)" class="gauge__arc gauge__arc--alert" />
        <path [attr.d]="arcPath(0.67, 1)" class="gauge__arc gauge__arc--comfort" />

        <line
          x1="100"
          y1="100"
          [attr.x2]="needle().x"
          [attr.y2]="needle().y"
          class="gauge__needle" />
        <circle cx="100" cy="100" r="6" class="gauge__hub" />
      </svg>

      <div class="gauge__readout">
        <span class="gauge__value">{{ compactValue() }}</span>
        <span class="gauge__currency">{{ currency() }}</span>
        <span class="gauge__zone" [class]="'gauge__zone--' + zone()">{{ zoneLabel() }}</span>
      </div>

      <dl class="gauge__thresholds">
        <div>
          <dt i18n="@@treasury.cash-forecast.seuil.critique.2bf6d0b2">Seuil critique</dt>
          <dd>{{ formatted(thresholds().criticalThreshold) }}</dd>
        </div>
        <div>
          <dt i18n="@@treasury.cash-forecast.seuil.d.alerte.02c9c885">Seuil d'alerte</dt>
          <dd>{{ formatted(thresholds().alertThreshold) }}</dd>
        </div>
        <div>
          <dt i18n="@@treasury.cash-forecast.seuil.de.confort.e897eeaf">Seuil de confort</dt>
          <dd>{{ formatted(thresholds().comfortThreshold) }}</dd>
        </div>
      </dl>
    </div>
  `,
  styles: [`
    .gauge { display: flex; flex-direction: column; align-items: center; gap: .75rem; }
    .gauge__svg { width: 100%; max-width: 260px; height: auto; }
    .gauge__arc { fill: none; stroke-width: 16; stroke-linecap: butt; }
    .gauge__arc--critical { stroke: #ef4444; }
    .gauge__arc--alert { stroke: #f59e0b; }
    .gauge__arc--comfort { stroke: #10b981; }
    .gauge__needle { stroke: var(--color-text-primary, #0f172a); stroke-width: 3; stroke-linecap: round; }
    .gauge__hub { fill: var(--color-text-primary, #0f172a); }
    .gauge__readout { display: flex; flex-direction: column; align-items: center; gap: .15rem; margin-top: -1.75rem; }
    .gauge__value { font-size: 1.6rem; font-weight: 700; color: var(--color-text-primary, #0f172a); line-height: 1.1; }
    .gauge__currency { font-size: .75rem; color: var(--color-text-secondary, #64748b); }
    .gauge__zone { margin-top: .35rem; font-size: .75rem; font-weight: 600; padding: .15rem .6rem; border-radius: 999px; }
    .gauge__zone--critical { background: #fee2e2; color: #b91c1c; }
    .gauge__zone--alert { background: #fef3c7; color: #b45309; }
    .gauge__zone--comfort { background: #d1fae5; color: #047857; }
    .gauge__thresholds { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; width: 100%; margin: .5rem 0 0; }
    .gauge__thresholds > div { text-align: center; }
    .gauge__thresholds dt { font-size: .7rem; color: var(--color-text-tertiary, #94a3b8); margin: 0 0 .1rem; }
    .gauge__thresholds dd { font-size: .75rem; font-weight: 600; margin: 0; color: var(--color-text-secondary, #64748b); }
  `]
})
export class CashPositionGaugeComponent {
  readonly balance = input.required<number>();
  readonly thresholds = input.required<CashFlowThresholds>();
  readonly currency = input<string>('TND');

  readonly zone = computed(() => resolvePositionZone(this.balance(), this.thresholds()));
  readonly zoneLabel = computed(() => positionZoneLabel(this.zone()));

  readonly compactValue = computed(() => {
    const value = this.balance();
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace('.', ',')}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(2).replace('.', ',')}K`;
    return value.toFixed(0);
  });

  readonly ariaLabel = computed(
    () => `Position de trésorerie : ${formatAmount(this.balance(), this.currency())}, zone ${this.zoneLabel()}`
  );

  /**
   * Fraction [0..1] de la course de l'aiguille.
   *
   * L'échelle va du seuil critique au seuil de confort, prolongée d'une demi-plage de chaque côté
   * pour qu'un solde hors bornes reste lisible au lieu de coller à l'extrémité.
   */
  private readonly fraction = computed(() => {
    const { criticalThreshold, comfortThreshold } = this.thresholds();
    const span = comfortThreshold - criticalThreshold;

    if (span <= 0) return this.balance() >= comfortThreshold ? 1 : 0;

    const min = criticalThreshold - span / 2;
    const max = comfortThreshold + span / 2;
    const ratio = (this.balance() - min) / (max - min);

    return Math.min(1, Math.max(0, ratio));
  });

  readonly needle = computed(() => {
    // Demi-cercle parcouru de la gauche (180°) vers la droite (0°).
    const angle = Math.PI * (1 - this.fraction());
    return {
      x: 100 + Math.cos(angle) * 72,
      y: 100 - Math.sin(angle) * 72
    };
  });

  formatted(value: number): string {
    return formatAmount(value, this.currency());
  }

  /** Arc SVG entre deux fractions du demi-cercle. */
  arcPath(from: number, to: number): string {
    const point = (fraction: number) => {
      const angle = Math.PI * (1 - fraction);
      return {
        x: 100 + Math.cos(angle) * 82,
        y: 100 - Math.sin(angle) * 82
      };
    };

    const start = point(from);
    const end = point(to);

    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A 82 82 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }
}
