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
import {
  CustomRecordViewDto, RECORD_VIEW_LIMITS, RecordViewCalendarEventDto,
  RecordViewKanbanGroupDto, RecordViewRunResultDto
} from './studio-record-views.models';
import { StudioKanbanBoardComponent } from './studio-kanban-board.component';
import { StudioCalendarComponent } from './studio-calendar.component';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';

interface RunRequestParams {
  view: CustomRecordViewDto;
  entityKey: string;
  page: number;
  pageSize: number;
  search: string;
  /** 4.7v2 : mode aperçu (concepteur) — POST /views/preview avec le brouillon, sans id de vue. */
  preview: boolean;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}

/**
 * Exécute une vue enregistrée (`POST /run`) et affiche le résultat selon son mode :
 * - Liste : `app-dynamic-table` (mêmes colonnes/pagination que la vue « Liste » historique) ;
 * - Kanban : `app-studio-kanban-board` (pageSize plafonné à 500 cartes, rechargement sur 409) ;
 * - Calendrier : `app-studio-calendar` (pageSize 1000 événements, plage `rangeStart/rangeEnd`
 *   calculée par le calendrier et remontée via `rangeChange` — aucune requête avant la 1re plage).
 *
 * Tous les modes passent par la même file `runRequests$` (`switchMap` : une nouvelle demande annule
 * l'appel en vol). `search`/`total()`/`reload()` permettent au parent (page Données) de router sa
 * recherche et son total affiché vers la vue active au lieu du tableau brut (voir commentaire dans
 * `studio-record-list.component.ts`). `previewLimit` tronque le rendu côté client (réutilisé par
 * l'aperçu du concepteur de vue en 2.5c) sans dépendre de la troncature serveur (`result().truncated`).
 */
@Component({
  selector: 'app-studio-record-view-runner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DynamicTableComponent, EmptyStateComponent, StudioKanbanBoardComponent, StudioCalendarComponent],
  template: `
    @if (error()) {
      <app-empty-state
        icon="pi-exclamation-triangle"
        [title]="labels.views.error"
        [showAction]="true"
        actionLabel="Réessayer"
        (actionClick)="run()" />
    } @else {
      @switch (view()?.mode) {
        @case ('List') {
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
            [showView]="showView()"
            (lazyLoad)="onLazy($event)"
            (editRow)="editRow.emit($event)"
            (deleteRow)="deleteRow.emit($event)"
            (viewRow)="viewRow.emit($event)" />
        }
        @case ('Kanban') {
          <app-studio-kanban-board
            [entityKey]="entityKey()"
            [kanban]="view()?.definition?.kanban ?? null"
            [groups]="kanbanGroups()"
            [allFields]="allFields()"
            [truncated]="truncated()"
            [attr.aria-busy]="loading()"
            (reload)="reload()" />
        }
        @case ('Calendar') {
          <app-studio-calendar
            [entityKey]="entityKey()"
            [calendar]="view()?.definition?.calendar ?? null"
            [events]="calendarEvents()"
            [allFields]="allFields()"
            [truncated]="truncated()"
            [loading]="loading()"
            (rangeChange)="onCalendarRange($event)" />
        }
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
  `]
})
export class StudioRecordViewRunnerComponent {
  private readonly viewsService = inject(StudioRecordViewsService);
  private readonly toast = inject(MessageService);

  readonly entityKey = input('');
  readonly view = input<CustomRecordViewDto | null>(null);
  readonly allFields = input<CustomField[]>([]);
  readonly showActions = input(true);
  /** 4.7 suite (D-47-94) : propage l'œil « Voir » (fiche en lecture seule) à la table interne. */
  readonly showView = input(false);
  /** Texte de recherche courant du parent ; pris en compte au prochain `reload()` (pas réactif à la frappe). */
  readonly search = input('');
  /** Tronque le rendu côté client (réutilisation 2.5c) ; `null` = pas de troncature client. */
  readonly previewLimit = input<number | null>(null);
  /**
   * 4.7v2 (R3) : mode aperçu du concepteur — exécute le brouillon via `POST …/views/preview`
   * (sans id de vue, rien de persisté) au lieu de `run`. L'erreur réseau ne toaste PAS en
   * mode preview (une frappe en cours de définition ne doit pas toaster) ; l'état d'erreur
   * inline avec « Réessayer » reste.
   */
  readonly preview = input(false);

  readonly editRow = output<DynamicRow>();
  readonly deleteRow = output<DynamicRow>();
  readonly viewRow = output<DynamicRow>();
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

  // Dernière plage émise par le calendrier (mode Calendar uniquement) ; conservée entre deux vues
  // calendrier (l'ancre ne dépend pas de la vue) pour éviter une requête en double à la réémission.
  private calendarRange: { rangeStart: string; rangeEnd: string } | null = null;

  // File `switchMap` : toute nouvelle demande (changement de vue, page, plage ou recherche) annule
  // l'appel /run précédent encore en vol — sans ça une réponse en retard pourrait écraser une
  // sélection plus récente (ex. l'utilisateur change deux fois de vue rapidement).
  private readonly runRequests$ = new Subject<RunRequestParams>();

