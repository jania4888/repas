import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, ThirdPartyLedgerDto } from '../services/accounting.service';
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
import { FUNCTIONAL_CURRENCY } from '../manual-entry/models/entry-form.model';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Grand livre d'un tiers (client ou fournisseur) : solde d'ouverture + mouvements
 * avec solde progressif, réf. pièce et lettrage. Accessible par drill-down depuis
 * la balance auxiliaire (queryParams : thirdPartyId, kind, from, to, name).
 */
@Component({
  selector: 'app-third-party-ledger',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    TagModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    ButtonComponent,
    AccountingExportMenuComponent
  ],
  template: `
    <app-page-header
      [title]="loc_ui_tern_grand_livre_tiers_a3b44e + (ledger()?.thirdPartyName ? ' — ' + ledger()!.thirdPartyName : '')"
      subtitle="Mouvements d'un tiers avec solde progressif" i18n-subtitle="@@accounting.third-party-ledger.mouvements.d.un.tiers.avec.solde.progres.285a277f" />
    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Période du grand livre tiers" i18n-ariaLabel="@@accounting.third-party-ledger.periode.du.grand.livre.tiers.2a2472f0">
        <div accountingFilterFields class="tpl-toolbar-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="tpl-from" i18n="@@accounting.third-party-ledger.du.84814985">Du</label>
            <input id="tpl-from" type="date" [(ngModel)]="fromStr" class="accounting-filter-input" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="tpl-to" i18n="@@accounting.third-party-ledger.au.7a1732d5">Au</label>
            <input id="tpl-to" type="date" [(ngModel)]="toStr" class="accounting-filter-input" />
          </div>
        </div>
        <div accountingFilterActions>
          <app-button
            variant="secondary"
            icon="pi pi-arrow-left"
            iconPos="left"
            type="button"
            [routerLink]="['/accounting/auxiliary-balance']"
            ariaLabel="Retour à la balance auxiliaire" i18n-ariaLabel="@@accounting.third-party-ledger.retour.a.la.balance.auxiliaire.9855a346" i18n="@@accounting.third-party-ledger.balance.auxiliaire.e2a90270"> Balance auxiliaire </app-button>
          <app-button
            variant="secondary"
            icon="pi pi-refresh"
            iconPos="left"
            type="button"
            (click)="load()"
            [disabled]="loading() || !thirdPartyId"
            ariaLabel="Actualiser le grand livre du tiers" i18n-ariaLabel="@@accounting.third-party-ledger.actualiser.le.grand.livre.du.tiers.4b66dffd" i18n="@@accounting.third-party-ledger.actualiser.9d3b2a7d"> Actualiser </app-button>
          <app-accounting-export-menu
            [disabled]="loading() || exporting() || !thirdPartyId || (ledger()?.rows?.length ?? 0) === 0"
            (exportFormat)="onExport($event)" />
        </div>
      </app-accounting-filter-bar>
    </div>
    <app-accounting-status-banner
      variant="error"
      [message]="error() ?? ''"
      [showRetry]="!!error()"
      retryLabel="Réessayer" i18n-retryLabel="@@accounting.third-party-ledger.reessayer.c4f78b12"
      (retry)="load()" />
    @if (ledger(); as l) {
      <div class="tpl-opening" role="note" i18n="@@accounting.third-party-ledger.solde.d.ouverture.au.3f4dc63e">
        <span class="tpl-opening-label">Solde d'ouverture au {{ fromStr }} :</span>
        <span class="tpl-opening-value" [class.tpl-negative]="l.openingBalance < 0">
          {{ l.openingBalance | number : '1.3-3' }}
        </span>
      </div>
    }
    <p-table [value]="ledger()?.rows ?? []" [paginator]="true" [rows]="50" [rowsPerPageOptions]="[25, 50, 100]"
      [loading]="loading()" [rowHover]="true" [scrollable]="true" scrollHeight="flex"
      styleClass="p-datatable-sm accounting-datatable tpl-table"
      [showCurrentPageReport]="true" currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} mouvements" i18n-currentPageReportTemplate="@@accounting.third-party-ledger.affichage.de.first.a.last.sur.totalrecords.mouve.9c08ea88">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@accounting.third-party-ledger.date.eb9a4bc1">Date</th>
          <th i18n="@@accounting.third-party-ledger.journal.57d7f743">Journal</th>
          <th i18n="@@accounting.third-party-ledger.n.754e6095">N°</th>
          <th i18n="@@accounting.third-party-ledger.piece.954bbc8c">Pièce</th>
          <th i18n="@@accounting.third-party-ledger.compte.c45740bb">Compte</th>
          <th i18n="@@accounting.third-party-ledger.libelle.f5485bba">Libellé</th>
          @if (hasForeignCurrency()) { <th i18n="@@accounting.third-party-ledger.devise.eb2e42c4">Devise</th> }
          <th class="text-right" i18n="@@accounting.third-party-ledger.debit.f528224f">Débit</th>
          <th class="text-right" i18n="@@accounting.third-party-ledger.credit.19194bdf">Crédit</th>
          <th class="text-right" i18n="@@accounting.third-party-ledger.solde.e5977cf9">Solde</th>
          <th i18n="@@accounting.third-party-ledger.lettrage.cfcdd333">Lettrage</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r>
        <tr>
          <td data-label="Date">{{ r.entryDate | date : 'shortDate' }}</td>
          <td data-label="Journal">{{ r.journalCode }}</td>
          <td data-label="N°" class="tpl-num">{{ r.pieceNumber }}</td>
          <td data-label="Pièce" class="tpl-num">{{ r.pieceRef }}</td>
          <td data-label="Compte" class="tpl-num">{{ r.accountNumber }}</td>
          <td data-label="Libellé">{{ r.label }}</td>
          @if (hasForeignCurrency()) {
            <td class="tpl-num" data-label="Devise">
              @if (r.currencyCode && r.currencyCode !== functionalCurrency) {
                {{ r.currencyCode }} {{ r.amountInCurrency | number : '1.2-2' }}
              } @else {
                —
              }
            </td>
          }
          <td class="text-right tpl-num" data-label="Débit">{{ r.debit | number : '1.3-3' }}</td>
          <td class="text-right tpl-num" data-label="Crédit">{{ r.credit | number : '1.3-3' }}</td>
          <td class="text-right tpl-num" data-label="Solde" [class.tpl-negative]="r.runningBalance < 0">
            {{ r.runningBalance | number : '1.3-3' }}
          </td>
          <td data-label="Lettrage">
            @if (r.letteringCode) {
              <p-tag [value]="r.letteringCode" [severity]="r.letteringCode.startsWith('P') ? 'warn' : 'info'" [rounded]="true" />
            }
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td [attr.colspan]="hasForeignCurrency() ? 11 : 10" style="text-align:center;padding:2rem">
          @if (thirdPartyId) {<ng-container i18n="@@accounting.third-party-ledger.aucun.mouvement.sur.la.periode.9d40027a"> Aucun mouvement sur la période. </ng-container>} @else {<ng-container i18n="@@accounting.third-party-ledger.selectionnez.un.tiers.depuis.la.balance.4350652a"> Sélectionnez un tiers depuis la balance auxiliaire. </ng-container>}
        </td></tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .tpl-toolbar-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .text-right { text-align:right; }
    .tpl-num { font-variant-numeric:tabular-nums; }
    .tpl-negative { color:var(--color-danger-600, #dc2626); }
    .tpl-opening {
      display:flex; align-items:baseline; gap:var(--spacing-2);
      margin-bottom:var(--spacing-3); padding:var(--spacing-2) var(--spacing-3);
      background:var(--color-background-subtle); border:1px solid var(--color-border-subtle);
      border-radius:var(--radius-md); font-size:var(--font-size-sm);
    }
    .tpl-opening-label { color:var(--color-text-secondary); }
    .tpl-opening-value { font-weight:var(--font-weight-semibold); font-variant-numeric:tabular-nums; }
    :host ::ng-deep .tpl-table.p-datatable .p-datatable-table { min-width:60rem; }
  `
})
export class ThirdPartyLedgerComponent implements OnInit {
  readonly loc_ui_tern_grand_livre_tiers_a3b44e = $localize`:@@ui.tern.grand.livre.tiers.a3b44e:Grand livre tiers`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly route = inject(ActivatedRoute);

