import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import {
  OPERATORS_BY_TYPE, RECORD_VIEW_LIMITS, RecordViewFilter, RecordViewFilterOp
} from '../views/studio-record-views.models';
import { STUDIO_RUNTIME_LABELS } from './studio-runtime-labels';

/** Forme de l'éditeur de valeur déduite du couple (type de champ, opérateur). */
export type FilterValueKind = 'none' | 'range' | 'list' | 'boolean' | 'option' | 'number' | 'date' | 'text';

const NUMERIC_TYPES: ReadonlySet<CustomFieldType> = new Set([
  CustomFieldType.Number, CustomFieldType.Decimal, CustomFieldType.Money,
  CustomFieldType.Percentage, CustomFieldType.Rating, CustomFieldType.AutoNumber
]);
const DATE_TYPES: ReadonlySet<CustomFieldType> = new Set([CustomFieldType.Date, CustomFieldType.DateTime]);
const OPTION_TYPES: ReadonlySet<CustomFieldType> = new Set([CustomFieldType.Select, CustomFieldType.MultiSelect]);

export function filterValueKind(field: CustomField | undefined, op: RecordViewFilterOp): FilterValueKind {
  if (op === 'is_empty' || op === 'is_not_empty') return 'none';
  if (op === 'between') return 'range';
  if (op === 'in') return 'list';
  if (!field) return 'text';
  if (field.fieldType === CustomFieldType.Boolean) return 'boolean';
  if (OPTION_TYPES.has(field.fieldType) && (op === 'eq' || op === 'neq') && (field.options?.length ?? 0) > 0) return 'option';
  if (NUMERIC_TYPES.has(field.fieldType)) return 'number';
  if (DATE_TYPES.has(field.fieldType)) return 'date';
  return 'text';
}

/** Découpe « a, b ,c » en tableau borné à `maxInValues` (valeurs vides ignorées). */
export function parseListValue(raw: string): string[] {
  return raw.split(',').map(v => v.trim()).filter(v => v.length > 0).slice(0, RECORD_VIEW_LIMITS.maxInValues);
}

/**
 * Éditeur de filtres d'une vue enregistrée (2.5c) : lignes champ / opérateur / valeur, bornées à
 * `RECORD_VIEW_LIMITS.maxFilters`. Les opérateurs proposés suivent `OPERATORS_BY_TYPE` (miroir du
 * validateur serveur) ; un changement de champ ou d'opérateur incompatible réinitialise la valeur.
 * Réutilisé par le concepteur de vues (2.5d) puis par les filtres du tableau de bord (3.4).
 */
@Component({
  selector: 'app-studio-filter-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, InputTextModule, SelectModule],
  template: `
    <div class="ffb" role="group" [attr.aria-label]="labels.filters.title">
      @for (row of rows(); track $index; let i = $index) {
        <div class="ffb__row" [attr.data-testid]="'filter-row-' + i">
          <p-select class="ffb__field" [options]="fieldOptions()" [ngModel]="row.filter.fieldKey" (ngModelChange)="setField(i, $event)"
            optionLabel="label" optionValue="key" [disabled]="disabled()" appendTo="body" panelStyleClass="studio-theme"
            [placeholder]="labels.filters.field" [attr.aria-label]="labels.filters.field" />
          <p-select class="ffb__op" [options]="row.ops" [ngModel]="row.filter.op" (ngModelChange)="setOp(i, $event)"
            optionLabel="label" optionValue="value" [disabled]="disabled()" appendTo="body" panelStyleClass="studio-theme"
            [attr.aria-label]="labels.filters.operator" />
          @switch (row.kind) {
            @case ('none') {}
            @case ('range') {
              <input pInputText class="ffb__value ffb__value--half" [type]="row.inputType" [ngModel]="row.range[0]"
                (ngModelChange)="setRange(i, 0, $event)" [disabled]="disabled()" [attr.aria-label]="labels.filters.value + ' (min)'" />
              <input pInputText class="ffb__value ffb__value--half" [type]="row.inputType" [ngModel]="row.range[1]"
                (ngModelChange)="setRange(i, 1, $event)" [disabled]="disabled()" [attr.aria-label]="labels.filters.value + ' (max)'" />
            }
            @case ('list') {
              <input pInputText class="ffb__value" [ngModel]="row.text" (ngModelChange)="setList(i, $event)" [disabled]="disabled()"
                placeholder="a, b, c" [attr.aria-label]="labels.filters.value" />
            }
            @case ('boolean') {
              <p-select class="ffb__value" [options]="booleanOptions" [ngModel]="row.filter.value" (ngModelChange)="setValue(i, $event)"
                optionLabel="label" optionValue="value" [disabled]="disabled()" appendTo="body" panelStyleClass="studio-theme"
                [attr.aria-label]="labels.filters.value" />
            }
            @case ('option') {
              <p-select class="ffb__value" [options]="row.field?.options ?? []" [ngModel]="row.filter.value" (ngModelChange)="setValue(i, $event)"
                optionLabel="label" optionValue="value" [disabled]="disabled()" appendTo="body" panelStyleClass="studio-theme"
                [placeholder]="labels.filters.value" [attr.aria-label]="labels.filters.value" />
            }
            @default {
              <input pInputText class="ffb__value" [type]="row.inputType" [ngModel]="row.text"
                (ngModelChange)="setScalar(i, $event, row.kind)" [disabled]="disabled()" [attr.aria-label]="labels.filters.value" />
            }
          }
          <button pButton type="button" icon="pi pi-times" class="p-button-text p-button-sm p-button-danger ffb__remove"
            [disabled]="disabled()" (click)="remove(i)" [attr.aria-label]="labels.filters.remove"></button>
        </div>
      } @empty {
        <p class="ffb__empty">{{ labels.filters.empty }}</p>
      }
      <div class="ffb__footer">
        <button pButton type="button" icon="pi pi-plus" class="p-button-sm p-button-outlined" [label]="labels.filters.add"
          [disabled]="disabled() || !canAdd()" (click)="add()"></button>
        @if (!canAdd()) {
          <small class="ffb__limit" role="status">{{ labels.filters.limitReached }}</small>
        }
      </div>
    </div>
  `,
  styles: [`
    .ffb { display: flex; flex-direction: column; gap: var(--spacing-2); }
    .ffb__row { display: grid; grid-template-columns: minmax(8rem, 1.2fr) minmax(8rem, 1fr) minmax(8rem, 1.4fr) auto; gap: var(--spacing-2); align-items: center; }
    .ffb__row:has(.ffb__value--half) { grid-template-columns: minmax(8rem, 1.2fr) minmax(8rem, 1fr) minmax(4rem, .7fr) minmax(4rem, .7fr) auto; }
    .ffb__value { width: 100%; }
    .ffb__empty, .ffb__limit { color: var(--text-secondary, #6b7280); margin: 0; font-size: .875rem; }
    .ffb__footer { display: flex; align-items: center; gap: var(--spacing-3); }
    @media (max-width: 640px) { .ffb__row, .ffb__row:has(.ffb__value--half) { grid-template-columns: 1fr; } }
  `]
})
export class StudioFilterBuilderComponent {
  /** Champs actifs de l'entité (hors clés système : un filtre porte toujours sur un champ). */
  readonly fields = input.required<CustomField[]>();
  readonly filters = model<RecordViewFilter[]>([]);
  readonly disabled = input(false);

