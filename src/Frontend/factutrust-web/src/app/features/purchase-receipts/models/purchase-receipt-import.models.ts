/**
 * Modèles de l'import de bon de réception depuis un document (PDF / image).
 * Miroir TypeScript des DTOs backend renvoyés par
 * POST /api/purchasereceipts/import-document et GET .../capabilities
 * (voir PurchaseReceiptImportDtos.cs).
 *
 * Les enums backend (SupplierType, ProductType, VatRate) sont sérialisés en
 * chaînes (JsonStringEnumConverter). Ne jamais transmettre ces valeurs brutes
 * aux endpoints de création : passer par les fonctions de conversion de
 * `purchase-receipt-import.mapping.ts`.
 */

export type PurchaseReceiptImportExtractionProvider = 'docstrange' | 'llm-text' | 'llm-vision' | 'native-pdf';

export type PurchaseReceiptImportConfidence = 'high' | 'medium' | 'low';

export type SupplierMatchOutcome =
  | 'MatchedByNif'
  | 'MatchedByName'
  | 'Ambiguous'
  | 'NameConflictsWithNif'
  | 'MatchedInactive'
  | 'NotFound'
  | 'Missing';

export type ProductMatchMethod = 'code' | 'barcode' | 'name' | 'ambiguous' | 'none' | 'skipped';

/** Valeur brute reçue du backend (JsonStringEnumConverter). */
export type ApiSupplierType = 'Individual' | 'Business';
/** Valeur brute reçue du backend (JsonStringEnumConverter). */
export type ApiProductType = 'Product' | 'Service' | 'Subscription';
/** Valeur brute reçue du backend (JsonStringEnumConverter). */
export type ApiVatRate = 'Exempt' | 'Reduced' | 'Intermediate' | 'Standard';

export interface PurchaseReceiptImportHeader {
  /** Date ISO "AAAA-MM-JJ" ou null : si absente, l'UI met la date du jour. */
  receiptDate: string | null;
  deliveryNoteNumber: string | null;
  supplierReference: string | null;
  currency: string | null;
  suggestedNotes: string | null;
  suggestedWarehouseId: string | null;
}

export interface SupplierCandidate {
  id: string;
  name: string;
  nif: string | null;
  city: string | null;
  isActive: boolean;
}

export interface SupplierPrefill {
  name: string | null;
  type: ApiSupplierType;
  nif: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  governorate: string | null;
  email: string | null;
  phone: string | null;
  missingRequiredFields: string[];
}

export interface PurchaseReceiptImportSupplier {
  matchOutcome: SupplierMatchOutcome;
  supplierId: string | null;
  supplierName: string | null;
  extractedName: string | null;
  extractedNif: string | null;
  candidates: SupplierCandidate[];
  prefill: SupplierPrefill | null;
}

export interface ProductCandidate {
  id: string;
  code: string;
  name: string;
  vatRatePercent: number;
  purchasePrice: number | null;
}

export interface ProductPrefill {
  code: string | null;
  codeConflict: boolean;
  name: string;
  type: ApiProductType;
  purchasePrice: number | null;
  vatRate: ApiVatRate;
  unit: string | null;
  barcode: string | null;
  isStockManaged: boolean;
  preferredSupplierId: string | null;
}

export interface PurchaseReceiptImportLine {
  index: number;
  extractedCode: string | null;
  designation: string | null;
  unit: string | null;
  quantity: number | null;
  unitPriceHt: number | null;
  discountPercent: number | null;
  vatRatePercent: number | null;
  lineTotalHt: number | null;
  matchMethod: ProductMatchMethod;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  productVatRatePercent: number | null;
  vatMismatch: boolean;
  candidates: ProductCandidate[];
  prefill: ProductPrefill | null;
}

export interface PurchaseReceiptImportVatBreakdown {
  ratePercent: number;
  baseHt: number;
  vatAmount: number;
}

export interface PurchaseReceiptImportTotals {
  totalHt: number | null;
  totalVat: number | null;
  fodecAmount: number | null;
  fiscalStampAmount: number | null;
  withholdingAmount: number | null;
  totalTtc: number | null;
  vatBreakdown: PurchaseReceiptImportVatBreakdown[];
}

export interface PurchaseReceiptImportExpectedTotals {
  subTotal: number;
  totalVat: number;
  totalAmount: number;
}

export interface PurchaseReceiptImportWarning {
  code: string;
  severity: 'info' | 'warning';
  message: string;
  lineIndex: number | null;
}

export interface PurchaseReceiptImportProposal {
  extractionProvider: PurchaseReceiptImportExtractionProvider;
  ocrApplied: boolean;
  documentType: string | null;
  documentNumber: string | null;
  header: PurchaseReceiptImportHeader;
  supplier: PurchaseReceiptImportSupplier;
  lines: PurchaseReceiptImportLine[];
  documentTotals: PurchaseReceiptImportTotals;
  expectedReceiptTotals: PurchaseReceiptImportExpectedTotals;
  confidence: PurchaseReceiptImportConfidence | null;
  warnings: PurchaseReceiptImportWarning[];
  canCreateSupplier: boolean;
  canCreateProduct: boolean;
  /** Absent côté anciens contrats : se replier sur hasPermission(purchaseReceipts.update). */
  canAttach?: boolean;
}

/** Réponse de GET /api/purchasereceipts/import-document/capabilities */
export interface PurchaseReceiptImportCapabilities {
  available: boolean;
  /** "docstrange" | "llm" ; jamais une URL ni une clé. */
  extractionProvider: string | null;
  ocrAvailable: boolean;
  visionCapable: boolean;
  /** Vrai si Docstrange lit, ou si le modèle résolu n'est pas local (Ollama). */
  externalProcessing: boolean;
  maxFileBytes: number;
  acceptedContentTypes: string[];
  canCreateSupplier: boolean;
  canCreateProduct: boolean;
  canAttach: boolean;
}

/** Événement émis par PurchaseReceiptImportService.importDocument(). */
export type PurchaseReceiptImportEvent =
  | { kind: 'upload'; percent: number }
  | { kind: 'analysing' }
  | { kind: 'done'; proposal: PurchaseReceiptImportProposal };
