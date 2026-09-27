import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, AgingReportRowDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-accounting-aging',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    TabsModule,
    ProgressSpinnerModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AnalyzeWithAiButtonComponent,
    AccountingFilterBarComponent,
    ButtonComponent,
    AccountingExportMenuComponent
  ],
  styles: [
    `
      @use '../shared/accounting-layout';
      .text-right {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .aging-zero {
        color: var(--color-text-tertiary);
      }
      .aging-overdue-warn {
        color: var(--color-warning-700);
        font-weight: var(--font-weight-semibold);
      }
      .aging-overdue-danger {
        color: var(--color-error-600);
        font-weight: var(--font-weight-semibold);
      }
      .aging-totals-row td {
        font-weight: var(--font-weight-bold);
        background: var(--color-background-subtle);
        border-top: 2px solid var(--color-border-default);
      }
    `
  ],
  template: `
    <app-page-header title="Balance âgée" i18n-title="Balance âgée" subtitle="Créances et dettes par tranche" />
    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Actualisation balance âgée">
        <div accountingFilterActions>
          <app-button
            variant="secondary"
            icon="pi pi-refresh"
            iconPos="left"
            type="button"
            (click)="loadAll()"
            [disabled]="loadingClients() || loadingSuppliers()"
            ariaLabel="Actualiser les balances clients et fournisseurs">
            @if (loadingClients() || loadingSuppliers()) {
              <p-progressSpinner strokeWidth="4" [style]="{ width: '1.1rem', height: '1.1rem', display: 'inline-block', verticalAlign: 'middle' }" />
            } @else {
              Actualiser
            }
          </app-button>
          <app-analyze-with-ai-button
            screenId="accounting-aging"
            density="toolbar"
            [payloadBuilder]="buildAgingAnalyzePayload"
            [disabled]="loadingClients() || loadingSuppliers()" />
          <app-accounting-export-menu
            label="Exporter clients" i18n-label="Exporter clients"
            [disabled]="loadingClients() || exportingClients() || clients().length === 0"
            (exportFormat)="onExportClients($event)" />
          <app-accounting-export-menu
            label="Exporter fournisseurs" i18n-label="Exporter fournisseurs"
            [disabled]="loadingSuppliers() || exportingSuppliers() || suppliers().length === 0"
            (exportFormat)="onExportSuppliers($event)" />
        </div>
      </app-accounting-filter-bar>
    </div>

    <p-tabs class="ft-tabs aging-tabs" [lazy]="true">
      <p-tablist>
        <p-tab [value]="0"><i class="pi pi-users"></i><span i18n="@@accounting.aging.clients.28e22fe3">Clients</span></p-tab>
        <p-tab [value]="1"><i class="pi pi-truck"></i><span i18n="@@accounting.aging.fournisseurs.06b6d88c">Fournisseurs</span></p-tab>
      </p-tablist>
      <p-tabpanels>
      <p-tabpanel [value]="0">
        <app-accounting-status-banner
          variant="error"
          [message]="errClients() ?? ''"
          [showRetry]="!!errClients()"
          retryLabel="Réessayer"
          (retry)="loadClients()"
        />
        <p-table
          [value]="clients()"
          [paginator]="true"
          [rows]="20"
          [loading]="loadingClients()"
          [rowHover]="true"
          styleClass="p-datatable-sm accounting-datatable"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.aging.client.1bdd79b1">Client</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.total.b25928c6">Total</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.non.echu.cb5c1717">Non échu</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.0.30j.222b5f16">0-30j</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.31.60j.4e83222f">31-60j</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.61.90j.a4ba1dc5">61-90j</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.gt.90j.f2293c82">&gt;90j</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.dso.5684cca3">DSO</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td data-label="Client">{{ r.thirdPartyName }}</td>
              <td class="text-right" data-label="Total">{{ formatAmount(r.total) }}</td>
              <td class="text-right" data-label="Non échu">{{ formatAmount(r.notYetDue) }}</td>
              <td class="text-right" data-label="0-30j">{{ formatAmount(r.days0To30) }}</td>
              <td class="text-right" data-label="31-60j">{{ formatAmount(r.days31To60) }}</td>
              <td class="text-right aging-overdue-warn" data-label="61-90j">{{ formatAmount(r.days61To90) }}</td>
              <td class="text-right aging-overdue-danger" data-label=">90j">{{ formatAmount(r.daysOver90) }}</td>
              <td class="text-right" data-label="DSO">{{ r.dsoOrDpo != null ? (r.dsoOrDpo | number : '1.1-1') : '—' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            @if (clients().length) {
              <tr class="aging-totals-row">
                <td i18n="@@accounting.aging.total.b25928c6">Total</td>
                <td class="text-right">{{ totalsClients().total | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsClients().notYetDue | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsClients().d0 | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsClients().d31 | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsClients().d61 | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsClients().d90 | number : '1.3-3' }}</td>
                <td class="text-right" i18n="@@accounting.aging.text.1b93795b">—</td>
              </tr>
            }
          </ng-template>
        </p-table>
      </p-tabpanel>
      <p-tabpanel [value]="1">
        <app-accounting-status-banner
          variant="error"
          [message]="errSup() ?? ''"
          [showRetry]="!!errSup()"
          retryLabel="Réessayer"
          (retry)="loadSuppliers()"
        />
        <p-table
          [value]="suppliers()"
          [paginator]="true"
          [rows]="20"
          [loading]="loadingSuppliers()"
          [rowHover]="true"
          styleClass="p-datatable-sm accounting-datatable"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.aging.fournisseur.97d91d89">Fournisseur</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.total.b25928c6">Total</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.non.echu.cb5c1717">Non échu</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.0.30j.222b5f16">0-30j</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.31.60j.4e83222f">31-60j</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.61.90j.a4ba1dc5">61-90j</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.gt.90j.f2293c82">&gt;90j</th>
              <th class="text-right" scope="col" i18n="@@accounting.aging.dpo.ef51589e">DPO</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td data-label="Fournisseur">{{ r.thirdPartyName }}</td>
              <td class="text-right" data-label="Total">{{ formatAmount(r.total) }}</td>
              <td class="text-right" data-label="Non échu">{{ formatAmount(r.notYetDue) }}</td>
              <td class="text-right" data-label="0-30j">{{ formatAmount(r.days0To30) }}</td>
              <td class="text-right" data-label="31-60j">{{ formatAmount(r.days31To60) }}</td>
              <td class="text-right aging-overdue-warn" data-label="61-90j">{{ formatAmount(r.days61To90) }}</td>
              <td class="text-right aging-overdue-danger" data-label=">90j">{{ formatAmount(r.daysOver90) }}</td>
              <td class="text-right" data-label="DPO">{{ r.dsoOrDpo != null ? (r.dsoOrDpo | number : '1.1-1') : '—' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            @if (suppliers().length) {
              <tr class="aging-totals-row">
                <td i18n="@@accounting.aging.total.b25928c6">Total</td>
                <td class="text-right">{{ totalsSuppliers().total | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsSuppliers().notYetDue | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsSuppliers().d0 | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsSuppliers().d31 | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsSuppliers().d61 | number : '1.3-3' }}</td>
                <td class="text-right">{{ totalsSuppliers().d90 | number : '1.3-3' }}</td>
                <td class="text-right" i18n="@@accounting.aging.text.1b93795b">—</td>
              </tr>
            }
          </ng-template>
        </p-table>
      </p-tabpanel>
      </p-tabpanels>
    </p-tabs>
  `
})
export class AgingComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  readonly clients = signal<AgingReportRowDto[]>([]);
  readonly suppliers = signal<AgingReportRowDto[]>([]);
  readonly errClients = signal<string | null>(null);
  readonly errSup = signal<string | null>(null);
  readonly loadingClients = signal(false);
  readonly loadingSuppliers = signal(false);
  readonly exportingClients = signal(false);
  readonly exportingSuppliers = signal(false);

  readonly totalsClients = computed(() => this.sumRows(this.clients()));
  readonly totalsSuppliers = computed(() => this.sumRows(this.suppliers()));

  readonly buildAgingAnalyzePayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      'accounting-aging',
      {
        screen: 'accounting-aging',
        clients: {
          count: this.clients().length,
          rows: this.clients().map(r => ({
            thirdPartyName: r.thirdPartyName,
            total: r.total,
            notYetDue: r.notYetDue,
            days0To30: r.days0To30,
            days31To60: r.days31To60,
            days61To90: r.days61To90,
            daysOver90: r.daysOver90,
            dsoOrDpo: r.dsoOrDpo
          })),
          totals: this.totalsClients()
        },
        suppliers: {
          count: this.suppliers().length,
          rows: this.suppliers().map(r => ({
            thirdPartyName: r.thirdPartyName,
            total: r.total,
            notYetDue: r.notYetDue,
            days0To30: r.days0To30,
            days31To60: r.days31To60,
            days61To90: r.days61To90,
            daysOver90: r.daysOver90,
            dsoOrDpo: r.dsoOrDpo
          })),
          totals: this.totalsSuppliers()
        }
      } as Record<string, unknown>
    );

  ngOnInit(): void {
    this.loadAll();
  }

  formatAmount(v: number): string {
    if (Math.abs(v) < 0.0005) {
      return '—';
    }
    return new Intl.NumberFormat('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);
  }

  loadAll(): void {
    this.loadClients();
    this.loadSuppliers();
  }

  loadClients(): void {
    this.errClients.set(null);
    this.loadingClients.set(true);
    this.api.getClientAging().subscribe({
      next: r => {
        this.loadingClients.set(false);
        if (r.success && r.data) this.clients.set(r.data);
        else this.errClients.set(r.error ?? $localize`:@@ui.tern.erreur.de.chargement.168d09:Erreur de chargement.`);
      },
      error: err => {
        this.loadingClients.set(false);
        this.errClients.set(this.errors.extractErrorMessage(err, 'Erreur réseau. Réessayez plus tard.'));
      }
    });
  }

  loadSuppliers(): void {
    this.errSup.set(null);
    this.loadingSuppliers.set(true);
    this.api.getSupplierAging().subscribe({
      next: r => {
        this.loadingSuppliers.set(false);
        if (r.success && r.data) this.suppliers.set(r.data);
        else this.errSup.set(r.error ?? $localize`:@@ui.tern.erreur.de.chargement.168d09:Erreur de chargement.`);
      },
      error: err => {
        this.loadingSuppliers.set(false);
        this.errSup.set(this.errors.extractErrorMessage(err, 'Erreur réseau. Réessayez plus tard.'));
      }
    });
  }

  onExportClients(format: AccountingExportFormat): void {
    this.exportingClients.set(true);
    this.api.exportClientAging(format).subscribe({
      next: blob => {
        this.exportingClients.set(false);
        downloadBlob(blob, `balance_agee_clients.${exportExtension(format)}`);
      },
      error: err => {
        this.exportingClients.set(false);
        this.errClients.set(this.errors.extractErrorMessage(err, "Erreur lors de l'export."));
      }
    });
  }

  onExportSuppliers(format: AccountingExportFormat): void {
    this.exportingSuppliers.set(true);
    this.api.exportSupplierAging(format).subscribe({
      next: blob => {
        this.exportingSuppliers.set(false);
        downloadBlob(blob, `balance_agee_fournisseurs.${exportExtension(format)}`);
      },
      error: err => {
        this.exportingSuppliers.set(false);
        this.errSup.set(this.errors.extractErrorMessage(err, "Erreur lors de l'export."));
      }
    });
  }

  private sumRows(rows: AgingReportRowDto[]): {
    total: number;
    notYetDue: number;
    d0: number;
    d31: number;
    d61: number;
    d90: number;
  } {
    let total = 0,
      notYetDue = 0,
      d0 = 0,
      d31 = 0,
      d61 = 0,
      d90 = 0;
    for (const r of rows) {
      total += r.total;
      notYetDue += r.notYetDue;
      d0 += r.days0To30;
      d31 += r.days31To60;
      d61 += r.days61To90;
      d90 += r.daysOver90;
    }
    return { total, notYetDue, d0, d31, d61, d90 };
  }
}
