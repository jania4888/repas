export enum NumberingDocumentType {
  Invoice = 0,
  CreditNote = 1,
  Quote = 2,
  DeliveryNote = 3,
  PurchaseOrder = 4,
  StockTransfer = 5,
  PhysicalInventory = 6,
  CashReceipt = 7,
  CashExpense = 8,
  BankDeposit = 9,
  SalesOrder = 10,
  FeeInvoice = 11,
  FeeCreditNote = 12,
  FeeQuote = 13,
  PurchaseReceipt = 14,
  SupplierInvoice = 15,
  SalesReturnNote = 16,
  ZReport = 17,
  StockEntry = 18,
  StockIssue = 19
}

export enum NumberingBlockType {
  FreeText = 0,
  Separator = 1,
  DocumentNumber = 2,
  DocumentNumberPadded3 = 3,
  DocumentNumberPadded4 = 4,
  DocumentNumberPadded5 = 5,
  DocumentNumberPadded6 = 6,
  Day = 7,
  Month = 8,
  Year4 = 9,
  Year2 = 10
}

export interface NumberingBlock {
  type: NumberingBlockType;
  value?: string | null;
  order: number;
  label?: string;
}

export interface NumberingScheme {
  documentType: NumberingDocumentType;
  documentTypeDisplay: string;
  fiscalYear: number;
  startNumber: number;
  currentSequence: number;
  nextSequence: number;
  minimumStartNumber: number;
  hasIssuedDocuments: boolean;
  blocks: NumberingBlock[];
  isFormatLocked: boolean;
  examplePreview: string;
}

export interface SaveNumberingSchemeRequest {
  startNumber: number;
  blocks: NumberingBlock[];
}

export interface PreviewNumberingRequest {
  startNumber: number;
  blocks: NumberingBlock[];
  fiscalYear?: number;
}

export interface PreviewNumberingResponse {
  example: string;
}

export const BLOCK_TYPE_LABELS: Record<NumberingBlockType, string> = {
  [NumberingBlockType.FreeText]: 'Texte libre',
  [NumberingBlockType.Separator]: $localize`:@@settings.numbering.ts.separateur.b9c2ee8d:Séparateur`,
  [NumberingBlockType.DocumentNumber]: $localize`:@@settings.numbering.ts.numero.de.document.f65df140:Numéro de document`,
  [NumberingBlockType.DocumentNumberPadded3]: $localize`:@@settings.numbering.ts.numero.de.document.a.3.chiffres.596b53d7:Numéro de document à 3 chiffres`,
  [NumberingBlockType.DocumentNumberPadded4]: $localize`:@@settings.numbering.ts.numero.de.document.a.4.chiffres.a53e9484:Numéro de document à 4 chiffres`,
  [NumberingBlockType.DocumentNumberPadded5]: $localize`:@@settings.numbering.ts.numero.de.document.a.5.chiffres.78d9d532:Numéro de document à 5 chiffres`,
  [NumberingBlockType.DocumentNumberPadded6]: $localize`:@@settings.numbering.ts.numero.de.document.a.6.chiffres.f640c3ce:Numéro de document à 6 chiffres`,
  [NumberingBlockType.Day]: $localize`:@@settings.numbering.ts.jour.jj.9e339227:Jour (JJ)`,
  [NumberingBlockType.Month]: $localize`:@@settings.numbering.ts.mois.mm.9704b748:Mois (MM)`,
  [NumberingBlockType.Year4]: $localize`:@@settings.numbering.ts.annee.aaaa.d05f8c31:Année (AAAA)`,
  [NumberingBlockType.Year2]: $localize`:@@settings.numbering.ts.annee.aa.63239c04:Année (AA)`
};

export interface PaletteBlockTemplate {
  type: NumberingBlockType;
  value?: string | null;
}

