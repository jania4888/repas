import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BankStatementEntriesStore } from './bank-statement-entries.store';
import { AccountingService } from '../services/accounting.service';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { BankLineProposal, BankStatementProposals } from '../bank-statement-import/bank-statement-import.models';

function proposal(overrides: Partial<BankLineProposal> = {}): BankLineProposal {
  return {
    lineId: 'l-1',
    transactionDate: '2026-09-01T00:00:00',
    valueDate: null,
    label: 'VIR RECU STE ALPHA',
    reference: '',
    amount: 4760,
    isDebit: false,
    isReconciled: false,
    status: 'Proposed',
    confidence: 'Probable',
    source: 'Catalog',
    explanation: '',
    accountNumber: '411000',
    accountLabel: 'Clients',
    accountStatus: 'found',
    thirdPartyId: null,
    thirdPartyKind: 'None',
    thirdPartyName: null,
    requiresThirdParty: true,
    vatSplit: null,
    existingEntry: null,
    generatedEntry: null,
    candidateCount: 0,
    diagnostics: [],
    selectedByDefault: true,
    ...overrides
  };
}

function proposals(lines: BankLineProposal[]): BankStatementProposals {
  return {
    statementId: 'st-1',
    bankAccountId: 'bank-1',
    bankName: 'STB',
    bankGlAccount: '532100',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    openingBalance: 0,
    closingBalance: 0,
    lines,
    unclassifiedDistinctLabels: 0
  };
}

