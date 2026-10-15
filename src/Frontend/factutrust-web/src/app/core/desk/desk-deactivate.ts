import { CanDeactivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { DeskWindowService } from './desk-window.service';

export { currentDeskNavigation, shouldBypassDeskDeactivate, type DeskDeactivateContext } from './desk-deactivate.logic';

export function deskAwareCanDeactivate<T extends { canDeactivate?: () => boolean }>(
  accept: (component: T) => boolean
): CanDeactivateFn<T> {
  return component => {
    if (!component) return true;
    if (inject(DeskWindowService).bypassesDeactivate()) return true;
    return accept(component);
  };
}
