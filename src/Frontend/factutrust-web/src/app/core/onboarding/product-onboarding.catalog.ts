import { AppModule } from '@core/models/app-module';
import {
  FIRM_CHECKLIST_IDS,
  COMPANY_CHECKLIST_IDS,
  OnboardingChecklistItemDef,
  ProductTourStepDef
} from './product-onboarding.models';

export const COMPANY_TOUR_STEPS: readonly ProductTourStepDef[] = [
  {
    id: 'welcome',
    title: $localize`:@@core.product-onboarding.catalog.ts.bienvenue.2da427c2:Bienvenue`,
    description:
      $localize`:@@core.product-onboarding.catalog.ts.bienvenue.voici.les.fonctions.essentiell.5a19b28d:Bienvenue. Voici les fonctions essentielles — 2 minutes. Vous pourrez relancer la visite depuis votre profil.`,
    compact: true
  },
  {
    id: 'nav-dashboard',
    title: $localize`:@@core.product-onboarding.catalog.ts.tableau.de.bord.a524057f:Tableau de bord`,
    description: $localize`:@@core.product-onboarding.catalog.ts.votre.page.d.accueil.indicateurs.facture.b9cd0be7:Votre page d’accueil : indicateurs, factures récentes et actions rapides.`,
    selector: '[data-tour="nav-dashboard"]',
    compact: true
  },
  {
    id: 'nav-ventes',
    title: $localize`:@@core.product-onboarding.catalog.ts.ventes.9087fc4f:Ventes`,
    description: $localize`:@@core.product-onboarding.catalog.ts.devis.commandes.bons.de.livraison.factur.c67ec914:Devis, commandes, bons de livraison, factures et retours — tout le cycle commercial.`,
    selector: '[data-tour="nav-ventes"]',
    expandNavTourId: 'ventes',
    compact: true
  },
  {
    id: 'nav-achats',
    title: $localize`:@@core.product-onboarding.catalog.ts.achats.ee5b078c:Achats`,
    description: $localize`:@@core.product-onboarding.catalog.ts.fournisseurs.commandes.d.achat.et.factur.dbae997b:Fournisseurs, commandes d’achat et factures fournisseurs.`,
    selector: '[data-tour="nav-achats"]',
    expandNavTourId: 'achats'
  },
  {
    id: 'nav-fiches',
    title: $localize`:@@core.product-onboarding.catalog.ts.fiches.c513967c:Fiches`,
    description: $localize`:@@core.product-onboarding.catalog.ts.clients.et.articles.le.referentiel.de.vo.3430a7f7:Clients et articles : le référentiel de votre société (pas un CRM séparé).`,
    selector: '[data-tour="nav-fiches"]',
    expandNavTourId: 'fiches',
    compact: true
  },
  {
    id: 'nav-stock',
    title: $localize`:@@core.product-onboarding.catalog.ts.stock.bcecf456:Stock`,
    description: $localize`:@@core.product-onboarding.catalog.ts.mouvements.transferts.et.inventaires.par.11a81a08:Mouvements, transferts et inventaires par entrepôt.`,
    selector: '[data-tour="nav-stock"]',
    expandNavTourId: 'stock'
  },
  {
    id: 'nav-tresorerie',
    title: $localize`:@@core.product-onboarding.catalog.ts.tresorerie.e0e75da7:Trésorerie`,
    description: $localize`:@@core.product-onboarding.catalog.ts.caisses.banques.paiements.et.prevision.d.60155dfa:Caisses, banques, paiements et prévision de trésorerie.`,
    selector: '[data-tour="nav-tresorerie"]',
    expandNavTourId: 'tresorerie'
  },
  {
    id: 'nav-comptabilite',
    title: $localize`:@@core.product-onboarding.catalog.ts.comptabilite.20af7266:Comptabilité`,
    description: $localize`:@@core.product-onboarding.catalog.ts.journaux.grand.livre.declarations.et.clo.495d3ebf:Journaux, grand livre, déclarations et clôture — selon vos modules activés.`,
    selector: '[data-tour="nav-comptabilite"]',
    expandNavTourId: 'comptabilite'
  },
  {
    id: 'nav-ai',
    title: $localize`:@@core.product-onboarding.catalog.ts.assistant.ia.94f6f208:Assistant IA`,
    description: $localize`:@@core.product-onboarding.catalog.ts.posez.une.question.metier.l.assistant.s.2f3e0c56:Posez une question métier : l’assistant s’appuie sur vos données, dans le périmètre autorisé.`,
    selector: '[data-tour="nav-ai-assistant"]'
  },
  {
    id: 'header-search',
    title: $localize`:@@core.product-onboarding.catalog.ts.recherche.787b5492:Recherche`,
    description: $localize`:@@core.product-onboarding.catalog.ts.retrouvez.une.facture.un.client.ou.un.me.1e2237d7:Retrouvez une facture, un client ou un menu. Raccourci : Ctrl+K.`,
    selector: '[data-tour="header-search"]'
  },
  {
    id: 'header-quick-access',
    title: $localize`:@@core.product-onboarding.catalog.ts.acces.rapide.b4388c3e:Accès rapide`,
    description: $localize`:@@core.product-onboarding.catalog.ts.raccourcis.pour.creer.un.document.ou.ouv.045adfb5:Raccourcis pour créer un document ou ouvrir les pages les plus utilisées.`,
    selector: '[data-tour="header-quick-access"]'
  },
  {
    id: 'header-settings',
    title: $localize`:@@core.product-onboarding.catalog.ts.parametres.ef8f0121:Paramètres`,
    description: $localize`:@@core.product-onboarding.catalog.ts.societe.numerotation.taxes.utilisateurs.a7a4b33b:Société, numérotation, taxes, utilisateurs et abonnement.`,
    selector: '[data-tour="header-settings"]',
    compact: true
  },
  {
    id: 'header-notifications',
    title: $localize`:@@core.product-onboarding.catalog.ts.notifications.753a22b2:Notifications`,
    description: $localize`:@@core.product-onboarding.catalog.ts.alertes.stock.echeances.messages.regroup.867d7129:Alertes (stock, échéances, messages) regroupées ici.`,
    selector: '[data-tour="header-notifications"]'
  },
  {
    id: 'header-profile',
    title: $localize`:@@core.product-onboarding.catalog.ts.votre.profil.f73bfe15:Votre profil`,
    description: $localize`:@@core.product-onboarding.catalog.ts.compte.deconnexion.et.relance.de.cette.v.0cb7bfc4:Compte, déconnexion, et relance de cette visite guidée.`,
    selector: '[data-tour="header-profile"]'
  },
  {
    id: 'header-warehouse',
    title: $localize`:@@core.product-onboarding.catalog.ts.entrepot.actif.2cc55984:Entrepôt actif`,
    description: $localize`:@@core.product-onboarding.catalog.ts.les.stocks.et.documents.sont.filtres.sur.00da5df7:Les stocks et documents sont filtrés sur cet entrepôt.`,
    selector: '[data-tour="header-warehouse"]'
  },
  {
    id: 'dash-kpi',
    title: $localize`:@@core.product-onboarding.catalog.ts.indicateurs.bc7196d0:Indicateurs`,
    description: $localize`:@@core.product-onboarding.catalog.ts.chiffre.d.affaires.impayes.et.alertes.un.2d8faf30:Chiffre d’affaires, impayés et alertes. Un clic ouvre la liste filtrée.`,
    selector: '[data-tour="dash-kpi"]',
    compact: true
  },
  {
    id: 'dash-quick-actions',
    title: $localize`:@@core.product-onboarding.catalog.ts.actions.rapides.abe69a9c:Actions rapides`,
    description: $localize`:@@core.product-onboarding.catalog.ts.creez.une.facture.un.devis.ou.un.bon.de.2858876e:Créez une facture, un devis ou un bon de livraison en un clic.`,
    selector: '[data-tour="dash-quick-actions"]'
  },
  {
    id: 'dash-empty-invoice',
    title: $localize`:@@core.product-onboarding.catalog.ts.premiere.facture.4485976a:Première facture`,
    description: $localize`:@@core.product-onboarding.catalog.ts.quand.la.liste.est.vide.ce.raccourci.cre.74c63164:Quand la liste est vide, ce raccourci crée votre première facture.`,
    selector: '[data-tour="dash-empty-invoice"]'
  },
  {
    id: 'ai-fab',
    title: $localize`:@@core.product-onboarding.catalog.ts.assistant.ia.94f6f208:Assistant IA`,
    description: $localize`:@@core.product-onboarding.catalog.ts.le.bouton.en.bas.a.droite.ouvre.l.assist.0109cc6a:Le bouton en bas à droite ouvre l’assistant dans un onglet de travail, sans quitter votre écran.`,
    selector: '[data-tour="ai-fab"]'
  },
  {
    id: 'checklist',
    title: $localize`:@@core.product-onboarding.catalog.ts.premiers.pas.975acb5a:Premiers pas`,
    description: $localize`:@@core.product-onboarding.catalog.ts.cette.liste.reste.affichee.jusqu.a.ce.qu.41770351:Cette liste reste affichée jusqu’à ce que vous ayez configuré l’essentiel. Vous pouvez la masquer.`,
    selector: '[data-tour="onboarding-checklist"]',
    compact: true
  }
];

