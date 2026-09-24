import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService, User } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { ToastService } from '@core/services/toast.service';
import {
  AccountingService,
  AccountBalanceSide,
  MonthlyDeclarationConfigurationDto,
  MonthlyDeclarationFamily,
  MonthlyDeclarationMode,
  MonthlyDeclarationRubricDto,
  RubricAccountMatchMode,
  RubricAccountRole,
  RubricGrossKind,
  RubricWithheldKind
} from '../services/accounting.service';
import { MonthlyDeclarationConfigComponent } from './monthly-declaration-config.component';

const tclRubric: MonthlyDeclarationRubricDto = {
  id: 'rubric-tcl',
  family: MonthlyDeclarationFamily.Tcl,
  code: 'F9_TCL',
  label: 'T.C.L sur chiffre d’affaires',
  reportCode: '*',
  grossKind: RubricGrossKind.Account,
  withheldKind: RubricWithheldKind.GrossTimesRate,
  grossSide: AccountBalanceSide.Credit,
  withheldSide: AccountBalanceSide.Credit,
  ratePercent: 0.2,
  fixedGrossAmount: null,
  fixedWithheldAmount: null,
  payrollComponent: null,
  withheldPayrollComponent: null,
  effectiveFrom: null,
  effectiveTo: null,
  isActive: true,
  displayOrder: 10,
  accounts: [
    { role: RubricAccountRole.Gross, accountNumber: '70', matchMode: RubricAccountMatchMode.Prefix }
  ]
};

const tfpRubric: MonthlyDeclarationRubricDto = {
  ...tclRubric,
  id: 'rubric-tfp',
  family: MonthlyDeclarationFamily.Tfp,
  code: 'F2_TFP',
  label: 'Taxe de formation professionnelle',
  ratePercent: 2
};

function configuration(
  overrides: Partial<MonthlyDeclarationConfigurationDto> = {}
): MonthlyDeclarationConfigurationDto {
  return {
    settings: {
      mode: MonthlyDeclarationMode.Legacy,
      configuredSince: null,
      lastParityRunAt: null,
      lastParityMaxGapMillimes: 0,
      parityCleanStreak: 0,
      requiredCleanParityPeriods: 3,
      canSwitchToConfigured: false,
      parityOverrideBy: null,
      parityOverrideReason: null,
      configurableLinesEnabled: true
    },
    families: [
      { family: MonthlyDeclarationFamily.Withholding, isIncluded: false },
      { family: MonthlyDeclarationFamily.Tcl, isIncluded: true },
      { family: MonthlyDeclarationFamily.Tfp, isIncluded: false }
    ],
    rubrics: [tclRubric, tfpRubric],
    ...overrides
  };
}

const firmDelegatedUser: User = {
  id: 'u1',
  email: 'firm@test.c',
  firstName: 'O',
  lastName: 'G',
  fullName: 'O G',
  role: 'FirmManager',
  roleDisplay: 'Responsable cabinet',
  tenantId: '00000000-0000-0000-0000-000000000002',
  companyName: 'Cabinet Test',
  tenantKind: 'AccountingFirm',
  accessMode: 'delegated',
  contextTenantId: '00000000-0000-0000-0000-000000000003',
  contextCompanyName: 'Ste Bouzgarou',
  twoFactorEnabled: false,
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['accounting:read', 'accounting:declare', 'firm:manage']
};

