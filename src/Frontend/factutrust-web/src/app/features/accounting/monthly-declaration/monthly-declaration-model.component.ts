/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
 * ce que l'écran de configuration affiche déjà. L'import est une écriture, avec les mêmes verrous
 * que le reste — cabinet délégué et interrupteur de la plateforme allumé.
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
      title="Modèle Intégration DM" i18n-title="@@accounting.monthly-declaration.modele.integration.dm.bf548515"
      subtitle="Emporter la configuration d’un dossier dans un fichier, et l’appliquer à un autre" i18n-subtitle="@@accounting.monthly-declaration.emporter.la.configuration.d.un.dossier.d.f378c695" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <section class="card dm-block">
      <h3 class="dm-block__title" i18n="@@accounting.monthly-declaration.exporter.0cd84bdc">Exporter</h3>
      <p class="dm-block__text" i18n="@@accounting.monthly-declaration.produit.un.fichier.json.portant.les.rubriques.du.c7546c88"> Produit un fichier JSON portant les rubriques du dossier — actives comme désactivées — et
        l’inclusion de chaque famille. </p>
      <div class="dm-actions">
        <app-button
          variant="secondary"
          icon="pi-download"
          type="button"
          [disabled]="exporting()"
          (click)="exportModel()">
          {{ exporting() ? loc_ui_tern_export_0a1163 : loc_ui_tern_exporter_le_modele_93eb36 }}
        </app-button>
      </div>
    </section>

    <section class="card dm-block">
      <h3 class="dm-block__title" i18n="@@accounting.monthly-declaration.importer.f54cfe90">Importer</h3>

      @if (!canWrite()) {
        <app-accounting-status-banner
          variant="info"
          message="Import réservé au cabinet comptable ouvrant le dossier. L’export reste disponible." i18n-message="@@accounting.monthly-declaration.import.reserve.au.cabinet.comptable.ouvr.7a678a48" />
      }

      @if (canWrite() && linesDisabled()) {
        <app-accounting-status-banner
          variant="info"
          message="Import indisponible : la déclaration mensuelle paramétrable est désactivée sur la plateforme. L’export reste disponible." i18n-message="@@accounting.monthly-declaration.import.indisponible.la.declaration.mensu.c9763f87" />
      }

      <p class="dm-block__text" i18n="@@accounting.monthly-declaration.les.rubriques.dont.le.code.est.absent.du.dossier.3eb61e10"> Les rubriques dont le code est absent du dossier sont créées. Une rubrique du dossier qui
        ne figure pas dans le fichier n’est jamais supprimée : un modèle complète une configuration,
        il ne la remplace pas. </p>

      <div class="dm-field">
        <label class="dm-lbl" for="dm-model-file" i18n="@@accounting.monthly-declaration.fichier.de.modele.json.1e799b42">Fichier de modèle (.json)</label>
        <input
          id="dm-model-file"
          type="file"
          accept="application/json,.json"
          class="dm-inp"
          [disabled]="!canImport() || importing()"
          (change)="pickFile($event)" />
      </div>

      @if (summary(); as s) {
        @if (s.error) {
          <p class="dm-invalid">{{ s.error }}</p>
        } @else {
          <dl class="dm-facts">
            <div>
              <dt i18n="@@accounting.monthly-declaration.rubriques.a5155d21">Rubriques</dt>
              <dd>{{ s.rubricCount }}</dd>
            </div>
            @if (s.modelVersion) {
              <div>
                <dt i18n="@@accounting.monthly-declaration.format.041a5dec">Format</dt>
                <dd>{{ s.modelVersion }}</dd>
              </div>
            }
            @if (s.catalogVersion) {
              <div>
                <dt i18n="@@accounting.monthly-declaration.catalogue.5a241023">Catalogue</dt>
                <dd>{{ s.catalogVersion }}</dd>
              </div>
            }
          </dl>

          @if (!s.silentOnFamilies && !s.isCurrentFormat) {
            <p class="dm-hint" i18n="@@accounting.monthly-declaration.fichier.anterieur.a.la.version.2.ses.inclusions..c4bd230e">
              Fichier antérieur à la version 2 : ses inclusions de familles seront ignorées — tout
              export antérieur les porte à « non incluse », les appliquer décocherait le dossier.
            </p>
          } @else if (s.silentOnFamilies) {
            <p class="dm-hint" i18n="@@accounting.monthly-declaration.ce.fichier.ne.dit.rien.des.familles.aucune.inclu.0ce77b0a"> Ce fichier ne dit rien des familles : aucune inclusion du dossier ne sera modifiée. </p>
          } @else {
            @if (s.includedFamilies.length) {
              <p class="dm-hint dm-hint--flag" i18n="@@accounting.monthly-declaration.familles.que.le.fichier.demande.d.inclur.856a4115">
                <ng-container> Familles que le fichier demande d’</ng-container><strong>inclure</strong> :
                {{ s.includedFamilies.join(', ') }}. Leur inclusion change les montants déclarés.
              </p>
            }
            @if (s.excludedFamilies.length) {
              <p class="dm-hint" i18n="@@accounting.monthly-declaration.familles.que.le.fichier.demande.d.exclur.57049f11">
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
          [disabled]="!canImport() || importing()" /><ng-container i18n="@@accounting.monthly-declaration.remplacer.les.rubriques.de.meme.code.au.ba00883f">
        Remplacer les rubriques de même code au lieu de les ignorer
      </ng-container></label>

      @if (summary(); as s) {
        @if (s.isCurrentFormat && s.excludedFamilies.length) {
          <label class="dm-check">
            <input
              type="checkbox"
              [(ngModel)]="confirmExclusions"
              [disabled]="!canImport() || importing()" />
            <span i18n="@@accounting.monthly-declaration.confirmer.l.exclusion.de.le.dossier.cessera.de.d.35bac01c">Confirmer l’exclusion de {{ s.excludedFamilies.join(', ') }} : le dossier cessera de déclarer ces familles</span>
          </label>
        }
      }

      <div class="dm-actions">
        <app-button
          variant="primary"
          icon="pi-upload"
          type="button"
          [disabled]="!canImport() || importing() || !readyToImport()"
          (click)="importModel()">
          {{ importing() ? loc_ui_tern_import_4834ca : loc_ui_tern_importer_f54cfe }}
        </app-button>
      </div>

      @if (result(); as r) {
        <div class="dm-report" role="status">
          <p class="dm-report__line">{{ outcome(r) }}</p>
          @if (nothingChanged(r)) {
            <p class="dm-hint" i18n="@@accounting.monthly-declaration.le.fichier.n.a.rien.ajoute.tous.ses.codes.exista.0c39b76a"> Le fichier n’a rien ajouté : tous ses codes existaient déjà. Cochez « Remplacer » pour
              appliquer sa version. </p>
          }
          @if (r.skippedCodes.length) {
            <p class="dm-hint" i18n="@@accounting.monthly-declaration.codes.deja.presents.laisses.intacts.76ddabb0">Codes déjà présents, laissés intacts : {{ r.skippedCodes.join(', ') }}</p>
          }
          @if (r.unknownAccounts.length) {
            <p class="dm-hint dm-hint--flag" i18n="@@accounting.monthly-declaration.comptes.absents.du.plan.du.dossier.enreg.84328d0a">
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
    .dm-report { display: flex; flex-direction: column; gap: var(--spacing-1); border-inline-start: 3px solid var(--color-success-500, #22c55e); padding-inline-start: var(--spacing-3); }
    .dm-report__line { margin: 0; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
  `
})
export class MonthlyDeclarationModelComponent implements OnInit {
  readonly loc_ui_tern_export_0a1163 = $localize`:@@ui.tern.export.0a1163:Export…`;
  readonly loc_ui_tern_exporter_le_modele_93eb36 = $localize`:@@ui.tern.exporter.le.modele.93eb36:Exporter le modèle`;
  readonly loc_ui_tern_import_4834ca = $localize`:@@ui.tern.import.4834ca:Import…`;
  readonly loc_ui_tern_importer_f54cfe = $localize`:@@ui.tern.importer.f54cfe:Importer`;
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
  /** Décocher une famille par import exige une confirmation explicite (refus serveur sinon). */
  confirmExclusions = false;

  /** Miroir du verrou serveur `IsAccountingFirmDelegatedContext`, qui ne garde que l'import. */
  readonly canWrite = computed(() => this.auth.isAccountingFirm() && this.auth.isDelegatedMode());

  /**
   * Vrai seulement quand le serveur a dit explicitement que l'interrupteur est éteint. Un échec de
   * lecture laisse l'import proposé : le serveur reste seul juge, et une panne passagère ne doit pas
   * fermer l'écran.
   */
  readonly linesDisabled = signal(false);

  readonly canImport = computed(() => this.canWrite() && !this.linesDisabled());

  readonly readyToImport = computed(() => {
    const s = this.summary();
    return !!this.content() && !!s && s.error === null;
  });

  ngOnInit(): void {
    // Seul l'import dépend de l'interrupteur, et seul le cabinet délégué peut importer : inutile
    // d'interroger le serveur pour une société.
    if (!this.canWrite()) {
      return;
    }
    // `includeInactive: false` — seuls les réglages intéressent cet écran, pas les rubriques.
    this.api.getMonthlyDeclarationConfiguration(false).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.linesDisabled.set(res.data.settings?.enabled === false);
        }
      },
      error: () => undefined
    });
  }

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
            summary: $localize`:@@monthly-declaration-model.component.summary.Modèle expor:Modèle exporté`,
            detail: res.data.fileName,
            life: 4000
          });
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.export.du.modele.a.echoue.194856:L’export du modèle a échoué.`);
        }
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.monthly-declaration-model.ts.erreur.reseau.0683007f:Erreur réseau`));
      }
    });
  }

  pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    this.result.set(null);
    this.error.set(null);
    // Une confirmation vaut pour le fichier qu'on a lu, pas pour le suivant.
    this.confirmExclusions = false;

    if (!file) {
      this.content.set(null);
      this.summary.set(null);
      return;
    }

    if (!looksLikeModelFile(file.name)) {
      this.content.set(null);
      this.summary.set(null);
      this.error.set($localize`:@@accounting.monthly-declaration-model.ts.choisissez.un.fichier.json.produit.par.l.4ee3476e:Choisissez un fichier .json produit par l’export du modèle.`);
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
        this.error.set($localize`:@@accounting.monthly-declaration-model.ts.le.fichier.n.a.pas.pu.etre.lu.49597327:Le fichier n’a pas pu être lu.`);
      }
    );
  }

  importModel(): void {
    const content = this.content();
    if (!this.canImport() || !content || this.importing() || !this.readyToImport()) {
      return;
    }

    this.importing.set(true);
    this.error.set(null);
    this.api
      .importMonthlyDeclarationModel({
        content,
        overwrite: this.overwrite,
        confirmFamilyExclusions: this.confirmExclusions
      })
      .subscribe({
        next: res => {
          this.importing.set(false);
          if (res.success && res.data) {
            this.result.set(res.data);
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@monthly-declaration-model.component.summary.Modèle impor:Modèle importé`,
              detail: describeImportOutcome(res.data),
              life: 5000
            });
          } else {
            this.result.set(null);
            this.error.set(res.error ?? $localize`:@@ui.tern.l.import.du.modele.a.ete.refuse.a3064d:L’import du modèle a été refusé.`);
          }
        },
        error: err => {
          this.importing.set(false);
          this.result.set(null);
          this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.monthly-declaration-model.ts.erreur.reseau.0683007f:Erreur réseau`));
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
