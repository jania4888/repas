/// <reference types="@angular/localize" />
import { API_ERROR_CODE } from '@core/utils/api-error-code';
import { Component, OnInit, inject, signal, computed, ViewChild } from '@angular/core';
import { environment } from '@environments/environment';
import { PrintLabelsDialogComponent, LabelPrintTarget } from '../components/print-labels-dialog/print-labels-dialog.component';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { FileUploadModule } from 'primeng/fileupload';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorMessageService } from '@core/services/error-message.service';
import { ProductService, CreateProductRequest, UpdateProductRequest, ProductAttributeDto } from '@core/services/product.service';
import { VARIANT_AXES_PATH } from '@features/settings/variant-axes/variant-axes.paths';
import { ProductCategoryService } from '@core/services/product-category.service';
import { SupplierService } from '@core/services/supplier.service';
import { StockService, StockFeatures } from '@core/services/stock.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PRODUCT_CATEGORY_OPTIONS, PRODUCT_UNIT_OPTIONS, PRODUCT_VAT_OPTIONS } from '@shared/constants/coded-option-labels';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AppModule } from '@core/models/app-module';
import {
  calculateFodecAmount,
  calculateSaleTtc,
  calculateVatAmount,
  PricingEditSource,
  recalculatePricing,
  resolvePurchaseTtc
} from '@shared/utils/product-pricing.utils';
import { ProductClientPricesComponent } from '../product-client-prices/product-client-prices.component';
import { ProductVariantMatrixComponent } from '@shared/components/product-variant-matrix/product-variant-matrix.component';
import {
  getCostingMethodHint,
  getCostingMethodOptions,
  getPickingPolicyHint,
  getPickingPolicyOptions,
  getTrackingModeHint,
  getTrackingModeOptions,
  isTraceabilityEditable,
  isTraceabilitySectionVisible,
  normalizeTraceabilityForm,
  showCostingMethodDropdown,
  showExpiryFields,
  showPickingField,
  TraceabilityFormState
} from '@shared/utils/product-traceability-rules';
import { coerceCostingMethod } from '@shared/utils/stock-traceability.utils';

interface CategoryOption {
  label: string;
  value: string;
}

interface UnitOption {
  label: string;
  value: string;
}

interface VatOption {
  label: string;
  value: number;
}

