import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

const CIN_PATTERN = /^\d{8}$/;
const CNSS_PATTERN = /^\d{10}$/;
const RIB_PATTERN = /^\d{20}$/;
const TN_PHONE_PATTERN = /^(\+?216)?[2-57-9]\d{7}$/;

export const TUNISIAN_GOVERNORATES = [
  'Ariana', 'Béja', 'Ben Arous', 'Bizerte', 'Gabès', 'Gafsa', 'Jendouba',
  'Kairouan', 'Kasserine', 'Kébili', 'Le Kef', 'Mahdia', 'La Manouba',
  'Médenine', 'Monastir', 'Nabeul', 'Sfax', 'Sidi Bouzid', 'Siliana',
  'Sousse', 'Tataouine', 'Tozeur', 'Tunis', 'Zaghouan'
] as const;

function optionalPattern(pattern: RegExp, message: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    if (raw == null || String(raw).trim() === '') return null;
    const cleaned = String(raw).replace(/\s/g, '').replace(/-/g, '');
    return pattern.test(cleaned) ? null : { tunisianFormat: message };
  };
}

export const tunisianPayrollValidators = {
  cin: optionalPattern(CIN_PATTERN, $localize`:@@core.tunisian-payroll.validators.ts.le.cin.doit.comporter.8.chiffres.fd83b5c9:Le CIN doit comporter 8 chiffres.`),
  cnss: optionalPattern(CNSS_PATTERN, $localize`:@@core.tunisian-payroll.validators.ts.le.numero.cnss.doit.comporter.10.chiffre.c2766358:Le numéro CNSS doit comporter 10 chiffres.`),
  rib: optionalPattern(RIB_PATTERN, $localize`:@@core.tunisian-payroll.validators.ts.le.rib.doit.comporter.20.chiffres.47214575:Le RIB doit comporter 20 chiffres.`),
  phone: optionalPattern(TN_PHONE_PATTERN, $localize`:@@core.tunisian-payroll.validators.ts.numero.de.telephone.tunisien.invalide.a973b508:Numéro de téléphone tunisien invalide.`),
  governorate: (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    if (raw == null || String(raw).trim() === '') return null;
    const match = TUNISIAN_GOVERNORATES.some(g => g.toLowerCase() === String(raw).trim().toLowerCase());
    return match ? null : { tunisianFormat: 'Gouvernorat tunisien invalide.' };
  },
  /**
   * Validateur de groupe : étudiants + infirmes ≤ enfants à charge (art. 40 code IRPP).
   * À poser sur le FormGroup contenant dependentChildren / studentChildren / disabledChildren.
   */
  familyCounts: (group: AbstractControl): ValidationErrors | null => {
    const total = Number(group.get('dependentChildren')?.value ?? 0);
    const students = Number(group.get('studentChildren')?.value ?? 0);
    const disabled = Number(group.get('disabledChildren')?.value ?? 0);
    return students + disabled <= total
      ? null
      : { familyCounts: $localize`:@@core.tunisian-payroll.validators.ts.le.total.des.enfants.etudiants.et.infirm.c4cba19a:Le total des enfants étudiants et infirmes ne peut pas dépasser le nombre d’enfants à charge.` };
  }
};

export function formatValidationError(errors: ValidationErrors | null): string | null {
  if (!errors) return null;
  if (errors['tunisianFormat']) return errors['tunisianFormat'] as string;
  if (errors['required']) return $localize`:@@core.tunisian-payroll.validators.ts.ce.champ.est.obligatoire.95840ee3:Ce champ est obligatoire.`;
  if (errors['email']) return 'Adresse e-mail invalide.';
  if (errors['min']) return $localize`:@@core.tunisian-payroll.validators.ts.la.valeur.est.trop.faible.687e393d:La valeur est trop faible.`;
  return 'Valeur invalide.';
}
