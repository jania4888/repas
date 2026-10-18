import {
  AccountingOverviewDashboardDto,
  DashboardComparison,
  ExpenseCategoryDto,
  MainAccountRowDto,
  MonthlyNetResultPointDto,
  MonthlyRevenuePointDto,
  ThirdPartySituationDto
} from '../services/accounting.service';
import { buildSparklinePaths } from '@shared/utils/sparkline-path.util';

/**
 * Fonctions pures du tableau de bord comptable (ouverture d'un dossier délégué).
 *
 * Toute la logique d'affichage (formats, couleurs, données des graphiques) vit ici plutôt que
 * dans le composant : elle se teste sans TestBed, ce qui est décisif sur un écran où une erreur
 * de signe ou de palette se voit à peine mais change la lecture financière du dossier.
 */

export type DeltaTone = 'positive' | 'negative' | 'neutral';

export interface PeriodOption {
  value: string;
  fiscalYear: number;
  month: number;
  label: string;
}

export interface ComparisonOption {
  value: DashboardComparison;
  label: string;
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string;
  tension?: number;
  fill?: boolean;
  borderRadius?: number;
  borderWidth?: number;
  cutout?: string;
}

export interface SimpleChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface ExpenseLegendItem {
  key: string;
  label: string;
  amount: number;
  percent: number;
  color: string;
}

export interface ThirdPartyChartResult {
  chartData: SimpleChartData;
  total: number;
}

/** Palette fixe des 6 catégories de charges (ordre backend : purchases…other). */
export const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  purchases: '#2563eb',
  externalServices: '#0ea5e9',
  personnel: '#8b5cf6',
  taxes: '#f59e0b',
  depreciation: '#10b981',
  other: '#94a3b8'
};

/** Couleurs des deux graphiques « Situation clients/fournisseurs ». */
export const THIRD_PARTY_COLORS = { notDue: '#2563eb', overdue: '#ef4444' };

const COMPACT_FORMATTER_M = new Intl.NumberFormat('fr-TN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Abrège un montant pour les axes de graphique : 12 500 → « 12,5 K ». */
export function formatCompactTnd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${COMPACT_FORMATTER_M.format(value / 1_000_000)} M`;
  if (abs >= 1_000) return `${COMPACT_FORMATTER_M.format(value / 1_000)} K`;
  return String(Math.round(value));
}

/** Variation en pourcentage, signe explicite : « +12,5 % », « -6,2 % », « — » si inconnue. */
export function formatDeltaPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')} %`;
}

/** Arrondi à une décimale pour l'affichage du chip de variation `app-stat-card`. */
export function roundToOneDecimal(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value * 10) / 10;
}

/** Sens de la variation : sert à teinter le chip / la flèche. */
export function deltaTone(value: number | null | undefined): DeltaTone {
  if (value == null || Number.isNaN(value) || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

/** Vrai lorsque la période sélectionnée n'a aucune écriture validée (état vide). */
export function isEmptyPeriod(data: AccountingOverviewDashboardDto | null): boolean {
  return !!data && !data.hasEntriesInPeriod;
}

/** Urgence d'une échéance fiscale : « soon » (≤ 7 jours) colore la pastille en orange. */
export function deadlineUrgency(daysRemaining: number): 'soon' | 'later' {
  return daysRemaining <= 7 ? 'soon' : 'later';
}

/** Libellé « J-n » (ou « J+n » si l'échéance est dépassée) d'une échéance fiscale. */
export function deadlineCountdownLabel(daysRemaining: number): string {
  if (daysRemaining < 0) return `J+${Math.abs(daysRemaining)}`;
  return `J-${daysRemaining}`;
}

/** Icône FontAwesome selon le type MIME d'un document récent. */
export function documentIcon(contentType: string | null | undefined): string {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('pdf')) return 'fa-solid fa-file-pdf';
  if (type.includes('image')) return 'fa-solid fa-file-image';
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) return 'fa-solid fa-file-excel';
  if (type.includes('word') || type.includes('document')) return 'fa-solid fa-file-word';
  return 'fa-solid fa-file';
}

/** Options du sélecteur de période : chaque année disponible × 12 mois, libellé « Mois AAAA ». */
export function periodOptions(availableYears: number[]): PeriodOption[] {
  const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
  const options: PeriodOption[] = [];
  for (const year of availableYears) {
    for (let month = 1; month <= 12; month++) {
      const monthName = monthFormatter.format(new Date(2020, month - 1, 1));
      const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
      options.push({ value: `${year}-${month}`, fiscalYear: year, month, label: `${capitalized} ${year}` });
    }
  }
  return options;
}

