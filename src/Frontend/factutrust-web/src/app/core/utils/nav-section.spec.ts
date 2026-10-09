import { NavSubItem } from '@core/config/app-navigation.registry';
import {
  isReportsNavChild,
  reportsGroupIsContiguousSuffix,
  showReportsSeparator
} from './nav-section';

describe('nav-section', () => {
  const page = (route: string): NavSubItem => ({ label: route, route });
  const report = (route: string): NavSubItem => ({ label: route, route, navGroup: 'reports' });

  it('detects only the reports presentation group', () => {
    expect(isReportsNavChild(report('/reports/sales'))).toBeTrue();
    expect(isReportsNavChild(page('/invoices'))).toBeFalse();
    expect(isReportsNavChild(undefined)).toBeFalse();
  });

  it('shows the heading before the first report, including when it is the first child', () => {
    const onlyReports = [report('/reports/fiches')];
    expect(showReportsSeparator(onlyReports, 0)).toBeTrue();

    const mixed = [page('/invoices'), report('/reports/sales-journal'), report('/reports/sales')];
    expect(showReportsSeparator(mixed, 0)).toBeFalse();
    expect(showReportsSeparator(mixed, 1)).toBeTrue();
    expect(showReportsSeparator(mixed, 2)).toBeFalse();
  });

  it('shows nothing when the visible list has no report child', () => {
    const operational = [page('/invoices'), page('/quotes')];
    expect(operational.some((_, index) => showReportsSeparator(operational, index))).toBeFalse();
    expect(showReportsSeparator([], 0)).toBeFalse();
  });

  it('keeps a single heading after a cabinet-style filter that drops blocked reports', () => {
    const visible = [
      page('/invoices'),
      page('/invoices/unpaid'),
      report('/reports/client-balances'),
      report('/reports/sales')
    ];
    const flags = visible.map((_, index) => showReportsSeparator(visible, index));
    expect(flags).toEqual([false, false, true, false]);
    expect(reportsGroupIsContiguousSuffix(visible)).toBeTrue();
  });

  it('rejects a report inserted between operational entries', () => {
    const broken = [page('/invoices'), report('/reports/sales-journal'), page('/recurring-contracts')];
    expect(showReportsSeparator(broken, 1)).toBeTrue();
    expect(reportsGroupIsContiguousSuffix(broken)).toBeFalse();
    expect(reportsGroupIsContiguousSuffix(undefined)).toBeTrue();
  });
});
