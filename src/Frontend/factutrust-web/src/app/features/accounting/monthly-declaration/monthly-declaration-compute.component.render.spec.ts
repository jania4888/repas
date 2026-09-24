import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService, User } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ToastService } from '@core/services/toast.service';
import {
  AccountingService,
  MonthlyDeclarationConfigurationDto,
  MonthlyDeclarationFamily,
  MonthlyDeclarationLineDto,
  MonthlyDeclarationMode,
  MonthlyDeclarationSettingsDto,
  RubricDiagnosticKind,
  VatDeclarationDto
} from '../services/accounting.service';
import { MonthlyDeclarationComputeComponent } from './monthly-declaration-compute.component';

function settings(over: Partial<MonthlyDeclarationSettingsDto> = {}): MonthlyDeclarationSettingsDto {
  return {
    mode: MonthlyDeclarationMode.Parity,
    configuredSince: null,
    lastParityRunAt: '2026-09-01T08:00:00Z',
    lastParityMaxGapMillimes: 0,
    parityCleanStreak: 1,
    requiredCleanParityPeriods: 3,
    canSwitchToConfigured: false,
    parityOverrideBy: null,
    parityOverrideReason: null,
    configurableLinesEnabled: true,
    ...over
  };
}

function configuration(
  over: Partial<MonthlyDeclarationSettingsDto> = {}
): MonthlyDeclarationConfigurationDto {
  return { settings: settings(over), families: [], rubrics: [] };
}

function line(over: Partial<MonthlyDeclarationLineDto> = {}): MonthlyDeclarationLineDto {
  return {
    rubricId: 'r1',
    code: 'F9_TCL',
    label: 'T.C.L sur chiffre d’affaires',
    family: MonthlyDeclarationFamily.Tcl,
    reportCode: '*',
    gross: 100000,
    withheld: 200,
    ratePercentApplied: 0.2,
    requiresManualInput: false,
    diagnostics: [],
    ...over
  };
}

