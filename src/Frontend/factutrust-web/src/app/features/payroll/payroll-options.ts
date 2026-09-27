export const MARITAL_STATUS_OPTIONS = [
  { value: 'Single', label: $localize`:@@payroll.payroll-options.ts.celibataire.b7ff8bfa:Célibataire` },
  { value: 'Married', label: $localize`:@@payroll.payroll-options.ts.marie.e.ad4238c3:Marié(e)` },
  { value: 'Divorced', label: $localize`:@@payroll.payroll-options.ts.divorce.e.f6bd699d:Divorcé(e)` },
  { value: 'Widowed', label: $localize`:@@payroll.payroll-options.ts.veuf.ve.3e41f11f:Veuf(ve)` }
];

export const CONTRACT_TYPE_OPTIONS = [
  { value: 'Cdi', label: 'CDI' },
  { value: 'Cdd', label: 'CDD' },
  { value: 'Sivp', label: 'SIVP' },
  { value: 'Karama', label: 'Karama' },
  { value: 'Internship', label: $localize`:@@payroll.payroll-options.ts.stage.ca6d0e3a:Stage` },
  { value: 'Other', label: $localize`:@@payroll.payroll-options.ts.autre.43dacf9e:Autre` }
];

export const SOCIAL_REGIME_OPTIONS = [
  { value: 'Rsna', label: $localize`:@@payroll.payroll-options.ts.rsna.cnss.b5b22161:RSNA (CNSS)` },
  { value: 'SivpExonere', label: $localize`:@@payroll.payroll-options.ts.sivp.exonere.2355c2cd:SIVP exonéré` },
  { value: 'Rsa', label: $localize`:@@payroll.payroll-options.ts.rsa.salaries.agricoles.a976cfb9:RSA (salariés agricoles)` },
  { value: 'None', label: $localize`:@@payroll.payroll-options.ts.non.assujetti.c686966b:Non assujetti` }
];

export const SUSPENSION_TYPE_OPTIONS = [
  { value: 'Disciplinary', label: $localize`:@@payroll.payroll-options.ts.disciplinaire.38954c3f:Disciplinaire` },
  { value: 'Administrative', label: $localize`:@@payroll.payroll-options.ts.administrative.67c743d3:Administrative` },
  { value: 'Other', label: $localize`:@@payroll.payroll-options.ts.autre.43dacf9e:Autre` }
];

export const LEAVE_TYPE_OPTIONS = [
  { value: 'Paid', label: $localize`:@@payroll.payroll-options.ts.conge.paye.846d0e23:Congé payé` },
  { value: 'Unpaid', label: $localize`:@@payroll.payroll-options.ts.conge.sans.solde.85a161af:Congé sans solde` },
  { value: 'Sick', label: $localize`:@@payroll.payroll-options.ts.maladie.37c2435e:Maladie` },
  { value: 'Maternity', label: $localize`:@@payroll.payroll-options.ts.maternite.cb256f52:Maternité` },
  { value: 'Paternity', label: $localize`:@@payroll.payroll-options.ts.conge.paternite.973e8b96:Congé paternité` },
  { value: 'Bereavement', label: $localize`:@@payroll.payroll-options.ts.conge.deces.cf3f357b:Congé décès` },
  { value: 'Recovery', label: $localize`:@@payroll.payroll-options.ts.recuperation.9bbc4b41:Récupération` },
  { value: 'Unjustified', label: $localize`:@@payroll.payroll-options.ts.absence.injustifiee.8fbb1a88:Absence injustifiée` },
  { value: 'Other', label: $localize`:@@payroll.payroll-options.ts.autre.43dacf9e:Autre` }
];

export const OVERTIME_RATE_OPTIONS = [
  { value: 125, label: '125 %' },
  { value: 150, label: '150 %' },
  { value: 175, label: $localize`:@@payroll.payroll-options.ts.175.nuit.ferie.9004a213:175 % (nuit / férié)` },
  { value: 200, label: '200 %' }
];

export const WEEKLY_REGIME_OPTIONS = [
  { value: 'FortyEightHours', label: $localize`:@@payroll.payroll-options.ts.48.h.semaine.regime.general.02bed6bc:48 h / semaine (régime général)` },
  { value: 'FortyHours', label: $localize`:@@payroll.payroll-options.ts.40.h.semaine.8710dfb3:40 h / semaine` }
];

/** Diviseur mensuel du taux horaire selon le régime hebdomadaire du contrat. */
export function weeklyRegimeDivisor(weeklyRegime?: string): string {
  return weeklyRegime === 'FortyHours' ? '173,33' : '208';
}

/** Taux de majoration légal proposé par défaut selon le régime hebdomadaire. */
export function defaultOvertimeRate(weeklyRegime?: string): number {
  return weeklyRegime === 'FortyHours' ? 125 : 175;
}

/**
 * Taux de majoration proposés pour un salarié : taux légaux du régime en tête,
 * complétés des taux étendus quand l'option de l'exercice les autorise.
 * Reflète la validation backend (OvertimeRatePercentExtensions.IsValid).
 */
export function overtimeRateOptions(weeklyRegime?: string, extendedRatesEnabled = false): { value: number; label: string }[] {
  const h40 = weeklyRegime === 'FortyHours';
  const options: { value: number; label: string }[] = [
    { value: 125, label: h40 ? $localize`:@@payroll.payroll-options.ts.125.legal.41e.a.48e.heure.44e9a600:125 % (légal — 41e à 48e heure)` : '125 %' },
    { value: 150, label: h40 ? $localize`:@@payroll.payroll-options.ts.150.legal.au.dela.de.48.h.122fe97c:150 % (légal — au-delà de 48 h)` : '150 %' }
  ];
  if (!h40)
    options.push({ value: 175, label: $localize`:@@payroll.payroll-options.ts.175.taux.legal.48.h.49592761:175 % (taux légal 48 h)` });
  else if (extendedRatesEnabled)
    options.push({ value: 175, label: $localize`:@@payroll.payroll-options.ts.175.nuit.ferie.9004a213:175 % (nuit / férié)` });
  if (extendedRatesEnabled)
    options.push({ value: 200, label: '200 %' });
  return options;
}

export { TUNISIAN_GOVERNORATES } from '@core/validators/tunisian-payroll.validators';

export const TUNISIAN_GOVERNORATE_OPTIONS = [
  'Ariana', 'Béja', 'Ben Arous', 'Bizerte', 'Gabès', 'Gafsa', 'Jendouba',
  'Kairouan', 'Kasserine', 'Kébili', 'Le Kef', 'Mahdia', 'La Manouba',
  'Médenine', 'Monastir', 'Nabeul', 'Sfax', 'Sidi Bouzid', 'Siliana',
  'Sousse', 'Tataouine', 'Tozeur', 'Tunis', 'Zaghouan'
].map(g => ({ value: g, label: g }));
