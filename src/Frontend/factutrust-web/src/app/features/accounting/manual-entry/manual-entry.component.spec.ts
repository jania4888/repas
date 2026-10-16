import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ManualEntryComponent } from './manual-entry.component';
import { AccountingService } from '../services/accounting.service';
import { AuthService } from '@core/services/auth.service';
import { TaxService } from '@core/services/tax.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { ClientService } from '@core/services/client.service';
import { SupplierService } from '@core/services/supplier.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

describe('ManualEntryComponent', () => {
  let fixture: ComponentFixture<ManualEntryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManualEntryComponent, RouterTestingModule],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AccountingService,
          useValue: {
            getChartOfAccounts: () => of({ success: true, data: [] }),
            getCurrencies: () => of({ success: true, data: [] }),
            getJournals: () => of({ success: true, data: [] }),
            getPeriods: () => of({ success: true, data: [] }),
            getJournalTemplates: () => of({ success: true, data: [] }),
            createManualJournalEntry: () => of({ success: true, data: 'entry-id' }),
            updateDraftJournalEntry: () => of({ success: true, data: true }),
            getJournal: () => of({ success: true, data: [] }),
            getJournalEntry: () => of({ success: true, data: null }),
            createJournalTemplate: () => of({ success: true }),
            getThirdPartyProfile: () => of({ success: true, data: null }),
            runTemplateRecurrence: () => of({ success: true }),
            uploadEntryAttachment: () => of({ success: true, data: null })
          }
        },
        {
          provide: TaxService,
          useValue: { getVatRates: jasmine.createSpy('getVatRates').and.returnValue(of({ success: true, data: [{ id: '1', percent: 19, label: '19%' }] })) }
        },
        {
          provide: BankAccountService,
          useValue: { list: () => of({ success: true, data: [] }) }
        },
        {
          provide: ClientService,
          useValue: { getClients: () => of({ success: true, data: { items: [] } }) }
        },
        {
          provide: SupplierService,
          useValue: { getSuppliers: () => of({ success: true, data: { items: [] } }) }
        },
        {
          provide: AuthService,
          useValue: {
            hasAllPermissions: () => true,
            hasPermission: () => true,
            isAccountingFirm: () => true,
            isDelegatedMode: () => true,
            user: signal(null)
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ManualEntryComponent);
    fixture.detectChanges();
  });

  it('renders four entry mode tabs', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Saisie standard');
    expect(el.textContent).toContain('Saisie guidée');
    expect(el.textContent).toContain('Saisie par modèle');
    expect(el.textContent).toContain('Saisie récurrente');
  });

  it('place l’historique du journal sous la grille et hors du payload IA', () => {
    const el = fixture.nativeElement as HTMLElement;
    const main = el.querySelector('.entry-layout__main');
    const grid = main?.querySelector('app-entry-lines-grid');
    const history = main?.querySelector('app-entry-journal-history');
    const tabs = main?.querySelector('app-entry-bottom-tabs');

    expect(grid).toBeTruthy();
    expect(history).toBeTruthy();
    expect(tabs).toBeTruthy();
    expect(grid!.compareDocumentPosition(history!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(history!.compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const payload = JSON.stringify(fixture.componentInstance.buildManualEntryAnalyzePayload());
    expect(payload).not.toContain('journalHistory');
    expect(payload).not.toContain('Dernières écritures');
  });

  it('renders header form with journal field', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#eh-journal')).toBeTruthy();
    expect(el.textContent).toContain('Informations générales');
  });

  it('stays in create mode without entryId query param', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Saisie des écritures comptables');
    expect(el.textContent).toContain('Saisie guidée');
    expect(el.textContent).toContain('Enregistrer');
    expect(el.textContent).not.toContain('Enregistrer les modifications');
  });

  it('affiche le récapitulatif et les raccourcis en bande basse, après la colonne de saisie', () => {
    const el = fixture.nativeElement as HTMLElement;
    const main = el.querySelector('.entry-layout__main');
    const footer = el.querySelector('.entry-layout__footer');

    expect(el.querySelector('.entry-layout__sidebar')).toBeNull();
    expect(main).toBeTruthy();
    expect(footer).toBeTruthy();
    expect(footer!.querySelector('app-entry-summary-panel')).toBeTruthy();
    expect(footer!.querySelector('app-entry-shortcuts-panel')).toBeTruthy();
    expect(main!.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .withContext('la bande doit venir après la colonne principale dans le DOM')
      .toBeTruthy();
  });

  describe("import d'une pièce comptable", () => {
    function pressCtrlS(): void {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
      );
      fixture.detectChanges();
    }

    it('openDocumentImport ouvre la modale', () => {
      const cmp = fixture.componentInstance;
      expect(cmp.documentImportVisible()).toBeFalse();

      cmp.openDocumentImport();

      expect(cmp.documentImportVisible()).toBeTrue();
    });

    it('neutralise Ctrl+S tant que la modale d’import est ouverte', () => {
      const cmp = fixture.componentInstance;
      const submit = spyOn(cmp, 'submit');

      cmp.documentImportVisible.set(true);
      fixture.detectChanges();
      pressCtrlS();

      expect(submit)
        .withContext("Ctrl+S ne doit pas enregistrer pendant l'analyse d'une facture")
        .not.toHaveBeenCalled();
    });

    it('laisse Ctrl+S fonctionner quand la modale est fermée', () => {
      const cmp = fixture.componentInstance;
      const submit = spyOn(cmp, 'submit');

      // Écriture soumettable : deux lignes équilibrées.
      cmp.store.entryLabel.set('Test');
      const [first, second] = cmp.store.lines();
      cmp.store.setLines([
        { ...first, accountNumber: '607', lineLabel: 'A', debit: 100, credit: null },
        { ...second, accountNumber: '4011', lineLabel: 'B', debit: null, credit: 100 }
      ]);
      cmp.documentImportVisible.set(false);
      fixture.detectChanges();
      pressCtrlS();

      expect(submit).toHaveBeenCalled();
    });
  });
});