export const PALETTE_BLOCKS: readonly PaletteBlockTemplate[] = [
  { type: NumberingBlockType.FreeText, value: '' },
  { type: NumberingBlockType.Separator, value: '-' },
  { type: NumberingBlockType.Separator, value: '/' },
  { type: NumberingBlockType.DocumentNumber, value: null },
  { type: NumberingBlockType.DocumentNumberPadded3, value: null },
  { type: NumberingBlockType.DocumentNumberPadded4, value: null },
  { type: NumberingBlockType.DocumentNumberPadded5, value: null },
  { type: NumberingBlockType.DocumentNumberPadded6, value: null },
  { type: NumberingBlockType.Day, value: null },
  { type: NumberingBlockType.Month, value: null },
  { type: NumberingBlockType.Year4, value: null },
  { type: NumberingBlockType.Year2, value: null }
];

export interface NumberingDocumentTab {
  documentType: NumberingDocumentType;
  label: string;
  shortLabel: string;
  icon: string;
}

export const DOCUMENT_TYPE_TABS: readonly NumberingDocumentTab[] = [
  { documentType: NumberingDocumentType.Invoice, label: $localize`:@@settings.numbering.ts.facture.3953b9f5:Facture`, shortLabel: 'FAC', icon: 'pi pi-file' },
  { documentType: NumberingDocumentType.CreditNote, label: $localize`:@@settings.numbering.ts.facture.avoir.84174db8:Facture avoir`, shortLabel: 'AVO', icon: 'pi pi-replay' },
  { documentType: NumberingDocumentType.Quote, label: $localize`:@@settings.numbering.ts.devis.f7622f90:Devis`, shortLabel: 'DEV', icon: 'pi pi-file-edit' },
  { documentType: NumberingDocumentType.DeliveryNote, label: $localize`:@@settings.numbering.ts.bon.de.livraison.1a60dc44:Bon de livraison`, shortLabel: 'BL', icon: 'pi pi-truck' },
  { documentType: NumberingDocumentType.PurchaseOrder, label: $localize`:@@settings.numbering.ts.bon.de.commande.4b9aea29:Bon de commande`, shortLabel: 'BC', icon: 'pi pi-shopping-cart' },
  { documentType: NumberingDocumentType.StockTransfer, label: $localize`:@@settings.numbering.ts.transfert.stock.4a85a5f6:Transfert stock`, shortLabel: 'TR', icon: 'pi pi-arrows-h' },
  { documentType: NumberingDocumentType.PhysicalInventory, label: $localize`:@@settings.numbering.ts.inventaire.physique.38b526c7:Inventaire physique`, shortLabel: 'INVE', icon: 'pi pi-box' },
  { documentType: NumberingDocumentType.CashReceipt, label: $localize`:@@settings.numbering.ts.encaissement.caisse.e2f101b5:Encaissement caisse`, shortLabel: 'ENC', icon: 'pi pi-wallet' },
  { documentType: NumberingDocumentType.CashExpense, label: $localize`:@@settings.numbering.ts.decaissement.caisse.19ef35fa:Décaissement caisse`, shortLabel: 'DEP', icon: 'pi pi-money-bill' },
  { documentType: NumberingDocumentType.BankDeposit, label: $localize`:@@settings.numbering.ts.remise.bancaire.0097046a:Remise bancaire`, shortLabel: 'REM', icon: 'pi pi-building-columns' },
  { documentType: NumberingDocumentType.SalesReturnNote, label: $localize`:@@settings.numbering.ts.bon.de.retour.58d2db35:Bon de retour`, shortLabel: 'BRT', icon: 'pi pi-replay' },
  { documentType: NumberingDocumentType.ZReport, label: $localize`:@@settings.numbering.ts.cloture.z.e93fcfd6:Clôture Z`, shortLabel: 'Z', icon: 'pi pi-book' },
  { documentType: NumberingDocumentType.StockEntry, label: $localize`:@@settings.numbering.ts.bon.d.entree.e2e98811:Bon d'entrée`, shortLabel: 'BE', icon: 'pi pi-arrow-down' },
  { documentType: NumberingDocumentType.StockIssue, label: $localize`:@@settings.numbering.ts.bon.de.sortie.8a13eaf2:Bon de sortie`, shortLabel: 'BS', icon: 'pi pi-arrow-up' }
];