describe('BankStatementEntriesStore', () => {
  let store: BankStatementEntriesStore;
  let accounting: jasmine.SpyObj<AccountingService>;
  let journalCatalog: jasmine.SpyObj<AccountingJournalCatalogService>;

  beforeEach(() => {
    accounting = jasmine.createSpyObj<AccountingService>('AccountingService', ['ensureBankGlProjections', 'listImportableBankAccounts']);
    journalCatalog = jasmine.createSpyObj<AccountingJournalCatalogService>('AccountingJournalCatalogService', ['list', 'listBankJournals']);
    accounting.ensureBankGlProjections.and.returnValue(of({ success: true, data: { createdCount: 0, skippedCount: 0 } }));
    accounting.listImportableBankAccounts.and.returnValue(
      of({
        success: true,
        data: [
          { id: 'a1', bankName: 'STB', designation: null, isDefault: true, isActive: true, chartOfAccountNumber: '53210001', currency: 'TND', hasBankingIdentity: true }
        ]
      })
    );
    journalCatalog.listBankJournals.and.returnValue(of([{ code: 'JB', label: 'Banque', icon: '', shortLabel: 'JB' }]));

    TestBed.configureTestingModule({
      providers: [
        BankStatementEntriesStore,
        { provide: AccountingService, useValue: accounting },
        { provide: AccountingJournalCatalogService, useValue: journalCatalog }
      ]
    });
    store = TestBed.inject(BankStatementEntriesStore);
  });

  it('charge les comptes bancaires éligibles et pré-sélectionne le compte par défaut', () => {
    store.loadSourceReferences();
    expect(store.bankAccounts().length).toBe(1);
    expect(store.bankAccountId()).toBe('a1');
    expect(store.bankAccountsLoaded()).toBe(true);
  });

  it('ne propose que les journaux de banque (JB + non exclus), et retombe sur le premier si besoin', () => {
    store.loadSourceReferences();
    expect(store.journals().map(j => j.code)).toEqual(['JB']);
    expect(store.journalCode()).toBe('JB');
  });

  it('canSubmitSource exige un compte dinar relié à un compte comptable et un fichier', () => {
    store.loadSourceReferences();
    expect(store.canSubmitSource()).toBe(false); // pas de fichier encore
    store.setFile(new File(['x'], 'r.pdf', { type: 'application/pdf' }), 'document');
    expect(store.canSubmitSource()).toBe(true);
  });

  it('setFile(kind!=tabular) efface le mappage et l’aperçu en cours', () => {
    store.mapping.set({ headerRowIndex: 0, dateFormat: 'dd/MM/yyyy', decimalSeparator: ',', amountMode: 'signed', dateColumn: 0, labelColumns: [1] });
    store.setFile(new File(['x'], 'r.pdf', { type: 'application/pdf' }), 'document');
    expect(store.mapping()).toBeNull();
  });

  it('mappingRequiredRolesFilled exige date, libellé, montant (débit/crédit ou signé) et un solde exploitable', () => {
    expect(store.mappingRequiredRolesFilled()).toBe(false);
    store.mapping.set({ headerRowIndex: 0, dateFormat: 'dd/MM/yyyy', decimalSeparator: ',', amountMode: 'debitCredit', dateColumn: 0, labelColumns: [1] });
    expect(store.mappingRequiredRolesFilled()).toBe(false); // ni débit ni crédit mappé
    store.updateMapping({ debitColumn: 2 });
    expect(store.mappingRequiredRolesFilled()).toBe(false); // aucun solde exploitable (ni colonne, ni saisie)
    store.updateMapping({ balanceColumn: 3 });
    expect(store.mappingRequiredRolesFilled()).toBe(true);
    store.updateMapping({ balanceColumn: null, openingBalance: 100 });
    expect(store.mappingRequiredRolesFilled()).toBe(false); // solde de clôture manquant
    store.updateMapping({ closingBalance: 90 });
    expect(store.mappingRequiredRolesFilled()).toBe(true); // saisie manuelle complète des deux soldes
  });

  it('updateMapping remplace le mappage par un nouvel objet (jamais de mutation du précédent)', () => {
    const initial = { headerRowIndex: 0, dateFormat: 'dd/MM/yyyy' as const, decimalSeparator: ',' as const, amountMode: 'signed' as const, dateColumn: 0, labelColumns: [1] };
    store.mapping.set(initial);
    store.updateMapping({ dateColumn: 1 });
    expect(store.mapping()).not.toBe(initial);
    expect(initial.dateColumn).toBe(0);
    expect(store.mapping()?.dateColumn).toBe(1);
  });

  describe('propositions (étape 4)', () => {
    beforeEach(() => {
      store.setProposals(
        proposals([
          proposal({ lineId: 'l-1', status: 'Proposed', source: 'Catalog' }),
          proposal({ lineId: 'l-2', status: 'ToComplete', source: 'Fallback', accountNumber: '471000' }),
          proposal({ lineId: 'l-3', status: 'Generated' }),
          proposal({ lineId: 'l-4', status: 'Proposed', source: 'History' })
        ])
      );
    });

    it('convertit chaque proposition en ligne éditable', () => {
      expect(store.rows().length).toBe(4);
    });

    it('filtre "todo" montre les lignes non réglées sans compte ou à compléter', () => {
      store.rowFilter.set('todo');
      expect(store.visibleRows().map(r => r.proposal.lineId)).toEqual(['l-2']);
    });

    it('filtre "at471" montre les lignes au compte d’attente (source Fallback)', () => {
      store.rowFilter.set('at471');
      expect(store.visibleRows().map(r => r.proposal.lineId)).toEqual(['l-2']);
    });

    it('filtre "settled" montre les lignes déjà réglées', () => {
      store.rowFilter.set('settled');
      expect(store.visibleRows().map(r => r.proposal.lineId)).toEqual(['l-3']);
    });

    it('updateRow remplace une seule ligne par une nouvelle référence, sans toucher les autres', () => {
      const before = store.rows();
      const l1Before = before.find(r => r.proposal.lineId === 'l-1');
      store.updateRow('l-1', { account: '6278' });
      const after = store.rows();
      expect(after).not.toBe(before);
      expect(after.find(r => r.proposal.lineId === 'l-1')).not.toBe(l1Before);
      expect(after.find(r => r.proposal.lineId === 'l-1')?.account).toBe('6278');
      expect(after.find(r => r.proposal.lineId === 'l-2')).toBe(before.find(r => r.proposal.lineId === 'l-2'));
    });

    it('setRowSelected coche/décoche une seule ligne', () => {
      store.setRowSelected('l-1', false);
      expect(store.rows().find(r => r.proposal.lineId === 'l-1')?.selected).toBe(false);
      expect(store.rows().find(r => r.proposal.lineId === 'l-2')?.selected).toBe(true);
    });

    it('selectAllVisible ne coche que les lignes visibles, jamais les réglées ni les bloquées', () => {
      store.selectAllVisible(false);
      expect(store.rows().find(r => r.proposal.lineId === 'l-3')?.selected).toBe(true); // réglée, non touchée
      expect(store.rows().filter(r => r.proposal.lineId !== 'l-3').every(r => r.selected === false)).toBe(true);
    });

    it('selectedCount compte les lignes cochées', () => {
      expect(store.selectedCount()).toBe(4);
      store.setRowSelected('l-1', false);
      expect(store.selectedCount()).toBe(3);
    });
  });
});
