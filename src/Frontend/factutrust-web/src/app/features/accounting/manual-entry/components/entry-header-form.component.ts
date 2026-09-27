import { Component, computed, effect, inject, input, signal } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { EntryFormStore } from '../services/entry-form.store';

import { EntryReferenceStore } from '../services/entry-reference.store';

import { PeriodBadgeComponent } from './period-badge.component';

import { formatPeriodLabel } from '../models/guided-scenarios.catalog';

import { AccountingService } from '../../services/accounting.service';

import { AccountingFeatureFlagsService } from '../../shared/accounting-feature-flags.service';

import { AuthService } from '@core/services/auth.service';

import { PERMISSIONS } from '@core/config/permission-keys';

import { FUNCTIONAL_CURRENCY, MILLIME_DECIMALS } from '../models/entry-form.model';



@Component({

  selector: 'app-entry-header-form',

  standalone: true,

  imports: [CommonModule, FormsModule, PeriodBadgeComponent],

  template: `

    <section class="entry-header card" aria-labelledby="entry-header-title">

      <h2 id="entry-header-title" class="entry-header__title" i18n="@@accounting.manual-entry.informations.generales.be6ba6e5">Informations générales</h2>



      <div class="entry-header__grid" [class.entry-header__grid--compact]="compact()">

        <div class="form-field">

          <label class="field-label" for="eh-journal"><ng-container i18n="@@accounting.manual-entry.journal.57d7f743">Journal </ng-container> <span class="req" i18n="@@accounting.manual-entry.text.df58248c">*</span></label>

          <select id="eh-journal" class="me-input"
                  [ngModel]="store.journalCode()" (ngModelChange)="store.journalCode.set($event)"
                  [disabled]="lockJournal() || store.editingLocked()">

            @for (opt of store.journalOptions(); track opt.code) {

              <option [value]="opt.code">{{ opt.code }} — {{ opt.label }}</option>

            }

          </select>

        </div>



        <div class="form-field">

          <label class="field-label" for="eh-date"><ng-container i18n="@@accounting.manual-entry.date.d.ecriture.1cca6f03">Date d'écriture </ng-container> <span class="req" i18n="@@accounting.manual-entry.text.df58248c">*</span></label>

          <input id="eh-date" type="date" class="me-input"

                 [ngModel]="store.entryDate()" (ngModelChange)="store.setEntryDate($event)"
                 [disabled]="lockDate() || store.editingLocked()" />

          @if (store.periodsLoaded()) {

            <app-period-badge [date]="store.entryDate()" [periods]="store.periods()" />

          }

        </div>



        <div class="form-field">

          <label class="field-label" for="eh-period"><ng-container i18n="@@accounting.manual-entry.periode.de2110b7">Période </ng-container> <span class="req" i18n="@@accounting.manual-entry.text.df58248c">*</span></label>

          <select id="eh-period" class="me-input"

                  [ngModel]="store.periodId()" (ngModelChange)="store.setPeriodId($event || null)"
                  [disabled]="lockDate() || store.editingLocked()">

            <option [ngValue]="null" i18n="@@accounting.manual-entry.selectionner.7ae1afc7">— Sélectionner —</option>

            @for (p of refs.openPeriods(); track p.id) {

              <option [ngValue]="p.id">{{ periodLabel(p) }}</option>

            }

          </select>

        </div>



        @if (showCurrency()) {

          <div class="form-field">

            <label class="field-label" for="eh-currency"><ng-container i18n="@@accounting.manual-entry.devise.eb2e42c4">Devise </ng-container> <span class="req" i18n="@@accounting.manual-entry.text.df58248c">*</span></label>

            <select id="eh-currency" class="me-input"
                    [ngModel]="store.currency()" (ngModelChange)="onCurrencyChange($event)"
                    [disabled]="store.editingLocked()">

              @for (c of currencies(); track c.code) {

                <option [value]="c.code">{{ c.code }} — {{ c.label }}</option>

              }

            </select>

          </div>

        }



        @if (showCurrency() && store.isForeignCurrency()) {

          <div class="form-field">

            <label class="field-label" for="eh-rate"><ng-container i18n="@@accounting.manual-entry.taux.18bc95b8">Taux </ng-container> <span class="req" i18n="@@accounting.manual-entry.text.df58248c">*</span></label>

            <input id="eh-rate" type="number" step="0.00001" min="0" class="me-input"
                   [class.me-input--locked]="!canOverrideRate()"
                   [readonly]="!canOverrideRate()"
                   [ngModel]="store.exchangeRate()" (ngModelChange)="onRateChange($event)"
                   [attr.aria-label]="loc_ui_tern_taux_de_change_9dd682 + store.currency()" />

            @if (rateError(); as err) {

              <p class="eh-rate-msg eh-rate-msg--error" role="alert">{{ err }}</p>

            } @else if (store.exchangeRate() !== null) {

              <p class="eh-rate-msg">1 {{ store.currency() }} = {{ store.exchangeRate() }} {{ functionalCurrency }}</p>

            }

          </div>

        }



        <div class="form-field form-field--wide">

          <label class="field-label" for="eh-label"><ng-container i18n="@@accounting.manual-entry.libelle.general.777f3fa8">Libellé général </ng-container> <span class="req" i18n="@@accounting.manual-entry.text.df58248c">*</span></label>

          <input id="eh-label" type="text" class="me-input" placeholder="Libellé de l'écriture" i18n-placeholder="Libellé de l'écriture"

                 [ngModel]="store.entryLabel()" (ngModelChange)="onLabelChange($event)" />

        </div>

      </div>



      <details class="entry-header__piece-options">

        <summary i18n="@@accounting.manual-entry.options.piece.35e73236">Options pièce</summary>

        <div class="entry-header__grid entry-header__grid--secondary">

          <div class="form-field">

            <label class="field-label" for="eh-piece-num" i18n="@@accounting.manual-entry.n.piece.a5108f6f">N° pièce</label>

            @if (store.editingEntryNumber() != null) {
              <input id="eh-piece-num" type="text" class="me-input me-input--locked" readonly
                     [value]="store.editingEntryNumber()" title="Numéro de pièce (figé)" i18n-title="Numéro de pièce (figé)" />
            } @else {
              <input id="eh-piece-num" type="text" class="me-input me-input--locked" readonly
                     value="Attribué à l'enregistrement" title="Le numéro de pièce est généré automatiquement" i18n-title="Le numéro de pièce est généré automatiquement" />
            }

          </div>



          <div class="form-field">

            <label class="field-label" for="eh-ref" i18n="@@accounting.manual-entry.reference.f8130bb0">Référence</label>

            <input id="eh-ref" type="text" class="me-input" maxlength="50"

                   placeholder="Réf. pièce externe" i18n-placeholder="Réf. pièce externe"

                   [ngModel]="store.pieceRef()" (ngModelChange)="store.pieceRef.set($event)" />

          </div>



          <div class="form-field">

            <label class="field-label" for="eh-piece-date" i18n="@@accounting.manual-entry.date.piece.8364a00e">Date pièce</label>

            <input id="eh-piece-date" type="date" class="me-input"

                   [ngModel]="store.pieceDate()" (ngModelChange)="store.pieceDate.set($event)" />

          </div>

        </div>

      </details>

    </section>

  `,

  styles: `

    .entry-header { padding:var(--spacing-5); margin-bottom:var(--spacing-4); }

    .entry-header__title { font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); margin:0 0 var(--spacing-4); }

    .entry-header__grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:var(--spacing-4); align-items:end; }

    .entry-header__grid--compact { grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); }


    .entry-header__grid--secondary { margin-top:var(--spacing-3); }

    .entry-header__piece-options { margin-top:var(--spacing-2); }

    .entry-header__piece-options summary { cursor:pointer; font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); color:var(--color-text-secondary); padding:var(--spacing-2) 0; }

    .form-field { display:flex; flex-direction:column; gap:var(--spacing-2); }

    .form-field--wide { grid-column:1 / -1; }

    .field-label { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }

    .req { color:var(--color-error-600); }

    .me-input { padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); background:var(--color-background-elevated); font-size:var(--font-size-sm); min-height:2.5rem; width:100%; box-sizing:border-box; }

    .me-input--locked { background:var(--color-background-subtle); color:var(--color-text-tertiary); cursor:not-allowed; }

    .me-input:focus { outline:none; border-color:var(--color-primary-500); box-shadow:0 0 0 3px var(--color-primary-200); }

    .eh-rate-msg { font-size:var(--font-size-xs); color:var(--color-text-secondary); margin:0; font-variant-numeric:tabular-nums; }

    .eh-rate-msg--error { color:var(--color-error-600); }

  `

})

