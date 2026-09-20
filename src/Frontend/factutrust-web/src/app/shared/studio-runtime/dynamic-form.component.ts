import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { RatingModule } from 'primeng/rating';
import { CustomField, CustomFieldType, FormLayout } from './studio-runtime.models';
import { StudioCodeImageComponent } from './studio-code-image.component';
import { StudioFileFieldComponent } from './studio-file-field.component';

interface RenderCell {
  field: CustomField;
  label: string;
  width: 'full' | 'half';
}
interface RenderSection {
  title: string | null;
  cells: RenderCell[];
}

/**
 * Metadata-driven form. Builds a reactive form from custom field definitions, renders the right
 * PrimeNG control per type, honors an optional saved layout (sections / order / label overrides /
 * width), and emits a plain data dictionary ready for the records API.
 */
@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    ButtonModule, InputTextModule, Textarea, InputNumberModule,
    InputSwitchModule, DatePickerModule, SelectModule, MultiSelectModule, RatingModule,
    StudioCodeImageComponent, StudioFileFieldComponent
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="ft-dyn-form">
      <div class="ft-section" *ngFor="let s of sections">
        <h3 class="ft-section-title" *ngIf="s.title">{{ s.title }}</h3>
        <div class="ft-grid">
          <div class="ft-cell" [class.ft-half]="cell.width === 'half'" *ngFor="let cell of s.cells">
            <label>{{ cell.label }} <span *ngIf="cell.field.isRequired" class="ft-req">*</span></label>

            <ng-container [ngSwitch]="cell.field.fieldType">
              <input *ngSwitchCase="FT.Text" pInputText [formControlName]="cell.field.key" />
              <textarea *ngSwitchCase="FT.MultilineText" pTextarea [formControlName]="cell.field.key" rows="3"></textarea>
              <p-inputNumber *ngSwitchCase="FT.Number" [formControlName]="cell.field.key" [useGrouping]="false"></p-inputNumber>
              <p-inputNumber *ngSwitchCase="FT.Decimal" [formControlName]="cell.field.key" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="6"></p-inputNumber>
              <p-inputNumber *ngSwitchCase="FT.Money" [formControlName]="cell.field.key" mode="currency" [currency]="moneyCurrency(cell.field)" [minFractionDigits]="0" [maxFractionDigits]="3"></p-inputNumber>
              <p-inputNumber *ngSwitchCase="FT.Percentage" [formControlName]="cell.field.key" mode="decimal" suffix=" %" [minFractionDigits]="0" [maxFractionDigits]="2"></p-inputNumber>
              <p-rating *ngSwitchCase="FT.Rating" [formControlName]="cell.field.key" [stars]="ratingStars(cell.field)"></p-rating>
              <ng-container *ngSwitchCase="FT.QrCode">
                <input pInputText [formControlName]="cell.field.key" placeholder="Valeur à encoder" />
                <app-studio-code-image class="ft-code-preview" [fieldType]="FT.QrCode" [value]="form.get(cell.field.key)?.value"></app-studio-code-image>
              </ng-container>
              <ng-container *ngSwitchCase="FT.Barcode">
                <input pInputText [formControlName]="cell.field.key" placeholder="Valeur à encoder" />
                <app-studio-code-image class="ft-code-preview" [fieldType]="FT.Barcode" [config]="cell.field.config" [value]="form.get(cell.field.key)?.value"></app-studio-code-image>
              </ng-container>
              <input *ngSwitchCase="FT.AutoNumber" pInputText [formControlName]="cell.field.key" placeholder="Généré automatiquement" />
              <input *ngSwitchCase="FT.Formula" pInputText [formControlName]="cell.field.key" placeholder="Calculé automatiquement" />
              <input *ngSwitchCase="FT.Lookup" pInputText [formControlName]="cell.field.key" placeholder="Champ lié" />
              <input *ngSwitchCase="FT.Rollup" pInputText [formControlName]="cell.field.key" placeholder="Agrégat" />
              <app-studio-file-field *ngSwitchCase="FT.Attachment" mode="attachment" [entityKey]="entityKey"
                [value]="form.get(cell.field.key)?.value" (valueChange)="setFileValue(cell.field.key, $event)"></app-studio-file-field>
              <app-studio-file-field *ngSwitchCase="FT.Signature" mode="signature" [entityKey]="entityKey"
                [value]="form.get(cell.field.key)?.value" (valueChange)="setFileValue(cell.field.key, $event)"></app-studio-file-field>
              <p-inputSwitch *ngSwitchCase="FT.Boolean" [formControlName]="cell.field.key"></p-inputSwitch>
              <p-datepicker *ngSwitchCase="FT.Date" [formControlName]="cell.field.key" dateFormat="yy-mm-dd" appendTo="body"></p-datepicker>
              <p-datepicker *ngSwitchCase="FT.DateTime" [formControlName]="cell.field.key" [showTime]="true" dateFormat="yy-mm-dd" appendTo="body"></p-datepicker>
              <p-select *ngSwitchCase="FT.Select" [formControlName]="cell.field.key" [options]="cell.field.options || []"
                optionLabel="label" optionValue="value" [showClear]="true" appendTo="body" styleClass="ft-w-full"></p-select>
              <p-multiSelect *ngSwitchCase="FT.MultiSelect" [formControlName]="cell.field.key" [options]="cell.field.options || []"
                optionLabel="label" optionValue="value" appendTo="body" styleClass="ft-w-full"></p-multiSelect>
              <p-select *ngSwitchCase="FT.RelationCustom" [formControlName]="cell.field.key" [options]="cell.field.options || []"
                optionLabel="label" optionValue="value" [showClear]="true" [filter]="true" appendTo="body" styleClass="ft-w-full"></p-select>
              <p-select *ngSwitchCase="FT.RelationExisting" [formControlName]="cell.field.key" [options]="cell.field.options || []"
                optionLabel="label" optionValue="value" [showClear]="true" [filter]="true" appendTo="body" styleClass="ft-w-full"></p-select>
              <input *ngSwitchDefault pInputText [formControlName]="cell.field.key" />
            </ng-container>

            <small class="ft-error" *ngIf="invalid(cell.field.key)">Valeur invalide pour « {{ cell.label }} ».</small>
          </div>
        </div>
      </div>

      <p *ngIf="sections.length === 0" class="ft-empty">Aucun champ à afficher.</p>

      <!-- 4.7 suite (D-47-94) : en lecture seule, les actions d'écriture disparaissent. -->
      <div class="ft-form-actions" *ngIf="sections.length > 0 && !readOnly">
        <button pButton type="button" label="Annuler" class="p-button-text" (click)="formCancel.emit()"></button>
        <button pButton type="submit" label="Enregistrer" icon="fa-solid fa-check" [disabled]="saving"></button>
      </div>
    </form>
  `,
  styles: [`
    .ft-dyn-form { display: flex; flex-direction: column; gap: 1.25rem; }
    .ft-section-title { font-size: 1rem; margin: 0 0 .5rem; color: var(--text-color); border-bottom: 1px solid var(--surface-200); padding-bottom: .35rem; }
    .ft-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .ft-cell { grid-column: span 2; display: flex; flex-direction: column; gap: .35rem; }
    .ft-cell.ft-half { grid-column: span 1; }
    .ft-cell label { font-weight: 600; font-size: .9rem; }
    .ft-req { color: var(--red-500); }
    .ft-error { color: var(--red-500); }
    .ft-empty { color: var(--text-color-secondary); }
    .ft-form-actions { display: flex; justify-content: flex-end; gap: .5rem; }
    @media (max-width: 640px) { .ft-cell.ft-half { grid-column: span 2; } }
    :host ::ng-deep .ft-w-full { width: 100%; }
    :host ::ng-deep .p-inputnumber, :host ::ng-deep .p-datepicker { width: 100%; }
    .ft-code-preview { margin-top: .5rem; }
  `]
})
export class DynamicFormComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);

  @Input() fields: CustomField[] = [];
  @Input() layout: FormLayout | null = null;
  @Input() model: Record<string, unknown> | null = null;
  @Input() saving = false;
  /** Entity key used to scope file uploads (Attachment / Signature fields). */
  @Input() entityKey = '';
  /** 4.7 suite (D-47-94) : fiche en lecture seule — tous les champs désactivés, pas de validateurs,
   *  pas de barre d'actions. Le modèle reste patché (affichage des valeurs). */
  @Input() readOnly = false;

  @Output() save = new EventEmitter<Record<string, unknown>>();
  @Output() formCancel = new EventEmitter<void>();

  readonly FT = CustomFieldType;
  form: FormGroup = this.fb.group({});
  sections: RenderSection[] = [];
  private rendered: CustomField[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['fields'] || changes['layout'] || changes['readOnly']) {
      this.buildSections();
      this.buildForm();
    }
    if (changes['model'] && this.model) {
      this.patchModel();
    }
  }

  private buildSections(): void {
    const byKey = new Map(this.fields.map(f => [f.key, f]));
    const result: RenderSection[] = [];

    if (this.layout && this.layout.sections?.length) {
      for (const s of this.layout.sections) {
        const cells: RenderCell[] = [];
        for (const ref of s.fields) {
          const field = byKey.get(ref.key);
          if (!field) continue;
          cells.push({ field, label: ref.labelOverride?.trim() || field.label, width: ref.width === 'half' ? 'half' : 'full' });
        }
        if (cells.length) result.push({ title: s.title?.trim() || null, cells });
      }
    }

    if (result.length === 0) {
      // Fallback: one section, all active fields in sort order, full width.
      const cells = [...this.fields]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map<RenderCell>(field => ({ field, label: field.label, width: 'full' }));
      if (cells.length) result.push({ title: null, cells });
    }

    this.sections = result;
    this.rendered = result.flatMap(s => s.cells.map(c => c.field));
  }

  private buildForm(): void {
    const group: Record<string, unknown[]> = {};
    for (const f of this.rendered) {
      // Computed fields (AutoNumber / Formula / Lookup / Rollup) are filled server-side:
      // render disabled (read-only), no validators.
      if (f.fieldType === CustomFieldType.AutoNumber || f.fieldType === CustomFieldType.Formula
          || f.fieldType === CustomFieldType.Lookup || f.fieldType === CustomFieldType.Rollup) {
        group[f.key] = [{ value: null, disabled: true }, []];
        continue;
      }
      // D-47-94 : en lecture seule, aucun validateur et le champ est désactivé (les champs calculés
      // le sont déjà ci-dessus) — la fiche affiche les valeurs sans proposer la saisie.
      const validators = [];
      if (!this.readOnly) {
        if (f.isRequired) validators.push(Validators.required);
        if (f.rules?.minLength != null) validators.push(Validators.minLength(f.rules.minLength));
        if (f.rules?.maxLength != null) validators.push(Validators.maxLength(f.rules.maxLength));
        if (f.rules?.min != null) validators.push(Validators.min(f.rules.min));
        if (f.rules?.max != null) validators.push(Validators.max(f.rules.max));
      }
      group[f.key] = [{ value: f.fieldType === CustomFieldType.Boolean ? false : null, disabled: this.readOnly }, validators];
    }
    this.form = this.fb.group(group);
    if (this.model) this.patchModel();
  }

  private patchModel(): void {
    const patch: Record<string, unknown> = {};
    for (const f of this.rendered) {
      patch[f.key] = this.fromStored(f, this.model?.[f.key]);
    }
    this.form.patchValue(patch);
  }

  moneyCurrency(field: CustomField): string {
    const c = field.config?.['money']?.['currency'];
    return typeof c === 'string' && c.trim() ? c.trim() : 'TND';
  }

  ratingStars(field: CustomField): number {
    const n = Number(field.config?.['rating']?.['max']);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  setFileValue(key: string, url: string | null): void {
    const c = this.form.get(key);
    if (!c) return;
    c.setValue(url);
    c.markAsDirty();
    c.markAsTouched();
  }

  invalid(key: string): boolean {
    const c = this.form.get(key);
    return !!c && c.invalid && c.touched;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const data: Record<string, unknown> = {};
    for (const f of this.rendered) {
      const stored = this.toStored(f, this.form.get(f.key)?.value);
      if (stored !== null) data[f.key] = stored;
    }
    this.save.emit(data);
  }

  private fromStored(field: CustomField, raw: unknown): unknown {
    if (raw === null || raw === undefined) return field.fieldType === CustomFieldType.Boolean ? false : null;
    if (field.fieldType === CustomFieldType.Date || field.fieldType === CustomFieldType.DateTime) {
      const d = new Date(String(raw));
      return isNaN(d.getTime()) ? null : d;
    }
    return raw;
  }

  private toStored(field: CustomField, value: unknown): unknown {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
      return field.fieldType === CustomFieldType.Date ? this.toLocalDate(value) : value.toISOString();
    }
    return value;
  }

  private toLocalDate(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
}
