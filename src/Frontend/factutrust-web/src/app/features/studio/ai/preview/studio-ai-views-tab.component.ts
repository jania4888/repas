import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { CustomField } from '@shared/studio-runtime/studio-runtime.models';
import { StudioFilterBuilderComponent } from '../../shared/studio-filter-builder.component';
import { RecordViewFilter } from '../../views/studio-record-views.models';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import {
  StudioSpecEntity,
  StudioSpecRecordView,
  StudioSystemSpec,
  normalizeViewMode,
  viewDisplayName
} from '../studio-ai.models';
import { specEntityToCustomFields } from '../studio-ai-spec.util';
import {
  recordViewFiltersToSpecViewFilters,
  specViewFiltersToRecordViewFilters
} from '../studio-ai-view-filters.util';
import { StudioAiViewMiniatureComponent } from './studio-ai-view-miniature.component';

/** Une vue prête à afficher : mode normalisé, puces déjà résolues en libellés de champ. */
export interface StudioAiViewCard {
  id: string;
  entity: StudioSpecEntity;
  /** Position de la vue dans `entity.views` (cible du patch `viewChange`). */
  index: number;
  entityName: string;
  view: StudioSpecRecordView;
  name: string;
  mode: 'list' | 'kanban' | 'calendar';
  modeLabel: string;
  isDefault: boolean;
  chips: string[];
  seed: Record<string, unknown>[];
}

const MODE_ICONS: Record<StudioAiViewCard['mode'], string> = {
  list: 'fa-solid fa-list',
  kanban: 'fa-solid fa-table-columns',
  calendar: 'fa-solid fa-calendar-days'
};

/**
 * Onglet « Vues » (M3, lecture) : une carte par vue enregistrée de chaque table, avec une miniature
 * statique, le mode (Liste / Kanban / Calendrier), les puces de configuration et « Par défaut ».
 *
 * Les alias français du mode (`liste`, `calendrier`) et du plan maître (`displayName`, `dateField`…)
 * sont tolérés en lecture via `normalizeViewMode` / `viewDisplayName`. En mode Personnaliser
 * (3.4g2, `editable`), chaque carte embarque le constructeur de filtres partagé
 * (`app-studio-filter-builder`) : les changements sont convertis en `StudioSpecViewFilter[]` et
 * remontés via `viewChange`. La lecture seule est strictement inchangée.
 */
