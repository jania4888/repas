import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import {
  AccountingService,
  MonthlyDeclarationTrackingDto,
  MonthlyDeclarationTrackingRowDto
} from '../services/accounting.service';
import { describeMode } from './monthly-declaration-config.view-model';
import { formatDateFr } from '../vat-declaration/vat-declaration.view-model';
import {
  DmTrackingState,
  defaultTrackingYear,
  describeMigration,
  describeRow,
  isTrackableYear,
  periodLabel,
  rowModeLabel,
  stateLabel,
  stateNeedsAttention,
  summariseTracking,
  trackingState
} from './monthly-declaration-tracking.view-model';

/**
 * Suivi DM — les douze mois d'un exercice en une page : ce qui est déposé, ce qui manque, sous quel
 * régime, et où en est la rampe du dossier.
 *
 * Lecture seule et ouverte à la société : le suivi ne dit rien qu'un dossier ne puisse savoir de
 * ses propres dépôts. C'est le seul écran DM dans ce cas, et c'est pour cela qu'il n'affiche aucune
 * action d'écriture.
 */
@Component({
  selector: 'app-monthly-declaration-tracking',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent
  ],
  template: `
    <app-page-header
      title="Suivi DM" i18n-title="@@accounting.monthly-declaration.suivi.dm.2089b59a"
      subtitle="Les douze mois d’un exercice : ce qui est déposé, ce qui manque, et sous quel régime" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card dm-period">
      <div class="dm-field">
        <label class="dm-lbl" for="dm-year" i18n="@@accounting.monthly-declaration.exercice.e171e2b0">Exercice</label>
        <input
          id="dm-year"
          type="number"
          class="dm-inp"
          min="2000"
          max="2100"
          [(ngModel)]="year"
          (ngModelChange)="load()" />
      </div>
      <app-button
        variant="secondary"
        icon="pi-refresh"
        type="button"
        [disabled]="loading() || !yearValid()"
        (click)="load()">
        {{ loading() ? loc_ui_tern_chargement_01cba1 : loc_ui_tern_actualiser_9d3b2a }}
      </app-button>
    </div>

    @if (tracking(); as t) {
      @if (!t.settings.configurableLinesEnabled) {
        <app-accounting-status-banner
          variant="info"
          title="Calcul paramétré non activé" i18n-title="@@accounting.monthly-declaration.calcul.parametre.non.active.504c61d8"
          message="Toutes les périodes sont produites par le calcul historique. Le suivi des dépôts reste exact." />
      }

      <div class="card dm-state">
        <p class="dm-state__mode">{{ modeDetail(t) }}</p>
        <p class="dm-state__migration">{{ migration() }}</p>
      </div>

      <div class="card dm-counts">
        <div class="dm-count">
          <span class="dm-count__value">{{ summary().filed }}</span>
          <span class="dm-count__label" i18n="@@accounting.monthly-declaration.deposee.s.14004565">déposée(s)</span>
        </div>
        <div class="dm-count" [class.dm-count--flag]="summary().drafts > 0">
          <span class="dm-count__value">{{ summary().drafts }}</span>
          <span class="dm-count__label" i18n="@@accounting.monthly-declaration.brouillon.s.40d7d816">brouillon(s)</span>
        </div>
        <div class="dm-count" [class.dm-count--alert]="summary().late > 0">
          <span class="dm-count__value">{{ summary().late }}</span>
          <span class="dm-count__label" i18n="@@accounting.monthly-declaration.en.retard.5865d4b6">en retard</span>
        </div>
        <div class="dm-count">
          <span class="dm-count__value">{{ summary().missing }}</span>
          <span class="dm-count__label" i18n="@@accounting.monthly-declaration.a.venir.b7a44755">à venir</span>
        </div>
        <div class="dm-count dm-count--total">
          <span class="dm-count__value">{{ summary().totalToPay | number: '1.3-3' }}</span>
          <span class="dm-count__label" i18n="@@accounting.monthly-declaration.total.depose.35138fc7">total déposé</span>
        </div>
      </div>

      <div class="card">
        <p-table
          [value]="t.months"
          styleClass="p-datatable-sm accounting-datatable"
          [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.monthly-declaration.periode.de2110b7">Période</th>
              <th scope="col" i18n="@@accounting.monthly-declaration.etat.d3b28a2a">État</th>
              <th scope="col" i18n="@@accounting.monthly-declaration.echeance.f9a77ff6">Échéance</th>
              <th scope="col" i18n="@@accounting.monthly-declaration.regime.0020ca1b">Régime</th>
              <th scope="col" class="dm-num" i18n="@@accounting.monthly-declaration.t.v.a.due.4ad2ef13">T.V.A due</th>
              <th scope="col" class="dm-num" i18n="@@accounting.monthly-declaration.total.a.payer.d9252b33">Total à payer</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ label(row) }}</td>
              <td>
                <span class="dm-chip" [class.dm-chip--flag]="needsAttention(row)">
                  {{ state(row) }}
                </span>
                <p class="dm-detail">{{ detail(row) }}</p>
              </td>
              <td>{{ deadline(row) }}</td>
              <td>{{ mode(row) }}</td>
              <td class="dm-num">{{ row.exists ? (row.vatDue | number: '1.3-3') : '—' }}</td>
              <td class="dm-num dm-num--strong">
                {{ row.exists ? (row.totalToPay | number: '1.3-3') : '—' }}
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      <p class="dm-links">
        <a routerLink="/accounting/dm/calcul" i18n="@@accounting.monthly-declaration.calcul.dm.7af61bf4">Calcul DM</a> ·
        <a routerLink="/accounting/dm/configuration" i18n="@@accounting.monthly-declaration.configuration.dm.b438b9c2">Configuration DM</a>
      </p>
    }
  `,
  styles: `
    .dm-period { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .dm-field { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .dm-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .dm-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 7rem; }
    .dm-state { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .dm-state__mode, .dm-state__migration { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-counts { display: flex; flex-wrap: wrap; gap: var(--spacing-5); }
    .dm-count { display: flex; flex-direction: column; }
    .dm-count__value { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); font-family: ui-monospace, monospace; }
    .dm-count__label { font-size: var(--font-size-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
    .dm-count--flag .dm-count__value { color: var(--color-warning-700, #a16207); }
    .dm-count--alert .dm-count__value { color: var(--color-error-700, #b91c1c); }
    .dm-count--total { margin-left: auto; }
    .dm-num { text-align: right; font-family: ui-monospace, monospace; }
    .dm-num--strong { font-weight: var(--font-weight-semibold); }
    .dm-chip { display: inline-block; padding: 0.1rem 0.45rem; border-radius: var(--radius-pill, 999px); background: var(--color-background-subtle, #f1f5f9); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .dm-chip--flag { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); border: 1px solid var(--color-warning-200, #fde68a); }
    .dm-detail { margin: var(--spacing-1) 0 0; font-size: var(--font-size-xs); color: var(--color-text-secondary); }
    .dm-links { margin: var(--spacing-3) 0 0; font-size: var(--font-size-sm); }
  `
})
export class MonthlyDeclarationTrackingComponent implements OnInit {
  readonly loc_ui_tern_chargement_01cba1 = $localize`:@@ui.tern.chargement.01cba1:Chargement…`;
  readonly loc_ui_tern_actualiser_9d3b2a = $localize`:@@ui.tern.actualiser.9d3b2a:Actualiser`;
  private readonly api = inject(AccountingService);
  private readonly errors = inject(ErrorHandlerService);