const companyUser: User = {
  id: 'u2',
  email: 'company@test.c',
  firstName: 'A',
  lastName: 'B',
  fullName: 'A B',
  role: 'Administrator',
  roleDisplay: 'Administrateur',
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyName: 'Société Test',
  tenantKind: 'Company',
  twoFactorEnabled: false,
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['accounting:read']
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

describe('MonthlyDeclarationConfigComponent render', () => {
  let fixture: ComponentFixture<MonthlyDeclarationConfigComponent>;
  let api: {
    getMonthlyDeclarationConfiguration: jasmine.Spy;
    getChartOfAccounts: jasmine.Spy;
    createMonthlyDeclarationRubric: jasmine.Spy;
    updateMonthlyDeclarationRubric: jasmine.Spy;
    toggleMonthlyDeclarationRubric: jasmine.Spy;
    deleteMonthlyDeclarationRubric: jasmine.Spy;
    setMonthlyDeclarationFamily: jasmine.Spy;
    duplicateMonthlyDeclarationConfig: jasmine.Spy;
  };
  let firmAssignments: { getActiveClients: jasmine.Spy };
  let confirmation: { confirm: jasmine.Spy };

  beforeEach(async () => {
    api = {
      getMonthlyDeclarationConfiguration: jasmine
        .createSpy('getMonthlyDeclarationConfiguration')
        .and.returnValue(of({ success: true, data: configuration() })),
      getChartOfAccounts: jasmine.createSpy('getChartOfAccounts').and.returnValue(
        of({
          success: true,
          data: [
            {
              id: '1',
              accountNumber: '7071',
              label: 'Ventes de marchandises',
              accountClass: 7,
              natureType: 0,
              isSystem: false,
              isActive: true,
              level: 4
            }
          ]
        })
      ),
      createMonthlyDeclarationRubric: jasmine
        .createSpy('createMonthlyDeclarationRubric')
        .and.returnValue(of({ success: true, data: 'new-id' })),
      updateMonthlyDeclarationRubric: jasmine
        .createSpy('updateMonthlyDeclarationRubric')
        .and.returnValue(of({ success: true, data: true })),
      toggleMonthlyDeclarationRubric: jasmine
        .createSpy('toggleMonthlyDeclarationRubric')
        .and.returnValue(of({ success: true, data: true })),
      deleteMonthlyDeclarationRubric: jasmine
        .createSpy('deleteMonthlyDeclarationRubric')
        .and.returnValue(of({ success: true, data: true })),
      setMonthlyDeclarationFamily: jasmine
        .createSpy('setMonthlyDeclarationFamily')
        .and.returnValue(of({ success: true, data: true })),
      duplicateMonthlyDeclarationConfig: jasmine
        .createSpy('duplicateMonthlyDeclarationConfig')
        .and.returnValue(
          of({
            success: true,
            data: { inserted: 4, replaced: 0, skippedCodes: ['F9_TCL'], unknownAccounts: [] }
          })
        )
    };

    firmAssignments = {
      getActiveClients: jasmine.createSpy('getActiveClients').and.returnValue(
        of({
          success: true,
          data: [
            {
              assignmentId: 'a1',
              companyTenantId: '00000000-0000-0000-0000-000000000003',
              companyName: 'Ste Bouzgarou',
              activeSince: '2026-01-01'
            },
            {
              assignmentId: 'a2',
              companyTenantId: '00000000-0000-0000-0000-000000000004',
              companyName: 'Ste Voisine',
              activeSince: '2026-01-01'
            }
          ]
        })
      )
    };

    confirmation = { confirm: jasmine.createSpy('confirm') };

    await TestBed.configureTestingModule({
      imports: [MonthlyDeclarationConfigComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AccountingService, useValue: api },
        { provide: FirmAssignmentService, useValue: firmAssignments },
        { provide: ConfirmationService, useValue: confirmation },
        { provide: ToastService, useValue: { add: () => undefined } },
        {
          provide: ErrorHandlerService,
          useValue: {
            extractErrorMessage: (err: { error?: { error?: string }; message?: string } | string) => {
              if (typeof err === 'string') return err;
              return err?.error?.error ?? err?.message ?? 'Erreur';
            }
          }
        }
      ]
    }).compileComponents();
  });

  async function renderForUser(user: User): Promise<void> {
    const auth = TestBed.inject(AuthService);
    setUser(auth, user);
    TestBed.inject(FirmContextService).syncFromUser();
    fixture = TestBed.createComponent(MonthlyDeclarationConfigComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return fixture.nativeElement.textContent as string;
  }

  it('affiche les onze familles en onglets', async () => {
    await renderForUser(firmDelegatedUser);
    const body = text();
    expect(body).toContain('Retenue à la source');
    expect(body).toContain('T.F.P');
    expect(body).toContain('FOPROLOS');
    expect(body).toContain('Droit de consommation');
    expect(body).toContain('T.V.A');
    expect(body).toContain('Autres taxes C.A');
    expect(body).toContain('Droit de timbre');
    expect(body).toContain('Taxe hôtelière');
    expect(body).toContain('T.C.L');
    expect(body).toContain('Droit de licence');
    expect(body).toContain('Autres informations');
  });

  it('charge la configuration et le plan comptable une seule fois', async () => {
    await renderForUser(firmDelegatedUser);
    expect(api.getMonthlyDeclarationConfiguration).toHaveBeenCalledTimes(1);
    expect(api.getChartOfAccounts).toHaveBeenCalledTimes(1);
  });

  it('affiche les rubriques de la famille sélectionnée, et la règle de calcul en clair', async () => {
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.selectFamily(MonthlyDeclarationFamily.Tcl);
    fixture.detectChanges();

    const body = text();
    expect(body).toContain('F9_TCL');
    expect(body).toContain('crédits de 70…');
    expect(body).toContain('Brut × 0.2 %');
    expect(body).not.toContain('F2_TFP');
  });

  it('change de famille sans laisser traîner le brouillon de la précédente', async () => {
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.startCreate();
    fixture.detectChanges();
    expect(fixture.componentInstance.form()).not.toBeNull();

    fixture.componentInstance.selectFamily(MonthlyDeclarationFamily.Tfp);
    fixture.detectChanges();

    expect(fixture.componentInstance.form()).toBeNull();
    expect(text()).toContain('F2_TFP');
  });

  it('signale une famille incluse sans rubrique active', async () => {
    api.getMonthlyDeclarationConfiguration.and.returnValue(
      of({
        success: true,
        data: configuration({
          families: [{ family: MonthlyDeclarationFamily.HotelTax, isIncluded: true }],
          rubrics: []
        })
      })
    );
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.selectFamily(MonthlyDeclarationFamily.HotelTax);
    fixture.detectChanges();

    expect(text()).toContain('l’enregistrement de la déclaration sera refusé');
  });

  it('dit que la T.V.A reste hors du moteur paramétré', async () => {
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.selectFamily(MonthlyDeclarationFamily.Vat);
    fixture.detectChanges();

    expect(text()).toContain('ne déplacent aucun montant');
  });

  it('explique l’inactivité quand le drapeau serveur est éteint', async () => {
    api.getMonthlyDeclarationConfiguration.and.returnValue(
      of({
        success: true,
        data: configuration({
          settings: { ...configuration().settings, configurableLinesEnabled: false }
        })
      })
    );
    await renderForUser(firmDelegatedUser);

    expect(text()).toContain('Calcul paramétré non activé');
  });

  describe('drapeau serveur éteint, cabinet délégué', () => {
    beforeEach(() => {
      api.getMonthlyDeclarationConfiguration.and.returnValue(
        of({
          success: true,
          data: configuration({
            settings: { ...configuration().settings, configurableLinesEnabled: false }
          })
        })
      );
    });

    it('ne promet pas une modification que le serveur refuserait', async () => {
      await renderForUser(firmDelegatedUser);

      expect(text()).toContain('reste consultable');
      expect(text()).toContain('administrateur de la plateforme');
      expect(text()).not.toContain('reste modifiable');
    });

    it('désactive les écritures et retire la duplication, sans se dire « lecture seule société »', async () => {
      await renderForUser(firmDelegatedUser);

      const create: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('.dm-family__toolbar button');
      const include: HTMLInputElement | null =
        fixture.nativeElement.querySelector('.dm-family__include input');
      expect(fixture.componentInstance.canWrite()).toBe(true);
      expect(fixture.componentInstance.editable()).toBe(false);
      expect(create?.disabled).toBe(true);
      expect(include?.disabled).toBe(true);
      expect(text()).not.toContain('Dupliquer la configuration DM');
      expect(text()).not.toContain('réservée au cabinet comptable');
    });

    it('n’appelle aucune écriture, même sollicitée directement', async () => {
      await renderForUser(firmDelegatedUser);
      const instance = fixture.componentInstance;

      instance.startCreate();
      instance.startEdit(tclRubric);
      instance.saveRubric();
      instance.toggleFamily({ target: { checked: true } } as unknown as Event);
      instance.toggleRubric(tclRubric);
      instance.confirmRemove(tclRubric);
      instance.duplicate({
        sourceCompanyTenantId: '00000000-0000-0000-0000-000000000004',
        overwrite: false
      });

      expect(instance.form()).toBeNull();
      expect(api.createMonthlyDeclarationRubric).not.toHaveBeenCalled();
      expect(api.updateMonthlyDeclarationRubric).not.toHaveBeenCalled();
      expect(api.setMonthlyDeclarationFamily).not.toHaveBeenCalled();
      expect(api.toggleMonthlyDeclarationRubric).not.toHaveBeenCalled();
      expect(confirmation.confirm).not.toHaveBeenCalled();
      expect(api.duplicateMonthlyDeclarationConfig).not.toHaveBeenCalled();
    });
  });

  it('affiche le régime du dossier', async () => {
    await renderForUser(firmDelegatedUser);
    expect(text()).toContain('Calcul historique');
    expect(text()).toContain('ne déplace aucun montant');
  });

  it('société connectée : lecture seule, sans duplication ni écriture', async () => {
    await renderForUser(companyUser);
    const body = text();

    expect(fixture.componentInstance.canWrite()).toBe(false);
    expect(body).toContain('lecture seule');
    expect(body).not.toContain('Dupliquer la configuration DM');
    // La liste des dossiers du cabinet n'est même pas demandée : rien à proposer.
    expect(firmAssignments.getActiveClients).not.toHaveBeenCalled();
  });

  it('cabinet en mode délégué : écriture ouverte et duplication proposée', async () => {
    await renderForUser(firmDelegatedUser);
    const body = text();

    expect(fixture.componentInstance.canWrite()).toBe(true);
    expect(fixture.componentInstance.editable()).toBe(true);
    expect(body).toContain('Nouvelle rubrique');
    expect(body).toContain('Dupliquer la configuration DM');
  });

  it('retire le dossier ouvert de la liste des sources de duplication', async () => {
    await renderForUser(firmDelegatedUser);
    const sources = fixture.componentInstance.duplicateSources();

    expect(sources.map(s => s.companyName)).toEqual(['Ste Voisine']);
  });

  it('enregistre une création puis recharge la configuration', async () => {
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.startCreate();
    const draft = fixture.componentInstance.form()!;
    draft.code = 'F9_NEW';
    draft.label = 'Nouvelle rubrique';
    draft.reportCode = '*';
    draft.ratePercent = 0.2;
    draft.grossAccounts.prefixes = '70';

    fixture.componentInstance.saveRubric();
    fixture.detectChanges();

    expect(api.createMonthlyDeclarationRubric).toHaveBeenCalledTimes(1);
    const payload = api.createMonthlyDeclarationRubric.calls.mostRecent().args[0];
    expect(payload.code).toBe('F9_NEW');
    expect(payload.accounts).toEqual([
      { role: RubricAccountRole.Gross, accountNumber: '70', matchMode: RubricAccountMatchMode.Prefix }
    ]);
    expect(api.getMonthlyDeclarationConfiguration).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.form()).toBeNull();
  });

  it('n’envoie rien quand la fiche est invalide, et le dit', async () => {
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.startCreate();
    const draft = fixture.componentInstance.form()!;
    draft.code = 'CODE INVALIDE';
    draft.label = 'Essai';

    fixture.componentInstance.saveRubric();
    fixture.detectChanges();

    expect(api.createMonthlyDeclarationRubric).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('Le code est invalide');
  });

  it('modifie une rubrique existante par son identifiant', async () => {
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.startEdit(tclRubric);
    fixture.componentInstance.saveRubric();

    expect(api.updateMonthlyDeclarationRubric).toHaveBeenCalledTimes(1);
    expect(api.updateMonthlyDeclarationRubric.calls.mostRecent().args[0]).toBe('rubric-tcl');
    expect(api.createMonthlyDeclarationRubric).not.toHaveBeenCalled();
  });

  it('demande confirmation avant de supprimer une rubrique', async () => {
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.confirmRemove(tclRubric);

    expect(api.deleteMonthlyDeclarationRubric).not.toHaveBeenCalled();
    expect(confirmation.confirm).toHaveBeenCalledTimes(1);

    confirmation.confirm.calls.mostRecent().args[0].accept();
    expect(api.deleteMonthlyDeclarationRubric).toHaveBeenCalledWith('rubric-tcl');
  });

  it('recharge la configuration après un refus serveur sur l’inclusion d’une famille', async () => {
    // Sans ce rechargement, la case resterait cochée alors que le serveur a refusé : l'écran
    // afficherait une inclusion qui n'existe pas.
    api.setMonthlyDeclarationFamily.and.returnValue(of({ success: false, error: 'Refusé' }));
    await renderForUser(firmDelegatedUser);
    const before = api.getMonthlyDeclarationConfiguration.calls.count();

    fixture.componentInstance.toggleFamily({
      target: { checked: true }
    } as unknown as Event);
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toBe('Refusé');
    expect(api.getMonthlyDeclarationConfiguration.calls.count()).toBe(before + 1);
  });

  it('rend compte de la duplication, codes ignorés compris', async () => {
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.duplicate({
      sourceCompanyTenantId: '00000000-0000-0000-0000-000000000004',
      overwrite: false
    });
    fixture.detectChanges();

    const body = text();
    expect(body).toContain('4 rubrique(s) insérée(s), 0 remplacée(s)');
    expect(body).toContain('F9_TCL');
  });

  it('remonte une erreur de chargement en bandeau', async () => {
    api.getMonthlyDeclarationConfiguration.and.returnValue(
      throwError(() => ({ error: { error: 'Base injoignable' } }))
    );
    await renderForUser(firmDelegatedUser);

    expect(text()).toContain('Base injoignable');
  });

  it('reste utilisable quand le plan comptable est indisponible', async () => {
    // Le plan alimente un confort de saisie : son échec ne doit pas masquer la configuration.
    api.getChartOfAccounts.and.returnValue(throwError(() => new Error('boom')));
    await renderForUser(firmDelegatedUser);
    fixture.componentInstance.selectFamily(MonthlyDeclarationFamily.Tcl);
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toBeNull();
    expect(text()).toContain('F9_TCL');
  });
});