export class EntryHeaderFormComponent {
  readonly loc_ui_tern_taux_de_change_9dd682 = $localize`:@@ui.tern.taux.de.change.9dd682:Taux de change `;

  readonly store = inject(EntryFormStore);

  readonly refs = inject(EntryReferenceStore);

  readonly compact = input(false);

  readonly lockJournal = input(false);

  readonly lockDate = input(false);



  private readonly api = inject(AccountingService);

  private readonly flags = inject(AccountingFeatureFlagsService);

  private readonly auth = inject(AuthService);



  readonly functionalCurrency = FUNCTIONAL_CURRENCY;

  readonly rateError = signal<string | null>(null);



  readonly currencies = computed(() => this.refs.currencies());



  /**
   * Le sélecteur n'apparaît que si le module est activé ET qu'il existe une alternative à la devise
   * de tenue : un dossier mono-devise retrouve l'écran d'avant, au pixel près.
   */
  readonly showCurrency = computed(() =>
    this.flags.isEnabled('multiCurrencyEnabled') && this.currencies().length > 1
  );



  /** Sans cette permission le taux est en lecture seule : il fixe la valeur comptable de l'écriture. */
  readonly canOverrideRate = computed(() =>
    this.auth.hasPermission(PERMISSIONS.accounting.exchangeRateOverride)
  );



