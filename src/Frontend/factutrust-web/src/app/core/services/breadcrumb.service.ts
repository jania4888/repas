import { Injectable, signal, computed, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import type { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

/** Labels pour les segments de route courants (fil d'Ariane). */
const SEGMENT_LABELS: Record<string, string> = {
  home: 'Accueil',
  invoices: 'Factures',
  quotes: 'Devis',
  clients: 'Clients',
  crm: 'CRM Commercial',
  products: 'Produits',
  payments: 'Paiements',
  reports: 'Rapports',
  sales: 'Rapports Ventes',
  purchases: 'Rapports Achats',
  stock: 'Rapports Stock',
  fiches: 'Rapports Fiches',
  settings: 'Paramètres',
  promotions: 'Promotions',
  'variant-axes': 'Axes de variantes',
  warehouses: 'Entrepôts',
  profile: 'Mon profil',
  new: 'Nouveau',
  edit: 'Modifier',
  wizard: 'Assistant',
  documentation: 'Documentation',
  'premiers-pas': 'Premiers pas',
  'tableau-de-bord': 'Tableau de bord',
  ventes: 'Ventes',
  achats: 'Achats',
  parametres: 'Paramètres',
  glossaire: 'Glossaire',
  'quote-templates': 'Modèles de devis',
  unpaid: 'Factures impayées',
  'credit-notes': 'Avoirs de vente',
  transfers: 'Transferts',
  entries: "Bons d'entrée",
  issues: 'Bons de sortie',
  create: 'Créer',
  'purchase-orders': 'Bons de commande',
  'purchase-receipts': 'Bons de réception',
  'delivery-notes': 'Bons de livraison',
  'return-notes': 'Bons de retour',
  'supplier-invoices': 'Factures fournisseurs',
  suppliers: 'Fournisseurs',
};

/** Labels spécifiques pour les sous-routes de /reports (évite ambiguïté avec /payments). */
const REPORTS_CHILD_LABELS: Record<string, string> = {
  analytics: 'États analytiques',
  sales: 'Rapports Ventes',
  'sales-by-line': 'Détails ventes par ligne',
  purchases: 'Rapports Achats',
  'purchases-analytics': 'États analytiques Achats',
  stock: 'Rapports Stock',
  fiches: 'Rapports Fiches',
  payments: 'Rapports Paiements',
  profit: 'Rapport Bénéfices',
};

@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private router = inject(Router);

  private readonly itemsSignal = signal<BreadcrumbItem[]>([]);

  /** Signal des éléments du fil d'Ariane (dérivé de la route actuelle). */
  readonly items = computed(() => this.itemsSignal());

  constructor() {
    this.updateFromRoute(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => this.updateFromRoute(e.urlAfterRedirects));
  }

  private updateFromRoute(url: string): void {
    const path = url.split('?')[0];
    const segments = path.split('/').filter(Boolean);
    const items: BreadcrumbItem[] = [{ label: $localize`:@@core.breadcrumb.ts.accueil.a8ff8fd2:Accueil`, route: '/' }];

    let routeSoFar = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentLower = segment.toLowerCase();
      routeSoFar += `/${segment}`;

      let label: string;
      const prevSegment = segments[i - 1]?.toLowerCase();
      if (i > 0 && prevSegment === 'reports' && REPORTS_CHILD_LABELS[segmentLower]) {
        label = REPORTS_CHILD_LABELS[segmentLower];
      } else if (segmentLower === 'stock' && prevSegment !== 'reports') {
        label = $localize`:@@core.breadcrumb.ts.stock.bcecf456:Stock`;
      } else if (i > 0 && prevSegment === 'payments') {
        if (segmentLower === 'clients') label = $localize`:@@core.breadcrumb.ts.paiements.clients.79a7e359:Paiements clients`;
        else if (segmentLower === 'suppliers') label = $localize`:@@core.breadcrumb.ts.paiements.fournisseurs.416577a5:Paiements fournisseurs`;
        else label = SEGMENT_LABELS[segmentLower] ?? this.formatSegment(segment);
      } else {
        label = SEGMENT_LABELS[segmentLower] ?? this.formatSegment(segment);
      }

      items.push({
        label,
        route: i === segments.length - 1 ? undefined : routeSoFar,
      });
    }

    this.itemsSignal.set(items);
  }

  private formatSegment(segment: string): string {
    if (/^[0-9a-f-]{36}$/i.test(segment) || /^\d+$/.test(segment)) {
      return 'Détail';
    }
    return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
  }
}
