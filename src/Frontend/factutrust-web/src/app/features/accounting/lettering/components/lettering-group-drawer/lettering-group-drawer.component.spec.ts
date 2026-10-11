import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ErpLocaleService } from '@core/i18n/erp-locale.service';
import { LetteringGroup } from '../../models/lettering.models';
import { LetteringGroupDrawerComponent } from './lettering-group-drawer.component';

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LetteringGroupDrawerComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    const fixture = TestBed.createComponent(LetteringGroupDrawerComponent);
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
});
