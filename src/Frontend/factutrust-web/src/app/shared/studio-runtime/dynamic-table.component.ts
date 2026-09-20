import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { TooltipModule } from 'primeng/tooltip';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { CustomField, CustomFieldType } from './studio-runtime.models';
import { StudioCodeImageComponent } from './studio-code-image.component';
import { StudioFileService } from './studio-file.service';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

export interface DynamicRow {
  id: string;
  data: Record<string, unknown> | null;
}

@Component({
  selector: 'app-dynamic-table',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TableModule, ButtonModule, MultiSelectModule, TooltipModule,
    StudioCodeImageComponent, EmptyStateComponent
  ],
  template: `
    @if (columnPicker && allFields.length > columns.length) {
      <div class="dt-picker">
        <label>Colonnes visibles</label>
        <p-multiSelect
          [options]="allFields"
          [(ngModel)]="visibleKeys"
          (ngModelChange)="onColumnsChange()"
          optionLabel="label"
          optionValue="key"
          [maxSelectedLabels]="3"
          appendTo="body"
          styleClass="dt-ms"
          placeholder="Colonnes…" />
      </div>
    }

      <div class="ft-table-card">
        <p-table
          [value]="value"
          [loading]="loading"
          [lazy]="true"
          (onLazyLoad)="lazyLoad.emit($event)"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="total"
          styleClass="p-datatable-sm"
          [rowsPerPageOptions]="[10, 25, 50]">
          <ng-template pTemplate="header">
            <tr>
              @for (f of visibleColumns; track f.key) {
                <th>{{ f.label }}</th>
              }
              @if (showActions || showView) {
                <th class="dt-actions-col">Actions</th>
              }
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              @for (f of visibleColumns; track f.key) {
                <td>
                  @switch (cellKind(f)) {
                    @case ('code') {
                      <app-studio-code-image [fieldType]="f.fieldType" [config]="f.config" [value]="row.data?.[f.key]" />
                    }
                    @case ('file') {
                      @if (fileValue(row, f); as v) {
                        <a role="button" tabindex="0" class="dt-file-cell"
                          (click)="openFile(v)" (keyup.enter)="openFile(v)">
                          @if (isImageValue(row, f)) {
                            <img [attr.src]="fileSrc(v) | async" class="dt-file-thumb" alt="" />
                          } @else {
                            <i class="fa-solid fa-paperclip"></i> Fichier
                          }
                        </a>
                      } @else {
                        —
                      }
                    }
                    @default {
                      <span>{{ display(row, f) }}</span>
                    }
                  }
                </td>
              }
              @if (showActions || showView) {
                <td class="dt-actions">
                  <!-- 4.7 suite (D-47-94) : œil « Voir » pour un lecteur pur (showView sans showActions). -->
                  @if (showView) {
                    <button pButton type="button" icon="fa-solid fa-eye" class="p-button-text p-button-sm"
                      pTooltip="Voir" (click)="viewRow.emit(row)"></button>
                  }
                  @if (showActions) {
                    <button pButton type="button" icon="fa-solid fa-pen" class="p-button-text p-button-sm"
                      pTooltip="Modifier" (click)="editRow.emit(row)"></button>
                    <button pButton type="button" icon="fa-solid fa-trash" class="p-button-text p-button-sm p-button-danger"
                      pTooltip="Supprimer" (click)="deleteRow.emit(row)"></button>
                  }
                </td>
              }
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td [attr.colspan]="visibleColumns.length + (showActions || showView ? 1 : 0)">
                <app-empty-state icon="pi-table" title="Aucun enregistrement" description="Aucune donnée ne correspond à votre recherche." />
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
  `,
  styles: [`
    .dt-picker { display: flex; align-items: center; gap: var(--spacing-3); margin-bottom: var(--spacing-3); }
    .dt-picker label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-neutral-600); }
    .dt-actions { text-align: right; white-space: nowrap; display: flex; gap: var(--spacing-1); justify-content: flex-end; }
    .dt-actions-col { width: 8rem; text-align: right; }
    .dt-file-cell { display: inline-flex; align-items: center; gap: .35rem; color: var(--color-primary-600); cursor: pointer; }
    .dt-file-thumb { max-height: 36px; border-radius: var(--radius-sm); border: 1px solid var(--color-border-subtle); }
    :host ::ng-deep .dt-ms { min-width: 14rem; }
  `]
})
export class DynamicTableComponent implements OnChanges {
  private readonly studioFiles = inject(StudioFileService);

  @Input() columns: CustomField[] = [];
  @Input() allFields: CustomField[] = [];
  @Input() entityKey = '';
  @Input() columnPicker = true;
  @Input() value: DynamicRow[] = [];
  @Input() total = 0;
  @Input() pageSize = 25;
  @Input() loading = false;
  @Input() showActions = true;
  /** 4.7 suite (D-47-94) : affiche l'œil « Voir » (fiche en lecture seule) même sans showActions. */
  @Input() showView = false;

