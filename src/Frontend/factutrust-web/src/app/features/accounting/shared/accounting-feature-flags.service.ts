import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'ft.accounting.featureFlags';

export interface AccountingFeatureFlags {
  /** Primitives UI partagées (filter bar, bannières) */
  sharedAccountingUi: boolean;
  /** Table shell avec overlay chargement sur écrans sensibles */
  tableShellOverlay: boolean;
  /** Journalisation console des erreurs comptables (dev / support) */
  consoleAccountingErrors: boolean;
  /** Sous-module immobilisations (registre + amortissements) */
  fixedAssetsEnabled: boolean;
  /**
   * Comptabilite multi-devises : catalogue des devises, taux de change, saisie et lettrage en
   * devise. A basculer CONJOINTEMENT avec le drapeau back `Accounting:MultiCurrencyEnabled` :
   * drapeau front seul, les ecrans s'ouvrent mais l'API refuse toute ecriture.
   */
  multiCurrencyEnabled: boolean;
  /**
   * Propositions de lettrage déterministes + lettrage en masse (Phase 3 de la refonte du
   * lettrage). Éteint par défaut : seuls les emplacements (placeholders) du nouvel écran de
   * lettrage sont visibles tant que le moteur de proposition (back) n'est pas livré.
   */
  letteringProposals: boolean;
}

const DEFAULT_FLAGS: AccountingFeatureFlags = {
  sharedAccountingUi: true,
  tableShellOverlay: true,
  consoleAccountingErrors: false,
  fixedAssetsEnabled: true,
  multiCurrencyEnabled: true,
  letteringProposals: false
};

@Injectable({ providedIn: 'root' })
export class AccountingFeatureFlagsService {
  private readonly _flags = signal<AccountingFeatureFlags>(this.load());

  readonly flags = this._flags.asReadonly();

  isEnabled<K extends keyof AccountingFeatureFlags>(key: K): boolean {
    return this._flags()[key];
  }

  setFlag<K extends keyof AccountingFeatureFlags>(key: K, value: AccountingFeatureFlags[K]): void {
    const next = { ...this._flags(), [key]: value };
    this._flags.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  reset(): void {
    this._flags.set({ ...DEFAULT_FLAGS });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private load(): AccountingFeatureFlags {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_FLAGS };
      const parsed = JSON.parse(raw) as Partial<AccountingFeatureFlags>;
      return { ...DEFAULT_FLAGS, ...parsed };
    } catch {
      return { ...DEFAULT_FLAGS };
    }
  }
}
