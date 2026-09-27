/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ChartCardComponent } from '@shared/components/dashboard/chart-card.component';
import { DashboardPanelComponent } from '@shared/components/dashboard/dashboard-panel.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { CashForecastService } from '../services/cash-forecast.service';
import { CashFlowForecast } from '../models/cash-forecast.models';
import { CashPositionGaugeComponent } from './components/cash-position-gauge.component';
import {
  bucketLabel,
  buildAnalyzePayload,
  drivers,
  formatAmount,
  formatCompactAmount,
  monthlyTotals,
  orderedAlerts,
  orderedScenarios,
  recommendations,
  scenarioLabel,
  severityTone,
  sourceLabel
} from './cash-forecast.view-model';

/**
 * Écran « Trésorerie prévisionnelle par IA ».
 *
 * Les chiffres viennent d'un moteur déterministe ; le modèle de langage ne pondère que les
 * probabilités des scénarios et rédige les analyses. L'écran l'assume visuellement : un badge
 * signale toute pondération, et la valeur déterministe reste consultable en infobulle.
 */
@Component({
  selector: 'app-cash-forecast',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ChartModule,
    TableModule,
    TagModule,
    PageHeaderComponent,
    StatCardComponent,
    ChartCardComponent,
    DashboardPanelComponent,
    EmptyStateComponent,
    CashPositionGaugeComponent,
    AnalyzeWithAiButtonComponent
  ],
  template: `
    <div class="cash-forecast">
      <app-page-header
        title="Trésorerie prévisionnelle par IA" i18n-title="@@treasury.cash-forecast.tresorerie.previsionnelle.par.ia.a595f345"
        subtitle="Prévisions basées sur vos échéances clients, dettes fournisseurs, paie et obligations fiscales">
        <div class="header-actions">
          <label class="horizon">
            <span i18n="@@treasury.cash-forecast.horizon.de.prevision.c1cfc9dd">Horizon de prévision</span>
            <select [ngModel]="horizonMonths()" (ngModelChange)="onHorizonChange($event)" [disabled]="loading()">
              <option [ngValue]="3" i18n="@@treasury.cash-forecast.3.mois.d07765c5">3 mois</option>
              <option [ngValue]="6" i18n="@@treasury.cash-forecast.6.mois.1242b310">6 mois</option>
              <option [ngValue]="9" i18n="@@treasury.cash-forecast.9.mois.aefb1a50">9 mois</option>
              <option [ngValue]="12" i18n="@@treasury.cash-forecast.12.mois.3cbeea57">12 mois</option>
            </select>
          </label>

          <app-analyze-with-ai-button
            screenId="treasury-cash-forecast"
            [payloadBuilder]="buildAiPayload"
            [disabled]="loading() || forecast() === null" />

          @if (canManage()) {
            <button
              type="button"
              class="btn btn-secondary"
              (click)="recompute()"
              [disabled]="recomputing() || loading()">
              <i class="pi pi-refresh" aria-hidden="true"></i>
              {{ recomputing() ? loc_ui_tern_recalcul_39088a : loc_ui_tern_rafraichir_les_previsions_6d1d32 }}
            </button>
          }
        </div>
      </app-page-header>

      @if (loading()) {
        <div class="state" aria-busy="true" i18n="@@treasury.cash-forecast.calcul.de.la.projection.en.cours.62d75b0e">Calcul de la projection en cours…</div>
      } @else if (moduleDisabled()) {
        <div class="state state--info" i18n="@@treasury.cash-forecast.le.module.tresorerie.previsionnelle.n.est.pas.ac.f894b1ab"> Le module Trésorerie prévisionnelle n'est pas activé pour cet espace.
          Contactez votre administrateur pour l'activer. </div>
      } @else if (errorMessage()) {
        <div class="state state--error">
          {{ errorMessage() }}
          <button type="button" class="btn btn-secondary" (click)="load()" i18n="@@treasury.cash-forecast.reessayer.895d416b">Réessayer</button>
        </div>
      } @else if (forecast()) {
        <!-- KPI -->
        <section class="kpi-row" aria-label="Indicateurs de trésorerie" i18n-aria-label="@@treasury.cash-forecast.indicateurs.de.tresorerie.2281ae22">
          <app-stat-card
            label="Solde de trésorerie" i18n-label="@@treasury.cash-forecast.solde.de.tresorerie.2eb9bf52"
            [value]="amount(data().openingBalance)"
            icon="pi-wallet"
            variant="primary" />
          <app-stat-card
            [label]="loc_ui_tern_solde_previsionnel_au_73c6a9 + (data().periodEnd | date: 'dd/MM/yyyy')"
            [value]="amount(data().closingBalance)"
            icon="pi-chart-line"
            [variant]="data().closingBalance < 0 ? 'error' : 'primary'" />
          <app-stat-card
            label="Encaissements prévus" i18n-label="@@treasury.cash-forecast.encaissements.prevus.4c99e461"
            [value]="amount(data().totalInflows)"
            icon="pi-arrow-down-left"
            variant="success" />
          <app-stat-card
            label="Décaissements prévus" i18n-label="@@treasury.cash-forecast.decaissements.prevus.4541219d"
            [value]="amount(data().totalOutflows)"
            icon="pi-arrow-up-right"
            variant="warning" />
          <app-stat-card
            label="Flux net prévisionnel" i18n-label="@@treasury.cash-forecast.flux.net.previsionnel.aea44606"
            [value]="amount(data().netFlow)"
            icon="pi-arrows-v"
            [variant]="data().netFlow < 0 ? 'error' : 'success'" />
          <app-stat-card
            label="Indice de confiance" i18n-label="@@treasury.cash-forecast.indice.de.confiance.0dfd5098"
            [value]="(data().confidencePercent | number: '1.0-0') + ' %'"
            icon="pi-sparkles"
            variant="primary" />
        </section>

        <div class="main-grid">
          <div class="main-grid__left">
            <app-chart-card
              title="Évolution de la trésorerie prévisionnelle" i18n-title="@@treasury.cash-forecast.evolution.de.la.tresorerie.previsionnelle.d0cdb430"
              subtitle="Solde de fin de mois et intervalle de prévision">
              <div chart-actions>
                <button
                  type="button"
                  class="toggle"
                  [class.toggle--active]="view() === 'chart'"
                  (click)="view.set('chart')">
                  <i class="pi pi-chart-line" aria-hidden="true"></i> Graphique
                </button>
                <button
                  type="button"
                  class="toggle"
                  [class.toggle--active]="view() === 'table'"
                  (click)="view.set('table')">
                  <i class="pi pi-table" aria-hidden="true"></i> Tableau
                </button>
              </div>

              @if (view() === 'chart') {
                <p-chart type="line" [data]="chartData()" [options]="chartOptions" [style]="{ height: '300px' }" />
              } @else {
                <p-table [value]="data().buckets" responsiveLayout="scroll" styleClass="p-datatable-sm">
                  <ng-template pTemplate="header">
                    <tr>
                      <th scope="col" i18n="@@treasury.cash-forecast.mois.0d304bea">Mois</th>
                      <th scope="col" class="num" i18n="@@treasury.cash-forecast.solde.initial.78a4e543">Solde initial</th>
                      <th scope="col" class="num" i18n="@@treasury.cash-forecast.encaissements.598f53c9">Encaissements</th>
                      <th scope="col" class="num" i18n="@@treasury.cash-forecast.decaissements.566a79f1">Décaissements</th>
                      <th scope="col" class="num" i18n="@@treasury.cash-forecast.flux.net.1fc309e5">Flux net</th>
                      <th scope="col" class="num" i18n="@@treasury.cash-forecast.solde.final.eafcc35f">Solde final</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-b>
                    <tr>
                      <td>{{ label(b) }}</td>
                      <td class="num">{{ amount(b.openingBalance) }}</td>
                      <td class="num pos">{{ amount(b.inflows) }}</td>
                      <td class="num neg">{{ amount(b.outflows) }}</td>
                      <td class="num" [class.neg]="b.netFlow < 0" [class.pos]="b.netFlow >= 0">
                        {{ amount(b.netFlow) }}
                      </td>
                      <td class="num" [class.neg]="b.closingBalance < 0">{{ amount(b.closingBalance) }}</td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="footer">
                    <tr class="totals">
                      <td i18n="@@treasury.cash-forecast.total.b25928c6">Total</td>
                      <td class="num" i18n="@@treasury.cash-forecast.text.1b93795b">—</td>
                      <td class="num pos">{{ amount(totals().inflows) }}</td>
                      <td class="num neg">{{ amount(totals().outflows) }}</td>
                      <td class="num" [class.neg]="totals().netFlow < 0">{{ amount(totals().netFlow) }}</td>
                      <td class="num" [class.neg]="data().closingBalance < 0">{{ amount(data().closingBalance) }}</td>
                    </tr>
                  </ng-template>
                </p-table>
              }
            </app-chart-card>

            <app-dashboard-panel
              title="Scénarios de prévision" i18n-title="@@treasury.cash-forecast.scenarios.de.prevision.e330353d"
              [subtitle]="data().aiAdjustmentApplied
                ? loc_ui_tern_probabilites_ponderees_par_l_ia_autour_des_42688a
                : loc_ui_tern_probabilites_issues_du_moteur_deterministe_9e9fa3">
              <div class="scenarios">
                @for (s of scenarios(); track s.kind) {
                  <article class="scenario" [class]="'scenario--' + s.kind">
                    <header>
                      <h4>{{ scenarioName(s.kind) }}</h4>
                      @if (s.probabilitySource === 'ai_adjusted') {
                        <span
                          class="ai-badge"
                          [title]="loc_ui_tern_valeur_du_moteur_16e0b3 + s.deterministicProbabilityPercent + ' %'">
                          <i class="pi pi-sparkles" aria-hidden="true"></i> IA
                        </span>
                      }
                    </header>
                    <dl>
                      <dt i18n="@@treasury.cash-forecast.solde.final.eafcc35f">Solde final</dt>
                      <dd class="scenario__value" [class.neg]="s.closingBalance < 0">
                        {{ amount(s.closingBalance) }}
                      </dd>
                      <dt i18n="@@treasury.cash-forecast.flux.net.1fc309e5">Flux net</dt>
                      <dd [class.neg]="s.netFlow < 0">{{ amount(s.netFlow) }}</dd>
                      <dt i18n="@@treasury.cash-forecast.probabilite.b46293be">Probabilité</dt>
                      <dd>{{ s.probabilityPercent | number: '1.0-0' }} %</dd>
                    </dl>
                    @if (s.aiRationale) {
                      <p class="scenario__rationale">{{ s.aiRationale }}</p>
                    }
                  </article>
                }
              </div>
            </app-dashboard-panel>

            <app-dashboard-panel
              title="Facteurs d'influence détectés" i18n-title="@@treasury.cash-forecast.facteurs.d.influence.detectes.c5abdb89"
              subtitle="Structure des flux de la période">
              @if (influenceFactors().length === 0) {
                <p class="muted" i18n="@@treasury.cash-forecast.aucun.facteur.marquant.sur.la.periode.d70a6e1f">Aucun facteur marquant sur la période.</p>
              } @else {
                <ul class="drivers">
                  @for (d of influenceFactors(); track d.title) {
                    <li>
                      <div class="drivers__label">
                        <i
                          class="pi"
                          [class.pi-arrow-up-right]="d.impactDirection === 'inflow'"
                          [class.pi-arrow-down-right]="d.impactDirection !== 'inflow'"
                          aria-hidden="true"></i>
                        <div>
                          <strong>{{ d.title }}</strong>
                          @if (d.detail) { <span class="muted">{{ d.detail }}</span> }
                        </div>
                      </div>
                      <p-tag
                        [value]="impactLabel(d.impact)"
                        [severity]="d.impact === 'high' ? 'danger' : d.impact === 'medium' ? 'warn' : 'info'" />
                    </li>
                  }
                </ul>
              }
            </app-dashboard-panel>
          </div>

          <aside class="main-grid__right">
            <app-dashboard-panel title="Position de trésorerie" i18n-title="@@treasury.cash-forecast.position.de.tresorerie.c8a0928a" subtitle="Solde projeté en fin d'horizon">
              <app-cash-position-gauge
                [balance]="data().closingBalance"
                [thresholds]="data().thresholds"
                [currency]="data().currency" />
            </app-dashboard-panel>

            <app-dashboard-panel title="Alertes & recommandations" i18n-title="@@treasury.cash-forecast.alertes.recommandations.d9eac212">
              @if (alerts().length === 0 && advice().length === 0) {
                <p class="muted" i18n="@@treasury.cash-forecast.aucune.tension.detectee.sur.la.periode.240256f7">Aucune tension détectée sur la période.</p>
              } @else {
                <ul class="alerts">
                  @for (a of alerts(); track a.title) {
                    <li [class]="loc_ui_tern_alerts_item_alerts_item_73da9b + a.severity">
                      <div>
                        <strong>{{ a.title }}</strong>
                        @if (a.detail) { <p class="muted">{{ a.detail }}</p> }
                        @if (a.estimatedBalance !== null && a.estimatedBalance !== undefined) {
                          <p class="muted">Solde estimé : {{ amount(a.estimatedBalance) }}</p>
                        }
                      </div>
                      <p-tag [value]="severityLabel(a.severity)" [severity]="tone(a.severity)" />
                    </li>
                  }
                  @for (r of advice(); track r.title) {
                    <li class="alerts__item alerts__item--info">
                      <div>
                        <strong>{{ r.title }}</strong>
                        @if (r.detail) { <p class="muted">{{ r.detail }}</p> }
                      </div>
                      <p-tag value="Conseil" severity="info" />
                    </li>
                  }
                </ul>
              }
            </app-dashboard-panel>

            <app-dashboard-panel title="Encaissements à venir" i18n-title="@@treasury.cash-forecast.encaissements.a.venir.71835f34" subtitle="Les cinq plus proches">
              @if (data().upcomingInflows.length === 0) {
                <p class="muted" i18n="@@treasury.cash-forecast.aucun.encaissement.attendu.sur.la.periode.49910747">Aucun encaissement attendu sur la période.</p>
              } @else {
                <table class="upcoming">
                  <thead>
                    <tr>
                      <th scope="col" i18n="@@treasury.cash-forecast.echeance.f9a77ff6">Échéance</th>
                      <th scope="col" i18n="@@treasury.cash-forecast.tiers.435080ba">Tiers</th>
                      <th scope="col" class="num" i18n="@@treasury.cash-forecast.montant.4adcd9fc">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (line of data().upcomingInflows; track line.id) {
                      <tr>
                        <td>{{ line.expectedDate | date: 'dd/MM/yyyy' }}</td>
                        <td>
                          <span class="upcoming__party">{{ line.thirdPartyName || line.label }}</span>
                          <span class="muted">{{ source(line.sourceType) }}</span>
                        </td>
                        <td class="num">{{ amount(line.amount) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </app-dashboard-panel>

            <app-dashboard-panel title="Actions rapides" i18n-title="@@treasury.cash-forecast.actions.rapides.abe69a9c">
              <div class="quick-actions">
                <button type="button" class="quick" (click)="goToBankImport()">
                  <i class="pi pi-upload" aria-hidden="true"></i>
                  <span>
                    <strong i18n="@@treasury.cash-forecast.importer.un.releve.bancaire.6e7ea0df">Importer un relevé bancaire</strong>
                    <em i18n="@@treasury.cash-forecast.actualiser.le.solde.de.depart.f44f6005">Actualiser le solde de départ</em>
                  </span>
                </button>
                @if (canManage()) {
                  <button type="button" class="quick" (click)="recompute()" [disabled]="recomputing()">
                    <i class="pi pi-refresh" aria-hidden="true"></i>
                    <span>
                      <strong i18n="@@treasury.cash-forecast.rafraichir.les.previsions.6d1d3299">Rafraîchir les prévisions</strong>
                      <em i18n="@@treasury.cash-forecast.relancer.le.calcul.da88bd57">Relancer le calcul</em>
                    </span>
                  </button>
                }
                <button type="button" class="quick" (click)="exportCsv()">
                  <i class="pi pi-download" aria-hidden="true"></i>
                  <span>
                    <strong i18n="@@treasury.cash-forecast.exporter.le.rapport.42ceb35a">Exporter le rapport</strong>
                    <em i18n="@@treasury.cash-forecast.csv.des.flux.attendus.ce934820">CSV des flux attendus</em>
                  </span>
                </button>
              </div>
            </app-dashboard-panel>

            <p class="computed-at">
              <ng-container i18n="@@treasury.cash-forecast.calcule.le.date.heure"> Calculé le {{ data().computedAt | date: 'dd/MM/yyyy' }} à {{ data().computedAt | date: 'HH:mm' }} </ng-container>
              @if (data().aiAdjustmentApplied) { · pondéré par l'IA }
            </p>
          </aside>
        </div>
      } @else {
        <app-empty-state
          icon="pi-chart-line"
          title="Aucune projection disponible" i18n-title="@@treasury.cash-forecast.aucune.projection.disponible.3517bf5c"
          description="Lancez un premier calcul pour obtenir votre trésorerie prévisionnelle."
          [showAction]="canManage()"
          actionLabel="Calculer la prévision"
          (actionClick)="recompute()" />
      }
    </div>
  `,
  styles: [`
    .cash-forecast { padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
    .header-actions { display: flex; align-items: flex-end; gap: .75rem; flex-wrap: wrap; }
    .horizon { display: flex; flex-direction: column; gap: .25rem; font-size: .75rem; color: var(--color-text-secondary, #64748b); }
    .horizon select { padding: .45rem .6rem; border: 1px solid var(--color-border-subtle, #e2e8f0); border-radius: 6px; font-size: .875rem; }

    .state { padding: 2rem; text-align: center; color: var(--color-text-secondary, #64748b); background: #fff; border-radius: 8px; }
    .state--error { color: #b91c1c; display: flex; flex-direction: column; align-items: center; gap: .75rem; }
    .state--info { color: #1e40af; background: #eff6ff; }

    .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1rem; }

    .main-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 1rem; align-items: start; }
    .main-grid__left, .main-grid__right { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
    @media (max-width: 1200px) { .main-grid { grid-template-columns: 1fr; } }

    .toggle { border: 1px solid var(--color-border-subtle, #e2e8f0); background: #fff; border-radius: 6px; padding: .3rem .65rem; font-size: .8rem; cursor: pointer; display: inline-flex; align-items: center; gap: .35rem; }
    .toggle--active { background: var(--superieur-primary, #3862f5); border-color: var(--superieur-primary, #3862f5); color: #fff; }

    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pos { color: #047857; }
    .neg { color: #b91c1c; }
    .totals { font-weight: 600; background: var(--color-surface-muted, #f8fafc); }
    .muted { color: var(--color-text-secondary, #64748b); font-size: .8rem; margin: .15rem 0 0; display: block; }

    .scenarios { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; }
    @media (max-width: 900px) { .scenarios { grid-template-columns: 1fr; } }
    .scenario { border: 1px solid var(--color-border-subtle, #e2e8f0); border-radius: 8px; padding: .85rem; }
    .scenario--optimistic { border-left: 3px solid #10b981; }
    .scenario--realistic { border-left: 3px solid #3862f5; }
    .scenario--pessimistic { border-left: 3px solid #ef4444; }
    .scenario header { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
    .scenario h4 { margin: 0 0 .5rem; font-size: .9rem; font-weight: 600; }
    .scenario dl { display: grid; grid-template-columns: 1fr auto; gap: .2rem .5rem; margin: 0; font-size: .8rem; }
    .scenario dt { color: var(--color-text-secondary, #64748b); }
    .scenario dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
    .scenario__value { font-size: .95rem; }
    .scenario__rationale { margin: .5rem 0 0; font-size: .75rem; font-style: italic; color: var(--color-text-secondary, #64748b); }
    .ai-badge { font-size: .65rem; font-weight: 600; background: #ede9fe; color: #6d28d9; padding: .1rem .4rem; border-radius: 999px; white-space: nowrap; }

    .drivers, .alerts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .6rem; }
    .drivers li, .alerts__item { display: flex; justify-content: space-between; align-items: flex-start; gap: .75rem; }
    .drivers__label { display: flex; gap: .5rem; align-items: flex-start; }
    .drivers__label i { color: var(--color-text-tertiary, #94a3b8); margin-top: .15rem; }
    .alerts__item { border-left: 3px solid transparent; padding-left: .6rem; }
    .alerts__item--critical { border-left-color: #ef4444; }
    .alerts__item--warning { border-left-color: #f59e0b; }
    .alerts__item--info { border-left-color: #3862f5; }
    .alerts__item p { margin: .15rem 0 0; }

    .upcoming { width: 100%; border-collapse: collapse; font-size: .8rem; }
    .upcoming th { text-align: left; font-weight: 600; color: var(--color-text-secondary, #64748b); padding: .3rem 0; border-bottom: 1px solid var(--color-border-subtle, #e2e8f0); }
    .upcoming td { padding: .45rem 0; border-bottom: 1px solid var(--color-border-subtle, #f1f5f9); vertical-align: top; }
    .upcoming__party { display: block; font-weight: 500; }

    .quick-actions { display: grid; grid-template-columns: 1fr; gap: .5rem; }
    .quick { display: flex; align-items: center; gap: .6rem; text-align: left; background: #fff; border: 1px solid var(--color-border-subtle, #e2e8f0); border-radius: 8px; padding: .6rem .75rem; cursor: pointer; }
    .quick:hover:not(:disabled) { background: var(--color-surface-muted, #f8fafc); }
    .quick:disabled { opacity: .5; cursor: not-allowed; }
    .quick i { color: var(--superieur-primary, #3862f5); }
    .quick strong { display: block; font-size: .82rem; }
    .quick em { font-style: normal; font-size: .72rem; color: var(--color-text-secondary, #64748b); }

    .computed-at { font-size: .72rem; color: var(--color-text-tertiary, #94a3b8); text-align: right; margin: 0; }

    .btn { padding: .5rem .9rem; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: .875rem; display: inline-flex; align-items: center; gap: .4rem; }
    .btn-secondary { background: #fff; border-color: var(--color-border-subtle, #e2e8f0); color: var(--color-text-primary, #0f172a); }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
  `]
})
export class CashForecastComponent implements OnInit {
  readonly loc_ui_tern_recalcul_39088a = $localize`:@@ui.tern.recalcul.39088a:Recalcul…`;
  readonly loc_ui_tern_rafraichir_les_previsions_6d1d32 = $localize`:@@ui.tern.rafraichir.les.previsions.6d1d32:Rafraîchir les prévisions`;
  readonly loc_ui_tern_solde_previsionnel_au_73c6a9 = $localize`:@@ui.tern.solde.previsionnel.au.73c6a9:Solde prévisionnel au `;
  readonly loc_ui_tern_probabilites_ponderees_par_l_ia_autour_des_42688a = $localize`:@@ui.tern.probabilites.ponderees.par.l.ia.autour.des.42688a:Probabilités pondérées par l’IA autour des valeurs du moteur`;
  readonly loc_ui_tern_probabilites_issues_du_moteur_deterministe_9e9fa3 = $localize`:@@ui.tern.probabilites.issues.du.moteur.deterministe.9e9fa3:Probabilités issues du moteur déterministe`;
  readonly loc_ui_tern_valeur_du_moteur_16e0b3 = $localize`:@@ui.tern.valeur.du.moteur.16e0b3:Valeur du moteur : `;
  readonly loc_ui_tern_alerts_item_alerts_item_73da9b = "alerts__item alerts__item--";
  private readonly service = inject(CashForecastService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly recomputing = signal(false);
  readonly forecast = signal<CashFlowForecast | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly moduleDisabled = signal(false);
  readonly horizonMonths = signal(6);
  readonly view = signal<'chart' | 'table'>('chart');

  /** Projection courante, non nulle par construction dans la branche qui l'affiche. */
  readonly data = computed(() => this.forecast()!);

  readonly scenarios = computed(() => orderedScenarios(this.forecast()));
  readonly alerts = computed(() => orderedAlerts(this.forecast()));
  readonly influenceFactors = computed(() => drivers(this.forecast()));
  readonly advice = computed(() => recommendations(this.forecast()));
  readonly totals = computed(() => monthlyTotals(this.forecast()?.buckets ?? []));

  readonly chartData = computed(() => {
    const buckets = this.forecast()?.buckets ?? [];
    return {
      labels: buckets.map(bucketLabel),
      datasets: [
        {
          label: 'Solde prévisionnel',
          data: buckets.map(b => b.closingBalance),
          borderColor: '#3862f5',
          backgroundColor: 'rgba(56, 98, 245, 0.08)',
          fill: true,
          tension: 0.35
        },
        {
          label: 'Prévision basse',
          data: buckets.map(b => b.lowClosingBalance),
          borderColor: '#ef4444',
          borderDash: [5, 4],
          fill: false,
          pointRadius: 0,
          tension: 0.35
        },
        {
          label: 'Prévision haute',
          data: buckets.map(b => b.highClosingBalance),
          borderColor: '#10b981',
          borderDash: [5, 4],
          fill: false,
          pointRadius: 0,
          tension: 0.35
        }
      ]
    };
  });

  readonly chartOptions = {
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
            `${ctx.dataset.label} : ${formatAmount(ctx.parsed.y, this.forecast()?.currency ?? $localize`:@@ui.tern.tnd.51da21:TND`)}`
        }
      }
    },
    scales: {
      y: { ticks: { callback: (value: number | string) => formatCompactAmount(Number(value)) } }
    }
  };

  /** Passé au bouton « Analyser avec l'IA » — doit rester une propriété, pas une méthode. */
  readonly buildAiPayload = (): unknown => buildAnalyzePayload(this.forecast());

  ngOnInit(): void {
    this.load();
  }

  canManage(): boolean {
    return this.auth.hasAllPermissions([PERMISSIONS.treasuryForecast.manage]);
  }

  onHorizonChange(value: number): void {
    this.horizonMonths.set(value);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.service.getForecast(this.horizonMonths()).subscribe({
      next: data => {
        this.forecast.set(data);
        this.moduleDisabled.set(false);
        this.loading.set(false);
      },
      error: err => {
        // 503 = module éteint côté API : ce n'est pas une panne, l'écran l'explique posément.
        if (err?.status === 503) {
          this.moduleDisabled.set(true);
        } else {
          this.errorMessage.set(
            err?.error?.message ?? $localize`:@@ui.tern.impossible.de.charger.la.tresorerie.previs.acb3d6:Impossible de charger la trésorerie prévisionnelle.`
          );
        }
        this.loading.set(false);
      }
    });
  }

  recompute(): void {
    if (this.recomputing()) return;
    this.recomputing.set(true);

    this.service.recompute(this.horizonMonths()).subscribe({
      next: data => {
        this.forecast.set(data);
        this.recomputing.set(false);
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@cash-forecast.component.summary.Projection_recal:Projection recalculée`,
          detail: `Solde prévisionnel : ${this.amount(data.closingBalance)}`
        });
      },
      error: err => {
        this.recomputing.set(false);
        // Le 429 est déjà présenté par le dialogue global de limitation de débit.
        if (err?.status === 429) return;
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@cash-forecast.component.summary.Recalcul imp:Recalcul impossible`,
          detail: err?.error?.message ?? $localize`:@@ui.tern.erreur.inconnue.c3ec73:Erreur inconnue`
        });
      }
    });
  }

  exportCsv(): void {
    const run = this.forecast();
    if (!run) return;

    this.service.exportCsv(run.runId).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tresorerie-previsionnelle-${run.periodStart}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: () =>
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@cash-forecast.component.summary.Export impos:Export impossible`,
          detail: $localize`:@@cash-forecast.component.detail.Le_fichier_n_a_p:Le fichier n’a pas pu être généré.`
        })
    });
  }

  /**
   * Le produit ne dispose d'aucune synchronisation bancaire automatique : l'action honnête est
   * d'emmener l'utilisateur vers l'import de relevé, qui existe.
   */
  goToBankImport(): void {
    this.router.navigate(['/accounting/bank-reconciliation']);
  }

  amount(value: number | null | undefined): string {
    return formatAmount(value, this.forecast()?.currency ?? $localize`:@@ui.tern.tnd.51da21:TND`);
  }

  label = bucketLabel;
  scenarioName = scenarioLabel;
  tone = severityTone;
  source = sourceLabel;

  severityLabel(severity: string): string {
    switch (severity) {
      case 'critical':
        return 'Critique';
      case 'warning':
        return 'Alerte';
      default:
        return 'Info';
    }
  }

  impactLabel(impact: string | null | undefined): string {
    switch (impact) {
      case 'high':
        return 'Impact élevé';
      case 'medium':
        return 'Impact moyen';
      default:
        return 'Impact faible';
    }
  }
}
