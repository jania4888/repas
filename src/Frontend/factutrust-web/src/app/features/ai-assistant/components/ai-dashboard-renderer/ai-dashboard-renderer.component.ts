import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { DashboardCellLink, DashboardConfig, DashboardSection } from '../../models/ai-chat.models';
import { dashboardFullConfigToCsv, dashboardTableSectionToCsv, downloadCsv } from '../../utils/dashboard-table-csv';

@Component({
  selector: 'app-ai-dashboard-renderer',
  standalone: true,
  imports: [CommonModule, TableModule, CardModule, ChartModule],
  template: `
    @if (config) {
      <div class="ai-dashboard" [class.ai-dashboard--inline]="variant === 'inline'">
        <div class="dashboard-header">
          <h3>{{ config.title }}</h3>
          <div class="dashboard-header-actions">
            @if (canExportFullDashboard()) {
              <button
                type="button"
                class="csv-btn"
                (click)="exportFullDashboard()"
                [attr.aria-label]="'Exporter tout le tableau de bord « ' + config.title + ' » en CSV'">
                <i class="fa-solid fa-file-csv" aria-hidden="true"></i>
                Tout exporter (CSV)
              </button>
            }
            @if (showCloseButton) {
              <button
                type="button"
                class="close-dashboard"
                (click)="closed.emit()"
                title="Fermer le tableau de bord" i18n-title="Fermer le tableau de bord"
                aria-label="Fermer le tableau de bord" i18n-aria-label="Fermer le tableau de bord">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            }
          </div>
        </div>

        <div class="dashboard-grid">
          @for (section of config.sections; track $index) {
            @switch (section.type) {
              @case ('kpi_card') {
                <div class="kpi-card">
                  <div class="kpi-label">{{ section.title }}</div>
                  <!-- unit ?? label : les payloads générés par le modèle portent souvent l'unité dans data.label -->
                  <div class="kpi-value">{{ formatValue(section.data?.value, section.data?.unit ?? section.data?.label) }}</div>
                  @if (section.data?.trend != null) {
                    <div class="kpi-trend" [class.positive]="(section.data?.trend ?? 0) > 0" [class.negative]="(section.data?.trend ?? 0) < 0">
                      <i [class]="(section.data?.trend ?? 0) >= 0 ? 'fa-solid fa-arrow-up' : 'fa-solid fa-arrow-down'" aria-hidden="true"></i>
                      {{ formatTrend(section.data?.trend) }}
                    </div>
                  }
                </div>
              }
              @case ('table') {
                <div class="dashboard-table-section">
                  <div class="section-toolbar">
                    <h4>{{ section.title }}</h4>
                    @if (canExportTable(section)) {
                      <button
                        type="button"
                        class="csv-btn"
                        (click)="exportTable(section)"
                        [attr.aria-label]="'Exporter « ' + section.title + ' » en CSV'">
                        <i class="fa-solid fa-file-csv" aria-hidden="true"></i>
                        CSV
                      </button>
                    }
                  </div>
                  <p-table
                    [value]="section.data?.rows || []"
                    [scrollable]="true"
                    scrollHeight="300px"
                    styleClass="p-datatable-sm p-datatable-striped">
                    <ng-template pTemplate="header">
                      <tr>
                        @for (c of section.data?.columns || []; track c.key) {
                          <th scope="col">{{ c.label }}</th>
                        }
                      </tr>
                    </ng-template>
                    <ng-template pTemplate="body" let-row>
                      <tr>
                        @for (c of section.data?.columns || []; track c.key) {
                          <td>
                            @if (getCellLink(row, c.key); as cellLink) {
                              <button
                                type="button"
                                class="cell-link"
                                (click)="navigateCell(cellLink)"
                                [attr.aria-label]="'Ouvrir ' + formatCell(row[c.key])">
                                {{ formatCell(row[c.key]) }}
                              </button>
                            } @else {
                              {{ formatCell(row[c.key]) }}
                            }
                          </td>
                        }
                      </tr>
                    </ng-template>
                    <ng-template pTemplate="emptymessage">
                      <tr>
                        <td [attr.colspan]="(section.data?.columns || []).length" i18n="@@ai-assistant.components.aucune.donnee.434e5488">Aucune donnée</td>
                      </tr>
                    </ng-template>
                  </p-table>
                </div>
              }
              @case ('chart') {
                <div class="dashboard-chart-section">
                  <h4>{{ section.title }}</h4>
                  <p-chart
                    [type]="section.data?.chartType || 'bar'"
                    [data]="buildChartData(section)"
                    [options]="chartOptions"
                    [style]="{ width: '100%', height: '300px' }">
                  </p-chart>
                </div>
              }
            }
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .ai-dashboard {
      background: #fff;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-radius: 12px;
      padding: 20px;
      margin: 16px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }

    .ai-dashboard--inline {
      margin: 0 0 10px;
      padding: 14px 16px;
    }

    .dashboard-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 20px;
    }

    .dashboard-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .cell-link {
      display: inline;
      padding: 0;
      margin: 0;
      border: none;
      background: none;
      color: var(--color-primary-600, #2563eb);
      font: inherit;
      cursor: pointer;
      text-decoration: underline;
      text-align: left;
    }

    .cell-link:hover {
      color: var(--color-primary-700, #1d4ed8);
    }

    .cell-link:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
      border-radius: 4px;
    }

    .ai-dashboard--inline .dashboard-header {
      margin-bottom: 14px;
    }

    .dashboard-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--color-neutral-800, #1f2937);
    }

    .ai-dashboard--inline .dashboard-header h3 {
      font-size: 16px;
    }

    .close-dashboard {
      width: 28px;
      height: 28px;
      border: none;
      background: var(--color-neutral-100, #f3f4f6);
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-neutral-500, #6b7280);
      transition: all 0.15s;
    }

    .close-dashboard:hover {
      background: var(--color-neutral-200, #e5e7eb);
    }

    .close-dashboard:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
    }

    .section-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 12px;
    }

    .section-toolbar h4 {
      margin: 0;
      flex: 1;
      min-width: 0;
    }

    .csv-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 500;
      color: var(--color-neutral-700, #374151);
      background: var(--color-neutral-50, #f9fafb);
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .csv-btn:hover {
      background: var(--color-neutral-100, #f3f4f6);
      border-color: var(--color-neutral-300, #d1d5db);
    }

    .csv-btn:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .kpi-card {
      padding: 16px;
      background: var(--color-neutral-50, #f9fafb);
      border-radius: 10px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
    }

    .kpi-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--color-neutral-500, #6b7280);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .kpi-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--color-neutral-900, #111827);
    }

    .kpi-trend {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      font-size: 12px;
      font-weight: 500;
    }

    .kpi-trend.positive { color: var(--color-success-600, #16a34a); }
    .kpi-trend.negative { color: var(--color-error-600, #dc2626); }

    .dashboard-table-section,
    .dashboard-chart-section {
      grid-column: 1 / -1;
    }

    .dashboard-table-section h4,
    .dashboard-chart-section h4 {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 600;
      color: var(--color-neutral-700, #374151);
    }
  `]
})
export class AiDashboardRendererComponent implements OnChanges {
  @Input() config: DashboardConfig | null = null;
  /** Tighter spacing when embedded under a chat bubble. */
  @Input() variant: 'default' | 'inline' = 'default';
  @Input() showCloseButton = true;

