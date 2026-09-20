import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { CustomField } from '@shared/studio-runtime/studio-runtime.models';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';
import { formatLabel } from '../shared/studio-text.util';
import { workflowErrorMessage } from '../workflows/studio-workflow-http.util';
import { StudioService } from '../studio.service';
import { STUDIO_RECORD_HISTORY_PAGE_SIZE, StudioRecordHistoryEntry } from './studio-record-history.models';
import {
  HISTORY_INLINE_CHANGES,
  StudioRecordHistoryChangeView,
  appendHistoryPage,
  formatHistoryChange,
  historyActionLabel,
  historyActionSeverity,
  historyUserLabel
} from './studio-record-history.util';

/**
 * Onglet « Historique » de la fiche enregistrement (4.7h4, D-47-65 ; maquette `d47-history-tab-v1-table.html`).
 * Lecture seule : `GET records/{entityKey}/{id}/history` (page 1 de 20 à l'initialisation — chargement à
 * l'activation de l'onglet, D-B4), « Charger plus » ajoute la page suivante dédoublonnée par `id` (D-B5),
 * changements inline `Champ : ancien → nouveau` avec repli au-delà de 5 (D-B6). Libellés de champ résolus
 * sur le schéma complet, actifs et inactifs (D-B8) ; repli sur la clé brute (`_raw`, champ supprimé).
 * Erreurs affichées en ligne (le service saute le toast global) ; une erreur de page suivante ⇒ toast `warn`
 * porté par le `<p-toast>` de la fiche. Aucune action d'écriture, aucun identifiant ni e-mail (S-base).
 */
