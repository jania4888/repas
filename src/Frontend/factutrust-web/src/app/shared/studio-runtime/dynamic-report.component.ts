import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { ChartModule } from 'primeng/chart';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { MenuItem } from 'primeng/api';
import { ReportColumn, ReportResult } from './studio-runtime.models';
import { exportRowsCsv, exportRowsXlsx } from './studio-export.util';
import { StudioCellFormatterService, StudioColumnMeta } from './studio-cell-formatter.service';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';

type ChartType = 'bar' | 'line' | 'pie';

@Component({
  selector: 'app-dynamic-report',
  standalone: true,
  imports: [
    CommonModule, TableModule, ButtonModule, ChartModule, MenuModule, TooltipModule,
    EmptyStateComponent, StatusBadgeComponent
  ],
  template: `
    @if (loading && !result) {
      <div class="dr-loading" i18n="@@shared.studio-runtime.dynamic-report.chargement.fbee6e98"><i class="fa-solid fa-spinner fa-spin"></i> Chargement…</div>
    } @else if (!result || result.rows.length === 0) {
      <app-empty-state
        icon="pi-chart-bar"
        title="Aucune donnée" i18n-title="@@shared.studio-runtime.dynamic-report.aucune.donnee.434e5488"
        description="Aucune donnée pour ce rapport ou cette vue." i18n-description="@@shared.studio-runtime.dynamic-report.aucune.donnee.pour.ce.rapport.ou.cette.v.10fb24b3"
      />
    } @else {
      @if (result.truncated) {
        <div class="dr-truncated" role="status" i18n="@@shared.studio-runtime.dynamic-report.resultat.tronque.a.ligne.s.sur.les.totau.740818f2">
          <i class="fa-solid fa-triangle-exclamation"></i>
          Résultat tronqué à {{ result.rows.length }} ligne(s) sur {{ result.totalRows }}.
          Les totaux ne portent pas sur la totalité des données — affinez la période ou les filtres.
        </div>
      }
      <div class="dr-bar">
        @if (chartable()) {
          <div class="dr-modes">
            <button pButton type="button" icon="fa-solid fa-table" label="Tableau" i18n-label="@@shared.studio-runtime.dynamic-report.tableau.bb6d7e52" class="p-button-sm"
              [class.p-button-outlined]="view !== 'table'" (click)="view = 'table'"></button>
            <button pButton type="button" icon="fa-solid fa-chart-simple" label="Graphique" i18n-label="@@shared.studio-runtime.dynamic-report.graphique.fad32c3f" class="p-button-sm"
              [class.p-button-outlined]="view !== 'chart'" (click)="view = 'chart'"></button>
          </div>
        }
        <span class="dr-spacer"></span>
        <button pButton type="button" icon="fa-solid fa-download" label="Exporter" i18n-label="@@shared.studio-runtime.dynamic-report.exporter.0cd84bdc" class="p-button-sm p-button-outlined"
          (click)="exportMenu.toggle($event)"></button>
        <p-menu #exportMenu [popup]="true" [model]="exportItems" appendTo="body"></p-menu>
      </div>

      @if (view === 'table' || !chartable()) {
        <div class="ft-table-card">
          <p-table
            [value]="result.rows"
            styleClass="p-datatable-sm"
            [lazy]="lazy"
            (onLazyLoad)="lazyLoad.emit($event)"
            [paginator]="lazy || (result.rows.length > pageSize)"
            [rows]="pageSize"
            [totalRecords]="lazy ? totalRecords : result.rows.length"
            [rowsPerPageOptions]="[10, 25, 50, 100]"
            [loading]="loading">
            <ng-template pTemplate="header">
              <tr>
                @for (c of columns(); track c.key) {
                  <th [class.dr-measure]="c.kind === 'measure'">{{ c.label }}</th>
                }
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                @for (c of columns(); track c.key) {
                  <td [class.dr-measure]="c.kind === 'measure'">
                    @if (isStatus(c)) {
                      <app-status-badge
                        [label]="cell(row, c)"
                        [status]="statusBadge(row, c)" />
                    } @else {
                      <span [pTooltip]="cellTooltip(row, c)" tooltipPosition="top">{{ cell(row, c) }}</span>
                    }
                  </td>
                }
              </tr>
            </ng-template>
          </p-table>
        </div>
        <p class="dr-count" i18n="@@shared.studio-runtime.dynamic-report.ligne.s.6df35b9f">{{ result.totalRows }} ligne(s)</p>
      }

      @if (view === 'chart' && chartable()) {
        <div class="dr-chart-wrap">
          <div class="dr-types">
            <button pButton type="button" label="Barres" i18n-label="@@shared.studio-runtime.dynamic-report.barres.b51306e1" class="p-button-sm" [class.p-button-outlined]="chartType !== 'bar'" (click)="chartType = 'bar'"></button>
            <button pButton type="button" label="Lignes" i18n-label="@@shared.studio-runtime.dynamic-report.lignes.41c7025e" class="p-button-sm" [class.p-button-outlined]="chartType !== 'line'" (click)="chartType = 'line'"></button>
            <button pButton type="button" label="Camembert" i18n-label="@@shared.studio-runtime.dynamic-report.camembert.f15c2595" class="p-button-sm" [class.p-button-outlined]="chartType !== 'pie'" (click)="chartType = 'pie'"></button>
          </div>
          <p-chart [type]="chartType" [data]="buildChartData()" [options]="chartOptions" [style]="{ height: '340px' }"></p-chart>
        </div>
      }
    }
  `,
  styles: [`
    .dr-bar { display: flex; align-items: center; gap: var(--spacing-2); margin-bottom: var(--spacing-3); flex-wrap: wrap; }
    .dr-spacer { flex: 1; }
    .dr-measure { text-align: right; }
    .dr-count { color: var(--color-neutral-500); font-size: var(--font-size-sm); margin-top: var(--spacing-2); }
    .dr-chart-wrap { padding: var(--spacing-2) 0; }
    .dr-types { display: flex; gap: var(--spacing-2); margin-bottom: var(--spacing-3); }
    .dr-loading { text-align: center; padding: var(--spacing-8); color: var(--color-neutral-500); }
    .dr-modes { display: flex; gap: var(--spacing-1); }
    .dr-truncated {
      display: flex; align-items: center; gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3); margin-bottom: var(--spacing-3);
      border-radius: var(--radius-md);
      background: var(--color-warning-50, #fff7ed);
      border: 1px solid var(--color-warning-200, #fed7aa);
      color: var(--color-warning-800, #9a3412);
      font-size: var(--font-size-sm);
    }
  `]
})
export class DynamicReportComponent {
  private readonly formatter = inject(StudioCellFormatterService);

