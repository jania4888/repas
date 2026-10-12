/// <reference types="@angular/localize" />
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { LetteringComponent } from './lettering.component';
import { AccountingService } from '../services/accounting.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AiScreenAnalysisService } from '@features/ai-assistant/services/ai-screen-analysis.service';
import { PERMISSIONS } from '@core/config/permission-keys';

/**
 * Écran legacy de lettrage — PR1 (plan de refonte §5.4/§5.5) :
 * distinction P/L pour la sélection, bouton « Compléter le lettrage » (D7) et gestion des codes
 * d'erreur stables (§4.6) pour letter/complete/unletter/settle.
 */
describe('LetteringComponent (legacy — Compléter + codes d\'erreur)', () => {
  let fixture: ComponentFixture<LetteringComponent>;
  let component: LetteringComponent;
  let accounting: {
    getChartOfAccounts: jasmine.Spy;
    getJournal: jasmine.Spy;
    letterEntries: jasmine.Spy;
    completePartialLettering: jasmine.Spy;
    unletterEntries: jasmine.Spy;
    settleExchangeDifference: jasmine.Spy;
  };
  let hasPermission: jasmine.Spy;

  /** Miroir structurel de l'interface (non exportée) LetteringLine du composant. */
  interface TestLine {
    lineId: string;
    entryDate: string;
    journalCode: string;
    entryNumber: number;
    accountNumber: string;
    label: string;
    debit: number;
    credit: number;
    currency: string;
    debitInCurrency: number;
    creditInCurrency: number;
    letteringCode?: string | null;
  }

  const makeLine = (overrides: Partial<TestLine>): TestLine => ({
    lineId: 'l-' + Math.random().toString(36).slice(2, 10),
    entryDate: '2026-01-15',
    journalCode: 'ACH',
    entryNumber: 1,
    accountNumber: '4111',
    label: 'Écriture',
    debit: 0,
    credit: 0,
    currency: 'TND',
    debitInCurrency: 0,
    creditInCurrency: 0,
    letteringCode: null,
    ...overrides
  });

  const unlettered = (id: string, debit = 0, credit = 0): TestLine =>
    makeLine({ lineId: id, debit, credit });
  const partialLine = (id: string, code: string, debit = 0, credit = 0): TestLine =>
    makeLine({ lineId: id, debit, credit, letteringCode: code });
  const letteredLine = (id: string, code: string, debit = 0, credit = 0): TestLine =>
    makeLine({ lineId: id, debit, credit, letteringCode: code });

  beforeEach(async () => {
    accounting = {
      getChartOfAccounts: jasmine.createSpy('getChartOfAccounts').and.returnValue(of({ success: true, data: [] })),
      getJournal: jasmine.createSpy('getJournal').and.returnValue(of({ success: true, data: [] })),
      letterEntries: jasmine.createSpy('letterEntries').and.returnValue(of({
        success: true,
        data: { code: 'L00001', groupId: 'g1', isPartial: false, lineCount: 2 }
      })),
      completePartialLettering: jasmine.createSpy('completePartialLettering').and.returnValue(of({
        success: true,
        data: { code: 'L00002', groupId: 'g1', isPartial: false, lineCount: 3, previousCode: 'P00001' }
      })),
      unletterEntries: jasmine.createSpy('unletterEntries').and.returnValue(of({ success: true, data: true })),
      settleExchangeDifference: jasmine.createSpy('settleExchangeDifference').and.returnValue(of({ success: true, data: 'ok' }))
    };
    hasPermission = jasmine.createSpy('hasPermission').and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [LetteringComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AccountingService, useValue: accounting },
        {
          provide: AuthService,
          useValue: {
            hasPermission,
            hasAllPermissions: () => true,
            isAccountingFirm: () => false,
            isDelegatedMode: () => false,
            user: signal(null)
          }
        },
        { provide: ConfirmationService, useValue: { confirm: jasmine.createSpy('confirm') } },
        { provide: AiScreenAnalysisService, useValue: { startAnalysis: jasmine.createSpy('startAnalysis') } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LetteringComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('isRowSelectable : non lettrée et « P » sélectionnables, « L » non sélectionnable', () => {
    expect(component.isRowSelectable(unlettered('u1'))).toBeTrue();
    expect(component.isRowSelectable(partialLine('p1', 'P00001'))).toBeTrue();
    expect(component.isRowSelectable(letteredLine('f1', 'L00001'))).toBeFalse();
    // La donnée passée à [rowSelectable] du p-table applique la même règle.
    expect(component.isSelectableRow({ data: letteredLine('f2', 'L00002') })).toBeFalse();
    expect(component.isSelectableRow({ data: partialLine('p2', 'P00002') })).toBeTrue();
  });

  it('cache le bouton Délettrer sans la permission accounting:unletter', () => {
    hasPermission.and.callFake((p: string) => p !== PERMISSIONS.accounting.unletter);
    component.lines.set([letteredLine('f1', 'L00001')]);
    fixture.detectChanges();
    expect(component.canUnletter()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.lettering-unletter-btn')).toBeNull();

    hasPermission.and.returnValue(true);
    fixture.detectChanges();
    expect(component.canUnletter()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.lettering-unletter-btn')).not.toBeNull();
  });

  it('« Compléter le lettrage Pxxxxx » n\'envoie QUE les ids non lettrés', () => {
    component.selectedLines.set([
      partialLine('p1', 'P00001', 100, 0),
      partialLine('p2', 'P00001', 50, 0),
      unlettered('u1', 0, 150)
    ]);
    fixture.detectChanges();

    expect(component.isCompletionSelection()).toBeTrue();
    expect(component.canLetter()).toBeFalse();
    expect(component.canComplete()).toBeTrue();

    const btn = fixture.nativeElement.querySelector('.lettering-complete-group button');
    expect(btn).not.toBeNull();
    expect((btn.textContent ?? '').trim()).toContain('Compléter le lettrage P00001');

    spyOn(component, 'load');
    component.completeSelected();

    expect(accounting.completePartialLettering).toHaveBeenCalledTimes(1);
    const args = accounting.completePartialLettering.calls.mostRecent().args;
    expect(args[0]).toBe('P00001');
    expect(args[1]).toEqual(['u1']); // seules les lignes non lettrées
    expect(args[2]).toBeFalse();
    expect(component.selectedLines().length).toBe(0);
    expect(component.load).toHaveBeenCalled();
  });

  it('deux groupes « P » distincts dans la sélection : Compléter désactivé avec explication', () => {
    component.selectedLines.set([
      partialLine('p1', 'P00001', 100, 0),
      partialLine('p2', 'P00002', 50, 0),
      unlettered('u1', 0, 150)
    ]);
    fixture.detectChanges();

    expect(component.canComplete()).toBeFalse();
    expect(component.completionBlockedReason()).toContain('un seul groupe partiel');

    const btn = fixture.nativeElement.querySelector('.lettering-complete-group button');
    expect(btn?.disabled).toBeTrue();
  });

  it('groupe « P » sans aucune ligne non lettrée : Compléter désactivé avec explication', () => {
    component.selectedLines.set([partialLine('p1', 'P00001', 100, 0)]);
    fixture.detectChanges();

    expect(component.canComplete()).toBeFalse();
    expect(component.completionBlockedReason()).toContain('au moins une ligne non lettrée');
  });

  it('LETTERING_PERIOD_LOCKED : message clair, sélection conservée, pas de rechargement', () => {
    accounting.letterEntries.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 409,
      error: { success: false, code: 'LETTERING_PERIOD_LOCKED', message: 'Période clôturée', error: 'Période clôturée' }
    })));
    component.selectedLines.set([unlettered('u1', 100, 0), unlettered('u2', 0, 100)]);
    spyOn(component, 'load');

    component.letterSelected();

    expect(component.error()).toContain('période ou un exercice clôturé');
    expect(component.selectedLines().length).toBe(2);
    expect(component.load).not.toHaveBeenCalled();
  });

  it('LETTERING_ALREADY_LETTERED : message serveur, sélection vidée, rechargement', () => {
    accounting.letterEntries.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 409,
      error: { success: false, code: 'LETTERING_ALREADY_LETTERED', message: 'Déjà lettré', error: 'Déjà lettré' }
    })));
    component.selectedLines.set([unlettered('u1', 100, 0), unlettered('u2', 0, 100)]);
    spyOn(component, 'load');

    component.letterSelected();

    expect(component.error()).toBe('Déjà lettré');
    expect(component.selectedLines().length).toBe(0);
    expect(component.load).toHaveBeenCalled();
  });

  it('HTTP 403 : « Droit insuffisant », pas de rechargement', () => {
    accounting.completePartialLettering.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 403,
      error: { success: false, message: 'Forbidden' }
    })));
    component.selectedLines.set([partialLine('p1', 'P00001', 100, 0), unlettered('u1', 0, 100)]);
    spyOn(component, 'load');

    component.completeSelected();

    expect(component.error()).toBe('Droit insuffisant pour effectuer cette action.');
    expect(component.load).not.toHaveBeenCalled();
  });

  it('autre code d\'erreur : message serveur conservé, pas de rechargement', () => {
    accounting.unletterEntries.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 400,
      error: { success: false, code: 'LETTERING_UNBALANCED', message: 'Groupe non équilibré', error: 'Groupe non équilibré' }
    })));
    const confirm = TestBed.inject(ConfirmationService).confirm as jasmine.Spy;
    confirm.and.callFake((c: { accept?: () => void }) => c.accept?.());
    spyOn(component, 'load');

    component.unletter('P00001');

    expect(component.error()).toBe('Groupe non équilibré');
    expect(component.load).not.toHaveBeenCalled();
  });
});
