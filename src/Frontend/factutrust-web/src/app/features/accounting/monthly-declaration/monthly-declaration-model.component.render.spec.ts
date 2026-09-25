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
  MonthlyDeclarationMode
} from '../services/accounting.service';
import { MonthlyDeclarationModelComponent } from './monthly-declaration-model.component';
import { summariseModel } from './monthly-declaration-model.view-model';

const MODEL_JSON = JSON.stringify({
  modelVersion: 'dm-model-v1',
  families: [{ family: 'Tfp', isIncluded: true }],
  rubrics: [{ code: 'F2_TFP', family: 'Tfp' }]
});

function configuration(configurableLinesEnabled = true): MonthlyDeclarationConfigurationDto {
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
      configurableLinesEnabled
    },
    families: [],
    rubrics: []
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

describe('MonthlyDeclarationModelComponent render', () => {
  let fixture: ComponentFixture<MonthlyDeclarationModelComponent>;
  let api: {
    getMonthlyDeclarationConfiguration: jasmine.Spy;
    exportMonthlyDeclarationModel: jasmine.Spy;
    importMonthlyDeclarationModel: jasmine.Spy;
  };

  beforeEach(async () => {
    api = {
      getMonthlyDeclarationConfiguration: jasmine
        .createSpy('getMonthlyDeclarationConfiguration')
        .and.returnValue(of({ success: true, data: configuration() })),
      exportMonthlyDeclarationModel: jasmine
        .createSpy('exportMonthlyDeclarationModel')
        .and.returnValue(
          of({ success: true, data: { fileName: 'modele-dm-20260915.json', content: MODEL_JSON } })
        ),
      importMonthlyDeclarationModel: jasmine
        .createSpy('importMonthlyDeclarationModel')
        .and.returnValue(
          of({
            success: true,
            data: {
              inserted: 2,
              replaced: 1,
              skippedCodes: ['F9_TCL'],
              unknownAccounts: ['706100'],
              familiesChanged: 1,
              rejected: []
            }
          })
        )
    };

    await TestBed.configureTestingModule({
      imports: [MonthlyDeclarationModelComponent],
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

    fixture = TestBed.createComponent(MonthlyDeclarationModelComponent);
    setUser(TestBed.inject(AuthService), firmDelegatedUser);
  });

  function text(): string {
    return fixture.nativeElement.textContent as string;
  }

  /** Raccourci : le composant lit le fichier de façon asynchrone, ce que le test n'a pas à refaire. */
  function loadContent(content: string): void {
    fixture.componentInstance.content.set(content);
    fixture.componentInstance.summary.set(summariseModel(content));
    fixture.detectChanges();
  }

  it('n’exporte ni n’importe rien à l’ouverture : l’écran est fait de deux gestes explicites', () => {
    fixture.detectChanges();

    expect(api.exportMonthlyDeclarationModel).not.toHaveBeenCalled();
    expect(api.importMonthlyDeclarationModel).not.toHaveBeenCalled();
    // Seule lecture : l'état de l'interrupteur, sans les rubriques dont l'écran n'a pas l'usage.
    expect(api.getMonthlyDeclarationConfiguration).toHaveBeenCalledOnceWith(false);
  });

  describe('drapeau serveur éteint', () => {
    beforeEach(() => {
      api.getMonthlyDeclarationConfiguration.and.returnValue(
        of({ success: true, data: configuration(false) })
      );
    });

    it('ferme l’import, le dit, et laisse l’export ouvert', () => {
      fixture.detectChanges();

      const fileInput: HTMLInputElement | null =
        fixture.nativeElement.querySelector('#dm-model-file');
      expect(fixture.componentInstance.canImport()).toBe(false);
      expect(fileInput?.disabled).toBe(true);
      expect(text()).toContain('Import indisponible');
      expect(text()).toContain('désactivée sur la plateforme');
    });

    it('n’envoie pas le fichier, même sollicité directement', () => {
      fixture.detectChanges();
      loadContent(MODEL_JSON);

      fixture.componentInstance.importModel();

      expect(api.importMonthlyDeclarationModel).not.toHaveBeenCalled();
    });

    it('laisse l’export fonctionner', () => {
      spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
      spyOn(URL, 'revokeObjectURL');
      fixture.detectChanges();

      fixture.componentInstance.exportModel();

      expect(api.exportMonthlyDeclarationModel).toHaveBeenCalled();
    });
  });

  it('laisse l’import ouvert quand l’état de l’interrupteur ne peut pas être lu', () => {
    // Le serveur reste seul juge : une panne de lecture ne doit pas fermer l'écran.
    api.getMonthlyDeclarationConfiguration.and.returnValue(
      throwError(() => ({ error: { error: 'Service indisponible.' } }))
    );
    fixture.detectChanges();
    loadContent(MODEL_JSON);

    fixture.componentInstance.importModel();

    expect(fixture.componentInstance.linesDisabled()).toBe(false);
    expect(text()).not.toContain('Import indisponible');
    expect(api.importMonthlyDeclarationModel).toHaveBeenCalled();
  });

  it('dit ce que le modèle ne transporte pas', () => {
    fixture.detectChanges();
    expect(text()).toContain('régime de calcul');
    expect(text()).toContain('n’y figurent pas');
  });

  it('télécharge le fichier rendu par le serveur', () => {
    // Seul le `<a>` du téléchargement est capturé : détourner tout `createElement` empêcherait
    // Angular de construire la vue, et le test échouerait pour une raison sans rapport.
    const realCreate = document.createElement.bind(document);
    const anchor = realCreate('a');
    const click = spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.callFake(
      ((tag: string) => (tag === 'a' ? anchor : realCreate(tag))) as typeof document.createElement
    );
    spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
    spyOn(URL, 'revokeObjectURL');

    fixture.detectChanges();
    fixture.componentInstance.exportModel();

    expect(click).toHaveBeenCalled();
    expect(anchor.download).toBe('modele-dm-20260915.json');
  });

  it('remonte le refus du serveur sur un export impossible', () => {
    api.exportMonthlyDeclarationModel.and.returnValue(
      of({ success: false, error: 'Configuration illisible.' })
    );
    fixture.detectChanges();
    fixture.componentInstance.exportModel();
    fixture.detectChanges();

    expect(text()).toContain('Configuration illisible.');
  });

  it('décrit le fichier choisi avant de l’envoyer', () => {
    fixture.detectChanges();
    loadContent(MODEL_JSON);

    expect(text()).toContain('dm-model-v1');
    expect(text()).toContain('T.F.P');
  });

  it('avertit qu’inclure une famille déplace des montants', () => {
    fixture.detectChanges();
    loadContent(MODEL_JSON);

    expect(text()).toContain('change les montants déclarés');
  });

  it('dit qu’un fichier muet sur les familles n’en modifiera aucune', () => {
    fixture.detectChanges();
    loadContent(JSON.stringify({ rubrics: [{ code: 'A' }] }));

    expect(text()).toContain('ne dit rien des familles');
  });

  it('refuse d’importer un fichier que sa propre lecture rejette', () => {
    fixture.detectChanges();
    loadContent('{ pas du json');

    expect(fixture.componentInstance.readyToImport()).toBe(false);
    fixture.componentInstance.importModel();
    expect(api.importMonthlyDeclarationModel).not.toHaveBeenCalled();
  });

  it('transmet le contenu et le choix de remplacement', () => {
    fixture.detectChanges();
    loadContent(MODEL_JSON);
    fixture.componentInstance.overwrite = true;

    fixture.componentInstance.importModel();

    expect(api.importMonthlyDeclarationModel).toHaveBeenCalledWith({
      content: MODEL_JSON,
      overwrite: true
    });
  });

  it('rend le compte rendu, les codes ignorés et les comptes inconnus', () => {
    fixture.detectChanges();
    loadContent(MODEL_JSON);
    fixture.componentInstance.importModel();
    fixture.detectChanges();

    expect(text()).toContain('2 rubrique(s) insérée(s), 1 remplacée(s)');
    expect(text()).toContain('F9_TCL');
    expect(text()).toContain('706100');
  });

  it('explique un import qui n’a rien changé plutôt que de le taire', () => {
    api.importMonthlyDeclarationModel.and.returnValue(
      of({
        success: true,
        data: {
          inserted: 0,
          replaced: 0,
          skippedCodes: ['F2_TFP'],
          unknownAccounts: [],
          familiesChanged: 0,
          rejected: []
        }
      })
    );
    fixture.detectChanges();
    loadContent(MODEL_JSON);
    fixture.componentInstance.importModel();
    fixture.detectChanges();

    expect(text()).toContain('n’a rien ajouté');
    expect(text()).toContain('Remplacer');
  });

  it('affiche le refus détaillé du serveur sur un fichier rejeté', () => {
    api.importMonthlyDeclarationModel.and.returnValue(
      of({ success: false, error: "1 entrée(s) du fichier sont refusées ; rien n'a été importé. [F1_1] Famille inconnue." })
    );
    fixture.detectChanges();
    loadContent(MODEL_JSON);
    fixture.componentInstance.importModel();
    fixture.detectChanges();

    expect(text()).toContain('[F1_1] Famille inconnue.');
    expect(fixture.componentInstance.result()).toBeNull();
  });

  it('remonte le message du serveur sur une erreur réseau', () => {
    api.importMonthlyDeclarationModel.and.returnValue(
      throwError(() => ({ error: { error: 'Contexte cabinet requis.' } }))
    );
    fixture.detectChanges();
    loadContent(MODEL_JSON);
    fixture.componentInstance.importModel();
    fixture.detectChanges();

    expect(text()).toContain('Contexte cabinet requis.');
  });

  describe('verrou société', () => {
    beforeEach(() => setUser(TestBed.inject(AuthService), companyUser));

    it('ferme l’import et le dit, en laissant l’export ouvert', () => {
      fixture.detectChanges();

      expect(fixture.componentInstance.canWrite()).toBe(false);
      expect(text()).toContain('Import réservé au cabinet comptable');
      expect(text()).toContain('L’export reste disponible.');
    });

    it('n’interroge pas l’interrupteur : la société n’importe pas, quel que soit son état', () => {
      fixture.detectChanges();

      expect(api.getMonthlyDeclarationConfiguration).not.toHaveBeenCalled();
    });

    it('laisse l’export fonctionner', () => {
      spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
      spyOn(URL, 'revokeObjectURL');
      fixture.detectChanges();

      fixture.componentInstance.exportModel();

      expect(api.exportMonthlyDeclarationModel).toHaveBeenCalled();
    });
  });
});
