import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  FISCAL_OBLIGATION_OPTIONS,
  MONTH_OPTIONS,
  QUARTER_OPTIONS
} from './fiscal-schedule.view-model';
import { FISCAL_SCHEDULE_SHARED_STYLES } from './fiscal-schedule-shared.styles';

@Component({
  selector: 'app-fiscal-schedule-entry-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div
      class="fiscal-modal-backdrop"
      *ngIf="open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fiscal-entry-dialog-title">
      <form class="fiscal-modal" [formGroup]="form" (ngSubmit)="save.emit()">
        <header>
          <h2 id="fiscal-entry-dialog-title">{{ editing ? loc_ui_tern_modifier_une_echeance_02f156 : loc_ui_tern_nouvelle_echeance_fiscale_6a2c06 }}</h2>
          <button class="square-button" type="button" title="Fermer" i18n-title="@@accounting.fiscal-schedule.fermer.5ab4ec64" (click)="cancel.emit()"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="fiscal-modal-grid">
          <label>
            <ng-container i18n="@@accounting.fiscal-schedule.type.d.obligation.790fbe09"> Type d'obligation </ng-container>
            <select formControlName="obligationType" (change)="obligationTypeChange.emit()">
              <option *ngFor="let option of obligationOptions" [ngValue]="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label>
            <ng-container i18n="@@accounting.fiscal-schedule.libelle.bb39bab2"> Libelle </ng-container>
            <input formControlName="obligationLabel">
            <span class="field-error" *ngIf="form.get('obligationLabel')?.invalid && form.get('obligationLabel')?.touched" i18n="@@accounting.fiscal-schedule.libelle.obligatoire.200.caracteres.max.acbc878e">Libelle obligatoire (200 caracteres max).</span>
          </label>
          <label>
            <ng-container i18n="@@accounting.fiscal-schedule.exercice.e171e2b0"> Exercice </ng-container>
            <input formControlName="fiscalYear" type="number" min="2000" max="2100">
          </label>
          <label *ngIf="!showQuarterField">
            <ng-container i18n="@@accounting.fiscal-schedule.mois.0d304bea"> Mois </ng-container>
            <select formControlName="periodMonth">
              <option [ngValue]="null" i18n="@@accounting.fiscal-schedule.aucun.b2ed82f1">Aucun</option>
              <option *ngFor="let month of months" [ngValue]="month.value">{{ month.label }}</option>
            </select>
          </label>
          <label *ngIf="showQuarterField">
            <ng-container i18n="@@accounting.fiscal-schedule.trimestre.13116972"> Trimestre </ng-container>
            <select formControlName="periodQuarter">
              <option [ngValue]="null" i18n="@@accounting.fiscal-schedule.selectionner.3888de7d">Selectionner</option>
              <option *ngFor="let quarter of quarters" [ngValue]="quarter.value">{{ quarter.label }}</option>
            </select>
            <span class="field-error" *ngIf="form.hasError('periodQuarterRequired') && form.touched" i18n="@@accounting.fiscal-schedule.trimestre.obligatoire.pour.la.tva.trimestrielle.8ef8f3dd">Trimestre obligatoire pour la TVA trimestrielle.</span>
          </label>
          <label>
            <ng-container i18n="@@accounting.fiscal-schedule.date.d.echeance.e0e8b824"> Date d'echeance </ng-container>
            <input formControlName="dueDate" type="date">
          </label>
          <label>
            <ng-container i18n="@@accounting.fiscal-schedule.montant.estime.b496eba3"> Montant estime </ng-container>
            <input formControlName="estimatedAmount" type="number" min="0" step="0.001">
          </label>
          <label>
            <ng-container i18n="@@accounting.fiscal-schedule.responsable.44b58814"> Responsable </ng-container>
            <input formControlName="responsibleName">
          </label>
          <label class="wide">
            <ng-container i18n="@@accounting.fiscal-schedule.observations.461ebaa1"> Observations </ng-container>
            <textarea formControlName="observations" rows="3"></textarea>
          </label>
          <p class="field-error wide" *ngIf="form.hasError('periodConflict') && form.touched" i18n="@@accounting.fiscal-schedule.indiquez.un.mois.ou.un.trimestre.pas.les.deux.abd83ce3">Indiquez un mois ou un trimestre, pas les deux.</p>
        </div>
        <footer>
          <button class="icon-button" type="button" (click)="cancel.emit()" i18n="@@accounting.fiscal-schedule.annuler.49ba3292">Annuler</button>
          <button class="icon-button primary" type="submit" [disabled]="saving">
            <i class="fa-solid fa-floppy-disk"></i><span i18n="@@accounting.fiscal-schedule.enregistrer.f7c8bcd8">Enregistrer</span>
          </button>
        </footer>
      </form>
    </div>
  `,
  styles: [FISCAL_SCHEDULE_SHARED_STYLES, `
    .fiscal-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1400;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, .45);
      padding: 20px;
    }
    .fiscal-modal {
      display: block;
      width: min(760px, 100%);
      max-height: 92vh;
      overflow: auto;
      background: #fff;
      border-radius: 8px;
      border: 1px solid #d8dee8;
      box-shadow: 0 20px 60px rgba(15, 23, 42, .25);
    }
    .fiscal-modal header,
    .fiscal-modal footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid #e7ecf3;
    }
    .fiscal-modal footer { justify-content: flex-end; border-top: 1px solid #e7ecf3; border-bottom: 0; }
    .fiscal-modal h2 { margin: 0; font-size: 16px; }
    .fiscal-modal-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 16px;
    }
    .wide { grid-column: 1 / -1; }
    .field-error { color: #b42318; font-size: 11px; font-weight: 600; }
    @media (max-width: 720px) {
      .fiscal-modal-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class FiscalScheduleEntryDialogComponent {
  readonly loc_ui_tern_modifier_une_echeance_02f156 = $localize`:@@ui.tern.modifier.une.echeance.02f156:Modifier une echeance`;
  readonly loc_ui_tern_nouvelle_echeance_fiscale_6a2c06 = $localize`:@@ui.tern.nouvelle.echeance.fiscale.6a2c06:Nouvelle echeance fiscale`;
  @Input() open = false;
  @Input() editing = false;
  @Input() form!: FormGroup;
  @Input() showQuarterField = false;
  @Input() saving = false;

  @Output() save = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() obligationTypeChange = new EventEmitter<void>();

  readonly obligationOptions = FISCAL_OBLIGATION_OPTIONS;
  readonly months = MONTH_OPTIONS;
  readonly quarters = QUARTER_OPTIONS;
}
