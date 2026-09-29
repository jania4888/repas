import {
  MonthlyDeclarationParityBoxDto,
  MonthlyDeclarationParityFamilyDto,
  MonthlyDeclarationParityMonthDto,
  MonthlyDeclarationParityReportDto,
  ParityVerdict
} from '../services/accounting.service';
import { familyLabel } from './monthly-declaration-config.view-model';
import { formatPeriodLabel } from '../vat-declaration/vat-declaration.view-model';

/**
 * Rapport de parité — la preuve, avant le retrait du calcul historique, que le calcul paramétré le
 * reproduit. Fonctions pures : l'écran ne décide rien, il met en forme ce que le serveur a prouvé.
 */

export interface DmParityRange {
  year: number;
  fromMonth: number;
  toMonth: number;
}

/** Plafond serveur : au plus douze mois, dans une même année. */
export const DM_PARITY_MAX_MONTHS = 12;

/**
 * Plage proposée : du premier mois de l'année au dernier mois échu. En janvier, l'année écoulée
 * entière — le mois en cours n'est jamais complet, le comparer ne prouverait rien.
 */
export function defaultParityRange(today: Date): DmParityRange {
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  return month === 1
    ? { year: year - 1, fromMonth: 1, toMonth: 12 }
    : { year, fromMonth: 1, toMonth: month - 1 };
}

/** Rend le motif du refus, ou `null` si la plage est envoyable. Miroir de la garde serveur. */
export function validateParityRange(range: DmParityRange): string | null {
  const { year, fromMonth, toMonth } = range;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return $localize`:@@accounting.monthly-declaration-parity.view-model.ts.exercice.invalide.3da242b6:Exercice invalide.`;
  }
  if (!Number.isInteger(fromMonth) || !Number.isInteger(toMonth) || fromMonth < 1 || toMonth > 12) {
    return $localize`:@@accounting.monthly-declaration-parity.view-model.ts.les.mois.vont.de.1.a.12.dd68f892:Les mois vont de 1 à 12.`;
  }
  if (fromMonth > toMonth) {
    return $localize`:@@accounting.monthly-declaration-parity.view-model.ts.le.premier.mois.doit.preceder.le.dernier.e2f0c500:Le premier mois doit précéder le dernier.`;
  }
  return null;
}

export function parityVerdictLabel(verdict: ParityVerdict): string {
  switch (verdict) {
    case ParityVerdict.Exact:
      return $localize`:@@accounting.monthly-declaration-parity.view-model.ts.identique.11720f37:Identique`;
    case ParityVerdict.Rounding:
      return $localize`:@@accounting.monthly-declaration-parity.view-model.ts.arrondi.prouve.9ddd4891:Arrondi prouvé`;
    default:
      return $localize`:@@accounting.monthly-declaration-parity.view-model.ts.ecart.6ae8dce8:Écart`;
  }
}

export type DmParityTone = 'success' | 'warning' | 'error';

export function parityVerdictTone(verdict: ParityVerdict): DmParityTone {
  switch (verdict) {
    case ParityVerdict.Exact:
      return 'success';
    case ParityVerdict.Rounding:
      return 'warning';
    default:
      return 'error';
  }
}

