import { SupplierType } from '@core/services/supplier.service';
import {
  ApiProductType,
  ApiSupplierType,
  ApiVatRate,
  PurchaseReceiptImportTotals
} from '../models/purchase-receipt-import.models';

/**
 * Conversions entre les valeurs d'enum reçues du backend d'import (chaînes,
 * JsonStringEnumConverter) et les valeurs attendues par les endpoints de
 * création existants (SupplierService, ProductService). Ne jamais transmettre
 * une valeur brute de la proposition d'import à ces endpoints sans passer par
 * ces fonctions.
 */

export function toSupplierType(value: ApiSupplierType | null | undefined): SupplierType {
  return value === 'Business' ? SupplierType.Business : SupplierType.Individual;
}

/** Taux de TVA tunisien en pourcentage (0, 7, 13 ou 19). Défaut : 19 (Standard). */
export function toVatPercent(value: ApiVatRate | null | undefined): number {
  switch (value) {
    case 'Exempt': return 0;
    case 'Reduced': return 7;
    case 'Intermediate': return 13;
    case 'Standard': return 19;
    default: return 19;
  }
}

/** Catégorie produit attendue par QuickCreateProductDialogComponent ('Produit' | 'Service'). */
export function toProductCategory(value: ApiProductType | null | undefined): string {
  // Les abonnements (Subscription) ne sont pas gérés par la création rapide ;
  // repli sur Service, cohérent avec un article facturé sans suivi de stock.
  return value === 'Service' || value === 'Subscription' ? 'Service' : 'Produit';
}

const UNIT_SYNONYMS: Record<string, string> = {
  'U': 'Unité', 'UN': 'Unité', 'PCE': 'Unité', 'PC': 'Unité', 'PIECE': 'Unité', 'PIÈCE': 'Unité',
  'KG': 'Kg',
  'L': 'Litre', 'LT': 'Litre',
  'M': 'Mètre', 'ML': 'Mètre',
  'M2': 'M²'
};

/** Normalise une unité extraite du document vers une des valeurs connues du catalogue produit. */
export function normalizeImportUnit(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return 'Unité';
  return UNIT_SYNONYMS[raw.toUpperCase()] ?? raw;
}

