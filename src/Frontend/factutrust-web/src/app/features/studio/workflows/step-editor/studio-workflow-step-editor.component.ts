import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CustomField, CustomFieldType, parseFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { AutomationAction, BridgeParamMapping, CustomEntity } from '../../studio.models';
import { StudioService } from '../../studio.service';
import { StudioBridgeActionPickerComponent } from '../../shared/studio-bridge-action-picker.component';
import { StudioFilterBuilderComponent } from '../../shared/studio-filter-builder.component';
import type { RecordViewFilter } from '../../views/studio-record-views.models';
import { STUDIO_WORKFLOW_LABELS, STEP_TYPE_ICONS, stepTypeLabel } from '../studio-workflow-labels';
import {
  COMPUTED_FIELD_TYPES,
  SAVE_AS_REGEX,
  STEP_KEY_REGEX,
  StepCatalogEntryDto,
  StepCatalogPropertyDto,
  TEMPLATE_VARIABLES,
  WORKFLOW_LIMITS,
  WorkflowFilterSpec,
  WorkflowRecipient,
  WorkflowStepSpec,
  WorkflowValidationIssueDto
} from '../studio-workflows.models';
import { contextFieldOptions, toRecordViewFilters, toWorkflowFilters } from './studio-workflow-filter.adapter';
import { StudioAssigneePickerComponent } from './studio-assignee-picker.component';

/** Défauts affichés des `enum` quand l'étape ne les définit pas (catalogue serveur). */
const ENUM_DEFAULTS: Readonly<Record<string, string>> = { match: 'all', onFalse: 'stop', onFailure: 'fail', onTimeout: 'reject', onReject: 'stop' };
const COMPUTED: ReadonlySet<CustomFieldType> = new Set(COMPUTED_FIELD_TYPES);

/** Ligne d'édition d'une propriété `fieldMap` (`set`), stockée en objet `{ [fieldKey]: string }`. */
interface SetRow { field: string; value: string }

/**
 * Éditeur d'une étape `WorkflowStepSpec` (4.4c1) : rend un contrôle par propriété du catalogue
 * serveur (`StepCatalogEntryDto.properties`, 11 kinds), en réutilisant `app-studio-filter-builder`
 * pour `filters` (via l'adaptateur D-44-11) et `app-studio-bridge-action-picker` pour
 * `action` + `mapping` (D10). Colonne du milieu (320 px) des maquettes
 * `d44-workflows-designer-condition.html` / `d44-workflows-designer-erp-action.html`.
 * Surface de configuration uniquement : aucune action n'est exécutée ici.
 */
