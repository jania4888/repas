import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../../shared/accounting-status-banner.component';
import {
  AccountingService,
  AccountMappingSuggestionItemDto,
  ColumnMappingSuggestionItemDto,
  JournalImportFormat,
  MigrationAnalysisDto,
  MigrationSourceSystem,
  MigrationSuggestionOrigin,
  ReferenceImportPreviewDto,
  ReferenceImportTarget,
  ThirdPartyDuplicatePairDto
} from '../../services/accounting.service';

/**
 * Wizard de migration assistée par IA (N1) — 6 étapes : dépôt → analyse → correspondances →
 * aperçu (dry-run) → commit → résultat. Les suggestions (colonnes, comptes, doublons) sont
 * toujours éditables ; l'import effectif passe par reference-import/preview|commit, INCHANGÉS.
 * Si le feature flag backend est désactivé (404), l'écran se replie sur un renvoi vers les
 * onglets d'import standard — aucun blocage.
 */
@Component({
  selector: 'app-migration-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    @if (featureUnavailable()) {
      <div class="card mw-card">
        <p class="mw-help">
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          La migration assistée n'est pas activée sur cette installation. Utilisez les onglets
          d'import standard (Plan comptable, Plan tiers, Balance d'ouverture) — ils restent pleinement
          fonctionnels.
        </p>
      </div>
    } @else {
      <!-- Indicateur d'étapes -->
      <div class="mw-steps" role="list" aria-label="Étapes de la migration assistée" i18n-aria-label="Étapes de la migration assistée">
        @for (s of stepLabels; track $index) {
          <span class="mw-step" role="listitem" [class.mw-step-active]="$index === step()" [class.mw-step-done]="$index < step()">
            {{ $index + 1 }}. {{ s }}
          </span>
        }
      </div>

      <!-- Étape 1 : dépôt + analyse -->
      @if (step() === 0) {
        <div class="card mw-card">
          <div class="form-field mw-field-file">
            <label class="field-label" for="mw-file" i18n="@@accounting.import.fichier.source.export.sage.ebp.excel.csv.d315d87e">Fichier source (export Sage, EBP, Excel, CSV…)</label>
            <input id="mw-file" type="file" class="mw-input" (change)="onFileSelected($event)" [disabled]="busy()" accept=".csv,.txt,.xlsx,.tsv" />
          </div>
          <div class="mw-actions">
            <app-button variant="primary" icon="pi pi-search" type="button"
              (click)="analyze()" [disabled]="!file || busy()"
              ariaLabel="Analyser le fichier sans rien enregistrer" i18n="@@accounting.import.analyser.d06ab560"> Analyser </app-button>
          </div>
          <p class="mw-help" i18n="@@accounting.import.l.analyse.detecte.le.progiciel.source.et.la.cibl.b7801323">L'analyse détecte le progiciel source et la cible probable. Aucune donnée n'est enregistrée.</p>
        </div>
      }

      <!-- Étape 2 : résultat d'analyse -->
      @if (step() === 1 && analysis(); as a) {
        <div class="card mw-card">
          <div class="mw-summary">
            <div class="mw-kpi"><span class="mw-kpi-label" i18n="@@accounting.import.progiciel.detecte.aa375c01">Progiciel détecté</span><span class="mw-kpi-value">{{ sourceLabel(a.detectedSource) }}</span></div>
            <div class="mw-kpi"><span class="mw-kpi-label" i18n="@@accounting.import.lignes.41c7025e">Lignes</span><span class="mw-kpi-value">{{ a.sampleRowCount }}</span></div>
            <div class="mw-kpi"><span class="mw-kpi-label" i18n="@@accounting.import.format.041a5dec">Format</span><span class="mw-kpi-value">{{ a.format === 1 ? loc_ui_tern_excel_a08e11 : loc_ui_tern_csv_328118 }}</span></div>
          </div>
          <div class="form-field">
            <label class="field-label" for="mw-target" i18n="@@accounting.import.cible.d.import.5a0fc8de">Cible d'import</label>
            <select id="mw-target" class="mw-input" [(ngModel)]="target" [disabled]="busy()">
              <option [ngValue]="targets.ChartOfAccounts" i18n="@@accounting.import.plan.comptable.b3f54c09">Plan comptable</option>
              <option [ngValue]="targets.ThirdParties" i18n="@@accounting.import.plan.tiers.7dfd7c9a">Plan tiers</option>
              <option [ngValue]="targets.OpeningBalance" i18n="@@accounting.import.balance.d.ouverture.02618c43">Balance d'ouverture</option>
            </select>
          </div>
          @if (target === targets.OpeningBalance) {
            <div class="form-field">
              <label class="field-label" for="mw-year" i18n="@@accounting.import.exercice.e171e2b0">Exercice</label>
              <input id="mw-year" type="number" min="2000" max="2100" class="mw-input" [(ngModel)]="fiscalYear" [disabled]="busy()" />
            </div>
          }
          @for (w of a.warnings; track $index) {
            <p class="mw-warning"><i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ w }}</p>
          }
          <div class="mw-actions">
            <app-button variant="secondary" type="button" (click)="backTo(0)" [disabled]="busy()" i18n="@@accounting.import.retour.e5befb1f">Retour</app-button>
            <app-button variant="primary" icon="pi pi-arrow-right" type="button"
              (click)="suggestColumns()" [disabled]="busy() || (target === targets.OpeningBalance && !fiscalYear)"
              ariaLabel="Proposer la correspondance des colonnes" i18n="@@accounting.import.suggerer.les.correspondances.ee9018db"> Suggérer les correspondances </app-button>
          </div>
        </div>
      }

      <!-- Étape 3 : correspondances de colonnes (éditables) -->
      @if (step() === 2) {
        <div class="card mw-card">
          <h3 class="mw-title"><ng-container i18n="@@accounting.import.correspondance.des.colonnes.3c3fa143">Correspondance des colonnes </ng-container> <span class="mw-badge-ia" i18n="@@accounting.import.editable.5c533c88">éditable</span></h3>
          <p class="mw-help" i18n="@@accounting.import.verifiez.et.ajustez.avant.de.continuer.les.sugge.1f94b509">Vérifiez et ajustez avant de continuer — les suggestions ne sont jamais appliquées telles quelles.</p>
          <p-table [value]="columnItems()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
            <ng-template pTemplate="header"><tr>
              <th scope="col" i18n="@@accounting.import.colonne.source.3205531b">Colonne source</th><th scope="col" i18n="@@accounting.import.colonne.cible.3e86cdcc">Colonne cible</th><th scope="col" i18n="@@accounting.import.origine.62e96258">Origine</th><th scope="col" i18n="@@accounting.import.confiance.7b2239f6">Confiance</th>
            </tr></ng-template>
            <ng-template pTemplate="body" let-item>
              <tr>
                <td><code>{{ item.sourceColumn }}</code></td>
                <td>
                  <select class="mw-input" [(ngModel)]="item.canonicalColumn" [disabled]="busy()">
                    <option [ngValue]="null" i18n="@@accounting.import.non.mappee.c7389aff">— non mappée —</option>
                    @for (c of canonicalOptions(); track c) {
                      <option [ngValue]="c">{{ c }}{{ isRequired(c) ? ' *' : '' }}</option>
                    }
                  </select>
                </td>
                <td><span class="mw-origin" [class.mw-origin-ia]="item.origin === origins.Ia">{{ originLabel(item.origin) }}</span></td>
                <td>{{ item.confidence > 0 ? (item.confidence * 100 | number:'1.0-0') + ' %' : '—' }}</td>
              </tr>
            </ng-template>
          </p-table>
          @for (w of mappingWarnings(); track $index) {
            <p class="mw-warning"><i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ w }}</p>
          }
          <div class="mw-actions">
            <app-button variant="secondary" type="button" (click)="backTo(1)" [disabled]="busy()" i18n="@@accounting.import.retour.e5befb1f">Retour</app-button>
            <app-button variant="primary" icon="pi pi-arrow-right" type="button"
              (click)="columnsNext()" [disabled]="busy() || !columnMappingComplete()"
              ariaLabel="Valider la correspondance des colonnes" i18n="@@accounting.import.valider.les.correspondances.f5ee29eb"> Valider les correspondances </app-button>
          </div>
        </div>
      }

      <!-- Étape 4 : comptes (plan/balance) ou doublons (tiers) -->
      @if (step() === 3) {
        <div class="card mw-card">
          @if (target !== targets.ThirdParties) {
            <h3 class="mw-title"><ng-container i18n="@@accounting.import.correspondance.des.comptes.83a49034">Correspondance des comptes </ng-container> <span class="mw-badge-ia" i18n="@@accounting.import.editable.5c533c88">éditable</span></h3>
            <p class="mw-help">
              {{ accountResolvedCount() }} compte(s) résolu(s) sans IA (identique/préfixe).
              Les comptes sans cible seront importés tels quels.
            </p>
            <p-table [value]="accountItems()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true" [scrollable]="true" scrollHeight="360px">
              <ng-template pTemplate="header"><tr>
                <th scope="col" i18n="@@accounting.import.compte.source.ce24bd6c">Compte source</th><th scope="col" i18n="@@accounting.import.libelle.f5485bba">Libellé</th><th scope="col" i18n="@@accounting.import.compte.cible.d5e70e81">Compte cible</th><th scope="col" i18n="@@accounting.import.origine.62e96258">Origine</th><th scope="col" i18n="@@accounting.import.confiance.7b2239f6">Confiance</th>
              </tr></ng-template>
              <ng-template pTemplate="body" let-item>
                <tr>
                  <td><code>{{ item.sourceAccount }}</code></td>
                  <td>{{ item.sourceLabel ?? '—' }}</td>
                  <td>
                    <input type="text" class="mw-input mw-account-input" [(ngModel)]="item.targetAccount" [disabled]="busy()"
                      [attr.title]="item.justification" placeholder="(tel quel)" i18n-placeholder="(tel quel)" />
                  </td>
                  <td><span class="mw-origin" [class.mw-origin-ia]="item.origin === origins.Ia">{{ originLabel(item.origin) }}</span></td>
                  <td>{{ item.confidence > 0 ? (item.confidence * 100 | number:'1.0-0') + ' %' : '—' }}</td>
                </tr>
              </ng-template>
            </p-table>
          } @else {
            <h3 class="mw-title" i18n="@@accounting.import.doublons.de.tiers.detectes.29f0809d">Doublons de tiers détectés</h3>
            @if (duplicatePairs().length === 0) {
              <p class="mw-help"><i class="pi pi-check-circle" aria-hidden="true"></i> Aucun doublon détecté.</p>
            } @else {
              <p class="mw-help">
                {{ duplicatePairs().length }} paire(s) candidate(s). Les éléments déjà présents sont
                <strong i18n="@@accounting.import.ignores.jamais.ecrases.aabf521b">ignorés, jamais écrasés</strong> par l'import (comportement additif existant).
              </p>
              <p-table [value]="duplicatePairs()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true" [scrollable]="true" scrollHeight="320px">
                <ng-template pTemplate="header"><tr>
                  <th scope="col" i18n="@@accounting.import.ligne.importee.d698f4a5">Ligne importée</th><th scope="col" i18n="@@accounting.import.tiers.existant.6686275e">Tiers existant</th><th scope="col" i18n="@@accounting.import.motif.2a198f47">Motif</th><th scope="col" i18n="@@accounting.import.score.489f4877">Score</th>
                </tr></ng-template>
                <ng-template pTemplate="body" let-p>
                  <tr>
                    <td>{{ p.importedName }} <span class="mw-muted">({{ p.importedRef }})</span></td>
                    <td>{{ p.existingName }} <span class="mw-muted">[{{ p.existingOrigin }}]</span></td>
                    <td>{{ p.reason }}</td>
                    <td>{{ p.score * 100 | number:'1.0-0' }} %</td>
                  </tr>
                </ng-template>
              </p-table>
            }
          }
          @for (w of mappingWarnings(); track $index) {
            <p class="mw-warning"><i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ w }}</p>
          }
          <div class="mw-actions">
            <app-button variant="secondary" type="button" (click)="backTo(2)" [disabled]="busy()" i18n="@@accounting.import.retour.e5befb1f">Retour</app-button>
            <app-button variant="primary" icon="pi pi-search" type="button"
              (click)="runPreview()" [disabled]="busy()"
              ariaLabel="Lancer l'aperçu à blanc (dry-run)" i18n="@@accounting.import.apercu.a.blanc.e0c1846b"> Aperçu à blanc </app-button>
          </div>
        </div>
      }

      <!-- Étape 5 : aperçu (pipeline d'import existant, inchangé) -->
      @if (step() === 4 && preview(); as p) {
        <div class="card mw-card">
          <h3 class="mw-title" i18n="@@accounting.import.apercu.a.blanc.pipeline.d.import.standard.747678be">Aperçu à blanc — pipeline d'import standard</h3>
          <div class="mw-summary">
            <div class="mw-kpi"><span class="mw-kpi-label" i18n="@@accounting.import.lignes.41c7025e">Lignes</span><span class="mw-kpi-value">{{ p.totalRows }}</span></div>
            <div class="mw-kpi"><span class="mw-kpi-label" i18n="@@accounting.import.valides.4cb63bf2">Valides</span><span class="mw-kpi-value mw-ok">{{ p.validRows }}</span></div>
            <div class="mw-kpi"><span class="mw-kpi-label" i18n="@@accounting.import.en.erreur.10a2e3df">En erreur</span><span class="mw-kpi-value" [class.mw-err]="p.rowsWithErrors > 0">{{ p.rowsWithErrors }}</span></div>
            <div class="mw-kpi"><span class="mw-kpi-label" i18n="@@accounting.import.deja.presents.cad005a1">Déjà présents</span><span class="mw-kpi-value">{{ p.existingRows }}</span></div>
            @if (p.mappedAccountCount > 0) {
              <div class="mw-kpi"><span class="mw-kpi-label" i18n="@@accounting.import.comptes.traduits.7bfb19b7">Comptes traduits</span><span class="mw-kpi-value">{{ p.mappedAccountCount }}</span></div>
            }
          </div>
          @if (p.issues.length > 0) {
            <div class="mw-issues">
              <h4 class="mw-issues-title">{{ p.issues.length }} anomalie(s) — à corriger avant l'import</h4>
              <ul class="mw-issues-list">
                @for (issue of p.issues.slice(0, 100); track $index) {
                  <li><span class="mw-issue-ref">{{ issue.ref }}</span> {{ issue.message }}</li>
                }
              </ul>
            </div>
          }
          <p class="mw-help"><ng-container i18n="@@accounting.import.creation.b5061590">Création </ng-container> <strong i18n="@@accounting.import.additive.62d12306">additive</strong> : un élément déjà présent est ignoré, jamais écrasé.</p>
          <div class="mw-actions">
            <app-button variant="secondary" type="button" (click)="backTo(3)" [disabled]="busy()" i18n="@@accounting.import.retour.e5befb1f">Retour</app-button>
            <app-button variant="primary" icon="pi pi-check" type="button"
              (click)="commit()" [disabled]="busy() || !p.canCommit"
              ariaLabel="Confirmer l'import" i18n="@@accounting.import.confirmer.l.import.2b2258ef"> Confirmer l'import </app-button>
          </div>
        </div>
      }

      <!-- Étape 6 : résultat -->
      @if (step() === 5) {
        <div class="card mw-card">
          <div class="mw-success" role="status"><i class="pi pi-check-circle" aria-hidden="true"></i><span>{{ successMessage() }}</span></div>
          <p class="mw-help" i18n="@@accounting.import.l.import.est.trace.dans.le.journal.d.audit.du.do.7f2b376a">L'import est tracé dans le journal d'audit du dossier.</p>
          <div class="mw-actions">
            <app-button variant="secondary" type="button" (click)="reset()" i18n="@@accounting.import.nouvelle.migration.b5fb3220">Nouvelle migration</app-button>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .mw-card { padding: 1rem; margin-top: 1rem; }
    .mw-steps { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin-top: .75rem; font-size: .85rem; }
    .mw-step { color: var(--text-color-secondary, #6b7280); }
    .mw-step-active { font-weight: 700; color: var(--primary-color, #2563eb); }
    .mw-step-done { color: var(--green-600, #059669); }
    .mw-field-file { max-width: 520px; }
    .mw-input { width: 100%; padding: .4rem .5rem; border: 1px solid var(--surface-border, #d1d5db); border-radius: 6px; }
    .mw-account-input { min-width: 110px; font-family: monospace; }
    .mw-actions { display: flex; gap: .5rem; margin-top: 1rem; }
    .mw-help { color: var(--text-color-secondary, #6b7280); font-size: .85rem; margin-top: .75rem; }
    .mw-warning { color: var(--orange-600, #d97706); font-size: .85rem; margin: .35rem 0; }
    .mw-title { margin: 0 0 .5rem; font-size: 1rem; }
    .mw-badge-ia { font-size: .7rem; font-weight: 600; color: var(--primary-color, #2563eb); border: 1px solid currentColor; border-radius: 999px; padding: .1rem .5rem; vertical-align: middle; }
    .mw-summary { display: flex; flex-wrap: wrap; gap: 1.25rem; margin: .5rem 0 1rem; }
    .mw-kpi { display: flex; flex-direction: column; }
    .mw-kpi-label { font-size: .75rem; color: var(--text-color-secondary, #6b7280); }
    .mw-kpi-value { font-size: 1.15rem; font-weight: 700; }
    .mw-ok { color: var(--green-600, #059669); }
    .mw-err { color: var(--red-600, #dc2626); }
    .mw-origin { font-size: .75rem; padding: .1rem .45rem; border-radius: 999px; background: var(--surface-200, #e5e7eb); }
    .mw-origin-ia { background: var(--purple-100, #ede9fe); color: var(--purple-700, #6d28d9); }
    .mw-muted { color: var(--text-color-secondary, #9ca3af); font-size: .8rem; }
    .mw-issues { margin-top: .75rem; }
    .mw-issues-title { font-size: .9rem; color: var(--red-600, #dc2626); }
    .mw-issues-list { max-height: 220px; overflow: auto; margin: .5rem 0; padding-left: 1.25rem; font-size: .85rem; }
    .mw-issue-ref { font-family: monospace; font-weight: 600; margin-right: .4rem; }
    .mw-success { display: flex; align-items: center; gap: .5rem; color: var(--green-600, #059669); font-weight: 600; }
  `]
})
export class MigrationWizardComponent {
  readonly loc_ui_tern_excel_a08e11 = $localize`:@@ui.tern.excel.a08e11:Excel`;
  readonly loc_ui_tern_csv_328118 = $localize`:@@ui.tern.csv.328118:CSV`;
  private readonly service = inject(AccountingService);

  readonly targets = ReferenceImportTarget;
  readonly origins = MigrationSuggestionOrigin;
  readonly stepLabels = ['Dépôt', 'Analyse', 'Colonnes', 'Détail', 'Aperçu', 'Résultat'];

  readonly step = signal(0);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly featureUnavailable = signal(false);
  readonly successMessage = signal('');

  readonly analysis = signal<MigrationAnalysisDto | null>(null);
  readonly columnItems = signal<ColumnMappingSuggestionItemDto[]>([]);
  readonly accountItems = signal<AccountMappingSuggestionItemDto[]>([]);
  readonly duplicatePairs = signal<ThirdPartyDuplicatePairDto[]>([]);
  readonly mappingWarnings = signal<string[]>([]);
  readonly preview = signal<ReferenceImportPreviewDto | null>(null);

  file: File | null = null;
  target: ReferenceImportTarget = ReferenceImportTarget.ChartOfAccounts;
  fiscalYear: number | null = new Date().getFullYear();

  /** Fichier transformé (en-têtes canoniques) prêt pour preview/commit, si une transformation a eu lieu. */
  private transformedFile: File | null = null;
  /** Table de correspondance comptable générée (CSV source,cible) depuis la grille éditée. */
  private accountMappingFile: File | null = null;

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    this.error.set(null);
  }

  analyze(): void {
    if (!this.file) return;
    this.error.set(null);
    this.busy.set(true);
    this.service.analyzeMigrationSource(this.file).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.success && r.data) {
          this.analysis.set(r.data);
          this.target = r.data.suggestedTarget;
          this.step.set(1);
        } else {
          this.error.set(r.error ?? $localize`:@@ui.tern.analyse.impossible.26753e:Analyse impossible.`);
        }
      },
      error: (err) => {
        this.busy.set(false);
        if (err?.status === 404) {
          this.featureUnavailable.set(true); // flag désactivé → repli vers l'import standard
        } else {
          this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.l.analyse.du.fichier.32573d:Erreur lors de l'analyse du fichier.`);
        }
      }
    });
  }

  suggestColumns(): void {
    if (!this.file) return;
    this.error.set(null);
    this.busy.set(true);
    this.service.suggestMigrationColumnMapping(this.file, this.target).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.success && r.data) {
          // Copie éditable des suggestions — l'utilisateur tranche avant toute application.
          this.columnItems.set(r.data.items.map(i => ({ ...i })));
          this.mappingWarnings.set(r.data.warnings);
          this.step.set(2);
        } else {
          this.error.set(r.error ?? $localize`:@@ui.tern.suggestion.impossible.c4322e:Suggestion impossible.`);
        }
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.la.suggestion.de.colonnes.79c9b6:Erreur lors de la suggestion de colonnes.`);
      }
    });
  }

  columnsNext(): void {
    if (!this.file) return;
    this.error.set(null);
    this.busy.set(true);
    if (this.target === ReferenceImportTarget.ThirdParties) {
      this.service.detectMigrationDuplicates(this.file).subscribe({
        next: (r) => {
          this.busy.set(false);
          if (r.success && r.data) {
            this.duplicatePairs.set(r.data.pairs);
            this.mappingWarnings.set(r.data.warnings);
            this.step.set(3);
          } else {
            this.error.set(r.error ?? $localize`:@@ui.tern.detection.impossible.aa3ba4:Détection impossible.`);
          }
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.la.detection.de.doublons.596f48:Erreur lors de la détection de doublons.`);
        }
      });
    } else {
      this.service.suggestMigrationAccountMapping(this.file, this.columnMappingDict()).subscribe({
        next: (r) => {
          this.busy.set(false);
          if (r.success && r.data) {
            this.accountItems.set(r.data.items.map(i => ({ ...i })));
            this.mappingWarnings.set(r.data.warnings);
            this.step.set(3);
          } else {
            this.error.set(r.error ?? $localize`:@@ui.tern.suggestion.impossible.c4322e:Suggestion impossible.`);
          }
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.la.suggestion.de.comptes.ba2614:Erreur lors de la suggestion de comptes.`);
        }
      });
    }
  }

  runPreview(): void {
    if (!this.file) return;
    this.error.set(null);
    this.busy.set(true);

    const mapping = this.columnMappingDict();
    const needsTransform = Object.keys(mapping).length > 0
      && this.columnItems().some(i => i.canonicalColumn && i.origin !== undefined);

    // Table de correspondance comptable générée depuis la grille éditée (comptes uniquement).
    this.accountMappingFile = this.target !== ReferenceImportTarget.ThirdParties
      ? this.buildAccountMappingCsv()
      : null;

    const proceed = (file: File, format: JournalImportFormat) => {
      this.service.previewReferenceImport(
        file, this.target, format,
        this.target === ReferenceImportTarget.OpeningBalance ? this.fiscalYear ?? undefined : undefined,
        this.accountMappingFile
      ).subscribe({
        next: (r) => {
          this.busy.set(false);
          if (r.success && r.data) {
            this.preview.set(r.data);
            this.step.set(4);
          } else {
            this.error.set(r.error ?? $localize`:@@ui.tern.apercu.impossible.8df7df:Aperçu impossible.`);
          }
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.l.apercu.b90c81:Erreur lors de l'aperçu.`);
        }
      });
    };

    if (needsTransform) {
      this.service.transformMigrationFile(this.file, this.target, mapping).subscribe({
        next: (blob) => {
          this.transformedFile = new File([blob], 'migration-canonique.csv', { type: 'text/csv' });
          proceed(this.transformedFile, JournalImportFormat.Csv);
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(this.blobErrorMessage(err) ?? $localize`:@@ui.tern.erreur.lors.de.la.transformation.du.fichie.04ed3e:Erreur lors de la transformation du fichier.`);
        }
      });
    } else {
      this.transformedFile = null;
      proceed(this.file, this.analysis()?.format ?? JournalImportFormat.Csv);
    }
  }

  commit(): void {
    const file = this.transformedFile ?? this.file;
    if (!file) return;
    this.error.set(null);
    this.busy.set(true);
    this.service.commitReferenceImport(
      file, this.target,
      this.transformedFile ? JournalImportFormat.Csv : (this.analysis()?.format ?? JournalImportFormat.Csv),
      this.target === ReferenceImportTarget.OpeningBalance ? this.fiscalYear ?? undefined : undefined,
      this.accountMappingFile
    ).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.success && r.data) {
          this.successMessage.set(`${r.data.createdCount} élément(s) créé(s), ${r.data.skippedCount} ignoré(s).`);
          this.step.set(5);
        } else {
          this.error.set(r.error ?? $localize`:@@ui.tern.import.refuse.b4f285:Import refusé.`);
        }
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.l.import.264199:Erreur lors de l'import.`);
      }
    });
  }

  reset(): void {
    this.step.set(0);
    this.file = null;
    this.analysis.set(null);
    this.columnItems.set([]);
    this.accountItems.set([]);
    this.duplicatePairs.set([]);
    this.mappingWarnings.set([]);
    this.preview.set(null);
    this.successMessage.set('');
    this.error.set(null);
    this.transformedFile = null;
    this.accountMappingFile = null;
  }

  backTo(step: number): void {
    this.error.set(null);
    this.step.set(step);
  }

  // ── Helpers (purs, testables) ─────────────────────────────────────────────

  /** Mapping validé : en-tête source → colonne canonique (entrées non mappées exclues). */
  columnMappingDict(): Record<string, string> {
    const dict: Record<string, string> = {};
    for (const item of this.columnItems()) {
      if (item.canonicalColumn) dict[item.sourceColumn] = item.canonicalColumn;
    }
    return dict;
  }

  /** Table de correspondance CSV (source,cible) depuis la grille comptable éditée — null si vide. */
  buildAccountMappingCsv(): File | null {
    const lines = this.accountItems()
      .filter(i => i.targetAccount && i.targetAccount.trim() && i.targetAccount.trim() !== i.sourceAccount)
      .map(i => `${i.sourceAccount};${i.targetAccount!.trim()}`);
    if (lines.length === 0) return null;
    // La table existante attend les en-têtes « source;cible » (AccountMappingTable côté backend).
    const csv = 'source;cible\n' + lines.join('\n') + '\n';
    return new File([csv], 'correspondance-comptes.csv', { type: 'text/csv' });
  }

  columnMappingComplete(): boolean {
    const a = this.analysis();
    if (!a) return false;
    const mapped = new Set(this.columnItems().map(i => i.canonicalColumn).filter(Boolean));
    return this.requiredCanonical().every(r => mapped.has(r));
  }

  requiredCanonical(): string[] {
    switch (this.target) {
      case ReferenceImportTarget.ChartOfAccounts: return ['compte', 'libelle', 'classe'];
      case ReferenceImportTarget.ThirdParties: return ['type', 'nom', 'email', 'rue', 'ville', 'gouvernorat'];
      default: return ['compte'];
    }
  }

  canonicalOptions(): string[] {
    switch (this.target) {
      case ReferenceImportTarget.ChartOfAccounts: return ['compte', 'libelle', 'classe', 'nature'];
      case ReferenceImportTarget.ThirdParties: return ['type', 'nom', 'email', 'rue', 'ville', 'gouvernorat', 'nif', 'telephone'];
      default: return ['compte', 'debit', 'credit'];
    }
  }

  isRequired(canonical: string): boolean {
    return this.requiredCanonical().includes(canonical);
  }

  accountResolvedCount(): number {
    return this.accountItems().filter(i =>
      i.origin === MigrationSuggestionOrigin.Identite || i.origin === MigrationSuggestionOrigin.Prefixe).length;
  }

  originLabel(origin: MigrationSuggestionOrigin): string {
    switch (origin) {
      case MigrationSuggestionOrigin.Synonyme: return 'Standard';
      case MigrationSuggestionOrigin.Catalogue: return 'Catalogue';
      case MigrationSuggestionOrigin.Ia: return 'IA';
      case MigrationSuggestionOrigin.Identite: return 'Identique';
      case MigrationSuggestionOrigin.Prefixe: return 'Préfixe';
      default: return '—';
    }
  }

  sourceLabel(source: MigrationSourceSystem): string {
    switch (source) {
      case MigrationSourceSystem.SageLigne100: return 'Sage Ligne 100';
      case MigrationSourceSystem.Ebp: return 'EBP';
      case MigrationSourceSystem.Cegid: return 'Cegid';
      case MigrationSourceSystem.Quadra: return 'Quadra';
      case MigrationSourceSystem.TableurGenerique: return 'Tableur générique';
      default: return 'Non reconnu';
    }
  }

  /** Extrait le message d'erreur d'une réponse blob (JSON sérialisé) — best effort. */
  private blobErrorMessage(err: unknown): string | null {
    void err;
    return null; // le message générique est affiché ; les erreurs blob ne sont pas relisibles en flux
  }
}
