import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';
import type { ApiResponse } from '@core/models/api-response.model';
import type {
  PlatformTenantDetailDto,
  PlatformTenantListPageDto,
  PlatformTenantListParams,
  PlatformTenantStatsDto,
  SavedTenantView,
  SubscriptionDto
} from '@core/models/platform.models';

const SAVED_VIEWS_KEY = 'ft.tenants.savedViews.v1';

@Injectable({ providedIn: 'root' })
export class PlatformTenantService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/platform/tenants`;

  stats(): Observable<ApiResponse<PlatformTenantStatsDto>> {
    return this.http.get<ApiResponse<PlatformTenantStatsDto>>(`${this.base}/stats`);
  }

  list(params?: PlatformTenantListParams): Observable<ApiResponse<PlatformTenantListPageDto>> {
    let hp = new HttpParams();
    const p = params ?? {};
    if (p.search?.trim()) hp = hp.set('search', p.search.trim());
    if (p.segment && p.segment !== 'all') hp = hp.set('segment', p.segment);
    if (p.plan !== undefined && p.plan !== null) hp = hp.set('plan', String(p.plan));
    if (p.subscriptionStatus !== undefined && p.subscriptionStatus !== null) {
      hp = hp.set('subscriptionStatus', String(p.subscriptionStatus));
    }
    if (p.isActive === true || p.isActive === false) hp = hp.set('isActive', String(p.isActive));
    if (p.taxRegime !== undefined && p.taxRegime !== null) hp = hp.set('taxRegime', String(p.taxRegime));
    if (p.kind !== undefined && p.kind !== null) hp = hp.set('kind', String(p.kind));
    const page = p.page ?? 1;
    const pageSize = p.pageSize ?? 25;
    hp = hp.set('page', String(page)).set('pageSize', String(pageSize));
    if (p.sortBy) hp = hp.set('sortBy', p.sortBy);
    if (p.sortDir) hp = hp.set('sortDir', p.sortDir);

    return this.http.get<ApiResponse<PlatformTenantListPageDto>>(this.base, { params: hp });
  }

  get(tenantId: string): Observable<ApiResponse<PlatformTenantDetailDto>> {
    return this.http.get<ApiResponse<PlatformTenantDetailDto>>(`${this.base}/${tenantId}`);
  }

  changeSubscription(tenantId: string, plan: string): Observable<ApiResponse<SubscriptionDto>> {
    return this.http.post<ApiResponse<SubscriptionDto>>(`${this.base}/${tenantId}/subscription/change`, {
      plan
    });
  }

  cancelSubscription(tenantId: string, reason: string): Observable<ApiResponse<SubscriptionDto>> {
    return this.http.post<ApiResponse<SubscriptionDto>>(`${this.base}/${tenantId}/subscription/cancel`, {
      reason
    });
  }

  // ============================================================================
  // Vues sauvegardées (localStorage — Lot A2.5 différé pour backend partagé).
  //
  // Schéma localStorage : `ft.tenants.savedViews.v1` → JSON `SavedTenantView[]`.
  // En cas de JSON corrompu, on réinitialise silencieusement.
  // ============================================================================

  /** Préréglages livrés (toujours injectés en tête de liste). */
  readonly builtInViews: ReadonlyArray<SavedTenantView> = [
    {
      id: 'builtin:risk',
      name: 'Risque churn',
      filters: { subscriptionStatus: 4 /* PastDue */ },
      isDefault: false,
      createdAt: '1970-01-01T00:00:00Z'
    },
    {
      id: 'builtin:trial',
      name: 'En essai',
      filters: { subscriptionStatus: 1 /* Trial */ },
      isDefault: false,
      createdAt: '1970-01-01T00:00:00Z'
    },
    {
      id: 'builtin:annual',
      name: 'Abonnés annuels',
      filters: { plan: 2 /* Annual */ },
      isDefault: false,
      createdAt: '1970-01-01T00:00:00Z'
    },
    {
      id: 'builtin:nonpaying',
      name: 'Non abonnés',
      filters: { segment: 'non_paying' },
      isDefault: false,
      createdAt: '1970-01-01T00:00:00Z'
    }
  ];

  /** Lit les vues utilisateurs depuis le localStorage. */
  loadSavedViews(): SavedTenantView[] {
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (v): v is SavedTenantView =>
          v &&
          typeof v.id === 'string' &&
          typeof v.name === 'string' &&
          typeof v.filters === 'object'
      );
    } catch {
      return [];
    }
  }

  /** Persiste un snapshot complet des vues utilisateurs. */
  private writeSavedViews(views: SavedTenantView[]): void {
    try {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    } catch {
      // Quota plein, mode privé, etc. — silencieux.
    }
  }

  /** Ajoute une nouvelle vue (génère un id ulid-like). */
  saveView(name: string, filters: SavedTenantView['filters']): SavedTenantView {
    const views = this.loadSavedViews();
    const view: SavedTenantView = {
      id: 'view_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      name: name.trim() || 'Vue sans nom',
      filters,
      createdAt: new Date().toISOString()
    };
    views.push(view);
    this.writeSavedViews(views);
    return view;
  }

  /** Supprime une vue sauvegardée. Les built-in ne sont pas supprimables. */
  deleteSavedView(id: string): void {
    if (id.startsWith('builtin:')) return;
    const views = this.loadSavedViews().filter((v) => v.id !== id);
    this.writeSavedViews(views);
  }
}
