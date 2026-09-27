export interface FirmCodeOption {
  value: string;
  label: string;
}

export const PRACTICE_AREA_OPTIONS: FirmCodeOption[] = [
  { value: 'tenue-comptable', label: $localize`:@@shared.firm-directory.labels.ts.tenue.comptable.24e29aad:Tenue comptable` },
  { value: 'fiscalite', label: $localize`:@@shared.firm-directory.labels.ts.fiscalite.0546e952:Fiscalité` },
  { value: 'tva', label: 'TVA' },
  { value: 'paie-cnss', label: $localize`:@@shared.firm-directory.labels.ts.paie.et.cnss.8910c964:Paie et CNSS` },
  { value: 'tej-retenue', label: $localize`:@@shared.firm-directory.labels.ts.tej.et.retenue.a.la.source.da534e13:TEJ et retenue à la source` },
  { value: 'liasse-fiscale', label: $localize`:@@shared.firm-directory.labels.ts.liasse.fiscale.f3f1f55a:Liasse fiscale` },
  { value: 'creation-societe', label: $localize`:@@shared.firm-directory.labels.ts.creation.de.societe.da8f100a:Création de société` },
  { value: 'conseil', label: $localize`:@@shared.firm-directory.labels.ts.conseil.da9311c6:Conseil` }
];

export const CLIENT_SEGMENT_OPTIONS: FirmCodeOption[] = [
  { value: 'tpe', label: 'TPE' },
  { value: 'pme', label: 'PME' },
  { value: 'profession-liberale', label: $localize`:@@shared.firm-directory.labels.ts.professions.liberales.02465024:Professions libérales` },
  { value: 'association', label: $localize`:@@shared.firm-directory.labels.ts.associations.134d6b41:Associations` },
  { value: 'export', label: $localize`:@@shared.firm-directory.labels.ts.export.f3e4fadb:Export` }
];

export const LANGUAGE_OPTIONS: FirmCodeOption[] = [
  { value: 'fr', label: 'Français' },
  { value: 'ar', label: $localize`:@@shared.firm-directory.labels.ts.arabe.4b016bf0:Arabe` },
  { value: 'en', label: $localize`:@@shared.firm-directory.labels.ts.anglais.c06595d9:Anglais` }
];

export const TEAM_SIZE_OPTIONS: FirmCodeOption[] = [
  { value: 'solo', label: $localize`:@@shared.firm-directory.labels.ts.independant.de8d4f95:Indépendant` },
  { value: '2-5', label: $localize`:@@shared.firm-directory.labels.ts.2.a.5.personnes.9a8bb52c:2 à 5 personnes` },
  { value: '6-20', label: $localize`:@@shared.firm-directory.labels.ts.6.a.20.personnes.bfd5e389:6 à 20 personnes` },
  { value: '20-plus', label: $localize`:@@shared.firm-directory.labels.ts.plus.de.20.personnes.7fb644a5:Plus de 20 personnes` }
];

export const MISSING_LABELS: Record<string, string> = {
  description: $localize`:@@shared.firm-directory.labels.ts.une.description.d.au.moins.80.caracteres.699c7794:Une description d’au moins 80 caractères`,
  practiceAreas: 'Au moins un domaine d’intervention',
  languages: 'Au moins une langue',
  governorate: 'Un gouvernorat tunisien',
  registration: 'Le numéro d’inscription professionnelle',
  visibility: 'La visibilité dans l’annuaire'
};

export function firmCodeLabel(options: FirmCodeOption[], code: string): string {
  return options.find(o => o.value === code)?.label ?? code;
}

export function firmInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
