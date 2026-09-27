import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { AuthService } from '@core/services/auth.service';
import { isCompanyAccountingRestricted } from '@core/config/company-accounting-nav.config';

@Component({
  selector: 'app-vat-declaration-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ButtonComponent, AnalyzeWithAiButtonComponent],
  template: `
    <div class="card accounting-filters-card vat-toolbar-card">
      <div class="vat-toolbar">
        <div class="vat-toolbar-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="vat-year" i18n="@@accounting.vat-declaration.annee.1f910d98">Année</label>
            <input id="vat-year" type="number" [ngModel]="year" (ngModelChange)="yearChange.emit($event)" class="accounting-filter-input vat-input-narrow" [disabled]="loading" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="vat-month" i18n="@@accounting.vat-declaration.mois.0d304bea">Mois</label>
            <input id="vat-month" type="number" min="1" max="12" [ngModel]="month" (ngModelChange)="monthChange.emit($event)" class="accounting-filter-input vat-input-narrow" [disabled]="loading" />
          </div>
        </div>
        <div class="vat-toolbar-actions">
          <app-button variant="secondary" icon="pi pi-chevron-left" type="button" (click)="prevPeriod.emit()" [disabled]="loading" ariaLabel="Période précédente" />
          <app-button variant="secondary" icon="pi pi-refresh" iconPos="left" type="button" (click)="refresh.emit()" [disabled]="loading" ariaLabel="Actualiser la déclaration" i18n="@@accounting.vat-declaration.actualiser.9d3b2a7d"> Actualiser </app-button>
          @if (showAiAnalyze) {
            <app-analyze-with-ai-button screenId="accounting-vat-declaration" density="toolbar" [payloadBuilder]="payloadBuilder" [disabled]="loading" />
          }
          @if (showPreview) {
            <app-button variant="secondary" icon="pi pi-eye" iconPos="left" type="button" (click)="previewPdf.emit()" [disabled]="loading || !hasData" ariaLabel="Aperçu avant impression" i18n="@@accounting.vat-declaration.apercu.f0f53004"> Aperçu </app-button>
          }
          @if (showExportPdf) {
            <app-button variant="secondary" icon="pi pi-file-pdf" iconPos="left" type="button" (click)="exportPdf.emit()" [disabled]="loading || !hasData" ariaLabel="Exporter en PDF" i18n="@@accounting.vat-declaration.exporter.pdf.9a2c3956"> Exporter PDF </app-button>
          }
          @if (showOfficialForm) {
            <app-button variant="secondary" icon="pi pi-file-export" iconPos="left" type="button" (click)="exportOfficialForm.emit()" [disabled]="loading || !hasData" ariaLabel="Exporter le formulaire officiel DGI" i18n="@@accounting.vat-declaration.formulaire.officiel.285536d7"> Formulaire officiel </app-button>
          }
          @if (showPreClosingControls) {
            <a class="vat-toolbar-link" routerLink="/accounting/pre-closing" aria-label="Contrôles de pré-clôture" i18n-aria-label="Contrôles de pré-clôture">
              <i class="pi pi-shield" aria-hidden="true"></i> Contrôles
            </a>
          }
          @if (showCompanySettings) {
            <a class="vat-toolbar-link" routerLink="/settings/company" aria-label="Paramètres société" i18n-aria-label="Paramètres société">
              <i class="pi pi-cog" aria-hidden="true"></i> Paramètres
            </a>
          }
          <app-button variant="secondary" icon="pi pi-chevron-right" type="button" (click)="nextPeriod.emit()" [disabled]="loading" ariaLabel="Période suivante" />
        </div>
      </div>
    </div>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .vat-toolbar-card { margin-bottom: var(--spacing-4); padding: var(--spacing-5); }
    .vat-toolbar { display: flex; flex-wrap: wrap; gap: var(--spacing-4); align-items: flex-end; justify-content: space-between; }
    .vat-toolbar-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--spacing-4); }
    .vat-input-narrow { max-width: 6rem; }
    .vat-toolbar-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-2); }
    .vat-toolbar-link {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.5rem 0.75rem; font-size: var(--font-size-sm);
      color: var(--color-text-secondary); text-decoration: none;
      border: 1px solid var(--color-border-default); border-radius: var(--radius-md);
      background: var(--color-background-subtle);
    }
    .vat-toolbar-link:hover { background: var(--color-background-hover); color: var(--color-text-primary); }
  `
})
export class VatDeclarationToolbarComponent {
  private readonly auth = inject(AuthService);

  readonly showPreClosingControls = !isCompanyAccountingRestricted(this.auth);

  @Input() year = new Date().getFullYear();
  @Input() month = new Date().getMonth() + 1;
  @Input() loading = false;
  @Input() hasData = false;
  @Input() showCompanySettings = true;
  @Input() showAiAnalyze = true;
  @Input() showPreview = true;
  @Input() showExportPdf = true;
  /** Piloté par le drapeau serveur `officialFormEnabled` de la déclaration. */
  @Input() showOfficialForm = false;
  @Input() payloadBuilder: () => unknown = () => ({});

  @Output() yearChange = new EventEmitter<number>();
  @Output() monthChange = new EventEmitter<number>();
  @Output() refresh = new EventEmitter<void>();
  @Output() prevPeriod = new EventEmitter<void>();
  @Output() nextPeriod = new EventEmitter<void>();
  @Output() exportPdf = new EventEmitter<void>();
  @Output() exportOfficialForm = new EventEmitter<void>();
  @Output() previewPdf = new EventEmitter<void>();
}
