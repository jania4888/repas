/// <reference types="@angular/localize" />
import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  AccountingService,
  NctNoteCatalogEntryDto,
  NctNoteOverrideDto
} from '../services/accounting.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/** Ligne d'édition : entrée du catalogue enrichie de sa personnalisation éventuelle. */
interface NoteEditRow {
  number: number;
  defaultTitle: string;
  family: string;
  customTitle: string;
  customDescription: string;
  isHidden: boolean;
  /** Vrai si une personnalisation existe en base (active le bouton « Rétablir »). */
  hasOverride: boolean;
  saving: boolean;
}

/**
 * Personnalisation des notes annexes NCT pour un exercice : titre de remplacement, texte narratif,
 * masquage. La liste part du CATALOGUE (et non de la liasse), car une note masquée en est absente —
 * sans quoi un masquage serait irréversible.
 */
@Component({
  selector: 'app-nct-note-overrides-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonComponent],
  template: `
    <p-dialog
      header="Personnaliser les annexes" i18n-header="Personnaliser les annexes"
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [style]="{ width: '48rem' }"
      [draggable]="false"
      [closable]="true"
      styleClass="nno-dialog">
      <p class="nno-help">
        <ng-container i18n="@@accounting.nct-statements.exercice.e171e2b0"> Exercice </ng-container> <strong>{{ fiscalYear }}</strong>. Un champ laissé vide conserve le libellé du
        catalogue. Une note masquée disparaît de la liasse <em i18n="@@accounting.nct-statements.et.a5bc1d9b">et</em> de l'export PDF.
      </p>

      @if (loading()) {
        <p class="nno-help" i18n="@@accounting.nct-statements.chargement.01cba1df">Chargement…</p>
      } @else {
        <div class="nno-list">
          @for (row of rows(); track row.number) {
            <div class="nno-row" [class.nno-row--hidden]="row.isHidden">
              <div class="nno-row-head">
                <span class="nno-num">Note {{ row.number }}</span>
                <span class="nno-default">{{ row.defaultTitle }}</span>
                <label class="nno-hide">
                  <input type="checkbox" [(ngModel)]="row.isHidden" [disabled]="row.saving" />
                  Masquer
                </label>
              </div>
              <input
                type="text"
                class="nno-input"
                [(ngModel)]="row.customTitle"
                [disabled]="row.saving || row.isHidden"
                [placeholder]="row.defaultTitle" />
              <textarea
                class="nno-input nno-textarea"
                rows="2"
                [(ngModel)]="row.customDescription"
                [disabled]="row.saving || row.isHidden"
                placeholder="Texte narratif (facultatif)" i18n-placeholder="Texte narratif (facultatif)"></textarea>
              <div class="nno-row-actions">
                <app-button variant="secondary" size="sm" type="button"
                  (click)="save(row)" [disabled]="row.saving"
                  [ariaLabel]="loc_ui_tern_enregistrer_la_note_b39ca7 + row.number" i18n="@@accounting.nct-statements.enregistrer.f7c8bcd8"> Enregistrer </app-button>
                @if (row.hasOverride) {
                  <app-button variant="ghost" size="sm" type="button"
                    (click)="reset(row)" [disabled]="row.saving"
                    [ariaLabel]="loc_ui_tern_retablir_la_note_f1b0b0 + row.number" i18n="@@accounting.nct-statements.retablir.91f08ee4"> Rétablir </app-button>
                }
              </div>
            </div>
          }
        </div>
      }
    </p-dialog>
  `,
  styles: `
    .nno-help { font-size:var(--font-size-sm); color:var(--color-text-secondary); margin:0 0 var(--spacing-3); }
    .nno-list { display:flex; flex-direction:column; gap:var(--spacing-3); max-height:60vh; overflow-y:auto; }
    .nno-row { border:1px solid var(--color-border-subtle); border-radius:var(--radius-md); padding:var(--spacing-3); display:flex; flex-direction:column; gap:var(--spacing-2); }
    .nno-row--hidden { opacity:0.6; background:var(--color-background-subtle); }
    .nno-row-head { display:flex; align-items:center; gap:var(--spacing-3); flex-wrap:wrap; }
    .nno-num { font-weight:var(--font-weight-semibold); font-size:var(--font-size-sm); }
    .nno-default { color:var(--color-text-tertiary); font-size:var(--font-size-sm); flex:1 1 auto; }
    .nno-hide { display:flex; align-items:center; gap:var(--spacing-1); font-size:var(--font-size-sm); white-space:nowrap; }
    .nno-input { padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); background:var(--color-background-elevated); color:var(--color-text-primary); font-size:var(--font-size-sm); width:100%; }
    .nno-textarea { resize:vertical; font-family:inherit; }
    .nno-row-actions { display:flex; gap:var(--spacing-2); justify-content:flex-end; }
  `
})
export class NctNoteOverridesDialogComponent implements OnChanges {
  readonly loc_ui_tern_enregistrer_la_note_b39ca7 = $localize`:@@ui.tern.enregistrer.la.note.b39ca7:Enregistrer la note `;
  readonly loc_ui_tern_retablir_la_note_f1b0b0 = $localize`:@@ui.tern.retablir.la.note.f1b0b0:Rétablir la note `;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);

  @Input() visible = false;
  @Input() fiscalYear = new Date().getFullYear();
  @Output() visibleChange = new EventEmitter<boolean>();
  /** Émis après un enregistrement ou un rétablissement, pour que l'écran recharge la liasse. */
  @Output() changed = new EventEmitter<void>();

  readonly rows = signal<NoteEditRow[]>([]);
  readonly loading = signal(false);

  ngOnChanges(): void {
    if (this.visible && this.rows().length === 0) this.load();
  }

  onVisibleChange(v: boolean): void {
    this.visibleChange.emit(v);
    // Rechargement à la prochaine ouverture (l'exercice a pu changer entre-temps).
    if (!v) this.rows.set([]);
  }

  private load(): void {
    this.loading.set(true);
    this.api.getNctNoteCatalog().subscribe({
      next: cat => {
        const entries = cat.success && cat.data ? cat.data : [];
        this.api.getNctNoteOverrides(this.fiscalYear).subscribe({
          next: ov => {
            this.loading.set(false);
            this.rows.set(this.merge(entries, ov.success && ov.data ? ov.data : []));
          },
          error: () => {
            this.loading.set(false);
            this.rows.set(this.merge(entries, []));
          }
        });
      },
      error: err => {
        this.loading.set(false);
        this.notify('error', this.errors.extractErrorMessage(err, 'Impossible de charger le catalogue des annexes.'));
      }
    });
  }

  /** Catalogue × personnalisations : toutes les notes restent listées, masquées comprises. */
  private merge(entries: NctNoteCatalogEntryDto[], overrides: NctNoteOverrideDto[]): NoteEditRow[] {
    const byNumber = new Map(overrides.map(o => [o.noteNumber, o]));
    return entries.map(e => {
      const o = byNumber.get(e.number);
      return {
        number: e.number,
        defaultTitle: e.defaultTitle,
        family: e.family,
        customTitle: o?.customTitle ?? '',
        customDescription: o?.customDescription ?? '',
        isHidden: o?.isHidden ?? false,
        hasOverride: !!o,
        saving: false
      };
    });
  }

  save(row: NoteEditRow): void {
    row.saving = true;
    this.api.upsertNctNoteOverride({
      fiscalYear: this.fiscalYear,
      noteNumber: row.number,
      customTitle: row.customTitle.trim() || null,
      customDescription: row.customDescription.trim() || null,
      isHidden: row.isHidden
    }).subscribe({
      next: res => {
        row.saving = false;
        if (res.success) {
          row.hasOverride = true;
          this.notify('success', `Note ${row.number} personnalisée.`);
          this.changed.emit();
        } else {
          this.notify('error', res.error ?? $localize`:@@ui.tern.l.enregistrement.a.echoue.3f69ec:L'enregistrement a échoué.`);
        }
      },
      error: err => {
        row.saving = false;
        this.notify('error', this.errors.extractErrorMessage(err, "Erreur réseau lors de l'enregistrement."));
      }
    });
  }

  reset(row: NoteEditRow): void {
    row.saving = true;
    this.api.deleteNctNoteOverride(this.fiscalYear, row.number).subscribe({
      next: () => {
        row.saving = false;
        row.customTitle = '';
        row.customDescription = '';
        row.isHidden = false;
        row.hasOverride = false;
        this.notify('success', `Note ${row.number} rétablie.`);
        this.changed.emit();
      },
      error: err => {
        row.saving = false;
        this.notify('error', this.errors.extractErrorMessage(err, 'Erreur réseau lors du rétablissement.'));
      }
    });
  }

  private notify(severity: 'success' | 'error', detail: string): void {
    this.toast.add({ severity, summary: $localize`:@@nct-note-overrides-dialog.component.summary.Annexes_NCT:Annexes NCT`, detail, life: 4000 });
  }
}
