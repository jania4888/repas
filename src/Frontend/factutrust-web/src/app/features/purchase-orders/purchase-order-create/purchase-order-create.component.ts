/// <reference types="@angular/localize" />
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { environment } from '@environments/environment';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { WarehouseSelectorComponent } from '@shared/components/warehouse-selector/warehouse-selector.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { formatLocalDate } from '@core/utils/date.util';
import { PurchaseOrderService, CreatePurchaseOrderRequest, CreatePurchaseOrderLineRequest } from '@core/services/purchase-order.service';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';

interface OrderLine {
  product: ProductListItem | null;
  quantity: number;
  unitPriceHT: number;
  vatRate: number;
  subTotal: number;
  vatAmount: number;
  total: number;
}

@Component({
  selector: 'app-purchase-order-create',
  standalone: true,
  imports: [
    BarcodeScanFieldComponent,
    CommonModule, RouterModule, FormsModule, CurrencyPipe,
    TableModule, SelectModule, InputTextModule, InputNumberModule,
    DatePickerModule, Textarea, ToastModule,
    PageHeaderComponent, BreadcrumbComponent, FormSectionComponent, ButtonComponent, WarehouseSelectorComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Nouveau bon de commande" i18n-title="@@purchase-orders.purchase-order-create.nouveau.bon.de.commande.589cb8eb"
      subtitle="Créez une commande fournisseur en sélectionnant les produits et quantités.">
      <app-button 
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/purchase-orders" i18n="@@purchase-orders.purchase-order-create.annuler.49ba3292"> Annuler </app-button>
    </app-page-header>

    <div class="form-grid">
      <!-- Section 1: Informations générales -->
      <app-form-section title="Informations générales" i18n-title="@@purchase-orders.purchase-order-create.informations.generales.be6ba6e5" icon="pi-building" [number]="1">
        <div class="form-group">
          <label for="supplier"><ng-container i18n="@@purchase-orders.purchase-order-create.fournisseur.97d91d89">Fournisseur </ng-container> <span class="required" i18n="@@purchase-orders.purchase-order-create.text.df58248c">*</span></label>
          <p-select
            id="supplier"
            [options]="suppliers()"
            [(ngModel)]="selectedSupplier"
            optionLabel="name"
            placeholder="Sélectionnez un fournisseur" i18n-placeholder="@@purchase-orders.purchase-order-create.selectionnez.un.fournisseur.7351a0fb"
            [filter]="true"
            filterBy="name"
            [showClear]="true"
            styleClass="w-full">
          </p-select>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="orderDate"><ng-container i18n="@@purchase-orders.purchase-order-create.date.de.commande.f9b0df86">Date de commande </ng-container> <span class="required" i18n="@@purchase-orders.purchase-order-create.text.df58248c">*</span></label>
            <p-datepicker
              id="orderDate"
              [(ngModel)]="orderDate"
              dateFormat="dd/mm/yy"
              [showIcon]="true"
              styleClass="w-full">
            </p-datepicker>
          </div>

          <div class="form-group">
            <label for="deliveryDate" i18n="@@purchase-orders.purchase-order-create.date.de.livraison.prevue.3ea95a1d">Date de livraison prévue</label>
            <p-datepicker
              id="deliveryDate"
              [(ngModel)]="expectedDeliveryDate"
              dateFormat="dd/mm/yy"
              [showIcon]="true"
              [minDate]="orderDate"
              styleClass="w-full">
            </p-datepicker>
          </div>
        </div>

        <div class="form-group">
          <label for="reference" i18n="@@purchase-orders.purchase-order-create.reference.fournisseur.5fbc4823">Référence fournisseur</label>
          <input
            pInputText
            id="reference"
            [(ngModel)]="reference"
            placeholder="Ex: DEV-2024-001" i18n-placeholder="@@purchase-orders.purchase-order-create.ex.dev.2024.001.9e0e07b8"
            class="w-full">
        </div>
      </app-form-section>

      <!-- Section 2: Notes & Entrepôt -->
      <app-form-section title="Notes et entrepôt" i18n-title="@@purchase-orders.purchase-order-create.notes.et.entrepot.89df1c38" icon="pi-file-edit" [number]="2" class="notes-card">
        <div class="form-group">
          <label for="notes" i18n="@@purchase-orders.purchase-order-create.notes.internes.1a81fb4e">Notes internes</label>
          <textarea
            pTextarea
            id="notes"
            [(ngModel)]="notes"
            placeholder="Notes internes pour cette commande..." i18n-placeholder="@@purchase-orders.purchase-order-create.notes.internes.pour.cette.commande.2507da2c"
            [rows]="4"
            class="w-full">
          </textarea>
          <small class="form-hint" i18n="@@purchase-orders.purchase-order-create.non.visibles.par.le.fournisseur.03ee7227">Non visibles par le fournisseur.</small>
        </div>
        <div class="form-group" style="margin-top: 1rem;">
          <app-warehouse-selector
            label="Entrepôt de réception" i18n-label="@@purchase-orders.purchase-order-create.entrepot.de.reception.e8cfc9df"
            placeholder="Entrepôt par défaut" i18n-placeholder="@@purchase-orders.purchase-order-create.entrepot.par.defaut.5dc0b8c6"
            [value]="selectedWarehouseId"
            (valueChange)="selectedWarehouseId = $event">
          </app-warehouse-selector>
          <small class="form-hint" i18n="@@purchase-orders.purchase-order-create.entrepot.dans.lequel.la.marchandise.sera.recepti.09418c89">Entrepôt dans lequel la marchandise sera réceptionnée (optionnel)</small>
        </div>
      </app-form-section>
    </div>

    <!-- Section 3: Lignes de commande (full width) -->
    <app-form-section title="Lignes de commande" i18n-title="@@purchase-orders.purchase-order-create.lignes.de.commande.ca1d2a94" icon="pi-list" [number]="3" class="lines-section">
      <div class="section-header-actions">
        <app-button variant="secondary" icon="pi-plus" iconPos="left" size="sm"
          (click)="addLine()" i18n="@@purchase-orders.purchase-order-create.ajouter.une.ligne.ba241fd4"> Ajouter une ligne </app-button>
        @if (barcodeScanEnabled) {
          <div class="barcode-scan-row">
            <ft-barcode-scan-field
              placeholder="Scanner un code-barres pour ajouter une ligne" i18n-placeholder="@@purchase-orders.purchase-order-create.scanner.un.code.barres.pour.ajouter.une.ligne.3525ced5"
              [autoFocus]="false"
              (scanned)="onBarcodeScanned($event)"></ft-barcode-scan-field>
          </div>
        }
      </div>

      @if (lines.length === 0) {
        <div class="empty-lines">
          <i class="pi pi-inbox"></i>
          <p i18n="@@purchase-orders.purchase-order-create.aucune.ligne.ajoutee.cliquez.sur.ajouter.une.lig.6e62345a">Aucune ligne ajoutée. Cliquez sur "Ajouter une ligne" pour commencer.</p>
        </div>
      } @else {
        <div class="lines-table">
          <table>
            <thead>
              <tr>
                <th style="width: 40px" i18n="@@purchase-orders.purchase-order-create.text.d08f88df">#</th>
                <th><ng-container i18n="@@purchase-orders.purchase-order-create.produit.ff673dc2">Produit </ng-container> <span class="required" i18n="@@purchase-orders.purchase-order-create.text.df58248c">*</span></th>
                <th style="width: 120px"><ng-container i18n="@@purchase-orders.purchase-order-create.quantite.09a38fda">Quantité </ng-container> <span class="required" i18n="@@purchase-orders.purchase-order-create.text.df58248c">*</span></th>
                <th style="width: 140px" i18n="@@purchase-orders.purchase-order-create.prix.unitaire.ht.bb3f8e39">Prix unitaire HT</th>
                <th style="width: 80px" i18n="@@purchase-orders.purchase-order-create.tva.fb62cb5d">TVA</th>
                <th style="width: 140px" i18n="@@purchase-orders.purchase-order-create.total.ttc.9e80ff7c">Total TTC</th>
                <th style="width: 50px"></th>
              </tr>
            </thead>
            <tbody>
              @for (line of lines; track $index) {
                <tr>
                  <td class="text-center line-number">{{ $index + 1 }}</td>
                  <td>
                    <p-select
                      [options]="products()"
                      [(ngModel)]="line.product"
                      optionLabel="name"
                      placeholder="Sélectionnez un produit" i18n-placeholder="@@purchase-orders.purchase-order-create.selectionnez.un.produit.fec907fb"
                      [filter]="true"
                      filterBy="name,code"
                      [showClear]="false"
                      appendTo="body"
                      (onChange)="onProductChange($index)"
                      styleClass="w-full product-dropdown">
                      <ng-template let-item pTemplate="item">
                        <div class="product-option">
                          <span class="product-option-name">{{ item.name }}</span>
                          <span class="product-option-code">{{ item.code }}</span>
                        </div>
                      </ng-template>
                    </p-select>
                  </td>
                  <td>
                    <p-inputNumber
                      [(ngModel)]="line.quantity"
                      [min]="0.001"
                      [minFractionDigits]="0"
                      [maxFractionDigits]="3"
                      (onInput)="recalculateLine($index)"
                      styleClass="w-full"
                      inputStyleClass="w-full text-right">
                    </p-inputNumber>
                  </td>
                  <td>
                    <p-inputNumber
                      [(ngModel)]="line.unitPriceHT"
                      [min]="0"
                      [minFractionDigits]="3"
                      [maxFractionDigits]="3"
                      mode="decimal"
                      suffix=" TND"
                      (onInput)="recalculateLine($index)"
                      styleClass="w-full"
                      inputStyleClass="w-full text-right">
                    </p-inputNumber>
                  </td>
                  <td class="text-center vat-cell">
                    {{ line.vatRate }}%
                  </td>
                  <td class="text-right amount">
                    {{ line.total | currency:'TND':'symbol':'1.3-3' }}
                  </td>
                  <td class="text-center">
                    <button class="remove-btn" (click)="removeLine($index)"
                      aria-label="Supprimer la ligne" i18n-aria-label="@@purchase-orders.purchase-order-create.supprimer.la.ligne.17611368">
                      <i class="pi pi-trash"></i>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </app-form-section>

    <!-- Section 4: Récapitulatif -->
    <app-form-section title="Récapitulatif" i18n-title="@@purchase-orders.purchase-order-create.recapitulatif.d5b5de6d" icon="pi-calculator" [number]="4" class="summary-section">
      <div class="totals-section">
        <div class="total-row">
          <span i18n="@@purchase-orders.purchase-order-create.sous.total.ht.724598f6">Sous-total HT</span>
          <span class="amount">{{ subTotalHT | currency:'TND':'symbol':'1.3-3' }}</span>
        </div>
        <div class="total-row">
          <span i18n="@@purchase-orders.purchase-order-create.tva.fb62cb5d">TVA</span>
          <span class="amount">{{ totalVat | currency:'TND':'symbol':'1.3-3' }}</span>
        </div>
        <div class="total-row grand-total">
          <span i18n="@@purchase-orders.purchase-order-create.total.ttc.9e80ff7c">Total TTC</span>
          <span class="amount">{{ totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
        </div>
      </div>
    </app-form-section>

    <!-- Actions -->
    <div class="form-actions">
      <app-button 
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/purchase-orders" i18n="@@purchase-orders.purchase-order-create.annuler.49ba3292"> Annuler </app-button>
      <app-button
        variant="primary"
        [icon]="submitting() ? 'pi-spin pi-spinner' : 'pi-check'"
        iconPos="left"
        [disabled]="!isFormValid() || submitting()"
        (click)="submitOrder()" i18n="@@purchase-orders.purchase-order-create.creer.en.brouillon.a3210155"> Créer en brouillon </app-button>
    </div>
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

    .notes-card {
      grid-column: 2;

      @media (max-width: 1024px) {
        grid-column: 1;
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

      &:last-child {
        margin-bottom: 0;
      }

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

    .form-hint {
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-1);
      display: block;
    }

    .lines-section {
      margin-top: var(--spacing-4);
    }

    .section-header-actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: var(--spacing-4);
    }

    .empty-lines {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--spacing-8);
      color: var(--color-text-tertiary);
      gap: var(--spacing-2);

      i { font-size: 2rem; }
      p { margin: 0; font-size: var(--font-size-sm); }
    }

    .lines-table {
      overflow-x: auto;

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th {
        padding: var(--spacing-3) var(--spacing-4);
        text-align: left;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background: var(--color-background-subtle);
        border-bottom: 1px solid var(--color-border-subtle);

        .required {
          color: var(--color-error-600);
          margin-left: var(--spacing-1);
        }
      }

      td {
        padding: var(--spacing-3) var(--spacing-4);
        border-bottom: 1px solid var(--color-border-subtle);
        vertical-align: middle;
      }
    }

    .line-number {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      font-weight: var(--font-weight-semibold);
    }

    .vat-cell {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .amount {
      font-family: 'JetBrains Mono', monospace;
      font-weight: var(--font-weight-semibold);
    }

    .remove-btn {
      background: none;
      border: none;
      padding: var(--spacing-2);
      cursor: pointer;
      color: var(--color-text-tertiary);
      border-radius: var(--radius-md);
      transition: all var(--transition-fast);

      &:hover {
        color: var(--color-danger-600, #dc2626);
        background: var(--color-danger-50, #fef2f2);
      }
    }

    .product-option {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .product-option-name {
      font-weight: var(--font-weight-medium);
    }

    .product-option-code {
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
      font-family: 'JetBrains Mono', monospace;
    }

    .summary-section {
      margin-top: var(--spacing-4);
    }

    .totals-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
      background: var(--color-background-subtle);
      border-radius: var(--radius-lg);
      max-width: 350px;
      margin-left: auto;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);

      &.grand-total {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        color: var(--color-text-primary);
        padding-top: var(--spacing-2);
        margin-top: var(--spacing-2);
        border-top: 2px solid var(--color-border-subtle);
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
      .p-inputmask,
      .p-select {
        width: 100%;
      }

      .product-dropdown .p-select-label {
        padding: var(--spacing-2) var(--spacing-3);
      }

      .p-datepicker {
        display: flex;
        width: 100%;

        .p-inputtext {
          flex: 1;
          min-width: 0;
        }
      }
    }
  `]
})
export class PurchaseOrderCreateComponent implements OnInit {
  private router = inject(Router);
  private poService = inject(PurchaseOrderService);
  private supplierService = inject(SupplierService);
  private productService = inject(ProductService);
  private toastService = inject(ToastService);
  private warehouseContext = inject(WarehouseContextService);
  private readonly barcodeLookup = inject(BarcodeLookupService);
  private readonly barcodeFeedback = inject(BarcodeFeedbackService);
  readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;

  suppliers = signal<SupplierListItem[]>([]);
  products = signal<ProductListItem[]>([]);
  submitting = signal(false);

  selectedSupplier: SupplierListItem | null = null;
  orderDate = new Date();
  expectedDeliveryDate: Date | null = null;
  reference = '';
  notes = '';
  selectedWarehouseId: string | null = null;
  lines: OrderLine[] = [];

  subTotalHT = 0;
  totalVat = 0;
  totalTTC = 0;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Bons de commande', route: '/purchase-orders' },
    { label: 'Nouveau' }
  ];

  ngOnInit(): void {
    const ctxWh = this.warehouseContext.selectedWarehouseId();
    if (ctxWh && this.selectedWarehouseId == null) {
      this.selectedWarehouseId = ctxWh;
    }
    this.loadSuppliers();
    this.loadProducts();
  }

  private loadSuppliers(): void {
    this.supplierService.getActiveSuppliers().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.suppliers.set(response.data.items);
        }
      }
    });
  }

  private loadProducts(): void {
    this.productService.getProducts({ isActive: true, pageSize: 500 }).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.products.set(response.data.items);
        }
      }
    });
  }

  addLine(): void {
    this.lines.push({
      product: null,
      quantity: 1,
      unitPriceHT: 0,
      vatRate: 19,
      subTotal: 0,
      vatAmount: 0,
      total: 0
    });
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
    this.recalculateTotals();
  }

  onProductChange(index: number): void {
    const line = this.lines[index];
    if (line.product) {
      line.unitPriceHT = line.product.purchasePrice ?? line.product.unitPrice;
      line.vatRate = line.product.vatRate;
      this.recalculateLine(index);
    }
  }

  recalculateLine(index: number): void {
    const line = this.lines[index];
    line.subTotal = line.quantity * line.unitPriceHT;
    line.vatAmount = line.subTotal * (line.vatRate / 100);
    line.total = line.subTotal + line.vatAmount;
    this.recalculateTotals();
  }

  private recalculateTotals(): void {
    this.subTotalHT = this.lines.reduce((sum, l) => sum + l.subTotal, 0);
    this.totalVat = this.lines.reduce((sum, l) => sum + l.vatAmount, 0);
    this.totalTTC = this.subTotalHT + this.totalVat;
  }

  isFormValid(): boolean {
    return !!this.selectedSupplier &&
      !!this.orderDate &&
      this.lines.length > 0 &&
      this.lines.every(l => l.product !== null && l.quantity > 0) &&
      !this.submitting();
  }

  submitOrder(): void {
    if (!this.isFormValid() || !this.selectedSupplier) return;

    this.submitting.set(true);

    const request: CreatePurchaseOrderRequest = {
      supplierId: this.selectedSupplier.id,
      orderDate: this.formatDate(this.orderDate),
      expectedDeliveryDate: this.expectedDeliveryDate ? this.formatDate(this.expectedDeliveryDate) : undefined,
      reference: this.reference || undefined,
      notes: this.notes || undefined,
      warehouseId: this.selectedWarehouseId || undefined,
      lines: this.lines.map(l => ({
        productId: l.product!.id,
        quantity: l.quantity,
        unitPriceHT: l.unitPriceHT !== (l.product!.purchasePrice ?? l.product!.unitPrice) ? l.unitPriceHT : undefined
      } as CreatePurchaseOrderLineRequest))
    };

    this.poService.createPurchaseOrder(request).subscribe({
      next: (response) => {
        if (response.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@purchase-order-create.component.summary.Succès:Succès`,
            detail: $localize`:@@purchase-order-create.component.detail.Bon_de_commande_:Bon de commande créé avec succès`
          });
          this.router.navigate(['/purchase-orders', response.data]);
        }
        this.submitting.set(false);
      },
      error: (err) => {
        this.submitting.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-order-create.component.summary.Erreur:Erreur`,
          detail: err?.error?.errors?.[0] || 'Erreur lors de la création'
        });
      }
    });
  }

  private formatDate(date: Date): string {
    return formatLocalDate(date);
  }

  /**
   * Scan d'un code-barres sur une commande fournisseur.
   *
   * Les services sont acceptés : une commande fournisseur peut légitimement porter sur une
   * prestation. Seuls un modèle de variantes et un article désactivé sont refusés, par le
   * socle de résolution.
   */
  onBarcodeScanned(code: string): void {
    this.barcodeLookup.resolve(code).subscribe(result => {
      if (result.status !== 'found' || !result.product) {
        this.barcodeFeedback.report(result);
        return;
      }

      const product = result.product;
      const index = this.lines.findIndex(l => l.product?.id === product.id);

      if (index >= 0) {
        this.lines[index].quantity = (this.lines[index].quantity || 0) + 1;
        this.recalculateLine(index);
      } else {
        let target = this.lines.findIndex(l => !l.product);
        if (target < 0) {
          this.addLine();
          target = this.lines.length - 1;
        }
        this.lines[target].product = product;
        this.lines[target].quantity = 1;
        this.onProductChange(target);
      }

      this.barcodeFeedback.success(product.name);
    });
  }
}