describe('ManualEntryComponent edit mode', () => {
  let fixture: ComponentFixture<ManualEntryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManualEntryComponent, RouterTestingModule],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({
                entryId: 'entry-42',
                returnFrom: '2026-08-01',
                returnTo: '2026-08-31'
              })
            }
          }
        },
        {
          provide: AccountingService,
          useValue: {
            getChartOfAccounts: () => of({ success: true, data: [] }),
            getCurrencies: () => of({ success: true, data: [] }),
            getJournals: () => of({ success: true, data: [] }),
            getPeriods: () => of({ success: true, data: [] }),
            getJournalTemplates: () => of({ success: true, data: [] }),
            createManualJournalEntry: () => of({ success: true, data: 'entry-id' }),
            updateDraftJournalEntry: () => of({ success: true, data: true }),
            getJournalEntry: () => of({
              success: true,
              data: {
                id: 'entry-42',
                entryNumber: 6,
                journalCode: 'JV',
                entryDate: '2026-08-14',
                label: 'Client — FAC-2026-000019',
                sourceEntityType: 'Invoice',
                isAutoGenerated: true,
                isReversed: false,
                reversesEntryId: null,
                status: 0,
                isDraft: true,
                pieceRef: 'FAC-2026-000019',
                attachmentCount: 0,
                lines: [
                  { id: 'l1', lineNumber: 1, accountNumber: '4111', label: 'Client', debit: 100, credit: 0, currency: 'TND' },
                  { id: 'l2', lineNumber: 2, accountNumber: '707', label: 'Ventes', debit: 0, credit: 100, currency: 'TND' }
                ]
              }
            }),
            createJournalTemplate: () => of({ success: true }),
            getThirdPartyProfile: () => of({ success: true, data: null }),
            runTemplateRecurrence: () => of({ success: true }),
            uploadEntryAttachment: () => of({ success: true, data: null })
          }
        },
        {
          provide: TaxService,
          useValue: { getVatRates: jasmine.createSpy('getVatRates').and.returnValue(of({ success: true, data: [{ id: '1', percent: 19, label: '19%' }] })) }
        },
        {
          provide: BankAccountService,
          useValue: { list: () => of({ success: true, data: [] }) }
        },
        {
          provide: ClientService,
          useValue: { getClients: () => of({ success: true, data: { items: [] } }) }
        },
        {
          provide: SupplierService,
          useValue: { getSuppliers: () => of({ success: true, data: { items: [] } }) }
        },
        {
          provide: AuthService,
          useValue: {
            hasAllPermissions: () => true,
            hasPermission: () => true,
            isAccountingFirm: () => true,
            isDelegatedMode: () => true,
            user: signal(null)
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ManualEntryComponent);
    fixture.detectChanges();
  });

  it('loads draft entry and switches to edit chrome', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Modification de l\'écriture JV n° 6 — Brouillon');
    expect(el.textContent).toContain('Enregistrer les modifications');
    expect(el.textContent).toContain('facture de vente');
    expect(el.textContent).not.toContain('Saisie guidée');
    const journal = el.querySelector('#eh-journal') as HTMLSelectElement | null;
    expect(journal?.disabled).toBeTrue();
    const date = el.querySelector('#eh-date') as HTMLInputElement | null;
    expect(date?.disabled).toBeTrue();
  });
});

