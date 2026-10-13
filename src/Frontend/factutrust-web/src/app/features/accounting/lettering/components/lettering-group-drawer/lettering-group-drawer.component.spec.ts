import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ErpLocaleService } from '@core/i18n/erp-locale.service';
import { LetteringGroup, LetteringLine } from '../../models/lettering.models';
import { LetteringGroupDrawerComponent } from './lettering-group-drawer.component';

function line(overrides: Partial<LetteringLine>): LetteringLine {
  return {
    lineId: 'l1', entryId: 'e1', entryDate: '2026-01-01', journalCode: 'JOD', entryNumber: 1,
    accountNumber: '4111', label: 'Ligne', pieceRef: null, documentType: null,
    thirdPartyId: null, thirdPartyKind: null, thirdPartyName: null,
    debit: 0, credit: 0, currency: 'TND', debitInCurrency: 0, creditInCurrency: 0,
    letteringCode: 'L00001', isPartiallyLettered: false,
    isDraft: false, isReversed: false, isReversal: false, periodLocked: false,
    ...overrides
  };
}

function group(overrides: Partial<LetteringGroup>): LetteringGroup {
  return {
    code: 'L00001',
    accountNumber: '4111',
    amount: 1000,
    currency: 'TND',
    isPartial: false,
    letteredAt: '2026-01-01T00:00:00Z',
    createdByDisplayName: null,
    lines: [],
    canUnletter: true,
    unletterBlockedReason: null,
    canComplete: false,
    ...overrides
  };
}

