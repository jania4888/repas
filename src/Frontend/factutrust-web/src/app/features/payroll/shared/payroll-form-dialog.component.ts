import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonComponent } from '@shared/components/button/button.component';

@Component({
  selector: 'app-payroll-form-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonComponent],
  template: `
    <p-dialog
      [header]="title"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: width }"
      [draggable]="false"
      [resizable]="false"
      (onHide)="cancelled.emit()">
      <ng-content></ng-content>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="onCancel()" i18n="@@payroll.shared.annuler.49ba3292">Annuler</app-button>
        <app-button
          variant="primary"
          [disabled]="saveDisabled || saving"
          (click)="saved.emit()">
          {{ saveLabel }}
        </app-button>
      </ng-template>
    </p-dialog>
  `
})
export class PayrollFormDialogComponent {
  @Input({ required: true }) title = '';
  @Input() visible = false;
  @Input() width = '32rem';
  @Input() saveLabel = $localize`:@@payroll.payroll-form-dialog.ts.enregistrer.f7c8bcd8:Enregistrer`;
  @Input() saveDisabled = false;
  @Input() saving = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  onCancel(): void {
    this.visible = false;
    this.visibleChange.emit(false);
    this.cancelled.emit();
  }
}
