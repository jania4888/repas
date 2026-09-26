import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, Subject, catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs';
import { environment } from '@environments/environment';
import { AuthService } from './auth.service';
import { getAllNavSearchEntries, NavSearchEntry } from '../config/app-navigation.registry';
import { getEntityGroupLabel } from '../config/search-entity.config';
import { normalizeSearchText } from '../utils/search-text-normalize';

export type GlobalSearchResultKind = 'page' | 'document' | 'recent';

export interface GlobalSearchResult {
  kind: GlobalSearchResultKind;
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  route: string;
  queryParams?: Record<string, string>;
  group: string;
  score: number;
  entityType?: string;
}

interface RecentSearchEntry {
  route: string;
  title: string;
  kind: GlobalSearchResultKind;
  timestamp: number;
}

interface ApiSearchResultDto {
  entityType: string;
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  date?: string;
  route: string;
  listRoute: string;
  icon: string;
  score: number;
}

interface ApiSearchResponseDto {
  query: string;
  results: ApiSearchResultDto[];
  truncatedTypes: string[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

const RECENT_KEY = 'instafact:recent-search';
const RECENT_MAX = 8;
const RECENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_DOC_QUERY = 2;

@Injectable({ providedIn: 'root' })
export class GlobalSearchService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly documentQuery$ = new Subject<string>();
  readonly paletteOpen = signal(false);

  readonly documentResults$ = this.documentQuery$.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap(q => this.fetchDocuments(q))
  );

  isEnabled(): boolean {
    return environment.globalSearchEnabled !== false;
  }

  openPalette(): void {
    if (!this.isEnabled()) return;
    this.paletteOpen.set(true);
  }

  closePalette(): void {
    this.paletteOpen.set(false);
  }

  togglePalette(): void {
    this.paletteOpen.update(v => !v);
  }

  normalize(text: string): string {
    return normalizeSearchText(text);
  }

  scoreNavMatch(query: string, entry: NavSearchEntry): number {
    const q = this.normalize(query);
    if (!q) return 0;
    const label = this.normalize(entry.label);
    if (label === q) return 100;
    if (label.startsWith(q)) return 85;
    if (label.includes(q)) return 70;
    const breadcrumb = entry.breadcrumb ? this.normalize(entry.breadcrumb) : '';
    if (breadcrumb.includes(q)) return 55;
    for (const kw of entry.keywords ?? []) {
      const k = this.normalize(kw);
      if (k === q) return 90;
      if (k.startsWith(q) || k.includes(q)) return 65;
    }
    return 0;
  }

  searchNavigation(query: string): GlobalSearchResult[] {
    const q = query.trim();
    const entries = getAllNavSearchEntries(this.auth);
    if (!q) {
      return this.getRecentResults().map(r => ({ ...r, score: 100 }));
    }
    return entries
      .map(entry => ({
        kind: 'page' as const,
        id: entry.id,
        title: entry.label,
        subtitle: entry.breadcrumb,
        icon: entry.icon,
        route: entry.route,
        group: entry.group === 'create' ? 'Actions' : entry.group === 'report' ? 'Rapports' : entry.group === 'documentation' ? 'Documentation' : 'Pages',
        score: this.scoreNavMatch(q, entry)
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }

  requestDocumentSearch(query: string): void {
    this.documentQuery$.next(query.trim());
  }

  fetchDocuments(query: string): Observable<GlobalSearchResult[]> {
    if (!this.isEnabled() || query.length < MIN_DOC_QUERY) {
      return of([]);
    }
    const params = new HttpParams().set('q', query).set('limitPerType', '5');
    return this.http.get<ApiResponse<ApiSearchResponseDto>>(`${environment.apiUrl}/search`, { params }).pipe(
      map(res => (res.success && res.data ? res.data.results : [])),
      map(items => items.map(item => this.mapDocument(item))),
      catchError(() => of([]))
    );
  }

  searchAll(query: string, documents: GlobalSearchResult[]): GlobalSearchResult[] {
    const nav = this.searchNavigation(query);
    const merged = [...nav, ...documents];
    if (!query.trim()) {
      const recent = this.getRecentResults();
      const seen = new Set<string>();
      const out: GlobalSearchResult[] = [];
      for (const r of recent) {
        const key = r.route;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
      for (const r of nav.slice(0, 6)) {
        if (seen.has(r.route)) continue;
        seen.add(r.route);
        out.push(r);
      }
      return out;
    }
    return merged.sort((a, b) => b.score - a.score);
  }

  recordSelection(result: GlobalSearchResult): void {
    try {
      const now = Date.now();
      const entry: RecentSearchEntry = {
        route: result.route,
        title: result.title,
        kind: result.kind === 'recent' ? 'page' : result.kind,
        timestamp: now
      };
      const existing = this.readRecentRaw().filter(e => e.route !== entry.route && now - e.timestamp < RECENT_TTL_MS);
      existing.unshift(entry);
      localStorage.setItem(RECENT_KEY, JSON.stringify(existing.slice(0, RECENT_MAX)));
    } catch {
      /* ignore storage errors */
    }
  }

  parseRouteSelection(result: GlobalSearchResult): { route: string[]; queryParams?: Record<string, string> } {
    const url = new URL(result.route, 'http://local');
    const segments = url.pathname.split('/').filter(Boolean);
    const fromUrl: Record<string, string> = {};
    url.searchParams.forEach((value, key) => { fromUrl[key] = value; });
    const queryParams = result.queryParams ?? fromUrl;
    return {
      route: ['/', ...segments],
      queryParams: Object.keys(queryParams).length ? queryParams : undefined
    };
  }

  private mapDocument(item: ApiSearchResultDto): GlobalSearchResult {
    return {
      kind: 'document',
      id: item.id,
      title: item.title,
      subtitle: item.subtitle ?? item.status,
      icon: item.icon.startsWith('fa-') ? `fa-solid ${item.icon}` : item.icon,
      route: item.route,
      group: getEntityGroupLabel(item.entityType),
      score: item.score,
      entityType: item.entityType
    };
  }

  private getRecentResults(): GlobalSearchResult[] {
    return this.readRecentRaw().map((e, i) => ({
      kind: 'recent' as const,
      id: `recent-${i}-${e.route}`,
      title: e.title,
      icon: 'fa-solid fa-clock-rotate-left',
      route: e.route,
      group: 'Recents',
      score: 100 - i
    }));
  }

  private readRecentRaw(): RecentSearchEntry[] {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as RecentSearchEntry[];
      const now = Date.now();
      return parsed.filter(e => now - e.timestamp < RECENT_TTL_MS);
    } catch {
      return [];
    }
  }
}
