import { createEmptyLine } from '../../models/entry-form.model';
import {
  buildStoreSnapshot,
  entryLinesToProposedLines,
  hasMeaningfulEdits,
  hasMeaningfulHeaderEdits,
  hasMeaningfulLineEdits,
  isImportProposalBalanced,
  mergeProposalWithStore,
  recomputeImportDiagnostics,
  submittableRowNumbers,
  withRowNumberPrefix
} from './import-proposal.utils';
import { formatLocalDate } from '../../../shared/accounting-date-utils';
import { JournalEntryProposal } from '../../models/accounting-document-import.models';

const accounts = [
  { id: '1', accountNumber: '607', label: 'Achats', accountClass: 6, isActive: true, isSystem: false, natureType: 0, level: 1 },
  { id: '2', accountNumber: '4011', label: 'Fournisseurs', accountClass: 4, isActive: true, isSystem: false, natureType: 0, level: 1 },
  { id: '3', accountNumber: '9999', label: 'Inactif', accountClass: 6, isActive: false, isSystem: false, natureType: 0, level: 1 }
];

function baseProposal(): JournalEntryProposal {
  return {
    direction: 'PURCHASE',
    directionReason: null,
    journalCode: 'JA',
    entryDate: '2026-08-01',
    label: 'Facture fournisseur',
    pieceRef: 'FAC-001',
    pieceDate: '2026-08-01',
    thirdParty: {
      kind: 2,
      matchedId: null,
      matchedName: null,
      matchedBy: null,
      collectiveAccountNumber: '4011',
      name: 'Supplier',
      nif: null,
      email: null,
      phone: null,
      street: null,
      city: null,
      postalCode: null,
      governorate: null
    },
    lines: [
      {
        accountNumber: '607',
        accountLabel: 'Achats',
        accountStatus: 'found',
        role: 'expense',
        label: 'HT',
        debit: 100,
        credit: 0,
        vatRatePercent: null,
        thirdPartyId: null,
        thirdPartyKind: null
      },
      {
        accountNumber: '4011',
        accountLabel: 'Fournisseurs',
        accountStatus: 'found',
        role: 'thirdparty',
        label: 'Fournisseur',
        debit: 0,
        credit: 100,
        vatRatePercent: null,
        thirdPartyId: null,
        thirdPartyKind: null
      }
    ],
    totalDebit: 100,
    totalCredit: 100,
    documentTotalTtc: 100,
    extraction: {
      documentType: 'INVOICE',
      documentNumber: 'FAC-001',
      issueDate: '2026-08-01',
      dueDate: null,
      documentStatus: null,
      currency: 'TND',
      seller: null,
      buyer: null,
      lines: [],
      vatBreakdown: [],
      totalHt: 100,
      totalVat: 0,
      fodecAmount: null,
      fiscalStampAmount: null,
      withholdingAmount: null,
      totalTtc: 100,
      confidence: 'high',
      warnings: [],
      extractionMethod: 'native-pdf',
      ocrApplied: false,
      vatBreakdownRecomputed: false
    },
    diagnostics: [
      {
        severity: 'warning',
        code: 'ThirdPartyNotMatched',
        message: 'Tiers non rapproché',
        relatedLineIndex: 1
      }
    ],
    hasBlockingDiagnostic: false
  };
}