/** Libellés des codes d'avertissement d'import (PurchaseReceiptImportWarningCodes côté backend). */
export const IMPORT_WARNING_LABELS: Record<string, () => string> = {
  Extraction: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.anomalie.detectee.pendant.l.extraction.du.doc.1a2b3c4e:Anomalie détectée pendant l'extraction du document.`,
  PartiesSwapped: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.fournisseur.et.le.destinataire.semblent.i.2b3c4d5f:Le fournisseur et le destinataire semblent inversés sur le document.`,
  SupplierNotFoundInDocument: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.aucun.fournisseur.identifie.sur.le.document.3c4d5e60:Aucun fournisseur identifié sur le document.`,
  UnexpectedDocumentType: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.type.de.document.detecte.n.est.pas.celui.4d5e6f71:Le type de document détecté n'est pas celui attendu pour un bon de réception.`,
  SupplierInactive: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.fournisseur.rapproche.est.inactif.5e6f7082:Le fournisseur rapproché est inactif.`,
  SupplierNameConflictsWithNif: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.nom.du.fournisseur.ne.correspond.pas.au.ma.6f708293:Le nom du fournisseur ne correspond pas au matricule fiscal trouvé.`,
  SupplierNifInvalid: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.matricule.fiscal.lu.sur.le.document.n.est.70829304:Le matricule fiscal lu sur le document n'est pas valide.`,
  ProductVatMismatch: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.taux.de.tva.lu.differe.de.celui.de.l.artic.82930415:Le taux de TVA lu diffère de celui de l'article en base ; le taux de l'article est appliqué.`,
  ProductInactiveOrTemplate: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.l.article.rapproche.est.inactif.ou.est.un.mo.93041526:L'article rapproché est inactif ou est un modèle de variantes.`,
  VatRateDefaulted: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.taux.de.tva.non.lu.taux.standard.applique.par.a4152637:Taux de TVA non lu : taux standard appliqué par défaut.`,
  QuantityInvalid: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.quantite.non.lisible.ou.invalide.sur.cette.li.b5263748:Quantité non lisible ou invalide sur cette ligne.`,
  DiscountOutOfRange: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.remise.lue.hors.bornes.ignoree.c6374859:Remise lue hors bornes, ignorée.`,
  LineTotalMismatch: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.total.de.la.ligne.ne.correspond.pas.au.cal.d748596a:Le total de la ligne ne correspond pas au calcul (quantité × prix − remise).`,
  TotalHtMismatch: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.total.ht.du.document.ne.correspond.pas.au.e8596a7b:Le total HT du document ne correspond pas au total calculé des lignes.`,
  TotalTtcMismatch: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.total.ttc.du.document.ne.correspond.pas.au.f96a7b8c:Le total TTC du document ne correspond pas au total calculé.`,
  FiscalStampNotApplied: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.un.timbre.fiscal.est.mentionne.sur.le.documen.a97b8c9d:Un timbre fiscal est mentionné sur le document ; il n'est pas reporté automatiquement sur le bon de réception.`,
  CurrencyNotTnd: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.document.n.est.pas.libelle.en.dinars.tunis.b8c9dae1:Le document n'est pas libellé en dinars tunisiens.`,
  TooManyLines: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.le.document.comporte.beaucoup.de.lignes.verif.c9dae2f0:Le document comporte beaucoup de lignes ; vérifiez qu'aucune n'a été omise.`,
  PossibleDuplicate: () => $localize`:@@features.purchase-receipts.utils.purchase-receipt-import.mapping.ts.un.bon.de.reception.similaire.existe.peut.et.dae2f031:Un bon de réception similaire existe peut-être déjà pour ce fournisseur.`
};

/** Libellé par défaut pour un code d'avertissement non reconnu de la table ci-dessus. */
export function importWarningLabel(code: string): string {
  return IMPORT_WARNING_LABELS[code]?.() ?? code;
}

export interface ImportTotalsComparison {
  /** Écart absolu en TND entre le total du document et le total calculé. */
  deltaAmount: number;
  /** Écart relatif (0.01 = 1%). */
  deltaRatio: number;
  /** True si l'écart dépasse la tolérance (0,010 TND ou 1%). */
  mismatch: boolean;
}

/** Tolérance absolue en TND sous laquelle un écart de totaux n'est pas signalé. */
const TOTALS_TOLERANCE_AMOUNT = 0.010;
/** Tolérance relative (1%) sous laquelle un écart de totaux n'est pas signalé. */
const TOTALS_TOLERANCE_RATIO = 0.01;

/**
 * Compare le total TTC lu sur le document à celui calculé à partir des lignes
 * du formulaire. Le TTC du document est ramené hors timbre fiscal et FODEC :
 * le bon de réception ne porte ni l'un ni l'autre (la retenue à la source ne
 * fait pas partie du TTC et n'est pas déduite). Tolérance : 0,010 TND ou 1%
 * (la plus permissive des deux). Renvoie null sans TTC de document exploitable.
 */
export function compareImportTotals(
  documentTotals: PurchaseReceiptImportTotals | null,
  computedTotalTtc: number
): ImportTotalsComparison | null {
  if (!documentTotals || documentTotals.totalTtc === null) return null;

  const expected =
    documentTotals.totalTtc - (documentTotals.fiscalStampAmount ?? 0) - (documentTotals.fodecAmount ?? 0);
  const deltaAmount = Math.abs(expected - computedTotalTtc);
  const deltaRatio = expected !== 0 ? deltaAmount / Math.abs(expected) : (computedTotalTtc !== 0 ? 1 : 0);
  const mismatch = deltaAmount > TOTALS_TOLERANCE_AMOUNT && deltaRatio > TOTALS_TOLERANCE_RATIO;

  return { deltaAmount, deltaRatio, mismatch };
}
