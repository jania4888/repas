import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CompanySupportService } from './company-support.service';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';

@Injectable({ providedIn: 'root' })
export class CompanySupportBadgeService {
  private readonly auth = inject(AuthService);
  private readonly support = inject(CompanySupportService);

  readonly unreadCount = signal(0);

  refresh(): void {
    const allowed =
      this.auth.isAuthenticated() &&
      this.auth.canAccessPlatformSettings() &&
      !this.auth.isAccountingFirm() &&
      !this.auth.isDelegatedMode() &&
      !this.auth.isClientPortal();
    if (!allowed) {
      this.unreadCount.set(0);
      return;
    }

    this.support.unreadCount(createHttpContextSkipGlobalErrorUi()).subscribe({
      next: r => {
        if (r.success) this.unreadCount.set(r.data);
      },
      error: () => {
        /* silent */
      }
    });
  }
}
