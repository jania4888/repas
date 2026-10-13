/// <reference types="@angular/localize" />
import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { catchError, of, timer } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { BankAccountDto, BankAccountService } from '@core/services/bank-account.service';
import { AccountingService } from '../services/accounting.service';
import { BankStatementEntriesStore } from './bank-statement-entries.store';
import { BseStepperComponent } from './bse-stepper.component';
import { BankStatementImportError, BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';
import {
  BankStatementImportSession,
  BankStatementImportSibling,
  ExtractedStatementLine,
  StatementLineCorrection
} from '../bank-statement-import/bank-statement-import.models';
import * as logic from '../bank-statement-import/bank-statement-posting.logic';
import { issueTitle, sessionFailureMessage } from '../bank-statement-import/bank-statement-import.messages';

const RETRYABLE_FAILURES = ['ai_unavailable', 'ai_timeout', 'ai_failed'];

/**
 * Signalements de l'import tabulaire ambigus sur le SENS de l'opération : une correction du
 * montant seule ne suffit pas à les lever côté serveur, le sens (débit/crédit) doit être
 * explicitement renseigné dans la correction — même s'il est identique à la lecture.
 */
const SIDE_REQUIRED_ISSUE_CODES = ['tabular_both_sides', 'tabular_amount_invalid'];

interface LineDraft {
  lineIndex: number;
  transactionDate: string;
  label: string;
  amount: number | null;
  isDebit: boolean;
  /** Faux tant que l'utilisateur n'a pas choisi explicitement un sens (lignes à sens ambigu). */
  sideChosen: boolean;
}

interface DisplayLine extends ExtractedStatementLine {
  corrected: boolean;
  excluded: boolean;
}

/** Étape 2 (progression IA, le cas échéant) + étape 3 (contrôle des soldes et des lignes lues). */
@Component({
  selector: 'app-bank-statement-entries-session',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageHeaderComponent, ButtonComponent, BseStepperComponent],
  providers: [BankStatementEntriesStore],
  template: `
    <app-page-header title="Relevé bancaire → écritures" i18n-title="@@accounting.bank-statement-entries.releve.bancaire.ecritures.426df845" />
    <app-bse-stepper [activeIndex]="2" />

    @if (error(); as message) {
      <div class="bse-alert bse-alert--error" role="alert">{{ message }}</div>
    }

    @if (session(); as s) {
      @if (s.status === 'Extracting' || s.status === 'Pending') {
        <section class="bse-card" data-testid="bse-ai-progress" role="status">
          <p class="bse-strong" i18n="@@accounting.bank-statement-entries.lecture.du.releve.en.cours.19edd5b1">
            Lecture du relevé en cours… {{ logic.currentPage(s) }} / {{ logic.totalPages(s) }}
          </p>
          <div class="bse-progress-bar" role="progressbar" [attr.aria-valuenow]="s.progressPercent" aria-valuemin="0" aria-valuemax="100">
            <div class="bse-progress-bar__fill" [style.width.%]="s.progressPercent"></div>
          </div>
          <app-button variant="secondary" data-testid="bse-cancel-session" (clicked)="cancelSession()" [disabled]="busy()" i18n="@@accounting.bank-statement-entries.annuler.49ba3292">Annuler</app-button>
        </section>
      }

      @if (s.status === 'Failed' || s.status === 'Cancelled') {
        <section class="bse-card">
          <p class="bse-strong" i18n="@@accounting.bank-statement-entries.l.analyse.de.ce.releve.n.a.pas.abouti.bcff5d65">L'analyse de ce relevé n'a pas abouti.</p>
          @if (s.status === 'Failed' && sessionFailureMessage(s.errorCode); as failure) {
            <p>{{ failure }}</p>
          }
          <div class="bse-actions">
            @if (canRetry(s)) {
              <app-button variant="secondary" data-testid="bse-retry-session" (clicked)="retry()" [disabled]="busy()" i18n="@@accounting.bank-statement-entries.relancer.l.analyse.04afd2a6">Relancer l'analyse</app-button>
            }
            <a routerLink="/accounting/manual-entry" i18n="@@accounting.bank-statement-entries.retour.a.la.saisie.655e44f8">Retour à la saisie</a>
          </div>
        </section>
      }

      @if (s.segmentCount && s.segmentCount > 1) {
        <section class="bse-card" data-testid="bse-siblings" role="status">
          <p class="bse-strong" i18n="@@accounting.bank-statement-entries.ts.ce.fichier.contient.plusieurs.releves.sess0001">
            Ce fichier contient {{ s.segmentCount }} relevés : chacun est contrôlé et enregistré séparément.
          </p>
          <ul class="bse-siblings-list">
            <li i18n="@@accounting.bank-statement-entries.ts.releve.affiche.ci.dessous.sess0002">Relevé {{ s.segmentIndex }} — affiché ci-dessous</li>
            @for (sib of s.siblings ?? []; track sib.id) {
              <li>
                @if (siblingLink(sib); as link) {
                  <a [routerLink]="link">{{ siblingState(sib) }}</a>
                } @else {
                  <span>{{ siblingState(sib) }}</span>
                }
              </li>
            }
          </ul>
        </section>
      }

      @if (s.status === 'AwaitingReview') {
        <section class="bse-card" data-testid="bse-statement-check">
          <h2 i18n="@@accounting.bank-statement-entries.controle.du.releve.61a0ed11">Contrôle du relevé</h2>
          <p class="bse-hint" i18n="@@accounting.bank-statement-entries.verifiez.les.soldes.et.les.anomalies.avant.de.pa.6d73b08b">
            Vérifiez les soldes et les anomalies avant de passer aux propositions d'écritures.
          </p>

          <dl class="bse-summary">
            <dt i18n="@@accounting.bank-statement-entries.fichier.f0fa5745">Fichier</dt><dd>{{ s.fileName }}</dd>
            <dt i18n="@@accounting.bank-statement-entries.operations.lues.514a9d3b">Opérations lues</dt><dd>{{ s.extraction?.lines?.length ?? 0 }}</dd>
            <dt i18n="@@accounting.bank-statement-entries.methode.2e94172a">Méthode</dt><dd>{{ logic.methodLabel(s) }}</dd>
          </dl>

          @if (s.balanceCheck; as bc) {
            <dl class="bse-summary" data-testid="bse-balance-check">
              <dt i18n="@@accounting.bank-statement-entries.solde.d.ouverture.69f2e147">Solde d'ouverture</dt><dd>{{ s.extraction?.header?.openingBalance?.value | number: '1.3-3' }}</dd>
              <dt i18n="@@accounting.bank-statement-entries.total.credits.ec8c5525">Total crédits</dt><dd>{{ bc.sumCredits | number: '1.3-3' }}</dd>
              <dt i18n="@@accounting.bank-statement-entries.total.debits.9acf4842">Total débits</dt><dd>{{ bc.sumDebits | number: '1.3-3' }}</dd>
              <dt i18n="@@accounting.bank-statement-entries.solde.calcule.0e690941">Solde calculé</dt><dd>{{ bc.computedClosing | number: '1.3-3' }}</dd>
              <dt i18n="@@accounting.bank-statement-entries.ecart.6ae8dce8">Écart</dt><dd>{{ bc.difference | number: '1.3-3' }}</dd>
            </dl>
            @if (bc.isBalanced) {
              <p class="bse-alert bse-alert--ok" i18n="@@accounting.bank-statement-entries.soldes.coherents.34d6074c">Soldes cohérents</p>
            } @else if (s.requiresBalanceAcknowledgement) {
              <label class="bse-ack" data-testid="bse-balance-ack">
                <input type="checkbox" [(ngModel)]="balanceAcknowledged" />
                <span i18n="@@accounting.bank-statement-entries.j.ai.verifie.les.operations.ci.dessous.et.je.sou.9b8b528e">
                  J'ai vérifié les opérations ci-dessous et je souhaite poursuivre malgré l'écart de solde.
                </span>
              </label>
            }
          }

          @if (!isTabularSession(s)) {
            @if (suggestedRetargetAccount(); as match) {
              <div class="bse-retarget" role="status" data-testid="bse-retarget-suggestion">
                <p i18n="@@accounting.bank-statement-entries.ts.ce.releve.appartient.au.compte.sess0003">
                  Ce relevé appartient au compte {{ match.bankName }} (…{{ ribTail(match.rib) }}).
                </p>
                <app-button variant="secondary" data-testid="bse-retarget-apply" (clicked)="retargetToAccount(match.id)" [disabled]="busy()"
                            ariaLabel="Analyser avec ce compte bancaire" i18n-ariaLabel="@@accounting.bank-statement-entries.ts.analyser.avec.ce.compte.aria.sess0004"
                            i18n="@@accounting.bank-statement-entries.ts.analyser.avec.ce.compte.sess0005">Analyser avec ce compte</app-button>
              </div>
            } @else if (missingAccountRibTail(); as tail) {
              <p class="bse-hint" role="status" data-testid="bse-retarget-missing" i18n="@@accounting.bank-statement-entries.ts.releve.d.un.compte.absent.sess0006">
                Ce relevé appartient à un autre compte (RIB …{{ tail }}) qui n'existe pas dans ce dossier. Créez-le dans Paiements › Comptes bancaires, puis relancez l'import.
              </p>
            }
          }

          @if (s.extraction?.issues?.length) {
            <ul class="bse-issue-list" data-testid="bse-session-issues">
              @for (issue of s.extraction?.issues; track issue.code + issue.lineIndex) {
                <li [class]="'bse-issue bse-issue--' + issue.severity.toLowerCase()">
                  <strong>{{ issueTitle(issue.code) }}</strong>
                  <span class="bse-hint">{{ issue.message }}</span>
                  @if (issue.lineIndex != null && isEditableIndex(issue.lineIndex)) {
                    <app-button variant="secondary" size="sm" (clicked)="editLineFromIssue(issue.lineIndex)"
                                [attr.data-testid]="'bse-correct-line-' + issue.lineIndex"
                                i18n="@@accounting.bank-statement-entries.ts.corriger.cette.ligne.sess0007">Corriger cette ligne</app-button>
                  }
                </li>
              }
            </ul>
          }

          @if (displayLines().length) {
            <table class="bse-table" data-testid="bse-lines-table">
              <thead>
                <tr>
                  <th i18n="@@accounting.bank-statement-entries.date.operation.957dc298">Date opération</th>
                  <th i18n="@@accounting.bank-statement-entries.libelle.f5485bba">Libellé</th>
                  <th i18n="@@accounting.bank-statement-entries.montant.4adcd9fc">Montant</th>
                  <th i18n="@@accounting.bank-statement-entries.ts.sens.sess0008">Sens</th>
                  <th i18n="@@accounting.bank-statement-entries.ts.actions.sess0009">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (line of displayLines(); track line.index) {
                  @if (editingIndex() === line.index) {
                    <tr class="bse-row--editing" [attr.data-testid]="'bse-line-edit-' + line.index">
                      <td><input type="date" [attr.data-testid]="'bse-edit-date-' + line.index" [(ngModel)]="draft.transactionDate" /></td>
                      <td><input type="text" maxlength="200" [attr.data-testid]="'bse-edit-label-' + line.index" [(ngModel)]="draft.label" /></td>
                      <td><input type="number" step="0.001" min="0.001" [attr.data-testid]="'bse-edit-amount-' + line.index" [(ngModel)]="draft.amount" /></td>
                      <td>
                        <select [attr.data-testid]="'bse-edit-side-' + line.index" [ngModel]="draft.isDebit" (ngModelChange)="onSideChange($event)">
                          <option [ngValue]="true" i18n="@@accounting.bank-statement-entries.ts.debit.sess0010">Débit</option>
                          <option [ngValue]="false" i18n="@@accounting.bank-statement-entries.ts.credit.sess0011">Crédit</option>
                        </select>
                        @if (sideRequired(line.index) && !draft.sideChosen) {
                          <p class="bse-hint" role="alert" i18n="@@accounting.bank-statement-entries.ts.le.sens.doit.etre.choisi.sess0012">Le sens doit être choisi avant d'enregistrer cette ligne.</p>
                        }
                      </td>
                      <td class="bse-row-actions">
                        <app-button variant="primary" size="sm" icon="pi-check" [iconOnly]="true" [disabled]="!draftValid()" (clicked)="saveLineEdit(line)"
                                    [attr.data-testid]="'bse-save-line-' + line.index"
                                    ariaLabel="Enregistrer la correction" i18n-ariaLabel="@@accounting.bank-statement-entries.ts.enregistrer.la.correction.aria.sess0013">Enregistrer</app-button>
                        <app-button variant="secondary" size="sm" icon="pi-times" [iconOnly]="true" (clicked)="cancelLineEdit()"
                                    [attr.data-testid]="'bse-cancel-line-' + line.index"
                                    ariaLabel="Annuler la correction" i18n-ariaLabel="@@accounting.bank-statement-entries.ts.annuler.la.correction.aria.sess0014">Annuler</app-button>
                      </td>
                    </tr>
                  } @else {
                    <tr [class.bse-row--excluded]="line.excluded">
                      <td>{{ line.transactionDate | date: 'dd/MM/yyyy' }}</td>
                      <td>
                        {{ line.label }}
                        @if (line.corrected) {
                          <span class="bse-badge" i18n="@@accounting.bank-statement-entries.ts.corrigee.sess0015">Corrigée</span>
                        }
                        @if (line.excluded) {
                          <span class="bse-badge bse-badge--muted" i18n="@@accounting.bank-statement-entries.ts.exclue.sess0016">Exclue</span>
                        }
                      </td>
                      <td>{{ line.amount | number: '1.3-3' }}</td>
                      <td>{{ line.isDebit ? debitLabel : creditLabel }}</td>
                      <td class="bse-row-actions">
                        @if (isEditable(line)) {
                          @if (!line.excluded) {
                            <app-button variant="secondary" size="sm" icon="pi-pencil" [iconOnly]="true" (clicked)="startLineEdit(line)" [disabled]="busy()"
                                        [attr.data-testid]="'bse-edit-' + line.index"
                                        ariaLabel="Modifier cette ligne" i18n-ariaLabel="@@accounting.bank-statement-entries.ts.modifier.cette.ligne.aria.sess0017">Modifier</app-button>
                            <app-button variant="secondary" size="sm" icon="pi-ban" [iconOnly]="true" (clicked)="toggleExclude(line)" [disabled]="busy()"
                                        [attr.data-testid]="'bse-exclude-' + line.index"
                                        ariaLabel="Exclure cette ligne" i18n-ariaLabel="@@accounting.bank-statement-entries.ts.exclure.cette.ligne.aria.sess0018">Exclure</app-button>
                          } @else {
                            <button type="button" class="bse-link-button" [attr.data-testid]="'bse-restore-' + line.index" (click)="toggleExclude(line)" [disabled]="busy()"
                                    i18n="@@accounting.bank-statement-entries.ts.retablir.sess0019">Rétablir</button>
                          }
                        }
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          }

          @if (correctedCount() > 0 || excludedCount() > 0) {
            <p class="bse-hint" data-testid="bse-correction-summary" i18n="@@accounting.bank-statement-entries.ts.lignes.corrigees.exclues.sess0020">
              {{ correctedCount() }} ligne(s) corrigée(s), {{ excludedCount() }} exclue(s) — le contrôle de solde sera recalculé par le serveur à l'enregistrement.
            </p>
          }

          <div class="bse-actions">
            <app-button variant="secondary" data-testid="bse-cancel-session" (clicked)="cancelSession()" [disabled]="busy()" i18n="@@accounting.bank-statement-entries.abandonner.7a0662a3">Abandonner</app-button>
            <app-button variant="primary" data-testid="bse-confirm-statement"
                        [disabled]="!s.canConfirm || busy() || (balanceMode() === 'warning' && !balanceAcknowledged)"
                        (clicked)="confirmStatement()"
                        i18n="@@accounting.bank-statement-entries.confirmer.les.lignes.08e40127">Confirmer les lignes</app-button>
          </div>
        </section>
      }
    }
  `,
  styles: [
    `
      .bse-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem; margin-bottom: 1.25rem; }
      .bse-strong { font-weight: 600; }
      .bse-hint { color: #6c757d; font-size: 0.85rem; }
      .bse-alert { padding: 0.6rem 0.9rem; border-radius: 6px; margin: 0.5rem 0; }
      .bse-alert--error { background: #f8d7da; color: #842029; }
      .bse-alert--ok { background: #e6f6ec; color: #1a7f4e; }
      .bse-progress-bar { height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; margin: 0.5rem 0; }
      .bse-progress-bar__fill { height: 100%; background: #0d6efd; transition: width 0.3s; }
      .bse-summary { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 0.75rem; margin: 0.5rem 0; }
      .bse-summary dt { color: #6c757d; }
      .bse-ack { display: flex; gap: 0.5rem; align-items: start; margin: 0.5rem 0; }
      .bse-issue-list { color: #664d03; list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
      .bse-issue { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
      .bse-issue--blocking { color: #842029; }
      .bse-issue--warning { color: #664d03; }
      .bse-issue--info { color: #495057; }
      .bse-retarget { background: #e7f1ff; border-radius: 6px; padding: 0.6rem 0.9rem; margin: 0.5rem 0; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
      .bse-siblings-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
      .bse-table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
      .bse-table th, .bse-table td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #e9ecef; text-align: start; }
      .bse-row--excluded { opacity: 0.6; text-decoration: line-through; }
      .bse-row--editing input, .bse-row--editing select { width: 100%; }
      .bse-row-actions { display: flex; gap: 0.25rem; white-space: nowrap; }
      .bse-badge { display: inline-block; margin-inline-start: 0.4rem; padding: 0.1rem 0.4rem; border-radius: 4px; background: #e7f1ff; color: #0d6efd; font-size: 0.75rem; }
      .bse-badge--muted { background: #e9ecef; color: #6c757d; }
      .bse-link-button { background: none; border: none; color: #0d6efd; cursor: pointer; padding: 0; font: inherit; }
      .bse-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
    `
  ]
})
export class BankStatementEntriesSessionComponent implements OnInit {
  protected readonly store = inject(BankStatementEntriesStore);
  private readonly api = inject(BankStatementImportService);
  private readonly accounting = inject(AccountingService);
  private readonly bankAccountsApi = inject(BankAccountService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirmation = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly logic = logic;
  protected readonly sessionFailureMessage = sessionFailureMessage;
  protected readonly issueTitle = issueTitle;
  protected readonly ribTail = logic.ribTail;

  protected readonly debitLabel = $localize`:@@accounting.bank-statement-entries.ts.debit.sess0010:Débit`;
  protected readonly creditLabel = $localize`:@@accounting.bank-statement-entries.ts.credit.sess0011:Crédit`;

  readonly session = signal<BankStatementImportSession | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  balanceAcknowledged = false;
  private pollAttempt = 0;

  /** Corrections par index de ligne (lecture d'origine inchangée ; seuls les champs modifiés sont renseignés). */
  readonly corrections = signal<Map<number, StatementLineCorrection>>(new Map());
  readonly editingIndex = signal<number | null>(null);
  draft: LineDraft = { lineIndex: -1, transactionDate: '', label: '', amount: null, isDebit: true, sideChosen: false };

  readonly bankAccounts = signal<BankAccountDto[]>([]);
  private readonly bankAccountsLoaded = signal(false);
  private readonly ribMatchReady = signal(false);

  readonly balanceMode = () => logic.computeBalanceMode(this.session());

  readonly displayLines = computed<DisplayLine[]>(() => {
    const lines = this.session()?.extraction?.lines ?? [];
    const corrections = this.corrections();
    return lines.map(line => {
      const c = corrections.get(line.index);
      return {
        ...line,
        transactionDate: c?.transactionDate ?? line.transactionDate,
        label: c?.label ?? line.label,
        amount: c?.amount ?? line.amount,
        isDebit: c?.isDebit ?? line.isDebit,
        corrected: !!c && this.hasFieldChange(c),
        excluded: c?.exclude === true
      };
    });
  });

  readonly correctedCount = computed(() => [...this.corrections().values()].filter(c => this.hasFieldChange(c) && !c.exclude).length);
  readonly excludedCount = computed(() => [...this.corrections().values()].filter(c => c.exclude === true).length);

  readonly aiUnavailableBlocking = computed(() => {
    const s = this.session();
    return !!s && s.status === 'AwaitingReview' && logic.hasIssue(s, 'statement.ai_unavailable', 'Blocking');
  });

  /**
   * Compte dont le RIB correspond exactement à celui lu sur le relevé, pour « Analyser avec ce
   * compte » (D3, relance ciblée). Jamais pour un relevé CSV/XLSX : il n'a pas de RIB imprimé et
   * le serveur refuse la relance (retarget) d'une session tabulaire.
   */
  readonly suggestedRetargetAccount = computed(() => {
    const s = this.session();
    const readRib = logic.normalizeRibDigits(s?.extraction?.header?.rib);
    if (!s || readRib.length !== 20) return null;
    if (!s.extraction?.issues.some(i => i.code === 'statement.rib_mismatch' && i.severity === 'Blocking')) return null;
    return this.bankAccounts().find(a => a.isActive && logic.normalizeRibDigits(a.rib) === readRib && a.id !== s.bankAccountId) ?? null;
  });

  readonly missingAccountRibTail = computed(() => {
    const s = this.session();
    if (!s?.extraction || !this.bankAccountsLoaded() || !this.ribMatchReady() || this.suggestedRetargetAccount()) return null;
    if (!s.extraction.issues.some(i => i.code === 'statement.rib_mismatch')) return null;
    const readRib = logic.normalizeRibDigits(s.extraction.header.rib);
    return readRib.length === 20 ? readRib.slice(-4) : null;
  });

  ngOnInit(): void {
    this.loadBankAccounts();
    const sessionId = this.route.snapshot.paramMap.get('sessionId');
    if (sessionId) this.loadSession(sessionId);
  }

  /** Comptes bancaires actifs avec RIB (pour la relance ciblée), ignorés pour un relevé CSV/XLSX. */
  private loadBankAccounts(): void {
    this.accounting.ensureBankGlProjections().pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.accounting.listImportableBankAccounts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: imported => {
          this.bankAccountsApi.list().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(payments => {
            const byId = new Map((payments?.data ?? []).map(a => [a.id, a] as const));
            this.ribMatchReady.set(payments != null);
            this.bankAccounts.set((imported?.data ?? []).filter(a => a.isActive).map(a => {
              const full = byId.get(a.id);
              return {
                id: a.id,
                companyId: full?.companyId ?? '',
                bankCode: full?.bankCode ?? '',
                bankName: a.bankName,
                designation: a.designation ?? full?.designation ?? null,
                agencyName: full?.agencyName ?? null,
                rib: full?.rib ?? '',
                iban: full?.iban ?? '',
                swiftBic: full?.swiftBic ?? null,
                isDefault: a.isDefault,
                isActive: a.isActive,
                chartOfAccountNumber: a.chartOfAccountNumber,
                currency: a.currency,
                hasBankingIdentity: a.hasBankingIdentity
              };
            }));
            this.bankAccountsLoaded.set(true);
          });
        },
        error: () => {
          this.bankAccounts.set([]);
          this.bankAccountsLoaded.set(true);
          this.ribMatchReady.set(false);
        }
      });
    });
  }

  private loadSession(id: string): void {
    this.api.session(id).subscribe({
      next: s => {
        this.session.set(s);
        this.error.set(null);
        this.balanceAcknowledged = false;
        this.corrections.set(new Map());
        this.editingIndex.set(null);
        this.schedulePollIfNeeded(id);
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  private schedulePollIfNeeded(sessionId: string): void {
    const s = this.session();
    if (!s) return;
    if (s.status === 'Extracting' || s.status === 'Pending') {
      this.schedulePoll(sessionId, 'full');
      return;
    }
    if ((s.siblings ?? []).some(x => x.status === 'Extracting' || x.status === 'Pending')) {
      this.schedulePoll(sessionId, 'siblings');
    } else {
      this.pollAttempt = 0;
    }
  }

  /** Interrogation avec temporisation croissante (2 s → 10 s), identique à l'écran de relecture. */
  private schedulePoll(id: string, mode: 'full' | 'siblings'): void {
    const delay = Math.min(10_000, 2_000 + this.pollAttempt++ * 1_000);
    timer(delay)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (mode === 'siblings') {
          // On ne récupère que l'évolution des relevés frères : la session courante, déjà en
          // relecture, ne doit pas être réécrasée pendant que l'utilisateur la corrige.
          this.api.session(id).subscribe({
            next: next => {
              const current = this.session();
              if (current?.id === id) {
                this.session.set({ ...current, siblings: next.siblings, segmentCount: next.segmentCount });
                this.schedulePollIfNeeded(id);
              }
            },
            error: (err: unknown) => this.fail(err)
          });
          return;
        }
        this.loadSession(id);
      });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.error.set(err instanceof BankStatementImportError ? err.message || 'Erreur' : 'Erreur');
  }

  canRetry(s: BankStatementImportSession): boolean {
    if (s.status === 'Failed') return !!s.errorCode && RETRYABLE_FAILURES.includes(s.errorCode);
    return this.aiUnavailableBlocking();
  }

  retry(): void {
    const s = this.session();
    if (!s || this.busy() || !this.canRetry(s)) return;
    this.busy.set(true);
    this.api.retry(s.id).subscribe({
      next: next => {
        this.busy.set(false);
        void this.router.navigate(['/accounting/bank-statement-entries/session', next.id], { replaceUrl: true });
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  cancelSession(): void {
    const s = this.session();
    if (!s) return;
    this.busy.set(true);
    this.api.cancel(s.id).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate(['/accounting/bank-statement-entries']);
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  /** Relance ciblée vers un autre compte bancaire (RIB suggéré) ; jamais appelée pour une session CSV/XLSX. */
  retargetToAccount(bankAccountId: string): void {
    const s = this.session();
    if (!s || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.retarget(s.id, bankAccountId).subscribe({
      next: next => {
        this.busy.set(false);
        void this.router.navigate(['/accounting/bank-statement-entries/session', next.id], { replaceUrl: true });
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  /** Un relevé CSV/XLSX n'a pas de RIB imprimé à comparer : le serveur refuse d'ailleurs sa relance. */
  isTabularSession(s: BankStatementImportSession): boolean {
    return s.extractionMethod === 'csv' || s.extractionMethod === 'xlsx';
  }

  // ── Correction des lignes ──────────────────────────────────────────────────────────────

  isEditable(line: ExtractedStatementLine): boolean {
    return line.source !== 'Layout';
  }

  isEditableIndex(lineIndex: number): boolean {
    const line = this.session()?.extraction?.lines.find(l => l.index === lineIndex);
    return !!line && this.isEditable(line);
  }

  /** Vrai si cette ligne porte un signalement dont la levée exige un sens explicite (débit/crédit). */
  sideRequired(lineIndex: number): boolean {
    return !!this.session()?.extraction?.issues.some(i => i.lineIndex === lineIndex && SIDE_REQUIRED_ISSUE_CODES.includes(i.code));
  }

  startLineEdit(line: DisplayLine): void {
    if (!this.isEditable(line) || line.excluded || this.busy()) return;
    this.draft = {
      lineIndex: line.index,
      transactionDate: (line.transactionDate ?? '').slice(0, 10),
      label: line.label ?? '',
      amount: line.amount,
      isDebit: line.isDebit,
      sideChosen: !this.sideRequired(line.index)
    };
    this.editingIndex.set(line.index);
  }

  cancelLineEdit(): void {
    this.editingIndex.set(null);
  }

  onSideChange(isDebit: boolean): void {
    this.draft.isDebit = isDebit;
    this.draft.sideChosen = true;
  }

  draftValid(): boolean {
    const d = this.draft;
    const amount = Number(d.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.transactionDate)) return false;
    if (!(d.label.trim().length > 0 && d.label.trim().length <= 200)) return false;
    if (!(Number.isFinite(amount) && amount > 0)) return false;
    if (this.sideRequired(d.lineIndex) && !d.sideChosen) return false;
    return true;
  }

  /** Transforme le brouillon en correction ne contenant que les champs qui diffèrent de la lecture. */
  saveLineEdit(line: DisplayLine): void {
    if (this.editingIndex() !== line.index || !this.draftValid()) return;
    const original = this.session()?.extraction?.lines.find(l => l.index === line.index);
    if (!original) return;
    const d = this.draft;
    const previous = this.corrections().get(line.index);
    const next: StatementLineCorrection = { lineIndex: line.index };
    if (d.transactionDate !== (original.transactionDate ?? '').slice(0, 10)) next.transactionDate = d.transactionDate;
    const amount = Math.round(Number(d.amount) * 1000) / 1000;
    if (amount !== original.amount) next.amount = amount;
    // Lignes à sens ambigu (tabular_both_sides / montant illisible) : le serveur n'efface le
    // signalement que si le sens est explicitement renseigné, même identique à la lecture.
    if (d.isDebit !== original.isDebit || this.sideRequired(line.index)) next.isDebit = d.isDebit;
    const label = d.label.trim();
    if (label !== original.label) next.label = label;
    if (previous?.exclude) next.exclude = true;
    this.corrections.update(map => {
      const copy = new Map(map);
      if (this.hasFieldChange(next) || next.exclude) copy.set(line.index, next);
      else copy.delete(line.index);
      return copy;
    });
    this.editingIndex.set(null);
  }

  toggleExclude(line: DisplayLine): void {
    if (!this.isEditable(line) || this.busy()) return;
    this.corrections.update(map => {
      const copy = new Map(map);
      const previous = copy.get(line.index);
      if (previous?.exclude) {
        const rest: StatementLineCorrection = { ...previous };
        delete rest.exclude;
        if (this.hasFieldChange(rest)) copy.set(line.index, rest);
        else copy.delete(line.index);
      } else {
        copy.set(line.index, { ...(previous ?? {}), lineIndex: line.index, exclude: true });
      }
      return copy;
    });
    if (this.editingIndex() === line.index) this.editingIndex.set(null);
  }

  /** Depuis un signalement « ligne à corriger » : ouvre directement la ligne en édition. */
  editLineFromIssue(lineIndex: number): void {
    const line = this.displayLines().find(l => l.index === lineIndex);
    if (!line || !this.isEditable(line) || line.excluded) return;
    this.startLineEdit(line);
  }

  private hasFieldChange(c: Partial<StatementLineCorrection>): boolean {
    return c.transactionDate !== undefined || c.amount !== undefined || c.isDebit !== undefined || c.label !== undefined;
  }

  // ── Relevés frères (fichier à plusieurs relevés) ───────────────────────────────────────

  siblingLink(sib: BankStatementImportSibling): string[] | null {
    if (sib.statementId) return ['/accounting/bank-statement-entries/statement', sib.statementId];
    if (sib.status === 'AwaitingReview' || sib.status === 'Extracting' || sib.status === 'Pending' || sib.status === 'Failed') {
      return ['/accounting/bank-statement-entries/session', sib.id];
    }
    return null;
  }

  siblingState(sib: BankStatementImportSibling): string {
    if (sib.statementId) return $localize`:@@accounting.bank-statement-entries.ts.releve.enregistre.sess0021:Relevé ${sib.segmentIndex}:index: — déjà enregistré`;
    switch (sib.status) {
      case 'Extracting':
      case 'Pending':
        return $localize`:@@accounting.bank-statement-entries.ts.releve.en.cours.de.lecture.sess0022:Relevé ${sib.segmentIndex}:index: — en cours de lecture`;
      case 'AwaitingReview':
        return $localize`:@@accounting.bank-statement-entries.ts.releve.en.attente.de.controle.sess0023:Relevé ${sib.segmentIndex}:index: — en attente de contrôle`;
      case 'Failed':
        return $localize`:@@accounting.bank-statement-entries.ts.releve.en.echec.sess0024:Relevé ${sib.segmentIndex}:index: — analyse en échec`;
      default:
        return $localize`:@@accounting.bank-statement-entries.ts.releve.annule.sess0025:Relevé ${sib.segmentIndex}:index: — annulé`;
    }
  }

  // ── Confirmation ────────────────────────────────────────────────────────────────────────

  confirmStatement(): void {
    const s = this.session();
    if (!s?.canConfirm || this.busy()) return;
    const corrections = [...this.corrections().values()];
    this.confirmation.confirm({
      message: $localize`:@@accounting.bank-statement-entries.ts.enregistrer.ce.releve.et.passer.aux.propositions.eb4f356b:Enregistrer ce relevé et passer aux propositions d'écritures ?`,
      accept: () => {
        this.busy.set(true);
        this.api.confirm(s.id, { corrections, acknowledgeBalanceWarning: this.balanceAcknowledged || undefined }).subscribe({
          next: result => {
            this.busy.set(false);
            void this.router.navigate(['/accounting/bank-statement-entries/statement', result.statementId], { replaceUrl: true });
          },
          error: (err: unknown) => this.fail(err)
        });
      }
    });
  }

  isDirty(): boolean {
    const s = this.session();
    return !!s && s.status === 'AwaitingReview' && (this.corrections().size > 0 || this.balanceAcknowledged);
  }

  canDeactivate(): boolean {
    if (!this.isDirty()) return true;
    return window.confirm(
      $localize`:@@accounting.bank-statement-entries.ts.vous.avez.des.corrections.non.enregistrees.quitt.18c5e8bc:Vous avez des corrections non enregistrées. Quitter cette page ? Les changements seront perdus.`
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  unloadNotification(event: BeforeUnloadEvent): void {
    if (this.isDirty()) {
      event.returnValue = $localize`:@@accounting.bank-statement-entries.ts.vous.avez.des.corrections.non.enregistrees.90e23137:Vous avez des corrections non enregistrées.`;
    }
  }
}
