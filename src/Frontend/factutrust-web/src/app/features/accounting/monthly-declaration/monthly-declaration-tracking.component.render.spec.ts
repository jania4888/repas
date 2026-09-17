import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import {
  AccountingService,
  MonthlyDeclarationMode,
  MonthlyDeclarationSettingsDto,
  MonthlyDeclarationTrackingDto,
  MonthlyDeclarationTrackingRowDto,
  VatDeclarationStatus
} from '../services/accounting.service';
import { MonthlyDeclarationTrackingComponent } from './monthly-declaration-tracking.component';

function row(over: Partial<MonthlyDeclarationTrackingRowDto> = {}): MonthlyDeclarationTrackingRowDto {
  return {
    month: 1,
    exists: false,
    status: VatDeclarationStatus.Draft,
    submittedAt: null,
    updatedAt: null,
    totalToPay: 0,
    vatDue: 0,
    revisionNumber: 1,
    isRectificative: false,
    filingDeadline: '2026-02-22T00:00:00Z',
    mode: MonthlyDeclarationMode.Legacy,
    ...over
  };
}

function settings(over: Partial<MonthlyDeclarationSettingsDto> = {}): MonthlyDeclarationSettingsDto {
  return {
    mode: MonthlyDeclarationMode.Legacy,
    configuredSince: null,
    lastParityRunAt: null,
    lastParityMaxGapMillimes: 0,
    parityCleanStreak: 0,
    requiredCleanParityPeriods: 3,
    canSwitchToConfigured: false,
    parityOverrideBy: null,
    parityOverrideReason: null,
    configurableLinesEnabled: true,
    ...over
  };
}

function tracking(over: Partial<MonthlyDeclarationTrackingDto> = {}): MonthlyDeclarationTrackingDto {
  return {
    year: 2026,
    settings: settings(),
    months: Array.from({ length: 12 }, (_, i) =>
      row({ month: i + 1, filingDeadline: `2026-${String(i + 2).padStart(2, '0')}-22T00:00:00Z` })
    ),
    ...over
  };
}

