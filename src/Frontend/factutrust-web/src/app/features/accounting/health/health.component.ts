import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, AccountingHealthReportDto, PreClosingCheckDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Centre de contrôle d'intégrité comptable — LECTURE SEULE. Diagnostics à la demande hors clôture :
 * contrôles de pré-clôture partagés (par exercice) + anomalies structurelles (comptes hors plan,
 * écritures hors période, doublons de pièce, tiers mal rattachés). Aucune action corrective.
 */
@Component({
  selector: 'app-accounting-health',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    ButtonComponent
  ],
  template: `
    <app-page-header
      title="Contrôle d'intégrité" i18n-title="Contrôle d'intégrité"
      subtitle="Diagnostics comptables en lecture seule — aucune modification des données" />

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Portée du diagnostic">
        <div accountingFilterFields class="hc-toolbar-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="hc-scope" i18n="@@accounting.health.portee.f42a1d5d">Portée</label>
            <select id="hc-scope" [(ngModel)]="scope" class="accounting-filter-input">
              <option value="year" i18n="@@accounting.health.exercice.e171e2b0">Exercice</option>
              <option value="all" i18n="@@accounting.health.tout.l.historique.058b1093">Tout l'historique</option>
            </select>
          </div>
          @if (scope === 'year') {
            <div class="accounting-filter-field">
              <label class="accounting-filter-label" for="hc-year" i18n="@@accounting.health.exercice.e171e2b0">Exercice</label>
              <input id="hc-year" type="number" min="2000" max="2100" [(ngModel)]="fiscalYear" class="accounting-filter-input" />
            </div>
          }
        </div>
        <div accountingFilterActions>
          <app-button
            variant="secondary"
            icon="pi pi-refresh"
            iconPos="left"
            type="button"
            (click)="run()"
            [disabled]="loading()"
            ariaLabel="Lancer les contrôles d'intégrité" i18n="@@accounting.health.lancer.les.controles.521d27dd"> Lancer les contrôles </app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" (retry)="run()" />

    @if (report(); as rep) {
      <div class="hc-summary" [class.hc-summary--anomaly]="rep.hasAnomalies" [class.hc-summary--ok]="!rep.hasAnomalies" role="status">
        <i class="pi" [class.pi-exclamation-triangle]="rep.hasAnomalies" [class.pi-check-circle]="!rep.hasAnomalies" aria-hidden="true"></i>
        <span>
          @if (rep.hasAnomalies) {
            {{ anomalyCount() }} contrôle(s) signalent des anomalies à examiner. Ce centre est en lecture seule : corrigez depuis les écrans liés.
          } @else {
            {{ noAnomalyMessage(rep.fiscalYear) }}
          }
        </span>
      </div>

      <p-table [value]="rep.checks" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th style="width:9rem" i18n="@@accounting.health.severite.62fd4ae5">Sévérité</th>
            <th i18n="@@accounting.health.controle.e988877e">Contrôle</th>
            <th style="width:6rem" class="text-right" i18n="@@accounting.health.nombre.e68491e9">Nombre</th>
            <th i18n="@@accounting.health.detail.7ce06afc">Détail</th>
            <th style="width:7rem" i18n="@@accounting.health.action.97c89a4d">Action</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [class.hc-row-anomaly]="c.count > 0">
            <td><span class="hc-badge" [ngClass]="severityClass(c)">{{ severityLabel(c) }}</span></td>
            <td>{{ c.title }}</td>
            <td class="text-right hc-num" [class.hc-count-nonzero]="c.count > 0">{{ c.count }}</td>
            <td class="hc-message">{{ c.message }}</td>
            <td>
              @if (c.deepLinkRoute && c.count > 0) {
                <a class="hc-link" [routerLink]="c.deepLinkRoute"><ng-container i18n="@@accounting.health.voir.8a754f1f">Voir </ng-container> <i class="pi pi-angle-right" aria-hidden="true"></i></a>
              }
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="5" style="text-align:center;padding:2rem" i18n="@@accounting.health.lancez.les.controles.d0416477">Lancez les contrôles.</td></tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: `
    @use '../shared/accounting-layout';
    .hc-toolbar-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .text-right { text-align:right; }
    .hc-num { font-variant-numeric:tabular-nums; }
    .hc-count-nonzero { font-weight:var(--font-weight-bold); }
    .hc-message { color:var(--color-text-secondary); font-size:var(--font-size-sm); }
    .hc-summary {
      display:flex; align-items:center; gap:var(--spacing-2);
      padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md);
      margin-bottom:var(--spacing-4); font-size:var(--font-size-sm);
    }
    .hc-summary i { font-size:1.2rem; }
    .hc-summary--anomaly { background:var(--color-warning-50,#fffbeb); color:var(--color-warning-700,#a16207); border:1px solid var(--color-warning-200,#fde68a); }
    .hc-summary--ok { background:var(--color-success-50,#f0fdf4); color:var(--color-success-700,#15803d); border:1px solid var(--color-success-200,#bbf7d0); }
    .hc-row-anomaly { background:var(--color-warning-50,#fffbeb); }
    .hc-badge { display:inline-block; padding:0.15rem 0.5rem; border-radius:var(--radius-pill,999px); font-size:var(--font-size-xs); font-weight:var(--font-weight-semibold); white-space:nowrap; }
    .hc-badge--blocking { background:var(--color-danger-100,#fee2e2); color:var(--color-danger-700,#b91c1c); }
    .hc-badge--warning { background:var(--color-warning-100,#fef3c7); color:var(--color-warning-700,#a16207); }
    .hc-badge--info { background:var(--color-background-subtle); color:var(--color-text-tertiary); }
    .hc-badge--ok { background:var(--color-success-100,#dcfce7); color:var(--color-success-700,#15803d); }
    .hc-link { color:var(--color-primary-500); text-decoration:none; font-weight:500; white-space:nowrap; }
    .hc-link:hover { text-decoration:underline; }
  `
})
export class AccountingHealthComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);

  scope: 'year' | 'all' = 'year';
  fiscalYear = new Date().getFullYear();
  readonly report = signal<AccountingHealthReportDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  readonly anomalyCount = computed(() =>
    (this.report()?.checks ?? []).filter(c => c.count > 0).length
  );

  noAnomalyMessage(fiscalYear: number | null): string {
    return fiscalYear
      ? $localize`:@@ui.tern.aucune.anomalie.detectee.sur.l.exercice.ph.f58da0:Aucune anomalie détectée sur l'exercice ${fiscalYear}:p0:.`
      : $localize`:@@ui.tern.aucune.anomalie.detectee.sur.l.ensemble.du.86d2cf:Aucune anomalie détectée sur l'ensemble du dossier.`;
  }

  ngOnInit(): void {
    this.run();
  }

  run(): void {
    this.error.set(null);
    this.loading.set(true);
    const year = this.scope === 'year' ? this.fiscalYear : undefined;
    this.api.getAccountingHealth(year).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.report.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  severityLabel(c: PreClosingCheckDto): string {
    if (c.count === 0) return 'OK';
    if (c.severity === 2) return 'Bloquant';
    if (c.severity === 1) return 'Avertissement';
    return 'Info';
  }

  severityClass(c: PreClosingCheckDto): string {
    if (c.count === 0) return 'hc-badge--ok';
    if (c.severity === 2) return 'hc-badge--blocking';
    if (c.severity === 1) return 'hc-badge--warning';
    return 'hc-badge--info';
  }
}
