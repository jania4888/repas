import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingService, JournalEntryDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { AccountingJournalTab } from '../shared/accounting-journal-tabs.model';
import { AuthService } from '@core/services/auth.service';
import { canDeleteDraftAccountingEntries } from '@core/utils/accounting-access';
import {
  firstDayOfYearLocalYmd,
  parseLocalDateString,
  todayLocalYmd,
  validateDateRange
} from '../shared/accounting-date-utils';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Modifications de masse des écritures EN BROUILLARD (journal / date / libellé) + suppression en lot.
 * Écran séparé pour ne pas toucher au journal ; n'affiche et n'agit que sur des brouillons —
 * le serveur ignore de toute façon tout id non-brouillon.
 */
@Component({
  selector: 'app-draft-batch',
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
      title="Écritures en brouillard — édition en lot" i18n-title="@@accounting.draft-batch.ecritures.en.brouillard.edition.en.lot.d092258e"
      subtitle="Corriger journal, date ou libellé d'un lot de brouillons, ou les supprimer. Le validé n'est jamais touché." i18n-subtitle="@@accounting.draft-batch.corriger.journal.date.ou.libelle.d.un.lo.182b70e7" />

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Période des brouillons" i18n-ariaLabel="@@accounting.draft-batch.periode.des.brouillons.5ffeef2b">
        <div accountingFilterFields class="db-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="db-from" i18n="@@accounting.draft-batch.du.84814985">Du</label>
            <input id="db-from" type="date" [(ngModel)]="fromStr" class="accounting-filter-input" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="db-to" i18n="@@accounting.draft-batch.au.7a1732d5">Au</label>
            <input id="db-to" type="date" [(ngModel)]="toStr" class="accounting-filter-input" />
          </div>
        </div>
        <div accountingFilterActions>
          <app-button variant="secondary" icon="pi pi-refresh" type="button"
            (click)="load()" [disabled]="busy()" ariaLabel="Charger les brouillons" i18n-ariaLabel="@@accounting.draft-batch.charger.les.brouillons.8a9a3755" i18n="@@accounting.draft-batch.charger.8f860300"> Charger </app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" i18n-retryLabel="@@accounting.draft-batch.reessayer.c4f78b12" (retry)="load()" />

    @if (successMessage(); as msg) {
      <div class="db-success" role="status"><i class="pi pi-check-circle" aria-hidden="true"></i><span>{{ msg }}</span></div>
    }

    <div class="card db-actions-card">
      <div class="db-actions">
        <div class="db-field">
          <label class="accounting-filter-label" for="db-journal" i18n="@@accounting.draft-batch.nouveau.journal.a81ef718">Nouveau journal</label>
          <select id="db-journal" [(ngModel)]="newJournal" class="accounting-filter-input" [disabled]="busy()">
            <option value="" i18n="@@accounting.draft-batch.inchange.0b0415d4">— inchangé —</option>
            @for (j of journals(); track j.code) { <option [value]="j.code">{{ j.code }} — {{ j.label }}</option> }
          </select>
        </div>
        <div class="db-field">
          <label class="accounting-filter-label" for="db-date" i18n="@@accounting.draft-batch.nouvelle.date.e513e19b">Nouvelle date</label>
          <input id="db-date" type="date" [(ngModel)]="newDate" class="accounting-filter-input" [disabled]="busy()" />
        </div>
        <div class="db-field db-field-grow">
          <label class="accounting-filter-label" for="db-label" i18n="@@accounting.draft-batch.nouveau.libelle.90a78230">Nouveau libellé</label>
          <input id="db-label" type="text" [(ngModel)]="newLabel" class="accounting-filter-input" placeholder="— inchangé —" i18n-placeholder="@@accounting.draft-batch.inchange.0b0415d4" [disabled]="busy()" />
        </div>
        <div class="db-action-buttons">
          <app-button variant="primary" icon="pi pi-pencil" type="button"
            (click)="applyUpdate()" [disabled]="busy() || selectedIds().length === 0 || !hasChange()"
            ariaLabel="Appliquer les modifications aux brouillons sélectionnés" i18n-ariaLabel="@@accounting.draft-batch.appliquer.les.modifications.aux.brouillo.35b429e2" i18n="@@accounting.draft-batch.modifier.30c76365">
            Modifier ({{ selectedIds().length }})
          </app-button>
          <app-button variant="danger" icon="pi pi-trash" type="button"
            (click)="applyDelete()" [disabled]="busy() || selectedIds().length === 0 || !canDelete()"
            [attr.ariaLabel]="canDelete() ? loc_ui_tern_supprimer_les_brouillons_selectionnes_1ccce3 : loc_ui_tern_suppression_reservee_au_cabinet_en_mode_de_27d9cd" i18n="@@accounting.draft-batch.supprimer.56e7b49a">
            Supprimer ({{ selectedIds().length }})
          </app-button>
        </div>
      </div>
    </div>

    <div class="card db-table-card">
      <p-table [value]="drafts()" [paginator]="true" [rows]="25" [rowsPerPageOptions]="[25, 50, 100]"
        [loading]="loading()" [rowHover]="true" styleClass="p-datatable-sm accounting-datatable">
        <ng-template pTemplate="header">
          <tr>
            <th style="width:3rem">
              <input type="checkbox" [checked]="allSelected()" (change)="toggleAll($event)" aria-label="Tout sélectionner" i18n-aria-label="@@accounting.draft-batch.tout.selectionner.06f2c1c0" />
            </th>
            <th scope="col" i18n="@@accounting.draft-batch.journal.57d7f743">Journal</th>
            <th scope="col" i18n="@@accounting.draft-batch.n.754e6095">N°</th>
            <th scope="col" i18n="@@accounting.draft-batch.date.eb9a4bc1">Date</th>
            <th scope="col" i18n="@@accounting.draft-batch.libelle.f5485bba">Libellé</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-e>
          <tr>
            <td><input type="checkbox" [checked]="isSelected(e.id)" (change)="toggle(e.id)" [attr.aria-label]="loc_ui_tern_selectionner_aaed53 + e.journalCode + ' ' + e.entryNumber" /></td>
            <td><span class="db-code">{{ e.journalCode }}</span></td>
            <td>{{ e.entryNumber }}</td>
            <td>{{ e.entryDate | date : 'shortDate' }}</td>
            <td>{{ e.label }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="5" style="text-align:center;padding:2rem" i18n="@@accounting.draft-batch.aucune.ecriture.en.brouillard.sur.la.periode.c26c42fb">Aucune écriture en brouillard sur la période.</td></tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .db-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .db-actions-card, .db-table-card { padding:var(--spacing-5); }
    .db-actions { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .db-field { display:flex; flex-direction:column; gap:var(--spacing-2); min-width:0; }
    .db-field-grow { flex:1 1 220px; }
    .db-action-buttons { display:flex; gap:var(--spacing-2); align-items:flex-end; }
    .db-code { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight:500; }
    .db-success {
      display:flex; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-4);
      padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md);
      background:var(--color-success-50,#f0fdf4); border:1px solid var(--color-success-200,#bbf7d0);
      color:var(--color-success-700,#15803d); font-weight:var(--font-weight-medium);
    }
  `
})
export class DraftBatchComponent implements OnInit {
  readonly loc_ui_tern_supprimer_les_brouillons_selectionnes_1ccce3 = $localize`:@@ui.tern.supprimer.les.brouillons.selectionnes.1ccce3:Supprimer les brouillons sélectionnés`;
  readonly loc_ui_tern_suppression_reservee_au_cabinet_en_mode_de_27d9cd = $localize`:@@ui.tern.suppression.reservee.au.cabinet.en.mode.de.27d9cd:Suppression réservée au cabinet en mode délégué`;
  readonly loc_ui_tern_selectionner_aaed53 = $localize`:@@ui.tern.selectionner.aaed53:Sélectionner `;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly journalCatalog = inject(AccountingJournalCatalogService);
  private readonly auth = inject(AuthService);

  readonly canDelete = computed(() => canDeleteDraftAccountingEntries(this.auth));

  fromStr = '';
  toStr = '';
  newJournal = '';
  newDate = '';
  newLabel = '';

  readonly journals = signal<readonly AccountingJournalTab[]>([]);
  readonly drafts = signal<JournalEntryDto[]>([]);
  private readonly selected = signal<Set<string>>(new Set());
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly acting = signal(false);
  readonly successMessage = signal<string | null>(null);

  readonly selectedIds = computed(() => [...this.selected()]);
  readonly allSelected = computed(() => this.drafts().length > 0 && this.selected().size === this.drafts().length);

  busy(): boolean {
    return this.loading() || this.acting();
  }

  hasChange(): boolean {
    return !!this.newJournal || !!this.newDate || !!this.newLabel.trim();
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  constructor() {
    this.fromStr = firstDayOfYearLocalYmd();
    this.toStr = todayLocalYmd();
  }

  ngOnInit(): void {
    this.journalCatalog.list().subscribe(list => this.journals.set(list));
    this.load();
  }

  toggle(id: string): void {
    const next = new Set(this.selected());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selected.set(next);
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selected.set(checked ? new Set(this.drafts().map(d => d.id)) : new Set());
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
    this.loading.set(true);
    this.selected.set(new Set());
    this.api.getJournal(undefined, from, to).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          // Seuls les brouillons non-extourne sont éditables en lot (le serveur les ignore sinon).
          this.drafts.set(res.data.filter(e => e.isDraft && !e.isReversed));
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  applyUpdate(): void {
    const ids = this.selectedIds();
    if (ids.length === 0 || !this.hasChange() || this.busy()) return;
    this.error.set(null);
    this.successMessage.set(null);
    this.acting.set(true);
    this.api.massUpdateDrafts(ids, {
      newJournalCode: this.newJournal || undefined,
      newDate: this.newDate ? parseLocalDateString(this.newDate) : undefined,
      newLabel: this.newLabel.trim() || undefined
    }).subscribe({
      next: res => {
        this.acting.set(false);
        if (res.success && res.data) {
          this.successMessage.set(`${res.data.updated} brouillon(s) modifié(s), ${res.data.skipped} ignoré(s).`);
          this.resetChangeForm();
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.la.modification.a.echoue.5f6a29:La modification a échoué.`);
        }
      },
      error: err => {
        this.acting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau lors de la modification.'));
      }
    });
  }

  applyDelete(): void {
    const ids = this.selectedIds();
    if (ids.length === 0 || this.busy()) return;
    this.error.set(null);
    this.successMessage.set(null);
    this.acting.set(true);
    this.api.massDeleteDrafts(ids).subscribe({
      next: res => {
        this.acting.set(false);
        if (res.success && res.data) {
          this.successMessage.set(`${res.data.deleted} brouillon(s) supprimé(s), ${res.data.skipped} ignoré(s).`);
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.la.suppression.a.echoue.2be4e0:La suppression a échoué.`);
        }
      },
      error: err => {
        this.acting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau lors de la suppression.'));
      }
    });
  }

  private resetChangeForm(): void {
    this.newJournal = '';
    this.newDate = '';
    this.newLabel = '';
  }
}
