import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  computed,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { InputSwitchModule } from 'primeng/inputswitch';
import { OverlayOptions } from 'primeng/api';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ProductService, CreateProductRequest, Product, ProductListItem } from '@core/services/product.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { DrawerOverlayService } from '@core/services/drawer-overlay.service';
import { AuthService } from '@core/services/auth.service';
import { AppModule } from '@core/models/app-module';
import { PERMISSIONS } from '@core/config/permission-keys';
import { HttpErrorResponse } from '@angular/common/http';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import {
  calculateFodecAmount,
  calculateSaleTtc,
  calculateVatAmount
} from '@shared/utils/product-pricing.utils';

interface TypeOption {
  label: string;
  value: string;
}

interface UnitOption {
  label: string;
  value: string;
}

interface VatOption {
  label: string;
  value: number;
}

const TYPE_OPTIONS: TypeOption[] = [
  { label: 'Produit', value: 'Produit' },
  { label: 'Service', value: 'Service' },
];

const UNIT_OPTIONS: UnitOption[] = [
  { label: 'Unité', value: 'Unité' },
  { label: 'Heure', value: 'Heure' },
  { label: 'Jour', value: 'Jour' },
  { label: 'Mois', value: 'Mois' },
  { label: 'An', value: 'An' },
  { label: 'Kg', value: 'Kg' },
  { label: 'Litre', value: 'Litre' },
  { label: 'Mètre', value: 'Mètre' },
  { label: 'M²', value: 'M²' },
];

const VAT_OPTIONS: VatOption[] = [
  { label: '19% - Taux normal', value: 19 },
  { label: '13% - Taux intermédiaire', value: 13 },
  { label: '7% - Taux réduit', value: 7 },
  { label: '0% - Exonéré', value: 0 },
];

/**
 * Dialog to create a product with minimal fields (code, name, type, unit price, VAT, unit, stock).
 * Used when adding a line in quote, delivery note or invoice and the product does not exist yet.
 * On success emits the created product as ProductListItem and closes.
 */
