export interface FirmCodeOption {
  value: string;
  label: string;
}

export const PRACTICE_AREA_OPTIONS: FirmCodeOption[] = [
  { value: 'tenue-comptable', label: 'Tenue comptable' },
  { value: 'fiscalite', label: 'Fiscalité' },
  { value: 'tva', label: 'TVA' },
  { value: 'paie-cnss', label: 'Paie et CNSS' },
  { value: 'tej-retenue', label: 'TEJ et retenue à la source' },
  { value: 'liasse-fiscale', label: 'Liasse fiscale' },
  { value: 'creation-societe', label: 'Création de société' },
  { value: 'conseil', label: 'Conseil' }
];

export const CLIENT_SEGMENT_OPTIONS: FirmCodeOption[] = [
  { value: 'tpe', label: 'TPE' },
  { value: 'pme', label: 'PME' },
  { value: 'profession-liberale', label: 'Professions libérales' },
  { value: 'association', label: 'Associations' },
  { value: 'export', label: 'Export' }
];

export const LANGUAGE_OPTIONS: FirmCodeOption[] = [
  { value: 'fr', label: 'Français' },
  { value: 'ar', label: 'Arabe' },
  { value: 'en', label: 'Anglais' }
];

export const TEAM_SIZE_OPTIONS: FirmCodeOption[] = [
  { value: 'solo', label: 'Indépendant' },
  { value: '2-5', label: '2 à 5 personnes' },
  { value: '6-20', label: '6 à 20 personnes' },
  { value: '20-plus', label: 'Plus de 20 personnes' }
];

export const MISSING_LABELS: Record<string, string> = {
  description: 'Une description d’au moins 80 caractères',
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