@Component({
  selector: 'app-studio-workflow-step-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, ButtonModule, InputNumberModule, InputTextModule, SelectModule, TextareaModule, ToggleSwitchModule,
    StudioAssigneePickerComponent, StudioBridgeActionPickerComponent, StudioFilterBuilderComponent
  ],
  template: `
    <section class="wf-editor" data-testid="step-editor">
      <header class="wf-editor__head">
        <span class="wf-editor__icon"><i [class]="icon()" aria-hidden="true"></i></span>
        <div>
          <h3 class="wf-editor__title">{{ title() }}</h3>
          @if (entry()?.description; as d) { <p class="studio-muted wf-editor__desc">{{ d }}</p> }
        </div>
      </header>

      <div class="wf-prop" data-testid="wf-prop-key">
        <label class="wf-prop__label" for="wf-step-key">{{ L.steps.key }} <span class="ft-req">*</span></label>
        <input id="wf-step-key" pInputText [ngModel]="step().key" (ngModelChange)="set('key', $event)"
          [pattern]="keyPattern" [disabled]="disabled()" [attr.aria-label]="L.steps.key" autocomplete="off" />
        <small class="studio-muted">{{ L.designer.keyHint }}</small>
        @if (issueFor('key'); as i) { <small class="wf-issue">{{ i.message }}</small> }
      </div>

      <div class="wf-prop" data-testid="wf-prop-label">
        <label class="wf-prop__label" for="wf-step-label">{{ L.steps.label }}</label>
        <input id="wf-step-label" pInputText [ngModel]="step().label ?? ''" (ngModelChange)="set('label', $event)"
          [disabled]="disabled()" [attr.aria-label]="L.steps.label" autocomplete="off" />
        @if (issueFor('label'); as i) { <small class="wf-issue">{{ i.message }}</small> }
      </div>

      @for (p of visibleProperties(); track p.name) {
        <div class="wf-prop" [attr.data-testid]="'wf-prop-' + p.name">
          <label class="wf-prop__label"><code class="wf-prop__name">{{ p.name }}</code> @if (p.required) { <span class="ft-req">*</span> }</label>
          @switch (p.kind) {
            @case ('filters') {
              <app-studio-filter-builder [fields]="filterFields()" [filters]="filterModel()"
                (filtersChange)="onFilters($event)" [disabled]="disabled()" />
            }
            @case ('enum') {
              <p-select [options]="enumOptions(p)" [ngModel]="step()[p.name] ?? enumDefault(p)" (ngModelChange)="set(p.name, $event)"
                optionLabel="label" optionValue="value" [disabled]="disabled()" appendTo="body" panelStyleClass="studio-theme"
                styleClass="wf-w" [attr.aria-label]="p.name" />
            }
            @case ('string') {
              @if (p.name === 'gotoKey') {
                <p-select [options]="laterSteps()" [ngModel]="asText(step()['gotoKey']) || null" (ngModelChange)="set('gotoKey', $event)"
                  optionLabel="label" optionValue="value" [showClear]="true" [disabled]="disabled()" appendTo="body"
                  panelStyleClass="studio-theme" styleClass="wf-w" data-testid="wf-goto"
                  [placeholder]="L.steps.gotoTarget" [attr.aria-label]="L.steps.gotoTarget" />
              } @else if (p.name === 'action') {
                <app-studio-bridge-action-picker [actions]="actions()" [fields]="writableFields()"
                  [action]="asAction(step()['action'])" (actionChange)="set('action', $event)"
                  [mapping]="asMapping(step()['mapping'])" (mappingChange)="set('mapping', $event)"
                  [allowTemplate]="true" [disabled]="disabled()" />
              } @else if (p.name === 'saveResultAs') {
                <input pInputText [ngModel]="asText(step()['saveResultAs'])" (ngModelChange)="set('saveResultAs', $event)"
                  [pattern]="saveAsPattern" [disabled]="disabled()" [attr.aria-label]="p.name" autocomplete="off" />
              } @else {
                <input pInputText [ngModel]="asText(step()[p.name])" (ngModelChange)="set(p.name, $event)"
                  [maxlength]="p.max ?? null" [disabled]="disabled()" [attr.aria-label]="p.name" autocomplete="off" />
              }
            }
            @case ('template') {
              <textarea pTextarea rows="2" [ngModel]="asText(step()[p.name])" (ngModelChange)="setTemplate(p, $event)"
                [disabled]="disabled()" [attr.aria-label]="p.name"></textarea>
              <small class="studio-muted wf-vars">@for (v of templateVars; track v) { <code>{{ v }}</code> }</small>
            }
            @case ('int') {
              <p-inputNumber styleClass="wf-w" [ngModel]="asNumber(step()[p.name])" (ngModelChange)="setInt(p, $event)"
                [min]="p.min ?? 1" [max]="p.max ?? limits.maxDueHours" [useGrouping]="false"
                [disabled]="disabled()" [attr.aria-label]="p.name" />
            }
            @case ('fieldMap') {
              @for (row of setRows(p); track $index; let ri = $index) {
                <div class="wf-set" [attr.data-testid]="'wf-set-row-' + ri">
                  <p-select [options]="setFieldOptions()" [ngModel]="row.field" (ngModelChange)="patchSetRow(p, ri, $event, row.value)"
                    optionLabel="label" optionValue="value" [filter]="true" [disabled]="disabled()" appendTo="body"
                    panelStyleClass="studio-theme" [attr.aria-label]="p.name + ' · champ'" />
                  <textarea pTextarea rows="1" [ngModel]="row.value" (ngModelChange)="patchSetRow(p, ri, row.field, $event)"
                    [disabled]="disabled()" [attr.aria-label]="p.name + ' · valeur'"></textarea>
                  <button pButton type="button" icon="pi pi-times" class="p-button-text p-button-sm p-button-danger"
                    [disabled]="disabled()" (click)="removeSetRow(p, ri)" [attr.aria-label]="L.steps.remove"></button>
                </div>
              }
              <button pButton type="button" icon="pi pi-plus" class="p-button-sm p-button-outlined wf-set__add"
                [label]="L.steps.addPair" [disabled]="disabled() || setRows(p).length >= limits.maxSetPairs"
                (click)="addSetRow(p)"></button>
            }
            @case ('recipient') {
              <app-studio-assignee-picker [value]="asRecipient(step()[p.name])" (valueChange)="set(p.name, $event)"
                [allowStartedBy]="p.name === 'to'" [disabled]="disabled()" />
            }
            @case ('entity') {
              <p-select [options]="targetEntities()" [ngModel]="asText(step()['entity']) || null" (ngModelChange)="onEntityChange($event)"
                optionLabel="label" optionValue="value" [showClear]="true" [filter]="true" [disabled]="disabled()"
                appendTo="body" panelStyleClass="studio-theme" styleClass="wf-w" [attr.aria-label]="p.name" />
            }
            @case ('bool') {
              <p-toggleswitch [ngModel]="step()[p.name] === true" (ngModelChange)="set(p.name, $event)"
                [disabled]="disabled()" [attr.aria-label]="p.name" />
            }
            @case ('field') {
              <p-select [options]="writableFieldOptions()" [ngModel]="asText(step()[p.name]) || null" (ngModelChange)="set(p.name, $event)"
                optionLabel="label" optionValue="value" [showClear]="true" [filter]="true" [disabled]="disabled()"
                appendTo="body" panelStyleClass="studio-theme" styleClass="wf-w" [attr.aria-label]="p.name" />
            }
            @default {
              <textarea pTextarea rows="3" class="wf-json" [ngModel]="jsonText(p)" (ngModelChange)="setJson(p, $event)"
                [disabled]="disabled()" [attr.aria-label]="p.name"></textarea>
              <small class="studio-muted">{{ L.designer.unknownKind }}</small>
            }
          }
          @if (p.help) { <small class="studio-muted">{{ p.help }}</small> }
          @if (issueFor(p.name); as i) { <small class="wf-issue">{{ i.message }}</small> }
        </div>
      }
    </section>
  `,
  styles: [`
    .wf-editor { display: flex; flex-direction: column; }
    .wf-editor__head { display: flex; gap: .6rem; align-items: flex-start; margin-bottom: .75rem; }
    .wf-editor__icon { width: 1.75rem; height: 1.75rem; border-radius: .5rem; background: var(--indigo-50, #eef2ff); color: var(--indigo-600, #4f46e5); display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .wf-editor__title { margin: 0; font-size: .95rem; font-weight: 600; }
    .wf-editor__desc { margin: .15rem 0 0; }
    .wf-prop { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .75rem; }
    .wf-prop__label { font-weight: 600; font-size: .85rem; }
    .wf-prop__name { font-family: monospace; font-size: .78rem; font-weight: 500; }
    .wf-issue { color: var(--red-500); font-size: .75rem; }
    .wf-set { display: grid; grid-template-columns: 1fr 1fr auto; gap: .35rem; align-items: center; }
    .wf-set__add { align-self: flex-start; }
    .wf-vars { display: flex; flex-wrap: wrap; gap: .25rem; }
    .wf-vars code { font-size: .6875rem; background: var(--indigo-50, #eef2ff); color: var(--indigo-700, #3730a3); padding: 0 .25rem; border-radius: .25rem; }
    .wf-json { font-family: monospace; font-size: .8rem; }
    :host ::ng-deep .wf-w { width: 100%; }
  `]
})
export class StudioWorkflowStepEditorComponent {
  readonly step = model.required<WorkflowStepSpec>();
  readonly index = input.required<number>();                 // position dans steps (pour gotoKey et contexte)
  readonly steps = input.required<WorkflowStepSpec[]>();
  readonly catalog = input.required<StepCatalogEntryDto[]>();
  readonly fields = input.required<CustomField[]>();          // champs de la table courante, fieldType numérique (D-44-14)
  readonly entities = input<CustomEntity[]>([]);              // create_record.entity
  readonly actions = input<AutomationAction[]>([]);           // erp_action.action / mapping
  readonly issues = input<WorkflowValidationIssueDto[]>([]);  // erreurs + warnings de validateWorkflow
  readonly disabled = input(false);

