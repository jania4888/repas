import { FormControl, FormGroup } from '@angular/forms';
import {
  evaluatePasswordRules,
  governorateValidator,
  identityPasswordValidator,
  nifValidator,
  passwordsMatchValidator,
  postalCodeValidator,
  tunisianPhoneValidator
} from './registration-validators';
import { normalizeNif, normalizePhone } from './tunisian-validation';

/**
 * Ces règles doivent rester alignées sur le serveur : un écart signifie qu'un opérateur peut
 * remplir tout le formulaire avant d'être rejeté par un 400 qu'il ne pouvait pas anticiper.
 */
describe('registration-validators', () => {
  describe('mot de passe (politique ASP.NET Identity réellement appliquée)', () => {
    it('accepte un mot de passe conforme', () => {
      expect(identityPasswordValidator(new FormControl('Abcdef123!@#'))).toBeNull();
    });

    it('refuse un mot de passe de 10 caractères — le serveur en exige 12', () => {
      const errors = identityPasswordValidator(new FormControl('Password1!'));
      expect(errors?.['passwordPolicy']).toContain('length');
    });

    it('refuse un mot de passe sans caractère spécial', () => {
      const errors = identityPasswordValidator(new FormControl('Abcdefgh1234'));
      expect(errors?.['passwordPolicy']).toContain('symbol');
    });

    it('refuse un mot de passe qui n’a pas 4 caractères distincts', () => {
      const errors = identityPasswordValidator(new FormControl('Aaaa1111!!!!'.slice(0, 12)));
      expect(errors).toBeNull(); // 'Aaaa1111!!!!' comporte bien A,a,1,! → 4 distincts
    });

    it('détaille chaque règle pour la checklist', () => {
      const rules = evaluatePasswordRules('abc');
      expect(rules.length).toBe(6);
      expect(rules.find(r => r.key === 'length')?.satisfied).toBeFalse();
      expect(rules.find(r => r.key === 'lowercase')?.satisfied).toBeTrue();
    });

    it('ne signale rien tant que le champ est vide (c’est le rôle de `required`)', () => {
      expect(identityPasswordValidator(new FormControl(''))).toBeNull();
    });
  });

  describe('confirmation du mot de passe', () => {
    const buildGroup = (password: string, confirmPassword: string) =>
      new FormGroup(
        { password: new FormControl(password), confirmPassword: new FormControl(confirmPassword) },
        { validators: passwordsMatchValidator() }
      );

    it('signale un couple divergent sur le champ de confirmation', () => {
      const group = buildGroup('Abcdef123!@#', 'Autre');
      expect(group.errors?.['passwordMismatch']).toBeTrue();
      expect(group.get('confirmPassword')?.hasError('passwordMismatch')).toBeTrue();
    });

    it('retire l’erreur dès que les deux valeurs concordent', () => {
      const group = buildGroup('Abcdef123!@#', 'Autre');
      group.get('confirmPassword')?.setValue('Abcdef123!@#');
      expect(group.get('confirmPassword')?.hasError('passwordMismatch')).toBeFalse();
    });
  });

  describe('matricule fiscal', () => {
    it('accepte la forme carte et l\'écriture historique', () => {
      expect(nifValidator(new FormControl('1772793W/A/M/000'))).toBeNull();
      expect(nifValidator(new FormControl('1234567/A/B/C/000'))).toBeNull();
    });

    it('accepte une saisie en minuscules ou espacée, via normalisation', () => {
      expect(nifValidator(new FormControl(' 1234567/a/b/c/000 '))).toBeNull();
      expect(normalizeNif(' 1234567/a/b/c/000 ')).toBe('1234567A/B/C/000');
      expect(normalizeNif('1772793w/a/m/000')).toBe('1772793W/A/M/000');
    });

    it('refuse une forme incomplète', () => {
      expect(nifValidator(new FormControl('1234567A/M/000'))?.['nifFormat']).toBeTrue();
    });

    it('refuse un NIF tronqué', () => {
      expect(nifValidator(new FormControl('1234567/A/B/C/00'))?.['nifFormat']).toBeTrue();
    });

    it('refuse le code de domaine « vente-detail » collé par erreur dans le champ', () => {
      expect(nifValidator(new FormControl('vente-detail'))?.['nifFormat']).toBeTrue();
    });
  });

  describe('téléphone tunisien', () => {
    it('accepte les trois formes acceptées par le serveur', () => {
      expect(tunisianPhoneValidator(new FormControl('71123456'))).toBeNull();
      expect(tunisianPhoneValidator(new FormControl('21671123456'))).toBeNull();
      expect(tunisianPhoneValidator(new FormControl('+21671123456'))).toBeNull();
    });

    it('normalise vers la forme internationale', () => {
      expect(normalizePhone('71 123 456')).toBe('+21671123456');
    });

    it('refuse un numéro trop court', () => {
      expect(tunisianPhoneValidator(new FormControl('7112345'))?.['phoneFormat']).toBeTrue();
    });
  });

  describe('code postal', () => {
    it('accepte 4 chiffres et tolère l’absence de valeur', () => {
      expect(postalCodeValidator(new FormControl('1000'))).toBeNull();
      expect(postalCodeValidator(new FormControl(''))).toBeNull();
    });

    it('refuse 3 chiffres', () => {
      expect(postalCodeValidator(new FormControl('100'))?.['postalCodeFormat']).toBeTrue();
    });
  });

  describe('gouvernorat', () => {
    it('accepte une valeur du référentiel, casse indifférente', () => {
      expect(governorateValidator(new FormControl('Tunis'))).toBeNull();
      expect(governorateValidator(new FormControl('sfax'))).toBeNull();
    });

    it('refuse une valeur hors référentiel', () => {
      expect(governorateValidator(new FormControl('Paris'))?.['governorateUnknown']).toBeTrue();
    });
  });
});
