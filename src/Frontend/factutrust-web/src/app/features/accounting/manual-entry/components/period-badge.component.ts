import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccountingPeriodDto } from '../../services/accounting.service';

export type PeriodStatus = 'open' | 'closed' | 'none';

@Component({
  selector: 'app-period-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    @switch (status()) {
      @case ('open') {
        <span class="me-period-badge me-period-open" role="status"
              [attr.title]="'Cette date appartient à une période comptable ouverte'" i18n="@@accounting.manual-entry.periode.ouverte.5919f319">
          <span class="me-period-dot" aria-hidden="true"></span>
          Période ouverte
        </span>
      }
      @case ('closed') {
        <span class="me-period-badge me-period-closed" role="status"
              [attr.title]="'Cette date appartient à une période comptable clôturée — l’enregistrement sera refusé'" i18n="@@accounting.manual-entry.periode.fermee.640f9aa5">
          <span class="me-period-dot" aria-hidden="true"></span>
          Période fermée
        </span>
      }
      @default {
        <span class="me-period-badge me-period-none" role="status"
              [attr.title]="'Aucune période comptable n’existe pour cette date — elle sera créée automatiquement à l’enregistrement'" i18n="@@accounting.manual-entry.aucune.periode.e4c0fc05">
          <span class="me-period-dot" aria-hidden="true"></span>
          Aucune période
        </span>
      }
    }
  `,
  styles: `
    .me-period-badge { display:inline-flex; align-items:center; gap:var(--spacing-2); padding:var(--spacing-1) var(--spacing-3); border-radius:9999px; font-size:var(--font-size-xs,0.75rem); font-weight:var(--font-weight-semibold); border:1px solid transparent; line-height:1.4; }
    .me-period-dot { width:0.5rem; height:0.5rem; border-radius:50%; background:currentColor; }
    .me-period-open { background:var(--color-success-50,#f0fdf4); color:var(--color-success-700,#15803d); border-color:var(--color-success-200,#bbf7d0); }
    .me-period-closed { background:var(--color-error-50,#fef2f2); color:var(--color-error-700,#b91c1c); border-color:var(--color-error-200,#fecaca); }
    .me-period-none { background:var(--color-warning-50,#fffbeb); color:var(--color-warning-700,#b45309); border-color:var(--color-warning-200,#fde68a); }
  `
})
export class PeriodBadgeComponent {
  readonly date = input.required<string>();
  readonly periods = input.required<AccountingPeriodDto[]>();

  readonly status = computed<PeriodStatus>(() => {
    const d = this.date();
    if (!d) return 'none';
    const periods = this.periods();
    const found = periods.find(p => {
      const start = (p.startDate ?? '').substring(0, 10);
      const end = (p.endDate ?? '').substring(0, 10);
      return d >= start && d <= end;
    });
    if (!found) return 'none';
    return found.isClosed ? 'closed' : 'open';
  });
}