export const FIRM_TOUR_STEPS: readonly ProductTourStepDef[] = [
  {
    id: 'welcome',
    title: $localize`:@@core.product-onboarding.catalog.ts.espace.cabinet.890d827d:Espace cabinet`,
    description:
      $localize`:@@core.product-onboarding.catalog.ts.bienvenue.dans.votre.espace.cabinet.voic.6bceb745:Bienvenue dans votre espace cabinet. Voici les fonctions essentielles — 2 minutes.`,
    compact: true
  },
  {
    id: 'nav-dashboard',
    title: $localize`:@@core.product-onboarding.catalog.ts.tableau.de.bord.a524057f:Tableau de bord`,
    description: $localize`:@@core.product-onboarding.catalog.ts.alertes.fiscales.dossiers.actifs.et.invi.259a21ad:Alertes fiscales, dossiers actifs et invitations en attente.`,
    selector: '[data-tour="nav-dashboard"]',
    compact: true
  },
  {
    id: 'nav-chef',
    title: $localize`:@@core.product-onboarding.catalog.ts.chef.de.mission.93d4fc86:Chef de mission`,
    description: $localize`:@@core.product-onboarding.catalog.ts.assistant.ia.du.cabinet.synthese.de.port.7cf83d83:Assistant IA du cabinet : synthèse de portefeuille et aide à la mission.`,
    selector: '[data-tour="nav-chef-de-mission"]'
  },
  {
    id: 'nav-clients',
    title: $localize`:@@core.product-onboarding.catalog.ts.dossiers.clients.12302caf:Dossiers clients`,
    description: $localize`:@@core.product-onboarding.catalog.ts.ouvrez.la.comptabilite.d.un.dossier.ou.c.be4d872a:Ouvrez la comptabilité d’un dossier ou créez une société gérée.`,
    selector: '[data-tour="nav-clients"]',
    compact: true
  },
  {
    id: 'nav-fiscal',
    title: $localize`:@@core.product-onboarding.catalog.ts.echeancier.fiscal.193d9cef:Échéancier fiscal`,
    description: $localize`:@@core.product-onboarding.catalog.ts.echeances.tva.is.et.declarations.de.vos.cb25353c:Échéances TVA, IS et déclarations de vos dossiers.`,
    selector: '[data-tour="nav-fiscal-schedule"]',
    compact: true
  },
  {
    id: 'nav-invitations',
    title: $localize`:@@core.product-onboarding.catalog.ts.invitations.9b69a35a:Invitations`,
    description: $localize`:@@core.product-onboarding.catalog.ts.acceptez.ou.refusez.les.demandes.d.affec.10d37fb0:Acceptez ou refusez les demandes d’affectation des sociétés.`,
    selector: '[data-tour="nav-invitations"]'
  },
  {
    id: 'nav-cabinet',
    title: $localize`:@@core.product-onboarding.catalog.ts.mon.cabinet.20598fad:Mon cabinet`,
    description: $localize`:@@core.product-onboarding.catalog.ts.collaborateurs.parametres.et.votre.profi.bc28bd5d:Collaborateurs, paramètres et votre profil cabinet.`,
    selector: '[data-tour="nav-cabinet"]',
    expandNavTourId: 'cabinet',
    compact: true
  },
  {
    id: 'header-settings',
    title: $localize`:@@core.product-onboarding.catalog.ts.parametres.cabinet.ea488559:Paramètres cabinet`,
    description: $localize`:@@core.product-onboarding.catalog.ts.identite.du.cabinet.visibilite.annuaire.b551e231:Identité du cabinet, visibilité annuaire et préférences.`,
    selector: '[data-tour="header-settings"]'
  },
  {
    id: 'header-profile',
    title: $localize`:@@core.product-onboarding.catalog.ts.votre.profil.f73bfe15:Votre profil`,
    description: $localize`:@@core.product-onboarding.catalog.ts.compte.personnel.et.relance.de.cette.vis.c1fc6a16:Compte personnel et relance de cette visite.`,
    selector: '[data-tour="header-profile"]'
  },
  {
    id: 'firm-empty',
    title: $localize`:@@core.product-onboarding.catalog.ts.dossiers.2a59919f:Dossiers`,
    description: $localize`:@@core.product-onboarding.catalog.ts.tant.qu.aucun.dossier.n.est.actif.accept.7e9477a5:Tant qu’aucun dossier n’est actif, acceptez une invitation ou créez un client géré.`,
    selector: '[data-tour="firm-empty-clients"]'
  },
  {
    id: 'checklist',
    title: $localize`:@@core.product-onboarding.catalog.ts.premiers.pas.975acb5a:Premiers pas`,
    description: $localize`:@@core.product-onboarding.catalog.ts.cochez.les.etapes.restantes.ici.la.liste.3d8b826d:Cochez les étapes restantes ici. La liste disparaît une fois terminée ou masquée.`,
    selector: '[data-tour="onboarding-checklist"]',
    compact: true
  }
];

