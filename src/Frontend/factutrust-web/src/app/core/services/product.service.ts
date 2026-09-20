import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpContext } from '@angular/common/http';
import { SKIP_ERROR_TOAST } from '@core/http-context';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { ApiResponse } from './auth.service';

export interface Product {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** Product type display: Produit, Service */
  typeDisplay: string;
  /** Product category ID */
  categoryId: string;
  /** Product category name for display */
  category: string;
  unitPrice: number;
  purchasePrice?: number | null;
  lastPurchasePrice?: number | null;
  weightedAverageCost?: number | null;
  profitMarginPercent?: number | null;
  salePriceTtc?: number;
  unit: string;
  vatRate: number;
  isFodecApplicable?: boolean;
  isDiscountEnabled?: boolean;
  maxDiscountPercent?: number | null;
  isActive: boolean;
  isStockManaged: boolean;
  /** Code-barres de l'article. Distinct du code produit interne. */
  barcode?: string | null;
  /** Symbologie déduite du code-barres : Ean8, UpcA, Ean13, Gtin14, Code128. Lecture seule. */
  barcodeSymbology?: string | null;
  /** URL of product image (uploaded or from external search) */
  imageUrl?: string | null;
  /** Fournisseur préféré (réapprovisionnement) ; null = aucun. */
  preferredSupplierId?: string | null;
  /** Stock minimum sur l'entrepôt par défaut (optionnel). */
  minimumStock?: number | null;
  createdAt?: string;
  updatedAt?: string | null;
  parentProductId?: string | null;
  isVariantTemplate?: boolean;
  trackingMode?: number;
  hasExpiryTracking?: boolean;
  pickingPolicy?: number;
  costingMethod?: number;
  expiryAlertDays?: number | null;
}

export interface ProductListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** Product type display: Produit, Service */
  typeDisplay: string;
  /** Product category ID */
  categoryId: string;
  /** Product category name for display */
  category: string;
  unitPrice: number;
  purchasePrice?: number | null;
  lastPurchasePrice?: number | null;
  weightedAverageCost?: number | null;
  profitMarginPercent?: number | null;
  salePriceTtc?: number;
  unit: string;
  vatRate: number;
  isFodecApplicable?: boolean;
  isDiscountEnabled?: boolean;
  maxDiscountPercent?: number | null;
  isActive: boolean;
  isStockManaged: boolean;
  /** Code-barres de l'article. Distinct du code produit interne. */
  barcode?: string | null;
  /** URL of product image from external search (Unsplash/Google) */
  imageUrl?: string | null;
  /** Quantité disponible (entrepôt par défaut) ; null si pas de gestion de stock ou indisponible côté API */
  quantityAvailable?: number | null;
  isVariantTemplate?: boolean;
  parentProductId?: string | null;
  trackingMode?: number;
  costingMethod?: number;
}

/** Lightweight product DTO for autocomplete / select dropdowns (GET /products/select). */
export interface ProductSelectItem {
  id: string;
  code: string;
  name: string;
  unitPrice: number;
  purchasePrice?: number | null;
  vatRate: number;
  unit: string;
  isFodecApplicable: boolean;
  isDiscountEnabled: boolean;
  maxDiscountPercent: number | null;
  attributeSummary?: string | null;
  isVariantTemplate?: boolean;
  parentProductId?: string | null;
  /** Code-barres, pour résoudre un scan directement dans l'autocomplétion. */
  barcode?: string | null;
}

export interface ProductFodecFlag {
  id: string;
  isFodecApplicable: boolean;
}

export interface ProductSearchParams {
  search?: string;
  /** Filter by product type: Produit, Service */
  category?: string;
  /** Filter by product category (POS). Sent as categoryId to API. */
  productCategoryId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** When set, stock quantities reflect this warehouse (session context). */
  warehouseId?: string;
  excludeVariantTemplates?: boolean;
  parentProductId?: string;
  isVariantTemplate?: boolean;
  hasParentProduct?: boolean;
}

