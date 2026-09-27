import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type StatusBadgeStatus =
  | 'paid'
  | 'partial'
  | 'pending'
  | 'overdue'
  | 'draft'
  | 'sent'
  | 'cancelled'
  | 'validated'
  | 'signed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted'
  | 'active'
  | 'inactive';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="status-badge status-{{ status }}" [attr.aria-label]="label || getStatusLabel()">
      @if (showIcon) {
        <i class="pi {{ getStatusIcon() }}"></i>
      }
      <span>{{ label ?? getStatusLabel() }}</span>
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
  `]
})
export class StatusBadgeComponent {
  @Input() status: StatusBadgeStatus = 'draft';
  @Input() label?: string;
  @Input() showIcon = true;

  private static readonly icons: Record<StatusBadgeStatus, string> = {
    paid: 'pi-check-circle',
    partial: 'pi-wallet',
    pending: 'pi-clock',
    overdue: 'pi-exclamation-triangle',
    draft: 'pi-file-edit',
    sent: 'pi-send',
    cancelled: 'pi-times-circle',
    validated: 'pi-verified',
    signed: 'pi-pencil',
    accepted: 'pi-check',
    rejected: 'pi-times',
    expired: 'pi-calendar-times',
    converted: 'pi-refresh',
    active: 'pi-check-circle',
    inactive: 'pi-ban'
  };

  private static readonly labels: Record<StatusBadgeStatus, string> = {
    paid: 'Payée',
    partial: 'Partiellement payée',
    pending: 'En attente',
    overdue: 'En retard',
    draft: 'Brouillon',
    sent: 'Envoyée',
    cancelled: 'Annulée',
    validated: 'Validée',
    signed: 'Signée',
    accepted: 'Acceptée',
    rejected: 'Rejetée',
    expired: 'Expirée',
    converted: 'Convertie',
    active: 'Actif',
    inactive: 'Inactif'
  };

  getStatusIcon(): string {
    return StatusBadgeComponent.icons[this.status] ?? 'pi-circle';
  }

  getStatusLabel(): string {
    return StatusBadgeComponent.labels[this.status] ?? $localize`:@@ui.tern.inconnu.f3cfc6:Inconnu`;
  }
}
