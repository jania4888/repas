import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ToastService } from '@core/services/toast.service';
import { AccountingService, ChartOfAccountDto } from '../services/accounting.service';
import {
  ChartOfAccountsComponent,
  SCE_ACCOUNT_MAX_DIGITS,
  SCE_ACCOUNT_NUMBER_PATTERN,
  sceAccountDigitCount
} from './chart-of-accounts.component';

describe('ChartOfAccountsComponent', () => {
  function createComponent(overrides: {
    createSubAccount?: ReturnType<AccountingService['createSubAccount']>;
    toggleAccountActive?: ReturnType<AccountingService['toggleAccountActive']>;
    extractErrorMessage?: string;
  } = {}): {
    component: ChartOfAccountsComponent;
    extractErrorMessage: jasmine.Spy;
  } {
    const apiMessage = overrides.extractErrorMessage
      ?? 'Le numéro de compte doit être un numéro SCE (chiffres, points autorisés).';
    // Le repli réseau vit dans ErrorHandlerService depuis que `httpFailureMessage` lui délègue :
    // le double doit donc l'honorer, sinon il teste un contrat que le service n'a plus.
    const extractErrorMessage = jasmine.createSpy('extractErrorMessage')
      .and.callFake((err: unknown, networkFallback?: string) =>
        networkFallback !== undefined && (err as HttpErrorResponse)?.status === 0
          ? networkFallback
          : apiMessage);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AccountingService,
          useValue: {
            getChartOfAccounts: () => of({ success: true, data: [] }),
            getTunisianBanks: () => of({ success: true, data: [] }),
            createSubAccount: jasmine.createSpy('createSubAccount').and.returnValue(
              overrides.createSubAccount ?? of({ success: true, data: 'id' })
            ),
            toggleAccountActive: jasmine.createSpy('toggleAccountActive').and.returnValue(
              overrides.toggleAccountActive ?? of({ success: true, data: true })
            )
          }
        },
        { provide: AuthService, useValue: { hasPermission: () => true } },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        { provide: ConfirmationService, useValue: { confirm: (opts: { accept: () => void }) => opts.accept() } },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage } }
      ]
    });

    return {
      component: TestBed.runInInjectionContext(() => new ChartOfAccountsComponent()),
      extractErrorMessage
    };
  }

  function account(partial: Partial<ChartOfAccountDto> = {}): ChartOfAccountDto {
    return {
      id: 'acc-1',
      accountNumber: '428.1',
      label: 'Personnel — mutuelles et caisses complémentaires',
      accountClass: 4,
      natureType: 1,
      isSystem: true,
      isActive: true,
      level: 5,
      ...partial
    };
  }

  it('accepte les numéros SCE pointés et les auxiliaires numériques', () => {
    expect(SCE_ACCOUNT_NUMBER_PATTERN.test('428.3')).toBeTrue();
    expect(SCE_ACCOUNT_NUMBER_PATTERN.test('425.1')).toBeTrue();
    expect(SCE_ACCOUNT_NUMBER_PATTERN.test('41100001')).toBeTrue();
    expect(SCE_ACCOUNT_NUMBER_PATTERN.test('421.1')).toBeTrue();

    const { component } = createComponent();
    component.form.label = 'Personnel — mutuelle';
    component.form.accountNumber = '428.3';
    expect(component.canSubmit()).toBeTrue();
    component.form.accountNumber = '41100001';
    expect(component.canSubmit()).toBeTrue();
  });

  it('refuse un numéro de plus de 8 chiffres, points non comptés', () => {
    const { component } = createComponent();
    component.form.label = 'Compte salarié';

    // La forme héritée des comptes auxiliaires salariés : 425 + 7 derniers chiffres du matricule.
    component.form.accountNumber = '4259655554';
    expect(component.canSubmit()).toBeFalse();
    expect(component.accountNumberError()).toContain('10 chiffres');

    // 8 chiffres exactement : accepté.
    component.form.accountNumber = '41100001';
    expect(component.canSubmit()).toBeTrue();
    expect(component.accountNumberError()).toBeNull();

    // Les points ne consomment pas le budget : 421.1 vaut 4 chiffres.
    component.form.accountNumber = '421.1';
    expect(component.canSubmit()).toBeTrue();

    // ... mais 9 chiffres répartis autour d'un point restent refusés.
    component.form.accountNumber = '12345678.1';
    expect(component.canSubmit()).toBeFalse();
  });

  it('ne suggère jamais un numéro enfant de plus de 8 chiffres', () => {
    const { component } = createComponent();
    // Un frère hérité à 10 chiffres ne doit pas dicter la largeur du suffixe proposé.
    component.rows.set([
      account({ accountNumber: '425', label: 'Personnel - rémunérations dues' }),
      account({ accountNumber: '4259655554', label: 'sami samou' })
    ]);

    const suggestion = component.nextFreeChildNumber('425');
    expect(suggestion).not.toBeNull();
    expect(sceAccountDigitCount(suggestion!)).toBeLessThanOrEqual(SCE_ACCOUNT_MAX_DIGITS);

    // Un parent déjà à 8 chiffres n'a plus de place pour un enfant.
    expect(component.nextFreeChildNumber('41100001')).toBeNull();
  });

  it('refuse les numéros SCE mal formés', () => {
    const { component } = createComponent();
    component.form.label = 'Personnel — mutuelle';
    for (const num of ['428.', '.428', '42..1', 'A28']) {
      component.form.accountNumber = num;
      expect(component.canSubmit()).withContext(num).toBeFalse();
    }
  });

  it('rejette un numéro déjà présent dans le plan sans appeler l’API', () => {
    const { component } = createComponent();
    const api = TestBed.inject(AccountingService) as unknown as { createSubAccount: jasmine.Spy };
    component.rows.set([
      account({ accountNumber: '436712', label: 'TVA collectée sur encaissements' })
    ]);
    component.form.accountNumber = '436712';
    component.form.label = 'tv 10%';

    component.create();

    expect(component.createError()).toBe(
      'Le compte 436712 existe déjà (TVA collectée sur encaissements).'
    );
    expect(component.error()).toBeNull();
    expect(api.createSubAccount).not.toHaveBeenCalled();
  });

  it('propose le prochain numéro libre sous 43671', () => {
    const { component } = createComponent();
    component.rows.set([
      account({ accountNumber: '43671', label: 'TVA collectée' }),
      account({ accountNumber: '436711', label: 'TVA collectée sur débits' }),
      account({ accountNumber: '436712', label: 'TVA collectée sur encaissements' })
    ]);
    component.form.accountNumber = '';
    component.lastSuggestedNumber = '';

    component.onParentChange('43671');

    expect(component.form.accountNumber).toBe('436713');
    expect(component.lastSuggestedNumber).toBe('436713');
  });

  it('n’écrase pas un numéro déjà saisi par l’utilisateur', () => {
    const { component } = createComponent();
    component.rows.set([
      account({ accountNumber: '43671', label: 'TVA collectée' }),
      account({ accountNumber: '436711', label: 'TVA collectée sur débits' }),
      account({ accountNumber: '436712', label: 'TVA collectée sur encaissements' })
    ]);
    component.form.accountNumber = '436799';
    component.lastSuggestedNumber = '';

    component.onParentChange('43671');

    expect(component.form.accountNumber).toBe('436799');
  });

  it('affiche le message API sur HTTP 400 à la création', () => {
    const { component, extractErrorMessage } = createComponent({
      createSubAccount: throwError(() => new HttpErrorResponse({
        status: 400,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'La validation a échoué.',
          fieldErrors: {
            'Request.AccountNumber': [{ message: 'Le numéro de compte doit être un numéro SCE (chiffres, points autorisés).' }]
          }
        }
      })),
      extractErrorMessage: 'Le numéro de compte doit être un numéro SCE (chiffres, points autorisés).'
    });

    component.form.accountNumber = '428.3';
    component.form.label = 'Personnel — mutuelle complémentaire';
    component.create();

    expect(extractErrorMessage).toHaveBeenCalled();
    expect(component.createError()).toBe('Le numéro de compte doit être un numéro SCE (chiffres, points autorisés).');
  });

  it('garde le message réseau uniquement si status === 0', () => {
    const { component, extractErrorMessage } = createComponent({
      createSubAccount: throwError(() => new HttpErrorResponse({ status: 0 }))
    });

    component.form.accountNumber = '428.3';
    component.form.label = 'Personnel — mutuelle complémentaire';
    component.create();

    // Le service est bien sollicité — c'est lui qui arbitre — mais il rend le repli contextuel.
    expect(extractErrorMessage).toHaveBeenCalledWith(
      jasmine.any(HttpErrorResponse), 'Erreur réseau lors de la création du compte.');
    expect(component.createError()).toBe('Erreur réseau lors de la création du compte.');
  });

  it('httpFailureMessage extrait le message API et réserve le repli réseau au status 0', () => {
    const { component, extractErrorMessage } = createComponent({
      extractErrorMessage: 'Le compte 428.1 existe déjà (Personnel — mutuelles et caisses complémentaires).'
    });

    const apiErr = new HttpErrorResponse({ status: 400, error: { error: 'Le compte 428.1 existe déjà.' } });
    expect(component.httpFailureMessage(apiErr, 'Erreur réseau lors de la création du compte.'))
      .toBe('Le compte 428.1 existe déjà (Personnel — mutuelles et caisses complémentaires).');
    // Le repli voyage désormais avec l'erreur : c'est le service qui arbitre lequel rendre.
    expect(extractErrorMessage).toHaveBeenCalledWith(
      apiErr, 'Erreur réseau lors de la création du compte.');

    expect(component.httpFailureMessage(new HttpErrorResponse({ status: 0 }), 'Erreur réseau lors de la création du compte.'))
      .toBe('Erreur réseau lors de la création du compte.');
  });

  it('affiche le message API sur HTTP 400 au changement de statut', () => {
    const { component, extractErrorMessage } = createComponent({
      toggleAccountActive: throwError(() => new HttpErrorResponse({
        status: 400,
        error: { error: 'Un compte système ne peut pas être désactivé.' }
      })),
      extractErrorMessage: 'Un compte système ne peut pas être désactivé.'
    });

    component.confirmToggleActive(account({ isSystem: false, isActive: true }));

    expect(extractErrorMessage).toHaveBeenCalled();
    expect(component.error()).toBe('Un compte système ne peut pas être désactivé.');
  });

  it('affiche l’encadré bancaire sous 5321 et enregistre sans RIB', () => {
    const { component } = createComponent();
    component.form.parentAccountNumber = '5321';
    expect(component.showsBankPanel()).toBeTrue();

    component.form.accountNumber = '53211';
    component.form.label = 'Banque Biat';
    component.create();

    const api = TestBed.inject(AccountingService) as unknown as { createSubAccount: jasmine.Spy };
    const request = api.createSubAccount.calls.mostRecent().args[0];
    expect(request.accountNumber).toBe('53211');
    expect(request.rib).toBeNull();
    expect(request.iban).toBeNull();
    expect(component.showsFxCurrency()).toBeFalse();
  });
});
