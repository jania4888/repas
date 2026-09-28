/**
 * Métadonnées des chapitres de la documentation utilisateur.
 * Utilisé pour la navigation et le chargement des fichiers Markdown.
 */
export interface DocChapter {
  id: string;
  title: string;
  file: string;
  icon: string;
  description?: string;
}

export const DOC_CHAPTERS: DocChapter[] = [
  { id: 'premiers-pas', title: $localize`:@@documentation.doc-chapters.ts.premiers.pas.975acb5a:Premiers pas`, file: '01-premiers-pas.md', icon: 'fa-sign-in', description: $localize`:@@documentation.doc-chapters.ts.creer.un.compte.se.connecter.572eff24:Créer un compte, se connecter` },
  { id: 'tableau-de-bord', title: $localize`:@@documentation.doc-chapters.ts.tableau.de.bord.a524057f:Tableau de bord`, file: '02-tableau-de-bord.md', icon: 'fa-th-large', description: $localize`:@@documentation.doc-chapters.ts.vue.d.ensemble.de.votre.activite.173cd083:Vue d'ensemble de votre activité` },
  { id: 'ventes', title: $localize`:@@documentation.doc-chapters.ts.ventes.9087fc4f:Ventes`, file: '03-ventes.md', icon: 'fa-shopping-bag', description: $localize`:@@documentation.doc-chapters.ts.devis.bons.de.livraison.factures.a57528e4:Devis, bons de livraison, factures` },
  { id: 'achats', title: $localize`:@@documentation.doc-chapters.ts.achats.ee5b078c:Achats`, file: '04-achats.md', icon: 'fa-shopping-cart', description: $localize`:@@documentation.doc-chapters.ts.fournisseurs.bons.de.commande.factures.f.5a03ea78:Fournisseurs, bons de commande, factures fournisseurs` },
  { id: 'fiches', title: $localize`:@@documentation.doc-chapters.ts.fiches.c513967c:Fiches`, file: '05-fiches.md', icon: 'fa-folder-open-o', description: $localize`:@@documentation.doc-chapters.ts.clients.et.produits.78a569bd:Clients et produits` },
  { id: 'stock', title: $localize`:@@documentation.doc-chapters.ts.stock.bcecf456:Stock`, file: '06-stock.md', icon: 'fa-cubes', description: $localize`:@@documentation.doc-chapters.ts.gestion.du.stock.et.inventaire.2cda818d:Gestion du stock et inventaire` },
  { id: 'paiements', title: $localize`:@@documentation.doc-chapters.ts.tresorerie.e0e75da7:Trésorerie`, file: '07-paiements.md', icon: 'fa-credit-card', description: $localize`:@@documentation.doc-chapters.ts.suivre.et.enregistrer.les.paiements.490e0edf:Suivre et enregistrer les paiements` },
  { id: 'rapports', title: $localize`:@@documentation.doc-chapters.ts.rapports.db7d9fbb:Rapports`, file: '08-rapports.md', icon: 'fa-bar-chart-o', description: $localize`:@@documentation.doc-chapters.ts.statistiques.et.analyses.f6c4a0fe:Statistiques et analyses` },
  { id: 'parametres', title: $localize`:@@documentation.doc-chapters.ts.parametres.ef8f0121:Paramètres`, file: '09-parametres.md', icon: 'fa-cog', description: $localize`:@@documentation.doc-chapters.ts.profil.entreprise.abonnement.d1096fd9:Profil, entreprise, abonnement` },
  { id: 'studio-ia', title: $localize`:@@documentation.doc-chapters.ts.studio.ia.04d04eb2:Studio IA`, file: '13-studio-ia.md', icon: 'fa-wand-magic-sparkles', description: $localize`:@@documentation.doc-chapters.ts.creer.tables.formulaires.et.rapports.en.4038e640:Créer tables, formulaires et rapports en décrivant votre besoin` },
  { id: 'glossaire', title: $localize`:@@documentation.doc-chapters.ts.glossaire.8bf66fc9:Glossaire`, file: 'glossaire.md', icon: 'fa-list-alt', description: $localize`:@@documentation.doc-chapters.ts.definitions.des.termes.utilises.7f95a70d:Définitions des termes utilisés` }
];

export function getChapterById(id: string): DocChapter | undefined {
  return DOC_CHAPTERS.find(c => c.id === id);
}
