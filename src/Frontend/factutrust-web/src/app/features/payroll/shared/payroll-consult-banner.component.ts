import { Component, Input } from '@angular/core';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-payroll-consult-banner',
  standalone: true,
  imports: [MessageModule],
  template: `
    @if (visible) {
      <p-message
        severity="info"
        [text]="message"
        styleClass="mb-3 w-full" />
    }
  `
})
export class PayrollConsultBannerComponent {
  @Input() visible = false;
  @Input() message = $localize`:@@payroll.payroll-consult-banner.ts.mode.consultation.certaines.actions.sont.a9976490:Mode consultation — certaines actions sont réservées à la société cliente.`;
}
