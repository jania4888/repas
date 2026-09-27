/// <reference types="@angular/localize" />
import { Component, EventEmitter, Input, OnChanges, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { RecurringContractDetail, RecurringContractService } from '@core/services/recurring-contract.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PERMISSIONS } from '@core/config/permission-keys';

/**
 * Onglet « Notes » : consultation et édition via PATCH /{id}/notes (autorisé à tout statut).
 * JAMAIS le PUT complet ici : refusé hors brouillon et à risque d'écrasement (B3).
 * Si le endpoint est absent (404 → 'unavailable'), l'onglet bascule en lecture seule.
 */
@Component({
  selector: 'app-contract-notes-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    <section class="ft-card-block">
      <h3 class="block-title"><i class="pi pi-comment"></i> Notes internes</h3>

      @if (readOnly()) {
        @if (notes) {
          <p class="notes">{{ notes }}</p>
        } @else {
          <p class="placeholder-note">Aucune note sur ce contrat.</p>
        }
      } @else {
        <textarea
          class="ft-input notes-input"
          rows="6"
          [(ngModel)]="notes"
          name="contractNotes"
          placeholder="Notes internes sur le contrat…">
        </textarea>
        <div class="actions">
          <app-button
            variant="primary"
            size="sm"
            icon="pi-check"
            [disabled]="saving()"
            (clicked)="save()">
            {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
          </app-button>
        </div>
      }
    </section>
  `,
  styles: [`
    .ft-card-block {
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-soft-sm, var(--shadow-sm));
      padding: var(--spacing-4);
    }

    .block-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-700);
      text-transform: uppercase;
      letter-spacing: 0.05em;

      .pi { color: var(--color-primary-600); }
    }

    .notes {
      color: var(--color-neutral-700);
      line-height: 1.6;
      white-space: pre-wrap;
      margin: 0;
    }

    .notes-input { width: 100%; resize: vertical; }

    .ft-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-family: inherit;
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
    }

    .ft-input:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 1px;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-3);
    }

    .placeholder-note {
      margin: 0;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-sm);
    }
  `]
})
export class ContractNotesTabComponent implements OnChanges {
  @Input({ required: true }) contract!: RecurringContractDetail;
  /** Émis après enregistrement réussi pour que la page parente mette à jour sa copie. */
  @Output() notesSaved = new EventEmitter<string | null>();

  private readonly service = inject(RecurringContractService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly saving = signal(false);
  /** Bascule lecture seule : endpoint PATCH absent côté serveur (phase 2 non déployée). */
  readonly unavailable = signal(false);

  notes = '';

  private readonly canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.update));

  readonly readOnly = computed(() => this.unavailable() || !this.canUpdate());

  ngOnChanges(): void {
    this.notes = this.contract.notes ?? '';
  }

  save(): void {
    this.saving.set(true);
    this.service.updateNotes(this.contract.id, this.notes || null).subscribe({
      next: result => {
        this.saving.set(false);
        if (result === 'unavailable') {
          this.unavailable.set(true);
          this.toast.add({
            severity: 'info',
            summary: $localize`:@@contract-notes.tab.summary.Fonction_indispo:Fonction indisponible`,
            detail: $localize`:@@contract-notes.tab.detail.Fonction_disponi:Fonction disponible après la mise à jour du serveur. Notes en lecture seule pour le moment.`
          });
          return;
        }
        this.toast.add({ severity: 'success', summary: $localize`:@@contract-notes.tab.summary.Notes_enregistr_:Notes enregistrées`, detail: $localize`:@@contract-notes.tab.detail.Les_notes_du_con:Les notes du contrat ont été mises à jour.` });
        this.notesSaved.emit(this.notes || null);
      },
      error: err => {
        this.saving.set(false);
        this.errorHandler.logError('RecurringContracts: update notes', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-notes.tab.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }
}
