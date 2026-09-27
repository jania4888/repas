/// <reference types="@angular/localize" />

export interface CodedOption<T extends string | number> {
  label: string;
  value: T;
}

/** Libellés traduits, valeurs envoyées à l'API inchangées. */
export const PRODUCT_TYPE_OPTIONS: CodedOption<string>[] = [
  { label: $localize`:@@product.type.produit:Produit`, value: 'Produit' },
  { label: $localize`:@@product.type.service:Service`, value: 'Service' },
];

export const PRODUCT_CATEGORY_OPTIONS: CodedOption<string>[] = [
  ...PRODUCT_TYPE_OPTIONS,
  { label: $localize`:@@product.type.abonnement:Abonnement`, value: 'Abonnement' },
];

export const PRODUCT_UNIT_VALUES = ['Unité', 'Heure', 'Jour', 'Mois', 'An', 'Kg', 'Litre', 'Mètre', 'M²'] as const;

export const PRODUCT_UNIT_OPTIONS: CodedOption<string>[] = [
  { label: $localize`:@@product.unit.unite:Unité`, value: 'Unité' },
  { label: $localize`:@@product.unit.heure:Heure`, value: 'Heure' },
  { label: $localize`:@@product.unit.jour:Jour`, value: 'Jour' },
  { label: $localize`:@@product.unit.mois:Mois`, value: 'Mois' },
  { label: $localize`:@@product.unit.an:An`, value: 'An' },
  { label: $localize`:@@product.unit.kg:Kg`, value: 'Kg' },
  { label: $localize`:@@product.unit.litre:Litre`, value: 'Litre' },
  { label: $localize`:@@product.unit.metre:Mètre`, value: 'Mètre' },
  { label: $localize`:@@product.unit.m2:M²`, value: 'M²' },
];

export const PRODUCT_VAT_OPTIONS: CodedOption<number>[] = [
  { label: $localize`:@@product.vat.19:19% - Taux normal`, value: 19 },
  { label: $localize`:@@product.vat.13:13% - Taux intermédiaire`, value: 13 },
  { label: $localize`:@@product.vat.7:7% - Taux réduit`, value: 7 },
  { label: $localize`:@@product.vat.0:0% - Exonéré`, value: 0 },
];

export const PAYMENT_TERM_DAY_VALUES = [30, 60, 90] as const;

export const PAYMENT_TERM_DAY_OPTIONS: CodedOption<number>[] = [
  { label: $localize`:@@pay.term.30:30 jours`, value: 30 },
  { label: $localize`:@@pay.term.60:60 jours`, value: 60 },
  { label: $localize`:@@pay.term.90:90 jours`, value: 90 },
];

export const SUPPLIER_PAYMENT_METHOD_VALUES = [
  'Effet de commerce',
  'Virement bancaire',
  'Espèces',
  'Chèque',
  'Carte bancaire',
] as const;

export const SUPPLIER_PAYMENT_METHOD_OPTIONS: CodedOption<string>[] = [
  { label: $localize`:@@pay.method.effet:Effet de commerce`, value: 'Effet de commerce' },
  { label: $localize`:@@pay.method.virement:Virement bancaire`, value: 'Virement bancaire' },
  { label: $localize`:@@pay.method.especes:Espèces`, value: 'Espèces' },
  { label: $localize`:@@pay.method.cheque:Chèque`, value: 'Chèque' },
  { label: $localize`:@@pay.method.carte:Carte bancaire`, value: 'Carte bancaire' },
];
