import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingService } from '../services/accounting.service';
import { downloadBlob } from '../shared/accounting-download.util';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Export d'archive de dossier (ZIP, lecture seule) : plan comptable, journal général, balance,
 * plan tiers, FEC et manifeste, pour un exercice. Aucune modification des données.
 */
@Component({
  selector: 'app-dossier-export',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <div class="card de-card">
      <div class="de-fields">
        <div class="form-field">
          <label class="field-label" for="de-year" i18n="@@accounting.import.exercice.e171e2b0">Exercice</label>
          <input id="de-year" type="number" min="2000" max="2100" class="de-input" [(ngModel)]="fiscalYear" [disabled]="busy()" />
        </div>
        <div class="de-actions">
          <app-button variant="primary" icon="pi pi-download" type="button"
            (click)="download()" [disabled]="busy()"
            ariaLabel="Télécharger l'archive ZIP du dossier" i18n-ariaLabel="@@accounting.import.telecharger.l.archive.zip.du.dossier.53238a25">
            {{ busy() ? loc_ui_tern_preparation_47305e : loc_ui_tern_telecharger_le_dossier_zip_485761 }}
          </app-button>
        </div>
      </div>
      <p class="de-help" i18n="@@accounting.import.l.archive.reunit.plan.comptable.csv.jour.0e2f3714">
        <ng-container> L'archive réunit </ng-container> <code>plan_comptable.csv</code>, <code>journal_general.csv</code>,
        <code>balance.csv</code>, <code>tiers.csv</code>, <code>fec.txt</code> et un manifeste.
        Export en <strong>lecture seule</strong> — aucune donnée n'est modifiée.
      </p>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    @if (successMessage(); as msg) {
      <div class="de-success" role="status"><i class="pi pi-check-circle" aria-hidden="true"></i><span>{{ msg }}</span></div>
    }
  `,
  styles: `
    .de-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm,0 1px 3px rgba(15,23,42,0.08)); margin-bottom:var(--spacing-4); }
    .de-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .form-field { display:flex; flex-direction:column; gap:var(--spacing-2); min-width:0; }
    .field-label { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); margin:0; }
    .de-input { padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); background:var(--color-background-elevated); color:var(--color-text-primary); font-size:var(--font-size-sm); min-height:2.5rem; max-width:8rem; }
    .de-help { margin:var(--spacing-4) 0 0; font-size:var(--font-size-sm); color:var(--color-text-secondary); }
    .de-help code { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background:var(--color-background-subtle); padding:0 0.25rem; border-radius:var(--radius-sm,4px); }
    .de-success { display:flex; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-4); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); background:var(--color-success-50,#f0fdf4); border:1px solid var(--color-success-200,#bbf7d0); color:var(--color-success-700,#15803d); font-weight:var(--font-weight-medium); }
  `
})
export class DossierExportComponent {
  readonly loc_ui_tern_preparation_47305e = $localize`:@@ui.tern.preparation.47305e:Préparation…`;
  readonly loc_ui_tern_telecharger_le_dossier_zip_485761 = $localize`:@@ui.tern.telecharger.le.dossier.zip.485761:Télécharger le dossier (ZIP)`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);

  fiscalYear = new Date().getFullYear() - 1;
  readonly exporting = signal(false);
  readonly error = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  busy(): boolean {
    return this.exporting();
  }

  download(): void {
    if (this.busy()) return;
    this.error.set(null);
    this.successMessage.set(null);
    this.exporting.set(true);
    this.api.exportDossierArchive(this.fiscalYear).subscribe({
      next: blob => {
        this.exporting.set(false);
        downloadBlob(blob, `dossier_${this.fiscalYear}.zip`);
        this.successMessage.set($localize`:@@accounting.dossier-export.ts.archive.du.dossier.fiscalyear.telecharge.b9692329:Archive du dossier ${this.fiscalYear}:fiscalYear: téléchargée.`);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.dossier-export.ts.erreur.lors.de.la.preparation.de.l.archi.ae349217:Erreur lors de la préparation de l'archive.`));
      }
    });
  }
}
