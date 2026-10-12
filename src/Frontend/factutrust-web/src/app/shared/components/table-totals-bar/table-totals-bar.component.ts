import { Component, Input, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';

/**
 * Métrique affichée dans la zone de totaux d'un tableau.
 * `value` est la valeur brute (déjà agrégée côté backend sur l'ensemble filtré) ;
 * le formatage est centralisé ici pour rester cohérent avec les cellules des tableaux.
 */
export interface TotalMetric {
  label: string;
  value: number | null | undefined;
  /** 'currency' → "1 234,000 TND" (fr-TN) ; 'number' → entier ; 'percent' → "12,5 %". Défaut : 'number'. */
  format?: 'currency' | 'number' | 'percent';
  /** Devise pour le format 'currency' (défaut 'TND'). */
  currency?: string;
  /** Clé de teinte de la palette $ft-icon-tones (primary, emerald, amber, rose, cyan…). */
  tone?: string;
  /** Icône PrimeIcons (pi-*) ou FontAwesome (fa-*). */
  icon?: string;
  /** Petit complément sous la valeur (ex. une devise ou une précision). */
  hint?: string;
  /** Met la tuile en avant (liseré primaire), ex. « Total CA HT » de la vue Factures et avoirs. */
  accent?: boolean;
}

/**
 * Zone de totaux placée au-dessus d'un tableau (style Swiver). Bande responsive de tuiles
 * compactes alimentées par des agrégats calculés côté backend sur l'ensemble filtré complet.
 *
 * Le formatage monétaire réutilise {@link DecimalPipe}, piloté par LOCALE_ID — désormais
 * fixé globalement à 'fr-TN' (main.ts) : rendu « 1 234,000 », identique aux cellules des
 * tableaux formatées en fr-TN. (Avant la locale globale, LOCALE_ID par défaut = en-US
 * rendait « 1,234.000 » ici, divergent des cellules.)
 */
@Component({
  selector: 'app-table-totals-bar',
  standalone: true,
  imports: [CommonModule],
  providers: [DecimalPipe],
  template: `
    <section class="totals-bar" role="region" aria-label="Totaux du tableau" i18n-aria-label="@@shared.components.table-totals-bar.table-totals-bar.totaux.du.tableau.a65d89c7">
      @if (loading) {
        @for (slot of skeletonSlots; track $index) {
          <div class="total-tile total-tile--skeleton" aria-hidden="true">
            <span class="sk-badge"></span>
            <div class="total-text">
              <span class="sk-line sk-label"></span>
              <span class="sk-line sk-value"></span>
            </div>
          </div>
        }
      } @else {
        @for (m of metrics; track m.label) {
          <div class="total-tile" [class.total-tile--accent]="m.accent">
            @if (m.icon) {
              <span class="total-badge ft-icon-badge ft-icon-badge--sm"
                    [class]="'ft-icon-badge--' + (m.tone || 'neutral')">
                <i [class]="iconClass(m.icon)" aria-hidden="true"></i>
              </span>
            }
            <div class="total-text">
              <span class="total-label">{{ m.label }}</span>
              <span class="total-value">{{ display(m) }}</span>
              @if (m.hint) {
                <span class="total-hint">{{ m.hint }}</span>
              }
            </div>
          </div>
        }
      }
    </section>
  `,
  styles: [`
    .totals-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-4);
    }

    .total-tile {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      padding: var(--spacing-3) var(--spacing-4);
      box-shadow: var(--shadow-soft-sm, var(--shadow-sm));
      min-width: 0;
    }

    .total-badge {
      flex-shrink: 0;
    }

    .total-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .total-label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .total-value {
      font-size: var(--font-size-lg);
      font-weight: 700;
      color: var(--color-text-primary);
      line-height: 1.2;
      font-family: var(--font-family-mono, 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
      white-space: nowrap;
    }

    .total-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary, var(--color-text-secondary));
    }

    /* Tuile mise en avant (accent) — liseré primaire + fond teinté. */
    .total-tile--accent {
      border-color: var(--color-primary-500, #3862f5);
      border-inline-start-width: 4px;
      background: var(--color-primary-50, #eff6ff);
    }

    .total-tile--accent .total-label {
      color: var(--color-primary-700, #1e4fd6);
    }

    /* Squelettes de chargement */
    .total-tile--skeleton .sk-badge {
      width: 2rem;
      height: 2rem;
      border-radius: var(--radius-md);
      background: var(--color-background-hover);
      flex-shrink: 0;
    }
    .sk-line {
      display: block;
      height: 0.75rem;
      border-radius: var(--radius-sm);
      background: var(--color-background-hover);
      animation: totals-pulse 1.4s ease-in-out infinite;
    }
    .sk-label { width: 5rem; margin-bottom: var(--spacing-2); }
    .sk-value { width: 7rem; height: 1rem; }

    @keyframes totals-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @media (max-width: 768px) {
      .total-tile { padding: var(--spacing-2) var(--spacing-3); }
      .total-value { font-size: var(--font-size-base); }
    }
  `]
})
export class TableTotalsBarComponent {
  /** Métriques à afficher (ordre conservé). */
  @Input() metrics: TotalMetric[] = [];
  /** Affiche des squelettes pendant le calcul des totaux. */
  @Input() loading = false;

  /** Nombre de tuiles squelette pendant le chargement. */
  readonly skeletonSlots = Array.from({ length: 5 });

  private readonly decimal = inject(DecimalPipe);

  iconClass(icon: string): string {
    return icon.startsWith('fa') ? icon : 'pi ' + icon;
  }

  display(m: TotalMetric): string {
    if (m.value === null || m.value === undefined || Number.isNaN(m.value)) {
      return '—';
    }
    switch (m.format) {
      case 'currency':
        return `${this.decimal.transform(m.value, '1.3-3')} ${m.currency ?? 'TND'}`;
      case 'percent':
        return `${this.decimal.transform(m.value, '1.0-1')} %`;
      default:
        return this.decimal.transform(m.value, '1.0-0') ?? String(m.value);
    }
  }
}
