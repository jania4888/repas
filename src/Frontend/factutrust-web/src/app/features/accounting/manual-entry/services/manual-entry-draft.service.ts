import { Injectable, inject } from '@angular/core';
import { ColumnVisibility, EntryTabId } from '../models/entry-form.model';
import { AuthService } from '@core/services/auth.service';

export interface ManualEntryDraftLine {
  accountNumber: string;
  lineLabel: string;
  debit: number | null;
  credit: number | null;
}

export interface ManualEntryDraft {
  journalCode: string;
  entryDate: string;
  entryLabel: string;
  lines: ManualEntryDraftLine[];
  savedAt: string;
  /** v2 fields */
  workNotes?: string;
  activeTab?: EntryTabId;
  columnVisibility?: ColumnVisibility;
  schemaVersion?: number;
}

/**
 * Persists a single in-progress manual journal entry as JSON in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ManualEntryDraftService {
  private static readonly STORAGE_KEY_V2 = 'ft:manual-entry:draft:v2';
  private static readonly STORAGE_KEY_V1 = 'factutrust:manual-entry:draft:v1';
  private static readonly TTL_DAYS = 7;

  private readonly auth = inject(AuthService);

  /** Clé du dossier courant. L'ancienne clé sans suffixe n'est lue qu'une fois, puis rattachée à ce dossier. */
  storageKey(): string {
    return `${ManualEntryDraftService.STORAGE_KEY_V2}:${this.tenantScope()}`;
  }

  save(draft: Omit<ManualEntryDraft, 'savedAt' | 'schemaVersion'>): void {
    if (!this.isBrowser()) return;
    try {
      const payload: ManualEntryDraft = {
        ...draft,
        schemaVersion: 2,
        savedAt: new Date().toISOString()
      };
      window.localStorage.setItem(this.storageKey(), JSON.stringify(payload));
      window.localStorage.removeItem(ManualEntryDraftService.STORAGE_KEY_V1);
      window.localStorage.removeItem(ManualEntryDraftService.STORAGE_KEY_V2);
    } catch {
      // Quota exceeded or unavailable — silently ignore.
    }
  }

  load(): ManualEntryDraft | null {
    if (!this.isBrowser()) return null;
    const current = this.loadFromKey(this.storageKey());
    if (current) return current;
    const legacy = this.loadFromKey(ManualEntryDraftService.STORAGE_KEY_V2);
    if (legacy) {
      this.save(legacy);
      return legacy;
    }
    const v1 = this.loadFromKey(ManualEntryDraftService.STORAGE_KEY_V1);
    if (!v1) return null;
    return this.migrateV1ToV2(v1);
  }

  private loadFromKey(key: string): ManualEntryDraft | null {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ManualEntryDraft;
      if (!parsed || !parsed.savedAt || !Array.isArray(parsed.lines)) {
        this.clearKey(key);
        return null;
      }
      const savedAt = new Date(parsed.savedAt);
      const ageMs = Date.now() - savedAt.getTime();
      const ttlMs = ManualEntryDraftService.TTL_DAYS * 24 * 60 * 60 * 1000;
      if (Number.isNaN(savedAt.getTime()) || ageMs > ttlMs) {
        this.clearKey(key);
        return null;
      }
      return parsed;
    } catch {
      this.clearKey(key);
      return null;
    }
  }

  private migrateV1ToV2(v1: ManualEntryDraft): ManualEntryDraft {
    const migrated: ManualEntryDraft = {
      ...v1,
      schemaVersion: 2,
      workNotes: '',
      activeTab: 'standard'
    };
    this.save(migrated);
    return migrated;
  }

  clear(): void {
    if (!this.isBrowser()) return;
    this.clearKey(this.storageKey());
    this.clearKey(ManualEntryDraftService.STORAGE_KEY_V2);
    this.clearKey(ManualEntryDraftService.STORAGE_KEY_V1);
  }

  private clearKey(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore
    }
  }

  isMeaningful(draft: ManualEntryDraft): boolean {
    if (draft.entryLabel.trim().length > 0) return true;
    if ((draft.workNotes ?? '').trim().length > 0) return true;
    return draft.lines.some(l =>
      l.accountNumber.trim().length > 0 ||
      l.lineLabel.trim().length > 0 ||
      (l.debit ?? 0) > 0 ||
      (l.credit ?? 0) > 0
    );
  }

  private tenantScope(): string {
    const user = this.auth.user();
    if (user?.accessMode === 'delegated' && user.contextTenantId) return user.contextTenantId;
    return user?.tenantId || 'local';
  }

  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }
}
