import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
import { AccountingService, JournalSearchFilters, JournalSearchRowDto } from '../services/accounting.service';
import { FUNCTIONAL_CURRENCY } from '../manual-entry/models/entry-form.model';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-entry-search',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent, AccountingCorrectionBannerComponent],
  template: `
    <app-page-header title="Recherche d'écriture" i18n-title="Recherche d'écriture" subtitle="Recherche multicritère des lignes d'écriture" />

    <app-accounting-correction-banner />

    <div class="card es-filters">
      <div class="es-grid">
        <div class="es-field"><label class="es-lbl" for="es-acc" i18n="@@accounting.entry-search.compte.c45740bb">Compte</label><input id="es-acc" class="es-inp" [(ngModel)]="f.account" placeholder="Ex. 411" i18n-placeholder="Ex. 411" /></div>
        <div class="es-field"><label class="es-lbl" for="es-jrn" i18n="@@accounting.entry-search.journal.57d7f743">Journal</label>
          <select id="es-jrn" class="es-inp" [(ngModel)]="f.journalCode">
            <option [ngValue]="null" i18n="@@accounting.entry-search.tous.b97ae3b4">Tous</option>
            @for (jc of journalCodes; track jc) { <option [value]="jc">{{ jc }}</option> }
          </select>
        </div>
        <div class="es-field"><label class="es-lbl" for="es-from" i18n="@@accounting.entry-search.du.84814985">Du</label><input id="es-from" type="date" class="es-inp" [(ngModel)]="f.from" /></div>
        <div class="es-field"><label class="es-lbl" for="es-to" i18n="@@accounting.entry-search.au.7a1732d5">Au</label><input id="es-to" type="date" class="es-inp" [(ngModel)]="f.to" /></div>
        <div class="es-field"><label class="es-lbl" for="es-min" i18n="@@accounting.entry-search.montant.min.e00fa4de">Montant min</label><input id="es-min" type="number" class="es-inp" [(ngModel)]="f.minAmount" /></div>
        <div class="es-field"><label class="es-lbl" for="es-max" i18n="@@accounting.entry-search.montant.max.44599630">Montant max</label><input id="es-max" type="number" class="es-inp" [(ngModel)]="f.maxAmount" /></div>
        <div class="es-field es-field-wide"><label class="es-lbl" for="es-lbl" i18n="@@accounting.entry-search.libelle.contient.694f61b3">Libellé contient</label><input id="es-lbl" class="es-inp" [(ngModel)]="f.label" /></div>
        <div class="es-field"><label class="es-lbl" for="es-let" i18n="@@accounting.entry-search.lettrage.cfcdd333">Lettrage</label><input id="es-let" class="es-inp" [(ngModel)]="f.lettering" /></div>
        <div class="es-field"><label class="es-lbl" for="es-piece" i18n="@@accounting.entry-search.ref.piece.16d07789">Réf. pièce</label><input id="es-piece" class="es-inp" [(ngModel)]="f.pieceRef" placeholder="Contient…" i18n-placeholder="Contient…" /></div>
        <div class="es-field"><label class="es-lbl" for="es-st" i18n="@@accounting.entry-search.statut.659499f3">Statut</label>
          <select id="es-st" class="es-inp" [(ngModel)]="f.status">
            <option [ngValue]="null" i18n="@@accounting.entry-search.tous.b97ae3b4">Tous</option>
            <option [ngValue]="0" i18n="@@accounting.entry-search.brouillon.57d2d7a7">Brouillon</option>
            <option [ngValue]="1" i18n="@@accounting.entry-search.validee.2cc6c327">Validée</option>
            <option [ngValue]="2" i18n="@@accounting.entry-search.cloturee.da2e2bc8">Clôturée</option>
          </select>
        </div>
      </div>
      <div class="es-actions">
        <app-button variant="primary" icon="pi pi-search" type="button" (click)="search()" [disabled]="loading()" i18n="@@accounting.entry-search.rechercher.91f7d3e9">Rechercher</app-button>
        <app-button variant="secondary" icon="pi pi-times" type="button" (click)="reset()" [disabled]="loading()" i18n="@@accounting.entry-search.reinitialiser.e0e2ad54">Réinitialiser</app-button>
      </div>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    @if (searched()) {
      <div class="card es-results">
        <p class="es-count">{{ rows().length }} ligne(s) — limité à 200</p>
        <p-table [value]="rows()" [loading]="loading()" [paginator]="rows().length > 25" [rows]="25" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.entry-search.date.eb9a4bc1">Date</th><th scope="col" i18n="@@accounting.entry-search.journal.57d7f743">Journal</th><th scope="col" i18n="@@accounting.entry-search.n.754e6095">N°</th>
              <th scope="col" i18n="@@accounting.entry-search.piece.954bbc8c">Pièce</th>
              <th scope="col" i18n="@@accounting.entry-search.compte.c45740bb">Compte</th><th scope="col" i18n="@@accounting.entry-search.libelle.f5485bba">Libellé</th>
              @if (hasForeignCurrency()) { <th scope="col" i18n="@@accounting.entry-search.devise.eb2e42c4">Devise</th> }
              <th scope="col" class="es-amt" i18n="@@accounting.entry-search.debit.f528224f">Débit</th><th scope="col" class="es-amt" i18n="@@accounting.entry-search.credit.19194bdf">Crédit</th>
              <th scope="col" i18n="@@accounting.entry-search.lettrage.cfcdd333">Lettrage</th><th scope="col" i18n="@@accounting.entry-search.statut.659499f3">Statut</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td>{{ r.entryDate | date : 'shortDate' }}</td>
              <td>{{ r.journalCode }}</td>
              <td>{{ r.entryNumber }}</td>
              <td class="es-mono">{{ r.pieceRef }}</td>
              <td class="es-mono">{{ r.accountNumber }}</td>
              <td>{{ r.label }}</td>
              @if (hasForeignCurrency()) {
                <td class="es-mono">
                  @if (r.currencyCode && r.currencyCode !== functionalCurrency) {
                    {{ r.currencyCode }} {{ r.amountInCurrency | number : '1.2-2' }}
                  } @else {
                    —
                  }
                </td>
              }
              <td class="es-amt">{{ r.debit | number : '1.3-3' }}</td>
              <td class="es-amt">{{ r.credit | number : '1.3-3' }}</td>
              <td>{{ r.letteringCode }}</td>
              <td><span class="es-badge" [class.es-badge-draft]="r.isDraft">{{ r.isDraft ? loc_ui_tern_brouillon_57d2d7 : r.status === 2 ? loc_ui_tern_cloturee_da2e2b : loc_ui_tern_validee_2cc6c3 }}</span></td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="10" class="es-empty" i18n="@@accounting.entry-search.aucune.ecriture.ne.correspond.aux.criteres.392fa480">Aucune écriture ne correspond aux critères.</td></tr>
          </ng-template>
        </p-table>
      </div>
    }
  `,
  styles: `
    .es-filters, .es-results { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .es-grid { display: flex; flex-wrap: wrap; gap: var(--spacing-3); }
    .es-field { display: flex; flex-direction: column; gap: var(--spacing-1); flex: 1 1 9rem; min-width: 7rem; }
    .es-field-wide { flex: 2 1 14rem; }
    .es-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .es-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .es-actions { display: flex; gap: var(--spacing-3); margin-top: var(--spacing-4); }
    .es-count { margin: 0 0 var(--spacing-3); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .es-amt { text-align: right; font-variant-numeric: tabular-nums; }
    .es-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .es-badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d); }
    .es-badge-draft { background: var(--color-warning-100, #fef3c7); color: var(--color-warning-700, #b45309); }
    .es-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
  `
})
export class EntrySearchComponent implements OnInit {
  readonly loc_ui_tern_brouillon_57d2d7 = $localize`:@@ui.tern.brouillon.57d2d7:Brouillon`;
  readonly loc_ui_tern_cloturee_da2e2b = $localize`:@@ui.tern.cloturee.da2e2b:Clôturée`;
  readonly loc_ui_tern_validee_2cc6c3 = $localize`:@@ui.tern.validee.2cc6c3:Validée`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly route = inject(ActivatedRoute);
  readonly journalCodes = ['JV', 'JA', 'JC', 'JB', 'JOD', 'JIM', 'JAN'];

