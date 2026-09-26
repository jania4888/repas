import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '@core/services/toast.service';
import { ForecastingService } from '../../services/forecasting.service';
import { ProductDemandForecast } from '../../models/forecasting.models';

@Component({
  selector: 'app-product-demand-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal-panel" (click)="$event.stopPropagation()">
        <header class="modal-header">
          <div>
            <h3>{{ productName }}</h3>
            <span class="modal-subtitle" i18n="@@forecasting.components.prevision.de.demande.produit.bf33950d">Prévision de demande produit</span>
          </div>
          <button class="close-btn" (click)="close.emit()"><i class="pi pi-times"></i></button>
        </header>

        @if (loading()) {
          <div class="state" i18n="@@forecasting.components.calcul.en.cours.0721ac07">Calcul en cours…</div>
        } @else {
          @if (forecast(); as f) {
            <div class="kpi-row">
              <div class="kpi">
                <span class="label" i18n="@@forecasting.components.qte.prevue.1e18ec77">Qté prévue</span>
                <span class="value">{{ f.expectedQty | number:'1.0-2' }}</span>
                <span class="hint">{{ f.lowQty | number:'1.0-2' }} – {{ f.highQty | number:'1.0-2' }}</span>
              </div>
              <div class="kpi">
                <span class="label" i18n="@@forecasting.components.stock.actuel.294a897a">Stock actuel</span>
                <span class="value" [class.low-stock]="isLowStock(f)">{{ f.currentStockOnHand | number:'1.0-2' }}</span>
                @if (f.daysOfStockRemaining !== null) {
                  <span class="hint">{{ f.daysOfStockRemaining | number:'1.0-0' }} jour(s) de stock</span>
                }
              </div>
              <div class="kpi">
                <span class="label" i18n="@@forecasting.components.reappro.suggere.0611eb76">Réappro suggéré</span>
                <span class="value accent">{{ f.suggestedReplenishmentQty | number:'1.0-2' }}</span>
                <span class="hint">Confiance {{ f.confidencePercent | number:'1.0-1' }} %</span>
              </div>
            </div>

            <div class="info-row">
              <span class="method-badge">{{ methodLabel(f.methodUsed) }}</span>
              <span class="period">{{ f.periodStart | date:'dd/MM/yyyy' }} → {{ f.periodEnd | date:'dd/MM/yyyy' }}</span>
            </div>

            @if (isLowStock(f)) {
              <div class="alert">
                <i class="pi pi-exclamation-triangle"></i>
                Le stock actuel est inférieur à la demande prévue. Un réapprovisionnement est recommandé.
              </div>
            }

            <footer class="modal-footer">
              <button class="btn btn-primary" (click)="triggerReplenishment()" [disabled]="generating()">
                <i class="pi pi-shopping-cart"></i>
                {{ generating() ? 'Génération…' : 'Créer une recommandation de réappro' }}
              </button>
              <button class="btn btn-secondary" (click)="close.emit()" i18n="@@forecasting.components.fermer.5ab4ec64">Fermer</button>
            </footer>
          } @else if (error()) {
            <div class="state error">{{ error() }}</div>
            <footer class="modal-footer">
              <button class="btn btn-secondary" (click)="close.emit()" i18n="@@forecasting.components.fermer.5ab4ec64">Fermer</button>
            </footer>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal-panel { background: white; border-radius: 10px; width: 100%; max-width: 520px; box-shadow: 0 20px 60px rgba(0,0,0,.18); display: flex; flex-direction: column; }
    .modal-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.25rem 1.25rem .75rem; border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); }
    .modal-header h3 { margin: 0 0 .15rem; font-size: 1.1rem; font-weight: 600; color: var(--color-neutral-900, #111827); }
    .modal-subtitle { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
    .close-btn { background: none; border: none; cursor: pointer; padding: .25rem; color: var(--color-neutral-400, #9ca3af); font-size: 1.1rem; }
    .close-btn:hover { color: var(--color-neutral-700, #374151); }
    .state { padding: 2rem; text-align: center; color: var(--color-neutral-600, #6b7280); font-style: italic; }
    .state.error { color: var(--color-danger-700, #b91c1c); }
    .kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; padding: 1rem 1.25rem; }
    .kpi { background: var(--color-neutral-50, #f9fafb); border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; padding: .75rem; text-align: center; }
    .kpi .label { display: block; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--color-neutral-500, #9ca3af); margin-bottom: .3rem; }
    .kpi .value { display: block; font-size: 1.3rem; font-weight: 600; color: var(--color-neutral-900, #111827); }
    .kpi .value.low-stock { color: var(--color-danger-700, #b91c1c); }
    .kpi .value.accent { color: var(--color-primary-700, #1e40af); }
    .kpi .hint { display: block; font-size: .75rem; color: var(--color-neutral-500, #9ca3af); margin-top: .2rem; }
    .info-row { display: flex; align-items: center; gap: .75rem; padding: 0 1.25rem .75rem; flex-wrap: wrap; }
    .method-badge { background: var(--color-neutral-100, #f3f4f6); border-radius: 4px; padding: .2rem .55rem; font-size: .75rem; color: var(--color-neutral-700, #374151); font-family: monospace; }
    .period { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
    .alert { margin: 0 1.25rem .75rem; padding: .75rem 1rem; background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; font-size: .85rem; color: #92400e; display: flex; gap: .5rem; align-items: flex-start; }
    .modal-footer { display: flex; gap: .75rem; padding: 1rem 1.25rem; border-top: 1px solid var(--color-neutral-200, #e5e7eb); }
    .btn { padding: .5rem 1rem; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: .85rem; display: inline-flex; align-items: center; gap: .4rem; }
    .btn-primary { background: var(--color-primary-600, #2563eb); color: white; }
    .btn-primary:hover:not(:disabled) { background: var(--color-primary-700, #1e40af); }
    .btn-secondary { background: white; border-color: var(--color-neutral-300, #d1d5db); color: var(--color-neutral-800, #1f2937); }
    .btn-secondary:hover { background: var(--color-neutral-50, #f9fafb); }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
  `]
})
export class ProductDemandModalComponent implements OnInit {
  @Input({ required: true }) productId!: string;
  @Input({ required: true }) productName!: string;
  @Output() close = new EventEmitter<void>();
  /**
   * Phase 6 review P6-m1: fires after a successful product-scoped regeneration so the parent
   * board can refresh its list/KPI without forcing a manual reload. Optional listener — components
   * that don't care can ignore it.
   */
  @Output() regenerated = new EventEmitter<{ productId: string; createdCount: number }>();

  private readonly forecastingService = inject(ForecastingService);
  private readonly toast = inject(ToastService);

  forecast = signal<ProductDemandForecast | null>(null);
  loading = signal(false);
  generating = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const f = await firstValueFrom(this.forecastingService.getProductDemandForecast(this.productId, 'month'));
      this.forecast.set(f);
    } catch (err: any) {
      this.error.set(err?.error?.message ?? 'Impossible de charger la prévision.');
    } finally {
      this.loading.set(false);
    }
  }

  async triggerReplenishment() {
    this.generating.set(true);
    try {
      // Fix F-C3: scope the regeneration to THIS product only.
      // Before this fix, calling generate without arguments regenerated every stock-managed product
      // in the tenant — misleading UX and unnecessary backend cost.
      const count = await firstValueFrom(
        this.forecastingService.generateReplenishment(null, this.productId)
      );
      this.toast.add({
        severity: 'success',
        summary: 'Recommandation créée',
        detail: count > 0
          ? `${count} recommandation(s) générée(s) pour ${this.productName}. Consultez le tableau de réapprovisionnement.`
          : `Aucune nouvelle recommandation nécessaire pour ${this.productName} — stock suffisant.`
      });
      // Phase 6 review P6-m1: tell the parent that a regeneration happened so it can reload its data.
      this.regenerated.emit({ productId: this.productId, createdCount: count });
      this.close.emit();
    } catch (err: any) {
      this.toast.add({ severity: 'error', summary: 'Échec', detail: err?.error?.message ?? 'Erreur inconnue.' });
    } finally {
      this.generating.set(false);
    }
  }

  isLowStock(f: ProductDemandForecast): boolean {
    return f.currentStockOnHand < f.expectedQty;
  }

  methodLabel(method: ProductDemandForecast['methodUsed']): string {
    switch (method) {
      case 'sma': return 'SMA';
      case 'holt': return 'Holt';
      case 'holtWinters': return 'Holt-Winters';
      case 'calendarHeuristic': return 'Heuristique';
      default: return method;
    }
  }
}
