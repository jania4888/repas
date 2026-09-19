import { Injectable, inject, OnDestroy, signal } from '@angular/core';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import {
  BarcodeScannerService,
  ScannerRegistration
} from '@shared/services/barcode-scanner.service';
import { PosStateService } from './pos-state.service';
import { canSellProduct } from './pos-stock-guard';

export type BarcodeScanResult = 'added' | 'not_found' | 'multiple' | 'out_of_stock';

export interface BarcodeScanEvent {
  code: string;
  timestamp: number;
  result: BarcodeScanResult;
}

/**
 * Detects barcode scanner input (rapid keypresses ending with Enter)
 * and adds the matching product to the order.
 *
 * La détection clavier elle-même vit dans {@link BarcodeScannerService}, partagé avec les
 * écrans de document. Le point de vente garde la capture GLOBALE : il occupe l'écran entier
 * et n'a pas d'autre champ de saisie à protéger, contrairement aux grilles de lignes où un
 * champ de scan dédié est le seul moyen sûr de ne pas voler les frappes.
 */
@Injectable({
  providedIn: 'root'
})
export class PosBarcodeService implements OnDestroy {
  private readonly productService = inject(ProductService);
  private readonly warehouseContext = inject(WarehouseContextService);
  private readonly posState = inject(PosStateService);
  private readonly scanner = inject(BarcodeScannerService);

  readonly lastScannedCode = signal<string | null>(null);
  readonly lastScanResult = signal<BarcodeScanResult | null>(null);

  private registration: ScannerRegistration | null = null;

  startListening(): void {
    if (this.registration) return;

    this.registration = this.scanner.register({
      minLength: 3,
      bufferMs: 50,
      ignoreWhenFocusInEditable: true,
      onScan: code => {
        this.lastScannedCode.set(code);
        this.searchAndAdd(code);
      }
    });
  }

  stopListening(): void {
    this.registration?.unregister();
    this.registration = null;
  }

  ngOnDestroy(): void {
    this.stopListening();
  }

  /**
   * Résout un code scanné en article, en correspondance EXACTE sur le code-barres.
   *
   * L'implémentation précédente cherchait dans le CODE PRODUIT interne, puis retombait sur
   * un `includes()` bidirectionnel : scanner « 1234 » pouvait ajouter l'article « 12345 »,
   * et scanner « 12345 » l'article « 1234 ». En caisse, cela encaisse le mauvais article et
   * fausse le stock. On n'approxime plus : ce qui ne correspond pas échoue.
   *
   * Repli volontaire sur le code interne uniquement en correspondance STRICTE, pour les
   * catalogues dont les articles n'ont pas encore d'EAN renseigné.
   */
  private searchAndAdd(code: string): void {
    this.productService.getProductByBarcode(code).subscribe({
      next: response => {
        if (response.success && response.data) {
          this.tryAddScannedProduct(response.data);
          return;
        }
        this.fallbackToExactInternalCode(code);
      },
      error: () => this.fallbackToExactInternalCode(code)
    });
  }

  /**
   * Repli sur le code produit interne, en égalité STRICTE et insensible à la casse.
   * Aucune correspondance partielle : plusieurs candidats signalent l'ambiguïté au caissier
   * plutôt que d'en choisir un.
   */
  private fallbackToExactInternalCode(code: string): void {
    this.productService.getProducts({
      search: code,
      isActive: true,
      page: 1,
      pageSize: 10,
      warehouseId: this.warehouseContext.selectedWarehouseId() ?? undefined
    }).subscribe({
      next: response => {
        if (!response.success || !response.data) {
          this.lastScanResult.set('not_found');
          return;
        }

        const normalized = code.trim().toLowerCase();
        const matches = response.data.items.filter(
          p => p.code.trim().toLowerCase() === normalized
        );

        if (matches.length === 1) {
          this.tryAddScannedProduct(matches[0]);
        } else if (matches.length > 1) {
          this.lastScanResult.set('multiple');
        } else {
          this.lastScanResult.set('not_found');
        }
      },
      error: () => this.lastScanResult.set('not_found')
    });
  }

  /**
   * Recherche déclenchée depuis le catalogue. Même exigence d'exactitude que le scan.
   */
  searchByCode(code: string): void {
    this.lastScannedCode.set(code);
    this.searchAndAdd(code);
  }

  private tryAddScannedProduct(product: ProductListItem): void {
    if (!this.posState.isCreditNote()) {
      const currentQty = this.posState.lines().find(l => l.productId === product.id)?.quantity ?? 0;
      const check = canSellProduct(product, 1, currentQty);
      if (!check.ok) {
        this.posState.setError(check.message);
        this.lastScanResult.set('out_of_stock');
        return;
      }
    }
    this.posState.addProduct(product);
    this.lastScanResult.set('added');
  }
}
