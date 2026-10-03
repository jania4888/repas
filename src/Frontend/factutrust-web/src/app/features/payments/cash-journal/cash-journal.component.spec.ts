import {
  CashExpenseCategory,
  CashOperationListItem,
  CashOperationType,
  CashRevenueCategory
} from '@core/services/cash-desk.service';
import { CashJournalComponent } from './cash-journal.component';
import { buildTreasuryJournalView } from './cash-journal.view';

describe('CashJournalComponent', () => {
  it('is a standalone page', () => {
    expect(CashJournalComponent).toBeTruthy();
  });
});

describe('buildTreasuryJournalView', () => {
  const unclassified = 'Non classé';

  const rentLine = {
    operationType: CashOperationType.Debit,
    category: CashExpenseCategory.RentPayment,
    revenueCategory: null,
    categoryDisplay: 'SHOULD_NOT_APPEAR',
    revenueCategoryDisplay: 'SHOULD_NOT_APPEAR'
  } as CashOperationListItem;

  it('place les encaissements avant les décaissements et masque les catégories vides', () => {
    const sections = buildTreasuryJournalView({
      encaissementsTitle: 'Encaissements',
      decaissementsTitle: 'Décaissements',
      unclassifiedLabel: unclassified,
      lines: [rentLine],
      groups: [
        { operationType: CashOperationType.Credit, category: CashRevenueCategory.CashSalesReceipt, count: 2, total: 1000 },
        { operationType: CashOperationType.Credit, category: CashRevenueCategory.Other, count: 0, total: 0 },
        { operationType: CashOperationType.Debit, category: CashExpenseCategory.RentPayment, count: 4, total: 145 },
        { operationType: CashOperationType.Debit, category: CashExpenseCategory.BankDeposit, count: 1, total: 40 }
      ]
    });

    expect(sections.map(section => section.title)).toEqual(['Encaissements', 'Décaissements']);
    expect(sections[0].groups.map(group => group.category)).toEqual([CashRevenueCategory.CashSalesReceipt]);
    expect(sections[0].groups[0].lines).toEqual([]);
    expect(sections[0].groups[0].total).toBe(1000);
    expect(sections[1].groups.map(group => group.category)).toEqual([
      CashExpenseCategory.RentPayment,
      CashExpenseCategory.BankDeposit
    ]);
    expect(sections[1].groups[0].label).not.toContain('SHOULD_NOT_APPEAR');
    expect(sections[1].groups[0].label).toBe('Paiement des loyers');
    expect(sections[1].groups[0].lines).toEqual([rentLine]);
    expect(sections[1].groups[1].lines).toEqual([]);
    expect(sections[1].groups[1].total).toBe(40);
  });

  it('range une opération sans catégorie dans Non classé', () => {
    const sections = buildTreasuryJournalView({
      encaissementsTitle: 'Encaissements',
      decaissementsTitle: 'Décaissements',
      unclassifiedLabel: unclassified,
      lines: [],
      groups: [{ operationType: CashOperationType.Debit, category: null, count: 1, total: 5 }]
    });

    expect(sections.length).toBe(1);
    expect(sections[0].groups[0].label).toBe(unclassified);
  });
});