describe('LetteringGroupDrawerComponent', () => {
  let component: LetteringGroupDrawerComponent;
  let fixture: ComponentFixture<LetteringGroupDrawerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LetteringGroupDrawerComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()]
    });
    fixture = TestBed.createComponent(LetteringGroupDrawerComponent);
    component = fixture.componentInstance;
  });

  describe('canUnletterGroup', () => {
    it('refuse si aucun groupe chargé', () => {
      component.group = null;
      component.canUnletterPermission = true;
      expect(component.canUnletterGroup()).toBe(false);
    });

    it('refuse si le groupe interdit le délettrage (ex. période clôturée)', () => {
      component.group = group({ canUnletter: false });
      component.canUnletterPermission = true;
      expect(component.canUnletterGroup()).toBe(false);
    });

    it("refuse si l'utilisateur n'a pas la permission accounting:unletter", () => {
      component.group = group({ canUnletter: true });
      component.canUnletterPermission = false;
      expect(component.canUnletterGroup()).toBe(false);
    });

    it('autorise seulement quand le groupe le permet ET la permission est accordée', () => {
      component.group = group({ canUnletter: true });
      component.canUnletterPermission = true;
      expect(component.canUnletterGroup()).toBe(true);
    });
  });

  describe('blockedReasonLabel', () => {
    it('texte vide si aucune raison', () => {
      component.group = group({ unletterBlockedReason: null });
      expect(component.blockedReasonLabel()).toBe('');
    });

    it('message distinct par motif de blocage (permission vs période verrouillée)', () => {
      component.group = group({ unletterBlockedReason: 'permission' });
      const permissionMsg = component.blockedReasonLabel();
      component.group = group({ unletterBlockedReason: 'period_locked' });
      const lockedMsg = component.blockedReasonLabel();
      expect(permissionMsg).not.toBe('');
      expect(lockedMsg).not.toBe('');
      expect(permissionMsg).not.toBe(lockedMsg);
    });

    it('texte vide si aucun groupe', () => {
      component.group = null;
      expect(component.blockedReasonLabel()).toBe('');
    });
  });

  describe('isPartialCode', () => {
    it('reconnaît un code P comme partiel', () => {
      expect(component.isPartialCode('P00002')).toBe(true);
      expect(component.isPartialCode('L00002')).toBe(false);
    });
  });

  describe('onUnletter / onComplete', () => {
    it('émet unletter avec le code du groupe courant', () => {
      component.group = group({ code: 'L00042' });
      const emitted: string[] = [];
      component.unletter.subscribe(code => emitted.push(code));
      component.onUnletter();
      expect(emitted).toEqual(['L00042']);
    });

    it("n'émet rien si aucun groupe chargé", () => {
      component.group = null;
      const emitted: string[] = [];
      component.unletter.subscribe(code => emitted.push(code));
      component.onUnletter();
      expect(emitted).toEqual([]);
    });

    it('émet complete avec le code du groupe courant', () => {
      component.group = group({ code: 'P00009' });
      const emitted: string[] = [];
      component.complete.subscribe(code => emitted.push(code));
      component.onComplete();
      expect(emitted).toEqual(['P00009']);
    });
  });

  describe('close', () => {
    it('émet visibleChange(false)', () => {
      const emitted: boolean[] = [];
      component.visibleChange.subscribe(v => emitted.push(v));
      component.close();
      expect(emitted).toEqual([false]);
    });
  });

  describe('position', () => {
    it("vaut 'right' en contexte français (LTR)", () => {
      expect(component.position()).toBe('right');
    });

    it("vaut 'left' en contexte arabe (RTL) — tiroir ouvert du côté opposé", () => {
      const erpLocale = TestBed.inject(ErpLocaleService);
      erpLocale.apply('ar', { persist: false });
      expect(component.position()).toBe('left');
      // Nettoyage : `apply('ar')` insère de vrais <link> dans le document.head (feuille RTL,
      // préchargement de la police arabe) qui survivraient aux autres fichiers de spec Karma
      // (document partagé entre fichiers dans la même session navigateur).
      erpLocale.apply('fr', { persist: false });
      document.getElementById('factutrust-erp-noto-preload')?.remove();
    });
  });
  describe('montant du groupe et devises (correctif Qodex : 300 TND ne doit pas s\'afficher « 300 EUR »)', () => {
    const eurGroup = (overrides: Partial<LetteringGroup> = {}) =>
      group({
        amount: 300,
        currency: 'EUR',
        lines: [
          line({ lineId: 'd', debit: 300, currency: 'EUR', debitInCurrency: 100 }),
          line({ lineId: 'c', credit: 300, currency: 'EUR', creditInCurrency: 100 })
        ],
        ...overrides
      });

    it('aucun montant en devise pour un groupe en devise de tenue', () => {
      component.group = group({ amount: 1000, currency: 'TND' });
      expect(component.amountInCurrency()).toBeNull();
    });

    it('aucun montant en devise sans groupe', () => {
      component.group = null;
      expect(component.amountInCurrency()).toBeNull();
    });

    it('groupe soldé en EUR : montant en devise = somme des débits en devise', () => {
      component.group = eurGroup();
      expect(component.amountInCurrency()).toEqual({ amount: 100, currency: 'EUR' });
    });

    it('groupe partiel en EUR : montant en devise = minimum des deux côtés (même règle que le serveur)', () => {
      component.group = eurGroup({
        isPartial: true,
        code: 'P00001',
        lines: [
          line({ lineId: 'd', debit: 300, currency: 'EUR', debitInCurrency: 100 }),
          line({ lineId: 'c', credit: 120, currency: 'EUR', creditInCurrency: 40 })
        ]
      });
      expect(component.amountInCurrency()).toEqual({ amount: 40, currency: 'EUR' });
    });

    it("n'invente pas de montant en devise si les lignes n'en portent pas", () => {
      component.group = eurGroup({ lines: [line({ lineId: 'd', debit: 300, currency: 'EUR' })] });
      expect(component.amountInCurrency()).toBeNull();
    });

    it('rendu : le montant du groupe porte toujours la devise de tenue, le montant en devise sa propre devise', () => {
      component.visible = true;
      component.group = eurGroup();
      fixture.detectChanges();
      const amount = document.querySelector('[data-testid="lettering-group-amount"]');
      const fx = document.querySelector('[data-testid="lettering-group-amount-currency"]');
      expect(amount?.textContent).toContain(component.functionalCurrency);
      expect(amount?.textContent).not.toContain('EUR');
      expect(fx?.textContent).toContain('EUR');
      fixture.destroy();
    });
  });
});
