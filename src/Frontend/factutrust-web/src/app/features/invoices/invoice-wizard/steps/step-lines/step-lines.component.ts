/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, OnDestroy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, switchMap, catchError, of, tap } from 'rxjs';

// PrimeNG
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { TooltipModule } from 'primeng/tooltip';
import { DividerModule } from 'primeng/divider';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TagModule } from 'primeng/tag';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { QuickCreateProductDialogComponent } from '@shared/components/quick-create-product-dialog/quick-create-product-dialog.component';
import { VariantProductPickerComponent } from '@shared/components/variant-product-picker/variant-product-picker.component';
import { ButtonComponent } from '@shared/components/button/button.component';

// Services & Models
import { InvoiceWizardService } from '../../services/invoice-wizard.service';
import { ProductListItem } from '@core/services/product.service';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { PriceSource, PricingService } from '@core/services/pricing.service';
import { DocumentLinePricingService, mapResolvedPricePromotion } from '@shared/utils/document-line-pricing.helper';
import {
  ProductAutocompleteService,
  ProductSuggestion
} from '@shared/services/product-autocomplete.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { environment } from '@environments/environment';
import {
  InvoiceLine,
  TunisianVatRate,
  Currency,
  VAT_RATE_OPTIONS
} from '../../models/invoice-wizard.models';
import { normalizeDesignation, resolveDesignation } from '../../utils/invoice-line.utils';

interface WizardProductSuggestion {
  id: string;
  code: string;
  name: string;
  unitPrice: number;
  vatRate: TunisianVatRate;
  unit: string;
  isFodecApplicable: boolean;
  isDiscountEnabled: boolean;
  maxDiscountPercent: number | null;
}

/**
 * Étape 4 - Lignes de facturation
 * 
 * Permet de gérer les lignes de facture avec:
 * - Ajout/modification/suppression de lignes
 * - Sélection de produits depuis le catalogue
 * - Saisie libre de désignations
 * - Calculs automatiques (HT, TVA, TTC)
 * - Gestion des remises (% ou montant)
 * 
 * Conformité tunisienne:
 * - Taux de TVA: 0%, 7%, 13%, 19%
 * - Calculs conformes à la réglementation
 * - Affichage détaillé par taux de TVA
 */
