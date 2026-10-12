/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { HttpErrorResponse } from '@angular/common/http';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { ToolbarModule } from 'primeng/toolbar';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  AccountingService,
  JournalEntryDto,
  JournalEntryLineDto,
  ChartOfAccountDto
} from '../services/accounting.service';
import {
  firstDayOfYearLocalYmd,
  parseLocalDateString,
  todayLocalYmd,
  validateDateRange
} from '../shared/accounting-date-utils';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { AccountingToolbarActionsComponent } from '../shared/accounting-toolbar-actions.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { FUNCTIONAL_CURRENCY } from '../manual-entry/models/entry-form.model';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Codes stables du lettrage (plan de refonte §4.6). Toutes les routes letter/complete/unletter/
 * settle répondent par un statut HTTP non-2xx sur échec (409/404/400) : Angular livre donc ces
 * échecs via le callback `error` de l'Observable, jamais via `next` avec `success:false`.
 */
const LETTERING_PERIOD_LOCKED_CODE = 'LETTERING_PERIOD_LOCKED';
const LETTERING_ALREADY_LETTERED_CODE = 'LETTERING_ALREADY_LETTERED';

interface LetteringLine {
  lineId: string;
  entryDate: string;
  journalCode: string;
  entryNumber: number;
  accountNumber: string;
  label: string;
  /** Montant au débit en devise de tenue. */
  debit: number;
  /** Montant au crédit en devise de tenue. */
  credit: number;
  /** Devise de l'opération, portée par l'écriture. */
  currency: string;
  /** Montants dans la devise de l'opération. 0 en mono-devise. */
  debitInCurrency: number;
  creditInCurrency: number;
  letteringCode?: string | null;
}

@Component({
  selector: 'app-lettering',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    ToolbarModule,
    CardModule,
    ProgressSpinnerModule,
    AutoCompleteModule,
    CheckboxModule,
    TagModule,
    PageHeaderComponent,
    EmptyStateComponent,
    AnalyzeWithAiButtonComponent,
    AccountingToolbarActionsComponent,
    ButtonComponent,
    AccountingCorrectionBannerComponent
  ],
  templateUrl: './lettering.component.html',
  styleUrl: './lettering.component.scss'
})
export class LetteringComponent implements OnInit {
  protected loc_charger_les_ecritures_du_compte_acco_592654(p0: unknown): string {
    return $localize`:@@accounting.lettering.tpl.charger.les.ecritures.du.compte.account.5926549d:Charger les écritures du compte ${p0}:account:`;
  }
  protected readonly loc_lettrer_la_selection_826ebb = $localize`:@@accounting.lettering.tpl.lettrer.la.selection.826ebb34:Lettrer la sélection`;
  protected readonly loc_selection_non_equilibree_cochez_lett_b9e132 = $localize`:@@accounting.lettering.tpl.selection.non.equilibree.cochez.lettrage.b9e1322b:Sélection non équilibrée – cochez lettrage partiel ou équilibrez la sélection`;
  protected loc_lettrer_les_count_lignes_selectionne_2f8a67(p0: unknown): string {
    return $localize`:@@accounting.lettering.tpl.lettrer.les.count.lignes.selectionnees.2f8a674c:Lettrer les ${p0}:count: lignes sélectionnées`;
  }
  protected readonly loc_lettrage_cfcdd3 = $localize`:@@accounting.lettering.tpl.lettrage.cfcdd333:Lettrage`;
  protected readonly loc_lettrage_partiel_fc201a = $localize`:@@accounting.lettering.tpl.lettrage.partiel.fc201a43:Lettrage partiel`;
  protected loc_delettrer_le_groupe_letteringcode_0aecd2(p0: unknown): string {
    return $localize`:@@accounting.lettering.tpl.delettrer.le.groupe.letteringcode.0aecd2b5:Délettrer le groupe ${p0}:letteringCode:`;
  }
  protected readonly loc_completer_le_lettrage_a1b2c3 = $localize`:@@accounting.lettering.tpl.completer.le.lettrage.a1b2c3d4:Compléter le lettrage`;
  protected loc_completer_le_lettrage_code_c0d1e2(p0: unknown): string {
    return $localize`:@@accounting.lettering.tpl.completer.le.lettrage.code.c0d1e2f3:Compléter le lettrage ${p0}:code:`;
  }
  protected readonly loc_retirez_les_lignes_deja_lettrees_b1c2d3 = $localize`:@@accounting.lettering.ts.retirez.les.lignes.deja.lettrees.b1c2d3e4:Retirez les lignes déjà lettrées définitivement (code « L ») de la sélection.`;
  protected readonly loc_un_seul_groupe_partiel_c2d3e4 = $localize`:@@accounting.lettering.ts.selectionnez.un.seul.groupe.partiel.c2d3e4f5:Sélectionnez les lignes d'un seul groupe partiel (« P ») à la fois pour le compléter.`;
  protected readonly loc_ajoutez_une_ligne_non_lettree_d3e4f5 = $localize`:@@accounting.lettering.ts.ajoutez.au.moins.une.ligne.non.lettree.d3e4f5a6:Ajoutez au moins une ligne non lettrée à la sélection pour compléter ce groupe.`;
  protected readonly loc_droit_insuffisant_e4f5a6 = $localize`:@@accounting.lettering.ts.droit.insuffisant.e4f5a6b7:Droit insuffisant pour effectuer cette action.`;
  protected readonly loc_periode_ou_exercice_cloture_f5a6b7 = $localize`:@@accounting.lettering.ts.periode.ou.exercice.cloture.f5a6b7c8:Action impossible : une des écritures sélectionnées appartient à une période ou un exercice clôturé.`;

