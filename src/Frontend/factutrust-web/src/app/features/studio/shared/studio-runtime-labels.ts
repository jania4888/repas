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
    previewHint: 'Enregistrez pour voir l’aperçu.',
    setDefault: 'Vue par défaut',
    delete: 'Supprimer',
    save: 'Enregistrer',
    duplicateKey: 'Une vue porte déjà cette clé.',
    planLimit: 'Limite du plan atteinte pour les vues enregistrées.',
    staleConflict: 'La vue a été modifiée ailleurs ; rechargez.'
  },
  relations: {
    title: 'Relations',
    addManyToMany: 'Ajouter une relation plusieurs-à-plusieurs',
    junctionAttributeSoon: 'Attribut de liaison — Bientôt',
    empty: 'Relations non activées.',
    duplicateKey: 'Une table de liaison porte déjà cette clé.',
    created: 'Relation plusieurs-à-plusieurs créée.'
  },
  linked: {
    tabLabel: 'Liés',
    add: 'Ajouter',
    remove: 'Retirer',
    duplicate: 'Lien déjà existant.',
    truncated: 'Certaines fiches liées ne sont pas affichées.'
  }
} as const;
