/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ProductService, Product } from '@core/services/product.service';
import { SupplierService } from '@core/services/supplier.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import {
  calculateFodecAmount,
  calculateSaleTtc,
  calculateVatAmount
} from '@shared/utils/product-pricing.utils';
import { ProductClientPricesComponent } from '../product-client-prices/product-client-prices.component';
import { ProductVariantMatrixComponent } from '@shared/components/product-variant-matrix/product-variant-matrix.component';
import {
  formatCostingMethodLabel,
  formatPickingPolicyLabel,
  formatTrackingModeLabel
} from '@shared/utils/product-traceability-rules';
import { TRACKING_MODE_LOT } from '@shared/utils/stock-traceability.utils';

const VAT_OPTIONS: { label: string; value: number }[] = [
  { label: $localize`:@@products.product-detail.ts.19.taux.normal.1dc12a7c:19% - Taux normal`, value: 19 },
  { label: $localize`:@@products.product-detail.ts.13.taux.intermediaire.f50bb2e0:13% - Taux intermédiaire`, value: 13 },
  { label: $localize`:@@products.product-detail.ts.7.taux.reduit.e464d7cf:7% - Taux réduit`, value: 7 },
  { label: $localize`:@@products.product-detail.ts.0.exonere.45b95f13:0% - Exonéré`, value: 0 }
];

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SkeletonModule,
    TagModule,
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
      [title]="pageTitle()"
      [subtitle]="pageSubtitle()">
      <app-button
        variant="outline"
        icon="pi-arrow-left"
        iconPos="left"
        routerLink="/products" i18n="@@products.product-detail.retour.e5befb1f"> Retour </app-button>
      @if (product() && canEditProduct()) {
        <app-button
          variant="primary"
          icon="pi-pencil"
          iconPos="left"
          [routerLink]="['/products', product()!.id, 'edit']" i18n="@@products.product-detail.modifier.f260e757"> Modifier </app-button>
      }
    </app-page-header>

    @if (loading()) {
      <div class="form-grid">
        <app-form-section title="Informations générales" i18n-title="@@products.product-detail.informations.generales.be6ba6e5" icon="pi-box" [number]="1">
          <p-skeleton height="2.5rem" styleClass="mb-3"></p-skeleton>
          <p-skeleton height="2.5rem" styleClass="mb-3"></p-skeleton>
          <p-skeleton height="5rem" width="100%"></p-skeleton>
        </app-form-section>
        <app-form-section title="Tarification" i18n-title="@@products.product-detail.tarification.5dc310ae" icon="pi-dollar" [number]="2">
          <p-skeleton height="2.5rem" styleClass="mb-3"></p-skeleton>
          <p-skeleton height="8rem" width="100%"></p-skeleton>
        </app-form-section>
      </div>
    } @else {
      @if (product(); as p) {
      <div class="form-grid">
        <app-form-section title="Informations générales" i18n-title="@@products.product-detail.informations.generales.be6ba6e5" icon="pi-box" [number]="1">
          <div class="form-row">
            <div class="form-group">
              <span class="field-label" i18n="@@products.product-detail.code.produit.60220afb">Code produit</span>
              <p class="field-value mono">{{ p.code }}</p>
            </div>
            <div class="form-group">
              <span class="field-label" i18n="@@products.product-detail.type.3deb7456">Type</span>
              <p class="field-value">
                <p-tag [value]="p.typeDisplay" severity="info"></p-tag>
              </p>
            </div>
            <div class="form-group">
              <span class="field-label" i18n="@@products.product-detail.categorie.6b38300a">Catégorie</span>
              <p class="field-value">{{ p.category }}</p>
            </div>
          </div>

          <div class="form-group">
            <span class="field-label" i18n="@@products.product-detail.designation.63a9062c">Désignation</span>
            <p class="field-value">{{ p.name }}</p>
          </div>

          <div class="form-group">
            <span class="field-label" i18n="@@products.product-detail.description.55f8ebc8">Description</span>
            <p class="field-value description-block">{{ p.description || '—' }}</p>
          </div>

          <div class="form-group">
            <span class="field-label" i18n="@@products.product-detail.gestion.de.stock.3f196b66">Gestion de stock</span>
            <p class="field-value">
              <p-tag
                [value]="p.isStockManaged ? loc_ui_tern_activee_9b4e7c : loc_ui_tern_desactivee_74cc3b"
                [severity]="p.isStockManaged ? 'success' : 'secondary'">
              </p-tag>
              @if (p.isVariantTemplate) {
                <p-tag value="Modèle de variantes" severity="warn"></p-tag>
              }
              @if (p.parentProductId) {
                <p-tag value="Variante" severity="info"></p-tag>
                <a class="parent-link" [routerLink]="['/products', p.parentProductId, 'view']" i18n="@@products.product-detail.voir.le.modele.3322b687">Voir le modèle</a>
              }
            </p>
          </div>
          @if (p.isStockManaged && showTraceabilitySummary(p)) {
            <div class="form-group">
              <span class="field-label" i18n="@@products.product-detail.tracabilite.et.valorisation.d1bd26b2">Traçabilité et valorisation</span>
              <p class="field-value" i18n="@@products.product-detail.suivi.valorisation.a42f59ec">
                Suivi : {{ formatTrackingModeLabel(p.trackingMode) }}
                · Valorisation : {{ formatCostingMethodLabel(p.costingMethod) }}
              </p>
              @if (p.trackingMode === trackingModeLot) {
                <p class="field-value field-value-sub" i18n="@@products.product-detail.prelevement.33661274">
                  Prélèvement : {{ formatPickingPolicyLabel(p.pickingPolicy) }}
                </p>
              }
              @if (p.hasExpiryTracking) {
                <p class="field-value field-value-sub"><ng-container i18n="@@products.product-detail.dluo.active.4abe0f18">
                  DLUO : activé
                  </ng-container>@if (p.expiryAlertDays != null) {<ng-container i18n="@@products.product-detail.alerte.jour.s.bced4a5d">
                    · Alerte {{ p.expiryAlertDays }} jour(s)
                  </ng-container>}
                </p>
              }
            </div>
          }

          @if (isProductType(p)) {
            <div class="form-group">
              <span class="field-label" i18n="@@products.product-detail.fournisseur.prefere.7d570b74">Fournisseur préféré</span>
              <p class="field-value">
                {{ preferredSupplierName() ?? (p.preferredSupplierId ? '—' : loc_ui_tern_aucun_b2ed82) }}
              </p>
            </div>
          }

          @if (p.isStockManaged && p.minimumStock != null && p.minimumStock > 0) {
            <div class="form-group">
              <span class="field-label" i18n="@@products.product-detail.stock.minimum.8a0c24af">Stock minimum</span>
              <p class="field-value">{{ p.minimumStock | number:'1.0-3' }} {{ p.unit || 'u' }}</p>
            </div>
          }

          @if (isProductType(p)) {
            <div class="form-group product-image-group">
              <span class="field-label" i18n="@@products.product-detail.image.produit.8586e902">Image produit</span>
              <div class="product-image-preview" [class.has-image]="resolvedImageUrl(p)">
                @if (resolvedImageUrl(p)) {
                  <img [src]="resolvedImageUrl(p)!" [alt]="loc_ui_tern_image_du_produit_6ab688 + p.name" />
                } @else {
                  <div class="product-image-placeholder">
                    <i class="pi pi-image" aria-hidden="true"></i>
                    <span i18n="@@products.product-detail.aucune.image.768c8a5c">Aucune image</span>
                  </div>
                }
              </div>
            </div>
          }

          <div class="form-group">
            <span class="field-label" i18n="@@products.product-detail.statut.659499f3">Statut</span>
            <p class="field-value">
              <p-tag
                [value]="p.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033"
                [severity]="p.isActive ? 'success' : 'secondary'">
              </p-tag>
            </p>
          </div>
        </app-form-section>

        <app-form-section title="Tarification" i18n-title="@@products.product-detail.tarification.5dc310ae" icon="pi-dollar" [number]="2">
          <div class="pricing-block">
            <h4 class="pricing-block-title" i18n="@@products.product-detail.couts.d.achat.1efe6462">Coûts d'achat</h4>
            <div class="form-group">
              <span class="field-label" i18n="@@products.product-detail.prix.d.achat.ht.9e99d105">Prix d'achat HT</span>
              <p class="field-value mono">{{ formatMoney(p.purchasePrice) }}</p>
            </div>

            <div class="pricing-readonly-group">
              <p class="pricing-readonly-badge" i18n="@@products.product-detail.calcule.automatiquement.395afd28">
                <i class="pi pi-lock" aria-hidden="true"></i>
                Calculé automatiquement
              </p>
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.dernier.prix.d.achat.ht.ccb5059f">Dernier prix d'achat HT</span>
                <p class="field-value mono">{{ formatMoney(p.lastPurchasePrice) }}</p>
              </div>
              <div class="form-group">
                <span class="field-label">{{ (p.costingMethod === 1 || p.costingMethod === 2) ? loc_ui_tern_cout_unitaire_affiche_ht_050c67 : loc_ui_tern_cmup_ht_8e5c3c }}</span>
                <p class="field-value mono">{{ formatMoney(p.weightedAverageCost) }}</p>
              </div>
            </div>
          </div>

          <div class="pricing-block">
            <h4 class="pricing-block-title" i18n="@@products.product-detail.prix.de.vente.ccbfa99b">Prix de vente</h4>

            <h5 class="pricing-subblock-title" i18n="@@products.product-detail.parametres.de.vente.ba205151">Paramètres de vente</h5>
            <div class="form-row form-row-pricing-params">
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.unite.de.mesure.f5101bff">Unité de mesure</span>
                <p class="field-value">{{ p.unit }}</p>
              </div>
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.taux.de.tva.e704ceaf">Taux de TVA</span>
                <p class="field-value">{{ vatLabel(p.vatRate) }}</p>
              </div>
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.fodec.9a029080">FODEC</span>
                <p class="field-value">{{ p.isFodecApplicable ? loc_ui_tern_applicable_1_7af7ec : loc_ui_tern_non_applicable_16ed38 }}</p>
              </div>
            </div>

            <h5 class="pricing-subblock-title" i18n="@@products.product-detail.montants.6b312baa">Montants</h5>
            <div class="form-row form-row-pricing-flow">
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.marge.beneficiaire.b7324f90">Marge bénéficiaire</span>
                <p class="field-value mono">
                  @if (p.profitMarginPercent != null) {
                    {{ p.profitMarginPercent | number:'1.3-3' }} %
                  } @else {
                    —
                  }
                </p>
              </div>
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.prix.de.vente.ht.7a39da52">Prix de vente HT</span>
                <p class="field-value mono strong">{{ p.unitPrice | number:'1.3-3' }} TND</p>
              </div>
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.prix.de.vente.ttc.87e7c028">Prix de vente TTC</span>
                <p class="field-value mono strong">{{ (p.salePriceTtc ?? calculateTtc(p)) | number:'1.3-3' }} TND</p>
              </div>
            </div>

            <div class="price-preview" aria-label="Récapitulatif des prix" i18n-aria-label="@@products.product-detail.recapitulatif.des.prix.3d69a8b0">
              <div class="preview-row">
                <span i18n="@@products.product-detail.prix.ht.362207ca">Prix HT</span>
                <span class="value">{{ p.unitPrice | number:'1.3-3' }} TND</span>
              </div>
              @if (p.isFodecApplicable) {
                <div class="preview-row">
                  <span i18n="@@products.product-detail.fodec.1.cdda0228">FODEC (1%)</span>
                  <span class="value">{{ calculateFodec(p) | number:'1.3-3' }} TND</span>
                </div>
              }
              <div class="preview-row">
                <span>TVA ({{ p.vatRate }}%)</span>
                <span class="value">{{ calculateVat(p) | number:'1.3-3' }} TND</span>
              </div>
              <div class="preview-row total">
                <span i18n="@@products.product-detail.prix.ttc.c48d80e8">Prix TTC</span>
                <span class="value">{{ (p.salePriceTtc ?? calculateTtc(p)) | number:'1.3-3' }} TND</span>
              </div>
            </div>
          </div>

          <div class="pricing-block">
            <h4 class="pricing-block-title" i18n="@@products.product-detail.remise.produit.158a2250">Remise produit</h4>
            <div class="form-row">
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.remise.produit.158a2250">Remise produit</span>
                <p class="field-value">{{ p.isDiscountEnabled ? loc_ui_tern_activee_9b4e7c : loc_ui_tern_desactivee_74cc3b }}</p>
              </div>
              <div class="form-group">
                <span class="field-label" i18n="@@products.product-detail.remise.maximale.5d83e3b6">Remise maximale</span>
                <p class="field-value mono">
                  @if (p.isDiscountEnabled && p.maxDiscountPercent != null) {
                    {{ p.maxDiscountPercent | number:'1.1-1' }} %
                  } @else {
                    —
                  }
                </p>
              </div>
            </div>
          </div>
        </app-form-section>
      </div>

      @if (p.isVariantTemplate) {
        <div class="form-grid-full">
          <app-form-section title="SKU enfants" i18n-title="@@products.product-detail.sku.enfants.922c9ec5" icon="pi-th-large" [number]="3">
            <app-product-variant-matrix [parentProductId]="p.id" />
          </app-form-section>
        </div>
      }

      <div class="form-grid-full">
        <app-form-section title="Tarifs par client" i18n-title="@@products.product-detail.tarifs.par.client.e47e033b" icon="pi-users" [number]="4">
          <app-product-client-prices
            [productId]="p.id"
            [catalogUnitPriceHT]="p.unitPrice"
            [readOnly]="true">
          </app-product-client-prices>
        </app-form-section>
      </div>
      }
    }
  `,
  styles: [`
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .form-grid-full {
      margin-top: var(--spacing-4);
    }

    .parent-link {
      margin-inline-start: 0.5rem;
      font-size: 0.875rem;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--spacing-4);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      margin-bottom: var(--spacing-5);

      &:last-child {
        margin-bottom: 0;
      }
    }

    .field-label {
      display: block;
      margin-bottom: var(--spacing-2);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
    }

    .field-value {
      margin: 0;
      font-size: var(--font-size-base);
      color: var(--color-neutral-800);
    }

    .field-value.mono {
      font-family: 'JetBrains Mono', monospace;
    }

    .field-value.strong {
      font-weight: var(--font-weight-semibold);
    }

    .field-value-sub {
      margin-top: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .description-block {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .product-image-group .field-label {
      margin-bottom: var(--spacing-2);
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

    .price-preview {
      margin-top: var(--spacing-4);
      padding: var(--spacing-4);
      background: var(--color-background-subtle);
      border: 1px solid var(--color-border-subtle);
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

    .pricing-subblock-title {
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .pricing-readonly-group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);
      margin-top: var(--spacing-4);
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 1px dashed var(--color-neutral-200);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .pricing-readonly-badge {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-1);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;

      i {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-500);
      }
    }

    .form-row-pricing-params,
    .form-row-pricing-flow {
      grid-template-columns: repeat(3, 1fr);

      @media (max-width: 900px) {
        grid-template-columns: 1fr 1fr;
      }

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
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
  `]
})
export class ProductDetailComponent implements OnInit {
  readonly loc_ui_tern_activee_9b4e7c = $localize`:@@ui.tern.activee.9b4e7c:Activée`;
  readonly loc_ui_tern_desactivee_74cc3b = $localize`:@@ui.tern.desactivee.74cc3b:Désactivée`;
  readonly loc_ui_tern_aucun_b2ed82 = $localize`:@@ui.tern.aucun.b2ed82:Aucun`;
  readonly loc_ui_tern_image_du_produit_6ab688 = $localize`:@@ui.tern.image.du.produit.6ab688:Image du produit `;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_cout_unitaire_affiche_ht_050c67 = $localize`:@@ui.tern.cout.unitaire.affiche.ht.050c67:Coût unitaire affiché HT`;
  readonly loc_ui_tern_cmup_ht_8e5c3c = $localize`:@@ui.tern.cmup.ht.8e5c3c:CMUP HT`;
  readonly loc_ui_tern_applicable_1_7af7ec = $localize`:@@ui.tern.applicable.1.7af7ec:Applicable (1%)`;
  readonly loc_ui_tern_non_applicable_16ed38 = $localize`:@@ui.tern.non.applicable.16ed38:Non applicable`;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private productService = inject(ProductService);
  private supplierService = inject(SupplierService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private auth = inject(AuthService);

  loading = signal(true);
  product = signal<Product | null>(null);
  /** Resolved name of the preferred supplier (null when none / not yet loaded). */
  preferredSupplierName = signal<string | null>(null);

  canEditProduct = computed(() => this.auth.hasPermission(PERMISSIONS.products.update));

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [
      { label: $localize`:@@products.product-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
      { label: $localize`:@@products.product-detail.ts.produits.services.01d33b70:Produits & Services`, route: '/products' },
      { label: $localize`:@@products.product-detail.ts.details.aaa029e6:Détails` }
    ];
    return items;
  });

  pageTitle = computed(() => (this.loading() ? $localize`:@@ui.tern.chargement.01cba1:Chargement…` : $localize`:@@ui.tern.details.du.produit.e44cb6:Détails du produit`));

  pageSubtitle = computed(() => {
    const p = this.product();
    if (this.loading() || !p) return $localize`:@@products.product-detail.ts.consultation.des.informations.du.produit.ce34dc99:Consultation des informations du produit`;
    return `${p.code} · ${p.name}`;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.toastService.add({
        severity: 'error',
        summary: $localize`:@@product-detail.component.summary.Erreur:Erreur`,
        detail: $localize`:@@product-detail.component.detail.Produit_introuva:Produit introuvable`
      });
      void this.router.navigate(['/products']);
      return;
    }
    this.loadProduct(id);
  }

  isProductType(p: Product): boolean {
    return p.typeDisplay === 'Produit';
  }

  /** Resolves the preferred supplier's display name (best-effort; silent on failure). */
  private loadPreferredSupplierName(supplierId: string | null): void {
    this.preferredSupplierName.set(null);
    if (!supplierId) return;
    this.supplierService.getSupplier(supplierId).subscribe({
      next: res => this.preferredSupplierName.set(res.data?.name ?? null),
      error: () => this.preferredSupplierName.set(null)
    });
  }

  resolvedImageUrl(p: Product): string | null {
    return this.productService.resolveProductImageUrl(p.imageUrl ?? null);
  }

  vatLabel(rate: number): string {
    const opt = VAT_OPTIONS.find(o => o.value === rate);
    return opt?.label ?? `${rate}%`;
  }

  formatMoney(value: number | null | undefined): string {
    if (value == null) return '—';
    return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`;
  }

  calculateFodec(p: Product): number {
    return calculateFodecAmount(p.unitPrice || 0, p.isFodecApplicable ?? false);
  }

  calculateVat(p: Product): number {
    return calculateVatAmount(p.unitPrice || 0, this.calculateFodec(p), p.vatRate || 0);
  }

  calculateTtc(p: Product): number {
    return calculateSaleTtc(p.unitPrice || 0, p.vatRate || 0, p.isFodecApplicable ?? false);
  }

  readonly trackingModeLot = TRACKING_MODE_LOT;
  readonly formatTrackingModeLabel = formatTrackingModeLabel;
  readonly formatPickingPolicyLabel = formatPickingPolicyLabel;
  readonly formatCostingMethodLabel = formatCostingMethodLabel;

  showTraceabilitySummary(p: Product): boolean {
    return !!(p.trackingMode || p.costingMethod || p.hasExpiryTracking || p.pickingPolicy);
  }

  private loadProduct(id: string): void {
    this.loading.set(true);
    this.productService.getProduct(id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.product.set(response.data);
          this.loadPreferredSupplierName(response.data.preferredSupplierId ?? null);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-detail.component.summary.Erreur:Erreur`,
            detail: response.errors?.join(', ') || $localize`:@@products.product-detail.ts.impossible.de.charger.le.produit.7a00d1a4:Impossible de charger le produit`
          });
          void this.router.navigate(['/products']);
        }
        this.loading.set(false);
      },
      error: (error) => {
        const errorMessage = this.errorHandler.extractErrorMessage(error);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-detail.component.summary.Erreur:Erreur`,
          detail: errorMessage || $localize`:@@products.product-detail.ts.impossible.de.charger.le.produit.7a00d1a4:Impossible de charger le produit`
        });
        this.errorHandler.logError('Failed to load product', error);
        void this.router.navigate(['/products']);
        this.loading.set(false);
      }
    });
  }
}
