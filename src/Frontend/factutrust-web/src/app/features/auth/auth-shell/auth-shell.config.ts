export interface AuthShellFeature {
  icon: string;
  label: string;
  description?: string;
}

export type AuthShellBadgeVariant = 'secure' | 'new' | 'context' | 'firm';

export interface AuthShellConfig {
  badge: string;
  badgeVariant?: AuthShellBadgeVariant;
  title: string;
  description?: string;
  features?: AuthShellFeature[];
  showAiHighlight?: boolean;
  showTrustFooter?: boolean;
  /** Wider floating card for multi-step registration wizards. */
  wideFormCard?: boolean;
  /**
   * When true, the floating form card is height-capped and scrolls internally.
   * Default: true only for wide wizard cards. Compact pages (login, etc.) grow to fit.
   */
  scrollableFormCard?: boolean;
}

/** Full-viewport office photo used as decorative auth background. */
export const AUTH_HERO_OFFICE = 'assets/branding/auth-hero-office.webp';
export const AUTH_HERO_OFFICE_FALLBACK = 'assets/branding/auth-hero-office.jpg';

const LOGIN_FEATURES: AuthShellFeature[] = [
  {
    icon: 'pi-chart-bar',
    label: $localize`:@@auth.auth-shell.ts.tableaux.de.bord.intelligents.165b8bf8:Tableaux de bord intelligents`,
    description: $localize`:@@auth.auth-shell.ts.suivez.vos.indicateurs.cles.en.temps.ree.53913376:Suivez vos indicateurs clés en temps réel et pilotez votre activité d’un coup d’œil.`,
  },
  {
    icon: 'pi-shopping-cart',
    label: $localize`:@@auth.auth-shell.ts.ventes.achats.optimises.9be56fc2:Ventes & Achats optimisés`,
    description: $localize`:@@auth.auth-shell.ts.devis.commandes.factures.et.achats.dans.4068a5f1:Devis, commandes, factures et achats dans un flux unique.`,
  },
  {
    icon: 'pi-box',
    label: $localize`:@@auth.auth-shell.ts.stocks.inventaires.maitrises.afef3032:Stocks & Inventaires maîtrisés`,
    description: $localize`:@@auth.auth-shell.ts.suivi.intelligent.des.stocks.alertes.et.884bbba6:Suivi intelligent des stocks, alertes et inventaires simplifiés.`,
  },
  {
    icon: 'pi-chart-pie',
    label: $localize`:@@auth.auth-shell.ts.analyses.rapports.avances.016424f6:Analyses & Rapports avancés`,
    description: $localize`:@@auth.auth-shell.ts.des.rapports.clairs.assistes.par.l.ia.po.d71f38f9:Des rapports clairs, assistés par l’IA, pour décider plus vite.`,
  },
];

const REGISTER_FEATURES: AuthShellFeature[] = [
  {
    icon: 'pi-file-edit',
    label: $localize`:@@auth.auth-shell.ts.facturation.electronique.conforme.6d666ff0:Facturation électronique conforme`,
    description: $localize`:@@auth.auth-shell.ts.emettez.et.recevez.vos.factures.dans.le.a8116fce:Émettez et recevez vos factures dans le respect des normes en vigueur.`,
  },
  {
    icon: 'pi-shopping-cart',
    label: $localize`:@@auth.auth-shell.ts.gestion.commerciale.integree.66ac40d4:Gestion commerciale intégrée`,
    description: $localize`:@@auth.auth-shell.ts.centralisez.ventes.achats.et.clients.dan.690672e7:Centralisez ventes, achats et clients dans un seul espace.`,
  },
  {
    icon: 'pi-box',
    label: $localize`:@@auth.auth-shell.ts.suivi.des.stocks.en.temps.reel.08fbec98:Suivi des stocks en temps réel`,
    description: $localize`:@@auth.auth-shell.ts.anticipez.les.ruptures.et.suivez.vos.mou.0b7f20d7:Anticipez les ruptures et suivez vos mouvements d’inventaire.`,
  },
  {
    icon: 'pi-chart-line',
    label: $localize`:@@auth.auth-shell.ts.pilotage.financier.simplifie.9f6852c1:Pilotage financier simplifié`,
    description: $localize`:@@auth.auth-shell.ts.visualisez.votre.activite.et.prenez.des.591425dc:Visualisez votre activité et prenez des décisions plus rapidement.`,
  },
];

