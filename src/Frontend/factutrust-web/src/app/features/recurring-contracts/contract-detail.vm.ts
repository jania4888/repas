import {
  ContractEvolutionPoint,
  ContractFinancialSummary,
  RecurringContractDetail
} from '@core/services/recurring-contract.service';
import { fixedLinesMonthlyEstimate } from './recurring-contracts.ui-utils';
import { erpDateLocale } from '@core/i18n/erp-format';

/**
 * Calculs purs de la page détail contrat (pattern cash-forecast.view-model.ts) :
 * tout ce qui alimente les KPI, le donut et le graphique d'évolution vit ici pour
 * être testé sans TestBed.
 */

export interface ContractKpiVm {
  /** Montant total du contrat HT (summary phase 2, sinon estimation locale). */
  contractTotalHT: number | null;
  /** Équivalent mensuel HT (detail enrichi, sinon Σ lignes fixes normalisées). */
  monthlyEquivalentHT: number | null;
  nextBillingDate: string | null;
  /** Jours jusqu'à la prochaine échéance (négatif = en retard). */
  daysUntilNext: number | null;
  frequencyLabel: string;
  billingDayOfMonth: number;
  /** Durée en mois (null si contrat sans fin). */
  durationMonths: number | null;
  periodLabel: string;
  autoRenew: boolean;
  noticePeriodDays: number;
  renewalDeadline: string | null;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FORMATTER.format(d);
}

/** Jours entiers entre aujourd'hui et la date ISO (comparaison en UTC, sans effet DST). */
export function daysUntil(isoDate: string, today: Date = new Date()): number {
  const target = new Date(isoDate);
  const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

/**
 * Durée du contrat en mois. Les contrats « calendaires » (fin = début + N mois − 1 jour,
 * ex. 01/01→31/12) retombent sur N exact : on compte les mois entre début et fin + 1 jour.
 */
export function durationMonths(startIso: string, endIso: string): number | null {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  const endPlus = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  let months = (endPlus.getFullYear() - start.getFullYear()) * 12 + (endPlus.getMonth() - start.getMonth());
  if (endPlus.getDate() < start.getDate()) months -= 1;
  return months > 0 ? months : 1;
}

/** Date limite de résiliation/renouvellement : cancellationDeadline du détail enrichi, sinon fin/prochaine − préavis. */
export function renewalDeadlineOf(c: RecurringContractDetail): string | null {
  if (c.cancellationDeadline) return c.cancellationDeadline;
  const base = c.endDate ?? c.nextBillingDate ?? null;
  if (!base) return null;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - (c.noticePeriodDays ?? 0));
  return d.toISOString().slice(0, 10);
}

/** Σ des lignes « récurrent fixe » ramenée au mois selon la périodicité (repli local), null si aucune ligne fixe. */
export function fixedMonthlyEstimate(c: RecurringContractDetail): number | null {
  if (!(c.lines ?? []).some(l => l.lineType === 'FixedRecurring')) return null;
  return fixedLinesMonthlyEstimate(c.lines ?? [], c.billingFrequency);
}

export function buildKpiVm(c: RecurringContractDetail, s: ContractFinancialSummary | null): ContractKpiVm {
  // Total contrat : résumé financier phase 2 en priorité ; sinon estimation prudente depuis
  // le détail enrichi (montant de la période × occurrences à venir) ; sinon rien (« — »).
  let contractTotalHT: number | null = s?.totalContractAmount ?? null;
  if (contractTotalHT === null && c.currentPeriodTotalHT != null && c.upcomingOccurrencesCount != null) {
    contractTotalHT = c.currentPeriodTotalHT * c.upcomingOccurrencesCount;
  }

  const monthlyEquivalentHT = c.estimatedMonthlyAmount ?? fixedMonthlyEstimate(c);
  const months = c.endDate ? durationMonths(c.startDate, c.endDate) : null;

  return {
    contractTotalHT,
    monthlyEquivalentHT,
    nextBillingDate: c.nextBillingDate ?? null,
    daysUntilNext: c.nextBillingDate ? daysUntil(c.nextBillingDate) : null,
    frequencyLabel: c.billingFrequencyDisplay,
    billingDayOfMonth: c.billingDayOfMonth,
    durationMonths: months,
    periodLabel: c.endDate
      ? `${formatDateShort(c.startDate)} → ${formatDateShort(c.endDate)}`
      : $localize`:@@recurring-contracts.contract-detail.ts.depuis.le.formatdateshort.sans.fin.9c7bfd9d:Depuis le ${formatDateShort(c.startDate)}:formatDateShort: (sans fin)`,
    autoRenew: c.autoRenew,
    noticePeriodDays: c.noticePeriodDays,
    renewalDeadline: renewalDeadlineOf(c)
  };
}

/** Données du donut « Résumé financier » : facturé vs reste à facturer (somme = total). */
export function donutChartData(s: ContractFinancialSummary): { labels: string[]; datasets: unknown[] } {
  return {
    labels: [$localize`:@@recurring-contracts.contract-detail.ts.deja.facture.363ed4bc:Déjà facturé`, $localize`:@@recurring-contracts.contract-detail.ts.reste.a.facturer.401f18d8:Reste à facturer`],
    datasets: [
      {
        // remainingAmount peut être négatif en cas de surfacturation (D4) — chart.js exige ≥ 0.
        data: [s.totalInvoicedAmount, Math.max(0, s.remainingAmount)],
        backgroundColor: ['#3862f5', '#e2e8f0'],
        hoverBackgroundColor: ['#2a4fd1', '#cbd5e1'],
        borderWidth: 0
      }
    ]
  };
}

/** Libellé français d'un point mensuel « 2026-03 » → « mars 2026 » (plan maître §4.7). */
export function evolutionMonthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return month;
  return new Intl.DateTimeFormat(erpDateLocale('fr-FR'), { month: 'long', year: 'numeric' }).format(d);
}

/** Série pour le graphique ligne « Évolution » (ordre chronologique déjà garanti par l'API). */
export function evolutionChartData(points: ContractEvolutionPoint[]): { labels: string[]; datasets: unknown[] } {
  return {
    labels: points.map(p => evolutionMonthLabel(p.month)),
    datasets: [
      {
        label: $localize`:@@recurring-contracts.contract-detail.ts.montant.facture.5129f82a:Montant facturé`,
        data: points.map(p => p.amount),
        borderColor: '#3862f5',
        backgroundColor: 'rgba(56, 98, 245, 0.08)',
        fill: true,
        tension: 0.35
      }
    ]
  };
}
