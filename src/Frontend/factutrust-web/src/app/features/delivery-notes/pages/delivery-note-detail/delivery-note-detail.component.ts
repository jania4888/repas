/// <reference types="@angular/localize" />
import { API_ERROR_CODE } from '@core/utils/api-error-code';
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
import { DialogModule } from 'primeng/dialog';
import { DatePickerModule } from 'primeng/datepicker';
import { formatLocalDate } from '@core/utils/date.util';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { MenuItem } from '@shared/models/menu-item.model';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DocumentActionsMenuComponent } from '@shared/components/document-actions-menu/document-actions-menu.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ProductService } from '@core/services/product.service';
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
  shouldBlockDocumentStockExit,
  resolveEffectiveWarehouse
} from '@shared/utils/stock-traceability.utils';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { DeliveryNoteService } from '../../services/delivery-note.service';
import {
  DeliveryNoteDetailDto,
  DeliveryNoteStatus,
  RecordDeliveryDto,
  RecordDeliveryLineDto,
  canCreateReturnNoteFromDeliveryNote,
  canGenerateInvoiceFromDeliveryNote
} from '../../models/delivery-note.model';

@Component({
  selector: 'app-delivery-note-detail',
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
    DialogModule,
    DatePickerModule,
    InputTextModule,
    InputNumberModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    DocumentActionsMenuComponent,
    StatusBadgeComponent,
    StockAllocationEditorComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    
    <app-page-header 
      [title]="deliveryNote()?.number || 'Chargement...'" 
      [subtitle]="loc_ui_tern_bon_de_livraison_du_b10ffc + (deliveryNote()?.issueDate | date:'dd/MM/yyyy')">
      <app-button 
        variant="outline"
        icon="pi-arrow-left"
        iconPos="left"
        routerLink="/delivery-notes" i18n="@@delivery-notes.pages.retour.e5befb1f"> Retour </app-button>
      @if (canCreateReturnNote()) {
        <app-button
          variant="outline"
          icon="pi-replay"
          iconPos="left"
          (clicked)="createReturnNote()" i18n="@@delivery-notes.pages.creer.un.bon.de.retour.a9261008"> Créer un bon de retour </app-button>
      }
      @if (primaryAction(); as action) {
        <app-button
          [variant]="action.variant"
          [icon]="action.icon"
          iconPos="left"
          [disabled]="workflowActionInProgress()"
          (clicked)="action.command()">
          {{ action.label }}
        </app-button>
      }
      @if (deliveryNote()) {
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
    } @else if (deliveryNote()) {
      <div class="detail-grid">
        <!-- Main Content -->
        <div class="main-content">
          <p-card styleClass="delivery-note-card">
            <!-- Header -->
            <div class="delivery-note-header">
              <div class="delivery-note-meta">
                <h2>{{ deliveryNote()!.number }}</h2>
                <app-status-badge 
                  [status]="getStatusBadgeStatus(deliveryNote()!.status)"
                  [label]="deliveryNote()!.statusDisplay | backendLabel">
                </app-status-badge>
              </div>
              <div class="delivery-note-dates">
                <div class="date-item">
                  <span class="label" i18n="@@delivery-notes.pages.date.d.emission.99f68857">Date d'émission</span>
                  <span class="value">{{ deliveryNote()!.issueDate | date:'dd/MM/yyyy' }}</span>
                </div>
                @if (deliveryNote()!.deliveryDate) {
                  <div class="date-item">
                    <span class="label" i18n="@@delivery-notes.pages.date.de.livraison.39361f0f">Date de livraison</span>
                    <span class="value">{{ deliveryNote()!.deliveryDate | date:'dd/MM/yyyy' }}</span>
                  </div>
                }
              </div>
            </div>

            <p-divider></p-divider>

            <!-- Client Info -->
            <div class="parties-grid">
              <div class="party-card">
                <h4 i18n="@@delivery-notes.pages.client.1bdd79b1">Client</h4>
                <p class="party-name">{{ deliveryNote()!.clientName }}</p>
                @if (deliveryNote()!.clientEmail) {
                  <p class="party-email">{{ deliveryNote()!.clientEmail }}</p>
                }
              </div>
              <div class="party-card">
                <h4 i18n="@@delivery-notes.pages.adresse.de.livraison.31eac756">Adresse de livraison</h4>
                <p class="party-address">{{ deliveryNote()!.deliveryAddress }}</p>
                @if (deliveryNote()!.deliveryCity) {
                  <p class="party-address">{{ deliveryNote()!.deliveryPostalCode }} {{ deliveryNote()!.deliveryCity }}</p>
                }
                @if (deliveryNote()!.recipientName) {
                  <p class="party-recipient"><strong i18n="@@delivery-notes.pages.destinataire.2935a4d5">Destinataire:</strong> {{ deliveryNote()!.recipientName }}</p>
                }
              </div>
            </div>

            <p-divider></p-divider>

            <!-- Lines -->
            <div class="lines-section">
              <h4 i18n="@@delivery-notes.pages.lignes.du.bon.de.livraison.f2475b32">Lignes du bon de livraison</h4>
              <table class="lines-table">
                <thead>
                  <tr>
                    <th i18n="@@delivery-notes.pages.text.d08f88df">#</th>
                    <th i18n="@@delivery-notes.pages.designation.63a9062c">Désignation</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.prix.u.ht.8bf47793">Prix U. HT</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.qte.comm.3bd32f16">Qté Comm.</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.qte.livree.22a60015">Qté Livrée</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.retourne.4027bfdd">Retourné</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.a.facturer.acd40e67">À facturer</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.qte.rejetee.c6ab2d5a">Qté Rejetée</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.remise.ce12d942">Remise</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.tva.fb62cb5d">TVA</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.total.ht.2ca17ae6">Total HT</th>
                    <th class="text-right" i18n="@@delivery-notes.pages.total.ttc.9e80ff7c">Total TTC</th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of deliveryNote()!.lines; track line.id) {
                    <tr [class.fully-delivered]="line.isFullyDelivered">
                      <td>{{ line.lineNumber }}</td>
                      <td>
                        <span class="line-name">{{ line.designation }}</span>
                        @if (line.description) {
                          <br><small class="line-desc">{{ line.description }}</small>
                        }
                        @if (line.productCode) {<ng-container i18n="@@delivery-notes.pages.code.229d37db">
                          <br><small class="line-code">Code: {{ line.productCode }}</small>
                        </ng-container>}
                      </td>
                      <td class="text-right mono">{{ line.unitPriceHT | number:'1.3-3' }} TND / {{ line.unit }}</td>
                      <td class="text-right mono">{{ line.orderedQuantity | number:'1.0-3' }}</td>
                      <td class="text-right mono">{{ line.deliveredQuantity | number:'1.0-3' }}</td>
                      <td class="text-right mono">{{ (line.returnedQuantity ?? 0) | number:'1.0-3' }}</td>
                      <td class="text-right mono">{{ (line.invoiceableQuantity ?? line.deliveredQuantity) | number:'1.0-3' }}</td>
                      <td class="text-right mono">
                        {{ line.rejectedQuantity | number:'1.0-3' }}
                        @if (line.rejectionReason) {
                          <i class="pi pi-info-circle" [pTooltip]="line.rejectionReason"></i>
                        }
                      </td>
                      <td class="text-right mono">
                        @if (line.discountPercent) {
                          {{ line.discountPercent | number:'1.0-2' }}%
                        } @else {
                          —
                        }
                      </td>
                      <td class="text-right mono">{{ line.vatRatePercent }}%</td>
                      <td class="text-right mono">{{ line.totalHT | number:'1.3-3' }} TND</td>
                      <td class="text-right mono">{{ line.totalTTC | number:'1.3-3' }} TND</td>
                    </tr>
                  }
                </tbody>
              </table>
              
              <div class="totals-section">
                <div class="total-row">
                  <span i18n="@@delivery-notes.pages.total.ht.2ca17ae6">Total HT</span>
                  <span class="mono">{{ deliveryNote()!.totalHT | number:'1.3-3' }} TND</span>
                </div>
                @if (totalFodec() > 0) {
                  <div class="total-row">
                    <span i18n="@@delivery-notes.pages.fodec.9a029080">FODEC</span>
                    <span class="mono">{{ totalFodec() | number:'1.3-3' }} TND</span>
                  </div>
                }
                <div class="total-row">
                  <span i18n="@@delivery-notes.pages.total.tva.605c4b2e">Total TVA</span>
                  <span class="mono">{{ deliveryNote()!.totalVAT | number:'1.3-3' }} TND</span>
                </div>
                <div class="total-row total-ttc">
                  <span i18n="@@delivery-notes.pages.total.ttc.9e80ff7c">Total TTC</span>
                  <span class="mono">{{ deliveryNote()!.totalTTC | number:'1.3-3' }} TND</span>
                </div>
              </div>
            </div>

            @if (isFullyReturned()) {
              <p-divider></p-divider>
              <p class="return-info" i18n="@@delivery-notes.pages.toutes.les.quantites.livrees.ont.ete.retournees..812a9aee"> Toutes les quantités livrées ont été retournées — impossible de facturer.
                Ce n'est pas un avoir : le stock a déjà été réintégré via le bon de retour. </p>
            }

            @if (deliveryNote()!.returnNotes?.length) {
              <p-divider></p-divider>
              <div class="return-notes-section">
                <h4 i18n="@@delivery-notes.pages.bons.de.retour.lies.fedece91">Bons de retour liés</h4>
                <ul class="return-notes-list">
                  @for (rtn of deliveryNote()!.returnNotes!; track rtn.id) {
                    <li i18n="@@delivery-notes.pages.qte.777e87ad">
                      <a [routerLink]="['/return-notes', rtn.id]">{{ rtn.number }}</a>
                      <span> — {{ rtn.statusDisplay | backendLabel }} · {{ rtn.returnDate | date:'dd/MM/yyyy' }} · qté {{ rtn.totalReturnedQuantity | number:'1.0-3' }}</span>
                    </li>
                  }
                </ul>
              </div>
            }

            @if (deliveryNote()!.notes || deliveryNote()!.reference) {
              <p-divider></p-divider>
              <div class="notes-section">
                @if (deliveryNote()!.reference) {
                  <div class="note">
                    <strong i18n="@@delivery-notes.pages.reference.b55d2a20">Référence:</strong> {{ deliveryNote()!.reference }}
                  </div>
                }
                @if (deliveryNote()!.notes) {
                  <div class="note">
                    <strong i18n="@@delivery-notes.pages.notes.9c3befe7">Notes:</strong> {{ deliveryNote()!.notes }}
                  </div>
                }
              </div>
            }
          </p-card>
        </div>

        <!-- Sidebar -->
        <div class="sidebar">
          <!-- Status Card -->
          <p-card header="Statut" i18n-header="@@delivery-notes.pages.statut.659499f3" styleClass="status-card">
            <div class="status-content">
              <app-status-badge 
                [status]="getStatusBadgeStatus(deliveryNote()!.status)"
                [label]="deliveryNote()!.statusDisplay | backendLabel">
              </app-status-badge>
            </div>
          </p-card>

          <p-card header="Entrepôt" i18n-header="@@delivery-notes.pages.entrepot.c349c0bc" styleClass="status-card">
            <div class="status-content">
              <span>{{ deliveryNote()!.warehouseName || 'Entrepôt par défaut' }}</span>
            </div>
          </p-card>

          <!-- Signature Info -->
          @if (deliveryNote()!.signedAt) {
            <p-card header="Signature" i18n-header="@@delivery-notes.pages.signature.2f32be1d" styleClass="signature-card">
              <div class="signature-info">
                <div class="info-row">
                  <i class="pi pi-verified"></i>
                  <span i18n="@@delivery-notes.pages.livraison.signee.9fb4ab89">Livraison signée</span>
                </div>
                <small i18n="@@delivery-notes.pages.signe.le.71c9e3e1">Signé le {{ deliveryNote()!.signedAt | date:'dd/MM/yyyy HH:mm' }}</small>
                @if (deliveryNote()!.recipientName) {
                  <small i18n="@@delivery-notes.pages.par.4a4180cc">Par: {{ deliveryNote()!.recipientName }}</small>
                }
              </div>
            </p-card>
          }
        </div>
      </div>

      <!-- Delivery Recording Dialog -->
      <p-dialog 
        header="Enregistrer la livraison" i18n-header="@@delivery-notes.pages.enregistrer.la.livraison.689980db" 
        [(visible)]="showDeliveryDialog" 
        [modal]="true"
        styleClass="ft-dialog-scrollable"
        [style]="{width: '920px', maxWidth: '95vw'}"
        [draggable]="false"
        [resizable]="false">
        <div class="delivery-dialog-content">
          <div class="delivery-context-banner">
            <span class="delivery-context-number">{{ deliveryNote()!.number }}</span>
            @if (deliveryWarehouseLabel()) {
              <span class="delivery-context-warehouse">
                <ng-container i18n="@@delivery-notes.pages.deduction.depuis.35c6b781"> Déduction depuis </ng-container> <strong>{{ deliveryWarehouseLabel() }}</strong>
                @if (deliveryWarehouseIsDefault()) {
                  <span class="delivery-default-badge" i18n="@@delivery-notes.pages.par.defaut.feee7660">par défaut</span>
                }
              </span>
            }
          </div>
          @if (deliveryContextLoading()) {
            <p class="delivery-loading muted" i18n="@@delivery-notes.pages.verification.du.stock.0ae6d17a">
              <i class="pi pi-spin pi-spinner"></i>
              Vérification du stock…
            </p>
          } @else if (deliveryContextError()) {
            <div class="delivery-stock-alert delivery-stock-alert--error" role="alert">
              <i class="pi pi-exclamation-circle"></i>
              <span>{{ deliveryContextError() }}</span>
            </div>
          } @else {
            @if (deliveryStockBlocked()) {
              <div class="delivery-stock-alert delivery-stock-alert--error" role="alert">
                <i class="pi pi-times-circle"></i>
                <div>
                  <p>{{ deliveryStockCheck()?.summaryMessage || 'Aucun stock trouvé pour un produit dans cet entrepôt.' }}</p>
                  <p i18n="@@delivery-notes.pages.ajoutez.du.stock.dans.cet.entrepot.avant.de.vali.0fa91ed7">Ajoutez du stock dans cet entrepôt avant de valider.</p>
                  <a routerLink="/stock" (click)="showDeliveryDialog = false" i18n="@@delivery-notes.pages.ajouter.du.stock.b3d3468f">Ajouter du stock</a>
                </div>
              </div>
            } @else if (hasMissingWarehouseLots()) {
              <div class="delivery-stock-alert delivery-stock-alert--error" role="alert">
                <i class="pi pi-times-circle"></i>
                <div>
                  @if (hasOnlyExpiredWarehouseLots()) {
                    <p i18n="@@delivery-notes.pages.tous.les.lots.disponibles.sont.perimes.pour.au.m.d7718b50">Tous les lots disponibles sont périmés pour au moins un article suivi. Ils ne peuvent pas sortir.</p>
                    <p i18n="@@delivery-notes.pages.choisissez.un.lot.non.perime.ou.receptionnez.un..89ff9112">Choisissez un lot non périmé, ou réceptionnez un lot valide avant de valider.</p>
                  } @else {
                    <p i18n="@@delivery-notes.pages.le.stock.de.cet.entrepot.n.a.pas.de.lots.ou.de.n.de44cfd5">Le stock de cet entrepôt n'a pas de lots (ou de n° de série) pour au moins un article suivi.</p>
                    <p i18n="@@delivery-notes.pages.receptionnez.d.abord.le.stock.avec.un.n.de.lot.o.2b6eba9f">Réceptionnez d'abord le stock avec un n° de lot, ou faites un inventaire d'ouverture.</p>
                  }
                </div>
              </div>
            } @else if ((deliveryStockCheck()?.insufficientCount ?? 0) > 0) {
              <div class="delivery-stock-alert delivery-stock-alert--warning" role="status">
                <i class="pi pi-exclamation-triangle"></i>
                <span>{{ deliveryStockCheck()?.summaryMessage }}</span>
              </div>
            }
          }

          <div class="delivery-form-grid">
            <div class="delivery-form-group">
              <label for="recipientName"><ng-container i18n="@@delivery-notes.pages.nom.du.receptionnaire.9b14b159">Nom du réceptionnaire </ng-container> <span class="required" i18n="@@delivery-notes.pages.text.df58248c">*</span></label>
              <input pInputText id="recipientName" [(ngModel)]="deliveryForm.recipientName" 
                placeholder="Personne ayant signé la réception" i18n-placeholder="@@delivery-notes.pages.personne.ayant.signe.la.reception.f5966786" class="w-full delivery-header-input" />
            </div>
            <div class="delivery-form-group">
              <label for="deliveryDate"><ng-container i18n="@@delivery-notes.pages.date.de.livraison.39361f0f">Date de livraison </ng-container> <span class="required" i18n="@@delivery-notes.pages.text.df58248c">*</span></label>
              <p-datepicker
                id="deliveryDate"
                [(ngModel)]="deliveryForm.deliveryDate"
                name="deliveryDate"
                dateFormat="dd/mm/yy"
                [showIcon]="true"
                placeholder="Date effective de réception" i18n-placeholder="@@delivery-notes.pages.date.effective.de.reception.078d93ec"
                styleClass="w-full delivery-header-datepicker"
                appendTo="body">
              </p-datepicker>
            </div>
          </div>
          
          <h4 class="delivery-lines-title" i18n="@@delivery-notes.pages.quantites.livrees.par.ligne.66d9901f">Quantités livrées par ligne</h4>
          <div class="delivery-lines-table-wrap">
            <table class="delivery-lines-form">
              <thead>
                <tr>
                  <th i18n="@@delivery-notes.pages.produit.ff673dc2">Produit</th>
                  <th class="text-right" i18n="@@delivery-notes.pages.qte.commandee.8c1ee02c">Qté commandée</th>
                  <th class="text-right" i18n="@@delivery-notes.pages.qte.livree.c6320ced">Qté livrée</th>
                  <th class="text-right" i18n="@@delivery-notes.pages.qte.rejetee.bf3a66b4">Qté rejetée</th>
                  <th class="motif-col" i18n="@@delivery-notes.pages.motif.refus.2b32c88a">Motif refus</th>
                </tr>
              </thead>
              <tbody>
                @for (lineForm of deliveryLinesForms; track lineForm.lineId) {
                  <tr>
                    <td>{{ lineForm.designation }}</td>
                    <td class="text-right mono">{{ lineForm.orderedQuantity }}</td>
                    <td class="text-right qty-cell">
                      <p-inputNumber [(ngModel)]="lineForm.deliveredQuantity" 
                        [min]="0" [max]="lineForm.orderedQuantity" 
                        [minFractionDigits]="0" [maxFractionDigits]="3"
                        styleClass="delivery-qty-input"
                        inputStyleClass="input-sm text-right"
                        (onInput)="onDeliveredQuantityChange(lineForm)" />
                    </td>
                    <td class="text-right qty-cell">
                      <p-inputNumber [(ngModel)]="lineForm.rejectedQuantity" 
                        [min]="0" [max]="lineForm.orderedQuantity" 
                        [minFractionDigits]="0" [maxFractionDigits]="3"
                        styleClass="delivery-qty-input"
                        inputStyleClass="input-sm text-right" />
                    </td>
                    <td class="motif-col">
                      @if (lineForm.rejectedQuantity > 0) {
                        <input pInputText [(ngModel)]="lineForm.rejectionReason" 
                          placeholder="Motif du refus" i18n-placeholder="@@delivery-notes.pages.motif.du.refus.e4d6bc0b" class="motif-input w-full" />
                      } @else {
                        <span class="motif-empty" i18n="@@delivery-notes.pages.text.1b93795b">—</span>
                      }
                    </td>
                  </tr>
                  @if (showLineTraceability(lineForm) && lineForm.deliveredQuantity > 0 && deliveryEffectiveWarehouseId()) {
                    <tr class="delivery-alloc-row">
                      <td colspan="5">
                        <app-stock-allocation-editor
                          mode="exit"
                          [productId]="lineForm.productId"
                          [warehouseId]="deliveryEffectiveWarehouseId()!"
                          [lineQuantity]="lineForm.deliveredQuantity"
                          [trackingMode]="lineForm.trackingMode"
                          [pickingPolicy]="lineForm.pickingPolicy"
                          [hasExpiryTracking]="lineForm.hasExpiryTracking"
                          [features]="stockFeatures()"
                          [allocations]="lineForm.lotAllocations"
                          (availabilityChange)="onDeliveryAllocAvailability($event)"
                          (lotStockValidChange)="onDeliveryLotStockValid($event)" />
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </div>
        @if (deliverySubmitError()) {
          <div class="delivery-stock-alert delivery-stock-alert--error" role="alert">
            <i class="pi pi-exclamation-circle"></i>
            <span>{{ deliverySubmitError() }}</span>
          </div>
        }
        <ng-template pTemplate="footer">
          <div class="dialog-footer">
            <app-button variant="outline" icon="pi-times" iconPos="left" (click)="showDeliveryDialog = false" i18n="@@delivery-notes.pages.annuler.49ba3292">Annuler</app-button>
            <app-button variant="primary" icon="pi-check" iconPos="left"
              [disabled]="!isDeliveryFormValid()" (click)="submitDelivery()" i18n="@@delivery-notes.pages.valider.la.livraison.f8f247be"> Valider la livraison </app-button>
          </div>
        </ng-template>
      </p-dialog>
    } @else {
      <div class="not-found">
        <i class="pi pi-exclamation-triangle"></i>
        <h2 i18n="@@delivery-notes.pages.bon.de.livraison.non.trouve.0be2aaed">Bon de livraison non trouvé</h2>
        <p i18n="@@delivery-notes.pages.le.bon.de.livraison.demande.n.existe.pas.ou.a.et.f1651ba0">Le bon de livraison demandé n'existe pas ou a été supprimé.</p>
        <app-button variant="primary" routerLink="/delivery-notes" i18n="@@delivery-notes.pages.retour.a.la.liste.7753f531">Retour à la liste</app-button>
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

    .delivery-note-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: var(--spacing-4);
    }

    .delivery-note-meta {
      h2 {
        margin: 0 0 var(--spacing-2);
        font-family: 'JetBrains Mono', monospace;
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--color-text-primary);
      }
    }

    .delivery-note-dates {
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
      .party-email,
      .party-recipient {
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

      tr.fully-delivered {
        background: var(--color-success-50);
      }

      .line-name {
        font-weight: var(--font-weight-medium);
      }

      .line-desc,
      .line-code {
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
      margin-top: var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle);
      padding-top: var(--spacing-4);
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--spacing-2);

      .total-row {
        display: flex;
        justify-content: space-between;
        width: 300px;
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);

        &.total-ttc {
          font-weight: var(--font-weight-bold);
          color: var(--color-text-primary);
          font-size: var(--font-size-lg);
          margin-top: var(--spacing-2);
          padding-top: var(--spacing-2);
          border-top: 2px solid var(--color-border-subtle);
        }
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
    }

    .status-actions {
      display: flex;
      gap: var(--spacing-2);
    }

    .quick-actions {
      display: flex;
      flex-direction: column;
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

      small {
        color: var(--color-neutral-500);
      }
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

    .delivery-dialog-content {
      padding: var(--spacing-4) var(--spacing-6);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .delivery-context-banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-2) var(--spacing-4);
      margin: 0;
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-background-subtle, #f8fafc);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-left: 4px solid var(--color-primary-500);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
    }

    .delivery-context-number {
      font-family: 'JetBrains Mono', monospace;
      font-weight: var(--font-weight-semibold);
    }

    .delivery-context-warehouse {
      color: var(--color-text-secondary);
    }

    .delivery-default-badge {
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

    .delivery-loading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0;
    }

    .delivery-stock-alert {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin: 0;
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

    .delivery-form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);
      align-items: start;
    }

    @media (max-width: 600px) {
      .delivery-form-grid {
        grid-template-columns: 1fr;
      }
    }

    .delivery-form-group {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;

      label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }
    }

    .delivery-form-group .required {
      color: var(--color-error-600);
    }

    .delivery-lines-title {
      margin: 0;
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .delivery-lines-table-wrap {
      overflow-x: auto;
    }

    .delivery-lines-form {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;

      th {
        padding: var(--spacing-3) var(--spacing-3);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-secondary);
        text-align: left;
        border-bottom: 2px solid var(--color-border-default);
        background: var(--color-background-subtle);
        font-weight: var(--font-weight-semibold);
      }

      th:nth-child(2),
      th:nth-child(3),
      th:nth-child(4),
      td:nth-child(2),
      td:nth-child(3),
      td:nth-child(4) {
        width: 7rem;
        white-space: nowrap;
      }

      th.motif-col,
      td.motif-col {
        width: 12rem;
      }

      td {
        padding: var(--spacing-3);
        font-size: var(--font-size-sm);
        border-bottom: 1px solid var(--color-border-subtle);
        vertical-align: middle;
      }

      .motif-empty {
        color: var(--color-text-tertiary);
      }

      .motif-input {
        width: 100%;
        font-size: var(--font-size-sm);
      }

      tr.delivery-alloc-row td {
        background: var(--color-background-subtle);
        padding: var(--spacing-2) var(--spacing-3) var(--spacing-2) var(--spacing-6);
        vertical-align: top;
      }
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
    }

    .input-sm {
      width: 80px;
      font-size: var(--font-size-sm);
    }

    .w-full {
      width: 100%;
    }

    :host ::ng-deep .delivery-dialog-content {
      .p-datepicker,
      .delivery-header-datepicker,
      .delivery-header-datepicker.p-datepicker {
        display: flex;
        width: 100%;
      }

      .delivery-header-input,
      .delivery-header-datepicker .p-datepicker-input,
      .delivery-header-datepicker input {
        height: 2.5rem;
        box-sizing: border-box;
      }
    }

    :host ::ng-deep .delivery-lines-form {
      .delivery-qty-input.p-inputnumber,
      .delivery-qty-input .p-inputnumber,
      p-inputnumber.delivery-qty-input {
        width: 5.5rem;
        max-width: 100%;
      }

      .p-inputnumber-input {
        width: 100%;
        text-align: right;
      }
    }

    :host ::ng-deep {
      .p-dialog {
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-xl);
        overflow: hidden;
      }

      .p-dialog-content {
        border-radius: 0;
        padding: 0;
        max-height: 70vh;
        overflow-y: auto;
      }

      .p-dialog-header {
        padding: var(--spacing-4) var(--spacing-6);
        border-bottom: 1px solid var(--color-border-subtle);
        background: var(--color-background-elevated);
      }

      .p-dialog-header .p-dialog-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .p-dialog-footer {
        padding: var(--spacing-4) var(--spacing-6);
        border-top: 1px solid var(--color-border-subtle);
        background: var(--color-background-subtle);
      }

      .delivery-note-card .p-card-body {
        padding: var(--card-padding);
      }

      .status-card,
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
    }

    .return-info {
      margin: 0;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      background: var(--color-warning-50, #fffbeb);
      color: var(--color-warning-800, #92400e);
    }

    .return-notes-list {
      margin: 0.5rem 0 0;
      padding-left: 1.25rem;
    }
  `]
})
export class DeliveryNoteDetailComponent implements OnInit {
  readonly loc_ui_tern_bon_de_livraison_du_b10ffc = $localize`:@@ui.tern.bon.de.livraison.du.b10ffc:Bon de livraison du `;
  private deliveryNoteService = inject(DeliveryNoteService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmationService = inject(ConfirmationService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private auth = inject(AuthService);
  private stockService = inject(StockService);
  private productService = inject(ProductService);
  private destroyRef = inject(DestroyRef);

  loading = signal(true);
  workflowActionInProgress = signal(false);
  deliveryNote = signal<DeliveryNoteDetailDto | null>(null);
  stockFeatures = signal<StockFeatures | null>(null);
  traceabilityByProduct = signal<Map<string, { trackingMode: number; pickingPolicy: number; hasExpiryTracking: boolean }>>(new Map());

  menuItems: MenuItem[] = [];

  deliveryEffectiveWarehouseId = signal<string | null>(null);
  deliveryWarehouseLabel = signal<string | null>(null);
  deliveryWarehouseIsDefault = signal(false);
  deliveryContextLoading = signal(false);
  deliveryContextError = signal<string | null>(null);
  deliveryStockCheck = signal<StockAvailabilityCheck | null>(null);
  deliveryStockBlocked = signal(false);
  deliveryProductMeta = signal<Map<string, { isStockManaged: boolean; costingMethod: number; trackingMode: number }>>(new Map());
  deliveryAvailabilityByProduct = signal<Map<string, ProductAvailabilityDetail>>(new Map());
  deliveryAllocAvailability = signal<Map<string, ExitLotAvailability>>(new Map());
  deliveryAllocLotStockValid = signal<Map<string, boolean>>(new Map());
  deliverySubmitError = signal<string | null>(null);
  private deliveryLoadSeq = 0;

  // Delivery dialog
  showDeliveryDialog = false;
  deliveryForm: { recipientName: string; deliveryDate: Date } = { recipientName: '', deliveryDate: new Date() };
  deliveryLinesForms: Array<{
    lineId: string;
    productId: string;
    designation: string;
    orderedQuantity: number;
    deliveredQuantity: number;
    rejectedQuantity: number;
    rejectionReason: string;
    trackingMode: number;
    pickingPolicy: number;
    hasExpiryTracking: boolean;
    lotAllocations: AllocationRow[];
  }> = [];

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const note = this.deliveryNote();
    return [
      { label: $localize`:@@delivery-notes.delivery-note-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
      { label: $localize`:@@delivery-notes.delivery-note-detail.ts.bons.de.livraison.a42b9518:Bons de Livraison`, route: '/delivery-notes' },
      { label: note?.number || $localize`:@@delivery-notes.delivery-note-detail.ts.bon.de.livraison.1a60dc44:Bon de livraison` }
    ];
  });

  /** Action workflow principale affichée dans l'en-tête selon l'état du BL. */
  readonly primaryAction = computed(() => {
    const note = this.deliveryNote();
    if (!note) return null;
    if (note.status === DeliveryNoteStatus.Draft) {
      return { label: $localize`:@@delivery-notes.delivery-note-detail.ts.valider.be4220f7:Valider`, icon: 'pi-check', variant: 'primary' as const, command: () => this.confirmDeliveryNote() };
    }
    if (note.status === DeliveryNoteStatus.Confirmed) {
      return { label: $localize`:@@delivery-notes.delivery-note-detail.ts.demarrer.livraison.c36c79cb:Démarrer livraison`, icon: 'pi-truck', variant: 'primary' as const, command: () => this.startDelivery() };
    }
    if (note.status === DeliveryNoteStatus.InTransit) {
      return { label: $localize`:@@delivery-notes.delivery-note-detail.ts.enregistrer.livraison.537b2e28:Enregistrer livraison`, icon: 'pi-check-circle', variant: 'primary' as const, command: () => this.openRecordDeliveryDialog() };
    }
    if (canGenerateInvoiceFromDeliveryNote(note)) {
      return { label: $localize`:@@delivery-notes.delivery-note-detail.ts.generer.facture.ef238ac2:Générer facture`, icon: 'pi-file', variant: 'primary' as const, command: () => this.generateInvoice() };
    }
    return null;
  });

  readonly canCreateReturnNote = computed(() => {
    const note = this.deliveryNote();
    return !!note
      && this.auth.hasPermission(PERMISSIONS.returnNotes.create)
      && canCreateReturnNoteFromDeliveryNote(note);
  });

  readonly isFullyReturned = computed(() => {
    const note = this.deliveryNote();
    return !!note
      && !note.invoiceId
      && (note.status === DeliveryNoteStatus.Delivered || note.status === DeliveryNoteStatus.PartiallyDelivered)
      && note.hasInvoiceableQuantity === false;
  });

  /** FODEC agrégé du bon (0 si aucune ligne n'y est assujettie). */
  totalFodec = computed<number>(() =>
    (this.deliveryNote()?.lines ?? []).reduce((sum, line) => sum + (line.fodecAmount ?? 0), 0));

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadDeliveryNote(id);
    } else {
      this.router.navigate(['/delivery-notes']);
    }
  }

  private loadDeliveryNote(id: string): void {
    this.loading.set(true);

    this.deliveryNoteService.getDeliveryNote(id).subscribe({
      next: (response) => {
        if (response.success) {
          this.deliveryNote.set(response.data);
          this.buildMenu(response.data);
        } else {
          this.deliveryNote.set(null);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.deliveryNote.set(null);
      }
    });
  }

  private buildMenu(note: DeliveryNoteDetailDto): void {
    // Actions secondaires uniquement — le workflow est dans primaryAction (header).
    this.menuItems = [];

    if (note.status === DeliveryNoteStatus.Draft || note.status === DeliveryNoteStatus.Confirmed) {
      this.menuItems.push({
        label: $localize`:@@delivery-notes.delivery-note-detail.ts.annuler.49ba3292:Annuler`,
        icon: 'pi pi-times',
        command: () => this.cancelDeliveryNote()
      });
    }

    if (note.invoiceId) {
      this.menuItems.push({
        label: note.invoiceNumber ? $localize`:@@ui.tern.voir.la.facture.ph.f92328:Voir la facture ${note.invoiceNumber}:p0:` : $localize`:@@ui.tern.voir.la.facture.e4bdde:Voir la facture`,
        icon: 'pi pi-file',
        routerLink: ['/invoices', note.invoiceId]
      });
    }

    if (
      this.auth.hasPermission(PERMISSIONS.returnNotes.create)
      && canCreateReturnNoteFromDeliveryNote(note)
    ) {
      this.menuItems.push({
        label: $localize`:@@delivery-notes.delivery-note-detail.ts.creer.un.bon.de.retour.a9261008:Créer un bon de retour`,
        icon: 'pi pi-replay',
        command: () => this.createReturnNote()
      });
    }
  }

  createReturnNote(): void {
    const note = this.deliveryNote();
    if (!note) return;
    this.router.navigate(['/return-notes/new'], { queryParams: { deliveryNoteId: note.id } });
  }

  confirmDeliveryNote(): void {
    const note = this.deliveryNote();
    if (!note || this.workflowActionInProgress() || note.status !== DeliveryNoteStatus.Draft) return;

    this.confirmationService.confirm({
      header: $localize`:@@delivery-notes.delivery-note-detail.ts.confirmer.le.bon.de.livraison.dba10848:Confirmer le bon de livraison`,
      message: $localize`:@@delivery-notes.delivery-note-detail.ts.etes.vous.sur.de.vouloir.confirmer.le.bo.5b854320:Êtes-vous sûr de vouloir confirmer le bon de livraison ${note.number}:number: ?`,
      acceptLabel: $localize`:@@delivery-note-detail.component.acceptLabel.Confirmer:Confirmer`,
      rejectLabel: $localize`:@@delivery-note-detail.component.rejectLabel.Annuler:Annuler`,
      icon: 'pi pi-check-circle',
      accept: () => {
        this.workflowActionInProgress.set(true);
        this.deliveryNoteService.confirmDeliveryNote(note.id).subscribe({
          next: (response) => {
            this.workflowActionInProgress.set(false);
            if (response.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@delivery-note-detail.component.summary.Succès:Succès`,
                detail: $localize`:@@delivery-note-detail.component.detail.bon.de.livraison.confirme.avec.succes.d52ec9b8:Bon de livraison confirmé avec succès`
              });
              this.loadDeliveryNote(note.id);
            } else {
              this.toastService.add({
                severity: 'error',
                summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
                detail: (response as any).message || $localize`:@@delivery-notes.delivery-note-detail.ts.impossible.de.confirmer.le.bon.de.livrai.da23e28d:Impossible de confirmer le bon de livraison`
              });
            }
          },
          error: (err) => {
            this.workflowActionInProgress.set(false);
            const message = this.errorHandler.extractErrorMessage(err);
            if (this.isAlreadyConfirmedError(err, message)) {
              this.toastService.add({
                severity: 'info',
                summary: $localize`:@@delivery-note-detail.component.summary.Information:Information`,
                detail: $localize`:@@delivery-note-detail.component.detail.Ce_bon_est_d_j_:Ce bon est déjà confirmé. Utilisez « Démarrer livraison » pour continuer.`
              });
              this.loadDeliveryNote(note.id);
              return;
            }
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
              detail: message
            });
          }
        });
      }
    });
  }

  startDelivery(): void {
    const note = this.deliveryNote();
    if (!note || this.workflowActionInProgress() || note.status !== DeliveryNoteStatus.Confirmed) return;

    this.confirmationService.confirm({
      header: $localize`:@@delivery-notes.delivery-note-detail.ts.demarrer.la.livraison.03cb1e3f:Démarrer la livraison`,
      message: $localize`:@@delivery-notes.delivery-note-detail.ts.etes.vous.sur.de.vouloir.demarrer.la.liv.31f3da9e:Êtes-vous sûr de vouloir démarrer la livraison du bon ${note.number}:number: ?`,
      acceptLabel: $localize`:@@delivery-note-detail.component.acceptLabel.Démarrer:Démarrer`,
      rejectLabel: $localize`:@@delivery-note-detail.component.rejectLabel.Annuler:Annuler`,
      icon: 'pi pi-truck',
      accept: () => {
        this.workflowActionInProgress.set(true);
        this.deliveryNoteService.startDelivery(note.id).subscribe({
          next: (response) => {
            this.workflowActionInProgress.set(false);
            if (response.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@delivery-note-detail.component.summary.Succès:Succès`,
                detail: $localize`:@@delivery-note-detail.component.detail.Livraison_d_marr:Livraison démarrée avec succès`
              });
              this.loadDeliveryNote(note.id);
            } else {
              this.toastService.add({
                severity: 'error',
                summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
                detail: (response as any).message || $localize`:@@delivery-notes.delivery-note-detail.ts.impossible.de.demarrer.la.livraison.4bd0d101:Impossible de démarrer la livraison`
              });
            }
          },
          error: (err) => {
            this.workflowActionInProgress.set(false);
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
              detail: this.errorHandler.extractErrorMessage(err)
            });
          }
        });
      }
    });
  }

  openRecordDeliveryDialog(): void {
    const note = this.deliveryNote();
    if (!note) return;

    this.deliveryForm = { recipientName: '', deliveryDate: new Date() };

    this.deliveryLinesForms = note.lines.map(line => ({
      lineId: line.id,
      productId: line.productId,
      designation: line.designation,
      orderedQuantity: line.orderedQuantity,
      deliveredQuantity: line.orderedQuantity,
      rejectedQuantity: 0,
      rejectionReason: '',
      trackingMode: 0,
      pickingPolicy: 0,
      hasExpiryTracking: false,
      lotAllocations: [createDefaultLotRow(line.orderedQuantity)]
    }));

    this.resetDeliveryStockState();
    this.loadDeliveryStockContext(note);
    this.showDeliveryDialog = true;
  }

  showLineTraceability(line: {
    trackingMode: number;
    deliveredQuantity: number;
  }): boolean {
    const f = this.stockFeatures();
    if (!f || !this.deliveryEffectiveWarehouseId()) return false;
    return line.deliveredQuantity > 0
      && (showLotSection(line.trackingMode, f) || showSerialSection(line.trackingMode, f));
  }

  onDeliveredQuantityChange(line: {
    deliveredQuantity: number;
    trackingMode: number;
    lotAllocations: AllocationRow[];
  }): void {
    if (line.trackingMode === TRACKING_MODE_SERIAL) {
      const count = Math.max(1, Math.round(line.deliveredQuantity));
      if (line.lotAllocations.length !== count) {
        line.lotAllocations = Array.from({ length: count }, () => createDefaultSerialRow());
      }
    } else {
      const row = line.lotAllocations[0] ?? createDefaultLotRow(0);
      row.quantity = line.deliveredQuantity;
      line.lotAllocations = [row];
    }
    this.recomputeDeliveryStockBlock();
  }

  private resetDeliveryStockState(): void {
    this.deliveryLoadSeq++;
    this.deliveryEffectiveWarehouseId.set(null);
    this.deliveryWarehouseLabel.set(null);
    this.deliveryWarehouseIsDefault.set(false);
    this.deliveryContextLoading.set(true);
    this.deliveryContextError.set(null);
    this.deliveryStockCheck.set(null);
    this.deliveryStockBlocked.set(false);
    this.deliveryProductMeta.set(new Map());
    this.deliveryAvailabilityByProduct.set(new Map());
    this.deliveryAllocAvailability.set(new Map());
    this.deliveryAllocLotStockValid.set(new Map());
    this.deliverySubmitError.set(null);
  }

  private loadDeliveryStockContext(note: DeliveryNoteDetailDto): void {
    const loadSeq = ++this.deliveryLoadSeq;
    this.deliveryContextLoading.set(true);

    this.stockService.getWarehouses()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of({ success: false, data: [] as { id: string; name: string; isDefault: boolean }[] })),
        switchMap(res => {
          if (loadSeq !== this.deliveryLoadSeq) return EMPTY;
          const warehouses = (res.success ? res.data : null) ?? [];
          const { warehouse, isDefaultFallback } = resolveEffectiveWarehouse(
            warehouses,
            note.warehouseId
          );
          this.deliveryEffectiveWarehouseId.set(warehouse?.id ?? null);
          this.deliveryWarehouseLabel.set(warehouse?.name ?? null);
          this.deliveryWarehouseIsDefault.set(isDefaultFallback);

          if (!warehouse) {
            this.deliveryContextError.set(
              $localize`:@@delivery-notes.delivery-note-detail.ts.aucun.entrepot.n.est.configure.impossibl.e521608b:Aucun entrepôt n'est configuré. Impossible de vérifier le stock.`
            );
            this.deliveryContextLoading.set(false);
            return EMPTY;
          }

          const productIds = [...new Set(note.lines.map(l => l.productId).filter(Boolean))];
          const items = this.deliveryLinesForms
            .filter(l => l.productId && l.deliveredQuantity > 0)
            .map(l => ({ productId: l.productId, requestedQuantity: l.deliveredQuantity }));

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
          if (loadSeq !== this.deliveryLoadSeq) return;
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

          for (const lineForm of this.deliveryLinesForms) {
            const t = traceMap.get(lineForm.productId);
            if (t) {
              lineForm.trackingMode = t.trackingMode;
              lineForm.pickingPolicy = t.pickingPolicy;
              lineForm.hasExpiryTracking = t.hasExpiryTracking;
              if (t.trackingMode === TRACKING_MODE_SERIAL) {
                lineForm.lotAllocations = Array.from(
                  { length: Math.max(1, Math.round(lineForm.deliveredQuantity)) },
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
          this.deliveryProductMeta.set(productMeta);

          const availMap = new Map<string, ProductAvailabilityDetail>();
          for (const detail of ctx.availability?.details ?? []) {
            availMap.set(detail.productId, detail);
          }
          this.deliveryAvailabilityByProduct.set(availMap);
          this.deliveryStockCheck.set(ctx.availability);

          this.recomputeDeliveryStockBlock();
          this.deliveryContextLoading.set(false);
        },
        error: () => {
          if (loadSeq !== this.deliveryLoadSeq) return;
          this.deliveryContextError.set($localize`:@@delivery-notes.delivery-note-detail.ts.impossible.de.verifier.le.stock.ae1fcaab:Impossible de vérifier le stock.`);
          this.deliveryContextLoading.set(false);
        }
      });
  }

  private recomputeDeliveryStockBlock(): void {
    const features = this.stockFeatures();
    const productMeta = this.deliveryProductMeta();
    const availability = this.deliveryAvailabilityByProduct();
    const lines = this.deliveryLinesForms
      .filter(lf => lf.deliveredQuantity > 0)
      .map(lf => {
        const meta = productMeta.get(lf.productId);
        const avail = availability.get(lf.productId);
        const isAvailable = avail
          ? avail.availableQuantity >= lf.deliveredQuantity
          : null;
        return {
          isStockManaged: meta?.isStockManaged ?? avail?.isStockManaged ?? lf.trackingMode > 0,
          trackingMode: lf.trackingMode || meta?.trackingMode || 0,
          costingMethod: meta?.costingMethod ?? 0,
          isAvailable
        };
      });
    this.deliveryStockBlocked.set(shouldBlockDocumentStockExit(lines, features));
  }

  onDeliveryAllocAvailability(event: ExitLotAvailability): void {
    const next = new Map(this.deliveryAllocAvailability());
    next.set(`${event.kind}:${event.productId}`, event);
    this.deliveryAllocAvailability.set(next);
  }

  onDeliveryLotStockValid(event: LotStockValidity): void {
    const next = new Map(this.deliveryAllocLotStockValid());
    next.set(`lot:${event.productId}`, event.valid);
    this.deliveryAllocLotStockValid.set(next);
  }

  hasMissingWarehouseLots(): boolean {
    const features = this.stockFeatures();
    for (const line of this.deliveryLinesForms) {
      if (!this.showLineTraceability(line)) continue;
      const avail = this.deliveryAvailabilityByProduct().get(line.productId);
      const stock = avail?.isStockManaged ? avail.availableQuantity : null;
      if (lineMissingWarehouseLots({
        trackingMode: line.trackingMode,
        features,
        quantity: line.deliveredQuantity,
        availableStock: stock,
        availability: this.deliveryAllocAvailability().get(`lot:${line.productId}`)
      })) {
        return true;
      }
      if (lineMissingWarehouseSerials({
        trackingMode: line.trackingMode,
        features,
        quantity: line.deliveredQuantity,
        availableStock: stock,
        availability: this.deliveryAllocAvailability().get(`serial:${line.productId}`)
      })) {
        return true;
      }
    }
    return false;
  }

  hasOnlyExpiredWarehouseLots(): boolean {
    const features = this.stockFeatures();
    for (const line of this.deliveryLinesForms) {
      if (!this.showLineTraceability(line)) continue;
      const avail = this.deliveryAvailabilityByProduct().get(line.productId);
      const stock = avail?.isStockManaged ? avail.availableQuantity : null;
      if (lineBlockedByExpiredLots({
        trackingMode: line.trackingMode,
        features,
        quantity: line.deliveredQuantity,
        availableStock: stock,
        availability: this.deliveryAllocAvailability().get(`lot:${line.productId}`)
      })) {
        return true;
      }
    }
    return false;
  }

  private allocAvailabilityFor(line: { productId: string; trackingMode: number }): ExitLotAvailability | undefined {
    const features = this.stockFeatures();
    if (showSerialSection(line.trackingMode, features)) {
      return this.deliveryAllocAvailability().get(`serial:${line.productId}`);
    }
    return this.deliveryAllocAvailability().get(`lot:${line.productId}`);
  }

  isDeliveryFormValid(): boolean {
    if (!this.deliveryForm.recipientName.trim() || !this.deliveryForm.deliveryDate) return false;
    if (this.deliveryContextLoading() || this.deliveryContextError()) return false;
    if (this.deliveryStockBlocked()) return false;
    if (this.hasMissingWarehouseLots()) return false;
    const features = this.stockFeatures();
    for (const line of this.deliveryLinesForms) {
      if (line.deliveredQuantity + line.rejectedQuantity > line.orderedQuantity) {
        return false;
      }
      if (line.rejectedQuantity > 0 && !line.rejectionReason.trim()) {
        return false;
      }
      if (this.showLineTraceability(line)) {
        if (!exitTraceabilityReady(
          line.trackingMode,
          features,
          line.deliveredQuantity,
          this.allocAvailabilityFor(line)
        )) {
          return false;
        }
        if (!exitAllocationsValid(
          line.trackingMode,
          line.pickingPolicy,
          line.deliveredQuantity,
          line.lotAllocations,
          features
        )) {
          return false;
        }
        if (this.deliveryAllocLotStockValid().get(`lot:${line.productId}`) === false) {
          return false;
        }
      }
    }
    return true;
  }

  submitDelivery(): void {
    const note = this.deliveryNote();
    if (!note || !this.isDeliveryFormValid()) return;

    this.deliverySubmitError.set(null);

    const lines: RecordDeliveryLineDto[] = this.deliveryLinesForms.map(lf => ({
      lineId: lf.lineId,
      deliveredQuantity: lf.deliveredQuantity,
      rejectedQuantity: lf.rejectedQuantity,
      rejectionReason: lf.rejectedQuantity > 0 ? lf.rejectionReason : undefined
    }));

    const lineAllocations = this.deliveryLinesForms
      .filter(lf => this.showLineTraceability(lf))
      .map(lf => ({
        lineId: lf.lineId,
        allocations: buildExitAllocationPayload(lf.lotAllocations)
      }))
      .filter(la => la.allocations.length > 0);

    const dto: RecordDeliveryDto = {
      deliveryDate: this.formatDate(this.deliveryForm.deliveryDate),
      recipientName: this.deliveryForm.recipientName.trim(),
      lines,
      lineAllocations: lineAllocations.length > 0 ? lineAllocations : undefined
    };

    this.deliveryNoteService.recordDelivery(note.id, dto).subscribe({
      next: (response) => {
        if (response.success) {
          this.showDeliveryDialog = false;
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@delivery-note-detail.component.summary.Succès:Succès`,
            detail: $localize`:@@delivery-note-detail.component.detail.Livraison_enregi:Livraison enregistrée avec succès`
          });
          this.loadDeliveryNote(note.id);
        } else {
          const message = (response as any).message || $localize`:@@delivery-notes.delivery-note-detail.ts.impossible.d.enregistrer.la.livraison.d625e48a:Impossible d'enregistrer la livraison`;
          this.deliverySubmitError.set(message);
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
            detail: message
          });
        }
      },
      error: (err) => {
        const message = this.errorHandler.extractErrorMessage(err);
        this.deliverySubmitError.set(message);
      }
    });
  }

  cancelDeliveryNote(): void {
    const note = this.deliveryNote();
    if (
      !note
      || this.workflowActionInProgress()
      || (note.status !== DeliveryNoteStatus.Draft && note.status !== DeliveryNoteStatus.Confirmed)
    ) return;

    this.confirmationService.confirm({
      header: $localize`:@@delivery-notes.delivery-note-detail.ts.annuler.le.bon.de.livraison.f42c4ca4:Annuler le bon de livraison`,
      message: $localize`:@@delivery-notes.delivery-note-detail.ts.etes.vous.sur.de.vouloir.annuler.le.bon.10898243:Êtes-vous sûr de vouloir annuler le bon de livraison ${note.number}:number: ?`,
      acceptLabel: $localize`:@@delivery-note-detail.component.acceptLabel.Annuler_le_bon:Annuler le bon`,
      rejectLabel: $localize`:@@delivery-note-detail.component.rejectLabel.Retour:Retour`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.workflowActionInProgress.set(true);
        this.deliveryNoteService.cancelDeliveryNote(note.id, { reason: 'Annulation manuelle' }).subscribe({
          next: (response) => {
            this.workflowActionInProgress.set(false);
            if (response.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@delivery-note-detail.component.summary.Succès:Succès`,
                detail: $localize`:@@delivery-note-detail.component.detail.bon.de.livraison.annule.94728b09:Bon de livraison annulé`
              });
              this.loadDeliveryNote(note.id);
            } else {
              this.toastService.add({
                severity: 'error',
                summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
                detail: (response as any).message || $localize`:@@delivery-notes.delivery-note-detail.ts.impossible.d.annuler.le.bon.de.livraison.a0913741:Impossible d'annuler le bon de livraison`
              });
            }
          },
          error: (err) => {
            this.workflowActionInProgress.set(false);
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
              detail: this.errorHandler.extractErrorMessage(err)
            });
          }
        });
      }
    });
  }

  generateInvoice(): void {
    const note = this.deliveryNote();
    if (!note || this.workflowActionInProgress()) return;
    if (!canGenerateInvoiceFromDeliveryNote(note)) {
      this.toastService.add({
        severity: 'warn',
        summary: $localize`:@@delivery-note-detail.component.summary.Facturation_impo:Facturation impossible`,
        detail: $localize`:@@delivery-note-detail.component.detail.Toutes_les_quant:Toutes les quantités livrées ont été retournées — impossible de facturer.`
      });
      return;
    }

    this.confirmationService.confirm({
      header: $localize`:@@delivery-notes.delivery-note-detail.ts.generer.facture.ef238ac2:Générer facture`,
      message: $localize`:@@delivery-notes.delivery-note-detail.ts.voulez.vous.generer.une.facture.pour.le.2e3983d9:Voulez-vous générer une facture pour le bon de livraison ${note.number}:number: ?`,
      acceptLabel: $localize`:@@delivery-note-detail.component.acceptLabel.G_n_rer:Générer`,
      rejectLabel: $localize`:@@delivery-note-detail.component.rejectLabel.Annuler:Annuler`,
      icon: 'pi pi-file',
      accept: () => {
        this.workflowActionInProgress.set(true);
        this.deliveryNoteService.generateInvoice(note.id).subscribe({
          next: (response) => {
            this.workflowActionInProgress.set(false);
            if (response.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@delivery-note-detail.component.summary.Succès:Succès`,
                detail: $localize`:@@delivery-note-detail.component.detail.Facture_g_n_r_e_:Facture générée avec succès`
              });
              this.loadDeliveryNote(note.id);
              if (response.data) {
                this.router.navigate(['/invoices', response.data]);
              }
            } else {
              this.toastService.add({
                severity: 'error',
                summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
                detail: (response as any).message || $localize`:@@delivery-notes.delivery-note-detail.ts.impossible.de.generer.la.facture.56d8d59c:Impossible de générer la facture`
              });
            }
          },
          error: (err) => {
            this.workflowActionInProgress.set(false);
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@delivery-note-detail.component.summary.Erreur:Erreur`,
              detail: this.errorHandler.extractErrorMessage(err)
            });
          }
        });
      }
    });
  }

  /** Refus de confirmation lié au statut : code d'abord (message traduisible), texte en repli sans code. */
  private isAlreadyConfirmedError(err: unknown, message: string): boolean {
    const code = this.errorHandler.getApiErrorCode(err);
    if (code) {
      return code === API_ERROR_CODE.statusNotAllowed;
    }
    const normalized = message.toLowerCase();
    return normalized.includes('déjà confirmé') || normalized.includes('ne peut pas être confirmé');
  }

  private formatDate(d: Date): string {
    return formatLocalDate(d);
  }

  getStatusBadgeStatus(status: DeliveryNoteStatus): StatusBadgeStatus {
    const statusMap: Record<DeliveryNoteStatus, StatusBadgeStatus> = {
      [DeliveryNoteStatus.Draft]: 'draft',
      [DeliveryNoteStatus.Confirmed]: 'validated',
      [DeliveryNoteStatus.InTransit]: 'sent',
      [DeliveryNoteStatus.Delivered]: 'accepted',
      [DeliveryNoteStatus.PartiallyDelivered]: 'pending',
      [DeliveryNoteStatus.Failed]: 'rejected',
      [DeliveryNoteStatus.Refused]: 'rejected',
      [DeliveryNoteStatus.Cancelled]: 'cancelled',
      [DeliveryNoteStatus.Invoiced]: 'converted'
    };
    return statusMap[status] || 'draft';
  }
}
