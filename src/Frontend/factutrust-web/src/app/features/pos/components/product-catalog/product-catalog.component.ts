import { Component, inject, OnInit, OnDestroy, signal, computed, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, pairwise, filter, map, catchError } from 'rxjs/operators';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { StockService } from '@core/services/stock.service';
import { ProductCategoryService } from '@core/services/product-category.service';
import { ProductCardComponent } from '../product-card/product-card.component';
import { QuickAddModalComponent } from '../quick-add-modal/quick-add-modal.component';
import { PosFavoritesService } from '../../services/pos-favorites.service';
import { PosStockService } from '../../services/pos-stock.service';
import { PosStateService } from '../../services/pos-state.service';
import { canSellProduct } from '../../services/pos-stock-guard';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { VariantProductPickerComponent } from '@shared/components/variant-product-picker/variant-product-picker.component';
import { ProductSuggestion, suggestionToListItem } from '@shared/services/product-autocomplete.service';

interface CategoryTab {
  id: string;
  name: string;
  count: number;
}

@Component({
  selector: 'app-product-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductCardComponent, QuickAddModalComponent, VariantProductPickerComponent],
  template: `
    <div class="catalog">
      <!-- Search -->
      <div class="catalog__search">
        <div class="catalog__search-row">
          <div class="catalog__search-input-wrapper">
            <i class="pi pi-search catalog__search-icon"></i>
            <input
              #searchInput
              type="text"
              class="catalog__search-input"
              placeholder="Rechercher un produit (F2)" i18n-placeholder="@@pos.components.rechercher.un.produit.f2.a5e21a19"
              [ngModel]="searchQuery()"
              (ngModelChange)="onSearchChange($event)"
              (keydown.enter)="onSearchEnter($event)"
              aria-label="Rechercher un produit" i18n-aria-label="@@pos.components.rechercher.un.produit.3ce811dc" />
            @if (searchQuery()) {
              <button class="catalog__search-clear" (click)="clearSearch()" [attr.aria-label]="loc_effacer_la_recherche_189351">
                <i class="pi pi-times"></i>
              </button>
            }
          </div>
          <div class="catalog__search-actions">
            @if (isSpeechSupported()) {
              <button
                type="button"
                class="catalog__search-voice"
                [class.catalog__search-voice--listening]="listening()"
                (click)="toggleVoiceSearch()"
                [attr.aria-label]="listening() ? loc_ui_tern_arreter_la_recherche_vocale_00b388 : loc_ui_tern_recherche_vocale_c929e9">
                <i class="pi" [class.pi-microphone]="!listening()" [class.pi-stop]="listening()"></i>
              </button>
            }
            <button
              type="button"
              class="catalog__variant-btn"
              (click)="variantPickerVisible = true"
              title="Choisir une variante" i18n-title="@@pos.components.choisir.une.variante.c8ab137c"
              aria-label="Choisir une variante" i18n-aria-label="@@pos.components.choisir.une.variante.c8ab137c">
              <i class="pi pi-th-large"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Category Tabs -->
      <div class="catalog__categories" role="tablist" aria-label="Filtrer par categorie" i18n-aria-label="@@pos.components.filtrer.par.categorie.f4dcce51">
        <button
          class="catalog__category-tab"
          [class.catalog__category-tab--active]="selectedCategory() === 'all'"
          (click)="selectCategory('all')"
          role="tab"
          [attr.aria-selected]="selectedCategory() === 'all'">
          <span class="catalog__category-name" i18n="@@pos.components.tous.b97ae3b4">Tous</span>
          <span class="catalog__category-count">{{ totalCount() }}</span>
        </button>
        @if (favoritesService.favoriteIds().length > 0) {
          <button
            class="catalog__category-tab"
            [class.catalog__category-tab--active]="selectedCategory() === 'favorites'"
            (click)="selectCategory('favorites')"
            role="tab"
            [attr.aria-selected]="selectedCategory() === 'favorites'">
            <span class="catalog__category-name" i18n="@@pos.components.favoris.1020d908">Favoris</span>
            <span class="catalog__category-count">{{ favoritesService.favoriteIds().length }}</span>
          </button>
        }
        @if (favoritesService.recentProducts().length > 0) {
          <button
            class="catalog__category-tab"
            [class.catalog__category-tab--active]="selectedCategory() === 'recents'"
            (click)="selectCategory('recents')"
            role="tab"
            [attr.aria-selected]="selectedCategory() === 'recents'">
            <span class="catalog__category-name" i18n="@@pos.components.recents.84380106">Recents</span>
          </button>
        }
        @for (cat of categories(); track cat.id) {
          <button
            class="catalog__category-tab"
            [class.catalog__category-tab--active]="selectedCategory() === cat.id"
            (click)="selectCategory(cat.id)"
            role="tab"
            [attr.aria-selected]="selectedCategory() === cat.id">
            <span class="catalog__category-name">{{ cat.name }}</span>
          </button>
        }
      </div>

      <!-- Product Grid -->
      <div class="catalog__grid-container">
        @if (loading()) {
          <div class="catalog__grid">
            @for (i of [1,2,3,4,5,6]; track i) {
              <div class="catalog__skeleton">
                <div class="catalog__skeleton-image"></div>
                <div class="catalog__skeleton-text"></div>
                <div class="catalog__skeleton-text catalog__skeleton-text--short"></div>
              </div>
            }
          </div>
        } @else if (displayedProducts().length === 0) {
          <div class="catalog__empty catalog__empty--animated">
            <div class="catalog__empty-icon">
              <i class="pi pi-inbox"></i>
            </div>
            <p class="catalog__empty-title" i18n="@@pos.components.aucun.produit.trouve.1537e5ac">Aucun produit trouve</p>
            <p class="catalog__empty-text">
              @if (selectedCategory() === 'favorites') {<ng-container i18n="@@pos.components.ajoutez.des.produits.aux.favoris.en.cliq.db1dea04">
                Ajoutez des produits aux favoris en cliquant sur l'etoile.
              </ng-container>} @else if (selectedCategory() === 'recents') {<ng-container i18n="@@pos.components.les.produits.recemment.ajoutes.apparaiss.e506c4d5">
                Les produits recemment ajoutes apparaissent ici.
              </ng-container>} @else if (searchQuery()) {<ng-container i18n="@@pos.components.essayez.avec.d.autres.termes.de.recherch.b5975444">
                Essayez avec d'autres termes de recherche.
              </ng-container>} @else {<ng-container i18n="@@pos.components.aucun.produit.disponible.dans.cette.cate.e35ac279">
                Aucun produit disponible dans cette categorie.
              </ng-container>}
            </p>
            @if (searchQuery()) {
              <button class="catalog__empty-action" (click)="clearSearch()" i18n="@@pos.components.effacer.la.recherche.189351c0">Effacer la recherche</button>
            }
          </div>
        } @else {
          <div class="catalog__grid">
            @for (product of displayedProducts(); track product.id; let i = $index) {
              <div class="catalog__grid-item" [style.animation-delay]="(i * 40) + 'ms'">
                <app-product-card
                  [product]="product"
                  [stockAlert]="stockService.getCatalogAlert(product.id)"
                  [lastAddedProductId]="lastAddedProductId()"
                  (addToOrder)="onProductAddToOrder($event)"
                  (addToOrderWithQuantity)="handleProductAddWithQuantity($event)"
                  (openQuickAdd)="openQuickAddModal($event)" />
              </div>
            }
          </div>

          @if (hasMore() && selectedCategory() === 'all') {
            <div class="catalog__load-more">
              <button class="catalog__load-more-btn" (click)="loadMore()" [disabled]="loadingMore()">
                @if (loadingMore()) {
                  <i class="pi pi-spin pi-spinner"></i>
                } @else {<ng-container i18n="@@pos.components.afficher.plus.de.produits.033e0d1f">
                  Afficher plus de produits
                </ng-container>}
              </button>
            </div>
          }
        }
      </div>

      @if (quickAddProduct(); as product) {
        <app-quick-add-modal
          [product]="product"
          (confirm)="onQuickAddConfirmFromCatalog($event)"
          (cancel)="quickAddProduct.set(null)" />
      }

      <app-variant-product-picker
        [(visible)]="variantPickerVisible"
        (selected)="onVariantPicked($event)">
      </app-variant-product-picker>
    </div>
  `,
  styles: [`
    :host {
      flex: 1;
      min-height: 0;
      display: block;
    }

    .catalog {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    .catalog__search {
      padding: var(--spacing-5) var(--spacing-5);
      padding-bottom: var(--spacing-4);
      flex-shrink: 0;
    }

    .catalog__search-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .catalog__search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      background: var(--color-white);
      border-radius: 24px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.04);
      padding: 0 var(--spacing-2);
      transition: box-shadow 300ms ease;
    }

    .catalog__search-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      flex-shrink: 0;
    }

    .catalog__search-input-wrapper:focus-within {
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04);
    }

    .catalog__search-icon {
      position: absolute;
      inset-inline-start: var(--spacing-5);
      color: var(--color-text-tertiary);
      font-size: 1.15rem;
      pointer-events: none;
      transition: color 300ms ease, transform 300ms ease;
    }

    .catalog__search-input {
      width: 100%;
      height: 52px;
      padding-block: 0; padding-inline: 3.5rem var(--spacing-10);
      border: none;
      border-radius: 20px;
      font-size: var(--font-size-base);
      font-family: var(--font-family);
      color: var(--color-text-primary);
      background: transparent;
      transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .catalog__search-input:focus {
      outline: none;
    }

    .catalog__search-input::placeholder {
      color: var(--color-text-tertiary);
      font-style: italic;
    }

    .catalog__search-input-wrapper:focus-within .catalog__search-icon {
      color: var(--color-primary-500);
      transform: scale(1.08);
    }

    .catalog__search-clear {
      position: absolute;
      inset-inline-end: var(--spacing-3);
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-lg);
      background: transparent;
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: all 200ms ease;
      animation: catalogClearRotateIn 250ms ease-out forwards;
    }

    .catalog__search-clear:hover {
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);
    }

    .catalog__search-voice {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all 200ms ease;
      flex-shrink: 0;
    }

    .catalog__search-voice:hover {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }

    .catalog__search-voice--listening {
      background: var(--color-error-100);
      color: var(--color-error-600);
      animation: catalogVoicePulse 1s ease-in-out infinite;
    }

    @keyframes catalogVoicePulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.85; transform: scale(1.05); }
    }

    @keyframes catalogClearRotateIn {
      from {
        opacity: 0;
        transform: rotate(-90deg);
      }
      to {
        opacity: 1;
        transform: rotate(0);
      }
    }

    .catalog__variant-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all 200ms ease;
      flex-shrink: 0;
    }

    .catalog__variant-btn:hover {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }

    .catalog__variant-btn i {
      font-size: 1rem;
    }

    @media (max-width: 1024px) {
      .catalog__search {
        padding-inline-start: var(--spacing-4);
        padding-inline-end: var(--spacing-4);
      }

      .catalog__categories {
        padding-inline-start: var(--spacing-4);
        padding-inline-end: var(--spacing-4);
      }

      .catalog__grid-container {
        padding-inline-start: var(--spacing-4);
        padding-inline-end: var(--spacing-4);
      }
    }

    .catalog__categories {
      display: flex;
      gap: var(--spacing-2);
      padding: 0 var(--spacing-5);
      padding-bottom: var(--spacing-3);
      overflow-x: auto;
      flex-shrink: 0;
      scrollbar-width: none;
      mask-image: linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent);
      -webkit-mask-image: linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent);
    }

    .catalog__categories::-webkit-scrollbar {
      display: none;
    }

    .catalog__category-tab {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      min-height: 40px;
      height: 40px;
      padding: 0 var(--spacing-4);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-full);
      background: var(--color-white);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      font-family: var(--font-family);
      cursor: pointer;
      transition: background 200ms cubic-bezier(0.4, 0, 0.2, 1), color 200ms ease, border-color 200ms ease;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .catalog__category-tab:hover {
      background: var(--color-neutral-50);
      color: var(--color-text-primary);
      border-color: var(--color-border-strong);
    }

    .catalog__category-tab--active {
      border-color: transparent;
      background: #1e3a5f;
      color: var(--color-white);
      font-weight: var(--font-weight-semibold);
    }

    .catalog__category-tab--active:hover {
      background: #152a47;
      color: var(--color-white);
    }

    .catalog__category-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      font-size: 0.7rem;
      background: var(--color-neutral-200);
      color: var(--color-text-secondary);
      border-radius: var(--radius-full);
      font-weight: var(--font-weight-semibold);
    }

    .catalog__category-tab--active .catalog__category-count {
      background: rgba(255, 255, 255, 0.3);
      color: var(--color-white);
    }

    .catalog__grid-container {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      scrollbar-gutter: stable;
      padding: var(--spacing-2) var(--spacing-5) var(--spacing-4);
      scrollbar-width: thin;
      scrollbar-color: var(--color-neutral-300) transparent;
    }

    .catalog__grid-container::-webkit-scrollbar {
      width: 6px;
    }

    .catalog__grid-container::-webkit-scrollbar-track {
      background: transparent;
    }

    .catalog__grid-container::-webkit-scrollbar-thumb {
      background: var(--color-neutral-300);
      border-radius: var(--radius-full);
    }

    .catalog__grid-container::-webkit-scrollbar-thumb:hover {
      background: var(--color-neutral-400);
    }

    .catalog__grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: var(--spacing-5);
    }

    .catalog__grid-item {
      animation: fadeInUp 350ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
      opacity: 0;
    }

    .catalog__skeleton {
      background: var(--color-white);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      padding: var(--spacing-3);
    }

    .catalog__skeleton-image {
      width: 100%;
      aspect-ratio: 4 / 3;
      border-radius: var(--radius-lg);
      background: linear-gradient(110deg, var(--color-neutral-100) 25%, var(--color-neutral-50) 50%, var(--color-neutral-100) 75%);
      background-size: 200% 100%;
      animation: catalogShimmer 1.8s ease-in-out infinite;
      margin-bottom: var(--spacing-3);
    }

    .catalog__skeleton-text {
      height: 12px;
      border-radius: var(--radius-sm);
      background: linear-gradient(110deg, var(--color-neutral-100) 25%, var(--color-neutral-50) 50%, var(--color-neutral-100) 75%);
      background-size: 200% 100%;
      animation: catalogShimmer 1.8s ease-in-out infinite;
      margin-bottom: var(--spacing-2);
    }

    .catalog__skeleton-text--short {
      width: 60%;
    }

    .catalog__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12) var(--spacing-4);
      text-align: center;
    }

    .catalog__empty--animated {
      animation: fadeInUp 400ms ease-out forwards;
    }

    .catalog__empty-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 80px;
      height: 80px;
      border-radius: var(--radius-2xl);
      background: var(--color-neutral-100);
      color: var(--color-neutral-400);
      font-size: 2rem;
      margin-bottom: var(--spacing-5);
    }

    .catalog__empty-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
    }

    .catalog__empty-text {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      max-width: 280px;
      margin-bottom: var(--spacing-4);
    }

    .catalog__empty-action {
      padding: var(--spacing-2) var(--spacing-4);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-white);
      color: var(--color-primary-600);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      font-family: var(--font-family);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .catalog__empty-action:hover {
      background: var(--color-primary-50);
      border-color: var(--color-primary-300);
    }

    .catalog__load-more {
      display: flex;
      justify-content: center;
      padding: var(--spacing-4) 0;
    }

    .catalog__load-more-btn {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-5);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-white);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      font-family: var(--font-family);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .catalog__load-more-btn:hover:not(:disabled) {
      background: var(--color-neutral-50);
      border-color: var(--color-border-strong);
    }

    .catalog__load-more-btn:disabled {
      cursor: default;
      opacity: 0.7;
    }

    @keyframes catalogShimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    @media (max-width: 768px) {
      .catalog__grid {
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-3);
      }

      .catalog__search {
        padding-inline-start: var(--spacing-3);
        padding-inline-end: var(--spacing-3);
      }

      .catalog__categories {
        padding-inline-start: var(--spacing-3);
        padding-inline-end: var(--spacing-3);
      }

      .catalog__grid-container {
        padding: var(--spacing-2) var(--spacing-3) var(--spacing-3);
      }

      .catalog__category-tab {
        min-height: 44px;
        padding: 0 var(--spacing-4);
      }

      .catalog__search-input {
        height: 48px;
      }
    }
  `]
})
export class ProductCatalogComponent implements OnInit, OnDestroy {
  protected readonly loc_effacer_la_recherche_189351 = $localize`:@@pos.product-catalog.tpl.effacer.la.recherche.189351c0:Effacer la recherche`;

