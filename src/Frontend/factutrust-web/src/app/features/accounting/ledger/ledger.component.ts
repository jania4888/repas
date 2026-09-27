import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { TableModule } from 'primeng/table';
import { ToolbarModule } from 'primeng/toolbar';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  AccountingService,
  BalanceRowDto,
  ChartOfAccountDto,
  GeneralLedgerDto,
  LedgerRowDto
} from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingToolbarActionsComponent } from '../shared/accounting-toolbar-actions.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import {
  buildScreenAnalysisPayloadV2,
  detectBasicAnomalies,
  sampleRowsSmart
} from '@features/ai-assistant/utils/ai-screen-payload.factory';
import {
  firstDayOfYearLocalYmd,
  parseLocalDateString,
  todayLocalYmd,
  validateDateRange
} from '../shared/accounting-date-utils';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { FUNCTIONAL_CURRENCY } from '../manual-entry/models/entry-form.model';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/** Éditions du grand livre : un compte, une plage de comptes, ou le récapitulatif par racine. */
type LedgerMode = 'single' | 'range' | 'recap';

@Component({
  selector: 'app-accounting-ledger',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ToolbarModule,
    ButtonComponent,
    AccountingToolbarActionsComponent,
    CardModule,
    ProgressSpinnerModule,
    AutoCompleteModule,
    PageHeaderComponent,
    EmptyStateComponent,
    AccountingStatusBannerComponent,
    AnalyzeWithAiButtonComponent,
    AccountingExportMenuComponent
  ],
  templateUrl: './ledger.component.html',
  styleUrl: './ledger.component.scss'
})
export class LedgerComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly route = inject(ActivatedRoute);
  account = '4111';
  fromStr = '';
  toStr = '';
  accountSuggestions: string[] = [];
  private allAccounts: ChartOfAccountDto[] = [];
  readonly rows = signal<LedgerRowDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly exporting = signal(false);

  /**
   * Édition demandée. `single` reste le mode d'ouverture : l'écran, son compte par défaut et le
   * drill-down depuis la balance se comportent exactement comme avant.
   */
  mode: LedgerMode = 'single';
  accountFrom = '';
  accountTo = '';
  includeUnmoved = false;
  recapLevel = 2;

  readonly generalLedger = signal<GeneralLedgerDto | null>(null);
  readonly recapRows = signal<BalanceRowDto[]>([]);

  readonly showEmpty = computed(
    () => this.rows().length === 0 && !this.loading() && !this.error()
  );

  /** Vrai quand l'édition courante a produit des données exportables. */
  readonly hasResults = computed(() => {
    switch (this.mode) {
      case 'range':
        return (this.generalLedger()?.accounts.length ?? 0) > 0;
      case 'recap':
        return this.recapRows().length > 0;
      default:
        return this.rows().length > 0;
    }
  });

  readonly functionalCurrency = FUNCTIONAL_CURRENCY;

  /** Filtre Devise : '' = toutes. Purement client, sur les lignes déjà chargées. */
  readonly currencyFilter = signal('');

  /** Devises réellement présentes dans le relevé, devise de tenue comprise. */
  readonly availableCurrencies = computed(() => {
    const codes = new Set(this.rows().map(r => r.currencyCode || FUNCTIONAL_CURRENCY));
    return [...codes].sort();
  });

  /**
   * La colonne Devise n'apparaît que si le compte porte au moins une opération en devise : un
   * dossier mono-devise conserve exactement les sept colonnes d'avant.
   */
  readonly hasForeignCurrency = computed(() =>
    this.rows().some(r => (r.currencyCode || FUNCTIONAL_CURRENCY) !== FUNCTIONAL_CURRENCY)
  );

  /**
   * Lignes affichées. Le solde progressif reste celui calculé par le serveur sur l'intégralité du
   * relevé : filtrer n'en recalcule pas un partiel, qui n'aurait aucun sens comptable.
   */
  readonly visibleRows = computed(() => {
    const filter = this.currencyFilter();
    if (!filter) return this.rows();
    return this.rows().filter(r => (r.currencyCode || FUNCTIONAL_CURRENCY) === filter);
  });

  readonly totals = computed(() => {
    let debit = 0, credit = 0;
    for (const r of this.visibleRows()) {
      debit += r.debit;
      credit += r.credit;
    }
    const lastRow = this.visibleRows().at(-1);
    return { debit, credit, balance: lastRow?.runningBalance ?? 0 };
  });

  constructor() {
    this.fromStr = firstDayOfYearLocalYmd();
    this.toStr = todayLocalYmd();
  }

  ngOnInit(): void {
    // Accept query parameters from balance drill-down
    const params = this.route.snapshot.queryParams;
    if (params['account']) this.account = params['account'];
    if (params['from']) this.fromStr = params['from'];
    if (params['to']) this.toStr = params['to'];

    this.api.getChartOfAccounts().subscribe({
      next: res => {
        if (res.success && res.data) this.allAccounts = res.data;
      }
    });
    this.load();
  }

  readonly buildLedgerAnalyzePayload = (): unknown => {
    const allRows = this.rows();
    const totals = this.totals();
    const { rows, sampling } = sampleRowsSmart(
      allRows,
      200,
      'anomaly-first',
      r => Math.max(r.debit, r.credit)
    );
    const imbalance = Math.abs(totals.debit - totals.credit);
    const avgAmount =
      allRows.length > 0
        ? allRows.reduce((s, r) => s + Math.max(r.debit, r.credit), 0) / allRows.length
        : 0;
    const threshold = Math.max(avgAmount * 3, 1000);

    return buildScreenAnalysisPayloadV2({
      screenId: 'accounting-ledger',
      filters: {
        account: this.account || null,
        from: this.fromStr || null,
        to: this.toStr || null
      },
      summary: {
        totalRows: allRows.length,
        totalDebit: totals.debit,
        totalCredit: totals.credit,
        finalBalance: totals.balance,
        debitCreditGap: imbalance
      },
      highlights: [
        ...(imbalance > 0.001
          ? [{ type: 'warning' as const, label: $localize`:@@accounting.ledger.ts.ecart.debit.credit.c4e76936:Écart débit/crédit`, value: imbalance, context: 'Vérifier l\'équilibre' }]
          : []),
        ...detectBasicAnomalies(
          rows.map(r => ({ label: r.label, debit: r.debit, credit: r.credit })),
          threshold
        )
      ],
      rows: rows.map(r => ({
        entryDate: r.entryDate,
        journalCode: r.journalCode,
        pieceNumber: r.pieceNumber,
        label: r.label,
        debit: r.debit,
        credit: r.credit,
        runningBalance: r.runningBalance
      })),
      sampling,
      dataQuality: {
        hasData: allRows.length > 0,
        isPartial: sampling.truncated,
        warnings: sampling.truncated ? [`Échantillon de ${sampling.included} lignes sur ${sampling.totalAvailable}`] : []
      }
    });
  };

  filterAccounts(event: { query: string }): void {
    const q = event.query.toLowerCase();
    this.accountSuggestions = this.allAccounts
      .filter(a => a.accountNumber.toLowerCase().includes(q) || a.label.toLowerCase().includes(q))
      .map(a => a.accountNumber)
      .slice(0, 20);
  }

  /** Change d'édition : on repart d'un état propre, sans conserver le résultat du mode précédent. */
  onModeChange(): void {
    this.error.set(null);
    this.rows.set([]);
    this.generalLedger.set(null);
    this.recapRows.set([]);
    this.load();
  }

  load(): void {
    if (this.mode === 'range') {
      this.loadGeneralLedger();
      return;
    }
    if (this.mode === 'recap') {
      this.loadRecap();
      return;
    }

    if (!this.account.trim()) {
      this.loading.set(false);
      this.rows.set([]);
      this.error.set($localize`:@@accounting.ledger.ts.saisissez.un.numero.de.compte.pour.affic.a85beef0:Saisissez un numéro de compte pour afficher le grand livre.`);
      return;
    }
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.loading.set(false);
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    this.api
      .getLedger(this.account.trim(), from, to)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            this.rows.set(res.data);
            this.error.set(null);
          } else {
            this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
          }
        },
        error: err => this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.ledger.ts.erreur.reseau.0683007f:Erreur réseau`))
      });
  }

  private loadGeneralLedger(): void {
    const range = this.resolvePeriod();
    if (!range) return;

    this.error.set(null);
    this.loading.set(true);
    this.api
      .getGeneralLedger(range.from, range.to, this.accountFrom.trim() || undefined, this.accountTo.trim() || undefined, this.includeUnmoved)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: res => {
          if (res.success && res.data) this.generalLedger.set(res.data);
          else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        },
        error: err => this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.ledger.ts.erreur.reseau.0683007f:Erreur réseau`))
      });
  }

  private loadRecap(): void {
    const range = this.resolvePeriod();
    if (!range) return;

    this.error.set(null);
    this.loading.set(true);
    this.api
      .getLedgerRecap(range.from, range.to, this.recapLevel)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: res => {
          if (res.success && res.data) this.recapRows.set(res.data);
          else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        },
        error: err => this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.ledger.ts.erreur.reseau.0683007f:Erreur réseau`))
      });
  }

  /** Période validée, ou null après publication du message d'erreur. */
  private resolvePeriod(): { from: Date; to: Date } | null {
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.loading.set(false);
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return null;
    }
    return { from, to };
  }

  onExport(format: AccountingExportFormat): void {
    if (this.mode === 'range') {
      this.exportGeneralLedger(format);
      return;
    }
    if (this.mode === 'recap') {
      this.exportRecap(format);
      return;
    }

    const account = this.account.trim();
    if (!account) {
      this.error.set($localize`:@@accounting.ledger.ts.saisissez.un.numero.de.compte.avant.d.ex.0325b027:Saisissez un numéro de compte avant d'exporter.`);
      return;
    }
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.exporting.set(true);
    this.api.exportLedger(account, from, to, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        downloadBlob(blob, `grand_livre_${account}_${this.fromStr}_${this.toStr}.${exportExtension(format)}`);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.ledger.ts.erreur.lors.de.l.export.cd90f787:Erreur lors de l'export.`));
      }
    });
  }

  private exportGeneralLedger(format: AccountingExportFormat): void {
    const range = this.resolvePeriod();
    if (!range) return;

    this.exporting.set(true);
    this.api
      .exportGeneralLedger(
        range.from,
        range.to,
        this.accountFrom.trim() || undefined,
        this.accountTo.trim() || undefined,
        this.includeUnmoved,
        format
      )
      .subscribe({
        next: blob => {
          this.exporting.set(false);
          downloadBlob(blob, `grand_livre_general_${this.fromStr}_${this.toStr}.${exportExtension(format)}`);
        },
        error: err => {
          this.exporting.set(false);
          this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.ledger.ts.erreur.lors.de.l.export.cd90f787:Erreur lors de l'export.`));
        }
      });
  }

  private exportRecap(format: AccountingExportFormat): void {
    const range = this.resolvePeriod();
    if (!range) return;

    this.exporting.set(true);
    this.api.exportLedgerRecap(range.from, range.to, this.recapLevel, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        downloadBlob(
          blob,
          `recap_grand_livre_n${this.recapLevel}_${this.fromStr}_${this.toStr}.${exportExtension(format)}`
        );
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.ledger.ts.erreur.lors.de.l.export.cd90f787:Erreur lors de l'export.`));
      }
    });
  }
}