export const COMPANY_CHECKLIST_ITEMS: readonly OnboardingChecklistItemDef[] = [
  {
    id: COMPANY_CHECKLIST_IDS.companyProfile,
    label: $localize`:@@core.product-onboarding.catalog.ts.completer.la.fiche.entreprise.18a29909:Compléter la fiche entreprise`,
    description: $localize`:@@core.product-onboarding.catalog.ts.logo.rib.ou.registre.de.commerce.pour.vo.84e16e10:Logo, RIB ou registre de commerce pour vos documents.`,
    route: '/settings/company',
    permission: 'settings:read'
  },
  {
    id: COMPANY_CHECKLIST_IDS.createClient,
    label: $localize`:@@core.product-onboarding.catalog.ts.creer.un.client.db580ea8:Créer un client`,
    description: $localize`:@@core.product-onboarding.catalog.ts.au.dela.du.client.passager.ajoutez.votre.7b9348b5:Au-delà du client passager, ajoutez votre premier client réel.`,
    route: '/clients/new',
    permission: 'clients:create'
  },
  {
    id: COMPANY_CHECKLIST_IDS.createProduct,
    label: $localize`:@@core.product-onboarding.catalog.ts.creer.un.article.6b3f0d41:Créer un article`,
    description: $localize`:@@core.product-onboarding.catalog.ts.un.produit.ou.service.a.facturer.b1ae2d2f:Un produit ou service à facturer.`,
    route: '/products/new',
    permission: 'products:create'
  },
  {
    id: COMPANY_CHECKLIST_IDS.createInvoice,
    label: $localize`:@@core.product-onboarding.catalog.ts.creer.une.facture.13a9becd:Créer une facture`,
    description: $localize`:@@core.product-onboarding.catalog.ts.votre.premiere.facture.de.vente.16e591aa:Votre première facture de vente.`,
    route: '/invoices/new',
    permission: 'invoices:create'
  },
  {
    id: COMPANY_CHECKLIST_IDS.numbering,
    label: $localize`:@@core.product-onboarding.catalog.ts.verifier.la.numerotation.566d1149:Vérifier la numérotation`,
    description: $localize`:@@core.product-onboarding.catalog.ts.prefixes.et.compteurs.des.documents.fac.d071eece:Préfixes et compteurs des documents (FAC, DEV…).`,
    route: '/settings/numbering',
    permission: 'settings:read'
  },
  {
    id: COMPANY_CHECKLIST_IDS.inviteUser,
    label: $localize`:@@core.product-onboarding.catalog.ts.inviter.un.utilisateur.e2b010c3:Inviter un utilisateur`,
    description: $localize`:@@core.product-onboarding.catalog.ts.ajoutez.un.collaborateur.avec.les.bons.m.e51dbfe9:Ajoutez un collaborateur avec les bons modules.`,
    route: '/settings/users',
    permission: 'users:create',
    adminOnly: true
  },
  // Phase 2 (plan §4.4) — additive, module/segment-gated items (canSee() in
  // onboarding-checklist.component.ts already evaluates `modules`/`segments`).
  {
    id: COMPANY_CHECKLIST_IDS.checkDefaultWarehouse,
    label: $localize`:@@core.product-onboarding.catalog.ts.verifier.votre.entrepot.par.defaut.d2d3814b:Vérifier votre entrepôt par défaut`,
    description: $localize`:@@core.product-onboarding.catalog.ts.nom.adresse.et.parametres.de.l.entrepot.39743679:Nom, adresse et paramètres de l’entrepôt créé automatiquement à l’inscription.`,
    route: '/settings/warehouses',
    permission: 'settings:read',
    modules: [AppModule.Stock]
  },
  {
    id: COMPANY_CHECKLIST_IDS.commerceStockReceipt,
    label: $localize`:@@core.product-onboarding.catalog.ts.receptionner.votre.premier.stock.d36ba9f7:Réceptionner votre premier stock`,
    description: $localize`:@@core.product-onboarding.catalog.ts.enregistrez.une.entree.de.stock.pour.vos.41ff0c67:Enregistrez une entrée de stock pour vos premiers articles en négoce.`,
    route: '/stock/entries/new',
    permission: 'stock_vouchers:create',
    modules: [AppModule.Stock],
    segments: ['commerce']
  },
  // Plan v1 §2.6 — items sectoriels supplémentaires (BTP / Services & Éducatif).
  {
    id: COMPANY_CHECKLIST_IDS.btpFirstProject,
    label: $localize`:@@core.product-onboarding.catalog.ts.creer.votre.premier.projet.74e1f8ab:Créer votre premier projet`,
    description: $localize`:@@core.product-onboarding.catalog.ts.suivez.son.avancement.ses.taches.et.sa.f.a599eba9:Suivez son avancement, ses tâches et sa facturation.`,
    // NB : la création de projet se fait via une boîte de dialogue depuis la liste
    // (pas de route dédiée `/projects/new`) — on renvoie donc vers la liste des projets.
    route: '/projects',
    permission: 'projects:read',
    modules: [AppModule.Projects],
    segments: ['btp-construction']
  },
  {
    id: COMPANY_CHECKLIST_IDS.recurringContractSetup,
    label: $localize`:@@core.product-onboarding.catalog.ts.configurer.un.contrat.recurrent.1c409169:Configurer un contrat récurrent`,
    description: $localize`:@@core.product-onboarding.catalog.ts.facturez.automatiquement.vos.abonnements.bba1907d:Facturez automatiquement vos abonnements ou missions récurrentes.`,
    route: '/recurring-contracts/new',
    permission: 'recurring_contracts:create',
    modules: [AppModule.RecurringContracts],
    segments: ['services', 'etablissement-educatif']
  },
  // Plan v1 §3.5 — progressive profiling: reminder to enrich the company profile
  // (logo, RIB…) appears only after a few days of usage (minAgeDays gate).
  {
    id: COMPANY_CHECKLIST_IDS.completeCompanyProfile,
    label: $localize`:@@core.product-onboarding.catalog.ts.completez.votre.profil.entreprise.46b82bd2:Complétez votre profil entreprise`,
    description: $localize`:@@core.product-onboarding.catalog.ts.ajoutez.votre.logo.rib.et.coordonnees.ba.06084d4d:Ajoutez votre logo, RIB et coordonnées bancaires pour des documents plus pro.`,
    route: '/settings/company',
    permission: 'settings:read',
    minAgeDays: 3
  }
];

