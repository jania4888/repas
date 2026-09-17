import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ToastService } from '@core/services/toast.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import {
  AccountingService,
  MonthlyDeclarationModelImportResultDto
} from '../services/accounting.service';
import {
  DmModelSummary,
  describeImportOutcome,
  importChangedNothing,
  looksLikeModelFile,
  summariseModel
} from './monthly-declaration-model.view-model';

/**
 * Modèle Intégration DM — emporter la configuration d'un dossier dans un fichier, et l'appliquer
 * ailleurs. Complète la duplication inter-dossiers, qui ne franchit pas les frontières du cabinet.
 *
 * L'export est ouvert sous `accounting:read`, même drapeau éteint : le fichier ne fait que refléter
 * ce que l'écran de configuration affiche déjà. L'import est une écriture, avec le même verrou
 * cabinet délégué que le reste.
 */
@Component({
  selector: 'app-monthly-declaration-model',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent
  ],
  template: `
    <app-page-header
      title="Modèle Intégration DM"
      subtitle="Emporter la configuration d’un dossier dans un fichier, et l’appliquer à un autre" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <section class="card dm-block">
      <h3 class="dm-block__title">Exporter</h3>
      <p class="dm-block__text">
        Produit un fichier JSON portant les rubriques du dossier — actives comme désactivées — et
        l’inclusion de chaque famille. Le régime de calcul et l’historique des contrôles de parité
        n’y figurent pas : ils appartiennent au dossier, pas au paramétrage.
      </p>
      <div class="dm-actions">
        <app-button
          variant="secondary"
          icon="pi-download"
          type="button"
          [disabled]="exporting()"
          (click)="exportModel()">
          {{ exporting() ? 'Export…' : 'Exporter le modèle' }}
        </app-button>
      </div>
    </section>

    <section class="card dm-block">
      <h3 class="dm-block__title">Importer</h3>

      @if (!canWrite()) {
        <app-accounting-status-banner
          variant="info"
          message="Import réservé au cabinet comptable ouvrant le dossier. L’export reste disponible." />
      }

      <p class="dm-block__text">
        Les rubriques dont le code est absent du dossier sont créées. Une rubrique du dossier qui
        ne figure pas dans le fichier n’est jamais supprimée : un modèle complète une configuration,
        il ne la remplace pas.
      </p>

      <div class="dm-field">
        <label class="dm-lbl" for="dm-model-file">Fichier de modèle (.json)</label>
        <input
          id="dm-model-file"
          type="file"
          accept="application/json,.json"
          class="dm-inp"
          [disabled]="!canWrite() || importing()"
          (change)="pickFile($event)" />
      </div>

      @if (summary(); as s) {
        @if (s.error) {
          <p class="dm-invalid">{{ s.error }}</p>
        } @else {
          <dl class="dm-facts">
            <div>
              <dt>Rubriques</dt>
              <dd>{{ s.rubricCount }}</dd>
            </div>
            @if (s.modelVersion) {
              <div>
                <dt>Format</dt>
                <dd>{{ s.modelVersion }}</dd>
              </div>
            }
            @if (s.catalogVersion) {
              <div>
                <dt>Catalogue</dt>
                <dd>{{ s.catalogVersion }}</dd>
              </div>
            }
          </dl>

          @if (s.silentOnFamilies) {
            <p class="dm-hint">
              Ce fichier ne dit rien des familles : aucune inclusion du dossier ne sera modifiée.
            </p>
          } @else {
            @if (s.includedFamilies.length) {
              <p class="dm-hint dm-hint--flag">
                Familles que le fichier demande d’<strong>inclure</strong> :
                {{ s.includedFamilies.join(', ') }}. Leur inclusion change les montants déclarés dès
                que le dossier calcule en mode paramétré.
              </p>
            }
            @if (s.excludedFamilies.length) {
              <p class="dm-hint">
                Familles que le fichier demande d’exclure : {{ s.excludedFamilies.join(', ') }}.
              </p>
            }
          }
        }
      }

      <label class="dm-check">
        <input
          type="checkbox"
          [(ngModel)]="overwrite"
          [disabled]="!canWrite() || importing()" />
        Remplacer les rubriques de même code au lieu de les ignorer
      </label>

      <div class="dm-actions">
        <app-button
          variant="primary"
          icon="pi-upload"
          type="button"
          [disabled]="!canWrite() || importing() || !readyToImport()"
          (click)="importModel()">
          {{ importing() ? 'Import…' : 'Importer' }}
        </app-button>
      </div>

      @if (result(); as r) {
        <div class="dm-report" role="status">
          <p class="dm-report__line">{{ outcome(r) }}</p>
          @if (nothingChanged(r)) {
            <p class="dm-hint">
              Le fichier n’a rien ajouté : tous ses codes existaient déjà. Cochez « Remplacer » pour
              appliquer sa version.
            </p>
          }
          @if (r.skippedCodes.length) {
            <p class="dm-hint">Codes déjà présents, laissés intacts : {{ r.skippedCodes.join(', ') }}</p>
          }
          @if (r.unknownAccounts.length) {
            <p class="dm-hint dm-hint--flag">
              Comptes absents du plan du dossier, enregistrés quand même :
              {{ r.unknownAccounts.join(', ') }}
            </p>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .dm-block { display: flex; flex-direction: column; gap: var(--spacing-3); margin-bottom: var(--spacing-4); }
    .dm-block__title { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .dm-block__text { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-field { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .dm-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .dm-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); }
    .dm-facts { display: flex; flex-wrap: wrap; gap: var(--spacing-5); margin: 0; }
    .dm-facts dt { font-size: var(--font-size-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
    .dm-facts dd { margin: 0; font-weight: var(--font-weight-semibold); }
    .dm-hint { margin: 0; font-size: var(--font-size-xs); color: var(--color-text-secondary); }
    .dm-hint--flag { color: var(--color-warning-700, #a16207); }
    .dm-invalid { margin: 0; font-size: var(--font-size-sm); color: var(--color-danger-700, #b91c1c); }
    .dm-check { display: flex; align-items: center; gap: var(--spacing-2); font-size: var(--font-size-sm); }
    .dm-actions { display: flex; justify-content: flex-end; }
    .dm-report { display: flex; flex-direction: column; gap: var(--spacing-1); border-left: 3px solid var(--color-success-500, #22c55e); padding-left: var(--spacing-3); }
    .dm-report__line { margin: 0; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
  `
})
export class MonthlyDeclarationModelComponent {
  private readonly api = inject(AccountingService);
  private readonly auth = inject(AuthService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly toast = inject(ToastService);

  readonly content = signal<string | null>(null);
  readonly summary = signal<DmModelSummary | null>(null);
  readonly result = signal<MonthlyDeclarationModelImportResultDto | null>(null);

  readonly exporting = signal(false);
  readonly importing = signal(false);
  readonly error = signal<string | null>(null);

  overwrite = false;

  /** Miroir du verrou serveur `IsAccountingFirmDelegatedContext`, qui ne garde que l'import. */
  readonly canWrite = computed(() => this.auth.isAccountingFirm() && this.auth.isDelegatedMode());

  readonly readyToImport = computed(() => {
    const s = this.summary();
    return !!this.content() && !!s && s.error === null;
  });

  outcome(result: MonthlyDeclarationModelImportResultDto): string {
    return describeImportOutcome(result);
  }

  nothingChanged(result: MonthlyDeclarationModelImportResultDto): boolean {
    return importChangedNothing(result);
  }

  exportModel(): void {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(true);
    this.error.set(null);
    this.api.exportMonthlyDeclarationModel().subscribe({
      next: res => {
        this.exporting.set(false);
        if (res.success && res.data) {
          this.download(res.data.content, res.data.fileName);
          this.toast.add({
            severity: 'success',
            summary: 'Modèle exporté',
            detail: res.data.fileName,
            life: 4000
          });
        } else {
          this.error.set(res.error ?? 'L’export du modèle a échoué.');
        }
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    this.result.set(null);
    this.error.set(null);

    if (!file) {
      this.content.set(null);
      this.summary.set(null);
      return;
    }

    if (!looksLikeModelFile(file.name)) {
      this.content.set(null);
      this.summary.set(null);
      this.error.set('Choisissez un fichier .json produit par l’export du modèle.');
      return;
    }

    file.text().then(
      text => {
        this.content.set(text);
        this.summary.set(summariseModel(text));
      },
      () => {
        this.content.set(null);
        this.summary.set(null);
        this.error.set('Le fichier n’a pas pu être lu.');
      }
    );
  }

  importModel(): void {
    const content = this.content();
    if (!content || this.importing() || !this.readyToImport()) {
      return;
    }

    this.importing.set(true);
    this.error.set(null);
    this.api
      .importMonthlyDeclarationModel({ content, overwrite: this.overwrite })
      .subscribe({
        next: res => {
          this.importing.set(false);
          if (res.success && res.data) {
            this.result.set(res.data);
            this.toast.add({
              severity: 'success',
              summary: 'Modèle importé',
              detail: describeImportOutcome(res.data),
              life: 5000
            });
          } else {
            this.result.set(null);
            this.error.set(res.error ?? 'L’import du modèle a été refusé.');
          }
        },
        error: err => {
          this.importing.set(false);
          this.result.set(null);
          this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
        }
      });
  }

  private download(content: string, fileName: string): void {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
