import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { InputNumberModule } from 'primeng/inputnumber';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { WarehouseSelectorComponent } from '@shared/components/warehouse-selector/warehouse-selector.component';
import {
  PurchaseOrderService,
  PurchaseOrderDetail,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  mapPurchaseOrderDetailFromApi
} from '@core/services/purchase-order.service';

interface ReceptionLine {
  lineId: string;
  productName: string;
  productCode: string;
  quantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
  toReceive: number;
  isFullyReceived: boolean;
}

@Component({
  selector: 'app-purchase-order-receive',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule,
    TableModule, InputNumberModule, ProgressBarModule, TagModule, ToastModule,
    PageHeaderComponent, BreadcrumbComponent, ButtonComponent, WarehouseSelectorComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p i18n="@@purchase-orders.purchase-order-receive.chargement.a209b664">Chargement...</p>
      </div>
    } @else if (po()) {
      <app-page-header
        [title]="'Réception — ' + po()!.number"
        [subtitle]="'Fournisseur : ' + po()!.supplier.name">
      </app-page-header>

      <!-- Order Summary -->
      <div class="summary-card">
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label" i18n="@@purchase-orders.purchase-order-receive.statut.659499f3">Statut</span>
            <p-tag [value]="po()!.statusDisplay"
              [severity]="getStatusSeverity(po()!.status)"></p-tag>
          </div>
          <div class="summary-item">
            <span class="summary-label" i18n="@@purchase-orders.purchase-order-receive.date.commande.d50824e9">Date commande</span>
            <span class="summary-value">{{ po()!.orderDate | date:'dd/MM/yyyy' }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label" i18n="@@purchase-orders.purchase-order-receive.progression.globale.0e5c3dbd">Progression globale</span>
            <div class="progress-container">
              <p-progressBar
                [value]="globalProgress()"
                [showValue]="true"
                [style]="{'height': '24px'}">
              </p-progressBar>
            </div>
          </div>
        </div>

        <div class="warehouse-row">
          <app-warehouse-selector
            inputId="po-receive-warehouse"
            label="Entrepôt de réception"
            [required]="true"
            [value]="receiveWarehouseId()"
            (valueChange)="onReceiveWarehouseChange($event)">
          </app-warehouse-selector>
          @if (!receiveWarehouseId()) {
            <p class="warehouse-hint" role="status" i18n="@@purchase-orders.purchase-order-receive.selectionnez.l.entrepot.dans.lequel.le.stock.ser.97ae182d">Sélectionnez l'entrepôt dans lequel le stock sera mis à jour.</p>
          }
        </div>
      </div>

      <!-- Reception Lines -->
      <div class="reception-card">
        <h3 class="card-title"><i class="pi pi-box"></i> Lignes à réceptionner</h3>

        <div class="reception-table">
          <table>
            <thead>
              <tr>
                <th i18n="@@purchase-orders.purchase-order-receive.produit.ff673dc2">Produit</th>
                <th style="width: 110px" class="text-center" i18n="@@purchase-orders.purchase-order-receive.qte.commandee.8c1ee02c">Qté commandée</th>
                <th style="width: 110px" class="text-center" i18n="@@purchase-orders.purchase-order-receive.deja.recue.03bcf3f9">Déjà reçue</th>
                <th style="width: 110px" class="text-center" i18n="@@purchase-orders.purchase-order-receive.restante.b9dbe01c">Restante</th>
                <th style="width: 150px" class="text-center" i18n="@@purchase-orders.purchase-order-receive.qte.a.receptionner.ac2fffa0">Qté à réceptionner</th>
                <th style="width: 100px" class="text-center" i18n="@@purchase-orders.purchase-order-receive.statut.659499f3">Statut</th>
              </tr>
            </thead>
            <tbody>
              @for (line of receptionLines; track line.lineId) {
                <tr [class.fully-received]="line.isFullyReceived">
                  <td>
                    <div class="product-info">
                      <span class="product-name">{{ line.productName }}</span>
                      <span class="product-code">{{ line.productCode }}</span>
                    </div>
                  </td>
                  <td class="text-center">{{ line.quantity }}</td>
                  <td class="text-center">
                    <span [class.partially]="line.receivedQuantity > 0 && !line.isFullyReceived"
                          [class.fully]="line.isFullyReceived">
                      {{ line.receivedQuantity }}
                    </span>
                  </td>
                  <td class="text-center">
                    <span [class.pending]="line.pendingQuantity > 0">
                      {{ line.pendingQuantity }}
                    </span>
                  </td>
                  <td class="text-center">
                    @if (!line.isFullyReceived) {
                      <p-inputNumber
                        [(ngModel)]="line.toReceive"
                        [min]="0"
                        [max]="line.pendingQuantity"
                        [minFractionDigits]="0"
                        [maxFractionDigits]="3"
                        styleClass="reception-input"
                        inputStyleClass="text-center">
                      </p-inputNumber>
                    } @else {
                      <span class="fully-badge"><i class="pi pi-check-circle"></i> Complète</span>
                    }
                  </td>
                  <td class="text-center">
                    @if (line.isFullyReceived) {
                      <p-tag value="Reçu" severity="success"></p-tag>
                    } @else if (line.receivedQuantity > 0) {
                      <p-tag value="Partiel" severity="warn"></p-tag>
                    } @else {
                      <p-tag value="En attente" severity="secondary"></p-tag>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <app-button variant="outline" [routerLink]="['/purchase-orders', po()!.id]" i18n="@@purchase-orders.purchase-order-receive.retour.au.detail.1ee22560">Retour au détail</app-button>
          <app-button
            variant="primary"
            icon="pi-check"
            iconPos="left"
            [disabled]="!hasLinesToReceive() || submitting() || !receiveWarehouseId()"
            (click)="submitReception()">
            {{ submitting() ? 'Validation...' : 'Valider la réception' }}
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

    .summary-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      box-shadow: var(--shadow-md);
      border: 1px solid var(--color-border-subtle);
      margin-bottom: var(--spacing-4);
    }

    .summary-grid {
      display: grid;
      grid-template-columns: auto auto 1fr;
      gap: var(--spacing-6);
      align-items: center;
    }

    .summary-item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .summary-label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .summary-value {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .progress-container {
      min-width: 200px;
    }

    .warehouse-row {
      margin-top: var(--spacing-4);
      padding-top: var(--spacing-4);
      border-top: 1px solid var(--color-border-subtle);
      max-width: 420px;
    }

    .warehouse-hint {
      margin: var(--spacing-2) 0 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .reception-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      box-shadow: var(--shadow-md);
      border: 1px solid var(--color-border-subtle);
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
    }

    .reception-table {
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

    .fully-received {
      background: var(--color-success-50, #f0fdf4);
    }

    .product-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .product-name {
      font-weight: var(--font-weight-medium);
    }

    .product-code {
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
      font-family: 'JetBrains Mono', monospace;
    }

    .partially { color: var(--color-warning-600, #d97706); font-weight: var(--font-weight-semibold); }
    .fully { color: var(--color-success-600, #16a34a); font-weight: var(--font-weight-semibold); }
    .pending { color: var(--color-primary-600); font-weight: var(--font-weight-semibold); }

    .fully-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-success-600, #16a34a);
      font-weight: var(--font-weight-medium);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
      padding-top: var(--spacing-4);
      margin-top: var(--spacing-4);
      border-top: 1px solid var(--color-border-subtle);
    }

    :host ::ng-deep {
      .reception-input {
        width: 100px;

        .p-inputnumber-input {
          text-align: center;
          padding: var(--spacing-2);
        }
      }
    }
  `]
})
export class PurchaseOrderReceiveComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private poService = inject(PurchaseOrderService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private warehouseContext = inject(WarehouseContextService);

  loading = signal(true);
  submitting = signal(false);
  po = signal<PurchaseOrderDetail | null>(null);
  /** Warehouse where stock entries will be posted (explicit PATCH body). */
  receiveWarehouseId = signal<string | null>(null);

  receptionLines: ReceptionLine[] = [];

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Bons de commande', route: '/purchase-orders' },
    { label: 'Réception' }
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      // Réceptions désormais gérées via les bons de réception d'achat.
      this.router.navigate(['/purchase-receipts', 'new'], {
        queryParams: { purchaseOrderId: id },
        replaceUrl: true
      });
      return;
    }
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
              summary: 'Statut inconnu',
              detail: 'Le statut de cette commande est non reconnu. Veuillez actualiser ou contacter le support.'
            });
            console.warn('[PurchaseOrderReceive] Unknown purchase order status received from API', {
              orderId: response.data.id,
              rawStatus: response.data.status
            });
            this.router.navigate(['/purchase-orders', id]);
            return;
          }

          // Verify the order can receive goods
          if (order.status !== PurchaseOrderStatus.Confirmed &&
            order.status !== PurchaseOrderStatus.PartiallyReceived) {
            let message = 'Cette commande ne peut pas recevoir de marchandise';
            if (order.status === PurchaseOrderStatus.Draft) {
              message = 'Cette commande est en brouillon. Veuillez d\'abord la confirmer avant de pouvoir recevoir des marchandises.';
            } else if (order.status === PurchaseOrderStatus.Received) {
              message = 'Cette commande a déjà été entièrement reçue.';
            } else if (order.status === PurchaseOrderStatus.Cancelled) {
              message = 'Cette commande a été annulée.';
            }

            this.toastService.add({
              severity: 'warn',
              summary: 'Action impossible',
              detail: message
            });
            this.router.navigate(['/purchase-orders', id]);
            return;
          }

          const ctxId = this.warehouseContext.selectedWarehouseId();
          this.receiveWarehouseId.set(order.warehouseId ?? ctxId ?? null);
          this.po.set(order);
          this.receptionLines = order.lines.map((l: PurchaseOrderLine) => ({
            lineId: l.id,
            productName: l.productName,
            productCode: l.productCode,
            quantity: l.quantity,
            receivedQuantity: l.receivedQuantity,
            pendingQuantity: l.quantity - l.receivedQuantity,
            toReceive: 0,
            isFullyReceived: l.isFullyReceived
          }));

          this.breadcrumbItems = [
            { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
            { label: 'Bons de commande', route: '/purchase-orders' },
            { label: order.number, route: '/purchase-orders/' + order.id },
            { label: 'Réception' }
          ];
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.add({ severity: 'error', summary: 'Erreur', detail: 'Commande introuvable' });
        this.router.navigate(['/purchase-orders']);
      }
    });
  }

  getStatusSeverity(status: PurchaseOrderStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case PurchaseOrderStatus.Draft: return 'secondary';
      case PurchaseOrderStatus.Confirmed: return 'info';
      case PurchaseOrderStatus.PartiallyReceived: return 'warn';
      case PurchaseOrderStatus.Received: return 'success';
      case PurchaseOrderStatus.Cancelled: return 'danger';
      case PurchaseOrderStatus.Invoiced: return 'contrast';
      default: return 'secondary';
    }
  }

  globalProgress(): number {
    const order = this.po();
    if (!order || order.lines.length === 0) return 0;
    const totalQty = order.lines.reduce((sum: number, l: PurchaseOrderLine) => sum + l.quantity, 0);
    const receivedQty = order.lines.reduce((sum: number, l: PurchaseOrderLine) => sum + l.receivedQuantity, 0);
    return totalQty > 0 ? Math.round((receivedQty / totalQty) * 100) : 0;
  }

  hasLinesToReceive(): boolean {
    return this.receptionLines.some(l => l.toReceive > 0);
  }

  onReceiveWarehouseChange(warehouseId: string | null): void {
    this.receiveWarehouseId.set(warehouseId);
  }

  submitReception(): void {
    if (!this.hasLinesToReceive()) return;

    const order = this.po();
    if (!order) return;

    const warehouseId = this.receiveWarehouseId();
    if (!warehouseId) return;

    this.submitting.set(true);

    const linesToReceive = this.receptionLines
      .filter(l => l.toReceive > 0)
      .map(l => ({ lineId: l.lineId, receivedQuantity: l.toReceive }));

    this.poService.receiveGoods(order.id, { warehouseId, lines: linesToReceive }).subscribe({
      next: (response) => {
        if (response.success) {
          this.toastService.add({
            severity: 'success',
            summary: 'Succès',
            detail: 'Réception enregistrée avec succès. Le stock a été mis à jour.'
          });
          this.router.navigate(['/purchase-orders', order.id]);
        }
        this.submitting.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }
}
