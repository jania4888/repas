import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, throwError, timer } from 'rxjs';
import { catchError, map, retry, shareReplay, tap } from 'rxjs/operators';
import { environment } from '@environments/environment';
import type { ApiResponse } from '@core/models/api-response.model';
import { CORE_MODULE_IDS, HONORAIRES_MODULE_ID, MODULE_CATALOG } from '@core/models/module-catalog';
import {
  DOMAIN_MODULE_OVERLAY,
  SEGMENT_ALLOWED_DOMAINS,
  SEGMENT_DEFAULT_WAREHOUSE_NAME,
  SEGMENT_RECOMMENDED_MODULES,
  STATIC_DOMAINS,
  STATIC_SEGMENTS
} from './static-sector-catalog';
import type {
  SectorCatalogDto,
  SectorCatalogState,
  SectorDomainDto,
  SectorModuleDto,
  SectorSegmentDto
} from './sector-catalog.models';

const RETRY_COUNT = 2;

/**
 * Catalogue sectoriel du backoffice.
 *
 * Jumeau fonctionnel : `factutrust-web/src/app/features/auth/register-wizard/registration-catalog.ts`.
 * Écarts assumés et voulus :
 *  - un **404** (drapeau `Features:RegistrationSector` éteint) bascule en état `disabled` sans
 *    aucune reprise : la réponse fait autorité, et le serveur ignorerait de toute façon toute
 *    sélection de secteur ou de modules. L'écran masque alors ces étapes au lieu de demander une
 *    saisie qui serait jetée ;
 *  - aucune notion de profilage (`profileAnswers`) : un opérateur ne répond pas à la place du
 *    dirigeant.
 *
 * Source consommée : `GET /api/public/sector-catalog` — le catalogue **résolu**, c'est-à-dire
 * exactement ce que `RegistrationSectorService.ResolveProfile` validera côté serveur. L'API
 * d'administration `/api/platform/sector-rules` expose la forme CRUD, qui imposerait un second
 * résolveur côté client, susceptible de diverger.
 */
@Injectable({ providedIn: 'root' })
export class RegistrationCatalogService {
  private readonly http = inject(HttpClient);

  private readonly remote = signal<SectorCatalogDto | null>(null);
  private readonly state = signal<SectorCatalogState>('loading');
  private request$: Observable<SectorCatalogDto | null> | null = null;

  readonly loadState = this.state.asReadonly();
  readonly isDisabled = computed(() => this.state() === 'disabled');
  readonly usedStaticFallback = computed(() => this.state() === 'fallback');

  /** Idempotent : le catalogue n'est chargé qu'une fois par session. */
  load(): Observable<SectorCatalogDto | null> {
    if (!this.request$) {
      this.request$ = this.http
        .get<ApiResponse<SectorCatalogDto>>(`${environment.apiUrl}/public/sector-catalog`)
        .pipe(
          retry({
            count: RETRY_COUNT,
            delay: (error: unknown, retryIndex: number) => {
              // Un 404 est une réponse définitive (fonctionnalité désactivée) : ne pas insister.
              if (error instanceof HttpErrorResponse && error.status === 404) {
                return throwError(() => error);
              }
              return timer(retryIndex * 400);
            }
          }),
          map(res => (res.success && res.data ? res.data : null)),
          tap(catalog => {
            if (catalog && catalog.segments.length > 0) {
              this.remote.set(catalog);
              this.state.set('remote');
            } else {
              this.state.set('fallback');
            }
          }),
          catchError((err: HttpErrorResponse) => {
            this.state.set(err.status === 404 ? 'disabled' : 'fallback');
            return of(null);
          }),
          shareReplay({ bufferSize: 1, refCount: false })
        );
    }
    return this.request$;
  }

  segments(): SectorSegmentDto[] {
    const remote = this.remote();
    return remote ? [...remote.segments].sort((a, b) => a.sortOrder - b.sortOrder) : [...STATIC_SEGMENTS];
  }

  /**
   * Domaines réellement autorisés pour un segment. C'est cette cascade qui évite les 400
   * « Type de société requis… » et « couple type de société / domaine incohérent » renvoyés par
   * `RegistrationSectorService.ResolveProfile`.
   */
  domainsForSegment(segmentCode: string | null | undefined): SectorDomainDto[] {
    if (!segmentCode) return [];

    const remote = this.remote();
    if (remote) {
      const segment = remote.segments.find(s => s.code === segmentCode);
      const allowed = segment?.domainCodes ?? [];
      const pool = [...remote.domains].sort((a, b) => a.sortOrder - b.sortOrder);
      // `domainCodes` vide côté serveur signifie « aucune restriction » (fournisseur statique).
      return allowed.length > 0 ? pool.filter(d => allowed.includes(d.code)) : pool;
    }

    const allowedStatic = SEGMENT_ALLOWED_DOMAINS[segmentCode] ?? [];
    return STATIC_DOMAINS.filter(d => allowedStatic.includes(d.code));
  }

