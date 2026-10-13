import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { catchError, combineLatest, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { EmployeeService } from '@core/services/employee.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { EntryReferenceStore } from '../manual-entry/services/entry-reference.store';
import { ThirdPartyRef } from '../manual-entry/models/entry-form.model';
import { BankStatementImportError, BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';
import { downloadBlob } from '../shared/accounting-download.util';
import {
  EntryNumberRange,
  GenerateItem,
  GenerateResult,
  SOURCE_EXTENSIONS,
  expectedThirdPartyKind
} from '../bank-statement-import/bank-statement-import.models';
import * as logic from '../bank-statement-import/bank-statement-posting.logic';
import {
  confidenceLabel,
  generationFailureMessage,
  importErrorOf,
  issueTitle,
  lineStatusLabel,
  proposalDiagnosticMessage,
  proposalSourceLabel,
  uncertainResultAfterReloadMessage
} from '../bank-statement-import/bank-statement-import.messages';
import { BankStatementEntriesStore, EntriesRow, EntriesRowFilter } from './bank-statement-entries.store';
import { BseStepperComponent } from './bse-stepper.component';

/** Nombre de lignes affichées par page de la grille des contreparties (plan §4.7, perf.). */
const PAGE_SIZE = 50;

/** Résultat de génération, forme réduite affichée à l'étape 5 (Résultat). */
interface GenerationSummary {
  created: number;
  skipped: number;
  failed: number;
  firstEntryNumber: number | null;
  lastEntryNumber: number | null;
  entryNumberRangesByYear: EntryNumberRange[];
}

/**
 * Étape 4 (Contreparties) + étape 5 (Résultat) de la page dédiée « Relevé bancaire → écritures ».
 * Génération STRICTEMENT atomique (tout ou rien) : un seul appel `generate(..., {atomic:true})`.
 */
@Component({
  selector: 'app-bank-statement-entries-posting',
  standalone: true,
  providers: [BankStatementEntriesStore, EntryReferenceStore],
  imports: [CommonModule, FormsModule, RouterModule, PageHeaderComponent, ButtonComponent, BseStepperComponent],
  template: `
    <app-page-header
      i18n-title="@@accounting.bank-statement-entries.releve.bancaire.ecritures.426df845"
      title="Relevé bancaire → écritures"
    />
    <app-bse-stepper [activeIndex]="view() === 'result' ? 4 : 3" />

    @if (error(); as msg) {
      <div class="bse-banner bse-banner--error" role="alert">{{ msg }}</div>
    }

    @if (!store.proposals()) {
      <p i18n="@@accounting.bank-statement-entries.ts.chargement.des.propositions.2f80f455">Chargement des propositions…</p>
    } @else if (view() === 'result') {
      @if (store.atomicRejected()) {
        <section class="bse-result bse-result--failed" data-testid="bse-result-failed">
          <h2 i18n="@@accounting.bank-statement-entries.ts.aucune.ecriture.n.a.ete.creee.367e3d94">Aucune écriture n'a été créée.</h2>
          <p i18n="@@accounting.bank-statement-entries.ts.rien.n.a.ete.enregistre.dans.le.journal.ni.ecrit.472ec1e1">
            rien n'a été enregistré dans le journal : ni écriture, ni numéro de pièce, ni règle mémorisée.
          </p>
          <p i18n="@@accounting.bank-statement-entries.ts.vos.modifications.de.comptes.tiers.et.libelles.s.57b3a15c">
            Vos modifications de comptes, tiers et libellés sont conservées.
          </p>
          <h3 i18n="@@accounting.bank-statement-entries.ts.lignes.a.corriger.2e2da19f">Lignes à corriger</h3>
          <ul data-testid="bse-rejected-lines">
            @for (o of store.rejectedOutcomes(); track o.lineId) {
              <li>{{ failedLineLabel(o.lineId) }} — {{ generationFailureMessage(o.code) }}</li>
            }
          </ul>
          <app-button variant="secondary" (clicked)="backToGrid()" data-testid="bse-back-to-grid"
            i18n="@@accounting.bank-statement-entries.ts.retour.aux.propositions.13358e3a">Retour aux propositions</app-button>
        </section>
      } @else if (lastGeneration(); as result) {
        <section class="bse-result bse-result--success" data-testid="bse-result-success">
          <h2>{{ successMessage(result) }}</h2>
          @if (result.entryNumberRangesByYear.length > 0) {
            <ul data-testid="bse-entry-ranges">
              @for (range of result.entryNumberRangesByYear; track range.fiscalYear) {
                <li>{{ entryRangeMessage(range) }}</li>
              }
            </ul>
          } @else if (result.firstEntryNumber != null && result.lastEntryNumber != null) {
            <p>{{ entryNumbersMessage(result) }}</p>
          }
          @if (result.skipped > 0) {
            <p data-testid="bse-skipped-count">{{ skippedMessage(result) }}</p>
          }
          <div class="bse-result-actions">
            <a routerLink="/accounting/draft-batch" class="bse-link" data-testid="bse-open-draft-batch"
              i18n="@@accounting.bank-statement-entries.ts.valider.les.ecritures.en.brouillard.50f4ac68">Valider les écritures en brouillard</a>
            <a [routerLink]="'/accounting/journal'" [queryParams]="journalLinkParams()" class="bse-link" data-testid="bse-open-journal"
              i18n="@@accounting.bank-statement-entries.ts.voir.le.journal.1b6a9f33">Voir le journal</a>
            <a routerLink="/accounting/bank-statement-entries" fragment="bse-history" class="bse-link" data-testid="bse-open-history"
              i18n="@@accounting.bank-statement-entries.ts.voir.l.historique.des.imports.7c8e1d44">Voir l'historique des imports</a>
            <app-button variant="secondary" (clicked)="importAnother()" data-testid="bse-import-another"
              i18n="@@accounting.bank-statement-entries.ts.importer.un.autre.releve.30586829">Importer un autre relevé</app-button>
          </div>
        </section>
      }
    } @else {
      <div class="bse-toolbar">
        <span i18n="@@accounting.bank-statement-entries.ts.journal.57d7f743">Journal</span> : {{ store.journalCode() }}
        <app-button variant="secondary" (clicked)="downloadSource()" [disabled]="busy()" data-testid="bse-download-source"
          i18n="@@accounting.bank-statement-entries.ts.telecharger.la.piece.justificative.4ae35fd4">Télécharger la pièce justificative</app-button>
        @if (canClassifyWithAi(); as unclassified) {
          <app-button variant="secondary" icon="pi-sparkles" iconPos="left" (clicked)="classifyWithAi()" [disabled]="busy()" data-testid="bse-classify-ai"
            i18n="@@accounting.bank-statement-entries.ts.classer.par.l.ia.9665f0d2">Classer par l'IA ({{ unclassified }})</app-button>
        }
      </div>

      <div class="bse-filters" role="tablist" data-testid="bse-row-filters">
        <button type="button" [class.active]="store.rowFilter() === 'all'" (click)="setRowFilter('all')" data-testid="bse-filter-all"
          i18n="@@accounting.bank-statement-entries.ts.toutes.c5f641e4">Toutes</button>
        <button type="button" [class.active]="store.rowFilter() === 'todo'" (click)="setRowFilter('todo')" data-testid="bse-filter-todo"
          i18n="@@accounting.bank-statement-entries.ts.a.completer.b06198e1">À compléter</button>
        <button type="button" [class.active]="store.rowFilter() === 'proposed'" (click)="setRowFilter('proposed')" data-testid="bse-filter-proposed"
          i18n="@@accounting.bank-statement-entries.ts.pretes.36d3db42">Prêtes</button>
        <button type="button" [class.active]="store.rowFilter() === 'at471'" (click)="setRowFilter('at471')" data-testid="bse-filter-at471"
          i18n="@@accounting.bank-statement-entries.ts.au.compte.d.attente.471.f72babdb">Au compte d'attente 471</button>
        <button type="button" [class.active]="store.rowFilter() === 'settled'" (click)="setRowFilter('settled')" data-testid="bse-filter-settled"
          i18n="@@accounting.bank-statement-entries.ts.deja.comptabilisees.d9d7cf7c">Déjà comptabilisées</button>
        @if (hasRowsNeedingCorrection()) {
          <button type="button" [class.active]="store.rowFilter() === 'rejected'" (click)="setRowFilter('rejected')" data-testid="bse-filter-rejected"
            i18n="@@accounting.bank-statement-entries.ts.a.corriger.filtre.9b1f2e3a">À corriger</button>
        }
      </div>

      @if (store.selectedCount() > 0) {
        <div class="bse-bulk" data-testid="bse-bulk-bar">
          <span>{{ selectedCountMessage() }}</span>
          <input class="bse-input" [(ngModel)]="bulkAccount" list="bse-accounts"
            i18n-placeholder="@@accounting.bank-statement-entries.ts.appliquer.le.compte.6cf13df4" placeholder="Appliquer le compte" />
          <app-button variant="secondary" (clicked)="applyBulkAccount()" data-testid="bse-apply-bulk-account"
            i18n="@@accounting.bank-statement-entries.ts.appliquer.a4d66139">Appliquer</app-button>
          <input class="bse-input" [(ngModel)]="bulkLabel" maxlength="500" data-testid="bse-bulk-label"
            i18n-placeholder="@@accounting.bank-statement-entries.ts.appliquer.le.libelle.4ed1b935" placeholder="Appliquer le libellé" />
          <app-button variant="secondary" (clicked)="applyBulkLabel()" data-testid="bse-apply-bulk-label"
            i18n="@@accounting.bank-statement-entries.ts.appliquer.a4d66139">Appliquer</app-button>
        </div>
      }

      <datalist id="bse-accounts">
        @for (a of accountOptions(); track a.accountNumber) {
          <option [value]="a.accountNumber">{{ a.accountNumber }} — {{ a.label }}</option>
        }
      </datalist>

      <table class="bse-grid" data-testid="bse-rows-table">
        <thead>
          <tr>
            <th class="bse-check">
              <input type="checkbox" [checked]="allVisibleSelected()" (change)="store.selectAllVisible($any($event.target).checked)"
                i18n-aria-label="@@accounting.bank-statement-entries.ts.tout.selectionner.06f2c1c0" aria-label="Tout sélectionner" />
            </th>
            <th i18n="@@accounting.bank-statement-entries.ts.date.eb9a4bc1">Date</th>
            <th i18n="@@accounting.bank-statement-entries.ts.libelle.du.releve.eb9efd4d">Libellé du relevé</th>
            <th class="bse-right" i18n="@@accounting.bank-statement-entries.ts.debit.f528224f">Débit</th>
            <th class="bse-right" i18n="@@accounting.bank-statement-entries.ts.credit.19194bdf">Crédit</th>
            <th i18n="@@accounting.bank-statement-entries.ts.statut.659499f3">Statut</th>
            <th i18n="@@accounting.bank-statement-entries.ts.compte.de.contrepartie.df81fd03">Compte de contrepartie</th>
            <th i18n="@@accounting.bank-statement-entries.ts.tiers.435080ba">Tiers</th>
            <th i18n="@@accounting.bank-statement-entries.ts.libelle.de.l.ecriture.9e5c8f10">Libellé de l'écriture</th>
            <th i18n="@@accounting.bank-statement-entries.ts.tva.debit.seulement.3833f905">TVA (débit seulement)</th>
            <th i18n="@@accounting.bank-statement-entries.ts.memoriser.72c86d0e">Mémoriser</th>
          </tr>
        </thead>
        <tbody>
          @for (row of pagedRows(); track row.proposal.lineId) {
            <tr [class.bse-row--settled]="isSettled(row)" [class.bse-row--needs-correction]="row.needsCorrection" [attr.data-testid]="'bse-row-' + row.proposal.lineId">
              <td class="bse-check">
                <input type="checkbox" [checked]="row.selected" [disabled]="isSettled(row) || row.proposal.status === 'Blocked'"
                  (change)="store.setRowSelected(row.proposal.lineId, $any($event.target).checked)"
                  i18n-aria-label="@@accounting.bank-statement-entries.ts.generer.l.ecriture.de.cette.ligne.222c38bb" aria-label="Générer l'écriture de cette ligne" />
              </td>
              <td>{{ row.proposal.transactionDate | date: 'dd/MM/yyyy' }}</td>
              <td class="bse-label">
                <div>{{ row.proposal.label }}</div>
                @if (proposalSourceLabel(row.proposal.source); as origin) {
                  <div class="bse-muted bse-small">{{ origin }}</div>
                }
                @for (d of row.proposal.diagnostics; track $index) {
                  <div class="bse-small" [class.bse-danger]="d.severity === 'blocking'" [class.bse-warn]="d.severity !== 'blocking'">
                    {{ proposalDiagnosticMessage(d.code, row.proposal.accountNumber) }}
                  </div>
                }
              </td>
              <td class="bse-right bse-num">{{ row.proposal.isDebit ? (row.proposal.amount | number: '1.3-3') : '' }}</td>
              <td class="bse-right bse-num">{{ !row.proposal.isDebit ? (row.proposal.amount | number: '1.3-3') : '' }}</td>
              <td>
                <span [class]="'bse-badge bse-badge--' + row.proposal.status.toLowerCase()">{{ lineStatusLabel(row.proposal.status) }}</span>
                @if (row.proposal.confidence) { <div class="bse-small bse-muted">{{ confidenceLabel(row.proposal.confidence) }}</div> }
              </td>
              <td>
                @if (!isSettled(row)) {
                  <input class="bse-input bse-input--account" list="bse-accounts" [ngModel]="row.account"
                    (ngModelChange)="onAccountChanged(row, $event)" [disabled]="row.proposal.status === 'Blocked'"
                    i18n-aria-label="@@accounting.bank-statement-entries.ts.compte.de.contrepartie.df81fd03" aria-label="Compte de contrepartie" />
                  @if (accountLabel(row.account); as label) { <div class="bse-small bse-muted">{{ label }}</div> }
                } @else {
                  {{ row.account }}
                }
              </td>
              <td class="bse-tp">
                @if (!isSettled(row) && needsThirdParty(row)) {
                  <input class="bse-input" [ngModel]="row.thirdPartyName" (ngModelChange)="searchThirdParty(row, $event)"
                    (focus)="activeRowId.set(row.proposal.lineId)"
                    i18n-placeholder="@@accounting.bank-statement-entries.ts.rechercher.un.tiers.0a1b4369" placeholder="Rechercher un tiers"
                    i18n-aria-label="@@accounting.bank-statement-entries.ts.tiers.435080ba" aria-label="Tiers" />
                  @if (activeRowId() === row.proposal.lineId && thirdPartySuggestions(row).length > 0) {
                    <ul class="bse-suggestions" role="listbox">
                      @for (tp of thirdPartySuggestions(row); track tp.id) {
                        <li><button type="button" class="bse-suggestion" (click)="pickThirdParty(row, tp)">{{ tp.display }}</button></li>
                      }
                    </ul>
                  }
                } @else if (row.thirdPartyName) {
                  <span>{{ row.thirdPartyName }}</span>
                }
              </td>
              <td class="bse-label">
                @if (!isSettled(row)) {
                  <input class="bse-input" [ngModel]="row.label" maxlength="500" [attr.data-testid]="'bse-label-' + row.proposal.lineId"
                    (ngModelChange)="onLabelChanged(row, $event)"
                    i18n-placeholder="@@accounting.bank-statement-entries.ts.libelle.du.releve.eb9efd4d" placeholder="Libellé du relevé"
                    i18n-aria-label="@@accounting.bank-statement-entries.ts.libelle.de.l.ecriture.9e5c8f10" aria-label="Libellé de l'écriture" />
                } @else {
                  {{ row.label || row.proposal.label }}
                }
              </td>
              <td>
                @if (row.proposal.vatSplit; as vat) {
                  <label class="bse-inline bse-small">
                    <input type="checkbox" [checked]="row.splitVat" [disabled]="isSettled(row)"
                      (change)="onSplitVatChanged(row, $any($event.target).checked)" />
                    {{ vat.netAmount | number: '1.3-3' }} + {{ vat.vatAmount | number: '1.3-3' }}
                  </label>
                }
              </td>
              <td class="bse-check">
                @if (!isSettled(row)) {
                  <input type="checkbox" [checked]="row.remember" (change)="onRememberChanged(row, $any($event.target).checked)"
                    i18n-aria-label="@@accounting.bank-statement-entries.ts.memoriser.cette.affectation.pour.les.prochains.r.58391091" aria-label="Mémoriser cette affectation pour les prochains relevés" />
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="11" i18n="@@accounting.bank-statement-entries.ts.aucune.ligne.a.comptabiliser.941c0e8c">Aucune ligne à comptabiliser.</td></tr>
          }
        </tbody>
      </table>

      @if (pageCount() > 1) {
        <div class="bse-pagination" data-testid="bse-pagination">
          <app-button variant="secondary" [disabled]="page() <= 1" (clicked)="page.set(page() - 1)" data-testid="bse-page-prev"
            i18n="@@accounting.bank-statement-entries.ts.page.precedente.6b7f9a21">Page précédente</app-button>
          <span>{{ pageLabel() }}</span>
          <app-button variant="secondary" [disabled]="page() >= pageCount()" (clicked)="page.set(page() + 1)" data-testid="bse-page-next"
            i18n="@@accounting.bank-statement-entries.ts.page.suivante.1a9c7e02">Page suivante</app-button>
        </div>
      }

      <div class="bse-totals" data-testid="bse-totals">
        <span>{{ toGenerateLabel() }} : {{ store.selectedCount() }}</span>
        <span>{{ totalDebitsLabel() }} : {{ totals().debit | number: '1.3-3' }}</span>
        <span>{{ totalCreditsLabel() }} : {{ totals().credit | number: '1.3-3' }}</span>
      </div>

      <div class="bse-actions">
        <app-button variant="primary" icon="pi-bolt" iconPos="left" (clicked)="generate()" [disabled]="store.selectedCount() === 0 || busy() || overMaxAtomicLines()"
          data-testid="bse-generate"
          i18n="@@accounting.bank-statement-entries.ts.generer.les.ecritures.en.brouillard.03aa9336">Générer les écritures en brouillard</app-button>
        @if (overMaxAtomicLines()) {
          <p class="bse-hint" data-testid="bse-max-lines-hint">{{ maxAtomicLinesHint() }}</p>
        }
      </div>
    }
  `,
  styles: [
    `
      .bse-banner { padding: 0.6rem 0.9rem; border-radius: 6px; margin: 0.5rem 0; }
      .bse-banner--error { background: #f8d7da; color: #842029; }
      .bse-toolbar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
      .bse-filters { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
      .bse-filters button { border: 1px solid #dee2e6; background: #fff; border-radius: 999px; padding: 0.3rem 0.8rem; font-size: 0.85rem; cursor: pointer; }
      .bse-filters button.active { background: #0d6efd; color: #fff; border-color: #0d6efd; }
      .bse-bulk { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; background: #e7f1ff; border-radius: 6px; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; }
      .bse-input { border: 1px solid #ced4da; border-radius: 4px; padding: 0.3rem 0.5rem; font: inherit; width: 100%; }
      .bse-input--account { min-width: 8rem; }
      .bse-grid { width: 100%; border-collapse: collapse; }
      .bse-grid th, .bse-grid td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #e9ecef; text-align: start; vertical-align: top; }
      .bse-grid tr.bse-row--settled { background: #f8f9fa; color: #6c757d; }
      .bse-grid tr.bse-row--needs-correction { background: #fff3cd; }
      .bse-check { width: 2rem; text-align: center; }
      .bse-right { text-align: end; }
      .bse-num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
      .bse-label { min-width: 10rem; }
      .bse-tp { position: relative; min-width: 10rem; }
      .bse-small { font-size: 0.78rem; }
      .bse-muted { color: #6c757d; }
      .bse-danger { color: #842029; }
      .bse-warn { color: #664d03; }
      .bse-inline { display: flex; align-items: center; gap: 0.3rem; }
      .bse-badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px; background: #e7f1ff; color: #0d6efd; font-size: 0.75rem; }
      .bse-badge--generated, .bse-badge--reconciled, .bse-badge--alreadyposted { background: #e6f6ec; color: #1a7f4e; }
      .bse-badge--ambiguous, .bse-badge--toverify { background: #fff3cd; color: #664d03; }
      .bse-badge--blocked { background: #f8d7da; color: #842029; }
      .bse-badge--proposed { background: #e7f1ff; color: #0d6efd; }
      .bse-badge--tocomplete { background: #e9ecef; color: #495057; }
      .bse-suggestions { position: absolute; inset-inline-start: 0; top: 100%; z-index: 20; margin: 0.1rem 0 0; padding: 0.2rem 0; list-style: none; background: #fff; border: 1px solid #dee2e6; border-radius: 6px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08); max-height: 12rem; overflow-y: auto; min-width: 12rem; }
      .bse-suggestion { display: block; width: 100%; text-align: start; background: none; border: none; padding: 0.3rem 0.6rem; cursor: pointer; font: inherit; }
      .bse-suggestion:hover, .bse-suggestion:focus { background: #e7f1ff; }
      .bse-pagination { display: flex; align-items: center; gap: 0.75rem; justify-content: center; margin: 0.75rem 0; }
      .bse-totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
      .bse-actions { display: flex; align-items: center; gap: 0.75rem; justify-content: flex-end; margin-top: 1rem; }
      .bse-hint { color: #6c757d; font-size: 0.85rem; }
      .bse-result { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem; }
      .bse-result--success { border-inline-start: 4px solid #1a7f4e; }
      .bse-result--failed { border-inline-start: 4px solid #842029; }
      .bse-result-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-top: 1rem; }
      .bse-link { color: #0d6efd; }
    `
  ]
})
export class BankStatementEntriesPostingComponent implements OnInit {
  readonly store = inject(BankStatementEntriesStore);
  private readonly api = inject(BankStatementImportService);
  private readonly refs = inject(EntryReferenceStore);
  private readonly auth = inject(AuthService);
  private readonly employees = inject(EmployeeService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly view = signal<'grid' | 'result'>('grid');
  readonly activeRowId = signal<string | null>(null);
  readonly employeeSuggestions = signal<ThirdPartyRef[]>([]);
  readonly lastGeneration = signal<GenerationSummary | null>(null);
  readonly page = signal(1);
  readonly dirty = signal(false);
  bulkAccount = '';
  bulkLabel = '';

  private statementId: string | null = null;

  readonly accountOptions = computed(() => this.refs.accounts().filter(a => a.isActive));

  /** Lignes sélectionnées, hors lignes déjà comptabilisées — base commune des totaux et de la génération. */
  private readonly selectedPending = computed(() => this.store.rows().filter(r => r.selected && !this.isSettled(r)));

  readonly totals = computed(() => {
    const selected = this.selectedPending();
    return {
      debit: selected.filter(r => r.proposal.isDebit).reduce((sum, r) => sum + r.proposal.amount, 0),
      credit: selected.filter(r => !r.proposal.isDebit).reduce((sum, r) => sum + r.proposal.amount, 0)
    };
  });

  /** Lignes visibles de la page courante (pagination 50, plan §4.7 perf.) ; se recale si le filtre change. */
  readonly pagedRows = computed(() => {
    const all = this.store.visibleRows();
    const current = Math.min(this.page(), this.pageCount());
    return all.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  });

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.store.visibleRows().length / PAGE_SIZE)));

  /** Lignes au compte d'attente 471 parmi les lignes sélectionnées à générer (résumé de confirmation). */
  readonly selectedSuspenseCount = computed(() => this.selectedPending().filter(r => r.proposal.source === 'Fallback').length);

  readonly uncheckedCount = computed(() => this.store.rows().filter(r => !r.selected && !this.isSettled(r)).length);

  readonly hasRowsNeedingCorrection = computed(() => this.store.rows().some(r => r.needsCorrection));

  readonly lineStatusLabel = lineStatusLabel;
  readonly confidenceLabel = confidenceLabel;
  readonly issueTitle = issueTitle;
  readonly proposalSourceLabel = proposalSourceLabel;
  readonly proposalDiagnosticMessage = proposalDiagnosticMessage;
  readonly generationFailureMessage = generationFailureMessage;

  ngOnInit(): void {
    this.refs.loadAll();
    this.api.capabilities().subscribe(c => this.store.capabilities.set(c));
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        const statementId = params.get('statementId');
        if (!statementId) return;
        // Code de journal transmis par l'étape « Contrôle » (query param `journal`) ; validé contre
        // les journaux de banque actifs du dossier, retombe sur JB (plan HIGH 1 — jamais codé en dur).
        this.store.loadJournalCode(query.get('journal'));
        this.loadProposals(statementId);
      });
  }

  /** Des contreparties ont été modifiées et aucune écriture n'a encore été générée (plan §4.6). */
  private hasUnsavedChanges(): boolean {
    return this.view() === 'grid' && this.dirty();
  }

  canDeactivate(): boolean {
    if (!this.hasUnsavedChanges()) return true;
    return window.confirm(
      $localize`:@@accounting.bank-statement-entries.ts.vous.avez.des.contreparties.modifiees.non.gener.d3f1b1a2:Vous avez des contreparties modifiées, non générées. Quitter cette page ? Les changements seront perdus.`
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  unloadNotification(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.returnValue = $localize`:@@accounting.bank-statement-entries.ts.vous.avez.des.contreparties.modifiees.non.gener.3c2fef3b:Vous avez des contreparties modifiées, non générées.`;
    }
  }

  setRowFilter(filter: EntriesRowFilter): void {
    this.store.rowFilter.set(filter);
    this.page.set(1);
  }

  private loadProposals(statementId: string): void {
    this.statementId = statementId;
    this.error.set(null);
    this.api.proposals(statementId, { assist: true }).subscribe({
      next: p => this.store.setProposals(p),
      error: (err: unknown) => this.error.set(importErrorOf(err))
    });
  }

  isSettled(row: EntriesRow): boolean {
    return logic.isSettledRow(row);
  }

  needsThirdParty(row: EntriesRow): boolean {
    return logic.needsThirdPartyRow(row);
  }

  allVisibleSelected(): boolean {
    const selectable = this.store.visibleRows().filter(r => !this.isSettled(r) && r.proposal.status !== 'Blocked');
    return selectable.length > 0 && selectable.every(r => r.selected);
  }

  onAccountChanged(row: EntriesRow, account: string): void {
    const expected = expectedThirdPartyKind(account);
    const clearThirdParty = row.thirdPartyId && expected !== 0 && expected !== row.thirdPartyKind;
    this.store.updateRow(row.proposal.lineId, {
      account,
      ...(clearThirdParty ? { thirdPartyId: null, thirdPartyKind: 0, thirdPartyName: '' } : {})
    });
    this.dirty.set(true);
  }

  accountLabel(account: string): string | null {
    if (!account) return null;
    return (
      this.refs.findAccountByNumber(account)?.label ??
      $localize`:@@accounting.bank-statement-entries.ts.compte.inconnu.du.plan.a0abf82a:Compte inconnu du plan`
    );
  }

  searchThirdParty(row: EntriesRow, term: string): void {
    this.store.updateRow(row.proposal.lineId, { thirdPartyName: term, thirdPartyId: null, thirdPartyKind: 0 });
    this.activeRowId.set(row.proposal.lineId);
    this.dirty.set(true);
    if (expectedThirdPartyKind(row.account) === 3) this.searchEmployees(term);
    else this.refs.searchThirdParties(term);
  }

  thirdPartySuggestions(row: EntriesRow): ThirdPartyRef[] {
    const expected = expectedThirdPartyKind(row.account);
    if (expected === 3) return this.employeeSuggestions();
    return this.refs.thirdPartySuggestions().filter(tp => expected === 0 || tp.kind === expected);
  }

  private searchEmployees(term: string): void {
    const search = term.trim();
    if (search.length < 2 || !this.auth.hasPermission(PERMISSIONS.payroll.read)) {
      this.employeeSuggestions.set([]);
      return;
    }
    this.employees
      .list(search, true, 1, 10)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe(res =>
        this.employeeSuggestions.set(
          (res?.data?.items ?? []).map(e => ({
            id: e.id,
            kind: 3,
            name: e.fullName,
            display: $localize`:@@accounting.bank-statement-entries.ts.salarie.b41cc694:Salarié — ${e.fullName}:name: (${e.employeeNumber}:number:)`
          }))
        )
      );
  }

  pickThirdParty(row: EntriesRow, tp: ThirdPartyRef): void {
    this.store.updateRow(row.proposal.lineId, { thirdPartyId: tp.id, thirdPartyKind: tp.kind, thirdPartyName: tp.name });
    this.activeRowId.set(null);
    this.dirty.set(true);
  }

  onLabelChanged(row: EntriesRow, label: string): void {
    this.store.updateRow(row.proposal.lineId, { label: label.slice(0, 500) });
    this.dirty.set(true);
  }

  onRememberChanged(row: EntriesRow, remember: boolean): void {
    this.store.updateRow(row.proposal.lineId, { remember });
    this.dirty.set(true);
  }

  onSplitVatChanged(row: EntriesRow, splitVat: boolean): void {
    this.store.updateRow(row.proposal.lineId, { splitVat });
    this.dirty.set(true);
  }

  applyBulkAccount(): void {
    const account = this.bulkAccount.trim();
    if (!account) return;
    for (const row of this.store.rows()) {
      if (row.selected && !this.isSettled(row)) this.onAccountChanged(row, account);
    }
  }

  applyBulkLabel(): void {
    const label = this.bulkLabel.trim().slice(0, 500);
    if (!label) return;
    for (const row of this.store.rows()) {
      if (row.selected && !this.isSettled(row)) this.onLabelChanged(row, label);
    }
  }

  /** Nombre de libellés distincts non reconnus, si une classification IA complémentaire est possible (sinon `null`). */
  canClassifyWithAi(): number | null {
    const p = this.store.proposals();
    if (!p || p.unclassifiedDistinctLabels <= 0 || !this.store.capabilities()?.aiAvailable) return null;
    return p.unclassifiedDistinctLabels;
  }

  classifyWithAi(): void {
    const statementId = this.statementId;
    if (!statementId) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.classifyWithAi(statementId).subscribe({
      next: () => {
        this.busy.set(false);
        this.loadProposals(statementId);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(importErrorOf(err));
      }
    });
  }

  pageLabel(): string {
    return $localize`:@@accounting.bank-statement-entries.ts.page.sur.d2b4ac4f:Page ${this.page()}:current: sur ${this.pageCount()}:total:`;
  }

  overMaxAtomicLines(): boolean {
    const max = this.store.capabilities()?.maxAtomicLines ?? null;
    return !!max && this.store.selectedCount() > max;
  }

  maxAtomicLinesHint(): string {
    const max = this.store.capabilities()?.maxAtomicLines ?? 0;
    return $localize`:@@accounting.bank-statement-entries.ts.au.dela.du.maximum.autorise.de.par.envoi.de.e.a0f8c912:Au-delà du maximum autorisé de ${max}:max: ligne(s) par envoi : désélectionnez des lignes ou traitez-les en plusieurs envois.`;
  }

  downloadSource(): void {
    const id = this.statementId;
    if (!id) return;
    this.error.set(null);
    this.api.sourceFile(id).subscribe({
      next: blob => downloadBlob(blob, `releve${SOURCE_EXTENSIONS[blob.type] ?? ''}`),
      error: (err: unknown) =>
        this.error.set(
          err instanceof BankStatementImportError && err.status === 404
            ? $localize`:@@accounting.bank-statement-entries.ts.aucune.piece.justificative.pour.ce.releve.e7f06a74:Aucune pièce justificative pour ce relevé.`
            : importErrorOf(err)
        )
    });
  }

  private isReady(row: EntriesRow): boolean {
    return logic.isRowReady(row, account => !!this.refs.findAccountByNumber(account)?.isActive);
  }

  journalLinkParams(): { journalCode: string; from: string; to: string } {
    const p = this.store.proposals();
    return {
      journalCode: this.store.journalCode(),
      from: p?.periodStart ?? '',
      to: p?.periodEnd ?? ''
    };
  }

  generate(): void {
    const p = this.store.proposals();
    if (!p || !this.statementId) return;
    this.error.set(null);
    const selected = this.selectedPending();
    if (selected.length === 0) return;

    const invalid = selected.filter(r => !this.isReady(r));
    if (invalid.length > 0) {
      this.error.set(
        $localize`:@@accounting.bank-statement-entries.ts.ligne.s.selectionnee.s.sans.compte.valide.ou.san.08820478:${invalid.length}:count: ligne(s) sélectionnée(s) sans compte valide ou sans tiers : complétez-les ou désélectionnez-les.`
      );
      return;
    }

    const max = this.store.capabilities()?.maxAtomicLines ?? null;
    if (max && selected.length > max) {
      this.error.set(
        $localize`:@@accounting.bank-statement-entries.ts.ligne.s.selectionnee.s.a.generer.au.dela.du.maxi.863aa5ee:${selected.length}:count: ligne(s) sélectionnée(s) à générer, au-delà du maximum autorisé de ${max}:max: par envoi.`
      );
      return;
    }

    const excludedLineIds = this.store.rows().filter(r => !r.selected && !this.isSettled(r)).map(r => r.proposal.lineId);
    const items: GenerateItem[] = selected.map(r => logic.rowToGenerateItem(r, r.label.trim() || null));
    const statementId = this.statementId;
    const journal = this.store.journalCode();
    const suspenseCount = this.selectedSuspenseCount();
    const unchecked = this.uncheckedCount();

    this.confirmation.confirm({
      header: $localize`:@@accounting.bank-statement-entries.ts.generer.les.ecritures.f829d762:Générer les écritures`,
      message: this.confirmGenerateMessage(selected.length, journal, p, suspenseCount, unchecked),
      acceptLabel: $localize`:@@accounting.bank-statement-entries.ts.generer.bd221c07:Générer`,
      rejectLabel: $localize`:@@accounting.bank-statement-entries.ts.annuler.49ba3292:Annuler`,
      accept: () => this.runGeneration(statementId, journal, items, excludedLineIds)
    });
  }

  /** Résumé complet avant génération : nombre d'écritures, journal, période, lignes au 471, lignes non cochées (plan §4.4 étape 4). */
  private confirmGenerateMessage(
    count: number,
    journal: string,
    p: { periodStart: string; periodEnd: string },
    suspenseCount: number,
    uncheckedCount: number
  ): string {
    const base = $localize`:@@accounting.bank-statement-entries.ts.ecriture.s.seront.creees.en.brouillard.dans.le.j.3d3c6933:${count}:count: écriture(s) seront créées en brouillard dans le journal ${journal}:journal:, une par ligne de relevé. Si une seule ligne échoue, aucune écriture n'est créée (tout ou rien).`;
    const period = $localize`:@@accounting.bank-statement-entries.ts.periode.du.au.d2e3f901:Période du ${logic.formatDateFr(p.periodStart)}:from: au ${logic.formatDateFr(p.periodEnd)}:to:.`;
    const parts = [base, period];
    if (suspenseCount > 0) {
      parts.push(
        $localize`:@@accounting.bank-statement-entries.ts.dont.ligne.s.au.compte.d.attente.471.c3e8a812:Dont ${suspenseCount}:count: ligne(s) au compte d'attente 471.`
      );
    }
    if (uncheckedCount > 0) {
      parts.push(
        $localize`:@@accounting.bank-statement-entries.ts.ligne.s.non.cochee.s.ne.seront.pas.generees.5f3b9a10:${uncheckedCount}:count: ligne(s) non cochée(s) ne seront pas générées.`
      );
    }
    return parts.join(' ');
  }

  private runGeneration(statementId: string, journal: string, items: GenerateItem[], excludedLineIds: string[]): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.generate(statementId, journal, items, { atomic: true, assist: true, excludedLineIds }).subscribe({
      next: result => {
        this.busy.set(false);
        this.applyGenerationResult(result);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const code = err instanceof BankStatementImportError ? err.code : null;
        this.error.set(importErrorOf(err));
        if (code === 'bank_statement_posting.atomic_rejected' && err instanceof BankStatementImportError && err.data) {
          // Pré-validation entièrement rejetée (HTTP 400) : rien n'a été écrit côté serveur, le résultat
          // complet (avec le motif par ligne) voyage dans la charge utile de l'erreur ; pas de relecture.
          this.applyGenerationResult(err.data as GenerateResult);
          return;
        }
        if (
          code === 'bank_statement_posting.atomic_incomplete' ||
          code === 'bank_statement_posting.atomic_too_many_lines' ||
          code === 'bank_statement_posting.atomic_overlap'
        ) {
          // Erreur de validation avant toute tentative d'écriture (couverture incomplète, trop de lignes,
          // ou lignes à la fois cochées et exclues) : rien n'a changé côté serveur, pas de relecture.
          return;
        }
        // Résultat réel inconnu (conflit de concurrence, réseau/délai…) : on relit les propositions avant
        // toute nouvelle tentative, par sécurité d'idempotence (l'écriture a pu partiellement réussir), et on
        // efface les modifications locales devenues incertaines (plan MED 5 — l'utilisateur doit tout revérifier).
        this.loadProposals(statementId);
        this.dirty.set(false);
        this.error.set(uncertainResultAfterReloadMessage());
      }
    });
  }

  private applyGenerationResult(result: GenerateResult): void {
    this.lastGeneration.set({
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
      firstEntryNumber: result.firstEntryNumber,
      lastEntryNumber: result.lastEntryNumber,
      entryNumberRangesByYear: result.entryNumberRangesByYear ?? []
    });
    if (result.committed === false) {
      this.store.atomicRejected.set(true);
      this.store.rejectedOutcomes.set(
        result.outcomes.filter(o => o.outcome === 'failed').map(o => ({ lineId: o.lineId, code: o.code, message: o.message }))
      );
    } else {
      this.store.atomicRejected.set(false);
      this.store.rejectedOutcomes.set([]);
      this.dirty.set(false);
    }
    this.view.set('result');
  }

  backToGrid(): void {
    // Les lignes refusées par la dernière génération atomique (plan MED 6) restent visibles via le
    // filtre « À corriger » pour que l'utilisateur les retrouve facilement avant de relancer.
    const rejectedLineIds = this.store.rejectedOutcomes().map(o => o.lineId);
    if (rejectedLineIds.length > 0) {
      this.store.markNeedsCorrection(rejectedLineIds);
      this.setRowFilter('rejected');
    }
    this.view.set('grid');
  }

  importAnother(): void {
    void this.router.navigate(['/accounting/bank-statement-entries']);
  }

  failedLineLabel(lineId: string): string {
    const proposal = this.store.failedProposal(lineId);
    return proposal ? proposal.label : lineId;
  }

  successMessage(result: GenerationSummary): string {
    return $localize`:@@accounting.bank-statement-entries.ts.ecriture.s.creee.s.en.brouillard.dans.le.journal.18a7e099:${result.created}:count: écriture(s) créée(s) en brouillard dans le journal ${this.store.journalCode()}:journal:.`;
  }

  entryNumbersMessage(result: GenerationSummary): string {
    return $localize`:@@accounting.bank-statement-entries.ts.numeros.a.a65df798:Numéros ${result.firstEntryNumber}:first: à ${result.lastEntryNumber}:last:.`;
  }

  entryRangeMessage(range: EntryNumberRange): string {
    return $localize`:@@accounting.bank-statement-entries.ts.exercice.numeros.a.9b7c3e21:Exercice ${range.fiscalYear}:year: — numéros ${range.first}:first: à ${range.last}:last:.`;
  }

  skippedMessage(result: GenerationSummary): string {
    return $localize`:@@accounting.bank-statement-entries.ts.ligne.s.ignoree.s.car.deja.comptabilisee.s.e5f.ba12c903:${result.skipped}:count: ligne(s) ignorée(s) car déjà comptabilisée(s).`;
  }

  selectedCountMessage(): string {
    return $localize`:@@accounting.bank-statement-entries.ts.ligne.s.selectionnee.s.fb9ca8e8:${this.store.selectedCount()}:count: ligne(s) sélectionnée(s).`;
  }

  toGenerateLabel(): string {
    return $localize`:@@accounting.bank-statement-entries.ts.lignes.a.generer.dea07d81:Lignes à générer`;
  }

  totalDebitsLabel(): string {
    return $localize`:@@accounting.bank-statement-entries.ts.total.debits.9acf4842:Total débits`;
  }

  totalCreditsLabel(): string {
    return $localize`:@@accounting.bank-statement-entries.ts.total.credits.ec8c5525:Total crédits`;
  }
}
