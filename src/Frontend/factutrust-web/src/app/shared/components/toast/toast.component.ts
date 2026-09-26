import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 9999;">
      @for (msg of toastService.messagesValue; track msg.id!) {
        <div class="toast-item alert alert-dismissible fade show" [ngClass]="getAlertClass(msg)" role="alert">
          <strong *ngIf="msg.summary">{{ msg.summary }}: </strong>{{ msg.detail }}
          <button type="button" class="btn-close" (click)="toastService.remove(msg.id!)" aria-label="Fermer" i18n-aria-label="Fermer"></button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-item {
      min-width: 280px;
      max-width: 400px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
  `]
})
export class ToastComponent {
  toastService = inject(ToastService);

  getAlertClass(msg: { severity?: string }): string {
    const severity = msg.severity ?? 'info';
    const map: Record<string, string> = {
      success: 'alert-success',
      info: 'alert-info',
      warn: 'alert-warning',
      error: 'alert-danger'
    };
    return map[severity] ?? 'alert-info';
  }
}