@Component({
  selector: 'app-studio-record-history-tab',
  standalone: true,
  imports: [DatePipe, ButtonModule, TableModule, TagModule, SkeletonTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="srh-panel" data-testid="srh-panel" [attr.aria-label]="labels.tabLabel">
      <div class="srh-head">
        <p class="studio-muted">{{ labels.hint }}</p>
        @if (total() > 0) {
          <span class="srh-count" data-testid="srh-count">{{ countLabel() }}</span>
        }
      </div>
      @if (error(); as message) {
        <div class="sai-banner sai-banner--error" role="alert" data-testid="srh-error">
          {{ message }}
          <p-button [label]="labels.retry" [text]="true" size="small" (onClick)="load()" data-testid="srh-retry" />
        </div>
      } @else if (loading()) {
        <app-skeleton-table [rows]="5" [columns]="skeletonColumns" />
      } @else {
        <div class="ft-table-card">
          <p-table [value]="entries()" dataKey="id" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr>
                <th class="srh-col-date">{{ labels.colDate }}</th>
                <th class="srh-col-action">{{ labels.colAction }}</th>
                <th class="srh-col-user">{{ labels.colUser }}</th>
                <th>{{ labels.colChanges }}</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr [attr.data-testid]="'srh-row-' + row.id">
                <td class="srh-date" [attr.data-testid]="'srh-date-' + row.id">{{ row.createdAt | date:'dd/MM/yyyy HH:mm' }}</td>
                <td>
                  <p-tag [severity]="severity(row.action)" [value]="actionLabel(row.action)" [attr.data-testid]="'srh-action-' + row.id" />
                </td>
                <td class="srh-user" [class.studio-muted]="!row.userName?.trim()" [attr.data-testid]="'srh-user-' + row.id">{{ userLabel(row.userName) }}</td>
                <td>
                  @if (changesFor(row); as changes) {
                    @if (changes.length === 0) {
                      <span class="srh-deleted" [attr.data-testid]="'srh-changes-' + row.id">{{ labels.noChanges }}</span>
                    } @else {
                      <ul class="srh-changes" [id]="'srh-changes-' + row.id" [attr.aria-label]="labels.colChanges" [attr.data-testid]="'srh-changes-' + row.id">
                        @for (change of visibleChanges(row.id, changes); track change.key) {
                          <li class="srh-change" [attr.data-testid]="'srh-change-' + row.id + '-' + change.key">
                            <strong class="srh-change__label">{{ change.label }}</strong><span class="srh-change__sep"> : </span>
                            @if (change.kind === 'added') {
                              <span class="srh-val srh-new" [attr.title]="change.newText">{{ change.newText }}</span>
                            } @else {
                              <span class="srh-val srh-old" [attr.title]="change.oldText">{{ change.oldText }}</span>
                              <span class="srh-change__arrow"> → </span>
                              <span class="srh-val srh-new" [class.srh-val--null]="change.kind === 'removed'"
                                [attr.title]="change.kind === 'removed' ? null : change.newText">{{ change.newText }}</span>
                            }
                          </li>
                        }
                      </ul>
                      @if (changes.length > inlineLimit) {
                        <button type="button" class="srh-more" (click)="toggle(row.id)" [attr.aria-expanded]="expanded().has(row.id)"
                          [attr.aria-controls]="'srh-changes-' + row.id" [attr.data-testid]="'srh-more-' + row.id">
                          {{ expanded().has(row.id) ? labels.showLess : moreLabel(changes.length) }}
                        </button>
                      }
                    }
                  }
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="4" class="ft-empty" role="status" data-testid="srh-empty">
                  <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> {{ labels.empty }}
                  <div class="studio-muted">{{ labels.emptyHint }}</div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
        @if (hasNextPage()) {
          <div class="srh-more-bar">
            <p-button [label]="labels.loadMore" [outlined]="true" size="small" [loading]="loadingMore()" [disabled]="loadingMore()"
              (onClick)="loadMore()" data-testid="srh-load-more" />
          </div>
        }
      }
    </section>
  `,
  // studio-layout.scss fournit .studio-muted (encapsulation émulée — même motif que l'onglet « Workflows »).
  styleUrl: '../shared/studio-layout.scss',
  styles: [`
    .srh-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .75rem; }
    .srh-head p { margin: 0; }
    .srh-count { color: var(--color-neutral-500); font-size: var(--font-size-sm); white-space: nowrap; }
    .srh-col-date { width: 9.5rem; } .srh-col-action { width: 8.5rem; } .srh-col-user { width: 11rem; }
    .srh-date { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .srh-user { white-space: nowrap; }
    .srh-deleted { color: var(--color-neutral-400); font-size: var(--font-size-sm); }
    .srh-changes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .25rem; min-width: 0; }
    .srh-change { display: flex; align-items: center; flex-wrap: nowrap; gap: .25rem; min-width: 0; font-size: var(--font-size-sm); line-height: 1.375rem; }
    .srh-change__label { color: var(--color-neutral-700); font-weight: 500; white-space: nowrap; }
    .srh-change__sep { color: var(--color-neutral-400); white-space: pre; }
    .srh-change__arrow { color: var(--color-neutral-400); padding: 0 .125rem; flex: none; }
    .srh-val { display: inline-block; flex: 0 1 auto; min-width: 0; max-width: 22rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      vertical-align: bottom; font-family: var(--font-family-mono, monospace); font-size: var(--font-size-xs); padding: 0 .375rem;
      border: 1px solid var(--color-neutral-200); border-radius: 4px; background: var(--color-neutral-50, #f8fafc); }
    .srh-old { color: var(--color-neutral-500); text-decoration: line-through; text-decoration-color: var(--color-neutral-400); }
    .srh-new { background: var(--color-background-elevated, #fff); border-color: var(--color-neutral-300); color: var(--color-neutral-900); }
    .srh-val--null { border-style: dashed; background: transparent; color: var(--color-neutral-400); min-width: 1.75rem; text-align: center; }
    .srh-more { appearance: none; border: 0; background: transparent; padding: 0; margin: .25rem 0 0; font: inherit; font-size: var(--font-size-xs);
      font-weight: 500; color: var(--color-primary-600); cursor: pointer; }
    .srh-more:hover { text-decoration: underline; }
    .srh-more:focus-visible { outline: 2px solid var(--color-primary-500); outline-offset: 2px; border-radius: 2px; }
    .srh-more-bar { display: flex; justify-content: center; padding: .75rem 0 .25rem; }
    .sai-banner { display: flex; align-items: center; gap: .75rem; padding: .75rem 1rem; border-radius: .5rem; margin-bottom: 1rem; }
    .sai-banner--error { background: #fef2f2; color: #991b1b; }
    .ft-empty { text-align: center; color: var(--text-color-secondary); padding: 2rem; }
    @media (max-width: 768px) { .srh-val { max-width: 12rem; } }
  `]
})
export class StudioRecordHistoryTabComponent implements OnInit {
  readonly entityKey = input.required<string>();
  readonly recordId = input.required<string>();
  /** Schéma complet (actifs + inactifs, D-B8) pour les libellés de champ et le format des valeurs. */
  readonly fields = input<CustomField[]>([]);

  private readonly studio = inject(StudioService);
  /** Le `<p-toast>` est porté par la fiche hôte ; `MessageService` est root (même motif que l'onglet Workflows). */
  private readonly toast = inject(MessageService);

  readonly labels = STUDIO_RUNTIME_LABELS.history;
  readonly inlineLimit = HISTORY_INLINE_CHANGES;
  readonly skeletonColumns = [{ width: '16%' }, { width: '14%' }, { width: '20%' }, { width: '50%' }];

  readonly entries = signal<StudioRecordHistoryEntry[]>([]);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly hasNextPage = signal(false);
  readonly page = signal(1);
  readonly expanded = signal<ReadonlySet<string>>(new Set<string>());

  readonly countLabel = computed(() => formatLabel(this.labels.count, { shown: this.entries().length, total: this.total() }));

  /** Vues de changements mémorisées par `id` d'entrée (invalidées quand le schéma change). */
  private changeViews = new Map<string, StudioRecordHistoryChangeView[]>();
  private changeViewsFields: readonly CustomField[] | null = null;

  ngOnInit(): void {
    this.load();
  }

  /** Page 1 (remplace le contenu) — appelée à l'initialisation et par « Réessayer ». */
  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.studio.listRecordHistory(this.entityKey(), this.recordId(), 1, STUDIO_RECORD_HISTORY_PAGE_SIZE).subscribe({
      next: res => {
        const data = res.data;
        this.entries.set(data?.items ?? []);
        this.total.set(data?.totalCount ?? 0);
        this.hasNextPage.set(!!data?.hasNextPage);
        this.page.set(1);
        this.expanded.set(new Set<string>());
        this.changeViews.clear();
        this.loading.set(false);
      },
      error: err => {
        this.entries.set([]);
        this.total.set(0);
        this.hasNextPage.set(false);
        this.error.set(workflowErrorMessage(err) || this.labels.loadError);
        this.loading.set(false);
      }
    });
  }

  /** Page suivante ajoutée (dédoublonnée par `id`) ; le tableau déjà chargé reste affiché en cas d'erreur. */
  loadMore(): void {
    if (this.loadingMore() || !this.hasNextPage()) return;
    const nextPage = this.page() + 1;
    this.loadingMore.set(true);
    this.studio.listRecordHistory(this.entityKey(), this.recordId(), nextPage, STUDIO_RECORD_HISTORY_PAGE_SIZE).subscribe({
      next: res => {
        const data = res.data;
        this.entries.update(current => appendHistoryPage(current, data?.items ?? []));
        this.total.set(data?.totalCount ?? this.total());
        this.hasNextPage.set(!!data?.hasNextPage);
        this.page.set(nextPage);
        this.loadingMore.set(false);
      },
      error: err => {
        this.loadingMore.set(false);
        this.toast.add({ severity: 'warn', summary: this.labels.tabLabel, detail: workflowErrorMessage(err) || this.labels.loadError });
      }
    });
  }

  toggle(id: string): void {
    this.expanded.update(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  actionLabel(action: string): string {
    return historyActionLabel(action, this.labels);
  }

  severity(action: string): 'success' | 'info' | 'danger' | 'secondary' {
    return historyActionSeverity(action);
  }

  userLabel(userName: string | null): string {
    return historyUserLabel(userName, this.labels);
  }

  moreLabel(count: number): string {
    return formatLabel(this.labels.showMore, { count: count - this.inlineLimit });
  }

  changesFor(row: StudioRecordHistoryEntry): StudioRecordHistoryChangeView[] {
    const fields = this.fields();
    if (this.changeViewsFields !== fields) {
      this.changeViews.clear();
      this.changeViewsFields = fields;
    }
    let views = this.changeViews.get(row.id);
    if (!views) {
      views = (row.changes ?? []).map(change => formatHistoryChange(change, fields, this.labels));
      this.changeViews.set(row.id, views);
    }
    return views;
  }

  visibleChanges(id: string, changes: StudioRecordHistoryChangeView[]): StudioRecordHistoryChangeView[] {
    return changes.length <= this.inlineLimit || this.expanded().has(id) ? changes : changes.slice(0, this.inlineLimit);
  }
}
