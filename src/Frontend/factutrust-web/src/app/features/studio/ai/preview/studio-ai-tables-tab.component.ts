import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import {
  STUDIO_SPEC_FIELD_TYPES,
  STUDIO_SPEC_LIMITS,
  StudioSpecChange,
  StudioSpecEntity,
  StudioSpecField,
  StudioSpecFieldType,
  StudioSpecOption,
  StudioSystemSpec,
  relationTargetName
} from '../studio-ai.models';
import { slugify, uniqueKey } from '../studio-ai-spec.util';

/** Chemins de changement de champ produits par `diffSpec` : `entities.<ref>.fields.<key>`. */
const FIELD_CHANGE_PATH = /^entities\.([^.]+)\.fields\.([^.]+)$/;

/**
 * Onglet « Tables » : liste des tables à gauche, grille des champs de la table sélectionnée à
 * droite (Libellé · Clé · Type · Requis · Unique · Détails).
 *
 * Table HTML plutôt que `p-table` : la grille est dense et purement descriptive, ce qui évite le
 * poids de style d'un `p-datatable` (budget `anyComponentStyle`). En mode Personnaliser (3.4g1,
 * `editable`), les cellules deviennent éditables (libellé inline, `p-select` de type, interrupteurs
 * Requis/Unique, puces d'options), avec « Ajouter un champ », « Retirer » (ligne barrée restaurable)
 * et marquage « Ajouté / Modifié / Retiré » déduit de `changes` (le `diffSpec` du store). Une table
 * qui réutilise une table existante (`existingKey`) reste verrouillée en lecture seule. Le mode
 * lecture seule est strictement inchangé. En 3.4g2, les lignes deviennent réordonnables :
 * glisser-déposer par la poignée (`cdkDropList`/`cdkDragHandle`) ou boutons Monter/Descendre
 * (le CDK n'a pas de tri clavier natif), chaque déplacement émettant `fieldReorder`.
 */
