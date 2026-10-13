import { TestBed } from '@angular/core/testing';
import { AccountingFeatureFlagsService } from './accounting-feature-flags.service';

const STORAGE_KEY = 'ft.accounting.featureFlags';

describe('AccountingFeatureFlagsService', () => {
  let saved: string | null;

  function create(): AccountingFeatureFlagsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(AccountingFeatureFlagsService);
  }

  beforeEach(() => {
    saved = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    if (saved === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, saved);
  });

  it('propositions de lettrage (Phase 3) : éteintes par défaut', () => {
    expect(create().isEnabled('letteringProposals')).toBeFalse();
  });

  it('activation pilote par localStorage : lue au démarrage, les autres drapeaux gardent leur défaut', () => {
    const defaults = create();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ letteringProposals: true }));

    const piloted = create();

    expect(piloted.isEnabled('letteringProposals')).toBeTrue();
    expect(piloted.isEnabled('multiCurrencyEnabled')).toBe(defaults.isEnabled('multiCurrencyEnabled'));
    expect(piloted.isEnabled('consoleAccountingErrors')).toBe(defaults.isEnabled('consoleAccountingErrors'));
  });

  it('valeur illisible dans localStorage : retour aux défauts (propositions éteintes)', () => {
    localStorage.setItem(STORAGE_KEY, '{pas du json');
    expect(create().isEnabled('letteringProposals')).toBeFalse();
  });

  it('reset() : efface l\'activation pilote et revient au défaut éteint', () => {
    const service = create();
    service.setFlag('letteringProposals', true);
    expect(service.isEnabled('letteringProposals')).toBeTrue();

    service.reset();

    expect(service.isEnabled('letteringProposals')).toBeFalse();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
