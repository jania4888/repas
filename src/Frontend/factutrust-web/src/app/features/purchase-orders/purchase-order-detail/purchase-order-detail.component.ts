import { Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { Textarea } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CreateSupplierInvoiceModalComponent } from '../components/create-supplier-invoice-modal/create-supplier-invoice-modal.component';
import {
  PurchaseOrderService,
  PurchaseOrderDetail,
  PurchaseOrderStatus,
  mapPurchaseOrderDetailFromApi
} from '@core/services/purchase-order.service';
import {
  PurchaseReceiptService,
  PurchaseReceiptListItem
} from '@core/services/purchase-receipt.service';

@Component({
  selector: 'app-purchase-order-detail',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule, CurrencyPipe, DatePipe,
    TagModule, TableModule, ToastModule, DialogModule, Textarea, TooltipModule,
    PageHeaderComponent, BreadcrumbComponent, ButtonComponent, CreateSupplierInvoiceModalComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p>Chargement...</p>
      </div>
    } @else if (po()) {


      <app-page-header
        [title]="'Commande ' + po()!.number"
        [subtitle]="po()!.supplier.name">
        <div class="header-actions">
          <app-button variant="outline" icon="pi-file-pdf" iconPos="left"
            (click)="downloadPdf()">
            Télécharger PDF
          </app-button>
          

          <!-- Conditional buttons with robust comparison -->
          <ng-container *ngIf="po() && po()!.status != null && po()!.status != undefined">
            <ng-container *ngIf="po()!.status != PurchaseOrderStatus.Draft && po()!.status != PurchaseOrderStatus.Cancelled">
              <app-button variant="outline" icon="pi-envelope" iconPos="left"
                [disabled]="sending() || !po()!.supplier.email"
                pTooltip="Le fournisseur n'a pas d'adresse email."
                [tooltipDisabled]="!!po()!.supplier.email"
                tooltipPosition="bottom"
                (click)="sendByEmail()">
                {{ sending() ? 'Envoi...' : 'Envoyer par email' }}
              </app-button>
            </ng-container>
            
            <ng-container *ngIf="isDraft()">
              <app-button variant="outline" icon="pi-pencil" iconPos="left"
                [routerLink]="['/purchase-orders', po()!.id, 'edit']">
                Modifier
              </app-button>
              <app-button variant="primary" icon="pi-check" iconPos="left"
                (click)="confirmOrder()"
                [disabled]="confirming()"
                pTooltip="Confirmer la commande pour pouvoir recevoir les marchandises et créer des factures"
                tooltipPosition="bottom">
                {{ confirming() ? 'Confirmation...' : 'Confirmer' }}
              </app-button>
              <app-button variant="outline" icon="pi-times" iconPos="left"
                (click)="cancelOrder()">
                Annuler
              </app-button>
              <app-button variant="danger" icon="pi-trash" iconPos="left"
                (click)="deleteOrder()">
                Supprimer
              </app-button>
            </ng-container>
            
            <ng-container *ngIf="canReceiveGoods()">
              <app-button variant="primary" icon="pi-box" iconPos="left"
                [routerLink]="['/purchase-receipts', 'new']"
                [queryParams]="{ purchaseOrderId: po()!.id }">
                Réception marchandise
              </app-button>
            </ng-container>
            
            <ng-container *ngIf="canCreateSupplierInvoice()">
              <app-button variant="primary" icon="pi-money-bill" iconPos="left"
                (click)="openCreateSupplierInvoice()">
                Créer facture fournisseur
              </app-button>
            </ng-container>
          </ng-container>
        </div>
      </app-page-header>

      <!-- Workflow Guidance -->
      <ng-container *ngIf="isDraft()">
        <div class="workflow-guidance draft-guidance">
          <div class="guidance-content">
            <i class="pi pi-info-circle guidance-icon"></i>
            <div class="guidance-text">
              <h4>Commande en brouillon</h4>
              <p>Cette commande doit être confirmée avant de pouvoir recevoir les marchandises ou créer une facture fournisseur.</p>
              <div class="next-steps">
                <span class="step-label">Prochaine étape :</span>
                <span class="step-action">Confirmer la commande</span>
              </div>
            </div>
          </div>
        </div>
      </ng-container>

      <ng-container *ngIf="isConfirmed()">
        <div class="workflow-guidance confirmed-guidance">
          <div class="guidance-content">
            <i class="pi pi-check-circle guidance-icon"></i>
            <div class="guidance-text">
              <h4>Commande confirmée</h4>
              <p>La commande est prête pour la réception des marchandises. Vous pouvez maintenant enregistrer les livraisons.</p>
              <div class="next-steps">
                <span class="step-label">Prochaine étape :</span>
                <span class="step-action">Réceptionner les marchandises</span>
              </div>
            </div>
          </div>
        </div>
      </ng-container>

      <ng-container *ngIf="isPartiallyReceived()">
        <div class="workflow-guidance partial-guidance">
          <div class="guidance-content">
            <i class="pi pi-exclamation-triangle guidance-icon"></i>
            <div class="guidance-text">
              <h4>Réception partielle</h4>
              <p>Certaines marchandises ont été reçues. Vous pouvez continuer la réception ou créer une facture pour les articles déjà livrés.</p>
              <div class="next-steps">
                <span class="step-label">Actions disponibles :</span>
                <span class="step-action">Réceptionner / Créer facture</span>
              </div>
            </div>
          </div>
        </div>
      </ng-container>

      <div class="detail-grid">
        <!-- Order Info -->
        <div class="detail-card">
          <h3 class="card-title"><i class="pi pi-file"></i> Informations commande</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label">Numéro</span>
              <span class="value mono">{{ po()!.number }}</span>
            </div>
            <div class="info-item">
              <span class="label">Date</span>
              <span class="value">{{ po()!.orderDate | date:'dd/MM/yyyy' }}</span>
            </div>
            <div class="info-item">
              <span class="label">Statut</span>
              <p-tag [value]="po()!.statusDisplay"
                [severity]="getStatusSeverity(po()!.status)"></p-tag>
            </div>
            <div class="info-item">
              <span class="label">Livraison prévue</span>
              <span class="value">{{ po()!.expectedDeliveryDate ? (po()!.expectedDeliveryDate | date:'dd/MM/yyyy') : '-' }}</span>
            </div>
            @if (po()!.reference) {
              <div class="info-item">
                <span class="label">Référence</span>
                <span class="value">{{ po()!.reference }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Supplier Info -->
        <div class="detail-card">
          <h3 class="card-title"><i class="pi pi-building"></i> Fournisseur</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label">Nom</span>
              <a [routerLink]="['/suppliers', po()!.supplier.id]" class="value link">{{ po()!.supplier.name }}</a>
            </div>
            @if (po()!.supplier.email) {
              <div class="info-item">
                <span class="label">Email</span>
                <a [href]="'mailto:' + po()!.supplier.email" class="value link">{{ po()!.supplier.email }}</a>
              </div>
            }
            @if (po()!.supplier.nif) {
              <div class="info-item">
                <span class="label">NIF</span>
                <span class="value mono">{{ po()!.supplier.nif }}</span>
              </div>
            }
            <div class="info-item full-width">
              <span class="label">Adresse</span>
              <span class="value">{{ po()!.supplier.address }}</span>
            </div>
          </div>
        </div>

        <!-- Lines -->
        <div class="detail-card full-width">
          <h3 class="card-title"><i class="pi pi-list"></i> Lignes de commande</h3>
          <p-table [value]="po()!.lines" styleClass="p-datatable-sm" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 50px">#</th>
                <th>Produit</th>
                <th style="width: 100px">Qté commandée</th>
                <th style="width: 100px">Qté reçue</th>
                <th style="width: 120px">Prix unitaire HT</th>
                <th style="width: 80px">TVA</th>
                <th style="width: 130px">Total TTC</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-line>
              <tr [class.received]="line.isFullyReceived">
                <td class="text-center">{{ line.lineNumber }}</td>
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
                <td class="text-right">{{ line.unitPriceHT | currency:'TND':'symbol':'1.3-3' }}</td>
                <td class="text-center">{{ line.vatRateDisplay }}</td>
                <td class="text-right amount">{{ line.total | currency:'TND':'symbol':'1.3-3' }}</td>
              </tr>
            </ng-template>
          </p-table>

          <!-- Totals -->
          <div class="totals-section">
            <div class="total-row">
              <span>Sous-total HT</span>
              <span class="amount">{{ po()!.subTotal | currency:'TND':'symbol':'1.3-3' }}</span>
            </div>
            <div class="total-row">
              <span>TVA</span>
              <span class="amount">{{ po()!.totalVat | currency:'TND':'symbol':'1.3-3' }}</span>
            </div>
            <div class="total-row grand-total">
              <span>Total TTC</span>
              <span class="amount">{{ po()!.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
            </div>
          </div>
        </div>

        @if (po()!.notes) {
          <div class="detail-card full-width">
            <h3 class="card-title"><i class="pi pi-file-edit"></i> Notes</h3>
            <p class="notes-text">{{ po()!.notes }}</p>
          </div>
        }

        @if (linkedReceipts().length > 0) {
          <div class="detail-card full-width">
            <h3 class="card-title"><i class="pi pi-box"></i> Bons de réception liés</h3>
            <ul class="linked-receipts">
              @for (br of linkedReceipts(); track br.id) {
                <li>
                  <a [routerLink]="['/purchase-receipts', br.id]" class="value link">{{ br.number }}</a>
                  <span class="date">{{ br.receiptDate | date:'dd/MM/yyyy' }}</span>
                  <p-tag [value]="br.statusDisplay" [severity]="br.status === 1 ? 'success' : br.status === 2 ? 'danger' : 'secondary'"></p-tag>
                  <span class="amount">{{ br.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
                </li>
              }
            </ul>
          </div>
        }

        @if (po()!.linkedSupplierInvoices && po()!.linkedSupplierInvoices!.length > 0) {
          <div class="detail-card full-width">
            <h3 class="card-title"><i class="pi pi-money-bill"></i> Factures fournisseur liées</h3>
            <ul class="linked-receipts">
              @for (inv of po()!.linkedSupplierInvoices!; track inv.id) {
                <li>
                  <a [routerLink]="['/supplier-invoices', inv.id]" class="value link">{{ inv.invoiceNumber }}</a>
                  <span class="date">{{ inv.invoiceDate | date:'dd/MM/yyyy' }}</span>
                  <p-tag [value]="inv.statusDisplay" severity="info"></p-tag>
                  <span class="amount">{{ inv.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
                </li>
              }
            </ul>
          </div>
        }

        @if (po()!.cancellationReason) {
          <div class="detail-card full-width cancelled-card">
            <h3 class="card-title"><i class="pi pi-exclamation-triangle"></i> Motif d'annulation</h3>
            <p class="notes-text">{{ po()!.cancellationReason }}</p>
            <p class="cancelled-date">Annulée le {{ po()!.cancelledAt | date:'dd/MM/yyyy HH:mm' }}</p>
          </div>
        }
      </div>
    }

    <!-- Cancel order dialog -->
    <p-dialog
      header="Annuler la commande"
      [(visible)]="cancelDialogVisible"
      [modal]="true"
      [style]="{ width: '450px' }"
      [draggable]="false"
      [resizable]="false"
      (onHide)="closeCancelDialog()">
      <p class="dialog-message">Êtes-vous sûr de vouloir annuler cette commande ? Indiquez le motif d'annulation (obligatoire).</p>
      <textarea
        pTextarea
        [(ngModel)]="cancellationReason"
        placeholder="Motif d'annulation..."
        [rows]="4"
        class="w-full cancellation-reason-input">
      </textarea>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="closeCancelDialog()">Retour</app-button>
        <app-button
          variant="danger"
          icon="pi-times"
          iconPos="left"
          [disabled]="!cancellationReason.trim()"
          (click)="submitCancelOrder()">
          Annuler la commande
        </app-button>
      </ng-template>
    </p-dialog>

    <!-- Create Supplier Invoice Modal -->
    <app-create-supplier-invoice-modal #createSupplierInvoiceModal></app-create-supplier-invoice-modal>
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

    .header-actions {
      display: flex;
      gap: var(--spacing-2);
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);
    }

    .detail-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      box-shadow: var(--shadow-md);
      border:1px solid var(--color-border-subtle);

      &.full-width { grid-column: 1 / -1; }
      &.cancelled-card {
        border-color: var(--color-danger-300);
        background: var(--color-danger-50, #fef2f2);
      }
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

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      &.full-width { grid-column: 1 / -1; }

      .label {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .value {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        &.mono { font-family: 'JetBrains Mono', monospace; }
        &.link {
          color: var(--color-primary-600);
          text-decoration: none;
          &:hover { text-decoration: underline; }
        }
      }
    }

    .product-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      .product-name { font-weight: var(--font-weight-medium); }
      .product-code {
        font-size: var(--font-size-xs);
        color: var(--color-neutral-500);
        font-family: 'JetBrains Mono', monospace;
      }
    }

    .amount {
      font-family: 'JetBrains Mono', monospace;
      font-weight: var(--font-weight-semibold);
    }

    .partially { color: var(--color-warning-600, #d97706); font-weight: var(--font-weight-semibold); }
    .fully { color: var(--color-success-600, #16a34a); font-weight: var(--font-weight-semibold); }

    tr.received { background: var(--color-success-50, #f0fdf4); }

    .totals-section {
      margin-top: var(--spacing-4);
      padding-top: var(--spacing-4);
      border-top: 2px solid var(--color-border-subtle);
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--spacing-2);
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      width: 300px;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);

      &.grand-total {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        color: var(--color-text-primary);
        padding-top: var(--spacing-2);
        border-top: 1px solid var(--color-border-subtle);
      }
    }

    .notes-text {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: 1.6;
      margin: 0;
    }

    .cancelled-date {
      font-size: var(--font-size-xs);
      color: var(--color-danger-600);
      margin: var(--spacing-2) 0 0;
    }

    .linked-receipts {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);

      li {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        flex-wrap: wrap;
        font-size: var(--font-size-sm);
      }

      .date { color: var(--color-text-secondary); }
      .link {
        color: var(--color-primary-600);
        font-weight: var(--font-weight-semibold);
        text-decoration: none;
        font-family: 'JetBrains Mono', monospace;
        &:hover { text-decoration: underline; }
      }
    }

    .dialog-message {
      margin: 0 0 var(--spacing-4) 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .cancellation-reason-input {
      width: 100%;
      margin-bottom: var(--spacing-2);
    }

    .workflow-guidance {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      box-shadow: var(--shadow-md);
      border: 1px solid var(--color-border-subtle);
      margin-bottom: var(--spacing-4);

      &.draft-guidance {
        border-left: 4px solid var(--color-warning-500);
        background: var(--color-warning-50, #fef3c7);
      }

      &.confirmed-guidance {
        border-left: 4px solid var(--color-info-500);
        background: var(--color-info-50, #eff6ff);

        .guidance-icon {
          color: var(--color-info-600);
        }

        .guidance-text h4 {
          color: var(--color-info-800);
        }

        .guidance-text p {
          color: var(--color-info-700);
        }

        .next-steps .step-label {
          color: var(--color-info-600);
        }

        .next-steps .step-action {
          color: var(--color-info-800);
          background: var(--color-info-100);
        }
      }

      &.partial-guidance {
        border-left: 4px solid var(--color-warning-500);
        background: var(--color-warning-50, #fef3c7);

        .guidance-icon {
          color: var(--color-warning-600);
        }

        .guidance-text h4 {
          color: var(--color-warning-800);
        }

        .guidance-text p {
          color: var(--color-warning-700);
        }

        .next-steps .step-label {
          color: var(--color-warning-600);
        }

        .next-steps .step-action {
          color: var(--color-warning-800);
          background: var(--color-warning-100);
        }
      }

      .guidance-content {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-3);
      }

      .guidance-icon {
        font-size: 1.5rem;
        color: var(--color-warning-600);
        margin-top: 2px;
      }

      .guidance-text {
        flex: 1;

        h4 {
          margin: 0 0 var(--spacing-2) 0;
          font-size: var(--font-size-base);
          font-weight: var(--font-weight-semibold);
          color: var(--color-warning-800);
        }

        p {
          margin: 0 0 var(--spacing-3) 0;
          font-size: var(--font-size-sm);
          color: var(--color-warning-700);
          line-height: 1.5;
        }

        .next-steps {
          display: flex;
          align-items: center;
          gap: var(--spacing-2);

          .step-label {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-medium);
            color: var(--color-warning-600);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .step-action {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--color-warning-800);
            background: var(--color-warning-100);
            padding: var(--spacing-1) var(--spacing-3);
            border-radius: var(--radius-md);
          }
        }
      }
    }
  `]
})
export class PurchaseOrderDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly poService = inject(PurchaseOrderService);
  private readonly receiptService = inject(PurchaseReceiptService);
  private readonly toastService = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly auth = inject(AuthService);

  // Rendre l'énumération accessible dans le template
  readonly PurchaseOrderStatus = PurchaseOrderStatus;

  loading = signal(true);
  sending = signal(false);
  confirming = signal(false);
  po = signal<PurchaseOrderDetail | null>(null);
  linkedReceipts = signal<PurchaseReceiptListItem[]>([]);
  cancelDialogVisible = false;
  cancellationReason = '';

  @ViewChild('createSupplierInvoiceModal')
  createSupplierInvoiceModal?: CreateSupplierInvoiceModalComponent;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Bons de commande', route: '/purchase-orders' },
    { label: 'Détail' }
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadOrder(id);
  }

  private loadOrder(id: string): void {
    this.poService.getPurchaseOrder(id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const normalizedData = mapPurchaseOrderDetailFromApi(response.data);
          if (!normalizedData) {
            this.loading.set(false);
            this.toastService.add({
              severity: 'warn',
              summary: 'Statut inconnu',
              detail: 'Le statut de cette commande est non reconnu. Veuillez actualiser ou contacter le support.'
            });
            console.warn('[PurchaseOrderDetail] Unknown purchase order status received from API', {
              orderId: response.data.id,
              rawStatus: response.data.status
            });
            return;
          }

          this.po.set(normalizedData);
          this.breadcrumbItems = [
            { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
            { label: 'Bons de commande', route: '/purchase-orders' },
            { label: response.data.number }
          ];
          this.loadLinkedReceipts(normalizedData.id);
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

  private loadLinkedReceipts(purchaseOrderId: string): void {
    this.receiptService.getPurchaseReceipts({ purchaseOrderId, pageSize: 50 }).subscribe({
      next: (res) => {
        this.linkedReceipts.set(res.success && res.data ? res.data.items : []);
      },
      error: () => this.linkedReceipts.set([])
    });
  }

  isDraft(): boolean {
    return this.po()?.status === PurchaseOrderStatus.Draft;
  }

  isConfirmed(): boolean {
    return this.po()?.status === PurchaseOrderStatus.Confirmed;
  }

  isPartiallyReceived(): boolean {
    return this.po()?.status === PurchaseOrderStatus.PartiallyReceived;
  }

  canReceiveGoods(): boolean {
    const status = this.po()?.status;
    return status === PurchaseOrderStatus.Confirmed
      || status === PurchaseOrderStatus.PartiallyReceived
      || status === PurchaseOrderStatus.PartiallyInvoiced;
  }

  canCreateSupplierInvoice(): boolean {
    const order = this.po();
    return !!order?.hasReceivedNotInvoiced
      && this.auth.hasPermission(PERMISSIONS.supplierInvoices.create);
  }

  getStatusSeverity(status: PurchaseOrderStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case PurchaseOrderStatus.Draft: return 'secondary';
      case PurchaseOrderStatus.Confirmed: return 'info';
      case PurchaseOrderStatus.PartiallyReceived: return 'warn';
      case PurchaseOrderStatus.Received: return 'success';
      case PurchaseOrderStatus.PartiallyInvoiced: return 'warn';
      case PurchaseOrderStatus.Cancelled: return 'danger';
      case PurchaseOrderStatus.Invoiced: return 'contrast';
      default: return 'secondary';
    }
  }

  confirmOrder(): void {
    const order = this.po();
    if (!order || this.confirming() || order.status !== PurchaseOrderStatus.Draft) return;

    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir confirmer la commande ${order.number} ? Cette action est irréversible.`,
      header: 'Confirmer la commande',
      icon: 'pi pi-check-circle',
      acceptLabel: 'Confirmer',
      rejectLabel: 'Annuler',
      accept: () => {
        this.confirming.set(true);
        this.poService.confirmPurchaseOrder(order.id).subscribe({
          next: (response) => {
            this.confirming.set(false);
            if (response.success) {
              this.toastService.add({ severity: 'success', summary: 'Succès', detail: 'Commande confirmée' });
              this.loadOrder(order.id);
            }
          },
          error: () => {
            this.confirming.set(false);
          }
        });
      }
    });
  }

  cancelOrder(): void {
    this.cancellationReason = '';
    this.cancelDialogVisible = true;
  }

  closeCancelDialog(): void {
    this.cancelDialogVisible = false;
    this.cancellationReason = '';
  }

  submitCancelOrder(): void {
    const order = this.po();
    const reason = this.cancellationReason?.trim();
    if (!order || !reason) return;

    this.poService.cancelPurchaseOrder(order.id, reason).subscribe({
      next: (response) => {
        if (response.success) {
          this.closeCancelDialog();
          this.toastService.add({ severity: 'success', summary: 'Succès', detail: 'Commande annulée' });
          this.loadOrder(order.id);
        }
      },
      error: (err) => {
        this.toastService.add({ severity: 'error', summary: 'Erreur', detail: err?.error?.errors?.[0] || 'Erreur' });
      }
    });
  }

  downloadPdf(): void {
    const order = this.po();
    if (!order) return;

    this.poService.downloadPdf(order.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `BC_${order.number}.pdf`;
        link.click();
        window.URL.revokeObjectURL(url);
        this.toastService.add({ severity: 'success', summary: 'PDF', detail: 'Téléchargement lancé' });
      },
      error: () => {
        this.toastService.add({ severity: 'error', summary: 'Erreur', detail: 'Impossible de générer le PDF' });
      }
    });
  }

  sendByEmail(): void {
    const order = this.po();
    if (!order) return;
    if (!order.supplier.email) {
      this.toastService.add({
        severity: 'warn',
        summary: 'Email manquant',
        detail: "Le fournisseur n'a pas d'adresse email."
      });
      return;
    }

    this.confirmationService.confirm({
      message: `Envoyer le bon de commande ${order.number} par email à ${order.supplier.email} ?`,
      header: 'Envoi par email',
      icon: 'pi pi-envelope',
      acceptLabel: 'Envoyer',
      rejectLabel: 'Annuler',
      accept: () => {
        this.sending.set(true);
        this.poService.sendByEmail(order.id).subscribe({
          next: (response) => {
            this.sending.set(false);
            if (response.success) {
              this.toastService.add({ severity: 'success', summary: 'Envoyé', detail: `Email envoyé à ${order.supplier.email}` });
            }
          },
          error: (err) => {
            this.sending.set(false);
            this.toastService.add({ severity: 'error', summary: 'Erreur', detail: err?.error?.errors?.[0] || 'Erreur lors de l\'envoi' });
          }
        });
      }
    });
  }

  openCreateSupplierInvoice(): void {
    const order = this.po();
    if (!order) return;

    this.poService.getSupplierInvoicePrefill(order.id).subscribe({
      next: (prefillRes) => {
        if (!prefillRes.success || !prefillRes.data) {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: prefillRes.message || 'Impossible de préparer la facture'
          });
          return;
        }

        this.createSupplierInvoiceModal?.open({
          prefill: prefillRes.data,
          sourceType: 'po',
          onConfirm: (request) => {
            void this.submitSupplierInvoice(order.id, request, false);
          }
        });
      },
      error: (err) => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: err?.error?.errors?.[0] || err?.error?.message || 'Impossible de préparer la facture'
        });
      }
    });
  }

  /**
   * See PurchaseReceiptDetailComponent.submitSupplierInvoice — same auto-retry
   * strategy for the PO sibling endpoint. Keeps behaviour aligned across both paths.
   */
  private async submitSupplierInvoice(
    orderId: string,
    request: { invoiceNumber: string; invoiceDate: Date; paymentTermDays: number;
      externalReference?: string; notes?: string; sendEmail?: boolean;
      lines?: { sourceLineId: string; quantityToInvoice: number }[];
      lineAssetClassifications?: { lineNumber: number; isFixedAsset: boolean;
        depreciationRateCategoryId?: string; assetAccountNumber?: string }[];
      paymentMethod?: string; useSuggestedNumber?: boolean; },
    isRetryAfterConflict: boolean
  ): Promise<void> {
    const payload = {
      invoiceNumber: request.invoiceNumber,
      invoiceDate: this.formatDateForApi(request.invoiceDate),
      paymentTermDays: request.paymentTermDays,
      externalReference: request.externalReference,
      notes: request.notes,
      sendEmail: request.sendEmail,
      lines: request.lines,
      lineAssetClassifications: request.lineAssetClassifications,
      paymentMethod: request.paymentMethod,
      useSuggestedNumber: isRetryAfterConflict ? true : request.useSuggestedNumber
    };

    this.poService.createSupplierInvoice(orderId, payload).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.createSupplierInvoiceModal?.closeAfterSuccess();
          this.toastService.add({
            severity: 'success',
            summary: 'Succès',
            detail: `Facture fournisseur ${response.data.invoiceNumber} créée`
          });
          void this.router.navigate(['/supplier-invoices', response.data.id]);
        }
      },
      error: (err) => {
        const isDuplicate = err?.status === 409;
        const suggested: string | null | undefined = err?.error?.data?.suggestedInvoiceNumber;

        if (isDuplicate && !isRetryAfterConflict) {
          void this.handleConflictAndRetry(orderId, request, suggested);
          return;
        }

        this.createSupplierInvoiceModal?.setSubmitting(false);
        const errorMsg = err?.error?.errors?.[0] ?? err?.error?.message ?? 'Erreur lors de la création';
        this.toastService.add({
          severity: 'error',
          summary: isDuplicate ? 'Numéro en doublon' : 'Erreur',
          detail: isDuplicate
            ? 'Impossible de créer la facture : le numéro proposé est également indisponible. Réessayez ou saisissez un numéro.'
            : errorMsg
        });
      }
    });
  }

  private async handleConflictAndRetry(
    orderId: string,
    request: { invoiceNumber: string; invoiceDate: Date; paymentTermDays: number;
      externalReference?: string; notes?: string; sendEmail?: boolean;
      lines?: { sourceLineId: string; quantityToInvoice: number }[];
      lineAssetClassifications?: { lineNumber: number; isFixedAsset: boolean;
        depreciationRateCategoryId?: string; assetAccountNumber?: string }[];
      paymentMethod?: string; useSuggestedNumber?: boolean; },
    suggestedFromServer: string | null | undefined
  ): Promise<void> {
    const modal = this.createSupplierInvoiceModal;
    if (!modal) return;

    const newNumber = await modal.handleConflict(suggestedFromServer);
    if (!newNumber) {
      modal.setSubmitting(false);
      this.toastService.add({
        severity: 'error',
        summary: 'Erreur',
        detail: 'Impossible de générer un nouveau numéro de facture. Veuillez réessayer.'
      });
      return;
    }

    void this.submitSupplierInvoice(
      orderId,
      { ...request, invoiceNumber: newNumber, useSuggestedNumber: true },
      true
    );
  }

  private formatDateForApi(date: Date): string {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  }

  private sendSupplierInvoiceEmail(invoiceId: string): void {
    // This would integrate with existing email infrastructure
    // For now, just show a success message
    this.toastService.add({
      severity: 'info',
      summary: 'Email envoyé',
      detail: 'La facture fournisseur a été envoyée par email'
    });
  }

  deleteOrder(): void {
    const order = this.po();
    if (!order) return;

    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir supprimer définitivement la commande brouillon ${order.number} ? Cette action est irréversible.`,
      header: 'Supprimer la commande',
      icon: 'pi pi-trash',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.poService.deletePurchaseOrder(order.id).subscribe({
          next: (response) => {
            if (response.success) {
              this.toastService.add({ severity: 'success', summary: 'Succès', detail: 'Commande supprimée' });
              this.router.navigate(['/purchase-orders']);
            }
          },
          error: (err) => {
            this.toastService.add({
              severity: 'error',
              summary: 'Erreur',
              detail: err?.error?.errors?.[0] || 'Impossible de supprimer cette commande'
            });
          }
        });
      }
    });
  }
}
