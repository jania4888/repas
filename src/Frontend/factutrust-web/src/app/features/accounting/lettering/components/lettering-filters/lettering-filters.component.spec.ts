import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AccountingService, ChartOfAccountDto, ThirdPartyDirectoryRowDto } from '../../../services/accounting.service';
import { AccountingJournalCatalogService } from '../../../shared/accounting-journal-catalog.service';
import { createDefaultLetteringFilters } from '../../models/lettering.models';
import { LetteringFiltersComponent } from './lettering-filters.component';

function account(overrides: Partial<ChartOfAccountDto>): ChartOfAccountDto {
  return {
    id: 'a1',
    accountNumber: '4111',
    label: 'Clients',
    accountClass: 4,
    natureType: 0,
    isSystem: false,
    isActive: true,
    level: 1,
    accountType: 1,
    ...overrides
  } as ChartOfAccountDto;
}

function thirdParty(overrides: Partial<ThirdPartyDirectoryRowDto>): ThirdPartyDirectoryRowDto {
  return {
    thirdPartyId: 'tp1',
    kind: 1,
    name: 'Client ABC',
    collectiveAccountNumber: '4111',
    isActive: true,
    balanceDebit: 0,
    balanceCredit: 0,
    ...overrides
  };
}

describe('LetteringFiltersComponent', () => {
  let component: LetteringFiltersComponent;
  let apiStub: { getChartOfAccounts: jasmine.Spy; getThirdPartyDirectory: jasmine.Spy };

  beforeEach(() => {
    apiStub = {
      getChartOfAccounts: jasmine.createSpy().and.returnValue(
        of({ success: true, data: [account({ accountNumber: '4111', label: 'Clients' }), account({ accountNumber: '411100', label: 'Client ABC' })] })
      ),
      getThirdPartyDirectory: jasmine.createSpy().and.returnValue(
        of({ success: true, data: { items: [thirdParty({})], totalCount: 1, page: 1, pageSize: 20 } })
      )
    };

    TestBed.configureTestingModule({
      imports: [LetteringFiltersComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AccountingService, useValue: apiStub },
        { provide: AccountingJournalCatalogService, useValue: { list: () => of([]) } }
      ]
    });

    const fixture = TestBed.createComponent(LetteringFiltersComponent);
    component = fixture.componentInstance;
    component.filters = createDefaultLetteringFilters('2026-01-01', '2026-01-31');
    component.payloadBuilder = () => ({});
    fixture.detectChanges(); // déclenche ngOnInit (charge le plan de comptes et les journaux)
  });

  describe('filterAccounts', () => {
    it('filtre par numéro de compte ou libellé, insensible à la casse', () => {
      component.filterAccounts({ query: 'client' });
      expect(component.accountSuggestions).toEqual(['4111', '411100']);
    });

    it('ne retourne rien si aucun compte ne correspond', () => {
      component.filterAccounts({ query: 'xyz' });
      expect(component.accountSuggestions).toEqual([]);
    });
  });

  describe('onAccountInputChange', () => {
    it('émet le filtre complet avec le nouveau compte', () => {
      const emitted: unknown[] = [];
      component.filtersChange.subscribe(f => emitted.push(f));
      component.onAccountInputChange('4111');
      expect(emitted).toEqual([{ ...component.filters, account: '4111' }]);
      expect(component.accountQuery).toBe('4111');
    });
  });

  describe('filterThirdParties', () => {
    it('interroge le répertoire des tiers avec le kind déduit du compte sélectionné', () => {
      component.filters = { ...component.filters, account: '4111' };
      component.filterThirdParties({ query: 'abc' });
      expect(apiStub.getThirdPartyDirectory).toHaveBeenCalledWith({ search: 'abc', kind: 1, pageSize: 20 });
      expect(component.thirdPartySuggestions.length).toBe(1);
    });

    it('ne contraint pas le kind si le compte sélectionné est hors client/fournisseur', () => {
      component.filters = { ...component.filters, account: '' };
      component.filterThirdParties({ query: 'abc' });
      expect(apiStub.getThirdPartyDirectory).toHaveBeenCalledWith({ search: 'abc', kind: null, pageSize: 20 });
    });
  });

  describe('onThirdPartySelect', () => {
    it('émet la référence du tiers sélectionné', () => {
      const emitted: any[] = [];
      component.filtersChange.subscribe(f => emitted.push(f));
      const row = thirdParty({ thirdPartyId: 'tp9', kind: 2, name: 'Fournisseur X' });
      component.onThirdPartySelect(row);
      expect(emitted[0].thirdParty).toEqual({ id: 'tp9', kind: 2, name: 'Fournisseur X' });
      expect(component.thirdPartyQuery).toBe(row);
    });

    it("renseigne aussi le compte collectif si aucun compte n'était saisi", () => {
      component.filters = { ...component.filters, account: '' };
      const emitted: any[] = [];
      component.filtersChange.subscribe(f => emitted.push(f));
      component.onThirdPartySelect(thirdParty({ collectiveAccountNumber: '4111' }));
      expect(emitted[0].account).toBe('4111');
      expect(component.accountQuery).toBe('4111');
    });

    it('ne modifie pas un compte déjà saisi par l’utilisateur', () => {
      component.filters = { ...component.filters, account: '401100' };
      const emitted: any[] = [];
      component.filtersChange.subscribe(f => emitted.push(f));
      component.onThirdPartySelect(thirdParty({ collectiveAccountNumber: '4111' }));
      expect(emitted[0].account).toBe('401100');
      expect(component.accountQuery).not.toBe('4111');
    });
  });

  describe('onThirdPartyClear', () => {
    it('vide le tiers sélectionné', () => {
      const emitted: any[] = [];
      component.filtersChange.subscribe(f => emitted.push(f));
      component.onThirdPartyClear();
      expect(component.thirdPartyQuery).toBe('');
      expect(emitted[0].thirdParty).toBeNull();
    });
  });

  describe('onIncludeSubAccountsChange', () => {
    it('bascule accountMatch entre exact et prefix', () => {
      const emitted: any[] = [];
      component.filtersChange.subscribe(f => emitted.push(f));
      component.onIncludeSubAccountsChange(true);
      component.onIncludeSubAccountsChange(false);
      expect(emitted[0].accountMatch).toBe('prefix');
      expect(emitted[1].accountMatch).toBe('exact');
    });
  });

  describe('toggleAdvanced', () => {
    it('bascule la visibilité du bloc « Plus de filtres »', () => {
      expect(component.showAdvanced()).toBe(false);
      component.toggleAdvanced();
      expect(component.showAdvanced()).toBe(true);
      component.toggleAdvanced();
      expect(component.showAdvanced()).toBe(false);
    });
  });

  describe('submit', () => {
    it('émet load', () => {
      let count = 0;
      component.load.subscribe(() => count++);
      component.submit();
      expect(count).toBe(1);
    });
  });

  describe('onStateChange / onJournalChange / onDateChange / montants', () => {
    it('émet chaque filtre modifié avec le reste des filtres inchangé', () => {
      const emitted: any[] = [];
      component.filtersChange.subscribe(f => emitted.push(f));
      component.onStateChange('lettered');
      component.onJournalChange('VE');
      component.onJournalChange('');
      component.onDateChange('from', '2026-02-01');
      component.onMinAmountChange(100);
      component.onMaxAmountChange(null);
      expect(emitted[0].state).toBe('lettered');
      expect(emitted[1].journalCode).toBe('VE');
      expect(emitted[2].journalCode).toBeNull();
      expect(emitted[3].from).toBe('2026-02-01');
      expect(emitted[4].minAmount).toBe(100);
      expect(emitted[5].maxAmount).toBeNull();
    });
  });
});