describe('import-proposal.utils', () => {
  it('detects header edits', () => {
    const p = baseProposal();
    expect(
      hasMeaningfulHeaderEdits(p, {
        journalCode: 'JA',
        entryDate: '2026-08-01',
        entryLabel: 'Facture fournisseur',
        pieceRef: 'FAC-001',
        pieceDate: '2026-08-01'
      })
    ).toBe(false);
    expect(
      hasMeaningfulHeaderEdits(p, {
        journalCode: 'JA',
        entryDate: '2026-08-01',
        entryLabel: 'Autre libellé',
        pieceRef: 'FAC-001',
        pieceDate: '2026-08-01'
      })
    ).toBe(true);
  });

  it('detects line amount edits', () => {
    const p = baseProposal();
    const lines = [
      { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 120, credit: null },
      { ...createEmptyLine(), accountNumber: '4011', lineLabel: 'Fournisseur', debit: null, credit: 100 }
    ];
    expect(hasMeaningfulLineEdits(p.lines, lines)).toBe(true);
  });

  it('maps entry lines to proposed lines with account status', () => {
    const lines = [
      { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 50, credit: null },
      { ...createEmptyLine(), accountNumber: '9999', lineLabel: 'Bad', debit: 50, credit: null }
    ];
    const proposed = entryLinesToProposedLines(lines, baseProposal().lines, accounts, 'PURCHASE');
    expect(proposed[0].accountStatus).toBe('found');
    expect(proposed[1].accountStatus).toBe('inactive');
  });

  it('recomputes blocking account missing diagnostic', () => {
    const p = baseProposal();
    const lines = [
      { ...createEmptyLine(), accountNumber: '8888', lineLabel: 'HT', debit: 100, credit: null },
      { ...createEmptyLine(), accountNumber: '4011', lineLabel: 'Fournisseur', debit: null, credit: 100 }
    ];
    const snapshot = buildStoreSnapshot(
      {
        journalCode: 'JA',
        entryDate: '2026-08-01',
        entryLabel: 'Facture',
        pieceRef: 'FAC-001',
        pieceDate: '2026-08-01'
      },
      lines,
      false,
      true
    );
    const proposed = entryLinesToProposedLines(lines, p.lines, accounts, p.direction);
    const diagnostics = recomputeImportDiagnostics(p, proposed, snapshot, accounts);
    expect(diagnostics.some(d => d.code === 'AccountMissing' && d.severity === 'blocking')).toBe(true);
  });

  it('mergeProposalWithStore updates totals and label', () => {
    const p = baseProposal();
    const lines = [
      { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 80, credit: null },
      { ...createEmptyLine(), accountNumber: '4011', lineLabel: 'Fournisseur', debit: null, credit: 80 }
    ];
    const snapshot = buildStoreSnapshot(
      {
        journalCode: 'JA',
        entryDate: '2026-08-01',
        entryLabel: 'Libellé modifié',
        pieceRef: 'FAC-002',
        pieceDate: '2026-08-01'
      },
      lines,
      false,
      true
    );
    const merged = mergeProposalWithStore(p, snapshot, accounts);
    expect(merged.label).toBe('Libellé modifié');
    expect(merged.pieceRef).toBe('FAC-002');
    expect(merged.totalDebit).toBe(80);
    expect(merged.totalCredit).toBe(80);
    expect(merged.lines.length).toBe(2);
  });

  it('preserves server-only diagnostics like DuplicatePieceRef', () => {
    const p: JournalEntryProposal = {
      ...baseProposal(),
      diagnostics: [
        {
          severity: 'blocking',
          code: 'DuplicatePieceRef',
          message: 'Doublon',
          relatedLineIndex: null
        }
      ],
      hasBlockingDiagnostic: true
    };
    const snapshot = buildStoreSnapshot(
      {
        journalCode: 'JA',
        entryDate: '2026-08-01',
        entryLabel: 'Facture',
        pieceRef: 'FAC-001',
        pieceDate: '2026-08-01'
      },
      [
        { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 100, credit: null },
        { ...createEmptyLine(), accountNumber: '4011', lineLabel: 'Fournisseur', debit: null, credit: 100 }
      ],
      false,
      true
    );
    const merged = mergeProposalWithStore(p, snapshot, accounts);
    expect(merged.diagnostics.some(d => d.code === 'DuplicatePieceRef')).toBe(true);
    expect(merged.hasBlockingDiagnostic).toBe(true);
  });

  describe('third-party diagnostics with matched auxiliary account', () => {
    const accountsWithAux = [
      ...accounts,
      { id: '4', accountNumber: '401002', label: 'Fournisseur ACME', accountClass: 4, isActive: true, isSystem: false, natureType: 1, level: 5, accountType: 2, isAuxiliary: true }
    ];

    function proposalWithMatchedAux(matchedAccountNumber: string | null): JournalEntryProposal {
      const p = baseProposal();
      return {
        ...p,
        thirdParty: {
          ...p.thirdParty!,
          matchedAccountNumber,
          matchedAccountId: matchedAccountNumber ? 'acc-4' : null,
          matchedAccountLabel: matchedAccountNumber ? 'Fournisseur ACME' : null,
          matchedAccountBy: matchedAccountNumber ? 'nif' : null
        }
      };
    }

    function snapshotWithLines(lines: ReturnType<typeof createEmptyLine>[]) {
      return buildStoreSnapshot(
        {
          journalCode: 'JA',
          entryDate: '2026-08-01',
          entryLabel: 'Facture',
          pieceRef: 'FAC-001',
          pieceDate: '2026-08-01'
        },
        lines,
        false,
        true
      );
    }

    it('ne signale pas ThirdPartyNotMatched quand la ligne porte le compte auxiliaire rapproché', () => {
      const p = proposalWithMatchedAux('401002');
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 100, credit: null },
        { ...createEmptyLine(), accountNumber: '401002', lineLabel: 'Fournisseur ACME', debit: null, credit: 100 }
      ];
      const snapshot = snapshotWithLines(lines);
      const proposed = entryLinesToProposedLines(lines, p.lines, accountsWithAux, p.direction);

      const diagnostics = recomputeImportDiagnostics(p, proposed, snapshot, accountsWithAux);

      expect(diagnostics.some(d => d.code === 'ThirdPartyNotMatched')).toBe(false);
    });

    it('retombe sur le diagnostic collectif si aucune ligne ne porte le compte auxiliaire rapproché', () => {
      // Le compte auxiliaire a été rapproché côté serveur, mais l'utilisateur a remis la ligne
      // sur le compte collectif : le diagnostic « tiers non rapproché » doit réapparaître.
      const p = proposalWithMatchedAux('401002');
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 100, credit: null },
        { ...createEmptyLine(), accountNumber: '4011', lineLabel: 'Fournisseur', debit: null, credit: 100 }
      ];
      const snapshot = snapshotWithLines(lines);
      const proposed = entryLinesToProposedLines(lines, p.lines, accountsWithAux, p.direction);

      const diagnostics = recomputeImportDiagnostics(p, proposed, snapshot, accountsWithAux);

      expect(diagnostics.some(d => d.code === 'ThirdPartyNotMatched')).toBe(true);
    });

    it('conserve le comportement existant (diagnostic sur le collectif) quand aucun compte auxiliaire n’a été rapproché', () => {
      const p = proposalWithMatchedAux(null);
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 100, credit: null },
        { ...createEmptyLine(), accountNumber: '4011', lineLabel: 'Fournisseur', debit: null, credit: 100 }
      ];
      const snapshot = snapshotWithLines(lines);
      const proposed = entryLinesToProposedLines(lines, p.lines, accountsWithAux, p.direction);

      const diagnostics = recomputeImportDiagnostics(p, proposed, snapshot, accountsWithAux);

      expect(diagnostics.some(d => d.code === 'ThirdPartyNotMatched')).toBe(true);
    });

    it('préserve les diagnostics déjà produits par le serveur (ex. DuplicatePieceRef) même avec un compte auxiliaire rapproché', () => {
      const p: JournalEntryProposal = {
        ...proposalWithMatchedAux('401002'),
        diagnostics: [
          { severity: 'blocking', code: 'DuplicatePieceRef', message: 'Doublon', relatedLineIndex: null }
        ],
        hasBlockingDiagnostic: true
      };
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 100, credit: null },
        { ...createEmptyLine(), accountNumber: '401002', lineLabel: 'Fournisseur ACME', debit: null, credit: 100 }
      ];
      const snapshot = snapshotWithLines(lines);
      const merged = mergeProposalWithStore(p, snapshot, accountsWithAux);

      expect(merged.diagnostics.some(d => d.code === 'DuplicatePieceRef')).toBe(true);
      expect(merged.diagnostics.some(d => d.code === 'ThirdPartyNotMatched')).toBe(false);
    });
  });

  it('isImportProposalBalanced ignores empty lines', () => {
    const lines = [
      { ...createEmptyLine(), accountNumber: '607', debit: 100, credit: null },
      { ...createEmptyLine(), accountNumber: '4011', debit: null, credit: 100 },
      createEmptyLine()
    ];
    expect(isImportProposalBalanced(lines)).toBe(true);
    lines[1].credit = 90;
    expect(isImportProposalBalanced(lines)).toBe(false);
  });

  it('hasMeaningfulEdits combines header and lines', () => {
    const p = baseProposal();
    const snapshot = buildStoreSnapshot(
      {
        journalCode: 'JA',
        entryDate: '2026-08-01',
        entryLabel: 'Facture fournisseur',
        pieceRef: 'FAC-001',
        pieceDate: '2026-08-01'
      },
      [
        { ...createEmptyLine(), accountNumber: '607', lineLabel: 'HT', debit: 100, credit: null },
        { ...createEmptyLine(), accountNumber: '4011', lineLabel: 'Fournisseur', debit: null, credit: 100 }
      ],
      false,
      true
    );
    expect(hasMeaningfulEdits(p, snapshot)).toBe(false);
  });

  describe('lines editing and diagnostics', () => {
    function header(entryDate = '2026-08-01') {
      return { journalCode: 'JA', entryDate, entryLabel: 'Facture', pieceRef: 'FAC-001', pieceDate: '2026-08-01' };
    }

    function vatProposal(): JournalEntryProposal {
      const p = baseProposal();
      return {
        ...p,
        lines: [
          { ...p.lines[0], debit: 100 },
          { accountNumber: '43666', accountLabel: 'TVA', accountStatus: 'found', role: 'vat', label: 'TVA 19 %', debit: 19, credit: 0, vatRatePercent: 19, thirdPartyId: null, thirdPartyKind: null },
          { ...p.lines[1], credit: 119 }
        ]
      };
    }

    function dateOffset(days: number): string {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return formatLocalDate(d);
    }

    it('keeps role and VAT rate on the matching line after deleting the first line', () => {
      const p = vatProposal();
      const lines = [
        { ...createEmptyLine(), accountNumber: '43666', debit: 19 },
        { ...createEmptyLine(), accountNumber: '4011', credit: 119 }
      ];
      const proposed = entryLinesToProposedLines(lines, p.lines, accounts, p.direction);
      expect(proposed[0]).toEqual(jasmine.objectContaining({ accountNumber: '43666', role: 'vat', vatRatePercent: 19 }));
      expect(proposed[1]).toEqual(jasmine.objectContaining({ accountNumber: '4011', role: 'thirdparty', vatRatePercent: null }));
    });

    it('infers the role of an added line and does not steal the VAT rate on duplicates', () => {
      const p = vatProposal();
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', debit: 100 },
        { ...createEmptyLine(), accountNumber: '607', debit: 5 },
        { ...createEmptyLine(), accountNumber: '43666', debit: 19 },
        { ...createEmptyLine(), accountNumber: '4011', credit: 124 }
      ];
      const proposed = entryLinesToProposedLines(lines, p.lines, accounts, p.direction);
      expect(proposed[1].role).toBe('expense');
      expect(proposed[1].vatRatePercent).toBeNull();
      expect(proposed[2].vatRatePercent).toBe(19);
    });

    it('carries the chosen third party name', () => {
      const p = baseProposal();
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', debit: 100 },
        { ...createEmptyLine(), accountNumber: '4011', credit: 100, thirdParty: { id: 'sup-9', kind: 2, name: 'ACME SARL', display: 'Fournisseur — ACME SARL' } }
      ];
      const proposed = entryLinesToProposedLines(lines, p.lines, accounts, p.direction);
      expect(proposed[1]).toEqual(jasmine.objectContaining({ thirdPartyId: 'sup-9', thirdPartyKind: 2, thirdPartyName: 'ACME SARL' }));
    });

    it('reports a blocking MissingIssueDate when the entry date is empty', () => {
      const p = baseProposal();
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', debit: 100 },
        { ...createEmptyLine(), accountNumber: '4011', credit: 100 }
      ];
      const snapshot = buildStoreSnapshot(header(''), lines, false, true);
      const proposed = entryLinesToProposedLines(lines, p.lines, accounts, p.direction);
      const diagnostics = recomputeImportDiagnostics(p, proposed, snapshot, accounts);
      expect(diagnostics.find(d => d.code === 'MissingIssueDate')?.severity).toBe('blocking');
    });

    it('accepts tomorrow (server tolerance) and blocks later dates', () => {
      const p = baseProposal();
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', debit: 100 },
        { ...createEmptyLine(), accountNumber: '4011', credit: 100 }
      ];
      const proposed = entryLinesToProposedLines(lines, p.lines, accounts, p.direction);
      const tomorrow = recomputeImportDiagnostics(p, proposed, buildStoreSnapshot(header(dateOffset(1)), lines, false, true), accounts);
      const later = recomputeImportDiagnostics(p, proposed, buildStoreSnapshot(header(dateOffset(2)), lines, false, true), accounts);
      expect(tomorrow.some(d => d.code === 'FutureDate')).toBe(false);
      expect(later.some(d => d.code === 'FutureDate')).toBe(true);
    });

    it('keeps server account controls and adds none while the chart is unavailable', () => {
      const p = {
        ...baseProposal(),
        diagnostics: [{ severity: 'blocking' as const, code: 'AccountMissing', message: 'serveur', relatedLineIndex: 0 }]
      };
      const lines = [
        { ...createEmptyLine(), accountNumber: '8888', debit: 100 },
        { ...createEmptyLine(), accountNumber: '7777', credit: 100 }
      ];
      const proposed = entryLinesToProposedLines(lines, p.lines, [], p.direction);
      const diagnostics = recomputeImportDiagnostics(
        p, proposed, buildStoreSnapshot(header(), lines, false, true), [], { accountsAvailable: false }
      );
      const accountDiagnostics = diagnostics.filter(d => d.code === 'AccountMissing');
      expect(accountDiagnostics.length).toBe(1);
      expect(accountDiagnostics[0].message).toBe('serveur');
    });

    it('keeps the server PeriodClosed control until periods are loaded or the date changes', () => {
      const p = {
        ...baseProposal(),
        diagnostics: [{ severity: 'blocking' as const, code: 'PeriodClosed', message: 'clôturée (serveur)', relatedLineIndex: null }]
      };
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', debit: 100 },
        { ...createEmptyLine(), accountNumber: '4011', credit: 100 }
      ];
      const proposed = entryLinesToProposedLines(lines, p.lines, accounts, p.direction);
      const notLoaded = recomputeImportDiagnostics(p, proposed, buildStoreSnapshot(header(), lines, false, false), accounts);
      const sameDate = recomputeImportDiagnostics(p, proposed, buildStoreSnapshot(header(), lines, false, true), accounts);
      const sameDateClientClosed = recomputeImportDiagnostics(p, proposed, buildStoreSnapshot(header(), lines, true, true), accounts);
      const otherDate = recomputeImportDiagnostics(p, proposed, buildStoreSnapshot(header('2026-08-02'), lines, false, true), accounts);
      expect(notLoaded.filter(d => d.code === 'PeriodClosed').length).toBe(1);
      expect(sameDate.filter(d => d.code === 'PeriodClosed').length).toBe(1);
      expect(sameDateClientClosed.filter(d => d.code === 'PeriodClosed').length).toBe(1);
      expect(otherDate.some(d => d.code === 'PeriodClosed')).toBe(false);
    });

    it('maps submittable indexes to grid row numbers and prefixes messages', () => {
      const lines = [
        { ...createEmptyLine(), accountNumber: '607', debit: 100 },
        createEmptyLine(),
        { ...createEmptyLine(), accountNumber: '4011', credit: 100 }
      ];
      const rows = submittableRowNumbers(lines);
      expect(rows).toEqual([1, 3]);
      const prefixed = withRowNumberPrefix({ severity: 'blocking', code: 'AccountMissing', message: 'Absent.', relatedLineIndex: 1 }, rows);
      expect(prefixed.message).toBe('Ligne 3 — Absent.');
      const untouched = { severity: 'info' as const, code: 'X', message: 'Global.', relatedLineIndex: null };
      expect(withRowNumberPrefix(untouched, rows)).toBe(untouched);
      const outOfRange = { severity: 'info' as const, code: 'X', message: 'Hors plage.', relatedLineIndex: 5 };
      expect(withRowNumberPrefix(outOfRange, rows)).toBe(outOfRange);
    });
  });
});
