import { Component, EventEmitter, Input, Output, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PROJECT_TASK_STATUS_OPTIONS, ProjectTaskStatusCode } from '../project-enums';

export interface ProjectStatusChangePayload {
  status: ProjectTaskStatusCode;
  comment: string;
  notifyCollaborators: boolean;
}

@Component({
  selector: 'app-project-status-change-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, SelectModule, Textarea, CheckboxModule, ButtonComponent],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      header="Modifier le statut de la tâche" i18n-header="@@projects.components.modifier.le.statut.de.la.tache.21dd934f"
      [style]="{ width: '32rem' }"
      [draggable]="false"
      (onHide)="cancel.emit()">
      <p class="task-create-intro" i18n="@@projects.components.selectionnez.un.nouveau.statut.et.ajoutez.un.com.7f152ef9">Sélectionnez un nouveau statut et ajoutez un commentaire si nécessaire.</p>

      <div class="task-create-form">
        <div class="task-create-field">
          <label for="status-change-target"><ng-container i18n="@@projects.components.nouveau.statut.3e47f423">Nouveau statut </ng-container> <span class="ft-required" i18n="@@projects.components.text.df58248c">*</span></label>
          <p-select
            inputId="status-change-target"
            class="w-full"
            [options]="statusOptions"
            [(ngModel)]="targetStatus"
            optionLabel="label"
            optionValue="value"
            appendTo="body" />
        </div>

        <div class="task-create-field">
          <label for="status-change-comment" i18n="@@projects.components.commentaire.bcb916ab">Commentaire</label>
          <div class="status-change-comment">
            <textarea
              id="status-change-comment"
              pTextarea
              class="w-full"
              [(ngModel)]="comment"
              rows="4"
              maxlength="500"
              placeholder="Justification du changement…" i18n-placeholder="@@projects.components.justification.du.changement.37acd745"></textarea>
            <span class="status-change-comment__count">{{ comment.length }}/500</span>
          </div>
        </div>

        <div class="status-change-notify">
          <p-checkbox [(ngModel)]="notifyCollaborators" [binary]="true" inputId="notifyCollab" />
          <label for="notifyCollab" i18n="@@projects.components.notifier.les.collaborateurs.concernes.51a55247">Notifier les collaborateurs concernés</label>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (click)="visible = false; cancel.emit()" i18n="@@projects.components.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="confirm()" i18n="@@projects.components.confirmer.le.changement.58e2f7cb">Confirmer le changement</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .task-create-intro {
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: 1.5;
    }

    .task-create-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .task-create-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .task-create-field > label {
      font-size: var(--font-size-sm);
      font-weight: 400;
      color: var(--color-text-secondary);
    }

    .status-change-comment {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .status-change-comment__count {
      align-self: flex-end;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .status-change-notify {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .status-change-notify label {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      cursor: pointer;
    }
  `]
})
export class ProjectStatusChangeDialogComponent implements OnChanges {
  @Input() visible = false;
  @Input() currentStatus: ProjectTaskStatusCode = 'Todo';
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() confirmChange = new EventEmitter<ProjectStatusChangePayload>();
  @Output() cancel = new EventEmitter<void>();

  targetStatus: ProjectTaskStatusCode = 'InProgress';
  comment = '';
  notifyCollaborators = true;
  readonly statusOptions = PROJECT_TASK_STATUS_OPTIONS.filter(o => o.value !== 'Cancelled');

  ngOnChanges(): void {
    this.targetStatus = this.currentStatus;
  }

  confirm(): void {
    if ((this.targetStatus === 'Waiting' || this.targetStatus === 'Done') && !this.comment.trim()) {
      return;
    }
    this.confirmChange.emit({
      status: this.targetStatus,
      comment: this.comment.trim(),
      notifyCollaborators: this.notifyCollaborators
    });
    this.visible = false;
    this.visibleChange.emit(false);
  }
}
