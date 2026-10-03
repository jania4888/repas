/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  CashDeskService,
  CashOperationType,
  TreasuryJournalResult,
  getCashPaymentMethodLabel
} from '@core/services/cash-desk.service';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { formatLocalDate } from '@core/utils/date.util';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { buildTreasuryJournalView } from './cash-journal.view';

const PAGE_SIZE = 50;

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  };
}

@Component({
  selector: 'app-cash-journal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    PageHeaderComponent,
    ButtonComponent,
    EmptyStateComponent,
    SkeletonTableComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-page-header
      title="Journal de trésorerie" i18n-title="@@payments.cash-journal.title"
      subtitle="Mouvements de caisse regroupés par catégorie d'encaissement et de décaissement." i18n-subtitle="@@payments.cash-journal.subtitle">
      <app-button
        variant="primary"
        icon="pi-print"
        iconPos="left"
        [disabled]="loading() || printing()"
        (click)="printPdf()"
        i18n="@@payments.cash-journal.print">Imprimer (PDF)</app-button>
    </app-page-header>

    <div class="page-grid">
      <section class="filters-card">
        <div class="filters-row">
          <label class="filter-field">
            <span i18n="@@payments.cash-journal.from">Du</span>
            <input type="date" name="from" [(ngModel)]="from" />
          </label>
          <label class="filter-field">
            <span i18n="@@payments.cash-journal.to">Au</span>
            <input type="date" name="to" [(ngModel)]="to" />
          </label>
          <label class="filter-field">
            <span i18n="@@payments.cash-journal.method">Moyen</span>
            <select name="method" [(ngModel)]="method">
              @for (option of methodOptions; track option.value) {
                <option [ngValue]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>
          <div class="filter-action">
            <app-button variant="outline" [disabled]="loading()" (click)="show()" i18n="@@payments.cash-journal.show">Afficher</app-button>
          </div>
        </div>
      </section>

      @if (error()) {
        <div class="alert" role="alert">{{ error() }}</div>
      }

      <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

      @if (initialLoad()) {
        <app-skeleton-table [rows]="8" [columns]="skeletonColumns"></app-skeleton-table>
      } @else if (journal() && journal()!.operationCount === 0) {
        <app-empty-state
          illustration="empty-payments.svg"
          title="Aucune opération" i18n-title="@@payments.cash-desk.aucune.operation.5e70746f"
          description="Aucune opération trouvée pour la période sélectionnée." i18n-description="@@payments.cash-desk.aucune.operation.trouvee.pour.la.periode.cd290cb0">
        </app-empty-state>
      } @else {
        @for (section of sections(); track section.operationType) {
          <section class="journal-section">
            <h2>{{ section.title }}</h2>
            @for (group of section.groups; track group.key) {
              <article class="group-card">
                <header class="group-header">
                  <h3>{{ group.label }}</h3>
                  <p>
                    <span i18n="@@payments.cash-journal.subtotal">Sous-total</span>
                    {{ group.total | number:'1.3-3' }} {{ currency() }}
                    <span class="count">({{ group.count }})</span>
                  </p>
                </header>
                @if (group.lines.length === 0) {
                  <p class="partial" i18n="@@payments.cash-journal.partial">Le détail de cette catégorie continue sur une autre page.</p>
                } @else {
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th i18n="@@payments.cash-desk.date.eb9a4bc1">Date</th>
                          <th i18n="@@payments.cash-desk.type.3deb7456">Type</th>
                          <th i18n="@@payments.cash-desk.moyen.de03c108">Moyen</th>
                          <th i18n="@@payments.cash-desk.categorie.6b38300a">Catégorie</th>
                          <th i18n="@@payments.cash-desk.libelle.f5485bba">Libellé</th>
                          <th i18n="@@payments.cash-desk.document.e214b8a2">Document</th>
                          <th class="num" i18n="@@payments.cash-desk.debit.f528224f">Débit</th>
                          <th class="num" i18n="@@payments.cash-desk.credit.19194bdf">Crédit</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (line of group.lines; track line.id) {
                          <tr>
                            <td>{{ line.operationDate | date:'dd/MM/yyyy' }}</td>
                            <td>{{ typeLabel(line.operationType) }}</td>
                            <td>{{ methodLabel(line.method) }}</td>
                            <td>{{ group.label }}</td>
                            <td>{{ line.label }}</td>
                            <td>
                              <span class="mono">{{ line.document }}</span>
                              @if (line.sourceInvoiceId) {
                                <a [routerLink]="['/invoices', line.sourceInvoiceId]">{{ line.sourceInvoiceNumber }}</a>
                              }
                              @if (line.sourceSupplierInvoiceId) {
                                <a [routerLink]="['/supplier-invoices', line.sourceSupplierInvoiceId]">{{ line.sourceSupplierInvoiceNumber }}</a>
                              }
                            </td>
                            <td class="num debit">
                              @if (line.operationType === debit) {
                                {{ line.amount | number:'1.3-3' }} {{ line.currency }}
                              }
                            </td>
                            <td class="num credit">
                              @if (line.operationType === credit) {
                                {{ line.amount | number:'1.3-3' }} {{ line.currency }}
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  @if (group.lines.length < group.count) {
                    <p class="partial" i18n="@@payments.cash-journal.partial">Le détail de cette catégorie continue sur une autre page.</p>
                  }
                }
              </article>
            }
          </section>
        }

        @if ((journal()?.lines?.totalPages ?? 1) > 1) {
          <nav class="pager" [attr.aria-label]="pagerLabel">
            <app-button variant="outline" [disabled]="page <= 1 || loading()" (click)="changePage(-1)" i18n="@@payments.cash-journal.previous">Page précédente</app-button>
            <span>{{ page }} / {{ journal()?.lines?.totalPages }}</span>
            <app-button variant="outline" [disabled]="page >= (journal()?.lines?.totalPages ?? 1) || loading()" (click)="changePage(1)" i18n="@@payments.cash-journal.next">Page suivante</app-button>
          </nav>
        }
      }
    </div>
  `,
  styles: [`
    .page-grid { display: flex; flex-direction: column; gap: var(--spacing-6); }
    .filters-card, .group-card {
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-sm);
    }
    .filters-card { padding: var(--spacing-5); }
    .filters-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: var(--spacing-4); align-items: end; }
    .filter-field { display: flex; flex-direction: column; gap: var(--spacing-2); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .filter-field input, .filter-field select {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-md);
      background: var(--color-background);
      color: var(--color-text-primary);
    }
    .filter-action { display: flex; justify-content: flex-end; }
    .alert { padding: var(--spacing-3) var(--spacing-4); border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-danger-500) 12%, transparent); color: var(--color-danger-700); }
    .journal-section h2 { margin: 0; font-size: var(--font-size-xl); }
    .group-card { padding: var(--spacing-4) var(--spacing-5); }
    .group-header { display: flex; justify-content: space-between; gap: var(--spacing-4); align-items: baseline; }
    .group-header h3 { margin: 0; font-size: var(--font-size-lg); }
    .group-header p { margin: 0; font-variant-numeric: tabular-nums; }
    .count { color: var(--color-text-secondary); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: var(--spacing-2) var(--spacing-3); border-bottom: 1px solid var(--color-border-subtle); text-align: start; vertical-align: top; }
    th { font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary); }
    .num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .debit { color: var(--color-danger-600); }
    .credit { color: var(--color-success-600); }
    .mono { font-family: var(--font-family-mono, ui-monospace, monospace); }
    .partial { margin: var(--spacing-2) 0 0; color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .pager { display: flex; justify-content: flex-end; align-items: center; gap: var(--spacing-3); }
    td a { display: block; font-size: var(--font-size-xs); }
    @media (max-width: 900px) {
      .filters-row { grid-template-columns: 1fr; }
    }
  `]
})
export class CashJournalComponent implements OnInit, OnDestroy {
  private readonly cashDesk = inject(CashDeskService);
  private readonly printPreview = inject(PrintPreviewService);
  private subscription: Subscription | null = null;

  readonly debit = CashOperationType.Debit;
  readonly credit = CashOperationType.Credit;
  readonly pagerLabel = $localize`:@@payments.cash-journal.pager:Pages du journal`;
  readonly methodOptions = [
    { value: null as number | null, label: $localize`:@@payments.cash-journal.all-methods:Tous les moyens` },
    { value: 0, label: getCashPaymentMethodLabel(0) },
    { value: 1, label: getCashPaymentMethodLabel(1) },
    { value: 2, label: getCashPaymentMethodLabel(2) },
    { value: 3, label: getCashPaymentMethodLabel(3) },
    { value: 4, label: getCashPaymentMethodLabel(4) },
    { value: 5, label: getCashPaymentMethodLabel(5) },
    { value: 99, label: getCashPaymentMethodLabel(99) }
  ];
  readonly skeletonColumns = [
    { width: '110px' },
    { width: '90px' },
    { width: '140px' },
    { width: '180px' },
    { width: '220px' },
    { width: '160px' },
    { width: '120px' },
    { width: '120px' }
  ];

  private readonly encaissementsTitle = $localize`:@@payments.cash-journal.encaissements:Encaissements`;
  private readonly decaissementsTitle = $localize`:@@payments.cash-journal.decaissements:Décaissements`;
  private readonly unclassifiedLabel = $localize`:@@payments.cash-journal.unclassified:Non classé`;
  private readonly loadError = $localize`:@@payments.cash-journal.load-error:Impossible de charger le journal de trésorerie.`;
  private readonly periodOrderError = $localize`:@@payments.cash-journal.period-order:La date de début ne peut pas être après la date de fin.`;
  private readonly periodLengthError = $localize`:@@payments.cash-journal.period-length:La période du journal de trésorerie ne peut pas dépasser 366 jours.`;
  private readonly debitLabel = $localize`:@@payments.cash-journal.debit:Débit`;
  private readonly creditLabel = $localize`:@@payments.cash-journal.credit:Crédit`;

  from = currentMonthRange().from;
  to = currentMonthRange().to;
  method: number | null = null;
  page = 1;

  readonly loading = signal(true);
  readonly initialLoad = signal(true);
  readonly printing = signal(false);
  readonly error = signal<string | null>(null);
  readonly journal = signal<TreasuryJournalResult | null>(null);

  readonly currency = computed(() => this.journal()?.currency ?? 'TND');
  readonly sections = computed(() => {
    const data = this.journal();
    if (!data) return [];
    return buildTreasuryJournalView({
      groups: data.groups ?? [],
      lines: data.lines?.items ?? [],
      encaissementsTitle: this.encaissementsTitle,
      decaissementsTitle: this.decaissementsTitle,
      unclassifiedLabel: this.unclassifiedLabel
    });
  });
  readonly summaryMetrics = computed<TotalMetric[]>(() => {
    const data = this.journal();
    const currency = data?.currency ?? 'TND';
    return [
      {
        label: this.encaissementsTitle,
        value: data?.totalCredits,
        format: 'currency',
        currency,
        icon: 'pi-arrow-down-left',
        tone: 'emerald'
      },
      {
        label: this.decaissementsTitle,
        value: data?.totalDebits,
        format: 'currency',
        currency,
        icon: 'pi-arrow-up-right',
        tone: 'rose'
      },
      {
        label: $localize`:@@payments.cash-journal.balance:Solde`,
        value: data?.balance,
        format: 'currency',
        currency,
        icon: 'pi-wallet',
        tone: 'primary'
      },
      {
        label: $localize`:@@payments.cash-journal.count:Nombre d'opérations`,
        value: data?.operationCount,
        format: 'number',
        icon: 'pi-list',
        tone: 'cyan'
      }
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  show(): void {
    this.page = 1;
    this.load();
  }

  changePage(delta: number): void {
    this.page = Math.max(1, this.page + delta);
    this.load();
  }

  printPdf(): void {
    if (!this.datesAreValid()) return;
    this.printing.set(true);
    this.cashDesk.downloadTreasuryJournalPdf({ from: this.from, to: this.to, method: this.method }).subscribe({
      next: blob => {
        const stamp = (value: string) => value.replace(/-/g, '');
        this.printPreview.openPdfForPrintPreview(blob, `journal-tresorerie_${stamp(this.from)}_${stamp(this.to)}.pdf`);
        this.printing.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.printing.set(false);
      }
    });
  }

  typeLabel(operationType: number): string {
    return operationType === CashOperationType.Credit ? this.creditLabel : this.debitLabel;
  }

  methodLabel(method: number): string {
    return getCashPaymentMethodLabel(method);
  }

  private load(): void {
    if (!this.datesAreValid()) {
      this.loading.set(false);
      this.initialLoad.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.subscription?.unsubscribe();
    this.subscription = this.cashDesk
      .getTreasuryJournal({
        from: this.from,
        to: this.to,
        method: this.method,
        page: this.page,
        pageSize: PAGE_SIZE
      })
      .subscribe({
        next: res => {
          this.journal.set(res.success && res.data ? res.data : null);
          if (!res.success) this.error.set(res.message || this.loadError);
          this.loading.set(false);
          this.initialLoad.set(false);
        },
        error: (err: HttpErrorResponse) => {
          const body = err.error as { message?: string } | null;
          this.error.set(body?.message || this.loadError);
          this.loading.set(false);
          this.initialLoad.set(false);
        }
      });
  }

  private datesAreValid(): boolean {
    if (!this.from || !this.to) {
      this.error.set(this.loadError);
      return false;
    }
    const from = new Date(`${this.from}T00:00:00`);
    const to = new Date(`${this.to}T00:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      this.error.set(this.periodOrderError);
      return false;
    }
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 366) {
      this.error.set(this.periodLengthError);
      return false;
    }
    return true;
  }
}
