import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import {
  StudioSpecEntity,
  StudioSpecRecordView,
  normalizeViewMode,
  viewDisplayName
} from '../studio-ai.models';

/** Colonne d'une miniature kanban : libellé de l'option et nombre de cartes (≤ 3). */
export interface StudioAiKanbanColumn {
  value: string;
  label: string;
  cards: number;
}

/** Cellule d'une miniature calendrier : `null` hors du mois, `event` si une date du seed tombe ce jour. */
export interface StudioAiCalendarCell {
  day: number | null;
  event: boolean;
}

const MAX_COLUMNS = 3;
const MAX_CARDS = 3;
const LIST_ROWS = 3;
const MAX_LIST_COLUMNS = 5;
/** Cartes affichées quand la table n'a pas de seed (motif fixe, purement illustratif). */
const PLACEHOLDER_CARDS = [2, 1, 2];

/**
 * Miniature statique d'une vue enregistrée (Liste / Kanban / Calendrier), en CSS pur.
 *
 * - kanban : ≤ 3 colonnes issues des `options` du champ `groupBy`, cartes = lignes du seed de la
 *   table regroupées par valeur (≤ 3 par colonne) ;
 * - calendrier : mini-mois du premier `start` trouvé dans le seed, jours marqués ;
 * - liste : en-tête + 3 lignes, autant de colonnes que la vue (≤ 5).
 *
 * Aucune interaction : `role="img"` + `aria-label` décrivent l'image aux lecteurs d'écran.
 */