/** Phrase de conclusion du rapport : c'est elle qui ouvre, ou non, le retrait de l'historique. */
export function describeParityReport(report: MonthlyDeclarationParityReportDto): string {
  const count = report.months.length;
  if (report.readyForRetirement) {
    return report.roundingOnlyMonths > 0
      ? $localize`:@@accounting.monthly-declaration-parity.view-model.ts.aucun.ecart.sur.count.mois.exactmonths.i.3c3e901a:Aucun écart sur ${count}:count: mois : ${report.exactMonths}:exactMonths: identique(s), ${report.roundingOnlyMonths}:roundingOnlyMonths: dont les seuls écarts sont des arrondis prouvés. Exportez ce rapport et archivez-le : il ne pourra plus être produit après le retrait du calcul historique.`
      : $localize`:@@accounting.monthly-declaration-parity.view-model.ts.aucun.ecart.sur.count.mois.le.calcul.par.5cef7434:Aucun écart sur ${count}:count: mois : le calcul paramétré reproduit le calcul historique au millime. Exportez ce rapport et archivez-le : il ne pourra plus être produit après le retrait du calcul historique.`;
  }
  return $localize`:@@accounting.monthly-declaration-parity.view-model.ts.monthswithgap.mois.sur.count.portent.un.0f3abbce:${report.monthsWithGap}:monthsWithGap: mois sur ${count}:count: portent un écart non expliqué. Corrigez la configuration (ou cochez les familles manquantes) puis relancez le contrôle : le calcul historique ne peut pas être retiré en l'état.`;
}

/** Familles à montrer : celles qui portent un montant, ou qui diffèrent. Les autres encombrent. */
export function visibleParityFamilies(
  month: MonthlyDeclarationParityMonthDto
): MonthlyDeclarationParityFamilyDto[] {
  return month.families.filter(
    f => f.verdict !== ParityVerdict.Exact || f.legacy !== 0 || f.configured !== 0
  );
}

export function parityMonthLabel(report: MonthlyDeclarationParityReportDto, month: number): string {
  return formatPeriodLabel(report.year, month);
}

/** Nom du fichier de preuve : dossier, plage, et horodatage de production. */
export function parityFileName(report: MonthlyDeclarationParityReportDto, extension: 'json' | 'csv'): string {
  const range = `${report.year}-${pad(report.fromMonth)}_${report.year}-${pad(report.toMonth)}`;
  const stamp = report.generatedAtUtc.slice(0, 19).replace(/[-:T]/g, '');
  const nif = (report.nif || 'dossier').replace(/[^A-Za-z0-9]/g, '');
  return `parite-dm_${nif}_${range}_${stamp}.${extension}`;
}

/**
 * Export tableur : une ligne par famille et par case différente. Point-virgule et montants au
 * millime, comme les autres exports comptables ; précédé d'une marque d'ordre des octets pour que
 * les accents restent lisibles une fois ouvert dans un tableur.
 */
export function parityCsv(report: MonthlyDeclarationParityReportDto): string {
  const lines = [
    `Rapport de parité;${csv(report.companyName)};${csv(report.nif)};Produit le ${report.generatedAtUtc} par ${csv(report.generatedBy)}`,
    'Mois;Type;Élément;Incluse;Historique;Paramétré;Écart;Verdict'
  ];

  for (const month of report.months) {
    const label = csv(parityMonthLabel(report, month.month));
    if (month.error) {
      lines.push(`${label};Erreur;${csv(month.error)};;;;;${parityVerdictLabel(month.verdict)}`);
      continue;
    }
    for (const f of month.families) {
      lines.push(
        [
          label,
          'Famille',
          csv(familyLabel(f.family)),
          f.isIncluded ? 'Oui' : 'Non',
          f.legacy.toFixed(3),
          f.configured.toFixed(3),
          f.gap.toFixed(3),
          parityVerdictLabel(f.verdict)
        ].join(';')
      );
    }
    for (const b of month.boxDifferences) {
      lines.push(boxLine(label, b));
    }
  }

  return BYTE_ORDER_MARK + lines.join('\n');
}

/** Marque d'ordre des octets UTF-8, écrite par son code pour rester visible dans le source. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

function boxLine(label: string, box: MonthlyDeclarationParityBoxDto): string {
  return [
    label,
    'Case',
    csv(box.key),
    '',
    csv(box.legacy ?? ''),
    csv(box.configured ?? ''),
    '',
    parityVerdictLabel(box.verdict)
  ].join(';');
}

function csv(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function pad(month: number): string {
  return String(month).padStart(2, '0');
}
