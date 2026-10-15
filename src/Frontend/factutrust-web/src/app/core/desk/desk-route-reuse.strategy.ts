import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';
import { deskWindowKeyFromSnapshot, isDetachablePage } from './desk-window-key';
import { DeskWindowStore } from './desk-window.store';

/**
 * Conserve l'écran quitté seulement dans le dossier délégué.
 * Hors de ce mode, `shouldDetach` reste faux : société et cabinet natif ne changent pas.
 *
 * `store(null)` efface la référence sans détruire : le routeur vient de la reprendre via `retrieve`.
 */
@Injectable()
export class DeskRouteReuseStrategy implements RouteReuseStrategy {
  private readonly windows = inject(DeskWindowStore);

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    const key = this.pageKey(route);
    if (!key || this.windows.isClosing(key)) return false;
    return true;
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const key = this.pageKey(route);
    if (!key) return;
    if (handle == null) {
      this.windows.forgetHandle(key);
      return;
    }
    this.windows.rememberHandle(key, handle);
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.pageKey(route);
    if (!key || this.windows.isClosing(key)) return false;
    const window = this.windows.find(key);
    if (window && window.tenantKey !== this.windows.tenantKey()) {
      this.windows.destroyHandle(key);
      return false;
    }
    return this.windows.hasHandle(key);
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.pageKey(route);
    if (!key) return null;
    return (this.windows.peekHandle(key) as DetachedRouteHandle | null) ?? null;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.routeConfig !== curr.routeConfig) return false;
    if (!this.windows.isEnabled()) return true;
    if (!isDetachablePage(future) || !isDetachablePage(curr)) return true;
    const next = deskWindowKeyFromSnapshot(future);
    const previous = deskWindowKeyFromSnapshot(curr);
    if (next && previous && next !== previous) return false;
    return true;
  }

  private pageKey(route: ActivatedRouteSnapshot): string | null {
    if (!this.windows.isEnabled() || !isDetachablePage(route)) return null;
    return deskWindowKeyFromSnapshot(route);
  }
}