@Component({
  selector: 'app-studio-ai-tables-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkDrag, CdkDragHandle, CdkDropList,
    FormsModule, InputTextModule, SelectModule, ToggleSwitchModule, ButtonModule, TagModule, TooltipModule
  ],
  styleUrl: './studio-ai-preview.scss',
  template: `
    @if (!entities().length) {
      <p class="sai-hint">{{ labels.noEntities }}</p>
    } @else {
      <div class="sai-grid" style="grid-template-columns: 15rem minmax(0, 1fr)">
        <ul class="sai-list">
          @for (entity of entities(); track entity.ref) {
            <li>
              <button
                type="button"
                class="sai-list__item"
                [class.sai-list__item--active]="entity.ref === activeRef()"
                [class.sai-list__item--highlight]="entity.ref === highlightedRef()"
                [attr.aria-pressed]="entity.ref === activeRef()"
                (click)="select(entity.ref)">
                <i [class]="entity.icon || 'fa-solid fa-table'" aria-hidden="true"></i>
                <span>
                  <span [class.sai-highlight]="entity.ref === highlightedRef()">{{ entity.displayName }}</span>
                  @if (entity.existingKey) {
                    <span class="sai-code sai-existing" style="display: block">↳ {{ entity.existingKey }}</span>
                  }
                  <span class="sai-code" style="display: block">{{ entity.ref }}</span>
                </span>
                <span class="sai-list__meta">{{ entity.fields.length }} {{ labels.fields }}</span>
              </button>
            </li>
          }
        </ul>

        @if (activeEntity(); as entity) {
          <div>
            <div class="sai-block__head">
              <i [class]="entity.icon || 'fa-solid fa-table'" aria-hidden="true"></i>
              <span [class.sai-highlight]="entity.ref === highlightedRef()">{{ entity.displayName }}</span>
              <span class="sai-code">{{ entity.ref }}</span>
              <span class="sai-list__meta">{{ entity.fields.length }} / {{ maxFields }} {{ labels.fields }}</span>
            </div>
            @if (entity.description) {
              <p class="sai-hint">{{ entity.description }}</p>
            }
            @if (editable() && !entity.existingKey) {
              <!-- Mode Personnaliser (3.4g1) : édition inline des champs. -->
              <div class="sai-table__scroll">
                <table class="sai-table sai-table--edit">
                  <thead>
                    <tr>
                      <th scope="col"><span class="sr-only">{{ customize.dragHandle }}</span></th>
                      <th scope="col">{{ customize.fieldLabel }} · {{ labels.colKey }}</th>
                      <th scope="col">{{ customize.fieldType }}</th>
                      <th scope="col">{{ customize.required }}</th>
                      <th scope="col">{{ customize.unique }}</th>
                      <th scope="col">{{ labels.colDetails }}</th>
                      <th scope="col"><span class="sr-only">{{ customize.actions }}</span></th>
                    </tr>
                  </thead>
                  <!-- 3.4g2 : réordonnancement par glisser-déposer (poignée) et boutons ↑↓. -->
                  <tbody cdkDropList (cdkDropListDropped)="onDrop(entity, $event)">
                    @for (field of entity.fields; track field.key; let first = $first, last = $last, i = $index) {
                      <tr
                        cdkDrag
                        [class.sai-row--added]="changeKind(entity.ref, field.key) === 'added'"
                        [class.sai-row--changed]="changeKind(entity.ref, field.key) === 'changed'"
                        [attr.data-has-options]="hasOptionsEditor(field) ? '' : null">
                        <td class="sai-cell-grip">
                          <span
                            class="sai-grip"
                            cdkDragHandle
                            [attr.aria-label]="customize.dragHandle"
                            [attr.data-component-id]="'sai-field-drag-' + field.key">
                            <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>
                          </span>
                        </td>
                        <td>
                          <input
                            type="text"
                            pInputText
                            class="sai-inline"
                            [ngModel]="field.label"
                            (ngModelChange)="onLabelEdit(entity, field, $event)"
                            [attr.aria-label]="customize.fieldLabel"
                            [attr.data-component-id]="'sai-field-label-' + field.key" />
                          <span class="sai-code sai-field-key">
                            {{ field.key }}
                            @if (changeKind(entity.ref, field.key) === 'added') {
                              <p-tag severity="success" [value]="customize.addedTag" />
                            } @else if (changeKind(entity.ref, field.key) === 'changed') {
                              <p-tag severity="info" [value]="customize.changedTag" />
                            }
                          </span>
                          @if (isDuplicateKey(entity, field.key)) {
                            <span class="sai-field-error">{{ customize.keyTaken }}</span>
                          }
                        </td>
                        <td>
                          <p-select
                            class="sai-type-select"
                            [options]="fieldTypeOptions"
                            [ngModel]="field.type"
                            (ngModelChange)="onTypeEdit(entity, field, $event)"
                            optionLabel="label"
                            optionValue="value"
                            appendTo="body"
                            panelStyleClass="studio-theme"
                            [attr.aria-label]="customize.fieldType"
                            [attr.data-component-id]="'sai-field-type-' + field.key" />
                        </td>
                        <td class="sai-cell-center">
                          <p-toggleswitch
                            [ngModel]="field.required"
                            (ngModelChange)="onFlagEdit(entity, field, 'required', $event)"
                            [ariaLabel]="customize.required"
                            [attr.data-component-id]="'sai-field-required-' + field.key" />
                        </td>
                        <td class="sai-cell-center">
                          <p-toggleswitch
                            [ngModel]="field.unique"
                            (ngModelChange)="onFlagEdit(entity, field, 'unique', $event)"
                            [ariaLabel]="customize.unique"
                            [attr.data-component-id]="'sai-field-unique-' + field.key" />
                        </td>
                        <td class="sai-hint">
                          @if (hasOptionsEditor(field)) {
                            {{ optionsCountLabel(field) }}
                          } @else {
                            {{ details(field) }}
                          }
                        </td>
                        <td>
                          <p-button
                            icon="fa-solid fa-arrow-up"
                            severity="secondary"
                            [text]="true"
                            [pTooltip]="customize.moveUp"
                            tooltipPosition="top"
                            [attr.aria-label]="customize.moveUp"
                            [attr.data-component-id]="'sai-field-up-' + field.key"
                            [disabled]="first"
                            (onClick)="onMoveField(entity, i, i - 1)" />
                          <p-button
                            icon="fa-solid fa-arrow-down"
                            severity="secondary"
                            [text]="true"
                            [pTooltip]="customize.moveDown"
                            tooltipPosition="top"
                            [attr.aria-label]="customize.moveDown"
                            [attr.data-component-id]="'sai-field-down-' + field.key"
                            [disabled]="last"
                            (onClick)="onMoveField(entity, i, i + 1)" />
                          <p-button
                            icon="fa-solid fa-trash-can"
                            severity="danger"
                            [text]="true"
                            [pTooltip]="customize.removeField"
                            tooltipPosition="top"
                            [attr.aria-label]="customize.removeField"
                            [attr.data-component-id]="'sai-field-delete-' + field.key"
                            (onClick)="onRemoveField(entity, field)" />
                        </td>
                      </tr>
                      @if (hasOptionsEditor(field)) {
                        <tr
                          class="sai-options-row"
                          [class.sai-row--added]="changeKind(entity.ref, field.key) === 'added'"
                          [class.sai-row--changed]="changeKind(entity.ref, field.key) === 'changed'">
                          <td colspan="7">
                            <div class="sai-options">
                              <span class="sai-hint">{{ customize.options }} :</span>
                              @for (option of field.options ?? []; track option.value) {
                                <span class="sai-opt">
                                  {{ option.label || option.value }}
                                  <button
                                    type="button"
                                    class="sai-opt__x"
                                    [attr.aria-label]="removeOptionLabel(option)"
                                    (click)="onRemoveOption(entity, field, option)">
                                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                                  </button>
                                </span>
                              }
                              <button
                                type="button"
                                class="sai-opt-add"
                                [attr.data-component-id]="'sai-option-add-' + field.key"
                                (click)="onAddOption(entity, field)">
                                <i class="fa-solid fa-plus" aria-hidden="true"></i> {{ customize.addOption }}
                              </button>
                            </div>
                          </td>
                        </tr>
                      }
                    }
                    @for (removed of removedFields(entity.ref); track removed.key) {
                      <tr class="sai-row--removed">
                        <td></td>
                        <td>
                          <span class="sai-strike">{{ removed.label }}</span>
                          <p-tag severity="secondary" [value]="customize.removedTag" />
                          <span class="sai-code sai-strike sai-field-key">{{ removed.key }}</span>
                        </td>
                        <td><span class="sai-strike">{{ typeLabel(removed) }}</span></td>
                        <td class="sai-cell-center"><span class="sai-dash" aria-hidden="true">—</span></td>
                        <td class="sai-cell-center"><span class="sai-dash" aria-hidden="true">—</span></td>
                        <td>
                          <button
                            type="button"
                            class="sai-link"
                            [attr.data-component-id]="'sai-field-restore-' + removed.key"
                            (click)="onRemoveField(entity, removed)">
                            {{ customize.restoreField }}
                          </button>
                        </td>
                        <td></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="sai-add-field">
                <p-button
                  [label]="customize.addField"
                  icon="fa-solid fa-plus"
                  [outlined]="true"
                  size="small"
                  data-component-id="sai-field-add"
                  [disabled]="entity.fields.length >= maxFields"
                  (onClick)="onAddField(entity)" />
                @if (entity.fields.length >= maxFields) {
                  <span class="sai-hint sai-hint--warn">{{ customize.maxFields }}</span>
                }
              </div>
            } @else {
              @if (editable() && entity.existingKey) {
                <p class="sai-hint sai-locked">
                  <i class="fa-solid fa-lock" aria-hidden="true"></i> {{ customize.locked }}
                </p>
              }
              <div class="sai-table__scroll">
                <table class="sai-table">
                  <thead>
                    <tr>
                      <th scope="col">{{ labels.colLabel }}</th>
                      <th scope="col">{{ labels.colKey }}</th>
                      <th scope="col">{{ labels.colType }}</th>
                      <th scope="col">{{ labels.colRequired }}</th>
                      <th scope="col">{{ labels.colUnique }}</th>
                      <th scope="col">{{ labels.colDetails }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (field of entity.fields; track field.key) {
                      <tr>
                        <td>{{ field.label }}</td>
                        <td class="sai-code">{{ field.key }}</td>
                        <td>{{ typeLabel(field) }}</td>
                        <td>
                          @if (field.required) {
                            <i class="fa-solid fa-check sai-ok" [attr.aria-label]="labels.colRequired"></i>
                          } @else {
                            <span class="sai-dash" aria-hidden="true">—</span>
                          }
                        </td>
                        <td>
                          @if (field.unique) {
                            <i class="fa-solid fa-check sai-ok" [attr.aria-label]="labels.colUnique"></i>
                          } @else {
                            <span class="sai-dash" aria-hidden="true">—</span>
                          }
                        </td>
                        <td class="sai-hint">{{ details(field) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        }
      </div>
    }
  `
})
export class StudioAiTablesTabComponent {
  readonly spec = input.required<StudioSystemSpec>();
  /** `ref` de la table à déplier (envoyée par l'onglet Vue d'ensemble via la page). */
  readonly selectedRef = input<string | null>(null);
  /** Mode Personnaliser (3.4g1) : les champs de la table active deviennent éditables. */
  readonly editable = input(false);
  /** `ref` de la table renommée « (2) » après « Créer quand même » (R21) : libellé en surbrillance. */
  readonly highlightedRef = input<string | null>(null);
  /** Différences spec serveur → brouillon (`store.changes()`) : marquage des lignes et champs retirés. */
  readonly changes = input<StudioSpecChange[]>([]);

