export type SearchEntityType =
  | 'invoice'
  | 'quote'
  | 'deliverynote'
  | 'client'
  | 'product'
  | 'supplier'
  | 'salesreturnnote';

export interface SearchEntityConfig {
  type: SearchEntityType;
  label: string;
  labelPlural: string;
  icon: string;
  listRoute: string;
}

export const SEARCH_ENTITY_CONFIG: Record<SearchEntityType, SearchEntityConfig> = {
  invoice: { type: 'invoice', label: $localize`:@@core.search-entity.ts.facture.3953b9f5:Facture`, labelPlural: 'Factures', icon: 'fa-file-invoice', listRoute: '/invoices' },
  quote: { type: 'quote', label: $localize`:@@core.search-entity.ts.devis.f7622f90:Devis`, labelPlural: 'Devis', icon: 'fa-file-lines', listRoute: '/quotes' },
  deliverynote: { type: 'deliverynote', label: $localize`:@@core.search-entity.ts.bon.de.livraison.1a60dc44:Bon de livraison`, labelPlural: 'Bons de livraison', icon: 'fa-truck', listRoute: '/delivery-notes' },
  client: { type: 'client', label: $localize`:@@core.search-entity.ts.client.1bdd79b1:Client`, labelPlural: 'Clients', icon: 'fa-users', listRoute: '/clients' },
  product: { type: 'product', label: $localize`:@@core.search-entity.ts.produit.ff673dc2:Produit`, labelPlural: 'Produits', icon: 'fa-cube', listRoute: '/products' },
  supplier: { type: 'supplier', label: $localize`:@@core.search-entity.ts.fournisseur.97d91d89:Fournisseur`, labelPlural: 'Fournisseurs', icon: 'fa-building', listRoute: '/suppliers' },
  salesreturnnote: { type: 'salesreturnnote', label: $localize`:@@core.search-entity.ts.bon.de.retour.58d2db35:Bon de retour`, labelPlural: 'Bons de retour', icon: 'fa-rotate-left', listRoute: '/return-notes' }
};

export function getEntityGroupLabel(entityType?: string): string {
  if (!entityType) return 'Documents';
  const key = entityType.toLowerCase() as SearchEntityType;
  return SEARCH_ENTITY_CONFIG[key]?.labelPlural ?? 'Documents';
}
