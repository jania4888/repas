import { Injectable, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription, timer } from 'rxjs';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { environment } from '@environments/environment';
import { ApiResponse, AuthService } from './auth.service';
import { FirmBadgeService } from './firm-badge.service';
import { ExchangeBadgeService } from './exchange-badge.service';

export interface AppNotification {
  id: string;
  /** `NotificationType` backend : l'API l'émet en chaîne PascalCase (`JsonStringEnumConverter` global) ; la forme numérique reste tolérée. */
  type: number | string;
  title: string;
  body: string;
  linkUrl?: string;
  createdAt: string;
  readAt?: string;
}

/** `NotificationType` backend 15–18 (Studio workflows, U1). */
export const STUDIO_WORKFLOW_NOTIFICATION_TYPES = {
  approvalRequested: 15,
  approvalDecided: 16,
  stepFailed: 17,
  message: 18
} as const;

/** Noms PascalCase des mêmes valeurs, tels que sérialisés par l'API (D-44-94). */
const STUDIO_WORKFLOW_NOTIFICATION_NAMES: ReadonlySet<string> = new Set([
  'StudioWorkflowApprovalRequested', 'StudioWorkflowApprovalDecided', 'StudioWorkflowStepFailed', 'StudioWorkflowMessage'
]);

export function isStudioWorkflowNotification(type: number | string): boolean {
  if (typeof type === 'string') return STUDIO_WORKFLOW_NOTIFICATION_NAMES.has(type);
  return type >= STUDIO_WORKFLOW_NOTIFICATION_TYPES.approvalRequested &&
    type <= STUDIO_WORKFLOW_NOTIFICATION_TYPES.message;
}

export interface NotificationList {
  items: AppNotification[];
  totalCount: number;
  unreadCount: number;
  page: number;
  pageSize: number;
}

const POLL_INTERVAL_MS = 60_000;
/** Delay first exchange badge poll so it does not collide with /exchanges/bootstrap at t=0. */
const EXCHANGE_BADGE_INITIAL_DELAY_MS = 15_000;

/**
 * Notifications in-app (cloche du header) : compteur non-lues + dernières
 * notifications, rafraîchis par polling léger tant que l'utilisateur est
 * connecté. Le tick rafraîchit aussi le badge invitations du cabinet.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly firmBadge = inject(FirmBadgeService);
  private readonly exchangeBadge = inject(ExchangeBadgeService);
  private readonly baseUrl = `${environment.apiUrl}/notifications`;

  readonly unreadCount = signal(0);
  readonly latest = signal<AppNotification[]>([]);

  private pollSub: Subscription | null = null;
  private exchangeBadgePollSub: Subscription | null = null;

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.startPolling();
      } else {
        this.stopPolling();
        this.unreadCount.set(0);
        this.latest.set([]);
      }
    });
  }

  refresh(): void {
    this.http
      .get<ApiResponse<NotificationList>>(this.baseUrl, {
        params: { page: 1, pageSize: 10 },
        context: createHttpContextSkipGlobalErrorUi()
      })
      .subscribe({
        next: r => {
          if (r.success) {
            this.latest.set(r.data.items);
            this.unreadCount.set(r.data.unreadCount);
          }
        },
        error: () => {
          /* silencieux : le prochain tick réessaiera */
        }
      });
  }

  markRead(id: string): void {
    this.http
      .post<ApiResponse<unknown>>(`${this.baseUrl}/${id}/read`, {}, {
        context: createHttpContextSkipGlobalErrorUi()
      })
      .subscribe({
        next: () => this.refresh(),
        error: () => {}
      });
  }

  markAllRead(): void {
    this.http
      .post<ApiResponse<unknown>>(`${this.baseUrl}/read-all`, {}, {
        context: createHttpContextSkipGlobalErrorUi()
      })
      .subscribe({
        next: () => this.refresh(),
        error: () => {}
      });
  }

  private startPolling(): void {
    if (this.pollSub) return;
    this.pollSub = timer(0, POLL_INTERVAL_MS).subscribe(() => {
      this.refresh();
      this.firmBadge.refresh();
    });
    // Décalage volontaire : évite que unread-summary concurrence le bootstrap Échanges.
    this.exchangeBadgePollSub = timer(EXCHANGE_BADGE_INITIAL_DELAY_MS, POLL_INTERVAL_MS).subscribe(() => {
      this.exchangeBadge.refresh();
    });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.exchangeBadgePollSub?.unsubscribe();
    this.exchangeBadgePollSub = null;
  }
}
