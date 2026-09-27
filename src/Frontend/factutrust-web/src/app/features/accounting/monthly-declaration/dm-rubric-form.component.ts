import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MultiSelectModule } from 'primeng/multiselect';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  DM_GROSS_KIND_OPTIONS,
  DM_PAYROLL_COMPONENT_OPTIONS,
  DM_SIDE_OPTIONS,
  DM_WITHHELD_KIND_OPTIONS,
  DmOption,
  DmRubricForm,
  needsFixedGross,
  needsFixedWithheld,
  needsGrossAccounts,
  needsPayrollComponent,
  needsRate,
  needsWithheldAccounts,
  needsWithheldPayrollComponent,
  validateRubricForm
} from './monthly-declaration-config.view-model';

/**
 * Fiche d'édition d'une rubrique. Composant muet : il modifie le brouillon qu'on lui confie et
 * signale l'enregistrement ; il ne connaît ni le service ni la configuration du dossier.
 *
 * Les champs ne sont affichés que lorsque le type choisi les utilise — montrer un taux à une
 * rubrique à valeur fixe inviterait à le renseigner, et le chiffre saisi ne servirait à rien.
 */
@Component({
  selector: 'app-dm-rubric-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MultiSelectModule, ButtonComponent],
  template: `
    @if (form; as f) {
      <div class="dm-form">
        <h3 class="dm-form__title">
          {{ f.id ? loc_ui_tern_modifier_la_rubrique_035400 + f.code : 'Nouvelle rubrique' }}
        </h3>

        <div class="dm-grid">
          <div class="dm-field">
            <label class="dm-lbl" for="dm-code" i18n="@@accounting.monthly-declaration.code.adac6937">Code</label>
            <input
              id="dm-code"
              class="dm-inp dm-mono"
              [(ngModel)]="f.code"
              [disabled]="!!f.id || disabled"
              maxlength="20"
              placeholder="Ex. F9_TCL" i18n-placeholder="Ex. F9_TCL" />
            @if (f.id) {
              <small class="dm-hint" i18n="@@accounting.monthly-declaration.le.code.relie.la.rubrique.aux.declarations.depos.68063285">Le code relie la rubrique aux déclarations déposées : il ne se modifie pas.</small>
            }
          </div>

          <div class="dm-field dm-grow">
            <label class="dm-lbl" for="dm-label" i18n="@@accounting.monthly-declaration.libelle.f5485bba">Libellé</label>
            <input
              id="dm-label"
              class="dm-inp"
              [(ngModel)]="f.label"
              [disabled]="disabled"
              maxlength="200"
              placeholder="Ex. Taxe sur les établissements…" i18n-placeholder="Ex. Taxe sur les établissements…" />
          </div>

          <div class="dm-field">
            <label class="dm-lbl" for="dm-report" i18n="@@accounting.monthly-declaration.code.rapport.149223b0">Code rapport</label>
            <input
              id="dm-report"
              class="dm-inp dm-mono dm-narrow"
              [(ngModel)]="f.reportCode"
              [disabled]="disabled"
              maxlength="16"
              placeholder="17.2" i18n-placeholder="17.2" />
            <small class="dm-hint" i18n="@@accounting.monthly-declaration.numero.d.article.du.formulaire.ou.aucune.case.de.8b9c53ce">Numéro d’article du formulaire, ou « * » (aucune case de détail).</small>
          </div>

          <div class="dm-field">
            <label class="dm-lbl" for="dm-order" i18n="@@accounting.monthly-declaration.ordre.5c32e631">Ordre</label>
            <input
              id="dm-order"
              type="number"
              class="dm-inp dm-narrow"
              [(ngModel)]="f.displayOrder"
              [disabled]="disabled"
              min="0" />
          </div>
        </div>

        <div class="dm-columns">
          <fieldset class="dm-col">
            <legend class="dm-col__legend" i18n="@@accounting.monthly-declaration.montant.brut.6c8cf046">Montant brut</legend>

            <div class="dm-field">
              <label class="dm-lbl" for="dm-gross-kind" i18n="@@accounting.monthly-declaration.type.de.calcul.67778e9f">Type de calcul</label>
              <select id="dm-gross-kind" class="dm-inp" [(ngModel)]="f.grossKind" [disabled]="disabled">
                @for (o of grossKinds; track o.value) {
                  <option [ngValue]="o.value">{{ o.label }}</option>
                }
              </select>
            </div>

            @if (showGrossAccounts) {
              <div class="dm-field">
                <label class="dm-lbl" for="dm-gross-side" i18n="@@accounting.monthly-declaration.sens.55928a79">Sens</label>
                <select id="dm-gross-side" class="dm-inp" [(ngModel)]="f.grossSide" [disabled]="disabled">
                  @for (o of sides; track o.value) {
                    <option [ngValue]="o.value">{{ o.label }}</option>
                  }
                </select>
              </div>
              <div class="dm-field">
                <label class="dm-lbl" for="dm-gross-accounts" i18n="@@accounting.monthly-declaration.comptes.f778ac95">Comptes</label>
                <p-multiSelect
                  inputId="dm-gross-accounts"
                  [options]="accountOptions"
                  [(ngModel)]="f.grossAccounts.exact"
                  [ngModelOptions]="{ standalone: true }"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Choisir des comptes" i18n-placeholder="Choisir des comptes"
                  [filter]="true"
                  [disabled]="disabled"
                  display="chip"
                  appendTo="body"
                  styleClass="dm-ms" />
              </div>
              <div class="dm-field">
                <label class="dm-lbl" for="dm-gross-prefixes" i18n="@@accounting.monthly-declaration.racines.ac83d6b7">Racines</label>
                <input
                  id="dm-gross-prefixes"
                  class="dm-inp dm-mono"
                  [(ngModel)]="f.grossAccounts.prefixes"
                  [disabled]="disabled"
                  placeholder="Ex. 70;71" i18n-placeholder="Ex. 70;71" />
                <small class="dm-hint" i18n="@@accounting.monthly-declaration.le.compte.et.toute.sa.descendance.separees.par.a2e82592">Le compte et toute sa descendance. Séparées par « ; ».</small>
              </div>
            }

            @if (showPayrollComponent) {
              <div class="dm-field">
                <label class="dm-lbl" for="dm-payroll" i18n="@@accounting.monthly-declaration.valeur.de.paie.00856faf">Valeur de paie</label>
                <select id="dm-payroll" class="dm-inp" [(ngModel)]="f.payrollComponent" [disabled]="disabled">
                  <option [ngValue]="null" i18n="@@accounting.monthly-declaration.choisir.413c3acc">— Choisir —</option>
                  @for (o of payrollComponents; track o.value) {
                    <option [ngValue]="o.value">{{ o.label }}</option>
                  }
                </select>
              </div>
            }

            @if (showFixedGross) {
              <div class="dm-field">
                <label class="dm-lbl" for="dm-fixed-gross" i18n="@@accounting.monthly-declaration.valeur.fixe.84e10831">Valeur fixe</label>
                <input
                  id="dm-fixed-gross"
                  type="number"
                  step="0.001"
                  class="dm-inp"
                  [(ngModel)]="f.fixedGrossAmount"
                  [disabled]="disabled"
                  placeholder="Laisser vide pour saisir au Calcul DM" i18n-placeholder="Laisser vide pour saisir au Calcul DM" />
                <small class="dm-hint" i18n="@@accounting.monthly-declaration.vide.ne.vaut.pas.zero.la.ligne.attendra.une.sais.49c6d03c">Vide ne vaut pas zéro : la ligne attendra une saisie.</small>
              </div>
            }
          </fieldset>

          <fieldset class="dm-col">
            <legend class="dm-col__legend" i18n="@@accounting.monthly-declaration.retenue.88cf18f4">Retenue</legend>

            <div class="dm-field">
              <label class="dm-lbl" for="dm-withheld-kind" i18n="@@accounting.monthly-declaration.type.de.calcul.67778e9f">Type de calcul</label>
              <select id="dm-withheld-kind" class="dm-inp" [(ngModel)]="f.withheldKind" [disabled]="disabled">
                @for (o of withheldKinds; track o.value) {
                  <option [ngValue]="o.value">{{ o.label }}</option>
                }
              </select>
            </div>

            @if (showWithheldAccounts) {
              <div class="dm-field">
                <label class="dm-lbl" for="dm-withheld-side" i18n="@@accounting.monthly-declaration.sens.55928a79">Sens</label>
                <select id="dm-withheld-side" class="dm-inp" [(ngModel)]="f.withheldSide" [disabled]="disabled">
                  @for (o of sides; track o.value) {
                    <option [ngValue]="o.value">{{ o.label }}</option>
                  }
                </select>
              </div>
              <div class="dm-field">
                <label class="dm-lbl" for="dm-withheld-accounts" i18n="@@accounting.monthly-declaration.comptes.f778ac95">Comptes</label>
                <p-multiSelect
                  inputId="dm-withheld-accounts"
                  [options]="accountOptions"
                  [(ngModel)]="f.withheldAccounts.exact"
                  [ngModelOptions]="{ standalone: true }"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Choisir des comptes" i18n-placeholder="Choisir des comptes"
                  [filter]="true"
                  [disabled]="disabled"
                  display="chip"
                  appendTo="body"
                  styleClass="dm-ms" />
              </div>
              <div class="dm-field">
                <label class="dm-lbl" for="dm-withheld-prefixes" i18n="@@accounting.monthly-declaration.racines.ac83d6b7">Racines</label>
                <input
                  id="dm-withheld-prefixes"
                  class="dm-inp dm-mono"
                  [(ngModel)]="f.withheldAccounts.prefixes"
                  [disabled]="disabled"
                  placeholder="Ex. 436" i18n-placeholder="Ex. 436" />
                <small class="dm-hint" i18n="@@accounting.monthly-declaration.le.compte.et.toute.sa.descendance.separees.par.a2e82592">Le compte et toute sa descendance. Séparées par « ; ».</small>
              </div>
            }

            @if (showWithheldPayrollComponent) {
              <div class="dm-field">
                <label class="dm-lbl" for="dm-withheld-payroll" i18n="@@accounting.monthly-declaration.valeur.de.paie.00856faf">Valeur de paie</label>
                <select
                  id="dm-withheld-payroll"
                  class="dm-inp"
                  [(ngModel)]="f.withheldPayrollComponent"
                  [disabled]="disabled">
                  <option [ngValue]="null" i18n="@@accounting.monthly-declaration.choisir.413c3acc">— Choisir —</option>
                  @for (o of payrollComponents; track o.value) {
                    <option [ngValue]="o.value">{{ o.label }}</option>
                  }
                </select>
              </div>
            }

            @if (showFixedWithheld) {
              <div class="dm-field">
                <label class="dm-lbl" for="dm-fixed-withheld" i18n="@@accounting.monthly-declaration.valeur.fixe.84e10831">Valeur fixe</label>
                <input
                  id="dm-fixed-withheld"
                  type="number"
                  step="0.001"
                  class="dm-inp"
                  [(ngModel)]="f.fixedWithheldAmount"
                  [disabled]="disabled"
                  placeholder="Laisser vide pour saisir au Calcul DM" i18n-placeholder="Laisser vide pour saisir au Calcul DM" />
                <small class="dm-hint" i18n="@@accounting.monthly-declaration.vide.ne.vaut.pas.zero.la.ligne.attendra.une.sais.49c6d03c">Vide ne vaut pas zéro : la ligne attendra une saisie.</small>
              </div>
            }

            @if (showRate) {
              <div class="dm-field">
                <label class="dm-lbl" for="dm-rate" i18n="@@accounting.monthly-declaration.taux.bb9a8c5a">Taux (%)</label>
                <input
                  id="dm-rate"
                  type="number"
                  step="0.0001"
                  min="0"
                  max="100"
                  class="dm-inp dm-narrow"
                  [(ngModel)]="f.ratePercent"
                  [disabled]="disabled" />
              </div>
            }
          </fieldset>
        </div>

        <div class="dm-grid">
          <div class="dm-field">
            <label class="dm-lbl" for="dm-from" i18n="@@accounting.monthly-declaration.date.de.debut.706438ab">Date de début</label>
            <input id="dm-from" type="date" class="dm-inp" [(ngModel)]="f.effectiveFrom" [disabled]="disabled" />
          </div>
          <div class="dm-field">
            <label class="dm-lbl" for="dm-to" i18n="@@accounting.monthly-declaration.date.maximale.d.application.9f9a67dd">Date maximale d’application</label>
            <input id="dm-to" type="date" class="dm-inp" [(ngModel)]="f.effectiveTo" [disabled]="disabled" />
          </div>
          <small class="dm-hint dm-hint--block" i18n="@@accounting.monthly-declaration.la.rubrique.s.applique.au.mois.entier.de.la.date.0b581591"> La rubrique s’applique au mois entier de la date maximale : le formulaire officiel n’a pas
            de case pour un mois proratisé. </small>
        </div>

        @if (validationMessage; as message) {
          <p class="dm-invalid" role="status">{{ message }}</p>
        }

        <div class="dm-actions">
          <app-button variant="secondary" size="sm" type="button" [disabled]="saving" (click)="cancel.emit()" i18n="@@accounting.monthly-declaration.annuler.49ba3292"> Annuler </app-button>
          <app-button
            variant="primary"
            size="sm"
            type="button"
            [disabled]="saving || disabled || !!validationMessage"
            (click)="save.emit()">
            {{ saving ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
          </app-button>
        </div>
      </div>
    }
  `,
  styles: `
    .dm-form { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .dm-form__title { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .dm-grid { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-start; }
    .dm-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: var(--spacing-3); }
    .dm-col { border: 1px solid var(--color-border-default); border-radius: var(--radius-md); padding: var(--spacing-3); display: flex; flex-direction: column; gap: var(--spacing-3); margin: 0; }
    .dm-col__legend { padding: 0 var(--spacing-2); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .dm-field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 9rem; }
    .dm-grow { flex: 1 1 16rem; }
    .dm-narrow { max-width: 8rem; }
    .dm-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .dm-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .dm-mono { font-family: ui-monospace, monospace; }
    .dm-hint { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
    .dm-hint--block { flex-basis: 100%; }
    .dm-invalid { margin: 0; font-size: var(--font-size-sm); color: var(--color-danger-700, #b91c1c); }
    .dm-actions { display: flex; gap: var(--spacing-2); justify-content: flex-end; }
    :host ::ng-deep .dm-ms { width: 100%; }
  `
})
export class DmRubricFormComponent {
  readonly loc_ui_tern_modifier_la_rubrique_035400 = $localize`:@@ui.tern.modifier.la.rubrique.035400:Modifier la rubrique `;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  /** Brouillon modifié en place ; le conteneur en garde la propriété. */
  @Input({ required: true }) form!: DmRubricForm;
  @Input() accountOptions: DmOption<string>[] = [];
  @Input() saving = false;
  /** Lecture seule : l'appelant n'a pas le droit d'écrire la configuration du dossier. */
  @Input() disabled = false;

  @Output() readonly save = new EventEmitter<void>();
  @Output() readonly cancel = new EventEmitter<void>();

  readonly grossKinds = DM_GROSS_KIND_OPTIONS;
  readonly withheldKinds = DM_WITHHELD_KIND_OPTIONS;
  readonly sides = DM_SIDE_OPTIONS;
  readonly payrollComponents = DM_PAYROLL_COMPONENT_OPTIONS;

  get showGrossAccounts(): boolean {
    return needsGrossAccounts(this.form);
  }

  get showWithheldAccounts(): boolean {
    return needsWithheldAccounts(this.form);
  }

  get showPayrollComponent(): boolean {
    return needsPayrollComponent(this.form);
  }

  get showWithheldPayrollComponent(): boolean {
    return needsWithheldPayrollComponent(this.form);
  }

  get showRate(): boolean {
    return needsRate(this.form);
  }

  get showFixedGross(): boolean {
    return needsFixedGross(this.form);
  }

  get showFixedWithheld(): boolean {
    return needsFixedWithheld(this.form);
  }

  get validationMessage(): string | null {
    return validateRubricForm(this.form);
  }
}
