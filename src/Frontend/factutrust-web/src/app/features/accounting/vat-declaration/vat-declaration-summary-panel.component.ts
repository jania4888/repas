import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule } from 'primeng/chart';
import { VatDeclarationDto } from '../services/accounting.service';
import { VatChartSegment, canSubmitDeclaration, formatDateFr, shouldShowFilingAlert } from './vat-declaration.view-model';

@Component({
  selector: 'app-vat-declaration-summary-panel',
  standalone: true,
  imports: [CommonModule, ChartModule],
  template: `
    <div class="vat-sidebar">
      <div class="card vat-summary-card">
        <h3 class="vat-zone-title" i18n="@@accounting.vat-declaration.recapitulatif.d5b5de6d">Récapitulatif</h3>
        @if (chartData) {
          <p-chart type="doughnut" [data]="chartData" [options]="chartOptions" [style]="{ height: '220px' }" />
        }
        <div class="vat-total-block">
          <span class="vat-total-label">TOTAL À PAYER ({{ currency }})</span>
          <span class="vat-total-value">{{ totalToPay | number:'1.3-3' }}</span>
        </div>
      </div>

      <div class="card vat-actions-card">
        <h3 class="vat-zone-title" i18n="@@accounting.vat-declaration.actions.c3cd636a">Actions</h3>
        <div class="vat-actions-stack">
          @if (canManage) {
            @if (canSubmit) {
              <button type="button" class="btn btn-primary vat-action-btn" (click)="saveDraft.emit()" [disabled]="loading" i18n="@@accounting.vat-declaration.enregistrer.brouillon.09f6f9ed">Enregistrer brouillon</button>
              <button type="button" class="btn btn-success vat-action-btn" (click)="submit.emit()" [disabled]="loading" i18n="@@accounting.vat-declaration.soumettre.5597a63d">Soumettre</button>
            } @else {
              <p class="vat-submitted-hint" i18n="@@accounting.vat-declaration.declaration.deja.soumise.pour.cette.periode.util.c26a58f7">Déclaration déjà soumise pour cette période. Utilisez « Rectificative » pour la corriger.</p>
            }
            @if (v2Enabled) {
              <button type="button" class="btn btn-secondary vat-action-btn" (click)="rectificative.emit()" [disabled]="loading"
                title="Corriger une déclaration déjà déposée (rectificative)" i18n-title="Corriger une déclaration déjà déposée (rectificative)" i18n="@@accounting.vat-declaration.rectificative.4524a686">Rectificative</button>
            }
          }
          <button type="button" class="btn btn-secondary vat-action-btn" (click)="exportPdf.emit()" [disabled]="loading">
            <i class="pi pi-file-pdf" aria-hidden="true"></i> Exporter PDF
          </button>
        </div>
      </div>

      @if (showFilingAlert) {
        <div class="vat-filing-alert" role="status">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <span>Le paiement doit être effectué avant le <strong>{{ filingDeadlineLabel }}</strong>.</span>
        </div>
      }
    </div>
  `,
  styles: `
    .vat-sidebar { display: flex; flex-direction: column; gap: var(--spacing-4); position: sticky; top: var(--spacing-4); }
    .vat-summary-card, .vat-actions-card { padding: var(--spacing-5); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
    .vat-zone-title { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); margin: 0 0 var(--spacing-4); color: var(--color-text-primary); }
    .vat-total-block { margin-top: var(--spacing-4); text-align: center; padding-top: var(--spacing-4); border-top: 1px solid var(--color-border-subtle); }
    .vat-total-label { display: block; font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--color-text-tertiary); letter-spacing: 0.04em; margin-bottom: var(--spacing-1); }
    .vat-total-value { display: block; font-size: 1.75rem; font-weight: var(--font-weight-bold); color: var(--color-primary-700,#1d4ed8); font-variant-numeric: tabular-nums; }
    .vat-actions-stack { display: flex; flex-direction: column; gap: var(--spacing-2); }
    .vat-action-btn { width: 100%; justify-content: center; }
    .vat-submitted-hint { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .btn-secondary { background: var(--color-background-subtle); color: var(--color-text-primary); border: 1px solid var(--color-border-default); }
    .vat-filing-alert {
      display: flex; align-items: flex-start; gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4); border-radius: var(--radius-md);
      background: var(--color-warning-50,#fffbeb); color: var(--color-warning-800,#92400e);
      border: 1px solid var(--color-warning-200,#fde68a); font-size: var(--font-size-sm);
    }
    .vat-filing-alert i { margin-top: 0.1rem; }
  `
})
export class VatDeclarationSummaryPanelComponent implements OnChanges {
  @Input() declaration: VatDeclarationDto | null = null;
  @Input() totalToPay = 0;
  @Input() currency = 'TND';
  @Input() loading = false;
  @Input() v2Enabled = false;
  @Input() chartSegments: VatChartSegment[] = [];
  /** false pour la société : seules les actions d'export restent visibles. */
  @Input() canManage = true;

  /** Soumettre/Enregistrer visibles uniquement sur un brouillon (statut 0). */
  get canSubmit(): boolean {
    return canSubmitDeclaration(this.declaration?.status ?? 0);
  }

  @Output() saveDraft = new EventEmitter<void>();
  @Output() submit = new EventEmitter<void>();
  @Output() rectificative = new EventEmitter<void>();
  @Output() exportPdf = new EventEmitter<void>();

  chartData: { labels: string[]; datasets: { data: number[]; backgroundColor: string[] }[] } | null = null;
  chartOptions = {
    plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
    maintainAspectRatio: false
  };

  private readonly palette = [
    '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#0891b2'
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chartSegments']) {
      this.buildChart();
    }
  }

  get showFilingAlert(): boolean {
    return this.declaration ? shouldShowFilingAlert(this.declaration) : false;
  }

  get filingDeadlineLabel(): string {
    return formatDateFr(this.declaration?.filingDeadline);
  }

  private buildChart(): void {
    const segments = this.chartSegments.filter(s => s.value > 0);
    if (segments.length === 0) {
      this.chartData = null;
      return;
    }
    this.chartData = {
      labels: segments.map(s => s.label),
      datasets: [{
        data: segments.map(s => s.value),
        backgroundColor: segments.map((_, i) => this.palette[i % this.palette.length])
      }]
    };
  }
}
