import { Component, Input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import {
  AccountingService,
  JournalImportFormat,
  ReferenceImportTarget,
  ReferenceImportPreviewDto
} from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Import d'un référentiel (plan comptable, plan tiers ou balance d'ouverture) — dry-run puis commit
 * additif (jamais d'écrasement). Réutilisable via l'entrée `target`. Séparé de l'import d'écritures.
 */
@Component({
  selector: 'app-reference-import',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <div class="card ri-card">
      <div class="ri-fields">
        <div class="form-field">
          <label class="field-label" for="ri-format-{{ target }}" i18n="@@accounting.import.format.041a5dec">Format</label>
          <select id="ri-format-{{ target }}" class="ri-input" [(ngModel)]="format" [disabled]="busy()">
            <option [ngValue]="0" i18n="@@accounting.import.csv.delimite.d957a0e8">CSV (délimité)</option>
            <option [ngValue]="1" i18n="@@accounting.import.excel.xlsx.47f8ecb0">Excel (.xlsx)</option>
          </select>
        </div>
        @if (target === 2) {
          <div class="form-field">
            <label class="field-label" for="ri-year-{{ target }}" i18n="@@accounting.import.exercice.e171e2b0">Exercice</label>
            <input id="ri-year-{{ target }}" type="number" min="2000" max="2100" class="ri-input" [(ngModel)]="fiscalYear" [disabled]="busy()" />
          </div>
        }
        <div class="form-field ri-field-file">
          <label class="field-label" for="ri-file-{{ target }}" i18n="@@accounting.import.fichier.f0fa5745">Fichier</label>
          <input id="ri-file-{{ target }}" type="file" class="ri-input" (change)="onFileSelected($event)" [disabled]="busy()" accept=".csv,.txt,.xlsx,.tsv" />
        </div>
        @if (target !== 1) {
          <div class="form-field ri-field-file">
            <label class="field-label" for="ri-mapping-{{ target }}" i18n="@@accounting.import.table.de.correspondance.facultatif.4e919db4">Table de correspondance (facultatif)</label>
            <input id="ri-mapping-{{ target }}" type="file" class="ri-input" (change)="onMappingSelected($event)" [disabled]="busy()" accept=".csv,.txt,.xlsx,.tsv" />
          </div>
        }
        <div class="ri-actions">
          <app-button variant="secondary" icon="pi pi-search" type="button"
            (click)="runPreview()" [disabled]="!selectedFile() || busy()"
            ariaLabel="Analyser le fichier sans rien enregistrer" i18n-ariaLabel="@@accounting.import.analyser.le.fichier.sans.rien.enregistre.d298afee" i18n="@@accounting.import.apercu.f0f53004"> Aperçu </app-button>
        </div>
      </div>
      <p class="ri-help" i18n="@@accounting.import.colonnes.attendues.creation.additive.un.f2ed5399"><ng-container>Colonnes attendues : </ng-container> <code>{{ expectedColumns }}</code>. Création <strong>additive</strong> : un élément déjà présent est ignoré, jamais écrasé.</p>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    @if (successMessage(); as msg) {
      <div class="ri-success" role="status"><i class="pi pi-check-circle" aria-hidden="true"></i><span>{{ msg }}</span></div>
    }

    @if (preview(); as p) {
      <div class="card ri-card">
        <div class="ri-summary">
          <div class="ri-kpi"><span class="ri-kpi-label" i18n="@@accounting.import.lignes.41c7025e">Lignes</span><span class="ri-kpi-value">{{ p.totalRows }}</span></div>
          <div class="ri-kpi"><span class="ri-kpi-label" i18n="@@accounting.import.valides.4cb63bf2">Valides</span><span class="ri-kpi-value ri-ok">{{ p.validRows }}</span></div>
          <div class="ri-kpi"><span class="ri-kpi-label" i18n="@@accounting.import.en.erreur.10a2e3df">En erreur</span><span class="ri-kpi-value" [class.ri-err]="p.rowsWithErrors > 0">{{ p.rowsWithErrors }}</span></div>
          <div class="ri-kpi"><span class="ri-kpi-label" i18n="@@accounting.import.deja.presents.cad005a1">Déjà présents</span><span class="ri-kpi-value">{{ p.existingRows }}</span></div>
          @if (p.mappedAccountCount > 0) {
            <div class="ri-kpi"><span class="ri-kpi-label" i18n="@@accounting.import.comptes.traduits.7bfb19b7">Comptes traduits</span><span class="ri-kpi-value">{{ p.mappedAccountCount }}</span></div>
          }
        </div>

        @if (p.unusedMappings.length > 0) {
          <p class="ri-help"><ng-container i18n="@@accounting.import.correspondance.s.jamais.rencontree.s.26021dc9">
            {{ p.unusedMappings.length }} correspondance(s) jamais rencontrée(s) :
            <code>{{ p.unusedMappings.slice(0, 10).join(', ') }}</code></ng-container>@if (p.unusedMappings.length > 10) { … }
          </p>
        }

        @if (p.issues.length > 0) {
          <div class="ri-issues">
            <h3 class="ri-issues-title" i18n="@@accounting.import.anomalie.s.a.corriger.avant.l.import.16553fe9">{{ p.issues.length }} anomalie(s) — à corriger avant l'import</h3>
            <ul class="ri-issues-list">
              @for (issue of p.issues.slice(0, 100); track $index) {
                <li><span class="ri-issue-ref">{{ issue.ref }}</span> {{ issue.message }}</li>
              }
            </ul>
          </div>
        }

        @if (p.sample.length > 0) {
          <h3 class="ri-sample-title" i18n="@@accounting.import.apercu.premiere.s.ligne.s.3f341043">Aperçu ({{ p.sample.length }} première(s) ligne(s))</h3>
          <p-table [value]="p.sample" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
            <ng-template pTemplate="header"><tr><th scope="col" i18n="@@accounting.import.ref.7f0a8d72">Réf.</th><th scope="col" i18n="@@accounting.import.resume.9fb58963">Résumé</th></tr></ng-template>
            <ng-template pTemplate="body" let-r><tr><td>{{ r.ref }}</td><td>{{ r.summary }}</td></tr></ng-template>
          </p-table>
        }

        <div class="ri-commit-bar">
          @if (p.canCommit) {
            <span class="ri-commit-hint" i18n="@@accounting.import.pret.a.importer.deja.present.s.seront.ig.a78966c9">Prêt à importer ({{ p.existingRows }} déjà présent(s) seront ignorés).</span>
          } @else {
            <span class="ri-commit-hint ri-err" i18n="@@accounting.import.corrigez.les.anomalies.bloquantes.avant.d.import.127ebca3">Corrigez les anomalies bloquantes avant d'importer.</span>
          }
          <app-button variant="primary" icon="pi pi-upload" type="button"
            (click)="runCommit()" [disabled]="!p.canCommit || busy()"
            ariaLabel="Importer le référentiel" i18n-ariaLabel="@@accounting.import.importer.le.referentiel.4d2aefcf">
            {{ committing() ? loc_ui_tern_import_4834ca : loc_ui_tern_importer_f54cfe }}
          </app-button>
        </div>
      </div>
    }
  `,
  styles: `
    .ri-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm,0 1px 3px rgba(15,23,42,0.08)); margin-bottom:var(--spacing-4); }
    .ri-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .form-field { display:flex; flex-direction:column; gap:var(--spacing-2); min-width:0; }
    .ri-field-file { flex:1 1 260px; }
    .field-label { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); margin:0; }
    .ri-input { padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); background:var(--color-background-elevated); color:var(--color-text-primary); font-size:var(--font-size-sm); min-height:2.5rem; }
    .ri-help { margin:var(--spacing-4) 0 0; font-size:var(--font-size-sm); color:var(--color-text-secondary); }
    .ri-help code { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background:var(--color-background-subtle); padding:0 0.25rem; border-radius:var(--radius-sm,4px); }
    .ri-success { display:flex; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-4); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); background:var(--color-success-50,#f0fdf4); border:1px solid var(--color-success-200,#bbf7d0); color:var(--color-success-700,#15803d); font-weight:var(--font-weight-medium); }
    .ri-summary { display:flex; flex-wrap:wrap; gap:var(--spacing-5); padding-bottom:var(--spacing-4); margin-bottom:var(--spacing-4); border-bottom:1px solid var(--color-border-subtle); }
    .ri-kpi { display:flex; flex-direction:column; gap:2px; }
    .ri-kpi-label { font-size:var(--font-size-xs); color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em; }
    .ri-kpi-value { font-size:var(--font-size-lg); font-weight:var(--font-weight-semibold); font-variant-numeric:tabular-nums; }
    .ri-ok { color:var(--color-success-700,#15803d); }
    .ri-err { color:var(--color-danger-600,#dc2626); }
    .ri-issues { margin-bottom:var(--spacing-4); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); background:var(--color-danger-50,#fef2f2); border:1px solid var(--color-danger-200,#fecaca); }
    .ri-issues-title { margin:0 0 var(--spacing-2); font-size:var(--font-size-sm); color:var(--color-danger-700,#b91c1c); }
    .ri-issues-list { margin:0; padding-left:var(--spacing-5); font-size:var(--font-size-sm); color:var(--color-text-secondary); }
    .ri-issue-ref { font-weight:var(--font-weight-semibold); color:var(--color-text-primary); margin-right:var(--spacing-1); }
    .ri-sample-title { margin:0 0 var(--spacing-3); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }
    .ri-commit-bar { display:flex; align-items:center; justify-content:flex-end; gap:var(--spacing-4); margin-top:var(--spacing-4); padding-top:var(--spacing-4); border-top:1px solid var(--color-border-subtle); }
    .ri-commit-hint { font-size:var(--font-size-sm); color:var(--color-text-secondary); }
  `
})
export class ReferenceImportComponent {
  readonly loc_ui_tern_import_4834ca = $localize`:@@ui.tern.import.4834ca:Import…`;
  readonly loc_ui_tern_importer_f54cfe = $localize`:@@ui.tern.importer.f54cfe:Importer`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);

  /** Cible d'import : 0 = plan comptable, 1 = plan tiers, 2 = balance d'ouverture. */
  @Input({ required: true }) target!: ReferenceImportTarget;

  format: JournalImportFormat = JournalImportFormat.Csv;
  fiscalYear = new Date().getFullYear() - 1;
  readonly selectedFile = signal<File | null>(null);
  /** Table de correspondance facultative (sans objet pour le plan tiers). */
  readonly mappingFile = signal<File | null>(null);
  readonly preview = signal<ReferenceImportPreviewDto | null>(null);
  readonly loading = signal(false);
  readonly committing = signal(false);
  readonly error = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  get expectedColumns(): string {
    switch (this.target) {
      case 1: return 'type, nom, email, rue, ville, gouvernorat (nif, telephone optionnels)';
      case 2: return 'compte, debit, credit';
      default: return 'compte, libelle, classe (nature : debit/credit, optionnelle)';
    }
  }

  busy(): boolean {
    return this.loading() || this.committing();
  }

  private get yearParam(): number | undefined {
    return this.target === 2 ? this.fiscalYear : undefined;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files && input.files.length > 0 ? input.files[0] : null);
    this.resetPreview();
  }

  onMappingSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.mappingFile.set(input.files && input.files.length > 0 ? input.files[0] : null);
    this.resetPreview();
  }

  private resetPreview(): void {
    this.preview.set(null);
    this.successMessage.set(null);
    this.error.set(null);
  }

  runPreview(): void {
    const file = this.selectedFile();
    if (!file || this.busy()) return;
    this.error.set(null);
    this.successMessage.set(null);
    this.loading.set(true);
    this.api.previewReferenceImport(file, this.target, this.format, this.yearParam, this.mappingFile()).subscribe({
      next: res => {
        this.loading.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.apercu.a.echoue.15045a:L'aperçu a échoué.`);
          return;
        }
        this.preview.set(res.data);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.reference-import.ts.erreur.reseau.lors.de.l.apercu.37b653a5:Erreur réseau lors de l'aperçu.`));
      }
    });
  }

  runCommit(): void {
    const file = this.selectedFile();
    const p = this.preview();
    if (!file || !p?.canCommit || this.busy()) return;
    this.error.set(null);
    this.committing.set(true);
    this.api.commitReferenceImport(file, this.target, this.format, this.yearParam, this.mappingFile()).subscribe({
      next: res => {
        this.committing.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.import.a.echoue.2e84df:L'import a échoué.`);
          return;
        }
        this.successMessage.set($localize`:@@accounting.reference-import.ts.createdcount.element.s.cree.s.skippedcou.955c971f:${res.data.createdCount}:createdCount: élément(s) créé(s), ${res.data.skippedCount}:skippedCount: ignoré(s).`);
        this.preview.set(null);
        this.selectedFile.set(null);
        this.mappingFile.set(null);
      },
      error: err => {
        this.committing.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.reference-import.ts.erreur.reseau.lors.de.l.import.085abb90:Erreur réseau lors de l'import.`));
      }
    });
  }
}
