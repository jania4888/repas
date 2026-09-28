import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FiscalScheduleSummaryDto } from '../services/fiscal-schedule.service';
import { FISCAL_SCHEDULE_SHARED_STYLES } from './fiscal-schedule-shared.styles';
import { formatFiscalAmount } from './fiscal-schedule.view-model';

@Component({
  selector: 'app-fiscal-schedule-summary',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="summary-grid" *ngIf="summary">
      <button class="summary-tile success" type="button" (click)="statusClick.emit(0)">
        <span i18n="@@accounting.fiscal-schedule.a.venir.lt.7.jours.f4beddec">A venir (&lt;= 7 jours)</span>
        <strong>{{ summary.upcomingWithin7DaysCount }}</strong>
        <em>{{ amount(summary.upcomingWithin7DaysAmount) }} TND</em>
      </button>
      <button class="summary-tile warning" type="button" (click)="statusClick.emit(1)">
        <span i18n="@@accounting.fiscal-schedule.a.venir.gt.7.jours.87078399">A venir (&gt; 7 jours)</span>
        <strong>{{ summary.upcomingAfter7DaysCount }}</strong>
        <em>{{ amount(summary.upcomingAfter7DaysAmount) }} TND</em>
      </button>
      <button class="summary-tile danger" type="button" (click)="statusClick.emit(2)">
        <span i18n="@@accounting.fiscal-schedule.en.retard.40c1dde3">En retard</span>
        <strong>{{ summary.overdueCount }}</strong>
        <em>{{ amount(summary.overdueAmount) }} TND</em>
      </button>
      <button class="summary-tile info" type="button" (click)="statusClick.emit(3)">
        <span i18n="@@accounting.fiscal-schedule.deposees.ce.mois.03dff7c7">Deposees ce mois</span>
        <strong>{{ summary.depositedThisMonthCount }}</strong>
        <em>{{ amount(summary.depositedThisMonthAmount) }} TND</em>
      </button>
      <button class="summary-tile neutral" type="button" (click)="clearStatus.emit()">
        <span i18n="@@accounting.fiscal-schedule.total.echeances.0605ae24">Total echeances</span>
        <strong>{{ summary.totalCount }}</strong>
        <em>{{ amount(summary.totalAmount) }} TND</em>
      </button>
    </div>
  `,
  styles: [FISCAL_SCHEDULE_SHARED_STYLES, `
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(150px, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }
    .summary-tile {
      display: grid;
      gap: 7px;
      min-height: 92px;
      padding: 14px;
      text-align: left;
      border-left-width: 3px;
    }
    .summary-tile span { font-size: 13px; font-weight: 700; }
    .summary-tile strong { font-size: 28px; line-height: 1; }
    .summary-tile em { font-style: normal; font-size: 12px; font-weight: 700; justify-self: end; }
    .summary-tile.success { background: #f2fbf5; border-color: #b8e2c5; border-left-color: #16a34a; }
    .summary-tile.warning { background: #fff8e8; border-color: #f2d592; border-left-color: #d97706; }
    .summary-tile.danger { background: #fff2f1; border-color: #f3b7b1; border-left-color: #dc2626; }
    .summary-tile.info { background: #eff7ff; border-color: #bad7f7; border-left-color: #2563eb; }
    .summary-tile.neutral { background: #f8fafc; border-color: #d8dee8; border-left-color: #64748b; }
    @media (max-width: 1180px) {
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 720px) {
      .summary-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class FiscalScheduleSummaryComponent {
  @Input() summary: FiscalScheduleSummaryDto | null = null;
  @Output() statusClick = new EventEmitter<number>();
  @Output() clearStatus = new EventEmitter<void>();

  amount(value: number): string {
    return formatFiscalAmount(value, 'TND').replace(' TND', '');
  }
}
