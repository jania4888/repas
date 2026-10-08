/**
 * Modèles de l'import de facture depuis un fichier (PDF / image / Word / Excel).
 * Miroir TypeScript des DTOs backend renvoyés par POST /api/ai/invoice-import.
 */

export interface InvoiceImportClient {
  /** Renseigné si le client a été rapproché d'un client existant en base. */
  matchedClientId: string | null;
  matchedClientName: string | null;
  /** True si aucun client existant n'a été rapproché (mode "nouveau client"). */
  isNewClient: boolean;
  name: string | null;
  nif: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  governorate: string | null;
  /** "TAX_SUBJECT" | "NON_TAX_SUBJECT" | "TAX_EXEMPT". */
  taxType: string;
}

export interface InvoiceImportLine {
  /** Renseigné si la ligne a été rapprochée d'un produit existant en base. */
  matchedProductId: string | null;
  matchedProductCode: string | null;
  designation: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPriceHT: number;
  discountPercent: number | null;
  /** Taux de TVA tunisien : 0, 7, 13 ou 19. */
  vatRatePercent: number;
}

export interface InvoiceImportTotals {
  totalHT: number | null;
  totalVat: number | null;
  totalTTC: number | null;
}

/** Réponse de POST /api/ai/invoice-import/warm-up */
export interface InvoiceImportWarmUpResponse {
  accepted: boolean;
  ready: boolean;
  model: string | null;
  error: string | null;
  requiredGiB: number | null;
  availableGiB: number | null;
}

export interface InvoiceImportResult {
  /** INVOICE, CREDIT_NOTE, DELIVERY_NOTE ou PROFORMA. */
  documentType: string;
  invoiceNumber: string | null;
  /** Date ISO "AAAA-MM-JJ" ou null. */
  issueDate: string | null;
  dueDate: string | null;
  /** "TND" | "EUR" | "USD". */
  currency: string;
  client: InvoiceImportClient;
  lines: InvoiceImportLine[];
  totals: InvoiceImportTotals | null;
  /** Auto-évaluation du LLM : "high" | "medium" | "low". */
  confidence: string;
  warnings: string[];
  /** Format détecté du fichier source ("pdf", "image", "docx", "xlsx", "csv", "txt"). */
  extractionFormat: string;
  ocrApplied: boolean;
}

/** Capacités d'import de facture. Jamais de clé ni d'URL de fournisseur. */
export interface InvoiceImportCapabilities {
  /**
   * Nom du service d'extraction documentaire externe quand il est actif, sinon null. Actif, il est
   * le SEUL lecteur : le modèle d'IA local n'est pas sollicité.
   */
  documentExtractionProvider: string | null;
  ocrAvailable: boolean;
  importModel: string | null;
  visionModel: string | null;
}
