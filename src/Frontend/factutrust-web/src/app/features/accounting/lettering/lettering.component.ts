/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs/operators';
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
import { FUNCTIONAL_CURRENCY } from '../manual-entry/models/entry-form.model';
import { ErrorHandlerService } from '@core/services/error-handler.service';

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
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);

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

  /** Lettrage possible : ≥ 2 lignes, équilibrées OU partiel explicitement coché. */
  canLetter(): boolean {
    const s = this.selectionSummary();
    return s.count >= 2 && (s.balanced || this.allowPartial);
  }

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
        error: err => this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.de.l.equilibrage.86743867:Erreur réseau lors de l'équilibrage.`))
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
        error: err => this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.du.lettrage.1358d80e:Erreur réseau lors du lettrage.`))
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
            error: err => this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.du.delettrage.ae259626:Erreur réseau lors du délettrage.`))
          });
      }
    });
  }

  isLettered(line: LetteringLine): boolean {
    return !!line.letteringCode;
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
