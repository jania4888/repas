import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Subject, catchError, of, switchMap } from 'rxjs';
import { TableLazyLoadEvent } from 'primeng/table';
import { MessageService } from 'primeng/api';
import { DynamicTableComponent, DynamicRow } from '@shared/studio-runtime/dynamic-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { CustomField } from '@shared/studio-runtime/studio-runtime.models';
import { StudioRecordViewsService } from './studio-record-views.service';
import { CustomRecordViewDto, RecordViewRunResultDto } from './studio-record-views.models';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';

interface RunRequestParams {
  view: CustomRecordViewDto;
  entityKey: string;
  page: number;
  pageSize: number;
  search: string;
}

/**
 * Exécute une vue enregistrée (`POST /run`) et affiche le résultat.
 * Mode Liste : rendu via `app-dynamic-table` (mêmes colonnes/pagination que la vue « Liste »
 * historique). Modes Kanban / Calendrier : bandeau « Bientôt » (corps réel en 2.5b).
 *
 * `search`/`total()`/`reload()` permettent au parent (page Données) de router sa recherche et son
 * total affiché vers la vue active au lieu du tableau brut (voir commentaire dans
 * `studio-record-list.component.ts`). `previewLimit` tronque le rendu côté client (réutilisé par
 * l'aperçu du concepteur de vue en 2.5c) sans dépendre de la troncature serveur (`result().truncated`).
 */
@Component({
  selector: 'app-studio-record-view-runner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DynamicTableComponent, EmptyStateComponent],
  template: `
    @switch (view()?.mode) {
      @case ('List') {
        @if (error()) {
          <app-empty-state
            icon="pi-exclamation-triangle"
            [title]="labels.views.error"
            [showAction]="true"
            actionLabel="Réessayer"
            (actionClick)="run()" />
        } @else {
          @if (truncated()) {
            <div class="runner-banner">
              <i class="fa-solid fa-circle-info"></i>
              <span>{{ labels.views.truncatedGeneric }}</span>
            </div>
          }
          <app-dynamic-table
            [entityKey]="entityKey()"
            [allFields]="allFields()"
            [columns]="columns()"
            [columnPicker]="false"
            [value]="rows()"
            [total]="result()?.total ?? 0"
            [pageSize]="pageSize()"
            [loading]="loading()"
            [showActions]="showActions()"
            (lazyLoad)="onLazy($event)"
            (editRow)="editRow.emit($event)"
            (deleteRow)="deleteRow.emit($event)" />
        }
      }
      @case ('Kanban') {
        <div class="runner-soon"><i class="fa-solid fa-table-columns"></i> Vue Kanban — {{ labels.views.soon }}</div>
      }
      @case ('Calendar') {
        <div class="runner-soon"><i class="fa-solid fa-calendar-days"></i> Vue Calendrier — {{ labels.views.soon }}</div>
      }
    }
  `,
  styles: [`
    .runner-banner {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      margin-bottom: var(--spacing-3);
      background: var(--color-warning-50, #fffbeb);
      color: var(--color-warning-800, #92400e);
      border: 1px solid var(--color-warning-200, #fde68a);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
    }

    .runner-soon {
      padding: var(--spacing-6);
      text-align: center;
      color: var(--color-neutral-500);
      background: var(--color-neutral-50, #f8fafc);
      border-radius: var(--radius-lg);
    }
  `]
})
export class StudioRecordViewRunnerComponent {
  private readonly viewsService = inject(StudioRecordViewsService);
  private readonly toast = inject(MessageService);

  readonly entityKey = input('');
  readonly view = input<CustomRecordViewDto | null>(null);
  readonly allFields = input<CustomField[]>([]);
  readonly showActions = input(true);
  /** Texte de recherche courant du parent ; pris en compte au prochain `reload()` (pas réactif à la frappe). */
  readonly search = input('');
  /** Tronque le rendu côté client (réutilisation 2.5c) ; `null` = pas de troncature client. */
  readonly previewLimit = input<number | null>(null);