  protected readonly labels = STUDIO_RUNTIME_LABELS;
  protected readonly booleanOptions = [{ label: 'Oui', value: true }, { label: 'Non', value: false }];

  readonly fieldOptions = computed(() => this.fields().filter(f => f.isActive).map(f => ({ key: f.key, label: f.label })));
  readonly canAdd = computed(() => this.filters().length < RECORD_VIEW_LIMITS.maxFilters);

  protected readonly rows = computed(() => this.filters().map(filter => {
    const field = this.fields().find(f => f.key === filter.fieldKey);
    const kind = filterValueKind(field, filter.op);
    const value = filter.value;
    return {
      filter,
      field,
      kind,
      ops: this.opsFor(field).map(op => ({ value: op, label: this.labels.filters.ops[op] })),
      inputType: kind === 'number' || (kind === 'range' && field && NUMERIC_TYPES.has(field.fieldType)) ? 'number'
        : kind === 'date' || (kind === 'range' && field && DATE_TYPES.has(field.fieldType)) ? 'date' : 'text',
      range: Array.isArray(value) && value.length === 2 ? [value[0] ?? null, value[1] ?? null] : [null, null],
      text: Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)
    };
  }));

  private opsFor(field: CustomField | undefined): RecordViewFilterOp[] {
    return field ? OPERATORS_BY_TYPE[field.fieldType] ?? ['eq', 'neq', 'is_empty', 'is_not_empty'] : ['eq', 'neq', 'is_empty', 'is_not_empty'];
  }

  add(): void {
    if (!this.canAdd()) return;
    const first = this.fieldOptions()[0];
    const field = this.fields().find(f => f.key === first?.key);
    this.filters.set([...this.filters(), { fieldKey: first?.key ?? '', op: this.opsFor(field)[0], value: null }]);
  }

  remove(index: number): void {
    this.filters.set(this.filters().filter((_, i) => i !== index));
  }

  setField(index: number, fieldKey: string): void {
    const field = this.fields().find(f => f.key === fieldKey);
    const ops = this.opsFor(field);
    const current = this.filters()[index];
    const op = ops.includes(current.op) ? current.op : ops[0];
    this.patch(index, { fieldKey, op, value: null });
  }

  setOp(index: number, op: RecordViewFilterOp): void {
    const current = this.filters()[index];
    const field = this.fields().find(f => f.key === current.fieldKey);
    const keep = filterValueKind(field, current.op) === filterValueKind(field, op) && op !== 'is_empty' && op !== 'is_not_empty';
    this.patch(index, { op, value: keep ? current.value : null });
  }

  setValue(index: number, value: unknown): void {
    this.patch(index, { value: value ?? null });
  }

  setScalar(index: number, raw: string | number | null, kind: FilterValueKind): void {
    if (raw === null || raw === '') { this.patch(index, { value: null }); return; }
    this.patch(index, { value: kind === 'number' ? Number(raw) : String(raw) });
  }

  setList(index: number, raw: string): void {
    this.patch(index, { value: parseListValue(raw ?? '') });
  }

  setRange(index: number, position: 0 | 1, raw: string | number | null): void {
    const current = this.filters()[index].value;
    const range: [unknown, unknown] = Array.isArray(current) && current.length === 2 ? [current[0], current[1]] : [null, null];
    const field = this.fields().find(f => f.key === this.filters()[index].fieldKey);
    const numeric = field ? NUMERIC_TYPES.has(field.fieldType) : false;
    range[position] = raw === null || raw === '' ? null : numeric ? Number(raw) : String(raw);
    this.patch(index, { value: range });
  }

  private patch(index: number, changes: Partial<RecordViewFilter>): void {
    this.filters.set(this.filters().map((f, i) => i === index ? { ...f, ...changes } : f));
  }
}
