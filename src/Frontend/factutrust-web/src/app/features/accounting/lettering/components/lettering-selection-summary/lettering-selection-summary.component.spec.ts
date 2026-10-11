import {
  LetteringSelectionGuards,
  LetteringSelectionSummary,
  LetteringSideCounts
} from '../../models/lettering.models';
import { LetteringSelectionSummaryComponent } from './lettering-selection-summary.component';

function summary(overrides: Partial<LetteringSelectionSummary> = {}): LetteringSelectionSummary {
  return {
    count: 0,
    debit: 0,
    credit: 0,
    gap: 0,
    balanced: true,
    currency: null,
    foreign: false,
    debitCurrency: 0,
    creditCurrency: 0,
    currencyGap: 0,
    hasExchangeDifference: false,
    ...overrides
  };
}

function sideCounts(overrides: Partial<LetteringSideCounts> = {}): LetteringSideCounts {
  return { debitCount: 0, creditCount: 0, ...overrides };
}

function guards(overrides: Partial<LetteringSelectionGuards> = {}): LetteringSelectionGuards {
  return { mixedCurrencies: false, multipleAccounts: false, ...overrides };
}

describe('LetteringSelectionSummaryComponent', () => {
  let component: LetteringSelectionSummaryComponent;

  beforeEach(() => {
    component = new LetteringSelectionSummaryComponent();
    component.summary = summary();
    component.sideCounts = sideCounts();
    component.guards = guards();
  });

  describe('onAllowPartialChange', () => {
    it('émet allowPartialChange avec la valeur reçue', () => {
      const emitted: boolean[] = [];
      component.allowPartialChange.subscribe(v => emitted.push(v));
      component.onAllowPartialChange(true);
      component.onAllowPartialChange(false);
      expect(emitted).toEqual([true, false]);
    });
  });

  describe('libellé du bouton de validation', () => {
    it("expose un libellé « Valider le lettrage » et un libellé partiel distincts", () => {
      // Les deux chaînes sont exposées en lecture (`protected readonly`), on vérifie juste
      // qu'elles existent et diffèrent — le template choisit laquelle afficher via isPartialMode.
      expect((component as any).loc_valider).toBeTruthy();
      expect((component as any).loc_valider_partiel).toBeTruthy();
      expect((component as any).loc_valider).not.toBe((component as any).loc_valider_partiel);
    });
  });

  describe('entrées par défaut', () => {
    it('canLetter, allowPartial, isPartialMode, readOnly sont faux par défaut', () => {
      expect(component.canLetter).toBe(false);
      expect(component.allowPartial).toBe(false);
      expect(component.isPartialMode).toBe(false);
      expect(component.readOnly).toBe(false);
      expect(component.busyAction).toBeNull();
    });
  });
});
