/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingTableActionsComponent } from '../shared/accounting-table-actions.component';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AccountingService, CurrencyDto } from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

interface CurrencyForm {
  id: string | null;
  code: string;
  label: string;
  decimalPlaces: number;
  ratePeriodicity: number;
}

const MIN_FISCAL_YEAR = 2000;
const MAX_FISCAL_YEAR = 2100;

@Component({
  selector: 'app-currencies',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingTableActionsComponent
  ],
  template: `
    <app-page-header title="Gestion des devises" i18n-title="@@accounting.currencies.gestion.des.devises.d97aadcb"
                     subtitle="Devises utilisables en comptabilité et taux de change par exercice" i18n-subtitle="@@accounting.currencies.devises.utilisables.en.comptabilite.et.t.ac880e8f" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card cur-toolbar">
      <div class="cur-field">
        <label class="cur-lbl" for="cur-year" i18n="@@accounting.currencies.exercice.e171e2b0">Exercice</label>
        <input id="cur-year" class="cur-inp cur-year" type="number" [ngModel]="fiscalYear()"
               (ngModelChange)="onYearChange($event)" [min]="minYear" [max]="maxYear" />
      </div>
      <div class="cur-toolbar-actions">
        @if (canManage()) {
          <app-button variant="primary" icon="pi pi-plus" type="button"
                      (click)="startCreate()" [disabled]="loading()" i18n="@@accounting.currencies.ajouter.une.devise.cd33411d">Ajouter une devise</app-button>
        }
        <app-button variant="secondary" icon="pi pi-refresh" type="button"
                    (click)="load()" [disabled]="loading()" i18n="@@accounting.currencies.actualiser.9d3b2a7d">Actualiser</app-button>
      </div>
    </div>

    @if (form(); as f) {
      <div class="card cur-form">
        <h3 class="cur-form-title">{{ f.id ? loc_ui_tern_modifier_la_devise_b37fac : loc_ui_tern_nouvelle_devise_b1094e }}</h3>
        <div class="cur-fields">
          <div class="cur-field">
            <label class="cur-lbl" for="cur-code" i18n="@@accounting.currencies.code.adac6937">Code</label>
            <input id="cur-code" class="cur-inp" [(ngModel)]="f.code" [disabled]="!!f.id"
                   maxlength="3" placeholder="Ex. EUR" i18n-placeholder="@@accounting.currencies.ex.eur.0a968982" />
          </div>
          <div class="cur-field cur-grow">
            <label class="cur-lbl" for="cur-label" i18n="@@accounting.currencies.libelle.f5485bba">Libellé</label>
            <input id="cur-label" class="cur-inp" [(ngModel)]="f.label" maxlength="60" />
          </div>
          <div class="cur-field">
            <label class="cur-lbl" for="cur-decimals" i18n="@@accounting.currencies.decimales.ac27f79a">Décimales</label>
            <select id="cur-decimals" class="cur-inp" [(ngModel)]="f.decimalPlaces">
              @for (d of decimalOptions; track d) { <option [ngValue]="d">{{ d }}</option> }
            </select>
          </div>
          <div class="cur-field">
            <label class="cur-lbl" for="cur-periodicity" i18n="@@accounting.currencies.periode.de2110b7">Période</label>
            <select id="cur-periodicity" class="cur-inp" [(ngModel)]="f.ratePeriodicity">
              <option [ngValue]="1" i18n="@@accounting.currencies.mensuelle.15af1be3">Mensuelle</option>
              <option [ngValue]="0" i18n="@@accounting.currencies.fixe.annuelle.dc8817b4">Fixe (annuelle)</option>
            </select>
          </div>
          <div class="cur-form-actions">
            <button type="button" class="btn btn-secondary" (click)="form.set(null)" [disabled]="saving()" i18n="@@accounting.currencies.annuler.49ba3292">Annuler</button>
            <button type="button" class="btn btn-primary" (click)="save()"
                    [disabled]="saving() || !f.code.trim() || !f.label.trim()">
              {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
            </button>
          </div>
        </div>
      </div>
    }

    <div class="card cur-list">
      <p-table [value]="currencies()" [loading]="loading()"
               styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" i18n="@@accounting.currencies.code.adac6937">Code</th>
            <th scope="col" i18n="@@accounting.currencies.libelle.f5485bba">Libellé</th>
            <th scope="col" i18n="@@accounting.currencies.configuration.75416485">Configuration</th>
            <th scope="col" i18n="@@accounting.currencies.taux.de.change.d29fa782">Taux de change</th>
            <th scope="col" i18n="@@accounting.currencies.actif.2eb75f84">Actif</th>
            <th scope="col" i18n="@@accounting.currencies.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [class.cur-inactive]="!c.isActive">
            <td class="cur-mono">{{ c.code }}</td>
            <td>
              {{ c.label }}
              @if (c.isFunctional) { <span class="cur-badge cur-badge--functional" i18n="@@accounting.currencies.devise.de.tenue.184b32cb">Devise de tenue</span> }
            </td>
            <td>
              @if (c.isFunctional) {
                <span class="cur-muted" i18n="@@accounting.currencies.text.1b93795b">—</span>
              } @else if (c.ratePeriodicity === 1) {
                <span class="cur-badge" i18n="@@accounting.currencies.mensuelle.15af1be3">Mensuelle</span>
              } @else {
                <span class="cur-badge" i18n="@@accounting.currencies.fixe.95d72643">Fixe</span>
              }
            </td>
            <td>
              @if (c.isFunctional) {
                <span class="cur-muted" i18n="@@accounting.currencies.text.1b93795b">—</span>
              } @else if (c.configuredRateCount === 0) {
                <span class="cur-badge cur-badge--danger" i18n="@@accounting.currencies.non.configure.309abde3">Non configuré</span>
              } @else if (c.configuredRateCount < c.expectedRateCount) {
                <span class="cur-badge cur-badge--warn">{{ c.configuredRateCount }} / {{ c.expectedRateCount }}</span>
              } @else {
                <span class="cur-badge cur-badge--ok" i18n="@@accounting.currencies.complet.26275ebd">Complet</span>
              }
            </td>
            <td>{{ c.isActive ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
            <td>
              <app-accounting-table-actions>
                @if (!c.isFunctional) {
                  <app-button variant="ghost" size="sm" icon="pi-sliders-h" [iconOnly]="true" [iconAlwaysVisible]="true"
                              type="button" (click)="openRates(c)" ariaLabel="Taux de change" i18n-ariaLabel="@@accounting.currencies.taux.de.change.99c07e9c" />
                }
                @if (canManage()) {
                  <app-button variant="ghost" size="sm" icon="pi-pencil" [iconOnly]="true" [iconAlwaysVisible]="true"
                              type="button" (click)="startEdit(c)" ariaLabel="Modifier" i18n-ariaLabel="@@accounting.currencies.modifier.ead890f7" />
                  @if (!c.isFunctional) {
                    <app-button variant="ghost" size="sm"
                                [icon]="c.isActive ? 'pi-eye-slash' : 'pi-eye'"
                                [iconOnly]="true" [iconAlwaysVisible]="true"
                                type="button" (click)="toggle(c)"
                                [attr.aria-label]="c.isActive ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_activer_b96fa7" />
                  }
                }
              </app-accounting-table-actions>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="6" class="cur-empty" i18n="@@accounting.currencies.aucune.devise.f24f39b3">Aucune devise.</td></tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    .cur-toolbar, .cur-form, .cur-list { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .cur-toolbar { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .cur-toolbar-actions { display: flex; gap: var(--spacing-3); margin-left: auto; }
    .cur-form-title { margin: 0 0 var(--spacing-3); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .cur-fields { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .cur-field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 8rem; }
    .cur-grow { flex: 1 1 14rem; }
    .cur-year { max-width: 7rem; }
    .cur-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .cur-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .cur-form-actions { display: flex; gap: var(--spacing-2); margin-left: auto; }
    .cur-mono { font-family: ui-monospace, monospace; }
    .cur-inactive { opacity: 0.6; }
    .cur-muted { color: var(--color-text-tertiary); }
    .cur-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
    .cur-badge { display: inline-block; padding: var(--spacing-1) var(--spacing-2); border-radius: var(--radius-full); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); background: var(--color-background-subtle); color: var(--color-text-secondary); }
    .cur-badge--ok { background: var(--color-success-50); color: var(--color-success-700); }
    .cur-badge--warn { background: var(--color-warning-50); color: var(--color-warning-800); }
    .cur-badge--danger { background: var(--color-error-50); color: var(--color-error-700); }
    .cur-badge--functional { margin-left: var(--spacing-2); background: var(--color-primary-50); color: var(--color-primary-700); }
    .btn { padding: var(--spacing-2) var(--spacing-4); border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); cursor: pointer; border: 1px solid transparent; }
    .btn-secondary { background: var(--color-background-subtle); color: var(--color-text-primary); border-color: var(--color-border-default); }
    .btn-primary { background: var(--color-primary-500, #2563eb); color: #fff; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  `
})
export class CurrenciesComponent implements OnInit {
  readonly loc_ui_tern_modifier_la_devise_b37fac = $localize`:@@ui.tern.modifier.la.devise.b37fac:Modifier la devise`;
  readonly loc_ui_tern_nouvelle_devise_b1094e = $localize`:@@ui.tern.nouvelle.devise.b1094e:Nouvelle devise`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  readonly loc_ui_tern_desactiver_d28397 = $localize`:@@ui.tern.desactiver.d28397:Désactiver`;
  readonly loc_ui_tern_activer_b96fa7 = $localize`:@@ui.tern.activer.b96fa7:Activer`;
  private readonly api = inject(AccountingService);
  // Le 400 metier porte un message precis ; extractErrorMessage le lit et
  // distingue au passage la vraie panne reseau (status 0).
  private readonly errors = inject(ErrorHandlerService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly minYear = MIN_FISCAL_YEAR;
  readonly maxYear = MAX_FISCAL_YEAR;
  readonly decimalOptions = [0, 1, 2, 3];

  readonly currencies = signal<CurrencyDto[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = signal<CurrencyForm | null>(null);
  readonly fiscalYear = signal(new Date().getFullYear());

  /** L'écriture est gardée par la permission, pas par un drapeau front : c'est l'API qui tranche. */
  readonly canManage = computed(() => this.auth.hasPermission(PERMISSIONS.accounting.currenciesManage));

  ngOnInit(): void {
    this.load();
  }

  onYearChange(year: number): void {
    if (!Number.isFinite(year) || year < MIN_FISCAL_YEAR || year > MAX_FISCAL_YEAR) return;
    this.fiscalYear.set(Math.trunc(year));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getCurrencies(this.fiscalYear(), true).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.currencies.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => { this.loading.set(false); this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau')); }
    });
  }

  startCreate(): void {
    this.form.set({ id: null, code: '', label: '', decimalPlaces: 2, ratePeriodicity: 1 });
  }

  startEdit(c: CurrencyDto): void {
    this.form.set({
      id: c.id,
      code: c.code,
      label: c.label,
      decimalPlaces: c.decimalPlaces,
      ratePeriodicity: c.ratePeriodicity
    });
  }

  openRates(c: CurrencyDto): void {
    void this.router.navigate(['/accounting/currencies', c.id], {
      queryParams: { fiscalYear: this.fiscalYear() }
    });
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    this.saving.set(true);

    const done = (ok: boolean, err?: string) => {
      this.saving.set(false);
      if (ok) {
        this.toast.add({ severity: 'success', summary: $localize`:@@currencies.component.summary.Devise_enregistr:Devise enregistrée`, detail: f.code, life: 4000 });
        this.form.set(null);
        this.load();
      } else {
        this.error.set(err ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      }
    };

    if (f.id) {
      this.api.updateCurrency(f.id, {
        label: f.label.trim(),
        decimalPlaces: f.decimalPlaces,
        ratePeriodicity: f.ratePeriodicity
      }).subscribe({ next: r => done(r.success, r.error), error: err => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau')) });
    } else {
      this.api.createCurrency({
        code: f.code.trim().toUpperCase(),
        label: f.label.trim(),
        decimalPlaces: f.decimalPlaces,
        ratePeriodicity: f.ratePeriodicity
      }).subscribe({ next: r => done(r.success, r.error), error: err => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau')) });
    }
  }

  toggle(c: CurrencyDto): void {
    this.api.toggleCurrency(c.id).subscribe({
      next: r => { if (r.success) this.load(); else this.error.set(r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`); },
      error: err => this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'))
    });
  }
}
