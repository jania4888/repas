/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { SkeletonModule } from 'primeng/skeleton';
import { TimelineModule } from 'primeng/timeline';
import { DialogModule } from 'primeng/dialog';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { MenuItem } from '@shared/models/menu-item.model';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DocumentActionsMenuComponent } from '@shared/components/document-actions-menu/document-actions-menu.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { RecordPaymentDialogComponent } from '@shared/components/record-payment-dialog/record-payment-dialog.component';
import { InvoiceService, InvoiceDetail } from '@core/services/invoice.service';
import { formatLocalDate } from '@core/utils/date.util';
import { ProductService } from '@core/services/product.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import {
  StockService,
  StockFeatures,
  StockAvailabilityCheck,
  ProductAvailabilityDetail
} from '@core/services/stock.service';
import { StockAllocationEditorComponent } from '@shared/components/stock-allocation-editor/stock-allocation-editor.component';
import {
  AllocationRow,
  ExitLotAvailability,
  LotStockValidity,
  buildExitAllocationPayload,
  exitAllocationsValid,
  exitTraceabilityReady,
  lineMissingWarehouseLots,
  lineMissingWarehouseSerials,
  lineBlockedByExpiredLots,
  showLotSection,
  showSerialSection,
  createDefaultLotRow,
  createDefaultSerialRow,
  coercePickingPolicy,
  coerceTrackingMode,
  TRACKING_MODE_SERIAL,
  shouldBlockInvoiceValidateForStock
} from '@shared/utils/stock-traceability.utils';
import {
  isValidateLineInsufficient as isValidateLineInsufficientFn,
  isValidateLineWarning as isValidateLineWarningFn,
  lineImpactDisplay,
  LineImpactDisplay
} from '@shared/utils/invoice-validate-display.utils';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

interface TimelineEvent {
  status: string;
  date: string | null;
  icon: string;
  color: string;
}