function buildAccountingServiceStub(entryOverrides: Record<string, unknown> = {}) {
  return {
    getChartOfAccounts: () => of({ success: true, data: [] }),
            getCurrencies: () => of({ success: true, data: [] }),
    getJournals: () => of({ success: true, data: [] }),
    getPeriods: () => of({ success: true, data: [] }),
    getJournalTemplates: () => of({ success: true, data: [] }),
    createManualJournalEntry: () => of({ success: true, data: 'entry-id' }),
    updateDraftJournalEntry: jasmine.createSpy('updateDraftJournalEntry').and.returnValue(of({ success: true, data: true })),
    getJournalEntry: () =>
      of({
        success: true,
        data: {
          id: 'entry-42',
          entryNumber: 6,
          journalCode: 'JV',
          entryDate: '2026-08-14',
          label: 'Écriture',
          sourceEntityType: null,
          isAutoGenerated: false,
          isReversed: false,
          reversesEntryId: null,
          status: 0,
          isDraft: true,
          pieceRef: null,
          attachmentCount: 0,
          lines: [
            { id: 'l1', lineNumber: 1, accountNumber: '4111', label: 'Client', debit: 100, credit: 0, currency: 'TND' },
            { id: 'l2', lineNumber: 2, accountNumber: '707', label: 'Ventes', debit: 0, credit: 100, currency: 'TND' }
          ],
          ...entryOverrides
        }
      }),
    createJournalTemplate: () => of({ success: true }),
    getThirdPartyProfile: () => of({ success: true, data: null }),
    runTemplateRecurrence: () => of({ success: true }),
    uploadEntryAttachment: () => of({ success: true, data: null })
  };
}

function buildEditModeProviders(accountingService: unknown, confirmationService?: unknown) {
  const providers: unknown[] = [
    provideNoopAnimations(),
    provideHttpClient(),
    provideHttpClientTesting(),
    {
      provide: ActivatedRoute,
      useValue: {
        snapshot: {
          queryParamMap: convertToParamMap({
            entryId: 'entry-42',
            returnFrom: '2026-08-01',
            returnTo: '2026-08-31'
          })
        }
      }
    },
    { provide: AccountingService, useValue: accountingService },
    {
      provide: TaxService,
      useValue: { getVatRates: jasmine.createSpy('getVatRates').and.returnValue(of({ success: true, data: [{ id: '1', percent: 19, label: '19%' }] })) }
    },
    { provide: BankAccountService, useValue: { list: () => of({ success: true, data: [] }) } },
    { provide: ClientService, useValue: { getClients: () => of({ success: true, data: { items: [] } }) } },
    { provide: SupplierService, useValue: { getSuppliers: () => of({ success: true, data: { items: [] } }) } },
    {
      provide: AuthService,
      useValue: {
        hasAllPermissions: () => true,
        hasPermission: () => true,
        isAccountingFirm: () => true,
        isDelegatedMode: () => true,
        user: signal(null)
      }
    }
  ];
  if (confirmationService) {
    providers.push({ provide: ConfirmationService, useValue: confirmationService });
  }
  return providers;
}

describe('ManualEntryComponent edit mode — extourne', () => {
  let fixture: ComponentFixture<ManualEntryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManualEntryComponent, RouterTestingModule],
      providers: buildEditModeProviders(
        buildAccountingServiceStub({
          sourceEntityType: 'ManualReversal',
          isAutoGenerated: true,
          reversesEntryId: 'entry-original'
        })
      )
    }).compileComponents();

    fixture = TestBed.createComponent(ManualEntryComponent);
    fixture.detectChanges();
  });

  it('loads the reversal draft without redirecting', () => {
    const cmp = fixture.componentInstance;
    expect(cmp.store.editingEntryId()).toBe('entry-42');
    expect(cmp.store.isReversal()).toBe(true);
  });

  it('shows the reversal warning banner', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(
      'Cette écriture est une extourne : vos modifications rompent la symétrie miroir avec l\'écriture d\'origine.'
    );
  });
});

