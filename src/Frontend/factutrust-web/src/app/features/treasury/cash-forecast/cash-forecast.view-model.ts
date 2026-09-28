import {
  CashFlowBucket,
  CashFlowForecast,
  CashFlowInsight,
  CashFlowInsightSeverity,
  CashFlowScenario,
  CashFlowScenarioKind,
  CashFlowThresholds,
  CashPositionZone,
  CashFlowSourceType
} from '../models/cash-forecast.models';
import { erpDateLocale } from '@core/i18n/erp-format';

/**
 * Fonctions pures de l'écran de trésorerie prévisionnelle.
 *
 * Toute la logique d'affichage vit ici plutôt que dans le composant : elle se teste sans TestBed,
 * ce qui est décisif sur un écran où une erreur de seuil ou de signe se voit à peine mais change
 * la décision de gestion.
 */

/** Formate un montant en dinars, au millime. */
const AMOUNT_FORMATTER = new Intl.NumberFormat('fr-TN', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3
});

export function formatAmount(value: number | null | undefined, currency = 'TND'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${AMOUNT_FORMATTER.format(value)} ${currency}`;
}

/** Abrège un montant pour les axes du graphique : 12 500 → « 12,5K ». */
export function formatCompactAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace('.', ',')}K`;
  return String(Math.round(value));
}

/**
 * Zone de la jauge de position de trésorerie.
 *
 * Les comparaisons sont strictes vers le bas : un solde exactement égal au seuil critique est
 * critique, un solde égal au seuil de confort est confortable. Sans cette convention, un solde
 * posé pile sur un seuil basculerait au gré des arrondis.
 */
export function resolvePositionZone(
  balance: number,
  thresholds: CashFlowThresholds
): CashPositionZone {
  if (balance <= thresholds.criticalThreshold) return 'critical';
  if (balance < thresholds.comfortThreshold) return 'alert';
  return 'comfort';
}

/** Libellé français d'une zone. */
export function positionZoneLabel(zone: CashPositionZone): string {
  switch (zone) {
    case 'critical':
      return 'Critique';
    case 'alert':
      return 'Vigilance';
    default:
      return 'Confortable';
  }
}

/** Libellé français d'un scénario. */
export function scenarioLabel(kind: CashFlowScenarioKind): string {
  switch (kind) {
    case 'optimistic':
      return $localize`:@@treasury.cash-forecast.view-model.ts.scenario.optimiste.ffec2223:Scénario optimiste`;
    case 'realistic':
      return $localize`:@@treasury.cash-forecast.view-model.ts.scenario.realiste.4b8d48a3:Scénario réaliste`;
    default:
      return $localize`:@@treasury.cash-forecast.view-model.ts.scenario.pessimiste.05d17bd7:Scénario pessimiste`;
  }
}

/** Le scénario de référence, celui dont les chiffres alimentent les cartes KPI. */
export function realisticScenario(forecast: CashFlowForecast | null): CashFlowScenario | null {
  return forecast?.scenarios.find(s => s.kind === 'realistic') ?? null;
}

/** Ordre d'affichage des scénarios : optimiste, réaliste, pessimiste. */
export function orderedScenarios(forecast: CashFlowForecast | null): CashFlowScenario[] {
  const order: CashFlowScenarioKind[] = ['optimistic', 'realistic', 'pessimistic'];
  if (!forecast) return [];
  return [...forecast.scenarios].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)
  );
}

/** Alertes, les plus graves d'abord. */
export function orderedAlerts(forecast: CashFlowForecast | null): CashFlowInsight[] {
  const weight: Record<CashFlowInsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return (forecast?.insights ?? [])
    .filter(i => i.kind === 'alert')
    .sort((a, b) => weight[a.severity] - weight[b.severity]);
}

export function drivers(forecast: CashFlowForecast | null): CashFlowInsight[] {
  return (forecast?.insights ?? []).filter(i => i.kind === 'driver');
}

export function recommendations(forecast: CashFlowForecast | null): CashFlowInsight[] {
  return (forecast?.insights ?? []).filter(i => i.kind === 'recommendation');
}

/** Sévérité → jeton de sévérité PrimeNG (`p-tag`, bandeaux). */
export function severityTone(severity: CashFlowInsightSeverity): 'danger' | 'warn' | 'info' {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warn';
    default:
      return 'info';
  }
}

