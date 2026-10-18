import { ChartOfAccountDto } from '../services/accounting.service';
import {
  accountSupportsFiscalId,
  extractFiscalIdServerError,
  findFiscalIdDuplicate,
  fiscalIdDuplicateMessage,
  fiscalIdFormatError,
  normalizeFiscalIdInput
} from './chart-account-fiscal-id';

describe('chart-account-fiscal-id', () => {
  function account(partial: Partial<ChartOfAccountDto> = {}): ChartOfAccountDto {
    return {
      id: 'acc-1',
      accountNumber: '411001',
      label: 'Client ABC',
      accountClass: 4,
      natureType: 0,
      isSystem: false,
      isActive: true,
      level: 5,
      accountType: 1,
      isAuxiliary: true,
      fiscalId: null,
      ...partial
    };
  }

  describe('accountSupportsFiscalId', () => {
    it('autorise Client auxiliaire', () => {
      expect(accountSupportsFiscalId(1, true)).toBeTrue();
    });

    it('autorise Fournisseur auxiliaire', () => {
      expect(accountSupportsFiscalId(2, true)).toBeTrue();
    });

    it('refuse un compte non auxiliaire même Client/Fournisseur', () => {
      expect(accountSupportsFiscalId(1, false)).toBeFalse();
      expect(accountSupportsFiscalId(2, false)).toBeFalse();
    });

    it('refuse le type Autre, même auxiliaire', () => {
      expect(accountSupportsFiscalId(3, true)).toBeFalse();
    });

    it('refuse valeurs manquantes', () => {
      expect(accountSupportsFiscalId(undefined, true)).toBeFalse();
      expect(accountSupportsFiscalId(1, undefined)).toBeFalse();
      expect(accountSupportsFiscalId(null, null)).toBeFalse();
    });
  });

  describe('normalizeFiscalIdInput', () => {
    it('ramène la forme compacte à la forme carte', () => {
      expect(normalizeFiscalIdInput('1234567ABM000')).toBe('1234567A/B/M/000');
    });

    it('ramène la forme historique à la forme carte', () => {
      expect(normalizeFiscalIdInput('1234567/A/B/M/000')).toBe('1234567A/B/M/000');
    });

    it('renvoie une chaîne vide pour une saisie vide ou absente', () => {
      expect(normalizeFiscalIdInput('')).toBe('');
      expect(normalizeFiscalIdInput(null)).toBe('');
      expect(normalizeFiscalIdInput(undefined)).toBe('');
    });
  });

  describe('fiscalIdFormatError', () => {
    it('ne signale rien pour une saisie vide (champ optionnel)', () => {
      expect(fiscalIdFormatError('')).toBeNull();
      expect(fiscalIdFormatError(null)).toBeNull();
      expect(fiscalIdFormatError(undefined)).toBeNull();
    });

    it('ne signale rien pour un matricule valide', () => {
      expect(fiscalIdFormatError('1234567A/B/M/000')).toBeNull();
      expect(fiscalIdFormatError('1234567ABM000')).toBeNull();
    });

    it('signale une erreur pour un format invalide', () => {
      expect(fiscalIdFormatError('ABC123')).toContain('Matricule fiscal invalide');
      expect(fiscalIdFormatError('123456')).toContain('Matricule fiscal invalide');
    });
  });

  describe('findFiscalIdDuplicate', () => {
    it('trouve un doublon pour le même type de compte', () => {
      const rows = [
        account({ id: 'acc-1', accountType: 1, fiscalId: '1234567A/B/M/000', accountNumber: '411001', label: 'Client ABC' })
      ];
      const duplicate = findFiscalIdDuplicate(rows, 1, '1234567ABM000');
      expect(duplicate?.id).toBe('acc-1');
    });

    it('ignore un même matricule fiscal porté par un type de compte différent', () => {
      const rows = [
        account({ id: 'acc-1', accountType: 1, fiscalId: '1234567A/B/M/000' })
      ];
      expect(findFiscalIdDuplicate(rows, 2, '1234567ABM000')).toBeNull();
    });

    it('exclut le compte en cours d’édition via excludeId', () => {
      const rows = [
        account({ id: 'acc-1', accountType: 1, fiscalId: '1234567A/B/M/000' })
      ];
      expect(findFiscalIdDuplicate(rows, 1, '1234567ABM000', 'acc-1')).toBeNull();
    });

    it('renvoie null pour un matricule vide', () => {
      const rows = [account({ fiscalId: '1234567A/B/M/000' })];
      expect(findFiscalIdDuplicate(rows, 1, '')).toBeNull();
      expect(findFiscalIdDuplicate(rows, 1, null)).toBeNull();
    });

    it('ignore les comptes sans matricule fiscal', () => {
      const rows = [account({ fiscalId: null })];
      expect(findFiscalIdDuplicate(rows, 1, '1234567ABM000')).toBeNull();
    });
  });

  describe('fiscalIdDuplicateMessage', () => {
    it('inclut le numéro et le libellé du compte en doublon', () => {
      const message = fiscalIdDuplicateMessage({ accountNumber: '411001', label: 'Client ABC' });
      expect(message).toContain('411001');
      expect(message).toContain('Client ABC');
    });
  });

  describe('extractFiscalIdServerError', () => {
    it('extrait un message de fieldErrors["FiscalId"]', () => {
      const err = { error: { fieldErrors: { FiscalId: [{ message: 'Format invalide.' }] } } };
      expect(extractFiscalIdServerError(err)).toBe('Format invalide.');
    });

    it('extrait un message de fieldErrors["Request.FiscalId"]', () => {
      const err = { error: { fieldErrors: { 'Request.FiscalId': ['Déjà utilisé.'] } } };
      expect(extractFiscalIdServerError(err)).toBe('Déjà utilisé.');
    });

    it('ignore les autres champs de fieldErrors', () => {
      const err = { error: { fieldErrors: { Label: [{ message: 'Libellé requis.' }] } } };
      expect(extractFiscalIdServerError(err)).toBeNull();
    });

    it('extrait le message pour le code ChartAccount.FiscalIdDuplicate', () => {
      const err = { error: { code: 'ChartAccount.FiscalIdDuplicate', error: 'Déjà utilisé par un autre compte.' } };
      expect(extractFiscalIdServerError(err)).toBe('Déjà utilisé par un autre compte.');
    });

    it('extrait le message pour le code Validation.FiscalId', () => {
      const err = { error: { code: 'Validation.FiscalId', message: 'Format invalide.' } };
      expect(extractFiscalIdServerError(err)).toBe('Format invalide.');
    });

    it('renvoie null pour une erreur sans rapport avec le matricule fiscal', () => {
      const err = { error: { code: 'Validation.AccountNumber', message: 'Numéro invalide.' } };
      expect(extractFiscalIdServerError(err)).toBeNull();
    });

    it('accepte un corps passé directement (sans .error imbriqué)', () => {
      const err = { code: 'ChartAccount.FiscalIdDuplicate', error: 'Déjà utilisé.' };
      expect(extractFiscalIdServerError(err)).toBe('Déjà utilisé.');
    });

    it('renvoie null pour une entrée non objet', () => {
      expect(extractFiscalIdServerError(null)).toBeNull();
      expect(extractFiscalIdServerError(undefined)).toBeNull();
      expect(extractFiscalIdServerError('oops')).toBeNull();
    });
  });
});