@Component({
  selector: 'app-studio-ai-view-miniature',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sai-thumb" role="img" [attr.aria-label]="ariaLabel()" [attr.data-mode]="mode()">
      @switch (mode()) {
        @case ('kanban') {
          <div class="th-kan">
            @for (col of kanban(); track col.value) {
              <div class="th-col" [attr.data-option]="col.value" [attr.data-cards]="col.cards">
                <div class="th-col__h"></div>
                @for (card of range(col.cards); track card) {
                  <div class="th-card"></div>
                }
              </div>
            }
          </div>
        }
        @case ('calendar') {
          <div class="th-cal">
            @for (head of range(7); track head) {
              <span class="th-cal__hd"></span>
            }
            @for (cell of calendar(); track $index) {
              <span [class.th-cal__dim]="cell.day === null" [class.th-cal__ev]="cell.event"></span>
            }
          </div>
        }
        @default {
          <div class="th-list">
            <div class="th-row th-row--head">
              @for (col of range(listColumns()); track col) {
                <span></span>
              }
            </div>
            @for (row of range(listRows); track row) {
              <div class="th-row">
                @for (col of range(listColumns()); track col) {
                  <span [class.th-row__acc]="col === listColumns() - 1"></span>
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .sai-thumb {
      height: 8rem;
      padding: 0.625rem;
      background: var(--color-neutral-50, #f9fafb);
      border-bottom: 1px solid var(--surface-border, #e5e7eb);
      overflow: hidden;
    }
    .th-kan { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.375rem; height: 100%; }
    .th-col {
      background: var(--color-neutral-100, #f3f4f6);
      border-radius: 0.375rem;
      padding: 0.25rem;
      display: grid;
      gap: 0.25rem;
      align-content: start;
    }
    .th-col__h { height: 0.5rem; width: 60%; border-radius: 2px; background: var(--color-neutral-400, #9ca3af); margin-bottom: 2px; }
    .th-card {
      height: 1rem;
      border-radius: 0.25rem;
      background: var(--surface-card, #fff);
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-left: 3px solid var(--color-primary-400, #818cf8);
    }
    .th-cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; height: 100%; }
    .th-cal span { background: var(--surface-card, #fff); border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 2px; min-height: 0; }
    .th-cal span.th-cal__hd { background: var(--color-neutral-300, #d1d5db); border: 0; height: 0.375rem; }
    .th-cal span.th-cal__dim { background: var(--color-neutral-100, #f3f4f6); }
    .th-cal span.th-cal__ev { background: var(--color-primary-100, #e0e7ff); border-color: var(--color-primary-300, #a5b4fc); }
    .th-row { display: flex; gap: 0.25rem; margin-bottom: 0.25rem; }
    .th-row span { flex: 1; height: 0.625rem; border-radius: 3px; background: var(--color-neutral-200, #e5e7eb); }
    .th-row--head span { height: 0.75rem; background: var(--color-neutral-300, #d1d5db); }
    .th-row span:first-child { flex: 0.6; }
    .th-row span:nth-child(2) { flex: 1.6; }
    .th-row span.th-row__acc { background: var(--color-primary-200, #c7d2fe); }
  `
})
export class StudioAiViewMiniatureComponent {
  readonly view = input.required<StudioSpecRecordView>();
  readonly entity = input.required<StudioSpecEntity>();
  /** Lignes de `spec.seed[]` de la table (le seed vit à la racine de la spec, pas dans l'entité). */
  readonly seed = input<Record<string, unknown>[]>([]);

  readonly listRows = LIST_ROWS;
  private readonly labels = STUDIO_AI_LABELS.views;

  readonly mode = computed(() => normalizeViewMode(this.view().mode));

  readonly ariaLabel = computed(() => {
    const name = viewDisplayName(this.view()) || this.entity().displayName;
    return `${this.labels[this.mode()]} : ${name}`;
  });

  readonly kanban = computed<StudioAiKanbanColumn[]>(() => {
    const view = this.view();
    const groupBy = view.groupBy;
    const field = groupBy ? this.entity().fields.find(f => f.key === groupBy) : undefined;
    const seed = this.seed();
    const options = (field?.options ?? []).slice(0, MAX_COLUMNS);
    if (options.length) {
      return options.map(option => ({
        value: option.value,
        label: option.label,
        cards: seed.length
          ? Math.min(MAX_CARDS, seed.filter(row => this.matches(row[groupBy!], option)).length)
          : PLACEHOLDER_CARDS[options.indexOf(option)] ?? 1
      }));
    }
    // Pas d'options connues : valeurs distinctes du seed, sinon motif fixe.
    const distinct = new Map<string, number>();
    if (groupBy) {
      for (const row of seed) {
        const key = this.text(row[groupBy]);
        if (key) distinct.set(key, (distinct.get(key) ?? 0) + 1);
      }
    }
    if (distinct.size) {
      return Array.from(distinct.entries())
        .slice(0, MAX_COLUMNS)
        .map(([value, count]) => ({ value, label: value, cards: Math.min(MAX_CARDS, count) }));
    }
    return PLACEHOLDER_CARDS.map((cards, i) => ({ value: `col-${i}`, label: '', cards }));
  });

  readonly calendar = computed<StudioAiCalendarCell[]>(() => {
    const startKey = this.view().start ?? (this.view()['dateField'] as string | undefined);
    const dates = startKey
      ? this.seed().map(row => this.toDate(row[startKey])).filter((d): d is Date => d !== null)
      : [];
    const anchor = dates[0] ?? new Date();
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const marked = new Set(
      dates.filter(d => d.getFullYear() === year && d.getMonth() === month).map(d => d.getDate())
    );
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7; // semaine commençant le lundi
    const cells: StudioAiCalendarCell[] = [];
    for (let i = 0; i < offset; i++) cells.push({ day: null, event: false });
    for (let day = 1; day <= daysInMonth; day++) cells.push({ day, event: marked.has(day) });
    while (cells.length % 7 !== 0) cells.push({ day: null, event: false });
    return cells;
  });

  readonly listColumns = computed(() => {
    const declared = this.view().columns?.length ?? 0;
    const count = declared || Math.min(this.entity().fields.length, 4);
    return Math.max(1, Math.min(MAX_LIST_COLUMNS, count));
  });

  range(n: number): number[] {
    return Array.from({ length: Math.max(0, n) }, (_, i) => i);
  }

  private matches(raw: unknown, option: { value: string; label: string }): boolean {
    const text = this.text(raw).toLowerCase();
    return !!text && (text === option.value.toLowerCase() || text === option.label.toLowerCase());
  }

  private text(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    return typeof raw === 'object' ? '' : String(raw).trim();
  }

  private toDate(raw: unknown): Date | null {
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    const date = new Date(raw);
    return isNaN(date.getTime()) ? null : date;
  }
}
