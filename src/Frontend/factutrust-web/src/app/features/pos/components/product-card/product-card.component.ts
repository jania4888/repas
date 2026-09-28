import { Component, Input, Output, EventEmitter, signal, computed, inject, OnInit, OnDestroy, AfterViewInit, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductListItem, ProductService } from '@core/services/product.service';
import { PosFavoritesService } from '../../services/pos-favorites.service';
import { ProductStockAlert } from '../../services/pos-stock.service';
import { PosStateService } from '../../services/pos-state.service';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="product-card-wrap">
      <button
        class="product-card__favorite"
        (click)="toggleFavorite($event)"
        [attr.aria-label]="isFavorite() ? loc_ui_tern_retirer_des_favoris_dcaac8 : loc_ui_tern_ajouter_aux_favoris_721554"
        [title]="isFavorite() ? loc_ui_tern_retirer_des_favoris_dcaac8 : loc_ui_tern_ajouter_aux_favoris_721554"
        type="button">
        <i [class]="isFavorite() ? 'pi pi-star-fill' : 'pi pi-star'"></i>
      </button>

      <button
        class="product-card"
        [class.product-card--added]="justAdded()"
        [class.product-card--disabled]="isAddDisabled()"
        [attr.aria-disabled]="isAddDisabled() ? 'true' : null"
        (click)="onCardClick()"
        (dblclick)="onCardDblClick()"
        [attr.aria-label]="cardAriaLabel()"
        type="button">

      @if (showRuptureStockBadge()) {
        <span class="product-card__stock-badge product-card__stock-badge--insufficient" i18n="@@pos.components.rupture.fda77001">Rupture</span>
      }
      @if (showLowStockBadge()) {
        <span class="product-card__stock-badge product-card__stock-badge--warning" i18n="@@pos.components.stock.faible.051fbda0">Stock faible</span>
      }

      <div class="product-card__image">
        @if (displayImageUrl() && !imageError()) {
          <img
            [src]="displayImageUrl()"
            [attr.alt]="product.name"
            loading="lazy"
            (error)="onImageError()"
            class="product-card__img" />
        } @else {
          <div class="product-card__placeholder">
            <i [class]="product.typeDisplay === 'Service' ? 'pi pi-cog' : 'pi pi-box'"></i>
          </div>
        }
        <div class="product-card__add-badge" [class.visible]="justAdded()">
          <i class="pi pi-check"></i>
        </div>
      </div>

      <div class="product-card__info">
        <span class="product-card__name" [title]="product.name">{{ product.name }}</span>
        <span class="product-card__code">{{ product.code }}</span>
        @if (product.isStockManaged && product.quantityAvailable != null) {
          <span class="product-card__stock-line" aria-hidden="true"><ng-container i18n="@@pos.components.dispo.47531188">
            Dispo : {{ formatQuantity(product.quantityAvailable) }}
            </ng-container>@if (product.unit) {
              <span class="product-card__stock-unit">{{ product.unit }}</span>
            }
          </span>
        }
      </div>

      <div class="product-card__footer">
        <span class="product-card__category">{{ product.category }}</span>
        <span class="product-card__price">{{ formatPrice(product.unitPrice) }}</span>
      </div>
    </button>
    </div>
  `,
  styles: [`
    .product-card-wrap {
      position: relative;
      width: 100%;
    }

    .product-card {
      display: flex;
      flex-direction: column;
      width: 100%;
      background: #faf8f5;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-3);
      cursor: pointer;
      transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 300ms ease, border-color 300ms ease;
      text-align: start;
      position: relative;
      overflow: hidden;
      font-family: var(--font-family);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .product-card:hover {
      will-change: transform;
      border-color: var(--color-neutral-300);
      box-shadow: 0 12px 24px -4px rgba(0, 0, 0, 0.1), 0 4px 8px -2px rgba(0, 0, 0, 0.06);
      transform: translateY(-4px);
    }

    .product-card:active {
      transform: translateY(-1px) scale(0.97);
      box-shadow: var(--shadow-md);
    }

    .product-card--added {
      border-color: var(--color-success-500);
      box-shadow: 0 0 0 2px var(--color-success-200);
    }

    .product-card--disabled {
      opacity: 0.65;
      cursor: not-allowed;
      filter: grayscale(0.25);
    }

    .product-card--disabled:hover {
      transform: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      border-color: var(--color-neutral-200);
    }

    .product-card--disabled:hover .product-card__image::before {
      opacity: 0;
    }

    .product-card--disabled:active {
      transform: none;
    }

    .product-card__image {
      position: relative;
      width: 100%;
      aspect-ratio: 5 / 4;
      border-radius: 16px;
      overflow: hidden;
      margin-bottom: var(--spacing-2);
      background: linear-gradient(135deg, var(--color-neutral-100) 0%, var(--color-neutral-50) 50%, var(--color-neutral-100) 100%);
    }

    .product-card__image::before {
      content: '+';
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(37, 99, 235, 0.1);
      font-size: 2rem;
      font-weight: var(--font-weight-bold);
      color: var(--color-primary-600);
      opacity: 0;
      transition: opacity 300ms ease;
      pointer-events: none;
      z-index: 1;
    }

    .product-card:hover .product-card__image::before {
      opacity: 1;
    }

    .product-card__image::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.03) 100%);
      pointer-events: none;
    }

    .product-card__img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .product-card__placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, var(--color-neutral-50) 0%, var(--color-neutral-100) 100%);
    }

    .product-card__placeholder i {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: var(--radius-full);
      background: var(--color-white);
      color: var(--color-text-tertiary);
      font-size: 1.5rem;
      box-shadow: var(--shadow-sm);
    }

    .product-card__add-badge {
      position: absolute;
      top: 8px;
      inset-inline-end: 8px;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      background: var(--color-success-600);
      color: var(--color-white);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8rem;
      opacity: 0;
      transform: scale(0.4);
      transition: all var(--transition-bounce);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
      z-index: 2;
    }

    .product-card__add-badge.visible {
      opacity: 1;
      transform: scale(1);
      animation: productCardBadgePulse 600ms ease-out;
    }

    @keyframes productCardBadgePulse {
      0% { transform: scale(0.4); opacity: 0; }
      60% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }

    .product-card__info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: var(--spacing-2);
      min-height: 2.75rem;
    }

    .product-card__name {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .product-card__code {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      font-variant-numeric: tabular-nums;
    }

    .product-card__stock-line {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      font-variant-numeric: tabular-nums;
      margin-top: 2px;
    }

    .product-card__stock-unit {
      margin-inline-start: 0.25rem;
      color: var(--color-text-tertiary);
      font-weight: var(--font-weight-regular);
    }

    .product-card__footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-2);
      padding-top: var(--spacing-2);
      border-top: 1px solid var(--color-neutral-100);
    }

    .product-card__category {
      font-size: 0.65rem;
      font-weight: var(--font-weight-medium);
      color: var(--color-white);
      background: #166534;
      padding: 3px 8px;
      border-radius: var(--radius-full);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 50%;
    }

    .product-card__price {
      font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
      font-variant-numeric: tabular-nums;
      font-size: 1.0625rem;
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      white-space: nowrap;
      transition: color 300ms ease;
    }

    .product-card:hover .product-card__price {
      color: var(--color-primary-600);
    }

    .product-card__favorite {
      position: absolute;
      top: 8px;
      inset-inline-start: 8px;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-full);
      background: rgba(255, 255, 255, 0.9);
      color: var(--color-neutral-400);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 11;
      transition: all 200ms ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .product-card__favorite:hover {
      background: var(--color-white);
      color: #eab308;
      transform: scale(1.1);
    }

    .product-card__favorite i {
      font-size: 0.9rem;
    }

    .product-card__favorite:has(.pi-star-fill) {
      color: #eab308;
    }

    .product-card__stock-badge {
      position: absolute;
      top: 8px;
      inset-inline-end: 44px;
      padding: 4px 8px;
      border-radius: var(--radius-full);
      font-size: 0.65rem;
      font-weight: var(--font-weight-semibold);
      z-index: 5;
    }

    .product-card__stock-badge--warning {
      background: rgba(234, 179, 8, 0.95);
      color: #1a1a1a;
    }

    .product-card__stock-badge--insufficient {
      background: rgba(220, 38, 38, 0.95);
      color: var(--color-white);
    }
  `]
})
export class ProductCardComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
  readonly loc_ui_tern_retirer_des_favoris_dcaac8 = $localize`:@@ui.tern.retirer.des.favoris.dcaac8:Retirer des favoris`;
  readonly loc_ui_tern_ajouter_aux_favoris_721554 = $localize`:@@ui.tern.ajouter.aux.favoris.721554:Ajouter aux favoris`;
  @Input({ required: true }) product!: ProductListItem;
  @Input() loadImageOnDemand = true;
  @Input() stockAlert: ProductStockAlert | null = null;
  @Input() lastAddedProductId: string | null = null;
  @Output() addToOrder = new EventEmitter<ProductListItem>();
  @Output() addToOrderWithQuantity = new EventEmitter<{ product: ProductListItem; quantity: number }>();
  @Output() openQuickAdd = new EventEmitter<ProductListItem>();

  private readonly productService = inject(ProductService);
  private readonly favoritesService = inject(PosFavoritesService);
  private readonly posState = inject(PosStateService);
  private readonly elementRef = inject(ElementRef);

  private justAddedSignal = signal(false);
  justAdded = computed(() => this.justAddedSignal() || this.lastAddedProductId === this.product.id);
  displayImageUrl = signal<string | null>(null);
  imageError = signal(false);
  private addTimeout?: ReturnType<typeof setTimeout>;
  private intersectionObserver?: IntersectionObserver;
  private loadRequested = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['product'] && this.product) {
      const url = this.productService.resolveProductImageUrl(this.product.imageUrl ?? null);
      this.displayImageUrl.set(url);
      this.imageError.set(false);
      if (url) this.loadRequested = true;
    }
  }

  ngOnInit(): void {
    if (this.product) {
      const url = this.productService.resolveProductImageUrl(this.product.imageUrl ?? null);
      this.displayImageUrl.set(url);
      this.imageError.set(false);
      if (url) this.loadRequested = true;
    }
  }

  ngAfterViewInit(): void {
    if (!this.loadImageOnDemand || this.loadRequested || this.displayImageUrl()) return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !this.loadRequested) {
          this.loadRequested = true;
          this.loadImageOnDemandAsync();
        }
      },
      { rootMargin: '50px', threshold: 0.01 }
    );
    const container = this.elementRef.nativeElement.querySelector('.product-card__image');
    if (container) this.intersectionObserver.observe(container);
  }

  ngOnDestroy(): void {
    this.intersectionObserver?.disconnect();
  }

  private loadImageOnDemandAsync(): void {
    this.productService.getProductImageUrl(this.product.id).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          const url = this.productService.resolveProductImageUrl(res.data);
          if (url) {
            this.displayImageUrl.set(url);
            this.imageError.set(false);
          }
        }
      }
    });
  }

  onImageError(): void {
    this.imageError.set(true);
    this.displayImageUrl.set(null);
  }

  isFavorite(): boolean {
    return this.favoritesService.isFavorite(this.product.id);
  }

  toggleFavorite(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.favoritesService.toggleFavorite(this.product.id);
  }

  onCardClick(): void {
    if (this.isAddDisabled()) return;
    if (this.addTimeout) clearTimeout(this.addTimeout);
    this.addTimeout = setTimeout(() => this.onAdd(), 250);
  }

  onCardDblClick(): void {
    if (this.isAddDisabled()) return;
    if (this.addTimeout) {
      clearTimeout(this.addTimeout);
      this.addTimeout = undefined;
    }
    this.openQuickAdd.emit(this.product);
  }

  onAdd(): void {
    this.addToOrder.emit(this.product);
    this.favoritesService.addRecent(this.product);
    this.justAddedSignal.set(true);
    if (this.addTimeout) clearTimeout(this.addTimeout);
    this.addTimeout = setTimeout(() => this.justAddedSignal.set(false), 600);
  }

  formatPrice(price: number): string {
    return price.toLocaleString('fr-TN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }) + $localize`:@@ui.tern.tnd.9aaf5c: TND`;
  }

  formatQuantity(value: number): string {
    return value.toLocaleString('fr-TN', {
      maximumFractionDigits: 3,
      minimumFractionDigits: 0
    });
  }

  cardAriaLabel(): string {
    const base = $localize`:@@pos.product-card.ts.ajouter.name.au.panier.6b783056:Ajouter ${this.product.name}:name: au panier`;
    if (this.isAddDisabled()) {
      return $localize`:@@pos.product-card.ts.name.indisponible.rupture.de.stock.4c6fbcc6:${this.product.name}:name: indisponible, rupture de stock`;
    }
    if (this.product.isStockManaged && this.product.quantityAvailable != null) {
      const n = this.product.quantityAvailable;
      const unitPart = this.product.unit ? ` ${this.product.unit}` : '';
      if (n === 0) {
        return $localize`:@@pos.product-card.ts.base.rupture.de.stock.ef232cff:${base}:base:, rupture de stock`;
      }
      let label = $localize`:@@pos.product-card.ts.base.stock.disponible.formatquantity.uni.a2bed4d7:${base}:base:, stock disponible : ${this.formatQuantity(n)}:formatQuantity:${unitPart}:unitPart:`;
      if (this.showLowStockBadge()) {
        label += $localize`:@@pos.product-card.ts.stock.faible.280678dd:, stock faible`;
      }
      return label;
    }
    return base;
  }

  isAddDisabled(): boolean {
    return this.showRuptureStockBadge() && !this.posState.isCreditNote();
  }

  /** Aligné sur la quantité affichée (entrepôt par défaut), pas sur les alertes multi-entrepôts. */
  showRuptureStockBadge(): boolean {
    return (
      this.product.isStockManaged &&
      this.product.quantityAvailable != null &&
      this.product.quantityAvailable === 0
    );
  }

  showLowStockBadge(): boolean {
    const q = this.product.quantityAvailable;
    return (
      this.product.isStockManaged &&
      q != null &&
      q > 0 &&
      this.stockAlert?.alertLevel === 'warning'
    );
  }
}
