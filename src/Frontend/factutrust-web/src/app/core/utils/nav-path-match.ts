import { NavItem, NavSubItem } from '@core/config/app-navigation.registry';
import { getNavId } from '@core/config/nav-item-ids';

/** Path only: no query, no hash; trailing slash removed except root. */
export function stripPathForMatch(url: string): string {
  let path = url.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}

/** Avoids `/invoice` matching `/invoices` (segment boundary). */
export function pathMatchesRoute(path: string, route: string | undefined): boolean {
  if (!route) {
    return false;
  }
  if (path === route) {
    return true;
  }
  return path.startsWith(route + '/');
}

/** Considers child routes and one level of grandchildren (nested NavSubItem.children). */
export function findLongestMatchingChildInParent(path: string, item: NavItem): NavSubItem | null {
  if (!item.children?.length) {
    return null;
  }
  let best: NavSubItem | null = null;
  let bestLen = -1;

  const consider = (entry: NavSubItem): void => {
    if (!entry.route) {
      return;
    }
    if (pathMatchesRoute(path, entry.route) && entry.route.length > bestLen) {
      bestLen = entry.route.length;
      best = entry;
    }
  };

  for (const child of item.children) {
    consider(child);
    if (child.children?.length) {
      for (const grand of child.children) {
        consider(grand);
      }
    }
  }
  return best;
}

/** Direct child (not grandchild) whose own route or nested child matches the path. */
export function findMatchingDirectChild(path: string, item: NavItem): NavSubItem | null {
  if (!item.children?.length) {
    return null;
  }
  let best: NavSubItem | null = null;
  let bestLen = -1;

  for (const child of item.children) {
    let matchLen = -1;
    if (child.route && pathMatchesRoute(path, child.route)) {
      matchLen = child.route.length;
    }
    if (child.children?.length) {
      for (const grand of child.children) {
        if (grand.route && pathMatchesRoute(path, grand.route) && grand.route.length > matchLen) {
          matchLen = grand.route.length;
        }
      }
    }
    if (matchLen > bestLen) {
      bestLen = matchLen;
      best = child;
    }
  }
  return best;
}

export function isNavChildActive(url: string, item: NavItem): boolean {
  if (!item.children?.length) {
    return false;
  }
  return findLongestMatchingChildInParent(stripPathForMatch(url), item) !== null;
}

/**
 * True when `child` is the single active sibling under `parent` for the current URL
 * (longest-match among siblings / one level of grandchildren).
 */
export function isNavSubItemActive(url: string, parent: NavItem, child: NavSubItem): boolean {
  const path = stripPathForMatch(url);
  if (child.children?.length) {
    const match = findMatchingDirectChild(path, parent);
    return match ? getNavId(match) === getNavId(child) : false;
  }
  if (!child.route) {
    return false;
  }
  return findLongestMatchingChildInParent(path, parent)?.route === child.route;
}

export function isNavRouteActive(url: string, route: string | undefined): boolean {
  return pathMatchesRoute(stripPathForMatch(url), route);
}
