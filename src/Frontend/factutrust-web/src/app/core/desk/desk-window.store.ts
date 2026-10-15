import { Injectable, signal } from '@angular/core';
import { DESK_SESSION_PREFIX, DESK_WINDOW_CAP, DeskSessionRecord, DeskWindow } from './desk-window.model';
import { destroyDeskHandle } from './desk-handle';

@Injectable({ providedIn: 'root' })
export class DeskWindowStore {
  private readonly windowsSignal = signal<DeskWindow[]>([]);
  private readonly activeKeySignal = signal<string | null>(null);
  private readonly enabledSignal = signal(false);
  private readonly tenantSignal = signal('');
  private readonly bypassSignal = signal(false);

  readonly windows = this.windowsSignal.asReadonly();
  readonly activeKey = this.activeKeySignal.asReadonly();
  readonly enabled = this.enabledSignal.asReadonly();
  readonly tenantKey = this.tenantSignal.asReadonly();

  private readonly handles = new Map<string, unknown>();
  private readonly closing = new Set<string>();
  private activeInstance: object | null = null;
  private restoredTenant: string | null = null;
  private persistSuspended = false;

  isEnabled(): boolean {
    return this.enabledSignal();
  }

  setEnabled(value: boolean): void {
    this.enabledSignal.set(value);
  }

  setTenantKey(value: string): void {
    this.tenantSignal.set(value);
  }

  bypassesDeactivate(): boolean {
    return this.bypassSignal();
  }

  setBypassDeactivate(value: boolean): void {
    this.bypassSignal.set(value);
  }

  setActiveInstance(instance: object | null): void {
    this.activeInstance = instance;
  }

  getActiveInstance(): object | null {
    return this.activeInstance;
  }

  find(key: string): DeskWindow | undefined {
    return this.windowsSignal().find(window => window.key === key);
  }

  setActiveKey(key: string | null): void {
    this.activeKeySignal.set(key);
  }

  markClosing(key: string | null): void {
    if (key) this.closing.add(key);
  }

  isClosing(key: string): boolean {
    return this.closing.has(key);
  }

  clearClosing(): void {
    this.closing.clear();
  }

  /** Retire les fenêtres dont la navigation de fermeture a abouti, et détruit leur instance. */
  dropClosing(): void {
    const keys = [...this.closing];
    this.closing.clear();
    for (const key of keys) {
      this.destroyHandle(key);
      this.remove(key, false);
    }
    if (keys.length > 0) this.persist();
  }

  rememberHandle(key: string, handle: unknown): void {
    const previous = this.handles.get(key);
    if (previous && previous !== handle) destroyDeskHandle(previous);
    this.handles.set(key, handle);
    this.patch(key, { hydrated: true }, false);
  }

  /** Le routeur a repris le handle (`store(null)` après `retrieve`). On oublie la référence sans détruire. */
  forgetHandle(key: string): void {
    this.handles.delete(key);
    this.patch(key, { hydrated: false }, false);
  }

  peekHandle(key: string): unknown {
    return this.handles.get(key) ?? null;
  }

  hasHandle(key: string): boolean {
    return this.handles.has(key);
  }

  destroyHandle(key: string): void {
    const handle = this.handles.get(key);
    if (!handle) return;
    this.handles.delete(key);
    destroyDeskHandle(handle);
    this.patch(key, { hydrated: false }, false);
  }

  destroyAllHandles(): void {
    for (const key of [...this.handles.keys()]) this.destroyHandle(key);
  }

  upsert(window: Pick<DeskWindow, 'key' | 'url' | 'title' | 'tenantKey'>): void {
    const now = Date.now();
    this.windowsSignal.update(list => {
      const index = list.findIndex(item => item.key === window.key);
      if (index >= 0) {
        const next = [...list];
        const current = next[index];
        next[index] = {
          ...current,
          url: window.url,
          title: window.title || current.title,
          tenantKey: window.tenantKey,
          minimized: false,
          lastFocusedAt: now
        };
        return next;
      }
      return [
        ...list,
        {
          id: newDeskId(),
          key: window.key,
          url: window.url,
          title: window.title,
          minimized: false,
          tenantKey: window.tenantKey,
          openedAt: now,
          lastFocusedAt: now,
          hydrated: this.handles.has(window.key)
        }
      ];
    });
    this.persist();
  }

