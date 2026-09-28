import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, JournalEntryDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import {
  firstDayOfMonthLocalYmd,
  parseLocalDateString,
  todayLocalYmd,
  validateDateRange
} from '../shared/accounting-date-utils';
import { AccountingJournalTabsComponent } from '../shared/accounting-journal-tabs.component';
import {
  ACCOUNTING_SUB_JOURNALS,
  AccountingJournalTab,
  AccountingJournalTabChange
} from '../shared/accounting-journal-tabs.model';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

type JournalFlatRow = {
  date: string;
  journal: string;
  piece: number;
  label: string;
  account: string;
  debit: number;
  credit: number;
};

@Component({
  selector: 'app-sub-journals',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AnalyzeWithAiButtonComponent,
    AccountingJournalTabsComponent
  ],
  template: `
    <app-page-header title="Journaux auxiliaires" i18n-title="@@accounting.sub-journals.journaux.auxiliaires.a7120594" subtitle="Consultation par journal" i18n-subtitle="@@accounting.sub-journals.consultation.par.journal.47ac69a9" />

    <div class="card sub-journals-filters-card">
      <div class="sub-journals-toolbar">
        <div class="form-field sub-journals-field-date">
          <label class="field-label" for="sj-from" i18n="@@accounting.sub-journals.du.84814985">Du</label>
          <input
            id="sj-from"
            type="date"
            [(ngModel)]="fromStr"
            (ngModelChange)="onDatesChange()"
            class="sub-journals-date-input"
            [disabled]="loading()" />
        </div>
        <div class="form-field sub-journals-field-date">
          <label class="field-label" for="sj-to" i18n="@@accounting.sub-journals.au.7a1732d5">Au</label>
          <input
            id="sj-to"
            type="date"
            [(ngModel)]="toStr"
            (ngModelChange)="onDatesChange()"
            class="sub-journals-date-input"
            [disabled]="loading()" />
        </div>
        <div class="sub-journals-toolbar-actions">
          <app-analyze-with-ai-button
            screenId="accounting-sub-journals"
            [payloadBuilder]="buildSubJournalsAnalyzePayload"
            [disabled]="loading()" />
        </div>
      </div>
    </div>

    <app-accounting-journal-tabs
      [tabs]="tabs()"
      [activeIndex]="activeTabIndex"
      (tabChange)="onJournalTabChange($event)" />

    <div
      class="sub-journals-panel"
      role="tabpanel"
      [attr.id]="'sub-journal-panel-' + activeJournalCode"
      [attr.aria-labelledby]="'accounting-journal-tab-' + activeJournalCode">
      <div class="accounting-kpi-row" aria-label="Totaux du journal" i18n-aria-label="@@accounting.sub-journals.totaux.du.journal.e65826b3">
        <div class="accounting-kpi-item">
          <span class="accounting-kpi-label" i18n="@@accounting.sub-journals.total.debit.ea9c4853">Total débit</span>
          <span class="accounting-kpi-value">{{ tabTotals().debit | number : '1.3-3' }}</span>
        </div>
        <div class="accounting-kpi-item">
          <span class="accounting-kpi-label" i18n="@@accounting.sub-journals.total.credit.98c95962">Total crédit</span>
          <span class="accounting-kpi-value">{{ tabTotals().credit | number : '1.3-3' }}</span>
        </div>
      </div>

      <app-accounting-status-banner
        variant="error"
        [message]="error() ?? ''"
        [showRetry]="!!error()"
        retryLabel="Réessayer" i18n-retryLabel="@@accounting.sub-journals.reessayer.c4f78b12"
        (retry)="loadJournal(activeJournalCode)" />

      <p-table
        [value]="flatRows()"
        [paginator]="true"
        [rows]="20"
        [rowsPerPageOptions]="[20, 50, 100]"
        [loading]="loading()"
        [rowHover]="true"
        [showCurrentPageReport]="true"
        currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} lignes" i18n-currentPageReportTemplate="@@accounting.sub-journals.affichage.de.first.a.last.sur.totalrecords.ligne.3b382824"
        styleClass="p-datatable-sm sub-journals-table accounting-datatable">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" i18n="@@accounting.sub-journals.date.eb9a4bc1">Date</th>
            <th scope="col" i18n="@@accounting.sub-journals.journal.57d7f743">Journal</th>
            <th scope="col" class="sub-journals-col-narrow" i18n="@@accounting.sub-journals.n.754e6095">N°</th>
            <th scope="col" i18n="@@accounting.sub-journals.libelle.f5485bba">Libellé</th>
            <th scope="col" class="sub-journals-col-account" i18n="@@accounting.sub-journals.compte.c45740bb">Compte</th>
            <th scope="col" class="sub-journals-col-amount" i18n="@@accounting.sub-journals.debit.f528224f">Débit</th>
            <th scope="col" class="sub-journals-col-amount" i18n="@@accounting.sub-journals.credit.19194bdf">Crédit</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr>
            <td data-label="Date" i18n-data-label="@@accounting.sub-journals.date.eb9a4bc1">{{ r.date | date : 'shortDate' }}</td>
            <td data-label="Journal" i18n-data-label="@@accounting.sub-journals.journal.57d7f743">{{ r.journal }}</td>
            <td class="sub-journals-col-narrow sub-journals-cell-num" data-label="N°">{{ r.piece }}</td>
            <td data-label="Libellé" i18n-data-label="@@accounting.sub-journals.libelle.f5485bba">{{ r.label }}</td>
            <td class="sub-journals-col-account" data-label="Compte" i18n-data-label="@@accounting.sub-journals.compte.c45740bb">
              <span class="sub-journals-account-code">{{ r.account }}</span>
            </td>
            <td class="sub-journals-col-amount" data-label="Débit" i18n-data-label="@@accounting.sub-journals.debit.f528224f">{{ r.debit | number : '1.3-3' }}</td>
            <td class="sub-journals-col-amount" data-label="Crédit" i18n-data-label="@@accounting.sub-journals.credit.19194bdf">{{ r.credit | number : '1.3-3' }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="7" class="sub-journals-empty">
              <p class="sub-journals-empty-title" i18n="@@accounting.sub-journals.aucune.ecriture.c5660ccc">Aucune écriture</p>
              <p class="sub-journals-empty-hint" i18n="@@accounting.sub-journals.aucune.ecriture.trouvee.pour.le.journal.af67fd0a">
                Aucune écriture trouvée pour le journal {{ activeJournalCode }} sur la période sélectionnée.
              </p>
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    @use '../shared/accounting-layout';

    .sub-journals-filters-card {
      padding: var(--spacing-5);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.08));
      margin-bottom: var(--spacing-4);
    }
    .sub-journals-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--spacing-4);
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      min-width: 0;
    }
    .sub-journals-field-date { flex: 0 1 auto; }
    .sub-journals-toolbar-actions { display: flex; align-items: flex-end; padding-bottom: 2px; }
    .field-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0;
    }
    .sub-journals-date-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      min-height: 2.5rem;
    }
    .sub-journals-date-input:focus {
      outline: none;
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px var(--color-primary-200);
    }
    .sub-journals-date-input:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .sub-journals-panel {
      padding-top: var(--spacing-2);
    }
    .sub-journals-col-narrow { width: 1%; white-space: nowrap; }
    .sub-journals-col-account { width: 1%; white-space: nowrap; }
    .sub-journals-account-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-variant-numeric: tabular-nums;
      font-weight: var(--font-weight-medium);
    }
    .sub-journals-col-amount {
      text-align: end;
      font-variant-numeric: tabular-nums;
    }
    .sub-journals-cell-num {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }
    .sub-journals-empty {
      text-align: center;
      padding: var(--spacing-8) var(--spacing-4) !important;
      border: none !important;
    }
    .sub-journals-empty-title {
      margin: 0 0 var(--spacing-2);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }
    .sub-journals-empty-hint {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
    :host ::ng-deep .sub-journals-table .p-datatable-thead > tr > th {
      text-transform: uppercase;
      font-size: var(--font-size-xs);
      letter-spacing: 0.04em;
      color: var(--color-text-tertiary);
      background: var(--color-background-subtle);
    }
  `
})
export class SubJournalsComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly journalCatalog = inject(AccountingJournalCatalogService);

  /**
   * Onglets initialisés sur les 6 journaux standards puis étendus au catalogue : l'écran s'affiche
   * immédiatement à l'identique de l'existant, et les journaux personnalisés viennent s'y ajouter.
   */
  readonly tabs = signal<readonly AccountingJournalTab[]>(ACCOUNTING_SUB_JOURNALS);
  fromStr = '';
  toStr = '';
  activeTabIndex = 0;

  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly flatRows = signal<JournalFlatRow[]>([]);

  readonly tabTotals = computed(() => {
    let debit = 0;
    let credit = 0;
    for (const r of this.flatRows()) {
      debit += Number(r.debit);
      credit += Number(r.credit);
    }
    return { debit, credit };
  });

  get activeJournalCode(): string {
    return this.tabs()[this.activeTabIndex]?.code ?? 'JV';
  }

  readonly buildSubJournalsAnalyzePayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      'accounting-sub-journals',
      {
        screen: 'accounting-sub-journals',
        filters: {
          from: this.fromStr || null,
          to: this.toStr || null,
          activeJournal: this.tabs()[this.activeTabIndex]?.code ?? null,
          activeJournalLabel: this.tabs()[this.activeTabIndex]?.label ?? null
        },
        summary: {
          totalRows: this.flatRows().length,
          totalDebit: this.tabTotals().debit,
          totalCredit: this.tabTotals().credit
        },
        rows: this.flatRows().slice(0, 200).map(r => ({
          date: r.date,
          journal: r.journal,
          piece: r.piece,
          label: r.label,
          account: r.account,
          debit: r.debit,
          credit: r.credit
        }))
      } as Record<string, unknown>
    );

  ngOnInit(): void {
    this.fromStr = firstDayOfMonthLocalYmd();
    this.toStr = todayLocalYmd();
    // Le catalogue ne change pas l'onglet actif : il ne fait qu'étendre la liste, les journaux
    // standards restant en tête dans leur ordre historique.
    this.journalCatalog.list().subscribe(list => this.tabs.set(list));
    this.loadJournal(this.tabs()[0].code);
  }

  onJournalTabChange(event: AccountingJournalTabChange): void {
    if (event.index === this.activeTabIndex) {
      return;
    }
    this.activeTabIndex = event.index;
    this.loadJournal(event.code);
  }

  onDatesChange(): void {
    this.loadJournal(this.activeJournalCode);
  }

  loadJournal(journalCode: string): void {
    this.error.set(null);
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.loading.set(true);

    this.api.getJournal(journalCode, from, to).subscribe({
      next: res => {
        this.loading.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
          return;
        }
        this.flatRows.set(this.flatten(res.data));
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.sub-journals.ts.erreur.reseau.0683007f:Erreur réseau`));
      }
    });
  }

  private flatten(entries: JournalEntryDto[]): JournalFlatRow[] {
    const flat: JournalFlatRow[] = [];
    for (const e of entries) {
      for (const l of e.lines) {
        flat.push({
          date: e.entryDate,
          journal: e.journalCode,
          piece: e.entryNumber,
          label: l.label?.trim() ? l.label : e.label,
          account: l.accountNumber,
          debit: l.debit,
          credit: l.credit
        });
      }
    }
    return flat;
  }
}
