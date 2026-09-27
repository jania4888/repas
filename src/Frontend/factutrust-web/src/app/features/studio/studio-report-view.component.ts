/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { DynamicReportComponent } from '@shared/studio-runtime/dynamic-report.component';
import { StudioService } from './studio.service';
import { ReportResult } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

@Component({
  selector: 'app-studio-report-view',
  standalone: true,
  imports: [CommonModule, RouterModule, ToastModule, ButtonModule, DynamicReportComponent, StudioPageShellComponent],
  template: `
    <p-toast></p-toast>
    <app-studio-page-shell
      [title]="reportName()"
      subtitle="Rapport analytique — consultation et export." i18n-subtitle="@@studio.studio-report-view.rapport.analytique.consultation.et.expor.5c5a2337"
      [breadcrumbs]="breadcrumbs()">
      <div class="srv-actions">
        <button pButton type="button" class="p-button-outlined p-button-sm"
          icon="fa-solid fa-file-pdf" label="Imprimer (PDF)" i18n-label="@@studio.studio-report-view.imprimer.pdf.279d3d23"
          [disabled]="loading() || exporting() || !result()" (click)="exportPdf()"></button>
      </div>
      <app-dynamic-report
        [result]="result()"
        [loading]="loading()"
        [exportName]="reportName()" />
    </app-studio-page-shell>
  `,
  styles: [`.srv-actions { display: flex; justify-content: flex-end; margin-bottom: .5rem; }`],
  styleUrl: './shared/studio-layout.scss',
})
export class StudioReportViewComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly printPreview = inject(PrintPreviewService);

  readonly result = signal<ReportResult | null>(null);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly reportName = signal($localize`:@@studio.studio-report-view.ts.rapport.f25c405b:Rapport`);
  readonly breadcrumbs = signal<BreadcrumbItem[]>(STUDIO_BREADCRUMBS.reportView($localize`:@@studio.studio-report-view.ts.rapport.f25c405b:Rapport`));

  private reportId = '';

  exportPdf(): void {
    if (!this.reportId || this.exporting()) return;
    this.exporting.set(true);
    this.studio.exportReportPdf(this.reportId).subscribe({
      next: blob => {
        this.exporting.set(false);
        this.printPreview.openPdfForPrintPreview(blob, `${this.reportName()}.pdf`);
      },
      error: () => {
        this.exporting.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-view.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-report-view.component.detail.LéditionPDFaéchoué:L'édition PDF a échoué.` });
      }
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.reportId = id;
    this.studio.getReport(id).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.reportName.set(res.data.displayName);
          this.breadcrumbs.set(STUDIO_BREADCRUMBS.reportView(res.data.displayName));
        }
      }
    });
    this.studio.runReport(id).subscribe({
      next: res => { this.loading.set(false); if (res.success) this.result.set(res.data); },
      error: () => { this.loading.set(false); this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-view.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-report-view.component.detail.Rapport_introuva:Rapport introuvable.` }); }
    });
  }
}
