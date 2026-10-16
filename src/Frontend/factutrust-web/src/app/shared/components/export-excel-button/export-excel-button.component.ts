/// <reference types="@angular/localize" />
import { Component, Input, inject, signal } from '@angular/core';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DataExportError, DataExportFilters, DataExportService } from '@core/services/data-export.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-export-excel-button',
  standalone: true,
  imports: [ButtonComponent],
  template: `
    <app-button
      variant="secondary"
      icon="pi-download"
      iconPos="left"
      [disabled]="busy()"
      (click)="exportNow()"
      i18n="@@dataExport.button">
      Exporter Excel
    </app-button>
  `
})
export class ExportExcelButtonComponent {
  private readonly exports = inject(DataExportService);
  private readonly toast = inject(ToastService);

  @Input({ required: true }) dataset!: string;
  @Input({ required: true }) filters!: () => DataExportFilters;

  readonly busy = signal(false);

  exportNow(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.exports.downloadDataset(this.dataset, this.filters()).subscribe({
      next: () => this.busy.set(false),
      error: (err: unknown) => {
        this.busy.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@dataExport.error.title:Export impossible`,
          detail: err instanceof DataExportError ? err.message : $localize`:@@dataExport.error.generic:L'export n'a pas pu être téléchargé.`
        });
      }
    });
  }
}
