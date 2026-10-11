import {
  LETTERING_FUNCTIONAL_CURRENCY,
  LetteringLine,
  LetteringSelectionGuards,
  LetteringSelectionSummary,
  LetteringSide,
  LetteringSideCounts
} from '../models/lettering.models';

/**
 * Résumé de l'équilibre d'une sélection. Copie **littérale** de l'ancien `computed` de
 * `lettering.component.ts` (même ordre de sommation, mêmes arrondis, même détection de devise) :
 * un changement de comportement ici casserait silencieusement l'équilibrage multi-devise. Toute
 * évolution doit passer par le test de parité de `lettering-selection.spec.ts`.
 */
export function computeSelectionSummary(sel: readonly LetteringLine[]): LetteringSelectionSummary {
  let debit = 0;
  let credit = 0;
  let debitCurrency = 0;
  let creditCurrency = 0;
  for (const l of sel) {
    debit += l.debit;
    credit += l.credit;
    debitCurrency += l.debitInCurrency;
    creditCurrency += l.creditInCurrency;
  }

  // Une sélection mono-devise mélangeant des devises n'a pas de sens : le serveur la refusera,
  // l'écran doit le refléter avant l'appel.
  const currencies = new Set(sel.map(l => l.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const foreign = currency !== null && currency !== LETTERING_FUNCTIONAL_CURRENCY;

  const gap = Math.round((debit - credit) * 1000) / 1000;
  const currencyGap = Math.round((debitCurrency - creditCurrency) * 1000) / 1000;

  // L'équilibre s'apprécie sur la devise de l'opération : deux règlements de 1 000 EUR à des
  // taux différents soldent le compte en euros, sans le solder en dinars.
  const balanced = sel.length >= 2 && (foreign ? currencyGap === 0 : gap === 0);

  return {
    count: sel.length,
    debit,
    credit,
    gap,
    balanced,
    currency,
    foreign,
    debitCurrency,
    creditCurrency,
    currencyGap,
    /** Soldé en devise mais pas en dinars : c'est un écart de change, apurable. */
    hasExchangeDifference: foreign && sel.length >= 2 && currencyGap === 0 && gap !== 0
  };
}

/** Compte de lignes par côté (« x au débit / y au crédit »), hors de la fonction d'équilibre. */
export function sideCounts(sel: readonly LetteringLine[]): LetteringSideCounts {
  let debitCount = 0;
  let creditCount = 0;
  for (const l of sel) {
    if (l.debit !== 0) debitCount++;
    else creditCount++;
  }
  return { debitCount, creditCount };
}

/**
 * Garde-fous de sélection, distincts de l'équilibre : ces refus existent déjà côté serveur
 * (`ValidateLinesAsync`), mais afficher le message avant l'appel évite un aller-retour voué à
 * l'échec.
 */
export function selectionGuards(sel: readonly LetteringLine[]): LetteringSelectionGuards {
  const currencies = new Set(sel.map(l => l.currency));
  const accounts = new Set(sel.map(l => l.accountNumber));
  return {
    mixedCurrencies: currencies.size > 1,
    multipleAccounts: accounts.size > 1
  };
}

/** Répartit les lignes par volet : une ligne va au débit si `debit !== 0`, sinon au crédit. */
export function splitBySide(lines: readonly LetteringLine[]): { debit: LetteringLine[]; credit: LetteringLine[] } {
  const debit: LetteringLine[] = [];
  const credit: LetteringLine[] = [];
  for (const l of lines) {
    if (l.debit !== 0) debit.push(l);
    else credit.push(l);
  }
  return { debit, credit };
}

/** Total (TND + devise si unique) des lignes sélectionnées d'un volet. */
export function paneTotal(lines: readonly LetteringLine[], side: LetteringSide): { amount: number; amountInCurrency: number } {
  let amount = 0;
  let amountInCurrency = 0;
  for (const l of lines) {
    amount += side === 'debit' ? l.debit : l.credit;
    amountInCurrency += side === 'debit' ? l.debitInCurrency : l.creditInCurrency;
  }
  return { amount, amountInCurrency };
}