  modules(): SectorModuleDto[] {
    const remote = this.remote();
    if (remote && remote.modules.length > 0) return remote.modules;

    return MODULE_CATALOG.map(m => ({
      id: m.value,
      code: `MODULE_${m.value}`,
      labelFr: m.label,
      isCore: CORE_MODULE_IDS.includes(m.value),
      availableOnFreePlan: true
    }));
  }

  moduleLabelFor(moduleId: number): string {
    return this.modules().find(m => m.id === moduleId)?.labelFr
      ?? MODULE_CATALOG.find(m => m.value === moduleId)?.label
      ?? `Module ${moduleId}`;
  }

  coreModuleIds(): number[] {
    const remote = this.remote();
    if (remote) {
      const core = remote.modules.filter(m => m.isCore).map(m => m.id);
      if (core.length > 0) return core.sort((a, b) => a - b);
    }
    return [...CORE_MODULE_IDS].sort((a, b) => a - b);
  }

  /**
   * Socle ∪ recommandations du segment ∪ apports du domaine — miroir de la fusion réalisée
   * côté serveur par `SectorConfigurationCatalog.Resolve`.
   */
  recommendedModuleIds(segmentCode: string | null | undefined, domainCode: string | null | undefined): number[] {
    const set = new Set<number>(this.coreModuleIds());
    const remote = this.remote();

    if (remote) {
      const segment = segmentCode ? remote.segments.find(s => s.code === segmentCode) : undefined;
      segment?.recommendedModuleIds.forEach(id => set.add(id));
      const domain = domainCode ? remote.domains.find(d => d.code === domainCode) : undefined;
      domain?.additionalModuleIds.forEach(id => set.add(id));
    } else {
      (segmentCode ? SEGMENT_RECOMMENDED_MODULES[segmentCode] ?? [] : []).forEach(id => set.add(id));
      (domainCode ? DOMAIN_MODULE_OVERLAY[domainCode] ?? [] : []).forEach(id => set.add(id));
    }

    set.delete(HONORAIRES_MODULE_ID);
    return Array.from(set).sort((a, b) => a - b);
  }

  /** Modules ni socle, ni recommandés, ni Honoraires (réservé aux cabinets). */
  optionalModuleIds(segmentCode: string | null | undefined, domainCode: string | null | undefined): number[] {
    const recommended = new Set(this.recommendedModuleIds(segmentCode, domainCode));
    return this.modules()
      .map(m => m.id)
      .filter(id => id !== HONORAIRES_MODULE_ID && !recommended.has(id))
      .sort((a, b) => a - b);
  }

  /** Fermeture transitive des prérequis de `moduleId`. */
  requiredBy(moduleId: number): number[] {
    const edges = this.remote()?.moduleDependencies ?? [];
    if (edges.length === 0) return [];

    const resolved = new Set<number>();
    const queue = [moduleId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.moduleId !== current) continue;
        if (resolved.has(edge.requiredModuleId) || edge.requiredModuleId === moduleId) continue;
        resolved.add(edge.requiredModuleId);
        queue.push(edge.requiredModuleId);
      }
    }
    return Array.from(resolved).sort((a, b) => a - b);
  }

  /** Modules actuellement sélectionnés qui dépendent de `moduleId` — il ne peut pas être retiré. */
  dependentsOf(moduleId: number, selected: Iterable<number>): number[] {
    const edges = this.remote()?.moduleDependencies ?? [];
    if (edges.length === 0) return [];

    const selectedSet = new Set(selected);
    return edges
      .filter(e => e.requiredModuleId === moduleId && selectedSet.has(e.moduleId))
      .map(e => e.moduleId)
      .sort((a, b) => a - b);
  }

  /** Un module verrouillé n'est pas accordable sur le forfait gratuit. */
  isLockedOnFreePlan(moduleId: number): boolean {
    const module = this.modules().find(m => m.id === moduleId);
    return module ? !module.availableOnFreePlan : false;
  }

  defaultWarehouseName(segmentCode: string | null | undefined): string | undefined {
    if (!segmentCode) return undefined;
    const remote = this.remote();
    if (remote) {
      return remote.segments.find(s => s.code === segmentCode)?.defaultWarehouseName ?? undefined;
    }
    return SEGMENT_DEFAULT_WAREHOUSE_NAME[segmentCode];
  }

  /** Régime fiscal usuel du segment, avec sa justification. Purement indicatif. */
  suggestedTaxRegimeFor(segmentCode: string | null | undefined): { regime: number; noteFr: string } | null {
    if (!segmentCode) return null;
    const suggestion = this.remote()?.suggestedTaxRegimes.find(s => s.segmentCode === segmentCode);
    return suggestion ? { regime: suggestion.regime, noteFr: suggestion.noteFr } : null;
  }
}
