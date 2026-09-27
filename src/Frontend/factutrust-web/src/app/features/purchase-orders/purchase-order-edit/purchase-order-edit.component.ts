/// <reference types="@angular/localize" />
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { formatLocalDate } from '@core/utils/date.util';
import {
    PurchaseOrderService,
    PurchaseOrderDetail,
    PurchaseOrderLine,
    PurchaseOrderStatus,
    UpdatePurchaseOrderRequest,
    UpdatePurchaseOrderLineRequest,
    mapPurchaseOrderDetailFromApi
} from '@core/services/purchase-order.service';
import { ProductService, ProductListItem } from '@core/services/product.service';

interface EditOrderLine {
    id: string | null;
    product: ProductListItem | null;
    productId: string;
    quantity: number;
    unitPriceHT: number;
    vatRate: number;
    subTotal: number;
    vatAmount: number;
    total: number;
}

@Component({
    selector: 'app-purchase-order-edit',
    standalone: true,
    imports: [
        CommonModule, RouterModule, FormsModule, CurrencyPipe,
        TableModule, SelectModule, InputTextModule, InputNumberModule,
        DatePickerModule, Textarea, ToastModule,
        PageHeaderComponent, BreadcrumbComponent, ButtonComponent
    ],
    template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p i18n="@@purchase-orders.purchase-order-edit.chargement.a209b664">Chargement...</p>
      </div>
    } @else if (po()) {
      <app-page-header
        [title]="loc_ui_tern_modifier_042082 + po()!.number"
        subtitle="Modifiez les informations et les lignes de cette commande brouillon.">
      </app-page-header>

      <div class="form-container">
        <!-- Section 1: Header -->
        <div class="form-card">
          <h3 class="card-title"><i class="pi pi-building"></i> En-tête de commande</h3>
          <div class="form-grid">
            <div class="form-group">
              <label i18n="@@purchase-orders.purchase-order-edit.fournisseur.97d91d89">Fournisseur</label>
              <span class="readonly-value">{{ po()!.supplier.name }}</span>
            </div>

            <div class="form-group">
              <label i18n="@@purchase-orders.purchase-order-edit.date.de.commande.f9b0df86">Date de commande</label>
              <span class="readonly-value">{{ po()!.orderDate | date:'dd/MM/yyyy' }}</span>
            </div>

            <div class="form-group">
              <label for="deliveryDate" i18n="@@purchase-orders.purchase-order-edit.date.de.livraison.prevue.3ea95a1d">Date de livraison prévue</label>
              <p-datepicker
                id="deliveryDate"
                [(ngModel)]="expectedDeliveryDate"
                dateFormat="dd/mm/yy"
                [showIcon]="true"
                styleClass="w-full">
              </p-datepicker>
            </div>

            <div class="form-group">
              <label for="reference" i18n="@@purchase-orders.purchase-order-edit.reference.fournisseur.5fbc4823">Référence fournisseur</label>
              <input
                pInputText
                id="reference"
                [(ngModel)]="reference"
                placeholder="Ex: DEV-2024-001" i18n-placeholder="Ex: DEV-2024-001"
                class="w-full">
            </div>
          </div>
        </div>

        <!-- Section 2: Lines -->
        <div class="form-card">
          <div class="card-header">
            <h3 class="card-title"><i class="pi pi-list"></i> Lignes de commande</h3>
            <app-button variant="secondary" icon="pi-plus" iconPos="left" size="sm"
              (click)="addLine()" i18n="@@purchase-orders.purchase-order-edit.ajouter.une.ligne.ba241fd4"> Ajouter une ligne </app-button>
          </div>

          @if (lines.length === 0) {
            <div class="empty-lines">
              <i class="pi pi-inbox"></i>
              <p i18n="@@purchase-orders.purchase-order-edit.aucune.ligne.cliquez.sur.ajouter.une.ligne.pour..bbab98ba">Aucune ligne. Cliquez sur "Ajouter une ligne" pour commencer.</p>
            </div>
          } @else {
            <div class="lines-table">
              <table>
                <thead>
                  <tr>
                    <th style="width: 40px" i18n="@@purchase-orders.purchase-order-edit.text.d08f88df">#</th>
                    <th i18n="@@purchase-orders.purchase-order-edit.produit.12b1aa43">Produit *</th>
                    <th style="width: 120px" i18n="@@purchase-orders.purchase-order-edit.quantite.d8a4d5eb">Quantité *</th>
                    <th style="width: 140px" i18n="@@purchase-orders.purchase-order-edit.prix.unitaire.ht.bb3f8e39">Prix unitaire HT</th>
                    <th style="width: 80px" i18n="@@purchase-orders.purchase-order-edit.tva.fb62cb5d">TVA</th>
                    <th style="width: 140px" i18n="@@purchase-orders.purchase-order-edit.total.ttc.9e80ff7c">Total TTC</th>
                    <th style="width: 50px"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of lines; track $index) {
                    <tr>
                      <td class="text-center line-number">{{ $index + 1 }}</td>
                      <td>
                        @if (line.id) {
                          <!-- Existing line: show product name, not editable -->
                          <span class="existing-product">{{ line.product?.name || 'Produit inconnu' }}</span>
                        } @else {
                          <!-- New line: product dropdown -->
                          <p-select
                            [options]="products()"
                            [(ngModel)]="line.product"
                            optionLabel="name"
                            placeholder="Sélectionnez un produit" i18n-placeholder="Sélectionnez un produit"
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
                        }
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
                          aria-label="Supprimer la ligne" i18n-aria-label="Supprimer la ligne">
                          <i class="pi pi-trash"></i>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>

        <!-- Section 3: Summary -->
        <div class="form-card">
          <h3 class="card-title"><i class="pi pi-calculator"></i> Récapitulatif</h3>

          <div class="summary-layout">
            <div class="notes-section">
              <label for="notes" i18n="@@purchase-orders.purchase-order-edit.notes.70440046">Notes</label>
              <textarea
                pTextarea
                id="notes"
                [(ngModel)]="notes"
                placeholder="Notes internes pour cette commande..." i18n-placeholder="Notes internes pour cette commande..."
                [rows]="4"
                class="w-full">
              </textarea>
            </div>

            <div class="totals-section">
              <div class="total-row">
                <span i18n="@@purchase-orders.purchase-order-edit.sous.total.ht.724598f6">Sous-total HT</span>
                <span class="amount">{{ subTotalHT | currency:'TND':'symbol':'1.3-3' }}</span>
              </div>
              <div class="total-row">
                <span i18n="@@purchase-orders.purchase-order-edit.tva.fb62cb5d">TVA</span>
                <span class="amount">{{ totalVat | currency:'TND':'symbol':'1.3-3' }}</span>
              </div>
              <div class="total-row grand-total">
                <span i18n="@@purchase-orders.purchase-order-edit.total.ttc.9e80ff7c">Total TTC</span>
                <span class="amount">{{ totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <app-button variant="outline" [routerLink]="['/purchase-orders', po()!.id]" i18n="@@purchase-orders.purchase-order-edit.annuler.49ba3292"> Annuler </app-button>
          <app-button
            variant="primary"
            icon="pi-check"
            iconPos="left"
            [disabled]="!isFormValid()"
            (click)="submitUpdate()">
            {{ submitting() ? loc_ui_tern_enregistrement_9bf105 : loc_ui_tern_enregistrer_les_modifications_2a9459 }}
          </app-button>
        </div>
      </div>
    }
  `,
    styles: [`
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      color: var(--color-text-secondary);
      gap: var(--spacing-3);
    }

    .form-container {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      max-width: 1100px;
    }

    .form-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      box-shadow: var(--shadow-md);
      border: 1px solid var(--color-border-subtle);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-4);
    }

    .card-title {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-4) 0;
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      i { color: var(--color-primary-600); }

      .card-header & { margin-bottom: 0; }
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);

      label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
      }
    }

    .readonly-value {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      padding: var(--spacing-2) 0;
    }

    .existing-product {
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
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

    .summary-layout {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: var(--spacing-6);
      align-items: start;
    }

    .notes-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);

      label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
      }
    }

    .totals-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
      background: var(--color-background-subtle);
      border-radius: var(--radius-lg);
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
      gap: var(--spacing-3);
      padding-top: var(--spacing-2);
    }

    :host ::ng-deep {
      .product-dropdown .p-select-label {
        padding: var(--spacing-2) var(--spacing-3);
      }

      // Calendar input fix - ensure input is visible alongside icon
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
export class PurchaseOrderEditComponent implements OnInit {
  readonly loc_ui_tern_modifier_042082 = $localize`:@@ui.tern.modifier.042082:Modifier — `;
  readonly loc_ui_tern_enregistrement_9bf105 = $localize`:@@ui.tern.enregistrement.9bf105:Enregistrement...`;
  readonly loc_ui_tern_enregistrer_les_modifications_2a9459 = $localize`:@@ui.tern.enregistrer.les.modifications.2a9459:Enregistrer les modifications`;
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private poService = inject(PurchaseOrderService);
    private productService = inject(ProductService);
    private toastService = inject(ToastService);

    loading = signal(true);
    submitting = signal(false);
    products = signal<ProductListItem[]>([]);
    po = signal<PurchaseOrderDetail | null>(null);

    expectedDeliveryDate: Date | null = null;
    reference = '';
    notes = '';
    lines: EditOrderLine[] = [];

    subTotalHT = 0;
    totalVat = 0;
    totalTTC = 0;

    breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
        { label: 'Bons de commande', route: '/purchase-orders' },
        { label: 'Modifier' }
    ];

    ngOnInit(): void {
        this.loadProducts();
        const id = this.route.snapshot.paramMap.get('id');
        if (id) this.loadOrder(id);
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

    private loadOrder(id: string): void {
        this.poService.getPurchaseOrder(id).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    const order = mapPurchaseOrderDetailFromApi(response.data);
                    if (!order) {
                        this.loading.set(false);
                        this.toastService.add({
                            severity: 'warn',
                            summary: $localize`:@@purchase-order-edit.component.summary.Statut_inconnu:Statut inconnu`,
                            detail: $localize`:@@purchase-order-edit.component.detail.Le_statut_de_cet:Le statut de cette commande est non reconnu. Veuillez actualiser ou contacter le support.`
                        });
                        console.warn('[PurchaseOrderEdit] Unknown purchase order status received from API', {
                            orderId: response.data.id,
                            rawStatus: response.data.status
                        });
                        this.router.navigate(['/purchase-orders', id]);
                        return;
                    }

                    // Only draft orders can be edited
                    if (order.status !== PurchaseOrderStatus.Draft) {
                        this.toastService.add({
                            severity: 'warn',
                            summary: $localize`:@@purchase-order-edit.component.summary.Action_impossibl:Action impossible`,
                            detail: $localize`:@@purchase-order-edit.component.detail.Seuls_les_brouil:Seuls les brouillons peuvent être modifiés.`
                        });
                        this.router.navigate(['/purchase-orders', id]);
                        return;
                    }

                    this.po.set(order);
                    this.reference = order.reference || '';
                    this.notes = order.notes || '';
                    this.expectedDeliveryDate = order.expectedDeliveryDate
                        ? new Date(order.expectedDeliveryDate)
                        : null;

                    // Map existing lines
                    this.lines = order.lines.map((l: PurchaseOrderLine) => {
                        const matchingProduct = this.products().find(p => p.id === l.productId);
                        return {
                            id: l.id,
                            product: matchingProduct || { id: l.productId, name: l.productName, code: l.productCode } as ProductListItem,
                            productId: l.productId,
                            quantity: l.quantity,
                            unitPriceHT: l.unitPriceHT,
                            vatRate: parseFloat(l.vatRateDisplay) || 19,
                            subTotal: l.subTotal,
                            vatAmount: l.vatAmount,
                            total: l.total
                        };
                    });

                    this.recalculateTotals();

                    this.breadcrumbItems = [
                        { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
                        { label: 'Bons de commande', route: '/purchase-orders' },
                        { label: order.number, route: '/purchase-orders/' + order.id },
                        { label: 'Modifier' }
                    ];
                }
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.toastService.add({ severity: 'error', summary: $localize`:@@purchase-order-edit.component.summary.Erreur:Erreur`, detail: $localize`:@@purchase-order-edit.component.detail.Commande_introuv:Commande introuvable` });
                this.router.navigate(['/purchase-orders']);
            }
        });
    }

    addLine(): void {
        this.lines.push({
            id: null,
            product: null,
            productId: '',
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
            line.productId = line.product.id;
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
        return this.lines.length > 0 &&
            this.lines.every(l => (l.id || l.product !== null) && l.quantity > 0) &&
            !this.submitting();
    }

    submitUpdate(): void {
        const order = this.po();
        if (!this.isFormValid() || !order) return;

        this.submitting.set(true);

        const request: UpdatePurchaseOrderRequest = {
            expectedDeliveryDate: this.expectedDeliveryDate ? this.formatDate(this.expectedDeliveryDate) : undefined,
            reference: this.reference || undefined,
            notes: this.notes || undefined,
            lines: this.lines.map(l => ({
                id: l.id || undefined,
                productId: l.id ? l.productId : l.product!.id,
                quantity: l.quantity,
                unitPriceHT: l.unitPriceHT
            } as UpdatePurchaseOrderLineRequest))
        };

        this.poService.updatePurchaseOrder(order.id, request).subscribe({
            next: (response) => {
                if (response.success) {
                    this.toastService.add({
                        severity: 'success',
                        summary: $localize`:@@purchase-order-edit.component.summary.Succès:Succès`,
                        detail: $localize`:@@purchase-order-edit.component.detail.Bon_de_commande_:Bon de commande mis à jour avec succès`
                    });
                    this.router.navigate(['/purchase-orders', order.id]);
                }
                this.submitting.set(false);
            },
            error: (err) => {
                this.submitting.set(false);
                this.toastService.add({
                    severity: 'error',
                    summary: $localize`:@@purchase-order-edit.component.summary.Erreur:Erreur`,
                    detail: err?.error?.errors?.[0] || 'Erreur lors de la mise à jour'
                });
            }
        });
    }

    private formatDate(date: Date): string {
        return formatLocalDate(date);
    }
}
