import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { buildSparklinePaths } from '@shared/utils/sparkline-path.util';

/** Historic decorative polyline kept as fallback when no series is provided. */
export const DECORATIVE_SPARKLINE_POINTS = '0,22 15,18 30,20 45,12 60,14 75,8 90,10 105,4 120,6';

type StatVariant = 'primary' | 'success' | 'warning' | 'error';
type StatAppearance = 'default' | 'solid' | 'mini-sparkline';

/**
 * Carte KPI — style maquette factutrust_design.html :
 * badge d'icône en teinte claire (haut-gauche) + badge de tendance (haut-droite),
 * libellé, valeur, puis emplacement projeté (barre de progression / sparkline / sous-titre)
 * et blob d'angle décoratif teinté.
 *
 * API rétro-compatible : les @Input existants (label, value, icon, variant, change, featured)
 * sont préservés. Ajouts optionnels : `tone`, `appearance` (solid / mini-sparkline Superieur),
 * navigation via `routerLink`.
 */
@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    @if (isNavigable) {
      <a
        class="stat-card-link"
        [routerLink]="routerLink!"
        [queryParams]="queryParams"
        [attr.aria-label]="navigationAriaLabel || label">
        <ng-container *ngTemplateOutlet="cardContent"></ng-container>
      </a>
    } @else {
      <div [class]="cardClasses" [class.stat-card--clickable]="clickable && !isNavigable" (click)="onCardClick($event)">
        <ng-container *ngTemplateOutlet="cardContent"></ng-container>
      </div>
    }

    <ng-template #cardContent>
      <div [class]="cardClasses">
        <div class="stat-body">
          <div class="stat-top">
            <span [class]="badgeClasses">
              <i [class]="iconClass" aria-hidden="true"></i>
            </span>
            @if (change) {
              <span class="stat-trend" [class.positive]="change > 0" [class.negative]="change < 0">
                <i class="fa-solid" [class.fa-arrow-trend-up]="change > 0" [class.fa-arrow-trend-down]="change < 0" aria-hidden="true"></i>
                {{ change > 0 ? '+' : '' }}{{ change }}%
                @if (changeSuffix) {
                  <span class="stat-trend-suffix">{{ changeSuffix }}</span>
                }
              </span>
            }
          </div>
          <span class="stat-label">{{ label }}</span>
          <span class="stat-value" [attr.title]="valueTitle || null">{{ value }}</span>
          <ng-content></ng-content>
          @if (sparklinePath) {
            <svg class="stat-sparkline" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
              <path [attr.d]="sparklineAreaPath" fill="currentColor" opacity="0.18" />
              <path
                [attr.d]="sparklinePath"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round" />
            </svg>
          } @else if (showDecorativeSparkline) {
            <svg class="stat-sparkline" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                [attr.points]="decorativeSparklinePoints" />
            </svg>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    .stat-card-link {
      display: block;
      text-decoration: none;
      color: inherit;
      border-radius: var(--radius-2xl, 1rem);
    }

    .stat-card-link:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .stat-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-2xl, 1rem);
      padding: var(--spacing-5);
      border: 1px solid var(--color-border-subtle);
      box-shadow: var(--shadow-soft-sm, var(--shadow-sm));
      position: relative;
      overflow: hidden;
      transition: box-shadow var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1)),
                  transform var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1)),
                  border-color var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1));
    }

    .stat-card::after {
      content: '';
      position: absolute;
      top: 0;
      inset-inline-end: 0;
      width: 8rem;
      height: 8rem;
      background: radial-gradient(circle at top right, currentColor 0%, transparent 70%);
      opacity: 0.08;
      border-end-start-radius: 9999px;
      pointer-events: none;
      transition: opacity var(--duration-moderate, 260ms) var(--ease-out-soft);
    }

    .stat-card-link .stat-card,
    .stat-card:hover {
      box-shadow: var(--shadow-soft-lg, var(--shadow-lg));
      transform: translateY(-3px);
      border-color: var(--color-border-default);
    }

    .stat-card-link .stat-card:hover::after,
    .stat-card:hover::after { opacity: 0.14; }

    .stat-card--primary:hover { border-color: var(--color-primary-300); }
    .stat-card--success:hover { border-color: var(--color-success-200, #bbf7d0); }
    .stat-card--warning:hover { border-color: var(--color-warning-200, #fde68a); }
    .stat-card--error:hover   { border-color: var(--color-error-200, #fecaca); }

    .stat-body {
      position: relative;
      z-index: 1;
      min-width: 0;
    }

    .stat-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-4);
    }

    .stat-icon {
      transition: transform var(--duration-moderate, 260ms) var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1));
    }
    .stat-card-link .stat-card:hover .stat-icon,
    .stat-card:hover .stat-icon {
      transform: scale(1.08) rotate(-3deg);
    }

    .stat-card--clickable {
      cursor: pointer;
    }

    .stat-trend {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-lg);
    }
    .stat-trend.positive { color: var(--color-success-600); background: var(--color-success-50); }
    .stat-trend.negative { color: var(--color-error-600); background: var(--color-error-50); }
    .stat-trend-suffix {
      font-weight: var(--font-weight-medium, 500);
      opacity: 0.85;
    }

    .stat-label {
      display: block;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      line-height: 1.3;
      overflow-wrap: break-word;
      margin-bottom: var(--spacing-1);
    }

    .stat-value {
      display: block;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: clamp(var(--font-size-lg), 2.5vw, var(--font-size-2xl));
      font-weight: 700;
      color: var(--color-text-primary);
      line-height: 1.15;
      font-family: var(--font-family-mono, 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }

    .stat-card--featured { padding: var(--spacing-6); }
    .stat-card--featured .stat-value {
      font-size: clamp(var(--font-size-xl), 3vw, var(--font-size-3xl));
    }

    /* Superieur solid KPI — fond coloré plein + texte blanc */
    .stat-card--solid {
      border: none;
      border-radius: var(--superieur-card-radius, 8px);
      box-shadow: var(--superieur-card-shadow, 0 0 20px rgba(0,0,0,0.08));
      color: #fff;
    }
    .stat-card--solid::after { opacity: 0.15; color: #fff; }
    .stat-card--solid .stat-label { color: #000; }
    .stat-card--solid .stat-value { color: #fff; font-family: var(--font-family, Inter, sans-serif); }
    .stat-card--solid .stat-trend {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }
    .stat-card--solid .ft-icon-badge {
      background: rgba(255, 255, 255, 0.22) !important;
      color: #fff !important;
    }
    .stat-card--solid.stat-card--primary { background: var(--superieur-primary, #3862f5); }
    .stat-card--solid.stat-card--success { background: var(--superieur-accent-teal, #45bdad); }
    .stat-card--solid.stat-card--warning { background: var(--superieur-accent-orange, #febc3b); }
    .stat-card--solid.stat-card--error { background: var(--superieur-accent-red, #f83f37); }
    .stat-card--solid.ft-icon-tone--cyan { background: var(--superieur-accent-cyan, #17a2b8); }
    .stat-card--solid.ft-icon-tone--purple,
    .stat-card--solid.ft-icon-tone--violet { background: var(--superieur-accent-purple, #776be8); }
    .stat-card--solid.ft-icon-tone--emerald { background: var(--superieur-accent-teal, #45bdad); }
    .stat-card--solid.ft-icon-tone--amber { background: var(--superieur-accent-orange, #febc3b); }
    .stat-card--solid.ft-icon-tone--rose { background: var(--superieur-accent-red, #f83f37); }
    .stat-card--solid:hover {
      transform: translateY(-3px);
      border-color: transparent;
      filter: brightness(1.05);
    }

    .stat-sparkline {
      display: block;
      width: 100%;
      height: 28px;
      margin-top: var(--spacing-3);
      opacity: 0.85;
      color: rgba(255, 255, 255, 0.9);
    }

    .stat-card:not(.stat-card--solid) .stat-sparkline {
      color: var(--color-primary-500, #3b82f6);
    }

    @media (max-width: 768px) {
      .stat-card { padding: var(--spacing-4); }
      .stat-value { font-size: var(--font-size-xl); }
      .stat-card--featured .stat-value { font-size: var(--font-size-2xl); }
    }
  `]
})
export class StatCardComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  /** Optional native tooltip on the value (e.g. amount with currency suffix). */
  @Input() valueTitle?: string;
  @Input() icon = 'pi-chart-line';
  @Input() variant: StatVariant = 'primary';
  @Input() change?: number;
  /** Optional suffix after trend percent (e.g. « vs mois dernier »). */
  @Input() changeSuffix?: string;
  @Input() featured?: boolean;
  /** Teinte précise du badge/blob (clé de la palette $ft-icon-tones). Défaut : dérivée de `variant`. */
  @Input() tone?: string;
  /** Apparence : default (actuel) | solid (KPI Superieur plein) | mini-sparkline */
  @Input() appearance: StatAppearance = 'default';
  /**
   * Sparkline series — three-state contract:
   * - `undefined` (default) + solid/mini-sparkline → decorative polyline (other screens)
   * - `number[]` with length ≥ 2 → data-driven path
   * - `null` or too-short array → no curve
   */
  @Input() sparkline?: number[] | null;
  @Input() routerLink?: string | any[];
  @Input() queryParams?: Record<string, string>;
  @Input() clickable = false;
  @Input() navigationAriaLabel?: string;
  @Output() cardClick = new EventEmitter<void>();

  onCardClick(event: MouseEvent): void {
    if (this.clickable && !this.isNavigable) {
      event.preventDefault();
      this.cardClick.emit();
    }
  }

  private static readonly VARIANT_TONE: Record<StatVariant, string> = {
    primary: 'primary',
    success: 'emerald',
    warning: 'amber',
    error: 'rose'
  };

  readonly decorativeSparklinePoints = DECORATIVE_SPARKLINE_POINTS;

  get isNavigable(): boolean {
    return (this.clickable || this.routerLink !== undefined) && this.routerLink != null && this.routerLink !== '';
  }

  get showDecorativeSparkline(): boolean {
    return (this.appearance === 'solid' || this.appearance === 'mini-sparkline')
      && this.sparkline === undefined;
  }

  get sparklinePath(): string | null {
    return this.sparklinePaths?.line ?? null;
  }

  get sparklineAreaPath(): string | null {
    return this.sparklinePaths?.area ?? null;
  }

  private get sparklinePaths() {
    if (!this.sparkline || this.sparkline.length < 2) {
      return null;
    }
    return buildSparklinePaths(this.sparkline);
  }

  get resolvedTone(): string {
    return this.tone ?? StatCardComponent.VARIANT_TONE[this.variant] ?? 'primary';
  }

  get cardClasses(): string {
    return [
      'stat-card',
      'stat-card--' + this.variant,
      'ft-icon-tone--' + this.resolvedTone,
      this.featured ? 'stat-card--featured' : '',
      this.appearance !== 'default' ? 'stat-card--solid' : ''
    ].join(' ').trim();
  }

  get badgeClasses(): string {
    return [
      'stat-icon',
      'ft-icon-badge',
      'ft-icon-badge--' + this.resolvedTone,
      this.featured ? 'ft-icon-badge--lg' : ''
    ].join(' ').trim();
  }

  get iconClass(): string {
    const icon = this.icon || '';
    return icon.startsWith('fa') ? icon : 'pi ' + icon;
  }
}