  readonly editRow = output<DynamicRow>();
  readonly deleteRow = output<DynamicRow>();
  /** Total serveur de la dernière exécution réussie — permet au parent d'afficher un sous-titre cohérent. */
  readonly total = output<number>();

  protected readonly labels = STUDIO_RUNTIME_LABELS;

  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly result = signal<RecordViewRunResultDto | null>(null);

  private page = 1;
  protected readonly pageSize = signal(25);
  // Écho de montage de `p-table` (lazy+paginator) : évite un second POST /run identique (même
  // schéma que `StudioRecordListComponent.onLazy`).
  private fetched = false;

  // File `switchMap` : toute nouvelle demande (changement de vue, page ou recherche) annule l'appel
  // /run précédent encore en vol — sans ça une réponse en retard pourrait écraser une sélection plus
  // récente (ex. l'utilisateur change deux fois de vue rapidement).
  private readonly runRequests$ = new Subject<RunRequestParams>();

  protected readonly rows = computed<DynamicRow[]>(() => {
    const items = this.result()?.items ?? [];
    const limit = this.previewLimit();
    return limit != null && limit >= 0 ? items.slice(0, limit) : items;
  });

  protected readonly truncated = computed(() => {
    const items = this.result()?.items ?? [];
    const limit = this.previewLimit();
    const truncatedByPreview = limit != null && limit >= 0 && items.length > limit;
    return truncatedByPreview || this.result()?.truncated === true;
  });

  protected readonly columns = computed<CustomField[]>(() => {
    const v = this.view();
    const fields = this.allFields();
    if (!v) return fields;
    const byKey = new Map(fields.map(f => [f.key, f]));
    return v.definition.columns
      .filter(c => !c.hidden)
      .map(c => byKey.get(c.fieldKey))
      .filter((f): f is CustomField => !!f);
  });

  constructor() {
    this.runRequests$.pipe(
      switchMap(params => {
        this.loading.set(true);
        this.error.set(false);
        this.fetched = true;
        return this.viewsService
          .runRecordView(params.entityKey, params.view.id, {
            page: params.page,
            pageSize: params.pageSize,
            search: params.search.trim() || null
          })
          .pipe(catchError(() => of(null)));
      }),
      takeUntilDestroyed()
    ).subscribe(res => {
      this.loading.set(false);
      if (res === null) {
        this.error.set(true);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.labels.views.error });
        return;
      }
      if (res.success) {
        this.result.set(res.data);
        this.total.emit(res.data.total);
      } else {
        this.error.set(true);
      }
    });

    effect(() => {
      const v = this.view();
      const key = this.entityKey();
      if (!v || !key) {
        untracked(() => this.result.set(null));
        return;
      }
      // `untracked` : sans ça l'effet suivrait aussi `search()`/`pageSize()` lus par `dispatch()`
      // (les effets Angular traquent les lectures imbriquées) et chaque frappe de recherche
      // relancerait un /run en réinitialisant la page.
      untracked(() => {
        this.page = 1;
        this.pageSize.set(v.definition.pageSize || 25);
        this.fetched = false;
        // Kanban/Calendrier : panneau « Bientôt » (2.5b) — pas d'appel réseau tant que non consommé.
        if (v.mode === 'List') this.dispatch();
        else this.result.set(null);
      });
    });
  }

  onLazy(event: TableLazyLoadEvent): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize();
    const nextPage = Math.floor(first / rows) + 1;
    // Ignore l'écho de montage de la table une fois le premier chargement effectué.
    if (this.fetched && nextPage === this.page && rows === this.pageSize()) return;
    this.pageSize.set(rows);
    this.page = nextPage;
    this.dispatch();
  }

  /** Relance à la page courante (bouton « Réessayer » de l'état d'erreur). */
  run(): void {
    this.dispatch();
  }

  /** Relance depuis la page 1 avec le texte de `search()` courant (recherche, post-suppression…). */
  reload(): void {
    this.page = 1;
    this.dispatch();
  }

  private dispatch(): void {
    const v = this.view();
    const key = this.entityKey();
    if (!v || !key) return;
    this.runRequests$.next({ view: v, entityKey: key, page: this.page, pageSize: this.pageSize(), search: this.search() });
  }
}
