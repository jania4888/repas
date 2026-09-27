import {
  ScreenAnalysisDataQuality,
  ScreenAnalysisHighlight,
  ScreenAnalysisPayloadV2,
  ScreenAnalysisSampling,
  ScreenAnalysisSamplingStrategy
} from '../models/ai-screen-analysis-payload.schema';

export interface BuildScreenPayloadV2Input {
  screenId: string;
  filters?: Record<string, unknown>;
  summary?: Record<string, number | string | null>;
  highlights?: ScreenAnalysisHighlight[];
  rows?: unknown[];
  sampling?: Partial<ScreenAnalysisSampling>;
  dataQuality?: Partial<ScreenAnalysisDataQuality>;
  extra?: Record<string, unknown>;
}

export function buildScreenAnalysisPayloadV2(input: BuildScreenPayloadV2Input): ScreenAnalysisPayloadV2 {
  const totalAvailable = input.sampling?.totalAvailable ?? input.rows?.length ?? 0;
  const included = input.sampling?.included ?? input.rows?.length ?? 0;
  const truncated = input.sampling?.truncated ?? included < totalAvailable;

  return {
    schemaVersion: '2',
    screenId: input.screenId,
    capturedAt: new Date().toISOString(),
    filters: input.filters ?? {},
    summary: input.summary ?? {},
    highlights: input.highlights ?? [],
    ...(input.rows && input.rows.length > 0 ? { rows: input.rows } : {}),
    sampling: {
      strategy: input.sampling?.strategy ?? 'all',
      totalAvailable,
      included,
      truncated
    },
    dataQuality: {
      hasData: input.dataQuality?.hasData ?? (totalAvailable > 0 || Object.keys(input.summary ?? {}).length > 0),
      isPartial: input.dataQuality?.isPartial ?? truncated,
      warnings: input.dataQuality?.warnings ?? []
    },
    ...(input.extra ?? {})
  };
}

export function sampleRowsSmart<T>(
  rows: T[],
  maxCount: number,
  strategy: ScreenAnalysisSamplingStrategy = 'anomaly-first',
  amountSelector?: (row: T) => number
): { rows: T[]; sampling: ScreenAnalysisSampling } {
  const totalAvailable = rows.length;
  if (totalAvailable <= maxCount) {
    return {
      rows,
      sampling: {
        strategy,
        totalAvailable,
        included: totalAvailable,
        truncated: false
      }
    };
  }

  let sampled: T[];
  switch (strategy) {
    case 'top-by-amount':
      sampled = [...rows]
        .sort((a, b) => Math.abs(amountSelector?.(b) ?? 0) - Math.abs(amountSelector?.(a) ?? 0))
        .slice(0, maxCount);
      break;
    case 'recent':
      sampled = rows.slice(-maxCount);
      break;
    case 'anomaly-first': {
      const withAmount = amountSelector
        ? [...rows].sort((a, b) => Math.abs(amountSelector(b)) - Math.abs(amountSelector(a)))
        : [...rows];
      sampled = withAmount.slice(0, maxCount);
      break;
    }
    default:
      sampled = rows.slice(0, maxCount);
  }

  return {
    rows: sampled,
    sampling: {
      strategy,
      totalAvailable,
      included: sampled.length,
      truncated: true
    }
  };
}

export function detectBasicAnomalies(
  rows: Array<{ label?: string; amount?: number; debit?: number; credit?: number }>,
  threshold: number
): ScreenAnalysisHighlight[] {
  const highlights: ScreenAnalysisHighlight[] = [];

  for (const row of rows) {
    const amount = row.amount ?? Math.max(row.debit ?? 0, row.credit ?? 0);
    if (amount >= threshold) {
      highlights.push({
        type: 'anomaly',
        label: row.label ?? 'Écriture',
        value: amount,
        context: 'Montant élevé'
      });
    }
  }

  return highlights.slice(0, 10);
}

export function computeYoYVariation(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function wrapLegacyAnalyzePayload(
  screenId: string,
  legacy: Record<string, unknown>,
  options?: {
    rowsKey?: string;
    maxRows?: number;
    summaryKeys?: string[];
    filtersKeys?: string[];
  }
): ScreenAnalysisPayloadV2 {
  const rowsKey = options?.rowsKey ?? 'rows';
  const rawRows = (legacy[rowsKey] as unknown[]) ?? [];
  const maxRows = options?.maxRows ?? 200;
  const { rows, sampling } = sampleRowsSmart(rawRows, maxRows, 'anomaly-first');

  const summary: Record<string, number | string | null> = {};
  for (const key of options?.summaryKeys ?? ['summary']) {
    const val = legacy[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(summary, val as Record<string, number | string | null>);
    } else if (typeof val === 'number' || typeof val === 'string') {
      summary[key] = val as number | string;
    }
  }

  for (const [key, val] of Object.entries(legacy)) {
    if (['screen', 'screenId', rowsKey, 'filters', 'summary', 'pagination', 'noData', 'loading'].includes(key)) {
      continue;
    }
    if (typeof val === 'number' || typeof val === 'string' || val === null) {
      summary[key] = val as number | string | null;
    }
  }

  const filters = (legacy['filters'] as Record<string, unknown>) ?? {};
  for (const key of options?.filtersKeys ?? []) {
    if (legacy[key] != null) {
      filters[key] = legacy[key];
    }
  }

  const warnings: string[] = [];
  if (legacy['noData']) {
    warnings.push('Aucune donnée chargée');
  }
  if (legacy['pagination'] && typeof legacy['pagination'] === 'object') {
    const p = legacy['pagination'] as Record<string, unknown>;
    if (p['totalRecords'] && p['page'] && p['pageSize']) {
      const totalPages = Math.ceil(Number(p['totalRecords']) / Number(p['pageSize']));
      if (totalPages > 1) {
        warnings.push(`Pagination : page ${p['page']}/${totalPages}`);
      }
    }
  }

  const { [rowsKey]: _removed, ...extra } = legacy;

  return buildScreenAnalysisPayloadV2({
    screenId,
    filters,
    summary,
    rows,
    sampling,
    dataQuality: {
      hasData: !legacy['noData'] && (rawRows.length > 0 || Object.keys(summary).length > 0),
      isPartial: sampling.truncated || warnings.some(w => w.includes('Pagination')),
      warnings
    },
    extra
  });
}

export function buildNoDataPayload(screenId: string, reason = 'Aucune donnée chargée'): ScreenAnalysisPayloadV2 {
  return buildScreenAnalysisPayloadV2({
    screenId,
    summary: {},
    dataQuality: {
      hasData: false,
      isPartial: false,
      warnings: [reason]
    }
  });
}