export interface CreateProductRequest {
  code: string;
  name: string;
  description?: string | null;
  /** Product type: Produit, Service (maps to backend Type enum) */
  category: string;
  /** Product category ID (Guid). Uses default if not provided */
  productCategoryId?: string;
  unitPrice: number;
  purchasePrice?: number | null;
  profitMarginPercent?: number | null;
  unit: string;
  vatRate: number;
  isStockManaged: boolean;
  isFodecApplicable?: boolean;
  isDiscountEnabled?: boolean;
  maxDiscountPercent?: number | null;
  /**
   * Code-barres de l'article. Chaîne vide ou null = aucun.
   *
   * ⚠️ Ce champ DOIT figurer dans la charge utile de mise à jour, même vide. Le serveur
   * applique `SetBarcode(dto.Barcode)` sans condition : omettre la clé revient à envoyer
   * null, donc à effacer le code-barres de l'article à chaque enregistrement de la fiche.
   */
  barcode?: string | null;
  /** Fournisseur préféré (optionnel) ; null/undefined = aucun. */
  preferredSupplierId?: string | null;
  /** Stock minimum sur l'entrepôt par défaut (optionnel). */
  minimumStock?: number | null;
  isVariantTemplate?: boolean;
  trackingMode?: number;
  hasExpiryTracking?: boolean;
  pickingPolicy?: number;
  costingMethod?: number;
  expiryAlertDays?: number | null;
}

export interface UpdateProductRequest extends CreateProductRequest {
  isActive: boolean;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private readonly API_URL = `${environment.apiUrl}/products`;
  private http = inject(HttpClient);

  getProducts(params: ProductSearchParams = {}): Observable<ApiResponse<PagedResult<ProductListItem>>> {
    let httpParams = new HttpParams();
    
    if (params.search) httpParams = httpParams.set('search', params.search);
    
    // Map category string to ProductType enum value
    // Frontend sends: "Produit" (0), "Service" (1), "Abonnement" (2)
    if (params.category) {
      let typeValue: number | null = null;
      if (params.category === 'Produit') {
        typeValue = 0; // ProductType.Product
      } else if (params.category === 'Service') {
        typeValue = 1; // ProductType.Service
      } else if (params.category === 'Abonnement') {
        typeValue = 2; // ProductType.Subscription
      }
      if (typeValue !== null) {
        httpParams = httpParams.set('type', typeValue.toString());
      }
    }
    
    if (params.productCategoryId) httpParams = httpParams.set('categoryId', params.productCategoryId);
    if (params.isActive !== undefined) httpParams = httpParams.set('isActive', params.isActive.toString());
    if (params.page) httpParams = httpParams.set('page', params.page.toString());
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize.toString());
    if (params.sortBy) httpParams = httpParams.set('sortBy', params.sortBy);
    if (params.sortOrder) httpParams = httpParams.set('sortOrder', params.sortOrder);
    if (params.warehouseId) httpParams = httpParams.set('warehouseId', params.warehouseId);
    if (params.excludeVariantTemplates) httpParams = httpParams.set('excludeVariantTemplates', 'true');
    if (params.parentProductId) httpParams = httpParams.set('parentProductId', params.parentProductId);
    if (params.isVariantTemplate !== undefined) {
      httpParams = httpParams.set('isVariantTemplate', params.isVariantTemplate.toString());
    }
    if (params.hasParentProduct !== undefined) {
      httpParams = httpParams.set('hasParentProduct', params.hasParentProduct.toString());
    }

