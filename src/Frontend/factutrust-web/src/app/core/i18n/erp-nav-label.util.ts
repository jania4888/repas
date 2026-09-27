import type { NavItem, NavSubItem } from '@core/config/app-navigation.registry';
import { getNavId } from '@core/config/nav-item-ids';
import { NAV_LABELS } from './nav-labels';

export function resolveNavLabel(item: Pick<NavItem, 'id' | 'label'>): string {
  const id = getNavId(item);
  return NAV_LABELS[id] ?? item.label;
}

export function resolveSubNavLabel(item: Pick<NavSubItem, 'id' | 'label'>): string {
  if (!item.id) {
    return item.label;
  }
  return NAV_LABELS[item.id] ?? item.label;
}

/** @deprecated use resolveNavLabel — kept for secondary-nav fiscal short label mapping. */
export function coreNavKeyForId(navId: string): string {
  return navId;
}
