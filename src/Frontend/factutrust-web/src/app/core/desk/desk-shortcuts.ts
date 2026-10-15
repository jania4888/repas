import { NavItem, NavSubItem } from '@core/config/app-navigation.registry';
import { isDeskWindowUrl, stripDeskPath } from './desk-window-key';

export interface DeskShortcut {
  label: string;
  route: string;
  icon?: string;
}

/** Raccourcis du bureau vide : uniquement les routes déjà visibles dans le menu du dossier. */
export function deskShortcuts(items: readonly NavItem[]): DeskShortcut[] {
  const shortcuts: DeskShortcut[] = [];
  const seen = new Set<string>();
  const visit = (item: NavItem | NavSubItem): void => {
    const action = 'action' in item ? item.action : undefined;
    if (item.route && !action) {
      const path = stripDeskPath(item.route);
      if (isDeskWindowUrl(path) && !seen.has(path)) {
        seen.add(path);
        shortcuts.push({ label: item.label, route: item.route, icon: item.icon });
      }
    }
    item.children?.forEach(visit);
  };
  items.forEach(visit);
  return shortcuts;
}
