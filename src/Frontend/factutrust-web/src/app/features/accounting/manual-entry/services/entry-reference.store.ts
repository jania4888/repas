import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { catchError, forkJoin, map, of } from 'rxjs';
import {
  AccountingService,
  AccountingPeriodDto,
  ChartOfAccountDto,
  CurrencyDto,
  JournalDto
} from '../../services/accounting.service';
import { TaxService, VatRateOption } from '@core/services/tax.service';
import { BankAccountService, BankAccountDto } from '@core/services/bank-account.service';
import { ClientService } from '@core/services/client.service';
import { SupplierService } from '@core/services/supplier.service';
import { ThirdPartyRef } from '../models/entry-form.model';
import { buildDefaultVatRateOptions } from './vat-rate-fallback';

/**
 * Libellé affiché d'un tiers dans la colonne « Auxiliaire » : « Client — X » / « Fournisseur — X ».
 * Sans nom, on retombe sur le seul type, jamais sur le code numérique.
 */
export function buildThirdPartyDisplay(kind: number, name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (kind === 1) {
    return trimmed
      ? $localize`:@@accounting.entry-reference.ts.client.name.9124c16d:Client — ${trimmed}:name:`
      : $localize`:@@ui.tern.client.1bdd79:Client`;
  }
  return trimmed
    ? $localize`:@@accounting.entry-reference.ts.fournisseur.name.a20a36f3:Fournisseur — ${trimmed}:name:`
    : $localize`:@@ui.tern.fournisseur.97d91d:Fournisseur`;
}

export interface AccountSuggestion {
  number: string;
  label: string;
  display: string;
}

@Injectable()
export class EntryReferenceStore {
  private readonly api = inject(AccountingService);
  private readonly taxService = inject(TaxService);
  private readonly bankService = inject(BankAccountService);
  private readonly clientService = inject(ClientService);
  private readonly supplierService = inject(SupplierService);
  private readonly destroyRef = inject(DestroyRef);

  readonly accounts = signal<ChartOfAccountDto[]>([]);
  readonly periods = signal<AccountingPeriodDto[]>([]);
  readonly journals = signal<JournalDto[]>([]);
  readonly vatRates = signal<VatRateOption[]>([]);
  readonly vatRatesFromFallback = signal(false);
  readonly bankAccounts = signal<BankAccountDto[]>([]);

  /**
   * Devises actives du catalogue, taux de l'exercice de la date du jour compris. Chargées même
   * quand le multi-devises est éteint : la liste est alors simplement réduite à la devise de tenue,
   * et rien ne l'expose dans l'interface.
   */
  readonly currencies = signal<CurrencyDto[]>([]);
  readonly loading = signal(true);
  /** Vrai quand le plan comptable n'a pas pu être chargé (erreur réseau ou réponse en échec). */
  readonly accountsLoadFailed = signal(false);
  readonly accountSuggestions = signal<AccountSuggestion[]>([]);
  readonly thirdPartySuggestions = signal<ThirdPartyRef[]>([]);

  loadAll(): void {
    this.loading.set(true);
    this.accountsLoadFailed.set(false);
    forkJoin({
      accounts: this.api.getChartOfAccounts().pipe(catchError(() => of(null))),
      periods: this.api.getPeriods().pipe(catchError(() => of(null))),
      journals: this.api.getJournals().pipe(catchError(() => of(null))),
      vatRates: this.taxService.getVatRates({ skipGlobalErrorUi: true }).pipe(catchError(() => of(null))),
      banks: this.bankService.list().pipe(catchError(() => of(null))),
      currencies: this.api.getCurrencies(new Date().getFullYear()).pipe(catchError(() => of(null)))
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ accounts, periods, journals, vatRates, banks, currencies }) => {
          if (accounts?.success && accounts.data) {
            this.accounts.set(accounts.data);
          } else {
            this.accountsLoadFailed.set(true);
          }
          if (periods?.success && periods.data) this.periods.set(periods.data);
          if (journals?.success && journals.data) this.journals.set(journals.data);
          if (vatRates?.success && vatRates.data?.length) {
            this.vatRates.set(vatRates.data);
            this.vatRatesFromFallback.set(false);
          } else {
            this.vatRates.set(buildDefaultVatRateOptions());
            this.vatRatesFromFallback.set(true);
          }
          if (banks?.success && banks.data) this.bankAccounts.set(banks.data.filter(b => b.isActive));
          if (currencies?.success && currencies.data) this.currencies.set(currencies.data.filter(c => c.isActive));
          this.loading.set(false);
        },
        error: () => {
          this.accountsLoadFailed.set(true);
          this.loading.set(false);
        }
      });
  }

  filterAccounts(query: string, limit = 20): AccountSuggestion[] {
    const q = query.toLowerCase();
    return this.accounts()
      .filter(a => a.isActive && (a.accountNumber.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)))
      .map(a => ({ number: a.accountNumber, label: a.label, display: `${a.accountNumber} — ${a.label}` }))
      .slice(0, limit);
  }

  resolveAccount(candidates: readonly string[]): string | null {
    const plan = this.accounts();
    for (const c of candidates) {
      const found = plan.find(a => a.accountNumber === c && a.isActive);
      if (found) return found.accountNumber;
    }
    return null;
  }

  findAccountByNumber(number: string): ChartOfAccountDto | undefined {
    return this.accounts().find(a => a.accountNumber === number);
  }

  searchThirdParties(search: string): void {
    const term = search.trim();
    if (term.length < 2) {
      this.thirdPartySuggestions.set([]);
      return;
    }
    forkJoin({
      clients: this.clientService.getClients({ search: term, isActive: true, page: 1, pageSize: 10, skipGlobalErrorUi: true })
        .pipe(catchError(() => of(null))),
      suppliers: this.supplierService.getSuppliers({ search: term, isActive: true, page: 1, pageSize: 10, skipGlobalErrorUi: true })
        .pipe(catchError(() => of(null)))
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map(({ clients, suppliers }) => {
          const out: ThirdPartyRef[] = [];
          for (const c of clients?.data?.items ?? []) {
            out.push({ id: c.id, kind: 1, name: c.name, display: buildThirdPartyDisplay(1, c.name) });
          }
          for (const s of suppliers?.data?.items ?? []) {
            out.push({ id: s.id, kind: 2, name: s.name, display: buildThirdPartyDisplay(2, s.name) });
          }
          return out;
        })
      )
      .subscribe(suggestions => this.thirdPartySuggestions.set(suggestions));
  }

  journalOptions(): { code: string; label: string }[] {
    const j = this.journals();
    if (j.length === 0) return [];
    return j.map(x => ({ code: x.code, label: x.label }));
  }

  openPeriods(): AccountingPeriodDto[] {
    return this.periods().filter(p => !p.isClosed);
  }
}