function declaration(over: Partial<VatDeclarationDto> = {}): VatDeclarationDto {
  return {
    year: 2026,
    month: 8,
    collectedVat19: 0,
    collectedVat13: 0,
    collectedVat7: 0,
    deductibleVatGoods: 0,
    deductibleVatAssets: 0,
    previousCredit: 0,
    vatDue: 0,
    creditToCarry: 0,
    currency: 'TND',
    status: 0,
    fodec: 0,
    droitTimbre: 0,
    tcl: 200,
    tfp: 0,
    foprolos: 0,
    withholdingTax: 0,
    acomptes: 0,
    totalToPay: 200,
    version: 1,
    isRectificative: false,
    monthlyDeclarationV2Enabled: true,
    filingDeadline: '2026-09-28T00:00:00Z',
    declarationTypeDisplay: 'Mensuelle',
    collectedVatBreakdown: [],
    deductiblePurchasesTaxableBase: 0,
    salesTaxableBase: 0,
    salesGrossBase: 0,
    monthlyDeclarationMode: MonthlyDeclarationMode.Parity,
    parityMaxGapMillimes: 0,
    lines: [line()],
    monthlyDeclarationDiagnostics: [],
    ...over
  } as VatDeclarationDto;
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

describe('MonthlyDeclarationComputeComponent render', () => {
  let fixture: ComponentFixture<MonthlyDeclarationComputeComponent>;
  let api: {
    getMonthlyDeclarationConfiguration: jasmine.Spy;
    computeMonthlyDeclaration: jasmine.Spy;
    setMonthlyDeclarationMode: jasmine.Spy;
  };

  beforeEach(async () => {
    api = {
      getMonthlyDeclarationConfiguration: jasmine
        .createSpy('getMonthlyDeclarationConfiguration')
        .and.returnValue(of({ success: true, data: configuration() })),
      computeMonthlyDeclaration: jasmine
        .createSpy('computeMonthlyDeclaration')
        .and.returnValue(of({ success: true, data: declaration() })),
      setMonthlyDeclarationMode: jasmine
        .createSpy('setMonthlyDeclarationMode')
        .and.returnValue(of({ success: true, data: true }))
    };

    await TestBed.configureTestingModule({
      imports: [MonthlyDeclarationComputeComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AccountingService, useValue: api },
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

    fixture = TestBed.createComponent(MonthlyDeclarationComputeComponent);
    setUser(TestBed.inject(AuthService), firmDelegatedUser);
  });

  function text(): string {
    return fixture.nativeElement.textContent as string;
  }

  it('ouvre sur la période écoulée et ne calcule rien de lui-même', () => {
    fixture.detectChanges();

    const today = new Date();
    const expected = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    expect(fixture.componentInstance.year).toBe(expected.getFullYear());
    expect(fixture.componentInstance.month).toBe(expected.getMonth() + 1);
    expect(api.computeMonthlyDeclaration).not.toHaveBeenCalled();
  });

  it('ne lit que les réglages, sans charger les rubriques dont il n’a pas l’usage', () => {
    fixture.detectChanges();
    expect(api.getMonthlyDeclarationConfiguration).toHaveBeenCalledWith(false);
  });

  it('affiche le détail par famille et le rapprochement avec la déclaration', () => {
    fixture.detectChanges();
    fixture.componentInstance.compute();
    fixture.detectChanges();

    expect(text()).toContain('T.C.L');
    expect(text()).toContain('F9_TCL');
    expect(text()).toContain('Identique au montant de la déclaration.');
  });

  it("nomme le régime qui a produit les montants de la période", () => {
    fixture.detectChanges();
    fixture.componentInstance.compute();
    fixture.detectChanges();

    expect(text()).toContain('Contrôle de parité');
    expect(text()).toContain('sans écart');
  });

  it('signale l’écart de parité en clair plutôt que de le laisser deviner', () => {
    api.computeMonthlyDeclaration.and.returnValue(
      of({
        success: true,
        data: declaration({ tcl: 199, parityMaxGapMillimes: 1000 })
      })
    );
    fixture.detectChanges();
    fixture.componentInstance.compute();
    fixture.detectChanges();

    expect(text()).toContain('1,000 DT');
    expect(text()).toContain('restent ceux du calcul historique');
  });

  it('traduit les signalements du moteur en phrases', () => {
    api.computeMonthlyDeclaration.and.returnValue(
      of({
        success: true,
        data: declaration({
          monthlyDeclarationDiagnostics: [
            { kind: RubricDiagnosticKind.UnknownAccount, detail: '706100' },
            { kind: RubricDiagnosticKind.UnknownAccount, detail: '706100' },
            { kind: RubricDiagnosticKind.PayrollRunNotUsable, detail: null }
          ]
        })
      })
    );
    fixture.detectChanges();
    fixture.componentInstance.compute();
    fixture.detectChanges();

    expect(text()).toContain('706100');
    expect(text()).toContain('ni validé ni clôturé');
    // Dédoublonné : le même compte inconnu ne se répète pas.
    expect(text()).toContain('1 erreur(s), 1 avertissement(s)');
  });

  it('relit les réglages après un calcul, la série de parité ayant pu avancer', () => {
    fixture.detectChanges();
    api.getMonthlyDeclarationConfiguration.calls.reset();

    fixture.componentInstance.compute();
    fixture.detectChanges();

    expect(api.getMonthlyDeclarationConfiguration).toHaveBeenCalled();
  });

  it('laisse le refus visible quand la relecture qui le suit réussit', () => {
    api.computeMonthlyDeclaration.and.returnValue(
      of({ success: false, error: 'Exercice invalide.' })
    );
    fixture.detectChanges();
    fixture.componentInstance.compute();
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toBe('Exercice invalide.');
    expect(text()).toContain('Exercice invalide.');
  });

  it('remonte le message du serveur sur une erreur réseau', () => {
    api.computeMonthlyDeclaration.and.returnValue(
      throwError(() => ({ error: { error: 'Contexte cabinet requis.' } }))
    );
    fixture.detectChanges();
    fixture.componentInstance.compute();
    fixture.detectChanges();

    expect(text()).toContain('Contexte cabinet requis.');
  });

  it('refuse de calculer une période hors bornes sans appeler le serveur', () => {
    fixture.detectChanges();
    fixture.componentInstance.month = 13;
    fixture.componentInstance.compute();

    expect(api.computeMonthlyDeclaration).not.toHaveBeenCalled();
  });

  describe('régime de calcul', () => {
    it('chiffre la rampe plutôt que d’annoncer un verdict', () => {
      fixture.detectChanges();
      expect(text()).toContain('1 sur 3');
      expect(text()).toContain('Encore 2');
    });

    it('n’offre le motif de dérogation que lorsqu’il est exigé', () => {
      fixture.detectChanges();
      fixture.componentInstance.modeForm.set({
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: null
      });
      fixture.detectChanges();
      expect(text()).toContain('Motif de dérogation');

      fixture.componentInstance.settings.set(
        settings({ parityCleanStreak: 3, canSwitchToConfigured: true })
      );
      fixture.detectChanges();
      expect(text()).not.toContain('Motif de dérogation');
    });

    it('envoie la demande et relit les réglages', () => {
      fixture.detectChanges();
      fixture.componentInstance.modeForm.set({
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: 'Validé par l’associé.'
      });
      api.getMonthlyDeclarationConfiguration.calls.reset();

      fixture.componentInstance.applyMode();
      fixture.detectChanges();

      expect(api.setMonthlyDeclarationMode).toHaveBeenCalledWith({
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: 'Validé par l’associé.'
      });
      expect(api.getMonthlyDeclarationConfiguration).toHaveBeenCalled();
    });

    it('bloque une demande que ses propres règles refusent, sans appeler le serveur', () => {
      fixture.detectChanges();
      fixture.componentInstance.settings.set(settings({ mode: MonthlyDeclarationMode.Legacy }));
      fixture.componentInstance.modeForm.set({
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: null
      });

      fixture.componentInstance.applyMode();

      expect(api.setMonthlyDeclarationMode).not.toHaveBeenCalled();
      expect(fixture.componentInstance.error()).toContain('contrôle de parité');
    });

    it('laisse visible le refus du serveur malgré la relecture qui le suit', () => {
      api.setMonthlyDeclarationMode.and.returnValue(
        of({ success: false, error: 'Série de contrôles insuffisante.' })
      );
      fixture.detectChanges();
      fixture.componentInstance.modeForm.set({
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: 'Motif.'
      });

      fixture.componentInstance.applyMode();
      fixture.detectChanges();

      expect(fixture.componentInstance.error()).toBe('Série de contrôles insuffisante.');
      expect(text()).toContain('Série de contrôles insuffisante.');
    });
  });

  describe('verrou société', () => {
    beforeEach(() => setUser(TestBed.inject(AuthService), companyUser));

    it('passe en lecture seule et dit pourquoi', () => {
      fixture.detectChanges();
      expect(fixture.componentInstance.canWrite()).toBe(false);
      expect(text()).toContain('réservé au cabinet comptable');
    });

    it('ne calcule pas, le calcul étant une écriture côté serveur', () => {
      fixture.detectChanges();
      const button: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('.dm-period button');
      expect(button?.disabled).toBe(true);
    });
  });

  describe('drapeau serveur éteint', () => {
    beforeEach(() => {
      api.getMonthlyDeclarationConfiguration.and.returnValue(
        of({ success: true, data: configuration({ configurableLinesEnabled: false }) })
      );
    });

    it('explique l’inactivité au lieu d’afficher une erreur', () => {
      fixture.detectChanges();

      expect(text()).toContain('Calcul paramétré non activé');
      expect(fixture.componentInstance.error()).toBeNull();
    });

    it('dit que l’interrupteur est celui de la plateforme, pas celui du dossier', () => {
      fixture.detectChanges();

      expect(text()).toContain('pour tous les dossiers');
      expect(text()).toContain('administrateur de la plateforme');
      expect(text()).not.toContain('pour ce dossier');
    });

    it('ne propose ni le calcul ni le changement de régime, voués au refus', () => {
      fixture.detectChanges();

      const compute: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('.dm-period button');
      const apply: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('.dm-mode__form .dm-actions button');
      expect(fixture.componentInstance.canCompute()).toBe(false);
      expect(compute?.disabled).toBe(true);
      expect(apply?.disabled).toBe(true);
    });

    it('n’appelle pas le serveur, même sollicité directement', () => {
      fixture.detectChanges();
      fixture.componentInstance.modeForm.set({
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: 'Motif.'
      });

      fixture.componentInstance.compute();
      fixture.componentInstance.applyMode();

      expect(api.computeMonthlyDeclaration).not.toHaveBeenCalled();
      expect(api.setMonthlyDeclarationMode).not.toHaveBeenCalled();
      expect(fixture.componentInstance.error()).toBeNull();
    });
  });

  describe('réglages indisponibles', () => {
    it('ne propose pas le calcul tant que l’état de l’interrupteur est inconnu', () => {
      api.getMonthlyDeclarationConfiguration.and.returnValue(
        throwError(() => ({ error: { error: 'Service indisponible.' } }))
      );
      fixture.detectChanges();

      fixture.componentInstance.compute();

      expect(fixture.componentInstance.canCompute()).toBe(false);
      expect(api.computeMonthlyDeclaration).not.toHaveBeenCalled();
      expect(text()).toContain('Service indisponible.');
    });
  });
});