const REGISTER_FIRM_FEATURES: AuthShellFeature[] = [
  {
    icon: 'pi-users',
    label: $localize`:@@auth.auth-shell.ts.gestion.multi.dossiers.clients.713e33d4:Gestion multi-dossiers clients`,
    description: $localize`:@@auth.auth-shell.ts.accedez.a.tous.vos.dossiers.societes.dep.bf7766dc:Accédez à tous vos dossiers sociétés depuis un espace cabinet unique.`,
  },
  {
    icon: 'pi-briefcase',
    label: $localize`:@@auth.auth-shell.ts.pilotage.cabinet.centralise.810856e8:Pilotage cabinet centralisé`,
    description: $localize`:@@auth.auth-shell.ts.suivez.l.activite.les.invitations.et.la.68e96a23:Suivez l’activité, les invitations et la collaboration d’équipe.`,
  },
  {
    icon: 'pi-shield',
    label: $localize`:@@auth.auth-shell.ts.acces.delegue.securise.ecabe398:Accès délégué sécurisé`,
    description: $localize`:@@auth.auth-shell.ts.intervenez.sur.les.dossiers.clients.sans.c73319ba:Intervenez sur les dossiers clients sans compromettre la sécurité.`,
  },
  {
    icon: 'pi-chart-bar',
    label: $localize`:@@auth.auth-shell.ts.rentabilite.et.reporting.8afc1e34:Rentabilité et reporting`,
    description: $localize`:@@auth.auth-shell.ts.mesurez.la.performance.de.vos.missions.e.31cf42d8:Mesurez la performance de vos missions et de vos collaborateurs.`,
  },
];

const WAREHOUSE_FEATURES: AuthShellFeature[] = [
  {
    icon: 'pi-box',
    label: $localize`:@@auth.auth-shell.ts.donnees.de.stock.filtrees.par.site.f8dacee3:Données de stock filtrées par site`,
    description: $localize`:@@auth.auth-shell.ts.les.stocks.et.operations.s.adaptent.a.l.2a9e4f4e:Les stocks et opérations s’adaptent à l’entrepôt sélectionné.`,
  },
  {
    icon: 'pi-sync',
    label: $localize`:@@auth.auth-shell.ts.contexte.de.travail.memorise.a053310e:Contexte de travail mémorisé`,
    description: $localize`:@@auth.auth-shell.ts.votre.choix.d.entrepot.est.conserve.pour.5fb55a64:Votre choix d’entrepôt est conservé pour cette session.`,
  },
];

export const LOGIN_AUTH_SHELL_CONFIG: AuthShellConfig = {
  badge: 'Espace sécurisé',
  badgeVariant: 'secure',
  title: $localize`:@@auth.auth-shell.ts.pilotez.votre.activite.commerciale.en.to.9f40694b:Pilotez votre activité commerciale en toute sérénité`,
  description:
    $localize`:@@auth.auth-shell.ts.instafact.est.la.solution.intelligente.t.dc9c6cb5:InstaFact est la solution intelligente tout-en-un pour gérer vos ventes, achats, stocks, clients et facturation électronique.`,
  features: LOGIN_FEATURES,
  showAiHighlight: true,
  showTrustFooter: true,
  scrollableFormCard: false,
};

