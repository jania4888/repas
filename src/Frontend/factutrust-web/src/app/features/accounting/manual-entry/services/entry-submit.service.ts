/// <reference types="@angular/localize" />
import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, from, of, toArray, catchError, map } from 'rxjs';
import { AccountingService } from '../../services/accounting.service';
import { EntryFormStore } from './entry-form.store';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

export interface SubmitResult {
  success: boolean;
  entryId?: string;
  journalCode: string;
  entryDate: string;
  attachmentFailures?: string[];
}

@Injectable()
export class EntrySubmitService {
  private readonly api = inject(AccountingService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly toast = inject(ToastService);

  submit(
    store: EntryFormStore,
    pendingFiles: File[],
    afterSuccess: 'reset' | 'navigate' | 'duplicate'
  ): Observable<SubmitResult> {
    const validation = store.validateSubmit();
    if (!validation.valid) {
      store.error.set(validation.error ?? 'Validation échouée.');
      return of({
        success: false,
        journalCode: store.journalCode(),
        entryDate: store.entryDate()
      });
    }

    store.error.set(null);
    store.successMsg.set(null);
    store.loading.set(true);

    const editingId = store.editingEntryId();
    const journalCode = store.journalCode();
    const entryDate = store.entryDate();

    const save$ = editingId
      ? this.api.updateDraftJournalEntry(editingId, store.buildUpdateRequest().request).pipe(
          map(res => ({
            ok: !!res.success,
            error: res.error,
            entryId: editingId as string | undefined
          }))
        )
      : this.api.createManualJournalEntry(store.buildCreateRequest().request).pipe(
          map(res => ({
            ok: !!res.success && !!res.data,
            error: res.error,
            entryId: res.data
          }))
        );

    return save$.pipe(
      concatMap(res => {
        if (!res.ok || !res.entryId) {
          store.loading.set(false);
          store.error.set(res.error ?? "Erreur lors de l'enregistrement.");
          return of({
            success: false,
            journalCode,
            entryDate
          } satisfies SubmitResult);
        }

        const entryId = res.entryId;
        if (editingId || pendingFiles.length === 0) {
          return of({
            success: true,
            entryId,
            journalCode,
            entryDate,
            attachmentFailures: []
          } satisfies SubmitResult);
        }

        return from(pendingFiles).pipe(
          concatMap(file =>
            this.api.uploadEntryAttachment(entryId, file).pipe(
              map(uploadRes => ({ file, ok: uploadRes.success })),
              catchError(() => of({ file, ok: false }))
            )
          ),
          toArray(),
          map(results => ({
            success: true,
            entryId,
            journalCode,
            entryDate,
            attachmentFailures: results.filter(r => !r.ok).map(r => r.file.name)
          }))
        );
      }),
      catchError(err => {
        store.loading.set(false);
        store.error.set(this.errorHandler.extractErrorMessage(err));
        return of({
          success: false,
          journalCode,
          entryDate
        });
      })
    );
  }

  handleSubmitSuccess(
    store: EntryFormStore,
    result: SubmitResult,
    afterSuccess: 'reset' | 'navigate' | 'duplicate',
    onNavigate: (journalCode: string, date: string) => void,
    onClearDraft: () => void
  ): void {
    store.loading.set(false);
    if (!result.success) return;

    const wasEdit = !!store.editingEntryId();
    store.successMsg.set(wasEdit
      ? 'Écriture mise à jour avec succès.'
      : 'Écriture enregistrée avec succès.');
    const detailSuffix = afterSuccess === 'reset'
      ? ' Le formulaire est prêt pour une nouvelle saisie.'
      : afterSuccess === 'duplicate'
        ? ' Les données sont conservées pour duplication.'
        : ' Redirection vers le journal…';

    this.toast.add({
      severity: 'success',
      summary: wasEdit ? 'Écriture mise à jour' : 'Écriture enregistrée',
      detail: wasEdit
        ? `L'écriture du journal ${result.journalCode} a été mise à jour.${detailSuffix}`
        : `L'écriture du journal ${result.journalCode} a été enregistrée.${detailSuffix}`,
      life: 5000
    });

    if (result.attachmentFailures && result.attachmentFailures.length > 0) {
      this.toast.add({
        severity: 'warn',
        summary: $localize`:@@entry-submit.service.summary.Pi_ces_jointes_p:Pièces jointes partielles`,
        detail: `Échec pour : ${result.attachmentFailures.join(', ')}. Vous pouvez les ajouter depuis le journal.`,
        life: 8000
      });
    }

    onClearDraft();

    if (afterSuccess === 'navigate') {
      onNavigate(result.journalCode, result.entryDate);
      store.resetForm();
    } else if (afterSuccess === 'reset') {
      store.resetForm();
    }
    // duplicate: keep form as-is
  }
}
