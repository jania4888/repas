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
import { StockService, MovementReason, RecordExitRequest, Warehouse } from '@core/services/stock.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import { ConfirmationService } from '@core/services/confirmation.service';

@Component({
  selector: 'app-stock-exit-form',
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
      title="Nouvelle sortie de stock" i18n-title="@@stock.stock-exit-form.nouvelle.sortie.de.stock.8989c4d6" 
      subtitle="Enregistrez une sortie de marchandise de votre entrepôt" i18n-subtitle="@@stock.stock-exit-form.enregistrez.une.sortie.de.marchandise.de.954f60f4">
      <app-button 
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/stock" i18n="@@stock.stock-exit-form.annuler.49ba3292"> Annuler </app-button>
    </app-page-header>

    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div class="form-grid">
        <!-- Section 1: Entrepôt & Produit -->
        <app-form-section title="Détails du Stock" i18n-title="@@stock.stock-exit-form.details.du.stock.04fbfd18" icon="pi-box" [number]="1">
          <div class="form-group">
            <label for="warehouse"><ng-container i18n="@@stock.stock-exit-form.entrepot.c349c0bc">Entrepôt </ng-container> <span class="required" i18n="@@stock.stock-exit-form.text.df58248c">*</span></label>
            <p-select 
              id="warehouse"
              [options]="warehouses" 
              formControlName="warehouse"
              optionLabel="name"
              placeholder="Sélectionner un entrepôt" i18n-placeholder="@@stock.stock-exit-form.selectionner.un.entrepot.2e4d1232"
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
            <label for="product"><ng-container i18n="@@stock.stock-exit-form.produit.ff673dc2">Produit </ng-container> <span class="required" i18n="@@stock.stock-exit-form.text.df58248c">*</span></label>
            <p-select 
              id="product"
              [options]="products" 
              formControlName="product"
              optionLabel="name"
              [filter]="true"
              filterBy="name,code"
              placeholder="Chercher un produit" i18n-placeholder="@@stock.stock-exit-form.chercher.un.produit.44ee94b8"
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
              <small class="form-hint" i18n="@@stock.stock-exit-form.aucun.produit.avec.gestion.de.stock.acti.792ada2c">
                <ng-container> Aucun produit avec gestion de stock. </ng-container>
                <a routerLink="/products">Activer sur un produit existant</a> ou
                <a routerLink="/products/new">créer un produit</a>.
              </small>
            }
          </div>
        </app-form-section>

        <!-- Section 2: Quantité -->
        <app-form-section title="Quantité à Sortir" i18n-title="@@stock.stock-exit-form.quantite.a.sortir.bab0682e" icon="pi-minus-circle" [number]="2">
           <div class="form-group">
              <label for="quantity"><ng-container i18n="@@stock.stock-exit-form.quantite.09a38fda">Quantité </ng-container> <span class="required" i18n="@@stock.stock-exit-form.text.df58248c">*</span></label>
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
           
           <!-- Warning panel -->
           <div class="exit-warning">
             <i class="pi pi-exclamation-triangle"></i>
             <span i18n="@@stock.stock-exit-form.cette.operation.reduira.le.stock.disponible.du.p.43c58548">Cette opération réduira le stock disponible du produit sélectionné.</span>
           </div>
        </app-form-section>
        
        <!-- Section 3: Motif & Notes -->
        <app-form-section title="Informations Complémentaires" i18n-title="@@stock.stock-exit-form.informations.complementaires.5ce46026" icon="pi-file-edit" [number]="3">
           <div class="form-group">
              <label for="reason"><ng-container i18n="@@stock.stock-exit-form.motif.2a198f47">Motif </ng-container> <span class="required" i18n="@@stock.stock-exit-form.text.df58248c">*</span></label>
              <p-select 
                id="reason"
                [options]="exitReasons" 
                formControlName="reason"
                optionLabel="label"
                optionValue="value"
                placeholder="Raison de la sortie" i18n-placeholder="@@stock.stock-exit-form.raison.de.la.sortie.23c4a027"
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
              <label for="notes" i18n="@@stock.stock-exit-form.notes.reference.682d0de7">Notes / Référence</label>
              <textarea 
                pTextarea 
                id="notes" 
                formControlName="notes"
                placeholder="Ex: Ajustement inventaire" i18n-placeholder="@@stock.stock-exit-form.ex.ajustement.inventaire.153b5f1e"
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
          routerLink="/stock" i18n="@@stock.stock-exit-form.annuler.49ba3292"> Annuler </app-button>
        <app-button 
          variant="primary"
          type="submit"
          [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
          iconPos="left"
          [disabled]="form.invalid || saving()"
          class="danger-button" i18n="@@stock.stock-exit-form.enregistrer.la.sortie.478823d2"> Enregistrer la sortie </app-button>
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

    .exit-warning {
      margin-top: var(--spacing-4);
      padding: var(--spacing-4);
      background: var(--color-warning-50);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-warning-200);
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      color: var(--color-warning-700);
      font-size: var(--font-size-sm);
      
      i {
        font-size: var(--font-size-lg);
        color: var(--color-warning-500);
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

    // Le <textarea> natif n'est PAS couvert par le bloc ::ng-deep ci-dessous : il vit
    // dans ce template, pas dans un composant enfant. Sans cette règle il reste à sa
    // largeur intrinsèque pendant que les p-select et p-inputNumber voisins occupent
    // toute la colonne — la « class="w-full" » posée dessus ne porte rien (Tailwind est
    // préfixé « tw- », cf. tailwind.config.js).
    .form-group > input[pInputText],
    .form-group > textarea[pTextarea] {
      width: 100%;
    }

    :host ::ng-deep {
      .p-inputnumber, .p-select { width: 100%; }

      .danger-button .btn {
        background-color: var(--color-error-600) !important;
        border-color: var(--color-error-600) !important;
        &:hover {
          background-color: var(--color-error-700) !important;
          border-color: var(--color-error-700) !important;
        }
      }
    }
  `]
})
export class StockExitFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private toastService = inject(ToastService);
  private stockService = inject(StockService);
  private productService = inject(ProductService);
  private errorHandler = inject(ErrorHandlerService);
  private confirmationService = inject(ConfirmationService);
  errorMessageService = inject(ErrorMessageService);

  saving = signal(false);
  warehouses: Warehouse[] = [];
  products: ProductListItem[] = [];
  productsLoaded = false;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@stock.stock-exit-form.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@stock.stock-exit-form.ts.gestion.du.stock.72df5586:Gestion du Stock`, route: '/stock' },
    { label: $localize`:@@stock.stock-exit-form.ts.nouvelle.sortie.dd4db0bf:Nouvelle Sortie` }
  ];

  exitReasons = [
    { label: $localize`:@@stock.stock-exit-form.ts.retour.fournisseur.371de2a8:Retour Fournisseur`, value: MovementReason.SupplierReturn },
    { label: $localize`:@@stock.stock-exit-form.ts.dommage.perte.4a8ecd42:Dommage / Perte`, value: MovementReason.Damage }
  ];

  form: FormGroup = this.fb.group({
    warehouse: [null, Validators.required],
    product: [null, Validators.required],
    quantity: [1, [Validators.required, Validators.min(0.001)]],
    reason: [MovementReason.SupplierReturn, Validators.required],
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

    const request: RecordExitRequest = {
      warehouseId: val.warehouse.id,
      productId: val.product.id,
      quantity: val.quantity,
      reason: val.reason,
      notes: val.notes
    };

    this.stockService.recordExit(request, { skipGlobalErrorUi: true }).subscribe({
      next: (res) => {
        if (res.success) {
          this.toastService.add({
            severity: 'success', summary: $localize`:@@stock-exit-form.component.summary.Succès:Succès`, detail: $localize`:@@stock-exit-form.component.detail.Sortie_de_stock_:Sortie de stock enregistrée`
          });
          this.router.navigate(['/stock']);
        } else {
          const detail = res.errors?.join(', ') || res.message || 'Erreur';
          this.confirmationService.alert({
            header: $localize`:@@stock.stock-exit-form.ts.sortie.de.stock.impossible.803e3955:Sortie de stock impossible`,
            message: detail,
            icon: 'pi pi-exclamation-triangle'
          });
          this.saving.set(false);
        }
      },
      error: (err) => {
        const errorMessage = this.errorHandler.extractErrorMessage(err);
        this.confirmationService.alert({
          header: $localize`:@@stock.stock-exit-form.ts.sortie.de.stock.impossible.803e3955:Sortie de stock impossible`,
          message: errorMessage || $localize`:@@stock.stock-exit-form.ts.une.erreur.est.survenue.0419f56e:Une erreur est survenue`,
          icon: 'pi pi-exclamation-triangle'
        });
        this.errorHandler.logError('Stock exit failed', err, { consoleLevel: 'warn' });
        this.saving.set(false);
      }
    });
  }
}
