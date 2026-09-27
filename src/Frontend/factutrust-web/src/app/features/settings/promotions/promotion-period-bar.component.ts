import { Component, Input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';
import { Promotion } from '@core/services/pricing.service';
import { periodLabel, promotionPeriodProgress } from './promotions.utils';

@Component({
  selector: 'app-promotion-period-bar',
  standalone: true,
  imports: [CommonModule, TooltipModule],
  template: `
    <div class="period-bar" [pTooltip]="tooltip()" tooltipPosition="top">
      <div
        class="period-bar__track"
        role="progressbar"
        [attr.aria-valuenow]="progress().percent"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-label]="ariaLabel()">
        <div
          class="period-bar__fill period-bar__fill--{{ progress().tone }}"
          [style.width.%]="progress().percent"></div>
      </div>
      <div class="period-bar__meta">
        <span class="period-bar__percent">{{ progress().percent }} %</span>
        <span class="period-bar__dates">{{ periodText() }}</span>
        @if (progress().daysRemaining > 0 && progress().tone !== 'secondary') {
          <span class="period-bar__remaining" i18n="@@settings.promotions.j.restants.20b22806">{{ progress().daysRemaining }} j restants</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .period-bar {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-1);
        min-width: 12rem;
      }

      .period-bar__track {
        height: 6px;
        border-radius: var(--radius-full);
        background: var(--color-neutral-200);
        overflow: hidden;
      }

      .period-bar__fill {
        height: 100%;
        border-radius: var(--radius-full);
        transition: width var(--transition-fast);
      }

      .period-bar__fill--success {
        background: var(--color-success-500);
      }

      .period-bar__fill--warning {
        background: var(--color-warning-500);
      }

      .period-bar__fill--secondary {
        background: var(--color-neutral-400);
      }

      .period-bar__meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-2);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .period-bar__percent {
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-secondary);
      }
    `
  ]
})
export class PromotionPeriodBarComponent {
  @Input({ required: true }) promo!: Promotion;

  readonly progress = computed(() => promotionPeriodProgress(this.promo));
  readonly periodText = computed(() => periodLabel(this.promo));

  tooltip(): string {
    const p = this.progress();
    return `${p.daysElapsed} jour(s) sur ${p.daysTotal} écoulé(s)`;
  }

  ariaLabel(): string {
    return $localize`:@@settings.promotion-period-bar.ts.progression.de.la.periode.percent.pour.c.ac7c40ed:Progression de la période : ${this.progress().percent}:percent: pour cent`;
  }
}