  protected letterSelectedAriaLabel(): string {
    return this.canLetter()
      ? this.loc_lettrer_les_count_lignes_selectionne_2f8a67(this.selectionSummary().count)
      : this.loc_selection_non_equilibree_cochez_lett_b9e132;
  }

  protected completeSelectedAriaLabel(): string {
    const code = this.selectedPartialCode();
    if (this.canComplete() && code) return this.loc_completer_le_lettrage_code_c0d1e2(code);
    return this.completionBlockedReason() ?? this.loc_completer_le_lettrage_a1b2c3;
  }

  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly auth = inject(AuthService);
  account = '';
  fromStr = '';
  toStr = '';
  accountHint = '';
  unletteredOnly = false;
  accountSuggestions: string[] = [];
  private allAccounts: ChartOfAccountDto[] = [];

  readonly lines = signal<LetteringLine[]>([]);
  readonly selectedLines = signal<LetteringLine[]>([]);
  readonly loading = signal(false);
  readonly lettering = signal(false);
  readonly error = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  /** Code du groupe en cours de délettrage (désactive son bouton). */
  readonly unlettering = signal<string | null>(null);
  /** Lettrage partiel demandé explicitement (sélection non équilibrée). */
  allowPartial = false;

  readonly showEmpty = computed(
    () => this.lines().length === 0 && !this.loading() && !this.error()
  );

  readonly selectionSummary = computed(() => {
    const sel = this.selectedLines();
    let debit = 0;
    let credit = 0;
    let debitCurrency = 0;
    let creditCurrency = 0;
    for (const l of sel) {
      debit += l.debit;
      credit += l.credit;
      debitCurrency += l.debitInCurrency;
      creditCurrency += l.creditInCurrency;
    }

    // Une sélection mono-devise mélangeant des devises n'a pas de sens : le serveur la refusera,
    // l'écran doit le refléter avant l'appel.
    const currencies = new Set(sel.map(l => l.currency));
    const currency = currencies.size === 1 ? [...currencies][0] : null;
    const foreign = currency !== null && currency !== FUNCTIONAL_CURRENCY;

    const gap = Math.round((debit - credit) * 1000) / 1000;
    const currencyGap = Math.round((debitCurrency - creditCurrency) * 1000) / 1000;

    // L'équilibre s'apprécie sur la devise de l'opération : deux règlements de 1 000 EUR à des
    // taux différents soldent le compte en euros, sans le solder en dinars.
    const balanced = sel.length >= 2 && (foreign ? currencyGap === 0 : gap === 0);

    return {
      count: sel.length,
      debit,
      credit,
      gap,
      balanced,
      currency,
      foreign,
      debitCurrency,
      creditCurrency,
      currencyGap,
      /** Soldé en devise mais pas en dinars : c'est un écart de change, apurable. */
      hasExchangeDifference: foreign && sel.length >= 2 && currencyGap === 0 && gap !== 0
    };
  });