@Component({
  selector: 'app-quick-create-product-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    Textarea,
    CheckboxModule,
    InputSwitchModule,
    ButtonComponent,
  ],
  template: `
    <ng-template #formContent>
      <div class="quick-create-product-content">
        <div class="form-fields">
          <div class="form-block">
            <h4 class="form-block-title">Identité</h4>
            <div class="form-group">
              <label for="quick-code">Code produit <span class="required">*</span></label>
              <input
                pInputText
                id="quick-code"
                [ngModel]="code()"
                (ngModelChange)="code.set($event)"
                (blur)="codeTouched.set(true)"
                placeholder="Ex: PROD-001"
                class="w-full"
                [class.ng-invalid]="showCodeError()"
                [attr.aria-invalid]="showCodeError()"
                [attr.aria-describedby]="showCodeError() ? 'quick-code-error' : null" />
              <small class="form-hint">Min. 2 caractères</small>
              @if (showCodeError()) {
                <div class="field-error" id="quick-code-error" role="alert">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ codeErrorMessage() }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="quick-name">Nom <span class="required">*</span></label>
              <input
                pInputText
                id="quick-name"
                [ngModel]="name()"
                (ngModelChange)="name.set($event)"
                (blur)="nameTouched.set(true)"
                placeholder="Nom du produit ou service"
                class="w-full"
                [class.ng-invalid]="showNameError()"
                [attr.aria-invalid]="showNameError()"
                [attr.aria-describedby]="showNameError() ? 'quick-name-error' : null" />
              <small class="form-hint">Min. 2 caractères</small>
              @if (showNameError()) {
                <div class="field-error" id="quick-name-error" role="alert">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ nameErrorMessage() }}</span>
                </div>
              }
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="quick-type">Type <span class="required">*</span></label>
                <p-select
                  id="quick-type"
                  [options]="typeOptions"
                  [ngModel]="category()"
                  (ngModelChange)="onCategoryChange($event)"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Type"
                  [appendTo]="panelMode ? 'body' : null"
                  [overlayOptions]="panelMode ? drawerOverlayOptions : undefined"
                  styleClass="w-full" />
              </div>
              <div class="form-group">
                <label for="quick-unit">Unité <span class="required">*</span></label>
                <p-select
                  id="quick-unit"
                  [options]="unitOptions"
                  [ngModel]="unit()"
                  (ngModelChange)="unit.set($event)"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Unité"
                  [appendTo]="panelMode ? 'body' : null"
                  [overlayOptions]="panelMode ? drawerOverlayOptions : undefined"
                  styleClass="w-full" />
              </div>
            </div>

            @if (showStockManagement()) {
              <div class="form-group">
                <label for="quick-stock">Gestion de stock</label>
                <div class="status-switch">
                  <p-inputSwitch
                    id="quick-stock"
                    [ngModel]="isStockManaged()"
                    (ngModelChange)="isStockManaged.set(!!$event)"
                    [disabled]="!isProductCategory()"
                    [attr.aria-describedby]="stockDescribedBy()">
                  </p-inputSwitch>
                  <span [class.active]="resolveIsStockManaged()">
                    {{ resolveIsStockManaged() ? 'Activée' : 'Désactivée' }}
                  </span>
                </div>
                @if (!isProductCategory()) {
                  <small class="form-hint" id="quick-stock-type-hint">Disponible uniquement pour les produits physiques.</small>
                }
                @if (resolveIsStockManaged()) {
                  <small class="form-hint" id="quick-stock-zero-hint">Le stock initial reste à zéro jusqu'à une entrée de stock.</small>
                }
                @if (showSupplierStockHint()) {
                  <small class="form-hint" id="quick-stock-supplier-hint">Cet article ne sera pas ajouté à la facture fournisseur directe. Décochez Gestion de stock pour l'ajouter à la ligne.</small>
                }
              </div>
            }
          </div>

          <div class="form-block">
            <h4 class="form-block-title">Tarification</h4>
            <div class="form-row">
              <div class="form-group">
                <label for="quick-price">Prix unitaire HT (TND) <span class="required">*</span></label>
                <p-inputNumber
                  id="quick-price"
                  [ngModel]="unitPrice()"
                  (ngModelChange)="unitPrice.set($event)"
                  [min]="0"
                  [minFractionDigits]="2"
                  [maxFractionDigits]="3"
                  mode="decimal"
                  placeholder="0.000"
                  styleClass="w-full" />
              </div>
              <div class="form-group">
                <label for="quick-vat">TVA <span class="required">*</span></label>
                <p-select
                  id="quick-vat"
                  [options]="vatOptions"
                  [ngModel]="vatRate()"
                  (ngModelChange)="vatRate.set($event)"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="TVA"
                  [appendTo]="panelMode ? 'body' : null"
                  [overlayOptions]="panelMode ? drawerOverlayOptions : undefined"
                  styleClass="w-full" />
              </div>
            </div>
            <div class="form-group fodec-row">
              <p-checkbox
                inputId="quick-fodec"
                [ngModel]="isFodecApplicable()"
                (ngModelChange)="isFodecApplicable.set($event)"
                [binary]="true">
              </p-checkbox>
              <label for="quick-fodec">FODEC applicable (1%)</label>
            </div>
            <div class="price-preview">
              <div class="price-preview-row">
                <span>Prix HT</span>
                <span class="value">{{ unitPrice() | number:'1.3-3' }} TND</span>
              </div>
              @if (isFodecApplicable()) {
                <div class="price-preview-row">
                  <span>FODEC (1%)</span>
                  <span class="value">{{ calculateFodec() | number:'1.3-3' }} TND</span>
                </div>
              }
              <div class="price-preview-row">
                <span>TVA ({{ vatRate() }}%)</span>
                <span class="value">{{ calculateVat() | number:'1.3-3' }} TND</span>
              </div>
              <div class="price-preview-row total">
                <span>Prix TTC</span>
                <span class="value">{{ calculateTTC() | number:'1.3-3' }} TND</span>
              </div>
            </div>
          </div>

          <div class="form-block">
            <h4 class="form-block-title">Optionnel</h4>
            <div class="form-group">
              <label for="quick-desc">Description</label>
              <textarea
                pTextarea
                id="quick-desc"
                [ngModel]="description()"
                (ngModelChange)="description.set($event)"
                placeholder="Description du produit"
                [rows]="2"
                class="w-full"></textarea>
            </div>
          </div>
        </div>

        @if (errorMessage()) {
          <div class="error-message" role="alert">
            <i class="pi pi-exclamation-triangle"></i>
            {{ errorMessage() }}
          </div>
        }
      </div>
    </ng-template>

    @if (panelMode && visible) {
      <div class="panel-overlay" (click)="close()" role="presentation">
        <div
          class="panel-content"
          (click)="$event.stopPropagation()"
          role="dialog"
          aria-label="Créer un nouveau produit"
          aria-modal="true">
          <div class="panel-header">
            <h2 class="panel-title" id="quick-create-product-panel-title">Créer un produit</h2>
            <button
              type="button"
              class="panel-close"
              (click)="close()"
              aria-label="Fermer le panneau">
              <i class="pi pi-times"></i>
            </button>
          </div>
          <div class="panel-body">
            <ng-container *ngTemplateOutlet="formContent"></ng-container>
          </div>
          <div class="panel-footer">
            <app-button
              variant="outline"
              icon="pi-times"
              iconPos="left"
              (click)="close()"
              ariaLabel="Annuler">
              Annuler
            </app-button>
            <app-button
              variant="primary"
              icon="pi-plus"
              iconPos="left"
              [disabled]="submitting() || !canSubmit()"
              (click)="submit()"
              ariaLabel="Créer et ajouter">
              {{ submitting() ? 'Création...' : 'Créer et ajouter' }}
            </app-button>
          </div>
        </div>
      </div>
    }

    @if (!panelMode) {
      <p-dialog
        header="Créer un produit"
        [(visible)]="visible"
        [modal]="true"
        [style]="{ width: '640px', maxWidth: '95vw' }"
        [draggable]="false"
        [closable]="true"
        (onHide)="onHide()"
        [contentStyle]="{ overflow: 'visible' }"
        ariaLabel="Créer un nouveau produit">
        <ng-container *ngTemplateOutlet="formContent"></ng-container>
        <ng-template pTemplate="footer">
          <div class="dialog-footer">
            <app-button
              variant="outline"
              icon="pi-times"
              iconPos="left"
              (click)="close()"
              ariaLabel="Annuler">
              Annuler
            </app-button>
            <app-button
              variant="primary"
              icon="pi-plus"
              iconPos="left"
              [disabled]="submitting() || !canSubmit()"
              (click)="submit()"
              ariaLabel="Créer et ajouter">
              {{ submitting() ? 'Création...' : 'Créer et ajouter' }}
            </app-button>
          </div>
        </ng-template>
      </p-dialog>
    }
  `,
  styles: [`
    .quick-create-product-content {
      padding: 0;
    }

    .form-fields {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .form-block {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .form-block-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0;
      padding-top: var(--spacing-2);
      border-top: 1px solid var(--color-border-subtle);
    }

    .form-block:first-child .form-block-title {
      padding-top: 0;
      border-top: none;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .form-group label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
    }

    .required {
      color: var(--color-error-600);
      margin-left: var(--spacing-1);
    }

    .form-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      margin-top: var(--spacing-1);
    }

    .status-switch {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }

    .status-switch span {
      color: var(--color-neutral-600);
    }

    .status-switch span.active {
      color: var(--color-success-600);
      font-weight: var(--font-weight-medium);
    }

    .field-error {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-error-600);
    }

    .field-error i {
      font-size: var(--font-size-base);
      flex-shrink: 0;
    }

    .error-message {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4);
      margin-top: var(--spacing-4);
      background: var(--color-error-50);
      color: var(--color-error-700);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-4);
    }

    .price-preview {
      margin-top: var(--spacing-3);
      padding: var(--spacing-3);
      background: var(--color-background-subtle);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
    }

    .price-preview-row {
      display: flex;
      justify-content: space-between;
      padding: var(--spacing-2) 0;
      font-size: var(--font-size-sm);
    }

    .price-preview-row .value {
      font-family: var(--font-family);
      font-weight: var(--font-weight-medium);
    }

    .price-preview-row.total {
      margin-top: var(--spacing-2);
      padding-top: var(--spacing-3);
      border-top: 2px solid var(--color-border-subtle);
      font-weight: var(--font-weight-semibold);
    }

    .price-preview-row.total .value {
      font-size: var(--font-size-lg);
      color: var(--color-primary-700);
    }

    @media (max-width: 520px) {
      :host ::ng-deep .p-dialog {
        width: calc(100vw - var(--spacing-8)) !important;
        max-width: 640px;
      }

      .form-row {
        grid-template-columns: 1fr;
      }
    }

    :host ::ng-deep {
      .p-dialog {
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-xl);
        overflow: hidden;
      }

      .p-dialog-content {
        border-radius: 0;
        padding: var(--spacing-6);
      }

      .p-dialog-header {
        padding: var(--spacing-4) var(--spacing-6);
        border-bottom: 1px solid var(--color-border-subtle);
        background: var(--color-background-elevated);
      }

      .p-dialog-header .p-dialog-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .p-dialog-footer {
        padding: var(--spacing-4) var(--spacing-6);
        border-top: 1px solid var(--color-border-subtle);
        background: var(--color-background-subtle);
      }

      .p-select,
      .p-inputnumber {
        width: 100%;
      }
    }

    .panel-overlay {
      position: fixed;
      inset: 0;
      z-index: var(--z-drawer-overlay);
      display: flex;
      justify-content: flex-end;
      align-items: stretch;
      background: rgba(15, 23, 42, 0.25);
      backdrop-filter: blur(4px);
      animation: panelFadeIn 200ms ease-out;
    }

    .panel-content {
      position: relative;
      z-index: var(--z-drawer-panel);
      width: min(520px, 100vw);
      max-height: 100dvh;
      height: 100%;
      background: var(--color-white);
      box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: panelSlideInRight 250ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-5);
      border-bottom: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
    }

    .panel-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      margin: 0;
      color: var(--color-text-primary);
    }

    .panel-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .panel-close:hover {
      background: var(--color-neutral-200);
      color: var(--color-text-primary);
    }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-5);
      min-height: 0;
    }

    .panel-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-4);
      padding: var(--spacing-4) var(--spacing-5);
      padding-bottom: calc(var(--spacing-4) + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid var(--color-border-subtle);
      background: var(--color-background-subtle);
      flex-shrink: 0;
    }

    @keyframes panelFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes panelSlideInRight {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
  `],
})
export class QuickCreateProductDialogComponent {
  @Input() panelMode = false;
  /** Facture fournisseur directe : un article géré en stock n'est pas ajouté à la ligne. */
  @Input() stockExcludedFromLine = false;