  /** Modification inline d'un champ (libellé, type, requis/unique, options). */
  readonly fieldChange = output<{ ref: string; key: string; patch: Partial<StudioSpecField> }>();
  /** « Ajouter un champ » sur la table `ref` (le store crée le champ par défaut, clé unique). */
  readonly fieldAdd = output<string>();
  /** « Retirer » et « Rétablir » un champ (bascule côté store). */
  readonly fieldRemove = output<{ ref: string; key: string }>();
  /** Réordonnancement d'un champ (3.4g2) : déplacement de `from` vers `to` dans `entity.fields`. */
  readonly fieldReorder = output<{ ref: string; from: number; to: number }>();

  readonly labels = STUDIO_AI_LABELS.preview;
  readonly customize = STUDIO_AI_LABELS.customize;
  readonly maxFields = STUDIO_SPEC_LIMITS.maxFields;

  /** Options du `p-select` de type : libellés FR canoniques (`STUDIO_AI_LABELS.fieldTypes`). */
  readonly fieldTypeOptions: { value: StudioSpecFieldType; label: string }[] =
    STUDIO_SPEC_FIELD_TYPES.map(value => ({ value, label: STUDIO_AI_LABELS.fieldTypes[value] ?? value }));

  private readonly clicked = signal<string | null>(null);

