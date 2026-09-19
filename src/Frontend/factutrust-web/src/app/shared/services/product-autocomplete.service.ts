import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '@environments/environment';
import {
  ProductSelectItem,
  ProductService
} from '@core/services/product.service';

/** Suggestion shape shared by document line autocompletes. */
export interface ProductSuggestion {
  id: string;
  code: string;
  name: string;
  unitPrice: number;
  /** VAT rate percent (0, 7, 13, 19). */
  vatRate: number;
  unit: string;
  isFodecApplicable: boolean;
  isDiscountEnabled: boolean;
  maxDiscountPercent: number | null;
  attributeSummary?: string | null;
  /** Code-barres, pour résoudre un code scanné sans aller-retour serveur. */
  barcode?: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const PREFETCH_PAGE_SIZE = 100;
const SERVER_SEARCH_MIN_LENGTH = 3;

/**
 * Prefetch + TTL cache + local filter for product autocomplete.
 * Used by invoice wizard and other document forms when invoiceProductSearchV2 is enabled.
 */
@Injectable({ providedIn: 'root' })
export class ProductAutocompleteService {
  private readonly productService = inject(ProductService);

  private cachedActiveProducts: ProductSuggestion[] = [];
  private cacheLoadedAt = 0;
  private prefetchInFlight: Observable<ProductSuggestion[]> | null = null;

  readonly isLoading = signal(false);

  /** Whether the optimized search path is enabled. */
  get isV2Enabled(): boolean {
    return environment.featureFlags?.invoiceProductSearchV2 === true;
  }

  /** True when a warm cache of active products is available. */
  get hasWarmCache(): boolean {
    return this.isCacheValid();
  }

  /** Snapshot of cached active products (empty if cold). */
  getCachedActiveProducts(): ProductSuggestion[] {
    return this.isCacheValid() ? [...this.cachedActiveProducts] : [];
  }

  invalidateCache(): void {
    this.cachedActiveProducts = [];
    this.cacheLoadedAt = 0;
    this.prefetchInFlight = null;
  }

