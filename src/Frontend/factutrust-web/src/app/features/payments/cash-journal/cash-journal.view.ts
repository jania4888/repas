import {
  CashOperationListItem,
  CashOperationType,
  getCashExpenseCategoryLabel,
  getCashRevenueCategoryLabel
} from '@core/services/cash-desk.service';

export interface TreasuryJournalGroupInput {
  operationType: number;
  category: number | null;
  count: number;
  total: number;
}

export interface TreasuryJournalGroupView extends TreasuryJournalGroupInput {
  key: string;
  label: string;
  lines: CashOperationListItem[];
}

export interface TreasuryJournalSectionView {
  operationType: number;
  title: string;
  total: number;
  groups: TreasuryJournalGroupView[];
}

export function treasuryJournalGroupKey(operationType: number, category: number | null): string {
  return `${operationType}:${category ?? 'x'}`;
}

export function treasuryCategoryLabel(
  operationType: number,
  category: number | null,
  unclassified: string
): string {
  if (category === null || category === undefined) return unclassified;
  const label =
    operationType === CashOperationType.Credit
      ? getCashRevenueCategoryLabel(category)
      : getCashExpenseCategoryLabel(category);
  return label ?? unclassified;
}

export function lineCategoryCode(line: CashOperationListItem): number | null {
  return line.operationType === CashOperationType.Credit ? line.revenueCategory : line.category;
}

/**
 * Les sous-totaux viennent des groupes serveur (période entière).
 * Les lignes ne sont que la page courante. Une catégorie à effectif 0 n'est pas affichée.
 * Le libellé de catégorie vient du vocabulaire caisse, pas du texte français renvoyé par l'API.
 */
export function buildTreasuryJournalView(input: {
  groups: TreasuryJournalGroupInput[];
  lines: CashOperationListItem[];
  encaissementsTitle: string;
  decaissementsTitle: string;
  unclassifiedLabel: string;
}): TreasuryJournalSectionView[] {
  const byKey = new Map<string, CashOperationListItem[]>();
  for (const line of input.lines) {
    const key = treasuryJournalGroupKey(line.operationType, lineCategoryCode(line));
    const bucket = byKey.get(key);
    if (bucket) bucket.push(line);
    else byKey.set(key, [line]);
  }

  const toView = (group: TreasuryJournalGroupInput): TreasuryJournalGroupView => {
    const key = treasuryJournalGroupKey(group.operationType, group.category);
    return {
      ...group,
      key,
      label: treasuryCategoryLabel(group.operationType, group.category, input.unclassifiedLabel),
      lines: byKey.get(key) ?? []
    };
  };

  const credits = input.groups
    .filter(group => group.operationType === CashOperationType.Credit && group.count > 0)
    .map(toView);
  const debits = input.groups
    .filter(group => group.operationType === CashOperationType.Debit && group.count > 0)
    .map(toView);

  const sections: TreasuryJournalSectionView[] = [];
  if (credits.length) {
    sections.push({
      operationType: CashOperationType.Credit,
      title: input.encaissementsTitle,
      total: credits.reduce((sum, group) => sum + group.total, 0),
      groups: credits
    });
  }
  if (debits.length) {
    sections.push({
      operationType: CashOperationType.Debit,
      title: input.decaissementsTitle,
      total: debits.reduce((sum, group) => sum + group.total, 0),
      groups: debits
    });
  }
  return sections;
}