  @Input() set visible(value: boolean) {
    const wasVisible = this._dialogVisible;
    this._dialogVisible = value;
    if (value && !wasVisible) {
      if (this.panelMode) {
        this.drawerOverlay.registerOpen();
      }
      this.resetForm();
      setTimeout(() => this.focusFirstField(), 200);
    } else if (!value && wasVisible && this.panelMode) {
      this.drawerOverlay.registerClose();
    }
  }
  get visible(): boolean {
    return this._dialogVisible;
  }
  _dialogVisible = false;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() productCreated = new EventEmitter<ProductListItem>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.panelMode && this.visible) {
      this.close();
    }
  }

  readonly productService = inject(ProductService);
  readonly errorHandler = inject(ErrorHandlerService);
  readonly drawerOverlay = inject(DrawerOverlayService);
  private readonly auth = inject(AuthService);
  readonly drawerOverlayOptions: OverlayOptions = { baseZIndex: 1200 };

  readonly typeOptions = TYPE_OPTIONS;
  readonly unitOptions = UNIT_OPTIONS;
  readonly vatOptions = VAT_OPTIONS;

  readonly code = signal('');
  readonly name = signal('');
  readonly category = signal('Produit');
  readonly unit = signal('Unité');
  readonly unitPrice = signal(0);
  readonly vatRate = signal(19);
  readonly isFodecApplicable = signal(false);
  readonly isStockManaged = signal(false);
  readonly description = signal('');

  readonly showStockManagement = computed(
    () => this.auth.hasModule(AppModule.Stock) && this.auth.hasPermission(PERMISSIONS.products.create)
  );

  readonly isProductCategory = computed(() => this.category() === 'Produit');

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly submitAttempted = signal(false);

  readonly codeTouched = signal(false);
  readonly nameTouched = signal(false);

  readonly codeValid = computed(() => this.code().trim().length >= 2);
  readonly nameValid = computed(() => this.name().trim().length >= 2);

  readonly canSubmit = computed(() =>
    this.codeValid() && this.nameValid() && this.unitPrice() >= 0
  );

  readonly showCodeError = computed(() =>
    (this.submitAttempted() || this.codeTouched()) && !this.codeValid()
  );

  readonly showNameError = computed(() =>
    (this.submitAttempted() || this.nameTouched()) && !this.nameValid()
  );

  readonly codeErrorMessage = computed(() => {
    const v = this.code().trim();
    return v.length === 0 ? 'Ce champ est obligatoire' : 'Min. 2 caractères';
  });

  readonly nameErrorMessage = computed(() => {
    const v = this.name().trim();
    return v.length === 0 ? 'Ce champ est obligatoire' : 'Min. 2 caractères';
  });

  resolveIsStockManaged(): boolean {
    return this.showStockManagement() && this.isProductCategory() && this.isStockManaged();
  }

  showSupplierStockHint(): boolean {
    return this.stockExcludedFromLine && this.resolveIsStockManaged();
  }

  stockDescribedBy(): string | null {
    const ids: string[] = [];
    if (!this.isProductCategory()) ids.push('quick-stock-type-hint');
    if (this.resolveIsStockManaged()) ids.push('quick-stock-zero-hint');
    if (this.showSupplierStockHint()) ids.push('quick-stock-supplier-hint');
    return ids.length ? ids.join(' ') : null;
  }

  onCategoryChange(value: string): void {
    this.category.set(value);
    this.applyStockDefaultForCategory(value);
  }

  private applyStockDefaultForCategory(category: string): void {
    this.isStockManaged.set(this.showStockManagement() && category === 'Produit');
  }

  calculateFodec(): number {
    return calculateFodecAmount(this.unitPrice(), this.isFodecApplicable());
  }

  calculateVat(): number {
    return calculateVatAmount(this.unitPrice(), this.calculateFodec(), this.vatRate());
  }

  calculateTTC(): number {
    return calculateSaleTtc(this.unitPrice(), this.vatRate(), this.isFodecApplicable());
  }

  onHide(): void {
    this.visibleChange.emit(false);
  }

  close(): void {
    this._dialogVisible = false;
    this.visibleChange.emit(false);
  }

  focusFirstField(): void {
    document.getElementById('quick-code')?.focus();
  }

  resetForm(): void {
    this.code.set('');
    this.name.set('');
    this.category.set('Produit');
    this.unit.set('Unité');
    this.unitPrice.set(0);
    this.vatRate.set(19);
    this.isFodecApplicable.set(false);
    this.applyStockDefaultForCategory('Produit');
    this.description.set('');
    this.errorMessage.set(null);
    this.submitAttempted.set(false);
    this.codeTouched.set(false);
    this.nameTouched.set(false);
  }

  submit(): void {
    this.submitAttempted.set(true);
    if (!this.canSubmit() || this.submitting()) return;

    this.errorMessage.set(null);
    this.submitting.set(true);

    const request: CreateProductRequest = {
      code: this.code().trim(),
      name: this.name().trim(),
      description: this.description().trim() || null,
      category: this.category(),
      unitPrice: this.unitPrice(),
      unit: this.unit(),
      vatRate: this.vatRate(),
      isStockManaged: this.resolveIsStockManaged(),
      isFodecApplicable: this.isFodecApplicable(),
    };

    this.productService.createProduct(request).pipe(
      switchMap((response) => {
        if (!response.success || !response.data) {
          return of(null);
        }
        return this.productService.getProduct(response.data);
      })
    ).subscribe({
      next: (getResponse) => {
        this.submitting.set(false);
        if (getResponse?.success && getResponse.data) {
          const product = getResponse.data as Product;
          const listItem: ProductListItem = {
            id: product.id,
            code: product.code,
            name: product.name,
            description: product.description ?? null,
            typeDisplay: product.typeDisplay,
            categoryId: product.categoryId,
            category: product.category,
            unitPrice: product.unitPrice,
            purchasePrice: product.purchasePrice ?? null,
            unit: product.unit,
            vatRate: product.vatRate,
            isActive: product.isActive,
            isStockManaged: product.isStockManaged,
            imageUrl: product.imageUrl ?? null,
          };
          this.productCreated.emit(listItem);
          this.close();
        }
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        const message = this.errorHandler.extractErrorMessage(err);
        if (err.status === 409) {
          this.errorMessage.set('Un produit avec ce code existe déjà.');
        } else {
          this.errorMessage.set(message || 'Impossible de créer le produit.');
        }
      },
    });
  }
}