export const REGISTER_AUTH_SHELL_CONFIG: AuthShellConfig = {
  badge: 'Nouveau',
  badgeVariant: 'new',
  title: $localize`:@@auth.auth-shell.ts.simplifiez.votre.gestion.des.aujourd.hui.5bda5632:Simplifiez votre gestion dès aujourd'hui`,
  description:
    $localize`:@@auth.auth-shell.ts.rejoignez.instafact.et.prenez.le.control.8c4901c8:Rejoignez InstaFact et prenez le contrôle de votre facturation et de vos flux financiers en quelques étapes.`,
  features: REGISTER_FEATURES,
  showAiHighlight: true,
  showTrustFooter: true,
  wideFormCard: true,
  scrollableFormCard: false,
};

export const REGISTER_FIRM_AUTH_SHELL_CONFIG: AuthShellConfig = {
  badge: 'Cabinet comptable',
  badgeVariant: 'firm',
  title: $localize`:@@auth.auth-shell.ts.pilotez.votre.cabinet.en.toute.serenite.48dbdf7c:Pilotez votre cabinet en toute sérénité`,
  description:
    $localize`:@@auth.auth-shell.ts.centralisez.la.gestion.de.vos.dossiers.c.2faa6095:Centralisez la gestion de vos dossiers clients, collaborez en équipe et offrez un service premium à vos entreprises.`,
  features: REGISTER_FIRM_FEATURES,
  showAiHighlight: false,
  showTrustFooter: true,
  wideFormCard: true,
  scrollableFormCard: false,
};

export const SELECT_WAREHOUSE_AUTH_SHELL_CONFIG: AuthShellConfig = {
  badge: 'Contexte de travail',
  badgeVariant: 'context',
  title: $localize`:@@auth.auth-shell.ts.choisissez.votre.entrepot.c4dadfab:Choisissez votre entrepôt`,
  description:
    $localize`:@@auth.auth-shell.ts.les.donnees.de.stock.et.certaines.operat.e900034e:Les données de stock et certaines opérations sont filtrées par entrepôt. Sélectionnez celui dans lequel vous travaillez.`,
  features: WAREHOUSE_FEATURES,
  showAiHighlight: false,
  showTrustFooter: true,
};

export const FORGOT_PASSWORD_AUTH_SHELL_CONFIG: AuthShellConfig = {
  badge: 'Sécurisé',
  badgeVariant: 'secure',
  title: $localize`:@@auth.auth-shell.ts.recuperez.l.acces.a.votre.espace.d3c0ad93:Récupérez l'accès à votre espace`,
  description:
    $localize`:@@auth.auth-shell.ts.saisissez.l.adresse.email.associee.a.vot.f9a408c1:Saisissez l'adresse email associée à votre compte. Nous vous enverrons un lien pour réinitialiser votre mot de passe.`,
  showAiHighlight: false,
  showTrustFooter: true,
};

export const RESET_PASSWORD_AUTH_SHELL_CONFIG: AuthShellConfig = {
  badge: 'Sécurisé',
  badgeVariant: 'secure',
  title: $localize`:@@auth.auth-shell.ts.definissez.votre.nouveau.mot.de.passe.c179989d:Définissez votre nouveau mot de passe`,
  description:
    $localize`:@@auth.auth-shell.ts.choisissez.un.mot.de.passe.fort.pour.sec.700f1c9d:Choisissez un mot de passe fort pour sécuriser votre compte InstaFact.`,
  showAiHighlight: false,
  showTrustFooter: true,
};

export const PORTAL_INVITE_AUTH_SHELL_CONFIG: AuthShellConfig = {
  badge: 'Espace client',
  badgeVariant: 'secure',
  title: $localize`:@@auth.auth-shell.ts.activez.votre.espace.client.8987ab9c:Activez votre espace client`,
  description:
    $localize`:@@auth.auth-shell.ts.choisissez.un.mot.de.passe.pour.consulte.e444c9a1:Choisissez un mot de passe pour consulter vos factures, paiements et relevé auprès de votre fournisseur.`,
  showAiHighlight: false,
  showTrustFooter: true,
};
