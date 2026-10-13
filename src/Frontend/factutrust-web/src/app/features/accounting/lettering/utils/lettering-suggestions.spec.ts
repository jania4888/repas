import type { LetteringSuggestionDto, LetteringSuggestionLineDto } from '../../services/accounting.service';
import {
  LETTERING_BULK_MAX_GROUPS,
  LETTERING_BULK_MAX_LINES_PER_GROUP,
  LETTERING_BULK_MAX_TOTAL_LINES,
  LetteringSuggestion
} from '../models/lettering-suggestions.models';
import {
  bulkAccounts,
  bulkGroups,
  bulkIneligibleReason,
  canAddToBulk,
  bulkLineCount,
  bulkTotalsByCurrency,
  categoryText,
  confidenceText,
  defaultBulkSelection,
  isBulkCandidate,
  mainReasonText,
  mapSuggestion,
  reasonText,
  topSuggestions
} from './lettering-suggestions';

let seq = 0;

function lineDto(over: Partial<LetteringSuggestionLineDto> = {}): LetteringSuggestionLineDto {
  seq++;
  return {
    lineId: `l${seq}`, entryId: `e${seq}`, entryDate: '2026-05-01T00:00:00', journalCode: 'JV', entryNumber: seq,
    pieceRef: null, label: `Ligne ${seq}`, debit: 0, credit: 0, debitInCurrency: 0, creditInCurrency: 0, ...over
  };
}

function dto(over: Partial<LetteringSuggestionDto> = {}): LetteringSuggestionDto {
  return {
    key: `k${++seq}`, kind: 'SameThirdPartyAmount', category: 'Exact', score: 80, confidence: 'Medium',
    accountNumber: '4111', currencyCode: 'TND', thirdPartyId: null, thirdPartyKind: 0, thirdPartyName: null,
    debitLines: [lineDto({ debit: 100 })], creditLines: [lineDto({ credit: 100 })],
    totalAmount: 100, localGap: 0, hasExchangeDifference: false, bulkEligible: true, reasons: [], ...over
  };
}

function suggestion(over: Partial<LetteringSuggestionDto> = {}): LetteringSuggestion {
  return mapSuggestion(dto(over));
}

function withLines(count: number, over: Partial<LetteringSuggestionDto> = {}): LetteringSuggestion {
  const debitLines = Array.from({ length: count - 1 }, () => lineDto({ debit: 1 }));
  return suggestion({ confidence: 'High', debitLines, creditLines: [lineDto({ credit: count - 1 })], ...over });
}

