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
    paid: $localize`:@@shared.status-badge.ts.payee.65b240e8:Payée`,
    partial: $localize`:@@shared.status-badge.ts.partiellement.payee.25cdcffb:Partiellement payée`,
    pending: $localize`:@@shared.status-badge.ts.en.attente.5231158f:En attente`,
    overdue: $localize`:@@shared.status-badge.ts.en.retard.40c1dde3:En retard`,
    draft: $localize`:@@shared.status-badge.ts.brouillon.57d2d7a7:Brouillon`,
    sent: $localize`:@@shared.status-badge.ts.envoyee.a1eb6342:Envoyée`,
    cancelled: $localize`:@@shared.status-badge.ts.annulee.2776573b:Annulée`,
    validated: $localize`:@@shared.status-badge.ts.validee.2cc6c327:Validée`,
    signed: $localize`:@@shared.status-badge.ts.signee.be13d5cd:Signée`,
    accepted: $localize`:@@shared.status-badge.ts.acceptee.8f379d6f:Acceptée`,
    rejected: $localize`:@@shared.status-badge.ts.rejetee.cf97717e:Rejetée`,
    expired: $localize`:@@shared.status-badge.ts.expiree.1f0808dc:Expirée`,
    converted: $localize`:@@shared.status-badge.ts.convertie.584f5354:Convertie`,
    active: $localize`:@@shared.status-badge.ts.actif.2eb75f84:Actif`,
    inactive: $localize`:@@shared.status-badge.ts.inactif.d2e03387:Inactif`
  };

  getStatusIcon(): string {
    return StatusBadgeComponent.icons[this.status] ?? 'pi-circle';
  }

  getStatusLabel(): string {
    return StatusBadgeComponent.labels[this.status] ?? $localize`:@@ui.tern.inconnu.f3cfc6:Inconnu`;
  }
}
