import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { Menu, MenuModule } from 'primeng/menu';
import { MessageService, MenuItem } from 'primeng/api';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { CustomField, CustomFieldType, CustomRecord } from '../studio.models';
import { StudioRecordViewsService } from './studio-record-views.service';
import { RecordViewKanban, RecordViewKanbanGroupDto } from './studio-record-views.models';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';

interface KanbanColumnVm {
  value: string | null;
  label: string;
  count: number;
  items: CustomRecord[];
  visibleItems: CustomRecord[];
  remaining: number;
  colorClass: string;
}

const NULL_KEY = '\u0000null';
const COLUMN_PALETTE = ['kc-0', 'kc-1', 'kc-2', 'kc-3', 'kc-4', 'kc-5'];
const REVEAL_STEP = 25;

/**
 * Tableau kanban d'une vue enregistrée (2.5b) : colonnes = `RecordViewKanbanGroupDto[]` déjà ordonnées
 * par le backend (`ColumnOrder` puis options du champ, « Sans valeur » en dernier — `CustomRecordViewFeatures.cs`
 * l. ~552-601). Glisser-déposer via `@angular/cdk/drag-drop` UNIQUEMENT si `custom_records:write` ; sinon
 * repli complet sur le menu clavier « Déplacer vers… ». Déplacement optimiste, PATCH partiel, rollback
 * sur 409/erreur, `aria-live` annonçant le résultat.
 */
