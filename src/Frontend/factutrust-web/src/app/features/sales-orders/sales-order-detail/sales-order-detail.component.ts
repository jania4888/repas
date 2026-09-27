/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { TimelineModule } from 'primeng/timeline';
import { SkeletonModule } from 'primeng/skeleton';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DocumentActionsMenuComponent } from '@shared/components/document-actions-menu/document-actions-menu.component';
import { MenuItem } from '@shared/models/menu-item.model';
import {
  SalesOrderService,
  SalesOrderDetail,
  SalesOrderLine,
  SalesOrderStatus,
  GenerateDeliveryNoteRequest,
  GenerateInvoiceFromOrderRequest
} from '@core/services/sales-order.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ClientService, ClientOutstanding } from '@core/services/client.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface TimelineEvent {
  status: string;
  icon: string;
  color: string;
  date?: string | null;
}

@Component({
  selector: 'app-sales-order-detail',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    Textarea,
    InputNumberModule,
    TagModule,
    TooltipModule,
    DialogModule,
    ProgressBarModule,
    CardModule,
    DividerModule,
    TimelineModule,
    SkeletonModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    EmptyStateComponent,
    ButtonComponent,
    DocumentActionsMenuComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    <app-page-header [title]="pageTitle()" [subtitle]="headerSubtitle()">
      @if (primaryAction(); as action) {
        <app-button [variant]="action.variant" [icon]="action.icon" iconPos="left" (clicked)="action.command()">
          {{ action.label }}
        </app-button>
      }
      <app-document-actions-menu [items]="menuItems()" />
    </app-page-header>

    @if (loading()) {
      <div class="skeleton-grid">
        <div class="main-content">
          <p-card>
            <p-skeleton height="2rem" styleClass="mb-4"></p-skeleton>
            <p-skeleton height="1rem" styleClass="mb-2" width="60%"></p-skeleton>
            <p-skeleton height="1rem" styleClass="mb-2" width="40%"></p-skeleton>
            <p-skeleton height="8rem" styleClass="mb-4"></p-skeleton>
            <p-skeleton height="10rem"></p-skeleton>
          </p-card>
        </div>
        <div class="sidebar">
          <p-skeleton height="12rem" styleClass="mb-4"></p-skeleton>
          <p-skeleton height="14rem" styleClass="mb-4"></p-skeleton>
        </div>
      </div>
    } @else {
      @if (order(); as o) {
      <div class="detail-grid">
        <div class="main-content">
          <!-- Alertes -->
          @if (o.status === 'Cancelled' && o.cancellationReason) {
            <div class="alert-banner danger">
              <i class="pi pi-times-circle"></i>
              <div>
                <strong i18n="@@sales-orders.sales-order-detail.commande.annulee.77e9879d">Commande annulée</strong> — {{ o.cancellationReason }}
              </div>
            </div>
          }
          @if (o.status === 'Closed' && o.closureReason) {
            <div class="alert-banner muted">
              <i class="pi pi-flag"></i>
              <div>
                <strong i18n="@@sales-orders.sales-order-detail.commande.soldee.7abb36e2">Commande soldée</strong> — {{ o.closureReason }}
                <div class="hint" i18n="@@sales-orders.sales-order-detail.le.reliquat.non.livre.a.ete.abandonne.4e8ee35e">Le reliquat non livré a été abandonné.</div>
              </div>
            </div>
          }

          <!-- En-tête document -->
          <div class="document-card">
            <div class="document-header">
              <div class="document-meta">
                <h1 class="document-title">{{ o.number }}</h1>
                <div class="document-badges">
                  <p-tag [severity]="statusSeverity(o.status)" [value]="o.statusDisplay | backendLabel"></p-tag>
                  @if (o.isStockReserved) {
                    <span class="ft-chip" pTooltip="Le stock est réservé pour cette commande." i18n-pTooltip="@@sales-orders.sales-order-detail.le.stock.est.reserve.pour.cette.commande.cfec9063" i18n="@@sales-orders.sales-order-detail.stock.reserve.8465f093">
                      <i class="pi pi-box"></i> Stock réservé
                    </span>
                  }
                  @if (o.sourceQuoteId) {
                    <a [routerLink]="['/quotes', o.sourceQuoteId]" class="ft-chip ft-chip--link" i18n="@@sales-orders.sales-order-detail.issue.du.devis.a434b0eb">
                      <i class="pi pi-file-import"></i>
                      Issue du devis {{ o.sourceQuoteNumber ?? '' }}
                    </a>
                  }
                </div>
              </div>
              <div class="document-dates">
                <div class="date-item">
                  <span class="label" i18n="@@sales-orders.sales-order-detail.date.de.commande.f9b0df86">Date de commande</span>
                  <span class="value">{{ o.orderDate | date: 'dd/MM/yyyy' }}</span>
                </div>
                <div class="date-item">
                  <span class="label" i18n="@@sales-orders.sales-order-detail.livraison.prevue.dc15f458">Livraison prévue</span>
                  <span class="value" [class.empty]="!o.expectedDeliveryDate">
                    {{ o.expectedDeliveryDate ? (o.expectedDeliveryDate | date: 'dd/MM/yyyy') : '—' }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- KPIs -->
          <div class="kpi-grid">
            <div class="kpi-card">
              <span class="ft-icon-badge ft-icon-badge--primary"><i class="pi pi-truck"></i></span>
              <div class="kpi-content">
                <div class="kpi-label" i18n="@@sales-orders.sales-order-detail.livraison.5755a8fa">Livraison</div>
                <div class="kpi-value" i18n="@@sales-orders.sales-order-detail.reste.a.livrer.382eea6a">
                  {{ deliveryProgress() }} %
                  <small>· {{ o.totalPendingDeliveryQuantity | number: '1.0-4' }} reste à livrer</small>
                </div>
                <div class="kpi-progress">
                  <p-progressBar [value]="deliveryProgress()" [showValue]="false"></p-progressBar>
                </div>
              </div>
            </div>

            <div class="kpi-card">
              <span class="ft-icon-badge ft-icon-badge--violet"><i class="pi pi-file-export"></i></span>
              <div class="kpi-content">
                <div class="kpi-label" i18n="@@sales-orders.sales-order-detail.facturation.04716c6b">Facturation</div>
                <div class="kpi-value" i18n="@@sales-orders.sales-order-detail.reste.a.facturer.4ce1ce7d">
                  {{ invoiceProgress() }} %
                  <small>· {{ o.totalPendingInvoiceQuantity | number: '1.0-4' }} reste à facturer</small>
                </div>
                <div class="kpi-progress">
                  <p-progressBar [value]="invoiceProgress()" [showValue]="false"></p-progressBar>
                </div>
              </div>
            </div>

            <div class="kpi-card">
              <span class="ft-icon-badge ft-icon-badge--emerald"><i class="pi pi-book"></i></span>
              <div class="kpi-content">
                <div class="kpi-label" i18n="@@sales-orders.sales-order-detail.carnet.5e843afe">Carnet</div>
                <div class="kpi-value">{{ o.backlogAmountHt | number: '1.3-3' }} {{ o.currency }}</div>
                <div class="kpi-hint" i18n="@@sales-orders.sales-order-detail.valeur.ht.restant.a.livrer.f4640e08">Valeur HT restant à livrer</div>
              </div>
            </div>
          </div>

          <!-- Informations -->
          <div class="info-section">
            <h2 class="section-title" i18n="@@sales-orders.sales-order-detail.informations.740810f3"><i class="pi pi-info-circle"></i> Informations</h2>
            <div class="info-grid">
              <div class="info-item full-width">
                <div class="info-label" i18n="@@sales-orders.sales-order-detail.client.e9ef2d15"><i class="pi pi-user"></i> Client</div>
                <div class="info-value">
                  <a [routerLink]="['/clients', o.clientId]" class="ft-link">{{ o.client.name }}</a>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label" i18n="@@sales-orders.sales-order-detail.date.de.commande.789c8ef5"><i class="pi pi-calendar"></i> Date de commande</div>
                <div class="info-value">{{ o.orderDate | date: 'dd/MM/yyyy' }}</div>
              </div>
              <div class="info-item">
                <div class="info-label" i18n="@@sales-orders.sales-order-detail.livraison.prevue.6146b958"><i class="pi pi-clock"></i> Livraison prévue</div>
                <div class="info-value" [class.empty]="!o.expectedDeliveryDate">
                  {{ o.expectedDeliveryDate ? (o.expectedDeliveryDate | date: 'dd/MM/yyyy') : '—' }}
                </div>
              </div>
              <div class="info-item">
                <div class="info-label" i18n="@@sales-orders.sales-order-detail.reference.9e62b230"><i class="pi pi-tag"></i> Référence</div>
                <div class="info-value" [class.empty]="!o.reference">{{ o.reference || '—' }}</div>
              </div>
              <div class="info-item">
                <div class="info-label" i18n="@@sales-orders.sales-order-detail.depot.04b56297"><i class="pi pi-warehouse"></i> Dépôt</div>
                <div class="info-value" [class.empty]="!o.warehouseName">{{ o.warehouseName || '—' }}</div>
              </div>
              <div class="info-item full-width">
                <div class="info-label" i18n="@@sales-orders.sales-order-detail.conditions.de.reglement.bd84de97"><i class="pi pi-credit-card"></i> Conditions de règlement</div>
                <div class="info-value" [class.empty]="!o.paymentTerms">{{ o.paymentTerms || '—' }}</div>
              </div>
              @if (o.notes) {
                <div class="info-item full-width">
                  <div class="info-label" i18n="@@sales-orders.sales-order-detail.notes.3f02048c"><i class="pi pi-comment"></i> Notes</div>
                  <div class="content">{{ o.notes }}</div>
                </div>
              }
            </div>
          </div>

          <!-- Lignes -->
          <div class="table-card">
            <div class="card-header">
              <h3 i18n="@@sales-orders.sales-order-detail.lignes.de.commande.ca1d2a94">Lignes de commande</h3>
              <span class="ft-chip" i18n="@@sales-orders.sales-order-detail.ligne.s.aeaa47ea">{{ o.lines.length }} ligne(s)</span>
            </div>
            <table class="lines-table">
              <thead>
                <tr>
                  <th i18n="@@sales-orders.sales-order-detail.text.d08f88df">#</th>
                  <th i18n="@@sales-orders.sales-order-detail.produit.ff673dc2">Produit</th>
                  <th class="text-center" i18n="@@sales-orders.sales-order-detail.cde.2b9449a7">Cdé</th>
                  <th class="text-center" i18n="@@sales-orders.sales-order-detail.livre.0a1317e9">Livré</th>
                  <th class="text-center" i18n="@@sales-orders.sales-order-detail.facture.55e253e6">Facturé</th>
                  <th class="text-center" i18n="@@sales-orders.sales-order-detail.reste.a.livrer.0fdaa693">Reste à livrer</th>
                  <th class="text-right" i18n="@@sales-orders.sales-order-detail.pu.ht.79388cae">PU HT</th>
                  <th class="text-center" i18n="@@sales-orders.sales-order-detail.remise.ce12d942">Remise</th>
                  <th class="text-right" i18n="@@sales-orders.sales-order-detail.total.ht.2ca17ae6">Total HT</th>
                </tr>
              </thead>
              <tbody>
                @for (line of o.lines; track line.id) {
                  <tr>
                    <td>{{ line.lineNumber }}</td>
                    <td>
                      <div class="line-product">
                        <span class="line-product-name">{{ line.productName }}</span>
                        <span class="line-product-code">{{ line.productCode }}</span>
                      </div>
                      @if (line.notes) {
                        <i class="pi pi-comment ft-icon-hint" [pTooltip]="line.notes"></i>
                      }
                    </td>
                    <td class="text-center mono">{{ line.quantity | number: '1.0-4' }}</td>
                    <td class="text-center">
                      @if (line.isFullyDelivered) {
                        <span class="line-status-badge complete"><i class="pi pi-check"></i> {{ line.deliveredQuantity | number: '1.0-4' }}</span>
                      } @else {
                        <span class="line-status-badge pending">{{ line.deliveredQuantity | number: '1.0-4' }}</span>
                      }
                    </td>
                    <td class="text-center">
                      @if (line.isFullyInvoiced) {
                        <span class="line-status-badge complete"><i class="pi pi-check"></i> {{ line.invoicedQuantity | number: '1.0-4' }}</span>
                      } @else {
                        <span class="line-status-badge pending">{{ line.invoicedQuantity | number: '1.0-4' }}</span>
                      }
                    </td>
                    <td class="text-center">
                      @if (line.pendingDeliveryQuantity > 0) {
                        <strong class="mono">{{ line.pendingDeliveryQuantity | number: '1.0-4' }}</strong>
                      } @else {
                        <span class="line-status-badge complete"><i class="pi pi-check"></i></span>
                      }
                    </td>
                    <td class="text-right mono">{{ line.unitPrice | number: '1.3-3' }}</td>
                    <td class="text-center">
                      @if (line.discountPercent) {
                        {{ line.discountPercent + ' %' }}
                        @if (line.appliedPromotionName) {
                          <small class="promo-hint">({{ line.appliedPromotionName }})</small>
                        }
                      } @else {
                        —
                      }
                    </td>
                    <td class="text-right mono">{{ line.subTotal | number: '1.3-3' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Totaux -->
          <div class="totals-wrapper">
            <div class="totals-box">
              @if (o.globalDiscountAmount > 0) {
                <div class="total-row">
                  <span i18n="@@sales-orders.sales-order-detail.sous.total.ht.724598f6">Sous-total HT</span>
                  <span class="mono">{{ o.subTotalBeforeGlobalDiscount | number: '1.3-3' }}</span>
                </div>
                <div class="total-row discount">
                  <span><ng-container i18n="@@sales-orders.sales-order-detail.remise.de.pied.70ef8789">
                    Remise de pied
                    </ng-container>@if (o.globalDiscountPercent) {
                      ({{ o.globalDiscountPercent }} %)
                    }
                  </span>
                  <span class="mono">- {{ o.globalDiscountAmount | number: '1.3-3' }}</span>
                </div>
                <div class="total-row">
                  <span i18n="@@sales-orders.sales-order-detail.ht.apres.remise.9a858c00">HT après remise</span>
                  <span class="mono">{{ o.subTotal | number: '1.3-3' }}</span>
                </div>
              } @else {
                <div class="total-row"><span i18n="@@sales-orders.sales-order-detail.sous.total.ht.724598f6">Sous-total HT</span><span class="mono">{{ o.subTotal | number: '1.3-3' }}</span></div>
              }
              @if (o.fodecAmount > 0) {
                <div class="total-row"><span i18n="@@sales-orders.sales-order-detail.fodec.9a029080">FODEC</span><span class="mono">{{ o.fodecAmount | number: '1.3-3' }}</span></div>
              }
              @for (vat of o.vatBreakdown; track vat.rate) {
                <div class="total-row">
                  <span>TVA {{ vat.rateDisplay | backendLabel }}</span>
                  <span class="mono">{{ vat.vatAmount | number: '1.3-3' }}</span>
                </div>
              }
              @if (o.fiscalStampAmount > 0) {
                <div class="total-row">
                  <span i18n="@@sales-orders.sales-order-detail.timbre.fiscal.1f8f7dd1">Timbre fiscal</span>
                  <span class="mono">{{ o.fiscalStampAmount | number: '1.3-3' }}</span>
                </div>
              }
              <div class="total-row grand">
                <span i18n="@@sales-orders.sales-order-detail.total.ttc.9e80ff7c">Total TTC</span>
                <span class="mono">{{ o.totalAmount | number: '1.3-3' }} {{ o.currency }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="sidebar">
          <p-card header="Statut" i18n-header="@@sales-orders.sales-order-detail.statut.659499f3" styleClass="sidebar-card">
            <div class="status-content">
              <p-tag [severity]="statusSeverity(o.status)" [value]="o.statusDisplay | backendLabel" styleClass="w-full"></p-tag>
              <div class="status-meta">
                <div i18n="@@sales-orders.sales-order-detail.commande.du.790ed8e7">Commande du {{ o.orderDate | date: 'dd/MM/yyyy' }}</div>
                @if (o.sourceQuoteNumber) {
                  <div class="source-quote" i18n="@@sales-orders.sales-order-detail.issue.du.devis.19ded35c">
                    <i class="pi pi-file-import"></i>
                    Issue du devis <a [routerLink]="['/quotes', o.sourceQuoteId]">{{ o.sourceQuoteNumber }}</a>
                  </div>
                }
              </div>
              @if (quickStatusAction(); as action) {
                <div class="status-actions">
                  <app-button [variant]="action.variant" [icon]="action.icon" iconPos="left" (clicked)="action.command()" style="width: 100%">
                    {{ action.label }}
                  </app-button>
                </div>
              }
            </div>
          </p-card>

          <p-card header="Client" i18n-header="@@sales-orders.sales-order-detail.client.1bdd79b1" styleClass="sidebar-card">
            <div class="client-card-content">
              <h3 class="client-name">{{ o.client.name }}</h3>
              @if (o.client.address) {
                <p class="client-detail">{{ o.client.address }}</p>
              }
              @if (o.client.nif) {
                <p class="client-detail" i18n="@@sales-orders.sales-order-detail.mf.479da3ee">MF : {{ o.client.nif }}</p>
              }
              @if (o.client.email) {
                <p class="client-detail">{{ o.client.email }}</p>
              }
              <a [routerLink]="['/clients', o.clientId]" class="client-link" i18n="@@sales-orders.sales-order-detail.voir.la.fiche.client.8929f9c3">
                <i class="pi pi-external-link"></i> Voir la fiche client
              </a>
            </div>
          </p-card>

          <p-card header="Parcours de la commande" i18n-header="@@sales-orders.sales-order-detail.parcours.de.la.commande.c454c4b9" styleClass="sidebar-card">
            <p-timeline [value]="timelineEvents()">
              <ng-template pTemplate="content" let-event>
                <div class="timeline-content">
                  <div class="timeline-title">{{ event.status }}</div>
                  @if (event.date) {
                    <div class="timeline-date">{{ event.date | date: 'dd/MM/yyyy' }}</div>
                  }
                </div>
              </ng-template>
              <ng-template pTemplate="opposite" let-event>
                <span></span>
              </ng-template>
            </p-timeline>
          </p-card>
        </div>
      </div>
    } @else {
      <app-empty-state
        icon="pi-exclamation-circle"
        title="Commande introuvable" i18n-title="@@sales-orders.sales-order-detail.commande.introuvable.ef74dfb8"
        message="Cette commande n'existe pas ou a été supprimée." i18n-message="@@sales-orders.sales-order-detail.cette.commande.n.existe.pas.ou.a.ete.sup.6abbc452">
      </app-empty-state>
    }
  }

    <!-- Annulation -->
    <p-dialog
      header="Annuler la commande" i18n-header="@@sales-orders.sales-order-detail.annuler.la.commande.187515f7"
      [(visible)]="cancelVisible"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [draggable]="false">
      <p class="ft-dialog-intro" i18n="@@sales-orders.sales-order-detail.l.annulation.libere.les.reservations.de.stock.el.cbc75f32"> L'annulation libère les réservations de stock. Elle suppose qu'aucune livraison n'a eu
        lieu ; sinon, utilisez plutôt « Solder ». </p>
      <div class="ft-field">
        <label for="so-cancel-reason"><ng-container i18n="@@sales-orders.sales-order-detail.motif.2a198f47">Motif </ng-container> <span class="ft-required" i18n="@@sales-orders.sales-order-detail.text.df58248c">*</span></label>
        <textarea
          id="so-cancel-reason"
          pTextarea
          [(ngModel)]="cancelReason"
          rows="3"
          maxlength="500"></textarea>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="cancelVisible = false" i18n="@@sales-orders.sales-order-detail.retour.e5befb1f">Retour</app-button>
        <app-button variant="danger" [disabled]="!cancelReason.trim() || acting()" (clicked)="doCancel()" i18n="@@sales-orders.sales-order-detail.annuler.la.commande.187515f7"> Annuler la commande </app-button>
      </ng-template>
    </p-dialog>

    <!-- Remise de pied -->
    <p-dialog
      header="Remise de pied de document" i18n-header="@@sales-orders.sales-order-detail.remise.de.pied.de.document.ae016b90"
      [(visible)]="discountVisible"
      [modal]="true"
      [style]="{ width: '34rem' }"
      [draggable]="false">
      <p class="ft-dialog-intro" i18n="@@sales-orders.sales-order-detail.la.remise.est.repartie.sur.les.lignes.au.prorata.2651c62b"> La remise est répartie sur les lignes au prorata de leur base HT : elle réduit donc la
        base de TVA et le FODEC. Le timbre fiscal, droit fixe, n'est pas touché.
        Laissez les deux champs vides pour retirer la remise. </p>

      <div class="ft-form-grid">
        <div class="ft-field">
          <label for="so-disc-pct" i18n="@@sales-orders.sales-order-detail.pourcentage.e34218e3">Pourcentage</label>
          <p-inputNumber
            inputId="so-disc-pct"
            [(ngModel)]="discountPercent"
            (onInput)="onPercentInput()"
            mode="decimal"
            [minFractionDigits]="0"
            [maxFractionDigits]="2"
            [min]="0"
            [max]="100"
            suffix=" %"></p-inputNumber>
        </div>

        <div class="ft-field">
          <label for="so-disc-amt" i18n="@@sales-orders.sales-order-detail.ou.montant.ht.cb1d55ac">ou Montant HT</label>
          <p-inputNumber
            inputId="so-disc-amt"
            [(ngModel)]="discountAmount"
            (onInput)="onAmountInput()"
            mode="decimal"
            [minFractionDigits]="3"
            [maxFractionDigits]="3"
            [min]="0"></p-inputNumber>
          <small class="ft-hint" i18n="@@sales-orders.sales-order-detail.un.seul.des.deux.saisir.l.un.efface.l.autre.42b5c125">Un seul des deux : saisir l'un efface l'autre.</small>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="discountVisible = false" i18n="@@sales-orders.sales-order-detail.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="acting()" (clicked)="saveDiscount()" i18n="@@sales-orders.sales-order-detail.enregistrer.f7c8bcd8"> Enregistrer </app-button>
      </ng-template>
    </p-dialog>

    <!-- Solde -->
    <p-dialog
      header="Solder la commande" i18n-header="@@sales-orders.sales-order-detail.solder.la.commande.2d97b963"
      [(visible)]="closeVisible"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [draggable]="false">
      <p class="ft-dialog-intro" i18n="@@sales-orders.sales-order-detail.solder.ferme.la.commande.en.renoncant.au.reliqua.187df3b6"> Solder ferme la commande en renonçant au reliquat non livré. Ce qui a déjà été livré et
        facturé n'est pas touché. </p>
      <div class="ft-field">
        <label for="so-close-reason"><ng-container i18n="@@sales-orders.sales-order-detail.motif.2a198f47">Motif </ng-container> <span class="ft-required" i18n="@@sales-orders.sales-order-detail.text.df58248c">*</span></label>
        <textarea
          id="so-close-reason"
          pTextarea
          [(ngModel)]="closeReason"
          rows="3"
          maxlength="500"></textarea>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="closeVisible = false" i18n="@@sales-orders.sales-order-detail.retour.e5befb1f">Retour</app-button>
        <app-button variant="primary" [disabled]="!closeReason.trim() || acting()" (clicked)="doClose()" i18n="@@sales-orders.sales-order-detail.solder.2663192f"> Solder </app-button>
      </ng-template>
    </p-dialog>

    <!-- Génération d'un bon de livraison depuis la commande -->
    <p-dialog
      header="Générer un bon de livraison" i18n-header="@@sales-orders.sales-order-detail.generer.un.bon.de.livraison.1b94dce0"
      [(visible)]="deliveryNoteDialogVisible"
      [modal]="true"
      [style]="{ width: '44rem' }"
      [draggable]="false">
      <p class="ft-dialog-intro" i18n="@@sales-orders.sales-order-detail.precisez.les.quantites.a.livrer.par.defaut.tout..7aa1af48"> Précisez les quantités à livrer. Par défaut, tout le reste à livrer de la commande est
        repris. </p>

      <div class="ft-field">
        <label for="dn-issue-date" i18n="@@sales-orders.sales-order-detail.date.d.emission.99f68857">Date d'émission</label>
        <input id="dn-issue-date" type="date" [(ngModel)]="deliveryNoteIssueDate" class="ft-input" />
      </div>

      <div class="ft-field" style="margin-top: var(--spacing-3);">
        <label for="dn-address" i18n="@@sales-orders.sales-order-detail.adresse.de.livraison.31eac756">Adresse de livraison</label>
        <textarea
          id="dn-address"
          pTextarea
          [(ngModel)]="deliveryNoteAddress"
          rows="2"
          maxlength="500"></textarea>
      </div>

      <p-table [value]="deliveryNoteLines" [rowHover]="true" styleClass="ft-table p-datatable-sm" [style]="{ 'margin-top': 'var(--spacing-4)' }">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@sales-orders.sales-order-detail.produit.ff673dc2">Produit</th>
            <th class="ft-num" i18n="@@sales-orders.sales-order-detail.reste.a.livrer.0fdaa693">Reste à livrer</th>
            <th class="ft-num" i18n="@@sales-orders.sales-order-detail.quantite.09a38fda">Quantité</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-line>
          <tr>
            <td><span class="ft-muted">{{ line.productCode }}</span> — {{ line.productName }}</td>
            <td class="ft-num">{{ line.pendingQuantity | number: '1.0-4' }}</td>
            <td class="ft-num">
              <p-inputNumber
                [(ngModel)]="line.quantity"
                [min]="0"
                [max]="line.pendingQuantity"
                mode="decimal"
                [minFractionDigits]="0"
                [maxFractionDigits]="4"
                inputStyleClass="ft-input ft-input--num"></p-inputNumber>
            </td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="resetDeliveryNoteQuantities()" i18n="@@sales-orders.sales-order-detail.tout.livrer.d2623b5e">Tout livrer</app-button>
        <app-button variant="secondary" (clicked)="deliveryNoteDialogVisible = false" i18n="@@sales-orders.sales-order-detail.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="acting()" (clicked)="submitGenerateDeliveryNote()" i18n="@@sales-orders.sales-order-detail.generer.le.bl.8968ad09"> Générer le BL </app-button>
      </ng-template>
    </p-dialog>

    <!-- Génération d'une facture depuis la commande -->
    <p-dialog
      header="Générer une facture" i18n-header="@@sales-orders.sales-order-detail.generer.une.facture.9b204490"
      [(visible)]="invoiceDialogVisible"
      [modal]="true"
      [style]="{ width: '48rem' }"
      [draggable]="false">
      <p class="ft-dialog-intro" i18n="@@sales-orders.sales-order-detail.par.defaut.seul.le.livre.non.facture.est.55753df8">
        <ng-container> Par défaut, seul le </ng-container> <strong>livré-non-facturé</strong> est facturé. Activez la facturation
        d'avance pour facturer le reste à facturer indépendamment des livraisons.
      </p>

      <div class="ft-form-grid" style="grid-template-columns: 1fr 1fr;">
        <div class="ft-field">
          <label for="inv-issue-date" i18n="@@sales-orders.sales-order-detail.date.d.emission.99f68857">Date d'émission</label>
          <input id="inv-issue-date" type="date" [(ngModel)]="invoiceIssueDate" class="ft-input" />
        </div>
        <div class="ft-field">
          <label for="inv-due-date" i18n="@@sales-orders.sales-order-detail.date.d.echeance.optionnelle.0a255cf4">Date d'échéance (optionnelle)</label>
          <input id="inv-due-date" type="date" [(ngModel)]="invoiceDueDate" class="ft-input" />
        </div>
      </div>

      <div class="ft-field" style="margin-top: var(--spacing-3);">
        <label class="ft-checkbox-label">
          <input type="checkbox" [(ngModel)]="advanceBilling" (change)="onAdvanceBillingChange()" /><ng-container i18n="@@sales-orders.sales-order-detail.facturation.d.avance.dd022f98">
          Facturation d'avance
        </ng-container></label>
      </div>

      @if (advanceBilling) {
        <p class="ft-hint" i18n="@@sales-orders.sales-order-detail.plafond.de.chaque.ligne.reste.a.facturer.indepen.30668409">Plafond de chaque ligne : reste à facturer (indépendamment des livraisons).</p>
      }

      <p-table [value]="invoiceLines" [rowHover]="true" styleClass="ft-table p-datatable-sm" [style]="{ 'margin-top': 'var(--spacing-3)' }">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@sales-orders.sales-order-detail.produit.ff673dc2">Produit</th>
            <th class="ft-num" i18n="@@sales-orders.sales-order-detail.assiette.de18e968">Assiette</th>
            <th class="ft-num" i18n="@@sales-orders.sales-order-detail.quantite.09a38fda">Quantité</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-line>
          <tr>
            <td><span class="ft-muted">{{ line.productCode }}</span> — {{ line.productName }}</td>
            <td class="ft-num">{{ line.availableQuantity | number: '1.0-4' }}</td>
            <td class="ft-num">
              <p-inputNumber
                [(ngModel)]="line.quantity"
                [min]="0"
                [max]="line.availableQuantity"
                mode="decimal"
                [minFractionDigits]="0"
                [maxFractionDigits]="4"
                inputStyleClass="ft-input ft-input--num"></p-inputNumber>
            </td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="resetInvoiceQuantities()" i18n="@@sales-orders.sales-order-detail.tout.facturer.580a60a2">Tout facturer</app-button>
        <app-button variant="secondary" (clicked)="invoiceDialogVisible = false" i18n="@@sales-orders.sales-order-detail.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="acting()" (clicked)="submitGenerateInvoice()" i18n="@@sales-orders.sales-order-detail.generer.la.facture.962ccf5c"> Générer la facture </app-button>
      </ng-template>
    </p-dialog>
  `,
  styleUrls: ['./sales-order-detail.component.scss']
})
export class SalesOrderDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly salesOrderService = inject(SalesOrderService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly auth = inject(AuthService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly clientService = inject(ClientService);

  readonly order = signal<SalesOrderDetail | null>(null);
  readonly loading = signal(true);
  readonly acting = signal(false);

  cancelVisible = false;
  cancelReason = '';
  discountVisible = false;
  discountPercent: number | null = null;
  discountAmount: number | null = null;
  closeVisible = false;
  closeReason = '';

  // Génération de BL
  deliveryNoteDialogVisible = false;
  deliveryNoteIssueDate = this.formatDateForInput(new Date());
  deliveryNoteAddress = '';
  deliveryNoteLines: { salesOrderLineId: string; lineNumber: number; productCode: string; productName: string; pendingQuantity: number; quantity: number }[] = [];

  // Génération de facture
  invoiceDialogVisible = false;
  invoiceIssueDate = this.formatDateForInput(new Date());
  invoiceDueDate: string | null = null;
  advanceBilling = false;
  invoiceLines: { salesOrderLineId: string; lineNumber: number; productCode: string; productName: string; availableQuantity: number; quantity: number }[] = [];

  private orderId = '';

  readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => [
    { label: $localize`:@@sales-orders.sales-order-detail.ts.ventes.9087fc4f:Ventes` },
    { label: $localize`:@@sales-orders.sales-order-detail.ts.commandes.clients.928f824a:Commandes clients`, route: '/sales-orders' },
    { label: this.order()?.number ?? $localize`:@@ui.tern.detail.7ce06a:Détail` }
  ]);

  readonly pageTitle = computed(() => {
    const o = this.order();
    return o ? $localize`:@@ui.tern.commande.ph.3030aa:Commande ${o.number}:p0:` : $localize`:@@ui.tern.commande.478443:Commande`;
  });

  readonly headerSubtitle = computed(() => {
    const o = this.order();
    if (!o) return '';
    return `${o.client.name} · ${o.lines.length} ligne(s)`;
  });

  private static readonly ACTION_CONFIRM = 'confirm';
  private static readonly ACTION_GENERATE_BL = 'generate-bl';
  private static readonly ACTION_GENERATE_INVOICE = 'generate-invoice';
  private static readonly ACTION_CLOSE = 'close';
  private static readonly ACTION_CANCEL = 'cancel';

  /** Action principale affichée dans l'en-tête (max 1). */
  readonly primaryAction = computed(() => {
    if (this.canConfirm()) {
      return {
        id: SalesOrderDetailComponent.ACTION_CONFIRM,
        label: $localize`:@@sales-orders.sales-order-detail.ts.confirmer.80a664c8:Confirmer`,
        icon: 'pi-check',
        variant: 'primary' as const,
        command: () => this.confirmOrder()
      };
    }
    if (this.canGenerateDeliveryNote()) {
      return {
        id: SalesOrderDetailComponent.ACTION_GENERATE_BL,
        label: $localize`:@@sales-orders.sales-order-detail.ts.generer.un.bl.9045e1cf:Générer un BL`,
        icon: 'pi-truck',
        variant: 'primary' as const,
        command: () => this.openGenerateDeliveryNote()
      };
    }
    return null;
  });

  /** Action rapide de statut affichée dans la sidebar. */
  readonly quickStatusAction = computed(() => {
    if (this.canGenerateInvoice()) {
      return {
        id: SalesOrderDetailComponent.ACTION_GENERATE_INVOICE,
        label: $localize`:@@sales-orders.sales-order-detail.ts.generer.une.facture.9b204490:Générer une facture`,
        icon: 'pi-file-export',
        variant: 'primary' as const,
        command: () => this.openGenerateInvoice()
      };
    }
    if (this.canClose()) {
      return {
        id: SalesOrderDetailComponent.ACTION_CLOSE,
        label: $localize`:@@sales-orders.sales-order-detail.ts.solder.2663192f:Solder`,
        icon: 'pi-flag',
        variant: 'secondary' as const,
        command: () => this.openClose()
      };
    }
    if (this.canCancel()) {
      return {
        id: SalesOrderDetailComponent.ACTION_CANCEL,
        label: $localize`:@@sales-orders.sales-order-detail.ts.annuler.49ba3292:Annuler`,
        icon: 'pi-times',
        variant: 'danger' as const,
        command: () => this.openCancel()
      };
    }
    return null;
  });

  /** Menu regroupant les actions secondaires (hors primaryAction et quickStatusAction). */
  readonly menuItems = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [];
    const primary = this.primaryAction();
    const quick = this.quickStatusAction();

    const add = (label: string, icon: string, command: () => void, visible: boolean) => {
      if (visible) {
        items.push({ label, icon, command, visible: true });
      }
    };

    const exposed = new Set([primary?.id, quick?.id].filter(Boolean));

    // Exclure les actions déjà exposées en primaire (header) ou en CTA statut (sidebar).
    add(
      'Confirmer',
      'pi-check',
      () => this.confirmOrder(),
      this.canConfirm() && !exposed.has(SalesOrderDetailComponent.ACTION_CONFIRM)
    );
    add(
      'Générer un BL',
      'pi-truck',
      () => this.openGenerateDeliveryNote(),
      this.canGenerateDeliveryNote() && !exposed.has(SalesOrderDetailComponent.ACTION_GENERATE_BL)
    );
    add(
      'Générer une facture',
      'pi-file-export',
      () => this.openGenerateInvoice(),
      this.canGenerateInvoice() && !exposed.has(SalesOrderDetailComponent.ACTION_GENERATE_INVOICE)
    );
    add('Remise de pied', 'pi-percentage', () => this.openDiscount(), this.canEditDiscount());

    const canCloseInMenu = this.canClose() && !exposed.has(SalesOrderDetailComponent.ACTION_CLOSE);
    const canCancelInMenu = this.canCancel() && !exposed.has(SalesOrderDetailComponent.ACTION_CANCEL);

    if (canCloseInMenu || canCancelInMenu) {
      items.push({ separator: true });
    }

    add('Solder', 'pi-flag', () => this.openClose(), canCloseInMenu);
    add('Annuler', 'pi-times', () => this.openCancel(), canCancelInMenu);

    return items;
  });

  /** Timeline du cycle de commande. */
  readonly timelineEvents = computed<TimelineEvent[]>(() => {
    const o = this.order();
    if (!o) return [];

    const stepColor = (stepStatus: SalesOrderStatus, currentStatus: SalesOrderStatus) => {
      const order = ['Draft', 'Confirmed', 'PartiallyDelivered', 'Delivered', 'Completed'];
      const stepIndex = order.indexOf(stepStatus);
      const currentIndex = order.indexOf(currentStatus);

      if (currentStatus === 'Cancelled') return '#94a3b8';
      if (currentStatus === 'Closed') return '#f59e0b';
      if (stepIndex <= currentIndex) return '#2563eb';
      return '#94a3b8';
    };

    const events: TimelineEvent[] = [
      { status: 'Brouillon', icon: 'pi-file-edit', color: stepColor('Draft', o.status), date: o.orderDate },
      { status: 'Confirmée', icon: 'pi-check-circle', color: stepColor('Confirmed', o.status) },
      { status: 'Livraison', icon: 'pi-truck', color: o.totalPendingDeliveryQuantity === 0 ? '#10b981' : stepColor('PartiallyDelivered', o.status) },
      { status: 'Facturation', icon: 'pi-file-export', color: o.totalPendingInvoiceQuantity === 0 ? '#10b981' : stepColor('Delivered', o.status) },
      { status: 'Terminée', icon: 'pi-check', color: stepColor('Completed', o.status) }
    ];

    if (o.status === 'Cancelled') {
      events.push({ status: 'Annulée', icon: 'pi-times-circle', color: '#dc2626' });
    } else if (o.status === 'Closed') {
      events.push({ status: 'Soldée', icon: 'pi-flag', color: '#f59e0b' });
    }

    return events;
  });

  /** Confirmable seulement au brouillon : le domaine refuse toute autre transition. */
  readonly canConfirm = computed(
    () => this.order()?.status === 'Draft' && this.auth.hasPermission(PERMISSIONS.salesOrders.update)
  );

  /** Solder n'a de sens que s'il reste effectivement à livrer. */
  readonly canClose = computed(() => {
    const o = this.order();
    if (!o) return false;
    const open = o.status === 'Confirmed' || o.status === 'PartiallyDelivered';
    return open && o.totalPendingDeliveryQuantity > 0
      && this.auth.hasPermission(PERMISSIONS.salesOrders.update);
  });

  /** La remise ne se pose que tant que la commande est modifiable. */
  readonly canEditDiscount = computed(
    () => this.order()?.status === 'Draft' && this.auth.hasPermission(PERMISSIONS.salesOrders.update)
  );

  /** Générer un BL depuis la commande : possible dès qu'il reste à livrer. */
  readonly canGenerateDeliveryNote = computed(() => {
    const o = this.order();
    if (!o) return false;
    const open = o.status === 'Confirmed' || o.status === 'PartiallyDelivered';
    return open && o.totalPendingDeliveryQuantity > 0 && this.auth.hasPermission(PERMISSIONS.deliveryNotes.create);
  });

  /** Générer une facture depuis la commande : soit sur le livré, soit en avance. */
  readonly canGenerateInvoice = computed(() => {
    const o = this.order();
    if (!o) return false;
    const open = o.status === 'Confirmed' || o.status === 'PartiallyDelivered' || o.status === 'Delivered';
    if (!open) return false;
    const delivered = o.lines.reduce((sum, l) => sum + l.deliveredNotInvoicedQuantity, 0);
    const pending = o.lines.reduce((sum, l) => sum + l.pendingInvoiceQuantity, 0);
    return (delivered > 0 || pending > 0) && this.auth.hasPermission(PERMISSIONS.invoices.create);
  });

  readonly canCancel = computed(() => {
    const o = this.order();
    if (!o) return false;
    const cancellable = o.status === 'Draft' || o.status === 'Confirmed';
    return cancellable && this.auth.hasPermission(PERMISSIONS.salesOrders.update);
  });

  readonly deliveryProgress = computed(() => this.progress('delivered'));
  readonly invoiceProgress = computed(() => this.progress('invoiced'));

  ngOnInit(): void {
    this.orderId = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.salesOrderService.getSalesOrder(this.orderId).subscribe({
      next: res => {
        this.order.set(res.data ?? null);
        this.loading.set(false);
      },
      error: err => {
        this.showError(err, $localize`:@@sales-orders.sales-order-detail.ts.impossible.de.charger.la.commande.bcc63a71:Impossible de charger la commande`);
        this.errorHandler.logError('Failed to load sales order', err);
        this.order.set(null);
        this.loading.set(false);
      }
    });
  }

  private progress(kind: 'delivered' | 'invoiced'): number {
    const o = this.order();
    if (!o || o.lines.length === 0) return 0;

    const ordered = o.lines.reduce((s: number, l: SalesOrderLine) => s + l.quantity, 0);
    if (ordered === 0) return 0;

    const done = o.lines.reduce(
      (s: number, l: SalesOrderLine) => s + (kind === 'delivered' ? l.deliveredQuantity : l.invoicedQuantity),
      0
    );

    return Math.round((done / ordered) * 100);
  }

  statusSeverity(status: SalesOrderStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    switch (status) {
      case 'Draft':
        return 'secondary';
      case 'Confirmed':
      case 'Delivered':
        return 'info';
      case 'PartiallyDelivered':
        return 'warning';
      case 'Completed':
        return 'success';
      case 'Cancelled':
        return 'danger';
      case 'Closed':
        return 'warning';
      default:
        return 'secondary';
    }
  }

  /**
   * Avant de confirmer, on regarde l'encours du client et on l'affiche dans la demande de
   * confirmation.
   *
   * ⚠️ C'est un AVERTISSEMENT, pas un verrou : le bouton reste « Confirmer » même en
   * dépassement. Décision produit — le commercial connaît son client mieux que la règle.
   */
  confirmOrder(): void {
    const clientId = this.order()?.clientId;
    if (!clientId) return;

    this.clientService.getClientOutstanding(clientId).subscribe({
      next: res => this.askConfirmation(res.success ? res.data : null),
      // L'encours indisponible ne doit pas empêcher de confirmer : on demande sans lui.
      error: () => this.askConfirmation(null)
    });
  }

  private askConfirmation(outstanding: ClientOutstanding | null): void {
    let message =
      $localize`:@@ui.tern.confirmer.engage.fermement.la.commande.et..59ec81:Confirmer engage fermement la commande et rend les lignes non modifiables. ` +
      $localize`:@@ui.tern.si.la.reservation.de.stock.est.activee.le..7bb555:Si la réservation de stock est activée, le stock sera réservé.`;

    if (outstanding?.isOverLimit) {
      message +=
        `\n\n⚠️ Encours du client : ${outstanding.totalOutstanding.toFixed(3)} ` +
        `${outstanding.currency}, au-delà de son plafond de ` +
        `${(outstanding.creditLimit ?? 0).toFixed(3)}. La commande reste confirmable.`;
    } else if (outstanding && outstanding.overdueAmount > 0) {
      message +=
        `\n\n⚠️ ${outstanding.overdueAmount.toFixed(3)} ${outstanding.currency} ` +
        $localize`:@@ui.tern.echus.depuis.plus.de.30.jours.chez.ce.clie.ee6846:échus depuis plus de 30 jours chez ce client.`;
    }

    this.confirmationService.confirm({
      header: $localize`:@@sales-orders.sales-order-detail.ts.confirmer.la.commande.3af7f44c:Confirmer la commande`,
      message,
      icon: 'pi pi-check-circle',
      acceptLabel: $localize`:@@sales-order-detail.component.acceptLabel.Confirmer:Confirmer`,
      rejectLabel: $localize`:@@sales-order-detail.component.rejectLabel.Retour:Retour`,
      accept: () => this.doConfirm()
    });
  }

  private doConfirm(): void {
    this.acting.set(true);
    this.salesOrderService.confirmSalesOrder(this.orderId).subscribe({
      next: () => {
        this.toastService.add({ severity: 'success', summary: $localize`:@@sales-order-detail.component.summary.Succès:Succès`, detail: $localize`:@@sales-order-detail.component.detail.Commande_confirm:Commande confirmée.` });
        this.acting.set(false);
        this.load();
      },
      error: err => {
        this.showError(err, $localize`:@@sales-orders.sales-order-detail.ts.confirmation.impossible.fde41ea5:Confirmation impossible`);
        this.errorHandler.logError('Confirm sales order failed', err);
        this.acting.set(false);
      }
    });
  }

  openDiscount(): void {
    const o = this.order();
    this.discountPercent = o?.globalDiscountPercent ?? null;
    this.discountAmount = o?.globalDiscountPercent ? null : (o?.globalDiscountAmount || null);
    this.discountVisible = true;
  }

  // Pourcentage et montant sont exclusifs côté serveur : on efface l'autre plutôt que de
  // laisser l'utilisateur soumettre une saisie qui sera refusée.
  onPercentInput(): void {
    if (this.discountPercent) this.discountAmount = null;
  }

  onAmountInput(): void {
    if (this.discountAmount) this.discountPercent = null;
  }

  saveDiscount(): void {
    this.acting.set(true);
    this.salesOrderService
      .setGlobalDiscount(this.orderId, this.discountPercent, this.discountAmount)
      .subscribe({
        next: () => {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@sales-order-detail.component.summary.Succès:Succès`,
            detail: $localize`:@@sales-order-detail.component.detail.Remise_de_pied_e:Remise de pied enregistrée.`
          });
          this.discountVisible = false;
          this.acting.set(false);
          this.load();
        },
        error: err => {
          this.showError(err, $localize`:@@sales-orders.sales-order-detail.ts.enregistrement.de.la.remise.impossible.ebd883d2:Enregistrement de la remise impossible`);
          this.errorHandler.logError('Set global discount failed', err);
          this.acting.set(false);
        }
      });
  }

  openCancel(): void {
    this.cancelReason = '';
    this.cancelVisible = true;
  }

  doCancel(): void {
    this.acting.set(true);
    this.salesOrderService.cancelSalesOrder(this.orderId, this.cancelReason.trim()).subscribe({
      next: () => {
        this.toastService.add({ severity: 'success', summary: $localize`:@@sales-order-detail.component.summary.Succès:Succès`, detail: $localize`:@@sales-order-detail.component.detail.Commande_annul_e:Commande annulée.` });
        this.cancelVisible = false;
        this.acting.set(false);
        this.load();
      },
      error: err => {
        this.showError(err, $localize`:@@sales-orders.sales-order-detail.ts.annulation.impossible.54c16533:Annulation impossible`);
        this.errorHandler.logError('Cancel sales order failed', err);
        this.acting.set(false);
      }
    });
  }

  openClose(): void {
    this.closeReason = '';
    this.closeVisible = true;
  }

  doClose(): void {
    this.acting.set(true);
    this.salesOrderService.closeSalesOrder(this.orderId, this.closeReason.trim()).subscribe({
      next: () => {
        this.toastService.add({ severity: 'success', summary: $localize`:@@sales-order-detail.component.summary.Succès:Succès`, detail: $localize`:@@sales-order-detail.component.detail.Commande_sold_e_:Commande soldée.` });
        this.closeVisible = false;
        this.acting.set(false);
        this.load();
      },
      error: err => {
        this.showError(err, $localize`:@@sales-orders.sales-order-detail.ts.solde.impossible.28d2747d:Solde impossible`);
        this.errorHandler.logError('Close sales order failed', err);
        this.acting.set(false);
      }
    });
  }

  openGenerateDeliveryNote(): void {
    const o = this.order();
    if (!o) return;
    this.deliveryNoteIssueDate = this.formatDateForInput(new Date());
    this.deliveryNoteAddress = o.client.address ?? '';
    this.deliveryNoteLines = o.lines.map(l => ({
      salesOrderLineId: l.id,
      lineNumber: l.lineNumber,
      productCode: l.productCode,
      productName: l.productName,
      pendingQuantity: l.pendingDeliveryQuantity,
      quantity: l.pendingDeliveryQuantity
    }));
    this.deliveryNoteDialogVisible = true;
  }

  resetDeliveryNoteQuantities(): void {
    this.deliveryNoteLines.forEach(l => l.quantity = l.pendingQuantity);
  }

  submitGenerateDeliveryNote(): void {
    const lines = this.deliveryNoteLines.filter(l => l.quantity > 0);
    if (lines.length === 0) {
      this.toastService.add({ severity: 'warn', summary: $localize`:@@sales-order-detail.component.summary.Avertissement:Avertissement`, detail: $localize`:@@sales-order-detail.component.detail.aucune.quantite.a.livrer.096c2041:Aucune quantité à livrer.` });
      return;
    }

    const allMax = lines.every(l => l.quantity === l.pendingQuantity);
    const request: GenerateDeliveryNoteRequest = {
      issueDate: this.deliveryNoteIssueDate,
      deliveryAddress: this.deliveryNoteAddress.trim() || undefined
    };
    if (!allMax) {
      request.lines = lines.map(l => ({ salesOrderLineId: l.salesOrderLineId, quantity: l.quantity }));
    }

    this.acting.set(true);
    this.salesOrderService.generateDeliveryNote(this.orderId, request).subscribe({
      next: res => {
        this.acting.set(false);
        if (res.success && res.data) {
          this.deliveryNoteDialogVisible = false;
          this.toastService.add({ severity: 'success', summary: $localize`:@@sales-order-detail.component.summary.Succès:Succès`, detail: $localize`:@@sales-order-detail.component.detail.Bon_de_livraison:Bon de livraison généré.` });
          this.router.navigate(['/delivery-notes', res.data]);
        } else {
          this.toastService.add({ severity: 'error', summary: $localize`:@@sales-order-detail.component.summary.Erreur:Erreur`, detail: res.message || $localize`:@@sales-orders.sales-order-detail.ts.generation.impossible.0031b83e:Génération impossible.` });
        }
      },
      error: err => {
        this.acting.set(false);
        this.showError(err, $localize`:@@sales-orders.sales-order-detail.ts.generation.du.bon.de.livraison.impossibl.7cf4f9a2:Génération du bon de livraison impossible`);
      }
    });
  }

  openGenerateInvoice(): void {
    const o = this.order();
    if (!o) return;
    this.invoiceIssueDate = this.formatDateForInput(new Date());
    this.invoiceDueDate = null;
    this.advanceBilling = false;
    this.resetInvoiceLinesFromOrder();
    this.invoiceDialogVisible = true;
  }

  private resetInvoiceLinesFromOrder(): void {
    const o = this.order();
    if (!o) return;
    this.invoiceLines = o.lines.map(l => {
      const available = this.advanceBilling ? l.pendingInvoiceQuantity : l.deliveredNotInvoicedQuantity;
      return {
        salesOrderLineId: l.id,
        lineNumber: l.lineNumber,
        productCode: l.productCode,
        productName: l.productName,
        availableQuantity: available,
        quantity: available
      };
    });
  }

  resetInvoiceQuantities(): void {
    this.invoiceLines.forEach(l => l.quantity = l.availableQuantity);
  }

  onAdvanceBillingChange(): void {
    this.resetInvoiceLinesFromOrder();
  }

  submitGenerateInvoice(): void {
    const lines = this.invoiceLines.filter(l => l.quantity > 0);
    if (lines.length === 0) {
      this.toastService.add({ severity: 'warn', summary: $localize`:@@sales-order-detail.component.summary.Avertissement:Avertissement`, detail: $localize`:@@sales-order-detail.component.detail.aucune.quantite.a.facturer.88957e15:Aucune quantité à facturer.` });
      return;
    }

    const allMax = lines.every(l => l.quantity === l.availableQuantity);
    const request: GenerateInvoiceFromOrderRequest = {
      issueDate: this.invoiceIssueDate,
      dueDate: this.invoiceDueDate || undefined,
      advanceBilling: this.advanceBilling
    };
    if (!allMax) {
      request.lines = lines.map(l => ({ salesOrderLineId: l.salesOrderLineId, quantity: l.quantity }));
    }

    this.acting.set(true);
    this.salesOrderService.generateInvoice(this.orderId, request).subscribe({
      next: res => {
        this.acting.set(false);
        if (res.success && res.data) {
          this.invoiceDialogVisible = false;
          this.toastService.add({ severity: 'success', summary: $localize`:@@sales-order-detail.component.summary.Succès:Succès`, detail: $localize`:@@sales-order-detail.component.detail.Facture_g_n_r_e_:Facture générée.` });
          this.router.navigate(['/invoices', res.data]);
        } else {
          this.toastService.add({ severity: 'error', summary: $localize`:@@sales-order-detail.component.summary.Erreur:Erreur`, detail: res.message || $localize`:@@sales-orders.sales-order-detail.ts.generation.impossible.0031b83e:Génération impossible.` });
        }
      },
      error: err => {
        this.acting.set(false);
        this.showError(err, $localize`:@@sales-orders.sales-order-detail.ts.generation.de.la.facture.impossible.255bb677:Génération de la facture impossible`);
      }
    });
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private showError(err: unknown, fallback: string): void {
    const msg = this.errorHandler.extractErrorMessage(err);
    this.toastService.add({ severity: 'error', summary: $localize`:@@sales-order-detail.component.summary.Erreur:Erreur`, detail: msg || fallback });
  }
}
