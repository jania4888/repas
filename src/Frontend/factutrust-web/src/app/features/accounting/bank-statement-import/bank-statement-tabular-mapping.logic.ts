import { BankStatementTabularMapping, TabularDateFormat } from './bank-statement-import.models';

/**
 * Logique pure du mappage de colonnes CSV/XLSX (étape 2 du parcours dédié D1), partagée entre le
 * composant de page et ses specs : aucune dépendance Angular, aucun appel réseau.
 */

/** Liste fermée des formats de date acceptés par le lecteur tabulaire (voir `BankStatementTabularMappingDto`). */
export const TABULAR_DATE_FORMATS: readonly TabularDateFormat[] = [
  'dd/MM/yyyy',
  'dd-MM-yyyy',
  'dd.MM.yyyy',
  'yyyy-MM-dd',
  'MM/dd/yyyy',
  'dd/MM/yy'
];

const DATE_FORMAT_LABELS: Record<string, string> = {
  'dd/MM/yyyy': 'JJ/MM/AAAA',
  'dd-MM-yyyy': 'JJ-MM-AAAA',
  'dd.MM.yyyy': 'JJ.MM.AAAA',
  'yyyy-MM-dd': 'AAAA-MM-JJ',
  'MM/dd/yyyy': 'MM/JJ/AAAA',
  'dd/MM/yy': 'JJ/MM/AA'
};

/** Libellé lisible d'un format de date fermé (code technique sinon, jamais traduit). */
export function tabularDateFormatLabel(format: TabularDateFormat): string {
  return DATE_FORMAT_LABELS[format] ?? format;
}

/** Libellé affiché d'une colonne (lettre + en-tête si connu), utilisé par tous les sélecteurs de colonne. */
export function columnLabel(col: { letter: string; header: string | null }): string {
  return col.header ? `${col.letter} · « ${col.header} »` : col.letter;
}

/** Lit le N-ième (0, 1 ou 2) numéro de colonne « Libellé » du mappage ; `null` si absent. */
export function labelColumnSlot(mapping: BankStatementTabularMapping, slot: 0 | 1 | 2): number | null {
  return mapping.labelColumns[slot] ?? null;
}

/**
 * Remplace le N-ième emplacement « Libellé » et renvoie le nouveau tableau compacté (sans trou),
 * en conservant au moins une colonne (jamais de libellé entièrement vide).
 */
export function withLabelColumnSlot(mapping: BankStatementTabularMapping, slot: 0 | 1 | 2, value: number | null): number[] {
  const slots: Array<number | null> = [
    labelColumnSlot(mapping, 0),
    labelColumnSlot(mapping, 1),
    labelColumnSlot(mapping, 2)
  ];
  slots[slot] = value;
  const compacted = slots.filter((v): v is number => v != null);
  return compacted.length > 0 ? compacted : [mapping.labelColumns[0] ?? 0];
}

/** Vrai si un solde est disponible pour le contrôle (colonne Solde, ou saisie manuelle complète). */
export function mappingHasUsableBalance(mapping: BankStatementTabularMapping): boolean {
  return mapping.balanceColumn != null || (mapping.openingBalance != null && mapping.closingBalance != null);
}

/**
 * Vrai si tous les rôles obligatoires du mappage sont associés : date d'opération, au moins un
 * libellé, le montant (débit/crédit ou montant signé), et un solde exploitable (D1 : les soldes
 * sont obligatoires pour CSV/XLSX, colonne ou saisie — plan §9 décision 1).
 */
export function tabularMappingRolesFilled(mapping: BankStatementTabularMapping | null): boolean {
  if (!mapping) return false;
  const hasAmount = mapping.amountMode === 'signed' ? mapping.amountColumn != null : mapping.debitColumn != null || mapping.creditColumn != null;
  return mapping.dateColumn != null && mapping.labelColumns.length > 0 && hasAmount && mappingHasUsableBalance(mapping);
}
