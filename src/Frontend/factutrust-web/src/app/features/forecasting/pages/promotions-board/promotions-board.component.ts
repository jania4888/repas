/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { ForecastingService } from '../../services/forecasting.service';
import { PromotionRecommendation, PromotionRecommendationType } from '../../models/forecasting.models';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';

/**
 * Tableau des recommandations de promotions actives. L'utilisateur peut accepter pour préparer
 * un brouillon de remise (à activer manuellement dans le catalogue) ou écarter la suggestion.
 * Une zone "simulateur" permet de tester rapidement l'impact d'une remise donnée.
 */
@Component({
  selector: 'app-promotions-board',
  standalone: true,
  imports: [CommonModule, FormsModule, AnalyzeWithAiButtonComponent],
  template: `
    <section class="promotions-board">
      <div class="actions-row">
        @if (canManage()) {
          <button class="btn btn-secondary" (click)="generateNow()" [disabled]="generating()">
            <i class="pi pi-refresh"></i>
            {{ generating() ? loc_ui_tern_generation_ce4e34 : loc_ui_tern_regenerer_maintenant_94cff2 }}
          </button>
        }
        <div class="actions-ai">
          <app-analyze-with-ai-button
            screenId="forecasting-promotions"
            [payloadBuilder]="buildAiPayload"
            [disabled]="loading()" />
        </div>
      </div>

      @if (loading()) {
        <div class="state" i18n="@@forecasting.pages.chargement.01cba1df">Chargement…</div>
      } @else if (rows().length === 0) {
        <div class="state empty" i18n="@@forecasting.pages.aucune.recommandation.active.cliquez.sur.regener.3fdfe983">Aucune recommandation active. Cliquez sur « Régénérer maintenant ».</div>
      } @else {
        <div class="cards">
          @for (p of rows(); track p.id) {
            <article class="card type-{{ p.type }}">
              <header class="card-header">
                <span class="type">{{ typeLabel(p.type) }}</span>
                @if (p.relatedEventCode) { <span class="event">📅 {{ p.relatedEventCode }}</span> }
              </header>
              <h4>{{ p.productName ?? p.categoryName ?? '—' }}</h4>
              @if (p.productCode) { <p class="code">{{ p.productCode }}</p> }

              <div class="metrics">
                <div>
                  <span class="label" i18n="@@forecasting.pages.remise.suggeree.380e0d82">Remise suggérée</span>
                  <span class="value">{{ p.suggestedDiscountPercent | number:'1.0-1' }} %</span>
                </div>
                <div>
                  <span class="label" i18n="@@forecasting.pages.uplift.attendu.95c98ddd">Uplift attendu</span>
                  <span class="value">+{{ p.expectedUpliftPercent | number:'1.0-1' }} %</span>
                </div>
              </div>

              <p class="reasoning">{{ p.reasoningSummary }}</p>
              <p class="period">
                Validité : {{ p.validFrom | date:'dd/MM/yyyy' }} → {{ p.validUntil | date:'dd/MM/yyyy' }}
              </p>

              @if (canManage() && p.status === 'pending') {
                <footer class="card-footer">
                  <button class="btn btn-primary" (click)="prepareDraft(p)">
                    <i class="pi pi-tag"></i> Préparer la remise
                  </button>
                  <button class="btn btn-link" (click)="dismiss(p)" i18n="@@forecasting.pages.ecarter.0559f961">Écarter</button>
                </footer>
              } @else {
                <footer class="card-footer">
                  <span class="status status-{{ p.status }}">{{ statusLabel(p.status) }}</span>
                </footer>
              }
            </article>
          }
        </div>
      }

      <details class="simulator">
        <summary i18n="@@forecasting.pages.simulateur.d.impact.promotion.4a1648c6">Simulateur d'impact promotion</summary>
        <div class="sim-form">
          <label>
            <ng-container i18n="@@forecasting.pages.id.produit.guid.a0a67819"> ID produit (GUID) </ng-container>
            <input type="text" [(ngModel)]="simProductId" placeholder="00000000-0000-0000-0000-000000000000" i18n-placeholder="@@forecasting.pages.00000000.0000.0000.0000.000000000000.b602d594" />
          </label>
          <label>
            <ng-container i18n="@@forecasting.pages.remise.35bc2c9e"> Remise (%) </ng-container>
            <input type="number" min="0" max="90" [(ngModel)]="simDiscount" />
          </label>
          <label>
            <ng-container i18n="@@forecasting.pages.duree.jours.fa5bd0ae"> Durée (jours) </ng-container>
            <input type="number" min="1" max="90" [(ngModel)]="simDuration" />
          </label>
          <button class="btn btn-secondary" (click)="simulate()" [disabled]="!simProductId" i18n="@@forecasting.pages.simuler.4c4f5484">Simuler</button>
        </div>
        @if (simResult(); as r) {
          <div class="sim-result">
            <p><strong>{{ r.productName }}</strong> — élasticité approchée {{ r.approxElasticity }}</p>
            <ul>
              <li><ng-container i18n="@@forecasting.pages.ca.sans.promo.8d2ab7ef">CA sans promo : </ng-container> <b>{{ r.projectedRevenueWithoutPromo | number:'1.3-3' }} TND</b></li>
              <li><ng-container i18n="@@forecasting.pages.ca.avec.promo.09fcce53">CA avec promo : </ng-container> <b>{{ r.projectedRevenueWithPromo | number:'1.3-3' }} TND</b></li>
              <li><ng-container i18n="@@forecasting.pages.uplift.attendu.8d7fd4da">Uplift attendu : </ng-container> <b>+{{ r.expectedUpliftPercent | number:'1.0-1' }} %</b></li>
              <li><ng-container i18n="@@forecasting.pages.impact.marge.2ad62fb4">Impact marge : </ng-container> <b>{{ r.marginImpactPercent | number:'1.0-1' }} %</b></li>
            </ul>
            <p class="hint">{{ r.notes }}</p>
          </div>
        }
      </details>
    </section>
  `,
  styles: [`
    .promotions-board { display: block; }
    .actions-row { margin-bottom: 1rem; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
    .actions-ai { margin-left: auto; }
    @media (max-width: 768px) { .actions-ai { margin-left: 0; width: 100%; } }
    .state { padding: 1.25rem; color: var(--color-neutral-600, #6b7280); font-style: italic; }
    .state.empty { background: var(--color-neutral-50, #f9fafb); border: 1px dashed var(--color-neutral-300, #d1d5db); border-radius: 8px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
    .card { background: white; border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; }
    .card.type-destockage { border-left: 4px solid #f59e0b; }
    .card.type-surstock { border-left: 4px solid #ef4444; }
    .card.type-saisonnier { border-left: 4px solid #2563eb; }
    .card.type-crossSell { border-left: 4px solid #8b5cf6; }
    .card.type-prePic { border-left: 4px solid #10b981; }
    .card.type-margePush { border-left: 4px solid #14b8a6; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: .5rem; }
    .card-header .type { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--color-neutral-600, #6b7280); }
    .card-header .event { font-size: .75rem; color: var(--color-primary-700, #1e40af); }
    .card h4 { margin: 0 0 .25rem; font-size: 1.1rem; }
    .card .code { margin: 0 0 .75rem; font-family: monospace; font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
    .metrics { display: flex; gap: 1rem; margin-bottom: .75rem; }
    .metrics .label { display: block; font-size: .75rem; color: var(--color-neutral-600, #6b7280); }
    .metrics .value { display: block; font-weight: 600; font-size: 1.15rem; color: var(--color-neutral-900, #111827); }
    .reasoning { font-size: .9rem; color: var(--color-neutral-700, #374151); margin: 0 0 .5rem; }
    .period { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); margin: 0 0 .75rem; }
    .card-footer { margin-top: auto; display: flex; gap: .5rem; align-items: center; }
    .btn { padding: .45rem .85rem; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: .85rem; display: inline-flex; align-items: center; gap: .35rem; }
    .btn-secondary { background: white; border-color: var(--color-neutral-300, #d1d5db); color: var(--color-neutral-800, #1f2937); }
    .btn-primary { background: var(--color-primary-600, #2563eb); color: white; border-color: var(--color-primary-600, #2563eb); }
    .btn-link { background: transparent; color: var(--color-neutral-600, #6b7280); border: none; }
    .btn-link:hover { color: var(--color-danger-700, #b91c1c); text-decoration: underline; }
    .status { padding: .15rem .55rem; border-radius: 999px; font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-accepted { background: #d1fae5; color: #065f46; }
    .status-dismissed { background: #e5e7eb; color: #4b5563; }
    .status-activated { background: #dbeafe; color: #1e40af; }
    .status-expired { background: #fee2e2; color: #b91c1c; }
    .simulator { margin-top: 2rem; background: white; border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; padding: 1rem; }
    .simulator summary { cursor: pointer; font-weight: 600; }
    .sim-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .75rem; margin-top: 1rem; align-items: end; }
    .sim-form label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; color: var(--color-neutral-600, #6b7280); }
    .sim-form input { padding: .45rem .6rem; border-radius: 6px; border: 1px solid var(--color-neutral-300, #d1d5db); }
    .sim-result { margin-top: 1rem; padding: .85rem 1rem; background: var(--color-neutral-50, #f9fafb); border-radius: 6px; }
    .sim-result ul { padding-left: 1.5rem; margin: .25rem 0; }
    .hint { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
  `]
})
export class PromotionsBoardComponent implements OnInit {
  readonly loc_ui_tern_generation_ce4e34 = $localize`:@@ui.tern.generation.ce4e34:Génération…`;
  readonly loc_ui_tern_regenerer_maintenant_94cff2 = $localize`:@@ui.tern.regenerer.maintenant.94cff2:Régénérer maintenant`;
  private readonly forecastingService = inject(ForecastingService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  rows = signal<PromotionRecommendation[]>([]);
  loading = signal(false);
  generating = signal(false);

  simProductId = '';
  simDiscount = 15;
  simDuration = 7;
  simResult = signal<any | null>(null);

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
      const paged = await firstValueFrom(this.forecastingService.getPromotions({ pageSize: 100 }));
      this.rows.set(paged.items);
    } catch (err: any) {
      this.toast.add({ severity: 'error', summary: $localize`:@@promotions-board.component.summary.Erreur:Erreur`, detail: err?.error?.message ?? $localize`:@@ui.tern.chargement.echoue.a882c7:Chargement échoué.` });
    } finally {
      this.loading.set(false);
    }
  }

  async generateNow() {
    this.generating.set(true);
    try {
      const count = await firstValueFrom(this.forecastingService.generatePromotionsNow());
      this.toast.add({ severity: 'success', summary: $localize`:@@promotions-board.component.summary.R_g_n_ration_ter:Régénération terminée`, detail: `${count} recommandation(s).` });
      await this.load();
    } catch (err: any) {
      this.toast.add({ severity: 'error', summary: $localize`:@@promotions-board.component.summary.Échec:Échec`, detail: err?.error?.message ?? $localize`:@@ui.tern.erreur.inconnue.2f49e3:Erreur inconnue.` });
    } finally {
      this.generating.set(false);
    }
  }

  async prepareDraft(p: PromotionRecommendation) {
    try {
      const result = await firstValueFrom(this.forecastingService.prepareDiscountDraft(p.id));
      this.toast.add({
        severity: 'success',
        summary: $localize`:@@promotions-board.component.summary.Brouillon_pr_t:Brouillon prêt`,
        detail: `Remise ${result.suggestedDiscountPercent}% préparée du ${new Date(result.validFrom).toLocaleDateString('fr-FR')} au ${new Date(result.validUntil).toLocaleDateString('fr-FR')}. ${result.notes}`,
        life: 8000
      });
      await this.load();
    } catch (err: any) {
      this.toast.add({ severity: 'error', summary: $localize`:@@promotions-board.component.summary.Échec:Échec`, detail: err?.error?.message ?? $localize`:@@ui.tern.erreur.inconnue.2f49e3:Erreur inconnue.` });
    }
  }

  async dismiss(p: PromotionRecommendation) {
    try {
      await firstValueFrom(this.forecastingService.dismissPromotion(p.id));
      this.toast.add({ severity: 'info', summary: $localize`:@@promotions-board.component.summary.Écartée:Écartée`, detail: $localize`:@@promotions-board.component.detail.Recommandation_:Recommandation écartée.` });
      this.rows.set(this.rows().filter(x => x.id !== p.id));
    } catch (err: any) {
      this.toast.add({ severity: 'error', summary: $localize`:@@promotions-board.component.summary.Échec:Échec`, detail: err?.error?.message ?? $localize`:@@ui.tern.erreur.inconnue.2f49e3:Erreur inconnue.` });
    }
  }

  async simulate() {
    if (!this.simProductId) return;
    try {
      const r = await firstValueFrom(
        this.forecastingService.simulatePromotion(this.simProductId, this.simDiscount, this.simDuration)
      );
      this.simResult.set(r);
    } catch (err: any) {
      this.toast.add({ severity: 'error', summary: $localize`:@@promotions-board.component.summary.Simulation_impos:Simulation impossible`, detail: err?.error?.message ?? $localize`:@@ui.tern.erreur.inconnue.2f49e3:Erreur inconnue.` });
    }
  }

  typeLabel(t: PromotionRecommendationType): string {
    return ({
      destockage: 'Déstockage',
      surstock: 'Surstock',
      crossSell: 'Cross-Sell',
      prePic: 'Pré-pic',
      saisonnier: 'Saisonnier',
      margePush: 'Marge'
    } as Record<PromotionRecommendationType, string>)[t];
  }

  statusLabel(s: PromotionRecommendation['status']): string {
    return ({
      pending: 'En attente',
      accepted: 'Acceptée',
      dismissed: 'Écartée',
      activated: 'Activée',
      expired: 'Expirée'
    } as Record<PromotionRecommendation['status'], string>)[s];
  }

  readonly buildAiPayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      'forecasting-promotions',
      {
        screen: 'forecasting-promotions',
        totalRows: this.rows().length,
        promotions: this.rows().slice(0, 20).map(p => ({
          type: p.type,
          product: p.productName,
          category: p.categoryName,
          discountPercent: p.suggestedDiscountPercent,
          upliftPercent: p.expectedUpliftPercent,
          validFrom: p.validFrom,
          validUntil: p.validUntil,
          eventCode: p.relatedEventCode,
          reasoning: p.reasoningSummary,
          status: p.status
        }))
      } as Record<string, unknown>,
      { rowsKey: 'promotions', maxRows: 200 }
    );
}
