/// <reference types="@angular/localize" />
import { Component, DestroyRef, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BankAccountDto } from '@core/services/bank-account.service';
import { BankStatementEntriesStore } from './bank-statement-entries.store';
import { BseStepperComponent } from './bse-stepper.component';
import { BseTabularSettingsComponent } from './bse-tabular-settings.component';
import { BseTabularColumnRolesComponent } from './bse-tabular-column-roles.component';
import { BseTabularRowsPreviewComponent } from './bse-tabular-rows-preview.component';
import { BseTabularParsedLinesComponent } from './bse-tabular-parsed-lines.component';
import { BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';
import { BankStatementTabularMapping } from '../bank-statement-import/bank-statement-import.models';
import { importErrorMessage, importErrorOf, sessionFailureMessage } from '../bank-statement-import/bank-statement-import.messages';
import { columnLabel, mappingHasUsableBalance, withLabelColumnSlot } from '../bank-statement-import/bank-statement-tabular-mapping.logic';

const DOCUMENT_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
const TABULAR_EXTENSIONS = ['.csv', '.xlsx'];

type PageView = 'source' | 'mapping';

/**
 * Étape 1 (Source) + étape 2 (Mappage CSV/XLSX, sans route dédiée) + historique des relevés
 * déjà importés par ce parcours dédié (sans rapprochement, D1).
 */
@Component({
  selector: 'app-bank-statement-entries-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageHeaderComponent, ButtonComponent, BseStepperComponent, BseTabularSettingsComponent, BseTabularColumnRolesComponent, BseTabularRowsPreviewComponent, BseTabularParsedLinesComponent],
  providers: [BankStatementEntriesStore],
  template: `
    <app-page-header title="Relevé bancaire → écritures" i18n-title="@@accounting.bank-statement-entries.releve.bancaire.ecritures.426df845" />

    <app-bse-stepper [activeIndex]="view() === 'mapping' ? 1 : 0" />

    <div class="bse-banner" role="note" data-testid="bse-no-reconciliation-banner">
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      <span i18n="@@accounting.bank-statement-entries.aucun.rapprochement.bancaire.n.est.effectue.8eff982f">Aucun rapprochement bancaire n'est effectué.</span>
      <a routerLink="/accounting/bank-reconciliation" i18n="@@accounting.bank-statement-entries.traitements.rapprochement.bancaire.35e5cc4d">Traitements › Rapprochement bancaire</a>
    </div>

    @if (view() === 'source') {
      <section class="bse-card" data-testid="bse-source-form">
        <h2 i18n="@@accounting.bank-statement-entries.source.du.releve.ee90a11b">Source du relevé</h2>
        <p class="bse-hint" i18n="@@accounting.bank-statement-entries.choisissez.le.compte.bancaire.le.journal.de.banq.2f64a314">
          Choisissez le compte bancaire, le journal de banque et le fichier à importer.
        </p>

        @if (store.bankAccountsError()) {
          <p class="bse-alert bse-alert--error" role="alert" i18n="@@accounting.bank-statement-entries.impossible.de.charger.les.comptes.bancaires.rees.0d837939">
            Impossible de charger les comptes bancaires. Réessayez plus tard.
          </p>
        } @else if (store.bankAccountsLoaded() && !store.hasEligibleAccount()) {
          <div class="bse-alert bse-alert--warning" role="alert" data-testid="bse-no-eligible-account">
            <strong i18n="@@accounting.bank-statement-entries.aucun.compte.bancaire.eligible.pour.cette.compta.54b34de8">Aucun compte bancaire éligible pour cette comptabilisation.</strong>
            <span i18n="@@accounting.bank-statement-entries.associez.un.compte.comptable.532.a.un.compte.ban.33f2e1e2">Associez un compte comptable 532 à un compte bancaire en dinars (TND) pour continuer.</span>
          </div>
        }

        <label class="bse-label" for="bse-account" i18n="@@accounting.bank-statement-entries.compte.bancaire.485b42ca">Compte bancaire</label>
        <select id="bse-account" class="bse-input" data-testid="bse-account-select" [ngModel]="store.bankAccountId()" (ngModelChange)="store.bankAccountId.set($event)" [disabled]="store.submitting()">
          @for (account of store.bankAccounts(); track account.id) {
            <option [ngValue]="account.id" [disabled]="!account.chartOfAccountNumber || !store.isDinarAccount(account)">{{ accountLabel(account) }}</option>
          }
        </select>

        <label class="bse-label" for="bse-journal" i18n="@@accounting.bank-statement-entries.journal.de.banque.bfcb9d5a">Journal de banque</label>
        <select id="bse-journal" class="bse-input" data-testid="bse-journal-select" [ngModel]="store.journalCode()" (ngModelChange)="store.journalCode.set($event)" [disabled]="store.submitting()">
          @for (journal of store.journals(); track journal.code) {
            <option [ngValue]="journal.code">{{ journal.code }} — {{ journal.label }}</option>
          }
        </select>
        <p class="bse-hint" i18n="@@accounting.bank-statement-entries.les.ecritures.seront.numerotees.dans.ce.journal.9027c3f3">Les écritures seront numérotées dans ce journal.</p>

        <fieldset class="bse-filetype">
          <legend i18n="@@accounting.bank-statement-entries.type.de.fichier.58a0c10e">Type de fichier</legend>
          <label>
            <input type="radio" name="bse-filetype" value="document" [(ngModel)]="fileKindChoice" (ngModelChange)="onFileKindChoiceChange()" [disabled]="aiBlocked()" />
            <span i18n="@@accounting.bank-statement-entries.pdf.ou.image.analyse.par.l.ia.54432f1b">PDF ou image — analysé par l'IA</span>
          </label>
          @if (aiBlocked()) {
            <p class="bse-hint bse-hint--blocked" role="alert" data-testid="bse-ai-blocked">{{ aiUnavailableHint() }}</p>
          }
          <label>
            <input type="radio" name="bse-filetype" value="tabular" [(ngModel)]="fileKindChoice" (ngModelChange)="onFileKindChoiceChange()" [disabled]="tabularBlocked()" />
            <span i18n="@@accounting.bank-statement-entries.csv.ou.excel.xlsx.1f85a221">CSV ou Excel (.xlsx)</span>
          </label>
          @if (tabularBlocked()) {
            <p class="bse-hint bse-hint--blocked" role="alert" data-testid="bse-tabular-blocked">{{ tabularDisabledHint() }}</p>
          }
        </fieldset>

        <label class="bse-label" for="bse-file-input" i18n="@@accounting.bank-statement-entries.fichier.du.releve.515edb30">Fichier du relevé</label>
        <input #fileInput id="bse-file-input" type="file" class="bse-file-input"
               [attr.accept]="acceptAttr()" (change)="onFileSelected($event)" />
        <div class="bse-dropzone" data-testid="bse-dropzone" (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
          @if (store.file(); as f) {
            <span data-testid="bse-selected-file">{{ f.name }}</span>
            <app-button variant="secondary" size="sm" (clicked)="fileInput.click()" i18n="@@accounting.bank-statement-entries.remplacer.db2c67bc">Remplacer</app-button>
          } @else {
            <span i18n="@@accounting.bank-statement-entries.glissez.deposez.votre.releve.ici.c2dee522">Glissez-déposez votre relevé ici</span>
            <span i18n="@@accounting.bank-statement-entries.ou.d5f10c9b">ou</span>
            <app-button variant="secondary" size="sm" (clicked)="fileInput.click()" i18n="@@accounting.bank-statement-entries.choisir.un.fichier.75c27e25">Choisir un fichier</app-button>
          }
        </div>
        @if (fileKindChoice === 'tabular') {
          <p class="bse-hint" i18n="@@accounting.bank-statement-entries.csv.ou.xlsx.taille.maximale.mo.1f3b2c9a">CSV ou XLSX — taille maximale : {{ maxMegabytes() }} Mo.</p>
        } @else {
          <p class="bse-hint" i18n="@@accounting.bank-statement-entries.pdf.ou.image.taille.maximale.mo.2a7f1b9e">PDF ou image — taille maximale : {{ maxMegabytes() }} Mo.</p>
        }

        @if (store.sourceError(); as err) {
          <p class="bse-alert bse-alert--error" role="alert" data-testid="bse-source-error">{{ err }}</p>
        }
        @if (!store.canSubmitSource() && !store.sourceError()) {
          <p class="bse-hint" i18n="@@accounting.bank-statement-entries.choisissez.un.compte.relie.a.un.compte.532.et.un.d91621bf">Choisissez un compte relié à un compte 532 et un fichier pour continuer.</p>
        }

        <div class="bse-actions">
          <app-button variant="secondary" routerLink="/accounting/manual-entry" i18n="@@accounting.bank-statement-entries.annuler.49ba3292">Annuler</app-button>
          @if (fileKindChoice === 'tabular') {
            <app-button variant="primary" data-testid="bse-continue-mapping" [disabled]="!store.canSubmitSource()" (clicked)="goToMapping()" i18n="@@accounting.bank-statement-entries.continuer.mappage.des.colonnes.18308f14">Continuer — mappage des colonnes</app-button>
          } @else {
            <app-button variant="primary" data-testid="bse-continue-ai" [disabled]="!store.canSubmitSource()" (clicked)="startDocumentImport()" i18n="@@accounting.bank-statement-entries.continuer.analyse.par.l.ia.80851966">Continuer — analyse par l'IA</app-button>
          }
        </div>
      </section>

      <section class="bse-card" data-testid="bse-history">
        <h2 i18n="@@accounting.bank-statement-entries.releves.importes.958c16b7">Relevés importés</h2>
        @if (store.historyItems().length === 0 && !store.historyLoading()) {
          <p class="bse-hint" i18n="@@accounting.bank-statement-entries.aucun.releve.importe.pour.ce.dossier.b32cafd1">Aucun relevé importé pour ce dossier</p>
        } @else {
          <table class="bse-table" data-testid="bse-history-table">
            <thead>
              <tr>
                <th i18n="@@accounting.bank-statement-entries.date.d.import.ab43ed73">Date d'import</th>
                <th i18n="@@accounting.bank-statement-entries.banque.compte.a7408c6d">Banque / compte</th>
                <th i18n="@@accounting.bank-statement-entries.periode.du.releve.2e902b44">Période du relevé</th>
                <th i18n="@@accounting.bank-statement-entries.lignes.41c7025e">Lignes</th>
                <th i18n="@@accounting.bank-statement-entries.ecritures.generees.9847a764">Écritures générées</th>
                <th i18n="@@accounting.bank-statement-entries.action.97c89a4d">Action</th>
              </tr>
            </thead>
            <tbody>
              @for (item of store.historyItems(); track item.id) {
                <tr>
                  <td>{{ item.importedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                  <td>{{ item.bankName }} {{ item.maskedRib }}</td>
                  <td>{{ item.periodStart | date: 'dd/MM/yyyy' }} → {{ item.periodEnd | date: 'dd/MM/yyyy' }}</td>
                  <td>{{ item.lineCount }}</td>
                  <td>{{ item.postedCount }} / {{ item.lineCount }}</td>
                  <td>
                    <a [routerLink]="['/accounting/bank-statement-entries/statement', item.id]" i18n="@@accounting.bank-statement-entries.voir.les.ecritures.3e3b3dca">Voir les écritures</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    } @else {
      <section class="bse-card" data-testid="bse-mapping-form">
        <h2 i18n="@@accounting.bank-statement-entries.mappage.des.colonnes.29edf60d">Mappage des colonnes</h2>
        @if (store.tabularPreviewLoading()) {
          <p role="status" i18n="@@accounting.bank-statement-entries.lecture.du.mappage.en.cours.9bde0b53">Lecture du mappage en cours…</p>
        }
        @if (store.tabularPreviewError(); as err) {
          <p class="bse-alert bse-alert--error" role="alert" data-testid="bse-mapping-error">{{ err }}</p>
        }

        @if (mappingSource() === 'saved') {
          <p class="bse-alert bse-alert--info" role="note" data-testid="bse-mapping-source-saved" i18n="@@accounting.bank-statement-entries.mappage.memorise.depuis.le.dernier.import.de.ce.c.8f3b2a1d">Mappage mémorisé depuis le dernier import de ce compte — corrigez-le si le relevé a changé.</p>
        } @else if (mappingSource() === 'suggested') {
          <p class="bse-alert bse-alert--info" role="note" data-testid="bse-mapping-source-suggested" i18n="@@accounting.bank-statement-entries.mappage.suggere.automatiquement.verifiez.l.apercu.9d4c6e2f">Mappage suggéré automatiquement — vérifiez l'aperçu ci-dessous.</p>
        }

        @if (store.tabularPreview(); as preview) {
          @if (preview.ambiguousDateFormat) {
            <p class="bse-alert bse-alert--warning" role="alert" i18n="@@accounting.bank-statement-entries.format.de.date.ambigu.verifiez.les.exemples.ci.d.a1f5c1c9">Format de date ambigu : vérifiez les exemples ci-dessous.</p>
          }

          <h3 i18n="@@accounting.bank-statement-entries.lecture.du.fichier.6a0f3b9e">Lecture du fichier</h3>
          <app-bse-tabular-settings [mapping]="store.mapping()!" [format]="preview.format" [sheetNames]="preview.sheetNames"
                                     [disabled]="store.submitting()" (mappingChange)="patchMapping($event)" />

          <h3 i18n="@@accounting.bank-statement-entries.apercu.des.lignes.brutes.1b7d4e2a">Aperçu des lignes brutes</h3>
          <app-bse-tabular-rows-preview [rows]="preview.rows" [columns]="preview.columns" [headerRowIndex]="store.mapping()?.headerRowIndex ?? 0" />

          <h3 i18n="@@accounting.bank-statement-entries.association.des.colonnes.2c9e4a7f">Association des colonnes</h3>
          <label class="bse-label" for="bse-date-column" i18n="@@accounting.bank-statement-entries.date.d.operation.e0766a55">Date d'opération</label>
          <select id="bse-date-column" class="bse-input" data-testid="bse-map-date" [ngModel]="store.mapping()?.dateColumn" (ngModelChange)="patchMapping({ dateColumn: $event })">
            @for (col of preview.columns; track col.index) {
              <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
            }
          </select>

          <label class="bse-label" for="bse-label-column" i18n="@@accounting.bank-statement-entries.libelle.f5485bba">Libellé</label>
          <select id="bse-label-column" class="bse-input" data-testid="bse-map-label" [ngModel]="store.mapping()?.labelColumns?.[0]" (ngModelChange)="patchLabelColumn($event)">
            @for (col of preview.columns; track col.index) {
              <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
            }
          </select>

          <label class="bse-label" i18n="@@accounting.bank-statement-entries.sens.des.montants.7028199a">Sens des montants</label>
          <label>
            <input type="radio" name="bse-amount-mode" value="debitCredit" [ngModel]="store.mapping()?.amountMode" (ngModelChange)="patchMapping({ amountMode: $event })" />
            <span i18n="@@accounting.bank-statement-entries.deux.colonnes.debit.et.credit.41a73dfa">Deux colonnes : Débit et Crédit</span>
          </label>
          <label>
            <input type="radio" name="bse-amount-mode" value="signed" [ngModel]="store.mapping()?.amountMode" (ngModelChange)="patchMapping({ amountMode: $event })" />
            <span i18n="@@accounting.bank-statement-entries.une.colonne.montant.signe.3e9c333e">Une colonne : Montant signé</span>
          </label>

          @if (store.mapping()?.amountMode === 'signed') {
            <label class="bse-label" for="bse-amount-column" i18n="@@accounting.bank-statement-entries.montant.4adcd9fc">Montant</label>
            <select id="bse-amount-column" class="bse-input" data-testid="bse-map-amount" [ngModel]="store.mapping()?.amountColumn" (ngModelChange)="patchMapping({ amountColumn: $event })">
              @for (col of preview.columns; track col.index) {
                <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
              }
            </select>
          } @else {
            <label class="bse-label" for="bse-debit-column" i18n="@@accounting.bank-statement-entries.debit.f528224f">Débit</label>
            <select id="bse-debit-column" class="bse-input" data-testid="bse-map-debit" [ngModel]="store.mapping()?.debitColumn" (ngModelChange)="patchMapping({ debitColumn: $event })">
              @for (col of preview.columns; track col.index) {
                <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
              }
            </select>
            <label class="bse-label" for="bse-credit-column" i18n="@@accounting.bank-statement-entries.credit.19194bdf">Crédit</label>
            <select id="bse-credit-column" class="bse-input" data-testid="bse-map-credit" [ngModel]="store.mapping()?.creditColumn" (ngModelChange)="patchMapping({ creditColumn: $event })">
              @for (col of preview.columns; track col.index) {
                <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
              }
            </select>
          }

          <app-bse-tabular-column-roles [mapping]="store.mapping()!" [columns]="preview.columns" [disabled]="store.submitting()" (mappingChange)="patchMapping($event)" />

          @if (!hasUsableBalance()) {
            <h3 i18n="@@accounting.bank-statement-entries.soldes.d.ouverture.et.de.cloture.0e8d4c2a">Soldes d'ouverture et de clôture</h3>
            <p class="bse-hint" i18n="@@accounting.bank-statement-entries.obligatoires.en.l.absence.de.colonne.solde.9c1a3e7b">Obligatoires en l'absence de colonne solde.</p>
            <label class="bse-label" for="bse-opening-balance" i18n="@@accounting.bank-statement-entries.solde.d.ouverture.3f9b2c1e">Solde d'ouverture</label>
            <input id="bse-opening-balance" type="number" step="0.001" class="bse-input" data-testid="bse-map-opening-balance"
                   [ngModel]="store.mapping()?.openingBalance ?? null" (ngModelChange)="patchMapping({ openingBalance: $event })" />
            <label class="bse-label" for="bse-closing-balance" i18n="@@accounting.bank-statement-entries.solde.de.cloture.7a1d9c3f">Solde de clôture</label>
            <input id="bse-closing-balance" type="number" step="0.001" class="bse-input" data-testid="bse-map-closing-balance"
                   [ngModel]="store.mapping()?.closingBalance ?? null" (ngModelChange)="patchMapping({ closingBalance: $event })" />
          }

          <h3 i18n="@@accounting.bank-statement-entries.apercu.des.lignes.interpretees.4b7e2d9a">Aperçu des lignes interprétées</h3>
          <app-bse-tabular-parsed-lines [parsedLines]="preview.parsedLines" [issues]="preview.issues" />

          <label>
            <input type="checkbox" data-testid="bse-remember-mapping" [ngModel]="store.rememberMapping()" (ngModelChange)="store.rememberMapping.set($event)" />
            <span i18n="@@accounting.bank-statement-entries.memoriser.ce.mappage.pour.ce.compte.51734c56">Mémoriser ce mappage pour ce compte</span>
          </label>

          @if (!store.mappingRequiredRolesFilled()) {
            <p class="bse-hint" data-testid="bse-mapping-required-hint" i18n="@@accounting.bank-statement-entries.veuillez.associer.les.colonnes.obligatoires.date.2.4e8b1c9f">Veuillez associer les colonnes obligatoires (date, libellé, montant) et renseigner un solde exploitable (colonne solde ou soldes d'ouverture/clôture).</p>
          }
        }

        <div class="bse-actions">
          <app-button variant="secondary" data-testid="bse-back-to-source" (clicked)="backToSource()" i18n="@@accounting.bank-statement-entries.retour.e5befb1f">Retour</app-button>
          <app-button variant="primary" data-testid="bse-submit-tabular" [disabled]="!store.mappingRequiredRolesFilled() || store.submitting()" (clicked)="startTabularImport()" i18n="@@accounting.bank-statement-entries.lire.les.lignes.e98f52c0">Lire les lignes</app-button>
        </div>
      </section>
    }
  `,
  styles: [
    `
      .bse-banner { display: flex; gap: 0.5rem; align-items: center; background: #fff3cd; border: 1px solid #ffe08a; border-radius: 8px; padding: 0.6rem 1rem; margin-bottom: 1rem; }
      .bse-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem; margin-bottom: 1.25rem; }
      .bse-label { display: block; margin-top: 0.75rem; font-weight: 600; }
      .bse-input { width: 100%; max-width: 420px; padding: 0.4rem 0.6rem; margin-top: 0.25rem; }
      .bse-hint { color: #6c757d; font-size: 0.85rem; margin: 0.35rem 0; }
      .bse-hint--blocked { color: var(--color-danger, #842029); font-weight: 600; }
      .bse-alert { padding: 0.6rem 0.9rem; border-radius: 6px; margin: 0.5rem 0; }
      .bse-alert--error { background: #f8d7da; color: #842029; }
      .bse-alert--warning { background: #fff3cd; color: #664d03; }
      .bse-alert--info { background: #eff6ff; color: #1d4ed8; }
      .bse-filetype { display: flex; gap: 1.5rem; margin-top: 0.75rem; }
      .bse-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; }
      .bse-dropzone { border: 2px dashed #ced4da; border-radius: 8px; padding: 1.5rem; margin-top: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
      .bse-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
      .bse-table { width: 100%; border-collapse: collapse; }
      .bse-table th, .bse-table td { padding: 0.5rem 0.6rem; border-bottom: 1px solid #e9ecef; text-align: start; }
      .bse-issue-list { color: #842029; }
    `
  ]
})
export class BankStatementEntriesPageComponent implements OnInit {
  protected readonly store = inject(BankStatementEntriesStore);
  private readonly api = inject(BankStatementImportService);
  private readonly router = inject(Router);

  @ViewChild('fileInput') private readonly fileInputRef?: ElementRef<HTMLInputElement>;
  private readonly destroyRef = inject(DestroyRef);

  readonly view = signal<PageView>('source');
  fileKindChoice: 'document' | 'tabular' = 'document';
  /** Origine du mappage pré-rempli à l'étape 2, pour la bannière d'information. */
  readonly mappingSource = signal<'saved' | 'suggested' | null>(null);
  /** Vrai dès qu'un import a été envoyé avec succès : plus de confirmation de perte au départ. */
  private readonly submitted = signal(false);

  private readonly mappingChange$ = new Subject<void>();

  /** Taille maximale affichée (Mo), déduite des capacités serveur — 10 Mo si pas encore chargées. */
  readonly maxMegabytes = computed(() => Math.round((this.store.capabilities()?.maxFileBytes ?? 10 * 1024 * 1024) / (1024 * 1024)));

  /** PDF/image bloqué : capacités chargées ET IA indisponible côté serveur. */
  readonly aiBlocked = computed(() => {
    const caps = this.store.capabilities();
    return !!caps && !caps.aiAvailable;
  });

  /** CSV/Excel bloqué : capacités chargées ET import tabulaire explicitement désactivé. */
  readonly tabularBlocked = computed(() => {
    const caps = this.store.capabilities();
    return !!caps && caps.tabularEnabled === false;
  });

  aiUnavailableHint(): string {
    return sessionFailureMessage('ai_unavailable');
  }

  tabularDisabledHint(): string {
    return importErrorMessage('bank_statement_import.tabular_disabled');
  }

  ngOnInit(): void {
    this.store.loadSourceReferences();
    this.loadHistory();
    this.api.capabilities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(caps => {
      this.store.capabilities.set(caps);
      if (!caps) return;
      if (caps.tabularEnabled === false && this.fileKindChoice === 'tabular') this.fileKindChoice = 'document';
      if (!caps.aiAvailable && this.fileKindChoice === 'document' && caps.tabularEnabled !== false) this.fileKindChoice = 'tabular';
    });

    this.mappingChange$
      .pipe(
        debounceTime(400),
        switchMap(() => {
          const file = this.store.file();
          const mapping = this.store.mapping();
          if (!file || !mapping) return of(null);
          this.store.tabularPreviewLoading.set(true);
          return this.api.tabularPreview(file, mapping, this.store.bankAccountId() ?? undefined).pipe(
            catchError((err: unknown) => {
              this.store.tabularPreviewError.set(importErrorOf(err));
              return of(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(preview => {
        this.store.tabularPreviewLoading.set(false);
        if (preview) {
          this.store.tabularPreview.set(preview);
          this.store.tabularPreviewError.set(null);
        }
      });
  }

  private loadHistory(): void {
    this.store.historyLoading.set(true);
    this.api.history(this.store.historyPage(), this.store.historyPageSize())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: page => {
          this.store.historyItems.set(page.items);
          this.store.historyTotal.set(page.totalCount);
          this.store.historyLoading.set(false);
        },
        error: () => this.store.historyLoading.set(false)
      });
  }

  accountLabel(account: BankAccountDto): string {
    const name = account.designation || account.bankName;
    return account.chartOfAccountNumber ? `${account.chartOfAccountNumber} — ${name}` : name;
  }

  readonly columnLabel = columnLabel;

  hasUsableBalance(): boolean {
    const mapping = this.store.mapping();
    return !!mapping && mappingHasUsableBalance(mapping);
  }

  acceptAttr(): string {
    const caps = this.store.capabilities();
    if (this.fileKindChoice === 'tabular') {
      const extensions = caps?.tabularExtensions;
      return extensions && extensions.length > 0 ? extensions.join(',') : TABULAR_EXTENSIONS.join(',');
    }
    const extensions = caps?.acceptedExtensions;
    return extensions && extensions.length > 0 ? extensions.join(',') : DOCUMENT_EXTENSIONS.join(',');
  }

  onFileKindChoiceChange(): void {
    this.store.setFile(null, null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) this.applyFile(file);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) this.applyFile(file);
  }

  private applyFile(file: File): void {
    if (file.size === 0) {
      this.store.sourceError.set(importErrorMessage('bank_statement_import.file_rejected'));
      return;
    }
    const maxBytes = this.store.capabilities()?.maxFileBytes ?? 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      this.store.sourceError.set(importErrorMessage('bank_statement_import.file_too_large'));
      return;
    }
    const name = file.name.toLowerCase();
    const kind = this.fileKindChoice === 'tabular' ? 'tabular' : 'document';
    const expected = kind === 'tabular' ? TABULAR_EXTENSIONS : DOCUMENT_EXTENSIONS;
    if (!expected.some(ext => name.endsWith(ext))) {
      this.store.sourceError.set(importErrorMessage('bank_statement_import.file_rejected'));
      return;
    }
    this.store.setFile(file, kind);
  }

  goToMapping(): void {
    const file = this.store.file();
    if (!file) return;
    this.view.set('mapping');
    this.store.tabularPreviewLoading.set(true);
    this.store.tabularPreviewError.set(null);
    this.api.tabularPreview(file, undefined, this.store.bankAccountId() ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: preview => {
          this.store.tabularPreviewLoading.set(false);
          this.store.tabularPreview.set(preview);
          this.store.mapping.set(preview.savedMapping ?? preview.suggestedMapping ?? null);
          this.store.rememberMapping.set(!!preview.savedMapping);
          this.mappingSource.set(preview.savedMapping ? 'saved' : preview.suggestedMapping ? 'suggested' : null);
        },
        error: (err: unknown) => {
          this.store.tabularPreviewLoading.set(false);
          this.store.tabularPreviewError.set(importErrorOf(err));
        }
      });
  }

  backToSource(): void {
    this.view.set('source');
  }

  patchMapping(patch: Partial<BankStatementTabularMapping>): void {
    this.store.updateMapping(patch);
    this.mappingChange$.next();
  }

  /** La colonne « Libellé » principale occupe le slot 0 ; les slots 1/2 (optionnels) sont préservés. */
  patchLabelColumn(column: number): void {
    const mapping = this.store.mapping();
    if (!mapping) return;
    this.patchMapping({ labelColumns: withLabelColumnSlot(mapping, 0, column) });
  }

  startDocumentImport(): void {
    const file = this.store.file();
    const bankAccountId = this.store.bankAccountId();
    if (!file || !bankAccountId) return;
    this.store.submitting.set(true);
    this.store.sourceError.set(null);
    this.api.start(file, bankAccountId, this.store.journalCode()).subscribe({
      next: session => {
        this.store.submitting.set(false);
        this.submitted.set(true);
        void this.router.navigate(['/accounting/bank-statement-entries/session', session.id]);
      },
      error: (err: unknown) => {
        this.store.submitting.set(false);
        this.store.sourceError.set(importErrorOf(err));
      }
    });
  }

  startTabularImport(): void {
    const file = this.store.file();
    const bankAccountId = this.store.bankAccountId();
    const mapping = this.store.mapping();
    if (!file || !bankAccountId || !mapping) return;
    this.store.submitting.set(true);
    this.store.tabularPreviewError.set(null);
    const finalMapping: BankStatementTabularMapping = { ...mapping, rememberMapping: this.store.rememberMapping() };
    this.api.startTabular(file, bankAccountId, this.store.journalCode(), finalMapping).subscribe({
      next: session => {
        this.store.submitting.set(false);
        this.submitted.set(true);
        void this.router.navigate(['/accounting/bank-statement-entries/session', session.id]);
      },
      error: (err: unknown) => {
        this.store.submitting.set(false);
        this.store.tabularPreviewError.set(importErrorOf(err));
      }
    });
  }

  /** Fichier choisi non envoyé = perte potentielle si l'utilisateur quitte sans lancer l'import. */
  isDirty(): boolean {
    return !!this.store.file() && !this.store.submitting() && !this.submitted();
  }

  canDeactivate(): boolean {
    if (!this.isDirty()) return true;
    return window.confirm(
      $localize`:@@accounting.bank-statement-entries.ts.vous.avez.un.fichier.selectionne.non.envoye.quit.65a902f6:Vous avez un fichier sélectionné non envoyé. Quitter cette page ? Le fichier sera perdu.`
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  unloadNotification(event: BeforeUnloadEvent): void {
    if (this.isDirty()) {
      event.returnValue = $localize`:@@accounting.bank-statement-entries.ts.vous.avez.un.fichier.selectionne.non.envoye.38f669a0:Vous avez un fichier sélectionné non envoyé.`;
    }
  }
}
