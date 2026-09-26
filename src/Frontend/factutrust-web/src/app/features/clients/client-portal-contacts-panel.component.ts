import { Component, Input, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { ToastService } from '@core/services/toast.service';
import { ClientPortalContact, PortalService } from '@features/portal/portal.service';

@Component({
  selector: 'app-client-portal-contacts-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, TableModule, InputTextModule, DatePipe],
  template: `
    <p i18n="@@clients.client-portal-contacts-panel.invitez.un.contact.pour.qu.il.consulte.ses.factu.aa0aa605">Invitez un contact pour qu’il consulte ses factures dans l’espace client.</p>
    <form class="invite" (ngSubmit)="invite()">
      <input pInputText [(ngModel)]="email" name="email" placeholder="Email" i18n-placeholder="Email" />
      <input pInputText [(ngModel)]="firstName" name="firstName" placeholder="Prénom" i18n-placeholder="Prénom" />
      <input pInputText [(ngModel)]="lastName" name="lastName" placeholder="Nom" i18n-placeholder="Nom" />
      <p-button type="submit" label="Inviter" [loading]="busy()" />
    </form>
    <p-table [value]="contacts()" [loading]="loading()">
      <ng-template pTemplate="header">
        <tr><th i18n="@@clients.client-portal-contacts-panel.contact.b37456c4">Contact</th><th i18n="@@clients.client-portal-contacts-panel.email.84add5b2">Email</th><th i18n="@@clients.client-portal-contacts-panel.statut.659499f3">Statut</th><th i18n="@@clients.client-portal-contacts-panel.dernier.acces.6e683cc4">Dernier accès</th><th></th></tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr>
          <td>{{ c.displayName }}</td>
          <td>{{ c.email }}</td>
          <td>{{ c.statusDisplay }}</td>
          <td>{{ c.lastAccessAt | date:'dd/MM/yyyy HH:mm' }}</td>
          <td>
            @if (c.status !== 'Revoked') {
              <p-button label="Renvoyer" size="small" [text]="true" (onClick)="resend(c)" />
              <p-button label="Révoquer" size="small" severity="danger" [text]="true" (onClick)="revoke(c)" />
            }
          </td>
        </tr>
      </ng-template>
    </p-table>
  `,
  styles: [`.invite { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 1rem; }`]
})
export class ClientPortalContactsPanelComponent {
  private readonly portal = inject(PortalService);
  private readonly toast = inject(ToastService);

  @Input({ required: true }) clientId!: string;

  readonly contacts = signal<ClientPortalContact[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  email = '';
  firstName = '';
  lastName = '';

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.portal.listContacts(this.clientId).subscribe({
      next: rows => {
        this.contacts.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  invite(): void {
    this.busy.set(true);
    this.portal.inviteContact(this.clientId, {
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.email = this.firstName = this.lastName = '';
        this.toast.add({ severity: 'success', summary: 'Invitation envoyée' });
        this.reload();
      },
      error: err => {
        this.busy.set(false);
        this.toast.add({
          severity: 'error',
          summary: 'Invitation impossible',
          detail: err?.error?.errors?.[0] || err?.message
        });
      }
    });
  }

  resend(c: ClientPortalContact): void {
    this.portal.resendInvite(this.clientId, c.id).subscribe({
      next: () => this.toast.add({ severity: 'success', summary: 'Invitation renvoyée' })
    });
  }

  revoke(c: ClientPortalContact): void {
    this.portal.revokeContact(this.clientId, c.id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Accès révoqué' });
        this.reload();
      }
    });
  }
}
