import { ActivatedRouteSnapshot } from '@angular/router';

const EXCLUDED_ROOTS = [
  '/desk',
  '/access-denied',
  '/firm',
  '/ai-assistant',
  '/auth',
  '/portal',
  '/pos',
  '/legal',
  '/visite-virtuelle'
];

export interface DeskTenantSource {
  tenantId?: string | null;
  accessMode?: string | null;
  contextTenantId?: string | null;
}

/** Clé de session et de fenêtre : un dossier délégué ne relit jamais le bureau d'un autre. */
export function deskTenantKey(user: DeskTenantSource | null | undefined): string {
  if (!user) return '';
  if (user.accessMode === 'delegated' && user.contextTenantId) {
    return `delegated:${user.contextTenantId}`;
  }
  return user.tenantId ? `native:${user.tenantId}` : '';
}

export function stripDeskPath(url: string): string {
  let path = url.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path || '/';
}

export function normalizeDeskUrl(url: string): string {
  const noHash = url.split('#')[0];
  const queryIndex = noHash.indexOf('?');
  const path = stripDeskPath(queryIndex >= 0 ? noHash.slice(0, queryIndex) : noHash);
  if (queryIndex < 0) return path;
  const params = new URLSearchParams(noHash.slice(queryIndex + 1));
    const keys: string[] = [];
    params.forEach((_value, key) => {
      if (!keys.includes(key)) keys.push(key);
    });
    keys.sort();
  const next = new URLSearchParams();
  for (const key of keys) {
    for (const value of params.getAll(key)) next.append(key, value);
  }
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}

/** Route qui ne doit jamais devenir une fenêtre (refus, cabinet, assistant, bureau vide). */
export function isDeskWindowUrl(url: string): boolean {
  const path = stripDeskPath(url);
  if (!path || path === '/' || path === '/accounting') return false;
  return !EXCLUDED_ROOTS.some(root => path === root || path.startsWith(`${root}/`));
}

export function isDeskHomeUrl(url: string): boolean {
  return stripDeskPath(url) === '/desk';
}

/**
 * Identité de fenêtre.
 * Le chemin suffit : `/fixed-assets/a` et `/fixed-assets/b` sont deux fenêtres,
 * `/journal?from=` reste la même. Seule la saisie porte son identité dans la query (`entryId`).
 */
export function deskWindowKeyFromUrl(url: string): string | null {
  if (!isDeskWindowUrl(url)) return null;
  const normalized = normalizeDeskUrl(url);
  const queryIndex = normalized.indexOf('?');
  const path = queryIndex >= 0 ? normalized.slice(0, queryIndex) : normalized;
  if (path === '/accounting/manual-entry') {
    const entryId = new URLSearchParams(queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '')
      .get('entryId')
      ?.trim();
    return entryId ? `${path}?entryId=${encodeURIComponent(entryId)}` : path;
  }
  return path;
}

export function snapshotPath(route: ActivatedRouteSnapshot): string {
  const segments: string[] = [];
  const chain: ActivatedRouteSnapshot[] = [];
  let current: ActivatedRouteSnapshot | null = route;
  while (current) {
    chain.push(current);
    current = current.parent;
  }
  chain.reverse();
  for (const snap of chain) {
    for (const segment of snap.url) {
      if (segment.path) segments.push(segment.path);
    }
  }
  return `/${segments.join('/')}`;
}

export function snapshotUrl(route: ActivatedRouteSnapshot): string {
  const path = snapshotPath(route);
  const params = route.queryParams ?? {};
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function deskWindowKeyFromSnapshot(route: ActivatedRouteSnapshot): string | null {
  return deskWindowKeyFromUrl(snapshotUrl(route));
}

export function isDetachablePage(route: ActivatedRouteSnapshot): boolean {
  return !!route.routeConfig && !route.firstChild && route.outlet === 'primary' && !!route.component;
}