  readonly entities = computed(() => this.spec().entities);
  readonly activeRef = computed(() => {
    const entities = this.entities();
    const wanted = this.clicked() ?? this.selectedRef();
    if (wanted && entities.some(e => e.ref === wanted)) return wanted;
    return entities[0]?.ref ?? null;
  });
  readonly activeEntity = computed<StudioSpecEntity | null>(
    () => this.entities().find(e => e.ref === this.activeRef()) ?? null
  );

  /** Changements indexés par chemin (`entities.<ref>.fields.<key>`) pour le marquage des lignes. */
  private readonly changesByPath = computed(() => {
    const map = new Map<string, StudioSpecChange>();
    for (const change of this.changes()) map.set(change.path, change);
    return map;
  });

  constructor() {
    // Une nouvelle demande d'ouverture (clic dans la Vue d'ensemble) reprend la main sur la
    // sélection locale de l'utilisateur.
    effect(() => {
      this.selectedRef();
      this.clicked.set(null);
    });
  }

  select(ref: string): void {
    this.clicked.set(ref);
  }

  typeLabel(field: StudioSpecField): string {
    return STUDIO_AI_LABELS.fieldTypes[field.type] ?? field.type;
  }

  /** Colonne « Détails » : options d'une liste, cible d'une relation, ou réglage de configuration. */
  details(field: StudioSpecField): string {
    if (field.type === 'relation') {
      const target = relationTargetName(this.spec(), field.relationTo);
      return target.erp
        ? `→ ${target.name} (${STUDIO_AI_LABELS.preview.erpBadge})`
        : `→ ${target.name || '—'}`;
    }
    if (field.options?.length) {
      return field.options.map(o => o.label || o.value).join(' · ');
    }
    const config = field.config;
    if (config?.currency) return String(config.currency);
    if (typeof config?.max === 'number') return `max ${config.max}`;
    if (config?.format) return String(config.format);
    return '—';
  }

  // ---- Mode Personnaliser (3.4g1) -------------------------------------------------------------------

  /** Nature du changement d'un champ présent dans le brouillon ; `null` = identique au serveur. */
  changeKind(ref: string, key: string): 'added' | 'changed' | null {
    const change = this.changesByPath().get(`entities.${ref}.fields.${key}`);
    return change && change.kind !== 'removed' ? change.kind : null;
  }

