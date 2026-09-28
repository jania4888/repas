import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';
import { FISCAL_SCHEDULE_SHARED_STYLES } from './fiscal-schedule-shared.styles';

@Component({
  selector: 'app-fiscal-schedule-footer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <footer class="fiscal-footer">
      <button class="icon-button" type="button" (click)="close.emit()">
        <i class="fa-solid fa-xmark"></i><span i18n="@@accounting.fiscal-schedule.fermer.5ab4ec64">Fermer</span>
      </button>
      <button class="icon-button primary" type="button" (click)="newReminder.emit()">
        <i class="fa-regular fa-bell"></i><span i18n="@@accounting.fiscal-schedule.nouveau.rappel.117c6b5b">Nouveau rappel</span>
      </button>
    </footer>
  `,
  styles: [FISCAL_SCHEDULE_SHARED_STYLES, `
    .fiscal-footer {
      position: sticky;
      bottom: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 16px;
      padding: 12px 16px;
      border: 1px solid #d8dee8;
      border-radius: 6px;
      background: #fff;
      box-shadow: 0 -4px 16px rgba(15, 23, 42, .06);
    }
  `]
})
export class FiscalScheduleFooterComponent {
  @Output() close = new EventEmitter<void>();
  @Output() newReminder = new EventEmitter<void>();
}
