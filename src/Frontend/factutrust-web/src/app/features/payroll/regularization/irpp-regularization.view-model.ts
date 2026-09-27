import { IrppRegularizationMonth, IrppRegularizationPreview } from '@core/services/payroll.service';

/**
 * Fonctions pures de l'écran de régularisation IRPP.
 * Extraites du composant pour être testables sans TestBed (même approche que
 * `vat-declaration.view-model.ts`).
 */

export type RegularizationOutcome = 'rappel' | 'restitution' | 'neutre';

/** Ligne du tableau « Détail du calcul ». */
export interface RegularizationDetailRow {
  label: string;
  netTaxable: number;
  irpp: number;
  css: number;
  /** Ligne de total : rendue en gras. */
  isTotal?: boolean;
  /** Mois non encore arrêté (le mois régularisé lui-même). */
  isPending?: boolean;
}

/** Ligne de la carte « Récapitulatif ». */
export interface RegularizationSummaryRow {
  label: string;
  value: number;
  /** Ligne mise en avant (l'écart final). */
  highlight?: boolean;
  /** Trait de séparation au-dessus. */
  separator?: boolean;
}

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

export function monthLabel(month: number): string {
  return month >= 1 && month <= 12 ? MONTH_LABELS[month - 1] : String(month);
}

/** Sens de la régularisation, à partir de l'écart total. */
export function resolveOutcome(totalDelta: number): RegularizationOutcome {
  if (totalDelta > 0) return 'rappel';
  if (totalDelta < 0) return 'restitution';
  return 'neutre';
}

export function outcomeLabel(outcome: RegularizationOutcome): string {
  switch (outcome) {
    case 'rappel': return 'Rappel';
    case 'restitution': return 'Restitution';
    default: return 'Aucun écart';
  }
}

/** Sévérité PrimeNG du badge : un rappel prélève, une restitution rend. */
export function outcomeSeverity(outcome: RegularizationOutcome): 'warn' | 'success' | 'info' {
  switch (outcome) {
    case 'rappel': return 'warn';
    case 'restitution': return 'success';
    default: return 'info';
  }
}

export function outcomeHint(outcome: RegularizationOutcome): string {
  switch (outcome) {
    case 'rappel':
      return 'Un montant complémentaire sera retenu sur le bulletin du mois.';
    case 'restitution':
      return 'Le trop-perçu d’impôt sera reversé au salarié sur le bulletin du mois.';
    default:
      return 'La retenue mensuelle correspond déjà à l’impôt dû : rien à porter sur le bulletin.';
  }
}

/**
 * Tableau « Détail du calcul » : un mois par ligne, plus la ligne de total.
 * Le montant affiché est toujours positif ; c’est le libellé qui porte le sens.
 */
export function buildDetailRows(months: IrppRegularizationMonth[]): RegularizationDetailRow[] {
  const rows: RegularizationDetailRow[] = months.map(m => ({
    label: m.monthLabel || monthLabel(m.month),
    netTaxable: m.monthlyNetTaxable,
    irpp: m.irpp,
    css: m.css,
    isPending: !m.isSettled
  }));

  rows.push({
    label: $localize`:@@payroll.irpp-regularization.view-model.ts.total.b25928c6:Total`,
    netTaxable: sum(months, m => m.monthlyNetTaxable),
    irpp: sum(months, m => m.irpp),
    css: sum(months, m => m.css),
    isTotal: true
  });

  return rows;
}

/** Carte « Récapitulatif » : du cumul jusqu’à l’écart à porter. */
export function buildSummaryRows(preview: IrppRegularizationPreview): RegularizationSummaryRow[] {
  return [
    { label: $localize`:@@payroll.irpp-regularization.view-model.ts.cumul.net.imposable.c17a5048:Cumul net imposable`, value: preview.cumulNetTaxable },
    { label: $localize`:@@payroll.irpp-regularization.view-model.ts.irpp.du.sur.le.cumul.43a5b88d:IRPP dû sur le cumul`, value: preview.irppDue },
    { label: $localize`:@@payroll.irpp-regularization.view-model.ts.irpp.deja.retenu.52296423:IRPP déjà retenu`, value: preview.cumulIrppWithheld },
    { label: $localize`:@@payroll.irpp-regularization.view-model.ts.ecart.irpp.b4e086c7:Écart IRPP`, value: preview.irppDelta, separator: true },
    { label: $localize`:@@payroll.irpp-regularization.view-model.ts.ecart.css.367c8a47:Écart CSS`, value: preview.cssDelta },
    { label: $localize`:@@payroll.irpp-regularization.view-model.ts.regularisation.a.porter.1cf4ad8a:Régularisation à porter`, value: preview.totalDelta, highlight: true, separator: true }
  ];
}

/**
 * Message expliquant une année incomplète — sinon la restitution importante d’un salarié
 * entré en cours d’année passe pour une anomalie.
 */
export function partialYearNotice(preview: IrppRegularizationPreview): string | null {
  if (!preview.isPartialYear) return null;

  const count = preview.monthsCounted;
  const plural = count > 1 ? 's' : '';
  return `Année incomplète : ${count} bulletin${plural} arrêté${plural} sur ${preview.month}. `
    + 'Le barème annuel s’applique au revenu réellement perçu, ce qui explique un écart important.';
}

/** Avertissement lorsque l’exercice n’a pas activé la fonctionnalité. */
export function featureDisabledNotice(preview: IrppRegularizationPreview): string | null {
  if (!preview.isFeatureDisabled) return null;
  return 'La régularisation IRPP n’est pas activée pour cet exercice : ce calcul reste indicatif '
    + 'et ne sera pas porté sur les bulletins. Activez-la dans RH & Paie → Paramètres paie.';
}

/** Vrai si l’écart mérite d’être enregistré (au millime près). */
export function isWorthSaving(preview: IrppRegularizationPreview | null): boolean {
  return !!preview && Math.abs(preview.totalDelta) >= 0.001;
}

function sum<T>(items: T[], select: (item: T) => number): number {
  const total = items.reduce((acc, item) => acc + select(item), 0);
  return Math.round(total * 1000) / 1000;
}
