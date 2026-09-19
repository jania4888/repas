import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { ProductService, ProductListItem } from '@core/services/product.service';

export type BarcodeLookupStatus =
  | 'found'
  | 'not_found'
  | 'ambiguous'
  | 'inactive'
  | 'template'
  | 'not_stock_managed';

export interface BarcodeLookupResult {
  status: BarcodeLookupStatus;
  code: string;
  product: ProductListItem | null;
  /** Message prêt à afficher, vide lorsque la résolution a abouti. */
  message: string;
}

export interface BarcodeLookupOptions {
  /**
   * Autoriser le repli sur le code produit interne, en égalité STRICTE. Défaut `true`.
   *
   * Ce repli est intentionnel : beaucoup de catalogues n'ont pas encore de code-barres
   * renseigné, et la douchette y lit l'étiquette du code interne.
   */
  fallbackToExactInternalCode?: boolean;
  /** Entrepôt courant, transmis à la recherche de repli. */
  warehouseId?: string | null;
  /** Refuser un article désactivé. Défaut `true`. */
  requireActive?: boolean;
  /** Refuser un article non géré en stock (bons d'entrée/sortie, transferts). Défaut `false`. */
  requireStockManaged?: boolean;
}

/**
 * Résout un code scanné en article, pour tous les écrans.
 *
 * <p>
 * La correspondance est <b>exacte</b>, sur le code-barres puis, en repli, sur le code produit
 * interne. Aucune correspondance partielle : le scan interrogeait autrefois le code interne
 * avec un <c>includes</c> bidirectionnel, et scanner « 1234 » pouvait ajouter l'article
 * « 12345 » — en caisse, cela encaisse le mauvais article et fausse le stock.
 * </p>
 *
 * <p>
 * ⚠️ <b>L'article renvoyé ne porte pas de quantité disponible.</b> Il provient de
 * <c>GET by-barcode</c>, dont la réponse n'inclut pas le stock de l'entrepôt courant :
 * <c>quantityAvailable</c> y vaut toujours <c>null</c>, et <c>canSellProduct</c> laisse donc
 * passer. Tout appelant qui a besoin d'un contrôle de disponibilité doit le faire à partir de
 * ses propres données d'entrepôt, et surtout pas croire que ce service l'a fait pour lui.
 * </p>
 */
@Injectable({ providedIn: 'root' })
export class BarcodeLookupService {
  private readonly productService = inject(ProductService);

  resolve(code: string, options: BarcodeLookupOptions = {}): Observable<BarcodeLookupResult> {
    const trimmed = code.trim();

    if (!trimmed) {
      return of(this.failure('not_found', trimmed, 'Aucun code scanné.'));
    }

    return this.productService.getProductByBarcode(trimmed).pipe(
      map(response =>
        response.success && response.data
          ? this.evaluate(response.data, trimmed, options)
          : null
      ),
      catchError(() => of(null)),
      switchMap(result =>
        result ? of(result) : this.fallback(trimmed, options)
      )
    );
  }

  /**
   * Repli sur le code produit interne, en égalité STRICTE et insensible à la casse.
   *
   * Plusieurs correspondances signalent l'ambiguïté plutôt que d'en choisir une : au comptoir,
   * un choix arbitraire est pire qu'un refus explicite.
   */
  private fallback(
    code: string,
    options: BarcodeLookupOptions
  ): Observable<BarcodeLookupResult> {
    if (options.fallbackToExactInternalCode === false) {
      return of(this.failure('not_found', code, `Aucun article ne correspond au code « ${code} ».`));
    }

    return this.productService
      .getProducts({
        search: code,
        isActive: options.requireActive === false ? undefined : true,
        page: 1,
        pageSize: 10,
        warehouseId: options.warehouseId ?? undefined
      })
      .pipe(
        map(response => {
          if (!response.success || !response.data) {
            return this.failure('not_found', code, `Aucun article ne correspond au code « ${code} ».`);
          }

          const normalized = code.toLowerCase();
          const matches = response.data.items.filter(
            p => p.code.trim().toLowerCase() === normalized
          );

          if (matches.length === 1) return this.evaluate(matches[0], code, options);
          if (matches.length > 1) {
            return this.failure(
              'ambiguous',
              code,
              `Plusieurs articles portent le code « ${code} ». Choisissez-le dans la liste.`
            );
          }
          return this.failure('not_found', code, `Aucun article ne correspond au code « ${code} ».`);
        }),
        catchError(() =>
          of(this.failure('not_found', code, `Aucun article ne correspond au code « ${code} ».`))
        )
      );
  }

  /** Garde-fous métier communs à tous les écrans. */
  private evaluate(
    product: ProductListItem,
    code: string,
    options: BarcodeLookupOptions
  ): BarcodeLookupResult {
    if (product.isVariantTemplate) {
      return this.failure(
        'template',
        code,
        `« ${product.name} » est un modèle de variantes. Choisissez une variante (SKU).`
      );
    }

    if (options.requireActive !== false && !product.isActive) {
      return this.failure('inactive', code, `L'article « ${product.name} » est désactivé.`);
    }

    if (options.requireStockManaged === true && !product.isStockManaged) {
      return this.failure(
        'not_stock_managed',
        code,
        `L'article « ${product.name} » n'est pas géré en stock.`
      );
    }

    return { status: 'found', code, product, message: '' };
  }

  private failure(
    status: BarcodeLookupStatus,
    code: string,
    message: string
  ): BarcodeLookupResult {
    return { status, code, product: null, message };
  }
}