describe('lettering-suggestions (utilitaires purs)', () => {
  describe('mapSuggestion', () => {
    it('résume chaque côté : première pièce, lignes en plus, total', () => {
      const s = mapSuggestion(dto({
        debitLines: [lineDto({ debit: 60, pieceRef: 'FAC-1' }), lineDto({ debit: 40.1 })],
        creditLines: [lineDto({ credit: 100.1 })]
      }));

      expect(s.debit.first?.pieceRef).toBe('FAC-1');
      expect(s.debit.extraCount).toBe(1);
      expect(s.debit.total).toBe(100.1);
      expect(s.credit.extraCount).toBe(0);
      expect(s.lineIds).toEqual([...s.debit.lines, ...s.credit.lines].map(l => l.lineId));
    });

    it('prend les montants en devise de l’opération pour une devise étrangère', () => {
      const s = mapSuggestion(dto({
        currencyCode: 'EUR',
        debitLines: [lineDto({ debit: 330, debitInCurrency: 100 })],
        creditLines: [lineDto({ credit: 310, creditInCurrency: 100 })]
      }));

      expect(s.currency).toBe('EUR');
      expect(s.debit.total).toBe(100);
      expect(s.credit.first?.amount).toBe(100);
      expect(s.credit.first?.credit).toBe(310);
    });

    it('prend les montants en TND même si les champs en devise sont remplis', () => {
      const s = mapSuggestion(dto({
        currencyCode: 'TND',
        debitLines: [lineDto({ debit: 100, debitInCurrency: 999 })],
        creditLines: [lineDto({ credit: 100, creditInCurrency: 999 })]
      }));

      expect(s.debit.total).toBe(100);
      expect(s.credit.first?.amount).toBe(100);
    });

    it('normalise les champs facultatifs (pièce, tiers, raisons)', () => {
      const s = mapSuggestion(dto({ thirdPartyKind: 2, reasons: undefined as never }));
      expect(s.thirdPartyId).toBeNull();
      expect(s.thirdPartyKind).toBeNull();
      expect(s.debit.first?.pieceRef).toBeNull();
      expect(s.reasons).toEqual([]);

      const withTp = mapSuggestion(dto({ thirdPartyId: 'tp', thirdPartyKind: 1, thirdPartyName: 'ACME' }));
      expect([withTp.thirdPartyId, withTp.thirdPartyKind, withTp.thirdPartyName]).toEqual(['tp', 1, 'ACME']);
    });

    it('accepte un côté vide sans planter', () => {
      const s = mapSuggestion(dto({ debitLines: [] }));
      expect(s.debit.first).toBeNull();
      expect(s.debit.extraCount).toBe(0);
      expect(s.debit.total).toBe(0);
    });
  });

  describe('topSuggestions', () => {
    it('garde les 3 meilleurs scores, ordre stable à score égal', () => {
      const a = suggestion({ score: 70 });
      const b = suggestion({ score: 95 });
      const c = suggestion({ score: 70 });
      const d = suggestion({ score: 85 });

      expect(topSuggestions([a, b, c, d]).map(s => s.key)).toEqual([b.key, d.key, a.key]);
      expect(topSuggestions([a, b], 1)).toEqual([b]);
      expect(topSuggestions([a, b], -1)).toEqual([]);
    });

    it('ne modifie pas la liste reçue', () => {
      const list = [suggestion({ score: 10 }), suggestion({ score: 90 })];
      const before = list.map(s => s.key);
      topSuggestions(list);
      expect(list.map(s => s.key)).toEqual(before);
    });
  });

  describe('defaultBulkSelection', () => {
    it('ne retient que les propositions High éligibles', () => {
      const high = suggestion({ confidence: 'High' });
      const medium = suggestion({ confidence: 'Medium' });
      const fx = suggestion({ confidence: 'High', bulkEligible: false, hasExchangeDifference: true });

      expect(defaultBulkSelection([high, medium, fx])).toEqual([high.key]);
    });

    it('ignore une proposition qui réutilise une ligne ou une clé déjà retenue', () => {
      const first = suggestion({ confidence: 'High' });
      const sameLine = suggestion({ confidence: 'High', debitLines: [lineDto({ lineId: first.lineIds[0], debit: 100 })] });
      const sameKey = suggestion({ confidence: 'High', key: first.key });
      const other = suggestion({ confidence: 'High' });

      expect(defaultBulkSelection([first, sameLine, sameKey, other])).toEqual([first.key, other.key]);
    });

    it('s’arrête au plafond de groupes', () => {
      const list = Array.from({ length: LETTERING_BULK_MAX_GROUPS + 5 }, () => suggestion({ confidence: 'High' }));
      const keys = defaultBulkSelection(list);
      expect(keys.length).toBe(LETTERING_BULK_MAX_GROUPS);
      expect(keys[0]).toBe(list[0].key);
    });

    it('respecte le plafond de lignes au total et saute un groupe trop gros', () => {
      const big = withLines(LETTERING_BULK_MAX_LINES_PER_GROUP + 1);
      const perGroup = LETTERING_BULK_MAX_LINES_PER_GROUP;
      const fill = Array.from({ length: LETTERING_BULK_MAX_TOTAL_LINES / perGroup }, () => withLines(perGroup));
      const extra = withLines(2);

      const keys = defaultBulkSelection([big, ...fill, extra]);

      expect(keys).not.toContain(big.key);
      expect(keys).not.toContain(extra.key);
      expect(bulkLineCount([big, ...fill, extra], keys)).toBe(LETTERING_BULK_MAX_TOTAL_LINES);
    });

    it('isBulkCandidate exige au moins deux lignes', () => {
      expect(isBulkCandidate(suggestion({ creditLines: [] }))).toBeFalse();
      expect(isBulkCandidate(suggestion())).toBeTrue();
    });
  });

  describe('sélection manuelle du lot', () => {
    it('onlyHighConfidence: false retient aussi la confiance moyenne', () => {
      const high = suggestion({ confidence: 'High' });
      const medium = suggestion({ confidence: 'Medium' });
      const fx = suggestion({ confidence: 'Medium', bulkEligible: false, hasExchangeDifference: true });

      expect(defaultBulkSelection([high, medium, fx], { onlyHighConfidence: false })).toEqual([high.key, medium.key]);
      expect(defaultBulkSelection([high, medium, fx], {})).toEqual([high.key]);
    });

    it('canAddToBulk refuse une proposition inéligible, déjà cochée ou qui partage une ligne', () => {
      const a = suggestion();
      const sameLine = suggestion({ creditLines: [lineDto({ lineId: a.lineIds[1], credit: 100 })] });
      const fx = suggestion({ bulkEligible: false, hasExchangeDifference: true });
      const free = suggestion();
      const list = [a, sameLine, fx, free];
      const keys = new Set([a.key]);

      expect(canAddToBulk(list, keys, a)).toBeFalse();
      expect(canAddToBulk(list, keys, sameLine)).toBeFalse();
      expect(canAddToBulk(list, keys, fx)).toBeFalse();
      expect(canAddToBulk(list, keys, free)).toBeTrue();
      // Une clé cochée absente de la liste ne bloque aucune ligne.
      expect(canAddToBulk(list, new Set(['inconnue']), sameLine)).toBeTrue();
    });

    it('canAddToBulk respecte le plafond de groupes', () => {
      const list = Array.from({ length: LETTERING_BULK_MAX_GROUPS + 1 }, () => suggestion());
      const full = new Set(list.slice(0, LETTERING_BULK_MAX_GROUPS).map(s => s.key));
      const almost = new Set(list.slice(0, LETTERING_BULK_MAX_GROUPS - 1).map(s => s.key));

      expect(canAddToBulk(list, full, list[LETTERING_BULK_MAX_GROUPS])).toBeFalse();
      expect(canAddToBulk(list, almost, list[LETTERING_BULK_MAX_GROUPS])).toBeTrue();
    });

    it('canAddToBulk respecte le plafond de lignes au total', () => {
      const perGroup = LETTERING_BULK_MAX_LINES_PER_GROUP;
      const fill = Array.from({ length: LETTERING_BULK_MAX_TOTAL_LINES / perGroup }, () => withLines(perGroup));
      const extra = suggestion();
      const list = [...fill, extra];
      const keys = new Set(fill.map(s => s.key));

      expect(canAddToBulk(list, keys, extra)).toBeFalse();
      keys.delete(fill[0].key);
      expect(canAddToBulk(list, keys, extra)).toBeTrue();
    });

    it('bulkIneligibleReason donne la raison affichée', () => {
      expect(bulkIneligibleReason(suggestion())).toBeNull();
      expect(bulkIneligibleReason(suggestion({ bulkEligible: false, hasExchangeDifference: true }))).toBe('exchangeDifference');
      expect(bulkIneligibleReason(withLines(LETTERING_BULK_MAX_LINES_PER_GROUP + 1))).toBe('tooManyLines');
      expect(bulkIneligibleReason(suggestion({ bulkEligible: false }))).toBe('notEligible');
      expect(bulkIneligibleReason(suggestion({ creditLines: [] }))).toBe('notEligible');
    });

    it('bulkAccounts liste les comptes touchés sans doublon', () => {
      const a = suggestion({ accountNumber: '4111' });
      const b = suggestion({ accountNumber: '4011' });
      const c = suggestion({ accountNumber: '4111' });
      const d = suggestion({ accountNumber: '4012' });

      expect(bulkAccounts([a, b, c, d], [c.key, b.key, a.key])).toEqual(['4111', '4011']);
      expect(bulkAccounts([a], [])).toEqual([]);
    });
  });

  describe('totaux du lot', () => {
    it('ne mélange jamais deux devises', () => {
      const tnd1 = suggestion({ totalAmount: 100.1 });
      const tnd2 = suggestion({ totalAmount: 0.2 });
      const eur = suggestion({ currencyCode: 'EUR', totalAmount: 50 });
      const ignored = suggestion({ totalAmount: 999 });

      const totals = bulkTotalsByCurrency([tnd1, eur, tnd2, ignored], [tnd1.key, tnd2.key, eur.key]);

      expect([...totals.entries()]).toEqual([['TND', 100.3], ['EUR', 50]]);
    });

    it('compte les lignes et construit le corps du lot dans l’ordre de la liste', () => {
      const a = withLines(3);
      const b = suggestion();
      const c = suggestion();

      expect(bulkLineCount([a, b, c], [c.key, a.key])).toBe(5);
      expect(bulkGroups([a, b, c], [c.key, a.key])).toEqual([
        { clientKey: a.key, journalEntryLineIds: a.lineIds },
        { clientKey: c.key, journalEntryLineIds: c.lineIds }
      ]);
      expect(bulkTotalsByCurrency([a], []).size).toBe(0);
    });
  });

  describe('textes', () => {
    it('traduit chaque code de raison avec ses arguments', () => {
      expect(reasonText({ code: 'DocumentLink', args: { invoiceNumber: 'FAC-7', paymentCount: '2' } }))
        .toBe('Facture FAC-7 et ses règlements liés (2).');
      expect(reasonText({ code: 'SameReference', args: { reference: 'REF9' } })).toBe('Même référence : REF9.');
      expect(reasonText({ code: 'SameThirdParty', args: {} })).toBe('Même tiers des deux côtés.');
      expect(reasonText({ code: 'ExactAmount', args: { amount: '1234.500', currency: 'EUR' } }))
        .toBe('Montant identique : 1234.500 EUR.');
      expect(reasonText({ code: 'SubsetSum', args: { count: '4' } })).toBe('Combinaison de 4 lignes de somme nulle.');
      expect(reasonText({ code: 'AmountOnly', args: {} })).toContain('montant seul');
      expect(reasonText({ code: 'AmbiguousAmount', args: { alternatives: '3' } })).toContain('3');
      expect(reasonText({ code: 'DateGap', args: { days: '400' } })).toBe('Écart de dates : 400 jours.');
      expect(reasonText({ code: 'ExchangeDifference', args: { localGap: '-0.250' } })).toBe('Écart de change : -0.250 TND.');
    });

    it('arguments absents ou illisibles : ni NaN, ni undefined, ni espace avant le point', () => {
      expect(reasonText({ code: 'ExactAmount', args: {} })).toBe('Montant identique : 0.000.');
      expect(reasonText({ code: 'ExactAmount', args: { amount: 'abc', currency: 'TND' } })).toBe('Montant identique : 0.000 TND.');
      expect(reasonText({ code: 'ExchangeDifference', args: {} })).toBe('Écart de change : 0.000 TND.');
    });

    it('utilise le formateur de montant fourni', () => {
      const text = reasonText({ code: 'ExactAmount', args: { amount: '10.000', currency: 'TND' } }, (v, c) => `${c}:${v}`);
      expect(text).toBe('Montant identique : TND:10.');
    });

    it('donne un texte générique pour un code inconnu, jamais le code brut', () => {
      const text = reasonText({ code: 'FutureRule', args: {} });
      expect(text).toBe('Rapprochement détecté par les règles comptables.');
      expect(mainReasonText(suggestion())).toBe(text);
    });

    it('nomme la catégorie et la confiance', () => {
      expect(categoryText('Exact')).toBe('Correspondance exacte');
      expect(categoryText('Multiple')).toBe('Correspondance multiple');
      expect(categoryText('SameAmount')).toBe('Montant identique');
      expect(categoryText('X' as never)).toBe('Proposition');
      expect(confidenceText('High')).toBe('Confiance élevée');
      expect(confidenceText('Medium')).toBe('Confiance moyenne');
      expect(confidenceText('Low')).toBe('Confiance faible');
    });
  });
});
