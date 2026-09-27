/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { ForecastingService } from '../../services/forecasting.service';
import { RecomputeAudit } from '../../models/forecasting.models';
import { firstValueFrom } from 'rxjs';

/**
 * Hub de navigation du module Prévisions IA.
 * Tabs vers : Prévision CA, Réapprovisionnement, Promotions, ABC/XYZ, Trésorerie.
 * Bouton "Recalculer tout" — déclenche IForecastRecomputeOrchestrator (limité à
 * MaxRecomputeRunsPerDay côté backend, gestion d'erreur 429 ici).
 * Bouton "Analyser avec l'IA" — ouvre l'assistant existant avec le contexte courant.
 */
@Component({
  selector: 'app-forecasting-hub',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="forecasting-hub">
      <header class="hub-header">
        <div class="title-block">
          <h1 i18n="@@forecasting.pages.previsions.ia.ventes.amp.stock.f8e5b6be">Prévisions IA — Ventes & Stock</h1>
          <p class="subtitle" i18n="@@forecasting.pages.module.deterministe.base.sur.votre.historique.et.704b8e0e"> Module déterministe basé sur votre historique et le calendrier commercial tunisien
            (Ramadan, Aïd, Soldes, Rentrée…). Aucune valeur n'est inventée par l'IA. </p>
        </div>
        <div class="hub-actions">
          @if (canManage()) {
            <button class="btn btn-secondary" (click)="recomputeAll()" [disabled]="isRecomputing()">
              <i class="pi pi-refresh"></i>
              {{ isRecomputing() ? loc_ui_tern_recalcul_39088a : loc_ui_tern_recalculer_tout_c512c8 }}
            </button>
          }
        </div>
      </header>

      <nav class="tabs" role="tablist"><ng-container i18n="@@forecasting.pages.prevision.ca.reapprovisionnement.promoti.71a1b88c">
        <a routerLink="revenue" routerLinkActive="active" role="tab">
          <i class="pi pi-chart-line"></i> Prévision CA
        </a>
        <a routerLink="replenishment" routerLinkActive="active" role="tab">
          <i class="pi pi-shopping-cart"></i> Réapprovisionnement
        </a>
        <a routerLink="promotions" routerLinkActive="active" role="tab">
          <i class="pi pi-tag"></i> Promotions
        </a>
        <a routerLink="abc-xyz" routerLinkActive="active" role="tab">
          <i class="pi pi-th-large"></i> ABC / XYZ
        </a>
        </ng-container>@if (canViewTreasuryForecast()) {
          <a routerLink="treasury" routerLinkActive="active" role="tab" i18n="@@forecasting.pages.tresorerie.c2aca9f4">
            <i class="pi pi-wallet"></i> Trésorerie
          </a>
        }
      </nav>

      @if (audit(); as a) {
        <div class="audit-bar" [class.audit-error]="!a.success"><ng-container i18n="@@forecasting.pages.dernier.calcul.s.classif.reappros.promos.f7f068fe">
          <i class="pi" [class.pi-check-circle]="a.success" [class.pi-exclamation-circle]="!a.success"></i>
          <span>Dernier calcul : {{ a.startedAt | date:'dd/MM/yyyy HH:mm' }}</span>
          <span class="audit-sep">·</span>
          <span>{{ (a.durationMs / 1000).toFixed(1) }}s</span>
          <span class="audit-sep">·</span>
          <span>{{ a.classificationsUpdated }} classif.</span>
          <span class="audit-sep">·</span>
          <span>{{ a.replenishmentsGenerated }} réappros</span>
          <span class="audit-sep">·</span>
          <span>{{ a.promotionsGenerated }} promos</span>
          <span class="audit-sep">·</span>
          <span>{{ a.triggerType === 'manual' ? loc_ui_tern_manuel_6c1cc0 : loc_ui_tern_automatique_f8a3c3 }}</span>
          </ng-container>@if (!a.success && a.errorMessage) {
            <span class="audit-sep" i18n="@@forecasting.pages.text.1fdf0d90">·</span>
            <span class="audit-err-msg">{{ a.errorMessage }}</span>
          }
        </div>
      }

      <main class="hub-content">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .forecasting-hub { padding: 1.5rem; max-width: 1400px; margin: 0 auto; }
    .hub-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 2rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .title-block h1 { margin: 0 0 .35rem; font-size: 1.75rem; font-weight: 600; }
    .title-block .subtitle { margin: 0; color: var(--color-neutral-600, #6b7280); font-size: .95rem; max-width: 760px; }
    .hub-actions { display: flex; gap: .5rem; flex-shrink: 0; }
    .tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); margin-bottom: .75rem; flex-wrap: wrap; }
    .tabs a { padding: .75rem 1rem; color: var(--color-neutral-700, #374151); text-decoration: none; border-bottom: 2px solid transparent; font-weight: 500; display: inline-flex; align-items: center; gap: .5rem; transition: color .15s, border-color .15s; }
    .tabs a:hover { color: var(--color-primary-700, #1e40af); }
    .tabs a.active { color: var(--color-primary-700, #1e40af); border-bottom-color: var(--color-primary-600, #2563eb); }
    .audit-bar { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; padding: .45rem .85rem; background: var(--color-neutral-50, #f9fafb); border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 6px; font-size: .8rem; color: var(--color-neutral-600, #6b7280); margin-bottom: 1.25rem; }
    .audit-bar i { color: var(--color-success-600, #059669); }
    .audit-bar.audit-error { background: #fff1f2; border-color: #fecdd3; }
    .audit-bar.audit-error i { color: var(--color-danger-600, #dc2626); }
    .audit-sep { color: var(--color-neutral-300, #d1d5db); }
    .audit-err-msg { color: var(--color-danger-700, #b91c1c); font-style: italic; }
    .hub-content { min-height: 400px; }
    .btn { padding: .55rem 1rem; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: .95rem; display: inline-flex; align-items: center; gap: .5rem; }
    .btn-secondary { background: white; border-color: var(--color-neutral-300, #d1d5db); color: var(--color-neutral-800, #1f2937); }
    .btn-secondary:hover:not(:disabled) { background: var(--color-neutral-50, #f9fafb); }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
  `]
})
export class ForecastingHubComponent implements OnInit {
  readonly loc_ui_tern_recalcul_39088a = $localize`:@@ui.tern.recalcul.39088a:Recalcul…`;
  readonly loc_ui_tern_recalculer_tout_c512c8 = $localize`:@@ui.tern.recalculer.tout.c512c8:Recalculer tout`;
  readonly loc_ui_tern_manuel_6c1cc0 = $localize`:@@ui.tern.manuel.6c1cc0:Manuel`;
  readonly loc_ui_tern_automatique_f8a3c3 = $localize`:@@ui.tern.automatique.f8a3c3:Automatique`;
  private readonly forecastingService = inject(ForecastingService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly isRecomputing = signal(false);
  readonly audit = signal<RecomputeAudit | null>(null);

  canManage(): boolean {
    return this.auth.hasAllPermissions(['forecasting:manage']);
  }

  /**
   * L'onglet Trésorerie porte sa propre permission : elle est distincte de `forecasting:view`,
   * que le rôle Comptable ne possède pas.
   */
  canViewTreasuryForecast(): boolean {
    return this.auth.hasAllPermissions(['treasury_forecast:view']);
  }

  ngOnInit(): void {
    this.loadAudit();
  }

  async loadAudit() {
    try {
      const a = await firstValueFrom(this.forecastingService.getRecomputeAudit());
      this.audit.set(a);
    } catch {
      // audit is informational only — silently ignore errors
    }
  }

  async recomputeAll() {
    if (this.isRecomputing()) return;
    this.isRecomputing.set(true);
    try {
      const result = await firstValueFrom(this.forecastingService.recomputeAll());
      if (result.success) {
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@forecasting-hub.component.summary.Recalcul_termin_:Recalcul terminé`,
          detail:
            `${(result.durationMs / 1000).toFixed(1)}s — ` +
            $localize`:@@forecasting.forecasting-hub.ts.classificationsupdated.classifications.be67c722:${result.classificationsUpdated}:classificationsUpdated: classifications, ` +
            $localize`:@@forecasting.forecasting-hub.ts.replenishmentsgenerated.reappros.promoti.e8a44b9a:${result.replenishmentsGenerated}:replenishmentsGenerated: réappros, ${result.promotionsGenerated}:promotionsGenerated: promos.`
        });
        this.forecastingService.notifyRecomputeCompleted();
        await this.loadAudit();
      } else {
        this.toast.add({ severity: 'error', summary: $localize`:@@forecasting-hub.component.summary.Recalcul éch:Recalcul échoué`, detail: result.errorMessage ?? $localize`:@@ui.tern.erreur.inconnue.c3ec73:Erreur inconnue` });
        await this.loadAudit();
      }
    } catch (err: any) {
      // 429 already shown as a modal dialog by HttpRateLimitDialogService — avoid duplicate UI.
      if (err?.status !== 429) {
        const msg = err?.error?.message ?? $localize`:@@ui.tern.erreur.inconnue.c3ec73:Erreur inconnue`;
        this.toast.add({ severity: 'error', summary: $localize`:@@forecasting-hub.component.summary.Recalcul imp:Recalcul impossible`, detail: msg });
      }
    } finally {
      this.isRecomputing.set(false);
    }
  }
}