export const FIRM_CHECKLIST_ITEMS: readonly OnboardingChecklistItemDef[] = [
  {
    id: FIRM_CHECKLIST_IDS.firmSettings,
    label: $localize`:@@core.product-onboarding.catalog.ts.parametres.du.cabinet.86cf2df0:Paramètres du cabinet`,
    description: $localize`:@@core.product-onboarding.catalog.ts.completez.la.fiche.description.inscripti.f5613dd3:Complétez la fiche (description, inscription professionnelle).`,
    route: '/firm/settings'
  },
  {
    id: FIRM_CHECKLIST_IDS.addCollaborator,
    label: $localize`:@@core.product-onboarding.catalog.ts.ajouter.un.collaborateur.8a3ea168:Ajouter un collaborateur`,
    description: $localize`:@@core.product-onboarding.catalog.ts.invitez.un.associe.ou.un.collaborateur.a2e31fe4:Invitez un associé ou un collaborateur.`,
    route: '/firm/collaborateurs',
    managerOnly: true
  },
  {
    id: FIRM_CHECKLIST_IDS.clientDossier,
    label: $localize`:@@core.product-onboarding.catalog.ts.creer.ou.accepter.un.dossier.b822db62:Créer ou accepter un dossier`,
    description: $localize`:@@core.product-onboarding.catalog.ts.un.dossier.client.actif.pour.travailler.994d2b47:Un dossier client actif pour travailler.`,
    route: '/firm/clients'
  },
  {
    id: FIRM_CHECKLIST_IDS.fiscalSchedule,
    label: $localize`:@@core.product-onboarding.catalog.ts.consulter.l.echeancier.fiscal.91f6976e:Consulter l’échéancier fiscal`,
    description: $localize`:@@core.product-onboarding.catalog.ts.les.prochaines.echeances.de.vos.dossiers.2341ab4b:Les prochaines échéances de vos dossiers.`,
    route: '/firm/fiscal-schedule'
  },
  {
    id: FIRM_CHECKLIST_IDS.chefDeMission,
    label: $localize`:@@core.product-onboarding.catalog.ts.ouvrir.chef.de.mission.d3fe76c0:Ouvrir Chef de mission`,
    description: $localize`:@@core.product-onboarding.catalog.ts.decouvrez.l.assistant.ia.du.cabinet.d5bf11f7:Découvrez l’assistant IA du cabinet.`,
    route: '/firm/assistant',
    permission: 'firm:ai:chat'
  }
];

export function filterTourSteps(
  steps: readonly ProductTourStepDef[],
  options: { compact: boolean; elementExists: (selector: string) => boolean }
): ProductTourStepDef[] {
  return steps.filter(step => {
    if (options.compact && !step.compact) {
      return false;
    }
    if (!step.selector) {
      return true;
    }
    return options.elementExists(step.selector);
  });
}

export function mergeChecklistDone(
  manualIds: readonly string[] | undefined,
  autoIds: readonly string[] | undefined
): Set<string> {
  return new Set([...(manualIds ?? []), ...(autoIds ?? [])]);
}
