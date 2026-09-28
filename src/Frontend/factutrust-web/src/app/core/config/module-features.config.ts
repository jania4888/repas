import { AppModule } from '@core/models/app-module';
import type { UserModuleAccessItem } from '@core/services/tenant-users.service';

export interface ModuleFeatureOption {
  key: string;
  label: string;
}

/** Mirrors backend <c>ModuleFeatureCatalog</c> keys + French labels for the UI. */
const MODULE_FEATURE_OPTIONS: Record<AppModule, ModuleFeatureOption[]> = {
  [AppModule.Clients]: [
    { key: 'read', label: $localize`:@@core.module-features.ts.consultation.54b87b92:Consultation` },
    { key: 'manage', label: $localize`:@@core.module-features.ts.creation.modification.suppression.7b9b9ec6:Création / modification / suppression` }
  ],
  [AppModule.Products]: [
    { key: 'read', label: $localize`:@@core.module-features.ts.consultation.54b87b92:Consultation` },
    { key: 'manage', label: $localize`:@@core.module-features.ts.creation.modification.suppression.7b9b9ec6:Création / modification / suppression` }
  ],
  [AppModule.Sales]: [
    { key: 'sales_orders', label: $localize`:@@core.module-features.ts.commandes.clients.928f824a:Commandes clients` },
    { key: 'quotes', label: $localize`:@@core.module-features.ts.devis.f7622f90:Devis` },
    { key: 'delivery_notes', label: $localize`:@@core.module-features.ts.bons.de.livraison.a283129d:Bons de livraison` },
    { key: 'return_notes', label: $localize`:@@core.module-features.ts.bons.de.retour.d9f7ad6c:Bons de retour` },
    { key: 'invoices', label: $localize`:@@core.module-features.ts.factures.da35e4f2:Factures` },
    { key: 'pricing', label: $localize`:@@core.module-features.ts.tarification.5dc310ae:Tarification` }
  ],
  [AppModule.Treasury]: [
    { key: 'read', label: $localize`:@@core.module-features.ts.consultation.54b87b92:Consultation` },
    { key: 'manage', label: $localize`:@@core.module-features.ts.saisie.et.mise.a.jour.a1590232:Saisie et mise à jour` },
    { key: 'forecast_read', label: $localize`:@@core.module-features.ts.tresorerie.previsionnelle.consultation.5aa48958:Trésorerie prévisionnelle — consultation` },
    { key: 'forecast_manage', label: $localize`:@@core.module-features.ts.tresorerie.previsionnelle.recalcul.et.en.c98680fb:Trésorerie prévisionnelle — recalcul et engagements` }
  ],
  [AppModule.Reports]: [
    { key: 'sales', label: $localize`:@@core.module-features.ts.ventes.9087fc4f:Ventes` },
    { key: 'purchases', label: $localize`:@@core.module-features.ts.achats.ee5b078c:Achats` },
    { key: 'stock', label: $localize`:@@core.module-features.ts.stock.bcecf456:Stock` },
    { key: 'fiches', label: $localize`:@@core.module-features.ts.fiches.c513967c:Fiches` },
    { key: 'payments', label: $localize`:@@core.module-features.ts.paiements.97ecc646:Paiements` }
  ],
  [AppModule.Administration]: [
    { key: 'users', label: $localize`:@@core.module-features.ts.utilisateurs.c661b3bc:Utilisateurs` },
    { key: 'settings', label: $localize`:@@core.module-features.ts.parametres.ef8f0121:Paramètres` }
  ],
  [AppModule.Purchases]: [
    { key: 'suppliers', label: $localize`:@@core.module-features.ts.fournisseurs.06b6d88c:Fournisseurs` },
    { key: 'purchase_orders', label: $localize`:@@core.module-features.ts.bons.de.commande.aae719f0:Bons de commande` },
    { key: 'purchase_receipts', label: $localize`:@@core.module-features.ts.bons.de.reception.84d6ebb5:Bons de réception` },
    { key: 'supplier_invoices', label: $localize`:@@core.module-features.ts.factures.fournisseurs.1dcbc2ed:Factures fournisseurs` }
  ],
  [AppModule.Stock]: [
    { key: 'stock', label: $localize`:@@core.module-features.ts.mouvements.de.stock.b5ee405b:Mouvements de stock` },
    { key: 'stock_transfers', label: $localize`:@@core.module-features.ts.transferts.f2783f95:Transferts` },
    { key: 'inventory', label: $localize`:@@core.module-features.ts.inventaires.81598a9f:Inventaires` },
    { key: 'stock_vouchers', label: $localize`:@@core.module-features.ts.bons.d.entree.sortie.d3aa127b:Bons d’entrée / sortie` },
    { key: 'stock_lots', label: $localize`:@@core.module-features.ts.lots.de.stock.5db8d0f4:Lots de stock` }
  ],
  [AppModule.Accounting]: [
    { key: 'journal', label: $localize`:@@core.module-features.ts.journal.ecritures.f74eaa36:Journal / écritures` },
    { key: 'ledger', label: $localize`:@@core.module-features.ts.grand.livre.7eef7547:Grand livre` },
    { key: 'aging', label: $localize`:@@core.module-features.ts.balance.agee.f6b2095b:Balance âgée` },
    { key: 'vat_declaration', label: $localize`:@@core.module-features.ts.declaration.tva.4358470d:Déclaration TVA` },
    { key: 'closing', label: $localize`:@@core.module-features.ts.cloture.eb133909:Clôture` },
    { key: 'audit_log', label: $localize`:@@core.module-features.ts.journal.d.audit.52309db1:Journal d'audit` },
    { key: 'fixed_assets', label: $localize`:@@core.module-features.ts.immobilisations.1e4cbe01:Immobilisations` }
  ],
  [AppModule.CRM]: [
    { key: 'opportunities', label: $localize`:@@core.module-features.ts.opportunites.0dbfa3c5:Opportunités` },
    { key: 'activities', label: $localize`:@@core.module-features.ts.activites.9c1f6186:Activités` },
    { key: 'targets', label: $localize`:@@core.module-features.ts.objectifs.commerciaux.48084d31:Objectifs commerciaux` },
    { key: 'templates', label: $localize`:@@core.module-features.ts.modeles.de.devis.b90f004d:Modèles de devis` },
    { key: 'dashboard', label: $localize`:@@core.module-features.ts.tableau.de.bord.commercial.1d7454c7:Tableau de bord commercial` }
  ],
  [AppModule.Fiscal]: [],
  [AppModule.AI]: [],
  [AppModule.Forecasting]: [],
  [AppModule.Studio]: [],
  [AppModule.Payroll]: [],
  [AppModule.Honoraires]: [
    { key: 'invoices', label: $localize`:@@core.module-features.ts.factures.da35e4f2:Factures` },
    { key: 'quotes', label: $localize`:@@core.module-features.ts.devis.f7622f90:Devis` },
    { key: 'payments', label: $localize`:@@core.module-features.ts.encaissements.598f53c9:Encaissements` }
  ],
  [AppModule.Projects]: [
    { key: 'core', label: $localize`:@@core.module-features.ts.projets.et.equipe.b00217e5:Projets et équipe` },
    { key: 'tasks', label: $localize`:@@core.module-features.ts.taches.1b018f86:Tâches` },
    { key: 'time', label: $localize`:@@core.module-features.ts.temps.2986a8c2:Temps` },
    { key: 'billing', label: $localize`:@@core.module-features.ts.facturation.projet.12931a9e:Facturation projet` },
    { key: 'esn', label: $localize`:@@core.module-features.ts.pack.esn.regie.jalons.41f28247:Pack ESN (régie / jalons)` },
    { key: 'btp', label: $localize`:@@core.module-features.ts.pack.btp.situations.chantier.92bb06f8:Pack BTP (situations / chantier)` }
  ],
  [AppModule.RecurringContracts]: [
    { key: 'contracts', label: $localize`:@@core.module-features.ts.contrats.d35fbb32:Contrats` },
    { key: 'usage', label: $localize`:@@core.module-features.ts.consommation.fa3cc9c6:Consommation` },
    { key: 'billing', label: $localize`:@@core.module-features.ts.facturation.04716c6b:Facturation` }
  ]
};

