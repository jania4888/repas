import {
  DeclarationCalculationOrigin,
  MonthlyDeclarationTrackingRowDto,
  VatDeclarationStatus
} from '../services/accounting.service';
import { formatPeriodLabel, round3 } from '../vat-declaration/vat-declaration.view-model';

/**
 * Logique d'affichage de l'écran « Suivi DM ». Fonctions pures : le conteneur ne garde que les
 * signaux et l'appel réseau.
 */

/**
 * Exercice proposé à l'ouverture : l'année du mois **écoulé**. Au 1er janvier, le suivi utile est
 * encore celui de l'année qui vient de se terminer — c'est elle dont les déclarations se déposent.
 */
export function defaultTrackingYear(today: Date): number {
  const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return previousMonth.getFullYear();
}

export function isTrackableYear(year: number): boolean {
  return Number.isInteger(year) && year >= 2000 && year <= 2100;
}

/**
 * État d'un mois. `late` prime sur `missing` : les deux disent qu'il n'y a pas de dépôt, mais l'un
 * appelle une action aujourd'hui et l'autre est simplement une période à venir.
 */
export type DmTrackingState = 'locked' | 'submitted' | 'draft' | 'late' | 'missing';

export function trackingState(
  row: MonthlyDeclarationTrackingRowDto,
  today: Date
): DmTrackingState {
  if (row.exists) {
    if (row.status === VatDeclarationStatus.Locked) return 'locked';
    if (row.status === VatDeclarationStatus.Submitted) return 'submitted';
    return 'draft';
  }
  return isDeadlinePassed(row.filingDeadline, today) ? 'late' : 'missing';
}

function isDeadlinePassed(deadline: string, today: Date): boolean {
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return false;
  // Comparaison au jour : une échéance tombant aujourd'hui n'est pas encore dépassée.
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return day < now;
}

export function stateLabel(state: DmTrackingState): string {
  switch (state) {
    case 'locked':
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.verrouillee.af142775:Verrouillée`;
    case 'submitted':
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.deposee.8d55a917:Déposée`;
    case 'draft':
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.brouillon.57d2d7a7:Brouillon`;
    case 'late':
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.en.retard.40c1dde3:En retard`;
    default:
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.a.deposer.a9c5ca9a:À déposer`;
  }
}

/** Seuls les deux états qui appellent une action sont signalés ; les autres sont neutres. */
export function stateNeedsAttention(state: DmTrackingState): boolean {
  return state === 'late' || state === 'draft';
}

/** Phrase d'explication d'une ligne — ce que le lecteur doit en conclure. */
export function describeRow(row: MonthlyDeclarationTrackingRowDto, today: Date): string {
  const state = trackingState(row, today);
  switch (state) {
    case 'locked':
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.declaration.verrouillee.elle.ne.peut.plu.f7d225e4:Déclaration verrouillée : elle ne peut plus être modifiée.`;
    case 'submitted':
      return row.isRectificative
        ? $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.declaration.rectificative.n.revisionnumb.9012cbdc:Déclaration rectificative n° ${row.revisionNumber}:revisionNumber: déposée.`
        : $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.declaration.deposee.ece5d1c2:Déclaration déposée.`;
    case 'draft':
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.brouillon.enregistre.jamais.depose.3cb0b51e:Brouillon enregistré, jamais déposé.`;
    case 'late':
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.aucune.declaration.et.l.echeance.est.pas.d41e8eca:Aucune déclaration, et l’échéance est passée.`;
    default:
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.periode.non.encore.declaree.c8fae813:Période non encore déclarée.`;
  }
}

export interface DmTrackingSummary {
  filed: number;
  drafts: number;
  late: number;
  missing: number;
  /** Total à payer cumulé sur les périodes effectivement déposées. */
  totalToPay: number;
}

export function summariseTracking(
  rows: readonly MonthlyDeclarationTrackingRowDto[] | null | undefined,
  today: Date
): DmTrackingSummary {
  const summary: DmTrackingSummary = {
    filed: 0,
    drafts: 0,
    late: 0,
    missing: 0,
    totalToPay: 0
  };

  for (const row of rows ?? []) {
    switch (trackingState(row, today)) {
      case 'locked':
      case 'submitted':
        summary.filed++;
        // Un brouillon n'est pas un montant dû : il n'entre pas dans le cumul.
        summary.totalToPay = round3(summary.totalToPay + row.totalToPay);
        break;
      case 'draft':
        summary.drafts++;
        break;
      case 'late':
        summary.late++;
        break;
      default:
        summary.missing++;
    }
  }

  return summary;
}

/** Libellé de période, réutilisé de l'écran de déclaration pour que les deux disent pareil. */
export function periodLabel(year: number, month: number): string {
  return formatPeriodLabel(year, month);
}

/**
 * Le calcul qui a produit le dépôt de la période. « — » sans dépôt : la question ne se pose pas.
 * Les périodes antérieures au retrait du calcul câblé restent marquées « Historique » ; c'est ce
 * qu'elles sont, et le dire évite de laisser croire qu'elles ont été recalculées.
 */
export function rowOriginLabel(row: MonthlyDeclarationTrackingRowDto): string {
  switch (row.calculationOrigin) {
    case DeclarationCalculationOrigin.Historic:
      // « Historique » seul est un faux ami : ailleurs dans l'interface, le mot désigne un
      // journal d'évènements. La forme longue nomme ce dont il s'agit, et se traduit sans ambiguïté.
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.calcul.historique.8e4a1b73:Calcul historique`;
    case DeclarationCalculationOrigin.Configured:
      return $localize`:@@accounting.monthly-declaration-tracking.view-model.ts.calcul.parametre.5c90f2de:Calcul paramétré`;
    default:
      return '—';
  }
}