  readonly loc_ui_tern_arreter_la_recherche_vocale_00b388 = $localize`:@@ui.tern.arreter.la.recherche.vocale.00b388:Arreter la recherche vocale`;
  readonly loc_ui_tern_recherche_vocale_c929e9 = $localize`:@@ui.tern.recherche.vocale.c929e9:Recherche vocale`;
  @Output() onProductAdd = new EventEmitter<ProductListItem>();
  @Output() onProductAddWithQuantity = new EventEmitter<{ product: ProductListItem; quantity: number }>();
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  readonly favoritesService = inject(PosFavoritesService);
  readonly stockService = inject(PosStockService);
  private readonly coreStockService = inject(StockService);
  private readonly productService = inject(ProductService);
  private readonly categoryService = inject(ProductCategoryService);
  private readonly warehouseContext = inject(WarehouseContextService);
  private readonly posState = inject(PosStateService);

  products = signal<ProductListItem[]>([]);
  productCache = signal<Map<string, ProductListItem>>(new Map());
  categories = signal<CategoryTab[]>([]);
  searchQuery = signal('');
  selectedCategory = signal<string>('all');
  loading = signal(true);
  loadingMore = signal(false);
  totalCount = signal(0);
  hasMore = signal(false);
  readonly listening = signal(false);
  variantPickerVisible = false;
  quickAddProduct = signal<ProductListItem | null>(null);
  lastAddedProductId = signal<string | null>(null);
  private lastAddedTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private speechRecognition: { start(): void; stop(): void } | null = null;
  private voiceTimeoutId: ReturnType<typeof setTimeout> | null = null;