  constructor() {
    this.fromStr = firstDayOfYearLocalYmd();
    this.toStr = todayLocalYmd();
  }

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const accountParam = qp.get('account');
    const fromParam = qp.get('from');
    const toParam = qp.get('to');
    if (accountParam) this.account = accountParam;
    if (fromParam) this.fromStr = fromParam;
    if (toParam) this.toStr = toParam;
    this.unletteredOnly = qp.get('unletteredOnly') === '1';
    this.accountHint = qp.get('accountHint') ?? '';

    this.api.getChartOfAccounts().subscribe({
      next: res => {
        if (res.success && res.data) this.allAccounts = res.data;
      }
    });

    if (qp.get('autoLoad') === '1' && this.account.trim()) {
      this.load();
    }
  }

  readonly buildLetteringAnalyzePayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      'accounting-lettering',
      {
        screen: 'accounting-lettering',
        filters: {
          account: this.account || null,
          from: this.fromStr || null,
          to: this.toStr || null
        },
        summary: {
          totalLines: this.lines().length,
          selectedCount: this.selectedLines().length,
          selectionBalanced: this.selectionSummary().balanced
        },
        lines: this.lines().slice(0, 200).map(l => ({
          entryDate: l.entryDate,
          label: l.label,
          debit: l.debit,
          credit: l.credit,
          letteringCode: l.letteringCode ?? null
        }))
      } as Record<string, unknown>,
      { rowsKey: 'lines' }
    );

  filterAccounts(event: { query: string }): void {
    const q = event.query.toLowerCase();
    this.accountSuggestions = this.allAccounts
      .filter(a => a.accountNumber.toLowerCase().includes(q) || a.label.toLowerCase().includes(q))
      .map(a => a.accountNumber)
      .slice(0, 20);
  }

  load(): void {
    const acct = this.account.trim();
    if (!acct) {
      this.error.set($localize`:@@accounting.lettering.ts.veuillez.saisir.un.numero.de.compte.7beae1c2:Veuillez saisir un numéro de compte.`);
      return;
    }
    this.error.set(null);
    this.successMessage.set(null);
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.loading.set(true);
    this.selectedLines.set([]);

    this.api
      .getJournal(undefined, from, to)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            let result = this.extractLinesForAccount(res.data, acct);
            if (this.unletteredOnly) {
              result = result.filter(l => !l.letteringCode);
            }
            this.lines.set(result);
          } else {
            this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.du.chargement.des.ecritures.872dad:Erreur lors du chargement des écritures.`);
          }
        },
        error: err => this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.lettering.ts.erreur.reseau.verifiez.votre.connexion.39472e00:Erreur réseau. Vérifiez votre connexion.`))
      });
  }

  onSelectionChange(selected: LetteringLine[]): void {
    this.selectedLines.set(selected);
    this.successMessage.set(null);
  }

  /**
   * Lettrage possible : ≥ 2 lignes, équilibrées OU partiel explicitement coché. Désactivé dès que
   * la sélection contient une ligne « P » : dans ce cas, c'est le bouton « Compléter » (ci-dessous)
   * qui gère l'action, pour forcer l'appel au bon endpoint (`.../groups/{code}/complete`).
   */
  canLetter(): boolean {
    if (this.isCompletionSelection()) return false;
    const s = this.selectionSummary();
    return s.count >= 2 && (s.balanced || this.allowPartial);
  }

  /** Codes de groupes partiels (préfixe « P ») présents dans la sélection actuelle. */
  readonly selectedPartialCodes = computed<ReadonlySet<string>>(() => {
    const codes = new Set<string>();
    for (const l of this.selectedLines()) {
      if (this.isPartialCode(l.letteringCode)) codes.add(l.letteringCode as string);
    }
    return codes;
  });

  /** Un seul code « P » dans la sélection — pour l'affichage du bouton, même si l'action n'est
   * pas encore valide (cf. {@link completionBlockedReason}). `null` si 0 ou ≥ 2 groupes. */
  readonly selectedPartialCode = computed<string | null>(() => {
    const codes = this.selectedPartialCodes();
    return codes.size === 1 ? [...codes][0] : null;
  });

  /** Lignes déjà lettrées DÉFINITIVEMENT (code « L ») glissées dans la sélection : ne devrait pas
   * arriver via l'UI (`isSelectableRow` les exclut déjà), mais reste défensif. */
  readonly selectedFullyLetteredCount = computed(() =>
    this.selectedLines().filter(l => this.isLettered(l) && !this.isPartialCode(l.letteringCode)).length
  );

  readonly selectedUnletteredCount = computed(() =>
    this.selectedLines().filter(l => !this.isLettered(l)).length
  );

  /** La sélection contient au moins une ligne « P » : le bouton principal devient « Compléter ». */
  readonly isCompletionSelection = computed(() => this.selectedPartialCodes().size > 0);

  /**
   * Code du groupe partiel à compléter si la sélection s'y prête exactement : un seul groupe
   * « P » et au moins une ligne non lettrée ajoutée. `null` sinon (bouton désactivé).
   */
  readonly completionCode = computed<string | null>(() => {
    if (this.selectedFullyLetteredCount() > 0) return null;
    if (this.selectedUnletteredCount() < 1) return null;
    return this.selectedPartialCode();
  });

  canComplete(): boolean {
    return this.completionCode() !== null;
  }

  /** Explication affichée quand le bouton « Compléter » est désactivé. `null` si activable. */
  readonly completionBlockedReason = computed<string | null>(() => {
    const codes = this.selectedPartialCodes();
    if (codes.size === 0) return null;
    if (this.selectedFullyLetteredCount() > 0) return this.loc_retirez_les_lignes_deja_lettrees_b1c2d3;
    if (codes.size >= 2) return this.loc_un_seul_groupe_partiel_c2d3e4;
    if (this.selectedUnletteredCount() < 1) return this.loc_ajoutez_une_ligne_non_lettree_d3e4f5;
    return null;
  });

  readonly functionalCurrency = FUNCTIONAL_CURRENCY;

  /** La colonne Devise n'apparaît que si le compte porte au moins une opération en devise. */
  readonly hasForeignLines = computed(() =>
    this.lines().some(l => l.currency !== FUNCTIONAL_CURRENCY)
  );

  /** Modale d'équilibrage : compte d'imputation saisi à chaque fois, sans défaut persisté. */
  readonly settleOpen = signal(false);
  readonly settling = signal(false);
  settleAccount = '';

  openSettle(): void {
    if (!this.selectionSummary().hasExchangeDifference) return;
    this.settleAccount = '';
    this.settleOpen.set(true);
  }

  closeSettle(): void {
    this.settleOpen.set(false);
  }

  /**
   * Apure l'écart de change puis lettre l'ensemble, en une seule opération serveur. Le compte
   * saisi est revalidé côté serveur (existence, activité, classe autorisée) : l'écran ne fait que
   * le transmettre.
   */
  settleExchangeDifference(): void {
    const account = this.settleAccount.trim();
    if (!account || this.settling()) return;

    const ids = this.selectedLines().map(l => l.lineId);
    this.settling.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.api
      .settleExchangeDifference(ids, account)
      .pipe(finalize(() => this.settling.set(false)))
      .subscribe({
        next: res => {
          if (res.success) {
            this.successMessage.set(
              $localize`:@@accounting.lettering.ts.ecart.de.change.apure.sur.le.compte.acco.662b4773:Écart de change apuré sur le compte ${account}:account:, puis lettrage effectué.`);
            this.settleOpen.set(false);
            this.selectedLines.set([]);
            this.load();
          } else {
            this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.l.equilibrage.564a12:Erreur lors de l'équilibrage.`);
          }
        },
        error: err => this.handleLetteringError(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.de.l.equilibrage.86743867:Erreur réseau lors de l'équilibrage.`)
      });
  }

  letterSelected(): void {
    if (!this.canLetter()) return;
    const ids = this.selectedLines().map(l => l.lineId);
    const partial = !this.selectionSummary().balanced && this.allowPartial;

    this.lettering.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.api
      .letterEntries(ids, partial)
      .pipe(finalize(() => this.lettering.set(false)))
      .subscribe({
        next: res => {
          if (res.success) {
            this.successMessage.set(partial
              ? $localize`:@@ui.tern.lettrage.partiel.effectue.sur.ph.lignes.co.2ed8b4:Lettrage partiel effectué sur ${ids.length}:p0: lignes (code « P »).`
              : $localize`:@@ui.tern.lettrage.effectue.avec.succes.sur.ph.ligne.e8c8c6:Lettrage effectué avec succès sur ${ids.length}:p0: lignes.`);
            this.selectedLines.set([]);
            this.allowPartial = false;
            this.load();
          } else {
            this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.du.lettrage.8e822f:Erreur lors du lettrage.`);
          }
        },
        error: err => this.handleLetteringError(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.du.lettrage.1358d80e:Erreur réseau lors du lettrage.`)
      });
  }

  /**
   * Complète un lettrage partiel « P » (D7) : envoie UNIQUEMENT les lignes non lettrées ajoutées
   * à la sélection — les autres membres du groupe (déjà lettrés en « P ») sont connus du serveur
   * via le code, pas renvoyés. Le serveur recalcule l'équilibre sur l'ensemble du groupe ; l'écran
   * n'a pas besoin de voir les membres du groupe absents de la page courante.
   */
  completeSelected(): void {
    const code = this.completionCode();
    if (!code || this.lettering()) return;
    const ids = this.selectedLines().filter(l => !this.isLettered(l)).map(l => l.lineId);
    if (ids.length === 0) return;

    this.lettering.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.api
      .completePartialLettering(code, ids, this.allowPartial)
      .pipe(finalize(() => this.lettering.set(false)))
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            const result = res.data;
            this.successMessage.set(result.isPartial
              ? $localize`:@@accounting.lettering.ts.lettrage.partiel.code.complete.reste.partiel.a6b7c8d9:Lettrage partiel ${result.code}:code: complété (reste partiel).`
              : $localize`:@@accounting.lettering.ts.lettrage.code.finalise.b7c8d9e0:Lettrage ${result.code}:code: finalisé.`);
            this.selectedLines.set([]);
            this.allowPartial = false;
            this.load();
          } else {
            this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.completion.du.lettrage.c8d9e0f1:Erreur lors de la complétion du lettrage.`);
          }
        },
        error: err => this.handleLetteringError(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.de.la.completion.du.lettrage.d9e0f1a2:Erreur réseau lors de la complétion du lettrage.`)
      });
  }

  /** Délettrage d'un groupe : libère toutes ses lignes (un partiel se complète ainsi). */
  unletter(code: string): void {
    if (!code) return;
    this.confirmationService.confirm({
      message: $localize`:@@accounting.lettering.ts.delettrer.le.groupe.code.toutes.ses.lign.aa9895a9:Délettrer le groupe ${code}:code: ? Toutes ses lignes redeviendront lettrables.`,
      header: $localize`:@@accounting.lettering.ts.confirmation.de.delettrage.db4ca457:Confirmation de délettrage`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@lettering.component.acceptLabel.Délettrer:Délettrer`,
      rejectLabel: $localize`:@@lettering.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.unlettering.set(code);
        this.error.set(null);
        this.successMessage.set(null);

        this.api
          .unletterEntries(code)
          .pipe(finalize(() => this.unlettering.set(null)))
          .subscribe({
            next: res => {
              if (res.success) {
                this.successMessage.set($localize`:@@accounting.lettering.ts.groupe.code.delettre.7a5b5fd3:Groupe ${code}:code: délettré.`);
                this.selectedLines.set([]);
                this.load();
              } else {
                this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.du.delettrage.a7b9e5:Erreur lors du délettrage.`);
              }
            },
            error: err => this.handleLetteringError(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.du.delettrage.ae259626:Erreur réseau lors du délettrage.`)
          });
      }
    });
  }

  /**
   * Gère l'échec HTTP des 4 actions de lettrage (letter/complete/unletter/settle), toutes
   * mappées sur un statut non-2xx (plan §4.6) :
   * - 403 (policy d'autorisation refusée) → message fixe « Droit insuffisant », pas de rechargement.
   * - `LETTERING_PERIOD_LOCKED` → message traduit clair, sélection conservée, pas de rechargement.
   * - `LETTERING_ALREADY_LETTERED` → message serveur + rechargement (l'état a changé entre-temps).
   * - autres codes → message serveur, comportement inchangé (pas de rechargement).
   */
  private handleLetteringError(err: unknown, networkFallback: string): void {
    const status = (err as HttpErrorResponse)?.status;
    if (status === 403) {
      this.error.set(this.loc_droit_insuffisant_e4f5a6);
      return;
    }
    const code = this.errors.getApiErrorCode(err);
    if (code === LETTERING_PERIOD_LOCKED_CODE) {
      this.error.set(this.loc_periode_ou_exercice_cloture_f5a6b7);
      return;
    }
    if (code === LETTERING_ALREADY_LETTERED_CODE) {
      this.error.set(this.errors.extractErrorMessage(err, networkFallback));
      this.selectedLines.set([]);
      this.load();
      return;
    }
    this.error.set(this.errors.extractErrorMessage(err, networkFallback));
  }

  isLettered(line: LetteringLine): boolean {
    return !!line.letteringCode;
  }

  /**
   * Sélectionnable : ligne non lettrée, OU lettrée partiellement (code « P », D7 — on peut encore
   * y ajouter des lignes pour la compléter). Les lignes lettrées DÉFINITIVEMENT (code « L »)
   * restent exclues.
   */
  isRowSelectable(line: LetteringLine): boolean {
    return !this.isLettered(line) || this.isPartialCode(line.letteringCode);
  }

  /**
   * Donnée pour `[rowSelectable]` du `p-table` : sans cette fonction, la case « tout sélectionner »
   * de l'en-tête (`p-tableHeaderCheckbox`) sélectionne TOUTES les lignes, y compris celles déjà
   * lettrées, en contradiction avec la case de ligne (`[disabled]="!isRowSelectable(line)"`) —
   * elle doit respecter exactement la même règle.
   */
  isSelectableRow = (event: { data: LetteringLine }): boolean => this.isRowSelectable(event.data);

  /**
   * Droit requis pour délettrer (plan de refonte, D6) : `accounting:unletter`, distinct de
   * `accounting:create` utilisé jusqu'ici. Affichage seulement — le serveur revérifie la policy
   * `AccountingUnletter` à l'action, et refuse en outre toujours en période clôturée.
   */
  canUnletter(): boolean {
    return this.auth.hasPermission(PERMISSIONS.accounting.unletter);
  }

  /** Code de lettrage partiel (préfixe « P ») vs définitif (« L »). */
  isPartialCode(code: string | null | undefined): boolean {
    return !!code && code.startsWith('P');
  }

  private extractLinesForAccount(entries: JournalEntryDto[], accountNumber: string): LetteringLine[] {
    const result: LetteringLine[] = [];
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.accountNumber === accountNumber) {
          result.push({
            lineId: line.id,
            entryDate: entry.entryDate,
            journalCode: entry.journalCode,
            entryNumber: entry.entryNumber,
            accountNumber: line.accountNumber,
            label: line.label || entry.label,
            debit: line.debit,
            credit: line.credit,
            currency: entry.currencyCode ?? FUNCTIONAL_CURRENCY,
            debitInCurrency: line.debitInCurrency ?? 0,
            creditInCurrency: line.creditInCurrency ?? 0,
            letteringCode: line.letteringCode ?? null
          });
        }
      }
    }
    result.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    return result;
  }
}