/** Nom (en base) de la catégorie proposée par défaut à la création d'un produit. */
const DEFAULT_PRODUCT_CATEGORY_NAME = 'General';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [
    PrintLabelsDialogComponent,
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule,
    InputTextModule,
    Textarea,
    InputNumberModule,
    SelectModule,
    ButtonModule,
    CardModule,
    ToggleSwitchModule,
    CheckboxModule,
    FileUploadModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    FormSectionComponent,
    ButtonComponent,
    ProductClientPricesComponent,
    ProductVariantMatrixComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    
    <app-page-header 
      [title]="isEditMode() ? loc_ui_tern_modifier_le_produit_aeaa8f : loc_ui_tern_nouveau_produit_c31ca3" 
      [subtitle]="isEditMode() ? loc_ui_tern_modifiez_les_informations_du_produit_41bd18 : loc_ui_tern_ajoutez_un_nouveau_produit_a_votre_catalog_d9126c">
      <app-button 
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/products" i18n="@@products.product-form.annuler.49ba3292"> Annuler </app-button>
    </app-page-header>

    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div class="form-grid" [class.form-grid--with-side]="hasSideSections()">
        <!-- General Information -->
        <app-form-section class="section-identity" title="Informations générales" i18n-title="@@products.product-form.informations.generales.be6ba6e5" icon="pi-box" [number]="1">
          <div class="form-row form-row-3">
            <div class="form-group">
              <label for="code"><ng-container i18n="@@products.product-form.code.produit.60220afb">Code produit </ng-container> <span class="required" i18n="@@products.product-form.text.df58248c">*</span></label>
              <input 
                pInputText 
                id="code" 
                formControlName="code"
                placeholder="Ex: PROD-001" i18n-placeholder="@@products.product-form.ex.prod.001.654beeed"
                class="w-full"
                [class.ng-invalid]="isInvalid('code')">
              @if (isInvalid('code')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('code')) }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="category"><ng-container i18n="@@products.product-form.type.3deb7456">Type </ng-container> <span class="required" i18n="@@products.product-form.text.df58248c">*</span></label>
              <p-select 
                id="category"
                [options]="categoryOptions" 
                formControlName="category"
                placeholder="Sélectionner" i18n-placeholder="@@products.product-form.selectionner.ab31a36f"
                styleClass="w-full">
              </p-select>
              @if (isInvalid('category')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('category')) }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="productCategoryId" i18n="@@products.product-form.categorie.6b38300a">Catégorie</label>
              <p-select 
                id="productCategoryId"
                [options]="productCategoryOptions()"
                formControlName="productCategoryId"
                placeholder="Sélectionner une catégorie" i18n-placeholder="@@products.product-form.selectionner.une.categorie.6b9668aa"
                optionLabel="label"
                optionValue="value"
                styleClass="w-full">
              </p-select>
              <small class="form-hint" i18n="@@products.product-form.classification.du.produit.par.defaut.general.3db72c29">Classification du produit. Par défaut: General</small>
            </div>
          </div>

          <div class="form-group">
            <label for="barcode" i18n="@@products.product-form.code.barres.a5ce859a">Code-barres</label>
            <div class="barcode-input-row">
              <span class="p-input-icon-left barcode-input-row__field">
                <i class="pi pi-barcode" aria-hidden="true"></i>
                <input
                  pInputText
                  id="barcode"
                  formControlName="barcode"
                  placeholder="Scannez ou saisissez le code-barres" i18n-placeholder="@@products.product-form.scannez.ou.saisissez.le.code.barres.507da1a3"
                  class="w-full"
                  autocomplete="off"
                  spellcheck="false">
              </span>
              <app-button
                variant="outline"
                icon="pi-sync"
                iconPos="left"
                size="sm"
                [disabled]="generatingBarcode()"
                (clicked)="generateBarcode()" i18n="@@products.product-form.generer.un.code.interne.922844a9"> Générer un code interne </app-button>
              @if (labelPrintingEnabled && isEditMode()) {
                <app-button
                  variant="outline"
                  icon="pi-print"
                  iconPos="left"
                  size="sm"
                  (clicked)="openLabelDialog()" i18n="@@products.product-form.etiquettes.e26c690c"> Étiquettes </app-button>
              }
            </div>
            @if (barcodeSymbologyLabel()) {
              <small class="form-hint">
                <i class="pi pi-check-circle" aria-hidden="true"></i>
                {{ barcodeSymbologyLabel() }}
              </small>
            } @else {
              <small class="form-hint" i18n="@@products.product-form.distinct.du.code.produit.laissez.vide.si.l.artic.983b9086"> Distinct du code produit. Laissez vide si l'article n'en a pas. </small>
            }
          </div>

          <div class="form-group">
            <label for="name"><ng-container i18n="@@products.product-form.designation.63a9062c">Désignation </ng-container> <span class="required" i18n="@@products.product-form.text.df58248c">*</span></label>
            <input 
              pInputText 
              id="name" 
              formControlName="name"
              placeholder="Nom du produit ou service" i18n-placeholder="@@products.product-form.nom.du.produit.ou.service.d82d71d4"
              class="w-full"
              [class.ng-invalid]="isInvalid('name')">
            @if (isInvalid('name')) {
              <div class="form-error">
                <i class="pi pi-exclamation-circle"></i>
                <span>{{ errorMessageService.getErrorMessage(form.get('name')) }}</span>
              </div>
            }
          </div>

          <div class="form-group">
            <label for="description" i18n="@@products.product-form.description.55f8ebc8">Description</label>
            <textarea 
              pTextarea 
              id="description" 
              formControlName="description"
              placeholder="Description détaillée du produit ou service..." i18n-placeholder="@@products.product-form.description.detaillee.du.produit.ou.service.8c65fcfc"
              [rows]="4"
              class="w-full">
            </textarea>
          </div>

          @if (showStockManagementSection()) {
            <div class="form-row">
              <div class="form-group">
                <label for="isStockManaged" i18n="@@products.product-form.gestion.de.stock.3f196b66">Gestion de stock</label>
                <div class="status-switch">
                  <p-toggleswitch 
                    id="isStockManaged"
                    formControlName="isStockManaged"
                    [disabled]="!isProductCategory()">
                  </p-toggleswitch>
                  <span [class.active]="form.get('isStockManaged')?.value">
                    {{ form.get('isStockManaged')?.value ? loc_ui_tern_activee_9b4e7c : loc_ui_tern_desactivee_74cc3b }}
                  </span>
                </div>
                @if (!isProductCategory()) {
                  <small class="form-hint" i18n="@@products.product-form.disponible.uniquement.pour.les.produits.physique.36d9ce42">Disponible uniquement pour les produits physiques.</small>
                }
              </div>

              @if (isProductCategory()) {
                <div class="form-group">
                  <label for="preferredSupplierId" i18n="@@products.product-form.fournisseur.prefere.7d570b74">Fournisseur préféré</label>
                  <p-select
                    id="preferredSupplierId"
                    [options]="supplierOptions()"
                    formControlName="preferredSupplierId"
                    placeholder="Aucun (à choisir lors de la commande)" i18n-placeholder="@@products.product-form.aucun.a.choisir.lors.de.la.commande.8c0a1570"
                    optionLabel="label"
                    optionValue="value"
                    [filter]="true"
                    [showClear]="true"
                    styleClass="w-full">
                  </p-select>
                  <small class="form-hint" i18n="@@products.product-form.utilise.par.previsions.ia.reapprovisionnement.le.fa88557b"> Utilisé par Prévisions IA — Réapprovisionnement : les recommandations de ce produit
                    seront pré-rattachées à ce fournisseur, ce qui permet de créer les bons de commande sans
                    saisie manuelle. </small>
                </div>
              }
            </div>

            @if (isProductCategory() && form.get('isStockManaged')?.value) {
              <div class="form-group">
                <label for="minimumStock" i18n="@@products.product-form.stock.minimum.8a0c24af">Stock minimum</label>
                <p-inputNumber
                  id="minimumStock"
                  formControlName="minimumStock"
                  [min]="0"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="3"
                  placeholder="Non renseigné" i18n-placeholder="@@products.product-form.non.renseigne.9ccfe1f1"
                  styleClass="w-full">
                </p-inputNumber>
                <small class="form-hint" i18n="@@products.product-form.optionnel.seuil.d.alerte.sur.l.entrepot.par.defa.1ef85276"> Optionnel — seuil d'alerte sur l'entrepôt par défaut. Utilisé par les alertes stock
                  et le réapprovisionnement (« Sous le stock min. configuré »). </small>
              </div>
            }
          }

          @if (isProductCategory() && canMutateProduct()) {
            <div class="form-group product-image-group">
              <label i18n="@@products.product-form.image.produit.8586e902">Image produit</label>
              <div class="product-image-section">
                <div class="product-image-preview" [class.has-image]="displayImageUrl()">
                  @if (displayImageUrl()) {
                    <img [src]="resolveProductImageUrl(displayImageUrl())" alt="" />
                  } @else {
                    <div class="product-image-placeholder">
                      <i class="pi pi-image"></i>
                      <span i18n="@@products.product-form.ajouter.une.image.762947a7">Ajouter une image</span>
                    </div>
                  }
                </div>
                <div class="product-image-actions">
                  <p-fileUpload
                    mode="basic"
                    accept="image/*"
                    [maxFileSize]="2000000"
                    chooseLabel="Choisir une image" i18n-chooseLabel="@@products.product-form.choisir.une.image.994ddf80"
                    (onSelect)="onProductImageSelect($event)"
                    [disabled]="saving()"
                    aria-label="Choisir une image pour le produit" i18n-aria-label="@@products.product-form.choisir.une.image.pour.le.produit.498fe514">
                  </p-fileUpload>
                  @if (displayImageUrl() || selectedImageFile()) {
                    <button
                      type="button"
                      class="product-image-remove"
                      (click)="removeProductImage()"
                      [disabled]="saving()"
                      aria-label="Supprimer l'image du produit" i18n-aria-label="@@products.product-form.supprimer.l.image.du.produit.32bd2603" i18n="@@products.product-form.supprimer.l.image.2042d17b"> Supprimer l'image </button>
                  }
                  <small class="form-hint" i18n="@@products.product-form.jpeg.png.ou.webp.max.2.mo.c876f43c">JPEG, PNG ou WebP. Max 2 Mo.</small>
                </div>
              </div>
            </div>
          }

          @if (isEditMode() && canMutateProduct()) {
            <div class="form-group">
              <label for="isActive" i18n="@@products.product-form.statut.659499f3">Statut</label>
              <div class="status-switch">
                <p-toggleswitch 
                  id="isActive"
                  formControlName="isActive">
                </p-toggleswitch>
                <span [class.active]="form.get('isActive')?.value">
                  {{ form.get('isActive')?.value ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033 }}
                </span>
              </div>
            </div>
          }
        </app-form-section>

        @if (hasSideSections()) {
          <div class="section-side">
        @if (showVariantsSection()) {
          <app-form-section id="variantes" class="section-variants" title="Variantes" i18n-title="@@products.product-form.variantes.69a7f04e" icon="pi-th-large" [number]="variantsSectionNumber()">
            <div class="form-group">
              <label for="isVariantTemplate" i18n="@@products.product-form.modele.de.variantes.25d7b4a0">Modèle de variantes</label>
              <div class="status-switch">
                <p-toggleswitch id="isVariantTemplate" formControlName="isVariantTemplate"></p-toggleswitch>
                <span [class.active]="form.get('isVariantTemplate')?.value">
                  @if (form.get('isVariantTemplate')?.value) {<ng-container i18n="@@products.product-form.oui.le.parent.n.est.pas.vendable.1a2b10db">
                    Oui — le parent n'est pas vendable
                  </ng-container>} @else {<ng-container i18n="@@products.product-form.non.a7219939">
                    Non
                  </ng-container>}
                </span>
              </div>
              <small class="form-hint" i18n="@@products.product-form.genere.des.sku.enfants.taille.couleur.le.modele..2a28a372">Génère des SKU enfants (taille, couleur…). Le modèle est exclu des factures, du POS et du stock.</small>
            </div>
            @if (isEditMode() && form.get('isVariantTemplate')?.value) {
              <div class="form-group">
                <label i18n="@@products.product-form.generer.la.matrice.2b13764a">Générer la matrice</label>
                <p class="form-hint" i18n="@@products.product-form.selectionnez.les.valeurs.pour.chaque.axe.la.comb.46270d39">Sélectionnez les valeurs pour chaque axe — la combinaison crée les SKU enfants.</p>
                @for (attr of attributes(); track attr.id) {
                  <div class="variant-axis">
                    <strong>{{ attr.name }}</strong>
                    <div class="variant-values">
                      @for (value of attr.values; track value.id) {
                        <label class="variant-value">
                          <input
                            type="checkbox"
                            [checked]="isVariantValueSelected(attr.id, value.id)"
                            (change)="toggleVariantValue(attr.id, value.id)" />
                          {{ value.name }}
                        </label>
                      }
                    </div>
                  </div>
                }
                @if (attributes().length === 0) {
                  @if (canConfigureVariantAxes()) {
                    <p class="form-hint" i18n="@@products.product-form.creer.un.axe.de.variantes.ex.taille.coul.011f4bd5">
                      <a [routerLink]="variantAxesNewLink">Créer un axe de variantes</a> (ex. Taille, Couleur) avant de générer les SKU.
                    </p>
                  } @else {
                    <p class="form-hint" i18n="@@products.product-form.aucun.axe.de.variantes.n.est.defini.un.administr.4fdc29c8"> Aucun axe de variantes n'est défini. Un administrateur peut les configurer dans Paramètres → Axes de variantes. </p>
                  }
                }
                @if (previewCombinationCount() > 0) {
                  <p class="form-hint"><ng-container i18n="@@products.product-form.apercu.combinaison.s.seront.creees.eb30c002">
                    Aperçu : {{ previewCombinationCount() }} combinaison(s) seront créées.
                    </ng-container>@if (previewCombinationCount() > 50) {
                      <strong i18n="@@products.product-form.plus.de.50.sku.confirmez.avant.de.generer.c2047ba3"> Plus de 50 SKU — confirmez avant de générer.</strong>
                    }
                  </p>
                }
                <app-button type="button" variant="secondary" icon="pi-sitemap" iconPos="left"
                            (clicked)="generateVariants()" [disabled]="generatingVariants() || !hasVariantSelection()" i18n="@@products.product-form.generer.les.sku.6ff4e512"> Générer les SKU </app-button>
              </div>
              <div class="form-group">
                <label i18n="@@products.product-form.sku.enfants.922c9ec5">SKU enfants</label>
                <app-product-variant-matrix [parentProductId]="productId()!" />
              </div>
            }
          </app-form-section>
        }

        @if (showTraceabilitySection()) {
          <app-form-section class="section-trace" title="Traçabilité et valorisation" i18n-title="@@products.product-form.tracabilite.et.valorisation.d1bd26b2" icon="pi-qrcode" [number]="traceSectionNumber()">
            @if (!traceabilityEditable()) {
              <p class="form-hint" i18n="@@products.product-form.activez.la.gestion.de.stock.pour.configurer.la.t.bd79223f">Activez la gestion de stock pour configurer la traçabilité et la valorisation.</p>
            } @else {
              <div class="form-row">
                <div class="form-group">
                  <label for="trackingMode" i18n="@@products.product-form.suivi.29293f77">Suivi</label>
                  <p-select id="trackingMode" [options]="trackingModeSelectOptions()" formControlName="trackingMode"
                            optionLabel="label" optionValue="value" optionDisabled="disabled" styleClass="w-full"></p-select>
                  <small class="form-hint">{{ trackingModeHint() }}</small>
                </div>
                @if (showPickingFieldForForm()) {
                  <div class="form-group">
                    <label for="pickingPolicy" i18n="@@products.product-form.politique.de.prelevement.f7a64bad">Politique de prélèvement</label>
                    <p-select id="pickingPolicy" [options]="pickingPolicySelectOptions()" formControlName="pickingPolicy"
                              optionLabel="label" optionValue="value" optionDisabled="disabled" styleClass="w-full"></p-select>
                    <small class="form-hint">{{ pickingPolicyHint() }}</small>
                  </div>
                }
              </div>
              @if (showExpiryFieldsForForm()) {
                <div class="form-group">
                  <label for="hasExpiryTracking" i18n="@@products.product-form.suivi.de.peremption.dluo.1e67289e">Suivi de péremption (DLUO)</label>
                  <div class="status-switch">
                    <p-toggleswitch id="hasExpiryTracking" formControlName="hasExpiryTracking"></p-toggleswitch>
                    <span [class.active]="form.get('hasExpiryTracking')?.value">
                      {{ form.get('hasExpiryTracking')?.value ? loc_ui_tern_active_42ce0b : loc_ui_tern_desactive_2d32fa }}
                    </span>
                  </div>
                  <small class="form-hint" i18n="@@products.product-form.obligatoire.pour.activer.fefo.06e5bf32">Obligatoire pour activer FEFO.</small>
                </div>
                <div class="form-group">
                  <label for="expiryAlertDays" i18n="@@products.product-form.alerte.dluo.jours.2a61933b">Alerte DLUO (jours)</label>
                  <p-inputNumber id="expiryAlertDays" formControlName="expiryAlertDays" [min]="0" [max]="3650" styleClass="w-full"></p-inputNumber>
                </div>
              }
              <div class="form-group">
                <label for="costingMethod" i18n="@@products.product-form.methode.de.valorisation.b3c5bcf0">Méthode de valorisation</label>
                @if (showCostingDropdown()) {
                  <p-select id="costingMethod" [options]="costingMethodSelectOptions()" formControlName="costingMethod"
                            optionLabel="label" optionValue="value" optionDisabled="disabled" styleClass="w-full"></p-select>
                } @else {
                  <p class="costing-readonly" i18n="@@products.product-form.cmup.df307ace">CMUP</p>
                }
                <small class="form-hint">{{ costingMethodHint() }}</small>
                @if (isEditMode() && (form.get('costingMethod')?.value === 1 || form.get('costingMethod')?.value === 2)) {
                  <app-button type="button" variant="outline" size="sm" class="mt-2"
                              (clicked)="createOpeningLayer()" [disabled]="saving()" i18n="@@products.product-form.creer.la.couche.d.ouverture.fifo.lifo.a2aaa6ce"> Créer la couche d'ouverture FIFO/LIFO </app-button>
                }
              </div>
            }
          </app-form-section>
        }
          </div>
        }

        <!-- Pricing -->
        <app-form-section class="section-pricing" title="Tarification" i18n-title="@@products.product-form.tarification.5dc310ae" icon="pi-dollar" [number]="pricingSectionNumber()">
          <div class="pricing-block">
            <h4 class="pricing-block-title" i18n="@@products.product-form.couts.d.achat.1efe6462">Coûts d'achat</h4>
            <div class="form-row form-row-purchase-ht-ttc">
              <div class="form-group">
                <label for="purchasePrice" i18n="@@products.product-form.prix.d.achat.ht.9e99d105">Prix d'achat HT</label>
                <p-inputNumber
                  id="purchasePrice"
                  formControlName="purchasePrice"
                  mode="decimal"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  suffix=" TND"
                  placeholder="Optionnel" i18n-placeholder="@@products.product-form.optionnel.879d6b16"
                  styleClass="w-full"
                  (onInput)="onPricingChange('purchasePrice')">
                </p-inputNumber>
              </div>
              <div class="form-group">
                <label for="purchasePriceTtc" i18n="@@products.product-form.prix.d.achat.ttc.a8f3c2e1">Prix d'achat TTC</label>
                <p-inputNumber
                  id="purchasePriceTtc"
                  [ngModel]="previewPurchaseTtc()"
                  [ngModelOptions]="{ standalone: true }"
                  mode="decimal"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  suffix=" TND"
                  placeholder="—" i18n-placeholder="@@products.product-form.text.1b93795b"
                  [disabled]="true"
                  styleClass="w-full readonly-field">
                </p-inputNumber>
                <small class="form-hint" i18n="@@products.product-form.calcule.a.partir.du.prix.ht.et.du.taux.de.tva.b4e91d02">Calculé à partir du prix HT et du taux de TVA.</small>
              </div>
            </div>
            <small class="form-hint purchase-ht-hint" i18n="@@products.product-form.prix.par.defaut.pour.les.bons.de.commande.et.fac.3864e612"> Prix par défaut pour les bons de commande et factures fournisseurs. </small>

            <div class="pricing-readonly-group">
              <p class="pricing-readonly-badge" i18n="@@products.product-form.calcule.automatiquement.395afd28">
                <i class="pi pi-lock" aria-hidden="true"></i>
                Calculé automatiquement
              </p>
              <div class="form-group">
                <label for="lastPurchasePrice" i18n="@@products.product-form.dernier.prix.d.achat.ht.ccb5059f">Dernier prix d'achat HT</label>
                <p-inputNumber
                  id="lastPurchasePrice"
                  [ngModel]="lastPurchasePrice()"
                  [ngModelOptions]="{ standalone: true }"
                  mode="decimal"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  suffix=" TND"
                  [disabled]="true"
                  styleClass="w-full readonly-field">
                </p-inputNumber>
                <small class="form-hint" i18n="@@products.product-form.mis.a.jour.automatiquement.a.chaque.reception.bc.752ca915">Mis à jour automatiquement à chaque réception BC.</small>
              </div>

              <div class="form-group">
                <label for="weightedAverageCost">{{ (form.get('costingMethod')?.value === 1 || form.get('costingMethod')?.value === 2) ? loc_ui_tern_cout_unitaire_affiche_ht_050c67 : loc_ui_tern_cout_unitaire_moyen_pondere_cmup_ht_665d78 }}</label>
                <p-inputNumber
                  id="weightedAverageCost"
                  [ngModel]="weightedAverageCost()"
                  [ngModelOptions]="{ standalone: true }"
                  mode="decimal"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  suffix=" TND"
                  [disabled]="true"
                  styleClass="w-full readonly-field">
                </p-inputNumber>
                <small class="form-hint" i18n="@@products.product-form.calcule.depuis.le.stock.entrepot.par.defaut.7fda61fe">Calculé depuis le stock (entrepôt par défaut).</small>
              </div>
            </div>
          </div>

          <div class="pricing-block">
            <h4 class="pricing-block-title" i18n="@@products.product-form.prix.de.vente.ccbfa99b">Prix de vente</h4>

            <h5 class="pricing-subblock-title" i18n="@@products.product-form.parametres.de.vente.ba205151">Paramètres de vente</h5>
            <div class="form-row form-row-pricing-params">
              <div class="form-group">
                <label for="unit"><ng-container i18n="@@products.product-form.unite.de.mesure.f5101bff">Unité de mesure </ng-container> <span class="required" i18n="@@products.product-form.text.df58248c">*</span></label>
                <p-select
                  id="unit"
                  [options]="unitOptions"
                  formControlName="unit"
                  placeholder="Sélectionner" i18n-placeholder="@@products.product-form.selectionner.ab31a36f"
                  [editable]="true"
                  styleClass="w-full">
                </p-select>
              </div>

              <div class="form-group">
                <label for="vatRate"><ng-container i18n="@@products.product-form.taux.de.tva.e704ceaf">Taux de TVA </ng-container> <span class="required" i18n="@@products.product-form.text.df58248c">*</span></label>
                <p-select
                  id="vatRate"
                  [options]="vatOptions"
                  formControlName="vatRate"
                  placeholder="Sélectionner" i18n-placeholder="@@products.product-form.selectionner.ab31a36f"
                  styleClass="w-full"
                  (onChange)="onPricingChange('vatRate')">
                </p-select>
              </div>

              <div class="form-group fodec-group">
                <label for="isFodecApplicable" i18n="@@products.product-form.fodec.9a029080">FODEC</label>
                <div class="fodec-checkbox">
                  <p-checkbox
                    inputId="isFodecApplicable"
                    formControlName="isFodecApplicable"
                    [binary]="true"
                    (onChange)="onPricingChange('fodec')">
                  </p-checkbox>
                  <label for="isFodecApplicable" i18n="@@products.product-form.fodec.applicable.1.01c61523">FODEC applicable (1%)</label>
                </div>
              </div>
            </div>

            <h5 class="pricing-subblock-title" i18n="@@products.product-form.montants.6b312baa">Montants</h5>
            <div class="form-row form-row-pricing-flow">
              <div class="form-group">
                <label for="profitMarginPercent" i18n="@@products.product-form.marge.beneficiaire.b7324f90">Marge bénéficiaire</label>
                <p-inputNumber
                  id="profitMarginPercent"
                  formControlName="profitMarginPercent"
                  mode="decimal"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  suffix=" %"
                  placeholder="—" i18n-placeholder="@@products.product-form.text.1b93795b"
                  styleClass="w-full"
                  (onInput)="onPricingChange('margin')">
                </p-inputNumber>
                @if (!canEditMargin()) {
                  <small class="form-hint" i18n="@@products.product-form.renseignez.un.prix.d.achat.ht.pour.activer.la.ma.7d2edf6e">Renseignez un prix d'achat HT pour activer la marge.</small>
                }
              </div>

              <span class="pricing-flow-connector" aria-hidden="true">
                <i class="pi pi-arrow-right"></i>
              </span>

              <div class="form-group">
                <label for="unitPrice"><ng-container i18n="@@products.product-form.prix.de.vente.ht.7a39da52">Prix de vente HT </ng-container> <span class="required" i18n="@@products.product-form.text.df58248c">*</span></label>
                <p-inputNumber
                  id="unitPrice"
                  formControlName="unitPrice"
                  mode="decimal"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  suffix=" TND"
                  placeholder="0.000" i18n-placeholder="@@products.product-form.0.000.725af307"
                  styleClass="w-full"
                  [class.ng-invalid]="isInvalid('unitPrice')"
                  (onInput)="onPricingChange('unitPriceHt')">
                </p-inputNumber>
                @if (isInvalid('unitPrice')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('unitPrice')) }}</span>
                  </div>
                }
              </div>

              <span class="pricing-flow-connector" aria-hidden="true">
                <i class="pi pi-arrow-right"></i>
              </span>

              <div class="form-group">
                <label for="salePriceTtc"><ng-container i18n="@@products.product-form.prix.de.vente.ttc.87e7c028">Prix de vente TTC </ng-container> <span class="required" i18n="@@products.product-form.text.df58248c">*</span></label>
                <p-inputNumber
                  id="salePriceTtc"
                  formControlName="salePriceTtc"
                  mode="decimal"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  suffix=" TND"
                  placeholder="0.000" i18n-placeholder="@@products.product-form.0.000.725af307"
                  styleClass="w-full"
                  (onInput)="onPricingChange('saleTtc')">
                </p-inputNumber>
              </div>
            </div>

            <div class="price-preview" aria-label="Récapitulatif des prix" i18n-aria-label="@@products.product-form.recapitulatif.des.prix.3d69a8b0">
              <div class="preview-row">
                <span i18n="@@products.product-form.prix.ht.362207ca">Prix HT</span>
                <span class="value">{{ (form.get('unitPrice')?.value ?? 0) | number:'1.3-3' }} TND</span>
              </div>
              @if (form.get('isFodecApplicable')?.value) {
                <div class="preview-row">
                  <span i18n="@@products.product-form.fodec.1.cdda0228">FODEC (1%)</span>
                  <span class="value">{{ previewFodec() | number:'1.3-3' }} TND</span>
                </div>
              }
              <div class="preview-row">
                <span>TVA ({{ form.get('vatRate')?.value || 0 }}%)</span>
                <span class="value">{{ previewVat() | number:'1.3-3' }} TND</span>
              </div>
              <div class="preview-row total">
                <span i18n="@@products.product-form.prix.ttc.c48d80e8">Prix TTC</span>
                <span class="value">{{ (form.get('salePriceTtc')?.value ?? 0) | number:'1.3-3' }} TND</span>
              </div>
            </div>
          </div>

          <div class="pricing-block">
            <h4 class="pricing-block-title" i18n="@@products.product-form.remise.produit.158a2250">Remise produit</h4>
            <div class="form-row">
              <div class="form-group">
                <label for="isDiscountEnabled" i18n="@@products.product-form.remise.ce12d942">Remise</label>
                <div class="fodec-checkbox">
                  <p-checkbox
                    inputId="isDiscountEnabled"
                    formControlName="isDiscountEnabled"
                    [binary]="true">
                  </p-checkbox>
                  <label for="isDiscountEnabled" i18n="@@products.product-form.activer.la.remise.5a012642">Activer la remise</label>
                </div>
              </div>
              <div class="form-group">
                <label for="maxDiscountPercent" i18n="@@products.product-form.remise.maximale.5d83e3b6">Remise maximale</label>
                <p-inputNumber
                  id="maxDiscountPercent"
                  formControlName="maxDiscountPercent"
                  mode="decimal"
                  [minFractionDigits]="1"
                  [maxFractionDigits]="1"
                  suffix=" %"
                  placeholder="0.0" i18n-placeholder="@@products.product-form.0.0.38f6d787"
                  styleClass="w-full"
                  [class.ng-invalid]="isInvalid('maxDiscountPercent')">
                </p-inputNumber>
                <small class="form-hint discount-hint" i18n="@@products.product-form.remise.globale.maximale.100.0.3676411c">(Remise globale maximale : 100,0 %)</small>
              </div>
            </div>
          </div>
        </app-form-section>
      </div>

      @if (isEditMode() && productId()) {
        <div class="form-grid-full">
          <app-form-section title="Tarifs par client" i18n-title="@@products.product-form.tarifs.par.client.e47e033b" icon="pi-users" [number]="clientPricesSectionNumber()">
            <app-product-client-prices
              [productId]="productId()!"
              [catalogUnitPriceHT]="form.get('unitPrice')?.value ?? 0">
            </app-product-client-prices>
          </app-form-section>
        </div>
      } @else if (!isEditMode()) {
        <div class="form-grid-full">
          <div class="ft-alert ft-alert--info" i18n="@@products.product-form.enregistrez.le.produit.pour.definir.des.84be94ac">
            <i class="pi pi-info-circle"></i>
            Enregistrez le produit pour définir des tarifs par client.
          </div>
        </div>
      }

      <!-- Actions -->
      <div class="form-actions">
        <app-button 
          variant="outline"
          icon="pi-times"
          iconPos="left"
          routerLink="/products" i18n="@@products.product-form.annuler.49ba3292"> Annuler </app-button>
        @if (canMutateProduct()) {
          <app-button 
            variant="primary"
            type="submit"
            [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            [disabled]="form.invalid || saving()">
            {{ isEditMode() ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_le_produit_e19a48 }}
          </app-button>
        }
      </div>
    </form>


    <ft-print-labels-dialog
      [visible]="labelDialogVisible()"
      (visibleChange)="labelDialogVisible.set($event)"
      [target]="labelTarget()"></ft-print-labels-dialog>
  `,
  styles: [`
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);
      align-items: stretch;

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .section-identity,
    .section-pricing {
      display: block;
      min-width: 0;
    }

    .section-identity {
      grid-column: 1;
    }

    .section-side {
      grid-column: 2;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      min-width: 0;
      align-self: stretch;
    }

    .section-side > *:last-child {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
    }

    .form-grid--with-side .section-pricing {
      grid-column: 1 / -1;
    }

    @media (max-width: 1024px) {
      .section-identity,
      .section-side,
      .section-pricing,
      .form-grid--with-side .section-pricing {
        grid-column: 1;
      }
    }

    :host ::ng-deep .form-grid .form-section {
      margin-bottom: 0;
    }

    :host ::ng-deep .section-side > *:last-child .form-section {
      overflow: visible;
    }

    .section-trace {
      overflow: visible;
    }

    .costing-readonly {
      margin: 0;
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-md);
      background: var(--color-neutral-50);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .form-grid-full {
      margin-top: var(--spacing-4);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .form-row-3 {
      grid-template-columns: 1fr 1fr 1fr;
    }

    .form-grid:not(.form-grid--with-side) .form-row-3 {
      grid-template-columns: 1fr 1fr;
    }

    @media (max-width: 640px) {
      .form-row-3,
      .form-grid:not(.form-grid--with-side) .form-row-3 {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      margin-bottom: var(--spacing-5);

      &:last-child {
        margin-bottom: 0;
      }

      label {
        display: block;
        margin-bottom: var(--spacing-2);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .required {
        color: var(--color-error-600);
        margin-inline-start: var(--spacing-1);
      }
    }

    .form-error {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-error-600);

      i {
        font-size: var(--font-size-base);
      }

      .form-hint {
        display: block;
        margin-top: var(--spacing-1);
        color: var(--color-neutral-600);
        font-size: var(--font-size-xs);
      }
    }

    .form-hint {
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-1);
      display: block;
    }

    .product-image-group label {
      display: block;
      margin-bottom: var(--spacing-2);
    }

    .product-image-section {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--spacing-4);
    }

    .product-image-actions {
      display: flex;
      flex-direction: column;
      flex-wrap: wrap;
      gap: var(--spacing-2);
      align-items: flex-start;
      min-width: 0;
      flex: 1;
    }

    .product-image-preview {
      width: 160px;
      height: 160px;
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--color-neutral-100);
      border: 1px dashed var(--color-neutral-300);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .product-image-preview.has-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .product-image-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
    }

    .product-image-placeholder i {
      font-size: 2rem;
    }

    .fodec-checkbox {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      min-height: 2.5rem;
    }

    .product-image-remove {
      background: none;
      border: none;
      color: var(--color-error-600);
      font-size: var(--font-size-sm);
      cursor: pointer;
      padding: var(--spacing-1) 0;
      text-decoration: underline;
    }

    .product-image-remove:hover:not(:disabled) {
      color: var(--color-error-700);
    }

    .product-image-remove:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .status-switch {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);

      span {
        color: var(--color-neutral-600);

        &.active {
          color: var(--color-success-600);
          font-weight: var(--font-weight-medium);
        }
      }
    }

    .price-preview {
      margin-top: var(--spacing-4);
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
    }

    .pricing-block {
      margin-bottom: var(--spacing-5);
      padding-bottom: var(--spacing-4);
      border-bottom: 1px solid var(--color-neutral-200);

      &:last-child {
        border-bottom: none;
        margin-bottom: 0;
        padding-bottom: 0;
      }
    }

    .pricing-block-title {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .form-row-purchase-ht-ttc {
      margin-bottom: var(--spacing-2);

      .form-group {
        margin-bottom: var(--spacing-3);
      }
    }

    .purchase-ht-hint {
      display: block;
      margin-bottom: var(--spacing-5);
    }

    .discount-hint {
      color: var(--color-error-600);
    }

    :host ::ng-deep .readonly-field .p-inputnumber-input {
      background: var(--color-neutral-100);
      color: var(--color-neutral-600);
    }

    .preview-row {
      display: flex;
      justify-content: space-between;
      padding: var(--spacing-2) 0;
      font-size: var(--font-size-sm);

      .value {
        font-family: 'JetBrains Mono', monospace;
        font-weight: var(--font-weight-medium);
      }

      &.total {
        margin-top: var(--spacing-2);
        padding-top: var(--spacing-3);
        border-top: 2px solid var(--color-neutral-200);
        font-weight: var(--font-weight-semibold);

        .value {
          font-size: var(--font-size-lg);
          color: var(--color-primary-700);
        }
      }
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-4);
      margin-top: var(--spacing-8);
      padding-top: var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle);
    }

    .price-preview {
      background: var(--color-background-subtle);
      border: 1px solid var(--color-border-subtle);
    }

    :host ::ng-deep {
      .p-inputnumber,
      .p-select {
        width: 100%;
      }
    }

    // Les champs natifs ne sont PAS couverts par le bloc ::ng-deep ci-dessus : ils
    // vivent dans ce template, pas dans un composant enfant. Sans cette règle ils
    // restent à leur largeur intrinsèque (~185 px) pendant que les p-select et
    // p-inputNumber voisins occupent toute la colonne — les « class="w-full" » posées
    // sur eux ne portent rien (Tailwind est préfixé « tw- », cf. tailwind.config.js).
    .form-group > input[pInputText],
    .form-group > textarea[pTextarea] {
      width: 100%;
    }

    .variant-values {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin: 0.75rem 0;
    }

    .variant-value {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.875rem;
    }
  `]
})
export class ProductFormComponent implements OnInit {
  readonly loc_ui_tern_modifier_le_produit_aeaa8f = $localize`:@@ui.tern.modifier.le.produit.aeaa8f:Modifier le produit`;
  readonly loc_ui_tern_nouveau_produit_c31ca3 = $localize`:@@ui.tern.nouveau.produit.c31ca3:Nouveau produit`;
  readonly loc_ui_tern_modifiez_les_informations_du_produit_41bd18 = $localize`:@@ui.tern.modifiez.les.informations.du.produit.41bd18:Modifiez les informations du produit`;
  readonly loc_ui_tern_ajoutez_un_nouveau_produit_a_votre_catalog_d9126c = $localize`:@@ui.tern.ajoutez.un.nouveau.produit.a.votre.catalog.d9126c:Ajoutez un nouveau produit à votre catalogue`;
  readonly loc_ui_tern_activee_9b4e7c = $localize`:@@ui.tern.activee.9b4e7c:Activée`;
  readonly loc_ui_tern_desactivee_74cc3b = $localize`:@@ui.tern.desactivee.74cc3b:Désactivée`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_active_42ce0b = $localize`:@@ui.tern.active.42ce0b:Activé`;
  readonly loc_ui_tern_desactive_2d32fa = $localize`:@@ui.tern.desactive.2d32fa:Désactivé`;
  readonly loc_ui_tern_cout_unitaire_affiche_ht_050c67 = $localize`:@@ui.tern.cout.unitaire.affiche.ht.050c67:Coût unitaire affiché HT`;
  readonly loc_ui_tern_cout_unitaire_moyen_pondere_cmup_ht_665d78 = $localize`:@@ui.tern.cout.unitaire.moyen.pondere.cmup.ht.665d78:Coût unitaire moyen pondéré (CMUP) HT`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creer_le_produit_e19a48 = $localize`:@@ui.tern.creer.le.produit.e19a48:Créer le produit`;
  @ViewChild(ProductVariantMatrixComponent) variantMatrix?: ProductVariantMatrixComponent;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toastService = inject(ToastService);
  private productService = inject(ProductService);
  private productCategoryService = inject(ProductCategoryService);
  private supplierService = inject(SupplierService);
  private stockService = inject(StockService);
  private errorHandler = inject(ErrorHandlerService);
  errorMessageService = inject(ErrorMessageService);
  private auth = inject(AuthService);
  readonly canConfigureVariantAxes = this.auth.canAccessPlatformSettings;
  readonly variantAxesNewLink = `${VARIANT_AXES_PATH}/new`;

  saving = signal(false);
  productCategoryOptions = signal<{ label: string; value: string }[]>([]);
  /** Active suppliers for the "fournisseur préféré" dropdown (réapprovisionnement). */
  supplierOptions = signal<{ label: string; value: string }[]>([]);
  productId = signal<string | null>(null);
  currentImageUrl = signal<string | null>(null);
  selectedImageFile = signal<File | null>(null);
  previewDataUrl = signal<string | null>(null);
  imageToRemove = signal(false);
  lastPurchasePrice = signal<number | null>(null);
  weightedAverageCost = signal<number | null>(null);
  stockFeatures = signal<StockFeatures | null>(null);
  attributes = signal<ProductAttributeDto[]>([]);
  variantAxesSelection = signal<Record<string, string[]>>({});
  generatingVariants = signal(false);
  private pricingSync = false;

  isEditMode = computed(() => !!this.productId());
  /** Writable: FormControl values are not signal deps — must be refreshed in syncMarginControl. */
  canEditMargin = signal(false);

  canMutateProduct = computed(() =>
    this.isEditMode()
      ? this.auth.hasPermission(PERMISSIONS.products.update)
      : this.auth.hasPermission(PERMISSIONS.products.create)
  );

  showStockManagementSection = computed(
    () => this.auth.hasModule(AppModule.Stock) && this.canMutateProduct()
  );

  showVariantsSection(): boolean {
    return (this.stockFeatures()?.productVariantsEnabled ?? false) && this.isProductCategory() && this.canMutateProduct();
  }

  showTraceabilitySection(): boolean {
    return isTraceabilitySectionVisible(
      this.form.get('category')?.value ?? '',
      this.stockFeatures(),
      this.canMutateProduct()
    );
  }

  traceabilityEditable(): boolean {
    this.traceabilityUiVersion();
    return isTraceabilityEditable(
      this.form.get('category')?.value ?? '',
      !!this.form.get('isStockManaged')?.value
    );
  }

  hasSideSections(): boolean {
    return this.showVariantsSection() || this.showTraceabilitySection();
  }

  variantsSectionNumber(): number {
    return 2;
  }

  traceSectionNumber(): number {
    return this.showVariantsSection() ? 3 : 2;
  }

  pricingSectionNumber(): number {
    let n = 2;
    if (this.showVariantsSection()) n++;
    if (this.showTraceabilitySection()) n++;
    return n;
  }

  clientPricesSectionNumber(): number {
    return this.pricingSectionNumber() + 1;
  }

  hasVariantSelection = computed(() =>
    Object.values(this.variantAxesSelection()).some(ids => ids.length > 0)
  );

  showPickingFieldForForm(): boolean {
    this.traceabilityUiVersion();
    return showPickingField(this.form.get('trackingMode')?.value);
  }

  showExpiryFieldsForForm(): boolean {
    this.traceabilityUiVersion();
    return showExpiryFields(this.form.get('trackingMode')?.value, this.stockFeatures());
  }

  showCostingDropdown(): boolean {
    return showCostingMethodDropdown(this.stockFeatures());
  }

  trackingModeHint = computed(() => getTrackingModeHint());

  pickingPolicyHint = computed(() => {
    this.traceabilityUiVersion();
    return getPickingPolicyHint(!!this.form.get('hasExpiryTracking')?.value);
  });

  costingMethodHint = computed(() => getCostingMethodHint());

  trackingModeSelectOptions = computed(() => {
    this.traceabilityUiVersion();
    return getTrackingModeOptions(this.stockFeatures(), this.form.get('trackingMode')?.value);
  });

  pickingPolicySelectOptions = computed(() => {
    this.traceabilityUiVersion();
    return getPickingPolicyOptions(
      this.form.get('trackingMode')?.value,
      !!this.form.get('hasExpiryTracking')?.value
    );
  });

  originalCostingMethod = signal(0);

  costingMethodSelectOptions = computed(() => {
    this.traceabilityUiVersion();
    return getCostingMethodOptions(
      this.stockFeatures(),
      this.isEditMode(),
      this.originalCostingMethod()
    );
  });

  private traceabilityUiVersion = signal(0);
  private traceabilityNormalizing = false;

  displayImageUrl = computed(() => {
    if (this.imageToRemove()) return null;
    const preview = this.previewDataUrl();
    if (preview) return preview;
    return this.currentImageUrl();
  });

  /** Expose image URL resolution for template; keeps ProductService private. */
  resolveProductImageUrl(url: string | null): string | null {
    return this.productService.resolveProductImageUrl(url);
  }

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const base: BreadcrumbItem[] = [
      { label: $localize`:@@products.product-form.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
      { label: $localize`:@@products.product-form.ts.produits.services.01d33b70:Produits & Services`, route: '/products' }
    ];
    if (this.isEditMode()) {
      base.push({ label: $localize`:@@products.product-form.ts.modifier.f260e757:Modifier` });
    } else {
      base.push({ label: $localize`:@@products.product-form.ts.nouveau.produit.c31ca342:Nouveau produit` });
    }
    return base;
  });

  categoryOptions: CategoryOption[] = PRODUCT_CATEGORY_OPTIONS;
  unitOptions: UnitOption[] = PRODUCT_UNIT_OPTIONS;
  vatOptions: VatOption[] = PRODUCT_VAT_OPTIONS;

  readonly generatingBarcode = signal(false);
  readonly labelPrintingEnabled = environment.featureFlags?.barcodeLabelPrinting === true;
  readonly labelDialogVisible = signal(false);
  readonly labelTarget = signal<LabelPrintTarget | null>(null);

  /**
   * Symbologie déduite du code-barres saisi, pour confirmer d'un coup d'œil que la saisie est
   * reconnue. La validation qui fait autorité reste celle du serveur : ce libellé est un
   * confort d'affichage, pas un contrôle.
   */
  readonly barcodeSymbologyLabel = computed(() => {
    const value = this.barcodeValue();
    if (!value) return null;

    const digitsOnly = /^[0-9]+$/.test(value);
    if (digitsOnly) {
      switch (value.length) {
        case 8: return 'EAN-8';
        case 12: return 'UPC-A';
        case 13: return 'EAN-13';
        case 14: return 'GTIN-14';
        default: return 'Code 128';
      }
    }
    return 'Code 128';
  });

  form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(2)]],
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    category: ['Service', Validators.required],
    productCategoryId: [null as string | null],
    unitPrice: [0, [Validators.required, Validators.min(0)]],
    purchasePrice: [null as number | null, [Validators.min(0)]],
    profitMarginPercent: [null as number | null],
    salePriceTtc: [0, [Validators.required, Validators.min(0)]],
    unit: ['Unité', Validators.required],
    barcode: [''],
    vatRate: [19, Validators.required],
    isFodecApplicable: [false],
    isDiscountEnabled: [false],
    maxDiscountPercent: [null as number | null, [Validators.min(0), Validators.max(100)]],
    isStockManaged: [false],
    minimumStock: [null as number | null, [Validators.min(0)]],
    preferredSupplierId: [null as string | null],
    isActive: [true],
    isVariantTemplate: [false],
    trackingMode: [0],
    hasExpiryTracking: [false],
    pickingPolicy: [0],
    costingMethod: [0],
    expiryAlertDays: [null as number | null]
  });

  ngOnInit(): void {
    this.watchBarcodeControl();
    this.loadProductCategories();
    this.loadSuppliers();
    this.loadStockFeatures();

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.productId.set(id);
      this.loadProduct(id);
    }

    const categoryControl = this.form.get('category');
    this.syncStockManagement(categoryControl?.value ?? null, true);
    categoryControl?.valueChanges.subscribe((value) => {
      this.syncStockManagement(value ?? null);
    });

    this.form.get('isDiscountEnabled')?.valueChanges.subscribe((enabled) => {
      const maxCtrl = this.form.get('maxDiscountPercent');
      if (!maxCtrl) return;
      if (enabled) {
        maxCtrl.enable({ emitEvent: false });
        if (maxCtrl.value == null) {
          maxCtrl.setValue(100, { emitEvent: false });
        }
      } else {
        maxCtrl.disable({ emitEvent: false });
        maxCtrl.setValue(null, { emitEvent: false });
      }
    });

    this.syncDiscountControls(this.form.get('isDiscountEnabled')?.value ?? false);
    this.syncMarginControl();
    this.onPricingChange('unitPriceHt');
    this.setupTraceabilitySubscriptions();
    this.applyTraceabilityNormalization(false);
  }

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }

  onProductImageSelect(event: { files: File[] }): void {
    const file = event.files?.[0];
    if (!file) return;
    this.imageToRemove.set(false);
    this.selectedImageFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => this.previewDataUrl.set((e.target?.result as string) ?? null);
    reader.readAsDataURL(file);
  }

  removeProductImage(): void {
    this.selectedImageFile.set(null);
    this.previewDataUrl.set(null);
    this.imageToRemove.set(true);
    this.currentImageUrl.set(null);
  }

  onPricingChange(source: PricingEditSource): void {
    if (this.pricingSync) return;

    const purchasePrice = this.form.get('purchasePrice')?.value ?? null;
    this.syncMarginControl();

    // When purchase price is set and margin is still empty, seed margin from existing HT
    // instead of driving HT from a null margin (preserves unit price on first activation).
    let effectiveSource = source;
    if (
      source === 'purchasePrice' &&
      this.canEditMargin() &&
      this.form.get('profitMarginPercent')?.value == null
    ) {
      effectiveSource = 'unitPriceHt';
    }

    const result = recalculatePricing(
      {
        purchasePrice,
        profitMarginPercent: this.form.get('profitMarginPercent')?.value ?? null,
        unitPriceHt: this.form.get('unitPrice')?.value ?? 0,
        saleTtc: this.form.get('salePriceTtc')?.value ?? 0,
        vatRatePercent: this.form.get('vatRate')?.value ?? 0,
        isFodecApplicable: this.form.get('isFodecApplicable')?.value ?? false
      },
      effectiveSource
    );

    this.pricingSync = true;
    this.form.patchValue(
      {
        unitPrice: result.unitPriceHt,
        profitMarginPercent: result.profitMarginPercent,
        salePriceTtc: result.saleTtc
      },
      { emitEvent: false }
    );
    this.pricingSync = false;
  }

  previewFodec(): number {
    return calculateFodecAmount(
      this.form.get('unitPrice')?.value ?? 0,
      this.form.get('isFodecApplicable')?.value ?? false
    );
  }

  previewVat(): number {
    const unitPrice = this.form.get('unitPrice')?.value ?? 0;
    const fodec = this.previewFodec();
    return calculateVatAmount(unitPrice, fodec, this.form.get('vatRate')?.value ?? 0);
  }

  previewPurchaseTtc(): number | null {
    return resolvePurchaseTtc(
      this.form.get('purchasePrice')?.value ?? null,
      this.form.get('vatRate')?.value ?? 0
    );
  }

  private syncMarginControl(): void {
    const marginCtrl = this.form.get('profitMarginPercent');
    if (!marginCtrl) return;

    const purchase = this.form.get('purchasePrice')?.value;
    const canEdit = purchase != null && Number(purchase) > 0;
    this.canEditMargin.set(canEdit);

    if (canEdit) {
      marginCtrl.enable({ emitEvent: false });
    } else {
      marginCtrl.disable({ emitEvent: false });
      marginCtrl.setValue(null, { emitEvent: false });
    }
  }

  private syncDiscountControls(enabled: boolean): void {
    const maxCtrl = this.form.get('maxDiscountPercent');
    if (!maxCtrl) return;
    if (enabled) {
      maxCtrl.enable({ emitEvent: false });
    } else {
      maxCtrl.disable({ emitEvent: false });
    }
  }

  private loadProductCategories(): void {
    this.productCategoryService.getCategoryOptionsForDropdown().subscribe({
      next: options => {
        this.productCategoryOptions.set(options);
        if (options.length > 0 && !this.productId()) {
          // `label` est ici le nom de la catégorie en base (donnée, jamais traduite) et `value` son id.
          const defaultCategory = options.find(o => o.label === DEFAULT_PRODUCT_CATEGORY_NAME) ?? options[0];
          this.form.patchValue({ productCategoryId: defaultCategory.value });
        }
      },
      error: () => this.productCategoryOptions.set([])
    });
  }

  /** Loads active suppliers for the "fournisseur préféré" dropdown (best-effort). */
  private loadSuppliers(): void {
    this.supplierService.getSuppliers({ pageSize: 200, isActive: true }).subscribe({
      next: res => this.supplierOptions.set(
        (res.data?.items ?? []).map(s => ({ label: s.name, value: s.id }))
      ),
      error: () => this.supplierOptions.set([])
    });
  }

  private loadProduct(id: string): void {
    this.productService.getProduct(id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const product = response.data;
          this.lastPurchasePrice.set(product.lastPurchasePrice ?? null);
          this.weightedAverageCost.set(product.weightedAverageCost ?? null);
          this.form.patchValue({
            code: product.code,
            name: product.name,
            description: product.description || '',
            category: product.typeDisplay || 'Service',
            productCategoryId: product.categoryId || null,
            unitPrice: product.unitPrice,
            purchasePrice: product.purchasePrice ?? null,
            profitMarginPercent: product.profitMarginPercent ?? null,
            salePriceTtc: product.salePriceTtc ?? calculateSaleTtc(
              product.unitPrice,
              product.vatRate,
              product.isFodecApplicable ?? false
            ),
            unit: product.unit || 'Unité',
            barcode: product.barcode ?? '',
            vatRate: product.vatRate,
            isFodecApplicable: product.isFodecApplicable ?? false,
            isDiscountEnabled: product.isDiscountEnabled ?? false,
            maxDiscountPercent: product.maxDiscountPercent ?? null,
            isStockManaged: product.isStockManaged ?? false,
            minimumStock: product.minimumStock ?? null,
            preferredSupplierId: product.preferredSupplierId ?? null,
            isActive: product.isActive ?? true,
            isVariantTemplate: product.isVariantTemplate ?? false,
            trackingMode: product.trackingMode ?? 0,
            hasExpiryTracking: product.hasExpiryTracking ?? false,
            pickingPolicy: product.pickingPolicy ?? 0,
            costingMethod: coerceCostingMethod(product.costingMethod),
            expiryAlertDays: product.expiryAlertDays ?? null
          });
          this.originalCostingMethod.set(coerceCostingMethod(product.costingMethod));

          this.syncDiscountControls(product.isDiscountEnabled ?? false);
          this.syncMarginControl();

          this.syncStockManagement(product.typeDisplay || 'Service', true);
          this.applyTraceabilityNormalization(false);
          this.currentImageUrl.set(product.imageUrl ?? null);
          this.selectedImageFile.set(null);
          this.previewDataUrl.set(null);
          this.imageToRemove.set(false);
          if (product.isVariantTemplate) {
            this.loadVariantAxes(id);
          }
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-form.component.summary.Erreur:Erreur`,
            detail: response.errors?.join(', ') || $localize`:@@products.product-form.ts.impossible.de.charger.le.produit.7a00d1a4:Impossible de charger le produit`
          });
          this.router.navigate(['/products']);
        }
      },
      error: (error) => {
        const errorMessage = this.errorHandler.extractErrorMessage(error);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-form.component.summary.Erreur:Erreur`,
          detail: errorMessage || $localize`:@@products.product-form.ts.impossible.de.charger.le.produit.7a00d1a4:Impossible de charger le produit`
        });
        this.errorHandler.logError('Failed to load product', error);
        this.router.navigate(['/products']);
      }
    });
  }

  /** Sends null when stock management is off or the field is left empty (optional). */
  private resolveMinimumStockPayload(formValue: { isStockManaged?: boolean; minimumStock?: number | null }): number | null {
    if (!formValue.isStockManaged) return null;
    const value = formValue.minimumStock;
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    return value;
  }

  private navigateToProducts(): void {
    this.router.navigate(['/products']);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    const normalizedTrace = this.applyTraceabilityNormalization(false);
    const formValue = { ...this.form.getRawValue(), ...normalizedTrace };
    
    if (this.isEditMode()) {
      // Update existing product
      const updateRequest: UpdateProductRequest = {
        code: formValue.code.trim(),
        name: formValue.name.trim(),
        description: formValue.description?.trim() || null,
        category: formValue.category,
        productCategoryId: formValue.productCategoryId || undefined,
        unitPrice: formValue.unitPrice,
        purchasePrice: formValue.purchasePrice ?? null,
        profitMarginPercent: formValue.profitMarginPercent ?? null,
        unit: formValue.unit,
        // Toujours transmis, y compris vide : le serveur applique SetBarcode sans condition,
        // donc omettre ce champ effacerait le code-barres à chaque enregistrement de la fiche.
        barcode: (formValue.barcode ?? '').trim() || null,
        vatRate: formValue.vatRate,
        isFodecApplicable: formValue.isFodecApplicable ?? false,
        isDiscountEnabled: formValue.isDiscountEnabled ?? false,
        maxDiscountPercent: formValue.isDiscountEnabled ? formValue.maxDiscountPercent ?? null : null,
        isStockManaged: formValue.isStockManaged ?? false,
        minimumStock: this.resolveMinimumStockPayload(formValue),
        preferredSupplierId: formValue.preferredSupplierId || null,
        isActive: formValue.isActive ?? true,
        isVariantTemplate: formValue.isVariantTemplate ?? false,
        trackingMode: formValue.trackingMode ?? 0,
        hasExpiryTracking: formValue.hasExpiryTracking ?? false,
        pickingPolicy: formValue.pickingPolicy ?? 0,
        costingMethod: formValue.costingMethod ?? 0,
        expiryAlertDays: formValue.expiryAlertDays ?? null
      };

      this.productService.updateProduct(this.productId()!, updateRequest).subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.add({
              severity: 'success',
              summary: $localize`:@@product-form.component.summary.Succès:Succès`,
              detail: response.message || $localize`:@@products.product-form.ts.produit.mis.a.jour.avec.succes.c367beef:Produit mis à jour avec succès`
            });
            const id = this.productId()!;
            const file = this.selectedImageFile();
            const toRemove = this.imageToRemove();
            if (file) {
              this.productService.uploadProductImage(id, file).subscribe({
                next: () => {
                  this.saving.set(false);
                  this.navigateToProducts();
                },
                error: (err) => {
                  this.toastService.add({
                    severity: 'warn',
                    summary: $localize`:@@product-form.component.summary.Image:Image`,
                    detail: $localize`:@@product-form.component.detail.Produit_mis_jo:Produit mis à jour ; l'image n'a pas pu être enregistrée.`
                  });
                  this.saving.set(false);
                  this.navigateToProducts();
                }
              });
            } else if (toRemove) {
              this.productService.deleteProductImage(id).subscribe({
                next: () => {
                  this.saving.set(false);
                  this.navigateToProducts();
                },
                error: () => {
                  this.saving.set(false);
                  this.navigateToProducts();
                }
              });
            } else {
              this.saving.set(false);
              this.navigateToProducts();
            }
          } else {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-form.component.summary.Erreur:Erreur`,
              detail: this.mapTraceabilityApiError(
                response.errors?.join(', ') || $localize`:@@products.product-form.ts.une.erreur.est.survenue.lors.de.la.mise.0bf44f4f:Une erreur est survenue lors de la mise à jour`,
                (response as { code?: string }).code
              )
            });
            this.saving.set(false);
          }
        },
        error: (error) => {
          const errorMessage = this.mapTraceabilityApiError(
            this.errorHandler.extractErrorMessage(error) || $localize`:@@products.product-form.ts.une.erreur.est.survenue.lors.de.la.mise.0bf44f4f:Une erreur est survenue lors de la mise à jour`,
            this.errorHandler.getApiErrorCode(error)
          );
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-form.component.summary.Erreur:Erreur`,
            detail: errorMessage
          });
          this.errorHandler.logError('Failed to update product', error);
          this.saving.set(false);
        }
      });
    } else {
      // Create new product
      const createRequest: CreateProductRequest = {
        code: formValue.code.trim(),
        name: formValue.name.trim(),
        description: formValue.description?.trim() || null,
        category: formValue.category,
        productCategoryId: formValue.productCategoryId || undefined,
        unitPrice: formValue.unitPrice,
        purchasePrice: formValue.purchasePrice ?? null,
        profitMarginPercent: formValue.profitMarginPercent ?? null,
        unit: formValue.unit,
        barcode: (formValue.barcode ?? '').trim() || null,
        vatRate: formValue.vatRate,
        isFodecApplicable: formValue.isFodecApplicable ?? false,
        isDiscountEnabled: formValue.isDiscountEnabled ?? false,
        maxDiscountPercent: formValue.isDiscountEnabled ? formValue.maxDiscountPercent ?? null : null,
        isStockManaged: formValue.isStockManaged ?? false,
        minimumStock: this.resolveMinimumStockPayload(formValue),
        preferredSupplierId: formValue.preferredSupplierId || null,
        isVariantTemplate: formValue.isVariantTemplate ?? false,
        trackingMode: formValue.trackingMode ?? 0,
        hasExpiryTracking: formValue.hasExpiryTracking ?? false,
        pickingPolicy: formValue.pickingPolicy ?? 0,
        costingMethod: formValue.costingMethod ?? 0,
        expiryAlertDays: formValue.expiryAlertDays ?? null
      };

      this.productService.createProduct(createRequest).subscribe({
        next: (response) => {
          if (response.success && response.data) {
            const newId = response.data;
            this.toastService.add({
              severity: 'success',
              summary: $localize`:@@product-form.component.summary.Succès:Succès`,
              detail: response.message || $localize`:@@products.product-form.ts.produit.cree.avec.succes.0fed3c0d:Produit créé avec succès`
            });
            const file = this.selectedImageFile();
            if (file) {
              this.productService.uploadProductImage(newId, file).subscribe({
                next: (uploadRes) => {
                  if (!uploadRes.success) {
                    this.toastService.add({
                      severity: 'warn',
                      summary: $localize`:@@product-form.component.summary.Image:Image`,
                      detail: $localize`:@@product-form.component.detail.Produit_cr_l:Produit créé ; l'image n'a pas pu être enregistrée.`
                    });
                  }
                  this.saving.set(false);
                  this.navigateAfterCreate(newId, createRequest.isVariantTemplate ?? false);
                },
                error: () => {
                  this.toastService.add({
                    severity: 'warn',
                    summary: $localize`:@@product-form.component.summary.Image:Image`,
                    detail: $localize`:@@product-form.component.detail.Produit_cr_l:Produit créé ; l'image n'a pas pu être enregistrée.`
                  });
                  this.saving.set(false);
                  this.navigateAfterCreate(newId, createRequest.isVariantTemplate ?? false);
                }
              });
            } else {
              this.saving.set(false);
              this.navigateAfterCreate(newId, createRequest.isVariantTemplate ?? false);
            }
          } else {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-form.component.summary.Erreur:Erreur`,
              detail: this.mapTraceabilityApiError(
                response.errors?.join(', ') || $localize`:@@products.product-form.ts.une.erreur.est.survenue.lors.de.la.creat.3f7d195c:Une erreur est survenue lors de la création`,
                (response as { code?: string }).code
              )
            });
            this.saving.set(false);
          }
        },
        error: (error) => {
          const errorMessage = this.mapTraceabilityApiError(
            this.errorHandler.extractErrorMessage(error) || $localize`:@@products.product-form.ts.une.erreur.est.survenue.lors.de.la.creat.3f7d195c:Une erreur est survenue lors de la création`,
            this.errorHandler.getApiErrorCode(error)
          );
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-form.component.summary.Erreur:Erreur`,
            detail: errorMessage
          });
          this.errorHandler.logError('Failed to create product', error);
          this.saving.set(false);
        }
      });
    }
  }

  isProductCategory(): boolean {
    return this.form.get('category')?.value === 'Produit';
  }

  private loadStockFeatures(): void {
    this.stockService.getFeatures().subscribe({
      next: res => {
        if (res.success && res.data) {
          this.stockFeatures.set(res.data);
          this.applyTraceabilityNormalization(false);
          if (res.data.productVariantsEnabled) {
            this.productService.listAttributes().subscribe({
              next: attr => {
                if (attr.success && attr.data) this.attributes.set(attr.data);
              }
            });
          }
        }
      }
    });
  }

  isVariantValueSelected(definitionId: string, valueId: string): boolean {
    return (this.variantAxesSelection()[definitionId] ?? []).includes(valueId);
  }

  toggleVariantValue(definitionId: string, valueId: string): void {
    const current = { ...this.variantAxesSelection() };
    const list = current[definitionId] ?? [];
    current[definitionId] = list.includes(valueId)
      ? list.filter(x => x !== valueId)
      : [...list, valueId];
    if (current[definitionId].length === 0) delete current[definitionId];
    this.variantAxesSelection.set(current);
  }

  generateVariants(): void {
    const productId = this.productId();
    if (!productId) return;

    const count = this.previewCombinationCount();
    if (count > 50 && !confirm($localize`:@@products.product-form.ts.generer.count.sku.cette.operation.peut.p.701f6b43:Générer ${count}:count: SKU ? Cette opération peut prendre un moment.`)) {
      return;
    }

    const axes = Object.entries(this.variantAxesSelection())
      .filter(([, valueIds]) => valueIds.length > 0)
      .map(([definitionId, valueIds]) => ({ definitionId, valueIds }));

    if (axes.length === 0) return;

    this.generatingVariants.set(true);
    this.productService.generateVariants(productId, axes).subscribe({
      next: res => {
        this.generatingVariants.set(false);
        if (res.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@product-form.component.summary.Variantes:Variantes`,
            detail: $localize`:@@products.product-form.ts.p.sku.enfant.s.cree.s.606d0d64:${res.data?.length ?? 0}:p: SKU enfant(s) créé(s)`
          });
          this.loadVariantAxes(productId);
          this.variantMatrix?.load();
        }
      },
      error: err => {
        this.generatingVariants.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-form.component.summary.Variantes:Variantes`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  createOpeningLayer(): void {
    const productId = this.productId();
    if (!productId) return;
    const costingMethod = this.form.get('costingMethod')?.value ?? 1;
    this.saving.set(true);
    this.productService.createOpeningValuationLayer(productId, costingMethod).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@product-form.component.summary.Valorisation:Valorisation`,
            detail: $localize`:@@product-form.component.detail.Couche_d_ouvertu:Couche d'ouverture créée. Vous pouvez enregistrer le produit.`
          });
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-form.component.summary.Valorisation:Valorisation`,
            detail: res.message || res.errors?.join(', ') || $localize`:@@products.product-form.ts.impossible.de.creer.la.couche.d.ouvertur.35397855:Impossible de créer la couche d'ouverture.`
          });
        }
      },
      error: err => {
        this.saving.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-form.component.summary.Valorisation:Valorisation`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  private syncStockManagement(category: string | null, preserveValue: boolean = false): void {
    const control = this.form.get('isStockManaged');
    if (!control) return;

    const isProduct = category === 'Produit';

    if (!isProduct) {
      control.setValue(false, { emitEvent: false });
      control.disable({ emitEvent: false });
      this.applyTraceabilityNormalization(false);
      return;
    }

    control.enable({ emitEvent: false });

    if (!preserveValue && !this.isEditMode()) {
      control.setValue(true, { emitEvent: false });
    }

    this.applyTraceabilityNormalization(false);
  }

  private setupTraceabilitySubscriptions(): void {
    const bump = () => this.traceabilityUiVersion.update(v => v + 1);

    this.form.get('trackingMode')?.valueChanges.subscribe(() => {
      this.applyTraceabilityNormalization(true);
      bump();
    });
    this.form.get('hasExpiryTracking')?.valueChanges.subscribe(() => {
      this.applyTraceabilityNormalization(true);
      bump();
    });
    this.form.get('isStockManaged')?.valueChanges.subscribe(() => {
      this.applyTraceabilityNormalization(true);
      bump();
    });
    this.form.get('category')?.valueChanges.subscribe(() => bump());
  }

  private buildTraceabilityFormState(): TraceabilityFormState {
    return {
      category: this.form.get('category')?.value ?? '',
      isStockManaged: !!this.form.get('isStockManaged')?.value,
      trackingMode: this.form.get('trackingMode')?.value ?? 0,
      hasExpiryTracking: !!this.form.get('hasExpiryTracking')?.value,
      pickingPolicy: this.form.get('pickingPolicy')?.value ?? 0,
      costingMethod: this.form.get('costingMethod')?.value ?? 0,
      expiryAlertDays: this.form.get('expiryAlertDays')?.value ?? null
    };
  }

  private applyTraceabilityNormalization(notifyFefoDowngrade: boolean): Record<string, unknown> {
    if (this.traceabilityNormalizing) {
      return {};
    }

    const { state, fefoDowngraded } = normalizeTraceabilityForm(
      this.buildTraceabilityFormState(),
      this.stockFeatures()
    );

    this.traceabilityNormalizing = true;
    this.form.patchValue(state, { emitEvent: false });
    this.traceabilityNormalizing = false;
    this.traceabilityUiVersion.update(v => v + 1);

    if (notifyFefoDowngrade && fefoDowngraded) {
      this.toastService.add({
        severity: 'info',
        summary: $localize`:@@product-form.component.summary.Politique_de_pr_:Politique de prélèvement`,
        detail: $localize`:@@product-form.component.detail.FEFO_n_cessite_l:FEFO nécessite le suivi DLUO. Passage à FIFO physique.`
      });
    }

    return state;
  }

  /** Ajoute l'aide « couche d'ouverture » : code d'abord (message traduisible), texte en repli sans code. */
  private mapTraceabilityApiError(message: string, code?: string): string {
    const needsOpeningLayer = code
      ? code === API_ERROR_CODE.openingLayerRequired
      : message.includes('couche d\'ouverture') || message.includes('couche d’ouverture');
    if (needsOpeningLayer) {
      return $localize`:@@products.product-form.opening-layer-hint:${message}:message: Utilisez le bouton « Créer la couche d'ouverture FIFO/LIFO » si le stock est à zéro.`;
    }
    return message;
  }

  previewCombinationCount(): number {
    const axes = Object.values(this.variantAxesSelection()).filter(ids => ids.length > 0);
    if (axes.length === 0) return 0;
    return axes.reduce((acc, ids) => acc * ids.length, 1);
  }

  private loadVariantAxes(parentId: string): void {
    this.productService.getProductVariantAxes(parentId).subscribe(res => {
      if (res.success && res.data) {
        const selection: Record<string, string[]> = {};
        for (const axis of res.data) {
          if (axis.selectedValueIds.length > 0) {
            selection[axis.definitionId] = [...axis.selectedValueIds];
          }
        }
        this.variantAxesSelection.set(selection);
      }
    });
  }

  private navigateAfterCreate(id: string, isTemplate: boolean): void {
    if (isTemplate) {
      this.router.navigate(['/products', id, 'edit'], { fragment: 'variantes' });
    } else {
      this.navigateToProducts();
    }
  }

  /** Miroir du contrôle, pour que le libellé de symbologie se recalcule à la frappe. */
  private readonly barcodeValue = signal<string>('');

  private watchBarcodeControl(): void {
    this.form.get('barcode')?.valueChanges.subscribe((value: string | null) => {
      this.barcodeValue.set((value ?? '').trim());
    });
  }

  /**
   * Demande au serveur un code-barres interne libre.
   *
   * Le code obtenu n'est pas enregistré : il remplit le champ, et c'est l'enregistrement de la
   * fiche qui le persiste, en repassant par les mêmes contrôles que toute autre saisie.
   */
  generateBarcode(): void {
    if (this.generatingBarcode()) return;

    this.generatingBarcode.set(true);
    this.productService.generateProductBarcode(this.productId() ?? undefined).subscribe({
      next: response => {
        this.generatingBarcode.set(false);
        if (response.success && response.data) {
          this.form.patchValue({ barcode: response.data.barcode });
          this.form.get('barcode')?.markAsDirty();
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@product-form.component.summary.Code_barres_enge:Code-barres engendré`,
            detail: response.data.barcode
          });
        }
      },
      error: () => this.generatingBarcode.set(false)
    });
  }

  openLabelDialog(): void {
    const id = this.productId();
    if (!id) return;

    this.labelTarget.set({
      id,
      name: this.form.get('name')?.value || 'Article',
      hasBarcode: !!(this.form.get('barcode')?.value ?? '').trim()
    });
    this.labelDialogVisible.set(true);
  }
}
