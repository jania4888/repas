import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FISCAL_REMINDER_CHANNEL_OPTIONS } from './fiscal-schedule.view-model';
import { FISCAL_SCHEDULE_SHARED_STYLES } from './fiscal-schedule-shared.styles';

export type FiscalWorkflowMode = 'deposit' | 'payment' | 'reminder' | 'validate';

@Component({
  selector: 'app-fiscal-schedule-workflow-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="fiscal-modal-backdrop"
      *ngIf="open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fiscal-workflow-dialog-title">
      <form class="fiscal-modal fiscal-modal--narrow" (ngSubmit)="submit.emit()">
        <header>
          <h2 id="fiscal-workflow-dialog-title">{{ title }}</h2>
          <button class="square-button" type="button" title="Fermer" i18n-title="@@accounting.fiscal-schedule.fermer.5ab4ec64" (click)="cancel.emit()"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <label *ngIf="mode === 'deposit'">
          <ng-container i18n="@@accounting.fiscal-schedule.date.de.depot.a4aa4224"> Date de depot </ng-container>
          <input name="depositDate" type="date" required [(ngModel)]="workflowDate">
        </label>
        <label *ngIf="mode === 'payment'">
          <ng-container i18n="@@accounting.fiscal-schedule.date.de.paiement.bd0020ef"> Date de paiement </ng-container>
          <input name="paymentDate" type="date" required [(ngModel)]="workflowDate">
        </label>
        <label *ngIf="mode === 'validate'">
          <ng-container i18n="@@accounting.fiscal-schedule.date.de.validation.a3a6e7af"> Date de validation </ng-container>
          <input name="validatedDate" type="date" required [(ngModel)]="workflowDate">
        </label>
        <label *ngIf="mode === 'reminder'">
          <ng-container i18n="@@accounting.fiscal-schedule.canal.61f21e6f"> Canal </ng-container>
          <select name="reminderChannel" [(ngModel)]="reminderChannel">
            <option *ngFor="let option of reminderChannels" [ngValue]="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label *ngIf="mode === 'reminder'">
          <ng-container i18n="@@accounting.fiscal-schedule.date.du.rappel.ca97806b"> Date du rappel </ng-container>
          <input name="reminderAt" type="datetime-local" [(ngModel)]="workflowDateTime">
        </label>
        <label>
          <ng-container i18n="@@accounting.fiscal-schedule.observations.461ebaa1"> Observations </ng-container>
          <textarea name="workflowNotes" rows="3" [(ngModel)]="workflowObservations"></textarea>
        </label>
        <footer>
          <button class="icon-button" type="button" (click)="cancel.emit()" i18n="@@accounting.fiscal-schedule.annuler.49ba3292">Annuler</button>
          <button class="icon-button primary" type="submit" [disabled]="saving">
            <i class="fa-solid fa-check"></i><span i18n="@@accounting.fiscal-schedule.valider.be4220f7">Valider</span>
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
    .fiscal-modal--narrow {
      width: min(440px, 100%);
      background: #fff;
      border-radius: 8px;
      border: 1px solid #d8dee8;
      box-shadow: 0 20px 60px rgba(15, 23, 42, .25);
      display: grid;
      gap: 14px;
      padding-bottom: 14px;
    }
    .fiscal-modal--narrow header,
    .fiscal-modal--narrow footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid #e7ecf3;
    }
    .fiscal-modal--narrow footer { justify-content: flex-end; border-top: 1px solid #e7ecf3; border-bottom: 0; }
    .fiscal-modal--narrow h2 { margin: 0; font-size: 16px; }
    .fiscal-modal--narrow label { padding: 0 16px; }
  `]
})
export class FiscalScheduleWorkflowDialogComponent {
  @Input() open = false;
  @Input() mode: FiscalWorkflowMode = 'deposit';
  @Input() saving = false;
  @Input() workflowDate = '';
  @Input() workflowDateTime = '';
  @Input() workflowObservations = '';
  @Input() reminderChannel = 0;

  @Output() submit = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  readonly reminderChannels = FISCAL_REMINDER_CHANNEL_OPTIONS;

  get title(): string {
    switch (this.mode) {
      case 'payment': return $localize`:@@accounting.fiscal-schedule-workflow-dialog.ts.saisir.le.paiement.79ab0d86:Saisir le paiement`;
      case 'reminder': return $localize`:@@accounting.fiscal-schedule-workflow-dialog.ts.planifier.un.rappel.3fb10fc8:Planifier un rappel`;
      case 'validate': return 'Marquer comme validee';
      default: return 'Marquer comme deposee';
    }
  }
}
