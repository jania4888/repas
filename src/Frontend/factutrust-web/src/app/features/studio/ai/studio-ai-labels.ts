/// <reference types="@angular/localize" />
import { StudioAiIntent, StudioAiPlanStatus, StudioAiPreviewTab, StudioSpecFieldType } from './studio-ai.models';

/** Une carte d'intention « Que voulez-vous créer ? ». */
export interface StudioAiIntentCardDef {
  intent: StudioAiIntent;
  title: string;
  description: string;
  icon: string;
  /** Texte placé dans le composer au clic (l'utilisateur complète les « … »). */
  prompt: string;
  /** `false` ⇒ carte visible mais désactivée avec badge « Bientôt » (phase ultérieure). */
  available: boolean;
  /** Tooltip affiché quand la carte est désactivée. */
  soonTooltip?: string;
}

export interface StudioAiTabDef {
  id: StudioAiPreviewTab;
  label: string;
  icon: string;
  /** `false` ⇒ onglet rendu désactivé avec badge « Bientôt ». */
  available: boolean;
  soonTooltip?: string;
}

/** Libellés français centralisés de l'atelier Studio IA (P1). */
export const STUDIO_AI_LABELS = {
  page: {
    title: $localize`:@@studio.studio-ai-labels.ts.studio.ia.04d04eb2:Studio IA`,
    subtitle: $localize`:@@studio.studio-ai-labels.ts.decrivez.votre.besoin.metier.l.ia.propos.886e66a1:Décrivez votre besoin métier : l’IA propose une structure complète, vous la vérifiez, l’ajustez et l’intégrez dans l’ERP.`,
    heroTitle: $localize`:@@studio.studio-ai-labels.ts.decrivez.le.systeme.que.vous.souhaitez.c.bc765770:Décrivez le système que vous souhaitez créer`,
    heroHint: $localize`:@@studio.studio-ai-labels.ts.exemple.creer.un.systeme.de.gestion.des.fc57ae85:Exemple : « Créer un système de gestion des congés avec employés, types de congés, demandes, validations et rapports. »`,
    composerPlaceholder: $localize`:@@studio.studio-ai-labels.ts.decrivez.le.systeme.la.table.ou.le.rappo.d6233b5a:Décrivez le système, la table ou le rapport à créer…`,
    generate: $localize`:@@studio.studio-ai-labels.ts.generer.avec.l.ia.7f9b3a3b:Générer avec l’IA`,
    generating: $localize`:@@studio.studio-ai-labels.ts.generation.en.cours.46fb6bcf:Génération en cours…`,
    editRequest: $localize`:@@studio.studio-ai-labels.ts.modifier.la.demande.ca60674f:Modifier la demande`,
    regenerate: $localize`:@@studio.studio-ai-labels.ts.regenerer.af5d1d73:Régénérer`,
    newGeneration: $localize`:@@studio.studio-ai-labels.ts.nouvelle.generation.36928917:Nouvelle génération`,
    yourRequest: $localize`:@@studio.studio-ai-labels.ts.votre.demande.f534bab6:VOTRE DEMANDE`,
    fromTemplate: $localize`:@@studio.studio-ai-labels.ts.modele.20bd76ee:MODÈLE`,
    creating: $localize`:@@studio.studio-ai-labels.ts.creation.en.cours.1488d01b:Création en cours…`,
    createdOn: $localize`:@@studio.studio-ai-labels.ts.cree.le.046c02a0:Créé le`,
    advancedModel: $localize`:@@studio.studio-ai-labels.ts.modele.avance.9fe32624:Modèle avancé`,
    advancedModelHint: $localize`:@@studio.studio-ai-labels.ts.utilise.le.modele.avance.configure.par.l.5c673199:Utilise le modèle avancé configuré par l’administrateur pour cette génération.`,
    attach: $localize`:@@studio.studio-ai-labels.ts.joindre.un.document.5fb7d976:Joindre un document`,
    micStart: $localize`:@@studio.studio-ai-labels.ts.dicter.la.demande.cb24c4d0:Dicter la demande`,
    micStop: $localize`:@@studio.studio-ai-labels.ts.arreter.la.dictee.8026b653:Arrêter la dictée`,
    micUnsupported: $localize`:@@studio.studio-ai-labels.ts.la.dictee.n.est.pas.disponible.dans.ce.n.5c7b7832:La dictée n’est pas disponible dans ce navigateur.`,
    showCards: $localize`:@@studio.studio-ai-labels.ts.afficher.les.cartes.244be3b3:Afficher les cartes`,
    hideCards: $localize`:@@studio.studio-ai-labels.ts.masquer.les.cartes.f3e9b5c3:Masquer les cartes`,
    whatToCreate: $localize`:@@studio.studio-ai-labels.ts.que.voulez.vous.creer.3c97b8fc:Que voulez-vous créer ?`,
    seeDocumentation: $localize`:@@studio.studio-ai-labels.ts.voir.la.documentation.bc134202:Voir la documentation`,
    resetConversation: $localize`:@@studio.studio-ai-labels.ts.reinitialiser.la.conversation.051a7732:Réinitialiser la conversation`,
    resetConversationHint: $localize`:@@studio.studio-ai-labels.ts.annule.le.plan.en.attente.et.repart.d.un.837d40c8:Annule le plan en attente et repart d’une conversation vide.`,
    newRequest: $localize`:@@studio.studio-ai-labels.ts.nouvelle.demande.0a6e5d2f:Nouvelle demande`,
    badge: $localize`:@@studio.studio-ai-labels.ts.creer.sans.coder.8aaeebf4:Créer sans coder`,
    docLink: '/documentation/studio-ia',
    advancedModelOn: $localize`:@@studio.studio-ai-labels.ts.modele.avance.active.fa41a5b9:Modèle avancé activé`,
    advancedModelOff: $localize`:@@studio.studio-ai-labels.ts.modele.standard.07ff0fbf:Modèle standard`,
    micSoon: $localize`:@@studio.studio-ai-labels.ts.la.dictee.arrive.dans.une.prochaine.vers.e3e80859:La dictée arrive dans une prochaine version.`,
    // A19 : un message envoyé alors qu'une proposition attend la validation
    pendingPlanTitle: $localize`:@@studio.studio-ai-labels.ts.une.proposition.est.en.attente.d64ea09a:Une proposition est en attente`,
    pendingPlanMessage: $localize`:@@studio.studio-ai-labels.ts.envoyer.un.nouveau.message.abandonne.la.c7da7680:Envoyer un nouveau message abandonne la proposition en cours (rien n’est créé). Continuer ?`,
    pendingPlanAccept: $localize`:@@studio.studio-ai-labels.ts.abandonner.le.plan.et.envoyer.0945d584:Abandonner le plan et envoyer`,
    pendingPlanReject: $localize`:@@studio.studio-ai-labels.ts.garder.la.proposition.901dd5aa:Garder la proposition`,
    templateLoading: $localize`:@@studio.studio-ai-labels.ts.preparation.du.modele.d11677fd:Préparation du modèle…`,
    templateFailed: $localize`:@@studio.studio-ai-labels.ts.impossible.de.preparer.ce.modele.f1f3986b:Impossible de préparer ce modèle.`
  },

  /** Repli du modèle avancé (D3) : le serveur décide, le client informe. */
  model: {
    fallbackTitle: $localize`:@@studio.studio-ai-labels.ts.modele.standard.utilise.e78d50d1:Modèle standard utilisé`,
    fallbackReason: {
      disabled: $localize`:@@studio.studio-ai-labels.ts.le.modele.avance.est.desactive.par.l.adm.49d7291b:le modèle avancé est désactivé par l’administrateur.`,
      not_configured: $localize`:@@studio.studio-ai-labels.ts.le.modele.avance.n.est.pas.configure.4f14f2d2:le modèle avancé n’est pas configuré.`,
      unavailable: $localize`:@@studio.studio-ai-labels.ts.le.modele.avance.est.indisponible.pour.l.4b1a8004:le modèle avancé est indisponible pour le moment.`
    } as Record<string, string>,
    fallbackGeneric: $localize`:@@studio.studio-ai-labels.ts.le.modele.avance.n.a.pas.pu.etre.utilise.4ed7364e:le modèle avancé n’a pas pu être utilisé.`,
    usedAdvanced: $localize`:@@studio.studio-ai-labels.ts.genere.avec.le.modele.avance.02f53a7e:Généré avec le modèle avancé`
  },

  /** Bandeau doublons (PR 1.3 côté serveur, R21 côté atelier). */
  duplicates: {
    title: $localize`:@@studio.studio-ai-labels.ts.la.table.specdisplayname.existe.deja.4349fb28:La table « {specDisplayName} » existe déjà`,
    item: $localize`:@@studio.studio-ai-labels.ts.une.table.existante.existingdisplayname.bf0597c8:Une table existante « {existingDisplayName} » (clé {existingKey}) semble équivalente.`,
    question: $localize`:@@studio.studio-ai-labels.ts.voulez.vous.la.reutiliser.ou.creer.une.n.8f6babd1:Voulez-vous la réutiliser ou créer une nouvelle table « {suggestedName} » ?`,
    reuse: $localize`:@@studio.studio-ai-labels.ts.reutiliser.la.table.existante.b8c94210:Réutiliser la table existante`,
    createAnyway: $localize`:@@studio.studio-ai-labels.ts.creer.quand.meme.49464d1a:Créer quand même`,
    reuseHint: $localize`:@@studio.studio-ai-labels.ts.le.plan.reutilisera.cette.table.sans.la.5e22b55e:Le plan réutilisera cette table sans la modifier.`,
    reused: $localize`:@@studio.studio-ai-labels.ts.table.existante.existingdisplayname.reut.e44370f2:Table existante « {existingDisplayName} » réutilisée.`,
    renamed: $localize`:@@studio.studio-ai-labels.ts.nouvelle.table.renommee.displayname.cc708a1b:Nouvelle table renommée « {displayName} ».`,
    reasons: {
      same_key: $localize`:@@studio.studio-ai-labels.ts.meme.cle.7f8c0508:même clé`,
      same_name: $localize`:@@studio.studio-ai-labels.ts.meme.nom.47aa4312:même nom`,
      singular_plural: $localize`:@@studio.studio-ai-labels.ts.singulier.pluriel.177da0d0:singulier / pluriel`
    } as Record<string, string>,
    suffix: '(2)'
  },

  intents: [
    {
      intent: 'system',
      title: $localize`:@@studio.studio-ai-labels.ts.systeme.complet.88f1bb84:Système complet`,
      description: $localize`:@@studio.studio-ai-labels.ts.tables.relations.formulaires.donnees.de.cf8acd75:Tables, relations, formulaires, données de référence et rapports en une fois.`,
      icon: 'fa-solid fa-layer-group',
      prompt: 'Créer un système de gestion de … avec les tables, relations, formulaires, données de référence et rapports nécessaires.',
      available: true
    },
    {
      intent: 'table',
      title: $localize`:@@studio.studio-ai-labels.ts.table.0424f6e7:Table`,
      description: $localize`:@@studio.studio-ai-labels.ts.une.table.personnalisee.avec.ses.champs.93358b6c:Une table personnalisée avec ses champs et son formulaire.`,
      icon: 'fa-solid fa-table',
      prompt: 'Créer une table « … » avec les champs : ….',
      available: true
    },
    {
      intent: 'relations',
      title: $localize`:@@studio.studio-ai-labels.ts.relations.6519fe11:Relations`,
      description: $localize`:@@studio.studio-ai-labels.ts.relier.des.tables.entre.elles.ou.aux.don.d9fe1431:Relier des tables entre elles ou aux données de l’ERP.`,
      icon: 'fa-solid fa-diagram-project',
      prompt: 'Relier la table « … » à la table « … » (une … a plusieurs …).',
      available: true
    },
    {
      intent: 'form',
      title: $localize`:@@studio.studio-ai-labels.ts.formulaire.87e4e76f:Formulaire`,
      description: $localize`:@@studio.studio-ai-labels.ts.une.mise.en.page.de.saisie.pour.une.tabl.eba16e3a:Une mise en page de saisie pour une table existante.`,
      icon: 'fa-solid fa-file-lines',
      prompt: 'Générer un formulaire de saisie pour la table « … » organisé en sections : ….',
      available: true
    },
    {
      intent: 'reference_data',
      title: $localize`:@@studio.studio-ai-labels.ts.donnees.de.reference.90a59413:Données de référence`,
      description: $localize`:@@studio.studio-ai-labels.ts.listes.de.valeurs.et.donnees.initiales.217a666a:Listes de valeurs et données initiales.`,
      icon: 'fa-solid fa-database',
      prompt: 'Charger les valeurs initiales de la table « … » : ….',
      available: true
    },
    {
      intent: 'report',
      title: $localize`:@@studio.studio-ai-labels.ts.rapport.f25c405b:Rapport`,
      description: $localize`:@@studio.studio-ai-labels.ts.un.etat.regroupe.filtre.et.trie.38f7a291:Un état regroupé, filtré et trié.`,
      icon: 'fa-solid fa-chart-column',
      prompt: 'Créer un rapport « … » regroupé par … avec le total de ….',
      available: true
    },
    {
      intent: 'workflow',
      title: $localize`:@@studio.studio-ai-labels.ts.workflow.d7a48414:Workflow`,
      description: $localize`:@@studio.studio-ai-labels.ts.etats.transitions.et.automatisations.02b83e05:États, transitions et automatisations.`,
      icon: 'fa-solid fa-sitemap',
      prompt: '',
      available: false,
      soonTooltip: $localize`:@@studio.studio-ai-labels.ts.generation.de.workflows.desactivee.par.l.9a6c5b09:Génération de workflows désactivée par l’administrateur.`
    },
    {
      intent: 'page',
      title: $localize`:@@studio.studio-ai-labels.ts.page.interface.e348326c:Page / Interface`,
      description: $localize`:@@studio.studio-ai-labels.ts.tableaux.de.bord.et.pages.personnalisees.5a587af7:Tableaux de bord et pages personnalisées.`,
      icon: 'fa-solid fa-display',
      prompt: '',
      available: false,
      soonTooltip: $localize`:@@studio.studio-ai-labels.ts.disponible.dans.une.prochaine.version.pa.335a31ce:Disponible dans une prochaine version (pages et tableaux de bord).`
    }
  ] as readonly StudioAiIntentCardDef[],

  /** Prompt de la carte Workflow quand le serveur l'active (`workflowToolsEnabled`). */
  workflowPrompt: 'Ajouter un workflow de statut à la table … : états, transitions autorisées et règles de validation.',

  intentTitles: {
    system: $localize`:@@studio.studio-ai-labels.ts.systeme.complet.88f1bb84:Système complet`,
    table: $localize`:@@studio.studio-ai-labels.ts.table.0424f6e7:Table`,
    relations: $localize`:@@studio.studio-ai-labels.ts.relations.6519fe11:Relations`,
    form: $localize`:@@studio.studio-ai-labels.ts.formulaire.87e4e76f:Formulaire`,
    reference_data: $localize`:@@studio.studio-ai-labels.ts.donnees.de.reference.90a59413:Données de référence`,
    report: $localize`:@@studio.studio-ai-labels.ts.rapport.f25c405b:Rapport`,
    workflow: $localize`:@@studio.studio-ai-labels.ts.workflow.d7a48414:Workflow`,
    page: $localize`:@@studio.studio-ai-labels.ts.page.interface.e348326c:Page / Interface`
  } satisfies Record<StudioAiIntent, string>,

  tabs: [
    { id: 'overview', label: $localize`:@@studio.studio-ai-labels.ts.vue.d.ensemble.de0d9643:Vue d’ensemble`, icon: 'fa-solid fa-sitemap', available: true },
    { id: 'tables', label: $localize`:@@studio.studio-ai-labels.ts.tables.193daf13:Tables`, icon: 'fa-solid fa-table', available: true },
    { id: 'relations', label: $localize`:@@studio.studio-ai-labels.ts.relations.6519fe11:Relations`, icon: 'fa-solid fa-diagram-project', available: true },
    { id: 'forms', label: $localize`:@@studio.studio-ai-labels.ts.formulaires.edb3637f:Formulaires`, icon: 'fa-solid fa-file-lines', available: true },
    { id: 'seed', label: $localize`:@@studio.studio-ai-labels.ts.donnees.de.reference.90a59413:Données de référence`, icon: 'fa-solid fa-database', available: true },
    { id: 'reports', label: $localize`:@@studio.studio-ai-labels.ts.rapports.db7d9fbb:Rapports`, icon: 'fa-solid fa-chart-column', available: true },
    { id: 'views', label: $localize`:@@studio.studio-ai-labels.ts.vues.ff576f2b:Vues`, icon: 'fa-solid fa-eye', available: true },
    { id: 'workflow', label: $localize`:@@studio.studio-ai-labels.ts.workflow.d7a48414:Workflow`, icon: 'fa-solid fa-route', available: true },
    {
      id: 'pages',
      label: $localize`:@@studio.studio-ai-labels.ts.pages.600584c2:Pages`,
      icon: 'fa-solid fa-display',
      available: false,
      soonTooltip: $localize`:@@studio.studio-ai-labels.ts.disponible.dans.une.prochaine.version.pa.335a31ce:Disponible dans une prochaine version (pages et tableaux de bord).`
    },
    { id: 'menu', label: $localize`:@@studio.studio-ai-labels.ts.menu.57f5f5ef:Menu`, icon: 'fa-solid fa-bars', available: true }
  ] as readonly StudioAiTabDef[],

  soon: $localize`:@@studio.studio-ai-labels.ts.bientot.a60303f4:Bientôt`,
  soonTeam: $localize`:@@studio.studio-ai-labels.ts.disponible.avec.la.bibliotheque.d.equipe.5d0d173d:Disponible avec la bibliothèque d’équipe.`,
  disabledByAdmin: $localize`:@@studio.studio-ai-labels.ts.fonction.desactivee.par.l.administrateur.6e7b077f:Fonction désactivée par l’administrateur.`,

  /** Résumés de modifications (`summarizeChanges`, FR). */
  changes: {
    fieldsAdded: '{count} champ(s) ajouté(s) à {entity}',
    fieldsRemoved: '{count} champ(s) supprimé(s) de {entity}',
    fieldsChanged: '{count} champ(s) modifié(s) dans {entity}',
    entityAdded: $localize`:@@studio.studio-ai-labels.ts.table.entity.ajoutee.6683f3e4:Table « {entity} » ajoutée`,
    entityRemoved: $localize`:@@studio.studio-ai-labels.ts.table.entity.supprimee.1cad1e84:Table « {entity} » supprimée`,
    entityRenamed: $localize`:@@studio.studio-ai-labels.ts.table.before.renommee.after.4aafd72b:Table « {before} » renommée « {after} »`,
    entityReused: $localize`:@@studio.studio-ai-labels.ts.table.entity.reutilise.la.table.existant.46b2f0f7:Table « {entity} » : réutilise la table existante {existingKey}`,
    entityChanged: $localize`:@@studio.studio-ai-labels.ts.table.entity.modifiee.d0ecb18c:Table « {entity} » modifiée`,
    systemChanged: $localize`:@@studio.studio-ai-labels.ts.parametres.du.systeme.modifies.8bfd0a06:Paramètres du système modifiés`,
    seedChanged: $localize`:@@studio.studio-ai-labels.ts.donnees.de.reference.de.entity.modifiees.6de1d02d:Données de référence de « {entity} » modifiées`,
    formChanged: $localize`:@@studio.studio-ai-labels.ts.formulaire.de.entity.modifie.a1542b1f:Formulaire de « {entity} » modifié`,
    reportChanged: $localize`:@@studio.studio-ai-labels.ts.rapport.de.entity.modifie.30fbb8f3:Rapport de « {entity} » modifié`,
    fieldsReordered: $localize`:@@studio.studio-ai-labels.ts.ordre.des.champs.de.entity.modifie.c55ed1ad:Ordre des champs de « {entity} » modifié`,
    viewsChanged: $localize`:@@studio.studio-ai-labels.ts.vues.de.entity.modifiees.8d658981:Vues de « {entity} » modifiées`
  },

  /** Zone de saisie : pièces jointes et raccourcis clavier. */
  composer: {
    attachments: $localize`:@@studio.studio-ai-labels.ts.pieces.jointes.98d89a25:Pièces jointes`,
    extracting: $localize`:@@studio.studio-ai-labels.ts.extraction.de.name.4ae99ae9:Extraction de {name}…`,
    extractError: $localize`:@@studio.studio-ai-labels.ts.impossible.d.extraire.le.document.format.ce0939be:Impossible d’extraire le document. Formats acceptés : .txt, .csv, .pdf, .png, .jpg, .jpeg, .webp, .docx, .xlsx (max 10 Mo).`,
    maxAttachments: $localize`:@@studio.studio-ai-labels.ts.vous.ne.pouvez.joindre.que.max.pieces.jo.96517ee5:Vous ne pouvez joindre que {max} pièces jointes par demande.`,
    enterHint: $localize`:@@studio.studio-ai-labels.ts.entree.pour.envoyer.maj.entree.pour.un.r.6a4520f1:Entrée pour envoyer · Maj+Entrée pour un retour à la ligne.`,
    empty: $localize`:@@studio.studio-ai-labels.ts.decrivez.votre.besoin.avant.d.envoyer.41e189b1:Décrivez votre besoin avant d’envoyer.`
  },

  preview: {
    title: $localize`:@@studio.studio-ai-labels.ts.apercu.de.la.solution.generee.be249df4:Aperçu de la solution générée`,
    emptyTitle: $localize`:@@studio.studio-ai-labels.ts.aucune.proposition.pour.le.moment.b71d86cc:Aucune proposition pour le moment`,
    emptyHint: $localize`:@@studio.studio-ai-labels.ts.decrivez.votre.besoin.ci.dessus.pour.voi.13cb0f56:Décrivez votre besoin ci-dessus pour voir la proposition ici. Rien n’est créé avant votre validation.`,
    generatedAt: $localize`:@@studio.studio-ai-labels.ts.proposition.generee.a.cb681269:Proposition générée à`,
    nothingCreated: $localize`:@@studio.studio-ai-labels.ts.rien.n.est.encore.cree.verifiez.puis.val.174cf341:Rien n’est encore créé — vérifiez puis validez.`,
    editingSubtitle: $localize`:@@studio.studio-ai-labels.ts.mode.personnalisation.vos.modifications.d48d4f9f:Mode personnalisation · vos modifications restent dans la proposition jusqu’à l’intégration.`,
    executingSubtitle: $localize`:@@studio.studio-ai-labels.ts.integration.en.cours.d13c3740:Intégration en cours`,
    completedSubtitle: $localize`:@@studio.studio-ai-labels.ts.creation.terminee.le.997b1216:Création terminée le`,
    completedHint: $localize`:@@studio.studio-ai-labels.ts.aucune.donnee.n.a.ete.supprimee.578b2f83:Aucune donnée n’a été supprimée.`,
    test: $localize`:@@studio.studio-ai-labels.ts.tester.9264a677:Tester`,
    customize: $localize`:@@studio.studio-ai-labels.ts.personnaliser.b9d70818:Personnaliser`,
    integrate: $localize`:@@studio.studio-ai-labels.ts.integrer.dans.l.erp.3b5a2d09:Intégrer dans l’ERP`,
    integrateDisabledDirty: $localize`:@@studio.studio-ai-labels.ts.enregistrez.ou.reinitialisez.vos.modific.f47c0b5d:Enregistrez ou réinitialisez vos modifications avant d’intégrer.`,
    integrateDisabledErrors: $localize`:@@studio.studio-ai-labels.ts.corrigez.les.erreurs.signalees.avant.d.i.1d7ef3c1:Corrigez les erreurs signalées avant d’intégrer.`,
    cancelPlan: $localize`:@@studio.studio-ai-labels.ts.refuser.la.proposition.2ceba25f:Refuser la proposition`,
    cancelled: $localize`:@@studio.studio-ai-labels.ts.plan.annule.rien.n.a.ete.cree.e1da9418:Plan annulé. Rien n’a été créé.`,
    summary: $localize`:@@studio-ai-labels.summary.Résumé:Résumé`,
    tables: $localize`:@@studio.studio-ai-labels.ts.tables.3915396b:tables`,
    fields: $localize`:@@studio.studio-ai-labels.ts.champs.faccdb9f:champs`,
    relations: $localize`:@@studio.studio-ai-labels.ts.relations.9649007e:relations`,
    forms: $localize`:@@studio.studio-ai-labels.ts.formulaires.fc551d57:formulaires`,
    seedRecords: $localize`:@@studio.studio-ai-labels.ts.donnees.de.reference.51624d37:données de référence`,
    reports: $localize`:@@studio.studio-ai-labels.ts.rapports.fbf667d8:rapports`,
    limitsHint: $localize`:@@studio.studio-ai-labels.ts.8.tables.max.40.champs.par.table.200.val.b34cb1e0:8 tables max · 40 champs par table · 200 valeurs de référence par table`,
    warningsTitle: $localize`:@@studio.studio-ai-labels.ts.points.a.verifier.d3ad96e4:points à vérifier`,
    noWarnings: $localize`:@@studio.studio-ai-labels.ts.aucun.point.a.verifier.81cc14b2:Aucun point à vérifier.`,
    structure: $localize`:@@studio.studio-ai-labels.ts.structure.du.systeme.69896cda:Structure du système`,
    diagram: $localize`:@@studio.studio-ai-labels.ts.diagramme.des.relations.f73580a1:Diagramme des relations`,
    diagramSoon: $localize`:@@studio.studio-ai-labels.ts.le.diagramme.interactif.arrive.dans.la.p.802225c8:Le diagramme interactif arrive dans la prochaine livraison ; les relations sont listées dans l’onglet Relations.`,
    diagramMore: '+{n}',
    diagramEdge: '{from} → {to} ({kind})',
    stepsTitle: $localize`:@@studio.studio-ai-labels.ts.etapes.prevues.0971ff7f:Étapes prévues`,
    unsaved: $localize`:@@studio.studio-ai-labels.ts.modifications.non.enregistrees.ca4fbcca:Modifications non enregistrées`,
    changes: $localize`:@@studio.studio-ai-labels.ts.changements.12890aa6:changements`,
    reset: $localize`:@@studio.studio-ai-labels.ts.reinitialiser.e0e2ad54:Réinitialiser`,
    regenerateWithChanges: $localize`:@@studio.studio-ai-labels.ts.regenerer.avec.ces.modifications.195136c6:Régénérer avec ces modifications`,
    save: $localize`:@@studio.studio-ai-labels.ts.enregistrer.les.modifications.2a945921:Enregistrer les modifications`,
    validating: $localize`:@@studio.studio-ai-labels.ts.verification.30a67937:Vérification…`,
    reloadPreview: $localize`:@@studio.studio-ai-labels.ts.recharger.l.apercu.2eb52c79:Recharger l’aperçu`,
    expiresIn: $localize`:@@studio.studio-ai-labels.ts.cette.proposition.expire.dans.f5df48f0:Cette proposition expire dans`,
    expired: $localize`:@@studio.studio-ai-labels.ts.ce.plan.a.expire.redemandez.la.generatio.00510df7:Ce plan a expiré. Redemandez la génération à l’assistant.`,
    readOnlyHint: $localize`:@@studio.studio-ai-labels.ts.l.edition.detaillee.personnaliser.arrive.c413fbb8:L’édition détaillée (Personnaliser) arrive dans la prochaine livraison.`,
    referenceDataOf: $localize`:@@studio.studio-ai-labels.ts.valeurs.initiales.de.de9aefa0:Valeurs initiales de`,
    noSeed: $localize`:@@studio.studio-ai-labels.ts.aucune.donnee.de.reference.proposee.f8a38e13:Aucune donnée de référence proposée.`,
    noForms: $localize`:@@studio.studio-ai-labels.ts.aucun.formulaire.specifique.chaque.table.18a306c5:Aucun formulaire spécifique : chaque table utilisera une mise en page par défaut.`,
    noReports: $localize`:@@studio.studio-ai-labels.ts.aucun.rapport.propose.ecba5c5c:Aucun rapport proposé.`,
    noRelations: $localize`:@@studio.studio-ai-labels.ts.aucune.relation.entre.les.tables.e3e78522:Aucune relation entre les tables.`,
    erpRelations: $localize`:@@studio.studio-ai-labels.ts.relations.vers.des.donnees.existantes.de.b163a0a4:Relations vers des données existantes de l’ERP`,
    existingData: $localize`:@@studio.studio-ai-labels.ts.donnee.existante.fcf941b2:Donnée existante`,
    cardinality: $localize`:@@studio.studio-ai-labels.ts.plusieurs.source.un.target.4fb85d70:Plusieurs {source} → un {target}`,
    menuHint: $localize`:@@studio.studio-ai-labels.ts.le.menu.lateral.studio.utilisera.ce.nom.74201f47:Le menu latéral Studio utilisera ce nom et cette icône.`,
    onboarding: $localize`:@@studio.studio-ai-labels.ts.pour.demarrer.fc8965d8:Pour démarrer`,

    // — Aperçu en lecture seule (P1a) : en-tête, colonnes de tableaux, mentions « bientôt ». —
    cancel: $localize`:@@studio.studio-ai-labels.ts.annuler.49ba3292:Annuler`,
    createNow: $localize`:@@studio.studio-ai-labels.ts.creer.maintenant.eb967c2a:Créer maintenant`,
    edit: $localize`:@@studio.studio-ai-labels.ts.modifier.f260e757:Modifier`,
    loadingSpec: $localize`:@@studio.studio-ai-labels.ts.chargement.de.la.proposition.cece2c24:Chargement de la proposition…`,
    noEntities: $localize`:@@studio.studio-ai-labels.ts.aucune.table.dans.cette.proposition.95fa8e5f:Aucune table dans cette proposition.`,
    limitsTemplate: '{maxEntities} tables max · {maxFields} champs par table · {maxSeedRecords} valeurs de référence par table',
    colLabel: $localize`:@@studio.studio-ai-labels.ts.libelle.f5485bba:Libellé`,
    colKey: $localize`:@@studio.studio-ai-labels.ts.cle.24a01bef:Clé`,
    colType: $localize`:@@studio.studio-ai-labels.ts.type.3deb7456:Type`,
    colRequired: $localize`:@@studio.studio-ai-labels.ts.requis.9a33b681:Requis`,
    colUnique: $localize`:@@studio.studio-ai-labels.ts.unique.87c6f410:Unique`,
    colDetails: $localize`:@@studio.studio-ai-labels.ts.details.aaa029e6:Détails`,
    colSource: $localize`:@@studio.studio-ai-labels.ts.table.source.e8534ba8:Table source`,
    colField: $localize`:@@studio.studio-ai-labels.ts.champ.e1472010:Champ`,
    colTarget: $localize`:@@studio.studio-ai-labels.ts.cible.bebdb9b8:Cible`,
    erpBadge: 'ERP',
    defaultForm: $localize`:@@studio.studio-ai-labels.ts.formulaire.par.defaut.tous.les.champs.4558c289:Formulaire par défaut : tous les champs`,
    seedValues: $localize`:@@studio.studio-ai-labels.ts.valeurs.e23d38b7:valeurs`,
    seedTruncated: $localize`:@@studio.studio-ai-labels.ts.10.premieres.valeurs.affichees.sur.count.861eeadf:10 premières valeurs affichées sur {count}.`,
    groupedBy: $localize`:@@studio.studio-ai-labels.ts.regroupe.par.39cc02de:Regroupé par`,
    measures: $localize`:@@studio.studio-ai-labels.ts.mesures.15eab5d2:Mesures`,
    columns: $localize`:@@studio.studio-ai-labels.ts.colonnes.53a2544c:Colonnes`,
    filters: $localize`:@@studio.studio-ai-labels.ts.filtres.2a8e76e0:Filtres`,
    sort: $localize`:@@studio.studio-ai-labels.ts.tri.c05261e0:Tri`,
    menuTitle: $localize`:@@studio.studio-ai-labels.ts.apercu.du.menu.lateral.bf6bdded:Aperçu du menu latéral`
  },

  confirm: {
    title: $localize`:@@studio.studio-ai-labels.ts.integrer.name.dans.l.erp.8a759fd6:Intégrer « {name} » dans l’ERP`,
    intro: $localize`:@@studio.studio-ai-labels.ts.les.elements.suivants.vont.etre.crees.da.25647067:Les éléments suivants vont être créés dans votre espace :`,
    irreversible: 'La création est définitive ; rien n’est supprimé ; les champs pourront être désactivés ensuite.',
    checkbox: $localize`:@@studio.studio-ai-labels.ts.j.ai.verifie.la.structure.proposee.eba6419e:J’ai vérifié la structure proposée`,
    pendingWarnings: $localize`:@@studio.studio-ai-labels.ts.points.a.verifier.en.attente.19e75b67:Points à vérifier en attente`,
    cancel: $localize`:@@studio.studio-ai-labels.ts.annuler.49ba3292:Annuler`,
    ok: $localize`:@@studio.studio-ai-labels.ts.integrer.a06a7612:Intégrer`
  },

  progress: {
    title: $localize`:@@studio.studio-ai-labels.ts.construction.en.cours.a38b45b6:Construction en cours`,
    step: $localize`:@@studio.studio-ai-labels.ts.etape.en.cours.b9f8958c:Étape en cours :`,
    dontClose: $localize`:@@studio.studio-ai-labels.ts.ne.fermez.pas.cette.page.190a93a6:Ne fermez pas cette page.`,
    of: $localize`:@@studio.studio-ai-labels.ts.sur.3d54fd66:sur`,
    stepCount: $localize`:@@studio.studio-ai-labels.ts.etape.current.sur.total.3086b56b:Étape {current} sur {total}`,
    stepsPending: $localize`:@@studio.studio-ai-labels.ts.en.attente.25c22964:En attente…`,
    stepRunning: $localize`:@@studio.studio-ai-labels.ts.en.cours.f8bf3646:En cours…`,
    stepSkipped: $localize`:@@studio.studio-ai-labels.ts.ignore.2af07447:Ignoré`,
    views: $localize`:@@studio.studio-ai-labels.ts.vues.ff576f2b:Vues`
  },

  result: {
    systemCreated: $localize`:@@studio.studio-ai-labels.ts.systeme.name.cree.e87b22ff:Système « {name} » créé`,
    tableCreated: $localize`:@@studio.studio-ai-labels.ts.table.name.creee.800146d9:Table « {name} » créée`,
    workflowCreated: $localize`:@@studio.studio-ai-labels.ts.workflow.name.cree.88daacc5:Workflow « {name} » créé`,
    workflowsCreated: '{count} workflows créés',
    stepsDone: $localize`:@@studio.studio-ai-labels.ts.etapes.terminees.bb0137f8:étapes terminées`,
    steps: $localize`:@@studio.studio-ai-labels.ts.etapes.6f85161a:étapes`,
    open: $localize`:@@studio.studio-ai-labels.ts.ouvrir.42c07747:Ouvrir`,
    newRequest: $localize`:@@studio.studio-ai-labels.ts.nouvelle.demande.0a6e5d2f:Nouvelle demande`,
    openSystem: $localize`:@@studio.studio-ai-labels.ts.ouvrir.le.systeme.ccfc3fc7:Ouvrir le système`,
    openTable: $localize`:@@studio.studio-ai-labels.ts.ouvrir.la.table.9db00a1c:Ouvrir la table`,
    openWorkflow: $localize`:@@studio.studio-ai-labels.ts.ouvrir.le.workflow.ee88aa14:Ouvrir le workflow`,
    workflowsInactiveHint: $localize`:@@studio.studio-ai-labels.ts.cree.inactif.relisez.le.puis.activez.le.f41e7ae0:Créé inactif : relisez-le puis activez-le depuis le hub Workflows.`,
    newRecord: $localize`:@@studio.studio-ai-labels.ts.saisir.une.fiche.50d9c181:Saisir une fiche`,
    viewReports: $localize`:@@studio.studio-ai-labels.ts.voir.les.rapports.b21bbce4:Voir les rapports`,
    vigilance: $localize`:@@studio.studio-ai-labels.ts.points.de.vigilance.8e99240c:Points de vigilance`,
    saveAsTemplate: $localize`:@@studio.studio-ai-labels.ts.enregistrer.comme.modele.26a6257b:Enregistrer comme modèle`,
    exportZip: $localize`:@@studio.studio-ai-labels.ts.exporter.zip.aeb9ffd2:Exporter (ZIP)`,
    duplicate: $localize`:@@studio.studio-ai-labels.ts.dupliquer.c5e1d3f1:Dupliquer`,
    share: $localize`:@@studio.studio-ai-labels.ts.partager.cbcb7f0c:Partager`,
    failedTitle: $localize`:@@studio.studio-ai-labels.ts.la.creation.a.echoue.256764b7:La création a échoué`,
    failedHint: $localize`:@@studio.studio-ai-labels.ts.rien.n.a.ete.conserve.reformulez.votre.d.fb1301a9:Rien n’a été conservé. Reformulez votre demande ou réessayez plus tard.`,
    exportJson: $localize`:@@studio.studio-ai-labels.ts.exporter.json.6dcef1ad:Exporter (JSON)`,
    replay: $localize`:@@studio.studio-ai-labels.ts.rejouer.e27384b5:Rejouer`,
    views: $localize`:@@studio.studio-ai-labels.ts.vues.eb606dec:vues`,
    workflows: $localize`:@@studio.studio-ai-labels.ts.workflows.a5a3470a:workflows`,
    counters: $localize`:@@studio.studio-ai-labels.ts.contenu.cree.9bef399f:Contenu créé`
  },

  conversation: {
    title: $localize`:@@studio.studio-ai-labels.ts.conversation.avec.l.assistant.4a1a23ea:Conversation avec l’assistant`,
    show: $localize`:@@studio.studio-ai-labels.ts.afficher.la.conversation.24fce08d:Afficher la conversation`,
    hide: $localize`:@@studio.studio-ai-labels.ts.masquer.la.conversation.00936567:Masquer la conversation`,
    preparing: $localize`:@@studio.studio-ai-labels.ts.preparation.en.cours.ccb86f49:Préparation en cours…`,
    retry: $localize`:@@studio.studio-ai-labels.ts.reessayer.895d416b:Réessayer`,
    saveReport: $localize`:@@studio.studio-ai-labels.ts.enregistrer.comme.etat.7fe75c33:Enregistrer comme état`,
    saveReportPrompt: 'Enregistre cet état : {title}',
    suggestions: $localize`:@@studio.studio-ai-labels.ts.suggestions.861edba0:Suggestions`,
    you: $localize`:@@studio.studio-ai-labels.ts.vous.ac3daf66:Vous`,
    assistant: $localize`:@@studio.studio-ai-labels.ts.assistant.8010d1f4:Assistant`
  },

  rail: {
    templates: $localize`:@@studio.studio-ai-labels.ts.modeles.de.systemes.1d350276:Modèles de systèmes`,
    seeAll: $localize`:@@studio.studio-ai-labels.ts.voir.tous.ed060c09:Voir tous`,
    use: $localize`:@@studio.studio-ai-labels.ts.utiliser.fb5e43ce:Utiliser`,
    replaceCurrent: $localize`:@@studio.studio-ai-labels.ts.remplacer.la.proposition.en.cours.cdb3853e:Remplacer la proposition en cours ?`,
    quickActions: $localize`:@@studio.studio-ai-labels.ts.actions.rapides.abe69a9c:Actions rapides`,
    importTemplate: $localize`:@@studio.studio-ai-labels.ts.importer.un.modele.existant.45c9ae1d:Importer un modèle existant`,
    duplicateSystem: $localize`:@@studio.studio-ai-labels.ts.dupliquer.un.systeme.d4b8c169:Dupliquer un système`,
    exportSystem: $localize`:@@studio.studio-ai-labels.ts.exporter.le.systeme.json.5c726edd:Exporter le système (JSON)`,
    importTemplateJson: $localize`:@@studio.studio-ai-labels.ts.importer.un.modele.json.0c9b0eef:Importer un modèle (JSON)`,
    shareTeam: $localize`:@@studio.studio-ai-labels.ts.partager.avec.l.equipe.6d0b7d14:Partager avec l’équipe`,
    resetConversation: $localize`:@@studio.studio-ai-labels.ts.reinitialiser.la.conversation.051a7732:Réinitialiser la conversation`,
    resetConfirm: $localize`:@@studio.studio-ai-labels.ts.les.propositions.en.attente.seront.annul.0693d36a:Les propositions en attente seront annulées (rien n’est supprimé). Continuer ?`,
    resetDone: '{count} plan(s) en attente annulé(s).',
    history: $localize`:@@studio.studio-ai-labels.ts.historique.des.generations.8ee3726c:Historique des générations`,
    historyEmpty: $localize`:@@studio.studio-ai-labels.ts.aucune.generation.pour.le.moment.57ea15aa:Aucune génération pour le moment.`,
    seeAllHistory: $localize`:@@studio.studio-ai-labels.ts.voir.tout.7b7d86e8:Voir tout`,
    promoTitle: $localize`:@@studio.studio-ai-labels.ts.une.idee.laissez.l.ia.la.realiser.a883f427:Une idée ? Laissez l’IA la réaliser !`,
    promoText: $localize`:@@studio.studio-ai-labels.ts.decrivez.un.besoin.metier.en.une.phrase.086c3fef:Décrivez un besoin métier en une phrase : l’assistant propose tables, formulaires et rapports.`,
    promoCta: $localize`:@@studio.studio-ai-labels.ts.decouvrir.les.possibilites.57142c6e:Découvrir les possibilités`,
    promoPrompt: 'Créer un système de gestion de … avec les tables, relations, formulaires, données de référence et rapports nécessaires.',
    resetTitle: $localize`:@@studio.studio-ai-labels.ts.reinitialiser.la.conversation.e427e648:Réinitialiser la conversation ?`,
    resetNoPlan: $localize`:@@studio.studio-ai-labels.ts.conversation.reinitialisee.a658d05b:Conversation réinitialisée.`,
    templatesEmpty: $localize`:@@studio.studio-ai-labels.ts.aucun.modele.disponible.0e51c045:Aucun modèle disponible.`,
    templatesLoadFailed: $localize`:@@studio.studio-ai-labels.ts.bibliotheque.de.modeles.indisponible.8d5bca8c:Bibliothèque de modèles indisponible.`,
    historyLoadFailed: $localize`:@@studio.studio-ai-labels.ts.historique.indisponible.96e679db:Historique indisponible.`,
    openPlan: $localize`:@@studio.studio-ai-labels.ts.reprendre.1c56710b:Reprendre`,
    justNow: $localize`:@@studio.studio-ai-labels.ts.a.l.instant.783eb5d9:à l’instant`,
    minutesAgo: $localize`:@@studio.studio-ai-labels.ts.il.y.a.count.min.f64cd57b:il y a {count} min`,
    hoursAgo: $localize`:@@studio.studio-ai-labels.ts.il.y.a.count.h.853c444a:il y a {count} h`,
    daysAgo: $localize`:@@studio.studio-ai-labels.ts.il.y.a.count.j.d096d269:il y a {count} j`,
    panelLabel: $localize`:@@studio.studio-ai-labels.ts.panneau.lateral.40352a8b:Panneau latéral`,
    comingSoon: $localize`:@@studio.studio-ai-labels.ts.cette.action.arrive.dans.une.prochaine.v.512a7141:Cette action arrive dans une prochaine version.`,
    replay: $localize`:@@studio.studio-ai-labels.ts.rejouer.e27384b5:Rejouer`,
    openSystem: $localize`:@@studio.studio-ai-labels.ts.ouvrir.le.systeme.ccfc3fc7:Ouvrir le système`,
    relationsShort: '{count} rel.',
    viewsShort: '{count} vues'
  },

  /** Page « Mes projets » (`/studio/ai/projects`). */
  history: {
    title: $localize`:@@studio.studio-ai-labels.ts.mes.projets.d3d45a70:Mes projets`,
    subtitle: $localize`:@@studio.studio-ai-labels.ts.toutes.les.generations.studio.ia.de.votr.5b7df51a:Toutes les générations Studio IA de votre espace : propositions à valider, systèmes créés, échecs.`,
    columns: {
      title: $localize`:@@studio.studio-ai-labels.ts.titre.eb97899a:Titre`,
      kind: 'Genre',
      status: 'Statut',
      createdAt: $localize`:@@studio.studio-ai-labels.ts.cree.89e65d88:Créé`,
      expiresAt: $localize`:@@studio.studio-ai-labels.ts.expire.3da5d6c1:Expire`,
      system: $localize`:@@studio.studio-ai-labels.ts.systeme.62d09520:Système`,
      relations: $localize`:@@studio.studio-ai-labels.ts.relations.6519fe11:Relations`,
      views: $localize`:@@studio.studio-ai-labels.ts.vues.ff576f2b:Vues`,
      actions: $localize`:@@studio.studio-ai-labels.ts.actions.c3cd636a:Actions`
    },
    filters: {
      status: 'Statut',
      kind: 'Genre',
      allStatuses: $localize`:@@studio.studio-ai-labels.ts.tous.les.statuts.2d5088af:Tous les statuts`,
      allKinds: $localize`:@@studio.studio-ai-labels.ts.tous.les.genres.978ed356:Tous les genres`
    },
    resume: $localize`:@@studio.studio-ai-labels.ts.reprendre.1c56710b:Reprendre`,
    openSystem: $localize`:@@studio.studio-ai-labels.ts.ouvrir.le.systeme.ccfc3fc7:Ouvrir le système`,
    empty: $localize`:@@studio.studio-ai-labels.ts.aucun.projet.pour.le.moment.decrivez.un.05c06662:Aucun projet pour le moment. Décrivez un besoin dans l’atelier pour démarrer.`,
    loadFailed: $localize`:@@studio.studio-ai-labels.ts.impossible.de.charger.vos.projets.56edd69e:Impossible de charger vos projets.`,
    backToStudio: $localize`:@@studio.studio-ai-labels.ts.retour.a.l.atelier.187fdc22:Retour à l’atelier`,
    count: '{count} projet(s)',
    replay: $localize`:@@studio.studio-ai-labels.ts.rejouer.e27384b5:Rejouer`,
    duplicate: $localize`:@@studio.studio-ai-labels.ts.dupliquer.c5e1d3f1:Dupliquer`
  },

  /** Page « Bibliothèque de modèles » (`/studio/ai/templates`). */
  templates: {
    title: $localize`:@@studio.studio-ai-labels.ts.bibliotheque.de.modeles.a3242a66:Bibliothèque de modèles`,
    subtitle: $localize`:@@studio.studio-ai-labels.ts.des.systemes.prets.a.l.emploi.a.adapter.b4d93a66:Des systèmes prêts à l’emploi à adapter à votre activité : l’atelier prépare une proposition que vous validez.`,
    use: $localize`:@@studio.studio-ai-labels.ts.utiliser.ce.modele.45a15fb8:Utiliser ce modèle`,
    empty: $localize`:@@studio.studio-ai-labels.ts.aucun.modele.disponible.pour.le.moment.8aaf2f23:Aucun modèle disponible pour le moment.`,
    loadFailed: $localize`:@@studio.studio-ai-labels.ts.impossible.de.charger.la.bibliotheque.de.9d0519d2:Impossible de charger la bibliothèque de modèles.`,
    disabled: $localize`:@@studio.studio-ai-labels.ts.la.bibliotheque.de.modeles.est.desactive.28c872b0:La bibliothèque de modèles est désactivée par l’administrateur.`,
    entities: '{count} table(s)',
    relations: '{count} relation(s)',
    uncategorized: $localize`:@@studio.studio-ai-labels.ts.autres.2f0dd042:Autres`,
    sourceBuiltin: $localize`:@@studio.studio-ai-labels.ts.integre.533c3ba2:Intégré`,
    sourceTenant: $localize`:@@studio.studio-ai-labels.ts.votre.espace.69d7e04b:Votre espace`,
    backToStudio: $localize`:@@studio.studio-ai-labels.ts.retour.a.l.atelier.187fdc22:Retour à l’atelier`,
    opened: $localize`:@@studio.studio-ai-labels.ts.proposition.preparee.depuis.un.modele.du.bac9d19f:Proposition préparée depuis un modèle du catalogue : vérifiez-la puis validez.`
  },

  planStatus: {
    Pending: $localize`:@@studio.studio-ai-labels.ts.a.valider.34a5fa4b:À valider`,
    Executing: $localize`:@@studio.studio-ai-labels.ts.en.cours.bc9b533a:En cours`,
    Completed: $localize`:@@studio.studio-ai-labels.ts.termine.3bc59720:Terminé`,
    Failed: $localize`:@@studio.studio-ai-labels.ts.echec.0ff45fa6:Échec`,
    Cancelled: $localize`:@@studio.studio-ai-labels.ts.annule.34cd87cc:Annulé`,
    Expired: $localize`:@@studio.studio-ai-labels.ts.expire.57dde607:Expiré`
  } satisfies Record<StudioAiPlanStatus, string>,

  planKind: {
    CreateApp: $localize`:@@studio.studio-ai-labels.ts.table.0424f6e7:Table`,
    CreateSystem: $localize`:@@studio.studio-ai-labels.ts.systeme.62d09520:Système`,
    Amendment: $localize`:@@studio.studio-ai-labels.ts.modification.e3ea079d:Modification`,
    View: $localize`:@@studio.studio-ai-labels.ts.fenetre.3d691665:Fenêtre`,
    Report: $localize`:@@studio.studio-ai-labels.ts.etat.d3b28a2a:État`,
    RecordView: $localize`:@@studio.studio-ai-labels.ts.vue.09237dba:Vue`,
    Workflow: $localize`:@@studio.studio-ai-labels.ts.workflow.d7a48414:Workflow`
  } as Record<string, string>,

  fieldTypes: {
    text: $localize`:@@studio.studio-ai-labels.ts.texte.ff9afef1:Texte`,
    multilinetext: $localize`:@@studio.studio-ai-labels.ts.texte.long.09157521:Texte long`,
    number: $localize`:@@studio.studio-ai-labels.ts.nombre.entier.0e5abd6c:Nombre entier`,
    decimal: $localize`:@@studio.studio-ai-labels.ts.nombre.decimal.42b22118:Nombre décimal`,
    boolean: $localize`:@@studio.studio-ai-labels.ts.oui.non.1a268ea5:Oui / Non`,
    date: $localize`:@@studio.studio-ai-labels.ts.date.eb9a4bc1:Date`,
    datetime: $localize`:@@studio.studio-ai-labels.ts.date.et.heure.d77bc41b:Date et heure`,
    select: $localize`:@@studio.studio-ai-labels.ts.liste.choix.unique.2ddb7b67:Liste (choix unique)`,
    multiselect: $localize`:@@studio.studio-ai-labels.ts.liste.choix.multiple.975ad859:Liste (choix multiple)`,
    money: $localize`:@@studio.studio-ai-labels.ts.monetaire.5b9130b4:Monétaire`,
    percentage: $localize`:@@studio.studio-ai-labels.ts.pourcentage.e34218e3:Pourcentage`,
    rating: $localize`:@@studio.studio-ai-labels.ts.note.etoiles.73f5e1da:Note (étoiles)`,
    qrcode: $localize`:@@studio.studio-ai-labels.ts.qr.code.abba02fc:QR code`,
    barcode: $localize`:@@studio.studio-ai-labels.ts.code.barres.a5ce859a:Code-barres`,
    autonumber: $localize`:@@studio.studio-ai-labels.ts.numero.automatique.021478b9:Numéro automatique`,
    attachment: $localize`:@@studio.studio-ai-labels.ts.piece.jointe.2ecefd2c:Pièce jointe`,
    signature: $localize`:@@studio.studio-ai-labels.ts.signature.2f32be1d:Signature`,
    relation: $localize`:@@studio.studio-ai-labels.ts.relation.33a5a757:Relation`
  } satisfies Record<StudioSpecFieldType, string>,

  errors: {
    invalid: $localize`:@@studio.studio-ai-labels.ts.demande.invalide.f5427fb6:Demande invalide.`,
    invalidSpec: $localize`:@@studio.studio-ai-labels.ts.la.structure.proposee.est.invalide.corri.dfa911f9:La structure proposée est invalide. Corrigez-la puis réessayez.`,
    generationFailed: $localize`:@@studio.studio-ai-labels.ts.echec.de.la.generation.94609f9d:Échec de la génération.`,
    executionFailed: $localize`:@@studio.studio-ai-labels.ts.echec.de.l.execution.du.plan.de6cd80c:Échec de l’exécution du plan.`,
    unauthorized: $localize`:@@studio.studio-ai-labels.ts.session.expiree.reconnectez.vous.1b855c64:Session expirée. Reconnectez-vous.`,
    forbidden: $localize`:@@studio.studio-ai-labels.ts.vous.n.avez.pas.la.permission.de.concevo.7c60f585:Vous n’avez pas la permission de concevoir des tables Studio.`,
    planNotFound: $localize`:@@studio.studio-ai-labels.ts.ce.plan.est.introuvable.ou.a.expire.2e8a0aa9:Ce plan est introuvable ou a expiré.`,
    planNotPending: $localize`:@@studio.studio-ai-labels.ts.ce.plan.n.est.plus.en.attente.il.a.deja.5364935a:Ce plan n’est plus en attente : il a déjà été exécuté, annulé ou a expiré.`,
    workbenchDisabled: $localize`:@@studio.studio-ai-labels.ts.le.workbench.studio.ia.n.est.pas.active.45e2c0c9:Le workbench Studio IA n’est pas activé.`,
    conflict: $localize`:@@studio.studio-ai-labels.ts.ce.plan.a.ete.modifie.entre.temps.rechar.3be058ab:Ce plan a été modifié entre-temps. Rechargez l’aperçu.`,
    tooLarge: $localize`:@@studio.studio-ai-labels.ts.fichier.trop.volumineux.078566a8:Fichier trop volumineux.`,
    rateLimited: $localize`:@@studio.studio-ai-labels.ts.trop.de.demandes.patientez.quelques.seco.53aea3bd:Trop de demandes. Patientez quelques secondes.`,
    network: $localize`:@@studio.studio-ai-labels.ts.connexion.impossible.verifiez.votre.rese.1fc9f80c:Connexion impossible. Vérifiez votre réseau puis réessayez.`,
    generic: $localize`:@@studio.studio-ai-labels.ts.une.erreur.est.survenue.9a133198:Une erreur est survenue.`
  },

  /** Messages d'état du flux (barre de statut / bulles système de la conversation). */
  status: {
    analyzing: $localize`:@@studio.studio-ai-labels.ts.analyse.de.votre.demande.b8c1072a:Analyse de votre demande…`,
    preparing: $localize`:@@studio.studio-ai-labels.ts.preparation.en.cours.ccb86f49:Préparation en cours…`,
    awaitingValidation: $localize`:@@studio.studio-ai-labels.ts.en.attente.de.votre.validation.53bc9a47:En attente de votre validation…`,
    creating: $localize`:@@studio.studio-ai-labels.ts.creation.en.cours.1488d01b:Création en cours…`,
    created: $localize`:@@studio.studio-ai-labels.ts.creation.terminee.e7697b24:Création terminée.`,
    planCancelled: $localize`:@@studio.studio-ai-labels.ts.plan.annule.rien.n.a.ete.cree.e1da9418:Plan annulé. Rien n’a été créé.`,
    draftSaved: $localize`:@@studio.studio-ai-labels.ts.modifications.enregistrees.dans.le.plan.42ebc17f:Modifications enregistrées dans le plan.`
  },

  capabilities: {
    previewDisabled: $localize`:@@studio.studio-ai-labels.ts.l.apercu.avant.creation.est.desactive.pa.79f2148b:L’aperçu avant création est désactivé par l’administrateur : les demandes sont exécutées directement.`,
    workbenchRequired: $localize`:@@studio.studio-ai-labels.ts.cette.fonction.necessite.le.workbench.st.5a1cc03c:Cette fonction nécessite le workbench Studio IA (désactivé sur cet environnement).`
  },

  // ---- Aperçu enrichi (PR 3.4) --------------------------------------------------------------------

  /** Barre de modes Aperçu / Tester / Personnaliser (3.4c). */
  modes: {
    toolbar: $localize`:@@studio.studio-ai-labels.ts.mode.de.l.apercu.f7b672fa:Mode de l’aperçu`,
    preview: $localize`:@@studio.studio-ai-labels.ts.apercu.f0f53004:Aperçu`,
    test: $localize`:@@studio.studio-ai-labels.ts.tester.9264a677:Tester`,
    customize: $localize`:@@studio.studio-ai-labels.ts.personnaliser.b9d70818:Personnaliser`,
    expiresIn: $localize`:@@studio.studio-ai-labels.ts.expire.dans.eb1cdf89:Expire dans`,
    expired: $localize`:@@studio.studio-ai-labels.ts.expire.57dde607:Expiré`,
    regenerate: $localize`:@@studio.studio-ai-labels.ts.regenerer.af5d1d73:Régénérer`,
    previewUnavailable: $localize`:@@studio.studio-ai-labels.ts.disponible.apres.mise.a.jour.du.serveur.3fbfbd7e:Disponible après mise à jour du serveur.`,
    changes: $localize`:@@studio.studio-ai-labels.ts.modifications.1f33ec5a:modifications`,
    saveDraft: $localize`:@@studio.studio-ai-labels.ts.enregistrer.le.brouillon.6a319595:Enregistrer le brouillon`
  },

  /** Onglet « Vues » (3.4d). */
  views: {
    title: $localize`:@@studio.studio-ai-labels.ts.vues.ff576f2b:Vues`,
    empty: $localize`:@@studio.studio-ai-labels.ts.aucune.vue.proposee.188210db:Aucune vue proposée.`,
    list: $localize`:@@studio.studio-ai-labels.ts.liste.4231be17:Liste`,
    kanban: $localize`:@@studio.studio-ai-labels.ts.kanban.38955467:Kanban`,
    calendar: $localize`:@@studio.studio-ai-labels.ts.calendrier.4c83736b:Calendrier`,
    groupBy: $localize`:@@studio.studio-ai-labels.ts.regroupement.c875cbed:Regroupement`,
    dateField: $localize`:@@studio.studio-ai-labels.ts.champ.date.387a1d23:Champ date`,
    endField: $localize`:@@studio.studio-ai-labels.ts.fin.4251065f:Fin`,
    titleField: $localize`:@@studio.studio-ai-labels.ts.titre.eb97899a:Titre`,
    columns: $localize`:@@studio.studio-ai-labels.ts.colonnes.53a2544c:Colonnes`,
    filters: $localize`:@@studio.studio-ai-labels.ts.filtres.2a8e76e0:Filtres`,
    sort: $localize`:@@studio.studio-ai-labels.ts.tri.c05261e0:Tri`,
    isDefault: $localize`:@@studio.studio-ai-labels.ts.par.defaut.4550c68e:Par défaut`,
    count: '{count} vues',
    addFilter: $localize`:@@studio.studio-ai-labels.ts.filtres.de.la.vue.828c8f0b:Filtres de la vue`
  },

  /** Onglet « Workflows » de l'aperçu (cartes depuis `summary.workflows[]`, 4.4k1 ; état vide sinon). */
  workflows: {
    title: $localize`:@@studio.studio-ai-labels.ts.workflows.825ce9e9:Workflows`,
    emptyTitle: $localize`:@@studio.studio-ai-labels.ts.aucun.workflow.dans.cette.proposition.6db3b1ed:Aucun workflow dans cette proposition`,
    emptyHint: $localize`:@@studio.studio-ai-labels.ts.decrivez.le.circuit.souhaite.declencheur.d81c465b:Décrivez le circuit souhaité (déclencheur, étapes, approbation) pour obtenir une proposition.`,
    steps: '{count} étapes',
    trigger: $localize`:@@studio.studio-ai-labels.ts.declencheur.70540908:Déclencheur`,
    /** Clés = `WorkflowTrigger` snake_case (Q-6) ; l'onglet lit `triggers[trigger] ?? trigger`. */
    triggers: {
      on_create: $localize`:@@studio.studio-ai-labels.ts.a.la.creation.368f826d:À la création`,
      on_update: $localize`:@@studio.studio-ai-labels.ts.a.la.modification.6c3aed88:À la modification`,
      field_changed: $localize`:@@studio.studio-ai-labels.ts.au.changement.d.un.champ.5997dd16:Au changement d’un champ`,
      manual: $localize`:@@studio.studio-ai-labels.ts.manuel.6c1cc012:Manuel`,
      /** 4.7★1 (D-47-76) : le déclencheur planifié est livré (4.7b1 → b5) — même libellé que le concepteur. */
      scheduled: $localize`:@@studio.studio-ai-labels.ts.planifie.172deb14:Planifié`
    },
    active: $localize`:@@studio.studio-ai-labels.ts.actif.2eb75f84:Actif`,
    inactive: $localize`:@@studio.studio-ai-labels.ts.inactif.d2e03387:Inactif`,
    inactiveNote: $localize`:@@studio.studio-ai-labels.ts.les.workflows.crees.par.l.assistant.sont.569acc69:Les workflows créés par l’assistant sont inactifs : activez-les depuis le hub Workflows après relecture.`,
    soonForWorkflows: $localize`:@@studio.studio-ai-labels.ts.indisponible.pour.une.proposition.de.wor.f591f611:Indisponible pour une proposition de workflow.`
  },

  /** Mode Tester : formulaire / rapport simulés, 0 écriture (3.4f). */
  simulation: {
    banner: $localize`:@@studio.studio-ai-labels.ts.simulation.rien.n.est.enregistre.ad07879e:Simulation — rien n’est enregistré.`,
    entity: $localize`:@@studio.studio-ai-labels.ts.table.a.tester.33c2dacb:Table à tester`,
    saveSimulated: $localize`:@@studio.studio-ai-labels.ts.enregistrer.simulation.c44d12ee:Enregistrer (simulation)`,
    saved: $localize`:@@studio.studio-ai-labels.ts.enregistrement.simule.aucune.donnee.ecri.2e174175:Enregistrement simulé : aucune donnée écrite.`,
    reportUnavailable: $localize`:@@studio.studio-ai-labels.ts.rapport.indisponible.aucune.donnee.d.exe.49f31515:Rapport indisponible : aucune donnée d’exemple.`,
    sampleFromSeed: $localize`:@@studio.studio-ai-labels.ts.calcule.sur.les.donnees.de.depart.38e097ca:Calculé sur les données de départ`,
    sampleFromServer: $localize`:@@studio.studio-ai-labels.ts.echantillon.fourni.par.le.serveur.373124b5:Échantillon fourni par le serveur`,
    exportUnavailable: $localize`:@@studio.studio-ai-labels.ts.export.indisponible.en.simulation.ac6809a4:Export indisponible en simulation.`
  },

  /** Mode Personnaliser : édition inline des champs (3.4g). */
  customize: {
    changes: '{count} modifications',
    noChanges: $localize`:@@studio.studio-ai-labels.ts.aucune.modification.1c1d4720:Aucune modification`,
    addField: $localize`:@@studio.studio-ai-labels.ts.ajouter.un.champ.b653a98c:Ajouter un champ`,
    removeField: $localize`:@@studio.studio-ai-labels.ts.retirer.54ec24a1:Retirer`,
    restoreField: $localize`:@@studio.studio-ai-labels.ts.retablir.91f08ee4:Rétablir`,
    addOption: $localize`:@@studio.studio-ai-labels.ts.ajouter.une.option.74ba77eb:Ajouter une option`,
    fieldLabel: $localize`:@@studio.studio-ai-labels.ts.libelle.f5485bba:Libellé`,
    fieldType: $localize`:@@studio.studio-ai-labels.ts.type.3deb7456:Type`,
    required: $localize`:@@studio.studio-ai-labels.ts.requis.9a33b681:Requis`,
    unique: $localize`:@@studio.studio-ai-labels.ts.unique.87c6f410:Unique`,
    options: $localize`:@@studio.studio-ai-labels.ts.options.6bf5da9c:Options`,
    moveUp: $localize`:@@studio.studio-ai-labels.ts.monter.dd1b79d9:Monter`,
    moveDown: $localize`:@@studio.studio-ai-labels.ts.descendre.383f2e3e:Descendre`,
    dragHandle: $localize`:@@studio.studio-ai-labels.ts.reordonner.b5ed0fe4:Réordonner`,
    locked: $localize`:@@studio.studio-ai-labels.ts.table.existante.non.modifiable.fbfe5987:Table existante : non modifiable`,
    keyTaken: $localize`:@@studio.studio-ai-labels.ts.cette.cle.existe.deja.67ba2b43:Cette clé existe déjà.`,
    maxFields: $localize`:@@studio.studio-ai-labels.ts.nombre.maximal.de.champs.atteint.4ef1617d:Nombre maximal de champs atteint.`,
    newField: $localize`:@@studio.studio-ai-labels.ts.nouveau.champ.e9de4d3e:Nouveau champ`,
    newOption: $localize`:@@studio.studio-ai-labels.ts.option.index.ba4f1f20:Option {index}`,
    optionsCount: '{count} options',
    removeOption: $localize`:@@studio.studio-ai-labels.ts.retirer.l.option.option.fafb1e06:Retirer l’option {option}`,
    actions: $localize`:@@studio.studio-ai-labels.ts.actions.c3cd636a:Actions`,
    addedTag: $localize`:@@studio.studio-ai-labels.ts.ajoute.41200139:Ajouté`,
    changedTag: $localize`:@@studio.studio-ai-labels.ts.modifie.6ea4efa0:Modifié`,
    removedTag: $localize`:@@studio.studio-ai-labels.ts.retire.37523b83:Retiré`
  },

  /** Import CSV des données de départ (panneau inline, D20 — 3.4h). */
  csv: {
    title: $localize`:@@studio.studio-ai-labels.ts.importer.un.csv.b3a257d6:Importer un CSV`,
    hint: $localize`:@@studio.studio-ai-labels.ts.fichier.512.ko.500.lignes.maximum.les.co.9d39c292:Fichier ≤ 512 Ko, 500 lignes maximum ; les colonnes sont rapprochées des champs.`,
    choose: $localize`:@@studio.studio-ai-labels.ts.choisir.un.fichier.75c27e25:Choisir un fichier`,
    drop: $localize`:@@studio.studio-ai-labels.ts.deposez.un.fichier.csv.ici.166b790d:Déposez un fichier CSV ici`,
    paste: $localize`:@@studio.studio-ai-labels.ts.ou.collez.le.texte.d3c1edd7:ou collez le texte`,
    tooLarge: $localize`:@@studio.studio-ai-labels.ts.fichier.trop.volumineux.512.ko.maximum.775f6bb7:Fichier trop volumineux (512 Ko maximum).`,
    notCsv: $localize`:@@studio.studio-ai-labels.ts.seuls.les.fichiers.csv.sont.acceptes.56b3c089:Seuls les fichiers .csv sont acceptés.`,
    mapping: $localize`:@@studio.studio-ai-labels.ts.correspondance.colonnes.champs.8b256e16:Correspondance colonnes → champs`,
    ignore: $localize`:@@studio.studio-ai-labels.ts.ignorer.f69a55dc:— ignorer —`,
    preview: $localize`:@@studio.studio-ai-labels.ts.apercu.count.lignes.bcfde700:Aperçu ({count} lignes)`,
    truncated: $localize`:@@studio.studio-ai-labels.ts.tronque.a.count.lignes.2cd57865:Tronqué à {count} lignes.`,
    apply: $localize`:@@studio.studio-ai-labels.ts.remplacer.les.donnees.de.depart.a32683e7:Remplacer les données de départ`,
    cancel: $localize`:@@studio.studio-ai-labels.ts.annuler.49ba3292:Annuler`,
    applied: '{count} lignes importées.'
  },

  /** Export / import / duplication de système (3.4i, 3.4j). */
  importExport: {
    exportTitle: $localize`:@@studio.studio-ai-labels.ts.exporter.le.systeme.d1e6d33e:Exporter le système`,
    includeSeed: $localize`:@@studio.studio-ai-labels.ts.inclure.les.donnees.de.depart.64082d9e:Inclure les données de départ`,
    copy: $localize`:@@studio.studio-ai-labels.ts.copier.cdd28e1a:Copier`,
    copied: $localize`:@@studio.studio-ai-labels.ts.copie.08838153:Copié.`,
    download: $localize`:@@studio.studio-ai-labels.ts.telecharger.b332d06d:Télécharger`,
    importTitle: $localize`:@@studio.studio-ai-labels.ts.importer.un.systeme.json.250014ac:Importer un système (JSON)`,
    dropJson: $localize`:@@studio.studio-ai-labels.ts.deposez.un.fichier.json.ou.collez.son.co.9b083de5:Déposez un fichier .json ou collez son contenu`,
    tooLarge: $localize`:@@studio.studio-ai-labels.ts.fichier.trop.volumineux.256.ko.maximum.d098240d:Fichier trop volumineux (256 Ko maximum).`,
    invalidJson: $localize`:@@studio.studio-ai-labels.ts.json.invalide.1c1b7a79:JSON invalide.`,
    badVersion: $localize`:@@studio.studio-ai-labels.ts.specversion.non.pris.en.charge.1.attendu.987230bb:specVersion non pris en charge (1 attendu).`,
    counters: '{entities} tables · {relations} relations · {views} vues',
    displayName: $localize`:@@studio.studio-ai-labels.ts.nom.du.systeme.optionnel.0d002dad:Nom du système (optionnel)`,
    import: $localize`:@@studio.studio-ai-labels.ts.importer.f54cfe90:Importer`,
    duplicateTitle: $localize`:@@studio.studio-ai-labels.ts.dupliquer.un.systeme.d4b8c169:Dupliquer un système`,
    duplicate: $localize`:@@studio.studio-ai-labels.ts.dupliquer.c5e1d3f1:Dupliquer`,
    chooseSystem: $localize`:@@studio.studio-ai-labels.ts.systeme.a.dupliquer.e5eb8c76:Système à dupliquer`,
    copySuffix: '{name} (copie)',
    opened: $localize`:@@studio.studio-ai-labels.ts.plan.ouvert.verifiez.la.proposition.puis.ad3acf9e:Plan ouvert : vérifiez la proposition puis validez.`,
    exportLoading: $localize`:@@studio.studio-ai-labels.ts.preparation.de.l.export.171fb76e:Préparation de l’export…`,
    exportWarnings: $localize`:@@studio.studio-ai-labels.ts.points.a.verifier.bf981096:Points à vérifier`,
    exportFile: $localize`:@@studio.studio-ai-labels.ts.fichier.name.37d6b0c5:Fichier : {name}`,
    exportFailed: $localize`:@@studio.studio-ai-labels.ts.export.impossible.a061adcb:Export impossible.`,
    noSystem: $localize`:@@studio.studio-ai-labels.ts.aucun.systeme.a.exporter.7bae57c5:Aucun système à exporter.`,
    close: $localize`:@@studio.studio-ai-labels.ts.fermer.5ab4ec64:Fermer`,
    pasteJson: $localize`:@@studio.studio-ai-labels.ts.ou.collez.le.json.ici.9dad2ac6:Ou collez le JSON ici`,
    remove: $localize`:@@studio.studio-ai-labels.ts.retirer.54ec24a1:Retirer`,
    recognized: $localize`:@@studio.studio-ai-labels.ts.specification.reconnue.0093c1bd:Spécification reconnue`,
    notObject: $localize`:@@studio.studio-ai-labels.ts.la.specification.doit.etre.un.objet.json.8f44f0cc:La spécification doit être un objet JSON.`,
    invalidShape: $localize`:@@studio.studio-ai-labels.ts.le.fichier.ne.ressemble.pas.a.une.specif.4027e1b2:Le fichier ne ressemble pas à une spécification de système (tables et champs attendus).`,
    seedRecords: '{count} lignes de départ',
    duplicateSource: $localize`:@@studio.studio-ai-labels.ts.systeme.source.55f0ba08:Système source`,
    copyName: $localize`:@@studio.studio-ai-labels.ts.nom.de.la.copie.e49f19d1:Nom de la copie`,
    createCopy: $localize`:@@studio.studio-ai-labels.ts.creer.la.copie.80f5aaac:Créer la copie`,
    duplicateNote: $localize`:@@studio.studio-ai-labels.ts.la.copie.est.proposee.dans.l.apercu.ia.l.49091814:La copie est proposée dans l’aperçu IA ; les données de départ sont reprises.`,
    nameCounter: '{count}/{max}',
    entitiesCount: '{count} tables'
  },

  /** Rejeu d'un plan terminé / échoué / annulé / expiré (3.4k). */
  replay: {
    action: 'Rejouer',
    conflict: $localize`:@@studio.studio-ai-labels.ts.ce.plan.ne.peut.pas.etre.rejoue.maintena.424d95a4:Ce plan ne peut pas être rejoué maintenant.`,
    done: $localize`:@@studio.studio-ai-labels.ts.plan.rejoue.une.nouvelle.proposition.est.dbf5ec8e:Plan rejoué : une nouvelle proposition est ouverte.`
  },

  /** Changement de type d'un champ (3.4l). */
  typeChange: {
    checking: $localize`:@@studio.studio-ai-labels.ts.verification.30a67937:Vérification…`,
    lossless: $localize`:@@studio.studio-ai-labels.ts.conversion.sans.perte.c45afe70:Conversion sans perte.`,
    requiresEmpty: $localize`:@@studio.studio-ai-labels.ts.videz.la.table.avant.de.changer.le.type.0acc5235:Videz la table avant de changer le type.`,
    forbidden: $localize`:@@studio.studio-ai-labels.ts.changement.de.type.impossible.444a8891:Changement de type impossible.`,
    changed: $localize`:@@studio.studio-ai-labels.ts.type.modifie.417c3edb:Type modifié.`
  }
} as const;

export type StudioAiLabels = typeof STUDIO_AI_LABELS;

/** Remplace les `{jetons}` d'un libellé — ré-export de `formatLabel` (shared/studio-text.util.ts, 4.5h). */
export { formatLabel } from '../shared/studio-text.util';
