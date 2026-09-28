import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingService, JournalEntryDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import {
  firstDayOfYearLocalYmd,
  parseLocalDateString,
  todayLocalYmd,
  validateDateRange
} from '../shared/accounting-date-utils';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Correction de masse d'écritures VALIDÉES par extourne.
 * <p>
 * Une écriture validée ne se modifie jamais : elle est contre-passée par une écriture miroir, ce
 * qui préserve la piste d'audit. L'écran ne liste donc que les écritures validées et NON encore
 * extournées ; le motif est obligatoire et l'opération demande confirmation (elle n'est pas annulable).
 * </p>
 */
@Component({
  selector: 'app-mass-reversal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent
  ],
  template: `
    <app-page-header
      title="Correction en lot par extourne" i18n-title="@@accounting.mass-reversal.correction.en.lot.par.extourne.a8fc388a"
      subtitle="Contre-passer des écritures validées — la piste d'audit est préservée, rien n'est modifié" i18n-subtitle="@@accounting.mass-reversal.contre.passer.des.ecritures.validees.la.61e35c3b" />

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Période des écritures à corriger" i18n-ariaLabel="@@accounting.mass-reversal.periode.des.ecritures.a.corriger.fb377df4">
        <div accountingFilterFields class="mr-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="mr-from" i18n="@@accounting.mass-reversal.du.84814985">Du</label>
            <input id="mr-from" type="date" [(ngModel)]="fromStr" class="accounting-filter-input" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="mr-to" i18n="@@accounting.mass-reversal.au.7a1732d5">Au</label>
            <input id="mr-to" type="date" [(ngModel)]="toStr" class="accounting-filter-input" />
          </div>
        </div>
        <div accountingFilterActions>
          <app-button variant="secondary" icon="pi pi-refresh" type="button"
            (click)="load()" [disabled]="busy()" ariaLabel="Charger les écritures validées" i18n-ariaLabel="@@accounting.mass-reversal.charger.les.ecritures.validees.36cc82a5" i18n="@@accounting.mass-reversal.charger.8f860300"> Charger </app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" i18n-retryLabel="@@accounting.mass-reversal.reessayer.c4f78b12" (retry)="load()" />

    @if (successMessage(); as msg) {
      <div class="mr-success" role="status"><i class="pi pi-check-circle" aria-hidden="true"></i><span>{{ msg }}</span></div>
    }

    <div class="card mr-actions-card">
      <div class="mr-actions">
        <div class="mr-field mr-field-grow">
          <label class="accounting-filter-label" for="mr-reason" i18n="@@accounting.mass-reversal.motif.de.correction.obligatoire.10f7e33a">Motif de correction (obligatoire)</label>
          <input id="mr-reason" type="text" [(ngModel)]="reason" class="accounting-filter-input"
            placeholder="Ex. erreur d'imputation sur le compte 607" i18n-placeholder="@@accounting.mass-reversal.ex.erreur.d.imputation.sur.le.compte.607.c37cab5a" [disabled]="busy()" />
        </div>
        <div class="mr-action-buttons">
          <app-button variant="danger" icon="pi pi-replay" type="button"
            (click)="confirmReversal()" [disabled]="busy() || selectedIds().length === 0 || !reason.trim()"
            ariaLabel="Extourner les écritures sélectionnées" i18n-ariaLabel="@@accounting.mass-reversal.extourner.les.ecritures.selectionnees.096d149f" i18n="@@accounting.mass-reversal.extourner.92243f6c">
            Extourner ({{ selectedIds().length }})
          </app-button>
        </div>
      </div>
      <p class="mr-help" i18n="@@accounting.mass-reversal.chaque.ecriture.selectionnee.recoit.une.7552cf93">
        <ng-container> Chaque écriture sélectionnée reçoit une </ng-container> <strong>écriture miroir</strong> qui l'annule ; l'originale
        reste intacte et marquée « extournée ». Les brouillons et les écritures déjà extournées sont ignorés.
      </p>
    </div>

    @if (pendingConfirm()) {
      <div class="card mr-confirm" role="alertdialog">
        <p class="mr-confirm-text" i18n="@@accounting.mass-reversal.extourner.ecriture.s.avec.le.motif.cette.19fb813e">
          <ng-container> Extourner </ng-container> <strong>{{ selectedIds().length }}</strong> écriture(s) avec le motif
          « {{ reason.trim() }} » ? <strong>Cette opération n'est pas annulable.</strong>
        </p>
        <div class="mr-confirm-actions">
          <app-button variant="secondary" type="button" (click)="pendingConfirm.set(false)" [disabled]="busy()" i18n="@@accounting.mass-reversal.annuler.49ba3292">Annuler</app-button>
          <app-button variant="danger" type="button" (click)="applyReversal()" [disabled]="busy()" i18n="@@accounting.mass-reversal.confirmer.l.extourne.e80c2b00">Confirmer l'extourne</app-button>
        </div>
      </div>
    }

    <div class="card mr-table-card">
      <p-table [value]="entries()" [paginator]="true" [rows]="25" [rowsPerPageOptions]="[25, 50, 100]"
        [loading]="loading()" [rowHover]="true" styleClass="p-datatable-sm accounting-datatable">
        <ng-template pTemplate="header">
          <tr>
            <th style="width:3rem">
              <input type="checkbox" [checked]="allSelected()" (change)="toggleAll($event)" aria-label="Tout sélectionner" i18n-aria-label="@@accounting.mass-reversal.tout.selectionner.06f2c1c0" />
            </th>
            <th scope="col" i18n="@@accounting.mass-reversal.journal.57d7f743">Journal</th>
            <th scope="col" i18n="@@accounting.mass-reversal.n.754e6095">N°</th>
            <th scope="col" i18n="@@accounting.mass-reversal.date.eb9a4bc1">Date</th>
            <th scope="col" i18n="@@accounting.mass-reversal.libelle.f5485bba">Libellé</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-e>
          <tr>
            <td><input type="checkbox" [checked]="isSelected(e.id)" (change)="toggle(e.id)" [attr.aria-label]="loc_ui_tern_selectionner_aaed53 + e.journalCode + ' ' + e.entryNumber" /></td>
            <td><span class="mr-code">{{ e.journalCode }}</span></td>
            <td>{{ e.entryNumber }}</td>
            <td>{{ e.entryDate | date : 'shortDate' }}</td>
            <td>{{ e.label }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="5" style="text-align:center;padding:2rem" i18n="@@accounting.mass-reversal.aucune.ecriture.validee.extournable.sur.la.perio.84101d06">Aucune écriture validée extournable sur la période.</td></tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .mr-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .mr-actions-card, .mr-table-card { padding:var(--spacing-5); }
    .mr-actions { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .mr-field { display:flex; flex-direction:column; gap:var(--spacing-2); min-width:0; }
    .mr-field-grow { flex:1 1 320px; }
    .mr-action-buttons { display:flex; gap:var(--spacing-2); align-items:flex-end; }
    .mr-code { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight:500; }
    .mr-help { margin:var(--spacing-3) 0 0; font-size:var(--font-size-sm); color:var(--color-text-secondary); }
    .mr-success {
      display:flex; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-4);
      padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md);
      background:var(--color-success-50,#f0fdf4); border:1px solid var(--color-success-200,#bbf7d0);
      color:var(--color-success-700,#15803d); font-weight:var(--font-weight-medium);
    }
    .mr-confirm {
      padding:var(--spacing-4); margin-bottom:var(--spacing-4);
      background:var(--color-danger-50,#fef2f2); border:1px solid var(--color-danger-200,#fecaca);
    }
    .mr-confirm-text { margin:0 0 var(--spacing-3); font-size:var(--font-size-sm); color:var(--color-danger-700,#b91c1c); }
    .mr-confirm-actions { display:flex; gap:var(--spacing-2); justify-content:flex-end; }
  `
})
export class MassReversalComponent implements OnInit {
  readonly loc_ui_tern_selectionner_aaed53 = $localize`:@@ui.tern.selectionner.aaed53:Sélectionner `;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);

  fromStr = '';
  toStr = '';
  reason = '';

  readonly entries = signal<JournalEntryDto[]>([]);
  private readonly selected = signal<Set<string>>(new Set());
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly acting = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly pendingConfirm = signal(false);

  readonly selectedIds = computed(() => [...this.selected()]);
  readonly allSelected = computed(() => this.entries().length > 0 && this.selected().size === this.entries().length);

  busy(): boolean {
    return this.loading() || this.acting();
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  constructor() {
    this.fromStr = firstDayOfYearLocalYmd();
    this.toStr = todayLocalYmd();
  }

  ngOnInit(): void {
    this.load();
  }

  toggle(id: string): void {
    const next = new Set(this.selected());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selected.set(next);
    this.pendingConfirm.set(false);
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selected.set(checked ? new Set(this.entries().map(e => e.id)) : new Set());
    this.pendingConfirm.set(false);
  }

  load(): void {
    const from = parseLocalDateString(this.fromStr);
    const to = parseLocalDateString(this.toStr);
    const vr = validateDateRange(from, to);
    if (!vr.valid) {
      this.error.set(vr.message ?? $localize`:@@ui.tern.periode.invalide.a64d6e:Période invalide.`);
      return;
    }
    this.error.set(null);
    this.successMessage.set(null);
    this.pendingConfirm.set(false);
    this.loading.set(true);
    this.selected.set(new Set());
    this.api.getJournal(undefined, from, to).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          // Seules les écritures validées et NON déjà extournées sont extournables.
          this.entries.set(res.data.filter(e => !e.isDraft && !e.isReversed));
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.mass-reversal.ts.erreur.reseau.0683007f:Erreur réseau`));
      }
    });
  }

  confirmReversal(): void {
    if (this.selectedIds().length === 0 || !this.reason.trim() || this.busy()) return;
    this.pendingConfirm.set(true);
  }

  applyReversal(): void {
    const ids = this.selectedIds();
    if (ids.length === 0 || !this.reason.trim() || this.busy()) return;
    this.error.set(null);
    this.successMessage.set(null);
    this.acting.set(true);
    this.api.massReverseEntries(ids, this.reason.trim()).subscribe({
      next: res => {
        this.acting.set(false);
        this.pendingConfirm.set(false);
        if (res.success && res.data) {
          this.successMessage.set($localize`:@@accounting.mass-reversal.ts.reversed.ecriture.s.extournee.s.skipped.63901506:${res.data.reversed}:reversed: écriture(s) extournée(s), ${res.data.skipped}:skipped: ignorée(s).`);
          this.reason = '';
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.extourne.a.echoue.0069fe:L'extourne a échoué.`);
        }
      },
      error: err => {
        this.acting.set(false);
        this.pendingConfirm.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.mass-reversal.ts.erreur.reseau.lors.de.l.extourne.f214327e:Erreur réseau lors de l'extourne.`));
      }
    });
  }
}
