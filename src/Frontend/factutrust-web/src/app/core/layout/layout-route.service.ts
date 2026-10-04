import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import {
  DEFAULT_LAYOUT_ROUTE_FLAGS,
  LayoutRouteData,
  LayoutRouteFlags
} from './layout-route-data';

function getLeafRouteSnapshot(root: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  let route = root;
  while (route.firstChild) {
    route = route.firstChild;
  }
  return route;
}

function resolveLayoutFlags(snapshot: ActivatedRouteSnapshot): LayoutRouteFlags {
  const leaf = getLeafRouteSnapshot(snapshot);
  const data = leaf.data as LayoutRouteData;
  return {
    hideLayout: data.hideLayout === true,
    fullWidth: data.fullWidth === true,
    fillPane: data.fillPane === true
  };
}

@Injectable({ providedIn: 'root' })
export class LayoutRouteService {
  private readonly router = inject(Router);

  private readonly navigationTick = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.routerState.snapshot),
      startWith(this.router.routerState.snapshot)
    ),
    { initialValue: this.router.routerState.snapshot }
  );

  readonly flags = computed<LayoutRouteFlags>(() => {
    const snapshot = this.navigationTick();
    if (!snapshot) {
      return DEFAULT_LAYOUT_ROUTE_FLAGS;
    }
    return resolveLayoutFlags(snapshot.root);
  });
}