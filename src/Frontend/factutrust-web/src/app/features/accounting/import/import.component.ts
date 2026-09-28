import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import {
  AccountingService,
  JournalImportFormat,
  JournalImportPreviewDto
} from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-accounting-import',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <div class="card import-card">
      <div class="import-fields">
        <div class="form-field">
          <label class="field-label" for="imp-format" i18n="@@accounting.import.format.041a5dec">Format</label>
          <select id="imp-format" class="import-input" [(ngModel)]="format" [disabled]="busy()">
            <option [ngValue]="0" i18n="@@accounting.import.csv.delimite.d957a0e8">CSV (délimité)</option>
            <option [ngValue]="1" i18n="@@accounting.import.excel.xlsx.47f8ecb0">Excel (.xlsx)</option>
            <option [ngValue]="2" i18n="@@accounting.import.fec.fichier.des.ecritures.comptables.dbcbf998">FEC (fichier des écritures comptables)</option>
          </select>
        </div>
        <div class="form-field import-field-file">
          <label class="field-label" for="imp-file" i18n="@@accounting.import.fichier.f0fa5745">Fichier</label>
          <input id="imp-file" type="file" class="import-input" (change)="onFileSelected($event)" [disabled]="busy()"
            accept=".csv,.txt,.xlsx,.tsv" />
        </div>
        <div class="form-field import-field-file">
          <label class="field-label" for="imp-mapping" i18n="@@accounting.import.table.de.correspondance.facultatif.4e919db4">Table de correspondance (facultatif)</label>
          <input id="imp-mapping" type="file" class="import-input" (change)="onMappingSelected($event)" [disabled]="busy()"
            accept=".csv,.txt,.xlsx,.tsv" />
        </div>
        <div class="import-actions">
          <app-button variant="secondary" icon="pi pi-search" type="button"
            (click)="runPreview()" [disabled]="!selectedFile() || busy()"
            ariaLabel="Analyser le fichier sans rien enregistrer" i18n-ariaLabel="@@accounting.import.analyser.le.fichier.sans.rien.enregistre.d298afee" i18n="@@accounting.import.apercu.f0f53004"> Aperçu </app-button>
        </div>
      </div>

      <p class="import-help" i18n="@@accounting.import.colonnes.attendues.csv.excel.1.re.ligne.8738dd4f">
        <ng-container> Colonnes attendues (CSV/Excel, 1</ng-container><sup>re</sup> ligne = en-têtes) : <code>journal, numero, date, compte, libelle, debit, credit</code>.
        Les lignes de même <code>journal</code>+<code>numero</code> forment une pièce. Pour une balance d'ouverture,
        utilisez le journal <code>JAN</code>. Les écritures importées arrivent <strong>en brouillard</strong> et devront être validées.
      </p>
      <p class="import-help" i18n="@@accounting.import.table.de.correspondance.reprise.depuis.u.426db73a">
        <strong>Table de correspondance</strong> (reprise depuis un autre progiciel) : colonnes
        <code>source, cible</code>. Chaque compte listé est traduit vers le plan comptable local avant
        contrôle ; un compte absent de la table passe <strong>inchangé</strong>.
      </p>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    @if (successMessage(); as msg) {
      <div class="import-success" role="status">
        <i class="pi pi-check-circle" aria-hidden="true"></i>
        <span>{{ msg }}</span>
      </div>
    }

    @if (preview(); as p) {
      <div class="card import-card">
        <div class="import-summary">
          <div class="import-kpi"><span class="import-kpi-label" i18n="@@accounting.import.ecritures.7bfac2f6">Écritures</span><span class="import-kpi-value">{{ p.totalEntries }}</span></div>
          <div class="import-kpi"><span class="import-kpi-label" i18n="@@accounting.import.lignes.41c7025e">Lignes</span><span class="import-kpi-value">{{ p.totalLines }}</span></div>
          <div class="import-kpi"><span class="import-kpi-label" i18n="@@accounting.import.valides.4cb63bf2">Valides</span><span class="import-kpi-value import-ok">{{ p.validEntries }}</span></div>
          <div class="import-kpi"><span class="import-kpi-label" i18n="@@accounting.import.en.erreur.10a2e3df">En erreur</span><span class="import-kpi-value" [class.import-err]="p.entriesWithErrors > 0">{{ p.entriesWithErrors }}</span></div>
          <div class="import-kpi"><span class="import-kpi-label" i18n="@@accounting.import.total.debit.ea9c4853">Total débit</span><span class="import-kpi-value">{{ p.totalDebit | number : '1.3-3' }}</span></div>
          <div class="import-kpi"><span class="import-kpi-label" i18n="@@accounting.import.total.credit.98c95962">Total crédit</span><span class="import-kpi-value">{{ p.totalCredit | number : '1.3-3' }}</span></div>
          @if (p.mappedAccountCount > 0) {
            <div class="import-kpi"><span class="import-kpi-label" i18n="@@accounting.import.comptes.traduits.7bfb19b7">Comptes traduits</span><span class="import-kpi-value">{{ p.mappedAccountCount }}</span></div>
          }
        </div>

        @if (p.unusedMappings.length > 0) {
          <p class="import-help import-unused"><ng-container i18n="@@accounting.import.correspondance.s.jamais.rencontree.s.26021dc9">
            {{ p.unusedMappings.length }} correspondance(s) jamais rencontrée(s) :
            <code>{{ p.unusedMappings.slice(0, 10).join(', ') }}</code></ng-container>@if (p.unusedMappings.length > 10) { … }
          </p>
        }

        @if (p.issues.length > 0) {
          <div class="import-issues">
            <h3 class="import-issues-title" i18n="@@accounting.import.anomalie.s.a.corriger.avant.l.import.16553fe9">{{ p.issues.length }} anomalie(s) — à corriger avant l'import</h3>
            <ul class="import-issues-list">
              @for (issue of p.issues.slice(0, 100); track $index) {
                <li><span class="import-issue-ref">{{ issue.ref }}</span> {{ issue.message }}</li>
              }
            </ul>
            @if (p.issues.length > 100) {
              <p class="import-issues-more" i18n="@@accounting.import.et.autre.s.4e567bfc">… et {{ p.issues.length - 100 }} autre(s).</p>
            }
          </div>
        }

        @if (p.sample.length > 0) {
          <h3 class="import-sample-title" i18n="@@accounting.import.apercu.premiere.s.ecriture.s.bd265427">Aperçu ({{ p.sample.length }} première(s) écriture(s))</h3>
          <p-table [value]="p.sample" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" i18n="@@accounting.import.piece.954bbc8c">Pièce</th>
                <th scope="col" i18n="@@accounting.import.journal.57d7f743">Journal</th>
                <th scope="col" i18n="@@accounting.import.date.eb9a4bc1">Date</th>
                <th scope="col" i18n="@@accounting.import.libelle.f5485bba">Libellé</th>
                <th scope="col" class="import-col-amount" i18n="@@accounting.import.debit.f528224f">Débit</th>
                <th scope="col" class="import-col-amount" i18n="@@accounting.import.credit.19194bdf">Crédit</th>
                <th scope="col" i18n="@@accounting.import.equilibre.9f5b5fc0">Équilibre</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-e>
              <tr>
                <td>{{ e.ref }}</td>
                <td>{{ e.journalCode }}</td>
                <td>{{ e.entryDate | date : 'shortDate' }}</td>
                <td>{{ e.label }}</td>
                <td class="import-col-amount">{{ e.totalDebit | number : '1.3-3' }}</td>
                <td class="import-col-amount">{{ e.totalCredit | number : '1.3-3' }}</td>
                <td>
                  <span class="import-badge" [class.import-badge-ok]="e.isBalanced" [class.import-badge-ko]="!e.isBalanced">
                    {{ e.isBalanced ? 'OK' : loc_ui_tern_desequilibree_aff27e }}
                  </span>
                </td>
              </tr>
            </ng-template>
          </p-table>
        }

        <div class="import-commit-bar">
          @if (p.canCommit) {
            <span class="import-commit-hint" i18n="@@accounting.import.pret.a.importer.ecriture.s.en.brouillard.7ebdad8e">Prêt à importer {{ p.totalEntries }} écriture(s) en brouillard.</span>
          } @else {
            <span class="import-commit-hint import-err" i18n="@@accounting.import.corrigez.les.anomalies.bloquantes.avant.d.import.127ebca3">Corrigez les anomalies bloquantes avant d'importer.</span>
          }
          <app-button variant="primary" icon="pi pi-upload" type="button"
            (click)="runCommit()" [disabled]="!p.canCommit || busy()"
            ariaLabel="Importer les écritures en brouillard" i18n-ariaLabel="@@accounting.import.importer.les.ecritures.en.brouillard.7cf75604">
            {{ committing() ? loc_ui_tern_import_4834ca : loc_ui_tern_importer_en_brouillard_347e35 }}
          </app-button>
        </div>
      </div>
    }
  `,
  styles: `
    .import-card {
      padding: var(--spacing-5);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.08));
      margin-bottom: var(--spacing-4);
    }
    .import-fields {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--spacing-4);
    }
    .form-field { display: flex; flex-direction: column; gap: var(--spacing-2); min-width: 0; }
    .import-field-file { flex: 1 1 260px; }
    .field-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin: 0; }
    .import-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      min-height: 2.5rem;
    }
    .import-help {
      margin: var(--spacing-4) 0 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
    .import-help code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--color-background-subtle);
      padding: 0 0.25rem;
      border-radius: var(--radius-sm, 4px);
    }
    .import-success {
      display: flex; align-items: center; gap: var(--spacing-2);
      margin-bottom: var(--spacing-4); padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-md);
      background: var(--color-success-50, #f0fdf4);
      border: 1px solid var(--color-success-200, #bbf7d0);
      color: var(--color-success-700, #15803d);
      font-weight: var(--font-weight-medium);
    }
    .import-summary {
      display: flex; flex-wrap: wrap; gap: var(--spacing-5);
      padding-bottom: var(--spacing-4); margin-bottom: var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .import-kpi { display: flex; flex-direction: column; gap: 2px; }
    .import-kpi-label { font-size: var(--font-size-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
    .import-kpi-value { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); font-variant-numeric: tabular-nums; }
    .import-ok { color: var(--color-success-700, #15803d); }
    .import-err { color: var(--color-danger-600, #dc2626); }
    .import-issues {
      margin-bottom: var(--spacing-4); padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-md);
      background: var(--color-danger-50, #fef2f2);
      border: 1px solid var(--color-danger-200, #fecaca);
    }
    .import-issues-title { margin: 0 0 var(--spacing-2); font-size: var(--font-size-sm); color: var(--color-danger-700, #b91c1c); }
    .import-issues-list { margin: 0; padding-inline-start: var(--spacing-5); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .import-issue-ref { font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-inline-end: var(--spacing-1); }
    .import-issues-more { margin: var(--spacing-2) 0 0; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .import-sample-title { margin: 0 0 var(--spacing-3); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .import-col-amount { text-align: end; font-variant-numeric: tabular-nums; }
    .import-badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .import-badge-ok { background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d); }
    .import-badge-ko { background: var(--color-danger-100, #fee2e2); color: var(--color-danger-700, #b91c1c); }
    .import-commit-bar {
      display: flex; align-items: center; justify-content: flex-end; gap: var(--spacing-4);
      margin-top: var(--spacing-4); padding-top: var(--spacing-4);
      border-top: 1px solid var(--color-border-subtle);
    }
    .import-commit-hint { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
  `
})
export class ImportComponent {
  readonly loc_ui_tern_desequilibree_aff27e = $localize`:@@ui.tern.desequilibree.aff27e:Déséquilibrée`;
  readonly loc_ui_tern_import_4834ca = $localize`:@@ui.tern.import.4834ca:Import…`;
  readonly loc_ui_tern_importer_en_brouillard_347e35 = $localize`:@@ui.tern.importer.en.brouillard.347e35:Importer en brouillard`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);

  format: JournalImportFormat = JournalImportFormat.Csv;
  readonly selectedFile = signal<File | null>(null);
  /** Table de correspondance facultative — null = import inchangé. */
  readonly mappingFile = signal<File | null>(null);
  readonly preview = signal<JournalImportPreviewDto | null>(null);
  readonly loading = signal(false);
  readonly committing = signal(false);
  readonly error = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  busy(): boolean {
    return this.loading() || this.committing();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files && input.files.length > 0 ? input.files[0] : null);
    this.resetPreview();
  }

  onMappingSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.mappingFile.set(input.files && input.files.length > 0 ? input.files[0] : null);
    // L'aperçu dépend de la table : il doit être rejoué après un changement.
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
    this.api.previewJournalImport(file, this.format, this.mappingFile()).subscribe({
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
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.import.ts.erreur.reseau.lors.de.l.apercu.37b653a5:Erreur réseau lors de l'aperçu.`));
      }
    });
  }

  runCommit(): void {
    const file = this.selectedFile();
    const p = this.preview();
    if (!file || !p?.canCommit || this.busy()) return;
    this.error.set(null);
    this.committing.set(true);
    this.api.commitJournalImport(file, this.format, this.mappingFile()).subscribe({
      next: res => {
        this.committing.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.import.a.echoue.2e84df:L'import a échoué.`);
          return;
        }
        this.successMessage.set(
          $localize`:@@accounting.import.ts.importedentries.ecriture.s.et.importedli.3ba5c35e:${res.data.importedEntries}:importedEntries: écriture(s) et ${res.data.importedLines}:importedLines: ligne(s) importées en brouillard. Validez-les depuis le journal.`
        );
        this.preview.set(null);
        this.selectedFile.set(null);
        this.mappingFile.set(null);
      },
      error: err => {
        this.committing.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.import.ts.erreur.reseau.lors.de.l.import.085abb90:Erreur réseau lors de l'import.`));
      }
    });
  }
}
