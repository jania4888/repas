/**
 * Libellés français centralisés du runtime des vues enregistrées et des relations N-N (PR 2.5).
 * Toute chaîne visible dans ces écrans doit passer par cet objet (pas de littéral dispersé).
 */
export const STUDIO_RUNTIME_LABELS = {
  views: {
    listTab: $localize`:@@studio.studio-runtime-labels.ts.liste.4231be17:Liste`,
    newView: $localize`:@@studio.studio-runtime-labels.ts.nouvelle.vue.5c1894bc:Nouvelle vue`,
    editView: $localize`:@@studio.studio-runtime-labels.ts.modifier.la.vue.6e6ad47d:Modifier la vue`,
    defaultBadge: $localize`:@@studio.studio-runtime-labels.ts.vue.par.defaut.5bc0aaaf:Vue par défaut`,
    truncatedGeneric: $localize`:@@studio.studio-runtime-labels.ts.affichage.limite.affinez.les.filtres.b04e076f:Affichage limité ; affinez les filtres.`,
    empty: $localize`:@@studio.studio-runtime-labels.ts.aucun.enregistrement.3acbe7b2:Aucun enregistrement.`,
    error: $localize`:@@studio.studio-runtime-labels.ts.chargement.de.la.vue.impossible.6f838b59:Chargement de la vue impossible.`,
    searchDisabled: $localize`:@@studio.studio-runtime-labels.ts.la.recherche.est.desactivee.pour.cette.v.2fc89294:La recherche est désactivée pour cette vue.`,
    soon: $localize`:@@studio.studio-runtime-labels.ts.bientot.a60303f4:Bientôt`
  },
  kanban: {
    moveTo: $localize`:@@studio.studio-runtime-labels.ts.deplacer.vers.4fc1f752:Déplacer vers…`,
    emptyGroup: $localize`:@@studio.studio-runtime-labels.ts.sans.valeur.5f75588f:Sans valeur`,
    truncated: $localize`:@@studio.studio-runtime-labels.ts.affichage.limite.a.500.cartes.affinez.le.1b62d317:Affichage limité à 500 cartes ; affinez les filtres.`,
    moved: $localize`:@@studio.studio-runtime-labels.ts.fiche.deplacee.vers.column.da914b65:Fiche déplacée vers {column}`,
    conflict: $localize`:@@studio.studio-runtime-labels.ts.la.fiche.a.ete.modifiee.ailleurs.recharg.6e135b88:La fiche a été modifiée ailleurs ; rechargement.`,
    genericError: $localize`:@@studio.studio-runtime-labels.ts.deplacement.impossible.63359524:Déplacement impossible.`
  },
  calendar: {
    month: $localize`:@@studio.studio-runtime-labels.ts.mois.0d304bea:Mois`,
    week: $localize`:@@studio.studio-runtime-labels.ts.semaine.33703a8c:Semaine`,
    today: $localize`:@@studio.studio-runtime-labels.ts.aujourd.hui.ba0603b4:Aujourd’hui`,
    open: $localize`:@@studio.studio-runtime-labels.ts.ouvrir.42c07747:Ouvrir`,
    truncated: $localize`:@@studio.studio-runtime-labels.ts.affichage.limite.a.1000.evenements.affin.2bb0a655:Affichage limité à 1000 événements ; affinez les filtres.`
  },
  designer: {
    title: $localize`:@@studio.studio-runtime-labels.ts.concepteur.de.vue.15ece176:Concepteur de vue`,
    previewDraft: $localize`:@@studio.studio-runtime-labels.ts.apercu.du.brouillon.en.cours.20.premiers.e963d877:Aperçu du brouillon en cours (20 premiers enregistrements).`,
    previewInvalid: $localize`:@@studio.studio-runtime-labels.ts.completez.la.definition.pour.voir.l.aper.b387a61d:Complétez la définition pour voir l’aperçu.`,
    previewDesignOnly: $localize`:@@studio.studio-runtime-labels.ts.l.apercu.en.direct.est.reserve.aux.conce.df4e5949:L’aperçu en direct est réservé aux concepteurs.`,
    setDefault: $localize`:@@studio.studio-runtime-labels.ts.vue.par.defaut.5bc0aaaf:Vue par défaut`,
    delete: $localize`:@@studio.studio-runtime-labels.ts.supprimer.1acfc1c7:Supprimer`,
    save: $localize`:@@studio.studio-runtime-labels.ts.enregistrer.f7c8bcd8:Enregistrer`,
    duplicateKey: $localize`:@@studio.studio-runtime-labels.ts.une.vue.porte.deja.cette.cle.5698848d:Une vue porte déjà cette clé.`,
    planLimit: $localize`:@@studio.studio-runtime-labels.ts.limite.du.plan.atteinte.pour.les.vues.en.87381c93:Limite du plan atteinte pour les vues enregistrées.`,
    staleConflict: $localize`:@@studio.studio-runtime-labels.ts.la.vue.a.ete.modifiee.ailleurs.rechargez.bf57bfa1:La vue a été modifiée ailleurs ; rechargez.`,
    name: 'Nom de la vue',
    key: 'Clé',
    mode: 'Mode d’affichage',
    columns: $localize`:@@studio.studio-runtime-labels.ts.colonnes.53a2544c:Colonnes`,
    sort: $localize`:@@studio.studio-runtime-labels.ts.tri.c05261e0:Tri`,
    pageSize: $localize`:@@studio.studio-runtime-labels.ts.taille.de.page.09347b93:Taille de page`,
    kanbanGroupBy: $localize`:@@studio.studio-runtime-labels.ts.champ.de.regroupement.0c69e74f:Champ de regroupement`,
    calendarStart: $localize`:@@studio.studio-runtime-labels.ts.champ.de.debut.6164c285:Champ de début`,
    columnLimit: $localize`:@@studio.studio-runtime-labels.ts.nombre.maximal.de.colonnes.atteint.bd34cf9d:Nombre maximal de colonnes atteint.`,
    sortLimit: $localize`:@@studio.studio-runtime-labels.ts.nombre.maximal.de.criteres.de.tri.attein.c253894f:Nombre maximal de critères de tri atteint.`,
    invalidKey: $localize`:@@studio.studio-runtime-labels.ts.cle.invalide.minuscule.initiale.lettres.af9a773b:Clé invalide : minuscule initiale, lettres, chiffres ou « _ » (2 à 64 caractères).`,
    keyImmutable: $localize`:@@studio.studio-runtime-labels.ts.la.cle.d.une.vue.est.immuable.81d4aae9:La clé d’une vue est immuable.`,
    deleted: $localize`:@@studio.studio-runtime-labels.ts.vue.supprimee.c35b6b82:Vue supprimée.`,
    saved: $localize`:@@studio.studio-runtime-labels.ts.vue.enregistree.09622d42:Vue enregistrée.`
  },
  relations: {
    title: $localize`:@@studio.studio-runtime-labels.ts.relations.6519fe11:Relations`,
    addManyToMany: $localize`:@@studio.studio-runtime-labels.ts.ajouter.une.relation.plusieurs.a.plusieu.933609af:Ajouter une relation plusieurs-à-plusieurs`,
    junctionAttributeHint: $localize`:@@studio.studio-runtime-labels.ts.un.champ.numerique.est.ajoute.a.la.table.9781745b:Un champ numérique est ajouté à la table de liaison (ex. quantité par fiche liée).`,
    empty: $localize`:@@studio.studio-runtime-labels.ts.relations.non.activees.eceb18c5:Relations non activées.`,
    duplicateKey: $localize`:@@studio.studio-runtime-labels.ts.une.table.de.liaison.porte.deja.cette.cl.98ede013:Une table de liaison porte déjà cette clé.`,
    created: $localize`:@@studio.studio-runtime-labels.ts.relation.plusieurs.a.plusieurs.creee.22b030c9:Relation plusieurs-à-plusieurs créée.`
  },
  linked: {
    tabLabel: $localize`:@@studio.studio-runtime-labels.ts.lies.52db5710:Liés`,
    add: $localize`:@@studio.studio-runtime-labels.ts.ajouter.87c57ed1:Ajouter`,
    remove: $localize`:@@studio.studio-runtime-labels.ts.retirer.54ec24a1:Retirer`,
    duplicate: $localize`:@@studio.studio-runtime-labels.ts.lien.deja.existant.d8c20221:Lien déjà existant.`,
    truncated: $localize`:@@studio.studio-runtime-labels.ts.certaines.fiches.liees.ne.sont.pas.affic.27df0af2:Certaines fiches liées ne sont pas affichées.`,
    error: $localize`:@@studio.studio-runtime-labels.ts.chargement.des.fiches.liees.impossible.9afce907:Chargement des fiches liées impossible.`,
    edit: $localize`:@@studio.studio-runtime-labels.ts.modifier.f260e757:Modifier`,
    save: $localize`:@@studio.studio-runtime-labels.ts.enregistrer.f7c8bcd8:Enregistrer`,
    cancel: $localize`:@@studio.studio-runtime-labels.ts.annuler.49ba3292:Annuler`,
    conflict: $localize`:@@studio.studio-runtime-labels.ts.modifie.entre.temps.liste.rechargee.68027404:Modifié entre-temps — liste rechargée.`
  },
  history: {
    tabLabel: $localize`:@@studio.studio-runtime-labels.ts.historique.34f3a06a:Historique`,
    hint: $localize`:@@studio.studio-runtime-labels.ts.creations.modifications.et.suppression.d.36a12eac:Créations, modifications et suppression de cet enregistrement, du plus récent au plus ancien.`,
    colDate: $localize`:@@studio.studio-runtime-labels.ts.date.eb9a4bc1:Date`,
    colAction: $localize`:@@studio.studio-runtime-labels.ts.action.97c89a4d:Action`,
    colUser: $localize`:@@studio.studio-runtime-labels.ts.utilisateur.0b20cd7f:Utilisateur`,
    colChanges: $localize`:@@studio.studio-runtime-labels.ts.changements.b7411198:Changements`,
    actionCreated: $localize`:@@studio.studio-runtime-labels.ts.creation.b5061590:Création`,
    actionUpdated: $localize`:@@studio.studio-runtime-labels.ts.modification.e3ea079d:Modification`,
    actionDeleted: $localize`:@@studio.studio-runtime-labels.ts.suppression.c3b592c0:Suppression`,
    unknownUser: $localize`:@@studio.studio-runtime-labels.ts.utilisateur.inconnu.71b37ada:Utilisateur inconnu`,
    empty: $localize`:@@studio.studio-runtime-labels.ts.aucun.historique.pour.cet.enregistrement.9e1eb983:Aucun historique pour cet enregistrement`,
    emptyHint: $localize`:@@studio.studio-runtime-labels.ts.les.creations.modifications.et.suppressi.c4f384c7:Les créations, modifications et suppressions apparaîtront ici.`,
    loadError: $localize`:@@studio.studio-runtime-labels.ts.impossible.de.charger.l.historique.2e5c79df:Impossible de charger l'historique.`,
    retry: $localize`:@@studio.studio-runtime-labels.ts.reessayer.895d416b:Réessayer`,
    loadMore: $localize`:@@studio.studio-runtime-labels.ts.charger.plus.37d1844c:Charger plus`,
    count: '{shown} sur {total}',
    showMore: $localize`:@@studio.studio-runtime-labels.ts.afficher.les.count.autres.dd1e480f:Afficher les {count} autres`,
    showLess: $localize`:@@studio.studio-runtime-labels.ts.reduire.86a52505:Réduire`,
    emptyValue: $localize`:@@studio.studio-runtime-labels.ts.vide.4c98f0c4:(vide)`,
    noChanges: '—',
    yes: $localize`:@@studio.studio-runtime-labels.ts.oui.eaa02f3f:Oui`,
    no: $localize`:@@studio.studio-runtime-labels.ts.non.a7219939:Non`
  },
  entities: {
    junctionBadge: $localize`:@@studio.studio-runtime-labels.ts.jonction.1f6dc40a:Jonction`,
    hideJunctions: $localize`:@@studio.studio-runtime-labels.ts.masquer.les.jonctions.795c262a:Masquer les jonctions`
  },
  filters: {
    title: $localize`:@@studio.studio-runtime-labels.ts.filtres.2a8e76e0:Filtres`,
    add: $localize`:@@studio.studio-runtime-labels.ts.ajouter.un.filtre.11f60cc2:Ajouter un filtre`,
    remove: $localize`:@@studio.studio-runtime-labels.ts.retirer.ce.filtre.d33794b2:Retirer ce filtre`,
    field: 'Champ',
    operator: $localize`:@@studio.studio-runtime-labels.ts.operateur.4577d034:Opérateur`,
    value: 'Valeur',
    empty: $localize`:@@studio.studio-runtime-labels.ts.aucun.filtre.d46c60e3:Aucun filtre.`,
    limitReached: $localize`:@@studio.studio-runtime-labels.ts.nombre.maximal.de.filtres.atteint.8f294691:Nombre maximal de filtres atteint.`,
    ops: {
      eq: $localize`:@@studio.studio-runtime-labels.ts.est.egal.a.98277a07:est égal à`,
      neq: $localize`:@@studio.studio-runtime-labels.ts.est.different.de.0c518746:est différent de`,
      contains: $localize`:@@studio.studio-runtime-labels.ts.contient.207c5ba4:contient`,
      gt: $localize`:@@studio.studio-runtime-labels.ts.est.superieur.a.6cdb71f3:est supérieur à`,
      gte: $localize`:@@studio.studio-runtime-labels.ts.est.superieur.ou.egal.a.f64d52de:est supérieur ou égal à`,
      lt: $localize`:@@studio.studio-runtime-labels.ts.est.inferieur.a.1e4b988f:est inférieur à`,
      lte: $localize`:@@studio.studio-runtime-labels.ts.est.inferieur.ou.egal.a.f1aa2996:est inférieur ou égal à`,
      in: $localize`:@@studio.studio-runtime-labels.ts.est.parmi.b0a29ea3:est parmi`,
      is_empty: $localize`:@@studio.studio-runtime-labels.ts.est.vide.52b4a447:est vide`,
      is_not_empty: $localize`:@@studio.studio-runtime-labels.ts.n.est.pas.vide.ca50c992:n’est pas vide`,
      between: $localize`:@@studio.studio-runtime-labels.ts.est.compris.entre.bc2e5223:est compris entre`
    }
  }
} as const;