  displayedProducts = computed(() => {
    const cat = this.selectedCategory();
    if (cat === 'favorites') {
      const cache = this.productCache();
      const ids = this.favoritesService.favoriteIds();
      return ids.map(id => cache.get(id)).filter((p): p is ProductListItem => p != null);
    }
    if (cat === 'recents') {
      return this.favoritesService.recentProducts();
    }
    return this.products();
  });

  private currentPage = 1;
  private readonly pageSize = 30;
  private searchSubject = new Subject<string>();
  private subscriptions: Subscription[] = [];

  constructor() {
    toObservable(this.warehouseContext.selectedWarehouseId)
      .pipe(
        takeUntilDestroyed(),
        distinctUntilChanged(),
        pairwise(),
        filter(([a, b]) => a !== null && b !== null && a !== b)
      )
      .subscribe(() => {
        this.currentPage = 1;
        this.loadProducts();
      });
  }

  ngOnInit(): void {
    this.loadCategories();

    const searchSub = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(query => {
      this.searchQuery.set(query);
      this.currentPage = 1;
      this.loadProducts();
    });
    this.subscriptions.push(searchSub);

    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
    this.stopVoiceSearch();
    if (this.lastAddedTimeoutId) clearTimeout(this.lastAddedTimeoutId);
  }

  isSpeechSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
  }

  toggleVoiceSearch(): void {
    if (this.listening()) {
      this.stopVoiceSearch();
    } else {
      this.startVoiceSearch();
    }
  }

  private startVoiceSearch(): void {
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const SpeechRecognitionAPI = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: { results: { 0?: { 0?: { transcript?: string } } } }) => void;
      onerror: () => void;
      onend: () => void;
      start(): void;
      stop(): void;
    };
    this.speechRecognition = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'fr-FR';

    recognition.onresult = (event: unknown) => {
      const e = event as { results: { [i: number]: { [j: number]: { transcript?: string } } } };
      const transcript = e.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        this.onSearchChange(transcript);
        this.searchSubject.next(transcript);
        this.searchQuery.set(transcript);
        this.currentPage = 1;
        this.loadProducts();
      }
      this.stopVoiceSearch();
    };

    recognition.onerror = () => this.stopVoiceSearch();
    recognition.onend = () => this.stopVoiceSearch();

    this.listening.set(true);
    recognition.start();
    this.voiceTimeoutId = setTimeout(() => this.stopVoiceSearch(), 5000);
  }

  private stopVoiceSearch(): void {
    if (this.voiceTimeoutId) {
      clearTimeout(this.voiceTimeoutId);
      this.voiceTimeoutId = null;
    }
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {
        // ignore
      }
      this.speechRecognition = null;
    }
    this.listening.set(false);
  }

  focusSearch(): void {
    this.searchInput?.nativeElement?.focus();
  }

  onSearchChange(value: string): void {
    this.searchSubject.next(value);
  }

  onSearchEnter(event: Event): void {
    event.preventDefault();
    const query = this.searchQuery().trim();
    if (!query) return;
    const products = this.displayedProducts();
    if (products.length === 1) {
      const product = products[0];
      if (product.code.toLowerCase() === query.toLowerCase()) {
        this.onProductAddToOrder(product);
        this.clearSearch();
        return;
      }
    }
  }

  clearSearch(): void {
    this.searchSubject.next('');
    this.searchInput?.nativeElement?.focus();
  }

  handleProductAddWithQuantity(event: { product: ProductListItem; quantity: number }): void {
    if (!this.guardCatalogAdd(event.product, event.quantity)) return;
    this.onProductAddWithQuantity.emit(event);
  }

  openQuickAddModal(product: ProductListItem): void {
    if (!this.guardCatalogAdd(product, 1)) return;
    this.quickAddProduct.set(product);
  }

  onQuickAddConfirmFromCatalog(event: { product: ProductListItem; quantity: number }): void {
    if (!this.guardCatalogAdd(event.product, event.quantity)) return;
    this.quickAddProduct.set(null);
    this.favoritesService.addRecent(event.product);
    this.lastAddedProductId.set(event.product.id);
    this.onProductAddWithQuantity.emit(event);
    if (this.lastAddedTimeoutId) clearTimeout(this.lastAddedTimeoutId);
    this.lastAddedTimeoutId = setTimeout(() => {
      this.lastAddedProductId.set(null);
      this.lastAddedTimeoutId = null;
    }, 600);
  }

  onProductAddToOrder(product: ProductListItem): void {
    if (!this.guardCatalogAdd(product, 1)) return;
    this.productCache.update(cache => {
      const next = new Map(cache);
      next.set(product.id, product);
      return next;
    });
    this.onProductAdd.emit(product);
  }

  private guardCatalogAdd(product: ProductListItem, extraQty: number): boolean {
    if (this.posState.isCreditNote()) return true;
    const currentQty = this.posState.lines().find(l => l.productId === product.id)?.quantity ?? 0;
    const check = canSellProduct(product, extraQty, currentQty);
    if (check.ok) return true;
    this.posState.setError(check.message);
    return false;
  }

  onVariantPicked(suggestion: ProductSuggestion): void {
    const product = suggestionToListItem(suggestion);
    this.onProductAddToOrder(product);
  }

  searchWithCode(code: string): void {
    this.searchSubject.next(code);
    this.searchQuery.set(code);
    this.currentPage = 1;
    this.loadProducts();
    setTimeout(() => this.searchInput?.nativeElement?.focus(), 100);
  }

  selectCategory(categoryId: string): void {
    this.selectedCategory.set(categoryId);
    this.currentPage = 1;
    if (categoryId !== 'favorites' && categoryId !== 'recents') {
      this.loadProducts();
    }
  }

  loadMore(): void {
    this.currentPage++;
    this.loadProducts(true);
  }

  /** Fusionne les quantités serveur dans la grille, le cache favoris et les récents. */
  applyStockQuantitiesFromDetails(updates: Map<string, number>): void {
    if (updates.size === 0) return;
    this.products.update(list =>
      list.map(p => {
        if (!p.isStockManaged) return p;
        const q = updates.get(p.id);
        return q === undefined ? p : { ...p, quantityAvailable: q };
      })
    );
    this.productCache.update(cache => {
      const next = new Map(cache);
      for (const [id, q] of updates) {
        const existing = next.get(id);
        if (existing?.isStockManaged) {
          next.set(id, { ...existing, quantityAvailable: q });
        }
      }
      return next;
    });
    this.favoritesService.patchQuantitiesInRecents(updates);
  }

  /**
   * Après validation d'une facture POS : relecture des quantités via l'API (requestedQuantity 0).
   */
  refreshStockAfterSale(soldProductIds: string[]): void {
    const unique = [...new Set(soldProductIds.filter(id => !!id))];
    if (unique.length === 0) return;
    const warehouseId = this.warehouseContext.selectedWarehouseId() ?? undefined;
    const items = unique.map(productId => ({ productId, requestedQuantity: 0 }));
    this.coreStockService.checkAvailability(items, warehouseId).pipe(
      map(res => {
        const data = res?.data;
        if (!data?.details?.length) return null;
        const updates = new Map<string, number>();
        for (const d of data.details) {
          if (d.isStockManaged) {
            updates.set(d.productId, Number(d.availableQuantity));
          }
        }
        return updates.size > 0 ? updates : null;
      }),
      catchError(err => {
        console.error('POS: refresh stock after sale failed', err);
        return of(null);
      })
    ).subscribe(updates => {
      if (updates) this.applyStockQuantitiesFromDetails(updates);
    });
  }

  private loadProducts(append = false): void {
    if (append) {
      this.loadingMore.set(true);
    } else {
      this.loading.set(true);
    }

    const cat = this.selectedCategory();
    const productCategoryId = (cat !== 'all' && cat !== 'favorites' && cat !== 'recents') ? cat : undefined;

    this.productService.getProducts({
      search: this.searchQuery() || undefined,
      productCategoryId,
      isActive: true,
      excludeVariantTemplates: true,
      page: this.currentPage,
      pageSize: this.pageSize,
      warehouseId: this.warehouseContext.selectedWarehouseId() ?? undefined
    }).subscribe({
      next: response => {
        if (response.success && response.data) {
          const items = response.data.items;
          this.productCache.update(cache => {
            const next = new Map(cache);
            items.forEach(p => next.set(p.id, p));
            return next;
          });
          if (append) {
            this.products.update(prev => [...prev, ...items]);
          } else {
            this.products.set(items);
          }
          this.totalCount.set(response.data.totalCount);
          this.hasMore.set(response.data.hasNextPage);
        }
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadingMore.set(false);
      }
    });
  }

  private loadCategories(): void {
    this.categoryService.getCategoryOptionsForDropdown().subscribe(options => {
      this.categories.set(options.map(o => ({
        id: o.value,
        name: o.label,
        count: 0
      })));
    });
  }
}
