import {
  FiscalObligationType,
  FiscalReminderChannel,
  FiscalScheduleEntryDto,
  FiscalScheduleStatus
} from '../services/fiscal-schedule.service';

export const FISCAL_OBLIGATION_OPTIONS = [
  { value: FiscalObligationType.MonthlyDeclaration, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.declaration.mensuelle.39fc41f1:Declaration mensuelle` },
  { value: FiscalObligationType.ProvisionalCorporateTaxInstallment, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.acompte.provisionnel.is.e88e5f0f:Acompte provisionnel IS` },
  { value: FiscalObligationType.WithholdingTax, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.retenue.a.la.source.c237b496:Retenue a la source` },
  { value: FiscalObligationType.Fodec, label: 'FODEC' },
  { value: FiscalObligationType.QuarterlyVat, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.tva.trimestrielle.7d36aac5:TVA trimestrielle` },
  { value: FiscalObligationType.FinancialStatements, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.etats.financiers.46e0b54c:Etats financiers` },
  { value: FiscalObligationType.SemiAnnualFinancialStatements, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.etats.financiers.semestriels.bfd4c924:Etats financiers semestriels` },
  { value: FiscalObligationType.PersonalIncomeTaxInstallment, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.irpp.acompte.842969fe:IRPP - Acompte` },
  { value: FiscalObligationType.CnssDtsQuarterly, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.dts.cnss.trimestrielle.5d8122b7:DTS CNSS trimestrielle` },
  { value: FiscalObligationType.PayrollIrppWithholding, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.retenues.irpp.paie.13c44993:Retenues IRPP paie` },
  { value: FiscalObligationType.Other, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.autre.obligation.5b94fdb0:Autre obligation` }
];

export const FISCAL_STATUS_OPTIONS = [
  { value: FiscalScheduleStatus.UpcomingWithin7Days, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.a.venir.7.j.db3e1dce:A venir (<= 7 j)` },
  { value: FiscalScheduleStatus.UpcomingAfter7Days, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.a.venir.7.j.313ecbe1:A venir (> 7 j)` },
  { value: FiscalScheduleStatus.Overdue, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.en.retard.40c1dde3:En retard` },
  { value: FiscalScheduleStatus.Deposited, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.deposee.2e14b7a3:Deposee` },
  { value: FiscalScheduleStatus.Validated, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.validee.ddb05630:Validee` },
  { value: FiscalScheduleStatus.Paid, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.payee.dde5f980:Payee` },
  { value: FiscalScheduleStatus.Cancelled, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.annulee.41da1848:Annulee` }
];

export const QUARTER_OPTIONS = [
  { value: 1, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.trimestre.1.88ddb608:Trimestre 1` },
  { value: 2, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.trimestre.2.3349b906:Trimestre 2` },
  { value: 3, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.trimestre.3.d38bffd3:Trimestre 3` },
  { value: 4, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.trimestre.4.2ae307d0:Trimestre 4` }
];

export const FISCAL_REMINDER_CHANNEL_OPTIONS = [
  { value: FiscalReminderChannel.Email, label: 'Email' },
  { value: FiscalReminderChannel.InApp, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.notification.c18f8f25:Notification` },
  { value: FiscalReminderChannel.Sms, label: 'SMS' }
];

export const MONTH_OPTIONS = [
  { value: 1, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.janvier.7a32ae0f:Janvier` },
  { value: 2, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.fevrier.e1115e15:Fevrier` },
  { value: 3, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.mars.1778011d:Mars` },
  { value: 4, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.avril.4efeee46:Avril` },
  { value: 5, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.mai.afe526a6:Mai` },
  { value: 6, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.juin.8b1e84b6:Juin` },
  { value: 7, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.juillet.e8e0920c:Juillet` },
  { value: 8, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.aout.de526f76:Aout` },
  { value: 9, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.septembre.08d23f31:Septembre` },
  { value: 10, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.octobre.0ed28485:Octobre` },
  { value: 11, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.novembre.632580af:Novembre` },
  { value: 12, label: $localize`:@@accounting.fiscal-schedule.view-model.ts.decembre.e0d2c417:Decembre` }
];

export function statusClass(status: number): string {
  switch (status) {
    case FiscalScheduleStatus.Overdue:
      return 'status-overdue';
    case FiscalScheduleStatus.UpcomingWithin7Days:
      return 'status-soon';
    case FiscalScheduleStatus.UpcomingAfter7Days:
      return 'status-upcoming';
    case FiscalScheduleStatus.Deposited:
      return 'status-deposited';
    case FiscalScheduleStatus.Validated:
      return 'status-validated';
    case FiscalScheduleStatus.Paid:
      return 'status-done';
    case FiscalScheduleStatus.Cancelled:
      return 'status-cancelled';
    default:
      return 'status-neutral';
  }
}

export function statusIcon(status: number): string {
  switch (status) {
    case FiscalScheduleStatus.Overdue:
      return 'fa-regular fa-circle-xmark';
    case FiscalScheduleStatus.UpcomingWithin7Days:
      return 'fa-regular fa-clock';
    case FiscalScheduleStatus.UpcomingAfter7Days:
      return 'fa-regular fa-calendar';
    case FiscalScheduleStatus.Deposited:
    case FiscalScheduleStatus.Paid:
    case FiscalScheduleStatus.Validated:
      return 'fa-regular fa-circle-check';
    default:
      return 'fa-regular fa-circle';
  }
}

export function formatFiscalDate(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return new Intl.DateTimeFormat('fr-TN').format(date);
}

export function toInputDate(value?: string | Date | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatFiscalAmount(amount: number, currency = 'TND'): string {
  return new Intl.NumberFormat('fr-TN', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(amount ?? 0) + ` ${currency}`;
}

export function defaultObligationLabel(type: number): string {
  return FISCAL_OBLIGATION_OPTIONS.find(o => o.value === Number(type))?.label ?? 'Autre obligation';
}

export function fiscalSourceRoute(entry: FiscalScheduleEntryDto): string | null {
  if (entry.obligationType === FiscalObligationType.MonthlyDeclaration) {
    const year = entry.fiscalYear;
    const month = entry.periodMonth ?? 1;
    return `/accounting/vat-declaration?year=${year}&month=${month}`;
  }
  if (entry.obligationType === FiscalObligationType.QuarterlyVat) {
    const year = entry.fiscalYear;
    const quarter = entry.periodQuarter ?? 1;
    const month = quarter * 3;
    return `/accounting/vat-declaration?year=${year}&month=${month}`;
  }
  if (entry.obligationType === FiscalObligationType.FinancialStatements || entry.obligationType === FiscalObligationType.SemiAnnualFinancialStatements) {
    return `/accounting/nct-statements?fiscalYear=${entry.fiscalYear}`;
  }
  if (entry.obligationType === FiscalObligationType.WithholdingTax) {
    return '/withholding-tax/tej-export';
  }
  if (entry.obligationType === FiscalObligationType.ProvisionalCorporateTaxInstallment
    || entry.obligationType === FiscalObligationType.PersonalIncomeTaxInstallment) {
    return `/accounting/nct-statements?fiscalYear=${entry.fiscalYear}`;
  }
  if (entry.obligationType === FiscalObligationType.CnssDtsQuarterly) {
    const quarter = entry.periodQuarter ?? 1;
    return `/payroll/declarations?year=${entry.fiscalYear}&quarter=${quarter}`;
  }
  if (entry.obligationType === FiscalObligationType.PayrollIrppWithholding) {
    return '/payroll/runs';
  }
  return null;
}
