/// <reference types="@angular/localize" />
import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { catchError, concat, map, merge, of, skip, Subject, switchMap } from 'rxjs';
import { AccountingService, JournalEntryDto } from '../../services/accounting.service';
import { AuthService } from '@core/services/auth.service';
import { canEditDraftAccountingEntries } from '@core/utils/accounting-access';
import { EntryFormStore } from '../services/entry-form.store';
import { EntryReferenceStore } from '../services/entry-reference.store';
import {
  JOURNAL_HISTORY_TAKE,
  JournalHistoryDocument,
  buildJournalHistory,
  journalHistoryRange
} from './entry-journal-history.logic';

/** Déclenché après un enregistrement qui laisse l'écran de saisie ouvert. */
@Injectable()
export class EntryJournalHistoryRefresh {
  private readonly seq = signal(0);
  readonly token = this.seq.asReadonly();

  poke(): void {
    this.seq.update(n => n + 1);
  }
}

type HistoryLoad =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; entries: JournalEntryDto[] };

@Component({
  selector: 'app-entry-journal-history',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="entry-journal-history" aria-labelledby="entry-journal-history-title">
      <header class="entry-journal-history__head">
        <h2 id="entry-journal-history-title" class="entry-journal-history__title" i18n="@@accounting.entry-journal-history.title">Dernières écritures</h2>
        <p class="entry-journal-history__period">{{ periodLabel() }}</p>
      </header>

      @if (loading()) {
        <p class="entry-journal-history__state" i18n="@@accounting.entry-journal-history.loading">Chargement des dernières écritures…</p>
      } @else if (error()) {
        <p class="entry-journal-history__state entry-journal-history__state--error" role="alert">{{ error() }}</p>
        <button type="button" class="entry-journal-history__retry" (click)="reload()" i18n="@@accounting.entry-journal-history.retry">Réessayer</button>
      } @else if (documents().length === 0) {
        <p class="entry-journal-history__state" i18n="@@accounting.entry-journal-history.empty">Aucune écriture sur les 12 derniers mois pour ce journal.</p>
      } @else {
        <div class="entry-journal-history__scroll">
          @for (doc of documents(); track doc.id) {
            <article class="entry-journal-history__doc" [class.entry-journal-history__doc--current]="doc.isCurrent">
              <header class="entry-journal-history__doc-head">
                <p class="entry-journal-history__doc-meta">
                  <span>{{ doc.entryDate | date:'shortDate' }}</span>
                  <span>{{ doc.pieceDate ? (doc.pieceDate | date:'shortDate') : '—' }}</span>
                  <span class="entry-journal-history__doc-number">{{ doc.documentNumber }}</span>
                  @if (doc.pieceRef) {
                    <span>{{ pieceLabel(doc.pieceRef) }}</span>
                  }
                </p>
                <p class="entry-journal-history__doc-label">{{ doc.label }}</p>
                <p class="entry-journal-history__doc-amount">
                  @if (doc.imbalance === null) {
                    <span>{{ doc.amount | number:'1.3-3' }}</span>
                  } @else {
                    <span>{{ doc.imbalance | number:'1.3-3' }}</span>
                    <span class="entry-journal-history__badge" i18n="@@accounting.entry-journal-history.unbalanced">Non équilibrée</span>
                  }
                </p>
                <p class="entry-journal-history__doc-status">
                  <span class="entry-journal-history__badge">{{ statusLabel(doc) }}</span>
                  @if (doc.isReversed) {
                    <span class="entry-journal-history__badge" i18n="@@accounting.entry-journal-history.reversed">Extournée</span>
                  }
                  @if (doc.isCurrent) {
                    <span class="entry-journal-history__badge" i18n="@@accounting.entry-journal-history.current">Écriture en cours</span>
                  }
                </p>
                @if (doc.isDraft && canEdit()) {
                  <button
                    type="button"
                    class="entry-journal-history__open"
                    (click)="open(doc)"
                    [attr.aria-label]="openLabel(doc)">
                    <ng-container i18n="@@accounting.entry-journal-history.open">Ouvrir</ng-container>
                  </button>
                }
              </header>
              <table class="entry-journal-history__lines">
                <thead>
                  <tr>
                    <th scope="col" i18n="@@accounting.entry-journal-history.line">N°</th>
                    <th scope="col" i18n="@@accounting.entry-journal-history.account">Compte</th>
                    <th scope="col" i18n="@@accounting.entry-journal-history.label">Libellé</th>
                    <th scope="col" class="entry-journal-history__num" i18n="@@accounting.entry-journal-history.debit">Débit</th>
                    <th scope="col" class="entry-journal-history__num" i18n="@@accounting.entry-journal-history.credit">Crédit</th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of doc.lines; track line.lineNumber) {
                    <tr>
                      <td>{{ line.lineNumber }}</td>
                      <td>
                        <span class="entry-journal-history__account">{{ line.accountNumber }}</span>
                        @if (line.accountLabel) {
                          <span> — {{ line.accountLabel }}</span>
                        }
                      </td>
                      <td>{{ line.label }}</td>
                      <td class="entry-journal-history__num">{{ line.debit | number:'1.3-3' }}</td>
                      <td class="entry-journal-history__num">{{ line.credit | number:'1.3-3' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </article>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .entry-journal-history {
      margin-block-start: var(--spacing-4);
      padding: var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-background-surface, #fff);
    }
    .entry-journal-history__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--spacing-2);
      margin-block-end: var(--spacing-3);
    }
    .entry-journal-history__title {
      margin: 0;
      font-size: var(--font-size-md, 1rem);
      font-weight: var(--font-weight-semibold);
    }
    .entry-journal-history__period,
    .entry-journal-history__state {
      margin: 0;
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }
    .entry-journal-history__state--error { color: var(--color-error-700, #b91c1c); }
    .entry-journal-history__retry,
    .entry-journal-history__open {
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: transparent;
      padding-block: var(--spacing-1);
      padding-inline: var(--spacing-3);
      cursor: pointer;
      font-size: var(--font-size-sm);
    }
    .entry-journal-history__scroll {
      max-block-size: 22rem;
      overflow: auto;
    }
    .entry-journal-history__doc {
      border-block-start: 1px solid var(--color-border-subtle);
      padding-block: var(--spacing-3);
    }
    .entry-journal-history__doc--current {
      background: var(--color-info-50, #eff6ff);
    }
    .entry-journal-history__doc-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-2) var(--spacing-3);
      margin-block-end: var(--spacing-2);
    }
    .entry-journal-history__doc-meta,
    .entry-journal-history__doc-label,
    .entry-journal-history__doc-amount,
    .entry-journal-history__doc-status {
      margin: 0;
      font-size: var(--font-size-sm);
    }
    .entry-journal-history__doc-meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
    }
    .entry-journal-history__doc-number { font-weight: var(--font-weight-semibold); }
    .entry-journal-history__doc-label { flex: 1 1 12rem; }
    .entry-journal-history__doc-amount { font-variant-numeric: tabular-nums; }
    .entry-journal-history__badge {
      display: inline-block;
      margin-inline-start: var(--spacing-1);
      padding-block: 0;
      padding-inline: var(--spacing-2);
      border-radius: var(--radius-sm);
      background: var(--color-background-subtle);
      font-size: var(--font-size-xs);
    }
    .entry-journal-history__lines {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-size-sm);
    }
    .entry-journal-history__lines th,
    .entry-journal-history__lines td {
      padding-block: var(--spacing-1);
      padding-inline: var(--spacing-2);
      text-align: start;
    }
    .entry-journal-history__num { text-align: end; font-variant-numeric: tabular-nums; }
    .entry-journal-history__account { font-weight: var(--font-weight-semibold); }
  `
})
export class EntryJournalHistoryComponent {
  private readonly api = inject(AccountingService);
  private readonly store = inject(EntryFormStore);
  private readonly refs = inject(EntryReferenceStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly refreshBus = inject(EntryJournalHistoryRefresh, { optional: true });
  private readonly manualRefresh$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly documents = signal<JournalHistoryDocument[]>([]);
  readonly canEdit = computed(() => canEditDraftAccountingEntries(this.auth));
  readonly periodLabel = computed(() => {
    const code = this.store.journalCode();
    return $localize`:@@accounting.entry-journal-history.period:Journal ${code}:code: — 12 derniers mois`;
  });

  constructor() {
    const journalChanges$ = toObservable(this.store.journalCode);
    const afterSave$ = this.refreshBus
      ? toObservable(this.refreshBus.token).pipe(skip(1), map(() => this.store.journalCode()))
      : this.manualRefresh$.pipe(map(() => this.store.journalCode()));

    merge(journalChanges$, afterSave$, this.manualRefresh$.pipe(map(() => this.store.journalCode())))
      .pipe(
        switchMap(code => this.load(code)),
        takeUntilDestroyed()
      )
      .subscribe(result => queueMicrotask(() => this.apply(result)));
  }

  reload(): void {
    if (this.refreshBus) this.refreshBus.poke();
    else this.manualRefresh$.next();
  }

  open(doc: JournalHistoryDocument): void {
    if (!doc.isDraft || !this.canEdit()) return;
    void this.router.navigate(['/accounting/manual-entry'], {
      queryParams: { entryId: doc.id }
    });
  }

  statusLabel(doc: JournalHistoryDocument): string {
    if (doc.isDraft) return $localize`:@@accounting.entry-journal-history.draft:Brouillon`;
    if (doc.status === 2) return $localize`:@@accounting.entry-journal-history.closed:Clôturée`;
    return $localize`:@@accounting.entry-journal-history.validated:Validée`;
  }

  pieceLabel(pieceRef: string): string {
    return $localize`:@@accounting.entry-journal-history.piece:Pièce ${pieceRef}:ref:`;
  }

  openLabel(doc: JournalHistoryDocument): string {
    return $localize`:@@accounting.entry-journal-history.open-label:Ouvrir l'écriture ${doc.documentNumber}:number:`;
  }

  private load(code: string) {
    const { from, to } = journalHistoryRange();
    const networkError = $localize`:@@accounting.entry-journal-history.error:Impossible de charger les dernières écritures.`;
    return concat(
      of<HistoryLoad>({ state: 'loading' }),
      this.api.getJournal(code || undefined, from, to, JOURNAL_HISTORY_TAKE).pipe(
        map(res => {
          if (!res.success || !res.data) {
            return { state: 'error', message: res.error ?? networkError } satisfies HistoryLoad;
          }
          return { state: 'ready', entries: res.data } satisfies HistoryLoad;
        }),
        catchError(() => of<HistoryLoad>({ state: 'error', message: networkError }))
      )
    );
  }

  private apply(result: HistoryLoad): void {
    if (result.state === 'loading') {
      this.loading.set(true);
      this.error.set(null);
      this.documents.set([]);
      return;
    }
    this.loading.set(false);
    if (result.state === 'error') {
      this.documents.set([]);
      this.error.set(result.message);
      return;
    }
    this.error.set(null);
    this.documents.set(buildJournalHistory(result.entries, {
      currentEntryId: this.store.editingEntryId(),
      accountLabel: number => this.refs.findAccountByNumber(number)?.label ?? null
    }));
  }
}