  protected readonly rows = computed<DynamicRow[]>(() => {
    const items = this.result()?.items ?? [];
    const limit = this.previewLimit();
    return limit != null && limit >= 0 ? items.slice(0, limit) : items;
  });

  /** Groupes kanban, tronqués par colonne à `previewLimit` quand il est défini (aperçu 2.5c). */
  protected readonly kanbanGroups = computed<RecordViewKanbanGroupDto[]>(() => {
    const groups = this.result()?.groups ?? [];
    const limit = this.previewLimit();
    if (limit == null || limit < 0) return groups;
    return groups.map(g => ({ ...g, items: g.items.slice(0, limit) }));
  });

  /** Événements calendrier, tronqués à `previewLimit` quand il est défini (aperçu 2.5c). */
  protected readonly calendarEvents = computed<RecordViewCalendarEventDto[]>(() => {
    const events = this.result()?.events ?? [];
    const limit = this.previewLimit();
    return limit != null && limit >= 0 ? events.slice(0, limit) : events;
  });

  protected readonly truncated = computed(() => {
    const res = this.result();
    const limit = this.previewLimit();
    const truncatedByPreview = limit != null && limit >= 0 && (
      (res?.items?.length ?? 0) > limit
      || (res?.groups ?? []).some(g => g.items.length > limit)
      || (res?.events?.length ?? 0) > limit
    );
    return truncatedByPreview || res?.truncated === true;
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
        // Mode aperçu (4.7v2) : le brouillon part dans le corps, sans id — ni search ni extraFilters.
        const request$ = params.preview
          ? this.viewsService.previewRecordView(params.entityKey, {
              mode: params.view.mode,
              definition: params.view.definition,
              page: params.page,
              pageSize: params.pageSize,
              rangeStart: params.rangeStart ?? null,
              rangeEnd: params.rangeEnd ?? null
            })
          : this.viewsService.runRecordView(params.entityKey, params.view.id, {
              page: params.page,
              pageSize: params.pageSize,
              search: params.search.trim() || null,
              rangeStart: params.rangeStart ?? null,
              rangeEnd: params.rangeEnd ?? null
            });
        return request$.pipe(catchError(() => of(null)));
      }),
      takeUntilDestroyed()
    ).subscribe(res => {
      this.loading.set(false);
      if (res === null) {
        this.error.set(true);
        // 4.7v2 : en mode aperçu, pas de toast à la frappe — l'état d'erreur inline suffit.
        if (!this.preview()) {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.labels.views.error });
        }
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
        // Aperçu du concepteur (`previewLimit` défini) : le brouillon change à chaque frappe —
        // ne pas relancer `/run` à chaque émission ; seul « Actualiser l'aperçu » (`reload()`) redispatche.
        if (this.previewLimit() !== null && this.fetched) return;
        this.fetched = false;
        // Mode Calendar sans plage connue (1er montage) : `dispatch()` n'émet rien, la requête
        // partira à la réception du `rangeChange` initial du calendrier.
        this.dispatch();
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

  /** Plage visible remontée par le calendrier : déclenche un /run borné (mode Calendar). */
  onCalendarRange(range: { rangeStart: string; rangeEnd: string }): void {
    if (this.calendarRange?.rangeStart === range.rangeStart && this.calendarRange?.rangeEnd === range.rangeEnd) return;
    this.calendarRange = range;
    this.page = 1;
    this.dispatch();
  }

  /** Relance à la page courante (bouton « Réessayer » de l'état d'erreur). */
  run(): void {
    this.dispatch();
  }

  /** Relance depuis la page 1 avec le texte de `search()` courant (recherche, post-suppression, 409 kanban…). */
  reload(): void {
    this.page = 1;
    this.dispatch();
  }

  private dispatch(): void {
    const v = this.view();
    const key = this.entityKey();
    if (!v || !key) return;
    let page = this.page;
    let pageSize = this.pageSize();
    let rangeStart: string | null = null;
    let rangeEnd: string | null = null;
    if (v.mode === 'Kanban') {
      // Pas de pagination kanban. Le serveur borne `pageSize` à 200 AVANT le dispatch par mode puis
      // l'ignore en Kanban (plafond settings 500, bandeau `truncated`) : envoyer 200, la borne haute acceptée.
      page = 1;
      pageSize = RECORD_VIEW_LIMITS.maxPageSize;
    } else if (v.mode === 'Calendar') {
      // La plage est calculée par le calendrier (mois/semaine) ; tant qu'elle est inconnue, aucune requête.
      // Même borne que Kanban : le serveur ignore `pageSize` en Calendar (plafond settings 1000).
      if (!this.calendarRange) return;
      page = 1;
      pageSize = RECORD_VIEW_LIMITS.maxPageSize;
      rangeStart = this.calendarRange.rangeStart;
      rangeEnd = this.calendarRange.rangeEnd;
    }
    this.runRequests$.next({ view: v, entityKey: key, page, pageSize, search: this.search(), preview: this.preview(), rangeStart, rangeEnd });
  }
}
