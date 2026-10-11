import { Params } from '@angular/router';
import { LetteringFilters, LetteringStateFilter, createDefaultLetteringFilters } from '../models/lettering.models';
import { firstDayOfYearLocalYmd, todayLocalYmd } from '../../shared/accounting-date-utils';

const VALID_STATES: readonly LetteringStateFilter[] = ['all', 'unlettered', 'partial', 'lettered'];

export interface ParsedLetteringQueryParams {
  filters: LetteringFilters;
  accountHint: string;
  autoLoad: boolean;
  thirdPartyName: string | null;
}

function isValidState(value: string | null): value is LetteringStateFilter {
  return value !== null && (VALID_STATES as readonly string[]).includes(value);
}

/**
 * Lit les paramètres d'URL de l'écran de lettrage, avec compatibilité totale des anciens
 * deep-links (`account`, `from`, `to`, `unletteredOnly=1`, `accountHint`, `autoLoad=1`) utilisés
 * par `audit-correction.navigation.ts`, `pre-closing` et `health` (§6 annexe B).
 *
 * Priorité : si `state` est une valeur valide, il l'emporte sur `unletteredOnly=1` ; sinon
 * `unletteredOnly=1` vaut `state='unlettered'` ; sinon le défaut est `'unlettered'` (« Non
 * lettrées », nouvel état par défaut de la Phase 2).
 */
export function parseLetteringQueryParams(params: Params): ParsedLetteringQueryParams {
  const get = (key: string): string | null => {
    const v = params[key];
    return v === undefined || v === null || v === '' ? null : String(v);
  };

  const account = get('account') ?? '';
  const from = get('from') ?? firstDayOfYearLocalYmd();
  const to = get('to') ?? todayLocalYmd();
  const match = get('match') === 'prefix' ? 'prefix' : 'exact';

  const stateParam = get('state');
  const unletteredOnly = get('unletteredOnly') === '1';
  let state: LetteringStateFilter;
  if (isValidState(stateParam)) {
    state = stateParam;
  } else if (unletteredOnly) {
    state = 'unlettered';
  } else {
    state = 'unlettered';
  }

  const thirdPartyId = get('thirdPartyId');
  const thirdPartyKindRaw = get('thirdPartyKind');
  const thirdPartyKind = thirdPartyKindRaw !== null ? Number(thirdPartyKindRaw) : NaN;
  const thirdPartyName = get('thirdPartyName');

  const minRaw = get('min');
  const maxRaw = get('max');
  const min = minRaw !== null ? Number(minRaw) : NaN;
  const max = maxRaw !== null ? Number(maxRaw) : NaN;

  const filters: LetteringFilters = {
    ...createDefaultLetteringFilters(from, to),
    account,
    accountMatch: match,
    state,
    journalCode: get('journal'),
    documentType: get('docType'),
    minAmount: Number.isFinite(min) ? min : null,
    maxAmount: Number.isFinite(max) ? max : null,
    thirdParty: thirdPartyId && Number.isFinite(thirdPartyKind)
      ? { id: thirdPartyId, kind: thirdPartyKind, name: thirdPartyName ?? '' }
      : null
  };

  return {
    filters,
    accountHint: get('accountHint') ?? '',
    autoLoad: get('autoLoad') === '1',
    thirdPartyName
  };
}

/**
 * Sérialise les filtres courants en paramètres d'URL, en omettant les valeurs vides. Appelé après
 * chaque chargement réussi (`replaceUrl: true`), jamais au premier rendu.
 */
export function serializeLetteringFilters(filters: LetteringFilters, extra?: { accountHint?: string }): Params {
  const params: Params = {};
  if (filters.account) params['account'] = filters.account;
  if (filters.from) params['from'] = filters.from;
  if (filters.to) params['to'] = filters.to;
  if (filters.state) params['state'] = filters.state;
  if (filters.accountMatch === 'prefix') params['match'] = 'prefix';
  if (filters.journalCode) params['journal'] = filters.journalCode;
  if (filters.documentType) params['docType'] = filters.documentType;
  if (filters.minAmount !== null && filters.minAmount !== undefined) params['min'] = String(filters.minAmount);
  if (filters.maxAmount !== null && filters.maxAmount !== undefined) params['max'] = String(filters.maxAmount);
  if (filters.thirdParty) {
    params['thirdPartyId'] = filters.thirdParty.id;
    params['thirdPartyKind'] = String(filters.thirdParty.kind);
    if (filters.thirdParty.name) params['thirdPartyName'] = filters.thirdParty.name;
  }
  if (extra?.accountHint) params['accountHint'] = extra.accountHint;
  return params;
}