export function getModuleFeatureOptions(module: AppModule): ModuleFeatureOption[] {
  return MODULE_FEATURE_OPTIONS[module] ?? [];
}

export function allFeatureKeysForModule(module: AppModule): string[] {
  return getModuleFeatureOptions(module).map(o => o.key);
}

export function isSubFeatureOn(item: UserModuleAccessItem, featureKey: string): boolean {
  if (!item.enabled) return false;
  const all = allFeatureKeysForModule(item.module);
  if (all.length === 0) return false;
  if (item.enabledFeatureKeys == null) return true;
  if (item.enabledFeatureKeys.length === 0) return false;
  return item.enabledFeatureKeys.includes(featureKey);
}

/** Tout coché → null ; aucune case → [] ; sous-ensemble explicite → liste. */
export function setSubFeatureChecked(
  item: UserModuleAccessItem,
  featureKey: string,
  checked: boolean,
  visibleKeys?: readonly string[]
): void {
  const next = withSubFeatureToggled(item, featureKey, checked, visibleKeys);
  item.enabledFeatureKeys = next.enabledFeatureKeys;
}

/**
 * Immutable — à utiliser avec signal.update (p-checkbox OnPush + NgModel).
 * `visibleKeys` = features cochables du catalogue (allowedPermissions non vide).
 * Sans cet argument, le catalogue statique du module sert d’univers (rétrocompat).
 */
export function withSubFeatureToggled(
  item: UserModuleAccessItem,
  featureKey: string,
  checked: boolean,
  visibleKeys?: readonly string[]
): UserModuleAccessItem {
  const all = visibleKeys ? [...visibleKeys] : allFeatureKeysForModule(item.module);
  if (all.length === 0) return { ...item };
  const current =
    item.enabledFeatureKeys == null
      ? [...all]
      : item.enabledFeatureKeys.length === 0
        ? []
        : item.enabledFeatureKeys.filter(k => all.includes(k));
  const set = new Set(current);
  if (checked) set.add(featureKey);
  else set.delete(featureKey);
  const next = all.filter(k => set.has(k));
  const keys =
    next.length === 0 ? [] : next.length === all.length ? null : next;
  return { ...item, enabledFeatureKeys: keys };
}

/**
 * null/undefined keys = toutes les sous-fonctions (omit). Tableau vide = aucune sous-fonction explicite.
 */
export function toModuleAccessApiPayload(
  items: UserModuleAccessItem[]
): Array<{ module: AppModule; enabled: boolean; enabledFeatureKeys?: string[] | null }> {
  return items.map(x => {
    const row: { module: AppModule; enabled: boolean; enabledFeatureKeys?: string[] | null } = {
      module: x.module,
      enabled: x.enabled
    };
    if (!x.enabled) return row;
    const keys = x.enabledFeatureKeys;
    if (keys === null || keys === undefined) return row;
    row.enabledFeatureKeys = keys;
    return row;
  });
}