describe('ManualEntryComponent edit mode — brouillon caisse', () => {
  let fixture: ComponentFixture<ManualEntryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManualEntryComponent, RouterTestingModule],
      providers: buildEditModeProviders(
        buildAccountingServiceStub({
          sourceEntityType: 'CashOperation',
          isAutoGenerated: true
        })
      )
    }).compileComponents();

    fixture = TestBed.createComponent(ManualEntryComponent);
    fixture.detectChanges();
  });

  it('shows the cash-operation VAT impact warning banner', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Cette modification impacte le calcul de la TVA sur encaissements');
    expect(el.textContent).toContain('La ventilation par taux reste celle de l\'opération de caisse d\'origine.');
  });

  it('does not show the reversal warning banner', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('vos modifications rompent la symétrie miroir');
  });
});

describe('ManualEntryComponent edit mode — délettrage à l’enregistrement', () => {
  function makeConfirmationSpy(acceptOnConfirm: boolean) {
    const spy = jasmine.createSpyObj<ConfirmationService>('ConfirmationService', ['confirm']);
    spy.confirm.and.callFake((cfg: { accept?: () => void; reject?: () => void }) => {
      if (acceptOnConfirm) cfg.accept?.();
      else cfg.reject?.();
    });
    return spy;
  }

  it('shows the unlettering confirmation modal when the draft has lettered lines', async () => {
    const confirmationSpy = makeConfirmationSpy(true);
    const accountingService = buildAccountingServiceStub({
      lines: [
        { id: 'l1', lineNumber: 1, accountNumber: '4111', label: 'Client', debit: 100, credit: 0, currency: 'TND', letteringCode: 'L01' },
        { id: 'l2', lineNumber: 2, accountNumber: '4111', label: 'Client', debit: 0, credit: 100, currency: 'TND', letteringCode: 'L01' }
      ]
    });

    await TestBed.configureTestingModule({
      imports: [ManualEntryComponent, RouterTestingModule],
      providers: buildEditModeProviders(accountingService, confirmationSpy)
    }).compileComponents();

    const fixture = TestBed.createComponent(ManualEntryComponent);
    fixture.detectChanges();

    const cmp = fixture.componentInstance;
    expect(cmp.store.letteredGroupCodes()).toEqual(['L01']);

    cmp.submit('navigate');

    expect(confirmationSpy.confirm).toHaveBeenCalled();
    const call = confirmationSpy.confirm.calls.mostRecent().args[0] as { message?: string; header?: string };
    expect(call.header).toBe('Écriture lettrée');
    expect(call.message).toContain('L01');
    expect(accountingService.updateDraftJournalEntry).toHaveBeenCalled();
  });

  it('does not call updateDraftJournalEntry when the unlettering modal is cancelled', async () => {
    const confirmationSpy = makeConfirmationSpy(false);
    const accountingService = buildAccountingServiceStub({
      lines: [
        { id: 'l1', lineNumber: 1, accountNumber: '4111', label: 'Client', debit: 100, credit: 0, currency: 'TND', letteringCode: 'L01' },
        { id: 'l2', lineNumber: 2, accountNumber: '4111', label: 'Client', debit: 0, credit: 100, currency: 'TND', letteringCode: 'L01' }
      ]
    });

    await TestBed.configureTestingModule({
      imports: [ManualEntryComponent, RouterTestingModule],
      providers: buildEditModeProviders(accountingService, confirmationSpy)
    }).compileComponents();

    const fixture = TestBed.createComponent(ManualEntryComponent);
    fixture.detectChanges();

    const cmp = fixture.componentInstance;
    cmp.submit('navigate');

    expect(confirmationSpy.confirm).toHaveBeenCalled();
    expect(accountingService.updateDraftJournalEntry).not.toHaveBeenCalled();
  });

  it('does not show the unlettering modal when the draft has no lettered lines', async () => {
    const confirmationSpy = makeConfirmationSpy(true);
    const accountingService = buildAccountingServiceStub();

    await TestBed.configureTestingModule({
      imports: [ManualEntryComponent, RouterTestingModule],
      providers: buildEditModeProviders(accountingService, confirmationSpy)
    }).compileComponents();

    const fixture = TestBed.createComponent(ManualEntryComponent);
    fixture.detectChanges();

    const cmp = fixture.componentInstance;
    cmp.submit('navigate');

    const headers = confirmationSpy.confirm.calls.all().map(c => (c.args[0] as { header?: string }).header);
    expect(headers).not.toContain('Écriture lettrée');
    expect(accountingService.updateDraftJournalEntry).toHaveBeenCalled();
  });
});
