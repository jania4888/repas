import { FormControl } from '@angular/forms';
import {
  ContactValidators,
  isSingleLine,
  isValidContactEmail,
  isValidTunisianContactPhone,
  normalizeTunisianPhone,
  toAsciiDigits
} from './tunisian-validators';

describe('tunisian-validators (contact public)', () => {
  describe('normalizeTunisianPhone', () => {
    it('convertit les chiffres arabo-indiens et retire espaces, points, tirets, parenthèses', () => {
      expect(toAsciiDigits('٢٠١٢٣٤٥٦')).toBe('20123456');
      expect(normalizeTunisianPhone('٢٠ ١٢٣ ٤٥٦')).toBe('20123456');
      expect(normalizeTunisianPhone('+216 20.123-456')).toBe('+21620123456');
      expect(normalizeTunisianPhone('(+216) 20 123 456')).toBe('+21620123456');
    });

    it('convertit 00216 et 216 en +216', () => {
      expect(normalizeTunisianPhone('00216 20 123 456')).toBe('+21620123456');
      expect(normalizeTunisianPhone('21620123456')).toBe('+21620123456');
    });
  });

  describe('isValidTunisianContactPhone', () => {
    it('accepte 8 chiffres commençant par 2 à 9, avec ou sans +216', () => {
      for (const ok of ['20123456', '98 765 432', '+216 71 234 567', '00216 50123456', '٩٨٧٦٥٤٣٢']) {
        expect(isValidTunisianContactPhone(ok)).withContext(ok).toBeTrue();
      }
    });

    it('refuse les numéros trop courts, commençant par 0/1 ou étrangers', () => {
      for (const ko of ['', '2012345', '201234567', '01234567', '12345678', '+33 6 12 34 56 78', 'abc', '+216 1 2345678']) {
        expect(isValidTunisianContactPhone(ko)).withContext(ko).toBeFalse();
      }
    });
  });

  describe('isValidContactEmail', () => {
    it('accepte une adresse standard et refuse espaces, contrôle, longueur > 254', () => {
      expect(isValidContactEmail('amel@exemple.tn')).toBeTrue();
      expect(isValidContactEmail(' amel@exemple.tn ')).toBeTrue();
      expect(isValidContactEmail('amel @exemple.tn')).toBeFalse();
      expect(isValidContactEmail('amel@exemple')).toBeFalse();
      expect(isValidContactEmail(`${'a'.repeat(250)}@x.tn`)).toBeFalse();
      expect(isValidContactEmail('a\u0007@x.tn')).toBeFalse();
    });
  });

  describe('isSingleLine', () => {
    it('refuse sauts de ligne et caractères de contrôle', () => {
      expect(isSingleLine('Cabinet BS')).toBeTrue();
      expect(isSingleLine('Cabinet\nBS')).toBeFalse();
      expect(isSingleLine('Cabinet\u0000BS')).toBeFalse();
    });
  });

  describe('ContactValidators (Angular)', () => {
    it('tunisianPhone', () => {
      const v = ContactValidators.tunisianPhone();
      expect(v(new FormControl(''))).toBeNull();
      expect(v(new FormControl('+216 20 123 456'))).toBeNull();
      expect(v(new FormControl('12345678'))).toEqual({ tunisianPhone: true });
    });

    it('email', () => {
      const v = ContactValidators.email();
      expect(v(new FormControl(''))).toBeNull();
      expect(v(new FormControl('a@b.tn'))).toBeNull();
      expect(v(new FormControl('a@b'))).toEqual({ email: true });
    });

    it('singleLine et noControlChars', () => {
      expect(ContactValidators.singleLine()(new FormControl('Nom\nPrénom'))).toEqual({ singleLine: true });
      expect(ContactValidators.singleLine()(new FormControl('Nom Prénom'))).toBeNull();
      expect(ContactValidators.noControlChars()(new FormControl('ligne 1\nligne 2\ttab'))).toBeNull();
      expect(ContactValidators.noControlChars()(new FormControl('x\u0001y'))).toEqual({ controlChars: true });
    });

    it('contactSize accepte vide et la liste blanche seulement', () => {
      const v = ContactValidators.contactSize();
      expect(v(new FormControl(''))).toBeNull();
      expect(v(new FormControl('dossiers:21-50'))).toBeNull();
      expect(v(new FormControl('employes:100+'))).toBeNull();
      expect(v(new FormControl('dossiers:100+'))).toEqual({ size: true });
    });
  });
});
