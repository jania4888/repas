import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BankStatementImportOrigin, BankStatementUploadDialogComponent } from './bank-statement-upload-dialog.component';
import { BankStatementImportError, BankStatementImportService } from './bank-statement-import.service';
import { BankAccountDto, BankAccountService } from '@core/services/bank-account.service';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { BankStatementImportCapabilities, BankStatementImportSession } from './bank-statement-import.models';

function account(overrides: Partial<BankAccountDto>): BankAccountDto {
  return {
    id: 'a',
    companyId: 'c',
    bankCode: '10',
    bankName: 'STB',
    designation: null,
    agencyName: null,
    rib: '10006035123456789012',
    iban: '',
    swiftBic: null,
    isDefault: false,
    isActive: true,
    chartOfAccountNumber: '53210001',
    ...overrides
  };
}

const capabilities: BankStatementImportCapabilities = {
  enabled: true,
  aiAvailable: true,
  aiProviderKind: 'external',
  maxFileBytes: 1024,
  maxPages: 60,
  acceptedExtensions: ['.pdf'],
  recognizedBanks: []
};

describe('BankStatementUploadDialogComponent', () => {
  let fixture: ComponentFixture<BankStatementUploadDialogComponent>;
  let component: BankStatementUploadDialogComponent;
  let api: jasmine.SpyObj<BankStatementImportService>;
  let router: Router;

  async function open(
    accounts: BankAccountDto[],
    caps: BankStatementImportCapabilities | null = capabilities,
    inputs: { initialFile?: File; initialBankAccountId?: string; origin?: BankStatementImportOrigin } = {}
  ): Promise<void> {
    api.capabilities.and.returnValue(of(caps));
    await TestBed.configureTestingModule({
      imports: [BankStatementUploadDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: BankStatementImportService, useValue: api },
        { provide: BankAccountService, useValue: { list: () => of({ success: true, data: accounts }) } },
        {
          provide: AccountingJournalCatalogService,
          useValue: {
            list: () =>
              of([
                { code: 'JV', label: 'Ventes', icon: '', shortLabel: 'JV' },
                { code: 'JB', label: 'Banque', icon: '', shortLabel: 'JB' }
              ])
          }
        }
      ]
    }).compileComponents();
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(BankStatementUploadDialogComponent);
    component = fixture.componentInstance;
    if (inputs.initialFile) fixture.componentRef.setInput('initialFile', inputs.initialFile);
    if (inputs.initialBankAccountId) fixture.componentRef.setInput('initialBankAccountId', inputs.initialBankAccountId);
    if (inputs.origin) fixture.componentRef.setInput('origin', inputs.origin);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
  }

  function text(): string {
    return (document.body.textContent ?? '').replace(/\s+/g, ' ');
  }

  function select(file: File): void {
    const input = { files: [file], value: 'x' } as unknown as HTMLInputElement;
    component.onFileSelected({ target: input } as unknown as Event);
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<BankStatementImportService>('BankStatementImportService', ['capabilities', 'start']);
  });

  it('présélectionne le compte par défaut relié à un 532 et ne propose que des journaux de banque', async () => {
    await open([
      account({ id: 'sans-532', chartOfAccountNumber: null, isDefault: true }),
      account({ id: 'inactif', isActive: false }),
      account({ id: 'ok' })
    ]);

    expect(component.bankAccountId).toBe('ok');
    expect(component.bankAccounts().map(a => a.id)).toEqual(['sans-532', 'ok']);
    expect(component.journals().map(j => j.code)).toEqual(['JB']);
    expect(component.journalCode).toBe('JB');
  });

  it('refuse un fichier plus lourd que la limite annoncée par le serveur', async () => {
    await open([account({ id: 'ok' })]);

    select(new File([new Uint8Array(2048)], 'gros.pdf', { type: 'application/pdf' }));

    expect(component.file()).toBeNull();
    expect(component.error()).toContain('trop volumineux');
    expect(component.canAnalyze()).toBeFalse();
  });

  it('lance l’analyse puis ouvre l’écran de relecture', async () => {
    api.start.and.returnValue(of({ id: 's-42' } as BankStatementImportSession));
    await open([account({ id: 'ok' })]);
    const closed: boolean[] = [];
    component.visibleChange.subscribe(v => closed.push(v));
    const file = new File(['%PDF'], 'releve.pdf', { type: 'application/pdf' });

    select(file);
    expect(component.canAnalyze()).toBeTrue();
    component.analyze();

    expect(api.start).toHaveBeenCalledOnceWith(file, 'ok', 'JB');
    expect(closed).toEqual([false]);
    expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-import/session', 's-42']);
  });

  it('affiche le message correspondant au code d’erreur de l’API', async () => {
    api.start.and.returnValue(throwError(() => new BankStatementImportError('texte serveur', 'bank_statement_import.already_imported', 409)));
    await open([account({ id: 'ok' })]);

    select(new File(['%PDF'], 'releve.pdf', { type: 'application/pdf' }));
    component.analyze();

    expect(component.error()).toContain('déjà été importé');
    expect(component.error()).not.toContain('texte serveur');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  describe('ouverte depuis le rapprochement (tout document par l’IA)', () => {
    const pdf = new File(['%PDF'], 'releve.pdf', { type: 'application/pdf' });

    it('présélectionne le fichier et le compte déjà choisis', async () => {
      await open([account({ id: 'ok', isDefault: true }), account({ id: 'autre' })], capabilities, {
        initialFile: pdf,
        initialBankAccountId: 'autre',
        origin: 'reconciliation'
      });

      expect(component.file()).toBe(pdf);
      expect(component.bankAccountId).toBe('autre');
      expect(component.canAnalyze()).toBeTrue();
    });

    it('écarte un fichier présélectionné trop lourd', async () => {
      await open([account({ id: 'ok' })], capabilities, {
        initialFile: new File([new Uint8Array(2048)], 'gros.pdf', { type: 'application/pdf' }),
        origin: 'reconciliation'
      });

      expect(component.file()).toBeNull();
      expect(component.error()).toContain('trop volumineux');
    });

    it('revient au rapprochement après l’analyse', async () => {
      api.start.and.returnValue(of({ id: 's-7' } as BankStatementImportSession));
      await open([account({ id: 'ok' })], capabilities, { initialFile: pdf, origin: 'reconciliation' });

      component.analyze();

      expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-import/session', 's-7'], {
        queryParams: { from: 'reconciliation' }
      });
    });

    it('explique quoi faire quand aucun compte n’est éligible', async () => {
      await open(
        [account({ id: 'sans-532', chartOfAccountNumber: null }), account({ id: 'euros', currency: 'EUR' })],
        capabilities,
        { initialFile: pdf, origin: 'reconciliation' }
      );

      expect(component.hasEligibleAccount()).toBeFalse();
      expect(document.body.querySelector('.bsu-no-eligible')).not.toBeNull();
      expect(text()).toContain('CSV / OFX');
    });

    it('n’affiche pas cette aide depuis la saisie manuelle', async () => {
      await open([account({ id: 'sans-532', chartOfAccountNumber: null })]);

      expect(document.body.querySelector('.bsu-no-eligible')).toBeNull();
    });

    it('annonce la relecture par l’IA de ce qui n’est pas lu avec certitude', async () => {
      await open([account({ id: 'ok' })], { ...capabilities, aiProviderKind: 'local', allDocumentsViaAi: true }, { origin: 'reconciliation' });

      expect(text()).toContain('non lues avec certitude');
      expect(text()).toContain('rapprochement bancaire');
    });

    it('prévient qu’un compte hors dinars n’est pas pris en charge', async () => {
      await open([account({ id: 'euros', currency: 'EUR', isDefault: true })]);

      expect(component.bankAccountId).toBe('euros');
      expect(text()).toContain('pas en dinars');
    });
  });

  it('ne permet pas l’analyse quand la fonctionnalité est désactivée', async () => {
    await open([account({ id: 'ok' })], null);

    select(new File(['%PDF'], 'releve.pdf', { type: 'application/pdf' }));

    expect(component.canAnalyze()).toBeFalse();
  });
});