  readonly tracking = signal<MonthlyDeclarationTrackingDto | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  year = 0;

  /**
   * Figée à la construction. Un `new Date()` par appel ferait dépendre l'état d'une ligne du moment
   * exact du rendu, et un test passant à minuit deviendrait capricieux.
   */
  private readonly today = new Date();

  readonly summary = computed(() => summariseTracking(this.tracking()?.months, this.today));

  readonly migration = computed(() =>
    describeMigration(this.summary(), this.tracking()?.year ?? this.year)
  );

  ngOnInit(): void {
    this.year = defaultTrackingYear(this.today);
    this.load();
  }

  yearValid(): boolean {
    return isTrackableYear(Number(this.year));
  }

  label(row: MonthlyDeclarationTrackingRowDto): string {
    return periodLabel(this.tracking()?.year ?? Number(this.year), row.month);
  }

  state(row: MonthlyDeclarationTrackingRowDto): string {
    return stateLabel(this.rowState(row));
  }

  needsAttention(row: MonthlyDeclarationTrackingRowDto): boolean {
    return stateNeedsAttention(this.rowState(row));
  }

  detail(row: MonthlyDeclarationTrackingRowDto): string {
    return describeRow(row, this.today);
  }

  deadline(row: MonthlyDeclarationTrackingRowDto): string {
    return formatDateFr(row.filingDeadline);
  }

  mode(row: MonthlyDeclarationTrackingRowDto): string {
    return rowModeLabel(row);
  }

  modeDetail(tracking: MonthlyDeclarationTrackingDto): string {
    return describeMode(tracking.settings);
  }

  load(): void {
    if (!this.yearValid() || this.loading()) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api.getMonthlyDeclarationTracking(Number(this.year)).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.tracking.set(res.data);
        } else {
          this.tracking.set(null);
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.du.suivi.c972e3:Erreur de chargement du suivi.`);
        }
      },
      error: err => {
        this.loading.set(false);
        this.tracking.set(null);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  private rowState(row: MonthlyDeclarationTrackingRowDto): DmTrackingState {
    return trackingState(row, this.today);
  }
}
