import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';
import { finalize } from 'rxjs';
import { PayrollService, DtsDeclaration } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollStatGridComponent,
  PayrollEmptyStateComponent,
  PayrollAmountPipe,
  formatPayrollAmount,
  type PayrollStatItem
} from '../shared';

const MONTH_LABELS = [
  '',
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

@Component({
  selector: 'app-dts-declaration-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    SelectModule,
    TagModule,
    TooltipModule,
    MessageModule,
    ButtonComponent,
    PayrollStatGridComponent,
    PayrollEmptyStateComponent,
    PayrollAmountPipe
  ],
  template: `
    <div class="payroll-toolbar mb-3">
      <p-select
        [options]="yearOptions"
        [(ngModel)]="year"
        (ngModelChange)="load()"
        optionLabel="label"
        optionValue="value"
        placeholder="Année" i18n-placeholder="Année"
        styleClass="w-10rem" />
      <p-select
        [options]="quarterOptions"
        [(ngModel)]="quarter"
        (ngModelChange)="load()"
        optionLabel="label"
        optionValue="value"
        placeholder="Trimestre" i18n-placeholder="Trimestre"
        styleClass="w-10rem" />
      <app-button variant="primary" icon="pi-refresh" iconPos="left" (click)="load()" i18n="@@payroll.declarations.generer.bd221c07">Générer</app-button>
      <app-button
        variant="outline"
        icon="pi-download"
        iconPos="left"
        (click)="exportCsv()"
        [disabled]="!canExport()" i18n="@@payroll.declarations.exporter.csv.d4fc31cb">Exporter CSV</app-button>
    </div>

    @if (dts() && !dts()!.isComplete) {
      <p-message
        severity="warn"
        [text]="incompletenessMessage()"
        styleClass="mb-3 w-full" />
    }

    @if (loading()) {
      <app-payroll-empty-state [loading]="true" [skeletonColumns]="6" />
    } @else if (!dts()) {
      <app-payroll-empty-state
        icon="pi-exclamation-circle"
        title="Impossible de charger la DTS" i18n-title="Impossible de charger la DTS"
        description="Une erreur est survenue lors de la génération. Réessayez ou vérifiez vos droits."
        [showAction]="true"
        actionLabel="Réessayer"
        (actionClick)="load()" />
    } @else if (dts()!.lines.length === 0) {
      <app-payroll-empty-state
        icon="pi-file"
        title="Aucun salarié déclaré" i18n-title="Aucun salarié déclaré"
        [description]="emptyDescription()"
        [showAction]="true"
        actionLabel="Voir les cycles de paie"
        actionRoute="/payroll/runs" />
    } @else {
      <app-payroll-stat-grid [items]="summaryStats()" class="mb-4" />

      <p-table [value]="dts()!.lines" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.declarations.salarie.27f97915">Salarié</th>
            <th i18n="@@payroll.declarations.cnss.a04d171a">CNSS</th>
            <th class="text-right" i18n="@@payroll.declarations.brut.cnssable.fe8d5dba">Brut CNSSable</th>
            <th class="text-right" i18n="@@payroll.declarations.cnss.sal.5d831d27">CNSS sal.</th>
            <th class="text-right" i18n="@@payroll.declarations.cnss.pat.1d666774">CNSS pat.</th>
            <th class="text-right" i18n="@@payroll.declarations.mois.0d304bea">Mois</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-l>
          <tr>
            <td>{{ l.employeeName }}</td>
            <td>
              @if (l.cnssNumber) {
                {{ l.cnssNumber }}
              } @else {
                <i class="pi pi-exclamation-triangle text-warning" pTooltip="CNSS manquant" tooltipPosition="top"></i>
                <p-tag value="Manquant" severity="warn" class="ml-2" />
              }
            </td>
            <td class="text-right">{{ l.totalCnssableGross | payrollAmount }}</td>
            <td class="text-right">{{ l.cnssEmployee | payrollAmount }}</td>
            <td class="text-right">{{ l.cnssEmployer | payrollAmount }}</td>
            <td class="text-right">{{ l.monthsCount }}</td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [`
    .mb-3 { margin-bottom: var(--spacing-4); }
    .mb-4 { margin-bottom: var(--spacing-6); display: block; }
    .ml-2 { margin-left: var(--spacing-2); }
    .text-warning { color: var(--color-warning-600); }
  `]
})
export class DtsDeclarationTabComponent implements OnInit {
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);

  readonly initialYear = input<number | null>(null);
  readonly initialQuarter = input<number | null>(null);

  year = new Date().getFullYear();
  quarter = Math.ceil((new Date().getMonth() + 1) / 3);
  yearOptions = Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 2 + i;
    return { value: y, label: String(y) };
  });
  quarterOptions = [1, 2, 3, 4].map(q => ({ value: q, label: `T${q}` }));
  dts = signal<DtsDeclaration | null>(null);
  loading = signal(false);

  canExport = computed(() => {
    const d = this.dts();
    return !!d && d.employeeCount > 0;
  });

  incompletenessMessage = computed(() => {
    const d = this.dts();
    if (!d || d.isComplete) return '';
    const months = formatMonthList(d.missingMonths);
    return `Trimestre incomplet : cycles Validé/Clôturé manquants pour ${months}. Seuls les mois validés sont inclus.`;
  });

  emptyDescription = computed(() => {
    const d = this.dts();
    const base = 'Seuls les cycles de paie validés ou clôturés sont inclus.';
    if (!d || d.isComplete || d.missingMonths.length === 0) {
      return `${base} Aucun bulletin éligible pour cette période.`;
    }
    return `${base} Mois manquants : ${formatMonthList(d.missingMonths)}.`;
  });

  summaryStats = computed((): PayrollStatItem[] => {
    const d = this.dts();
    if (!d) return [];
    return [
      { label: 'Salariés', value: d.employeeCount, icon: 'pi-users', variant: 'primary' },
      { label: 'Masse CNSSable', value: formatPayrollAmount(d.totalCnssableGross, false), icon: 'pi-chart-bar', variant: 'primary' },
      { label: 'CNSS salarié', value: formatPayrollAmount(d.totalCnssEmployee, false), icon: 'pi-user', variant: 'warning' },
      { label: 'CNSS employeur', value: formatPayrollAmount(d.totalCnssEmployer, false), icon: 'pi-building', variant: 'warning' },
      { label: 'Cotisations CNSS', value: formatPayrollAmount(d.totalContributions, false), icon: 'pi-wallet', variant: 'success', featured: true }
    ];
  });

  ngOnInit(): void {
    const y = this.initialYear();
    const q = this.initialQuarter();
    if (y != null && y >= 2000 && y <= 2100) this.year = y;
    if (q != null && q >= 1 && q <= 4) this.quarter = q;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.payroll.getDts(this.year, this.quarter).pipe(
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: res => this.dts.set(res.data ?? null),
      error: () => {
        this.dts.set(null);
        this.toast.add({ severity: 'error', summary: 'DTS', detail: 'Impossible de générer la DTS.' });
      }
    });
  }

  exportCsv(): void {
    if (!this.canExport()) return;
    this.payroll.exportDtsCsv(this.year, this.quarter).subscribe({
      next: blob => downloadBlob(blob, `dts_${this.year}_T${this.quarter}.csv`),
      error: () => this.toast.add({ severity: 'error', summary: 'DTS', detail: 'Export CSV impossible.' })
    });
  }
}

function formatMonthList(months: number[]): string {
  return months.map(m => MONTH_LABELS[m] ?? `M${m}`).join(', ');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