  constructor() {
    // Les décimales suivent la devise, d'où qu'elle vienne : le sélecteur, ou une écriture
    // rechargée. L'effet dépend aussi du catalogue, donc il se corrige de lui-même si les
    // devises arrivent après l'écriture.
    effect(() => {
      const code = this.store.currency();
      const found = this.currencies().find(c => c.code === code);
      this.store.currencyDecimals.set(found?.decimalPlaces ?? MILLIME_DECIMALS);
    });

    // Le taux dépend de la devise ET du mois de l'écriture : changer l'une ou l'autre le réévalue.
    // La résolution est déléguée au serveur, pour que l'écran affiche exactement ce qui sera
    // comptabilisé plutôt qu'une estimation locale.
    effect(() => {
      const code = this.store.currency();
      const date = this.store.entryDate();

      if (code === FUNCTIONAL_CURRENCY) {
        this.store.exchangeRate.set(null);
        this.rateError.set(null);
        return;
      }

      if (!date) return;

      this.api.resolveExchangeRate(code, date).subscribe({
        next: res => {
          // Une écriture rechargée garde le taux avec lequel elle a été comptabilisée : le
          // remplacer par celui de la table la revaloriserait à la simple réouverture du
          // formulaire. Dès que la devise ou la date change, la clé ne correspond plus et le
          // taux fraîchement résolu reprend la main.
          const hydrated = this.store.isHydratedRate(code, date);
          if (res.success && res.data) {
            if (!hydrated) this.store.exchangeRate.set(res.data.rate);
            this.rateError.set(null);
          } else {
            // Aucun taux configuré pour la période : on efface plutôt que de laisser un taux
            // périmé, et le message porte le mois exact à renseigner. Le taux d'une écriture
            // rechargée survit en revanche au message : il est déjà comptabilisé.
            if (!hydrated) this.store.exchangeRate.set(null);
            this.rateError.set(res.error ?? $localize`:@@ui.tern.taux.indisponible.29ec77:Taux indisponible`);
          }
        },
        error: () => {
          if (!this.store.isHydratedRate(code, date)) this.store.exchangeRate.set(null);
          this.rateError.set('Taux indisponible');
        }
      });
    });
  }



  onCurrencyChange(code: string): void {
    // Choix délibéré de l'utilisateur : le taux de l'écriture rechargée ne fait plus foi, c'est
    // celui de la table qui reprend la main. Les décimales, elles, suivent par l'effet du
    // constructeur — un seul chemin, donc aucun risque qu'un rechargement les laisse sur la
    // devise précédente.
    this.store.clearHydratedRate();
    this.store.currency.set(code);
  }



  onRateChange(value: number | null): void {
    this.store.exchangeRate.set(value === null || value <= 0 ? null : value);
  }



  periodLabel(p: { fiscalYear: number; month: number }): string {

    return formatPeriodLabel(p.fiscalYear, p.month);

  }



  onLabelChange(label: string): void {

    this.store.entryLabel.set(label);

    if (this.store.propagateLabelToLines()) {

      const lines = this.store.lines().map(l =>

        l.lineLabel.trim() ? l : { ...l, lineLabel: label }

      );

      this.store.setLines(lines);

    }

  }

}


