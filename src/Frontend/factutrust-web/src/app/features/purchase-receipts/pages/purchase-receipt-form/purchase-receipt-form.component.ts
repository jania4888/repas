/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { AutoCompleteModule, AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { TagModule } from 'primeng/tag';
import { FileUploadModule } from 'primeng/fileupload';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { WarehouseSelectorComponent } from '@shared/components/warehouse-selector/warehouse-selector.component';
import { StockAllocationEditorComponent } from '@shared/components/stock-allocation-editor/stock-allocation-editor.component';
import {
  AllocationRow,
  buildAllocationPayload,
  showLotSection,
  showSerialSection,
  createDefaultLotRow,
  createDefaultSerialRow,
  coercePickingPolicy,
  coerceTrackingMode,
  entryAllocationsValid,
  TRACKING_MODE_SERIAL
} from '@shared/utils/stock-traceability.utils';
import { StockFeatures } from '@core/services/stock.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { environment } from '@environments/environment';
import { formatLocalDate } from '@core/utils/date.util';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import {
  PurchaseReceiptService,
  PurchaseReceiptLineAllocations,
  PurchaseReceiptStatus,
  PurchaseReceiptAttachment,
  CreatePurchaseReceiptRequest,
  UpdatePurchaseReceiptRequest,
  CreatePurchaseReceiptLineRequest,
  mapPurchaseReceiptDetailFromApi
} from '@core/services/purchase-receipt.service';
import {
  PurchaseOrderService,
  PurchaseOrderListItem,
  PurchaseOrderStatus
} from '@core/services/purchase-order.service';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { StockService } from '@core/services/stock.service';
import {
  ProductAutocompleteService,
  ProductSuggestion,
  suggestionToListItem
} from '@shared/services/product-autocomplete.service';
import {
  Subject,
  switchMap,
  of,
  Observable,
  debounceTime,
  distinctUntilChanged,
  tap,
  catchError,
  takeUntil,
  map
} from 'rxjs';

interface ReceiptLineRow {
  id: string | null;
  product: ProductListItem | null;
  productId: string | null;
  productCode: string;
  productName: string;
  designation: string;
  unit: string;
  orderedQuantity: number;
  receivedQuantity: number;
  alreadyReceivedQuantity: number;
  unitPriceHT: number;
  discountPercent: number | null;
  vatRate: number;
  purchaseOrderLineId: string | null;
  lotAllocations: AllocationRow[];
  trackingMode?: number;
  pickingPolicy?: number;
}

@Component({
  selector: 'app-purchase-receipt-form',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule, RouterModule, FormsModule, CurrencyPipe,
    SelectModule, InputTextModule, InputNumberModule, DatePickerModule,
    Textarea, AutoCompleteModule, TagModule, FileUploadModule,
    DialogModule, ToastModule,
    PageHeaderComponent, BreadcrumbComponent, FormSectionComponent,
    WarehouseSelectorComponent, ButtonComponent,
    StockAllocationEditorComponent, BarcodeScanFieldComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      [title]="isEdit() ? 'Modifier le bon de réception' : 'Nouveau bon de réception'"
      [subtitle]="isEdit() ? (receiptNumber() || '') : 'Enregistrez une réception de marchandises fournisseur.'">
      @if (statusDisplay()) {
        <p-tag [value]="statusDisplay()! | backendLabel" [severity]="statusSeverity()"></p-tag>
      }
    </app-page-header>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p i18n="@@purchase-receipts.pages.chargement.a209b664">Chargement...</p>
      </div>
    } @else {
      <div class="form-layout">
        <div class="form-main">
          <app-form-section title="Informations générales" i18n-title="@@purchase-receipts.pages.informations.generales.be6ba6e5" icon="pi-building" [number]="1">
            <div class="form-grid-3">
              <div class="form-group">
                <label for="supplier" i18n="@@purchase-receipts.pages.fournisseur.bc374fa5">Fournisseur <span class="required">*</span></label>
                <p-select
                  id="supplier"
                  [options]="suppliers()"
                  [(ngModel)]="selectedSupplierId"
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Sélectionnez un fournisseur" i18n-placeholder="@@purchase-receipts.pages.selectionnez.un.fournisseur.7351a0fb"
                  [filter]="true"
                  filterBy="name"
                  [showClear]="true"
                  [disabled]="isEdit() || !!lockedPurchaseOrderId"
                  (onChange)="onSupplierChange()"
                  styleClass="w-full">
                </p-select>
              </div>

              <div class="form-group">
                <label for="purchaseOrder" i18n="@@purchase-receipts.pages.bon.de.commande.4b9aea29">Bon de commande</label>
                <p-select
                  id="purchaseOrder"
                  [options]="purchaseOrderOptions()"
                  [(ngModel)]="selectedPurchaseOrderId"
                  optionLabel="label"
                  optionValue="id"
                  placeholder="Sélectionnez un BC (optionnel)" i18n-placeholder="@@purchase-receipts.pages.selectionnez.un.bc.optionnel.418875b7"
                  [filter]="true"
                  filterBy="label"
                  [showClear]="true"
                  [disabled]="isEdit() || !!lockedPurchaseOrderId"
                  (onChange)="onPurchaseOrderChange()"
                  styleClass="w-full">
                </p-select>
              </div>

              <div class="form-group">
                <app-warehouse-selector
                  inputId="receipt-warehouse"
                  label="Entrepôt" i18n-label="@@purchase-receipts.pages.entrepot.64a6a11c"
                  [required]="true"
                  [value]="selectedWarehouseId"
                  (valueChange)="onWarehouseSelected($event)">
                </app-warehouse-selector>
              </div>

              <div class="form-group">
                <label for="receiptNumber" i18n="@@purchase-receipts.pages.n.bon.de.reception.ad3cf1bd">N° bon de réception</label>
                <input
                  pInputText
                  id="receiptNumber"
                  [value]="receiptNumber() || 'Attribué à l’enregistrement'"
                  disabled
                  class="w-full">
              </div>

              <div class="form-group">
                <label for="receiptDate" i18n="@@purchase-receipts.pages.date.de.reception.9a9c1f22">Date de réception <span class="required">*</span></label>
                <p-datepicker
                  id="receiptDate"
                  [(ngModel)]="receiptDate"
                  dateFormat="dd/mm/yy"
                  [showIcon]="true"
                  styleClass="w-full">
                </p-datepicker>
              </div>

              <div class="form-group">
                <label for="supplierRef" i18n="@@purchase-receipts.pages.ref.fournisseur.98507c4b">Réf. fournisseur</label>
                <input
                  pInputText
                  id="supplierRef"
                  [(ngModel)]="supplierReference"
                  placeholder="N° BL fournisseur…" i18n-placeholder="@@purchase-receipts.pages.n.bl.fournisseur.56f543c6"
                  class="w-full">
              </div>
            </div>
          </app-form-section>

          <app-form-section title="Articles" i18n-title="@@purchase-receipts.pages.articles.7c422841" icon="pi-list" [number]="2">
            <div class="lines-actions">
              <app-button variant="secondary" icon="pi-plus" iconPos="left" size="sm"
                (clicked)="addLine()" i18n="@@purchase-receipts.pages.ajouter.une.ligne.ba241fd4"> Ajouter une ligne </app-button>
            @if (barcodeScanEnabled) {
              <app-button variant="outline" icon="pi-barcode" iconPos="left" size="sm"
                (clicked)="focusBarcodeField()" i18n="@@purchase-receipts.pages.scanner.un.code.barres.6f3f91b0"> Scanner un code-barres </app-button>
            }
              <app-button variant="outline" icon="pi-file-import" iconPos="left" size="sm"
                (clicked)="openImportBlDialog()" i18n="@@purchase-receipts.pages.importer.depuis.bl.8f5d1823"> Importer depuis BL </app-button>
              <app-button class="lines-actions__danger" variant="ghost" icon="pi-trash" iconPos="left" size="sm"
                [disabled]="lines.length === 0"
                (clicked)="clearAllLines()" i18n="@@purchase-receipts.pages.supprimer.toutes.les.lignes.0ec45964"> Supprimer toutes les lignes </app-button>
            </div>

            @if (barcodeScanEnabled) {
              <div class="barcode-scan-row">
                <ft-barcode-scan-field
                  #barcodeField
                  placeholder="Scanner un code-barres pour ajouter une ligne" i18n-placeholder="@@purchase-receipts.pages.scanner.un.code.barres.pour.ajouter.une.ligne.3525ced5"
                  [autoFocus]="false"
                  [disabled]="barcodeLookingUp()"
                  (scanned)="onBarcodeScanned($event)"></ft-barcode-scan-field>
              </div>
            }

            <div class="lines-table-wrap">
              <table class="lines-table">
                <colgroup>
                  <col class="col-idx" />
                  <col class="col-article" />
                  <col class="col-designation" />
                  <col class="col-unit" />
                  <col class="col-qty-ord" />
                  <col class="col-qty-rec" />
                  <col class="col-qty-pend" />
                  <col class="col-price" />
                  <col class="col-disc" />
                  <col class="col-total" />
                  <col class="col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th class="col-idx" i18n="@@purchase-receipts.pages.text.d08f88df">#</th>
                    <th class="col-article" i18n="@@purchase-receipts.pages.article.4360c2dc">Article</th>
                    <th class="col-designation" i18n="@@purchase-receipts.pages.designation.63a9062c">Désignation</th>
                    <th class="col-unit" i18n="@@purchase-receipts.pages.unite.388fd9c4">Unité</th>
                    <th class="col-qty-ord" title="Quantité commandée" i18n-title="@@purchase-receipts.pages.quantite.commandee.0ebfdfe6" i18n="@@purchase-receipts.pages.qte.cmd.b39159f2">Qté cmd.</th>
                    <th class="col-qty-rec" title="Quantité reçue" i18n-title="@@purchase-receipts.pages.quantite.recue.ed1e82c6" i18n="@@purchase-receipts.pages.qte.recue.ec07cbe1">Qté reçue</th>
                    <th class="col-qty-pend" title="Quantité en attente" i18n-title="@@purchase-receipts.pages.quantite.en.attente.487f9a68" i18n="@@purchase-receipts.pages.qte.attente.6142616c">Qté attente</th>
                    <th class="col-price" title="Prix unitaire HT" i18n-title="@@purchase-receipts.pages.prix.unitaire.ht.bb3f8e39" i18n="@@purchase-receipts.pages.p.u.ht.63f60414">P.U. HT</th>
                    <th class="col-disc" i18n="@@purchase-receipts.pages.remise.a39386b5">Remise %</th>
                    <th class="col-total" i18n="@@purchase-receipts.pages.total.ht.2ca17ae6">Total HT</th>
                    <th class="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of lines; track $index; let i = $index) {
                    <tr>
                      <td class="col-idx text-center">{{ i + 1 }}</td>
                      <td class="col-article">
                        <p-autoComplete
                          [(ngModel)]="line.product"
                          [suggestions]="productSuggestions()"
                          (completeMethod)="searchProducts($event)"
                          (onSelect)="onProductSelect(line, $event)"
                          field="name"
                          [dropdown]="true"
                          [forceSelection]="true"
                          [minLength]="0"
                          appendTo="body"
                          panelStyleClass="receipt-product-panel"
                          [panelStyle]="{ minWidth: '280px' }"
                          [ngModelOptions]="{ standalone: true }"
                          [disabled]="!!line.purchaseOrderLineId"
                          placeholder="Rechercher…" i18n-placeholder="@@purchase-receipts.pages.rechercher.1d12cdfb"
                          styleClass="w-full"
                          inputStyleClass="w-full">
                          <ng-template let-product pTemplate="item">
                            <div class="product-item" i18n="@@purchase-receipts.pages.dt.cbd698ad">
                              <span class="product-item__code">{{ product.code }}</span>
                              <span class="product-item__name">{{ product.name }}</span>
                              <span class="product-item__price">
                                {{ (product.purchasePrice ?? product.unitPrice ?? 0) | number:'1.3-3' }} DT
                              </span>
                            </div>
                          </ng-template>
                          <ng-template pTemplate="empty">
                            <div class="product-empty">
                              @if (isLoadingProducts()) {
                                <i class="pi pi-spin pi-spinner"></i>
                                <span i18n="@@purchase-receipts.pages.chargement.des.produits.912b5e70">Chargement des produits…</span>
                              } @else {
                                <span i18n="@@purchase-receipts.pages.aucun.produit.trouve.5edf7149">Aucun produit trouvé</span>
                              }
                            </div>
                          </ng-template>
                        </p-autoComplete>
                      </td>
                      <td class="col-designation">
                        <input pInputText [value]="line.designation" disabled class="w-full bg-muted" />
                      </td>
                      <td class="col-unit">
                        <input pInputText [value]="line.unit" disabled class="w-full bg-muted text-center" />
                      </td>
                      <td class="col-qty-ord">{{ line.orderedQuantity | number:'1.0-3' }}</td>
                      <td class="col-qty-rec">
                        <p-inputNumber
                          [(ngModel)]="line.receivedQuantity"
                          [ngModelOptions]="{ standalone: true }"
                          [min]="0"
                          [minFractionDigits]="0"
                          [maxFractionDigits]="3"
                          mode="decimal"
                          (onInput)="onReceivedQuantityChange(line)"
                          styleClass="w-full"
                          inputStyleClass="text-center">
                        </p-inputNumber>
                      </td>
                      <td class="col-qty-pend">
                        <span [class.pending-qty]="pendingQty(line) > 0">
                          {{ pendingQty(line) | number:'1.0-3' }}
                        </span>
                      </td>
                      <td class="col-price">
                        <p-inputNumber
                          [(ngModel)]="line.unitPriceHT"
                          [ngModelOptions]="{ standalone: true }"
                          [min]="0"
                          [minFractionDigits]="3"
                          [maxFractionDigits]="3"
                          mode="decimal"
                          (onInput)="recalculateTotals()"
                          styleClass="w-full"
                          inputStyleClass="text-right">
                        </p-inputNumber>
                      </td>
                      <td class="col-disc">
                        <p-inputNumber
                          [(ngModel)]="line.discountPercent"
                          [ngModelOptions]="{ standalone: true }"
                          [min]="0"
                          [max]="100"
                          [minFractionDigits]="0"
                          [maxFractionDigits]="2"
                          mode="decimal"
                          placeholder="0" i18n-placeholder="@@purchase-receipts.pages.0.b6589fc6"
                          (onInput)="recalculateTotals()"
                          styleClass="w-full"
                          inputStyleClass="text-center">
                        </p-inputNumber>
                      </td>
                      <td class="col-total font-bold">
                        {{ lineTotalHT(line) | number:'1.3-3' }}
                      </td>
                      <td class="col-actions">
                        <app-button
                          variant="ghost"
                          size="sm"
                          icon="pi-trash"
                          [iconOnly]="true"
                          (clicked)="removeLine(i)"
                          ariaLabel="Supprimer la ligne" i18n-ariaLabel="@@purchase-receipts.pages.supprimer.la.ligne.7e5f9ae0">
                        </app-button>
                      </td>
                    </tr>
                    @if (showLineTraceability(line)) {
                    <tr>
                      <td [attr.colspan]="11">
                        <app-stock-allocation-editor
                          mode="entry"
                          [productId]="line.productId!"
                          [warehouseId]="selectedWarehouseId!"
                          [lineQuantity]="line.receivedQuantity"
                          [trackingMode]="line.trackingMode ?? 0"
                          [pickingPolicy]="line.pickingPolicy ?? 0"
                          [features]="stockFeatures()"
                          [allocations]="line.lotAllocations">
                        </app-stock-allocation-editor>
                      </td>
                    </tr>
                    }
                  } @empty {
                    <tr>
                      <td colspan="11" class="empty-lines" i18n="@@purchase-receipts.pages.aucune.ligne.ajoutez.des.articles.ou.selectionne.51f5a9bd"> Aucune ligne. Ajoutez des articles ou sélectionnez un bon de commande. </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-form-section>

          <app-form-section title="Informations complémentaires" i18n-title="@@purchase-receipts.pages.informations.complementaires.805470ce" icon="pi-file-edit" [number]="3">
            <div class="form-grid-2">
              <div class="form-group">
                <label for="transporter" i18n="@@purchase-receipts.pages.transporteur.7adadb36">Transporteur</label>
                <input pInputText id="transporter" [(ngModel)]="transporterName" class="w-full" />
              </div>
              <div class="form-group">
                <label for="dnNumber" i18n="@@purchase-receipts.pages.n.bon.de.livraison.626cc0e6">N° bon de livraison</label>
                <input pInputText id="dnNumber" [(ngModel)]="deliveryNoteNumber" class="w-full" />
              </div>
              <div class="form-group span-full">
                <label for="notes" i18n="@@purchase-receipts.pages.notes.70440046">Notes</label>
                <textarea
                  pTextarea
                  id="notes"
                  [(ngModel)]="notes"
                  [rows]="3"
                  class="w-full"
                  placeholder="Notes internes…" i18n-placeholder="@@purchase-receipts.pages.notes.internes.09e2ee05">
                </textarea>
              </div>
            </div>
          </app-form-section>

          <app-form-section title="Pièces jointes" i18n-title="@@purchase-receipts.pages.pieces.jointes.98d89a25" icon="pi-paperclip" [number]="4">
            @if (!savedId()) {
              <p class="attachments-hint" i18n="@@purchase-receipts.pages.enregistrez.d.abord.le.bon.de.reception.pour.ajo.d44608bf"> Enregistrez d'abord le bon de réception pour ajouter des pièces jointes (PDF, JPG, PNG — max 10 Mo). </p>
            } @else {
              <p-fileUpload
                mode="basic"
                chooseLabel="Ajouter un fichier" i18n-chooseLabel="@@purchase-receipts.pages.ajouter.un.fichier.02b74bc9"
                [auto]="true"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                [maxFileSize]="10000000"
                [customUpload]="true"
                (uploadHandler)="onUpload($event)"
                chooseIcon="pi pi-upload">
              </p-fileUpload>

              @if (attachments().length > 0) {
                <ul class="attachments-list">
                  @for (att of attachments(); track att.id) {
                    <li>
                      <i class="pi pi-file"></i>
                      <span>{{ att.fileName }}</span>
                      <small>({{ formatSize(att.sizeBytes) }})</small>
                      <app-button
                        variant="ghost"
                        size="sm"
                        icon="pi-trash"
                        [iconOnly]="true"
                        (clicked)="deleteAttachment(att.id)"
                        ariaLabel="Supprimer la pièce jointe" i18n-ariaLabel="@@purchase-receipts.pages.supprimer.la.piece.jointe.9b073c7b">
                      </app-button>
                    </li>
                  }
                </ul>
              }
            }
          </app-form-section>
        </div>

        <aside class="totals-panel">
          <h3 i18n="@@purchase-receipts.pages.totaux.a1ca02f8">Totaux</h3>
          <div class="total-row">
            <span i18n="@@purchase-receipts.pages.total.ht.2ca17ae6">Total HT</span>
            <span>{{ totalHT() | currency:'TND':'symbol':'1.3-3' }}</span>
          </div>
          <div class="total-row">
            <span i18n="@@purchase-receipts.pages.tva.fb62cb5d">TVA</span>
            <span>{{ totalVat() | currency:'TND':'symbol':'1.3-3' }}</span>
          </div>
          <div class="total-row grand">
            <span i18n="@@purchase-receipts.pages.total.ttc.9e80ff7c">Total TTC</span>
            <span>{{ totalTTC() | currency:'TND':'symbol':'1.3-3' }}</span>
          </div>
          <div class="divider"></div>
          <div class="total-row">
            <span i18n="@@purchase-receipts.pages.total.commande.ht.e5a5e984">Total commandé HT</span>
            <span>{{ totalOrderedHT() | currency:'TND':'symbol':'1.3-3' }}</span>
          </div>
          <div class="total-row">
            <span i18n="@@purchase-receipts.pages.total.recu.ht.aef476e2">Total reçu HT</span>
            <span>{{ totalHT() | currency:'TND':'symbol':'1.3-3' }}</span>
          </div>
          <div class="total-row pending-total">
            <span i18n="@@purchase-receipts.pages.reste.a.recevoir.ht.b1ff628f">Reste à recevoir HT</span>
            <span>{{ remainingHT() | currency:'TND':'symbol':'1.3-3' }}</span>
          </div>
        </aside>
      </div>

      <div class="form-actions">
        <app-button variant="outline" icon="pi-times" iconPos="left"
          routerLink="/purchase-receipts" i18n="@@purchase-receipts.pages.annuler.49ba3292"> Annuler </app-button>
        <app-button variant="secondary" icon="pi-save" iconPos="left"
          [disabled]="!canSave() || submitting()"
          (clicked)="save('draft')">
          <ng-container i18n="@@purchase-receipts.pages.sel.enregistrement.enregistrer.en.brouillon.cd8328f3">{!!(submitting() && submitMode() === 'draft'), select, true {Enregistrement…} other {Enregistrer en brouillon}}</ng-container>
        </app-button>
        <app-button variant="primary" icon="pi-check" iconPos="left"
          [disabled]="!canSave() || submitting()"
          (clicked)="save('save')">
          <ng-container i18n="@@purchase-receipts.pages.sel.enregistrement.enregistrer.1317c42c">{!!(submitting() && submitMode() === 'save'), select, true {Enregistrement…} other {Enregistrer}}</ng-container>
        </app-button>
        <app-button variant="primary" icon="pi-verified" iconPos="left"
          [disabled]="!canValidate() || submitting()"
          (clicked)="save('validate')">
          <ng-container i18n="@@purchase-receipts.pages.sel.validation.valider.la.reception.21433cdd">{!!(submitting() && submitMode() === 'validate'), select, true {Validation…} other {Valider la réception}}</ng-container>
        </app-button>
      </div>
    }

    <p-dialog
      header="Importer depuis BL fournisseur" i18n-header="@@purchase-receipts.pages.importer.depuis.bl.fournisseur.3e304217"
      [(visible)]="importBlDialogVisible"
      [modal]="true"
      [style]="{ width: '420px' }"
      [draggable]="false">
      <p class="dialog-hint" i18n="@@purchase-receipts.pages.saisissez.le.numero.du.bon.de.livraison.fourniss.fa91a642"> Saisissez le numéro du bon de livraison fournisseur. Il sera reporté
        dans les champs « N° BL » et « Réf. fournisseur ». </p>
      <input
        pInputText
        [(ngModel)]="importBlNumber"
        (keyup.enter)="applyImportBl()"
        placeholder="Ex. BL-4587" i18n-placeholder="@@purchase-receipts.pages.ex.bl.4587.25995f69"
        class="w-full"
        autofocus />
      <ng-template pTemplate="footer">
        <app-button variant="outline" (clicked)="importBlDialogVisible = false" i18n="@@purchase-receipts.pages.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" icon="pi-check" iconPos="left"
          [disabled]="!importBlNumber.trim()"
          (clicked)="applyImportBl()" i18n="@@purchase-receipts.pages.appliquer.a4d66139"> Appliquer </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .lot-alloc {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      padding: 0.5rem 0;
    }
    .lot-alloc-label { font-size: 0.75rem; font-weight: 600; color: #64748b; margin-right: 0.5rem; }
    .btn-icon { background: none; border: none; cursor: pointer; color: #64748b; }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      color: var(--color-text-secondary);
      gap: var(--spacing-3);
    }

    .form-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      gap: var(--spacing-4);
      align-items: start;
      width: 100%;
      max-width: 100%;
    }

    .form-main {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      min-width: 0;
    }

    .form-grid-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--spacing-4);
    }

    .form-grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--spacing-4);
    }

    @media (max-width: 900px) {
      .form-grid-3,
      .form-grid-2 { grid-template-columns: 1fr; }
    }

    .span-full { grid-column: 1 / -1; }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      min-width: 0;
    }

    .form-group label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .required { color: var(--color-error-600); }

    .w-full { width: 100%; }
    .bg-muted { background: var(--color-background-subtle, #f9fafb); }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-bold { font-weight: var(--font-weight-bold); }

    .lines-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-4);
    }

    .lines-actions__danger {
      margin-left: auto;
    }

    .lines-table-wrap {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      min-width: 0;
      max-width: 100%;
    }

    .lines-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      min-width: 920px;
    }

    .lines-table col.col-idx { width: 40px; }
    .lines-table col.col-article { width: 19%; }
    .lines-table col.col-designation { width: 13%; }
    .lines-table col.col-unit { width: 8%; }
    .lines-table col.col-qty-ord { width: 8%; }
    .lines-table col.col-qty-rec { width: 9%; }
    .lines-table col.col-qty-pend { width: 8%; }
    .lines-table col.col-price { width: 10%; }
    .lines-table col.col-disc { width: 7%; }
    .lines-table col.col-total { width: 10%; }
    .lines-table col.col-actions { width: 44px; }

    .lines-table th,
    .lines-table td {
      padding: var(--spacing-2);
      text-align: left;
      vertical-align: middle;
      border-bottom: 1px solid var(--color-border-subtle);
    }

    .lines-table th.col-designation,
    .lines-table td.col-designation,
    .lines-table th.col-total,
    .lines-table td.col-total {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .lines-table td.col-article {
      overflow: visible;
    }

    .lines-table th {
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-secondary);
      background: var(--color-background-subtle);
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
    }

    .lines-table th.col-total,
    .lines-table td.col-total { text-align: right; }

    .lines-table th.col-qty-ord,
    .lines-table th.col-qty-rec,
    .lines-table th.col-qty-pend,
    .lines-table td.col-qty-ord,
    .lines-table td.col-qty-rec,
    .lines-table td.col-qty-pend { text-align: center; }

    .lines-table th.col-actions,
    .lines-table td.col-actions {
      text-align: center;
      padding-inline: var(--spacing-1, 0.25rem);
    }

    .pending-qty {
      color: #ea580c;
      font-weight: var(--font-weight-semibold);
    }

    .empty-lines {
      text-align: center;
      padding: var(--spacing-6) !important;
      color: var(--color-text-secondary);
    }

    .product-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      min-width: 0;
    }

    .product-item__code {
      font-weight: var(--font-weight-bold);
      flex-shrink: 0;
    }

    .product-item__name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .product-item__price {
      flex-shrink: 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .product-empty {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }

    .attachments-hint {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin: 0;
    }

    .attachments-list {
      list-style: none;
      padding: 0;
      margin: var(--spacing-4) 0 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .attachments-list li {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-background-subtle);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
    }

    .attachments-list li span { flex: 1; }

    .totals-panel {
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      box-shadow: var(--shadow-md);
      position: sticky;
      top: var(--spacing-4);
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
      overflow-wrap: anywhere;
    }

    .totals-panel h3 {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      gap: var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-2);
    }

    .total-row.grand {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin-top: var(--spacing-2);
    }

    .total-row.pending-total span:last-child {
      color: #ea580c;
      font-weight: var(--font-weight-semibold);
    }

    .divider {
      height: 1px;
      background: var(--color-border-subtle);
      margin: var(--spacing-3) 0;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: var(--spacing-3);
      margin-top: var(--spacing-6);
      padding-top: var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle);
    }

    .dialog-hint {
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    @media (max-width: 1100px) {
      .form-layout { grid-template-columns: 1fr; }
      .totals-panel { position: static; }
    }

    :host ::ng-deep {
      app-form-section .form-section {
        margin-bottom: 0;
      }

      .p-select, .p-datepicker, .p-autocomplete { width: 100%; }
      .p-datepicker { display: flex; }

      .form-grid-3 .p-select,
      .form-grid-3 .p-datepicker {
        width: 100%;
      }

      .lines-table p-autocomplete,
      .lines-table p-autocomplete .p-autocomplete,
      .lines-table p-autocomplete .p-autocomplete-input {
        width: 100%;
        max-width: 100%;
      }

      .lines-table p-inputnumber,
      .lines-table p-inputnumber .p-inputnumber,
      .lines-table p-inputnumber .p-inputtext {
        width: 100%;
        max-width: 100%;
      }

      .lines-table td input.p-inputtext {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
    }
  `]
})
export class PurchaseReceiptFormComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private receiptService = inject(PurchaseReceiptService);
  private poService = inject(PurchaseOrderService);
  private supplierService = inject(SupplierService);
  private productService = inject(ProductService);
  private stockService = inject(StockService);
  private readonly productAutocomplete = inject(ProductAutocompleteService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private warehouseContext = inject(WarehouseContextService);
  private readonly barcodeLookup = inject(BarcodeLookupService);
  private readonly barcodeFeedback = inject(BarcodeFeedbackService);
  private readonly searchSubject$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  loading = signal(true);
  submitting = signal(false);
  submitMode = signal<'draft' | 'save' | 'validate' | null>(null);
  isEdit = signal(false);
  savedId = signal<string | null>(null);
  receiptNumber = signal<string | null>(null);
  statusDisplay = signal<string | null>('Brouillon');
  statusSeverity = signal<'secondary' | 'success' | 'danger'>('secondary');

  suppliers = signal<SupplierListItem[]>([]);
  purchaseOrderOptions = signal<{ id: string; label: string }[]>([]);
  productSuggestions = signal<ProductListItem[]>([]);
  isLoadingProducts = signal(false);
  attachments = signal<PurchaseReceiptAttachment[]>([]);

  selectedSupplierId: string | null = null;
  selectedPurchaseOrderId: string | null = null;
  lockedPurchaseOrderId: string | null = null;
  selectedWarehouseId: string | null = null;
  receiptDate: Date = new Date();
  supplierReference = '';
  transporterName = '';
  deliveryNoteNumber = '';
  notes = '';
  lines: ReceiptLineRow[] = [];
  stockFeatures = signal<StockFeatures | null>(null);
  traceabilityByProduct = signal<Map<string, { trackingMode: number; pickingPolicy: number }>>(new Map());

  totalHT = signal(0);
  totalVat = signal(0);
  totalTTC = signal(0);
  totalOrderedHT = signal(0);
  remainingHT = signal(0);

  barcodeLookingUp = signal(false);
  readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;

  @ViewChild('barcodeField') private barcodeField?: BarcodeScanFieldComponent;
  importBlDialogVisible = false;
  importBlNumber = '';

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@purchase-receipts.purchase-receipt-form.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@purchase-receipts.purchase-receipt-form.ts.bons.de.reception.84d6ebb5:Bons de réception`, route: '/purchase-receipts' },
    { label: $localize`:@@purchase-receipts.purchase-receipt-form.ts.nouveau.b9676c8f:Nouveau` }
  ];

  ngOnInit(): void {
    const ctxWh = this.warehouseContext.selectedWarehouseId();
    if (ctxWh) this.selectedWarehouseId = ctxWh;

    this.setupProductSearch();
    this.stockService.getFeatures().subscribe({
      next: res => {
        if (res.success && res.data) this.stockFeatures.set(res.data);
      }
    });

    const id = this.route.snapshot.paramMap.get('id');
    const poId = this.route.snapshot.queryParamMap.get('purchaseOrderId');

    this.loadSuppliers();

    if (id && id !== 'new') {
      this.isEdit.set(true);
      this.savedId.set(id);
      this.breadcrumbItems = [
        { label: $localize`:@@purchase-receipts.purchase-receipt-form.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
        { label: $localize`:@@purchase-receipts.purchase-receipt-form.ts.bons.de.reception.84d6ebb5:Bons de réception`, route: '/purchase-receipts' },
        { label: $localize`:@@purchase-receipts.purchase-receipt-form.ts.modifier.f260e757:Modifier` }
      ];
      this.loadReceipt(id);
    } else if (poId) {
      this.lockedPurchaseOrderId = poId;
      this.selectedPurchaseOrderId = poId;
      this.prefillFromPo(poId);
    } else {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupProductSearch(): void {
    if (this.productAutocomplete.isV2Enabled) {
      this.productAutocomplete.prefetch().pipe(takeUntil(this.destroy$)).subscribe();
    }

    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((query: string) => {
        this.isLoadingProducts.set(true);
        return this.productAutocomplete.search(query).pipe(
          catchError(() => {
            this.isLoadingProducts.set(false);
            return of([] as ProductSuggestion[]);
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (items) => {
        this.isLoadingProducts.set(false);
        this.productSuggestions.set(items.map(suggestionToListItem));
      },
      error: () => {
        this.isLoadingProducts.set(false);
        this.productSuggestions.set([]);
      }
    });
  }

  private loadSuppliers(): void {
    this.supplierService.getActiveSuppliers().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.suppliers.set(res.data.items);
        }
      }
    });
  }

  private loadEligiblePurchaseOrders(supplierId: string): void {
    this.poService.getPurchaseOrders({
      supplierId,
      pageSize: 100
    }).subscribe({
      next: (res) => {
        if (!res.success || !res.data) {
          this.purchaseOrderOptions.set([]);
          return;
        }
        const eligible = res.data.items.filter(
          (po: PurchaseOrderListItem) =>
            po.status === PurchaseOrderStatus.Confirmed ||
            po.status === PurchaseOrderStatus.PartiallyReceived
        );
        this.purchaseOrderOptions.set(
          eligible.map(po => ({
            id: po.id,
            label: `${po.number} — ${po.statusDisplay} (${po.totalHT.toFixed(3)} HT)`
          }))
        );
      }
    });
  }

  private loadReceipt(id: string): void {
    this.receiptService.getPurchaseReceipt(id).subscribe({
      next: (res) => {
        if (!res.success || !res.data) {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@purchase-receipt-form.component.summary.Erreur:Erreur`,
            detail: $localize`:@@purchase-receipt-form.component.detail.bon.de.reception.introuvable.ddf6c47b:Bon de réception introuvable`
          });
          this.router.navigate(['/purchase-receipts']);
          return;
        }

        const detail = mapPurchaseReceiptDetailFromApi(res.data);
        if (!detail) {
          this.toastService.add({
            severity: 'warn',
            summary: $localize`:@@purchase-receipt-form.component.summary.Statut_inconnu:Statut inconnu`,
            detail: $localize`:@@purchase-receipt-form.component.detail.impossible.de.charger.ce.bon.de.reception.de7497ba:Impossible de charger ce bon de réception.`
          });
          this.router.navigate(['/purchase-receipts']);
          return;
        }

        if (detail.status !== PurchaseReceiptStatus.Draft) {
          this.toastService.add({
            severity: 'warn',
            summary: $localize`:@@purchase-receipt-form.component.summary.Non_modifiable:Non modifiable`,
            detail: $localize`:@@purchase-receipt-form.component.detail.Seuls_les_brouil:Seuls les brouillons peuvent être modifiés.`
          });
          this.router.navigate(['/purchase-receipts', id]);
          return;
        }

        this.receiptNumber.set(detail.number);
        this.statusDisplay.set(detail.statusDisplay);
        this.selectedSupplierId = detail.supplier.id;
        this.selectedPurchaseOrderId = detail.purchaseOrderId;
        this.selectedWarehouseId = detail.warehouseId;
        this.receiptDate = new Date(detail.receiptDate);
        this.supplierReference = detail.supplierReference ?? '';
        this.transporterName = detail.transporterName ?? '';
        this.deliveryNoteNumber = detail.deliveryNoteNumber ?? '';
        this.notes = detail.notes ?? '';
        this.attachments.set(detail.attachments ?? []);

        this.lines = detail.lines.map(l => ({
          id: l.id,
          product: {
            id: l.productId,
            code: l.productCode,
            name: l.productName,
            description: l.productDescription,
            unit: l.unit ?? '',
            unitPrice: l.unitPriceHT,
            purchasePrice: l.unitPriceHT,
            vatRate: this.parseVatRate(l.vatRateDisplay),
            typeDisplay: '',
            categoryId: '',
            category: '',
            isActive: true,
            isStockManaged: true
          } as ProductListItem,
          productId: l.productId,
          productCode: l.productCode,
          productName: l.productName,
          designation: l.productName,
          unit: l.unit ?? '',
          orderedQuantity: l.orderedQuantity,
          receivedQuantity: l.receivedQuantity,
          alreadyReceivedQuantity: 0,
          unitPriceHT: l.unitPriceHT,
          discountPercent: l.discountPercent,
          vatRate: this.parseVatRate(l.vatRateDisplay),
          purchaseOrderLineId: l.purchaseOrderLineId,
          trackingMode: coerceTrackingMode(l.trackingMode),
          pickingPolicy: coercePickingPolicy(l.pickingPolicy),
          lotAllocations: [createDefaultLotRow(l.receivedQuantity)]
        }));
        this.loadTraceabilityContext();

        this.loadEligiblePurchaseOrders(detail.supplier.id);
        this.recalculateTotals();
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-form.component.summary.Erreur:Erreur`,
          detail: $localize`:@@purchase-receipt-form.component.detail.impossible.de.charger.le.bon.de.reception.355e99c7:Impossible de charger le bon de réception`
        });
        this.router.navigate(['/purchase-receipts']);
      }
    });
  }

  private prefillFromPo(purchaseOrderId: string): void {
    this.receiptService.prefillFromPurchaseOrder(purchaseOrderId).subscribe({
      next: (res) => {
        if (!res.success || !res.data) {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@purchase-receipt-form.component.summary.Erreur:Erreur`,
            detail: res.message || $localize`:@@purchase-receipts.purchase-receipt-form.ts.impossible.de.preremplir.depuis.le.bon.d.0b96b652:Impossible de préremplir depuis le bon de commande`
          });
          this.loading.set(false);
          return;
        }

        const prefill = res.data;
        this.selectedSupplierId = prefill.supplierId;
        this.selectedPurchaseOrderId = prefill.purchaseOrderId;
        if (prefill.warehouseId) {
          this.selectedWarehouseId = prefill.warehouseId;
        }

        this.purchaseOrderOptions.set([{
          id: prefill.purchaseOrderId,
          label: prefill.purchaseOrderNumber
        }]);

        this.lines = prefill.lines
          .filter(l => l.pendingQuantity > 0)
          .map(l => ({
            product: {
              id: l.productId,
              code: l.productCode,
              name: l.productName,
              description: l.productDescription,
              unit: l.unit ?? '',
              unitPrice: l.unitPriceHT,
              purchasePrice: l.unitPriceHT,
              vatRate: 19,
              typeDisplay: '',
              categoryId: '',
              category: '',
              isActive: true,
              isStockManaged: true
            } as ProductListItem,
            productId: l.productId,
            productCode: l.productCode,
            productName: l.productName,
            designation: l.productName,
            unit: l.unit ?? '',
            orderedQuantity: l.orderedQuantity,
            receivedQuantity: l.pendingQuantity,
            alreadyReceivedQuantity: l.alreadyReceivedQuantity,
            unitPriceHT: l.unitPriceHT,
            discountPercent: null,
            vatRate: 19,
            purchaseOrderLineId: l.purchaseOrderLineId,
            id: null,
            trackingMode: 0,
            pickingPolicy: 0,
            lotAllocations: [createDefaultLotRow(l.pendingQuantity)]
          }));

        this.loadTraceabilityContext();
        // Enrich VAT from product catalog when possible
        this.enrichVatRates();
        this.recalculateTotals();
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-form.component.summary.Erreur:Erreur`,
          detail: err?.error?.errors?.[0] || $localize`:@@purchase-receipts.purchase-receipt-form.ts.impossible.de.preremplir.depuis.le.bon.d.0b96b652:Impossible de préremplir depuis le bon de commande`
        });
      }
    });
  }

  private enrichVatRates(): void {
    for (const line of this.lines) {
      if (!line.productId) continue;
      this.productService.getProduct(line.productId).subscribe({
        next: (res) => {
          if (res.success && res.data) {
            line.vatRate = res.data.vatRate;
            line.trackingMode = res.data.trackingMode ?? 0;
          }
          this.recalculateTotals();
        }
      });
    }
  }

  onSupplierChange(): void {
    this.selectedPurchaseOrderId = null;
    this.purchaseOrderOptions.set([]);
    if (this.selectedSupplierId) {
      this.loadEligiblePurchaseOrders(this.selectedSupplierId);
    }
  }

  onPurchaseOrderChange(): void {
    if (!this.selectedPurchaseOrderId) return;
    this.loading.set(true);
    this.prefillFromPo(this.selectedPurchaseOrderId);
  }

  addLine(): void {
    this.lines.push(this.createEmptyLine());
  }

  clearAllLines(): void {
    this.lines = [];
    this.recalculateTotals();
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
    this.recalculateTotals();
  }

  addLotAllocation(line: ReceiptLineRow): void {
    line.lotAllocations.push({ lotNumber: '', expiryDate: null, quantity: 0 });
  }

  removeLotAllocation(lineIndex: number, allocIndex: number): void {
    const line = this.lines[lineIndex];
    if (!line || line.lotAllocations.length <= 1) return;
    line.lotAllocations.splice(allocIndex, 1);
  }

  private buildLotAllocations(serverLines: { id: string; productId: string }[]): PurchaseReceiptLineAllocations[] | undefined {
    const payload: PurchaseReceiptLineAllocations[] = [];
    this.lines.forEach((line, i) => {
      const serverLine = serverLines[i];
      const lineId = serverLine?.id ?? line.id;
      if (serverLine?.id) {
        line.id = serverLine.id;
      }
      const allocations = buildAllocationPayload(line.lotAllocations ?? []);
      if (lineId && allocations.length > 0) {
        payload.push({ lineId, allocations });
      }
    });
    return payload.length > 0 ? payload : undefined;
  }

  showLineTraceability(line: ReceiptLineRow): boolean {
    const f = this.stockFeatures();
    if (!f || !this.selectedWarehouseId || !line.productId) return false;
    const mode = line.trackingMode ?? 0;
    return showLotSection(mode, f) || showSerialSection(mode, f);
  }

  private hasTrackedLines(): boolean {
    return this.lines.some(l => this.showLineTraceability(l));
  }

  private loadTraceabilityContext(): void {
    if (!this.selectedWarehouseId) return;
    const productIds = this.lines.map(l => l.productId).filter((id): id is string => !!id);
    if (productIds.length === 0) return;
    this.stockService.getTraceabilityContext(productIds, this.selectedWarehouseId).subscribe(res => {
      if (!res.success || !res.data) return;
      const map = new Map(this.traceabilityByProduct());
      for (const ctx of res.data) {
        map.set(ctx.productId, {
          trackingMode: coerceTrackingMode(ctx.trackingMode),
          pickingPolicy: coercePickingPolicy(ctx.pickingPolicy)
        });
      }
      this.traceabilityByProduct.set(map);
      for (const line of this.lines) {
        if (!line.productId) continue;
        const ctx = map.get(line.productId);
        if (ctx) {
          line.trackingMode = ctx.trackingMode;
          line.pickingPolicy = ctx.pickingPolicy;
        }
      }
    });
  }

  private defaultAllocationsForProduct(product: ProductListItem, quantity: number): AllocationRow[] {
    const mode = coerceTrackingMode(product.trackingMode);
    if (mode === TRACKING_MODE_SERIAL) {
      const count = Math.max(1, Math.round(quantity));
      return Array.from({ length: count }, () => createDefaultSerialRow());
    }
    return [createDefaultLotRow(quantity)];
  }

  private createEmptyLine(): ReceiptLineRow {
    return {
      id: null,
      product: null,
      productId: null,
      productCode: '',
      productName: '',
      designation: '',
      unit: '',
      orderedQuantity: 0,
      receivedQuantity: 1,
      alreadyReceivedQuantity: 0,
      unitPriceHT: 0,
      discountPercent: null,
      vatRate: 19,
      purchaseOrderLineId: null,
      trackingMode: 0,
      pickingPolicy: 0,
      lotAllocations: [createDefaultLotRow(1)]
    };
  }

  onWarehouseSelected(id: string | null): void {
    this.selectedWarehouseId = id;
    this.loadTraceabilityContext();
  }

  searchProducts(event: AutoCompleteCompleteEvent): void {
    this.searchSubject$.next(event.query ?? '');
  }

  onProductSelect(line: ReceiptLineRow, event: AutoCompleteSelectEvent): void {
    const product = event.value as ProductListItem;
    line.product = product;
    line.productId = product.id;
    line.productCode = product.code;
    line.productName = product.name;
    line.designation = product.name;
    line.unit = product.unit ?? '';
    line.unitPriceHT = product.purchasePrice ?? product.unitPrice ?? 0;
    line.vatRate = product.vatRate ?? 19;
    line.trackingMode = coerceTrackingMode(product.trackingMode);
    line.pickingPolicy = this.traceabilityByProduct().get(product.id)?.pickingPolicy ?? 0;
    line.lotAllocations = this.defaultAllocationsForProduct(product, line.receivedQuantity);
    if (!line.orderedQuantity) line.orderedQuantity = 0;
    this.loadTraceabilityContext();
    this.recalculateTotals();
  }

  pendingQty(line: ReceiptLineRow): number {
    return Math.max(0, line.orderedQuantity - line.alreadyReceivedQuantity - line.receivedQuantity);
  }

  lineTotalHT(line: ReceiptLineRow): number {
    const discount = (line.discountPercent ?? 0) / 100;
    return line.receivedQuantity * line.unitPriceHT * (1 - discount);
  }

  recalculateTotals(): void {
    let ht = 0;
    let vat = 0;
    let orderedHt = 0;

    for (const line of this.lines) {
      const lineHt = this.lineTotalHT(line);
      ht += lineHt;
      vat += lineHt * ((line.vatRate ?? 0) / 100);
      const discount = (line.discountPercent ?? 0) / 100;
      orderedHt += line.orderedQuantity * line.unitPriceHT * (1 - discount);
    }

    this.totalHT.set(ht);
    this.totalVat.set(vat);
    this.totalTTC.set(ht + vat);
    this.totalOrderedHT.set(orderedHt);
    this.remainingHT.set(Math.max(0, orderedHt - ht));
  }

  canSave(): boolean {
    return !!this.selectedSupplierId &&
      !!this.selectedWarehouseId &&
      !!this.receiptDate &&
      this.lines.length > 0 &&
      this.lines.every(l => !!l.productId && l.receivedQuantity > 0);
  }

  canValidate(): boolean {
    if (!this.canSave() || !this.stockFeatures()) return false;
    return this.lines.every(line => {
      if (!this.showLineTraceability(line)) return true;
      return entryAllocationsValid(
        line.trackingMode ?? 0,
        line.receivedQuantity,
        line.lotAllocations ?? [],
        this.stockFeatures()
      );
    });
  }

  onReceivedQuantityChange(line: ReceiptLineRow): void {
    if (line.lotAllocations?.length === 1) {
      line.lotAllocations[0].quantity = line.receivedQuantity;
    }
    this.recalculateTotals();
  }

  save(mode: 'draft' | 'save' | 'validate'): void {
    if (!this.canSave() || !this.selectedSupplierId || !this.selectedWarehouseId) return;

    if (mode === 'validate' && this.hasTrackedLines() && !this.canValidate()) {
      this.toastService.add({
        severity: 'warn',
        summary: $localize`:@@purchase-receipt-form.component.summary.Tra_abilit_inco:Traçabilité incomplète`,
        detail: $localize`:@@purchase-receipt-form.component.detail.Renseignez_les_n:Renseignez les numéros de lot ou de série pour chaque article suivi.`
      });
      return;
    }

    this.submitting.set(true);
    this.submitMode.set(mode);

    const linesPayload: CreatePurchaseReceiptLineRequest[] = this.lines.map(l => ({
      productId: l.productId!,
      receivedQuantity: l.receivedQuantity,
      unitPriceHT: l.unitPriceHT,
      orderedQuantity: l.orderedQuantity,
      purchaseOrderLineId: l.purchaseOrderLineId,
      discountPercent: l.discountPercent
    }));

    const persist$: Observable<string | null> = this.savedId()
      ? this.receiptService.updatePurchaseReceipt(this.savedId()!, {
          receiptDate: formatLocalDate(this.receiptDate),
          warehouseId: this.selectedWarehouseId,
          supplierReference: this.supplierReference || null,
          transporterName: this.transporterName || null,
          deliveryNoteNumber: this.deliveryNoteNumber || null,
          notes: this.notes || null,
          lines: linesPayload
        } as UpdatePurchaseReceiptRequest).pipe(
          switchMap(res => of(res.success ? this.savedId() : null))
        )
      : this.receiptService.createPurchaseReceipt({
          supplierId: this.selectedSupplierId,
          warehouseId: this.selectedWarehouseId,
          receiptDate: formatLocalDate(this.receiptDate),
          purchaseOrderId: this.selectedPurchaseOrderId,
          supplierReference: this.supplierReference || null,
          transporterName: this.transporterName || null,
          deliveryNoteNumber: this.deliveryNoteNumber || null,
          notes: this.notes || null,
          lines: linesPayload
        } as CreatePurchaseReceiptRequest).pipe(
          switchMap(res => of(res.success && res.data ? String(res.data) : null))
        );

    persist$.pipe(
      tap(id => {
        if (!id) return;
        this.savedId.set(id);
        this.isEdit.set(true);
      }),
      switchMap(id => {
        if (!id) return of({ id: null as string | null, validated: false, error: null as unknown });
        if (mode !== 'validate') return of({ id, validated: false, error: null as unknown });
        const validate$ = this.hasTrackedLines()
          ? this.receiptService.getPurchaseReceipt(id).pipe(
              map(res => this.buildLotAllocations(
                (res.data?.lines ?? []).map(l => ({ id: l.id, productId: l.productId }))
              )),
              switchMap(alloc => this.receiptService.validatePurchaseReceipt(id, alloc))
            )
          : this.receiptService.validatePurchaseReceipt(id);
        return validate$.pipe(
          map(res => ({ id, validated: !!res.success, error: null as unknown })),
          catchError(err => of({ id, validated: false, error: err }))
        );
      })
    ).subscribe({
      next: ({ id, validated, error }) => {
        this.submitting.set(false);
        this.submitMode.set(null);

        if (!id) {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@purchase-receipt-form.component.summary.Erreur:Erreur`,
            detail: $localize`:@@purchase-receipt-form.component.detail._chec_de_l_enreg:Échec de l'enregistrement`
          });
          return;
        }

        this.savedId.set(id);
        this.isEdit.set(true);

        if (mode === 'validate') {
          if (validated) {
            this.toastService.add({
              severity: 'success',
              summary: $localize`:@@purchase-receipt-form.component.summary.Validé:Validé`,
              detail: $localize`:@@purchase-receipt-form.component.detail.bon.de.reception.valide.avec.succes.23132924:Bon de réception validé avec succès`
            });
            this.router.navigate(['/purchase-receipts', id]);
            return;
          }

          this.toastService.add({
            severity: 'warn',
            summary: $localize`:@@purchase-receipt-form.component.summary.Enregistr_:Enregistré`,
            detail: error
              ? this.errorHandler.extractErrorMessage(error)
              : $localize`:@@purchase-receipts.purchase-receipt-form.ts.enregistre.mais.la.validation.a.echoue.93d8c18d:Enregistré, mais la validation a échoué`
          });
          this.ensureEditUrl(id);
          return;
        }

        this.toastService.add({
          severity: 'success',
          summary: $localize`:@@purchase-receipt-form.component.summary.Succès:Succès`,
          detail: $localize`:@@purchase-receipt-form.component.detail.bon.de.reception.enregistre.4fb74cab:Bon de réception enregistré`
        });

        if (mode === 'save') {
          this.router.navigate(['/purchase-receipts', id]);
        } else {
          this.ensureEditUrl(id);
        }
      },
      error: (err) => {
        this.submitting.set(false);
        this.submitMode.set(null);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-form.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err) || $localize`:@@purchase-receipts.purchase-receipt-form.ts.erreur.lors.de.l.enregistrement.28411a5e:Erreur lors de l'enregistrement`
        });
      }
    });
  }

  private ensureEditUrl(id: string): void {
    const routeId = this.route.snapshot.paramMap.get('id');
    if (routeId && routeId !== 'new') return;
    this.router.navigate(['/purchase-receipts', id, 'edit'], { replaceUrl: true });
  }

  focusBarcodeField(): void {
    this.barcodeField?.focus();
  }

  openImportBlDialog(): void {
    this.importBlNumber = this.deliveryNoteNumber || this.supplierReference || '';
    this.importBlDialogVisible = true;
  }

  applyImportBl(): void {
    const bl = this.importBlNumber.trim();
    if (!bl) return;
    this.deliveryNoteNumber = bl;
    if (!this.supplierReference?.trim()) {
      this.supplierReference = bl;
    }
    this.importBlDialogVisible = false;
    this.toastService.add({
      severity: 'success',
      summary: $localize`:@@purchase-receipt-form.component.summary.BL importé:BL importé`,
      detail: $localize`:@@purchase-receipts.purchase-receipt-form.ts.reference.fournisseur.bl.cfc63ba2:Référence fournisseur : ${bl}:bl:`
    });
  }

  /**
   * Scan sur le bon de réception.
   *
   * La résolution du code passe désormais par le socle partagé — il n'y avait aucune raison
   * que cet écran ait sa propre implémentation, divergente de celle de la caisse : un
   * correctif n'en aurait atteint qu'une moitié. La sémantique métier, elle, est conservée
   * telle quelle : un article déjà présent voit sa quantité reçue incrémentée, sinon une
   * ligne est créée au prix d'achat.
   */
  onBarcodeScanned(code: string): void {
    this.barcodeLookingUp.set(true);

    this.barcodeLookup.resolve(code, { requireActive: true }).subscribe(result => {
      this.barcodeLookingUp.set(false);

      if (result.status !== 'found' || !result.product) {
        this.barcodeFeedback.report(result);
        return;
      }

      const product = result.product;
      const existing = this.lines.find(l => l.productId === product.id);
      if (existing) {
        existing.receivedQuantity = (existing.receivedQuantity || 0) + 1;
      } else {
        const line = this.createEmptyLine();
        line.product = product;
        line.productId = product.id;
        line.productCode = product.code;
        line.productName = product.name;
        line.designation = product.name;
        line.unit = product.unit ?? '';
        line.unitPriceHT = product.purchasePrice ?? product.unitPrice ?? 0;
        line.vatRate = product.vatRate ?? 19;
        line.receivedQuantity = 1;
        this.lines.push(line);
      }

      this.recalculateTotals();
      this.barcodeFeedback.success(product.name);
    });
  }

  onUpload(event: { files: File[] }): void {
    const id = this.savedId();
    if (!id) return;
    const files = event.files ?? [];
    if (!files.length) return;

    const file = files[0];
    this.receiptService.uploadAttachment(id, file).subscribe({
      next: (res) => {
        if (res.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@purchase-receipt-form.component.summary.Pi_ce_jointe:Pièce jointe`,
            detail: $localize`:@@purchase-receipt-form.component.detail.Fichier ajou:Fichier ajouté`
          });
          this.reloadAttachments(id);
        }
      },
      error: (err) => {
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-form.component.summary.Erreur:Erreur`,
          detail: err?.error?.errors?.[0] || $localize`:@@purchase-receipts.purchase-receipt-form.ts.echec.de.l.upload.68e0c9ab:Échec de l'upload`
        });
      }
    });
  }

  deleteAttachment(attachmentId: string): void {
    const id = this.savedId();
    if (!id) return;
    this.receiptService.deleteAttachment(id, attachmentId).subscribe({
      next: (res) => {
        if (res.success) {
          this.attachments.update(list => list.filter(a => a.id !== attachmentId));
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-form.component.summary.Erreur:Erreur`,
          detail: $localize`:@@purchase-receipt-form.component.detail.Impossible_de_su:Impossible de supprimer la pièce jointe`
        });
      }
    });
  }

  private reloadAttachments(id: string): void {
    this.receiptService.getAttachments(id).subscribe({
      next: (res) => {
        if (res.success && res.data) this.attachments.set(res.data);
      }
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  private parseVatRate(display: string | null | undefined): number {
    if (!display) return 19;
    const match = String(display).match(/(\d+(?:[.,]\d+)?)/);
    return match ? parseFloat(match[1].replace(',', '.')) : 19;
  }
}