describe('MonthlyDeclarationTrackingComponent render', () => {
  let fixture: ComponentFixture<MonthlyDeclarationTrackingComponent>;
  let api: { getMonthlyDeclarationTracking: jasmine.Spy };

  beforeEach(async () => {
    api = {
      getMonthlyDeclarationTracking: jasmine
        .createSpy('getMonthlyDeclarationTracking')
        .and.returnValue(of({ success: true, data: tracking() }))
    };

    await TestBed.configureTestingModule({
      imports: [MonthlyDeclarationTrackingComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AccountingService, useValue: api },
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

    fixture = TestBed.createComponent(MonthlyDeclarationTrackingComponent);
  });

  function text(): string {
    return fixture.nativeElement.textContent as string;
  }

  it('charge l’exercice du mois écoulé à l’ouverture', () => {
    fixture.detectChanges();

    const today = new Date();
    const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    expect(api.getMonthlyDeclarationTracking).toHaveBeenCalledWith(previousMonth.getFullYear());
  });

  it('affiche les douze mois, y compris ceux sans dépôt', () => {
    fixture.detectChanges();

    expect(text()).toContain('Janvier 2026');
    expect(text()).toContain('Décembre 2026');
  });

  it('distingue déposée, brouillon et retard', () => {
    api.getMonthlyDeclarationTracking.and.returnValue(
      of({
        success: true,
        data: tracking({
          months: [
            row({ month: 1, exists: true, status: VatDeclarationStatus.Submitted, totalToPay: 100 }),
            row({ month: 2, exists: true, status: VatDeclarationStatus.Draft }),
            row({ month: 3, filingDeadline: '2000-04-22T00:00:00Z' })
          ]
        })
      })
    );
    fixture.detectChanges();

    expect(text()).toContain('Déposée');
    expect(text()).toContain('Brouillon');
    expect(text()).toContain('En retard');
    expect(text()).toContain('jamais déposé');
  });

  it('chiffre la synthèse et ne cumule que les périodes déposées', () => {
    api.getMonthlyDeclarationTracking.and.returnValue(
      of({
        success: true,
        data: tracking({
          months: [
            row({ month: 1, exists: true, status: VatDeclarationStatus.Submitted, totalToPay: 100.5 }),
            row({ month: 2, exists: true, status: VatDeclarationStatus.Draft, totalToPay: 999 })
          ]
        })
      })
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.summary().filed).toBe(1);
    expect(fixture.componentInstance.summary().drafts).toBe(1);
    expect(fixture.componentInstance.summary().totalToPay).toBe(100.5);
    // Séparateur décimal laissé libre : la locale `fr-TN` est fournie par la configuration de
    // l'application, pas par le composant, et l'épingler ici testerait le banc plutôt que l'écran.
    expect(text()).toMatch(/100[.,]500/);
  });

  it('dit combien de mois le moteur calcule réellement', () => {
    api.getMonthlyDeclarationTracking.and.returnValue(
      of({
        success: true,
        data: tracking({
          months: [
            row({ month: 1, mode: MonthlyDeclarationMode.Legacy }),
            row({ month: 2, mode: MonthlyDeclarationMode.Configured })
          ]
        })
      })
    );
    fixture.detectChanges();

    expect(text()).toContain('1 mois de 2026 sur 12');
  });

  it('affiche le régime période par période, pas celui du dossier', () => {
    api.getMonthlyDeclarationTracking.and.returnValue(
      of({
        success: true,
        data: tracking({
          settings: settings({
            mode: MonthlyDeclarationMode.Configured,
            configuredSince: '2026-07-01T00:00:00Z'
          }),
          months: [
            row({ month: 6, mode: MonthlyDeclarationMode.Legacy }),
            row({ month: 7, mode: MonthlyDeclarationMode.Configured })
          ]
        })
      })
    );
    fixture.detectChanges();

    expect(text()).toContain('Calcul historique');
    expect(text()).toContain('Calcul paramétré');
  });

  it('explique l’inactivité du drapeau au lieu d’afficher une erreur', () => {
    api.getMonthlyDeclarationTracking.and.returnValue(
      of({
        success: true,
        data: tracking({ settings: settings({ configurableLinesEnabled: false }) })
      })
    );
    fixture.detectChanges();

    expect(text()).toContain('Calcul paramétré non activé');
    expect(text()).toContain('suivi des dépôts reste exact');
    expect(fixture.componentInstance.error()).toBeNull();
  });

  it('recharge sur changement d’exercice', () => {
    fixture.detectChanges();
    api.getMonthlyDeclarationTracking.calls.reset();

    fixture.componentInstance.year = 2025;
    fixture.componentInstance.load();

    expect(api.getMonthlyDeclarationTracking).toHaveBeenCalledWith(2025);
  });

  it('n’appelle pas le serveur pour un exercice hors bornes', () => {
    fixture.detectChanges();
    api.getMonthlyDeclarationTracking.calls.reset();

    fixture.componentInstance.year = 1999;
    fixture.componentInstance.load();

    expect(api.getMonthlyDeclarationTracking).not.toHaveBeenCalled();
  });

  it('remonte le refus du serveur', () => {
    api.getMonthlyDeclarationTracking.and.returnValue(
      of({ success: false, error: 'Exercice invalide.' })
    );
    fixture.detectChanges();

    expect(text()).toContain('Exercice invalide.');
    expect(fixture.componentInstance.tracking()).toBeNull();
  });

  it('remonte le message du serveur sur une erreur réseau', () => {
    api.getMonthlyDeclarationTracking.and.returnValue(
      throwError(() => ({ error: { error: 'Contexte entreprise invalide.' } }))
    );
    fixture.detectChanges();

    expect(text()).toContain('Contexte entreprise invalide.');
  });

  it('n’offre aucune action d’écriture : le suivi est en lecture seule', () => {
    fixture.detectChanges();

    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('button')
    );
    const labels = buttons.map(b => (b.textContent ?? '').trim());
    expect(labels.some(l => /Actualiser|Chargement/.test(l))).toBe(true);
    expect(labels.some(l => /Enregistrer|Importer|Appliquer|Calculer/.test(l))).toBe(false);
  });
});
