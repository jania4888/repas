import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ForecastingService } from '../../services/forecasting.service';
import { ForecastBreakdownPoint, ForecastHorizon, ForecastScopeType, SalesForecast } from '../../models/forecasting.models';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { ProductCategoryService } from '@core/services/product-category.service';
import { ProductService } from '@core/services/product.service';
import { ClientService } from '@core/services/client.service';
import { StockService } from '@core/services/stock.service';

/**
 * Page de prévision de chiffre d'affaires. Permet de choisir un périmètre (par défaut Global)
 * et un horizon (Week/Month/Quarter), puis affiche le résultat déterministe (Expected/Low/High,
 * méthode utilisée, niveau de confiance, détail mensuel) avec un graphique à barres CSS
 * montrant les intervalles de confiance à 95 %.
 */
@Component({
  selector: 'app-revenue-forecast',
  standalone: true,
  imports: [CommonModule, FormsModule, AnalyzeWithAiButtonComponent],
  template: `
    <section class="revenue-forecast">
      <header class="filters">
        <label>
          Périmètre
          <select [(ngModel)]="scope" (ngModelChange)="onScopeChange()">
            <option value="global" i18n="@@forecasting.pages.global.toute.la.societe.84c4471a">Global (toute la société)</option>
            <option value="category" i18n="@@forecasting.pages.categorie.6b38300a">Catégorie</option>
            <option value="product" i18n="@@forecasting.pages.produit.ff673dc2">Produit</option>
            <option value="warehouse" i18n="@@forecasting.pages.entrepot.c349c0bc">Entrepôt</option>
            <option value="client" i18n="@@forecasting.pages.client.1bdd79b1">Client</option>
          </select>
        </label>
        @if (needsScopeId()) {
          <label>
            {{ scopeEntityLabel() }}
            <select [(ngModel)]="scopeId" (ngModelChange)="onScopeIdChange()" [disabled]="optionsLoading()">
              <option [ngValue]="null">{{ optionsLoading() ? 'Chargement…' : '— Sélectionner —' }}</option>
              @for (opt of currentOptions(); track opt.value) {
                <option [ngValue]="opt.value">{{ opt.label }}</option>
              }
            </select>
          </label>
        }
        <label>
          Horizon
          <select [(ngModel)]="horizon" (ngModelChange)="loadForecast()">
            <option value="week" i18n="@@forecasting.pages.semaine.7.j.eb7024dd">Semaine (7 j)</option>
            <option value="month" i18n="@@forecasting.pages.mois.30.j.de101fcd">Mois (30 j)</option>
            <option value="quarter" i18n="@@forecasting.pages.trimestre.90.j.26bc6b51">Trimestre (90 j)</option>
          </select>
        </label>
        <div class="filters-actions">
          <app-analyze-with-ai-button
            screenId="forecasting-revenue"
            [payloadBuilder]="buildAiPayload"
            [disabled]="loading() || !canCompute() || forecast() === null" />
        </div>
      </header>

      @if (needsScopeId() && !scopeId()) {
        <div class="state hint">
          Sélectionnez un(e) {{ scopeEntityLabel() | lowercase }} pour calculer la prévision.
        </div>
      } @else if (loading()) {
        <div class="state" i18n="@@forecasting.pages.calcul.en.cours.0721ac07">Calcul en cours…</div>
      } @else if (errorMessage()) {
        <div class="state error">{{ errorMessage() }}</div>
      } @else if (forecast() !== null) {
        <div class="kpi-row">
          <div class="kpi">
            <span class="label" i18n="@@forecasting.pages.ca.prevu.d4e47a65">CA prévu</span>
            <span class="value">{{ forecast()!.expected | number:'1.3-3' }} {{ forecast()!.currency }}</span>
            <span class="hint">Sur {{ forecast()!.periodStart | date:'dd/MM/yyyy' }} → {{ forecast()!.periodEnd | date:'dd/MM/yyyy' }}</span>
          </div>
          <div class="kpi">
            <span class="label" i18n="@@forecasting.pages.intervalle.95.05aaeb06">Intervalle 95 %</span>
            <span class="value small">{{ forecast()!.low | number:'1.3-3' }} – {{ forecast()!.high | number:'1.3-3' }} {{ forecast()!.currency }}</span>
            <span class="hint">Confiance {{ forecast()!.confidencePercent | number:'1.0-1' }} %</span>
          </div>
          <div class="kpi">
            <span class="label" i18n="@@forecasting.pages.methode.2e94172a">Méthode</span>
            <span class="value small">{{ methodLabel(forecast()!.methodUsed) }}</span>
            <span class="hint">{{ forecast()!.scopeLabel ?? 'Global' }}</span>
          </div>
        </div>

        @if (forecast()!.notes) {
          <div class="callout warn">{{ forecast()!.notes }}</div>
        }

        @if (forecast()!.breakdown.length > 0) {
          <div class="chart-card">
            <div class="chart-header">
              <span class="chart-title">Tendance — {{ horizonLabel() }}</span>
              <span class="chart-legend">
                <span class="legend-ci"></span> IC 95 %
                <span class="legend-bar"></span> Attendu
              </span>
            </div>
            <div class="chart-wrap">
              <div class="chart-bars">
                @for (b of forecast()!.breakdown; track b.periodStart) {
                  <div class="bar-col" [title]="b.expected | number:'1.3-3'">
                    <div class="ci-band"
                         [style.height.%]="getCiHeight(b)"
                         [style.top.%]="getCiTop(b)"></div>
                    <div class="bar-fill"
                         [style.height.%]="getBarHeight(b.expected)"
                         [style.background]="barColor()"></div>
                    <span class="bar-label">{{ b.periodStart | date:'dd/MM' }}</span>
                  </div>
                }
              </div>
            </div>
          </div>
        }

        <h3 i18n="@@forecasting.pages.detail.mensuel.0a058ece">Détail mensuel</h3>
        <table class="table">
          <thead>
            <tr>
              <th i18n="@@forecasting.pages.periode.de2110b7">Période</th>
              <th class="num" i18n="@@forecasting.pages.attendu.5e3bd350">Attendu</th>
              <th class="num" i18n="@@forecasting.pages.bas.95.c6271777">Bas (95 %)</th>
              <th class="num" i18n="@@forecasting.pages.haut.95.28837146">Haut (95 %)</th>
            </tr>
          </thead>
          <tbody>
            @for (b of forecast()!.breakdown; track b.periodStart) {
              <tr>
                <td>{{ b.periodStart | date:'dd/MM/yyyy' }} → {{ b.periodEnd | date:'dd/MM/yyyy' }}</td>
                <td class="num">{{ b.expected | number:'1.3-3' }}</td>
                <td class="num">{{ b.low | number:'1.3-3' }}</td>
                <td class="num">{{ b.high | number:'1.3-3' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
  styles: [`
    .revenue-forecast { display: block; }
    .filters { display: flex; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; align-items: flex-end; }
    .filters label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; color: var(--color-neutral-600, #6b7280); }
    .filters select { padding: .45rem .6rem; border-radius: 6px; border: 1px solid var(--color-neutral-300, #d1d5db); }
    .filters-actions { margin-left: auto; display: flex; align-items: flex-end; }
    .state { padding: 1rem; color: var(--color-neutral-600, #6b7280); font-style: italic; }
    .state.error { color: var(--color-danger-700, #b91c1c); }
    .state.hint { color: var(--color-neutral-500, #6b7280); font-style: italic; }
    .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.25rem; }
    .kpi { background: white; padding: 1rem 1.1rem; border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; }
    .kpi .label { font-size: .8rem; color: var(--color-neutral-600, #6b7280); display: block; margin-bottom: .35rem; text-transform: uppercase; letter-spacing: .04em; }
    .kpi .value { display: block; font-weight: 600; font-size: 1.4rem; color: var(--color-neutral-900, #111827); }
    .kpi .value.small { font-size: 1rem; }
    .kpi .hint { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); display: block; margin-top: .35rem; }
    .callout.warn { padding: .85rem 1rem; border-radius: 6px; background: #fef3c7; border: 1px solid #fde68a; color: #92400e; margin: 1rem 0 1.25rem; }

    /* ── Graphique ── */
    .chart-card { background: white; border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; padding: 1rem 1.25rem 1.5rem; margin-bottom: 1.5rem; }
    .chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .chart-title { font-weight: 600; font-size: .95rem; color: var(--color-neutral-800, #1f2937); }
    .chart-legend { display: flex; align-items: center; gap: .75rem; font-size: .75rem; color: var(--color-neutral-500, #9ca3af); }
    .legend-ci { display: inline-block; width: 14px; height: 10px; background: rgba(37,99,235,.15); border-radius: 2px; }
    .legend-bar { display: inline-block; width: 10px; height: 14px; background: #2563eb; border-radius: 2px; }
    .chart-wrap { overflow-x: auto; }
    .chart-bars { display: flex; align-items: flex-end; height: 160px; gap: 4px; min-width: 100%; padding-bottom: 1.5rem; position: relative; }
    .bar-col { flex: 1; min-width: 24px; position: relative; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
    .ci-band { position: absolute; left: 0; right: 0; background: rgba(37,99,235,.15); border-radius: 3px; pointer-events: none; }
    .bar-fill { position: relative; width: 100%; border-radius: 4px 4px 0 0; transition: height .3s ease; min-height: 4px; }
    .bar-label { position: absolute; bottom: -1.3rem; left: 50%; transform: translateX(-50%); font-size: .65rem; color: var(--color-neutral-500, #9ca3af); white-space: nowrap; }

    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { padding: .55rem .75rem; border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); text-align: left; font-size: .9rem; }
    .table th { background: var(--color-neutral-50, #f9fafb); font-weight: 600; }
    .table .num { text-align: right; font-variant-numeric: tabular-nums; }

    @media (max-width: 768px) {
      .filters-actions { margin-left: 0; width: 100%; }
    }
  `]
})
export class RevenueForecastComponent implements OnInit {
  private readonly forecastingService = inject(ForecastingService);
  private readonly categoryService = inject(ProductCategoryService);
  private readonly productService = inject(ProductService);
  private readonly clientService = inject(ClientService);
  private readonly stockService = inject(StockService);

  scope = signal<ForecastScopeType>('global');
  horizon = signal<ForecastHorizon>('month');
  forecast = signal<SalesForecast | null>(null);
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  // Identifiant de l'entité spécifique (Catégorie/Produit/Client/Entrepôt) — null en mode Global.
  scopeId = signal<string | null>(null);

  // Listes pour le dropdown contextuel. Chargées paresseusement à la sélection du scope.
  categoryOptions = signal<{ label: string; value: string }[]>([]);
  productOptions = signal<{ label: string; value: string }[]>([]);
  clientOptions = signal<{ label: string; value: string }[]>([]);
  warehouseOptions = signal<{ label: string; value: string }[]>([]);
  optionsLoading = signal(false);

  // Options actuellement affichées dans le second dropdown, dérivées du scope.
  readonly currentOptions = computed<{ label: string; value: string }[]>(() => {
    switch (this.scope()) {
      case 'category': return this.categoryOptions();
      case 'product': return this.productOptions();
      case 'client': return this.clientOptions();
      case 'warehouse': return this.warehouseOptions();
      default: return [];
    }
  });

  readonly scopeEntityLabel = computed<string>(() => {
    switch (this.scope()) {
      case 'category': return 'Catégorie';
      case 'product': return 'Produit';
      case 'client': return 'Client';
      case 'warehouse': return 'Entrepôt';
      default: return '';
    }
  });

  readonly needsScopeId = computed<boolean>(() => this.scope() !== 'global');
  readonly canCompute = computed<boolean>(() => !this.needsScopeId() || !!this.scopeId());

  readonly maxChartValue = computed(() => {
    const bd = this.forecast()?.breakdown;
    if (!bd || bd.length === 0) return 1;
    return Math.max(...bd.map(p => p.high), 1);
  });

  readonly barColor = computed(() => {
    const m = this.forecast()?.methodUsed;
    if (m === 'holtWinters') return '#7c3aed';
    if (m === 'holt') return '#059669';
    if (m === 'calendarHeuristic') return '#d97706';
    return '#2563eb';
  });

  readonly horizonLabel = computed(() => {
    switch (this.horizon()) {
      case 'week': return '7 jours';
      case 'month': return '30 jours';
      case 'quarter': return '90 jours';
      default: return 'Personnalisé';
    }
  });

  ngOnInit(): void {
    this.loadForecast();
  }

  async loadForecast() {
    // Garde : ne pas appeler l'API si le scopeId est encore manquant pour un scope non-Global.
    // L'utilisateur voit alors le message d'aide neutre, pas une erreur rouge.
    if (!this.canCompute()) {
      this.forecast.set(null);
      this.errorMessage.set(null);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const dto = await firstValueFrom(this.forecastingService.getRevenueForecast({
        scope: this.scope(),
        scopeId: this.scopeId(),
        horizon: this.horizon()
      }));
      this.forecast.set(dto);
    } catch (err: any) {
      this.errorMessage.set(err?.error?.message ?? 'Impossible de calculer la prévision.');
      this.forecast.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Réagit au changement de périmètre : reset de l'ID, vidage du résultat précédent,
   * chargement paresseux des options, et calcul immédiat si le scope est Global.
   */
  onScopeChange(): void {
    this.scopeId.set(null);
    this.forecast.set(null);
    this.errorMessage.set(null);
    this.loadOptionsFor(this.scope());
    if (this.scope() === 'global') {
      this.loadForecast();
    }
  }

  /** Réagit au choix d'une entité spécifique : déclenche le calcul si tout est prêt. */
  onScopeIdChange(): void {
    this.errorMessage.set(null);
    if (this.canCompute()) {
      this.loadForecast();
    }
  }

  /**
   * Charge les options du second dropdown selon le scope sélectionné.
   * Les listes sont mises en cache après le premier chargement (vérification via length > 0).
   * En cas d'erreur, on remet la liste à vide et on coupe le flag de chargement
   * pour éviter de bloquer l'UI ; l'utilisateur peut re-sélectionner le scope pour re-tenter.
   */
  private loadOptionsFor(scope: ForecastScopeType): void {
    if (scope === 'global') return;

    this.optionsLoading.set(true);

    switch (scope) {
      case 'category':
        if (this.categoryOptions().length > 0) { this.optionsLoading.set(false); return; }
        this.categoryService.getCategoryOptionsForDropdown().subscribe({
          next: opts => { this.categoryOptions.set(opts); this.optionsLoading.set(false); },
          error: () => { this.categoryOptions.set([]); this.optionsLoading.set(false); }
        });
        break;

      case 'product':
        if (this.productOptions().length > 0) { this.optionsLoading.set(false); return; }
        this.productService.getProducts({ isActive: true, pageSize: 500 }).subscribe({
          next: r => {
            const items = r?.data?.items ?? [];
            this.productOptions.set(items.map(p => ({
              label: `${p.code} — ${p.name}`,
              value: p.id
            })));
            this.optionsLoading.set(false);
          },
          error: () => { this.productOptions.set([]); this.optionsLoading.set(false); }
        });
        break;

      case 'client':
        if (this.clientOptions().length > 0) { this.optionsLoading.set(false); return; }
        this.clientService.getClients({ isActive: true, pageSize: 500 }).subscribe({
          next: r => {
            const items = r?.data?.items ?? [];
            this.clientOptions.set(items.map(c => ({
              label: c.code ? `${c.code} — ${c.name}` : c.name,
              value: c.id
            })));
            this.optionsLoading.set(false);
          },
          error: () => { this.clientOptions.set([]); this.optionsLoading.set(false); }
        });
        break;

      case 'warehouse':
        if (this.warehouseOptions().length > 0) { this.optionsLoading.set(false); return; }
        this.stockService.getWarehouses(true).subscribe({
          next: r => {
            const items = r?.data ?? [];
            this.warehouseOptions.set(items.map(w => ({
              label: w.code ? `${w.code} — ${w.name}` : w.name,
              value: w.id
            })));
            this.optionsLoading.set(false);
          },
          error: () => { this.warehouseOptions.set([]); this.optionsLoading.set(false); }
        });
        break;
    }
  }

  getBarHeight(expected: number): number {
    return (expected / this.maxChartValue()) * 100;
  }

  getCiHeight(b: ForecastBreakdownPoint): number {
    return ((b.high - b.low) / this.maxChartValue()) * 100;
  }

  getCiTop(b: ForecastBreakdownPoint): number {
    return (1 - b.high / this.maxChartValue()) * 100;
  }

  methodLabel(method: SalesForecast['methodUsed']): string {
    switch (method) {
      case 'sma': return 'Moyenne mobile (SMA)';
      case 'holt': return 'Lissage exponentiel double (Holt)';
      case 'holtWinters': return 'Holt-Winters multiplicatif';
      case 'calendarHeuristic': return 'Heuristique calendaire (historique limité)';
      default: return method;
    }
  }

  readonly buildAiPayload = (): unknown => {
    const f = this.forecast();
    if (!f)
      return wrapLegacyAnalyzePayload(
        'forecasting-revenue',
        { screen: 'forecasting-revenue', noData: true } as Record<string, unknown>
      );
    return wrapLegacyAnalyzePayload(
      'forecasting-revenue',
      {
        screen: 'forecasting-revenue',
        scope: this.scope(),
        scopeId: this.scopeId(),
        scopeLabel: f.scopeLabel,
        horizon: this.horizon(),
        expected: f.expected,
        low: f.low,
        high: f.high,
        currency: f.currency,
        confidencePercent: f.confidencePercent,
        methodUsed: f.methodUsed,
        notes: f.notes,
        breakdown: f.breakdown.slice(0, 12)
      } as Record<string, unknown>,
      { rowsKey: 'breakdown' }
    );
  };
}
