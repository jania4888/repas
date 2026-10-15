import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DeskTenantReset } from '@core/desk/desk-tenant-reset';
import { AccountingJournalCatalogService } from './accounting-journal-catalog.service';
import { AccountingService, JournalDto } from '../services/accounting.service';
import { ACCOUNTING_SUB_JOURNALS } from './accounting-journal-tabs.model';

function journal(overrides: Partial<JournalDto>): JournalDto {
  return { id: overrides.code ?? 'x', code: 'JV', label: 'Journal', isSystem: true, isActive: true, ...overrides };
}

describe('AccountingJournalCatalogService', () => {
  let service: AccountingJournalCatalogService;
  let accounting: jasmine.SpyObj<AccountingService>;

  beforeEach(() => {
    accounting = jasmine.createSpyObj<AccountingService>('AccountingService', ['getJournals']);
    TestBed.configureTestingModule({
      providers: [AccountingJournalCatalogService, { provide: AccountingService, useValue: accounting }]
    });
    service = TestBed.inject(AccountingJournalCatalogService);
  });

  it('listBankJournals() ne garde que JB parmi les journaux standards', done => {
    accounting.getJournals.and.returnValue(
      of({ success: true, data: [journal({ code: 'JV' }), journal({ code: 'JB' }), journal({ code: 'JA' })] })
    );

    service.listBankJournals().subscribe(journals => {
      expect(journals.map(j => j.code)).toEqual(['JB']);
      done();
    });
  });

  it('listBankJournals() conserve un journal personnalisé non standard', done => {
    accounting.getJournals.and.returnValue(
      of({ success: true, data: [journal({ code: 'JV' }), journal({ code: 'CB2' })] })
    );

    service.listBankJournals().subscribe(journals => {
      expect(journals.map(j => j.code)).toEqual(['CB2']);
      done();
    });
  });

  it('relit le catalogue après un changement de dossier', () => {
    accounting.getJournals.and.returnValue(
      of({ success: true, data: [journal({ code: 'JV', label: 'Ventes' })] })
    );

    service.list().subscribe();
    service.list().subscribe();
    expect(accounting.getJournals).toHaveBeenCalledTimes(1);

    TestBed.inject(DeskTenantReset).run();
    service.list().subscribe();
    expect(accounting.getJournals).toHaveBeenCalledTimes(2);
  });

  it('se replie sur les journaux standards complets pour list() en cas de catalogue vide', done => {
    accounting.getJournals.and.returnValue(of({ success: true, data: [] }));

    service.list().subscribe(journals => {
      expect(journals.map(j => j.code)).toEqual(ACCOUNTING_SUB_JOURNALS.map(j => j.code));
      done();
    });
  });
});
