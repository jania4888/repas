/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import {
  AccountingService,
  CurrencyDto,
  CurrencyRateEntryRequest
} from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

const UNSAVED_CHANGES_MESSAGE =
  'Des taux de change modifiés ne sont pas enregistrés. Quitter cette page les abandonnera. Continuer ?';

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

interface RateRow {
  /** 1 à 12, ou null pour le taux fixe de l'exercice. */
  month: number | null;
  label: string;
  value: number | null;
}

@Component({
  selector: 'app-currency-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <app-page-header [title]="pageTitle()" subtitle="Configuration de la devise et de ses taux de change" i18n-subtitle="@@accounting.currencies.configuration.de.la.devise.et.de.ses.tau.63a3ece1">
      <app-button variant="secondary" icon="pi pi-arrow-left" type="button" (click)="back()" i18n="@@accounting.currencies.retour.e5befb1f">Retour</app-button>
      @if (canManage()) {
        <app-button variant="primary" icon="pi pi-save" type="button"
                    (click)="save()" [disabled]="saving() || loading()">
          {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
        </app-button>
      }
    </app-page-header>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    @if (isDirty()) {
      <div class="ce-dirty" role="status" i18n="@@accounting.currencies.modifications.non.enregistrees.d3afef8e">Modifications non enregistrées.</div>
    }

    @if (currency(); as c) {
      <div class="card ce-block">
        <h3 class="ce-title" i18n="@@accounting.currencies.configuration.devise.147b7601">Configuration devise</h3>
        <div class="ce-grid">
          <div class="ce-field">
            <label class="ce-lbl" for="ce-code" i18n="@@accounting.currencies.code.adac6937">Code</label>
            <input id="ce-code" class="ce-inp ce-readonly" [value]="c.code" readonly />
          </div>
          <div class="ce-field ce-grow">
            <label class="ce-lbl" for="ce-label" i18n="@@accounting.currencies.libelle.f5485bba">Libellé</label>
            <input id="ce-label" class="ce-inp ce-readonly" [value]="c.label" readonly />
          </div>
          <div class="ce-field">
            <label class="ce-lbl" for="ce-periodicity" i18n="@@accounting.currencies.periode.de2110b7">Période</label>
            <input id="ce-periodicity" class="ce-inp ce-readonly"
                   [value]="c.ratePeriodicity === 1 ? loc_ui_tern_mensuelle_15af1b : loc_ui_tern_fixe_annuelle_dc8817" readonly />
          </div>
          <div class="ce-field">
            <label class="ce-lbl" for="ce-decimals" i18n="@@accounting.currencies.decimale.de3fe95d">Décimale</label>
            <input id="ce-decimals" class="ce-inp ce-readonly" [value]="c.decimalPlaces" readonly />
          </div>
        </div>
        <p class="ce-hint" i18n="@@accounting.currencies.le.code.le.libelle.la.periode.et.les.decimales.s.8b492df5"> Le code, le libellé, la période et les décimales se modifient depuis la liste des devises. </p>
      </div>

      <div class="card ce-block">
        <div class="ce-block-head">
          <h3 class="ce-title" i18n="@@accounting.currencies.configuration.de.taux.de.change.9bc5794a">Configuration de taux de change</h3>
          <div class="ce-field">
            <label class="ce-lbl" for="ce-year" i18n="@@accounting.currencies.exercice.e171e2b0">Exercice</label>
            <input id="ce-year" class="ce-inp ce-year" type="number" [ngModel]="fiscalYear()"
                   (ngModelChange)="onYearChange($event)" [min]="minYear" [max]="maxYear" />
          </div>
        </div>

        <p class="ce-direction" i18n="@@accounting.currencies.un.taux.exprime.le.nombre.de.dinars.pour.00c85efc">
          <ng-container> Un taux exprime le nombre de dinars pour </ng-container> <strong>une</strong> unité de {{ c.code }}.
          Exemple : 1 {{ c.code }} = 3,31420 TND se saisit <code>3,31420</code>.
        </p>

        <div class="ce-rates">
          @for (row of rates(); track row.month) {
            <div class="ce-field ce-rate">
              <label class="ce-lbl" [attr.for]="'ce-rate-' + (row.month ?? 0)">{{ row.label }}</label>
              <input [id]="'ce-rate-' + (row.month ?? 0)" class="ce-inp ce-rate-inp" type="number"
                     step="0.00001" min="0" [disabled]="!canManage()"
                     [ngModel]="row.value" (ngModelChange)="onRateChange(row, $event)"
                     [attr.aria-label]="loc_ui_tern_taux_de_change_9dd682 + row.label" />
            </div>
          }
        </div>
      </div>
    } @else if (!loading()) {
      <div class="card ce-block"><p class="ce-hint" i18n="@@accounting.currencies.devise.introuvable.d2789868">Devise introuvable.</p></div>
    }
  `,
  styles: `
    .ce-block { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .ce-block-head { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; justify-content: space-between; margin-bottom: var(--spacing-3); }
    .ce-title { margin: 0 0 var(--spacing-3); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .ce-block-head .ce-title { margin-bottom: 0; }
    .ce-grid { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .ce-rates { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--spacing-3); }
    .ce-field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 8rem; }
    .ce-grow { flex: 1 1 14rem; }
    .ce-year { max-width: 7rem; }
    .ce-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .ce-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .ce-rate-inp { font-variant-numeric: tabular-nums; text-align: right; }
    .ce-readonly { background: var(--color-background-subtle); color: var(--color-text-tertiary); }
    .ce-hint { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin: var(--spacing-3) 0 0; }
    .ce-direction { font-size: var(--font-size-sm); color: var(--color-text-secondary); background: var(--color-primary-50); padding: var(--spacing-3); border-radius: var(--radius-md); margin: 0 0 var(--spacing-4); }
    .ce-dirty { margin-bottom: var(--spacing-3); padding: var(--spacing-2) var(--spacing-3); background: var(--color-warning-50); color: var(--color-warning-800); border: 1px solid var(--color-warning-200); border-radius: var(--radius-md); font-size: var(--font-size-sm); }
  `
})
export class CurrencyEditComponent implements OnInit {
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_mensuelle_15af1b = $localize`:@@ui.tern.mensuelle.15af1b:Mensuelle`;
  readonly loc_ui_tern_fixe_annuelle_dc8817 = $localize`:@@ui.tern.fixe.annuelle.dc8817:Fixe (annuelle)`;
  readonly loc_ui_tern_taux_de_change_9dd682 = $localize`:@@ui.tern.taux.de.change.9dd682:Taux de change `;
  private readonly api = inject(AccountingService);
  // Le 400 metier porte un message precis ; extractErrorMessage le lit et
  // distingue au passage la vraie panne reseau (status 0).
  private readonly errors = inject(ErrorHandlerService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly minYear = 2000;
  readonly maxYear = 2100;

  readonly currency = signal<CurrencyDto | null>(null);
  readonly rates = signal<RateRow[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly fiscalYear = signal(new Date().getFullYear());

  /** Empreinte des taux chargés, pour détecter une modification non enregistrée. */
  private baseline = '';
  readonly dirty = signal(false);

  readonly canManage = computed(() => this.auth.hasPermission(PERMISSIONS.accounting.currenciesManage));
  readonly pageTitle = computed(() => {
    const c = this.currency();
    return c ? $localize`:@@ui.tern.edition.de.devise.ph.0241c4:Édition de devise — ${c.code}:p0:` : $localize`:@@ui.tern.edition.de.devise.403ce5:Édition de devise`;
  });

  private currencyId = '';

  ngOnInit(): void {
    this.currencyId = this.route.snapshot.paramMap.get('id') ?? '';
    const year = Number(this.route.snapshot.queryParamMap.get('fiscalYear'));
    if (Number.isFinite(year) && year >= this.minYear && year <= this.maxYear) {
      this.fiscalYear.set(Math.trunc(year));
    }
    this.load();
  }

  isDirty(): boolean {
    return this.dirty();
  }

  canDeactivate(): boolean {
    if (!this.isDirty()) return true;
    return confirm(UNSAVED_CHANGES_MESSAGE);
  }

  onYearChange(year: number): void {
    if (!Number.isFinite(year) || year < this.minYear || year > this.maxYear) return;
    if (this.isDirty() && !confirm(UNSAVED_CHANGES_MESSAGE)) return;
    this.fiscalYear.set(Math.trunc(year));
    this.load();
  }

  onRateChange(row: RateRow, value: number | null): void {
    const next = this.rates().map(r =>
      r.month === row.month ? { ...r, value: value === null || value <= 0 ? null : value } : r
    );
    this.rates.set(next);
    this.dirty.set(this.fingerprint(next) !== this.baseline);
  }

  back(): void {
    void this.router.navigate(['/accounting/currencies']);
  }

  load(): void {
    if (!this.currencyId) return;
    this.loading.set(true);
    this.error.set(null);

    this.api.getCurrencyDetail(this.currencyId, this.fiscalYear()).subscribe({
      next: res => {
        this.loading.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
          return;
        }
        const detail = res.data;
        this.currency.set(detail.currency);

        // La grille est toujours complète : chaque période attendue a sa case, vide si le taux
        // n'est pas encore saisi. C'est ce qui permet à l'enregistrement d'effacer un taux.
        const monthly = detail.currency.ratePeriodicity === 1;
        const rows: RateRow[] = monthly
          ? MONTH_LABELS.map((label, i) => ({
              month: i + 1,
              label,
              value: detail.rates.find(r => r.month === i + 1)?.rate ?? null
            }))
          : [{
              month: null,
              label: $localize`:@@accounting.currency-edit.ts.taux.de.l.exercice.fiscalyear.13fa1dc1:Taux de l'exercice ${detail.fiscalYear}:fiscalYear:`,
              value: detail.rates.find(r => r.month === null)?.rate ?? null
            }];

        this.rates.set(rows);
        this.baseline = this.fingerprint(rows);
        this.dirty.set(false);
      },
      error: err => { this.loading.set(false); this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.currency-edit.ts.erreur.reseau.0683007f:Erreur réseau`)); }
    });
  }

  save(): void {
    if (this.saving() || !this.currencyId) return;
    this.saving.set(true);
    this.error.set(null);

    const payload: CurrencyRateEntryRequest[] = this.rates().map(r => ({ month: r.month, rate: r.value }));

    this.api.saveCurrencyRates(this.currencyId, { fiscalYear: this.fiscalYear(), rates: payload }).subscribe({
      next: r => {
        this.saving.set(false);
        if (r.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@currency-edit.component.summary.Taux_enregistr_s:Taux enregistrés`, detail: this.currency()?.code, life: 4000 });
          this.load();
        } else {
          this.error.set(r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: err => { this.saving.set(false); this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.currency-edit.ts.erreur.reseau.0683007f:Erreur réseau`)); }
    });
  }

  private fingerprint(rows: RateRow[]): string {
    return rows.map(r => `${r.month ?? 'Y'}:${r.value ?? ''}`).join('|');
  }
}