/** Les deux modes de comparaison proposés au-dessus des KPI. */
export function comparisonOptions(): ComparisonOption[] {
  return [
    { value: 'previous-month', label: $localize`:@@accounting.accounting-dashboard.view-model.ts.vs.mois.precedent.710c5821:vs Mois précédent` },
    { value: 'previous-year', label: $localize`:@@accounting.accounting-dashboard.view-model.ts.vs.n.1.b18e6842:vs N-1` }
  ];
}

/** Données du graphique « Évolution du chiffre d'affaires » (barres, N-1 gris / N bleu). */
export function buildRevenueChartData(points: MonthlyRevenuePointDto[], fiscalYear: number): SimpleChartData {
  return {
    labels: points.map(p => p.label),
    datasets: [
      {
        label: String(fiscalYear - 1),
        data: points.map(p => p.previousYear),
        // Gris moyen + contour foncé : contraste suffisant (≥ 3:1) sur fond blanc.
        backgroundColor: '#94a3b8',
        borderColor: '#475569',
        borderWidth: 1,
        borderRadius: 4
      },
      {
        label: String(fiscalYear),
        data: points.map(p => p.current),
        backgroundColor: '#2563eb',
        borderRadius: 4
      }
    ]
  };
}

/** Données du graphique « Résultat net mensuel » (ligne, aire bleue translucide). */
export function buildNetResultChartData(points: MonthlyNetResultPointDto[]): SimpleChartData {
  return {
    labels: points.map(p => p.label),
    datasets: [
      {
        label: $localize`:@@accounting.accounting-dashboard.view-model.ts.resultat.net.1bbe6f47:Résultat net`,
        data: points.map(p => p.netResult),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.12)',
        tension: 0.35,
        fill: true
      }
    ]
  };
}

/** Données + légende du doughnut « Répartition des charges » (cutout 68 %). */
export function buildExpenseDoughnutData(categories: ExpenseCategoryDto[]): {
  chartData: SimpleChartData;
  legend: ExpenseLegendItem[];
} {
  const legend = categories.map(c => ({
    key: c.key,
    label: c.label,
    amount: c.amount,
    percent: c.percent,
    color: EXPENSE_CATEGORY_COLORS[c.key] ?? EXPENSE_CATEGORY_COLORS['other']
  }));
  return {
    chartData: {
      labels: legend.map(l => l.label),
      datasets: [
        {
          label: $localize`:@@accounting.accounting-dashboard.view-model.ts.charges.cfc370a2:Charges`,
          data: legend.map(l => l.amount),
          backgroundColor: legend.map(l => l.color),
          cutout: '68%'
        }
      ]
    },
    legend
  };
}

/** Données du doughnut « À échéance / Échus » d'une situation clients ou fournisseurs. */
export function buildThirdPartyChartData(situation: ThirdPartySituationDto | null): ThirdPartyChartResult | null {
  if (!situation) return null;
  return {
    chartData: {
      labels: [
        $localize`:@@accounting.accounting-dashboard.view-model.ts.a.echeance.ea798677:À échéance`,
        $localize`:@@accounting.accounting-dashboard.view-model.ts.echus.c8e22b3b:Échus`
      ],
      datasets: [
        {
          label: $localize`:@@accounting.accounting-dashboard.view-model.ts.situation.30f6fed8:Situation`,
          data: [situation.notDue, situation.overdue],
          backgroundColor: [THIRD_PARTY_COLORS.notDue, THIRD_PARTY_COLORS.overdue],
          cutout: '68%'
        }
      ]
    },
    total: situation.total
  };
}

/** Points du sparkline SVG inline (table « Suivi des comptes principaux »). */
export function mainAccountSparkline(row: MainAccountRowDto): { line: string; area: string } | null {
  return buildSparklinePaths(row.sparkline);
}

/** Icône FontAwesome + libellé accessible d'une variation (flèche haut/bas, neutre). */
export function deltaIconClass(tone: DeltaTone): string {
  if (tone === 'positive') return 'fa-solid fa-arrow-trend-up';
  if (tone === 'negative') return 'fa-solid fa-arrow-trend-down';
  return 'fa-solid fa-minus';
}

/** Âge relatif d'un document (« il y a 3 jours ») exprimé en unité Intl la plus pertinente. */
export function relativeDocumentAge(
  createdAt: string,
  now: Date = new Date()
): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const created = new Date(createdAt);
  const diffMs = created.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (Math.abs(diffDays) < 1) return { value: 0, unit: 'day' };
  if (Math.abs(diffDays) < 30) return { value: diffDays, unit: 'day' };
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return { value: diffMonths, unit: 'month' };
  return { value: Math.round(diffMonths / 12), unit: 'year' };
}

