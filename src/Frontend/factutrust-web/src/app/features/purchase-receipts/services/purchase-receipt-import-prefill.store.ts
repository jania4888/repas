import { Injectable } from '@angular/core';
import { PurchaseReceiptImportProposal } from '../models/purchase-receipt-import.models';

export interface PurchaseReceiptImportPayload {
  proposal: PurchaseReceiptImportProposal;
  file: File;
}

/**
 * Relais transitoire en mémoire entre la modale d'import de document et le
 * formulaire de bon de réception.
 *
 * La modale dépose ici la proposition extraite puis navigue vers
 * /purchase-receipts/new. Le formulaire, dans ngOnInit, consomme la donnée
 * pour se pré-remplir.
 *
 * Consommation unique : `consume()` vide le store. Aucune persistance
 * (pas de localStorage/sessionStorage) : le fichier n'est pas sérialisable
 * et la proposition peut contenir des données commerciales sensibles.
 */
@Injectable({ providedIn: 'root' })
export class PurchaseReceiptImportPrefillStore {
  private pending: PurchaseReceiptImportPayload | null = null;

  /** Dépose une proposition d'import à appliquer au prochain chargement du formulaire. */
  set(payload: PurchaseReceiptImportPayload): void {
    this.pending = payload;
  }

  /** Récupère et efface la proposition en attente (null si aucune). */
  consume(): PurchaseReceiptImportPayload | null {
    const result = this.pending;
    this.pending = null;
    return result;
  }

  /** Efface la proposition en attente sans la consommer. */
  clear(): void {
    this.pending = null;
  }

  /** True si une proposition est en attente d'application. */
  get hasPending(): boolean {
    return this.pending !== null;
  }
}