@Component({
  selector: 'app-invoice-detail',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    FormsModule,
    RouterModule,
    ButtonModule,
    CardModule,
    TagModule,
    DividerModule,
    TableModule,
    TooltipModule,
    ConfirmDialogModule,
    ToastModule,
    SkeletonModule,
    TimelineModule,
    DialogModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    DocumentActionsMenuComponent,
    StatusBadgeComponent,
    RecordPaymentDialogComponent,
    StockAllocationEditorComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    
    <app-page-header 
      [title]="invoice()?.number || 'Chargement...'" 
      [subtitle]="loc_ui_tern_facture_du_17b440 + (invoice()?.issueDate | date:'dd/MM/yyyy')">
      <app-button 
        variant="outline"
        icon="pi-arrow-left"
        iconPos="left"
        [routerLink]="listBackRoute" i18n="@@invoices.invoice-detail.retour.e5befb1f"> Retour </app-button>
      @if (primaryAction(); as action) {
        <app-button
          [variant]="action.variant"
          [icon]="action.icon"
          iconPos="left"
          (clicked)="action.command()">
          {{ action.label }}
        </app-button>
      }
      @if (invoice()) {
        <app-document-actions-menu [items]="menuItems" />
      }
    </app-page-header>

    @if (loading()) {
      <div class="detail-grid">
        <div class="main-content">
          <p-card>
            <p-skeleton height="2rem" styleClass="mb-4"></p-skeleton>
            <p-skeleton height="1rem" styleClass="mb-2" width="60%"></p-skeleton>
            <p-skeleton height="1rem" styleClass="mb-2" width="40%"></p-skeleton>
            <p-skeleton height="10rem"></p-skeleton>
          </p-card>
        </div>
        <div class="sidebar">
          <p-skeleton height="12rem" styleClass="mb-4"></p-skeleton>
          <p-skeleton height="8rem"></p-skeleton>
        </div>
      </div>
    } @else if (invoice()) {
      <div class="detail-grid">
        <!-- Main Content -->
        <div class="main-content">
          <!-- Invoice Preview -->
          <p-card styleClass="invoice-card">
            <!-- Header -->
            <div class="invoice-header">
              <div class="invoice-meta">
                <h2>{{ invoice()!.number }}</h2>
                <span class="doc-type-badge"
                      [class.doc-type-badge-avoir]="invoice()!.isCreditNote"
                      [class.doc-type-badge-facture]="!invoice()!.isCreditNote">
                  {{ invoice()!.isCreditNote ? loc_ui_tern_facture_d_avoir_541e44 : loc_ui_tern_facture_3953b9 }}
                </span>
                <app-status-badge
                  [status]="getStatusBadgeStatus(invoice()!.status)"
                  [label]="invoice()!.statusDisplay | backendLabel">
                </app-status-badge>
              </div>
              <div class="invoice-dates">
                <div class="date-item">
                  <span class="label" i18n="@@invoices.invoice-detail.date.d.emission.99f68857">Date d'émission</span>
                  <span class="value">{{ invoice()!.issueDate | date:'dd/MM/yyyy' }}</span>
                </div>
                @if (invoice()!.dueDate) {
                  <div class="date-item">
                    <span class="label" i18n="@@invoices.invoice-detail.echeance.f9a77ff6">Échéance</span>
                    <span class="value" [class.overdue]="isOverdue()">
                      {{ invoice()!.dueDate | date:'dd/MM/yyyy' }}
                    </span>
                  </div>
                }
              </div>
            </div>

            <p-divider></p-divider>

            <!-- Parties -->
            <div class="parties-grid">
              <div class="party-card">
                <h4 i18n="@@invoices.invoice-detail.client.1bdd79b1">Client</h4>
                <p class="party-name">{{ invoice()!.client.name }}</p>
                <p class="party-address">{{ invoice()!.client.address }}</p>
                @if (invoice()!.client.nif) {
                  <p class="party-nif">MF: {{ invoice()!.client.nif }}</p>
                }
                <p class="party-email">{{ invoice()!.client.email }}</p>
              </div>
            </div>

            <p-divider></p-divider>

            <!-- Lines -->
            <div class="lines-section">
              <h4 i18n="@@invoices.invoice-detail.lignes.de.facturation.5896ee38">Lignes de facturation</h4>
              <table class="lines-table">
                <thead>
                  <tr>
                    <th i18n="@@invoices.invoice-detail.text.d08f88df">#</th>
                    <th i18n="@@invoices.invoice-detail.designation.63a9062c">Désignation</th>
                    <th class="text-right" i18n="@@invoices.invoice-detail.quantite.09a38fda">Quantité</th>
                    <th class="text-right" i18n="@@invoices.invoice-detail.prix.unitaire.3e848c96">Prix unitaire</th>
                    <th class="text-center" i18n="@@invoices.invoice-detail.tva.fb62cb5d">TVA</th>
                    <th class="text-right" i18n="@@invoices.invoice-detail.total.ht.2ca17ae6">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of invoice()!.lines; track line.id) {
                    <tr>
                      <td>{{ line.lineNumber }}</td>
                      <td>
                        <span class="line-name">{{ line.productName }}</span>
                        @if (line.productDescription) {
                          <br><small class="line-desc">{{ line.productDescription }}</small>
                        }
                      </td>
                      <td class="text-right">{{ line.quantity | number:'1.0-3' }} {{ line.unit }}</td>
                      <td class="text-right mono">{{ line.unitPrice | number:'1.3-3' }}</td>
                      <td class="text-center">{{ line.vatRatePercent }}%</td>
                      <td class="text-right mono">{{ line.subTotal | number:'1.3-3' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Totals -->
            <div class="totals-section">
              <div class="vat-breakdown">
                <h5 i18n="@@invoices.invoice-detail.recapitulatif.tva.0918d3bc">Récapitulatif TVA</h5>
                @for (vat of invoice()!.vatBreakdown; track vat.rate) {
                  <div class="vat-row">
                    <span>{{ vat.rateDisplay | backendLabel }}</span>
                    <span class="mono">{{ vat.baseAmount | number:'1.3-3' }}</span>
                    <span class="mono">{{ vat.vatAmount | number:'1.3-3' }}</span>
                  </div>
                }
              </div>

              <div class="totals-box" [class.totals-box-avoir]="invoice()!.isCreditNote">
                <div class="total-row">
                  <span>{{ invoice()!.isCreditNote ? loc_ui_tern_total_ht_a_rembourser_a8f25c : loc_ui_tern_total_ht_2ca17a }}</span>
                  <span class="mono">{{ invoice()!.subTotal | number:'1.3-3' }} {{ invoice()!.currency }}</span>
                </div>
                <div class="total-row">
                  <span>{{ invoice()!.isCreditNote ? loc_ui_tern_total_tva_a_rembourser_a5ddaa : loc_ui_tern_total_tva_605c4b }}</span>
                  <span class="mono">{{ invoice()!.totalVat | number:'1.3-3' }} {{ invoice()!.currency }}</span>
                </div>
                @if ((invoice()!.fodecAmount ?? 0) > 0.0005 || (invoice()!.fodecAmount ?? 0) < -0.0005) {
                  <div class="total-row">
                    <span>{{ invoice()!.isCreditNote ? loc_ui_tern_fodec_a_rembourser_bca3c0 : loc_ui_tern_fodec_9a0290 }}</span>
                    <span class="mono">{{ invoice()!.fodecAmount | number:'1.3-3' }} {{ invoice()!.currency }}</span>
                  </div>
                }
                @if ((invoice()!.fiscalStampAmount ?? 0) > 0.0005 || (invoice()!.fiscalStampAmount ?? 0) < -0.0005) {
                  <div class="total-row">
                    <span i18n="@@invoices.invoice-detail.timbre.fiscal.1f8f7dd1">Timbre fiscal</span>
                    <span class="mono">{{ invoice()!.fiscalStampAmount | number:'1.3-3' }} {{ invoice()!.currency }}</span>
                  </div>
                }
                <div class="total-row grand">
                  <span>{{ invoice()!.isCreditNote ? loc_ui_tern_total_ttc_a_rembourser_1ef7ef : loc_ui_tern_total_ttc_9e80ff }}</span>
                  <span class="mono">{{ invoice()!.totalAmount | number:'1.3-3' }} {{ invoice()!.currency }}</span>
                </div>
              </div>
            </div>

            @if (invoice()!.notes || invoice()!.paymentTerms) {
              <p-divider></p-divider>
              <div class="notes-section">
                @if (invoice()!.paymentTerms) {
                  <div class="note">
                    <strong i18n="@@invoices.invoice-detail.conditions.de.paiement.34f8dab1">Conditions de paiement:</strong> {{ invoice()!.paymentTerms }}
                  </div>
                }
                @if (invoice()!.notes) {
                  <div class="note">
                    <strong i18n="@@invoices.invoice-detail.notes.9c3befe7">Notes:</strong> {{ invoice()!.notes }}
                  </div>
                }
              </div>
            }
          </p-card>
        </div>

        <!-- Sidebar -->
        <div class="sidebar">
          <!-- Status Card -->
          <p-card header="Statut" i18n-header="@@invoices.invoice-detail.statut.659499f3" styleClass="status-card">
            <div class="status-content">
              <app-status-badge 
                [status]="getStatusBadgeStatus(invoice()!.status)"
                [label]="invoice()!.statusDisplay | backendLabel">
              </app-status-badge>
            </div>
          </p-card>

          <!-- Timeline Card -->
          <p-card header="Historique" i18n-header="@@invoices.invoice-detail.historique.34f3a06a" styleClass="timeline-card">
            <p-timeline [value]="timeline" styleClass="custom-timeline">
              <ng-template pTemplate="content" let-event>
                <div class="timeline-event">
                  <span class="event-label">{{ event.status }}</span>
                  @if (event.date) {
                    <span class="event-date">{{ event.date | date:'dd/MM/yyyy HH:mm' }}</span>
                  }
                </div>
              </ng-template>
              <ng-template pTemplate="marker" let-event>
                <span class="timeline-marker" [style.background]="event.color">
                  <i [class]="event.icon"></i>
                </span>
              </ng-template>
            </p-timeline>
          </p-card>

          <!-- Payment History Card -->
          <p-card header="Historique des paiements" i18n-header="@@invoices.invoice-detail.historique.des.paiements.38e1285d" styleClass="payments-card">
            @if (invoice()!.payments && invoice()!.payments!.length > 0) {
              <div class="payments-list">
                @for (payment of invoice()!.payments; track payment.id) {
                  <div class="payment-row" [class.refunded]="payment.isRefunded">
                    <div class="payment-main">
                      <span class="payment-amount">{{ payment.amount | number:'1.3-3' }} {{ payment.currency }}</span>
                      <span class="payment-date">{{ payment.paymentDate | date:'dd/MM/yyyy' }}</span>
                    </div>
                    <div class="payment-meta">
                      <span class="payment-method">{{ payment.methodDisplay | backendLabel }}</span>
                      @if (payment.reference) {
                        <span class="payment-ref">{{ payment.reference }}</span>
                      }
                    </div>
                    @if (payment.clientWithholdingAmount && payment.clientWithholdingAmount > 0) {
                      <div class="payment-withholding">
                        <i class="pi pi-percentage"></i>
                        <span>RS subie : {{ payment.clientWithholdingAmount | number:'1.3-3' }} {{ payment.currency }}</span>
                      </div>
                    }
                    @if (payment.effetStatus !== null && payment.effetStatus !== undefined) {
                      <div class="payment-effet">
                        <span class="effet-badge" [class.en-portefeuille]="payment.effetStatus === 0" [class.encaisse]="payment.effetStatus === 1" [class.impaye]="payment.effetStatus === 2">
                          <i class="pi pi-file"></i>
                          Effet {{ payment.effetStatusDisplay | backendLabel }}
                          @if (payment.effetDueDate) {
                            <span class="effet-due"> · échéance {{ payment.effetDueDate | date:'dd/MM/yyyy' }}</span>
                          }
                        </span>
                        @if (payment.effetStatus === 0 && !payment.isRefunded && canSettleEffet()) {
                          <span class="effet-actions">
                            <button type="button" class="effet-btn encaisse" [disabled]="settlingEffetId() === payment.id" (click)="onSettleClientEffet(payment.id, 1)" i18n="@@invoices.invoice-detail.encaisser.fec08f89">Encaisser</button>
                            <button type="button" class="effet-btn impaye" [disabled]="settlingEffetId() === payment.id" (click)="onSettleClientEffet(payment.id, 2)" i18n="@@invoices.invoice-detail.impaye.3f8d3329">Impayé</button>
                          </span>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
              <div class="payments-summary">
                <div class="summary-row">
                  <span i18n="@@invoices.invoice-detail.total.paye.57d30be5">Total payé</span>
                  <span class="mono">{{ (invoice()!.totalPaid ?? 0) | number:'1.3-3' }} {{ invoice()!.currency }}</span>
                </div>
                @if ((invoice()!.totalClientWithholding ?? 0) > 0) {
                  <div class="summary-row withholding">
                    <span i18n="@@invoices.invoice-detail.retenue.subie.f31725ab">Retenue subie</span>
                    <span class="mono">{{ invoice()!.totalClientWithholding | number:'1.3-3' }} {{ invoice()!.currency }}</span>
                  </div>
                }
                @if ((invoice()!.remainingAmount ?? 0) > 0) {
                  <div class="summary-row remaining">
                    <span i18n="@@invoices.invoice-detail.restant.du.e9a8119c">Restant dû</span>
                    <span class="mono">{{ invoice()!.remainingAmount | number:'1.3-3' }} {{ invoice()!.currency }}</span>
                  </div>
                }
              </div>
            } @else {
              <div class="payments-empty">
                <i class="pi pi-wallet"></i>
                <p i18n="@@invoices.invoice-detail.aucun.paiement.enregistre.eefa82df">Aucun paiement enregistré</p>
              </div>
            }

             @if (canRecordPayment(invoice()!)) {
                <app-button 
                  variant="primary"
                  icon="pi-wallet"
                  iconPos="left"
                  (click)="openRecordPaymentDialog()"
                  style="width: 100%; margin-bottom: var(--spacing-2);" i18n="@@invoices.invoice-detail.enregistrer.un.paiement.72dddba2"> Enregistrer un paiement </app-button>
              }
          </p-card>

          <app-record-payment-dialog
            [panelMode]="true"
            [(visible)]="recordPaymentDialogVisible"
            [invoiceId]="invoice()?.id ?? ''"
            [invoiceNumber]="invoice()?.number ?? ''"
            [totalAmount]="invoice()?.totalAmount ?? 0"
            [totalPaid]="invoice()?.totalPaid ?? 0"
            [remainingAmount]="invoice()?.remainingAmount ?? (invoice()?.totalAmount ?? 0)"
            [currency]="invoice()?.currency ?? loc_ui_tern_tnd_51da21"
            invoiceType="client"
            (paymentRecorded)="onPaymentRecorded()">
          </app-record-payment-dialog>

          <!-- Signature Info -->
          @if (invoice()!.signatureHash) {
            <p-card header="Signature électronique" i18n-header="@@invoices.invoice-detail.signature.electronique.513a9511" styleClass="signature-card">
              <div class="signature-info">
                <div class="info-row">
                  <i class="pi pi-verified"></i>
                  <span i18n="@@invoices.invoice-detail.facture.signee.electroniquement.ec353a3c">Facture signée électroniquement</span>
                </div>
                <div class="hash-display">
                  <code>{{ invoice()!.signatureHash!.substring(0, 20) }}...</code>
                </div>
                <small>Signé le {{ invoice()!.signedAt | date:'dd/MM/yyyy HH:mm' }}</small>
              </div>
            </p-card>
          }
        </div>
      </div>

      <p-dialog
        header="Valider la facture" i18n-header="@@invoices.invoice-detail.valider.la.facture.04848f44"
        [(visible)]="showValidateDialog"
        [modal]="true"
        styleClass="ft-dialog-scrollable"
        [style]="{ width: '920px', maxWidth: '95vw' }"
        [draggable]="false"
        [resizable]="false">
        <p class="validate-dialog-hint">
          Confirmez la validation de {{ invoice()!.number }}. Sélectionnez les lots ou numéros de série si nécessaire.
        </p>
        @if (!invoice()!.isCreditNote) {
          @if (validateWarehouseLabel()) {
            <p class="validate-warehouse-banner">
              <ng-container i18n="@@invoices.invoice-detail.deduction.de.stock.depuis.49a643b4"> Déduction de stock depuis : </ng-container> <strong>{{ validateWarehouseLabel() }}</strong>
              @if (validateWarehouseIsDefault()) {
                <span class="validate-default-badge" i18n="@@invoices.invoice-detail.par.defaut.feee7660">par défaut</span>
              }
            </p>
          }
          @if (validateContextLoading()) {
            <p class="validate-loading muted">
              <i class="pi pi-spin pi-spinner"></i>
              Vérification du stock…
            </p>
          } @else if (validateContextError()) {
            <div class="validate-stock-alert validate-stock-alert--error" role="alert">
              <i class="pi pi-exclamation-circle"></i>
              <span>{{ validateContextError() }}</span>
            </div>
          } @else {
            @if (validateStockBlocked()) {
              <div class="validate-stock-alert validate-stock-alert--error" role="alert">
                <i class="pi pi-times-circle"></i>
                <div>
                  <p>{{ validateStockCheck()?.summaryMessage || 'Aucun stock trouvé pour un produit dans cet entrepôt.' }}</p>
                  <p i18n="@@invoices.invoice-detail.ajoutez.du.stock.dans.cet.entrepot.avant.de.vali.0fa91ed7">Ajoutez du stock dans cet entrepôt avant de valider.</p>
                  <a routerLink="/stock" (click)="showValidateDialog = false" i18n="@@invoices.invoice-detail.ajouter.du.stock.b3d3468f">Ajouter du stock</a>
                </div>
              </div>
            } @else if (hasMissingWarehouseLots()) {
              <div class="validate-stock-alert validate-stock-alert--error" role="alert">
                <i class="pi pi-times-circle"></i>
                <div>
                  @if (hasOnlyExpiredWarehouseLots()) {
                    <p i18n="@@invoices.invoice-detail.tous.les.lots.disponibles.sont.perimes.pour.au.m.d7718b50">Tous les lots disponibles sont périmés pour au moins un article suivi. Ils ne peuvent pas sortir.</p>
                    <p i18n="@@invoices.invoice-detail.choisissez.un.lot.non.perime.ou.receptionnez.un..89ff9112">Choisissez un lot non périmé, ou réceptionnez un lot valide avant de valider.</p>
                  } @else {
                    <p i18n="@@invoices.invoice-detail.le.stock.de.cet.entrepot.n.a.pas.de.lots.ou.de.n.de44cfd5">Le stock de cet entrepôt n'a pas de lots (ou de n° de série) pour au moins un article suivi.</p>
                    <p i18n="@@invoices.invoice-detail.receptionnez.d.abord.le.stock.avec.un.n.de.lot.o.2b6eba9f">Réceptionnez d'abord le stock avec un n° de lot, ou faites un inventaire d'ouverture.</p>
                  }
                </div>
              </div>
            } @else if ((validateStockCheck()?.insufficientCount ?? 0) > 0) {
              <div class="validate-stock-alert validate-stock-alert--warning" role="status">
                <i class="pi pi-exclamation-triangle"></i>
                <span>{{ validateStockCheck()?.summaryMessage }}</span>
              </div>
            }
            @if (needsStockAllocationOnValidate()) {
              <div class="validate-lines-table-wrap">
                <table class="validate-lines-table" aria-label="Lignes à déduire du stock" i18n-aria-label="@@invoices.invoice-detail.lignes.a.deduire.du.stock.cb3a69b2">
                  <thead>
                    <tr>
                      <th i18n="@@invoices.invoice-detail.produit.ff673dc2">Produit</th>
                      <th class="text-right" i18n="@@invoices.invoice-detail.quantite.09a38fda">Quantité</th>
                      <th class="text-right" i18n="@@invoices.invoice-detail.stock.disponible.4b508081">Stock disponible</th>
                      <th i18n="@@invoices.invoice-detail.impact.62036a70">Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (lineForm of validateLineForms; track lineForm.lineId) {
                      @let avail = lineAvailability(lineForm.productId);
                      @let impact = lineImpact(lineForm.productId);
                      <tr [class.validate-row-insufficient]="isValidateLineInsufficient(lineForm.productId)"
                          [class.validate-row-warning]="isValidateLineWarning(lineForm.productId)">
                        <td>{{ lineForm.designation }}</td>
                        <td class="text-right mono">{{ lineForm.quantity | number:'1.0-3' }}</td>
                        <td class="text-right mono">
                          @if (avail && avail.isStockManaged) {
                            {{ avail.availableQuantity | number:'1.0-3' }}
                          } @else {
                            —
                          }
                        </td>
                        <td class="validate-line-impact"
                            [class.validate-impact-error]="impact.tone === 'error'"
                            [class.validate-impact-warning]="impact.tone === 'warning'">
                          @if (impact.quantityKind === 'remaining') {
                            Restera {{ impact.quantity | number:'1.0-3' }}
                          } @else if (impact.quantityKind === 'available') {
                            Stock insuffisant ({{ impact.quantity | number:'1.0-3' }} dispo)
                          } @else {
                            {{ impact.text }}
                          }
                        </td>
                      </tr>
                      @if (showValidateLineTraceability(lineForm) && validateEffectiveWarehouseId()) {
                        <tr class="validate-alloc-row">
                          <td colspan="4">
                            <app-stock-allocation-editor
                              mode="exit"
                              [productId]="lineForm.productId"
                              [warehouseId]="validateEffectiveWarehouseId()!"
                              [lineQuantity]="lineForm.quantity"
                              [trackingMode]="lineForm.trackingMode"
                              [pickingPolicy]="lineForm.pickingPolicy"
                              [hasExpiryTracking]="lineForm.hasExpiryTracking"
                              [features]="stockFeatures()"
                              [allocations]="lineForm.lotAllocations"
                              (availabilityChange)="onValidateAllocAvailability($event)"
                              (lotStockValidChange)="onValidateLotStockValid($event)" />
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            }
            @if (validateSubmitError()) {
              <div class="validate-stock-alert validate-stock-alert--error" role="alert">
                <i class="pi pi-exclamation-circle"></i>
                <span>{{ validateSubmitError() }}</span>
              </div>
            }
          }
        }
        <ng-template pTemplate="footer">
          <div class="dialog-footer">
            <app-button variant="outline" icon="pi-times" (click)="showValidateDialog = false" i18n="@@invoices.invoice-detail.annuler.49ba3292">Annuler</app-button>
            <app-button variant="primary" icon="pi-check" [disabled]="!isValidateFormValid()" (click)="submitValidate()" i18n="@@invoices.invoice-detail.valider.be4220f7"> Valider </app-button>
          </div>
        </ng-template>
      </p-dialog>
    } @else {
      <div class="not-found">
        <i class="pi pi-exclamation-triangle"></i>
        <h2 i18n="@@invoices.invoice-detail.facture.non.trouvee.913f17a8">Facture non trouvée</h2>
        <p i18n="@@invoices.invoice-detail.la.facture.demandee.n.existe.pas.ou.a.ete.suppri.09ba20fa">La facture demandée n'existe pas ou a été supprimée.</p>
        <app-button variant="primary" [routerLink]="listBackRoute" i18n="@@invoices.invoice-detail.retour.a.la.liste.7753f531">Retour à la liste</app-button>
      </div>
    }

  `,
  styles: [`
    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: var(--spacing-6);

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .main-content {
      min-width: 0;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .invoice-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: var(--spacing-4);
    }

    .invoice-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-2);

      h2 {
        margin: 0;
        font-family: 'JetBrains Mono', monospace;
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--color-text-primary);
      }
    }

    .doc-type-badge {
      display: inline-flex;
      align-items: center;
      padding: var(--spacing-1) var(--spacing-3);
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.04em;

      &.doc-type-badge-facture {
        background: var(--color-primary-50);
        color: var(--color-primary-700);
      }

      &.doc-type-badge-avoir {
        background: var(--color-error-50, #fee2e2);
        color: var(--color-error-700, #b91c1c);
        border: 1px solid var(--color-error-200, #fecaca);
      }
    }

    .invoice-dates {
      display: flex;
      gap: var(--spacing-6);
    }

    .date-item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      .label {
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }

      .value {
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);

        &.overdue {
          color: var(--color-error-600);
        }
      }
    }

    .parties-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: var(--spacing-4);
      margin: var(--spacing-4) 0;
    }

    .party-card {
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);

      h4 {
        margin: 0 0 var(--spacing-2);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }

      .party-name {
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
        margin: 0 0 var(--spacing-2);
      }

      .party-address,
      .party-email {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        margin: 0 0 var(--spacing-1);
      }

      .party-nif {
        font-family: 'JetBrains Mono', monospace;
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        margin: 0 0 var(--spacing-1);
      }
    }

    .lines-section {
      h4 {
        margin: 0 0 var(--spacing-4);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }
    }

    .lines-table {
      width: 100%;
      border-collapse: collapse;

      th {
        padding: var(--spacing-4) var(--spacing-3);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-secondary);
        text-align: left;
        border-bottom: 2px solid var(--color-border-default);
        background: var(--color-background-subtle);
      }

      td {
        padding: var(--spacing-4) var(--spacing-3);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        border-bottom: 1px solid var(--color-border-subtle);
        vertical-align: top;
      }

      .line-name {
        font-weight: var(--font-weight-medium);
      }

      .line-desc {
        color: var(--color-text-tertiary);
      }

      .mono {
        font-family: 'JetBrains Mono', monospace;
      }

      .text-right {
        text-align: right;
      }

      .text-center {
        text-align: center;
      }
    }

    .totals-section {
      display: flex;
      justify-content: space-between;
      gap: var(--spacing-6);
      margin-top: var(--spacing-4);

      @media (max-width: 768px) {
        flex-direction: column;
      }
    }

    .vat-breakdown {
      h5 {
        margin: 0 0 var(--spacing-3);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-secondary);
      }

      .vat-row {
        display: flex;
        gap: var(--spacing-4);
        font-size: var(--font-size-sm);
        padding: var(--spacing-1) 0;
      }
    }

    .totals-box {
      min-width: 280px;
      padding: var(--spacing-4);
      background: var(--color-primary-50);
      border-radius: var(--radius-lg);

      &.totals-box-avoir {
        background: var(--color-error-50, #fee2e2);
        border: 1px solid var(--color-error-200, #fecaca);

        .total-row.grand {
          border-top-color: var(--color-error-200, #fecaca);
          color: var(--color-error-700, #b91c1c);
        }
      }
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      padding: var(--spacing-2) 0;
      font-size: var(--font-size-sm);

      &.grand {
        margin-top: var(--spacing-2);
        padding-top: var(--spacing-3);
        border-top: 2px solid var(--color-primary-200);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        color: var(--color-primary-700);
      }

      .mono {
        font-family: 'JetBrains Mono', monospace;
        font-weight: var(--font-weight-semibold);
      }
    }

    .notes-section {
      .note {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-600);
        margin-bottom: var(--spacing-2);

        strong {
          color: var(--color-neutral-700);
        }
      }
    }

    .status-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-4);

      .status-tag {
        font-size: var(--font-size-base);
        padding: var(--spacing-2) var(--spacing-4);
      }
    }

    .status-actions {
      display: flex;
      gap: var(--spacing-2);
    }

    .timeline-event {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      .event-label {
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-800);
      }

      .event-date {
        font-size: var(--font-size-xs);
        color: var(--color-neutral-500);
      }
    }

    .timeline-marker {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      color: white;

      i {
        font-size: 12px;
      }
    }

    .quick-actions {
      display: flex;
      flex-direction: column;
    }

    .payments-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-4);
    }

    .payment-row {
      padding: var(--spacing-3);
      background: var(--color-neutral-50);
      border-radius: var(--radius-md);
      border-left: 3px solid var(--color-success-500);

      &.refunded {
        opacity: 0.7;
        border-left-color: var(--color-neutral-400);
      }
    }

    .payment-main {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-1);
    }

    .payment-amount {
      font-weight: var(--font-weight-semibold);
      font-family: 'JetBrains Mono', monospace;
      color: var(--color-text-primary);
    }

    .payment-date {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .payment-meta {
      display: flex;
      gap: var(--spacing-2);
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .payment-withholding {
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
      margin-top: var(--spacing-1);
      font-size: var(--font-size-xs);
      color: var(--color-warning-600);
      font-weight: var(--font-weight-medium);

      i {
        font-size: 0.65rem;
      }
    }

    .payment-effet {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-2);
    }

    .effet-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      padding: 2px 8px;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);

      i { font-size: 0.65rem; }
      &.en-portefeuille { background: var(--color-warning-50); color: var(--color-warning-700); }
      &.encaisse { background: var(--color-success-50); color: var(--color-success-700); }
      &.impaye { background: var(--color-error-50); color: var(--color-error-700); }
    }

    .effet-due { opacity: 0.85; }

    .effet-actions {
      display: inline-flex;
      gap: var(--spacing-2);
    }

    .effet-btn {
      border: 1px solid var(--color-border-subtle);
      background: var(--color-white);
      border-radius: var(--radius-md);
      padding: 2px 10px;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      transition: all 150ms ease;

      &:disabled { opacity: 0.5; cursor: not-allowed; }
      &.encaisse { color: var(--color-success-700); border-color: var(--color-success-200); }
      &.encaisse:hover:not(:disabled) { background: var(--color-success-50); }
      &.impaye { color: var(--color-error-700); border-color: var(--color-error-200); }
      &.impaye:hover:not(:disabled) { background: var(--color-error-50); }
    }

    .payments-summary {
      padding-top: var(--spacing-3);
      border-top: 1px solid var(--color-border-subtle);
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: var(--spacing-1) 0;
      font-size: var(--font-size-sm);

      &.remaining {
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary-600);
      }

      &.withholding {
        color: var(--color-warning-600);
        font-style: italic;
      }
    }

    .payments-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-6);
      color: var(--color-text-tertiary);
      text-align: center;

      i {
        font-size: 2rem;
        opacity: 0.5;
      }

      p {
        margin: 0;
        font-size: var(--font-size-sm);
      }
    }

    .signature-info {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
      text-align: center;

      .info-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        color: var(--color-success-600);
        font-weight: var(--font-weight-medium);

        i {
          font-size: var(--font-size-xl);
        }
      }

      .hash-display {
        padding: var(--spacing-2);
        background: var(--color-neutral-100);
        border-radius: var(--radius-md);

        code {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--font-size-xs);
        }
      }

      small {
        color: var(--color-neutral-500);
      }
    }

    .validate-dialog-hint {
      margin-bottom: 1rem;
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }

    .validate-warehouse-banner {
      margin: 0 0 0.75rem;
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-background-subtle, #f8fafc);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
    }

    .validate-default-badge {
      display: inline-block;
      margin-left: 0.5rem;
      padding: 0.1rem 0.45rem;
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-700, #1d4ed8);
    }

    .validate-loading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0 0 0.75rem;
    }

    .validate-stock-alert {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin: 0 0 0.75rem;
      padding: var(--spacing-3);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);

      p { margin: 0 0 0.35rem; }
      p:last-of-type { margin-bottom: 0.5rem; }
      a { font-weight: var(--font-weight-semibold); }

      &--error {
        background: var(--color-error-50, #fef2f2);
        border: 1px solid var(--color-error-200, #fecaca);
        color: var(--color-error-700, #b91c1c);
      }

      &--warning {
        background: var(--color-warning-50, #fffbeb);
        border: 1px solid var(--color-warning-200, #fde68a);
        color: var(--color-warning-800, #92400e);
      }
    }

    .validate-lines-table-wrap {
      overflow-x: auto;
    }

    .validate-lines-table {
      width: 100%;
      border-collapse: collapse;

      th, td {
        padding: var(--spacing-3);
        border-bottom: 1px solid var(--color-border-subtle);
        font-size: var(--font-size-sm);
        vertical-align: middle;
      }

      th {
        text-transform: uppercase;
        font-size: var(--font-size-xs);
        letter-spacing: 0.05em;
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        background: var(--color-background-subtle);
        border-bottom: 2px solid var(--color-border-default, var(--color-border-subtle));
      }

      th.text-right, td.text-right { text-align: right; }
      .mono { font-family: 'JetBrains Mono', monospace; }

      td:nth-child(2),
      td:nth-child(3),
      th:nth-child(2),
      th:nth-child(3) {
        width: 7rem;
        white-space: nowrap;
      }

      td:nth-child(4),
      th:nth-child(4) {
        min-width: 8rem;
      }

      tr.validate-alloc-row td {
        background: var(--color-background-subtle);
        padding: var(--spacing-2) var(--spacing-3);
        vertical-align: top;
      }

      @media (max-width: 640px) {
        min-width: 32rem;
      }
    }

    .validate-line-impact {
      color: var(--color-text-secondary);
    }

    .validate-impact-error {
      color: var(--color-error-700, #b91c1c);
      font-weight: var(--font-weight-semibold);
    }

    .validate-impact-warning {
      color: var(--color-warning-800, #92400e);
    }

    .validate-row-insufficient td {
      background: var(--color-error-50, #fef2f2);
    }

    .validate-row-warning td {
      background: var(--color-warning-50, #fffbeb);
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
    }

    .muted {
      color: var(--color-text-secondary);
    }

    .not-found {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      text-align: center;

      i {
        font-size: 4rem;
        color: var(--color-warning-500);
        margin-bottom: var(--spacing-4);
      }

      h2 {
        color: var(--color-neutral-800);
        margin: 0 0 var(--spacing-2);
      }

      p {
        color: var(--color-neutral-600);
        margin: 0 0 var(--spacing-4);
      }
    }

    :host ::ng-deep {
      .invoice-card .p-card-body {
        padding: var(--card-padding);
      }

      .status-card,
      .timeline-card,
      .payments-card,
      .actions-card,
      .signature-card {
        .p-card-header {
          padding: var(--spacing-4) var(--card-padding);
          border-bottom: 1px solid var(--color-border-subtle);
          font-size: var(--font-size-base);
          font-weight: var(--font-weight-semibold);
          color: var(--color-text-primary);
        }

        .p-card-body {
          padding: var(--card-padding);
        }
      }

      .custom-timeline {
        .p-timeline-event-opposite {
          display: none;
        }
      }
    }
  `]
})
export class InvoiceDetailComponent implements OnInit {
  readonly loc_ui_tern_facture_du_17b440 = $localize`:@@ui.tern.facture.du.17b440:Facture du `;
  readonly loc_ui_tern_facture_d_avoir_541e44 = $localize`:@@ui.tern.facture.d.avoir.541e44:Facture d'avoir`;
  readonly loc_ui_tern_facture_3953b9 = $localize`:@@ui.tern.facture.3953b9:Facture`;
  readonly loc_ui_tern_total_ht_a_rembourser_a8f25c = $localize`:@@ui.tern.total.ht.a.rembourser.a8f25c:Total HT à rembourser`;
  readonly loc_ui_tern_total_ht_2ca17a = $localize`:@@ui.tern.total.ht.2ca17a:Total HT`;
  readonly loc_ui_tern_total_tva_a_rembourser_a5ddaa = $localize`:@@ui.tern.total.tva.a.rembourser.a5ddaa:Total TVA à rembourser`;
  readonly loc_ui_tern_total_tva_605c4b = $localize`:@@ui.tern.total.tva.605c4b:Total TVA`;
  readonly loc_ui_tern_fodec_a_rembourser_bca3c0 = $localize`:@@ui.tern.fodec.a.rembourser.bca3c0:FODEC à rembourser`;
  readonly loc_ui_tern_fodec_9a0290 = $localize`:@@ui.tern.fodec.9a0290:FODEC`;
  readonly loc_ui_tern_total_ttc_a_rembourser_1ef7ef = $localize`:@@ui.tern.total.ttc.a.rembourser.1ef7ef:Total TTC à rembourser`;
  readonly loc_ui_tern_total_ttc_9e80ff = $localize`:@@ui.tern.total.ttc.9e80ff:Total TTC`;
  readonly loc_ui_tern_tnd_51da21 = $localize`:@@ui.tern.tnd.51da21:TND`;
  private invoiceService = inject(InvoiceService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmationService = inject(ConfirmationService);
  private toastService = inject(ToastService);
  private readonly auth = inject(AuthService);
  private stockService = inject(StockService);
  private productService = inject(ProductService);
  private errorHandler = inject(ErrorHandlerService);
  private destroyRef = inject(DestroyRef);

  loading = signal(true);
  invoice = signal<InvoiceDetail | null>(null);
  stockFeatures = signal<StockFeatures | null>(null);
  traceabilityByProduct = signal<Map<string, { trackingMode: number; pickingPolicy: number; hasExpiryTracking: boolean }>>(new Map());

  showValidateDialog = false;
  validateLineForms: Array<{
    lineId: string;
    productId: string;
    designation: string;
    quantity: number;
    trackingMode: number;
    pickingPolicy: number;
    hasExpiryTracking: boolean;
    lotAllocations: AllocationRow[];
  }> = [];

  validateEffectiveWarehouseId = signal<string | null>(null);
  validateWarehouseLabel = signal<string | null>(null);
  validateWarehouseIsDefault = signal(false);
  validateContextLoading = signal(false);
  validateContextError = signal<string | null>(null);
  validateStockCheck = signal<StockAvailabilityCheck | null>(null);
  validateStockBlocked = signal(false);
  validateProductMeta = signal<Map<string, { isStockManaged: boolean; costingMethod: number; trackingMode: number }>>(new Map());
  validateAvailabilityByProduct = signal<Map<string, ProductAvailabilityDetail>>(new Map());
  validateAllocAvailability = signal<Map<string, ExitLotAvailability>>(new Map());
  validateAllocLotStockValid = signal<Map<string, boolean>>(new Map());
  validateSubmitError = signal<string | null>(null);
  private validateLoadSeq = 0;

  menuItems: MenuItem[] = [];
  timeline: TimelineEvent[] = [];

  private get unpaidOnlyFromRoute(): boolean {
    return this.route.snapshot.data['unpaidOnly'] === true;
  }

  private get creditNotesOnlyFromRoute(): boolean {
    return this.route.snapshot.data['creditNotesOnly'] === true;
  }

  get listBackRoute(): string {
    if (this.creditNotesOnlyFromRoute) {
      return '/invoices/credit-notes';
    }
    return this.unpaidOnlyFromRoute ? '/invoices/unpaid' : '/invoices';
  }

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const inv = this.invoice();
    const base: BreadcrumbItem[] = [
      { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' }
    ];
    if (this.creditNotesOnlyFromRoute) {
      base.push({ label: 'Avoirs de vente', route: '/invoices/credit-notes' });
    } else {
      base.push({ label: 'Factures', route: '/invoices' });
      if (this.unpaidOnlyFromRoute) {
        base.push({ label: 'Factures impayées', route: '/invoices/unpaid' });
      }
    }
    base.push({ label: inv?.number || (this.creditNotesOnlyFromRoute ? $localize`:@@ui.tern.avoir.8ee247:Avoir` : $localize`:@@ui.tern.facture.3953b9:Facture`) });
    return base;
  });

  /** Action workflow principale affichée dans l'en-tête (Valider / Signer). */
  readonly primaryAction = computed(() => {
    const inv = this.invoice();
    if (!inv) return null;
    if (inv.status === 'Draft') {
      return { label: 'Valider', icon: 'pi-check', variant: 'primary' as const, command: () => this.validateInvoice() };
    }
    if (inv.status === 'Validated') {
      return { label: 'Signer', icon: 'pi-pencil', variant: 'primary' as const, command: () => this.signInvoice() };
    }
    return null;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadInvoice(id);
    } else {
      this.router.navigate([this.listBackRoute]);
    }
  }

  private loadInvoice(id: string): void {
    this.loading.set(true);

    this.invoiceService.getInvoice(id).subscribe({
      next: (response) => {
        if (response.success) {
          this.invoice.set(response.data);
          this.buildTimeline(response.data);
          this.buildMenu(response.data);
        } else {
          this.invoice.set(null);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.invoice.set(null);
      }
    });
  }

  private buildTimeline(invoice: InvoiceDetail): void {
    this.timeline = [
      {
        status: 'Créée',
        date: invoice.createdAt,
        icon: 'pi pi-file',
        color: 'var(--color-neutral-400)'
      },
      {
        status: 'Validée',
        date: invoice.status !== 'Draft' ? invoice.createdAt : null,
        icon: 'pi pi-check',
        color: invoice.status !== 'Draft' ? $localize`:@@ui.tern.var.color.primary.500.135495:var(--color-primary-500)` : $localize`:@@ui.tern.var.color.neutral.300.711144:var(--color-neutral-300)`
      },
      {
        status: 'Signée',
        date: invoice.signedAt,
        icon: 'pi pi-pencil',
        color: invoice.signedAt ? $localize`:@@ui.tern.var.color.success.500.6e3aad:var(--color-success-500)` : $localize`:@@ui.tern.var.color.neutral.300.711144:var(--color-neutral-300)`
      },
      {
        status: 'Payée',
        date: invoice.paidAt,
        icon: 'pi pi-wallet',
        color: invoice.paidAt ? $localize`:@@ui.tern.var.color.success.600.129c92:var(--color-success-600)` : $localize`:@@ui.tern.var.color.neutral.300.711144:var(--color-neutral-300)`
      }
    ];
  }

  private buildMenu(invoice: InvoiceDetail): void {
    this.menuItems = [
      {
        label: 'Télécharger PDF',
        icon: 'pi pi-download',
        command: () => this.downloadPdf()
      },
      {
        label: invoice.client.email ? $localize`:@@ui.tern.envoyer.par.email.535086:Envoyer par email` : $localize`:@@ui.tern.envoyer.par.email.adresse.manquante.ffe6e3:Envoyer par email (adresse manquante)`,
        icon: 'pi pi-envelope',
        disabled: !invoice.client.email,
        command: () => this.sendByEmail()
      },
      {
        label: 'Enregistrer un paiement',
        icon: 'pi pi-wallet',
        visible: this.canRecordPayment(invoice),
        command: () => this.openRecordPaymentDialog()
      },
      { separator: true },
      {
        label: 'Dupliquer',
        icon: 'pi pi-copy',
        command: () => this.duplicateInvoice()
      },
      {
        label: "Créer un avoir",
        icon: 'pi pi-replay',
        visible: this.canCreateCreditNote(invoice.status),
        routerLink: ['/invoices', invoice.id, 'credit-note']
      }
    ];
  }

  getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case 'Draft': return 'secondary';
      case 'Validated': return 'info';
      case 'Signed': return 'success';
      case 'Paid': return 'success';
      case 'PartiallyPaid': return 'info';
      case 'Overdue': return 'danger';
      case 'Cancelled': return 'warn';
      case 'Archived': return 'secondary';
      default: return 'secondary';
    }
  }

  getStatusBadgeStatus(status: string): StatusBadgeStatus {
    switch (status) {
      case 'Draft': return 'draft';
      case 'Validated': return 'validated';
      case 'Signed': return 'signed';
      case 'Paid': return 'paid';
      case 'PartiallyPaid': return 'partial';
      case 'Overdue': return 'overdue';
      case 'Cancelled': return 'cancelled';
      case 'Archived': return 'inactive';
      default: return 'draft';
    }
  }

  isOverdue(): boolean {
    const invoice = this.invoice();
    if (!invoice?.dueDate) return false;
    const nonPaidStatuses = ['Draft', 'Validated', 'Signed', 'PartiallyPaid', 'Overdue'];
    return new Date(invoice.dueDate) < new Date() && nonPaidStatuses.includes(invoice.status);
  }

  canCreateCreditNote(status: string): boolean {
    // Only allow creating an AVO from a regular FAC — no chained avoir-of-avoir.
    if (this.invoice()?.isCreditNote) return false;
    return ['Validated', 'Signed', 'Paid', 'PartiallyPaid', 'Overdue'].includes(status);
  }

  canRecordPayment(invoice: InvoiceDetail): boolean {
    if (this.auth.isFirmDelegatedReadonly()) return false;
    if (invoice.status === 'Paid') return false;
    return ['Signed', 'Validated', 'PartiallyPaid', 'Overdue'].includes(invoice.status);
  }

  recordPaymentDialogVisible = false;

  openRecordPaymentDialog(): void {
    if (this.auth.isFirmDelegatedReadonly()) return;
    this.recordPaymentDialogVisible = true;
  }

  onPaymentRecorded(): void {
    const inv = this.invoice();
    if (inv) {
      this.toastService.add({
        severity: 'success',
        summary: $localize`:@@invoice-detail.component.summary.Succès:Succès`,
        detail: $localize`:@@invoice-detail.component.detail.Paiement_enregis:Paiement enregistré avec succès`
      });
      this.loadInvoice(inv.id);
    }
  }

  readonly settlingEffetId = signal<string | null>(null);

  canSettleEffet(): boolean {
    return !this.auth.isFirmDelegatedReadonly();
  }

  /** Règle un effet client à échéance : encaissé (outcome=1) ou impayé (outcome=2). */
  onSettleClientEffet(paymentId: string, outcome: 1 | 2): void {
    if (this.settlingEffetId()) return;
    if (this.auth.isFirmDelegatedReadonly()) return;
    const inv = this.invoice();
    if (!inv) return;

    this.confirmationService.confirm({
      header: outcome === 1 ? $localize`:@@ui.tern.encaisser.l.effet.e5814c:Encaisser l'effet` : $localize`:@@ui.tern.marquer.l.effet.impaye.0f7c87:Marquer l'effet impayé`,
      message: outcome === 1
        ? $localize`:@@ui.tern.confirmer.l.encaissement.de.cet.effet.a.ec.609377:Confirmer l'encaissement de cet effet à échéance ? L'écriture bancaire (532/413) sera générée.`
        : $localize`:@@ui.tern.confirmer.le.retour.impaye.de.cet.effet.la.0cdc24:Confirmer le retour impayé de cet effet ? La créance client sera réouverte (4111/413).`,
      icon: outcome === 1 ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle',
      acceptLabel: outcome === 1 ? $localize`:@@ui.tern.encaisser.fec08f:Encaisser` : $localize`:@@ui.tern.marquer.impaye.6de559:Marquer impayé`,
      rejectLabel: $localize`:@@invoice-detail.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.settlingEffetId.set(paymentId);
        this.invoiceService.settleEffet(inv.id, paymentId, {
          settlementDate: formatLocalDate(new Date()),
          outcome
        }).subscribe({
          next: (res) => {
            this.settlingEffetId.set(null);
            if (res.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@invoice-detail.component.summary.Effet réglé:Effet réglé`,
                detail: outcome === 1 ? $localize`:@@ui.tern.effet.encaisse.avec.succes.ce2647:Effet encaissé avec succès` : $localize`:@@ui.tern.effet.marque.impaye.6ea42d:Effet marqué impayé`
              });
              this.loadInvoice(inv.id);
            } else {
              this.toastService.add({ severity: 'error', summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`, detail: res.message ?? $localize`:@@ui.tern.echec.du.reglement.de.l.effet.f701ff:Échec du règlement de l'effet` });
            }
          },
          error: () => {
            this.settlingEffetId.set(null);
            this.toastService.add({ severity: 'error', summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`, detail: $localize`:@@invoice-detail.component.detail._chec_du_r_gleme:Échec du règlement de l'effet` });
          }
        });
      }
    });
  }

  validateInvoice(): void {
    const invoice = this.invoice();
    if (!invoice) return;

    this.validateLineForms = invoice.lines.map(line => ({
      lineId: line.id,
      productId: line.productId,
      designation: line.productName,
      quantity: line.quantity,
      trackingMode: 0,
      pickingPolicy: 0,
      hasExpiryTracking: false,
      lotAllocations: [createDefaultLotRow(line.quantity)]
    }));

    this.resetValidateStockState();
    this.showValidateDialog = true;

    if (invoice.isCreditNote) {
      return;
    }

    this.validateContextLoading.set(true);
    this.loadValidateStockContext(invoice);
  }

  needsStockAllocationOnValidate(): boolean {
    const inv = this.invoice();
    return !!inv && !inv.isCreditNote && !!this.validateEffectiveWarehouseId();
  }

  showValidateLineTraceability(line: { trackingMode: number; quantity: number }): boolean {
    const f = this.stockFeatures();
    if (!f || !this.validateEffectiveWarehouseId()) return false;
    return line.quantity > 0
      && (showLotSection(line.trackingMode, f) || showSerialSection(line.trackingMode, f));
  }

  isValidateFormValid(): boolean {
    const inv = this.invoice();
    if (!inv) return false;
    if (inv.isCreditNote) return true;
    if (this.validateContextLoading() || this.validateContextError()) return false;
    if (this.validateStockBlocked()) return false;
    if (this.hasMissingWarehouseLots()) return false;
    if (!this.needsStockAllocationOnValidate()) return true;
    const features = this.stockFeatures();
    for (const line of this.validateLineForms) {
      if (this.showValidateLineTraceability(line)) {
        if (!exitTraceabilityReady(
          line.trackingMode,
          features,
          line.quantity,
          this.allocAvailabilityFor(line)
        )) {
          return false;
        }
        if (!exitAllocationsValid(
          line.trackingMode,
          line.pickingPolicy,
          line.quantity,
          line.lotAllocations,
          features
        )) {
          return false;
        }
        if (this.validateAllocLotStockValid().get(`lot:${line.productId}`) === false) {
          return false;
        }
      }
    }
    return true;
  }

  submitValidate(): void {
    const invoice = this.invoice();
    if (!invoice || !this.isValidateFormValid()) return;

    this.validateSubmitError.set(null);

    const lineAllocations = this.needsStockAllocationOnValidate()
      ? this.validateLineForms
          .filter(lf => this.showValidateLineTraceability(lf))
          .map(lf => ({
            lineId: lf.lineId,
            allocations: buildExitAllocationPayload(lf.lotAllocations)
          }))
          .filter(la => la.allocations.length > 0)
      : undefined;

    this.invoiceService.validateInvoice(
      invoice.id,
      lineAllocations && lineAllocations.length > 0 ? { lineAllocations } : undefined
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.showValidateDialog = false;
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@invoice-detail.component.summary.Succès:Succès`,
            detail: $localize`:@@invoice-detail.component.detail.Facture vali:Facture validée avec succès`
          });
          this.loadInvoice(invoice.id);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`,
            detail: (response as any).message || 'Impossible de valider la facture'
          });
          this.validateSubmitError.set((response as any).message || 'Impossible de valider la facture');
        }
      },
      error: (err) => {
        const message = this.errorHandler.extractErrorMessage(err);
        this.validateSubmitError.set(message);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`,
          detail: message
        });
      }
    });
  }

  lineAvailability(productId: string): ProductAvailabilityDetail | undefined {
    return this.validateAvailabilityByProduct().get(productId);
  }

  lineImpact(productId: string): LineImpactDisplay {
    return lineImpactDisplay(this.lineAvailability(productId));
  }

  isValidateLineInsufficient(productId: string): boolean {
    return isValidateLineInsufficientFn(this.lineAvailability(productId));
  }

  isValidateLineWarning(productId: string): boolean {
    return isValidateLineWarningFn(this.lineAvailability(productId));
  }

  onValidateAllocAvailability(event: ExitLotAvailability): void {
    const next = new Map(this.validateAllocAvailability());
    next.set(`${event.kind}:${event.productId}`, event);
    this.validateAllocAvailability.set(next);
  }

  onValidateLotStockValid(event: LotStockValidity): void {
    const next = new Map(this.validateAllocLotStockValid());
    next.set(`lot:${event.productId}`, event.valid);
    this.validateAllocLotStockValid.set(next);
  }

  hasMissingWarehouseLots(): boolean {
    const features = this.stockFeatures();
    for (const line of this.validateLineForms) {
      if (!this.showValidateLineTraceability(line)) continue;
      const avail = this.lineAvailability(line.productId);
      const stock = avail?.isStockManaged ? avail.availableQuantity : null;
      if (lineMissingWarehouseLots({
        trackingMode: line.trackingMode,
        features,
        quantity: line.quantity,
        availableStock: stock,
        availability: this.validateAllocAvailability().get(`lot:${line.productId}`)
      })) {
        return true;
      }
      if (lineMissingWarehouseSerials({
        trackingMode: line.trackingMode,
        features,
        quantity: line.quantity,
        availableStock: stock,
        availability: this.validateAllocAvailability().get(`serial:${line.productId}`)
      })) {
        return true;
      }
    }
    return false;
  }

  hasOnlyExpiredWarehouseLots(): boolean {
    const features = this.stockFeatures();
    for (const line of this.validateLineForms) {
      if (!this.showValidateLineTraceability(line)) continue;
      const avail = this.lineAvailability(line.productId);
      const stock = avail?.isStockManaged ? avail.availableQuantity : null;
      if (lineBlockedByExpiredLots({
        trackingMode: line.trackingMode,
        features,
        quantity: line.quantity,
        availableStock: stock,
        availability: this.validateAllocAvailability().get(`lot:${line.productId}`)
      })) {
        return true;
      }
    }
    return false;
  }

  private allocAvailabilityFor(line: { productId: string; trackingMode: number }): ExitLotAvailability | undefined {
    const features = this.stockFeatures();
    if (showSerialSection(line.trackingMode, features)) {
      return this.validateAllocAvailability().get(`serial:${line.productId}`);
    }
    return this.validateAllocAvailability().get(`lot:${line.productId}`);
  }

  private resetValidateStockState(): void {
    this.validateLoadSeq++;
    this.validateEffectiveWarehouseId.set(null);
    this.validateWarehouseLabel.set(null);
    this.validateWarehouseIsDefault.set(false);
    this.validateContextLoading.set(false);
    this.validateContextError.set(null);
    this.validateStockCheck.set(null);
    this.validateStockBlocked.set(false);
    this.validateProductMeta.set(new Map());
    this.validateAvailabilityByProduct.set(new Map());
    this.validateAllocAvailability.set(new Map());
    this.validateAllocLotStockValid.set(new Map());
    this.validateSubmitError.set(null);
  }

  private loadValidateStockContext(invoice: InvoiceDetail): void {
    const loadSeq = ++this.validateLoadSeq;
    this.stockService.getWarehouses()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of({ success: false, data: [] as { id: string; name: string; isDefault: boolean }[] })),
        switchMap(res => {
          if (loadSeq !== this.validateLoadSeq) return EMPTY;
          const warehouses = (res.success ? res.data : null) ?? [];
          const byId = invoice.warehouseId
            ? warehouses.find(w => w.id === invoice.warehouseId) ?? null
            : null;
          const fallback = warehouses.find(w => w.isDefault) ?? null;
          const warehouse = byId ?? fallback;
          this.validateEffectiveWarehouseId.set(warehouse?.id ?? null);
          this.validateWarehouseLabel.set(warehouse?.name ?? null);
          this.validateWarehouseIsDefault.set(!byId && !!warehouse);

          if (!warehouse) {
            if (loadSeq !== this.validateLoadSeq) return EMPTY;
            this.validateContextError.set(
              'Aucun entrepôt n\'est configuré. Impossible de vérifier le stock.'
            );
            this.validateContextLoading.set(false);
            return EMPTY;
          }

          const productIds = [...new Set(invoice.lines.map(l => l.productId).filter(Boolean))];
          const items = invoice.lines
            .filter(l => l.productId)
            .map(l => ({ productId: l.productId, requestedQuantity: l.quantity }));

          const features$ = this.stockFeatures()
            ? of(this.stockFeatures())
            : this.stockService.getFeatures().pipe(
                map(r => (r.success && r.data ? r.data : null)),
                catchError(() => of(null))
              );

          const traceability$ = productIds.length
            ? this.stockService.getTraceabilityContext(productIds, warehouse.id).pipe(
                map(r => (r.success && r.data ? r.data : [])),
                catchError(() => of([] as { productId: string; trackingMode: number; pickingPolicy: number; hasExpiryTracking?: boolean }[]))
              )
            : of([] as { productId: string; trackingMode: number; pickingPolicy: number; hasExpiryTracking?: boolean }[]);

          const products$ = productIds.length
            ? forkJoin(productIds.map(id =>
                this.productService.getProduct(id).pipe(
                  map(r => r.data ?? null),
                  catchError(() => of(null))
                )
              ))
            : of([]);

          const availability$ = items.length
            ? this.stockService.checkAvailability(items, warehouse.id).pipe(
                map(r => (r.success && r.data ? r.data : null)),
                catchError(() => of(null))
              )
            : of(null);

          return forkJoin({
            features: features$,
            traceability: traceability$,
            products: products$,
            availability: availability$
          });
        })
      )
      .subscribe({
        next: ctx => {
          if (loadSeq !== this.validateLoadSeq) return;
          if (ctx.features) this.stockFeatures.set(ctx.features);

          const traceMap = new Map(this.traceabilityByProduct());
          for (const t of ctx.traceability) {
            traceMap.set(t.productId, {
              trackingMode: coerceTrackingMode(t.trackingMode),
              pickingPolicy: coercePickingPolicy(t.pickingPolicy),
              hasExpiryTracking: !!t.hasExpiryTracking
            });
          }
          this.traceabilityByProduct.set(traceMap);

          for (const lineForm of this.validateLineForms) {
            const t = traceMap.get(lineForm.productId);
            if (t) {
              lineForm.trackingMode = t.trackingMode;
              lineForm.pickingPolicy = t.pickingPolicy;
              lineForm.hasExpiryTracking = t.hasExpiryTracking;
              if (t.trackingMode === TRACKING_MODE_SERIAL) {
                lineForm.lotAllocations = Array.from(
                  { length: Math.max(1, Math.round(lineForm.quantity)) },
                  () => createDefaultSerialRow()
                );
              }
            }
          }

          const productMeta = new Map<string, { isStockManaged: boolean; costingMethod: number; trackingMode: number }>();
          for (const product of ctx.products) {
            if (!product) continue;
            productMeta.set(product.id, {
              isStockManaged: product.isStockManaged,
              costingMethod: product.costingMethod ?? 0,
              trackingMode: coerceTrackingMode(product.trackingMode)
            });
          }
          this.validateProductMeta.set(productMeta);

          const availMap = new Map<string, ProductAvailabilityDetail>();
          for (const detail of ctx.availability?.details ?? []) {
            availMap.set(detail.productId, detail);
          }
          this.validateAvailabilityByProduct.set(availMap);
          this.validateStockCheck.set(ctx.availability);

          this.recomputeValidateStockBlock();
          this.validateContextLoading.set(false);
        },
        error: () => {
          if (loadSeq !== this.validateLoadSeq) return;
          this.validateContextError.set('Impossible de vérifier le stock.');
          this.validateContextLoading.set(false);
        }
      });
  }

  private recomputeValidateStockBlock(): void {
    const features = this.stockFeatures();
    const productMeta = this.validateProductMeta();
    const availability = this.validateAvailabilityByProduct();
    const lines = this.validateLineForms.map(lf => {
      const meta = productMeta.get(lf.productId);
      const avail = availability.get(lf.productId);
      return {
        isStockManaged: meta?.isStockManaged ?? avail?.isStockManaged ?? lf.trackingMode > 0,
        trackingMode: lf.trackingMode || meta?.trackingMode || 0,
        costingMethod: meta?.costingMethod ?? 0,
        isAvailable: avail ? avail.isAvailable : null
      };
    });
    this.validateStockBlocked.set(shouldBlockInvoiceValidateForStock(lines, features));
  }

  signInvoice(): void {
    const invoice = this.invoice();
    if (!invoice) return;

    this.invoiceService.signInvoice(invoice.id).subscribe({
      next: (response) => {
        if (response.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@invoice-detail.component.summary.Succès:Succès`,
            detail: $localize`:@@invoice-detail.component.detail.Facture_sign_e_:Facture signée électroniquement`
          });
          this.loadInvoice(invoice.id);
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`,
          detail: $localize`:@@invoice-detail.component.detail.Impossible_de_si:Impossible de signer la facture`
        });
      }
    });
  }

  downloadPdf(): void {
    const invoice = this.invoice();
    if (!invoice) {
      this.toastService.add({
        severity: 'error',
        summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`,
        detail: $localize`:@@invoice-detail.component.detail.Aucune_facture_d:Aucune facture disponible pour le téléchargement`
      });
      return;
    }

    this.invoiceService.downloadPdf(invoice.id).subscribe({
      next: (blob) => {
        // Vérifier que le blob est valide
        if (!blob || blob.size === 0) {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`,
            detail: $localize`:@@invoice-detail.component.detail.Le_fichier_PDF_e:Le fichier PDF est vide ou invalide`
          });
          return;
        }

        try {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `Facture_${invoice.number}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);

          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@invoice-detail.component.summary.Succès:Succès`,
            detail: $localize`:@@invoice-detail.component.detail.PDF téléchar:PDF téléchargé avec succès`
          });
        } catch (error) {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`,
            detail: $localize`:@@invoice-detail.component.detail.Erreur_lors_de_l:Erreur lors de la création du lien de téléchargement`
          });
        }
      },
      error: (error: Error) => {
        const errorMessage = error.message || 'Impossible de télécharger le PDF';
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`,
          detail: errorMessage
        });
      }
    });
  }

  sending = signal(false);

  sendByEmail(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    if (!invoice.client.email) {
      this.toastService.add({
        severity: 'warn',
        summary: $localize`:@@invoice-detail.component.summary.Email_manquant:Email manquant`,
        detail: $localize`:@@invoice-detail.component.detail.Leclientnapasdadre:Le client n'a pas d'adresse email.`
      });
      return;
    }

    this.confirmationService.confirm({
      message: `Envoyer la facture ${invoice.number} par email à ${invoice.client.email} ?`,
      header: 'Envoi par email',
      icon: 'pi pi-envelope',
      acceptLabel: $localize`:@@invoice-detail.component.acceptLabel.Envoyer:Envoyer`,
      rejectLabel: $localize`:@@invoice-detail.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.sending.set(true);
        this.invoiceService.sendByEmail(invoice.id).subscribe({
          next: (response) => {
            this.sending.set(false);
            if (response.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@invoice-detail.component.summary.Envoy_:Envoyé`,
                detail: `Email envoyé à ${invoice.client.email}`
              });
              this.loadInvoice(invoice.id);
            }
          },
          error: (err) => {
            this.sending.set(false);
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@invoice-detail.component.summary.Erreur:Erreur`,
              detail: err?.error?.errors?.[0] || 'Erreur lors de l\'envoi'
            });
          }
        });
      }
    });
  }

  duplicateInvoice(): void {
    this.toastService.add({
      severity: 'info',
      summary: $localize`:@@invoice-detail.component.summary.Information:Information`,
      detail: $localize`:@@invoice-detail.component.detail.Fonctionnalit_e:Fonctionnalité en cours de développement`
    });
  }
}
