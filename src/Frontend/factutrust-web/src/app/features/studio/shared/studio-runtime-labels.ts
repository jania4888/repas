/**
 * Libellés français centralisés du runtime des vues enregistrées et des relations N-N (PR 2.5).
 * Toute chaîne visible dans ces écrans doit passer par cet objet (pas de littéral dispersé).
 */
export const STUDIO_RUNTIME_LABELS = {
  views: {
    listTab: 'Liste',
    newView: 'Nouvelle vue',
    editView: 'Modifier la vue',
    defaultBadge: 'Vue par défaut',
    truncatedGeneric: 'Affichage limité ; affinez les filtres.',
    empty: 'Aucun enregistrement.',
    error: 'Chargement de la vue impossible.',
    searchDisabled: 'La recherche est désactivée pour cette vue.',
    soon: 'Bientôt'
  },
  kanban: {
    moveTo: 'Déplacer vers…',
    emptyGroup: 'Sans valeur',
    truncated: 'Affichage limité à 500 cartes ; affinez les filtres.',
    moved: 'Fiche déplacée vers {column}',
    conflict: 'La fiche a été modifiée ailleurs ; rechargement.',
    genericError: 'Déplacement impossible.'
  },
  calendar: {
    month: 'Mois',
    week: 'Semaine',
    today: 'Aujourd’hui',
    open: 'Ouvrir',
    truncated: 'Affichage limité à 1000 événements ; affinez les filtres.'
  },
  designer: {
    title: 'Concepteur de vue',
    previewDraft: 'Aperçu du brouillon en cours (20 premiers enregistrements).',
    previewInvalid: 'Complétez la définition pour voir l’aperçu.',
    previewDesignOnly: 'L’aperçu en direct est réservé aux concepteurs.',
    setDefault: 'Vue par défaut',
    delete: 'Supprimer',
    save: 'Enregistrer',
    duplicateKey: 'Une vue porte déjà cette clé.',
    planLimit: 'Limite du plan atteinte pour les vues enregistrées.',
    staleConflict: 'La vue a été modifiée ailleurs ; rechargez.',
    name: 'Nom de la vue',
    key: 'Clé',
    mode: 'Mode d’affichage',
    columns: 'Colonnes',
    sort: 'Tri',
    pageSize: 'Taille de page',
    kanbanGroupBy: 'Champ de regroupement',
    calendarStart: 'Champ de début',
    columnLimit: 'Nombre maximal de colonnes atteint.',
    sortLimit: 'Nombre maximal de critères de tri atteint.',
    invalidKey: 'Clé invalide : minuscule initiale, lettres, chiffres ou « _ » (2 à 64 caractères).',
    keyImmutable: 'La clé d’une vue est immuable.',
    deleted: 'Vue supprimée.',
    saved: 'Vue enregistrée.'
  },
  relations: {
    title: 'Relations',
    addManyToMany: 'Ajouter une relation plusieurs-à-plusieurs',
    junctionAttributeHint: 'Un champ numérique est ajouté à la table de liaison (ex. quantité par fiche liée).',
    empty: 'Relations non activées.',
    duplicateKey: 'Une table de liaison porte déjà cette clé.',
    created: 'Relation plusieurs-à-plusieurs créée.'
  },
  linked: {
    tabLabel: 'Liés',
    add: 'Ajouter',
    remove: 'Retirer',
    duplicate: 'Lien déjà existant.',
    truncated: 'Certaines fiches liées ne sont pas affichées.',
    error: 'Chargement des fiches liées impossible.',
    edit: 'Modifier',
    save: 'Enregistrer',
    cancel: 'Annuler',
    conflict: 'Modifié entre-temps — liste rechargée.'
  },
  history: {
    tabLabel: 'Historique',
    hint: 'Créations, modifications et suppression de cet enregistrement, du plus récent au plus ancien.',
    colDate: 'Date',
    colAction: 'Action',
    colUser: 'Utilisateur',
    colChanges: 'Changements',
    actionCreated: 'Création',
    actionUpdated: 'Modification',
    actionDeleted: 'Suppression',
    unknownUser: 'Utilisateur inconnu',
    empty: 'Aucun historique pour cet enregistrement',
    emptyHint: 'Les créations, modifications et suppressions apparaîtront ici.',
    loadError: 'Impossible de charger l\'historique.',
    retry: 'Réessayer',
    loadMore: 'Charger plus',
    count: '{shown} sur {total}',
    showMore: 'Afficher les {count} autres',
    showLess: 'Réduire',
    emptyValue: '(vide)',
    noChanges: '—',
    yes: 'Oui',
    no: 'Non'
  },
  entities: {
    junctionBadge: 'Jonction',
    hideJunctions: 'Masquer les jonctions'
  },
  filters: {
    title: 'Filtres',
    add: 'Ajouter un filtre',
    remove: 'Retirer ce filtre',
    field: 'Champ',
    operator: 'Opérateur',
    value: 'Valeur',
    empty: 'Aucun filtre.',
    limitReached: 'Nombre maximal de filtres atteint.',
    ops: {
      eq: 'est égal à',
      neq: 'est différent de',
      contains: 'contient',
      gt: 'est supérieur à',
      gte: 'est supérieur ou égal à',
      lt: 'est inférieur à',
      lte: 'est inférieur ou égal à',
      in: 'est parmi',
      is_empty: 'est vide',
      is_not_empty: 'n’est pas vide',
      between: 'est compris entre'
    }
  }
} as const;
