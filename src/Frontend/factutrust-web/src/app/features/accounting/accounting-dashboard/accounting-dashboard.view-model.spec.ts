import {
  buildExpenseDoughnutData,
  buildNetResultChartData,
  buildRevenueChartData,
  buildThirdPartyChartData,
  comparisonOptions,
  deadlineCountdownLabel,
  deadlineUrgency,
  deltaTone,
  documentIcon,
  formatCompactTnd,
  formatDeltaPercent,
  isEmptyPeriod,
  mainAccountSparkline,
  periodOptions,
  relativeDocumentAge
} from './accounting-dashboard.view-model';
import {
  AccountingOverviewDashboardDto,
  ExpenseCategoryDto,
  MainAccountRowDto,
  MonthlyNetResultPointDto,
  MonthlyRevenuePointDto,
  ThirdPartySituationDto
} from '../services/accounting.service';

describe('accounting-dashboard.view-model', () => {
  describe('formatCompactTnd', () => {
    it('abbreviates millions and thousands', () => {
      expect(formatCompactTnd(2_350_000)).toBe('2,4 M');
      expect(formatCompactTnd(12_500)).toBe('12,5 K');
      expect(formatCompactTnd(850)).toBe('850');
      expect(formatCompactTnd(null)).toBe('—');
    });
  });

  describe('formatDeltaPercent', () => {
    it('shows an explicit sign and one decimal', () => {
      expect(formatDeltaPercent(12.47)).toBe('+12,5 %');
      expect(formatDeltaPercent(-6.2)).toBe('-6,2 %');
      expect(formatDeltaPercent(0)).toBe('0,0 %');
      expect(formatDeltaPercent(null)).toBe('—');
    });
  });

  describe('deltaTone', () => {
    it('classifies positive, negative and neutral variations', () => {
      expect(deltaTone(5)).toBe('positive');
      expect(deltaTone(-5)).toBe('negative');
      expect(deltaTone(0)).toBe('neutral');
      expect(deltaTone(null)).toBe('neutral');
    });
  });

  describe('isEmptyPeriod', () => {
    it('is true only when the dashboard has no entries in the selected period', () => {
      expect(isEmptyPeriod(null)).toBe(false);
      expect(isEmptyPeriod({ hasEntriesInPeriod: false } as AccountingOverviewDashboardDto)).toBe(true);
      expect(isEmptyPeriod({ hasEntriesInPeriod: true } as AccountingOverviewDashboardDto)).toBe(false);
    });
  });

  describe('deadlineUrgency / deadlineCountdownLabel', () => {
    it('flags deadlines within 7 days as soon', () => {
      expect(deadlineUrgency(7)).toBe('soon');
      expect(deadlineUrgency(8)).toBe('later');
    });

    it('renders J-n for upcoming and J+n for overdue deadlines', () => {
      expect(deadlineCountdownLabel(3)).toBe('J-3');
      expect(deadlineCountdownLabel(0)).toBe('J-0');
      expect(deadlineCountdownLabel(-2)).toBe('J+2');
    });
  });

  describe('documentIcon', () => {
    it('maps common content types to a FontAwesome icon', () => {
      expect(documentIcon('application/pdf')).toBe('fa-solid fa-file-pdf');
      expect(documentIcon('image/png')).toBe('fa-solid fa-file-image');
      expect(documentIcon('application/vnd.ms-excel')).toBe('fa-solid fa-file-excel');
      expect(documentIcon('application/msword')).toBe('fa-solid fa-file-word');
      expect(documentIcon('application/octet-stream')).toBe('fa-solid fa-file');
      expect(documentIcon(null)).toBe('fa-solid fa-file');
    });
  });

  describe('periodOptions', () => {
    it('builds 12 month options per available year, capitalized', () => {
      const options = periodOptions([2025, 2026]);
      expect(options.length).toBe(24);
      expect(options[0]).toEqual(jasmine.objectContaining({ fiscalYear: 2025, month: 1 }));
      expect(options[0].label.startsWith('Janvier')).toBe(true);
      expect(options[12]).toEqual(jasmine.objectContaining({ fiscalYear: 2026, month: 1 }));
    });
  });

  describe('comparisonOptions', () => {
    it('exposes the two fixed comparison modes', () => {
      const options = comparisonOptions();
      expect(options.map(o => o.value)).toEqual(['previous-month', 'previous-year']);
    });
  });

  describe('buildRevenueChartData', () => {
    it('builds a two-series bar chart, N-1 then N', () => {
      const points: MonthlyRevenuePointDto[] = [
        { month: 1, label: 'Jan', current: 1000, previousYear: 800 },
        { month: 2, label: 'Fév', current: 1200, previousYear: 900 }
      ];
      const chart = buildRevenueChartData(points, 2026);
      expect(chart.labels).toEqual(['Jan', 'Fév']);
      expect(chart.datasets[0].label).toBe('2025');
      expect(chart.datasets[0].data).toEqual([800, 900]);
      expect(chart.datasets[1].label).toBe('2026');
      expect(chart.datasets[1].data).toEqual([1000, 1200]);
    });
  });

  describe('buildNetResultChartData', () => {
    it('builds a single line dataset of net results', () => {
      const points: MonthlyNetResultPointDto[] = [
        { month: 1, label: 'Jan', revenue: 1000, expenses: 700, netResult: 300 }
      ];
      const chart = buildNetResultChartData(points);
      expect(chart.datasets[0].data).toEqual([300]);
      expect(chart.datasets[0].tension).toBe(0.35);
      expect(chart.datasets[0].fill).toBe(true);
    });
  });

  describe('buildExpenseDoughnutData', () => {
    it('colors each category from the fixed palette, by key', () => {
      const categories: ExpenseCategoryDto[] = [
        { key: 'purchases', label: 'Achats', amount: 1000, percent: 50 },
        { key: 'personnel', label: 'Personnel', amount: 1000, percent: 50 }
      ];
      const { chartData, legend } = buildExpenseDoughnutData(categories);
      expect(legend[0].color).toBe('#2563eb');
      expect(legend[1].color).toBe('#8b5cf6');
      expect(chartData.datasets[0].cutout).toBe('68%');
    });
  });

  describe('buildThirdPartyChartData', () => {
    it('returns null without a situation', () => {
      expect(buildThirdPartyChartData(null)).toBeNull();
    });

    it('splits the total between not-due and overdue amounts', () => {
      const situation: ThirdPartySituationDto = { asOf: '2026-10-17', total: 1000, notDue: 700, overdue: 300, thirdPartyCount: 5 };
      const result = buildThirdPartyChartData(situation);
      expect(result?.total).toBe(1000);
      expect(result?.chartData.datasets[0].data).toEqual([700, 300]);
    });
  });

  describe('mainAccountSparkline', () => {
    it('returns null with fewer than two points, a path otherwise', () => {
      const flat: MainAccountRowDto = {
        accountPrefix: '512',
        label: 'Banque',
        nature: 'Debit',
        balance: 100,
        previousBalance: 90,
        deltaAbsolute: 10,
        deltaPercent: 11.1,
        sparkline: [10]
      };
      expect(mainAccountSparkline(flat)).toBeNull();
      expect(mainAccountSparkline({ ...flat, sparkline: [10, 20, 15] })).not.toBeNull();
    });
  });

  describe('relativeDocumentAge', () => {
    it('expresses the difference in the most relevant unit', () => {
      const now = new Date('2026-10-17T00:00:00Z');
      expect(relativeDocumentAge('2026-10-17T00:00:00Z', now)).toEqual({ value: 0, unit: 'day' });
      expect(relativeDocumentAge('2026-10-14T00:00:00Z', now)).toEqual({ value: -3, unit: 'day' });
      expect(relativeDocumentAge('2026-06-17T00:00:00Z', now).unit).toBe('month');
    });
  });

});
