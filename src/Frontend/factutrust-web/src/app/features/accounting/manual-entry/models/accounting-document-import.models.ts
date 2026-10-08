/**
 * Miroir TypeScript des DTO de `POST /api/accounting/document-import/propose`.
 *
 * Le backend ne fait que PROPOSER : rien n'est écrit en base. L'écriture est ensuite
 * enregistrée par le chemin existant `POST /api/accounting/journal`.
 */

export type DocumentDirection = 'SALE' | 'PURCHASE';

export type ProposedAccountStatus = 'found' | 'inactive' | 'missing';

export type ProposalSeverity = 'info' | 'warning' | 'blocking';

export type ProposedLineRole =
  | 'thirdparty'
  | 'revenue'
  | 'expense'
  | 'vat'
  | 'fodec'
  | 'stamp';

export type ExtractionMethod = 'native-pdf' | 'llm-text' | 'llm-vision' | 'external-extraction' | '';

export interface ExtractedParty {
  name: string | null;
  nif: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  governorate: string | null;
}

export interface ExtractedVatBucket {
  ratePercent: number;
  baseAmount: number;
  vatAmount: number;
}

export interface ExtractedLine {
  designation: string;
  reference: string | null;
  quantity: number;
  unit: string | null;
  unitPriceHt: number;
  discountPercent: number | null;
  vatRatePercent: number;
  lineTotalHt: number | null;
}

export interface AccountingDocumentExtraction {
  documentType: 'INVOICE' | 'CREDIT_NOTE' | 'PROFORMA' | 'DELIVERY_NOTE' | 'UNKNOWN';
  documentNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  documentStatus: string | null;
  currency: string;
  seller: ExtractedParty | null;
  buyer: ExtractedParty | null;
  lines: ExtractedLine[];
  vatBreakdown: ExtractedVatBucket[];
  totalHt: number | null;
  totalVat: number | null;
  fodecAmount: number | null;
  fiscalStampAmount: number | null;
  withholdingAmount: number | null;
  totalTtc: number | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  extractionMethod: ExtractionMethod;
  ocrApplied: boolean;
  vatBreakdownRecomputed: boolean;
}

export interface ProposalDiagnostic {
  severity: ProposalSeverity;
  code: string;
  message: string;
  relatedLineIndex: number | null;
}

export interface ProposedThirdParty {
  /** 1 = client, 2 = fournisseur. */
  kind: number;
  matchedId: string | null;
  matchedName: string | null;
  /** 'nif' | 'name' | null. */
  matchedBy: string | null;
  collectiveAccountNumber: string;
  name: string | null;
  nif: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  governorate: string | null;
}

export interface ProposedLine {
  accountNumber: string;
  accountLabel: string | null;
  accountStatus: ProposedAccountStatus;
  role: ProposedLineRole;
  label: string;
  debit: number;
  credit: number;
  vatRatePercent: number | null;
  thirdPartyId: string | null;
  thirdPartyKind: number | null;
}

export interface JournalEntryProposal {
  direction: DocumentDirection;
  directionReason: string | null;
  journalCode: string;
  entryDate: string | null;
  label: string;
  pieceRef: string | null;
  pieceDate: string | null;
  thirdParty: ProposedThirdParty | null;
  lines: ProposedLine[];
  totalDebit: number;
  totalCredit: number;
  documentTotalTtc: number | null;
  extraction: AccountingDocumentExtraction;
  diagnostics: ProposalDiagnostic[];
  hasBlockingDiagnostic: boolean;
}

export interface DocumentImportCapabilities {
  enabled: boolean;
  /**
   * Nom du service d'extraction documentaire externe quand il est actif, sinon null. Actif, il
   * est le SEUL lecteur : ni parseur natif, ni IA locale. Jamais une clé ni une URL.
   */
  documentExtractionProvider: string | null;
  nativeParserEnabled: boolean;
  aiFallbackAvailable: boolean;
  ocrAvailable: boolean;
  importModel: string | null;
  visionModel: string | null;
  visionModelReady?: boolean;
}

/** Libellé lisible de la méthode d'extraction, pour l'écran de relecture. */
export function extractionMethodLabel(method: ExtractionMethod): string {
  switch (method) {
    case 'native-pdf':
      return $localize`:@@accounting.accounting-document-import.ts.lecture.directe.du.pdf.aucune.analyse.ia.c260d0a2:Lecture directe du PDF (aucune analyse IA nécessaire)`;
    case 'llm-text':
      return $localize`:@@accounting.accounting-document-import.ts.analyse.ia.du.texte.du.document.d5e78bfb:Analyse IA du texte du document`;
    case 'llm-vision':
      return $localize`:@@accounting.accounting-document-import.ts.analyse.ia.visuelle.document.scanne.ou.p.3f8c2dca:Analyse IA visuelle (document scanné ou photographié)`;
    case 'external-extraction':
      return $localize`:@@accounting.accounting-document-import.ts.lecture.par.le.service.d.extraction.documentaire.837158cd:Lecture par le service d'extraction documentaire externe`;
    default:
      return $localize`:@@accounting.accounting-document-import.ts.methode.inconnue.a2ec5941:Méthode inconnue`;
  }
}
