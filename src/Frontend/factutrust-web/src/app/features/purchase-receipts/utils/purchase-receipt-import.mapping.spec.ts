import { SupplierType } from '@core/services/supplier.service';
import {
  compareImportTotals,
  importWarningLabel,
  normalizeImportUnit,
  toProductCategory,
  toSupplierType,
  toVatPercent
} from './purchase-receipt-import.mapping';

describe('purchase-receipt-import.mapping', () => {
  describe('toSupplierType', () => {
    it('convertit "Business" en SupplierType.Business', () => {
      expect(toSupplierType('Business')).toBe(SupplierType.Business);
    });

    it('convertit "Individual", null ou undefined en SupplierType.Individual', () => {
      expect(toSupplierType('Individual')).toBe(SupplierType.Individual);
      expect(toSupplierType(null)).toBe(SupplierType.Individual);
      expect(toSupplierType(undefined)).toBe(SupplierType.Individual);
    });
  });

  describe('toVatPercent', () => {
    it('convertit chaque taux connu', () => {
      expect(toVatPercent('Exempt')).toBe(0);
      expect(toVatPercent('Reduced')).toBe(7);
      expect(toVatPercent('Intermediate')).toBe(13);
      expect(toVatPercent('Standard')).toBe(19);
    });

    it('se replie sur 19 pour une valeur nulle ou inconnue', () => {
      expect(toVatPercent(null)).toBe(19);
      expect(toVatPercent(undefined)).toBe(19);
      expect(toVatPercent('Autre' as never)).toBe(19);
    });
  });

  describe('toProductCategory', () => {
    it('renvoie "Produit" pour Product', () => {
      expect(toProductCategory('Product')).toBe('Produit');
    });

    it('renvoie "Service" pour Service et pour Subscription (repli)', () => {
      expect(toProductCategory('Service')).toBe('Service');
      expect(toProductCategory('Subscription')).toBe('Service');
    });

    it('renvoie "Produit" pour une valeur nulle ou inconnue', () => {
      expect(toProductCategory(null)).toBe('Produit');
      expect(toProductCategory(undefined)).toBe('Produit');
    });
  });

  describe('normalizeImportUnit', () => {
    it('reconnaît les synonymes insensibles à la casse', () => {
      expect(normalizeImportUnit('u')).toBe('Unité');
      expect(normalizeImportUnit('UN')).toBe('Unité');
      expect(normalizeImportUnit('pce')).toBe('Unité');
      expect(normalizeImportUnit('Pc')).toBe('Unité');
      expect(normalizeImportUnit('piece')).toBe('Unité');
      expect(normalizeImportUnit('kg')).toBe('Kg');
      expect(normalizeImportUnit('l')).toBe('Litre');
      expect(normalizeImportUnit('LT')).toBe('Litre');
      expect(normalizeImportUnit('m')).toBe('Mètre');
      expect(normalizeImportUnit('ml')).toBe('Mètre');
      expect(normalizeImportUnit('m2')).toBe('M²');
    });

    it('conserve une unité inconnue mais non vide telle quelle', () => {
      expect(normalizeImportUnit('Carton')).toBe('Carton');
    });

    it('renvoie "Unité" par défaut pour une valeur vide, null ou undefined', () => {
      expect(normalizeImportUnit('')).toBe('Unité');
      expect(normalizeImportUnit('   ')).toBe('Unité');
      expect(normalizeImportUnit(null)).toBe('Unité');
      expect(normalizeImportUnit(undefined)).toBe('Unité');
    });
  });

  describe('importWarningLabel', () => {
    it('renvoie le libellé localisé pour un code connu', () => {
      expect(importWarningLabel('SupplierInactive')).toContain('inactif');
      expect(importWarningLabel('PossibleDuplicate')).toContain('similaire');
    });

    it('renvoie le code brut pour un code inconnu', () => {
      expect(importWarningLabel('CodeInconnu42')).toBe('CodeInconnu42');
    });
  });

  describe('compareImportTotals', () => {
    it('renvoie null si les totaux du document sont absents', () => {
      expect(compareImportTotals(null, 100)).toBeNull();
    });

    it('ne signale rien dans le seuil de tolérance (0,010 TND ou 1%)', () => {
      const result = compareImportTotals({ subTotal: 80, totalVat: 20, totalAmount: 100 }, 100.005);
      expect(result?.mismatch).toBeFalse();
    });

    it('signale un écart hors seuil', () => {
      const result = compareImportTotals({ subTotal: 80, totalVat: 20, totalAmount: 100 }, 150);
      expect(result?.mismatch).toBeTrue();
      expect(result?.deltaAmount).toBeCloseTo(50, 3);
    });

    it('ne signale rien si l’écart relatif reste sous 1% malgré un écart absolu élevé', () => {
      const result = compareImportTotals({ subTotal: 8000, totalVat: 2000, totalAmount: 10000 }, 10050);
      // deltaAmount = 50 (> 0.010) mais deltaRatio = 0.005 (<= 0.01) : la règle "la plus permissive des deux" s'applique.
      expect(result?.mismatch).toBeFalse();
    });

    it('gère un total de document nul sans lever d’exception', () => {
      const zero = compareImportTotals({ subTotal: 0, totalVat: 0, totalAmount: 0 }, 0);
      expect(zero?.mismatch).toBeFalse();

      const nonZeroComputed = compareImportTotals({ subTotal: 0, totalVat: 0, totalAmount: 0 }, 50);
      expect(nonZeroComputed?.mismatch).toBeTrue();
    });
  });
});
