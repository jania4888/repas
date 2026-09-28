import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  AccountingService,
  JournalSummaryCellDto,
  JournalSummaryDto,
  JournalSummaryGrouping,
  JOURNAL_SUMMARY_ACCOUNT,
  JOURNAL_SUMMARY_MONTH,
  JOURNAL_SUMMARY_TOTALS
} from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { AccountingJournalTab } from '../shared/accounting-journal-tabs.model';
import {
  firstDayOfYearLocalYmd,
  parseLocalDateString,
  todayLocalYmd,
  validateDateRange
} from '../shared/accounting-date-utils';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/** Ligne du centralisateur : un journal, ses montants mois par mois et son total. */
interface CentralizerRow {
  journalCode: string;
  journalLabel: string;
  cells: { debit: number; credit: number }[];
  totalDebit: number;
  totalCredit: number;
}

const GROUPING_BY_TAB: readonly JournalSummaryGrouping[] = [
  JOURNAL_SUMMARY_MONTH,
  JOURNAL_SUMMARY_ACCOUNT,
  JOURNAL_SUMMARY_TOTALS
];

const FILE_BASE_BY_TAB: readonly string[] = [
  'journal_centralisateur',
  'recapitulation_journaux',
  'totaux_journaux'
];

@Component({
  selector: 'app-accounting-journal-summary',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TabsModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    AccountingExportMenuComponent
  ],
  template: `
    <app-page-header
      title="Récapitulatifs de journaux" i18n-title="@@accounting.journal-summary.recapitulatifs.de.journaux.39863c76"
      subtitle="Centralisateur, récapitulation et totaux journaux" i18n-subtitle="@@accounting.journal-summary.centralisateur.recapitulation.et.totaux.a68ca626" />

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Période et journal" i18n-ariaLabel="@@accounting.journal-summary.periode.et.journal.2147fcf5">
        <div accountingFilterFields class="js-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="js-from" i18n="@@accounting.journal-summary.du.84814985">Du</label>
            <input id="js-from" type="date" [(ngModel)]="fromStr" class="accounting-filter-input" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="js-to" i18n="@@accounting.journal-summary.au.7a1732d5">Au</label>
            <input id="js-to" type="date" [(ngModel)]="toStr" class="accounting-filter-input" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="js-journal" i18n="@@accounting.journal-summary.journal.57d7f743">Journal</label>
            <select id="js-journal" [(ngModel)]="journalCode" class="accounting-filter-input">
              <option value="" i18n="@@accounting.journal-summary.tous.b97ae3b4">Tous</option>
              @for (j of journals(); track j.code) {
                <option [value]="j.code">{{ j.code }} — {{ j.label }}</option>
              }
            </select>
          </div>
        </div>
        <div accountingFilterActions>
          <app-button
            variant="secondary"
            icon="pi pi-refresh"
            iconPos="left"
            type="button"
            (click)="load()"
            [disabled]="loading()"
            ariaLabel="Actualiser le récapitulatif pour la période sélectionnée" i18n-ariaLabel="@@accounting.journal-summary.actualiser.le.recapitulatif.pour.la.peri.cfc22773" i18n="@@accounting.journal-summary.actualiser.9d3b2a7d"> Actualiser </app-button>
          <app-accounting-export-menu
            [disabled]="loading() || exporting() || !summary()"
            (exportFormat)="onExport($event)" />
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner
      variant="error"
      [message]="error() ?? ''"
      [showRetry]="!!error()"
      retryLabel="Réessayer" i18n-retryLabel="@@accounting.journal-summary.reessayer.c4f78b12"
      (retry)="load()" />

    @if (summary(); as s) {
      @if (!s.isBalanced) {
        <app-accounting-status-banner
          variant="warning"
          message="Contrôle : total débit ≠ total crédit sur la période. Vérifiez les écritures avant d'exploiter cet état." i18n-message="@@accounting.journal-summary.controle.total.debit.total.credit.sur.la.1ea8752a" />
      }
    }

    <p-tabs [(value)]="activeTabIndex" (valueChange)="onTabChange()" [lazy]="true">
      <p-tablist>
        <p-tab [value]="0" i18n="@@accounting.journal-summary.centralisateur.3ed70b17">Centralisateur</p-tab>
        <p-tab [value]="1" i18n="@@accounting.journal-summary.recapitulation.072c711a">Récapitulation</p-tab>
        <p-tab [value]="2" i18n="@@accounting.journal-summary.totaux.journaux.2c1a92c9">Totaux journaux</p-tab>
      </p-tablist>
      <p-tabpanels>
      <!-- ══ Centralisateur : journaux × mois ══════════════════════════════ -->
      <p-tabpanel [value]="0">
        @if (summary(); as s) {
          <div class="js-scroll">
            <table class="js-matrix">
              <thead>
                <tr>
                  <th scope="col" class="js-sticky" i18n="@@accounting.journal-summary.journal.57d7f743">Journal</th>
                  @for (p of s.periods; track p.label) {
                    <th scope="col" colspan="2" class="js-month">{{ p.label }}</th>
                  }
                  <th scope="col" colspan="2" class="js-month js-total-col" i18n="@@accounting.journal-summary.total.b25928c6">Total</th>
                </tr>
                <tr>
                  <th scope="col" class="js-sticky"></th>
                  @for (p of s.periods; track p.label) {
                    <th scope="col" class="js-num js-sub" i18n="@@accounting.journal-summary.d.50c9e8d5">D</th>
                    <th scope="col" class="js-num js-sub" i18n="@@accounting.journal-summary.c.32096c2e">C</th>
                  }
                  <th scope="col" class="js-num js-sub js-total-col" i18n="@@accounting.journal-summary.d.50c9e8d5">D</th>
                  <th scope="col" class="js-num js-sub js-total-col" i18n="@@accounting.journal-summary.c.32096c2e">C</th>
                </tr>
              </thead>
              <tbody>
                @for (row of centralizerRows(); track row.journalCode) {
                  <tr>
                    <td class="js-sticky">
                      <span class="js-code">{{ row.journalCode }}</span>
                      <span class="js-label">{{ row.journalLabel }}</span>
                    </td>
                    @for (cell of row.cells; track $index) {
                      <td class="js-num">{{ cell.debit ? (cell.debit | number : '1.3-3') : '' }}</td>
                      <td class="js-num">{{ cell.credit ? (cell.credit | number : '1.3-3') : '' }}</td>
                    }
                    <td class="js-num js-total-col">{{ row.totalDebit | number : '1.3-3' }}</td>
                    <td class="js-num js-total-col">{{ row.totalCredit | number : '1.3-3' }}</td>
                  </tr>
                }
                @if (centralizerRows().length === 0) {
                  <tr>
                    <td [attr.colspan]="s.periods.length * 2 + 3" class="js-empty" i18n="@@accounting.journal-summary.aucun.mouvement.sur.la.periode.9d40027a"> Aucun mouvement sur la période. </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr class="acc-totals-row">
                  <td class="js-sticky" i18n="@@accounting.journal-summary.total.general.b6793855">Total général</td>
                  @for (cell of periodTotals(); track $index) {
                    <td class="js-num">{{ cell.debit ? (cell.debit | number : '1.3-3') : '' }}</td>
                    <td class="js-num">{{ cell.credit ? (cell.credit | number : '1.3-3') : '' }}</td>
                  }
                  <td class="js-num js-total-col">{{ s.totalDebit | number : '1.3-3' }}</td>
                  <td class="js-num js-total-col">{{ s.totalCredit | number : '1.3-3' }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        }
      </p-tabpanel>

      <!-- ══ Récapitulation : journaux × comptes ═══════════════════════════ -->
      <p-tabpanel [value]="1">
        <p-table
          [value]="cells()"
          [paginator]="true"
          [rows]="25"
          [rowsPerPageOptions]="[25, 50, 100]"
          [loading]="loading()"
          [rowHover]="true"
          styleClass="p-datatable-sm accounting-datatable"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} lignes" i18n-currentPageReportTemplate="@@accounting.journal-summary.affichage.de.first.a.last.sur.totalrecords.ligne.3b382824">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.journal-summary.journal.57d7f743">Journal</th>
              <th scope="col" i18n="@@accounting.journal-summary.libelle.f5485bba">Libellé</th>
              <th scope="col" i18n="@@accounting.journal-summary.compte.c45740bb">Compte</th>
              <th scope="col" i18n="@@accounting.journal-summary.intitule.9f19d904">Intitulé</th>
              <th scope="col" class="js-num" i18n="@@accounting.journal-summary.debit.f528224f">Débit</th>
              <th scope="col" class="js-num" i18n="@@accounting.journal-summary.credit.19194bdf">Crédit</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-c>
            <tr>
              <td data-label="Journal" i18n-data-label="@@accounting.journal-summary.journal.57d7f743"><span class="js-code">{{ c.journalCode }}</span></td>
              <td data-label="Libellé" i18n-data-label="@@accounting.journal-summary.libelle.f5485bba">{{ c.journalLabel }}</td>
              <td data-label="Compte" i18n-data-label="@@accounting.journal-summary.compte.c45740bb"><span class="js-code">{{ c.accountNumber }}</span></td>
              <td data-label="Intitulé" i18n-data-label="@@accounting.journal-summary.intitule.9f19d904">{{ c.accountLabel }}</td>
              <td data-label="Débit" i18n-data-label="@@accounting.journal-summary.debit.f528224f" class="js-num">{{ c.debit | number : '1.3-3' }}</td>
              <td data-label="Crédit" i18n-data-label="@@accounting.journal-summary.credit.19194bdf" class="js-num">{{ c.credit | number : '1.3-3' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="acc-totals-row">
              <td colspan="4" i18n="@@accounting.journal-summary.total.general.b6793855">Total général</td>
              <td class="js-num">{{ summary()?.totalDebit | number : '1.3-3' }}</td>
              <td class="js-num">{{ summary()?.totalCredit | number : '1.3-3' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="6" class="js-empty" i18n="@@accounting.journal-summary.aucun.mouvement.sur.la.periode.9d40027a">Aucun mouvement sur la période.</td></tr>
          </ng-template>
        </p-table>
      </p-tabpanel>

      <!-- ══ Totaux journaux ═══════════════════════════════════════════════ -->
      <p-tabpanel [value]="2">
        <p-table
          [value]="journalTotals()"
          [loading]="loading()"
          [rowHover]="true"
          styleClass="p-datatable-sm accounting-datatable">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.journal-summary.journal.57d7f743">Journal</th>
              <th scope="col" i18n="@@accounting.journal-summary.libelle.f5485bba">Libellé</th>
              <th scope="col" class="js-num" i18n="@@accounting.journal-summary.ecritures.7bfac2f6">Écritures</th>
              <th scope="col" class="js-num" i18n="@@accounting.journal-summary.total.debit.ea9c4853">Total débit</th>
              <th scope="col" class="js-num" i18n="@@accounting.journal-summary.total.credit.98c95962">Total crédit</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-t>
            <tr>
              <td data-label="Journal" i18n-data-label="@@accounting.journal-summary.journal.57d7f743"><span class="js-code">{{ t.journalCode }}</span></td>
              <td data-label="Libellé" i18n-data-label="@@accounting.journal-summary.libelle.f5485bba">{{ t.journalLabel }}</td>
              <td data-label="Écritures" i18n-data-label="@@accounting.journal-summary.ecritures.7bfac2f6" class="js-num">{{ t.entryCount }}</td>
              <td data-label="Total débit" i18n-data-label="@@accounting.journal-summary.total.debit.ea9c4853" class="js-num">{{ t.debit | number : '1.3-3' }}</td>
              <td data-label="Total crédit" i18n-data-label="@@accounting.journal-summary.total.credit.98c95962" class="js-num">{{ t.credit | number : '1.3-3' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="acc-totals-row">
              <td colspan="3" i18n="@@accounting.journal-summary.total.general.b6793855">Total général</td>
              <td class="js-num">{{ summary()?.totalDebit | number : '1.3-3' }}</td>
              <td class="js-num">{{ summary()?.totalCredit | number : '1.3-3' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="5" class="js-empty" i18n="@@accounting.journal-summary.aucun.mouvement.sur.la.periode.9d40027a">Aucun mouvement sur la période.</td></tr>
          </ng-template>
        </p-table>
      </p-tabpanel>
      </p-tabpanels>
    </p-tabs>
  `,
  styles: `
    @use '../shared/accounting-layout';

    .js-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--spacing-4); }
    .js-num { text-align: end; font-variant-numeric: tabular-nums; }
    .js-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: var(--font-weight-medium);
    }
    .js-label { margin-inline-start: var(--spacing-2); color: var(--color-text-secondary); }
    .js-empty { text-align: center; padding: var(--spacing-8) var(--spacing-4); }

    /* Le centralisateur est large par nature : il défile horizontalement dans son conteneur,
       jamais la page. La colonne Journal reste visible pendant le défilement. */
    .js-scroll { overflow-x: auto; max-width: 100%; }
    .js-matrix {
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
      font-size: var(--font-size-sm);
    }
    .js-matrix th,
    .js-matrix td {
      padding: var(--spacing-2) var(--spacing-3);
      border-bottom: 1px solid var(--color-border-subtle);
      white-space: nowrap;
    }
    .js-matrix thead th {
      background: var(--color-background-subtle);
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      font-size: var(--font-size-xs);
      letter-spacing: 0.04em;
      text-align: center;
    }
    .js-matrix thead th.js-sub { text-align: end; }
    .js-sticky {
      position: sticky;
      inset-inline-start: 0;
      z-index: 1;
      background: var(--color-background-elevated);
      text-align: start;
    }
    .js-matrix thead .js-sticky { background: var(--color-background-subtle); }
    .js-total-col { background: var(--color-background-subtle); }
    .acc-totals-row td {
      font-weight: var(--font-weight-bold);
      background: var(--color-background-subtle);
      border-top: 2px solid var(--color-border-default);
    }
  `
})
export class JournalSummaryComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly journalCatalog = inject(AccountingJournalCatalogService);

  fromStr = '';
  toStr = '';
  journalCode = '';
  activeTabIndex = 0;

  readonly journals = signal<readonly AccountingJournalTab[]>([]);
  readonly summary = signal<JournalSummaryDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);

  readonly cells = computed<JournalSummaryCellDto[]>(() => this.summary()?.cells ?? []);
  readonly journalTotals = computed(() => this.summary()?.journalTotals ?? []);

  /** Pivot journaux × mois : une ligne par journal, une paire D/C par mois de la période. */
  readonly centralizerRows = computed<CentralizerRow[]>(() => {
    const s = this.summary();
    if (!s || s.grouping !== JOURNAL_SUMMARY_MONTH) return [];

    const columnIndex = new Map<string, number>();
    s.periods.forEach((p, i) => columnIndex.set(`${p.year}-${p.month}`, i));

    const rows = new Map<string, CentralizerRow>();
    for (const total of s.journalTotals) {
      rows.set(total.journalCode, {
        journalCode: total.journalCode,
        journalLabel: total.journalLabel,
        cells: s.periods.map(() => ({ debit: 0, credit: 0 })),
        totalDebit: total.debit,
        totalCredit: total.credit
      });
    }

    for (const cell of s.cells) {
      const row = rows.get(cell.journalCode);
      const index = columnIndex.get(`${cell.year}-${cell.month}`);
      if (!row || index === undefined) continue;
      row.cells[index] = { debit: cell.debit, credit: cell.credit };
    }

    return [...rows.values()];
  });

  /** Totaux par colonne mensuelle (pied du centralisateur). */
  readonly periodTotals = computed(() => {
    const s = this.summary();
    if (!s || s.grouping !== JOURNAL_SUMMARY_MONTH) return [];
    const totals = s.periods.map(() => ({ debit: 0, credit: 0 }));
    for (const row of this.centralizerRows()) {
      row.cells.forEach((cell, i) => {
        totals[i].debit += cell.debit;
        totals[i].credit += cell.credit;
      });
    }
    return totals;
  });

  ngOnInit(): void {
    this.fromStr = firstDayOfYearLocalYmd();
    this.toStr = todayLocalYmd();
    this.journalCatalog.list().subscribe(list => this.journals.set(list));
    this.load();
  }

  onTabChange(): void {
    this.load();
  }

  load(): void {
    const range = this.resolveRange();
    if (!range) return;

    this.error.set(null);
    this.loading.set(true);
    this.api
      .getJournalSummary(range.from, range.to, GROUPING_BY_TAB[this.activeTabIndex], this.journalCode || undefined)
      .subscribe({
        next: res => {
          this.loading.set(false);
          if (res.success && res.data) this.summary.set(res.data);
          else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        },
        error: err => {
          this.loading.set(false);
          this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.journal-summary.ts.erreur.reseau.0683007f:Erreur réseau`));
        }
      });
  }

  onExport(format: AccountingExportFormat): void {
    const range = this.resolveRange();
    if (!range) return;

    this.exporting.set(true);
    this.api
      .exportJournalSummary(
        range.from,
        range.to,
        GROUPING_BY_TAB[this.activeTabIndex],
        this.journalCode || undefined,
        format
      )
      .subscribe({
        next: blob => {
          this.exporting.set(false);
          const base = FILE_BASE_BY_TAB[this.activeTabIndex];
          downloadBlob(blob, `${base}_${this.fromStr}_${this.toStr}.${exportExtension(format)}`);
        },
        error: err => {
          this.exporting.set(false);
          this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.journal-summary.ts.erreur.lors.de.l.export.cd90f787:Erreur lors de l'export.`));
        }
      });
  }

  /** Période validée, ou null après avoir publié le message d'erreur. */
  private resolveRange(): { from: Date; to: Date } | null {
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return null;
    }
    return { from, to };
  }
}