/** Libellé français d'une source de flux. */
export function sourceLabel(source: CashFlowSourceType): string {
  const labels: Record<CashFlowSourceType, string> = {
    client_invoice: $localize`:@@treasury.cash-forecast.view-model.ts.facture.client.83ca8a70:Facture client`,
    client_effet: $localize`:@@treasury.cash-forecast.view-model.ts.effet.client.bd4599d7:Effet client`,
    sales_order_backlog: $localize`:@@treasury.cash-forecast.view-model.ts.carnet.de.commandes.ec641454:Carnet de commandes`,
    supplier_invoice: $localize`:@@treasury.cash-forecast.view-model.ts.facture.fournisseur.37c58151:Facture fournisseur`,
    supplier_effet: $localize`:@@treasury.cash-forecast.view-model.ts.effet.fournisseur.605c18bc:Effet fournisseur`,
    purchase_order_commitment: $localize`:@@treasury.cash-forecast.view-model.ts.engagement.sur.commande.e06c2361:Engagement sur commande`,
    payroll: 'Salaires',
    payroll_contribution: 'Charges sociales',
    fiscal_obligation: $localize`:@@treasury.cash-forecast.view-model.ts.echeance.fiscale.136a3c07:Échéance fiscale`,
    loan_installment: $localize`:@@treasury.cash-forecast.view-model.ts.echeance.d.emprunt.854ae80a:Échéance d’emprunt`,
    recurring_commitment: $localize`:@@treasury.cash-forecast.view-model.ts.engagement.recurrent.607377af:Engagement récurrent`,
    recurring_journal_template: $localize`:@@treasury.cash-forecast.view-model.ts.ecriture.recurrente.898dbd99:Écriture récurrente`,
    manual: $localize`:@@treasury.cash-forecast.view-model.ts.saisie.manuelle.da81002e:Saisie manuelle`
  };
  return labels[source] ?? 'Autre flux';
}

/** Étiquette d'axe d'un mois : « Juin 2026 ». */
export function bucketLabel(bucket: CashFlowBucket): string {
  const date = new Date(bucket.periodStart);
  const label = date.toLocaleDateString(erpDateLocale('fr-TN'), { month: 'short', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Totaux de la colonne « Total » du tableau mensuel. */
export function monthlyTotals(buckets: CashFlowBucket[]): {
  inflows: number;
  outflows: number;
  netFlow: number;
} {
  return buckets.reduce(
    (acc, b) => ({
      inflows: acc.inflows + b.inflows,
      outflows: acc.outflows + b.outflows,
      netFlow: acc.netFlow + b.netFlow
    }),
    { inflows: 0, outflows: 0, netFlow: 0 }
  );
}

/**
 * Charge utile envoyée à l'assistant par le bouton « Analyser avec l'IA ».
 *
 * Volontairement resserrée sur ce que l'écran montre : l'assistant commente ce que l'utilisateur a
 * sous les yeux, il ne refait pas le calcul.
 */
export function buildAnalyzePayload(forecast: CashFlowForecast | null): unknown {
  if (!forecast) return { screen: 'treasury-cash-forecast', empty: true };

  return {
    screen: 'treasury-cash-forecast',
    periode: { debut: forecast.periodStart, fin: forecast.periodEnd },
    horizonMois: forecast.horizonMonths,
    devise: forecast.currency,
    soldeOuverture: forecast.openingBalance,
    soldeCloture: forecast.closingBalance,
    encaissements: forecast.totalInflows,
    decaissements: forecast.totalOutflows,
    fluxNet: forecast.netFlow,
    indiceConfiance: forecast.confidencePercent,
    ponderationIa: forecast.aiAdjustmentApplied,
    scenarios: forecast.scenarios.map(s => ({
      type: s.kind,
      soldeFinal: s.closingBalance,
      probabilite: s.probabilityPercent
    })),
    alertes: orderedAlerts(forecast).map(a => ({
      gravite: a.severity,
      titre: a.title,
      mois: a.periodStart
    })),
    buckets: forecast.buckets.map(b => ({
      mois: b.periodStart,
      encaissements: b.inflows,
      decaissements: b.outflows,
      soldeFin: b.closingBalance
    }))
  };
}