export const DEFAULT_FREE_TEXT: Record<NumberingDocumentType, string> = {
  [NumberingDocumentType.Invoice]: 'FAC',
  [NumberingDocumentType.CreditNote]: 'AVO',
  [NumberingDocumentType.Quote]: 'DEV',
  [NumberingDocumentType.DeliveryNote]: 'BL',
  [NumberingDocumentType.PurchaseOrder]: 'BC',
  [NumberingDocumentType.StockTransfer]: 'TR',
  [NumberingDocumentType.PhysicalInventory]: 'INVE',
  [NumberingDocumentType.CashReceipt]: 'ENC',
  [NumberingDocumentType.CashExpense]: 'DEP',
  [NumberingDocumentType.BankDeposit]: 'REM',
  [NumberingDocumentType.SalesOrder]: 'CDE',
  [NumberingDocumentType.FeeInvoice]: 'FAC',
  [NumberingDocumentType.FeeCreditNote]: 'AVO',
  [NumberingDocumentType.FeeQuote]: 'DEV',
  [NumberingDocumentType.PurchaseReceipt]: 'BR',
  [NumberingDocumentType.SupplierInvoice]: 'FS',
  [NumberingDocumentType.SalesReturnNote]: 'BRT',
  [NumberingDocumentType.ZReport]: 'Z',
  [NumberingDocumentType.StockEntry]: 'BE',
  [NumberingDocumentType.StockIssue]: 'BS'
};

export function isDocumentNumberBlock(type: NumberingBlockType): boolean {
  return (
    type === NumberingBlockType.DocumentNumber ||
    type === NumberingBlockType.DocumentNumberPadded3 ||
    type === NumberingBlockType.DocumentNumberPadded4 ||
    type === NumberingBlockType.DocumentNumberPadded5 ||
    type === NumberingBlockType.DocumentNumberPadded6
  );
}

export function cloneBlock(block: NumberingBlock, order: number): NumberingBlock {
  return {
    type: block.type,
    value: block.value,
    order,
    label: block.label ?? BLOCK_TYPE_LABELS[block.type]
  };
}

/**
 * L'API sérialise `NumberingDocumentType` en chaîne PascalCase (`JsonStringEnumConverter`),
 * alors que le front utilise l'enum numérique. Sans normalisation, `scheme.documentType === docType` échoue.
 */
const DOCUMENT_TYPE_BY_STRING: Record<string, NumberingDocumentType> = {
  Invoice: NumberingDocumentType.Invoice,
  CreditNote: NumberingDocumentType.CreditNote,
  Quote: NumberingDocumentType.Quote,
  DeliveryNote: NumberingDocumentType.DeliveryNote,
  PurchaseOrder: NumberingDocumentType.PurchaseOrder,
  StockTransfer: NumberingDocumentType.StockTransfer,
  PhysicalInventory: NumberingDocumentType.PhysicalInventory,
  CashReceipt: NumberingDocumentType.CashReceipt,
  CashExpense: NumberingDocumentType.CashExpense,
  BankDeposit: NumberingDocumentType.BankDeposit,
  SalesOrder: NumberingDocumentType.SalesOrder,
  FeeInvoice: NumberingDocumentType.FeeInvoice,
  FeeCreditNote: NumberingDocumentType.FeeCreditNote,
  FeeQuote: NumberingDocumentType.FeeQuote,
  PurchaseReceipt: NumberingDocumentType.PurchaseReceipt,
  SupplierInvoice: NumberingDocumentType.SupplierInvoice,
  SalesReturnNote: NumberingDocumentType.SalesReturnNote,
  ZReport: NumberingDocumentType.ZReport,
  StockEntry: NumberingDocumentType.StockEntry,
  StockIssue: NumberingDocumentType.StockIssue
};

