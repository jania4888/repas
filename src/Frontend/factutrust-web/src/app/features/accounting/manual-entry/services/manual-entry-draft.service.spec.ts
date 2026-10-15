import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import { ManualEntryDraftService } from './manual-entry-draft.service';

describe('ManualEntryDraftService dossier', () => {
  const user = signal<{
    id: string;
    tenantId: string;
    accessMode: string;
    contextTenantId?: string | null;
  } | null>(null);
  let drafts: ManualEntryDraftService;

  beforeEach(() => {
    clearDrafts();
    user.set({ id: 'u1', tenantId: 'firm-1', accessMode: 'delegated', contextTenantId: 'client-a' });
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { user } }]
    });
    drafts = TestBed.inject(ManualEntryDraftService);
  });

  afterEach(() => clearDrafts());

  it('ne relit pas le brouillon d’un autre dossier', () => {
    drafts.save(draft('Achat client A'));

    user.set({ id: 'u1', tenantId: 'firm-1', accessMode: 'delegated', contextTenantId: 'client-b' });
    expect(drafts.load()).toBeNull();

    drafts.save(draft('Achat client B'));
    user.set({ id: 'u1', tenantId: 'firm-1', accessMode: 'delegated', contextTenantId: 'client-a' });
    expect(drafts.load()?.entryLabel).toBe('Achat client A');
    expect(drafts.storageKey()).toBe('ft:manual-entry:draft:v2:client-a');
  });

  it('rattache une seule fois l’ancienne clé sans suffixe au dossier courant', () => {
    localStorage.setItem('ft:manual-entry:draft:v2', JSON.stringify({
      ...draft('Brouillon historique'),
      savedAt: new Date().toISOString(),
      schemaVersion: 2
    }));

    expect(drafts.load()?.entryLabel).toBe('Brouillon historique');
    expect(localStorage.getItem('ft:manual-entry:draft:v2')).toBeNull();
    expect(localStorage.getItem('ft:manual-entry:draft:v2:client-a')).toContain('Brouillon historique');

    user.set({ id: 'u1', tenantId: 'firm-1', accessMode: 'delegated', contextTenantId: 'client-b' });
    expect(drafts.load()).toBeNull();
  });
});

function draft(entryLabel: string) {
  return {
    journalCode: 'JA',
    entryDate: '2026-10-15',
    entryLabel,
    lines: [{ accountNumber: '401', lineLabel: 'Fournisseur', debit: null, credit: 10 }]
  };
}

function clearDrafts(): void {
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith('ft:manual-entry:draft:') || key.startsWith('factutrust:manual-entry:draft:')) {
      localStorage.removeItem(key);
    }
  }
}
