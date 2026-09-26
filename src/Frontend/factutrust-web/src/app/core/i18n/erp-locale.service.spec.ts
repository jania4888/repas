import { TestBed } from '@angular/core/testing';
import { ErpLocaleService } from './erp-locale.service';
import { ERP_LOCALE_STORAGE_KEY } from './erp-locale.types';

describe('ErpLocaleService', () => {
  let service: ErpLocaleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ErpLocaleService);
    localStorage.removeItem(ERP_LOCALE_STORAGE_KEY);
  });

  it('resolve applique fr par défaut', () => {
    service.resolve();
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });
});