@Component({
  selector: 'app-studio-kanban-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DragDropModule, ButtonModule, MenuModule],
  template: `
    <div class="sr-only" aria-live="polite">{{ liveMessage() }}</div>

    @if (truncated()) {
      <div class="runner-banner" role="status">
        <i class="fa-solid fa-circle-info"></i>
        <span>{{ labels.kanban.truncated }}</span>
      </div>
    }

    <div class="kanban" role="region" [attr.aria-label]="'Tableau kanban regroupé par ' + groupLabel()" cdkDropListGroup>
      @for (col of columns(); track $index) {
        <section class="kanban-col" [class]="col.colorClass" [attr.aria-labelledby]="'kcol-' + colId(col.value)">
          <header class="kanban-col__head">
            <span class="dot"></span>
            <h3 class="kanban-col__title" [id]="'kcol-' + colId(col.value)">{{ col.label }}</h3>
            <span class="kanban-col__count" [attr.aria-label]="col.count + ' fiche(s)'">{{ col.count }}</span>
          </header>

          <div
            class="kanban-col__body"
            role="list"
            [attr.aria-label]="'Fiches ' + col.label"
            cdkDropList
            [cdkDropListData]="col.visibleItems"
            [cdkDropListDisabled]="!canDragDrop()"
            (cdkDropListDropped)="drop($event, col.value)">
            @if (col.visibleItems.length === 0) {
              <div class="kanban-empty">
                <i class="fa-solid fa-inbox"></i>
                Aucune fiche dans cette colonne
              </div>
            }
            @for (item of col.visibleItems; track item.id) {
              <article
                class="kcard"
                [class.kcard--movable]="canDragDrop()"
                [attr.tabindex]="canDragDrop() ? 0 : null"
                [attr.aria-roledescription]="canDragDrop() ? 'Fiche déplaçable' : null"
                cdkDrag
                [cdkDragDisabled]="!canDragDrop()"
                [cdkDragData]="item">
                <div class="kcard__top">
                  <div class="kcard__title">{{ cardTitle(item) }}</div>
                  @if (canDragDrop()) {
                    <button
                      type="button"
                      class="kcard__menu"
                      [attr.aria-label]="'Actions pour ' + cardTitle(item)"
                      aria-haspopup="menu"
                      (click)="openMoveMenu($event, item, col.value)">
                      <i class="fa-solid fa-ellipsis-vertical"></i>
                    </button>
                  }
                </div>
                <div class="kcard__fields">
                  @for (f of cardFields(item); track f.key) {
                    <div class="kcard__field">
                      <span class="kcard__label">{{ f.label }}</span>
                      <span class="kcard__value">{{ f.value }}</span>
                    </div>
                  }
                </div>
              </article>
            }
          </div>

          @if (col.remaining > 0) {
            <div class="kanban-col__more">
              <button type="button" class="p-button p-button-text" (click)="showMore(col.value)">
                Afficher plus ({{ col.remaining }} restantes)
              </button>
            </div>
          }
        </section>
      }
    </div>

    <p-menu #moveMenu [popup]="true" [model]="moveMenuItems()" appendTo="body" styleClass="studio-theme"></p-menu>
  `,
  styleUrl: './studio-kanban-board.component.scss'
})
export class StudioKanbanBoardComponent {
  private readonly viewsService = inject(StudioRecordViewsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly entityKey = input('');
  readonly kanban = input<RecordViewKanban | null>(null);
  readonly groups = input<RecordViewKanbanGroupDto[]>([]);
  readonly allFields = input<CustomField[]>([]);
  readonly truncated = input(false);

  /** Émis quand un déplacement échoue (409 ou autre) : le parent doit recharger la vue depuis le serveur. */
  readonly reload = output<void>();

  protected readonly labels = STUDIO_RUNTIME_LABELS;
  protected readonly canDragDrop = computed(() => this.auth.hasPermission(PERMISSIONS.customData.recordsWrite));
  protected readonly liveMessage = signal('');

  private readonly localGroups = signal<RecordViewKanbanGroupDto[]>([]);
  private readonly revealed = signal<Record<string, number>>({});
  // Rollback scopé par déplacement (et non un snapshot unique) : deux moves en vol restent
  // indépendants — l'échec de A ne restaure jamais un état « post-B » ni n'efface un rechargement
  // survenu entre-temps (le rollback chirurgical ne touche que si la carte est encore à son
  // emplacement optimiste).
  private readonly pendingMoves = new Map<string, { sourceValue: string | null; record: CustomRecord }>();

  protected readonly moveMenuItems = signal<MenuItem[]>([]);

  protected readonly groupLabel = computed(() => {
    const key = this.kanban()?.groupByFieldKey;
    return this.allFields().find(f => f.key === key)?.label ?? key ?? '';
  });

  constructor() {
    // Resynchronise `localGroups` chaque fois que le parent reçoit une nouvelle réponse serveur
    // (nouvelle référence de `groups()`). Les mutations optimistes locales (déplacements) modifient
    // `localGroups` directement sans changer `groups()`, donc cet effet ne les écrase pas entre deux
    // fetchs réseau réels.
    effect(() => {
      this.localGroups.set(this.groups());
    });
  }

  protected readonly columns = computed<KanbanColumnVm[]>(() => {
    const revealed = this.revealed();
    return this.localGroups().map((g, index) => {
      const key = g.value ?? NULL_KEY;
      const visible = revealed[key] ?? REVEAL_STEP;
      return {
        value: g.value,
        label: g.value === null ? this.labels.kanban.emptyGroup : g.label,
        count: g.count,
        items: g.items,
        visibleItems: g.items.slice(0, visible),
        remaining: Math.max(0, g.items.length - visible),
        colorClass: COLUMN_PALETTE[index % COLUMN_PALETTE.length]
      };
    });
  });

  colId(value: string | null): string {
    return value === null ? 'none' : encodeURIComponent(value);
  }

  cardTitle(item: CustomRecord): string {
    const titleKey = this.kanban()?.titleFieldKey;
    if (titleKey) {
      const v = item.data?.[titleKey];
      if (v !== undefined && v !== null && v !== '') return this.formatValue(v, this.fieldByKey(titleKey));
    }
    return item.id.slice(0, 8);
  }

  cardFields(item: CustomRecord): { key: string; label: string; value: string }[] {
    const keys = (this.kanban()?.cardFieldKeys ?? []).slice(0, 6);
    return keys.map(key => {
      const field = this.fieldByKey(key);
      const value = item.data?.[key];
      return { key, label: field?.label ?? key, value: this.formatValue(value, field) };
    });
  }

  showMore(value: string | null): void {
    const key = value ?? NULL_KEY;
    this.revealed.update(m => ({ ...m, [key]: (m[key] ?? REVEAL_STEP) + REVEAL_STEP }));
  }

  @ViewChild('moveMenu') private moveMenu?: Menu;

  openMoveMenu(event: Event, item: CustomRecord, sourceValue: string | null): void {
    const others = this.columns().filter(c => c.value !== sourceValue);
    this.moveMenuItems.set([
      { label: this.labels.kanban.moveTo, disabled: true },
      ...others.map(c => ({
        label: c.label,
        command: () => this.moveCard(item, sourceValue, c.value)
      }))
    ]);
    this.moveMenu?.toggle(event);
  }

  drop(event: CdkDragDrop<CustomRecord[]>, targetValue: string | null): void {
    if (!this.canDragDrop()) return;
    const item = event.item.data as CustomRecord;
    const sourceValue = this.findSourceValue(item);
    if (event.previousContainer === event.container) {
      // Réordonnancement visuel uniquement (aucun ordre persisté côté backend) : pas d'appel réseau.
      // Mise à jour immuable : muter `group.items` en place laisserait le signal non invalidé.
      const group = this.localGroups().find(g => (g.value ?? NULL_KEY) === (sourceValue ?? NULL_KEY));
      if (group) {
        const items = [...group.items];
        moveItemInArray(items, event.previousIndex, event.currentIndex);
        this.localGroups.update(gs => gs.map(g => g === group ? { ...g, items } : g));
      }
      return;
    }
    if (sourceValue === targetValue) return;
    this.moveCard(item, sourceValue, targetValue);
  }

  private findSourceValue(item: CustomRecord): string | null {
    const group = this.localGroups().find(g => g.items.some(i => i.id === item.id));
    return group?.value ?? null;
  }

  private fieldByKey(key: string): CustomField | undefined {
    return this.allFields().find(f => f.key === key);
  }

  private moveCard(item: CustomRecord, sourceValue: string | null, targetValue: string | null): void {
    const kanban = this.kanban();
    const key = this.entityKey();
    if (!kanban || !key) return;
    this.pendingMoves.set(item.id, { sourceValue, record: item });

    const groups = this.localGroups().map(g => ({ ...g, items: [...g.items] }));
    const source = groups.find(g => (g.value ?? NULL_KEY) === (sourceValue ?? NULL_KEY));
    const target = groups.find(g => (g.value ?? NULL_KEY) === (targetValue ?? NULL_KEY));
    if (source) {
      source.items = source.items.filter(i => i.id !== item.id);
      source.count = Math.max(0, source.count - 1);
    }
    if (target) {
      target.items = [item, ...target.items];
      target.count = target.count + 1;
    }
    this.localGroups.set(groups);
    this.liveMessage.set(this.labels.kanban.moved.replace('{column}', target?.label ?? this.labels.kanban.emptyGroup));

    const rowVersion = item.rowVersion ?? '';
    this.viewsService.patchRecord(key, item.id, { [kanban.groupByFieldKey]: targetValue }, rowVersion)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          if (res.success) {
            this.pendingMoves.delete(item.id);
            this.replaceCard(targetValue, item.id, res.data);
          } else {
            this.rollbackMove(item.id, targetValue);
            this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.labels.kanban.genericError });
          }
        },
        error: (err: { status?: number }) => {
          this.rollbackMove(item.id, targetValue);
          if (err?.status === 409) {
            this.toast.add({ severity: 'warn', summary: 'Conflit', detail: this.labels.kanban.conflict });
            this.reload.emit();
          } else {
            this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.labels.kanban.genericError });
          }
        }
      });
  }

  /**
   * Restaure UNIQUEMENT la carte `recordId` vers sa colonne d'origine, et seulement si elle est
   * encore à l'emplacement optimiste (sinon un rechargement externe a déjà resynchronisé l'état —
   * on n'écrase pas les données fraîches).
   */
  private rollbackMove(recordId: string, targetValue: string | null): void {
    const pending = this.pendingMoves.get(recordId);
    this.pendingMoves.delete(recordId);
    const groups = this.localGroups().map(g => ({ ...g, items: [...g.items] }));
    const target = groups.find(g => (g.value ?? NULL_KEY) === (targetValue ?? NULL_KEY));
    const moved = target?.items.find(i => i.id === recordId);
    if (!target || !moved) return; // resynchronisé entre-temps : ne rien écraser
    target.items = target.items.filter(i => i.id !== recordId);
    target.count = Math.max(0, target.count - 1);
    const source = groups.find(g => (g.value ?? NULL_KEY) === (pending?.sourceValue ?? NULL_KEY));
    if (source) {
      source.items = [pending?.record ?? moved, ...source.items];
      source.count = source.count + 1;
    }
    this.localGroups.set(groups);
  }

  private replaceCard(targetValue: string | null, recordId: string, record: CustomRecord): void {
    const groups = this.localGroups().map(g => ({ ...g, items: [...g.items] }));
    const target = groups.find(g => (g.value ?? NULL_KEY) === (targetValue ?? NULL_KEY));
    if (target) {
      const idx = target.items.findIndex(i => i.id === recordId);
      if (idx >= 0) target.items[idx] = record;
    }
    this.localGroups.set(groups);
  }


  private formatValue(value: unknown, field?: CustomField): string {
    if (value === null || value === undefined || value === '') return '—';
    if (!field) return String(value);
    switch (field.fieldType) {
      case CustomFieldType.Boolean: return value ? 'Oui' : 'Non';
      case CustomFieldType.MultiSelect: return Array.isArray(value) ? value.join(', ') : String(value);
      case CustomFieldType.Date: return this.formatDate(value, false);
      case CustomFieldType.DateTime: return this.formatDate(value, true);
      case CustomFieldType.Select:
      case CustomFieldType.RelationCustom:
      case CustomFieldType.RelationExisting: {
        const opt = field.options?.find(o => o.value === value);
        return opt?.label ?? String(value);
      }
      default: return String(value);
    }
  }

  private formatDate(value: unknown, withTime: boolean): string {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return withTime
      ? d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
      : d.toLocaleDateString('fr-FR');
  }
}
