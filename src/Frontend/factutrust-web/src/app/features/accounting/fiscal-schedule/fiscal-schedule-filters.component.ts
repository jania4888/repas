import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirmClientDossier } from '@core/services/firm-assignment.service';
import { FiscalAssignableUserDto, FiscalScheduleFilters } from '../services/fiscal-schedule.service';
import {
  FISCAL_OBLIGATION_OPTIONS,
  FISCAL_STATUS_OPTIONS,
  MONTH_OPTIONS,
  QUARTER_OPTIONS
} from './fiscal-schedule.view-model';
import { FISCAL_SCHEDULE_SHARED_STYLES } from './fiscal-schedule-shared.styles';

export type FiscalPeriodMode = 'all' | 'month' | 'quarter' | 'year';

@Component({
  selector: 'app-fiscal-schedule-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <form class="filters-bar" (ngSubmit)="apply.emit()">
      <label *ngIf="isFirmScope">
        <ng-container i18n="@@accounting.fiscal-schedule.societe.45c9ec04"> Societe </ng-container>
        <select name="companyTenantId" [(ngModel)]="filters.companyTenantId" (ngModelChange)="filtersChange.emit(filters)">
          <option [ngValue]="null" i18n="@@accounting.fiscal-schedule.toutes.les.societes.382627d5">Toutes les societes</option>
          <option *ngFor="let company of companies" [ngValue]="company.companyTenantId">{{ company.companyName }}</option>
        </select>
      </label>
      <label>
        <ng-container i18n="@@accounting.fiscal-schedule.exercice.e171e2b0"> Exercice </ng-container>
        <select name="fiscalYear" [(ngModel)]="filters.fiscalYear" (ngModelChange)="onFiscalYearChange($event)">
          <option *ngFor="let year of years" [ngValue]="year">{{ year }}</option>
        </select>
      </label>
      <label>
        <ng-container i18n="@@accounting.fiscal-schedule.periode.85e181b5"> Periode </ng-container>
        <select name="periodMode" [(ngModel)]="periodMode" (ngModelChange)="onPeriodModeChange($event)">
          <option value="all" i18n="@@accounting.fiscal-schedule.tous.b97ae3b4">Tous</option>
          <option value="month" i18n="@@accounting.fiscal-schedule.mois.0d304bea">Mois</option>
          <option value="quarter" i18n="@@accounting.fiscal-schedule.trimestre.13116972">Trimestre</option>
          <option value="year" i18n="@@accounting.fiscal-schedule.exercice.e171e2b0">Exercice</option>
        </select>
      </label>
      <label *ngIf="periodMode === 'month'">
        <ng-container i18n="@@accounting.fiscal-schedule.mois.0d304bea"> Mois </ng-container>
        <select name="periodMonth" [(ngModel)]="filters.periodMonth" (ngModelChange)="filtersChange.emit(filters)">
          <option *ngFor="let month of months" [ngValue]="month.value">{{ month.label }}</option>
        </select>
      </label>
      <label *ngIf="periodMode === 'quarter'">
        <ng-container i18n="@@accounting.fiscal-schedule.trimestre.13116972"> Trimestre </ng-container>
        <select name="periodQuarter" [(ngModel)]="filters.periodQuarter" (ngModelChange)="filtersChange.emit(filters)">
          <option *ngFor="let quarter of quarters" [ngValue]="quarter.value">{{ quarter.label }}</option>
        </select>
      </label>
      <label>
        <ng-container i18n="@@accounting.fiscal-schedule.type.d.obligation.790fbe09"> Type d'obligation </ng-container>
        <select name="obligationType" [(ngModel)]="filters.obligationType" (ngModelChange)="filtersChange.emit(filters)">
          <option [ngValue]="null" i18n="@@accounting.fiscal-schedule.tous.b97ae3b4">Tous</option>
          <option *ngFor="let option of obligationOptions" [ngValue]="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label>
        <ng-container i18n="@@accounting.fiscal-schedule.statut.659499f3"> Statut </ng-container>
        <select name="status" [(ngModel)]="filters.status" (ngModelChange)="filtersChange.emit(filters)">
          <option [ngValue]="null" i18n="@@accounting.fiscal-schedule.tous.b97ae3b4">Tous</option>
          <option *ngFor="let option of statusOptions" [ngValue]="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label>
        <ng-container i18n="@@accounting.fiscal-schedule.responsable.44b58814"> Responsable </ng-container>
        <select name="responsibleUserId" [(ngModel)]="filters.responsibleUserId" (ngModelChange)="filtersChange.emit(filters)">
          <option [ngValue]="null" i18n="@@accounting.fiscal-schedule.tous.b97ae3b4">Tous</option>
          <option *ngFor="let user of users" [ngValue]="user.id">{{ user.displayName }}</option>
        </select>
      </label>
      <label>
        <ng-container i18n="@@accounting.fiscal-schedule.periode.du.a268cb17"> Periode du </ng-container>
        <input name="dueFrom" type="date" [(ngModel)]="filters.dueFrom" (ngModelChange)="onDateChange()">
      </label>
      <label>
        <ng-container i18n="@@accounting.fiscal-schedule.au.f095160c"> au </ng-container>
        <input name="dueTo" type="date" [(ngModel)]="filters.dueTo" (ngModelChange)="onDateChange()">
      </label>
      <p class="date-error" *ngIf="dateRangeError" i18n="@@accounting.fiscal-schedule.la.date.de.debut.doit.etre.anterieure.ou.egale.a.762c63b2">La date de debut doit etre anterieure ou egale a la date de fin.</p>
      <button class="icon-button apply" type="submit" [disabled]="dateRangeError">
        <i class="fa-solid fa-filter"></i><span i18n="@@accounting.fiscal-schedule.appliquer.les.filtres.9cdeaec0">Appliquer les filtres</span>
      </button>
    </form>
  `,
  styles: [FISCAL_SCHEDULE_SHARED_STYLES, `
    .filters-bar {
      display: grid;
      grid-template-columns: repeat(8, minmax(118px, 1fr));
      gap: 10px;
      align-items: end;
      padding: 12px;
      border: 1px solid #d8dee8;
      border-radius: 6px;
      background: #fff;
      margin-bottom: 14px;
    }
    .date-error {
      grid-column: 1 / -1;
      margin: 0;
      color: #b42318;
      font-size: 12px;
      font-weight: 600;
    }
    @media (max-width: 1180px) {
      .filters-bar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 720px) {
      .filters-bar { grid-template-columns: 1fr; }
    }
  `]
})
export class FiscalScheduleFiltersComponent implements OnChanges {
  @Input() filters!: FiscalScheduleFilters;
  @Input() years: number[] = [];
  @Input() isFirmScope = false;
  @Input() companies: FirmClientDossier[] = [];
  @Input() users: FiscalAssignableUserDto[] = [];

  @Output() apply = new EventEmitter<void>();
  @Output() filtersChange = new EventEmitter<FiscalScheduleFilters>();
  @Output() fiscalYearChange = new EventEmitter<number>();

  readonly obligationOptions = FISCAL_OBLIGATION_OPTIONS;
  readonly statusOptions = FISCAL_STATUS_OPTIONS;
  readonly months = MONTH_OPTIONS;
  readonly quarters = QUARTER_OPTIONS;

  periodMode: FiscalPeriodMode = 'all';
  dateRangeError = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['filters'] && this.filters) {
      this.periodMode = this.inferPeriodMode();
      this.validateDates();
    }
  }

  onFiscalYearChange(year: number): void {
    this.filters.dueFrom = `${year}-01-01`;
    this.filters.dueTo = `${year}-12-31`;
    this.filtersChange.emit(this.filters);
    this.fiscalYearChange.emit(year);
  }

  onPeriodModeChange(mode: FiscalPeriodMode): void {
    if (mode === 'all' || mode === 'year') {
      this.filters.periodMonth = null;
      this.filters.periodQuarter = null;
    } else if (mode === 'month') {
      this.filters.periodQuarter = null;
      this.filters.periodMonth ??= new Date().getMonth() + 1;
    } else if (mode === 'quarter') {
      this.filters.periodMonth = null;
      this.filters.periodQuarter ??= Math.ceil((new Date().getMonth() + 1) / 3);
    }
    this.filtersChange.emit(this.filters);
  }

  onDateChange(): void {
    this.validateDates();
    this.filtersChange.emit(this.filters);
  }

  private inferPeriodMode(): FiscalPeriodMode {
    if (this.filters.periodQuarter) return 'quarter';
    if (this.filters.periodMonth) return 'month';
    return 'all';
  }

  private validateDates(): void {
    const from = this.filters.dueFrom ?? '';
    const to = this.filters.dueTo ?? '';
    this.dateRangeError = !!from && !!to && from > to;
  }
}
