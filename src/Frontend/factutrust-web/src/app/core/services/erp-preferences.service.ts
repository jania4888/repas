import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@environments/environment';
import type { ErpLocale } from '@core/i18n/erp-locale.types';
import { ERP_LOCALE_STORAGE_KEY } from '@core/i18n/erp-locale.types';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ErpPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  async setLanguage(locale: ErpLocale): Promise<void> {
    try {
      localStorage.setItem(ERP_LOCALE_STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    if (!this.auth.isAuthenticated()) {
      return;
    }
    try {
      await firstValueFrom(
        this.http.put(`${environment.apiUrl}/me/preferences/language`, { language: locale })
      );
    } catch {
      /* repli localStorage + reload */
    }
  }
}
