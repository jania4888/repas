/** Options et libellés partagés par les états de contrôle paie. */

export const MONTH_LABELS = [
  '',
  $localize`:@@payroll.payroll-report-options.ts.janvier.7a32ae0f:Janvier`, $localize`:@@payroll.payroll-report-options.ts.fevrier.63fc1803:Février`, $localize`:@@payroll.payroll-report-options.ts.mars.1778011d:Mars`, $localize`:@@payroll.payroll-report-options.ts.avril.4efeee46:Avril`, $localize`:@@payroll.payroll-report-options.ts.mai.afe526a6:Mai`, $localize`:@@payroll.payroll-report-options.ts.juin.8b1e84b6:Juin`,
  $localize`:@@payroll.payroll-report-options.ts.juillet.e8e0920c:Juillet`, $localize`:@@payroll.payroll-report-options.ts.aout.460b6696:Août`, $localize`:@@payroll.payroll-report-options.ts.septembre.08d23f31:Septembre`, $localize`:@@payroll.payroll-report-options.ts.octobre.0ed28485:Octobre`, $localize`:@@payroll.payroll-report-options.ts.novembre.632580af:Novembre`, $localize`:@@payroll.payroll-report-options.ts.decembre.03bcd9b0:Décembre`
];

export const MONTH_OPTIONS = MONTH_LABELS
  .slice(1)
  .map((label, index) => ({ value: index + 1, label }));

/** Exercices proposés : deux ans en arrière, deux ans en avant (même règle que la DTS). */
export function yearOptions(): { value: number; label: string }[] {
  const current = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => {
    const y = current - 2 + i;
    return { value: y, label: String(y) };
  });
}

export function formatMonthList(months: number[]): string {
  return months.map(m => MONTH_LABELS[m] ?? `M${m}`).join(', ');
}
