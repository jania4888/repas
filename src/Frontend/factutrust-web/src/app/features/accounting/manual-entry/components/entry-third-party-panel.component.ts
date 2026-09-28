import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AccountingService, ThirdPartyProfileDto } from '../../services/accounting.service';
import { ClientService } from '@core/services/client.service';
import { SupplierService } from '@core/services/supplier.service';
import { ThirdPartyRef } from '../models/entry-form.model';
import { forkJoin, of, catchError } from 'rxjs';

interface ThirdPartyCard {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  auxiliaryCode?: string | null;
  collectiveAccount?: string;
  paymentTermDays?: number | null;
  profileRoute: string | null;
}

@Component({
  selector: 'app-entry-third-party-panel',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    @if (card()) {
      <aside class="tp-panel card" aria-labelledby="tp-title">
        <h3 id="tp-title" class="tp-panel__title" i18n="@@accounting.manual-entry.auxiliaire.b8c6c266">Auxiliaire</h3>
        <p class="tp-panel__name">{{ card()!.name }}</p>
        @if (card()!.address) {
          <p class="tp-panel__detail">{{ card()!.address }}</p>
        }
        @if (card()!.phone) {
          <p class="tp-panel__detail">📞 {{ card()!.phone }}</p>
        }
        @if (card()!.auxiliaryCode) {
          <p class="tp-panel__detail"><strong i18n="@@accounting.manual-entry.code.19095fe2">Code :</strong> {{ card()!.auxiliaryCode }}</p>
        }
        @if (card()!.collectiveAccount) {
          <p class="tp-panel__detail"><strong i18n="@@accounting.manual-entry.collectif.66626f9f">Collectif :</strong> {{ card()!.collectiveAccount }}</p>
        }
        @if (card()!.paymentTermDays != null) {
          <p class="tp-panel__detail" i18n="@@accounting.manual-entry.delai.jours.05ef8b72"><strong>Délai :</strong> {{ card()!.paymentTermDays }} jours</p>
        }
        @if (card()!.profileRoute) {
          <a [routerLink]="card()!.profileRoute" class="tp-panel__link" i18n="@@accounting.manual-entry.voir.la.fiche.622736cd">Voir la fiche →</a>
        }
      </aside>
    }
  `,
  styles: `
    :host { display:contents; }
    .tp-panel { padding:var(--spacing-4); margin-bottom:0; }
    .tp-panel__title { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); margin:0 0 var(--spacing-2); text-transform:uppercase; color:var(--color-text-secondary); }
    .tp-panel__name { font-weight:var(--font-weight-semibold); margin:0 0 var(--spacing-2); }
    .tp-panel__detail { font-size:var(--font-size-sm); color:var(--color-text-secondary); margin:0 0 var(--spacing-1); }
    .tp-panel__link { display:inline-block; margin-top:var(--spacing-2); font-size:var(--font-size-sm); color:var(--color-primary-600); }
  `
})
export class EntryThirdPartyPanelComponent implements OnChanges {
  @Input() thirdParty: ThirdPartyRef | null = null;

  private readonly accounting = inject(AccountingService);
  private readonly clientService = inject(ClientService);
  private readonly supplierService = inject(SupplierService);

  readonly card = signal<ThirdPartyCard | null>(null);

  ngOnChanges(): void {
    if (!this.thirdParty) {
      this.card.set(null);
      return;
    }
    this.loadCard(this.thirdParty);
  }

  private loadCard(tp: ThirdPartyRef): void {
    const crm$ = tp.kind === 1
      ? this.clientService.getClient(tp.id).pipe(catchError(() => of(null)))
      : this.supplierService.getSupplier(tp.id).pipe(catchError(() => of(null)));
    const profile$ = this.accounting.getThirdPartyProfile(tp.kind, tp.id).pipe(catchError(() => of(null)));

    forkJoin({ crm: crm$, profile: profile$ }).subscribe(({ crm, profile }) => {
      const data = crm?.data;
      const prof: ThirdPartyProfileDto | undefined = profile?.success ? profile.data : undefined;
      const paymentDays = prof?.paymentTermDays
        ?? (data as { defaultPaymentTermDays?: number })?.defaultPaymentTermDays
        ?? (data as { paymentTermDays?: number })?.paymentTermDays;
      this.card.set({
        name: data?.name ?? tp.name,
        address: formatAddress(data?.address),
        phone: data?.phone ?? undefined,
        email: data?.email ?? undefined,
        auxiliaryCode: prof?.auxiliaryCode ?? null,
        collectiveAccount: prof?.collectiveAccountNumber,
        paymentTermDays: paymentDays,
        profileRoute: tp.kind === 1 ? `/clients/${tp.id}` : `/suppliers/${tp.id}`
      });
    });
  }
}

function formatAddress(addr: { street?: string; city?: string; governorate?: string } | undefined): string | undefined {
  if (!addr) return undefined;
  const parts = [addr.street, addr.city, addr.governorate].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}
