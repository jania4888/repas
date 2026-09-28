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
  invoice: { type: 'invoice', label: $localize`:@@core.search-entity.ts.facture.3953b9f5:Facture`, labelPlural: $localize`:@@core.search-entity.ts.factures.da35e4f2:Factures`, icon: 'fa-file-invoice', listRoute: '/invoices' },
  quote: { type: 'quote', label: $localize`:@@core.search-entity.ts.devis.f7622f90:Devis`, labelPlural: $localize`:@@core.search-entity.ts.devis.f7622f90:Devis`, icon: 'fa-file-lines', listRoute: '/quotes' },
  deliverynote: { type: 'deliverynote', label: $localize`:@@core.search-entity.ts.bon.de.livraison.1a60dc44:Bon de livraison`, labelPlural: $localize`:@@core.search-entity.ts.bons.de.livraison.a283129d:Bons de livraison`, icon: 'fa-truck', listRoute: '/delivery-notes' },
  client: { type: 'client', label: $localize`:@@core.search-entity.ts.client.1bdd79b1:Client`, labelPlural: $localize`:@@core.search-entity.ts.clients.28e22fe3:Clients`, icon: 'fa-users', listRoute: '/clients' },
  product: { type: 'product', label: $localize`:@@core.search-entity.ts.produit.ff673dc2:Produit`, labelPlural: $localize`:@@core.search-entity.ts.produits.48000473:Produits`, icon: 'fa-cube', listRoute: '/products' },
  supplier: { type: 'supplier', label: $localize`:@@core.search-entity.ts.fournisseur.97d91d89:Fournisseur`, labelPlural: $localize`:@@core.search-entity.ts.fournisseurs.06b6d88c:Fournisseurs`, icon: 'fa-building', listRoute: '/suppliers' },
  salesreturnnote: { type: 'salesreturnnote', label: $localize`:@@core.search-entity.ts.bon.de.retour.58d2db35:Bon de retour`, labelPlural: $localize`:@@core.search-entity.ts.bons.de.retour.d9f7ad6c:Bons de retour`, icon: 'fa-rotate-left', listRoute: '/return-notes' }
};

export function getEntityGroupLabel(entityType?: string): string {
  if (!entityType) return $localize`:@@core.search-entity.ts.documents.687c8286:Documents`;
  const key = entityType.toLowerCase() as SearchEntityType;
  return SEARCH_ENTITY_CONFIG[key]?.labelPlural ?? $localize`:@@core.search-entity.ts.documents.687c8286:Documents`;
}
