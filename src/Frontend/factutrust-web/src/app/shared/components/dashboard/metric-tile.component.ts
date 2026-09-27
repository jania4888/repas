import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type MetricTileTone = 'blue' | 'teal' | 'orange' | 'purple' | 'red' | 'cyan';

/**
 * Tuile métrique Superieur (Support System / Hospital) :
 * icône carrée colorée + chiffre + libellé.
 */
@Component({
  selector: 'app-metric-tile',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="metric-tile" [class]="loc_ui_tern_metric_tile_metric_tile_8d5733 + tone">
      <div class="metric-tile__icon" aria-hidden="true">
        <i [class]="iconClass"></i>
      </div>
      <div class="metric-tile__body">
        <span class="metric-tile__value">{{ value }}</span>
        <span class="metric-tile__label">{{ label }}</span>
      </div>
    </div>
  `,
  styles: [`
    .metric-tile {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.25rem;
      background: #fff;
      border-radius: var(--superieur-card-radius, 8px);
      box-shadow: var(--superieur-card-shadow, 0 0 20px rgba(0,0,0,0.08));
      border: 1px solid rgba(0,0,0,0.04);
    }

    .metric-tile__icon {
      flex-shrink: 0;
      width: 56px;
      height: 56px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 1.35rem;
    }

    .metric-tile--blue .metric-tile__icon { background: var(--superieur-primary, #3862f5); }
    .metric-tile--teal .metric-tile__icon { background: var(--superieur-accent-teal, #45bdad); }
    .metric-tile--orange .metric-tile__icon { background: var(--superieur-accent-orange, #febc3b); }
    .metric-tile--purple .metric-tile__icon { background: var(--superieur-accent-purple, #776be8); }
    .metric-tile--red .metric-tile__icon { background: var(--superieur-accent-red, #f83f37); }
    .metric-tile--cyan .metric-tile__icon { background: var(--superieur-accent-cyan, #17a2b8); }

    .metric-tile__value {
      display: block;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text-primary, #0f172a);
      line-height: 1.2;
    }

    .metric-tile__label {
      display: block;
      font-size: 0.8125rem;
      color: var(--color-text-secondary, #64748b);
      margin-top: 2px;
    }
  `]
})
export class MetricTileComponent {
  readonly loc_ui_tern_metric_tile_metric_tile_8d5733 = "metric-tile metric-tile--";
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() icon = 'fa-solid fa-ticket';
  @Input() tone: MetricTileTone = 'blue';

  get iconClass(): string {
    const icon = this.icon || '';
    if (icon.startsWith('fa') || icon.startsWith('pi ')) return icon;
    if (icon.startsWith('pi-')) return 'pi ' + icon;
    return 'fa-solid ' + icon;
  }
}