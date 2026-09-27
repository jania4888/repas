import {
  Component,
  QueryList,
  ViewChildren,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { NgbDropdown, NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { filter, map, startWith } from 'rxjs';
import { NavItem, NavSubItem } from '@core/config/app-navigation.registry';
import { secondaryNavDisplayLabel } from '@core/config/secondary-nav.config';
import { getNavId } from '@core/config/nav-item-ids';
import { resolveNavLabel, resolveSubNavLabel } from '@core/i18n/erp-nav-label.util';
import { AppNavService } from '@core/services/app-nav.service';
import { AuthService } from '@core/services/auth.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { getNavIconKey } from '@core/utils/nav-icon-key.util';
import { AiAssistantShellService } from '@features/ai-assistant/services/ai-assistant-shell.service';
import { canUseAiAssistant } from '@features/ai-assistant/utils/ai-access.util';
import {
  isNavChildActive,
  isNavRouteActive,
  isNavSubItemActive,
  findLongestMatchingChildInParent,
  stripPathForMatch,
  pathMatchesRoute
} from '@core/utils/nav-path-match';

@Component({
  selector: 'app-secondary-nav',
  standalone: true,
  imports: [CommonModule, RouterModule, NgbDropdownModule],
  templateUrl: './secondary-nav.component.html',
  styleUrl: './secondary-nav.component.scss'
})
export class SecondaryNavComponent {
  private readonly appNav = inject(AppNavService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly firmContext = inject(FirmContextService);
  private readonly aiShell = inject(AiAssistantShellService);

  @ViewChildren(NgbDropdown) private readonly dropdowns!: QueryList<NgbDropdown>;

  readonly sections = this.appNav.secondaryNavSections;

  readonly isFirmDelegatedSkin = computed(
    () => this.auth.isAccountingFirm() && this.auth.isDelegatedMode()
  );

  /** Id of the nested flyout currently open (hover / focus / click). */
  readonly openSubmenuId = signal<string | null>(null);

  private readonly routerUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.closeAllDropdowns();
        this.openSubmenuId.set(null);
      });
  }

  readonly activeSectionId = computed(() => {
    const url = this.routerUrl();
    const path = stripPathForMatch(url);
    let bestId: string | null = null;
    let bestLen = -1;

    for (const section of this.sections()) {
      if (section.children?.length) {
        const child = findLongestMatchingChildInParent(path, section);
        if (child?.route && child.route.length > bestLen) {
          bestLen = child.route.length;
          bestId = getNavId(section);
        }
      } else if (section.route && isNavRouteActive(url, section.route) && section.route.length > bestLen) {
        bestLen = section.route.length;
        bestId = getNavId(section);
      }
    }
    return bestId;
  });

  displayLabel(section: NavItem): string {
    const id = getNavId(section);
    const translated = resolveNavLabel(section);
    return secondaryNavDisplayLabel(id, translated);
  }

  childDisplayLabel(child: NavSubItem): string {
    return resolveSubNavLabel(child);
  }

  navId(item: NavItem | NavSubItem): string {
    return getNavId(item);
  }

  getIconKey(icon?: string): string | null {
    return getNavIconKey(icon);
  }

  isSectionActive(section: NavItem): boolean {
    return this.activeSectionId() === getNavId(section);
  }

  isChildActive(section: NavItem, child: NavSubItem): boolean {
    return isNavSubItemActive(this.routerUrl(), section, child);
  }

  isNestedChildActive(grand: NavSubItem): boolean {
    if (!grand.route) {
      return false;
    }
    return pathMatchesRoute(stripPathForMatch(this.routerUrl()), grand.route);
  }

  isTopLevelActive(section: NavItem): boolean {
    const url = this.routerUrl();
    if (section.children?.length) {
      return isNavChildActive(url, section);
    }
    return isNavRouteActive(url, section.route);
  }

  hasNestedChildren(child: NavSubItem): boolean {
    return !!child.children?.length;
  }

  /** Hub overview link prepended in nested flyouts. */
  nestedHubItem(child: NavSubItem): NavSubItem {
    return {
      label: $localize`:@@core.secondary-nav.ts.tous.les.etats.7da63670:Tous les états`,
      route: child.route,
      icon: child.icon
    };
  }

  isSubmenuOpen(child: NavSubItem): boolean {
    return this.openSubmenuId() === getNavId(child);
  }

  openSubmenu(child: NavSubItem): void {
    if (child.children?.length) {
      this.openSubmenuId.set(getNavId(child));
    }
  }

  closeSubmenu(): void {
    this.openSubmenuId.set(null);
  }

  toggleSubmenu(child: NavSubItem, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!child.children?.length) {
      return;
    }
    const id = getNavId(child);
    this.openSubmenuId.update(current => (current === id ? null : id));
  }

  onSubmenuKeydown(child: NavSubItem, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeSubmenu();
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openSubmenu(child);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.closeSubmenu();
    }
  }

  menuId(section: NavItem): string {
    return `secondary-nav-menu-${getNavId(section)}`;
  }

  submenuId(child: NavSubItem): string {
    return `secondary-nav-submenu-${getNavId(child)}`;
  }

  async onChildClick(child: NavSubItem, dropdown: NgbDropdown, event: Event): Promise<void> {
    event.preventDefault();
    this.closeSubmenu();
    dropdown.close();
    if (child.action === 'returnToFirm') {
      await this.firmContext.returnToFirmHome();
      return;
    }
    if (child.action === 'changeDossier') {
      await this.firmContext.navigateToClientList();
      return;
    }
    if (child.route) {
      if (this.tryOpenWorkspaceAiRoute(child.route)) {
        return;
      }
      await this.router.navigateByUrl(child.route);
    }
  }

  async onTopLevelClick(section: NavItem, event: Event): Promise<void> {
    event.preventDefault();
    this.closeAllDropdowns();
    this.closeSubmenu();
    if (section.route) {
      if (this.tryOpenWorkspaceAiRoute(section.route)) {
        return;
      }
      await this.router.navigateByUrl(section.route);
    }
  }

  private tryOpenWorkspaceAiRoute(route: string): boolean {
    if (!canUseAiAssistant(this.auth) || !this.aiShell.isWorkspaceAiRoute(route)) {
      return false;
    }
    this.aiShell.openAiGeneralTabFromRoute(route, {
      firmDelegated: this.isFirmDelegatedSkin()
    });
    return true;
  }

  private closeAllDropdowns(): void {
    this.dropdowns?.forEach(dd => dd.close());
  }
}