  @Input() result: ReportResult | null = null;
  @Input() exportName = 'rapport';
  @Input() loading = false;
  @Input() lazy = false;
  @Input() totalRecords = 0;
  @Input() pageSize = 25;
  @Output() lazyLoad = new EventEmitter<TableLazyLoadEvent>();
  @Output() exportAll = new EventEmitter<'csv' | 'xlsx'>();

  view: 'table' | 'chart' = 'table';
  chartType: ChartType = 'bar';

  readonly chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const } }
  };

  readonly exportItems: MenuItem[] = [
    { label: $localize`:@@shared.dynamic-report.ts.csv.page.courante.2f0e6273:CSV — page courante`, icon: 'fa-solid fa-file-csv', command: () => this.exportCsv(false) },
    { label: $localize`:@@shared.dynamic-report.ts.excel.page.courante.84d32d06:Excel — page courante`, icon: 'fa-solid fa-file-excel', command: () => this.exportXlsx(false) },
    { label: $localize`:@@shared.dynamic-report.ts.csv.toutes.les.lignes.42fbba25:CSV — toutes les lignes`, icon: 'fa-solid fa-file-csv', command: () => this.exportCsv(true) },
    { label: $localize`:@@shared.dynamic-report.ts.excel.toutes.les.lignes.084ab1f3:Excel — toutes les lignes`, icon: 'fa-solid fa-file-excel', command: () => this.exportXlsx(true) },
  ];

  private readonly palette = [
    'var(--color-primary-500, #3b82f6)',
    'var(--color-success-500, #10b981)',
    'var(--color-warning-500, #f59e0b)',
    'var(--color-danger-500, #ef4444)',
    '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'
  ];

  columns(): ReportColumn[] {
    return this.result?.columns ?? [];
  }

  chartable(): boolean {
    return (this.result?.rows?.length || 0) > 0
      && this.columns().some(c => c.kind === 'dimension')
      && this.columns().some(c => c.kind === 'measure');
  }

  isStatus(col: ReportColumn): boolean {
    return col.format === 'status' || (col.key?.toLowerCase().includes('status') ?? false);
  }

  statusBadge(row: Record<string, unknown>, col: ReportColumn): StatusBadgeStatus {
    const sev = this.formatter.statusSeverity(row[col.key]);
    const map: Record<string, StatusBadgeStatus> = {
      success: 'validated', warn: 'pending', danger: 'cancelled', info: 'draft', neutral: 'draft'
    };
    return map[sev] ?? 'draft';
  }

  cell(row: Record<string, unknown>, col: ReportColumn): string {
    const meta = this.toMeta(col);
    const cacheKey = `${col.key}:${row[col.key]}`;
    if (this.result?.displayValues?.[cacheKey]) {
      return this.result.displayValues[cacheKey];
    }
    return this.formatter.formatCell(row[col.key], meta);
  }

  cellTooltip(row: Record<string, unknown>, col: ReportColumn): string | undefined {
    const raw = row[col.key];
    if (raw == null || raw === '') return undefined;
    const displayed = this.cell(row, col);
    const rawStr = String(raw);
    return displayed !== rawStr ? rawStr : undefined;
  }

  buildChartData(): unknown {
    const rows = this.result?.rows ?? [];
    const dim = this.columns().find(c => c.kind === 'dimension')!;
    const measures = this.columns().filter(c => c.kind === 'measure');
    const labels = rows.map(r => this.cell(r, dim));

    if (this.chartType === 'pie') {
      const m = measures[0];
      return {
        labels,
        datasets: [{ data: rows.map(r => this.num(r[m.key])), backgroundColor: labels.map((_, i) => this.palette[i % this.palette.length]) }]
      };
    }

    return {
      labels,
      datasets: measures.map((m, i) => ({
        label: m.label,
        data: rows.map(r => this.num(r[m.key])),
        backgroundColor: this.palette[i % this.palette.length],
        borderColor: this.palette[i % this.palette.length],
        fill: false
      }))
    };
  }

  exportCsv(all: boolean): void {
    // Sans chargement paresseux, `result.rows` porte DÉJÀ toutes les lignes reçues : émettre
    // l'événement n'aurait aucun destinataire (le parent n'a pas de page suivante à aller chercher)
    // et l'entrée de menu resterait muette. On exporte donc ce qu'on a.
    if (all && this.lazy) { this.exportAll.emit('csv'); return; }
    const cols = this.columns();
    exportRowsCsv(this.exportName, cols.map(c => ({ key: c.key, label: c.label })), this.result?.rows ?? [],
      (r, ec) => this.cell(r, cols.find(c => c.key === ec.key)!));
  }

  exportXlsx(all: boolean): void {
    if (all && this.lazy) { this.exportAll.emit('xlsx'); return; }
    const cols = this.columns();
    exportRowsXlsx(this.exportName, cols.map(c => ({ key: c.key, label: c.label })), this.result?.rows ?? [],
      (r, ec) => this.cell(r, cols.find(c => c.key === ec.key)!));
  }

  private exportCols(): { key: string; label: string }[] {
    return this.columns().map(c => ({ key: c.key, label: c.label }));
  }

  private toMeta(col: ReportColumn): StudioColumnMeta {
    return {
      key: col.key,
      label: col.label,
      kind: col.kind,
      format: col.format as StudioColumnMeta['format'],
      formatOptions: col.formatOptions ?? undefined
    };
  }

  private num(v: unknown): number {
    return typeof v === 'number' ? v : Number(v) || 0;
  }
}