const BLOCK_TYPE_BY_STRING: Record<string, NumberingBlockType> = {
  FreeText: NumberingBlockType.FreeText,
  Separator: NumberingBlockType.Separator,
  DocumentNumber: NumberingBlockType.DocumentNumber,
  DocumentNumberPadded3: NumberingBlockType.DocumentNumberPadded3,
  DocumentNumberPadded4: NumberingBlockType.DocumentNumberPadded4,
  DocumentNumberPadded5: NumberingBlockType.DocumentNumberPadded5,
  DocumentNumberPadded6: NumberingBlockType.DocumentNumberPadded6,
  Day: NumberingBlockType.Day,
  Month: NumberingBlockType.Month,
  Year4: NumberingBlockType.Year4,
  Year2: NumberingBlockType.Year2
};

export function parseNumberingDocumentType(raw: unknown): NumberingDocumentType {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw in DEFAULT_FREE_TEXT) {
    return raw as NumberingDocumentType;
  }
  if (typeof raw === 'string') {
    const value = DOCUMENT_TYPE_BY_STRING[raw];
    if (value !== undefined) {
      return value;
    }
  }
  return NumberingDocumentType.Invoice;
}

export function parseNumberingBlockType(raw: unknown): NumberingBlockType {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw in BLOCK_TYPE_LABELS) {
    return raw as NumberingBlockType;
  }
  if (typeof raw === 'string') {
    const value = BLOCK_TYPE_BY_STRING[raw];
    if (value !== undefined) {
      return value;
    }
  }
  return NumberingBlockType.FreeText;
}

export function normalizeNumberingBlock(block: NumberingBlock): NumberingBlock {
  const type = parseNumberingBlockType(block.type);
  return {
    ...block,
    type,
    label: block.label ?? BLOCK_TYPE_LABELS[type]
  };
}

export function normalizeNumberingScheme(scheme: NumberingScheme): NumberingScheme {
  const documentType = parseNumberingDocumentType(scheme.documentType);
  return {
    ...scheme,
    documentType,
    blocks: scheme.blocks.map((block, index) =>
      normalizeNumberingBlock({
        ...block,
        order: block.order ?? index
      })
    )
  };
}

export function findSchemeForType(
  schemes: readonly NumberingScheme[],
  documentType: NumberingDocumentType
): NumberingScheme | undefined {
  return schemes.find((s) => s.documentType === documentType);
}

export function getDocumentTypeForTabIndex(index: number): NumberingDocumentType {
  return DOCUMENT_TYPE_TABS[index]?.documentType ?? NumberingDocumentType.Invoice;
}

/** Default format blocks mirroring backend NumberingSchemeDefaults. */
export function getDefaultBlocksForType(documentType: NumberingDocumentType): NumberingBlock[] {
  const prefix = DEFAULT_FREE_TEXT[documentType];

  if (documentType === NumberingDocumentType.PhysicalInventory) {
    return [
      { type: NumberingBlockType.FreeText, value: prefix, order: 0, label: BLOCK_TYPE_LABELS[NumberingBlockType.FreeText] },
      { type: NumberingBlockType.Separator, value: '-', order: 1, label: BLOCK_TYPE_LABELS[NumberingBlockType.Separator] },
      { type: NumberingBlockType.DocumentNumberPadded6, value: null, order: 2, label: BLOCK_TYPE_LABELS[NumberingBlockType.DocumentNumberPadded6] }
    ];
  }

  return [
    { type: NumberingBlockType.FreeText, value: prefix, order: 0, label: BLOCK_TYPE_LABELS[NumberingBlockType.FreeText] },
    { type: NumberingBlockType.Separator, value: '-', order: 1, label: BLOCK_TYPE_LABELS[NumberingBlockType.Separator] },
    { type: NumberingBlockType.Year4, value: null, order: 2, label: BLOCK_TYPE_LABELS[NumberingBlockType.Year4] },
    { type: NumberingBlockType.Separator, value: '-', order: 3, label: BLOCK_TYPE_LABELS[NumberingBlockType.Separator] },
    { type: NumberingBlockType.DocumentNumberPadded6, value: null, order: 4, label: BLOCK_TYPE_LABELS[NumberingBlockType.DocumentNumberPadded6] }
  ];
}