  patch(key: string, partial: Partial<DeskWindow>, persist = true): void {
    this.windowsSignal.update(list =>
      list.map(window => (window.key === key ? { ...window, ...partial, key: window.key } : window))
    );
    if (persist) this.persist();
  }

  rename(key: string, title: string): void {
    if (!title.trim()) return;
    this.patch(key, { title });
  }

  remove(key: string, persist = true): void {
    this.windowsSignal.update(list => list.filter(window => window.key !== key));
    if (this.activeKeySignal() === key) this.activeKeySignal.set(null);
    if (persist) this.persist();
  }

  /**
   * Fait de la place pour une nouvelle clé. N'évince qu'une fenêtre non hydratée
   * (simple URL de session, aucune saisie en mémoire).
   */
  ensureRoomFor(key: string): boolean {
    if (this.find(key)) return true;
    if (this.windowsSignal().length < DESK_WINDOW_CAP) return true;
    const victim = [...this.windowsSignal()]
      .filter(window => !window.hydrated && !this.handles.has(window.key))
      .sort((a, b) => a.lastFocusedAt - b.lastFocusedAt)[0];
    if (!victim) return false;
    this.remove(victim.key);
    return this.windowsSignal().length < DESK_WINDOW_CAP;
  }

  fallbackUrl(exceptKey: string): string | null {
    const candidate = [...this.windowsSignal()]
      .filter(window => window.key !== exceptKey && !window.minimized)
      .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
    return candidate?.url ?? null;
  }

  /**
   * Oublie les instances. Ne touche pas au sessionStorage : le même utilisateur
   * qui rouvre ce dossier retrouve les URL, pas les formulaires.
   */
  discardAll(): void {
    this.persistSuspended = true;
    this.destroyAllHandles();
    this.closing.clear();
    this.windowsSignal.set([]);
    this.activeKeySignal.set(null);
    this.activeInstance = null;
    this.bypassSignal.set(false);
    this.restoredTenant = null;
    this.persistSuspended = false;
  }

  restore(tenantKey: string): void {
    if (!tenantKey || this.restoredTenant === tenantKey) return;
    this.restoredTenant = tenantKey;
    const records = readSession(tenantKey)
      .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)
      .slice(0, DESK_WINDOW_CAP);
    const now = Date.now();
    this.windowsSignal.set(
      records.map(record => ({
        id: newDeskId(),
        key: record.key,
        url: record.url,
        title: record.title,
        minimized: record.minimized,
        tenantKey,
        openedAt: now,
        lastFocusedAt: record.lastFocusedAt || now,
        hydrated: false
      }))
    );
  }

  clearPersisted(tenantKey: string): void {
    if (!tenantKey || !hasSessionStorage()) return;
    try {
      sessionStorage.removeItem(sessionKey(tenantKey));
    } catch {
      // Stockage indisponible.
    }
  }

  private persist(): void {
    if (this.persistSuspended || !this.enabledSignal()) return;
    const tenant = this.tenantSignal();
    if (!tenant || !hasSessionStorage()) return;
    const records: DeskSessionRecord[] = this.windowsSignal().map(window => ({
      key: window.key,
      url: window.url,
      title: window.title,
      minimized: window.minimized,
      lastFocusedAt: window.lastFocusedAt
    }));
    try {
      sessionStorage.setItem(sessionKey(tenant), JSON.stringify(records));
    } catch {
      // Quota ou navigation privée : le bureau reste en mémoire pour cet onglet.
    }
  }
}

function sessionKey(tenantKey: string): string {
  return `${DESK_SESSION_PREFIX}${tenantKey}`;
}

function hasSessionStorage(): boolean {
  return typeof sessionStorage !== 'undefined';
}

function readSession(tenantKey: string): DeskSessionRecord[] {
  if (!hasSessionStorage()) return [];
  try {
    const raw = sessionStorage.getItem(sessionKey(tenantKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSessionRecord);
  } catch {
    return [];
  }
}

function isSessionRecord(value: unknown): value is DeskSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as DeskSessionRecord;
  return typeof record.key === 'string' && typeof record.url === 'string' && typeof record.title === 'string';
}

function newDeskId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `desk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