  @Output() lazyLoad = new EventEmitter<TableLazyLoadEvent>();
  @Output() editRow = new EventEmitter<DynamicRow>();
  @Output() deleteRow = new EventEmitter<DynamicRow>();
  @Output() viewRow = new EventEmitter<DynamicRow>();
  @Output() visibleColumnsChange = new EventEmitter<CustomField[]>();

  visibleColumns: CustomField[] = [];
  visibleKeys: string[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['columns'] || changes['allFields'] || changes['entityKey']) {
      this.initVisibleColumns();
    }
  }

  // Sans sélecteur de colonnes, l'ordre/masquage fournis via `columns` (ex. vue enregistrée)
  // priment sur `allFields` et aucune préférence localStorage n'est appliquée (partagée avec la
  // vue « Liste » brute).
  private initVisibleColumns(): void {
    if (!this.columnPicker && this.columns.length) {
      this.visibleKeys = this.columns.map(f => f.key);
      this.visibleColumns = [...this.columns];
      return;
    }
    const fields = this.allFields.length ? this.allFields : this.columns;
    const stored = this.entityKey ? localStorage.getItem(this.storageKey()) : null;
    if (stored) {
      try {
        const keys = JSON.parse(stored) as string[];
        this.visibleKeys = keys.filter(k => fields.some(f => f.key === k));
      } catch { /* ignore */ }
    }
    if (!this.visibleKeys.length) {
      this.visibleKeys = fields.map(f => f.key);
    }
    this.visibleColumns = fields.filter(f => this.visibleKeys.includes(f.key));
    if (!this.visibleColumns.length) {
      this.visibleColumns = [...fields];
      this.visibleKeys = fields.map(f => f.key);
    }
  }

  onColumnsChange(): void {
    const fields = this.allFields.length ? this.allFields : this.columns;
    this.visibleColumns = fields.filter(f => this.visibleKeys.includes(f.key));
    if (this.entityKey) {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.visibleKeys));
    }
    this.visibleColumnsChange.emit(this.visibleColumns);
  }

  private storageKey(): string {
    return `studio:cols:${this.entityKey}`;
  }

  isCode(field: CustomField): boolean {
    return field.fieldType === CustomFieldType.QrCode || field.fieldType === CustomFieldType.Barcode;
  }

  isFile(field: CustomField): boolean {
    return field.fieldType === CustomFieldType.Attachment || field.fieldType === CustomFieldType.Signature;
  }

  cellKind(field: CustomField): 'code' | 'file' | 'text' {
    if (this.isCode(field)) return 'code';
    if (this.isFile(field)) return 'file';
    return 'text';
  }

  fileValue(row: DynamicRow, field: CustomField): string | null {
    const v = row.data?.[field.key];
    return typeof v === 'string' && v ? v : null;
  }

  /** Blob object URL via le service (cache : instance stable par valeur, sûre pour le template). */
  fileSrc(value: string): Observable<string | null> {
    return this.studioFiles.objectUrl(value);
  }

  openFile(value: string): void {
    this.studioFiles.open(value);
  }

  isImageValue(row: DynamicRow, field: CustomField): boolean {
    const v = row.data?.[field.key];
    return typeof v === 'string' && /\.(png|jpe?g|webp|gif)$/i.test(v);
  }

  display(row: DynamicRow, field: CustomField): string {
    const value = row.data?.[field.key];
    if (value === null || value === undefined || value === '') return '—';
    switch (field.fieldType) {
      case CustomFieldType.Boolean: return value ? 'Oui' : 'Non';
      case CustomFieldType.MultiSelect: return Array.isArray(value) ? value.join(', ') : String(value);
      case CustomFieldType.Date:
        return this.formatDate(value, false);
      case CustomFieldType.DateTime:
        return this.formatDate(value, true);
      case CustomFieldType.Money: return this.formatMoney(Number(value), field);
      case CustomFieldType.Percentage: return `${this.formatNumber(Number(value))} %`;
      case CustomFieldType.Rating: return `${Number(value)} / ${this.ratingStars(field)}`;
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

  private ratingStars(field: CustomField): number {
    const n = Number(field.config?.['rating']?.['max']);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  private formatMoney(value: number, field: CustomField): string {
    if (!Number.isFinite(value)) return '—';
    const currency = field.config?.['money']?.['currency'];
    const code = typeof currency === 'string' && currency.trim() ? currency.trim() : 'TND';
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code }).format(value);
    } catch {
      return `${this.formatNumber(value)} ${code}`;
    }
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
  }
}
