import { LetteringLine } from '../../models/lettering.models';
import { LetteringLedgerPaneComponent } from './lettering-ledger-pane.component';

function line(overrides: Partial<LetteringLine>): LetteringLine {
  return {
    lineId: 'l1',
    entryId: 'e1',
    entryDate: '2026-01-01',
    journalCode: 'JOD',
    entryNumber: 1,
    accountNumber: '4111',
    label: 'Ligne',
    pieceRef: null,
    documentType: null,
    thirdPartyId: null,
    thirdPartyKind: null,
    thirdPartyName: null,
    debit: 0,
    credit: 0,
    currency: 'TND',
    debitInCurrency: 0,
    creditInCurrency: 0,
    letteringCode: null,
    isPartiallyLettered: false,
    isDraft: false,
    isReversed: false,
    isReversal: false,
    periodLocked: false,
    ...overrides
  };
}

describe('LetteringLedgerPaneComponent', () => {
  let component: LetteringLedgerPaneComponent;

  beforeEach(() => {
    component = new LetteringLedgerPaneComponent();
    component.side = 'debit';
  });

  describe('isRowSelectable (règle D9 stricte)', () => {
    it('rejette une ligne verrouillée même non lettrée', () => {
      expect(component.isRowSelectable(line({ periodLocked: true }))).toBe(false);
    });

    it('rejette une ligne déjà lettrée définitivement (code L)', () => {
      expect(component.isRowSelectable(line({ letteringCode: 'L00001', isPartiallyLettered: false }))).toBe(false);
    });

    it('accepte une ligne non lettrée et non verrouillée', () => {
      expect(component.isRowSelectable(line({}))).toBe(true);
    });

    it('accepte une ligne partiellement lettrée (code P) pour compléter le groupe', () => {
      expect(component.isRowSelectable(line({ letteringCode: 'P00003', isPartiallyLettered: true }))).toBe(true);
    });

    it('rejette toute ligne quand le volet est en lecture seule', () => {
      component.readOnly = true;
      expect(component.isRowSelectable(line({}))).toBe(false);
    });

    it('rejette une ligne partiellement lettrée mais verrouillée', () => {
      expect(
        component.isRowSelectable(line({ letteringCode: 'P00003', isPartiallyLettered: true, periodLocked: true }))
      ).toBe(false);
    });
  });

  describe('rowSelectableFn', () => {
    it("délègue à isRowSelectable sur la propriété 'data' (contrat p-table)", () => {
      const lettered = line({ letteringCode: 'L00001' });
      expect(component.rowSelectableFn({ data: lettered })).toBe(false);
      expect(component.rowSelectableFn({ data: line({}) })).toBe(true);
    });
  });

  describe('sélection (getter/setter lié à [(selection)])', () => {
    it('selectedLines ne retient que les lignes présentes dans selectedIds', () => {
      const a = line({ lineId: 'a' });
      const b = line({ lineId: 'b' });
      component.lines = [a, b];
      component.selectedIds = new Set(['b']);
      expect(component.selectedLines).toEqual([b]);
    });

    it('écrire selectedLines émet les identifiants via selectionChange', () => {
      const a = line({ lineId: 'a' });
      const b = line({ lineId: 'b' });
      component.lines = [a, b];
      const emitted: (readonly string[])[] = [];
      component.selectionChange.subscribe(ids => emitted.push(ids));
      component.selectedLines = [b];
      expect(emitted).toEqual([['b']]);
    });
  });

  describe('rows', () => {
    it('expose les lignes en entrée comme un tableau mutable pour p-table', () => {
      const a = line({ lineId: 'a' });
      component.lines = [a];
      expect(component.rows).toEqual([a]);
    });
  });

  describe('rowStateLabel', () => {
    it('signale « Non lettrée » quand il n’y a pas de code', () => {
      expect(component.rowStateLabel(line({}))).toContain('lettrée');
    });

    it('distingue lettrage partiel et définitif', () => {
      const partial = component.rowStateLabel(line({ letteringCode: 'P00001', isPartiallyLettered: true }));
      const complete = component.rowStateLabel(line({ letteringCode: 'L00001', isPartiallyLettered: false }));
      expect(partial).not.toEqual(complete);
    });
  });

  describe('isPartialCode', () => {
    it('reconnaît un code P comme partiel et un code L comme définitif', () => {
      expect(component.isPartialCode('P00001')).toBe(true);
      expect(component.isPartialCode('L00001')).toBe(false);
      expect(component.isPartialCode(null)).toBe(false);
    });
  });

  describe('openGroupFor', () => {
    it("émet openGroup avec le code de la ligne quand elle en porte un", () => {
      const emitted: string[] = [];
      component.openGroup.subscribe(code => emitted.push(code));
      component.openGroupFor(line({ letteringCode: 'L00007' }));
      expect(emitted).toEqual(['L00007']);
    });

    it("n'émet rien pour une ligne sans code", () => {
      const emitted: string[] = [];
      component.openGroup.subscribe(code => emitted.push(code));
      component.openGroupFor(line({}));
      expect(emitted).toEqual([]);
    });
  });

  describe('paneTitle', () => {
    it('affiche le libellé débit ou crédit avec le nombre de lignes selon side', () => {
      component.lines = [line({ lineId: 'l1' }), line({ lineId: 'l2' })];
      component.side = 'debit';
      expect(component.paneTitle()).toContain('débit');
      expect(component.paneTitle()).toContain('2');
      component.side = 'credit';
      expect(component.paneTitle()).toContain('crédit');
      expect(component.paneTitle()).toContain('2');
    });
  });
});