@Component({
  selector: 'app-step-lines',
  standalone: true,
  imports: [BackendLabelPipe, 
    BarcodeScanFieldComponent,
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    AutoCompleteModule,
    TooltipModule,
    DividerModule,
    CardModule,
    DialogModule,
    ConfirmDialogModule,
    TagModule,
    DecimalPipe,
    QuickCreateProductDialogComponent,
    VariantProductPickerComponent,
    ButtonComponent
  ],
  template: `
    <div class="step-lines">
      <!-- Header -->
      <section class="section">
        <div class="section-header">
          <div>
            <h2 class="section-title" i18n="@@invoices.invoice-wizard.lignes.de.facturation.73e92d24">
              <i class="pi pi-list"></i>
              Lignes de facturation
            </h2>
            <p class="section-description" i18n="@@invoices.invoice-wizard.ajoutez.les.produits.ou.services.a.facturer.6b89b6a1"> Ajoutez les produits ou services à facturer </p>
          </div>
          <div class="header-actions">
            <button 
              type="button"
              class="mode-toggle"
              [class.active]="!simpleMode()"
              (click)="toggleSimpleMode()"
              pTooltip="Afficher/masquer les colonnes avancées (Unité, Remise, TVA détaillée)" i18n-pTooltip="@@invoices.invoice-wizard.afficher.masquer.les.colonnes.avancees.unite.rem.2761bdf3">
              <i class="pi" [class.pi-eye]="simpleMode()" [class.pi-eye-slash]="!simpleMode()"></i>
              {{ simpleMode() ? loc_ui_tern_mode_avance_f0a7a0 : loc_ui_tern_mode_simple_c08361 }}
            </button>
            <p-button
              label="Ajouter une ligne" i18n-label="@@invoices.invoice-wizard.ajouter.une.ligne.ba241fd4"
              icon="pi pi-plus"
              (click)="addNewLine()">
            </p-button>
          </div>
          @if (barcodeScanEnabled) {
            <div class="barcode-scan-row">
              <ft-barcode-scan-field
                placeholder="Scanner un code-barres pour ajouter une ligne" i18n-placeholder="@@invoices.invoice-wizard.scanner.un.code.barres.pour.ajouter.une.ligne.3525ced5"
                [autoFocus]="false"
                (scanned)="onBarcodeScanned($event)"></ft-barcode-scan-field>
            </div>
          }
        </div>
      </section>

      <!-- Unmatched Lines Banner (typically after AI import when products are not in the catalog) -->
      @if (unmatchedLines().length > 0) {
        <div class="unmatched-banner" role="alert">
          <i class="pi pi-exclamation-triangle"></i>
          <div class="unmatched-content">
            <strong i18n="@@invoices.invoice-wizard.ligne.s.a.associer.a.un.produit.291ee553">{{ unmatchedLines().length }} ligne(s) à associer à un produit</strong>
            <p i18n="@@invoices.invoice-wizard.ces.articles.ne.sont.pas.relies.a.votre.catalogu.77ca4c77">Ces articles ne sont pas reliés à votre catalogue. Liez chaque ligne à un produit existant ou créez un nouveau produit pour pouvoir émettre la facture.</p>
          </div>
          <p-button
            label="Résoudre la première" i18n-label="@@invoices.invoice-wizard.resoudre.la.premiere.893bfabd"
            icon="pi pi-arrow-right"
            iconPos="right"
            severity="warn"
            (click)="resolveNextUnmatched()">
          </p-button>
        </div>
      }

      <!-- Lines Table -->
      @if (lines().length > 0) {
        <div class="lines-table-container">
          <p-table 
            [value]="lines()" 
            [scrollable]="true"
            scrollHeight="55vh"
            styleClass="p-datatable-sm lines-table"
            [reorderableColumns]="true">
            
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 3%" i18n="@@invoices.invoice-wizard.text.d08f88df">#</th>
                <th style="width: 28%" i18n="@@invoices.invoice-wizard.designation.63a9062c">Désignation</th>
                <th style="width: 8%" class="text-right" i18n="@@invoices.invoice-wizard.quantite.09a38fda">Quantité</th>
                @if (!simpleMode()) {
                  <th style="width: 7%" i18n="@@invoices.invoice-wizard.unite.388fd9c4">Unité</th>
                }
                <th style="width: 10%" class="text-right" i18n="@@invoices.invoice-wizard.prix.unit.ht.5fbbfe6f">Prix unit. HT</th>
                <th style="width: 9%" i18n="@@invoices.invoice-wizard.origine.62e96258">Origine</th>
                @if (!simpleMode()) {
                  <th style="width: 10%" i18n="@@invoices.invoice-wizard.remise.ce12d942">Remise</th>
                  <th style="width: 8%" class="col-vat-rate" i18n="@@invoices.invoice-wizard.tva.fb62cb5d">TVA</th>
                  <th style="width: 9%" class="text-right" i18n="@@invoices.invoice-wizard.total.ht.2ca17ae6">Total HT</th>
                  <th style="width: 6%" class="text-right" i18n="@@invoices.invoice-wizard.tva.fb62cb5d">TVA</th>
                }
                <th style="width: 10%" class="text-right" i18n="@@invoices.invoice-wizard.total.ttc.9e80ff7c">Total TTC</th>
                <th style="width: 7%" i18n="@@invoices.invoice-wizard.actions.c3cd636a">Actions</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-line let-index="rowIndex">
              <tr [class.editing]="editingLineId === line.id">
                <!-- Line Number -->
                <td class="line-number">{{ line.lineNumber }}</td>
                
                <!-- Designation -->
                <td>
                  @if (editingLineId === line.id) {
                    <div class="edit-cell">
                      <div class="edit-cell-product-row">
                        <div class="product-cell-input">
                          <p-autoComplete
                            [(ngModel)]="editSelectedProduct"
                            [suggestions]="productSuggestions()"
                            (completeMethod)="searchProducts($event)"
                            (onSelect)="onProductSelect($event)"
                            field="name"
                            [forceSelection]="false"
                            [dropdown]="true"
                            [minLength]="0"
                            placeholder="Rechercher un produit..." i18n-placeholder="@@invoices.invoice-wizard.rechercher.un.produit.0da008f6"
                            appendTo="body"
                            [style]="{ width: '100%' }">
                            <ng-template let-product pTemplate="item">
                              <div class="product-suggestion">
                                <span class="product-code">{{ product.code }}</span>
                                <span class="product-name">{{ product.name }}</span>
                                @if (product.isFodecApplicable) {
                                  <span class="fodec-badge fodec-badge--suggestion" i18n="@@invoices.invoice-wizard.fodec.9a029080">FODEC</span>
                                }
                                <span class="product-price">{{ product.unitPrice | number:'1.3-3' }} TND</span>
                              </div>
                            </ng-template>
                            <ng-template pTemplate="empty">
                              <div class="product-empty">
                                @if (isLoadingProducts()) {
                                  <i class="pi pi-spin pi-spinner"></i>
                                  <span i18n="@@invoices.invoice-wizard.chargement.des.produits.98b02485">Chargement des produits...</span>
                                } @else {
                                  <div class="product-empty-content">
                                    <span i18n="@@invoices.invoice-wizard.aucun.produit.trouve.5edf7149">Aucun produit trouvé</span>
                                    <app-button
                                      variant="primary"
                                      size="sm"
                                      icon="pi-plus"
                                      [iconOnly]="true"
                                      ariaLabel="Créer un produit" i18n-ariaLabel="@@invoices.invoice-wizard.creer.un.produit.1ff296f3"
                                      (click)="openQuickCreateProduct(); $event.stopPropagation()"
                                      class="btn-add-product-circle btn-add-product-circle--dropdown" />
                                  </div>
                                }
                              </div>
                            </ng-template>
                          </p-autoComplete>
                        </div>
                        <app-button
                          variant="outline"
                          size="sm"
                          icon="pi-th-large"
                          ariaLabel="Choisir une variante" i18n-ariaLabel="@@invoices.invoice-wizard.choisir.une.variante.8e914309"
                          (click)="variantPickerVisible = true; $event.stopPropagation()"
                          title="Choisir une variante" i18n-title="@@invoices.invoice-wizard.choisir.une.variante.c8ab137c" />
                        <app-button
                          variant="primary"
                          size="sm"
                          icon="pi-plus"
                          [iconOnly]="true"
                          ariaLabel="Créer un produit" i18n-ariaLabel="@@invoices.invoice-wizard.creer.un.produit.1ff296f3"
                          (click)="openQuickCreateProduct(); $event.stopPropagation()"
                          class="btn-add-product-circle" />
                      </div>
                      <textarea
                        pTextarea
                        [(ngModel)]="editLine.description"
                        placeholder="Description (optionnel)" i18n-placeholder="@@invoices.invoice-wizard.description.optionnel.d1a39655"
                        rows="2"
                        class="description-input">
                      </textarea>
                    </div>
                  } @else {
                    <div class="designation-cell">
                      <div class="designation-main-row">
                        <span class="designation-main">{{ line.designation }}</span>
                        @if (!line.productId) {
                          <span class="unmatched-badge" pTooltip="Cette ligne n'est pas associée à un produit du catalogue" i18n-pTooltip="@@invoices.invoice-wizard.cette.ligne.n.est.pas.associee.a.un.produit.du.c.051aa385" i18n="@@invoices.invoice-wizard.a.lier.7027e5e5">
                            <i class="pi pi-exclamation-circle"></i> À lier
                          </span>
                        }
                        @if (simpleMode() && line.isFodecApplicable) {
                          <span class="fodec-badge" pTooltip="FODEC applicable (1%)" i18n-pTooltip="@@invoices.invoice-wizard.fodec.applicable.1.01c61523" i18n="@@invoices.invoice-wizard.fodec.9a029080">FODEC</span>
                        }
                      </div>
                      @if (line.description) {
                        <span class="designation-desc">{{ line.description }}</span>
                      }
                    </div>
                  }
                </td>

                <!-- Quantity -->
                <td class="text-right">
                  @if (editingLineId === line.id) {
                    <p-inputNumber
                      [(ngModel)]="editLine.quantity"
                      [min]="0.001"
                      [minFractionDigits]="0"
                      [maxFractionDigits]="3"
                      mode="decimal"
                      [style]="{ width: '80px' }"
                      (onInput)="onQuantityEdit()">
                    </p-inputNumber>
                  } @else {
                    {{ line.quantity | number:'1.0-3' }}
                  }
                </td>

                <!-- Unit -->
                @if (!simpleMode()) {
                <td>
                  @if (editingLineId === line.id) {
                    <input
                      pInputText
                      [(ngModel)]="editLine.unit"
                      placeholder="Unité" i18n-placeholder="@@invoices.invoice-wizard.unite.388fd9c4"
                      [style]="{ width: '80px' }">
                  } @else {
                    {{ line.unit || 'Unité' }}
                  }
                </td>
                }

                <!-- Unit Price HT -->
                <td class="text-right">
                  @if (editingLineId === line.id) {
                    <div class="price-cell">
                      @if (linePricing.resolving()) {
                        <i class="pi pi-spin pi-spinner price-resolving" pTooltip="Résolution du prix…" i18n-pTooltip="@@invoices.invoice-wizard.resolution.du.prix.38097b39"></i>
                      }
                      <p-inputNumber
                        [(ngModel)]="editLine.unitPriceHT"
                        [min]="0"
                        [minFractionDigits]="3"
                        [maxFractionDigits]="3"
                        mode="decimal"
                        suffix=" TND"
                        [style]="{ width: '120px' }"
                        (onInput)="onUnitPriceManualEdit()">
                      </p-inputNumber>
                    </div>
                  } @else {
                    <span class="amount">{{ line.unitPriceHT | number:'1.3-3' }}</span>
                  }
                </td>

                <!-- Price source -->
                <td>
                  @if (editingLineId === line.id) {
                    @if (editLine.priceOverridden) {
                      <p-tag severity="warning" value="Saisi"></p-tag>
                    } @else if (editLine.priceSource === 'ClientPrice') {
                      <p-tag severity="success" value="Prix négocié"></p-tag>
                    } @else if (editLine.priceSource === 'PriceList') {
                      <p-tag severity="info" value="Grille"></p-tag>
                    } @else if (editLine.priceSource === 'Catalog') {
                      <span class="text-muted" i18n="@@invoices.invoice-wizard.catalogue.5a241023">Catalogue</span>
                    }
                  } @else {
                    @if (line.priceOverridden) {
                      <p-tag severity="warning" value="Saisi"></p-tag>
                    } @else if (line.priceSource === 'ClientPrice') {
                      <p-tag severity="success" value="Prix négocié"></p-tag>
                    } @else if (line.priceSource === 'PriceList') {
                      <p-tag severity="info" value="Grille"></p-tag>
                    } @else if (line.priceSource) {
                      <span class="text-muted" i18n="@@invoices.invoice-wizard.catalogue.5a241023">Catalogue</span>
                    }
                  }
                </td>

                <!-- Discount -->
                @if (!simpleMode()) {
                <td class="col-discount">
                  @if (editingLineId === line.id) {
                    <div class="discount-input">
                      <p-inputNumber
                        [(ngModel)]="editLine.discountValue"
                        [min]="0"
                        [maxFractionDigits]="2"
                        mode="decimal"
                        [style]="{ width: '60px' }">
                      </p-inputNumber>
                      <p-select
                        [(ngModel)]="editLine.discountType"
                        [options]="discountTypeOptions"
                        optionLabel="label"
                        optionValue="value"
                        appendTo="body"
                        styleClass="discount-type-dropdown"
                        [style]="{ width: '56px' }"
                        [panelStyle]="{ minWidth: '72px' }">
                      </p-select>
                    </div>
                  } @else {
                    @if (line.discountAmount > 0) {
                      <span class="discount-badge">
                        -{{ line.discountValue }}{{ line.discountType === 'PERCENT' ? '%' : loc_ui_tern_tnd_9aaf5c }}
                      </span>
                    } @else {
                      <span class="text-muted">-</span>
                    }
                  }
                </td>
                }

                <!-- VAT Rate -->
                @if (!simpleMode()) {
                <td class="col-vat">
                  @if (editingLineId === line.id) {
                    <p-select
                      [(ngModel)]="editLine.vatRate"
                      [options]="vatRateOptions"
                      optionLabel="label"
                      optionValue="value"
                      appendTo="body"
                      styleClass="vat-rate-dropdown"
                      [style]="{ width: '80px' }"
                      [panelStyle]="{ minWidth: '12rem' }">
                    </p-select>
                  } @else {
                    <span class="vat-badge" [class]="'vat-' + line.vatRate">
                      {{ line.vatRate }}%
                    </span>
                    @if (line.isFodecApplicable) {
                      <span class="fodec-badge" pTooltip="FODEC applicable (1%)" i18n-pTooltip="@@invoices.invoice-wizard.fodec.applicable.1.01c61523" i18n="@@invoices.invoice-wizard.fodec.9a029080">FODEC</span>
                    }
                  }
                </td>
                }

                @if (!simpleMode()) {
                <!-- Total HT -->
                <td class="text-right">
                  <span class="amount">{{ line.totalHT | number:'1.3-3' }}</span>
                </td>

                <!-- VAT Amount -->
                <td class="text-right">
                  <span class="amount vat">{{ line.vatAmount | number:'1.3-3' }}</span>
                </td>
                }

                <!-- Total TTC -->
                <td class="text-right">
                  <span class="amount ttc">{{ line.totalTTC | number:'1.3-3' }}</span>
                </td>

                <!-- Actions -->
                <td>
                  <div class="line-actions">
                    @if (editingLineId === line.id) {
                      <p-button
                        icon="pi pi-check"
                        [text]="true"
                        [rounded]="true"
                        severity="success"
                        pTooltip="Valider" i18n-pTooltip="@@invoices.invoice-wizard.valider.be4220f7"
                        (click)="saveLineEdit()">
                      </p-button>
                      <p-button
                        icon="pi pi-times"
                        [text]="true"
                        [rounded]="true"
                        severity="secondary"
                        pTooltip="Annuler" i18n-pTooltip="@@invoices.invoice-wizard.annuler.49ba3292"
                        (click)="cancelLineEdit()">
                      </p-button>
                    } @else {
                      <p-button
                        icon="pi pi-pencil"
                        [text]="true"
                        [rounded]="true"
                        pTooltip="Modifier" i18n-pTooltip="@@invoices.invoice-wizard.modifier.f260e757"
                        (click)="startEditLine(line)">
                      </p-button>
                      <p-button
                        icon="pi pi-trash"
                        [text]="true"
                        [rounded]="true"
                        severity="danger"
                        pTooltip="Supprimer" i18n-pTooltip="@@invoices.invoice-wizard.supprimer.1acfc1c7"
                        (click)="deleteLine(line)">
                      </p-button>
                    }
                  </div>
                </td>
              </tr>
            </ng-template>

            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="12">
                  <div class="empty-lines">
                    <i class="pi pi-inbox"></i>
                    <p i18n="@@invoices.invoice-wizard.aucune.ligne.de.facturation.02e2114a">Aucune ligne de facturation</p>
                    <p-button
                      label="Ajouter votre première ligne" i18n-label="@@invoices.invoice-wizard.ajouter.votre.premiere.ligne.f4087e0c"
                      icon="pi pi-plus"
                      (click)="addNewLine()">
                    </p-button>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      } @else {
        <div class="empty-state-card">
          <i class="pi pi-inbox"></i>
          <h3 i18n="@@invoices.invoice-wizard.aucune.ligne.de.facturation.02e2114a">Aucune ligne de facturation</h3>
          <p i18n="@@invoices.invoice-wizard.ajoutez.des.produits.ou.services.pour.continuer.cf42cd33">Ajoutez des produits ou services pour continuer</p>
          <p-button
            label="Ajouter une ligne" i18n-label="@@invoices.invoice-wizard.ajouter.une.ligne.ba241fd4"
            icon="pi pi-plus"
            (click)="addNewLine()">
          </p-button>
        </div>
      }

      <!-- Totals Summary -->
      @if (lines().length > 0) {
        <p-divider></p-divider>

        <div class="totals-section">
          <div class="totals-grid">
            <!-- VAT Breakdown -->
            <div class="vat-breakdown-card">
              <h3 i18n="@@invoices.invoice-wizard.recapitulatif.tva.0918d3bc">Récapitulatif TVA</h3>
              <table class="vat-breakdown-table">
                <thead>
                  <tr>
                    <th i18n="@@invoices.invoice-wizard.taux.18bc95b8">Taux</th>
                    <th class="text-right" i18n="@@invoices.invoice-wizard.base.imposable.e1baa7e1">Base imposable</th>
                    <th class="text-right" i18n="@@invoices.invoice-wizard.tva.fb62cb5d">TVA</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of totals().vatBreakdown; track item.rate) {
                    <tr>
                      <td>
                        <span class="vat-badge" [class]="'vat-' + item.rate">
                          {{ item.rateDisplay | backendLabel }}
                        </span>
                      </td>
                      <td class="text-right amount">{{ item.baseAmount | number:'1.3-3' }}</td>
                      <td class="text-right amount">{{ item.vatAmount | number:'1.3-3' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Grand Total -->
            <div class="grand-total-card">
              <div class="total-row">
                <span class="total-label" i18n="@@invoices.invoice-wizard.sous.total.ht.724598f6">Sous-total HT</span>
                <span class="total-value">{{ totals().subTotalHT | number:'1.3-3' }} {{ currency }}</span>
              </div>
              @if (totals().totalDiscount > 0) {
                <div class="total-row discount">
                  <span class="total-label" i18n="@@invoices.invoice-wizard.remises.e0700e8c">Remises</span>
                  <span class="total-value">-{{ totals().totalDiscount | number:'1.3-3' }} {{ currency }}</span>
                </div>
              }
              <div class="total-row">
                <span class="total-label" i18n="@@invoices.invoice-wizard.total.ht.2ca17ae6">Total HT</span>
                <span class="total-value">{{ totals().totalHT | number:'1.3-3' }} {{ currency }}</span>
              </div>
              <div class="total-row">
                <span class="total-label" i18n="@@invoices.invoice-wizard.total.tva.605c4b2e">Total TVA</span>
                <span class="total-value">{{ totals().totalVat | number:'1.3-3' }} {{ currency }}</span>
              </div>
              @if (totals().totalFodec > 0.0005 || totals().totalFodec < -0.0005) {
                <div class="total-row">
                  <span class="total-label">FODEC ({{ totals().fodecRatePercent }}%)</span>
                  <span class="total-value">{{ totals().totalFodec | number:'1.3-3' }} {{ currency }}</span>
                </div>
              }
              @if (totals().fiscalStampAmount > 0.0005 || totals().fiscalStampAmount < -0.0005) {
                <div class="total-row">
                  <span class="total-label" i18n="@@invoices.invoice-wizard.timbre.fiscal.1f8f7dd1">Timbre fiscal</span>
                  <span class="total-value">{{ totals().fiscalStampAmount | number:'1.3-3' }} {{ currency }}</span>
                </div>
              }
              <p-divider></p-divider>
              <div class="total-row grand">
                <span class="total-label" i18n="@@invoices.invoice-wizard.total.ttc.9e80ff7c">Total TTC</span>
                <span class="total-value">{{ totals().totalTTC | number:'1.3-3' }} {{ currency }}</span>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Compliance Info -->
      <div class="compliance-info">
        <i class="pi pi-info-circle"></i>
        <span i18n="@@invoices.invoice-wizard.taux.de.tva.conformes.a.la.legislation.tunisienn.54fefbf1"> Taux de TVA conformes à la législation tunisienne : 0% (exonéré), 7% (réduit), 13% (intermédiaire), 19% (normal) </span>
      </div>

      <app-quick-create-product-dialog
        [panelMode]="true"
        [(visible)]="quickCreateProductVisible"
        (productCreated)="onQuickProductCreated($event)">
      </app-quick-create-product-dialog>

      <app-variant-product-picker
        [(visible)]="variantPickerVisible"
        (selected)="onVariantPicked($event)">
      </app-variant-product-picker>
    </div>

  `,
  styles: [`
    .step-lines {
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .section {
      margin-bottom: var(--spacing-4);
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--spacing-4);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }

    .mode-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-neutral-100);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-lg);
      cursor: pointer;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-600);
      transition: all var(--transition-fast);
      font-family: inherit;
    }

    .mode-toggle:hover {
      background: var(--color-neutral-200);
      color: var(--color-neutral-800);
    }

    .mode-toggle.active {
      background: var(--color-primary-50);
      border-color: var(--color-primary-300);
      color: var(--color-primary-700);
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-2);
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);

      i { color: var(--color-primary-500); }
    }

    .section-description {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }

    // Unmatched lines banner
    .unmatched-banner {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
      background: var(--color-warning-50);
      border: 1px solid var(--color-warning-300);
      border-radius: var(--radius-lg);
      color: var(--color-warning-900);

      i.pi-exclamation-triangle {
        font-size: var(--font-size-xl);
        color: var(--color-warning-600);
        flex-shrink: 0;
      }
    }

    .unmatched-content {
      flex: 1;
    }

    .unmatched-content strong {
      display: block;
      margin-bottom: var(--spacing-1);
      font-weight: var(--font-weight-semibold);
    }

    .unmatched-content p {
      margin: 0;
      font-size: var(--font-size-sm);
    }

    .designation-main-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      flex-wrap: wrap;
    }

    .unmatched-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      padding: 2px var(--spacing-2);
      background: var(--color-warning-100);
      color: var(--color-warning-700);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      border-radius: var(--radius-sm);

      i {
        font-size: var(--font-size-xs);
      }
    }

    // Lines Table
    .lines-table-container {
      background: white;
      border-radius: var(--radius-xl);
      border: 1px solid var(--color-neutral-200);
      overflow-x: hidden;
      overflow-y: visible;
    }

    ::ng-deep .lines-table {
      .p-datatable-scrollable-table {
        width: 100%;
        table-layout: fixed;
      }

      .p-datatable-thead > tr > th {
        background: var(--color-neutral-50);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        color: var(--color-neutral-600);
        padding: var(--spacing-3) var(--spacing-4);
      }

      th.col-vat-rate,
      .p-datatable-tbody > tr > td.col-vat {
        min-width: 80px;
      }

      .p-datatable-tbody > tr > td {
        padding: var(--spacing-3) var(--spacing-4);
        vertical-align: middle;
      }

      .p-datatable-tbody > tr.editing {
        background: var(--color-primary-50);
      }

      .p-datatable-tbody > tr > td input,
      .p-datatable-tbody > tr > td .p-inputnumber,
      .p-datatable-tbody > tr > td .p-select,
      .p-datatable-tbody > tr > td .p-autocomplete {
        max-width: 100%;
      }

      .p-datatable-tbody > tr > td .p-select {
        min-width: 90px;
      }

      /* Exception: dropdown type remise (%/TND) plus compact */
      .col-discount .p-select.discount-type-dropdown {
        min-width: unset;
      }

      /* Dropdown TVA (taux) : largeur adaptée pour afficher le % */
      .col-vat .p-select.vat-rate-dropdown {
        width: 80px;
        min-width: 80px;
      }

      .col-vat .p-select.vat-rate-dropdown .p-select-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .p-select .p-select-label {
        min-width: 2.5rem;
      }
    }

    /* Espacement entre colonne Remise et colonne TVA (taux) */
    ::ng-deep .lines-table .col-discount {
      padding-right: 2.25rem;
    }

    ::ng-deep .lines-table .p-datatable-tbody > tr > td.col-vat {
      padding-left: 0.75rem;
    }

    .line-number {
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-500);
      text-align: center;
    }

    .designation-cell {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .designation-main {
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-800);
    }

    .designation-desc {
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
    }

    .edit-cell {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .description-input {
      font-size: var(--font-size-sm);
      resize: none;
    }

    .amount {
      font-family: 'JetBrains Mono', monospace;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);

      &.vat {
        color: var(--color-neutral-600);
      }

      &.ttc {
        color: var(--color-primary-700);
        font-weight: var(--font-weight-semibold);
      }
    }

    .discount-input {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--spacing-1);
    }

    .discount-badge {
      display: inline-block;
      padding: var(--spacing-1) var(--spacing-2);
      background: var(--color-error-50);
      color: var(--color-error-600);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      border-radius: var(--radius-sm);
    }

    .vat-badge {
      display: inline-block;
      padding: var(--spacing-1) var(--spacing-2);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      border-radius: var(--radius-sm);

      &.vat-0 {
        background: var(--color-neutral-100);
        color: var(--color-neutral-600);
      }

      &.vat-7 {
        background: var(--color-success-100);
        color: var(--color-success-700);
      }

      &.vat-13 {
        background: var(--color-warning-100);
        color: var(--color-warning-700);
      }

      &.vat-19 {
        background: var(--color-primary-100);
        color: var(--color-primary-700);
      }
    }

    .line-actions {
      display: flex;
      gap: var(--spacing-1);
    }

    // Product Suggestion
    .fodec-badge {
      display: inline-flex;
      align-items: center;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-warning-800);
      background: var(--color-warning-100);
      padding: 0 var(--spacing-1);
      border-radius: var(--radius-sm);
      margin-left: var(--spacing-1);
      vertical-align: middle;
    }

    .fodec-badge--suggestion {
      margin-left: 0;
      flex-shrink: 0;
    }

    .product-suggestion {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-2);
    }

    .product-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
      background: var(--color-neutral-100);
      padding: var(--spacing-1);
      border-radius: var(--radius-sm);
    }

    .product-name {
      flex: 1;
      font-weight: var(--font-weight-medium);
    }

    .product-price {
      font-family: 'JetBrains Mono', monospace;
      font-size: var(--font-size-sm);
      color: var(--color-primary-600);
    }

    .product-empty {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3);
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      text-align: center;
      justify-content: center;

      i {
        color: var(--color-primary-500);
      }
    }

    .product-empty-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
    }

    .edit-cell-product-row {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: var(--spacing-2);
    }

    .edit-cell .product-cell-input {
      flex: 1;
      min-width: 0;
    }

    :host ::ng-deep .edit-cell .product-cell-input .p-autocomplete {
      width: 100%;
    }

    .btn-add-product-circle {
      border-radius: var(--radius-full);
      width: 36px;
      height: 36px;
      padding: 0;
      flex-shrink: 0;
    }

    .btn-add-product-circle--dropdown {
      width: 32px;
      height: 32px;
    }

    // Empty States
    .empty-lines {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-8);
      text-align: center;

      i {
        font-size: 3rem;
        color: var(--color-neutral-300);
      }

      p {
        margin: 0;
        color: var(--color-neutral-500);
      }
    }

    .empty-state-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-10);
      background: var(--color-neutral-50);
      border: 2px dashed var(--color-neutral-300);
      border-radius: var(--radius-xl);
      text-align: center;

      i {
        font-size: 4rem;
        color: var(--color-neutral-300);
      }

      h3 {
        margin: 0;
        color: var(--color-neutral-700);
      }

      p {
        margin: 0;
        color: var(--color-neutral-500);
      }
    }

    // Totals Section
    .totals-section {
      margin-top: var(--spacing-6);
    }

    .totals-grid {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: var(--spacing-6);

      @media (max-width: 900px) {
        grid-template-columns: 1fr;
      }
    }

    .vat-breakdown-card {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4);

      h3 {
        margin: 0 0 var(--spacing-4);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-700);
      }
    }

    .vat-breakdown-table {
      width: 100%;
      border-collapse: collapse;

      th {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        color: var(--color-neutral-500);
        padding: var(--spacing-2);
        text-align: left;
        border-bottom: 1px solid var(--color-neutral-200);
      }

      td {
        padding: var(--spacing-3) var(--spacing-2);
        border-bottom: 1px solid var(--color-neutral-100);
      }

      tr:last-child td {
        border-bottom: none;
      }
    }

    .grand-total-card {
      background: var(--color-primary-50);
      border: 1px solid var(--color-primary-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4);
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-2) 0;

      &.discount {
        color: var(--color-error-600);
      }

      &.grand {
        padding-top: var(--spacing-3);
        
        .total-label {
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-bold);
          color: var(--color-primary-800);
        }

        .total-value {
          font-size: var(--font-size-xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-primary-700);
        }
      }
    }

    .total-label {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .total-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
    }

    // Compliance Info
    .compliance-info {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-4);
      padding: var(--spacing-3);
      background: var(--color-neutral-100);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);

      i {
        color: var(--color-neutral-400);
      }
    }

    .text-right {
      text-align: right;
    }

    .text-muted {
      color: var(--color-neutral-400);
    }

    .price-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--spacing-2);
    }

    .price-resolving {
      color: var(--color-primary-500);
      font-size: var(--font-size-sm);
    }
  `]
})
export class StepLinesComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_mode_avance_f0a7a0 = $localize`:@@ui.tern.mode.avance.f0a7a0:Mode avancé`;
  readonly loc_ui_tern_mode_simple_c08361 = $localize`:@@ui.tern.mode.simple.c08361:Mode simple`;
  readonly loc_ui_tern_tnd_9aaf5c = $localize`:@@ui.tern.tnd.9aaf5c: TND`;
  readonly wizardService = inject(InvoiceWizardService);
  private readonly productAutocomplete = inject(ProductAutocompleteService);
  private readonly pricingService = inject(PricingService);
  readonly linePricing = inject(DocumentLinePricingService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly toastService = inject(ToastService);

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private lastClientKey: string | null = null;

  lines = computed(() => this.wizardService.lines());
  totals = computed(() => this.wizardService.totals());
  unmatchedLines = computed(() => this.lines().filter(l => !l.productId));
  currency = Currency.TND;

  constructor() {
    effect(() => {
      const client = this.wizardService.client();
      const clientKey = client?.id ?? client?.name ?? null;
      if (clientKey === this.lastClientKey) {
        return;
      }
      this.lastClientKey = clientKey;
      this.reresolveAllLines();
    });
  }

  // Options
  vatRateOptions = VAT_RATE_OPTIONS;
  discountTypeOptions = [
    { label: '%', value: 'PERCENT' },
    { label: 'TND', value: 'AMOUNT' }
  ];

  // Edit state
  editingLineId: string | null = null;
  editLine: Partial<InvoiceLine> = {};
  editSelectedProduct: WizardProductSuggestion | string | null = null;

  private readonly barcodeLookup = inject(BarcodeLookupService);
  private readonly barcodeFeedback = inject(BarcodeFeedbackService);
  readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;
  productSuggestions = signal<any[]>([]);
  quickCreateProductVisible = false;
  variantPickerVisible = false;
  isLoadingProducts = signal<boolean>(false);
  simpleMode = signal<boolean>(true);

  ngOnInit(): void {
    this.currency = this.wizardService.metadata().currency;

    // Prefetch active products so dropdown open is instant
    if (this.productAutocomplete.isV2Enabled) {
      this.productAutocomplete.prefetch().pipe(takeUntil(this.destroy$)).subscribe();
    }

    this.setupProductSearch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleSimpleMode(): void {
    this.simpleMode.update(v => !v);
  }

  private setupProductSearch(): void {
    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((query: string) => {
        const startedAt = performance.now();
        const warmEmpty =
          !query &&
          this.productAutocomplete.isV2Enabled &&
          this.productAutocomplete.hasWarmCache;

        if (!warmEmpty) {
          this.isLoadingProducts.set(true);
          if (!this.productAutocomplete.hasWarmCache || query.length >= 3) {
            this.productSuggestions.set([]);
          }
        }

        return this.productAutocomplete.search(query).pipe(
          tap(items => {
            if (!environment.production) {
              console.debug(
                `[step-lines] product search "${query}" → ${items.length} in ${(performance.now() - startedAt).toFixed(0)}ms`
              );
            }
          }),
          catchError((error) => {
            console.error('Error fetching products:', error);
            this.isLoadingProducts.set(false);
            return of([] as ProductSuggestion[]);
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (items) => {
        this.isLoadingProducts.set(false);
        this.productSuggestions.set(
          items.map(item => this.mapSuggestionForWizard(item))
        );
      },
      error: (error) => {
        console.error('Error in product search:', error);
        this.isLoadingProducts.set(false);
        this.productSuggestions.set([]);
      }
    });
  }

  private mapSuggestionForWizard(product: ProductSuggestion | ProductListItem) {
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      unitPrice: product.unitPrice,
      vatRate: this.mapVatRateToEnum(product.vatRate),
      unit: product.unit || 'Unité',
      isFodecApplicable: product.isFodecApplicable ?? false,
      isDiscountEnabled: product.isDiscountEnabled ?? false,
      maxDiscountPercent: product.maxDiscountPercent ?? null
    };
  }

  private mapProductToSuggestion(product: ProductListItem) {
    return this.mapSuggestionForWizard(product);
  }

  private resolveEditSelectedProduct(line: Partial<InvoiceLine>): WizardProductSuggestion | null {
    if (!line.productId) {
      return null;
    }

    const cached = this.productAutocomplete.getCachedActiveProducts().find(p => p.id === line.productId);
    if (cached) {
      return this.mapSuggestionForWizard(cached);
    }

    const designation = normalizeDesignation(line.designation);
    if (!designation) {
      return null;
    }

    return {
      id: line.productId,
      code: '',
      name: designation,
      unitPrice: line.unitPriceHT ?? 0,
      vatRate: line.vatRate ?? TunisianVatRate.Standard,
      unit: line.unit || 'Unité',
      isFodecApplicable: line.isFodecApplicable ?? false,
      isDiscountEnabled: line.productIsDiscountEnabled ?? false,
      maxDiscountPercent: line.productMaxDiscountPercent ?? null
    };
  }

  private mapVatRateToEnum(vatRate: number): TunisianVatRate {
    // Map numeric VAT rate to enum
    switch (vatRate) {
      case 0:
        return TunisianVatRate.Exempt;
      case 7:
        return TunisianVatRate.Reduced;
      case 13:
        return TunisianVatRate.Intermediate;
      case 19:
        return TunisianVatRate.Standard;
      default:
        return TunisianVatRate.Standard;
    }
  }

  addNewLine(): void {
    const newLine: Partial<InvoiceLine> = {
      designation: '',
      description: null,
      quantity: 1,
      unit: 'Unité',
      unitPriceHT: 0,
      discountType: null,
      discountValue: null,
      vatRate: TunisianVatRate.Standard
    };

    this.wizardService.addLine(newLine);

    // Start editing the new line
    const lines = this.lines();
    if (lines.length > 0) {
      this.startEditLine(lines[lines.length - 1]);
    }
  }

  startEditLine(line: InvoiceLine): void {
    this.editingLineId = line.id;
    this.editLine = {
      ...line,
      designation: normalizeDesignation(line.designation)
    };
    this.editSelectedProduct = this.resolveEditSelectedProduct(this.editLine);
    // If the line has no product yet (typical after AI import), seed the autocomplete
    // with the existing designation so the user lands on relevant matches immediately.
    const seed = !line.productId && this.editLine.designation ? this.editLine.designation : '';

    // Serve warm cache immediately for empty seed (dropdown open / add line)
    if (!seed && this.productAutocomplete.hasWarmCache) {
      this.productSuggestions.set(
        this.productAutocomplete.getCachedActiveProducts().map(p => this.mapSuggestionForWizard(p))
      );
      this.isLoadingProducts.set(false);
      return;
    }

    this.searchSubject$.next(seed);
  }

  saveLineEdit(): void {
    const designation = resolveDesignation(this.editLine.designation, this.editSelectedProduct);
    const selectedProduct = this.editSelectedProduct;
    const productId = this.editLine.productId
      ?? (selectedProduct && typeof selectedProduct === 'object' ? selectedProduct.id : null);

    if (this.editingLineId && designation) {
      const lineId = this.editingLineId;
      const priceOverridden = this.editLine.priceOverridden ?? false;
      const serviceLine = this.lines().find(l => l.id === lineId);
      const unitPriceHT = priceOverridden
        ? (this.editLine.unitPriceHT || 0)
        : (serviceLine?.unitPriceHT ?? (this.editLine.unitPriceHT || 0));

      this.wizardService.updateLine(lineId, {
        productId,
        designation,
        description: this.editLine.description,
        quantity: this.editLine.quantity || 1,
        unit: this.editLine.unit,
        unitPriceHT,
        priceOverridden,
        priceSource: priceOverridden ? null : (this.editLine.priceSource ?? serviceLine?.priceSource ?? null),
        discountType: this.editLine.discountType,
        discountValue: this.editLine.discountValue,
        vatRate: this.editLine.vatRate ?? TunisianVatRate.Standard,
        isFodecApplicable: productId
          ? (this.editLine.isFodecApplicable ?? false)
          : false
      });

      if (productId && !priceOverridden) {
        this.resolveLinePrice(lineId, productId, this.editLine.quantity || 1);
      }
    }
    this.cancelLineEdit();
  }

  cancelLineEdit(): void {
    const lineId = this.editingLineId;
    const line = lineId ? this.lines().find(l => l.id === lineId) : undefined;
    const isOrphanLine = line
      && !line.productId
      && !normalizeDesignation(line.designation).trim()
      && line.unitPriceHT === 0;

    this.editingLineId = null;
    this.editLine = {};
    this.editSelectedProduct = null;

    if (isOrphanLine && lineId) {
      this.wizardService.removeLine(lineId);
    }
  }

  deleteLine(line: InvoiceLine): void {
    this.confirmationService.confirm({
      message: $localize`:@@invoices.step-lines.ts.supprimer.la.ligne.designation.9a640b5f:Supprimer la ligne "${line.designation}:designation:" ?`,
      header: $localize`:@@invoices.step-lines.ts.confirmation.3424edc2:Confirmation`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@step-lines.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@step-lines.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.wizardService.removeLine(line.id);
      }
    });
  }

  searchProducts(event: any): void {
    const query = event.query?.trim() || '';

    // Instant warm-cache path for empty dropdown open (skip debounce)
    if (!query && this.productAutocomplete.hasWarmCache) {
      this.productSuggestions.set(
        this.productAutocomplete.getCachedActiveProducts().map(p => this.mapSuggestionForWizard(p))
      );
      this.isLoadingProducts.set(false);
      return;
    }

    this.searchSubject$.next(query);
  }

  onProductSelect(event: { originalEvent?: Event; value: any }): void {
    // PrimeNG AutoComplete onSelect émet { originalEvent, value }; le produit est dans value
    const product = event?.value;
    if (!product || !this.editingLineId) return;
    this.applyProductToEditingLine(product);
  }

  onVariantPicked(product: ProductSuggestion): void {
    if (!this.editingLineId) return;
    this.applyProductToEditingLine(product);
  }

  private applyProductToEditingLine(product: ProductSuggestion | WizardProductSuggestion): void {
    const lineId = this.editingLineId;
    if (!lineId) return;

    const mappedProduct = this.mapSuggestionForWizard(product);
    this.editSelectedProduct = mappedProduct;

    this.wizardService.updateLine(lineId, {
      productId: product.id,
      designation: product.name,
      unitPriceHT: product.unitPrice,
      priceOverridden: false,
      priceSource: 'Catalog' as PriceSource,
      vatRate: product.vatRate,
      isFodecApplicable: product.isFodecApplicable ?? false,
      productIsDiscountEnabled: product.isDiscountEnabled ?? false,
      productMaxDiscountPercent: product.maxDiscountPercent ?? null,
      unit: product.unit || 'Unité',
      quantity: this.editLine.quantity || 1,
      description: this.editLine.description,
      discountType: this.editLine.discountType,
      discountValue: this.editLine.discountValue
    });

    const updatedLine = this.lines().find(l => l.id === lineId);
    if (updatedLine) {
      this.editLine = {
        ...updatedLine,
        designation: normalizeDesignation(updatedLine.designation)
      };
    }

    this.resolveLinePrice(lineId, product.id, this.editLine.quantity || 1, true);
  }

  openQuickCreateProduct(): void {
    this.quickCreateProductVisible = true;
  }

  resolveNextUnmatched(): void {
    const next = this.unmatchedLines()[0];
    if (next) {
      this.startEditLine(next);
    }
  }

  onQuickProductCreated(product: ProductListItem): void {
    if (!this.editingLineId) return;

    const vatRateEnum = this.mapVatRateToEnum(product.vatRate);
    this.wizardService.updateLine(this.editingLineId, {
      productId: product.id,
      designation: product.name,
      unitPriceHT: product.unitPrice,
      priceOverridden: false,
      priceSource: 'Catalog' as PriceSource,
      vatRate: vatRateEnum,
      isFodecApplicable: product.isFodecApplicable ?? false,
      productIsDiscountEnabled: product.isDiscountEnabled ?? false,
      productMaxDiscountPercent: product.maxDiscountPercent ?? null,
      unit: product.unit || 'Unité',
      quantity: this.editLine.quantity || 1,
      description: this.editLine.description ?? product.description ?? null,
      discountType: this.editLine.discountType,
      discountValue: this.editLine.discountValue
    });

    this.resolveLinePrice(this.editingLineId, product.id, this.editLine.quantity || 1, true);

    const updatedLine = this.lines().find(l => l.id === this.editingLineId);
    if (updatedLine) {
      this.editLine = {
        ...updatedLine,
        designation: normalizeDesignation(updatedLine.designation)
      };
      this.editSelectedProduct = this.mapProductToSuggestion(product);
    }

    const mappedProduct = this.mapProductToSuggestion(product);
    this.productSuggestions.set([mappedProduct, ...this.productSuggestions()]);
    this.productAutocomplete.upsertSuggestion({
      id: product.id,
      code: product.code,
      name: product.name,
      unitPrice: product.unitPrice,
      vatRate: product.vatRate,
      unit: product.unit || 'Unité',
      isFodecApplicable: product.isFodecApplicable ?? false,
      isDiscountEnabled: product.isDiscountEnabled ?? false,
      maxDiscountPercent: product.maxDiscountPercent ?? null
    });
    this.quickCreateProductVisible = false;
    this.toastService.add({
      severity: 'success',
      summary: $localize`:@@step-lines.component.summary.Produit créé:Produit créé`,
      detail: $localize`:@@step-lines.component.detail.Le_produit_a_t_:Le produit a été créé et ajouté à la ligne.`,
    });
  }

  onUnitPriceManualEdit(): void {
    this.editLine.priceOverridden = true;
    this.editLine.priceSource = null;
  }

  onQuantityEdit(): void {
    if (this.editLine.priceOverridden || !this.editingLineId || !this.editLine.productId) {
      return;
    }
    this.resolveLinePrice(
      this.editingLineId,
      this.editLine.productId,
      this.editLine.quantity || 1,
      true
    );
  }

  private reresolveAllLines(): void {
    const eligible = this.lines().filter(l => l.productId && !l.priceOverridden);
    if (eligible.length === 0) {
      return;
    }

    const client = this.wizardService.client();
    const clientId = client?.id ?? null;
    const issueDate = this.wizardService.metadata().issueDate;
    const dateStr = this.linePricing.formatDocumentDate(issueDate);

    this.pricingService
      .resolveBatch(
        eligible.map(l => ({ productId: l.productId!, quantity: l.quantity })),
        clientId,
        dateStr
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          if (!res.success || !res.data) {
            return;
          }
          const remaining = [...res.data];
          for (const line of eligible) {
            const idx = remaining.findIndex(r => r.productId === line.productId);
            if (idx < 0) {
              continue;
            }
            const resolved = remaining.splice(idx, 1)[0];
            const current = this.lines().find(l => l.id === line.id);
            if (!current || current.priceOverridden) {
              continue;
            }
            this.wizardService.updateLine(line.id, {
              unitPriceHT: resolved.unitPriceHT,
              priceSource: resolved.source,
              ...mapResolvedPricePromotion(resolved)
            });
            if (this.editingLineId === line.id) {
              this.editLine = {
                ...this.editLine,
                unitPriceHT: resolved.unitPriceHT,
                priceSource: resolved.source,
                priceOverridden: false,
                ...mapResolvedPricePromotion(resolved)
              };
            }
          }
        },
        error: err => this.errorHandler.logError('Batch price resolution failed', err)
      });
  }

  private resolveLinePrice(
    lineId: string,
    productId: string,
    quantity: number,
    syncEditLine = false
  ): void {
    const client = this.wizardService.client();
    const clientId = client?.id ?? null;
    const issueDate = this.wizardService.metadata().issueDate;

    this.linePricing
      .resolveLinePrice({
        productId,
        clientId,
        quantity,
        documentDate: issueDate,
        priceOverridden: false,
        isOverrideCheck: () => {
          const line = this.lines().find(l => l.id === lineId);
          return line?.priceOverridden === true
            || (this.editingLineId === lineId && this.editLine.priceOverridden === true);
        }
      })
      .subscribe({
        next: resolved => {
          if (!resolved) {
            return;
          }

          const currentLine = this.lines().find(l => l.id === lineId);
          if (!currentLine || currentLine.priceOverridden) {
            return;
          }

          this.wizardService.updateLine(lineId, {
            unitPriceHT: resolved.unitPriceHT,
            priceSource: resolved.source,
            ...mapResolvedPricePromotion(resolved)
          });

          if (syncEditLine && this.editingLineId === lineId) {
            this.editLine = {
              ...this.editLine,
              unitPriceHT: resolved.unitPriceHT,
              priceSource: resolved.source,
              priceOverridden: false,
              ...mapResolvedPricePromotion(resolved)
            };
          }
        },
        error: err => this.errorHandler.logError('Price resolution failed', err)
      });
  }

  /**
   * Scan d'un code-barres dans le wizard de facture.
   *
   * Le wizard n'a pas de ligne modifiable « en place » : il faut ouvrir l'édition d'une ligne
   * avant d'y poser un article. On réutilise donc la ligne vierge en attente s'il y en a une,
   * plutôt que d'en empiler une nouvelle à chaque scan.
   *
   * Aucun contrôle de disponibilité n'est ajouté ici : le scan doit se comporter exactement
   * comme le choix manuel du même article dans l'autocomplétion, ni plus strict ni plus
   * permissif. (L'article résolu ne porte de toute façon pas de quantité disponible.)
   */
  onBarcodeScanned(code: string): void {
    this.barcodeLookup.resolve(code).subscribe(result => {
      if (result.status !== 'found' || !result.product) {
        this.barcodeFeedback.report(result);
        return;
      }

      const product = result.product;
      const existing = this.lines().find(l => l.productId === product.id);

      if (existing) {
        const quantity = (existing.quantity || 0) + 1;
        this.wizardService.updateLine(existing.id, { quantity });
        this.resolveLinePrice(existing.id, product.id, quantity, existing.id === this.editingLineId);
      } else {
        const blank = this.lines().find(
          l => !l.productId && !normalizeDesignation(l.designation)
        );
        if (blank) {
          this.startEditLine(blank);
        } else {
          this.addNewLine();
        }
        this.applyProductToEditingLine(this.toBarcodeSuggestion(product));
      }

      this.barcodeFeedback.success(product.name);
    });
  }

  private toBarcodeSuggestion(product: ProductListItem): ProductSuggestion {
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      unitPrice: product.unitPrice,
      vatRate: product.vatRate,
      unit: product.unit || 'Unité',
      isFodecApplicable: product.isFodecApplicable ?? false,
      isDiscountEnabled: product.isDiscountEnabled ?? false,
      maxDiscountPercent: product.maxDiscountPercent ?? null,
      barcode: product.barcode ?? null
    };
  }
}