@Component({
  selector: 'app-studio-ai-views-tab',
  standalone: true,
  imports: [TagModule, StudioAiViewMiniatureComponent, StudioFilterBuilderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    <div class="sai-body">
      <div class="sai-block__head">
        <i class="fa-solid fa-eye" aria-hidden="true"></i>
        <span>{{ labels.title }}</span>
        <span class="sai-list__meta">{{ countLabel() }}</span>
      </div>
      @if (!cards().length) {
        <div class="sai-empty">
          <span class="sai-empty__icon" aria-hidden="true"><i class="fa-solid fa-eye-slash"></i></span>
          <strong>{{ labels.empty }}</strong>
        </div>
      } @else {
        <div class="sai-views">
          @for (card of cards(); track card.id) {
            <article class="sai-view" [attr.data-component-id]="'sai-view-' + card.mode" [attr.aria-label]="card.name">
              <app-studio-ai-view-miniature [view]="card.view" [entity]="card.entity" [seed]="card.seed" />
              <div class="sai-view__body">
                <div class="sai-view__title">
                  <i [class]="icons[card.mode]" aria-hidden="true"></i>
                  <span>{{ card.name }}</span>
                  <span class="sai-list__meta">{{ card.entityName }}</span>
                </div>
                <div class="sai-view__chips">
                  <p-tag severity="secondary" [value]="card.modeLabel" />
                  @for (chip of card.chips; track chip) {
                    <span class="sai-chip sai-chip--xs">{{ chip }}</span>
                  }
                  @if (card.isDefault) {
                    <p-tag severity="info" [value]="labels.isDefault" />
                  }
                </div>
                @if (editable()) {
                  <!-- 3.4g2 : filtres éditables via le constructeur partagé (verrouillé sur une table existante). -->
                  <div class="sai-view__filters" [attr.data-component-id]="'sai-view-filters-' + card.entity.ref + '-' + card.index">
                    <span class="sai-hint">{{ labels.addFilter }}</span>
                    <app-studio-filter-builder
                      [fields]="fieldsOf(card.entity)"
                      [filters]="recordViewFiltersOf(card.view)"
                      (filtersChange)="onViewFiltersChange(card, $event)"
                      [disabled]="!editable() || !!card.entity.existingKey" />
                  </div>
                }
              </div>
            </article>
          }
        </div>
      }
    </div>
  `
})
export class StudioAiViewsTabComponent {
  readonly spec = input.required<StudioSystemSpec>();
  /** Mode Personnaliser (3.4g2) : les filtres de chaque vue deviennent éditables. */
  readonly editable = input(false);

  /** Filtres d'une vue modifiés dans le constructeur partagé (convertis en forme spec). */
  readonly viewChange = output<{ ref: string; index: number; patch: Partial<StudioSpecRecordView> }>();

  readonly labels = STUDIO_AI_LABELS.views;
  readonly icons = MODE_ICONS;

  readonly cards = computed<StudioAiViewCard[]>(() => {
    const spec = this.spec();
    const cards: StudioAiViewCard[] = [];
    for (const entity of spec.entities) {
      const seed = spec.seed?.find(s => s.entityRef === entity.ref)?.records ?? [];
      (entity.views ?? []).forEach((view, index) => cards.push(this.toCard(entity, view, index, seed)));
    }
    return cards;
  });

  readonly countLabel = computed(() => this.labels.count.replace('{count}', String(this.cards().length)));

  /** Champs de chaque entité en `CustomField[]` runtime (références stables pour le constructeur). */
  private readonly fieldsByRef = computed(() => {
    const spec = this.spec();
    return new Map<string, CustomField[]>(spec.entities.map(e => [e.ref, specEntityToCustomFields(e, spec)]));
  });

  /** Champs de l'entité d'une carte, au format attendu par `app-studio-filter-builder`. */
  fieldsOf(entity: StudioSpecEntity): CustomField[] {
    return this.fieldsByRef().get(entity.ref) ?? [];
  }

  /** Filtres de la vue convertis en `RecordViewFilter[]` (forme du constructeur partagé). */
  recordViewFiltersOf(view: StudioSpecRecordView): RecordViewFilter[] {
    return specViewFiltersToRecordViewFilters(view.filters);
  }

  /** Changement dans le constructeur : reconversion en forme spec puis patch de la vue. */
  onViewFiltersChange(card: StudioAiViewCard, filters: RecordViewFilter[]): void {
    if (!this.editable() || card.entity.existingKey) return;
    this.viewChange.emit({
      ref: card.entity.ref,
      index: card.index,
      patch: { filters: recordViewFiltersToSpecViewFilters(filters) }
    });
  }

  private toCard(
    entity: StudioSpecEntity,
    view: StudioSpecRecordView,
    index: number,
    seed: Record<string, unknown>[]
  ): StudioAiViewCard {
    const mode = normalizeViewMode(view.mode);
    const label = (key: string | undefined): string =>
      (key ? entity.fields.find(f => f.key === key)?.label ?? key : '');
    const alias = (key: string): string | undefined => {
      const raw = view[key];
      return typeof raw === 'string' && raw ? raw : undefined;
    };
    const chips: string[] = [];
    const push = (title: string, value: string | undefined) => {
      if (value) chips.push(`${title} : ${value}`);
    };
    push(this.labels.groupBy, view.groupBy ? label(view.groupBy) : undefined);
    const start = view.start ?? alias('dateField');
    push(this.labels.dateField, start ? label(start) : undefined);
    const end = view.end ?? alias('endDateField');
    push(this.labels.endField, end ? label(end) : undefined);
    const title = view.title ?? alias('titleField');
    push(this.labels.titleField, title ? label(title) : undefined);
    if (view.columns?.length) push(this.labels.columns, view.columns.map(label).join(', '));
    if (view.sort?.length) {
      push(this.labels.sort, view.sort.map(s => `${label(s.field)} ${(s.desc ?? s.descending) ? '↓' : '↑'}`).join(', '));
    }
    if (view.filters?.length) push(this.labels.filters, String(view.filters.length));

    return {
      id: `${entity.ref}:${index}`,
      entity,
      index,
      entityName: entity.displayNamePlural || entity.displayName,
      view,
      name: viewDisplayName(view) || entity.displayName,
      mode,
      modeLabel: this.labels[mode],
      isDefault: view.isDefault === true,
      chips,
      seed
    };
  }
}
