/**
 * Shared types for the metadata-driven Studio renderers (dynamic form / table).
 * Kept in the shared layer so the renderers don't depend on a feature module.
 * Mirrors backend FactuTrust.Domain.Enums.CustomFieldType (integer values must stay aligned).
 */
export enum CustomFieldType {
  Text = 0,
  MultilineText = 1,
  Number = 2,
  Decimal = 3,
  Boolean = 4,
  Date = 5,
  DateTime = 6,
  Select = 7,
  MultiSelect = 8,
  RelationCustom = 9,
  RelationExisting = 10,
  Money = 11,
  Percentage = 12,
  Rating = 13,
  QrCode = 14,
  Barcode = 15,
  AutoNumber = 16,
  Formula = 17,
  Lookup = 18,
  Rollup = 19,
  Attachment = 20,
  Signature = 21
}

/**
 * Normalises a wire `fieldType` to the numeric {@link CustomFieldType}. The API serializes enums as
 * PascalCase strings (global JsonStringEnumConverter) — e.g. "Date", "RelationCustom" — while this enum
 * is numeric and the renderers switch on numbers. Tolerant of the enum name, a numeric string, or a
 * number (future-proof). Unknown/missing → Text (safe default).
 */
export function parseFieldType(value: unknown): CustomFieldType {
  if (typeof value === 'number') return value as CustomFieldType;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number(value) as CustomFieldType;
    const mapped = (CustomFieldType as Record<string, unknown>)[value];
    if (typeof mapped === 'number') return mapped as CustomFieldType;
  }
  return CustomFieldType.Text;
}

export const FIELD_TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: CustomFieldType.Text, label: $localize`:@@shared.studio-runtime.ts.texte.ff9afef1:Texte` },
  { value: CustomFieldType.MultilineText, label: $localize`:@@shared.studio-runtime.ts.texte.long.09157521:Texte long` },
  { value: CustomFieldType.Number, label: $localize`:@@shared.studio-runtime.ts.nombre.entier.0e5abd6c:Nombre entier` },
  { value: CustomFieldType.Decimal, label: $localize`:@@shared.studio-runtime.ts.nombre.decimal.42b22118:Nombre décimal` },
  { value: CustomFieldType.Money, label: $localize`:@@shared.studio-runtime.ts.monetaire.5b9130b4:Monétaire` },
  { value: CustomFieldType.Percentage, label: $localize`:@@shared.studio-runtime.ts.pourcentage.e34218e3:Pourcentage` },
  { value: CustomFieldType.Rating, label: $localize`:@@shared.studio-runtime.ts.note.etoiles.73f5e1da:Note (étoiles)` },
  { value: CustomFieldType.Boolean, label: $localize`:@@shared.studio-runtime.ts.oui.non.1a268ea5:Oui / Non` },
  { value: CustomFieldType.Date, label: $localize`:@@shared.studio-runtime.ts.date.eb9a4bc1:Date` },
  { value: CustomFieldType.DateTime, label: $localize`:@@shared.studio-runtime.ts.date.et.heure.d77bc41b:Date et heure` },
  { value: CustomFieldType.Select, label: $localize`:@@shared.studio-runtime.ts.liste.choix.unique.2ddb7b67:Liste (choix unique)` },
  { value: CustomFieldType.MultiSelect, label: $localize`:@@shared.studio-runtime.ts.liste.choix.multiple.975ad859:Liste (choix multiple)` },
  { value: CustomFieldType.QrCode, label: $localize`:@@shared.studio-runtime.ts.qr.code.abba02fc:QR code` },
  { value: CustomFieldType.Barcode, label: $localize`:@@shared.studio-runtime.ts.code.barres.a5ce859a:Code-barres` },
  { value: CustomFieldType.AutoNumber, label: $localize`:@@shared.studio-runtime.ts.numero.automatique.021478b9:Numéro automatique` },
  { value: CustomFieldType.Formula, label: $localize`:@@shared.studio-runtime.ts.formule.calcul.c0c4d2e1:Formule (calcul)` },
  { value: CustomFieldType.Lookup, label: $localize`:@@shared.studio-runtime.ts.recherche.champ.lie.800be474:Recherche (champ lié)` },
  { value: CustomFieldType.Rollup, label: $localize`:@@shared.studio-runtime.ts.agregat.enfants.d7b3e6bf:Agrégat (enfants)` },
  { value: CustomFieldType.Attachment, label: $localize`:@@shared.studio-runtime.ts.piece.jointe.2ecefd2c:Pièce jointe` },
  { value: CustomFieldType.Signature, label: $localize`:@@shared.studio-runtime.ts.signature.2f32be1d:Signature` },
  { value: CustomFieldType.RelationCustom, label: $localize`:@@shared.studio-runtime.ts.relation.table.personnalisee.43ea5cac:Relation (table personnalisée)` },
  { value: CustomFieldType.RelationExisting, label: $localize`:@@shared.studio-runtime.ts.relation.donnee.existante.a992fb72:Relation (donnée existante)` }
];

export interface FieldValidationRules {
  minLength?: number | null;
  maxLength?: number | null;
  min?: number | null;
  max?: number | null;
  regex?: string | null;
  decimals?: number | null;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface RelationRef {
  kind: string;
  ref: string;
}

export interface CustomField {
  id: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  isRequired: boolean;
  isUnique: boolean;
  sortOrder: number;
  rules: FieldValidationRules | null;
  options: SelectOption[] | null;
  relation: RelationRef | null;
  isActive: boolean;
  /** Per-type config parsed from OptionsJson (money.currency, rating.max, render.format/source, …). */
  config?: Record<string, any> | null;
}

// ---- Form layout (mirrors backend FormLayout) ----

export interface FormFieldRef {
  key: string;
  labelOverride?: string | null;
  width?: 'full' | 'half' | null;
}

export interface FormSection {
  title?: string | null;
  fields: FormFieldRef[];
}

export interface FormLayout {
  sections: FormSection[];
}

// ---- Report result (mirrors backend ReportResultDto) ----

export interface ReportColumn {
  key: string;
  label: string;
  kind: 'dimension' | 'measure';
  format?: string | null;
  formatOptions?: {
    statusMap?: Record<string, string>;
    lookupTable?: string | null;
    lookupDisplayColumn?: string | null;
  } | null;
  dataType?: string | null;
  numeric?: boolean;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  /** Nombre de lignes RÉELLEMENT disponibles — peut dépasser `rows.length` (voir `truncated`). */
  totalRows: number;
  /**
   * Vrai quand le résultat a été plafonné : les totaux ne portent alors pas sur la totalité des
   * données et l'interface DOIT le signaler. Absent = comportement historique (non tronqué).
   */
  truncated?: boolean;
  displayValues?: Record<string, string> | null;
}
