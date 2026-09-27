/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StockService, MovementReason, RecordEntryRequest, Warehouse } from '@core/services/stock.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ErrorMessageService } from '@core/services/error-message.service';

@Component({
    selector: 'app-stock-entry-form',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        RouterModule,
        InputTextModule,
        Textarea,
        InputNumberModule,
        SelectModule,
        ButtonModule,
        ToastModule,
        PageHeaderComponent,
        BreadcrumbComponent,
        FormSectionComponent,
        ButtonComponent
    ],
    template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    
    <app-page-header 
      title="Nouvelle entrée de stock" i18n-title="@@stock.stock-entry-form.nouvelle.entree.de.stock.0d9ac600" 
      subtitle="Enregistrez une entrée de marchandise dans votre entrepôt">
      <app-button 
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/stock" i18n="@@stock.stock-entry-form.annuler.49ba3292"> Annuler </app-button>
    </app-page-header>

    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div class="form-grid">
        <!-- Section 1: Entrepôt & Produit -->
        <app-form-section title="Détails du Stock" i18n-title="@@stock.stock-entry-form.details.du.stock.04fbfd18" icon="pi-box" [number]="1">
          <div class="form-group">
            <label for="warehouse"><ng-container i18n="@@stock.stock-entry-form.entrepot.c349c0bc">Entrepôt </ng-container> <span class="required" i18n="@@stock.stock-entry-form.text.df58248c">*</span></label>
            <p-select 
              id="warehouse"
              [options]="warehouses" 
              formControlName="warehouse"
              optionLabel="name"
              placeholder="Sélectionner un entrepôt" i18n-placeholder="@@stock.stock-entry-form.selectionner.un.entrepot.2e4d1232"
              styleClass="w-full"
              [class.ng-invalid]="isInvalid('warehouse')">
            </p-select>
            @if (isInvalid('warehouse')) {
              <div class="form-error">
                <i class="pi pi-exclamation-circle"></i>
                <span>{{ errorMessageService.getErrorMessage(form.get('warehouse')) }}</span>
              </div>
            }
          </div>

          <div class="form-group">
            <label for="product"><ng-container i18n="@@stock.stock-entry-form.produit.ff673dc2">Produit </ng-container> <span class="required" i18n="@@stock.stock-entry-form.text.df58248c">*</span></label>
            <p-select 
              id="product"
              [options]="products" 
              formControlName="product"
              optionLabel="name"
              [filter]="true"
              filterBy="name,code"
              placeholder="Chercher un produit" i18n-placeholder="@@stock.stock-entry-form.chercher.un.produit.44ee94b8"
              styleClass="w-full"
              [class.ng-invalid]="isInvalid('product')">
            </p-select>
             @if (isInvalid('product')) {
              <div class="form-error">
                <i class="pi pi-exclamation-circle"></i>
                <span>{{ errorMessageService.getErrorMessage(form.get('product')) }}</span>
              </div>
            }
            @if (productsLoaded && products.length === 0) {
              <small class="form-hint">
                <ng-container i18n="@@stock.stock-entry-form.aucun.produit.avec.gestion.de.stock.7ebe6e80"> Aucun produit avec gestion de stock. </ng-container>
                <a routerLink="/products" i18n="@@stock.stock-entry-form.activer.sur.un.produit.existant.8bb7a382">Activer sur un produit existant</a> ou
                <a routerLink="/products/new" i18n="@@stock.stock-entry-form.creer.un.produit.f389562a">créer un produit</a>.
              </small>
            }
          </div>
        </app-form-section>

        <!-- Section 2: Quantité & Coût -->
        <app-form-section title="Quantité & Valorisation" i18n-title="@@stock.stock-entry-form.quantite.valorisation.905a2065" icon="pi-dollar" [number]="2">
           <div class="form-row">
            <div class="form-group">
              <label for="quantity"><ng-container i18n="@@stock.stock-entry-form.quantite.09a38fda">Quantité </ng-container> <span class="required" i18n="@@stock.stock-entry-form.text.df58248c">*</span></label>
              <p-inputNumber 
                id="quantity" 
                formControlName="quantity"
                [min]="0.01"
                [maxFractionDigits]="2"
                suffix=" U"
                styleClass="w-full"
                [inputStyle]="{'width': '100%'}"
                [class.ng-invalid]="isInvalid('quantity')">
              </p-inputNumber>
               @if (isInvalid('quantity')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('quantity')) }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="unitCost"><ng-container i18n="@@stock.stock-entry-form.cout.unitaire.96a46113">Coût Unitaire </ng-container> <span class="required" i18n="@@stock.stock-entry-form.text.df58248c">*</span></label>
              <p-inputNumber 
                id="unitCost" 
                formControlName="unitCost"
                mode="currency" 
                currency="TND"
                locale="fr-TN"
                styleClass="w-full"
                [inputStyle]="{'width': '100%'}"
                [class.ng-invalid]="isInvalid('unitCost')">
              </p-inputNumber>
               @if (isInvalid('unitCost')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('unitCost')) }}</span>
                </div>
              }
            </div>
          </div>
          
           <!-- Calculated Total -->
          <div class="price-preview">
            <div class="preview-row total">
               <span i18n="@@stock.stock-entry-form.valeur.totale.entree.5465bd99">Valeur Totale Entrée</span>
               <span class="value">{{ calculateTotal() | currency:'TND':'symbol':'1.3-3' }}</span>
            </div>
          </div>
        </app-form-section>
        
        <!-- Section 3: Motif & Notes -->
        <app-form-section title="Informations Complémentaires" i18n-title="@@stock.stock-entry-form.informations.complementaires.5ce46026" icon="pi-file-edit" [number]="3">
           <div class="form-group">
              <label for="reason"><ng-container i18n="@@stock.stock-entry-form.motif.2a198f47">Motif </ng-container> <span class="required" i18n="@@stock.stock-entry-form.text.df58248c">*</span></label>
              <p-select 
                id="reason"
                [options]="entryReasons" 
                formControlName="reason"
                optionLabel="label"
                optionValue="value"
                placeholder="Raison de l'entrée" i18n-placeholder="@@stock.stock-entry-form.raison.de.l.entree.31c00fbb"
                styleClass="w-full"
                [class.ng-invalid]="isInvalid('reason')">
              </p-select>
               @if (isInvalid('reason')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('reason')) }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="notes" i18n="@@stock.stock-entry-form.notes.reference.682d0de7">Notes / Référence</label>
              <textarea 
                pTextarea 
                id="notes" 
                formControlName="notes"
                placeholder="Ex: BL-2024-001" i18n-placeholder="@@stock.stock-entry-form.ex.bl.2024.001.b51e17b1"
                [rows]="3"
                class="w-full">
              </textarea>
            </div>
        </app-form-section>
      </div>

      <!-- Actions -->
      <div class="form-actions">
        <app-button 
          variant="outline"
          icon="pi-times"
          iconPos="left"
          routerLink="/stock" i18n="@@stock.stock-entry-form.annuler.49ba3292"> Annuler </app-button>
        <app-button 
          variant="primary"
          type="submit"
          [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
          iconPos="left"
          [disabled]="form.invalid || saving()" i18n="@@stock.stock-entry-form.enregistrer.l.entree.290540ec"> Enregistrer l'entrée </app-button>
      </div>
    </form>
  `,
    styles: [`
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      margin-bottom: var(--spacing-5);
      &:last-child { margin-bottom: 0; }
      
      label {
        display: block;
        margin-bottom: var(--spacing-2);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .required {
        color: var(--color-error-600);
        margin-left: var(--spacing-1);
      }
    }

    .form-error {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-error-600);
      i { font-size: var(--font-size-base); }
    }

    .price-preview {
      margin-top: var(--spacing-4);
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
    }

    .preview-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      
      &.total {
        font-weight: var(--font-weight-semibold);
        .value {
           font-size: var(--font-size-lg);
           color: var(--color-primary-700);
           font-family: 'JetBrains Mono', monospace;
        }
      }
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-4);
      margin-top: var(--spacing-8);
      padding-top: var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle);
    }

    :host ::ng-deep {
      .p-inputnumber, .p-select { width: 100%; }
    }

    // Le <textarea> natif n'est PAS couvert par le bloc ::ng-deep ci-dessus : il vit
    // dans ce template, pas dans un composant enfant. Sans cette règle il reste à sa
    // largeur intrinsèque pendant que les p-select et p-inputNumber voisins occupent
    // toute la colonne — la « class="w-full" » posée dessus ne porte rien (Tailwind est
    // préfixé « tw- », cf. tailwind.config.js).
    .form-group > input[pInputText],
    .form-group > textarea[pTextarea] {
      width: 100%;
    }
  `]
})
export class StockEntryFormComponent implements OnInit {
    private fb = inject(FormBuilder);
    private router = inject(Router);
    private toastService = inject(ToastService);
    private stockService = inject(StockService);
    private productService = inject(ProductService);
    private errorHandler = inject(ErrorHandlerService);
    errorMessageService = inject(ErrorMessageService);

    saving = signal(false);
    warehouses: Warehouse[] = [];
    products: ProductListItem[] = [];
    productsLoaded = false;

    breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
        { label: 'Gestion du Stock', route: '/stock' },
        { label: 'Nouvelle Entrée' }
    ];

    entryReasons = [
        { label: 'Achat hors réception', value: MovementReason.Purchase },
        { label: 'Retour Client', value: MovementReason.CustomerReturn },
        { label: 'Stock Initial', value: MovementReason.InitialStock }
    ];

    form: FormGroup = this.fb.group({
        warehouse: [null, Validators.required],
        product: [null, Validators.required],
        quantity: [1, [Validators.required, Validators.min(0.001)]],
        unitCost: [0, [Validators.required, Validators.min(0)]],
        reason: [MovementReason.Purchase, Validators.required],
        notes: ['']
    });

    ngOnInit() {
        this.loadWarehouses();
        this.loadProducts();
    }

    isInvalid(field: string): boolean {
        const control = this.form.get(field);
        return !!(control?.invalid && control?.touched);
    }

    calculateTotal(): number {
        const qty = this.form.get('quantity')?.value || 0;
        const cost = this.form.get('unitCost')?.value || 0;
        return qty * cost;
    }

    loadWarehouses() {
        this.stockService.getWarehouses(true).subscribe({
            next: (res) => {
                if (res.success && res.data) {
                    this.warehouses = res.data;
                    const defaultWh = this.warehouses.find(w => w.isDefault) || this.warehouses[0];
                    if (defaultWh) this.form.patchValue({ warehouse: defaultWh });
                }
            },
            error: (err) => this.errorHandler.logError('Failed warehouses', err)
        });
    }

    loadProducts() {
        this.productService.getProducts({ isActive: true, pageSize: 1000 }).subscribe({
            next: (res) => {
                if (res.success && res.data) {
                    this.products = res.data.items.filter(p => p.isStockManaged);
                }
                this.productsLoaded = true;
            },
            error: (err) => {
                this.productsLoaded = true;
                this.errorHandler.logError('Failed products', err);
            }
        });
    }

    onSubmit() {
        if (this.form.invalid) {
            this.form.markAllAsTouched();
            return;
        }

        this.saving.set(true);
        const val = this.form.value;

        const request: RecordEntryRequest = {
            warehouseId: val.warehouse.id,
            productId: val.product.id,
            quantity: val.quantity,
            unitCost: val.unitCost,
            reason: val.reason,
            notes: val.notes
        };

        this.stockService.recordEntry(request).subscribe({
            next: (res) => {
                if (res.success) {
                    this.toastService.add({
                        severity: 'success', summary: $localize`:@@stock-entry-form.component.summary.Succès:Succès`, detail: $localize`:@@stock-entry-form.component.detail.Entr_e_de_stock_:Entrée de stock enregistrée`
                    });
                    this.router.navigate(['/stock']);
                } else {
                    this.toastService.add({
                        severity: 'error', summary: $localize`:@@stock-entry-form.component.summary.Erreur:Erreur`, detail: res.errors?.join(', ') || 'Erreur'
                    });
                    this.saving.set(false);
                }
            },
            error: (err) => {
                const errorMessage = this.errorHandler.extractErrorMessage(err);
                this.toastService.add({
                    severity: 'error',
                    summary: $localize`:@@stock-entry-form.component.summary.Erreur:Erreur`,
                    detail: errorMessage || 'Une erreur est survenue'
                });
                this.errorHandler.logError('Stock entry failed', err);
                this.saving.set(false);
            }
        });

    }
}
