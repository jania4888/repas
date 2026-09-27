import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, AuxiliaryBalanceRowDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  firstDayOfYearLocalYmd,
  parseLocalDateString,
  todayLocalYmd,
  validateDateRange
} from '../shared/accounting-date-utils';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Balance auxiliaire : une ligne par tiers (clients ou fournisseurs) avec soldes
 * d'ouverture, mouvements et clôture — drill-down vers le grand livre du tiers.
 */
@Component({
  selector: 'app-auxiliary-balance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    TooltipModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    ButtonComponent,
    AccountingExportMenuComponent
  ],
  template: `
    <app-page-header title="Balance auxiliaire" i18n-title="Balance auxiliaire" subtitle="Soldes par tiers — clients ou fournisseurs" />
    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Type de tiers et période">
        <div accountingFilterFields class="auxbal-toolbar-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="auxbal-kind" i18n="@@accounting.auxiliary-balance.tiers.435080ba">Tiers</label>
            <select id="auxbal-kind" [(ngModel)]="kind" class="accounting-filter-input">
              <option [ngValue]="1" i18n="@@accounting.auxiliary-balance.clients.28e22fe3">Clients</option>
              <option [ngValue]="2" i18n="@@accounting.auxiliary-balance.fournisseurs.06b6d88c">Fournisseurs</option>
            </select>
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="auxbal-from" i18n="@@accounting.auxiliary-balance.du.84814985">Du</label>
            <input id="auxbal-from" type="date" [(ngModel)]="fromStr" class="accounting-filter-input" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="auxbal-to" i18n="@@accounting.auxiliary-balance.au.7a1732d5">Au</label>
            <input id="auxbal-to" type="date" [(ngModel)]="toStr" class="accounting-filter-input" />
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
            ariaLabel="Actualiser la balance auxiliaire" i18n="@@accounting.auxiliary-balance.actualiser.9d3b2a7d"> Actualiser </app-button>
          <app-accounting-export-menu
            [disabled]="loading() || exporting() || rows().length === 0"
            (exportFormat)="onExport($event)" />
        </div>
      </app-accounting-filter-bar>
    </div>
    <app-accounting-status-banner
      variant="error"
      [message]="error() ?? ''"
      [showRetry]="!!error()"
      retryLabel="Réessayer"
      (retry)="load()" />
    <p-table [value]="rows()" [paginator]="true" [rows]="25" [rowsPerPageOptions]="[25, 50, 100]"
      [loading]="loading()" [rowHover]="true" [scrollable]="true" scrollHeight="flex"
      styleClass="p-datatable-sm accounting-datatable auxbal-table"
      [showCurrentPageReport]="true" currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} tiers" i18n-currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} tiers">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@accounting.auxiliary-balance.tiers.435080ba">Tiers</th>
          <th class="text-right" pTooltip="Ouverture débit" i18n-pTooltip="Ouverture débit" tooltipPosition="top" i18n="@@accounting.auxiliary-balance.ouv.d.1a1c3306">Ouv. D</th>
          <th class="text-right" pTooltip="Ouverture crédit" i18n-pTooltip="Ouverture crédit" tooltipPosition="top" i18n="@@accounting.auxiliary-balance.ouv.c.95e30fd9">Ouv. C</th>
          <th class="text-right" pTooltip="Mouvement débit" i18n-pTooltip="Mouvement débit" tooltipPosition="top" i18n="@@accounting.auxiliary-balance.mouv.d.0f50458a">Mouv. D</th>
          <th class="text-right" pTooltip="Mouvement crédit" i18n-pTooltip="Mouvement crédit" tooltipPosition="top" i18n="@@accounting.auxiliary-balance.mouv.c.87e48868">Mouv. C</th>
          <th class="text-right" pTooltip="Clôture débit" i18n-pTooltip="Clôture débit" tooltipPosition="top" i18n="@@accounting.auxiliary-balance.cloture.d.edb6d923">Clôture D</th>
          <th class="text-right" pTooltip="Clôture crédit" i18n-pTooltip="Clôture crédit" tooltipPosition="top" i18n="@@accounting.auxiliary-balance.cloture.c.2be08431">Clôture C</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r>
        <tr>
          <td data-label="Tiers">
            <a
              class="auxbal-tiers-link"
              [routerLink]="['/accounting/third-party-ledger']"
              [queryParams]="{ thirdPartyId: r.thirdPartyId, kind: kind, from: fromStr, to: toStr, name: r.thirdPartyName }"
              title="Voir le grand livre de ce tiers" i18n-title="Voir le grand livre de ce tiers">
              {{ r.thirdPartyName }}
            </a>
          </td>
          <td class="text-right auxbal-num" data-label="Ouv. D">{{ r.openingDebit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num" data-label="Ouv. C">{{ r.openingCredit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num" data-label="Mouv. D">{{ r.movementDebit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num" data-label="Mouv. C">{{ r.movementCredit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num" data-label="Clôture D">{{ r.closingDebit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num" data-label="Clôture C">{{ r.closingCredit | number : '1.3-3' }}</td>
        </tr>
      </ng-template>
      <ng-template pTemplate="footer">
        <tr class="acc-totals-row">
          <td>Totaux ({{ rows().length }} tiers)</td>
          <td class="text-right auxbal-num">{{ totals().openingDebit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num">{{ totals().openingCredit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num">{{ totals().movementDebit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num">{{ totals().movementCredit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num">{{ totals().closingDebit | number : '1.3-3' }}</td>
          <td class="text-right auxbal-num">{{ totals().closingCredit | number : '1.3-3' }}</td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="7" style="text-align:center;padding:2rem" i18n="@@accounting.auxiliary-balance.aucun.mouvement.de.tiers.sur.la.periode.d9368d68">Aucun mouvement de tiers sur la période.</td></tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .auxbal-toolbar-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .text-right { text-align:right; }
    .auxbal-num { font-variant-numeric:tabular-nums; }
    .acc-totals-row td { font-weight:var(--font-weight-bold); background:var(--color-background-subtle); border-top:2px solid var(--color-border-default); }
    .auxbal-tiers-link { font-weight:500; color:var(--color-primary-500); cursor:pointer; text-decoration:none; }
    .auxbal-tiers-link:hover { text-decoration:underline; color:var(--color-primary-700); }
    :host ::ng-deep .auxbal-table.p-datatable .p-datatable-table { min-width:52rem; }
  `
})
export class AuxiliaryBalanceComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);

  kind = 1;
  fromStr = '';
  toStr = '';
  readonly rows = signal<AuxiliaryBalanceRowDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);

  readonly totals = computed(() => {
    let openingDebit = 0, openingCredit = 0, movementDebit = 0, movementCredit = 0, closingDebit = 0, closingCredit = 0;
    for (const r of this.rows()) {
      openingDebit += r.openingDebit;
      openingCredit += r.openingCredit;
      movementDebit += r.movementDebit;
      movementCredit += r.movementCredit;
      closingDebit += r.closingDebit;
      closingCredit += r.closingCredit;
    }
    return { openingDebit, openingCredit, movementDebit, movementCredit, closingDebit, closingCredit };
  });

  ngOnInit(): void {
    this.fromStr = firstDayOfYearLocalYmd();
    this.toStr = todayLocalYmd();
    this.load();
  }

  load(): void {
    this.error.set(null);
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.loading.set(true);
    this.api.getAuxiliaryBalance(this.kind, from, to).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.rows.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  onExport(format: AccountingExportFormat): void {
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.exporting.set(true);
    this.api.exportAuxiliaryBalance(this.kind, from, to, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        const kindName = this.kind === 1 ? 'clients' : 'fournisseurs';
        downloadBlob(blob, `balance_auxiliaire_${kindName}_${this.fromStr}_${this.toStr}.${exportExtension(format)}`);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, "Erreur lors de l'export."));
      }
    });
  }
}