  thirdPartyId = '';
  kind = 1;
  fromStr = '';
  toStr = '';
  readonly ledger = signal<ThirdPartyLedgerDto | null>(null);

  readonly functionalCurrency = FUNCTIONAL_CURRENCY;

  /** La colonne n'apparaît que si le tiers porte au moins une opération en devise. */
  readonly hasForeignCurrency = computed(() =>
    (this.ledger()?.rows ?? []).some(r => (r.currencyCode || FUNCTIONAL_CURRENCY) !== FUNCTIONAL_CURRENCY)
  );
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    this.thirdPartyId = qp.get('thirdPartyId') ?? '';
    this.kind = Number(qp.get('kind')) || 1;
    this.fromStr = qp.get('from') || firstDayOfYearLocalYmd();
    this.toStr = qp.get('to') || todayLocalYmd();
    if (this.thirdPartyId) this.load();
  }

  load(): void {
    if (!this.thirdPartyId) {
      this.error.set('Aucun tiers sélectionné — passez par la balance auxiliaire.');
      return;
    }
    this.error.set(null);
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.loading.set(true);
    this.api.getThirdPartyLedger(this.thirdPartyId, this.kind, from, to).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.ledger.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  onExport(format: AccountingExportFormat): void {
    if (!this.thirdPartyId) return;
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.exporting.set(true);
    this.api.exportThirdPartyLedger(this.thirdPartyId, this.kind, from, to, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        downloadBlob(blob, `grand_livre_tiers_${this.fromStr}_${this.toStr}.${exportExtension(format)}`);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, "Erreur lors de l'export."));
      }
    });
  }
}
