/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { Textarea } from 'primeng/textarea';
import { InputTextModule } from 'primeng/inputtext';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { RecordPaymentDialogComponent } from '@shared/components/record-payment-dialog/record-payment-dialog.component';
import {
    SupplierInvoiceService,
    SupplierInvoiceDetail,
    SupplierInvoiceStatus,
    isSupplierInvoiceOpenForPayment,
    isSupplierInvoicePaid,
    isSupplierInvoiceCancelled
} from '@core/services/supplier-invoice.service';
import { formatLocalDate } from '@core/utils/date.util';

@Component({
    selector: 'app-supplier-invoice-detail',
    standalone: true,
    imports: [BackendLabelPipe, 
        CommonModule, RouterModule, FormsModule, CurrencyPipe, DatePipe,
        TagModule, TableModule, ToastModule, DialogModule, Textarea, InputTextModule,
        PageHeaderComponent, BreadcrumbComponent, ButtonComponent, RecordPaymentDialogComponent
    ],
    template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p i18n="@@supplier-invoices.supplier-invoice-detail.chargement.a209b664">Chargement...</p>
      </div>
    } @else if (inv()) {
      <app-page-header
        [title]="loc_ui_tern_facture_e6d1ea + inv()!.invoiceNumber"
        [subtitle]="inv()!.supplier.name">
        <div class="header-actions">
          @if (canRecordSupplierPayment()) {
            <app-button variant="primary" icon="pi-wallet" iconPos="left" (click)="openPayDialog()" i18n="@@supplier-invoices.supplier-invoice-detail.payer.la.facture.4c5a802a"> Payer la facture </app-button>
          }
          @if (canShowPaymentButton()) {
            <app-button variant="outline" icon="pi-times" iconPos="left" (click)="openCancelDialog()" i18n="@@supplier-invoices.supplier-invoice-detail.annuler.49ba3292"> Annuler </app-button>
          }
        </div>
      </app-page-header>

      <div class="detail-grid">
        <div class="detail-card">
          <h3 class="card-title" i18n="@@supplier-invoices.supplier-invoice-detail.informations.c0a7c3ae"><i class="pi pi-file"></i> Informations</h3>
          <div class="info-grid">
            <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.n.facture.7543385a">N° facture</span><span class="value mono">{{ inv()!.invoiceNumber }}</span></div>
            <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.date.eb9a4bc1">Date</span><span class="value">{{ inv()!.invoiceDate | date:'dd/MM/yyyy' }}</span></div>
            <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.echeance.f9a77ff6">Échéance</span><span class="value">{{ inv()!.dueDate | date:'dd/MM/yyyy' }}</span></div>
            <div class="info-item status-item">
              <span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.statut.659499f3">Statut</span>
              <div class="status-with-actions">
                <p-tag [value]="inv()!.statusDisplay | backendLabel" [severity]="getStatusSeverity(inv()!.status)"></p-tag>
                @if (canRecordSupplierPayment() || canShowPaymentButton()) {
                  <div class="card-actions">
                    @if (canRecordSupplierPayment()) {
                      <app-button variant="primary" icon="pi-wallet" iconPos="left" (click)="openPayDialog()" i18n="@@supplier-invoices.supplier-invoice-detail.payer.la.facture.4c5a802a"> Payer la facture </app-button>
                    }
                    @if (canShowPaymentButton()) {
                      <app-button variant="outline" icon="pi-times" iconPos="left" (click)="openCancelDialog()" i18n="@@supplier-invoices.supplier-invoice-detail.annuler.49ba3292"> Annuler </app-button>
                    }
                  </div>
                }
              </div>
            </div>
            @if (inv()!.externalReference) {
              <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.reference.externe.c09efd4a">Référence externe</span><span class="value">{{ inv()!.externalReference }}</span></div>
            }
            @if (inv()!.purchaseOrderId && inv()!.purchaseOrderNumber) {
              <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.bon.de.commande.4b9aea29">Bon de commande</span><a [routerLink]="['/purchase-orders', inv()!.purchaseOrderId]" class="value link">{{ inv()!.purchaseOrderNumber }}</a></div>
            }
            @if (inv()!.sourcePurchaseReceiptId && inv()!.sourcePurchaseReceiptNumber) {
              <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.bon.de.reception.e02e175c">Bon de réception</span><a [routerLink]="['/purchase-receipts', inv()!.sourcePurchaseReceiptId]" class="value link">{{ inv()!.sourcePurchaseReceiptNumber }}</a></div>
            }
            @if (isStandaloneInvoice()) {
              <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.origine.62e96258">Origine</span><span class="value" i18n="@@supplier-invoices.supplier-invoice-detail.facture.directe.3c9196b4">Facture directe</span></div>
            }
          </div>
          @if (isStandaloneInvoice()) {
            <div class="asset-banner" role="status">
              <i class="pi pi-paperclip"></i>
              <span i18n="@@supplier-invoices.supplier-invoice-detail.joignez.le.scan.de.la.facture.a.l.ecriture.compt.aaf1cdc8">Joignez le scan de la facture à l’écriture comptable d’achat (journal JA). Cette facture n’a pas mis à jour le stock.</span>
            </div>
          }
        </div>

        <div class="detail-card">
          <h3 class="card-title" i18n="@@supplier-invoices.supplier-invoice-detail.fournisseur.35691c73"><i class="pi pi-building"></i> Fournisseur</h3>
          <div class="info-grid">
            <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.nom.7ff20370">Nom</span><a [routerLink]="['/suppliers', inv()!.supplier.id]" class="value link">{{ inv()!.supplier.name }}</a></div>
            @if (inv()!.supplier.email) {
              <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.email.84add5b2">Email</span><a [href]="'mailto:' + inv()!.supplier.email" class="value link">{{ inv()!.supplier.email }}</a></div>
            }
            @if (inv()!.supplier.nif) {
              <div class="info-item"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.nif.77124a3a">NIF</span><span class="value mono">{{ inv()!.supplier.nif }}</span></div>
            }
            <div class="info-item full-width"><span class="label" i18n="@@supplier-invoices.supplier-invoice-detail.adresse.522e1466">Adresse</span><span class="value">{{ inv()!.supplier.address }}</span></div>
          </div>
        </div>

        <div class="detail-card full-width">
          <h3 class="card-title" i18n="@@supplier-invoices.supplier-invoice-detail.lignes.a1f1c9f6"><i class="pi pi-list"></i> Lignes</h3>
          @if (hasFixedAssetLines()) {
            <div class="asset-banner" role="status" i18n="@@supplier-invoices.supplier-invoice-detail.cette.facture.comporte.des.lignes.classe.dc3e735d">
              <i class="pi pi-building"></i>
              <span><ng-container>Cette facture comporte des lignes classées en </ng-container> <strong>immobilisations</strong> (comptes 21x / TVA 43662).</span>
            </div>
          }
          <p-table [value]="inv()!.lines" styleClass="p-datatable-sm" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 50px" i18n="@@supplier-invoices.supplier-invoice-detail.text.d08f88df">#</th>
                <th i18n="@@supplier-invoices.supplier-invoice-detail.produit.ff673dc2">Produit</th>
                <th style="width: 110px" i18n="@@supplier-invoices.supplier-invoice-detail.type.3deb7456">Type</th>
                <th style="width: 100px" class="text-center" i18n="@@supplier-invoices.supplier-invoice-detail.quantite.09a38fda">Quantité</th>
                <th style="width: 120px" class="text-right" i18n="@@supplier-invoices.supplier-invoice-detail.prix.unit.ht.5fbbfe6f">Prix unit. HT</th>
                <th style="width: 80px" class="text-center" i18n="@@supplier-invoices.supplier-invoice-detail.tva.fb62cb5d">TVA</th>
                <th style="width: 130px" class="text-right" i18n="@@supplier-invoices.supplier-invoice-detail.total.ttc.9e80ff7c">Total TTC</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-line>
              <tr [class.asset-line]="line.isFixedAsset">
                <td class="text-center">{{ line.lineNumber }}</td>
                <td><div class="product-info"><span class="product-name">{{ line.productName }}</span><span class="product-code">{{ line.productCode }}</span></div></td>
                <td>
                  @if (line.isFixedAsset) {
                    <p-tag value="Immobilisation" severity="info"></p-tag>
                    @if (line.assetAccountNumber) {
                      <span class="asset-account mono">{{ line.assetAccountNumber }}</span>
                    }
                    @if (line.fixedAssetId) {
                      <a [routerLink]="['/accounting/fixed-assets', line.fixedAssetId]" class="asset-link">
                        {{ line.fixedAssetInventoryNumber || 'Registre immo' }}
                      </a>
                    }
                  } @else {
                    <span class="line-type-muted" i18n="@@supplier-invoices.supplier-invoice-detail.marchandise.fff117d5">Marchandise</span>
                  }
                </td>
                <td class="text-center">{{ line.quantity }}</td>
                <td class="text-right">{{ line.unitPriceHT | currency:'TND':'symbol':'1.3-3' }}</td>
                <td class="text-center">{{ line.vatRateDisplay | backendLabel }}</td>
                <td class="text-right amount">{{ line.total | currency:'TND':'symbol':'1.3-3' }}</td>
              </tr>
            </ng-template>
          </p-table>
          <div class="totals-section">
            <div class="total-row"><span i18n="@@supplier-invoices.supplier-invoice-detail.sous.total.ht.724598f6">Sous-total HT</span><span class="amount">{{ inv()!.subTotal | currency:'TND':'symbol':'1.3-3' }}</span></div>
            <div class="total-row"><span i18n="@@supplier-invoices.supplier-invoice-detail.tva.fb62cb5d">TVA</span><span class="amount">{{ inv()!.totalVat | currency:'TND':'symbol':'1.3-3' }}</span></div>
            <div class="total-row grand-total"><span i18n="@@supplier-invoices.supplier-invoice-detail.total.ttc.9e80ff7c">Total TTC</span><span class="amount">{{ inv()!.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span></div>
            @if (!inv()!.isSubjectToWithholding && inv()!.totalTTC >= rs7TtcThresholdTnd) {
              <div class="rs-threshold-banner" role="alert">
                <p class="rs-threshold-title" i18n="@@supplier-invoices.supplier-invoice-detail.retenue.a.la.source.achats.a0145f06">Retenue à la source (achats)</p>
                <p class="rs-threshold-text" i18n="@@supplier-invoices.supplier-invoice-detail.le.total.ttc.depasse.le.seuil.indicatif.1404b4ab">
                  Le total TTC dépasse le seuil indicatif de {{ rs7TtcThresholdTnd | number:'1.0-0' }}&nbsp;TND (RS7), mais aucune retenue n’est calculée tant que le fournisseur n’est pas marqué comme
                  <strong>assujetti à la retenue à la source</strong> sur sa fiche.
                </p>
                <a [routerLink]="['/suppliers', inv()!.supplier.id]" class="rs-threshold-link" i18n="@@supplier-invoices.supplier-invoice-detail.ouvrir.la.fiche.fournisseur.735fd96f">Ouvrir la fiche fournisseur</a>
              </div>
            }
            @if (inv()!.isSubjectToWithholding && inv()!.withholdingAmount != null && inv()!.withholdingAmount !== undefined) {
              <div class="total-row muted-row">
                <span i18n="@@supplier-invoices.supplier-invoice-detail.retenue.a.la.source.prevision.0bdd56a4">Retenue à la source (prévision)</span>
                <span class="amount">{{ inv()!.withholdingAmount | number:'1.3-3' }} TND @if (inv()!.withholdingRate != null) { — {{ inv()!.withholdingRate }}&nbsp;% }</span>
              </div>
            }
            @if (inv()!.isSubjectToWithholding && inv()!.netAmountAfterWithholding != null && inv()!.netAmountAfterWithholding !== undefined) {
              <div class="total-row"><span i18n="@@supplier-invoices.supplier-invoice-detail.net.apres.rs.indicatif.0f008ebb">Net après RS (indicatif)</span><span class="amount">{{ inv()!.netAmountAfterWithholding | currency:'TND':'symbol':'1.3-3' }}</span></div>
            }
            @if (inv()!.isSubjectToWithholding) {
              <p class="tej-hint" i18n="@@supplier-invoices.supplier-invoice-detail.la.declaration.tej.regroupe.automatiquem.7839deca">
                <ng-container> La déclaration </ng-container> <strong>TEJ</strong> regroupe automatiquement les factures fournisseurs <strong>soldées</strong> avec retenue, selon le mois de la date de solde.
                <a routerLink="/withholding-tax/tej-export" class="link-inline">Export TEJ</a>
              </p>
            }
          </div>
        </div>

        @if (inv()!.notes) {
          <div class="detail-card full-width">
            <h3 class="card-title" i18n="@@supplier-invoices.supplier-invoice-detail.notes.e4c25cd5"><i class="pi pi-file-edit"></i> Notes</h3>
            <p class="notes-text">{{ inv()!.notes }}</p>
          </div>
        }

        @if (inv()!.payments && inv()!.payments.length > 0) {
          <div class="detail-card full-width">
            <h3 class="card-title" i18n="@@supplier-invoices.supplier-invoice-detail.historique.des.paiements.ddade87b"><i class="pi pi-wallet"></i> Historique des paiements</h3>
            <p-table [value]="inv()!.payments" styleClass="p-datatable-sm" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th i18n="@@supplier-invoices.supplier-invoice-detail.date.eb9a4bc1">Date</th>
                  <th class="text-right" i18n="@@supplier-invoices.supplier-invoice-detail.montant.4adcd9fc">Montant</th>
                  <th i18n="@@supplier-invoices.supplier-invoice-detail.mode.a7b93d21">Mode</th>
                  <th i18n="@@supplier-invoices.supplier-invoice-detail.reference.f8130bb0">Référence</th>
                  <th i18n="@@supplier-invoices.supplier-invoice-detail.effet.3b25c07d">Effet</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-payment>
                <tr>
                  <td>{{ payment.paymentDate | date:'dd/MM/yyyy' }}</td>
                  <td class="text-right amount">{{ payment.amount | number:'1.3-3' }} {{ payment.currency }}</td>
                  <td>{{ payment.methodDisplay | backendLabel }}</td>
                  <td>{{ payment.reference || '-' }}</td>
                  <td>
                    @if (payment.effetStatus !== null && payment.effetStatus !== undefined) {
                      <span class="effet-badge" [class.en-portefeuille]="payment.effetStatus === 0" [class.encaisse]="payment.effetStatus === 1" [class.impaye]="payment.effetStatus === 2">
                        {{ payment.effetStatusDisplay | backendLabel }}@if (payment.effetDueDate) {<ng-container i18n="@@supplier-invoices.supplier-invoice-detail.ech.81d3a3bd"> · éch. {{ payment.effetDueDate | date:'dd/MM/yyyy' }} </ng-container>}
                      </span>
                      @if (payment.effetStatus === 0 && canSettleEffet()) {
                        <button type="button" class="effet-btn" [disabled]="settlingEffetId() === payment.id" (click)="onSettleSupplierEffet(payment.id)" i18n="@@supplier-invoices.supplier-invoice-detail.payer.l.effet.cf208e58">Payer l'effet</button>
                      }
                    } @else {
                      -
                    }
                  </td>
                </tr>
              </ng-template>
            </p-table>
            <div class="payment-summary">
              <span class="payment-total" i18n="@@supplier-invoices.supplier-invoice-detail.total.paye.tnd.2a1ae47f">Total payé : {{ inv()!.totalPaid | number:'1.3-3' }} TND</span>
              @if (inv()!.remainingAmount > 0) {
                <span class="payment-remaining" i18n="@@supplier-invoices.supplier-invoice-detail.restant.du.tnd.c7e4f669">Restant dû : {{ inv()!.remainingAmount | number:'1.3-3' }} TND</span>
              }
            </div>
          </div>
        }

        @if (isSupplierInvoicePaid(inv()!.status) && inv()!.paidAt && (!inv()!.payments || inv()!.payments.length === 0)) {
          <div class="detail-card full-width">
            <h3 class="card-title" i18n="@@supplier-invoices.supplier-invoice-detail.paiement.71e341ee"><i class="pi pi-check-circle"></i> Paiement</h3>
            <p class="notes-text"><ng-container i18n="@@supplier-invoices.supplier-invoice-detail.payee.le.1f2531d4">Payée le {{ inv()!.paidAt | date:'dd/MM/yyyy HH:mm' }}</ng-container>@if (inv()!.paymentReference) {<ng-container i18n="@@supplier-invoices.supplier-invoice-detail.ref.cbd76ffa"> — Réf. {{ inv()!.paymentReference }}</ng-container>}.</p>
          </div>
        }

        @if (inv()!.cancellationReason) {
          <div class="detail-card full-width cancelled-card">
            <h3 class="card-title" i18n="@@supplier-invoices.supplier-invoice-detail.annulation.272cfecb"><i class="pi pi-exclamation-triangle"></i> Annulation</h3>
            <p class="notes-text">{{ inv()!.cancellationReason }}</p>
            <p class="cancelled-date" i18n="@@supplier-invoices.supplier-invoice-detail.annulee.le.dda4325a">Annulée le {{ inv()!.cancelledAt | date:'dd/MM/yyyy HH:mm' }}</p>
          </div>
        }
      </div>
    }

    <app-record-payment-dialog
      [panelMode]="true"
      [(visible)]="payDialogVisible"
      [invoiceId]="inv()?.id ?? ''"
      [invoiceNumber]="inv()?.invoiceNumber ?? ''"
      [totalAmount]="inv()?.totalTTC ?? 0"
      [totalPaid]="inv()?.totalPaid ?? 0"
      [remainingAmount]="inv()?.remainingAmount ?? inv()?.totalTTC ?? 0"
      currency="TND"
      invoiceType="supplier"
      (paymentRecorded)="onPaymentRecorded()">
    </app-record-payment-dialog>

    <!-- Cancel dialog -->
    <p-dialog header="Annuler la facture" i18n-header="@@supplier-invoices.supplier-invoice-detail.annuler.la.facture.eb27c2cb" [(visible)]="cancelDialogVisible" [modal]="true" [style]="{ width: '450px' }" [draggable]="false" (onHide)="closeCancelDialog()">
      <p class="dialog-message" i18n="@@supplier-invoices.supplier-invoice-detail.indiquez.le.motif.d.annulation.obligatoire.ac8edb83">Indiquez le motif d'annulation (obligatoire).</p>
      <textarea pTextarea [(ngModel)]="cancelReason" placeholder="Motif..." i18n-placeholder="@@supplier-invoices.supplier-invoice-detail.motif.17487f89" [rows]="4" class="w-full"></textarea>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="closeCancelDialog()" i18n="@@supplier-invoices.supplier-invoice-detail.retour.e5befb1f">Retour</app-button>
        <app-button variant="danger" icon="pi-times" iconPos="left" [disabled]="!cancelReason.trim()" (click)="submitCancel()" i18n="@@supplier-invoices.supplier-invoice-detail.annuler.la.facture.eb27c2cb">Annuler la facture</app-button>
      </ng-template>
    </p-dialog>
  `,
    styles: [`
    .loading-container { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--spacing-12); color: var(--color-text-secondary); gap: var(--spacing-3); }
    .header-actions { display: flex; gap: var(--spacing-2); }
    .detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--spacing-4); }
    .detail-card { background: var(--color-background-elevated); border-radius: var(--radius-xl); padding: var(--spacing-5); box-shadow: var(--shadow-md); border: 1px solid var(--color-border-subtle); }
    .detail-card.full-width { grid-column: 1 / -1; }
    .detail-card.cancelled-card { border-color: var(--color-danger-300); background: var(--color-danger-50, #fef2f2); }
    .card-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin: 0 0 var(--spacing-4) 0; display: flex; align-items: center; gap: var(--spacing-2); }
    .card-title i { color: var(--color-primary-600); }
    .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--spacing-4); }
    .info-item { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .info-item.full-width { grid-column: 1 / -1; }
    .info-item .label { font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
    .info-item .value { font-size: var(--font-size-sm); color: var(--color-text-primary); }
    .info-item .value.mono { font-family: 'JetBrains Mono', monospace; }
    .info-item .value.link { color: var(--color-primary-600); text-decoration: none; }
    .info-item .value.link:hover { text-decoration: underline; }
    .status-item { grid-column: 1 / -1; }
    .status-with-actions { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .card-actions { display: flex; gap: var(--spacing-2); flex-wrap: wrap; }
    .product-info { display: flex; flex-direction: column; gap: 2px; }
    .product-name { font-weight: var(--font-weight-medium); }
    .product-code { font-size: var(--font-size-xs); color: var(--color-neutral-500); font-family: 'JetBrains Mono', monospace; }
    .asset-banner { display: flex; align-items: flex-start; gap: var(--spacing-3); margin-top: var(--spacing-4); margin-bottom: var(--spacing-4); padding: var(--spacing-3) var(--spacing-4); border-radius: var(--radius-lg); border: 1px solid var(--color-primary-200); background: var(--color-primary-50, #eff6ff); font-size: var(--font-size-sm); color: var(--color-primary-800); }
    .asset-banner i { margin-top: 2px; color: var(--color-primary-600); }
    .asset-line { background: color-mix(in srgb, var(--color-primary-50) 40%, transparent); }
    .asset-account { display: block; margin-top: var(--spacing-1); font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .asset-link { display: block; margin-top: var(--spacing-1); font-size: var(--font-size-xs); color: var(--color-primary-600); text-decoration: none; font-weight: var(--font-weight-medium); }
    .asset-link:hover { text-decoration: underline; }
    .line-type-muted { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .amount { font-family: 'JetBrains Mono', monospace; font-weight: var(--font-weight-semibold); }
    .totals-section { margin-top: var(--spacing-4); padding-top: var(--spacing-4); border-top: 2px solid var(--color-border-subtle); display: flex; flex-direction: column; align-items: flex-end; gap: var(--spacing-2); }
    .total-row { display: flex; justify-content: space-between; width: 300px; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .total-row.grand-total { font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); color: var(--color-text-primary); padding-top: var(--spacing-2); border-top: 1px solid var(--color-border-subtle); }
    .total-row.muted-row { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .rs-threshold-banner { align-self: stretch; width: 100%; max-width: 100%; margin-top: var(--spacing-3); padding: var(--spacing-3); border-radius: var(--radius-lg); border: 1px solid var(--color-warning-200); background: var(--color-warning-50, #fffbeb); text-align: start; }
    .rs-threshold-title { margin: 0 0 var(--spacing-2); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .rs-threshold-text { margin: 0 0 var(--spacing-2); font-size: var(--font-size-xs); line-height: 1.55; color: var(--color-text-secondary); }
    .rs-threshold-link { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-primary-600); text-decoration: none; }
    .rs-threshold-link:hover { text-decoration: underline; }
    .tej-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); line-height: 1.5; margin: var(--spacing-3) 0 0; max-width: 420px; text-align: end; align-self: flex-end; }
    .link-inline { margin-inline-start: var(--spacing-2); color: var(--color-primary-600); font-weight: var(--font-weight-medium); }
    .notes-text { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.6; margin: 0; }
    .payment-summary { margin-top: var(--spacing-4); padding-top: var(--spacing-3); border-top: 1px solid var(--color-border-subtle); display: flex; gap: var(--spacing-6); font-size: var(--font-size-sm); }
    .payment-total { font-weight: var(--font-weight-semibold); color: var(--color-success-600); }
    .payment-remaining { font-weight: var(--font-weight-medium); color: var(--color-warning-600); }
    .effet-badge { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); padding: 2px 8px; border-radius: var(--radius-lg); background: var(--color-neutral-100); color: var(--color-text-secondary); }
    .effet-badge.en-portefeuille { background: var(--color-warning-50); color: var(--color-warning-700); }
    .effet-badge.encaisse { background: var(--color-success-50); color: var(--color-success-700); }
    .effet-badge.impaye { background: var(--color-error-50); color: var(--color-error-700); }
    .effet-btn { margin-inline-start: var(--spacing-2); border: 1px solid var(--color-success-200); background: var(--color-white); border-radius: var(--radius-md); padding: 2px 10px; font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--color-success-700); cursor: pointer; }
    .effet-btn:hover:not(:disabled) { background: var(--color-success-50); }
    .effet-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .cancelled-date { font-size: var(--font-size-xs); color: var(--color-danger-600); margin: var(--spacing-2) 0 0; }
    .dialog-message { margin: 0 0 var(--spacing-4) 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .form-group { display: flex; flex-direction: column; gap: var(--spacing-2); margin-bottom: var(--spacing-4); }
    .form-group label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
  `]
})
export class SupplierInvoiceDetailComponent implements OnInit {
  readonly loc_ui_tern_facture_e6d1ea = $localize`:@@ui.tern.facture.e6d1ea:Facture `;
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private service = inject(SupplierInvoiceService);
    private toastService = inject(ToastService);
    private readonly auth = inject(AuthService);

    readonly SupplierInvoiceStatus = SupplierInvoiceStatus;
    readonly isSupplierInvoicePaid = isSupplierInvoicePaid;
    /** Seuil RS7 achats (TND) — aligné sur la valeur par défaut backend ; paramétrage fiscal par exercice possible côté serveur. */
    readonly rs7TtcThresholdTnd = 1000;
    loading = signal(true);
    inv = signal<SupplierInvoiceDetail | null>(null);
    payDialogVisible = false;
    cancelDialogVisible = false;
    cancelReason = '';

    breadcrumbItems: BreadcrumbItem[] = [
        { label: $localize`:@@supplier-invoices.supplier-invoice-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
        { label: $localize`:@@supplier-invoices.supplier-invoice-detail.ts.factures.fournisseurs.1dcbc2ed:Factures fournisseurs`, route: '/supplier-invoices' },
        { label: $localize`:@@supplier-invoices.supplier-invoice-detail.ts.detail.7ce06afc:Détail` }
    ];

    private get unpaidOnlyFromRoute(): boolean {
        return this.route.snapshot.data['unpaidOnly'] === true;
    }

    private get listBackRoute(): string {
        return this.unpaidOnlyFromRoute ? '/supplier-invoices/unpaid' : '/supplier-invoices';
    }

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) this.loadInvoice(id);
    }

    private buildBreadcrumb(invoiceNumber: string): BreadcrumbItem[] {
        const base: BreadcrumbItem[] = [
            { label: $localize`:@@supplier-invoices.supplier-invoice-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
            { label: $localize`:@@supplier-invoices.supplier-invoice-detail.ts.factures.fournisseurs.1dcbc2ed:Factures fournisseurs`, route: '/supplier-invoices' }
        ];
        if (this.unpaidOnlyFromRoute) {
            base.push({ label: $localize`:@@supplier-invoices.supplier-invoice-detail.ts.factures.impayees.dc3cffa5:Factures impayées`, route: '/supplier-invoices/unpaid' });
        }
        base.push({ label: invoiceNumber });
        return base;
    }

    private loadInvoice(id: string): void {
        this.service.getSupplierInvoice(id).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.inv.set(response.data);
                    this.breadcrumbItems = this.buildBreadcrumb(response.data.invoiceNumber);
                }
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-invoice-detail.component.summary.Erreur:Erreur`, detail: $localize`:@@supplier-invoice-detail.component.detail.Facture_introuva:Facture introuvable` });
                this.router.navigate([this.listBackRoute]);
            }
        });
    }

    isStandaloneInvoice(): boolean {
        const invoice = this.inv();
        return !!invoice && !invoice.purchaseOrderId && !invoice.sourcePurchaseReceiptId;
    }

    getStatusSeverity(s: SupplierInvoiceStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
        switch (s) {
            case SupplierInvoiceStatus.Pending: return 'warn';
            case SupplierInvoiceStatus.Paid: return 'success';
            case SupplierInvoiceStatus.Cancelled: return 'danger';
            case SupplierInvoiceStatus.PartiallyPaid: return 'info';
            default: return 'secondary';
        }
    }

    canShowPaymentButton(): boolean {
        return isSupplierInvoiceOpenForPayment(this.inv()?.status);
    }

    canRecordSupplierPayment(): boolean {
        return isSupplierInvoiceOpenForPayment(this.inv()?.status)
            && !this.auth.isFirmDelegatedReadonly();
    }

    hasFixedAssetLines(): boolean {
        return this.inv()?.lines?.some(l => l.isFixedAsset) ?? false;
    }

    openPayDialog(): void {
        if (this.auth.isFirmDelegatedReadonly()) return;
        this.payDialogVisible = true;
    }

    onPaymentRecorded(): void {
        const invoice = this.inv();
        if (invoice) {
            this.toastService.add({ severity: 'success', summary: $localize`:@@supplier-invoice-detail.component.summary.Succès:Succès`, detail: $localize`:@@supplier-invoice-detail.component.detail.Paiement_enregis:Paiement enregistré avec succès` });
            this.loadInvoice(invoice.id);
        }
    }

    readonly settlingEffetId = signal<string | null>(null);

    canSettleEffet(): boolean {
        return !this.auth.isFirmDelegatedReadonly();
    }

    /** Paie un effet fournisseur à échéance (403/532). */
    onSettleSupplierEffet(paymentId: string): void {
        if (this.settlingEffetId()) return;
        if (this.auth.isFirmDelegatedReadonly()) return;
        const invoice = this.inv();
        if (!invoice) return;

        this.settlingEffetId.set(paymentId);
        this.service.settleEffet(invoice.id, paymentId, { settlementDate: formatLocalDate(new Date()) }).subscribe({
            next: (res) => {
                this.settlingEffetId.set(null);
                if (res.success) {
                    this.toastService.add({ severity: 'success', summary: $localize`:@@supplier-invoice-detail.component.summary.Effet payé:Effet payé`, detail: $localize`:@@supplier-invoice-detail.component.detail.Effet_fournisseu:Effet fournisseur payé avec succès` });
                    this.loadInvoice(invoice.id);
                } else {
                    this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-invoice-detail.component.summary.Erreur:Erreur`, detail: res.message ?? $localize`:@@ui.tern.echec.du.paiement.de.l.effet.c57e3a:Échec du paiement de l'effet` });
                }
            },
            error: () => {
                this.settlingEffetId.set(null);
                this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-invoice-detail.component.summary.Erreur:Erreur`, detail: $localize`:@@supplier-invoice-detail.component.detail._chec_du_paiemen:Échec du paiement de l'effet` });
            }
        });
    }

    openCancelDialog(): void {
        this.cancelReason = '';
        this.cancelDialogVisible = true;
    }

    closeCancelDialog(): void {
        this.cancelDialogVisible = false;
        this.cancelReason = '';
    }

    submitCancel(): void {
        const invoice = this.inv();
        const reason = this.cancelReason?.trim();
        if (!invoice || !reason) return;
        this.service.cancel(invoice.id, reason).subscribe({
            next: (response) => {
                if (response.success) {
                    this.closeCancelDialog();
                    this.toastService.add({ severity: 'success', summary: $localize`:@@supplier-invoice-detail.component.summary.Succès:Succès`, detail: $localize`:@@supplier-invoice-detail.component.detail.Facture_annul_e:Facture annulée` });
                    this.loadInvoice(invoice.id);
                }
            },
            error: (err) => this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-invoice-detail.component.summary.Erreur:Erreur`, detail: err?.error?.errors?.[0] || $localize`:@@supplier-invoices.supplier-invoice-detail.ts.erreur.ab546c23:Erreur` })
        });
    }
}
