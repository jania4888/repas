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
  stock: $localize`:@@core.breadcrumb.ts.rapports.stock.00f72cdf:Rapports Stock`,
  fiches: 'Rapports Fiches',
  settings: $localize`:@@core.breadcrumb.ts.parametres.ef8f0121:Paramètres`,
  promotions: 'Promotions',
  'variant-axes': $localize`:@@core.breadcrumb.ts.axes.de.variantes.dcc95d91:Axes de variantes`,
  warehouses: $localize`:@@core.breadcrumb.ts.entrepots.c0906d10:Entrepôts`,
  profile: 'Mon profil',
  new: 'Nouveau',
  edit: 'Modifier',
  wizard: 'Assistant',
  documentation: 'Documentation',
  'premiers-pas': $localize`:@@core.breadcrumb.ts.premiers.pas.975acb5a:Premiers pas`,
  'tableau-de-bord': $localize`:@@core.breadcrumb.ts.tableau.de.bord.a524057f:Tableau de bord`,
  ventes: 'Ventes',
  achats: 'Achats',
  parametres: $localize`:@@core.breadcrumb.ts.parametres.ef8f0121:Paramètres`,
  glossaire: 'Glossaire',
  'quote-templates': 'Modèles de devis',
  unpaid: $localize`:@@core.breadcrumb.ts.factures.impayees.dc3cffa5:Factures impayées`,
  'credit-notes': $localize`:@@core.breadcrumb.ts.avoirs.de.vente.63b21d70:Avoirs de vente`,
  transfers: 'Transferts',
  entries: $localize`:@@core.breadcrumb.ts.bons.d.entree.c04705f1:Bons d'entrée`,
  issues: $localize`:@@core.breadcrumb.ts.bons.de.sortie.ccd59bed:Bons de sortie`,
  create: $localize`:@@core.breadcrumb.ts.creer.1a686172:Créer`,
  'purchase-orders': $localize`:@@core.breadcrumb.ts.bons.de.commande.aae719f0:Bons de commande`,
  'purchase-receipts': $localize`:@@core.breadcrumb.ts.bons.de.reception.84d6ebb5:Bons de réception`,
  'delivery-notes': $localize`:@@core.breadcrumb.ts.bons.de.livraison.a283129d:Bons de livraison`,
  'return-notes': $localize`:@@core.breadcrumb.ts.bons.de.retour.d9f7ad6c:Bons de retour`,
  'supplier-invoices': 'Factures fournisseurs',
  suppliers: 'Fournisseurs',
};

/** Labels spécifiques pour les sous-routes de /reports (évite ambiguïté avec /payments). */
const REPORTS_CHILD_LABELS: Record<string, string> = {
  analytics: $localize`:@@core.breadcrumb.ts.etats.analytiques.23bcc707:États analytiques`,
  sales: 'Rapports Ventes',
  'sales-by-line': $localize`:@@core.breadcrumb.ts.details.ventes.par.ligne.2ed7995e:Détails ventes par ligne`,
  purchases: 'Rapports Achats',
  'purchases-analytics': $localize`:@@core.breadcrumb.ts.etats.analytiques.achats.0f98ad05:États analytiques Achats`,
  stock: $localize`:@@core.breadcrumb.ts.rapports.stock.00f72cdf:Rapports Stock`,
  fiches: 'Rapports Fiches',
  payments: 'Rapports Paiements',
  profit: $localize`:@@core.breadcrumb.ts.rapport.benefices.245eba08:Rapport Bénéfices`,
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
      return $localize`:@@core.breadcrumb.ts.detail.7ce06afc:Détail`;
    }
    return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
  }
}