  private readonly studio = inject(StudioService);

  protected readonly L = STUDIO_WORKFLOW_LABELS;
  protected readonly limits = WORKFLOW_LIMITS;
  protected readonly keyPattern = STEP_KEY_REGEX;
  protected readonly saveAsPattern = SAVE_AS_REGEX;
  protected readonly templateVars = TEMPLATE_VARIABLES;

  protected readonly entry = computed(() => this.catalog().find(e => e.type === this.step().type) ?? null);
  protected readonly icon = computed(() => STEP_TYPE_ICONS[this.step().type]);
  protected readonly title = computed(() => stepTypeLabel(this.step().type, this.entry()?.label));
  /** D-44-04 : `gotoKey` ne cible que des étapes postérieures (`ValidateGotoKey` l.720–740 : `target <= i` ⇒ erreur). */
  protected readonly laterSteps = computed(() => this.steps().slice(this.index() + 1).map(s => ({ label: `${s.key}${s.label ? ' — ' + s.label : ''}`, value: s.key })));
  protected readonly filterFields = computed(() => contextFieldOptions(this.fields(), this.steps(), this.index()));
  /** `update_field.set` : champs actifs non calculés (`ValidateSetMap` l.458–478). */
  protected readonly writableFields = computed(() => this.fields().filter(f => f.isActive && !COMPUTED.has(f.fieldType)));
  protected readonly writableFieldOptions = computed(() => this.writableFields().map(f => ({ label: `${f.label} (${f.key})`, value: f.key })));
  /** D-44-15 : tables actives non jonction ; valeur = **clé** de table (l.601–611). */
  protected readonly targetEntities = computed(() => this.entities().filter(e => e.isActive && e.kind !== 'Junction').map(e => ({ label: e.displayName, value: e.key })));
  /** `create_record.set` : champs de la table cible, chargés à la volée. */
  protected readonly targetFields = signal<CustomField[]>([]);
  protected readonly filterModel = computed(() => toRecordViewFilters((this.step()['filters'] as WorkflowFilterSpec[] | undefined) ?? []));