  /**
   * Prefetch active products into the TTL cache.
   * Safe to call multiple times — concurrent callers share one in-flight request.
   */
  prefetch(): Observable<ProductSuggestion[]> {
    if (!this.isV2Enabled) {
      return of([]);
    }

    if (this.isCacheValid()) {
      return of([...this.cachedActiveProducts]);
    }

    if (this.prefetchInFlight) {
      return this.prefetchInFlight;
    }

    this.isLoading.set(true);
    const startedAt = performance.now();

    this.prefetchInFlight = this.productService
      .searchForSelect({
        isActive: true,
        page: 1,
        pageSize: PREFETCH_PAGE_SIZE
      })
      .pipe(
        map(res => {
          if (!res.success || !res.data) {
            return [] as ProductSuggestion[];
          }
          return res.data.items.map(item => this.mapSelectItem(item));
        }),
        tap(items => {
          this.cachedActiveProducts = items;
          this.cacheLoadedAt = Date.now();
          if (!environment.production) {
            console.debug(
              `[ProductAutocomplete] prefetch ${items.length} products in ${(performance.now() - startedAt).toFixed(0)}ms`
            );
          }
        }),
        catchError(err => {
          console.error('[ProductAutocomplete] prefetch failed', err);
          return of([] as ProductSuggestion[]);
        }),
        finalize(() => {
          this.isLoading.set(false);
          this.prefetchInFlight = null;
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    return this.prefetchInFlight;
  }

  /**
   * Search products for autocomplete.
   * - Empty query → warm cache (prefetch if needed)
   * - Short query → local filter on cache
   * - Longer query with 0 local hits → server /select
   * - V2 disabled → legacy getProducts
   */
  search(query: string): Observable<ProductSuggestion[]> {
    const q = (query ?? '').trim();
    const startedAt = performance.now();

    if (!this.isV2Enabled) {
      return this.legacySearch(q, startedAt);
    }

    if (!q) {
      if (this.isCacheValid()) {
        return of([...this.cachedActiveProducts]);
      }
      return this.prefetch();
    }

    if (this.isCacheValid()) {
      const local = this.filterLocal(q);
      if (local.length > 0 || q.length < SERVER_SEARCH_MIN_LENGTH) {
        if (!environment.production) {
          console.debug(
            `[ProductAutocomplete] local filter "${q}" → ${local.length} in ${(performance.now() - startedAt).toFixed(0)}ms`
          );
        }
        return of(local);
      }
    }

    return this.serverSearch(q, startedAt);
  }

  /**
   * Case-insensitive filter on cached code/name. Exposed for unit tests.
   *
   * Le code-barres, lui, se compare en égalité STRICTE et sensible à la casse : on ne tape
   * jamais un morceau de code-barres, on le scanne en entier, et un Code 128 distingue les
   * majuscules. Un `includes` ici rouvrirait la correspondance partielle que le scan a
   * précisément corrigée — « 1234 » ne doit jamais désigner « 12345 ».
   */
  filterLocal(query: string): ProductSuggestion[] {
    const raw = query.trim();
    const q = raw.toLowerCase();
    if (!q) {
      return [...this.cachedActiveProducts];
    }
    return this.cachedActiveProducts.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (!!p.barcode && p.barcode === raw)
    );
  }

  /** Seed cache from an external list (e.g. after quick-create). */
  upsertSuggestion(item: ProductSuggestion): void {
    if (!this.isCacheValid()) {
      return;
    }
    const idx = this.cachedActiveProducts.findIndex(p => p.id === item.id);
    if (idx >= 0) {
      this.cachedActiveProducts = [
        ...this.cachedActiveProducts.slice(0, idx),
        item,
        ...this.cachedActiveProducts.slice(idx + 1)
      ];
    } else {
      this.cachedActiveProducts = [...this.cachedActiveProducts, item].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr')
      );
    }
  }

  private isCacheValid(): boolean {
    return this.cacheLoadedAt > 0 && Date.now() - this.cacheLoadedAt < CACHE_TTL_MS;
  }

  private serverSearch(query: string, startedAt: number): Observable<ProductSuggestion[]> {
    this.isLoading.set(true);
    return this.productService
      .searchForSelect({
        search: query,
        isActive: true,
        page: 1,
        pageSize: PREFETCH_PAGE_SIZE
      })
      .pipe(
        map(res => {
          if (!res.success || !res.data) {
            return [] as ProductSuggestion[];
          }
          return res.data.items.map(item => this.mapSelectItem(item));
        }),
        tap(items => {
          if (!environment.production) {
            console.debug(
              `[ProductAutocomplete] server search "${query}" → ${items.length} in ${(performance.now() - startedAt).toFixed(0)}ms`
            );
          }
        }),
        catchError(err => {
          console.error('[ProductAutocomplete] server search failed', err);
          return of([] as ProductSuggestion[]);
        }),
        finalize(() => this.isLoading.set(false))
      );
  }

  private legacySearch(query: string, startedAt: number): Observable<ProductSuggestion[]> {
    this.isLoading.set(true);
    return this.productService
      .getProducts({
        search: query || undefined,
        isActive: true,
        page: 1,
        pageSize: 50
      })
      .pipe(
        map(res => {
          if (!res.success || !res.data) {
            return [] as ProductSuggestion[];
          }
          return res.data.items.map(p => ({
            id: p.id,
            code: p.code,
            name: p.name,
            unitPrice: p.unitPrice,
            vatRate: p.vatRate,
            unit: p.unit || 'Unité',
            isFodecApplicable: p.isFodecApplicable ?? false,
            isDiscountEnabled: p.isDiscountEnabled ?? false,
            maxDiscountPercent: p.maxDiscountPercent ?? null,
            barcode: p.barcode ?? null
          }));
        }),
        tap(items => {
          if (!environment.production) {
            console.debug(
              `[ProductAutocomplete] legacy search "${query}" → ${items.length} in ${(performance.now() - startedAt).toFixed(0)}ms`
            );
          }
        }),
        catchError(err => {
          console.error('[ProductAutocomplete] legacy search failed', err);
          return of([] as ProductSuggestion[]);
        }),
        finalize(() => this.isLoading.set(false))
      );
  }

  private mapSelectItem(item: ProductSelectItem): ProductSuggestion {
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      unit: item.unit || 'Unité',
      isFodecApplicable: item.isFodecApplicable ?? false,
      isDiscountEnabled: item.isDiscountEnabled ?? false,
      maxDiscountPercent: item.maxDiscountPercent ?? null,
      attributeSummary: item.attributeSummary ?? null,
      barcode: item.barcode ?? null
    };
  }
}

/** Adapt a suggestion to ProductListItem shape for forms that still expect the full list DTO. */
export function suggestionToListItem(s: ProductSuggestion): import('@core/services/product.service').ProductListItem {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    description: null,
    typeDisplay: '',
    categoryId: '',
    category: '',
    unitPrice: s.unitPrice,
    unit: s.unit || 'Unité',
    vatRate: s.vatRate,
    isFodecApplicable: s.isFodecApplicable,
    isDiscountEnabled: s.isDiscountEnabled,
    maxDiscountPercent: s.maxDiscountPercent,
    isActive: true,
    isStockManaged: false,
    barcode: s.barcode ?? null
  };
}
