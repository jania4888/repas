/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal, computed, ViewChild } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { Textarea } from 'primeng/textarea';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import {
  PurchaseReceiptService,
  PurchaseReceiptDetail,
  PurchaseReceiptStatus,
  mapPurchaseReceiptDetailFromApi
} from '@core/services/purchase-receipt.service';
import { CreateSupplierInvoiceModalComponent } from '@features/purchase-orders/components/create-supplier-invoice-modal/create-supplier-invoice-modal.component';
import { TRACKING_MODE_LOT, TRACKING_MODE_SERIAL } from '@shared/utils/stock-traceability.utils';

@Component({
  selector: 'app-purchase-receipt-detail',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule, RouterModule, FormsModule, CurrencyPipe, DatePipe,
    TagModule, TableModule, ToastModule, DialogModule, Textarea,
    PageHeaderComponent, BreadcrumbComponent, ButtonComponent, StatusBadgeComponent,
    CreateSupplierInvoiceModalComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p i18n="@@purchase-receipts.pages.chargement.a209b664">Chargement...</p>
      </div>
    } @else if (receipt()) {
      <app-page-header
        [title]="'Réception ' + receipt()!.number"
        [subtitle]="receipt()!.supplier.name">
        <div class="header-actions">
          <app-button variant="outline" icon="pi-arrow-left" iconPos="left"
            routerLink="/purchase-receipts" i18n="@@purchase-receipts.pages.retour.e5befb1f"> Retour </app-button>

          <app-button variant="outline" icon="pi-file-pdf" iconPos="left"
            [disabled]="downloadingPdf()"
            (clicked)="downloadPdf()">
            <ng-container i18n="@@purchase-receipts.pages.sel.pdf.pdf.a5f843cb">{!!(downloadingPdf()), select, true {PDF…} other {PDF}}</ng-container>
          </app-button>

          @if (canEdit()) {
            <app-button variant="outline" icon="pi-pencil" iconPos="left"
              [routerLink]="['/purchase-receipts', receipt()!.id, 'edit']" i18n="@@purchase-receipts.pages.modifier.f260e757"> Modifier </app-button>
          }

          @if (canValidate()) {
            <app-button variant="primary" icon="pi-verified" iconPos="left"
              [disabled]="validating()"
              (clicked)="validate()">
              <ng-container i18n="@@purchase-receipts.pages.sel.validation.valider.ed0aee37">{!!(validating()), select, true {Validation…} other {Valider}}</ng-container>
            </app-button>
          }

          @if (canCreateSupplierInvoice()) {
            <app-button variant="primary" icon="pi-money-bill" iconPos="left"
              (clicked)="openCreateSupplierInvoice()" i18n="@@purchase-receipts.pages.creer.facture.fournisseur.4a82949b"> Créer facture fournisseur </app-button>
          }

          @if (canCancel()) {
            <app-button variant="outline" icon="pi-times" iconPos="left"
              (clicked)="openCancelDialog()" i18n="@@purchase-receipts.pages.annuler.49ba3292"> Annuler </app-button>
          }

          @if (canDelete()) {
            <app-button variant="danger" icon="pi-trash" iconPos="left"
              (clicked)="deleteReceipt()" i18n="@@purchase-receipts.pages.supprimer.1acfc1c7"> Supprimer </app-button>
          }
        </div>
      </app-page-header>

      <div class="detail-grid">
        <div class="detail-card">
          <h3 class="card-title" i18n="@@purchase-receipts.pages.informations.generales.b89a6e35"><i class="pi pi-file"></i> Informations générales</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label" i18n="@@purchase-receipts.pages.numero.15e73db0">Numéro</span>
              <span class="value mono">{{ receipt()!.number }}</span>
            </div>
            <div class="info-item">
              <span class="label" i18n="@@purchase-receipts.pages.date.eb9a4bc1">Date</span>
              <span class="value">{{ receipt()!.receiptDate | date:'dd/MM/yyyy' }}</span>
            </div>
            <div class="info-item">
              <span class="label" i18n="@@purchase-receipts.pages.statut.659499f3">Statut</span>
              <app-status-badge
                [status]="statusBadge()"
                [label]="receipt()!.statusDisplay | backendLabel">
              </app-status-badge>
            </div>
            <div class="info-item">
              <span class="label" i18n="@@purchase-receipts.pages.entrepot.c349c0bc">Entrepôt</span>
              <span class="value">{{ receipt()!.warehouseName || '—' }}</span>
            </div>
            @if (receipt()!.supplierReference) {
              <div class="info-item">
                <span class="label" i18n="@@purchase-receipts.pages.ref.fournisseur.98507c4b">Réf. fournisseur</span>
                <span class="value">{{ receipt()!.supplierReference }}</span>
              </div>
            }
            @if (receipt()!.purchaseOrderId) {
              <div class="info-item">
                <span class="label" i18n="@@purchase-receipts.pages.bon.de.commande.4b9aea29">Bon de commande</span>
                <a [routerLink]="['/purchase-orders', receipt()!.purchaseOrderId]" class="value link">
                  {{ receipt()!.purchaseOrderNumber }}
                </a>
              </div>
            }
            @if (receipt()!.isPartialRelativeToOrdered) {
              <div class="info-item">
                <span class="label" i18n="@@purchase-receipts.pages.reception.36e23897">Réception</span>
                <p-tag value="Partielle" severity="warn"></p-tag>
              </div>
            }
          </div>
        </div>

        <div class="detail-card">
          <h3 class="card-title" i18n="@@purchase-receipts.pages.fournisseur.35691c73"><i class="pi pi-building"></i> Fournisseur</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label" i18n="@@purchase-receipts.pages.nom.7ff20370">Nom</span>
              <a [routerLink]="['/suppliers', receipt()!.supplier.id]" class="value link">
                {{ receipt()!.supplier.name }}
              </a>
            </div>
            @if (receipt()!.supplier.email) {
              <div class="info-item">
                <span class="label" i18n="@@purchase-receipts.pages.email.84add5b2">Email</span>
                <a [href]="'mailto:' + receipt()!.supplier.email" class="value link">
                  {{ receipt()!.supplier.email }}
                </a>
              </div>
            }
            @if (receipt()!.transporterName) {
              <div class="info-item">
                <span class="label" i18n="@@purchase-receipts.pages.transporteur.7adadb36">Transporteur</span>
                <span class="value">{{ receipt()!.transporterName }}</span>
              </div>
            }
            @if (receipt()!.deliveryNoteNumber) {
              <div class="info-item">
                <span class="label" i18n="@@purchase-receipts.pages.n.bl.f3b7f6bc">N° BL</span>
                <span class="value">{{ receipt()!.deliveryNoteNumber }}</span>
              </div>
            }
          </div>
        </div>

        <div class="detail-card full-width">
          <h3 class="card-title" i18n="@@purchase-receipts.pages.articles.recus.728eb9ac"><i class="pi pi-list"></i> Articles reçus</h3>
          <p-table [value]="receipt()!.lines" styleClass="p-datatable-sm" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 50px" i18n="@@purchase-receipts.pages.text.d08f88df">#</th>
                <th i18n="@@purchase-receipts.pages.article.4360c2dc">Article</th>
                <th style="width: 80px" i18n="@@purchase-receipts.pages.unite.388fd9c4">Unité</th>
                <th style="width: 100px" i18n="@@purchase-receipts.pages.qte.commandee.8c1ee02c">Qté commandée</th>
                <th style="width: 100px" i18n="@@purchase-receipts.pages.qte.recue.ec07cbe1">Qté reçue</th>
                <th style="width: 120px" i18n="@@purchase-receipts.pages.prix.unitaire.ht.bb3f8e39">Prix unitaire HT</th>
                <th style="width: 80px" i18n="@@purchase-receipts.pages.remise.ce12d942">Remise</th>
                <th style="width: 80px" i18n="@@purchase-receipts.pages.tva.fb62cb5d">TVA</th>
                <th style="width: 120px" i18n="@@purchase-receipts.pages.total.ht.2ca17ae6">Total HT</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-line>
              <tr>
                <td class="text-center">{{ line.lineNumber }}</td>
                <td>
                  <div class="product-info">
                    <span class="product-name">{{ line.productName }}</span>
                    <span class="product-code">{{ line.productCode }}</span>
                  </div>
                </td>
                <td class="text-center">{{ line.unit || '—' }}</td>
                <td class="text-center">{{ line.orderedQuantity | number:'1.0-3' }}</td>
                <td class="text-center">{{ line.receivedQuantity | number:'1.0-3' }}</td>
                <td class="text-right">{{ line.unitPriceHT | currency:'TND':'symbol':'1.3-3' }}</td>
                <td class="text-center">
                  {{ line.discountPercent ? (line.discountPercent | number:'1.0-2') + ' %' : '—' }}
                </td>
                <td class="text-center">{{ line.vatRateDisplay }}</td>
                <td class="text-right amount">{{ line.subTotal | currency:'TND':'symbol':'1.3-3' }}</td>
              </tr>
            </ng-template>
          </p-table>

          <div class="totals-section">
            <div class="total-row">
              <span i18n="@@purchase-receipts.pages.sous.total.ht.724598f6">Sous-total HT</span>
              <span class="amount">{{ receipt()!.subTotal | currency:'TND':'symbol':'1.3-3' }}</span>
            </div>
            <div class="total-row">
              <span i18n="@@purchase-receipts.pages.tva.fb62cb5d">TVA</span>
              <span class="amount">{{ receipt()!.totalVat | currency:'TND':'symbol':'1.3-3' }}</span>
            </div>
            <div class="total-row grand-total">
              <span i18n="@@purchase-receipts.pages.total.ttc.9e80ff7c">Total TTC</span>
              <span class="amount">{{ receipt()!.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
            </div>
          </div>
        </div>

        @if (receipt()!.notes) {
          <div class="detail-card full-width">
            <h3 class="card-title" i18n="@@purchase-receipts.pages.notes.e4c25cd5"><i class="pi pi-file-edit"></i> Notes</h3>
            <p class="notes-text">{{ receipt()!.notes }}</p>
          </div>
        }

        @if (receipt()!.attachments.length) {
          <div class="detail-card full-width">
            <h3 class="card-title" i18n="@@purchase-receipts.pages.pieces.jointes.85090279"><i class="pi pi-paperclip"></i> Pièces jointes</h3>
            <ul class="attachments-list">
              @for (att of receipt()!.attachments; track att.id) {
                <li>
                  <i class="pi pi-file"></i>
                  <span>{{ att.fileName }}</span>
                  <small>{{ att.uploadedAt | date:'dd/MM/yyyy HH:mm' }}</small>
                </li>
              }
            </ul>
          </div>
        }

        @if (receipt()!.linkedSupplierInvoices && receipt()!.linkedSupplierInvoices!.length > 0) {
          <div class="detail-card full-width">
            <h3 class="card-title" i18n="@@purchase-receipts.pages.factures.fournisseur.liees.7d6114da"><i class="pi pi-money-bill"></i> Factures fournisseur liées</h3>
            <ul class="linked-invoices">
              @for (inv of receipt()!.linkedSupplierInvoices!; track inv.id) {
                <li>
                  <a [routerLink]="['/supplier-invoices', inv.id]" class="value link">{{ inv.invoiceNumber }}</a>
                  <span class="date">{{ inv.invoiceDate | date:'dd/MM/yyyy' }}</span>
                  <p-tag [value]="inv.statusDisplay | backendLabel" severity="info"></p-tag>
                  <span class="amount">{{ inv.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
                </li>
              }
            </ul>
          </div>
        }

        @if (receipt()!.cancellationReason) {
          <div class="detail-card full-width cancelled-card">
            <h3 class="card-title" i18n="@@purchase-receipts.pages.motif.d.annulation.8ea42493"><i class="pi pi-exclamation-triangle"></i> Motif d'annulation</h3>
            <p class="notes-text">{{ receipt()!.cancellationReason }}</p>
            @if (receipt()!.cancelledAt) {
              <p class="cancelled-date" i18n="@@purchase-receipts.pages.annule.le.947527e8">Annulé le {{ receipt()!.cancelledAt | date:'dd/MM/yyyy HH:mm' }}</p>
            }
          </div>
        }
      </div>
    }

    <p-dialog
      header="Annuler le bon de réception" i18n-header="@@purchase-receipts.pages.annuler.le.bon.de.reception.8e64ea8c"
      [(visible)]="cancelDialogVisible"
      [modal]="true"
      [style]="{ width: '450px' }"
      [draggable]="false"
      [resizable]="false">
      <p class="dialog-message" i18n="@@purchase-receipts.pages.indiquez.le.motif.d.annulation.si.le.bon.etait.v.0b7f771f"> Indiquez le motif d'annulation. Si le bon était validé, le stock et les quantités du BC seront contrepassés. </p>
      <textarea
        pTextarea
        [(ngModel)]="cancellationReason"
        placeholder="Motif d'annulation…" i18n-placeholder="@@purchase-receipts.pages.motif.d.annulation.7df7a5ee"
        [rows]="4"
        class="w-full">
      </textarea>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (clicked)="cancelDialogVisible = false" i18n="@@purchase-receipts.pages.retour.e5befb1f">Retour</app-button>
        <app-button
          variant="danger"
          icon="pi-times"
          iconPos="left"
          [disabled]="!cancellationReason.trim() || cancelling()"
          (clicked)="submitCancel()" i18n="@@purchase-receipts.pages.confirmer.l.annulation.92040a54"> Confirmer l'annulation </app-button>
      </ng-template>
    </p-dialog>

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
      flex-wrap: wrap;
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
      border: 1px solid var(--color-border-subtle);

      &.full-width { grid-column: 1 / -1; }
      &.cancelled-card {
        border-color: var(--color-danger-300, #fca5a5);
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
      color: var(--color-danger-600, #dc2626);
      margin: var(--spacing-2) 0 0;
    }

    .attachments-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .attachments-list li {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
    }

    .attachments-list li span { flex: 1; }

    .linked-invoices {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .linked-invoices li {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      flex-wrap: wrap;
      font-size: var(--font-size-sm);
    }

    .linked-invoices .amount {
      margin-left: auto;
      font-family: 'JetBrains Mono', monospace;
    }

    .dialog-message {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    @media (max-width: 768px) {
      .detail-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class PurchaseReceiptDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private receiptService = inject(PurchaseReceiptService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private confirmationService = inject(ConfirmationService);
  private auth = inject(AuthService);

  loading = signal(true);
  validating = signal(false);
  cancelling = signal(false);
  downloadingPdf = signal(false);
  receipt = signal<PurchaseReceiptDetail | null>(null);

  cancelDialogVisible = false;
  cancellationReason = '';

  @ViewChild('createSupplierInvoiceModal')
  createSupplierInvoiceModal?: CreateSupplierInvoiceModalComponent;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.bons.de.reception.84d6ebb5:Bons de réception`, route: '/purchase-receipts' },
    { label: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.detail.7ce06afc:Détail` }
  ];

  canEdit = computed(() => {
    const r = this.receipt();
    return !!r &&
      r.status === PurchaseReceiptStatus.Draft &&
      this.auth.hasPermission(PERMISSIONS.purchaseReceipts.update);
  });

  canValidate = computed(() => {
    const r = this.receipt();
    return !!r &&
      r.status === PurchaseReceiptStatus.Draft &&
      this.auth.hasPermission(PERMISSIONS.purchaseReceipts.update);
  });

  canCancel = computed(() => {
    const r = this.receipt();
    return !!r &&
      (r.status === PurchaseReceiptStatus.Draft || r.status === PurchaseReceiptStatus.Validated) &&
      this.auth.hasPermission(PERMISSIONS.purchaseReceipts.update);
  });

  canDelete = computed(() => {
    const r = this.receipt();
    return !!r &&
      r.status === PurchaseReceiptStatus.Draft &&
      this.auth.hasPermission(PERMISSIONS.purchaseReceipts.delete);
  });

  canCreateSupplierInvoice = computed(() => {
    const r = this.receipt();
    return !!r &&
      r.hasReceivedNotInvoiced &&
      (r.status === PurchaseReceiptStatus.Validated
        || r.status === PurchaseReceiptStatus.PartiallyInvoiced) &&
      this.auth.hasPermission(PERMISSIONS.supplierInvoices.create);
  });

  statusBadge = computed<StatusBadgeStatus>(() => {
    const status = this.receipt()?.status;
    switch (status) {
      case PurchaseReceiptStatus.Validated: return 'validated';
      case PurchaseReceiptStatus.PartiallyInvoiced: return 'validated';
      case PurchaseReceiptStatus.Invoiced: return 'validated';
      case PurchaseReceiptStatus.Cancelled: return 'cancelled';
      default: return 'draft';
    }
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.receiptService.getPurchaseReceipt(id).subscribe({
      next: (res) => {
        if (!res.success || !res.data) {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
            detail: $localize`:@@purchase-receipt-detail.component.detail.bon.de.reception.introuvable.ddf6c47b:Bon de réception introuvable`
          });
          this.router.navigate(['/purchase-receipts']);
          return;
        }

        const mapped = mapPurchaseReceiptDetailFromApi(res.data);
        if (!mapped) {
          this.toastService.add({
            severity: 'warn',
            summary: $localize`:@@purchase-receipt-detail.component.summary.Statut_inconnu:Statut inconnu`,
            detail: $localize`:@@purchase-receipt-detail.component.detail.Impossible_d_aff:Impossible d'afficher ce bon de réception.`
          });
          this.router.navigate(['/purchase-receipts']);
          return;
        }

        this.receipt.set(mapped);
        this.breadcrumbItems = [
          { label: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
          { label: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.bons.de.reception.84d6ebb5:Bons de réception`, route: '/purchase-receipts' },
          { label: mapped.number }
        ];
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
          detail: $localize`:@@purchase-receipt-detail.component.detail.Impossible_de_ch:Impossible de charger le bon de réception`
        });
        this.router.navigate(['/purchase-receipts']);
      }
    });
  }

  downloadPdf(): void {
    const r = this.receipt();
    if (!r) return;
    this.downloadingPdf.set(true);
    this.receiptService.downloadPdf(r.id).subscribe({
      next: (blob) => {
        this.downloadingPdf.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `BR_${r.number}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.downloadingPdf.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
          detail: $localize`:@@purchase-receipt-detail.component.detail.Impossible d:Impossible de télécharger le PDF`
        });
      }
    });
  }

  validate(): void {
    const r = this.receipt();
    if (!r) return;

    if (this.hasTrackedLines(r)) {
      this.toastService.add({
        severity: 'info',
        summary: $localize`:@@purchase-receipt-detail.component.summary.Traçabilité :Traçabilité requise`,
        detail: $localize`:@@purchase-receipt-detail.component.detail.Renseignez_les_n:Renseignez les numéros de lot ou de série sur la page de modification avant validation.`
      });
      void this.router.navigate(['/purchase-receipts', r.id, 'edit']);
      return;
    }

    this.confirmationService.confirm({
      message: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.valider.cette.reception.le.stock.sera.mi.6c3a9af0:Valider cette réception ? Le stock sera mis à jour et les quantités du bon de commande seront imputées.`,
      header: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.valider.la.reception.7e156958:Valider la réception`,
      icon: 'pi pi-verified',
      acceptLabel: $localize`:@@purchase-receipt-detail.component.acceptLabel.Valider:Valider`,
      rejectLabel: $localize`:@@purchase-receipt-detail.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.validating.set(true);
        this.receiptService.validatePurchaseReceipt(r.id).subscribe({
          next: (res) => {
            this.validating.set(false);
            if (res.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@purchase-receipt-detail.component.summary.Validé:Validé`,
                detail: $localize`:@@purchase-receipt-detail.component.detail.bon.de.reception.valide.afed974c:Bon de réception validé`
              });
              this.load(r.id);
            }
          },
          error: (err) => {
            this.validating.set(false);
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
              detail: this.errorHandler.extractErrorMessage(err) || $localize`:@@purchase-receipts.purchase-receipt-detail.ts.echec.de.la.validation.d6fffafe:Échec de la validation`
            });
          }
        });
      }
    });
  }

  private hasTrackedLines(receipt: PurchaseReceiptDetail): boolean {
    return receipt.lines.some(l => {
      const mode = l.trackingMode ?? 0;
      return mode === TRACKING_MODE_LOT || mode === TRACKING_MODE_SERIAL;
    });
  }

  openCancelDialog(): void {
    this.cancellationReason = '';
    this.cancelDialogVisible = true;
  }

  submitCancel(): void {
    const r = this.receipt();
    if (!r || !this.cancellationReason.trim()) return;

    this.cancelling.set(true);
    this.receiptService.cancelPurchaseReceipt(r.id, { reason: this.cancellationReason.trim() }).subscribe({
      next: (res) => {
        this.cancelling.set(false);
        this.cancelDialogVisible = false;
        if (res.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@purchase-receipt-detail.component.summary.Annul_:Annulé`,
            detail: $localize`:@@purchase-receipt-detail.component.detail.bon.de.reception.annule.1b36efb2:Bon de réception annulé`
          });
          this.load(r.id);
        }
      },
      error: (err) => {
        this.cancelling.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
          detail: err?.error?.errors?.[0] || $localize`:@@purchase-receipts.purchase-receipt-detail.ts.echec.de.l.annulation.897a46f6:Échec de l'annulation`
        });
      }
    });
  }

  deleteReceipt(): void {
    const r = this.receipt();
    if (!r) return;

    this.confirmationService.confirm({
      message: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.supprimer.definitivement.ce.brouillon.c9471a55:Supprimer définitivement ce brouillon ?`,
      header: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.supprimer.1acfc1c7:Supprimer`,
      icon: 'pi pi-trash',
      acceptLabel: $localize`:@@purchase-receipt-detail.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@purchase-receipt-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.receiptService.deletePurchaseReceipt(r.id).subscribe({
          next: (res) => {
            if (res.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@purchase-receipt-detail.component.summary.Supprimé:Supprimé`,
                detail: $localize`:@@purchase-receipt-detail.component.detail.bon.de.reception.supprime.3fd82393:Bon de réception supprimé`
              });
              this.router.navigate(['/purchase-receipts']);
            }
          },
          error: (err) => {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
              detail: err?.error?.errors?.[0] || $localize`:@@purchase-receipts.purchase-receipt-detail.ts.echec.de.la.suppression.bfcbda57:Échec de la suppression`
            });
          }
        });
      }
    });
  }

  openCreateSupplierInvoice(): void {
    const r = this.receipt();
    if (!r) return;

    this.receiptService.getSupplierInvoicePrefill(r.id).subscribe({
      next: (prefillRes) => {
        if (!prefillRes.success || !prefillRes.data) {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
            detail: prefillRes.message || $localize`:@@purchase-receipts.purchase-receipt-detail.ts.impossible.de.preparer.la.facture.a10c22ae:Impossible de préparer la facture`
          });
          return;
        }

        this.createSupplierInvoiceModal?.open({
          prefill: prefillRes.data,
          sourceType: 'pr',
          onConfirm: (request) => {
            void this.submitSupplierInvoice(r.id, request, false);
          }
        });
      },
      error: (err) => {
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
          detail: err?.error?.errors?.[0] || $localize`:@@purchase-receipts.purchase-receipt-detail.ts.impossible.de.preparer.la.facture.a10c22ae:Impossible de préparer la facture`
        });
      }
    });
  }

  /**
   * Sends the create-supplier-invoice request. On a 409 duplicate, patches the modal with
   * the server-suggested (or freshly previewed) number and retries ONCE with
   * useSuggestedNumber=true — which routes the backend through the atomic ReserveNextAsync
   * path, guaranteeing no further collision. A second 409 (should not happen server-side)
   * yields a plain error toast; no infinite retry loop.
   */
  private async submitSupplierInvoice(
    receiptId: string,
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

    this.receiptService.createSupplierInvoice(receiptId, payload).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.createSupplierInvoiceModal?.closeAfterSuccess();
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@purchase-receipt-detail.component.summary.Succès:Succès`,
            detail: $localize`:@@purchase-receipts.purchase-receipt-detail.ts.facture.fournisseur.invoicenumber.creee.0fa763be:Facture fournisseur ${response.data.invoiceNumber}:invoiceNumber: créée`
          });
          void this.router.navigate(['/supplier-invoices', response.data.id]);
        }
      },
      error: (err) => {
        const isDuplicate = err?.status === 409;
        const suggested: string | null | undefined = err?.error?.data?.suggestedInvoiceNumber;

        if (isDuplicate && !isRetryAfterConflict) {
          // Auto-recover: patch the modal with a fresh number then retry ONCE.
          void this.handleConflictAndRetry(receiptId, request, suggested);
          return;
        }

        this.createSupplierInvoiceModal?.setSubmitting(false);
        const errorMsg = err?.error?.errors?.[0] ?? err?.error?.message ?? 'Erreur lors de la création';
        this.toastService.add({
          severity: 'error',
          summary: isDuplicate ? $localize`:@@purchase-receipts.purchase-receipt-detail.ts.numero.en.doublon.9aeb86ca:Numéro en doublon` : $localize`:@@purchase-receipts.purchase-receipt-detail.ts.erreur.ab546c23:Erreur`,
          detail: isDuplicate
            ? $localize`:@@purchase-receipts.purchase-receipt-detail.ts.impossible.de.creer.la.facture.le.numero.379737f7:Impossible de créer la facture : le numéro proposé est également indisponible. Réessayez ou saisissez un numéro.`
            : errorMsg
        });
      }
    });
  }

  private async handleConflictAndRetry(
    receiptId: string,
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
        summary: $localize`:@@purchase-receipt-detail.component.summary.Erreur:Erreur`,
        detail: $localize`:@@purchase-receipt-detail.component.detail.Impossible_de_g_:Impossible de générer un nouveau numéro de facture. Veuillez réessayer.`
      });
      return;
    }

    // Retry with the fresh number + useSuggestedNumber=true → backend uses the atomic
    // ReserveNextAsync path, so no further duplicate can happen.
    void this.submitSupplierInvoice(
      receiptId,
      { ...request, invoiceNumber: newNumber, useSuggestedNumber: true },
      true
    );
  }

  private formatDateForApi(date: Date): string {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