  @Output() readonly closed = new EventEmitter<void>();

  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const }
    }
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config']) {
      // Chart inputs may need refresh when config reference changes
    }
  }

  formatCell(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return '';
    }
    return String(value);
  }

  getCellLink(row: Record<string, unknown>, columnKey: string): DashboardCellLink | null {
    const links = row['_links'] as Record<string, DashboardCellLink> | undefined;
    const link = links?.[columnKey];
    if (!link || typeof link.route !== 'string' || !link.route.startsWith('/')) {
      return null;
    }
    return link;
  }

  navigateCell(link: DashboardCellLink): void {
    void this.router.navigate([link.route], { queryParams: link.queryParams || {} });
  }

  canExportFullDashboard(): boolean {
    const cfg = this.config;
    if (!cfg?.sections?.length) {
      return false;
    }
    return cfg.sections.some(s => s.type === 'table' && this.canExportTable(s));
  }

  exportFullDashboard(): void {
    if (!isPlatformBrowser(this.platformId) || !this.config) {
      return;
    }
    const csv = dashboardFullConfigToCsv(this.config);
    if (!csv.trim()) {
      return;
    }
    const name = this.slugifyFileName(this.config.title || 'tableau-de-bord');
    downloadCsv(`export-complet-${name}`, csv);
  }

  formatValue(value: any, unit?: string): string {
    if (value === undefined || value === null) return '-';
    const numValue = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(numValue)) return String(value);
    const formatted = numValue.toLocaleString('fr-TN', { maximumFractionDigits: 3 });
    return unit ? `${formatted} ${unit}` : formatted;
  }

  formatTrend(trend: number | null | undefined): string {
    if (trend == null || isNaN(trend)) {
      return '';
    }
    const abs = Math.abs(trend);
    return `${abs.toFixed(1)}%`;
  }

  canExportTable(section: DashboardSection): boolean {
    if (section.type !== 'table') {
      return false;
    }
    const cols = section.data?.columns ?? [];
    const rows = section.data?.rows ?? [];
    return cols.length > 0 && rows.length > 0;
  }

  exportTable(section: DashboardSection): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const csv = dashboardTableSectionToCsv(section);
    if (!csv) {
      return;
    }
    const name = this.slugifyFileName(section.title || 'tableau');
    downloadCsv(name, csv);
  }

  private slugifyFileName(title: string): string {
    return (
      title
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 80) || 'export'
    );
  }

  buildChartData(section: DashboardSection): any {
    const data = section.data;
    if (!data) return {};

    const colors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
    ];

    return {
      labels: data.labels || [],
      datasets: (data.datasets || []).map((ds: any, i: number) => ({
        ...ds,
        backgroundColor: data.chartType === 'pie' || data.chartType === 'doughnut'
          ? colors
          : colors[i % colors.length] + '80',
        borderColor: colors[i % colors.length],
        borderWidth: 2
      }))
    };
  }
}
