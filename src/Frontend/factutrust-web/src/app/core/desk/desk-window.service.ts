/// <reference types="@angular/localize" />
import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { currentDeskNavigation, shouldBypassDeskDeactivate } from './desk-deactivate.logic';
import { componentCanClose, componentIsDirty, deskHandleInstance } from './desk-handle';
import { DeskLeaveRegistry } from './desk-leave.registry';
import { DeskTenantReset } from './desk-tenant-reset';
import { DeskTitleService } from './desk-title.service';
import { DESK_HOME_URL, DeskNavigationState, DeskWindow } from './desk-window.model';
import { deskTenantKey, deskWindowKeyFromUrl, isDeskWindowUrl, normalizeDeskUrl } from './desk-window-key';
import { DeskWindowStore } from './desk-window.store';

export type DeskGuardDecision =
  | { kind: 'allow' }
  | { kind: 'block'; reason: 'cap' | 'overlay' }
  | { kind: 'redirect'; url: string };

@Injectable({ providedIn: 'root' })
export class DeskWindowService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly store = inject(DeskWindowStore);
  private readonly titles = inject(DeskTitleService);
  private readonly leave = inject(DeskLeaveRegistry);
  private readonly tenantReset = inject(DeskTenantReset);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly document = inject(DOCUMENT);

  private userId = '';
  private tenant = '';
  private seenUser = false;

  readonly windows = this.store.windows;
  readonly activeKey = this.store.activeKey;
  readonly enabled = this.store.enabled;
  readonly activeWindow = computed(() => {
    const key = this.store.activeKey();
    if (!key) return null;
    const window = this.store.find(key);
    return window && !window.minimized ? window : null;
  });

  constructor() {
    this.leave.register(
      () => this.confirmLeave(),
      () => this.store.setBypassDeactivate(false)
    );
    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) this.onNavigationStart();
      else if (event instanceof NavigationEnd) this.onNavigationEnd(event.urlAfterRedirects);
      else if (
        event instanceof NavigationCancel ||
        event instanceof NavigationError ||
        event instanceof NavigationSkipped
      ) {
        this.store.clearClosing();
      }
    });
    this.syncMode();
    effect(() => {
      this.auth.user();
      untracked(() => this.syncMode());
    });
  }

  isEnabled(): boolean {
    return this.store.isEnabled();
  }

  syncMode(): void {
    const user = this.auth.user();
    const enabled = !!user && this.auth.isAccountingFirm() && this.auth.isDelegatedMode();
    const tenant = deskTenantKey(user);
    const userId = user?.id ?? '';
    if (this.seenUser) {
      const leavingUser = userId !== this.userId;
      const leavingTenant = tenant !== this.tenant;
      const leavingMode = this.store.isEnabled() && !enabled;
      if (leavingUser || leavingTenant || leavingMode) {
        const previousTenant = this.tenant;
        this.store.discardAll();
        this.tenantReset.run();
        if (leavingUser && previousTenant) this.store.clearPersisted(previousTenant);
      }
    }
    this.seenUser = true;
    this.userId = userId;
    this.tenant = tenant;
    this.store.setEnabled(enabled);
    this.store.setTenantKey(tenant);
    if (enabled) {
      this.store.restore(tenant);
      if (this.router.navigated) this.noteArrival(this.router.url);
    }
  }

  bypassesDeactivate(): boolean {
    const navigation = currentDeskNavigation(this.router);
    return shouldBypassDeskDeactivate({
      enabled: this.store.isEnabled(),
      bypass: this.store.bypassesDeactivate(),
      state: navigation.state,
      nextUrl: navigation.nextUrl
    });
  }

  evaluate(url: string, state: DeskNavigationState = {}): DeskGuardDecision {
    if (!this.store.isEnabled()) return { kind: 'allow' };
    const key = deskWindowKeyFromUrl(url);
    const switching = !!key && key !== this.store.activeKey();
    const closing = state.deskAction === 'close-current';
    if ((switching || closing || isLeavingActive(url, this.store.activeKey())) && this.overlayOpen()) {
      return { kind: 'block', reason: 'overlay' };
    }
    if (!key) return { kind: 'allow' };
    const existing = this.store.find(key);
    if (
      existing &&
      existing.key !== this.store.activeKey() &&
      state.deskAction !== 'close-current' &&
      normalizeDeskUrl(existing.url) !== normalizeDeskUrl(url)
    ) {
      return { kind: 'redirect', url: existing.url };
    }
    if (!existing && !this.store.ensureRoomFor(key)) return { kind: 'block', reason: 'cap' };
    return { kind: 'allow' };
  }

  explain(reason: 'cap' | 'overlay'): void {
    const detail =
      reason === 'overlay'
        ? $localize`:@@core.desk.overlay:Fermez d'abord la fenêtre de dialogue.`
        : $localize`:@@core.desk.cap:Huit fenêtres sont déjà ouvertes. Fermez-en une pour continuer.`;
    this.toast.add({
      severity: 'warn',
      summary: $localize`:@@core.desk.titlebar:Fenêtres`,
      detail,
      life: 5000
    });
  }

  overlayOpen(): boolean {
    const query = this.document?.querySelector?.bind(this.document);
    if (!query) return false;
    return !!query('.p-dialog-mask, ngb-modal-window');
  }

  async activate(key: string): Promise<boolean> {
    const window = this.store.find(key);
    if (!window || !this.store.isEnabled()) return false;
    if (this.store.activeKey() === key && !window.minimized) return true;
    if (this.overlayOpen()) {
      this.explain('overlay');
      return false;
    }
    return this.router.navigateByUrl(window.url, { state: { deskAction: 'preserve' } satisfies DeskNavigationState });
  }

  async minimize(key: string): Promise<boolean> {
    const window = this.store.find(key);
    if (!window || !this.store.isEnabled() || window.minimized) return false;
    if (this.overlayOpen()) {
      this.explain('overlay');
      return false;
    }
    this.store.patch(key, { minimized: true });
    if (this.store.activeKey() !== key) return true;
    const next = this.store.fallbackUrl(key) ?? DESK_HOME_URL;
    const ok = await this.router.navigateByUrl(next, { state: { deskAction: 'preserve' } satisfies DeskNavigationState });
    if (!ok) this.store.patch(key, { minimized: false });
    return ok;
  }

  async close(key: string): Promise<boolean> {
    const window = this.store.find(key);
    if (!window || !this.store.isEnabled()) return false;
    if (this.overlayOpen()) {
      this.explain('overlay');
      return false;
    }
    if (this.store.activeKey() === key) {
      const next = this.store.fallbackUrl(key) ?? DESK_HOME_URL;
      return this.router.navigateByUrl(next, {
        state: { deskAction: 'close-current' } satisfies DeskNavigationState
      });
    }
    const instance = deskHandleInstance(this.store.peekHandle(key));
    if (!componentCanClose(instance)) return false;
    this.store.destroyHandle(key);
    this.titles.forget(key);
    this.store.remove(key);
    return true;
  }

  publishTitle(url: string, title: string): void {
    const key = deskWindowKeyFromUrl(url);
    if (!key) return;
    this.titles.publish(key, title);
    this.store.rename(key, title);
  }

  private confirmLeave(): boolean | Promise<boolean> {
    if (!this.store.isEnabled()) return true;
    const titles = this.dirtyTitles();
    if (titles.length === 0) return true;
    const list = titles.join(', ');
    return new Promise(resolve => {
      this.confirmation.confirm({
        header: $localize`:@@core.desk.leave.header:Quitter le dossier`,
        message: $localize`:@@core.desk.leave.message:Des modifications non enregistrées seront perdues : ${list}:titles:`,
        acceptLabel: $localize`:@@core.desk.leave.accept:Quitter quand même`,
        rejectLabel: $localize`:@@core.desk.leave.reject:Rester`,
        acceptButtonStyleClass: 'btn-danger',
        size: 'md',
        accept: () => {
          this.store.setBypassDeactivate(true);
          resolve(true);
        },
        reject: () => resolve(false)
      });
    });
  }

  private dirtyTitles(): string[] {
    const titles: string[] = [];
    for (const window of this.store.windows()) {
      const instance =
        window.key === this.store.activeKey()
          ? this.store.getActiveInstance()
          : deskHandleInstance(this.store.peekHandle(window.key));
      if (componentIsDirty(instance)) titles.push(window.title);
    }
    return titles;
  }

  private onNavigationStart(): void {
    if (!this.store.isEnabled()) return;
    const navigation = currentDeskNavigation(this.router);
    if (navigation.state.deskAction !== 'close-current') return;
    const active = this.store.activeKey();
    const nextKey = deskWindowKeyFromUrl(navigation.nextUrl);
    if (active && active !== nextKey) this.store.markClosing(active);
  }

  private onNavigationEnd(url: string): void {
    if (!this.store.isEnabled()) return;
    this.store.dropClosing();
    this.noteArrival(url);
  }

  private noteArrival(url: string): void {
    const previous = this.store.activeKey();
    const key = deskWindowKeyFromUrl(url);
    if (!key) {
      this.store.setActiveKey(null);
      return;
    }
    const override = this.titles.override(key);
    const title = override || titleFromRouter(this.router) || key;
    this.store.upsert({ key, url, title, tenantKey: this.store.tenantKey() });
    this.store.setActiveKey(key);
    if (previous !== key) {
      queueMicrotask(() => this.document.getElementById('main-content')?.focus());
    }
  }
}

function isLeavingActive(url: string, activeKey: string | null): boolean {
  if (!activeKey) return false;
  const next = deskWindowKeyFromUrl(url);
  return next !== activeKey && !isDeskWindowUrl(url);
}

function titleFromRouter(router: Router): string | null {
  let route: ActivatedRouteSnapshot | null = router.routerState.snapshot.root;
  let title: string | null = null;
  while (route) {
    const resolved = (route as ActivatedRouteSnapshot & { title?: string }).title;
    if (resolved) title = resolved;
    route = route.firstChild;
  }
  if (!title) return null;
  return title.replace(/\s+-\s+InstaFact\s*$/i, '').trim() || title;
}