  /**
   * Propriétés affichées : `mapping` est édité par le picker Pont sur la ligne `action`
   * (ligne `mapping` du catalogue ignorée — D10) ; `gotoKey` n'est visible que si le
   * branchement correspondant vaut `goto` (`onFalse` condition / `onReject` approval).
   */
  protected readonly visibleProperties = computed(() => (this.entry()?.properties ?? []).filter(p => {
    if (p.name === 'mapping') return false;
    if (p.name === 'gotoKey') return this.step()['onFalse'] === 'goto' || this.step()['onReject'] === 'goto';
    return true;
  }));

  protected issueFor(name: string): WorkflowValidationIssueDto | undefined {
    const p = `steps[${this.index()}].${name}`;
    return this.issues().find(i => i.path === p || i.path.startsWith(p + '[') || i.path.startsWith(p + '.'));   // Path(i, prop) l.753
  }

  protected set(name: string, value: unknown): void {
    const next = { ...this.step() } as WorkflowStepSpec;
    if (value === undefined || value === null || value === '') delete next[name]; else next[name] = value;
    this.step.set(next);
  }

  protected onFilters(filters: RecordViewFilter[]): void { this.set('filters', toWorkflowFilters(filters)); }

  protected onEntityChange(key: string | null): void {
    this.set('entity', key);
    this.set('set', undefined);
    this.loadTargetFields(key);
  }

  /** Valeurs `enum` traduites via `L.enumValues[p.name]?.[v]`, repli = valeur brute. */
  protected enumOptions(p: StepCatalogPropertyDto): { label: string; value: string }[] {
    const dict = (STUDIO_WORKFLOW_LABELS.enumValues as Record<string, Record<string, string>>)[p.name];
    return (p.allowedValues ?? []).map(v => ({ label: dict?.[v] ?? v, value: v }));
  }

  protected enumDefault(p: StepCatalogPropertyDto): string | null { return ENUM_DEFAULTS[p.name] ?? null; }

