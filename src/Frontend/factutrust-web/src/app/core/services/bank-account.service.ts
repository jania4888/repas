import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { ApiResponse } from './client.service';

export interface TunisianBankReference {
  code: string;
  name: string;
  defaultSwiftBic: string | null;
}

export interface BankAccountDto {
  id: string;
  companyId: string;
  bankCode: string;
  bankName: string;
  designation: string | null;
  agencyName: string | null;
  rib: string;
  iban: string;
  swiftBic: string | null;
  isDefault: boolean;
  isActive: boolean;
  chartOfAccountNumber?: string | null;
  currency?: string;
  /** Faux pour une projection plan comptable sans coordonnées. Absent = dérivé du RIB/IBAN. */
  hasBankingIdentity?: boolean;
}

/** RIB 20 chiffres et IBAN TN : requis pour paie, virements et dépôts. */
export function hasCompleteBankIdentity(account: Pick<BankAccountDto, 'rib' | 'iban' | 'hasBankingIdentity'>): boolean {
  if (account.hasBankingIdentity === false) return false;
  if (account.hasBankingIdentity === true) return true;
  const rib = (account.rib ?? '').replace(/\D/g, '');
  const iban = (account.iban ?? '').replace(/\s/g, '').toUpperCase();
  return rib.length === 20 && iban.startsWith('TN') && iban.length === 24;
}

export interface CreateBankAccountPayload {
  bankCode: string;
  bankName: string;
  rib: string;
  iban: string;
  designation?: string | null;
  agencyName?: string | null;
  swiftBic?: string | null;
  setAsDefault: boolean;
  chartOfAccountNumber?: string | null;
  autoCreateChartAccount?: boolean;
  currency?: string;
}

export interface UpdateBankAccountPayload {
  bankCode: string;
  bankName: string;
  rib: string;
  iban: string;
  designation?: string | null;
  agencyName?: string | null;
  swiftBic?: string | null;
  chartOfAccountNumber?: string | null;
  autoCreateChartAccount?: boolean;
  currency?: string;
}

@Injectable({ providedIn: 'root' })
export class BankAccountService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/bank-accounts`;

  private banksCache$: Observable<TunisianBankReference[]> | null = null;

  getTunisianBanks(): Observable<TunisianBankReference[]> {
    if (this.banksCache$) {
      return this.banksCache$;
    }
    this.banksCache$ = this.http.get<ApiResponse<TunisianBankReference[]>>(`${this.baseUrl}/reference/banks`).pipe(
      map(res => (res.success && res.data ? res.data : [])),
      catchError(() => of([])),
      shareReplay(1)
    );
    return this.banksCache$;
  }

  invalidateBanksCache(): void {
    this.banksCache$ = null;
  }

  list(): Observable<ApiResponse<BankAccountDto[]>> {
    // 403 is handled locally by the list (toast) — suppress the duplicate global modal.
    return this.http.get<ApiResponse<BankAccountDto[]>>(this.baseUrl, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  create(payload: CreateBankAccountPayload): Observable<ApiResponse<BankAccountDto>> {
    // 403 (payments:create) handled locally by the dialog — suppress the duplicate global modal.
    return this.http.post<ApiResponse<BankAccountDto>>(this.baseUrl, payload, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  update(id: string, payload: UpdateBankAccountPayload): Observable<ApiResponse<BankAccountDto>> {
    // 403 (payments:update) handled locally by the dialog — suppress the duplicate global modal.
    return this.http.put<ApiResponse<BankAccountDto>>(`${this.baseUrl}/${id}`, payload, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  delete(id: string): Observable<ApiResponse<object>> {
    // 403 (payments:update) handled locally by the list (toast) — suppress the duplicate global modal.
    return this.http.delete<ApiResponse<object>>(`${this.baseUrl}/${id}`, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  setDefault(id: string): Observable<ApiResponse<object>> {
    // 403 (payments:update) handled locally by the list (toast) — suppress the duplicate global modal.
    return this.http.post<ApiResponse<object>>(`${this.baseUrl}/${id}/set-default`, {}, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }
}
