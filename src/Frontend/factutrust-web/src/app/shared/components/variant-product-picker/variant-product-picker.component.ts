import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { TabViewModule } from 'primeng/tabview';
import { TagModule } from 'primeng/tag';
import {
  ProductSelectItem,
  ProductService,
  ProductVariantChildDto
} from '@core/services/product.service';
import {
  ProductAutocompleteService,
  ProductSuggestion
} from '@shared/services/product-autocomplete.service';

export type VariantPickerSelection = ProductSuggestion;

@Component({
  selector: 'app-variant-product-picker',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    AutoCompleteModule,
    TabViewModule,
    TagModule
  ],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: 'min(720px, 96vw)' }"
      header="Choisir une variante" i18n-header="@@shared.components.variant-product-picker.variant-product-picker.choisir.une.variante.c8ab137c"
      (onHide)="onDialogHide()">
      <p-tabView>
        <p-tabPanel header="Recherche SKU" i18n-header="@@shared.components.variant-product-picker.variant-product-picker.recherche.sku.ecc8587e">
          <p-autoComplete
            [(ngModel)]="directQuery"
            [suggestions]="directSuggestions()"
            (completeMethod)="searchDirect($event)"
            (onSelect)="selectDirect($event.value)"
            field="label"
            placeholder="Code ou nom du SKU…" i18n-placeholder="@@shared.components.variant-product-picker.variant-product-picker.code.ou.nom.du.sku.f9636dc9"
            styleClass="w-full"
            [minLength]="1">
            <ng-template let-item pTemplate="item">
              <div class="suggestion-row">
                <strong>{{ item.code }}</strong>
                <span>{{ item.name }}</span>
                @if (item.attributeSummary) {
                  <p-tag [value]="item.attributeSummary" severity="info" />
                }
              </div>
            </ng-template>
          </p-autoComplete>
        </p-tabPanel>
        <p-tabPanel header="Par modèle" i18n-header="@@shared.components.variant-product-picker.variant-product-picker.par.modele.ad61be8b">
          <div class="grouped-step">
            <label i18n="@@shared.components.variant-product-picker.variant-product-picker.modele.9853170f">Modèle</label>
            <p-autoComplete
              [(ngModel)]="templateQuery"
              [suggestions]="templateSuggestions()"
              (completeMethod)="searchTemplates($event)"
              (onSelect)="onTemplateSelected($event.value)"
              field="name"
              placeholder="Rechercher un modèle…" i18n-placeholder="@@shared.components.variant-product-picker.variant-product-picker.rechercher.un.modele.57af3d5f"
              styleClass="w-full"
              [minLength]="1" />
          </div>
          @if (selectedTemplate()) {
            <div class="grouped-step">
              <label i18n="@@shared.components.variant-product-picker.variant-product-picker.variantes.5bda7413">Variantes ({{ childVariants().length }})</label>
              @if (loadingChildren()) {
                <p class="form-hint" i18n="@@shared.components.variant-product-picker.variant-product-picker.chargement.73a97d98"><i class="pi pi-spin pi-spinner"></i> Chargement…</p>
              } @else {
                <div class="variant-pills">
                  @for (child of childVariants(); track child.id) {
                    <button type="button" class="variant-pill" (click)="selectChild(child)">
                      <span class="pill-code">{{ child.code }}</span>
                      <span class="pill-attrs">{{ formatAttributes(child) }}</span>
                      <span class="pill-price">{{ child.unitPrice | number:'1.3-3' }} HT</span>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </p-tabPanel>
      </p-tabView>
    </p-dialog>
  `,
  styles: [`
    .grouped-step { margin-bottom: 1rem; }
    .grouped-step label { display: block; font-weight: 600; margin-bottom: 0.35rem; }
    .suggestion-row { display: flex; flex-direction: column; gap: 0.15rem; }
    .variant-pills { display: flex; flex-direction: column; gap: 0.5rem; max-height: 280px; overflow-y: auto; }
    .variant-pill {
      display: grid;
      grid-template-columns: 1fr 1.5fr auto;
      gap: 0.5rem;
      align-items: center;
      text-align: left;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      background: var(--surface-card);
      cursor: pointer;
    }
    .variant-pill:hover { border-color: var(--primary-color); }
    .pill-code { font-family: monospace; font-weight: 600; }
    .pill-attrs { color: var(--text-color-secondary); font-size: 0.9rem; }
    .pill-price { font-size: 0.85rem; }
  `]
})
export class VariantProductPickerComponent {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() selected = new EventEmitter<VariantPickerSelection>();

  private readonly productService = inject(ProductService);
  private readonly productAutocomplete = inject(ProductAutocompleteService);

  directQuery = '';
  templateQuery: ProductSelectItem | string = '';
  directSuggestions = signal<Array<ProductSuggestion & { label: string; attributeSummary?: string | null }>>([]);
  templateSuggestions = signal<ProductSelectItem[]>([]);
  selectedTemplate = signal<ProductSelectItem | null>(null);
  childVariants = signal<ProductVariantChildDto[]>([]);
  loadingChildren = signal(false);

  searchDirect(event: { query: string }): void {
    const q = event.query?.trim() ?? '';
    if (!q) {
      this.directSuggestions.set([]);
      return;
    }
    this.productAutocomplete.search(q).subscribe(items => {
      this.directSuggestions.set(
        items.map(i => ({
          ...i,
          label: `${i.code} — ${i.name}`,
          attributeSummary: (i as ProductSuggestion & { attributeSummary?: string }).attributeSummary ?? null
        }))
      );
    });
  }

  selectDirect(item: ProductSuggestion & { label?: string }): void {
    this.emitSelection(item);
  }

  searchTemplates(event: { query: string }): void {
    this.productService.searchTemplatesForSelect(event.query).subscribe(res => {
      if (res.success && res.data) {
        this.templateSuggestions.set(res.data);
      }
    });
  }

  onTemplateSelected(item: ProductSelectItem): void {
    this.selectedTemplate.set(item);
    this.loadingChildren.set(true);
    this.productService.getProductVariants(item.id, 1, 200).subscribe({
      next: res => {
        this.loadingChildren.set(false);
        if (res.success && res.data) {
          this.childVariants.set(res.data.items);
        }
      },
      error: () => this.loadingChildren.set(false)
    });
  }

  formatAttributes(child: ProductVariantChildDto): string {
    return child.attributes.map(a => a.valueName).join(' / ');
  }

  selectChild(child: ProductVariantChildDto): void {
    this.emitSelection({
      id: child.id,
      code: child.code,
      name: child.name,
      unitPrice: child.unitPrice,
      vatRate: 19,
      unit: 'Unité',
      isFodecApplicable: false,
      isDiscountEnabled: false,
      maxDiscountPercent: null
    });
  }

  private emitSelection(item: ProductSuggestion): void {
    this.selected.emit(item);
    this.visible = false;
    this.visibleChange.emit(false);
    this.reset();
  }

  onDialogHide(): void {
    this.visibleChange.emit(this.visible);
    if (!this.visible) this.reset();
  }

  private reset(): void {
    this.directQuery = '';
    this.templateQuery = '';
    this.selectedTemplate.set(null);
    this.childVariants.set([]);
  }
}