  f: JournalSearchFilters = {};
  readonly rows = signal<JournalSearchRowDto[]>([]);

  readonly functionalCurrency = FUNCTIONAL_CURRENCY;

  /** La colonne n'apparaît que si le résultat porte au moins une opération en devise. */
  readonly hasForeignCurrency = computed(() =>
    this.rows().some(r => (r.currencyCode || FUNCTIONAL_CURRENCY) !== FUNCTIONAL_CURRENCY)
  );
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searched = signal(false);

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const setStr = (key: keyof JournalSearchFilters, param: string | null) => {
      if (param != null && param !== '') (this.f as Record<string, unknown>)[key] = param;
    };
    setStr('account', qp.get('account'));
    setStr('journalCode', qp.get('journalCode'));
    setStr('from', qp.get('from'));
    setStr('to', qp.get('to'));
    setStr('label', qp.get('label'));
    setStr('lettering', qp.get('lettering'));
    setStr('pieceRef', qp.get('pieceRef'));
    const status = qp.get('status');
    if (status != null && status !== '') this.f.status = Number(status);
    const minAmount = qp.get('minAmount');
    if (minAmount) this.f.minAmount = Number(minAmount);
    const maxAmount = qp.get('maxAmount');
    if (maxAmount) this.f.maxAmount = Number(maxAmount);
    const entryNumber = qp.get('entryNumber');
    if (entryNumber) this.f.entryNumber = Number(entryNumber);

    if (qp.get('autoSearch') === '1') this.search();
  }

  search(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.searchJournalEntries({ ...this.f, take: 200 }).subscribe({
      next: res => {
        this.loading.set(false);
        this.searched.set(true);
        if (res.success && res.data) this.rows.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => { this.loading.set(false); this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau')); }
    });
  }

  reset(): void {
    this.f = {};
    this.rows.set([]);
    this.searched.set(false);
    this.error.set(null);
  }
}
