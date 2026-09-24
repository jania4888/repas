import { FormControl } from '@angular/forms';
import { optionalAuthPasswordValidator, passwordPolicyMissingRules } from './auth-password.helpers';

describe('auth-password helpers', () => {
  describe('optionalAuthPasswordValidator', () => {
    const validate = (value: unknown) => optionalAuthPasswordValidator()(new FormControl(value));

    it('accepts an empty value: the account is then created by invitation', () => {
      expect(validate('')).toBeNull();
      expect(validate(null)).toBeNull();
    });

    it('treats whitespace as empty, like the server which trims the password', () => {
      expect(validate('   ')).toBeNull();
    });

    it('rejects a password the server policy refuses', () => {
      expect(validate('Test1234')).toEqual({
        passwordPolicy: { missing: ['12 caractères minimum', 'un caractère spécial'] }
      });
    });

    it('rejects an 11-character password that meets every other rule', () => {
      expect(validate('Aa1!Aa1!Aa1')).toEqual({ passwordPolicy: { missing: ['12 caractères minimum'] } });
    });

    it('accepts a password meeting every rule', () => {
      expect(validate('Aaaaaaaaaaa1!')).toBeNull();
    });

    it('accepts exactly four distinct characters', () => {
      expect(validate('Aa1!Aa1!Aa1!')).toBeNull();
    });

    it('validates the trimmed value, which is what the server checks', () => {
      expect(validate('  Aa1!Aa1!Aa1  ')).toEqual({ passwordPolicy: { missing: ['12 caractères minimum'] } });
    });
  });

  describe('passwordPolicyMissingRules', () => {
    it('lists every missing rule', () => {
      expect(passwordPolicyMissingRules('aaaa')).toEqual([
        '12 caractères minimum',
        'une majuscule',
        'un chiffre',
        'un caractère spécial',
        '4 caractères différents'
      ]);
    });

    it('counts an accented letter as a special character, as Identity does', () => {
      expect(passwordPolicyMissingRules('Aaaaaaaaaaa1é')).toEqual([]);
    });
  });
});