  /**
   * Champs retirés du brouillon (connus du serveur, absents de `entity.fields`) : lignes barrées
   * avec « Rétablir », reconstruites depuis `changes` (`before` porte le champ d'origine).
   */
  removedFields(ref: string): StudioSpecField[] {
    const removed: StudioSpecField[] = [];
    for (const change of this.changes()) {
      if (change.kind !== 'removed') continue;
      const match = FIELD_CHANGE_PATH.exec(change.path);
      if (!match || match[1] !== ref) continue;
      const before = change.before as StudioSpecField | undefined;
      if (before && typeof before.key === 'string' && before.key === match[2]) removed.push(before);
    }
    return removed;
  }

  /** Éditeur d'options réservé aux listes (choix unique / multiple). */
  hasOptionsEditor(field: StudioSpecField): boolean {
    return field.type === 'select' || field.type === 'multiselect';
  }

  /** Clé présente deux fois dans la table (spec fautive) : signalée via `customize.keyTaken`. */
  isDuplicateKey(entity: StudioSpecEntity, key: string): boolean {
    return entity.fields.filter(f => f.key === key).length > 1;
  }

  optionsCountLabel(field: StudioSpecField): string {
    return formatLabel(this.customize.optionsCount, { count: field.options?.length ?? 0 });
  }

  removeOptionLabel(option: StudioSpecOption): string {
    return formatLabel(this.customize.removeOption, { option: option.label || option.value });
  }

  onLabelEdit(entity: StudioSpecEntity, field: StudioSpecField, label: string): void {
    if (label === field.label) return;
    this.fieldChange.emit({ ref: entity.ref, key: field.key, patch: { label } });
  }

  onTypeEdit(entity: StudioSpecEntity, field: StudioSpecField, type: StudioSpecFieldType): void {
    if (type === field.type) return;
    this.fieldChange.emit({ ref: entity.ref, key: field.key, patch: { type } });
  }

  onFlagEdit(entity: StudioSpecEntity, field: StudioSpecField, flag: 'required' | 'unique', value: boolean): void {
    if (value === field[flag]) return;
    const patch: Partial<StudioSpecField> = flag === 'required' ? { required: value } : { unique: value };
    this.fieldChange.emit({ ref: entity.ref, key: field.key, patch });
  }

  /** « Ajouter une option » : libellé « Option n », valeur slugifiée unique dans le champ. */
  onAddOption(entity: StudioSpecEntity, field: StudioSpecField): void {
    const options = field.options ?? [];
    const label = formatLabel(this.customize.newOption, { index: options.length + 1 });
    const value = uniqueKey(slugify(label), options.map(o => o.value));
    this.fieldChange.emit({ ref: entity.ref, key: field.key, patch: { options: [...options, { value, label }] } });
  }

  onRemoveOption(entity: StudioSpecEntity, field: StudioSpecField, option: StudioSpecOption): void {
    const options = (field.options ?? []).filter(o => o.value !== option.value);
    this.fieldChange.emit({ ref: entity.ref, key: field.key, patch: { options } });
  }

  onAddField(entity: StudioSpecEntity): void {
    if (entity.fields.length >= this.maxFields) return;
    this.fieldAdd.emit(entity.ref);
  }

  /** « Retirer » et « Rétablir » partagent le même événement : le store bascule l'état du champ. */
  onRemoveField(entity: StudioSpecEntity, field: StudioSpecField): void {
    this.fieldRemove.emit({ ref: entity.ref, key: field.key });
  }

  // ---- Réordonnancement (3.4g2) ---------------------------------------------------------------------

  /**
   * Glisser-déposer d'une ligne : le CDK ne trie que les lignes `cdkDrag` (les lignes d'options
   * et les lignes barrées ne participent pas), les index correspondent donc à `entity.fields`.
   */
  onDrop(entity: StudioSpecEntity, event: CdkDragDrop<StudioSpecField[]>): void {
    this.onMoveField(entity, event.previousIndex, event.currentIndex);
  }

  /** Déplacement commun (poignée glissée ou boutons ↑↓) : borné, sans émission si inchangé. */
  onMoveField(entity: StudioSpecEntity, from: number, to: number): void {
    if (entity.existingKey) return;
    const last = entity.fields.length - 1;
    if (from === to || from < 0 || to < 0 || from > last || to > last) return;
    this.fieldReorder.emit({ ref: entity.ref, from, to });
  }
}