    return this.http.get<ApiResponse<PagedResult<any>>>(this.API_URL, { params: httpParams }).pipe(
      map(response => {
        if (!response.success || !response.data) {
          return response as ApiResponse<PagedResult<ProductListItem>>;
        }

        // Map backend response to frontend format
        const mappedItems = response.data.items.map((item: any) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          description: item.description || null,
          typeDisplay: this.mapTypeToCategory(item.type),
          categoryId: item.categoryId ?? '',
          category: item.categoryName ?? 'general',
          unitPrice: item.unitPrice,
          purchasePrice: item.purchasePrice ?? null,
          lastPurchasePrice: item.lastPurchasePrice ?? null,
          weightedAverageCost: item.weightedAverageCost ?? null,
          profitMarginPercent: item.profitMarginPercent ?? null,
          salePriceTtc: item.salePriceTtc,
          unit: item.unit || 'Unité',
          vatRate: item.vatRatePercent || item.vatRate,
          isFodecApplicable: item.isFodecApplicable ?? false,
          isDiscountEnabled: item.isDiscountEnabled ?? false,
          maxDiscountPercent: item.maxDiscountPercent ?? null,
          isActive: item.isActive,
          isStockManaged: item.isStockManaged ?? false,
          imageUrl: item.imageUrl ?? null,
          isVariantTemplate: item.isVariantTemplate ?? false,
          parentProductId: item.parentProductId ?? null,
          trackingMode: item.trackingMode ?? 0,
          costingMethod: item.costingMethod ?? 0,
          quantityAvailable:
            item.isStockManaged && item.quantityAvailable != null
              ? Number(item.quantityAvailable)
              : null
        }));

        return {
          ...response,
          data: {
            ...response.data,
            items: mappedItems
          }
        } as ApiResponse<PagedResult<ProductListItem>>;
      })
    );
  }

  /**
   * Lightweight autocomplete search (GET /products/select).
   * No stock quantities, smaller payload than getProducts().
   */
  searchForSelect(params: {
    search?: string;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  } = {}): Observable<ApiResponse<PagedResult<ProductSelectItem>>> {
    let httpParams = new HttpParams();
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.isActive !== undefined) httpParams = httpParams.set('isActive', params.isActive.toString());
    if (params.page) httpParams = httpParams.set('page', params.page.toString());
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize.toString());

    return this.http.get<ApiResponse<PagedResult<any>>>(`${this.API_URL}/select`, { params: httpParams }).pipe(
      map(response => {
        if (!response.success || !response.data) {
          return response as ApiResponse<PagedResult<ProductSelectItem>>;
        }

        const mappedItems: ProductSelectItem[] = response.data.items.map((item: any) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          unitPrice: item.unitPrice,
          purchasePrice: item.purchasePrice ?? null,
          vatRate: item.vatRatePercent ?? item.vatRate ?? 19,
          unit: item.unit || 'Unité',
          isFodecApplicable: item.isFodecApplicable ?? false,
          isDiscountEnabled: item.isDiscountEnabled ?? false,
          maxDiscountPercent: item.maxDiscountPercent ?? null
        }));

        return {
          ...response,
          data: {
            ...response.data,
            items: mappedItems
          }
        } as ApiResponse<PagedResult<ProductSelectItem>>;
      })
    );
  }

  /**
   * Bulk FODEC flags for draft/import reload (POST /products/fodec-flags).
   */
  getFodecFlags(productIds: string[]): Observable<ApiResponse<ProductFodecFlag[]>> {
    return this.http.post<ApiResponse<ProductFodecFlag[]>>(`${this.API_URL}/fodec-flags`, {
      productIds
    });
  }

  private mapTypeToCategory(type: string | number): string {
    // Backend returns ProductType enum as string: "Product" or "Service"
    // Or as number: 0 = Product, 1 = Service
    if (type === 0 || type === '0' || type === 'Product' || type === 'PRODUCT') {
      return 'Produit';
    } else if (type === 1 || type === '1' || type === 'Service' || type === 'SERVICE') {
      return 'Service';
    }
    // Default fallback
    return 'Service';
  }

  getProduct(id: string): Observable<ApiResponse<Product>> {
    return this.http.get<ApiResponse<any>>(`${this.API_URL}/${id}`).pipe(
      map(response => {
        if (!response.success || !response.data) {
          return response as ApiResponse<Product>;
        }

        // Map backend response to frontend format
        const product: Product = {
          id: response.data.id,
          code: response.data.code,
          name: response.data.name,
          description: response.data.description || null,
          typeDisplay: this.mapTypeToCategory(response.data.type),
          categoryId: response.data.categoryId ?? '',
          category: response.data.categoryName ?? 'general',
          unitPrice: response.data.unitPrice,
          purchasePrice: response.data.purchasePrice ?? null,
          lastPurchasePrice: response.data.lastPurchasePrice ?? null,
          weightedAverageCost: response.data.weightedAverageCost ?? null,
          profitMarginPercent: response.data.profitMarginPercent ?? null,
          salePriceTtc: response.data.salePriceTtc,
          unit: response.data.unit || 'Unité',
          vatRate: response.data.vatRatePercent || response.data.vatRate,
          isFodecApplicable: response.data.isFodecApplicable ?? false,
          isDiscountEnabled: response.data.isDiscountEnabled ?? false,
          maxDiscountPercent: response.data.maxDiscountPercent ?? null,
          isActive: response.data.isActive,
          isStockManaged: response.data.isStockManaged ?? false,
          barcode: response.data.barcode ?? null,
          barcodeSymbology: response.data.barcodeSymbology ?? null,
          imageUrl: response.data.imageUrl ?? null,
          preferredSupplierId: response.data.preferredSupplierId ?? null,
          createdAt: response.data.createdAt,
          updatedAt: response.data.updatedAt,
          parentProductId: response.data.parentProductId ?? null,
          isVariantTemplate: response.data.isVariantTemplate ?? false,
          trackingMode: response.data.trackingMode ?? 0,
          hasExpiryTracking: response.data.hasExpiryTracking ?? false,
          pickingPolicy: response.data.pickingPolicy ?? 0,
          costingMethod: response.data.costingMethod ?? 0,
          expiryAlertDays: response.data.expiryAlertDays ?? null
        };

        return {
          ...response,
          data: product
        } as ApiResponse<Product>;
      })
    );
  }

  /**
   * Recherche un article par code-barres, en correspondance EXACTE côté serveur.
   *
   * Renvoie 404 si aucun article ne porte ce code — jamais un article approchant. C'est la
   * différence de fond avec l'ancien scan, qui interrogeait le code produit interne et
   * retombait sur une correspondance partielle, au risque d'encaisser le mauvais article.
   */
  getProductByBarcode(barcode: string): Observable<ApiResponse<ProductListItem>> {
    const encoded = encodeURIComponent(barcode.trim());
    return this.http
      .get<ApiResponse<any>>(`${this.API_URL}/by-barcode/${encoded}`, {
        // Un code inconnu est un cas nominal en caisse : le service le traite lui-même,
        // sans faire surgir de bandeau d'erreur global au caissier.
        context: new HttpContext().set(SKIP_ERROR_TOAST, true)
      })
      .pipe(
        map(response => {
          if (!response.success || !response.data) {
            return response as ApiResponse<ProductListItem>;
          }

          const d = response.data;
          const item: ProductListItem = {
            id: d.id,
            code: d.code,
            name: d.name,
            description: d.description ?? null,
            typeDisplay: this.mapTypeToCategory(d.type),
            categoryId: d.categoryId ?? '',
            category: d.categoryName ?? 'general',
            unitPrice: d.unitPrice,
            purchasePrice: d.purchasePrice ?? null,
            lastPurchasePrice: d.lastPurchasePrice ?? null,
            weightedAverageCost: d.weightedAverageCost ?? null,
            profitMarginPercent: d.profitMarginPercent ?? null,
            salePriceTtc: d.salePriceTtc,
            unit: d.unit || 'Unité',
            vatRate: d.vatRatePercent ?? d.vatRate,
            isFodecApplicable: d.isFodecApplicable ?? false,
            isDiscountEnabled: d.isDiscountEnabled ?? false,
            maxDiscountPercent: d.maxDiscountPercent ?? null,
            isActive: d.isActive,
            isStockManaged: d.isStockManaged ?? false,
            barcode: d.barcode ?? null,
            imageUrl: d.imageUrl ?? null,
            isVariantTemplate: d.isVariantTemplate ?? false,
            parentProductId: d.parentProductId ?? null,
            trackingMode: d.trackingMode ?? 0,
            costingMethod: d.costingMethod ?? 0
          };

          return { ...response, data: item } as ApiResponse<ProductListItem>;
        })
      );
  }

  createProduct(request: CreateProductRequest): Observable<ApiResponse<string>> {
    // Map category string to ProductType enum
    // Frontend: "Produit" (0), "Service" (1), "Abonnement" (2)
    let type: number;
    if (request.category === 'Produit') {
      type = 0; // ProductType.Product
    } else if (request.category === 'Abonnement') {
      type = 2; // ProductType.Subscription
    } else {
      type = 1; // ProductType.Service
    }

    const backendRequest = {
      code: request.code,
      name: request.name,
      description: request.description,
      type: type,
      categoryId: request.productCategoryId,
      unitPrice: request.unitPrice,
      purchasePrice: request.purchasePrice ?? undefined,
      profitMarginPercent: request.profitMarginPercent ?? undefined,
      vatRate: request.vatRate, // Backend expects VatRate enum value (0, 7, 13, 19)
      unit: request.unit,
      isStockManaged: request.isStockManaged,
      isFodecApplicable: request.isFodecApplicable ?? false,
      isDiscountEnabled: request.isDiscountEnabled ?? false,
      maxDiscountPercent: request.isDiscountEnabled ? request.maxDiscountPercent ?? undefined : undefined,
      barcode: request.barcode ?? null,
      preferredSupplierId: request.preferredSupplierId ?? undefined,
      isVariantTemplate: request.isVariantTemplate ?? false,
      trackingMode: request.trackingMode ?? 0,
      hasExpiryTracking: request.hasExpiryTracking ?? false,
      pickingPolicy: request.pickingPolicy ?? 0,
      costingMethod: request.costingMethod ?? 0,
      expiryAlertDays: request.expiryAlertDays ?? undefined
    };

    return this.http.post<ApiResponse<string>>(this.API_URL, backendRequest);
  }

  updateProduct(id: string, request: UpdateProductRequest): Observable<ApiResponse<Product>> {
    const backendRequest = {
      name: request.name,
      description: request.description,
      unitPrice: request.unitPrice,
      purchasePrice: request.purchasePrice ?? undefined,
      profitMarginPercent: request.profitMarginPercent ?? undefined,
      vatRate: request.vatRate, // Backend expects VatRate enum value (0, 7, 13, 19)
      unit: request.unit,
      isActive: request.isActive,
      isStockManaged: request.isStockManaged,
      isFodecApplicable: request.isFodecApplicable ?? false,
      isDiscountEnabled: request.isDiscountEnabled ?? false,
      maxDiscountPercent: request.isDiscountEnabled ? request.maxDiscountPercent ?? undefined : undefined,
      // Toujours transmis, y compris vide : le serveur applique SetBarcode(dto.Barcode) sans
      // condition, donc omettre la clé effacerait le code-barres à chaque enregistrement.
      barcode: request.barcode ?? null,
      categoryId: request.productCategoryId,
      preferredSupplierId: request.preferredSupplierId ?? null,
      isVariantTemplate: request.isVariantTemplate ?? false,
      trackingMode: request.trackingMode ?? 0,
      hasExpiryTracking: request.hasExpiryTracking ?? false,
      pickingPolicy: request.pickingPolicy ?? 0,
      costingMethod: request.costingMethod ?? 0,
      expiryAlertDays: request.expiryAlertDays ?? undefined
    };

    return this.http.put<ApiResponse<Product>>(`${this.API_URL}/${id}`, backendRequest);
  }

  deleteProduct(id: string): Observable<ApiResponse<object | null>> {
    const context = new HttpContext().set(SKIP_ERROR_TOAST, true);
    return this.http.delete<ApiResponse<object | null>>(`${this.API_URL}/${id}`, { context });
  }

  toggleActive(id: string): Observable<ApiResponse<Product>> {
    return this.http.patch<ApiResponse<Product>>(`${this.API_URL}/${id}/toggle-active`, {});
  }

  /**
   * Resolves relative product image URLs to absolute using the API origin.
   * Leaves data:, http:, and https: URLs unchanged.
   */
  resolveProductImageUrl(url: string | null | undefined): string | null {
    if (url == null || url === '') return null;
    if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
    try {
      const origin = new URL(environment.apiUrl).origin;
      return origin + (url.startsWith('/') ? url : '/' + url);
    } catch {
      return url;
    }
  }

  /**
   * Gets the product image URL. If the product has no cached image, the backend searches
   * external APIs (Unsplash, Google) and caches the result.
   */
  getProductImageUrl(productId: string): Observable<ApiResponse<string | null>> {
    return this.http.get<ApiResponse<string | null>>(`${this.API_URL}/${productId}/image-url`);
  }

  /**
   * Uploads a product image. Allowed: JPEG, PNG, WebP; max 2 MB.
   * Returns the absolute image URL for immediate display.
   */
  uploadProductImage(productId: string, file: File): Observable<ApiResponse<string>> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<ApiResponse<string>>(`${this.API_URL}/${productId}/image`, formData);
  }

  /**
   * Removes the product image.
   */
  deleteProductImage(productId: string): Observable<ApiResponse<object | null>> {
    return this.http.delete<ApiResponse<object | null>>(`${this.API_URL}/${productId}/image`);
  }

  listAttributes(): Observable<ApiResponse<ProductAttributeDto[]>> {
    return this.http.get<ApiResponse<ProductAttributeDto[]>>(`${this.API_URL}/attributes`);
  }

  getAttribute(id: string): Observable<ApiResponse<ProductAttributeDto>> {
    return this.http.get<ApiResponse<ProductAttributeDto>>(`${this.API_URL}/attributes/${id}`);
  }

  createAttribute(request: CreateProductAttributeRequest): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.API_URL}/attributes`, request);
  }

  updateAttribute(id: string, request: UpdateProductAttributeRequest): Observable<ApiResponse<ProductAttributeDto>> {
    return this.http.put<ApiResponse<ProductAttributeDto>>(`${this.API_URL}/attributes/${id}`, request);
  }

  deleteAttribute(id: string): Observable<ApiResponse<object>> {
    return this.http.delete<ApiResponse<object>>(`${this.API_URL}/attributes/${id}`);
  }

  addAttributeValue(
    definitionId: string,
    request: AddProductAttributeValueRequest
  ): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(
      `${this.API_URL}/attributes/${definitionId}/values`,
      request
    );
  }

  updateAttributeValue(
    definitionId: string,
    valueId: string,
    request: UpdateProductAttributeValueRequest
  ): Observable<ApiResponse<ProductAttributeValueDto>> {
    return this.http.put<ApiResponse<ProductAttributeValueDto>>(
      `${this.API_URL}/attributes/${definitionId}/values/${valueId}`,
      request
    );
  }

  deleteAttributeValue(definitionId: string, valueId: string): Observable<ApiResponse<object>> {
    return this.http.delete<ApiResponse<object>>(
      `${this.API_URL}/attributes/${definitionId}/values/${valueId}`
    );
  }

  generateVariants(
    productId: string,
    axes: { definitionId: string; valueIds: string[] }[]
  ): Observable<ApiResponse<string[]>> {
    return this.http.post<ApiResponse<string[]>>(`${this.API_URL}/${productId}/variants`, axes);
  }

  getProductVariants(
    parentId: string,
    page = 1,
    pageSize = 100,
    warehouseId?: string
  ): Observable<ApiResponse<PagedResult<ProductVariantChildDto>>> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('pageSize', pageSize.toString());
    if (warehouseId) params = params.set('warehouseId', warehouseId);
    return this.http.get<ApiResponse<PagedResult<ProductVariantChildDto>>>(
      `${this.API_URL}/${parentId}/variants`,
      { params }
    );
  }

  getProductVariantAxes(parentId: string): Observable<ApiResponse<ProductVariantAxisDto[]>> {
    return this.http.get<ApiResponse<ProductVariantAxisDto[]>>(
      `${this.API_URL}/${parentId}/variant-axes`
    );
  }

  getProductVariantProfile(productId: string): Observable<ApiResponse<ProductVariantProfileDto>> {
    return this.http.get<ApiResponse<ProductVariantProfileDto>>(
      `${this.API_URL}/${productId}/variant-profile`
    );
  }

  searchTemplatesForSelect(search?: string, pageSize = 50): Observable<ApiResponse<ProductSelectItem[]>> {
    let params = new HttpParams().set('pageSize', pageSize.toString());
    if (search) params = params.set('search', search);
    return this.http.get<ApiResponse<ProductSelectItem[]>>(`${this.API_URL}/templates/select`, { params });
  }

  /**
   * Demande au serveur un code-barres interne libre pour un article sans code fournisseur.
   *
   * Le code n'est PAS enregistré par cet appel : il est seulement proposé. C'est
   * l'enregistrement de la fiche qui le persiste, en repassant par les mêmes contrôles que
   * toute autre saisie. `excludeProductId` évite qu'une régénération sur une fiche existante
   * se heurte à son propre code.
   */
  generateProductBarcode(excludeProductId?: string): Observable<ApiResponse<GeneratedBarcode>> {
    let params = new HttpParams();
    if (excludeProductId) params = params.set('excludeProductId', excludeProductId);
    return this.http.post<ApiResponse<GeneratedBarcode>>(
      `${this.API_URL}/barcode/generate`, null, { params });
  }

  /**
   * Drapeaux de déploiement des codes-barres. Sert à ne pas offrir une saisie que le serveur
   * refuserait — la validation faisant autorité reste côté serveur.
   */
  getBarcodeFeatures(): Observable<ApiResponse<BarcodeFeatures>> {
    return this.http.get<ApiResponse<BarcodeFeatures>>(`${this.API_URL}/barcode-features`);
  }

  /** Gabarits de planches d'étiquettes proposés par le serveur. */
  getLabelLayouts(): Observable<ApiResponse<LabelLayout[]>> {
    return this.http.get<ApiResponse<LabelLayout[]>>(`${this.API_URL}/label-layouts`);
  }

  /**
   * Produit une planche d'étiquettes.
   *
   * POST et réponse binaire : la sélection peut porter plusieurs centaines d'identifiants,
   * qui n'ont rien à faire dans une URL, et la réponse est un PDF, pas du JSON.
   */
  exportProductLabels(request: ProductLabelRequest): Observable<Blob> {
    return this.http.post(`${this.API_URL}/labels/pdf`, request, { responseType: 'blob' });
  }

  bulkUpdateVariantPrices(
    parentId: string,
    request: BulkUpdateVariantPricesRequest
  ): Observable<ApiResponse<number>> {
    return this.http.patch<ApiResponse<number>>(
      `${this.API_URL}/${parentId}/variants/prices`,
      request
    );
  }

  createOpeningValuationLayer(productId: string, costingMethod: number): Observable<ApiResponse<object>> {
    return this.http.post<ApiResponse<object>>(`${this.API_URL}/${productId}/opening-valuation-layer`, {
      costingMethod
    });
  }
}

export interface ProductAttributeValueDto {
  id: string;
  code: string;
  name: string;
}

export interface ProductAttributeDto {
  id: string;
  code: string;
  name: string;
  values: ProductAttributeValueDto[];
}

export interface CreateProductAttributeRequest {
  code: string;
  name: string;
  values: { code: string; name: string }[];
}

export interface UpdateProductAttributeRequest {
  name: string;
  sortOrder?: number;
}

export interface AddProductAttributeValueRequest {
  code: string;
  name: string;
  sortOrder?: number;
}

export interface UpdateProductAttributeValueRequest {
  name: string;
  sortOrder?: number;
}

export interface ProductVariantAttributePairDto {
  definitionId: string;
  definitionCode: string;
  definitionName: string;
  valueId: string;
  valueCode: string;
  valueName: string;
  sortOrder: number;
}

export interface ProductVariantChildDto {
  id: string;
  code: string;
  name: string;
  unitPrice: number;
  purchasePrice?: number | null;
  salePriceTtc: number;
  barcode?: string | null;
  isActive: boolean;
  quantityAvailable?: number | null;
  attributes: ProductVariantAttributePairDto[];
}

export interface ProductVariantAxisDto {
  definitionId: string;
  code: string;
  name: string;
  sortOrder: number;
  selectedValueIds: string[];
}

export interface ProductVariantProfileDto {
  productId: string;
  parentProductId: string;
  parentCode: string;
  parentName: string;
  attributes: ProductVariantAttributePairDto[];
}

export interface BulkUpdateVariantPricesRequest {
  mode: 'absolute' | 'copyFromParent' | 'percentDelta';
  items?: { childId: string; unitPrice?: number; purchasePrice?: number; barcode?: string | null }[];
}

/** Code-barres proposé par le serveur, avec sa symbologie pour l'affichage. */
export interface GeneratedBarcode {
  barcode: string;
  symbology: string;
}

/** Drapeaux de déploiement des codes-barres exposés par le serveur. */
export interface BarcodeFeatures {
  extendedSymbologiesEnabled: boolean;
  labelPrintingEnabled: boolean;
}

/** Gabarit de planche d'étiquettes. */
export interface LabelLayout {
  key: string;
  label: string;
  labelsPerPage: number;
  isRoll: boolean;
}

/** Demande d'impression d'étiquettes. */
export interface ProductLabelRequest {
  layout: string;
  includePrice: boolean;
  includeCode: boolean;
  items: Array<{ productId: string; quantity: number }>;
}
