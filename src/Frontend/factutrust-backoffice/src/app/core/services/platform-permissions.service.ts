import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '@environments/environment';
import type { ApiResponse } from '@core/models/api-response.model';
import type { PlatformMePermissionsDto, PlatformPermissionKey } from '@core/models/platform.models';

/**
 * Lot B1 — Service de permissions de l'utilisateur courant.
 *
 * Charge `GET /api/platform/auth/me/permissions` au démarrage de la session
 * (typiquement après login ou au chargement initial du shell), met les permissions
 * dans un signal reactive et expose `has(...)` / `hasAny(...)` / `hasAll(...)`.
 *
 * <b>Note sécurité</b> : le masquage UI est ergonomique uniquement. La vérification
 * authoritaire reste côté serveur (`PermissionAuthorizationHandler`).
 */
@Injectable({ providedIn: 'root' })
export class PlatformPermissionsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/platform/auth`;

  private readonly state = signal<PlatformMePermissionsDto | null>(null);
  /** Snapshot reactive : `null` tant que pas chargé. */
  readonly current = this.state.asReadonly();

  /** Set effectif des permissions (computed pour vérification rapide). */
  private readonly permissionSet = computed(() => new Set(this.state()?.permissions ?? []));

  /** Set effectif des rôles. */
  private readonly roleSet = computed(() => new Set(this.state()?.roles ?? []));

  /** Drapeaux de fonctionnalité de l'instance ; objet vide tant que rien n'est chargé. */
  private readonly featureMap = computed<Record<string, boolean>>(() => this.state()?.features ?? {});

  /** Indique si les permissions ont été chargées au moins une fois. */
  readonly isLoaded = computed(() => this.state() !== null);

  /** Charge / recharge les permissions depuis l'API. */
  load(): Observable<ApiResponse<PlatformMePermissionsDto>> {
    return this.http
      .get<ApiResponse<PlatformMePermissionsDto>>(`${this.base}/me/permissions`)
      .pipe(
        tap((res) => {
          if (res.success && res.data) {
            this.state.set(res.data);
          }
        })
      );
  }

  /** Réinitialise (au logout). */
  clear(): void {
    this.state.set(null);
  }

  /** Vérifie si l'utilisateur courant possède la permission donnée. */
  has(permission: PlatformPermissionKey): boolean {
    return this.permissionSet().has(permission);
  }

  /** Vérifie si l'utilisateur courant possède au moins une des permissions données. */
  hasAny(...permissions: PlatformPermissionKey[]): boolean {
    const set = this.permissionSet();
    return permissions.some((p) => set.has(p));
  }

  /** Vérifie si l'utilisateur courant possède toutes les permissions données. */
  hasAll(...permissions: PlatformPermissionKey[]): boolean {
    const set = this.permissionSet();
    return permissions.every((p) => set.has(p));
  }

  /** Vérifie si l'utilisateur courant a un rôle donné. */
  hasRole(role: string): boolean {
    return this.roleSet().has(role);
  }

  /**
   * Drapeau de fonctionnalité de l'instance, tel que remonté par l'API.
   *
   * Défaut `true` quand le drapeau est inconnu : une API antérieure au champ `features` — ou pas
   * encore chargée — ne doit pas faire disparaître des actions qui fonctionnent. Comme pour les
   * permissions, ce n'est qu'ergonomique : le serveur reste seul juge et répond 404 sur une
   * fonctionnalité désactivée.
   */
  hasFeature(key: string): boolean {
    return this.featureMap()[key] ?? true;
  }
}
