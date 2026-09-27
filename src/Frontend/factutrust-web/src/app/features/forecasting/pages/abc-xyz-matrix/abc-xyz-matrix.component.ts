/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { ForecastingService } from '../../services/forecasting.service';
import { AbcXyzMatrix } from '../../models/forecasting.models';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';

/**
 * Matrice ABC × XYZ (3×3) : ABC = contribution au CA (A=top 80 %, B=80-95 %, C=long tail).
 * XYZ = variabilité de la demande (X=stable, Y=variable, Z=erratique).
 * Affiche aussi le top des produits classés.
 */
@Component({
  selector: 'app-abc-xyz-matrix',
  standalone: true,
  imports: [CommonModule, AnalyzeWithAiButtonComponent, PageHeaderComponent],
  template: `
    <section class="abc-xyz">
      <app-page-header
        title="Matrice ABC × XYZ" i18n-title="@@forecasting.pages.matrice.abc.xyz.8f41fc5c"
        subtitle="Classification des produits par contribution au CA (ABC) et variabilité de la demande (XYZ)." i18n-subtitle="@@forecasting.pages.classification.des.produits.par.contribu.e9fbda82">
        @if (canManage()) {
          <button class="btn btn-secondary" (click)="recompute()" [disabled]="loading()">
            <i class="pi pi-refresh"></i>
            {{ loading() ? loc_ui_tern_calcul_c289e9 : loc_ui_tern_recalculer_la_classification_ec8914 }}
          </button>
        }
        <app-analyze-with-ai-button
          screenId="forecasting-abc-xyz"
          [payloadBuilder]="buildAiPayload"
          [disabled]="loading()" />
      </app-page-header>

      @if (loading()) {
        <div class="state" i18n="@@forecasting.pages.chargement.01cba1df">Chargement…</div>
      } @else if (matrix()) {
        @if (matrix(); as m) {
        <p class="info" i18n="@@forecasting.pages.produit.s.classifie.s.calcule.le.ca.de.r.2f0f7345">
          {{ m.totalProducts }} produit(s) classifié(s) — calculé le {{ m.computedAt | date:'dd/MM/yyyy HH:mm' }}.
          CA de référence : {{ m.totalReferenceRevenue | number:'1.3-3' }} TND (12 derniers mois).
        </p>

        <div class="matrix-grid">
          <div class="cell header"></div>
          <div class="cell header" i18n="@@forecasting.pages.x.stable.3f08468f">X (stable)</div>
          <div class="cell header" i18n="@@forecasting.pages.y.variable.80338f80">Y (variable)</div>
          <div class="cell header" i18n="@@forecasting.pages.z.erratique.2f1094b5">Z (erratique)</div>

          @for (abc of ['A', 'B', 'C']; track abc) {
            <div class="cell row-header">{{ abc }}</div>
            @for (xyz of ['X', 'Y', 'Z']; track xyz) {
              <div class="cell data" [class.empty]="cellCount(abc, xyz) === 0">
                <span class="count">{{ cellCount(abc, xyz) }}</span>
                <span class="share">{{ cellShare(abc, xyz) | number:'1.1-1' }} %</span>
                <span class="label">{{ strategyFor(abc, xyz) }}</span>
              </div>
            }
          }
        </div>

        <h3 i18n="@@forecasting.pages.top.produits.d72363c0">Top produits</h3>
        <table class="table">
          <thead>
            <tr>
              <th i18n="@@forecasting.pages.produit.ff673dc2">Produit</th>
              <th i18n="@@forecasting.pages.classe.3c38412a">Classe</th>
              <th class="num" i18n="@@forecasting.pages.ca.12.mois.0eba3184">CA 12 mois</th>
              <th class="num" i18n="@@forecasting.pages.cumul.076c3283">% cumul</th>
              <th class="num" i18n="@@forecasting.pages.cv.demande.95dd2b51">CV demande</th>
              <th class="num" i18n="@@forecasting.pages.mois.actifs.8ae2e48d">Mois actifs</th>
            </tr>
          </thead>
          <tbody>
            @for (p of topProducts(); track p.productId) {
              <tr>
                <td>
                  <div class="product">
                    <span class="code">{{ p.productCode }}</span>
                    <span class="name">{{ p.productName }}</span>
                  </div>
                </td>
                <td><span class="badge {{ p.matrixCode }}">{{ p.matrixCode }}</span></td>
                <td class="num">{{ p.referenceRevenue | number:'1.3-3' }}</td>
                <td class="num">{{ p.cumulativeRevenuePercent | number:'1.1-1' }} %</td>
                <td class="num">{{ p.demandCv | number:'1.2-2' }}</td>
                <td class="num">{{ p.activeMonths }} / 12</td>
              </tr>
            }
          </tbody>
        </table>
        }
      } @else {
        <div class="state empty" i18n="@@forecasting.pages.aucune.donnee.la.matrice.n.a.pas.encore.ete.calc.69c604dc">Aucune donnée — la matrice n'a pas encore été calculée.</div>
      }
    </section>
  `,
  styles: [`
    .abc-xyz { display: block; }
    .actions-row { margin-bottom: 1rem; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
    .actions-ai { margin-left: auto; }
    @media (max-width: 768px) { .actions-ai { margin-left: 0; width: 100%; } }
    .info { color: var(--color-neutral-600, #6b7280); font-size: .9rem; margin: 0 0 1rem; }
    .state { padding: 1.25rem; color: var(--color-neutral-600, #6b7280); font-style: italic; }
    .state.empty { background: var(--color-neutral-50, #f9fafb); border: 1px dashed var(--color-neutral-300, #d1d5db); border-radius: 8px; }
    .matrix-grid { display: grid; grid-template-columns: 80px repeat(3, 1fr); gap: .25rem; margin-bottom: 2rem; }
    .cell { padding: .85rem; background: white; border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 6px; text-align: center; min-height: 80px; display: flex; flex-direction: column; justify-content: center; }
    .cell.header { background: var(--color-neutral-100, #f3f4f6); font-weight: 600; color: var(--color-neutral-700, #374151); }
    .cell.row-header { background: var(--color-neutral-100, #f3f4f6); font-weight: 700; font-size: 1.5rem; color: var(--color-neutral-700, #374151); }
    .cell.data .count { font-size: 1.4rem; font-weight: 600; color: var(--color-neutral-900, #111827); }
    .cell.data .share { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
    .cell.data .label { font-size: .7rem; color: var(--color-primary-700, #1e40af); margin-top: .25rem; font-style: italic; }
    .cell.data.empty .count { color: var(--color-neutral-300, #d1d5db); }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { padding: .55rem .75rem; border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); text-align: left; font-size: .9rem; }
    .table th { background: var(--color-neutral-50, #f9fafb); font-weight: 600; }
    .table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .product { display: flex; flex-direction: column; }
    .product .code { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); font-family: monospace; }
    .product .name { font-weight: 500; }
    .badge { padding: .15rem .55rem; border-radius: 4px; font-weight: 700; font-family: monospace; }
    .badge.AX, .badge.AY { background: #d1fae5; color: #065f46; }
    .badge.AZ, .badge.BX { background: #dbeafe; color: #1e40af; }
    .badge.BY, .badge.BZ { background: #fef3c7; color: #92400e; }
    .badge.CX, .badge.CY, .badge.CZ { background: #fee2e2; color: #b91c1c; }
    .btn { padding: .5rem 1rem; border-radius: 6px; border: 1px solid var(--color-neutral-300, #d1d5db); background: white; cursor: pointer; font-size: .9rem; }
    .btn:hover:not(:disabled) { background: var(--color-neutral-50, #f9fafb); }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
  `]
})
export class AbcXyzMatrixComponent implements OnInit {
  readonly loc_ui_tern_calcul_c289e9 = $localize`:@@ui.tern.calcul.c289e9:Calcul…`;
  readonly loc_ui_tern_recalculer_la_classification_ec8914 = $localize`:@@ui.tern.recalculer.la.classification.ec8914:Recalculer la classification`;
  private readonly forecastingService = inject(ForecastingService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  matrix = signal<AbcXyzMatrix | null>(null);
  loading = signal(false);

  topProducts = computed(() => (this.matrix()?.products ?? []).slice(0, 25));

  canManage(): boolean { return this.auth.hasAllPermissions(['forecasting:manage']); }

  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.load();
    this.forecastingService.recomputeCompleted$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { void this.load(); });
  }

  async load() {
    this.loading.set(true);
    try {
      const m = await firstValueFrom(this.forecastingService.getAbcXyzMatrix());
      this.matrix.set(m);
    } catch (err: any) {
      this.toast.add({ severity: 'error', summary: $localize`:@@abc-xyz-matrix.component.summary.Erreur:Erreur`, detail: err?.error?.message ?? $localize`:@@ui.tern.chargement.echoue.a882c7:Chargement échoué.` });
    } finally {
      this.loading.set(false);
    }
  }

  async recompute() {
    this.loading.set(true);
    try {
      const count = await firstValueFrom(this.forecastingService.recomputeAbcXyz());
      this.toast.add({ severity: 'success', summary: $localize`:@@abc-xyz-matrix.component.summary.Recalcul_termin_:Recalcul terminé`, detail: $localize`:@@forecasting.abc-xyz-matrix.ts.count.produit.s.classifies.272b6600:${count}:count: produit(s) classifiés.` });
      await this.load();
    } catch (err: any) {
      this.toast.add({ severity: 'error', summary: $localize`:@@abc-xyz-matrix.component.summary.Échec:Échec`, detail: err?.error?.message ?? $localize`:@@ui.tern.erreur.inconnue.2f49e3:Erreur inconnue.` });
    } finally {
      this.loading.set(false);
    }
  }

  cellCount(abc: string, xyz: string): number {
    const cell = this.matrix()?.cells.find(c => c.matrixCode === abc + xyz);
    return cell?.productCount ?? 0;
  }

  cellShare(abc: string, xyz: string): number {
    const cell = this.matrix()?.cells.find(c => c.matrixCode === abc + xyz);
    return cell?.revenueShare ?? 0;
  }

  strategyFor(abc: string, xyz: string): string {
    const map: Record<string, string> = {
      AX: 'Stock élevé · auto-réappro',
      AY: 'Stock élevé · alerte',
      AZ: 'Stock élevé · suivi serré',
      BX: 'Stock standard',
      BY: 'Stock standard · alerte',
      BZ: 'Réappro à la demande',
      CX: 'Stock minimal',
      CY: 'Réappro ponctuelle',
      CZ: 'Candidat déstockage'
    };
    return map[abc + xyz] ?? '';
  }

  readonly buildAiPayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      'forecasting-abc-xyz',
      {
        screen: 'forecasting-abc-xyz',
        totalProducts: this.matrix()?.totalProducts ?? 0,
        computedAt: this.matrix()?.computedAt,
        cells: this.matrix()?.cells,
        topProducts: this.topProducts().slice(0, 10).map(p => ({
          product: p.productName,
          code: p.productCode,
          matrixCode: p.matrixCode,
          revenuePercent: p.cumulativeRevenuePercent,
          cv: p.demandCv
        }))
      } as Record<string, unknown>,
      { rowsKey: 'topProducts' }
    );
}