  /** `hours` / `until` sont exclusifs : saisir l'un vide l'autre. */
  protected setInt(p: StepCatalogPropertyDto, value: number | null): void {
    this.set(p.name, value);
    if (p.name === 'hours' && value !== null) this.set('until', undefined);
  }

  /** D-44-05 : `until` est un gabarit de date (kind `template`), pas un `field`. */
  protected setTemplate(p: StepCatalogPropertyDto, value: string): void {
    this.set(p.name, value);
    if (p.name === 'until' && value) this.set('hours', undefined);
  }

  // ---- fieldMap (`set`) : objet `{ [fieldKey]: string }` (AllowedProperties.UpdateField l.64–74) ----

  protected setRows(p: StepCatalogPropertyDto): SetRow[] {
    const raw = this.step()[p.name];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.entries(raw as Record<string, unknown>).map(([field, v]) => ({ field, value: v == null ? '' : String(v) }));
  }

  /** `writableFields()` pour `update_field` ; `targetFields()` pour `create_record`. */
  protected setFieldOptions(): { label: string; value: string }[] {
    const fields = this.step().type === 'create_record' ? this.targetFields() : this.writableFields();
    return fields.filter(f => f.isActive).map(f => ({ label: `${f.label} (${f.key})`, value: f.key }));
  }

  protected addSetRow(p: StepCatalogPropertyDto): void {
    const rows = this.setRows(p);
    if (rows.length >= WORKFLOW_LIMITS.maxSetPairs) return;
    const first = this.setFieldOptions().find(o => !rows.some(r => r.field === o.value));
    this.writeSetRows(p, [...rows, { field: first?.value ?? '', value: '' }]);
  }

  protected removeSetRow(p: StepCatalogPropertyDto, index: number): void {
    this.writeSetRows(p, this.setRows(p).filter((_, i) => i !== index));
  }

  protected patchSetRow(p: StepCatalogPropertyDto, index: number, field: string | null, value: string | null): void {
    this.writeSetRows(p, this.setRows(p).map((r, i) => (i === index ? { field: field ?? '', value: value ?? '' } : r)));
  }

  /** Les lignes sans champ ne sont pas émises ; vide complet ⇒ propriété supprimée. */
  private writeSetRows(p: StepCatalogPropertyDto, rows: SetRow[]): void {
    const filled = rows.filter(r => r.field);
    if (!filled.length) { this.set(p.name, undefined); return; }
    const obj: Record<string, string> = {};
    for (const r of filled) obj[r.field] = r.value;
    this.set(p.name, obj);
  }

  // ---- @default : JSON brut (robustesse si le serveur ajoute un kind) ----

  protected jsonText(p: StepCatalogPropertyDto): string {
    const v = this.step()[p.name];
    return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  }

  protected setJson(p: StepCatalogPropertyDto, raw: string): void {
    const text = raw ?? '';
    if (!text.trim()) { this.set(p.name, undefined); return; }
    try { this.set(p.name, JSON.parse(text)); } catch { this.set(p.name, text); }   // saisie en cours conservée ; la validation serveur tranchera
  }

  // ---- Conversions typées pour le template (step() est `Record<string, unknown>`) ----

  protected asText(v: unknown): string { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  protected asNumber(v: unknown): number | null { return typeof v === 'number' ? v : null; }
  protected asAction(v: unknown): string | null { return typeof v === 'string' && v ? v : null; }
  protected asMapping(v: unknown): BridgeParamMapping[] { return Array.isArray(v) ? v as BridgeParamMapping[] : []; }
  protected asRecipient(v: unknown): WorkflowRecipient | null {
    return v && typeof v === 'object' && typeof (v as WorkflowRecipient).kind === 'string' ? v as WorkflowRecipient : null;
  }

  /** D-44-14 : `listFields` renvoie `fieldType` en chaîne PascalCase ⇒ normalisé via `parseFieldType`. */
  private loadTargetFields(key: string | null): void {
    const id = this.entities().find(e => e.key === key)?.id;
    if (!id) { this.targetFields.set([]); return; }
    this.studio.listFields(id, false).subscribe({
      next: r => this.targetFields.set((r.data ?? []).map(f => ({ ...f, fieldType: parseFieldType(f.fieldType) }))),
      error: () => this.targetFields.set([])
    });
  }
}
