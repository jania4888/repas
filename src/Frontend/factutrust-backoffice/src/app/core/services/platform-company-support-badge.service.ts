import { Injectable, inject, signal } from '@angular/core';
import { PlatformPermissionsService } from './platform-permissions.service';
import { PlatformCompanySupportService } from './platform-company-support.service';
import { PlatformPermission } from '@core/models/platform.models';

@Injectable({ providedIn: 'root' })
export class PlatformCompanySupportBadgeService {
  private readonly permissions = inject(PlatformPermissionsService);
  private readonly support = inject(PlatformCompanySupportService);
  readonly unreadCount = signal(0);

  refresh(): void {
    if (!this.permissions.has(PlatformPermission.CompanySupportRead)) {
      this.unreadCount.set(0);
      return;
    }
    this.support.unreadCount().subscribe({
      next: r => {
        if (r.success) this.unreadCount.set(r.data ?? 0);
      },
      error: () => {}
    });
  }
}
