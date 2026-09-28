/// <reference types="@angular/localize" />
import type { WorkflowStepType } from './studio-workflows.models';

/**
 * Libellés FR centralisés de la fonctionnalité « Workflows » du Studio (4.4a1). Groupes figés
 * (contrat exposé à la partie B) : `nav`, `hub`, `triggers`, `triggerHints`, `designer`, `steps`,
 * `stepTypes`, `enumValues`, `assignee`, `roles`, `instanceStatus`, `stepRunStatus`, `outcomes`,
 * `approvalStatus`, `instances`, `approvals`, `recordTab`, `soon`.
 */
export const STUDIO_WORKFLOW_LABELS = {
  nav: {
    workflows: $localize`:@@studio.studio-workflow-labels.ts.workflows.825ce9e9:Workflows`,
    approvals: $localize`:@@studio.studio-workflow-labels.ts.mes.approbations.8f2a2f56:Mes approbations`
  },

  hub: {
    title: $localize`:@@studio.studio-workflow-labels.ts.workflows.825ce9e9:Workflows`,
    subtitle: $localize`:@@studio.studio-workflow-labels.ts.automatisez.les.traitements.de.vos.table.53a6b52e:Automatisez les traitements de vos tables.`,
    newWorkflow: $localize`:@@studio.studio-workflow-labels.ts.nouveau.workflow.c2f24e7e:Nouveau workflow`,
    allTables: $localize`:@@studio.studio-workflow-labels.ts.toutes.les.tables.c65303d2:Toutes les tables`,
    search: $localize`:@@studio.studio-workflow-labels.ts.rechercher.un.workflow.19e1441f:Rechercher un workflow…`,
    columns: {
      name: 'Nom',
      table: $localize`:@@studio.studio-workflow-labels.ts.table.0424f6e7:Table`,
      trigger: $localize`:@@studio.studio-workflow-labels.ts.declencheur.70540908:Déclencheur`,
      steps: $localize`:@@studio.studio-workflow-labels.ts.etapes.adabc0e0:Étapes`,
      active: $localize`:@@studio.studio-workflow-labels.ts.actif.2eb75f84:Actif`,
      openInstances: $localize`:@@studio.studio-workflow-labels.ts.instances.ouvertes.5172701d:Instances ouvertes`,
      lastRun: $localize`:@@studio.studio-workflow-labels.ts.derniere.execution.43de21a3:Dernière exécution`,
      actions: $localize`:@@studio.studio-workflow-labels.ts.actions.c3cd636a:Actions`
    },
    neverRun: $localize`:@@studio.studio-workflow-labels.ts.jamais.execute.a6d4a6c2:Jamais exécuté`,
    emptyTitle: $localize`:@@studio.studio-workflow-labels.ts.aucun.workflow.pour.cette.table.9509fd20:Aucun workflow pour cette table`,
    emptyHint: $localize`:@@studio.studio-workflow-labels.ts.creez.votre.premier.workflow.pour.automa.d90b8e9b:Créez votre premier workflow pour automatiser les traitements de cette table.`,
    deleteConfirm: $localize`:@@studio.studio-workflow-labels.ts.supprimer.name.count.instance.s.ouverte.5941d5a2:Supprimer « {name} » ? {count} instance(s) ouverte(s) seront annulées.`,
    deleted: '{count} instance(s) annulée(s).',
    duplicateKey: $localize`:@@studio.studio-workflow-labels.ts.un.workflow.porte.deja.cette.cle.pour.ce.657c62d3:Un workflow porte déjà cette clé pour cette table.`,
    duplicated: $localize`:@@studio.studio-workflow-labels.ts.copie.creee.inactive.47f13711:Copie créée (inactive).`,
    toggled: $localize`:@@studio.studio-workflow-labels.ts.workflow.state.75b4a3a7:Workflow {state}.`,
    loadError: $localize`:@@studio.studio-workflow-labels.ts.chargement.des.workflows.impossible.0762aa0b:Chargement des workflows impossible.`,
    /** 4.4d — compléments du hub (libellés manquants ajoutés selon l'annexe, cités en PR). */
    edit: $localize`:@@studio.studio-workflow-labels.ts.modifier.f260e757:Modifier`,
    duplicate: $localize`:@@studio.studio-workflow-labels.ts.dupliquer.c5e1d3f1:Dupliquer`,
    delete: $localize`:@@studio.studio-workflow-labels.ts.supprimer.1acfc1c7:Supprimer`,
    deleteTitle: $localize`:@@studio.studio-workflow-labels.ts.supprimer.le.workflow.b524cdf7:Supprimer le workflow`,
    deleteMessage: $localize`:@@studio.studio-workflow-labels.ts.supprimer.name.cette.action.est.irrevers.6e402fb0:Supprimer « {name} » ? Cette action est irréversible.`,
    deleteWithInstances: $localize`:@@studio.studio-workflow-labels.ts.supprimer.name.count.instance.s.ouverte.5941d5a2:Supprimer « {name} » ? {count} instance(s) ouverte(s) seront annulées.`,
    stateActive: $localize`:@@studio.studio-workflow-labels.ts.active.c138e044:activé`,
    stateInactive: $localize`:@@studio.studio-workflow-labels.ts.desactive.1313ee6a:désactivé`
  },

  triggers: {
    on_create: $localize`:@@studio.studio-workflow-labels.ts.a.la.creation.368f826d:À la création`,
    on_update: $localize`:@@studio.studio-workflow-labels.ts.a.la.modification.6c3aed88:À la modification`,
    field_changed: $localize`:@@studio.studio-workflow-labels.ts.quand.un.champ.change.15c64d22:Quand un champ change`,
    manual: $localize`:@@studio.studio-workflow-labels.ts.manuel.6c1cc012:Manuel`,
    scheduled: $localize`:@@studio.studio-workflow-labels.ts.planifie.172deb14:Planifié`
  },

  triggerHints: {
    on_create: $localize`:@@studio.studio-workflow-labels.ts.se.declenche.a.chaque.nouvel.enregistrem.e8384512:Se déclenche à chaque nouvel enregistrement.`,
    on_update: $localize`:@@studio.studio-workflow-labels.ts.se.declenche.a.chaque.modification.b04e69fd:Se déclenche à chaque modification.`,
    field_changed: $localize`:@@studio.studio-workflow-labels.ts.se.declenche.quand.le.champ.surveille.ch.26f9688d:Se déclenche quand le champ surveillé change (valeurs optionnelles).`,
    manual: $localize`:@@studio.studio-workflow-labels.ts.lance.depuis.la.fiche.par.un.utilisateur.ae2094e6:Lancé depuis la fiche par un utilisateur autorisé.`,
    scheduled: $localize`:@@studio.studio-workflow-labels.ts.selon.un.horaire.utc.sur.les.enregistrem.bea2419b:Selon un horaire (UTC), sur les enregistrements filtrés.`
  },

  designer: {
    title: $localize`:@@studio.studio-workflow-labels.ts.workflow.d7a48414:Workflow`,
    newTitle: $localize`:@@studio.studio-workflow-labels.ts.nouveau.workflow.c2f24e7e:Nouveau workflow`,
    name: 'Nom',
    key: 'Clé',
    table: $localize`:@@studio.studio-workflow-labels.ts.table.0424f6e7:Table`,
    trigger: $localize`:@@studio.studio-workflow-labels.ts.declencheur.70540908:Déclencheur`,
    watchedField: $localize`:@@studio.studio-workflow-labels.ts.champ.surveille.efc6c262:Champ surveillé`,
    from: $localize`:@@studio.studio-workflow-labels.ts.ancienne.valeur.35fdf3f5:Ancienne valeur`,
    to: $localize`:@@studio.studio-workflow-labels.ts.nouvelle.valeur.a56dea7b:Nouvelle valeur`,
    cronPreset: $localize`:@@studio.studio-workflow-labels.ts.frequence.bafbfba7:Fréquence`,
    cronPresets: { hourly: $localize`:@@studio.studio-workflow-labels.ts.toutes.les.heures.04af5315:Toutes les heures`, daily: $localize`:@@studio.studio-workflow-labels.ts.chaque.jour.a.06.00.utc.b03e5c4a:Chaque jour à 06:00 UTC`, weekly: $localize`:@@studio.studio-workflow-labels.ts.chaque.lundi.a.06.00.utc.79619fed:Chaque lundi à 06:00 UTC`, custom: $localize`:@@studio.studio-workflow-labels.ts.personnalise.8504dffc:Personnalisé` },
    cron: $localize`:@@studio.studio-workflow-labels.ts.expression.cron.5.champs.dd5daefc:Expression cron (5 champs)`,
    cronHint: $localize`:@@studio.studio-workflow-labels.ts.format.minute.heure.jour.mois.jour.de.se.4d680b6e:Format « minute heure jour mois jour-de-semaine » — fuseau UTC.`,
    scheduledFilters: $localize`:@@studio.studio-workflow-labels.ts.enregistrements.concernes.filtres.option.6bd7766d:Enregistrements concernés (filtres optionnels)`,
    active: $localize`:@@studio.studio-workflow-labels.ts.actif.2eb75f84:Actif`,
    inactive: $localize`:@@studio.studio-workflow-labels.ts.inactif.d2e03387:Inactif`,
    validate: $localize`:@@studio.studio-workflow-labels.ts.valider.be4220f7:Valider`,
    save: $localize`:@@studio.studio-workflow-labels.ts.enregistrer.f7c8bcd8:Enregistrer`,
    duplicate: $localize`:@@studio.studio-workflow-labels.ts.dupliquer.c5e1d3f1:Dupliquer`,
    saved: $localize`:@@studio.studio-workflow-labels.ts.workflow.enregistre.3675fd32:Workflow enregistré.`,
    validOk: $localize`:@@studio.studio-workflow-labels.ts.aucune.erreur.bfc34d49:Aucune erreur.`,
    validErrors: '{count} erreur(s) à corriger.',
    conflict: $localize`:@@studio.studio-workflow-labels.ts.ce.workflow.a.ete.modifie.par.ailleurs.r.bcdfed27:Ce workflow a été modifié par ailleurs. Rechargez la page.`,
    quota: $localize`:@@studio.studio-workflow-labels.ts.limite.de.max.workflows.par.table.attein.fd06565b:Limite de {max} workflows par table atteinte.`,
    stepsCount: '{count} / {max}',
    addStep: $localize`:@@studio.studio-workflow-labels.ts.ajouter.une.etape.9a611f09:Ajouter une étape`,
    properties: $localize`:@@studio.studio-workflow-labels.ts.proprietes.de.l.etape.9b335350:Propriétés de l'étape`,
    noStep: $localize`:@@studio.studio-workflow-labels.ts.selectionnez.une.etape.a4cb94ba:Sélectionnez une étape.`,
    unknownKind: $localize`:@@studio.studio-workflow-labels.ts.propriete.non.prise.en.charge.par.le.con.ad2df815:Propriété non prise en charge par le concepteur, JSON brut.`,
    keyHint: $localize`:@@studio.studio-workflow-labels.ts.minuscule.initiale.lettres.chiffres.ou.2.57cd0d43:Minuscule initiale, lettres, chiffres ou « _ » (2 à 64 caractères).`,
    keyImmutable: $localize`:@@studio.studio-workflow-labels.ts.la.cle.est.immuable.apres.creation.5792ee91:La clé est immuable après création.`,
    dirty: $localize`:@@studio.studio-workflow-labels.ts.modifications.non.enregistrees.d3afef8e:Modifications non enregistrées.`,
    reload: $localize`:@@studio.studio-workflow-labels.ts.recharger.b10ee511:Recharger`,
    tooLarge: $localize`:@@studio.studio-workflow-labels.ts.le.workflow.depasse.64.ko.reduisez.le.no.e6228ca3:Le workflow dépasse 64 Ko : réduisez le nombre d'étapes ou la taille des gabarits.`,
    noSteps: $localize`:@@studio.studio-workflow-labels.ts.ajoutez.au.moins.une.etape.0d9bdf5c:Ajoutez au moins une étape.`,
    unsavedInstances: $localize`:@@studio.studio-workflow-labels.ts.enregistrez.le.workflow.pour.voir.ses.in.e956256b:Enregistrez le workflow pour voir ses instances.`,
    warnings: '{count} avertissement(s).'
  },

  steps: {
    moveUp: $localize`:@@studio.studio-workflow-labels.ts.monter.dd1b79d9:Monter`,
    moveDown: $localize`:@@studio.studio-workflow-labels.ts.descendre.383f2e3e:Descendre`,
    remove: $localize`:@@studio.studio-workflow-labels.ts.supprimer.1acfc1c7:Supprimer`,
    key: 'Clé',
    label: $localize`:@@studio.studio-workflow-labels.ts.libelle.f5485bba:Libellé`,
    keyInvalid: $localize`:@@studio.studio-workflow-labels.ts.cle.invalide.minuscule.initiale.puis.let.3f635c5d:Clé invalide : minuscule initiale, puis lettres, chiffres ou « _ » (2 à 64 caractères).`,
    keyDuplicate: $localize`:@@studio.studio-workflow-labels.ts.cette.cle.est.deja.utilisee.par.une.autr.01e706f9:Cette clé est déjà utilisée par une autre étape.`,
    conditionPreview: $localize`:@@studio.studio-workflow-labels.ts.apercu.de.la.condition.06046ec6:Aperçu de la condition`,
    gotoTarget: $localize`:@@studio.studio-workflow-labels.ts.aller.a.l.etape.6ca9a005:Aller à l'étape`,
    addPair: $localize`:@@studio.studio-workflow-labels.ts.ajouter.une.affectation.1468272e:Ajouter une affectation`
  },

  /** Repli FR si le catalogue serveur ne fournit pas de `label`. */
  stepTypes: {
    condition: $localize`:@@studio.studio-workflow-labels.ts.condition.2f497932:Condition`,
    update_field: $localize`:@@studio.studio-workflow-labels.ts.mettre.a.jour.un.champ.b822f4bc:Mettre à jour un champ`,
    erp_action: $localize`:@@studio.studio-workflow-labels.ts.action.erp.pont.958c8e68:Action ERP (pont)`,
    notify: $localize`:@@studio.studio-workflow-labels.ts.notifier.b2e17488:Notifier`,
    approval: $localize`:@@studio.studio-workflow-labels.ts.approbation.c740fa16:Approbation`,
    wait: $localize`:@@studio.studio-workflow-labels.ts.attendre.6b084958:Attendre`,
    create_record: $localize`:@@studio.studio-workflow-labels.ts.creer.un.enregistrement.df329859:Créer un enregistrement`
  },

  /** Libellés des valeurs `enum` du catalogue d'étapes (clés = nom de propriété puis valeur). */
  enumValues: {
    match: { all: $localize`:@@studio.studio-workflow-labels.ts.toutes.les.conditions.eee4f84a:Toutes les conditions`, any: $localize`:@@studio.studio-workflow-labels.ts.au.moins.une.7ae96347:Au moins une` },
    onFalse: { stop: $localize`:@@studio.studio-workflow-labels.ts.arreter.le.workflow.2f3b6e81:Arrêter le workflow`, skip: $localize`:@@studio.studio-workflow-labels.ts.passer.l.etape.03664934:Passer l'étape`, goto: $localize`:@@studio.studio-workflow-labels.ts.aller.a.une.etape.f9bcf322:Aller à une étape` },
    onFailure: { fail: $localize`:@@studio.studio-workflow-labels.ts.echouer.63d193b0:Échouer`, continue: $localize`:@@studio.studio-workflow-labels.ts.continuer.129ffff9:Continuer` },
    onTimeout: { reject: $localize`:@@studio.studio-workflow-labels.ts.refuser.62897154:Refuser`, approve: $localize`:@@studio.studio-workflow-labels.ts.approuver.3033e7d6:Approuver`, fail: $localize`:@@studio.studio-workflow-labels.ts.echouer.63d193b0:Échouer` },
    onReject: { stop: $localize`:@@studio.studio-workflow-labels.ts.arreter.1b1cd217:Arrêter`, goto: $localize`:@@studio.studio-workflow-labels.ts.aller.a.une.etape.f9bcf322:Aller à une étape`, continue: $localize`:@@studio.studio-workflow-labels.ts.continuer.129ffff9:Continuer` }
  },

  assignee: {
    role: 'Un rôle',
    user: $localize`:@@studio.studio-workflow-labels.ts.un.utilisateur.67fcdeb4:Un utilisateur`,
    startedBy: $localize`:@@studio.studio-workflow-labels.ts.la.personne.qui.a.lance.caf7dbb6:La personne qui a lancé`,
    pickRole: $localize`:@@studio.studio-workflow-labels.ts.choisir.un.role.e3b5aaaa:Choisir un rôle`,
    pickUser: $localize`:@@studio.studio-workflow-labels.ts.choisir.un.utilisateur.a1f9a65b:Choisir un utilisateur`,
    usersUnavailable: $localize`:@@studio.studio-workflow-labels.ts.liste.des.utilisateurs.reservee.aux.admi.a1c43e96:Liste des utilisateurs réservée aux administrateurs.`,
    userIdHint: $localize`:@@studio.studio-workflow-labels.ts.identifiant.guid.de.l.utilisateur.la.lis.7cfb723a:Identifiant (GUID) de l'utilisateur — la liste est réservée aux administrateurs.`
  },

  /** 11 rôles tenant (D15) — `FirmManager`/`FirmAccountant` exclus (D-44-13) ; clés = noms exacts de l'enum `UserRole`. */
  roles: {
    Administrator: $localize`:@@studio.studio-workflow-labels.ts.administrateur.1d8141b2:Administrateur`,
    Accountant: $localize`:@@studio.studio-workflow-labels.ts.comptable.36cf0a9e:Comptable`,
    Client: $localize`:@@studio.studio-workflow-labels.ts.client.1bdd79b1:Client`,
    SalesRep: $localize`:@@studio.studio-workflow-labels.ts.commercial.b48513e4:Commercial`,
    SalesManager: $localize`:@@studio.studio-workflow-labels.ts.responsable.commercial.0fde72d7:Responsable commercial`,
    Warehouse: $localize`:@@studio.studio-workflow-labels.ts.magasinier.c61a86f7:Magasinier`,
    Purchaser: $localize`:@@studio.studio-workflow-labels.ts.acheteur.0afc4f6e:Acheteur`,
    Cashier: $localize`:@@studio.studio-workflow-labels.ts.caissier.8d597a37:Caissier`,
    Auditor: $localize`:@@studio.studio-workflow-labels.ts.auditeur.eac73f9c:Auditeur`,
    Supervisor: $localize`:@@studio.studio-workflow-labels.ts.superviseur.27e5f8da:Superviseur`,
    Developer: $localize`:@@studio.studio-workflow-labels.ts.developpeur.4819232b:Développeur`
  },

  /** Réutilise les mots de `planStatus` (studio-ai-labels.ts). */
  instanceStatus: {
    running: $localize`:@@studio.studio-workflow-labels.ts.en.cours.bc9b533a:En cours`,
    waiting: $localize`:@@studio.studio-workflow-labels.ts.en.attente.5231158f:En attente`,
    waiting_approval: $localize`:@@studio.studio-workflow-labels.ts.a.valider.34a5fa4b:À valider`,
    completed: $localize`:@@studio.studio-workflow-labels.ts.termine.3bc59720:Terminé`,
    failed: $localize`:@@studio.studio-workflow-labels.ts.echec.0ff45fa6:Échec`,
    cancelled: $localize`:@@studio.studio-workflow-labels.ts.annule.34cd87cc:Annulé`
  },

  stepRunStatus: {
    succeeded: $localize`:@@studio.studio-workflow-labels.ts.terminee.45936892:Terminée`,
    skipped: $localize`:@@studio.studio-workflow-labels.ts.ignoree.2b9acddb:Ignorée`,
    failed: $localize`:@@studio.studio-workflow-labels.ts.echec.0ff45fa6:Échec`,
    suspended: $localize`:@@studio.studio-workflow-labels.ts.en.attente.5231158f:En attente`
  },

  outcomes: {
    continue: $localize`:@@studio.studio-workflow-labels.ts.continuer.129ffff9:Continuer`,
    skip: $localize`:@@studio.studio-workflow-labels.ts.ignorer.b0d64e49:Ignorer`,
    goto: $localize`:@@studio.studio-workflow-labels.ts.aller.a.90e83761:Aller à`,
    stop: $localize`:@@studio.studio-workflow-labels.ts.arreter.1b1cd217:Arrêter`,
    suspend: $localize`:@@studio.studio-workflow-labels.ts.suspendre.1e34ab4e:Suspendre`,
    fail: $localize`:@@studio.studio-workflow-labels.ts.echec.0ff45fa6:Échec`
  },

  approvalStatus: {
    pending: $localize`:@@studio.studio-workflow-labels.ts.en.attente.5231158f:En attente`,
    approved: $localize`:@@studio.studio-workflow-labels.ts.approuvee.7d606a51:Approuvée`,
    rejected: $localize`:@@studio.studio-workflow-labels.ts.refusee.ce45da5d:Refusée`,
    cancelled: $localize`:@@studio.studio-workflow-labels.ts.annulee.2776573b:Annulée`,
    expired: $localize`:@@studio.studio-workflow-labels.ts.expiree.1f0808dc:Expirée`
  },

  instances: {
    /** 4.7a2 / D-47-F01 — le panneau devient l'historique paginé (était « Instances récentes »). */
    history: $localize`:@@studio.studio-workflow-labels.ts.historique.34f3a06a:Historique`,
    empty: $localize`:@@studio.studio-workflow-labels.ts.aucune.instance.68fa5f85:Aucune instance.`,
    detail: $localize`:@@studio-workflow-labels.detail.Détail:Détail`,
    close: $localize`:@@studio.studio-workflow-labels.ts.fermer.5ab4ec64:Fermer`,
    cancel: $localize`:@@studio.studio-workflow-labels.ts.annuler.l.instance.42430e60:Annuler l'instance`,
    cancelReason: $localize`:@@studio.studio-workflow-labels.ts.motif.optionnel.500.caracteres.max.d0287186:Motif (optionnel, 500 caractères max.)`,
    cancelTitle: $localize`:@@studio.studio-workflow-labels.ts.annuler.cette.instance.261907a0:Annuler cette instance ?`,
    cancelled: $localize`:@@studio.studio-workflow-labels.ts.instance.annulee.4795ebd9:Instance annulée.`,
    cancelConflict: $localize`:@@studio.studio-workflow-labels.ts.cette.instance.est.deja.terminee.f1577771:Cette instance est déjà terminée.`,
    remind: $localize`:@@studio.studio-workflow-labels.ts.relancer.les.approbateurs.12e80688:Relancer les approbateurs`,
    reminded: $localize`:@@studio.studio-workflow-labels.ts.rappel.envoye.50ada7ce:Rappel envoyé.`,
    remindConflict: $localize`:@@studio.studio-workflow-labels.ts.rappel.deja.envoye.depuis.moins.de.24.h.584d0403:Rappel déjà envoyé depuis moins de 24 h`,
    startedBy: $localize`:@@studio.studio-workflow-labels.ts.demarre.par.11b80ada:Démarré par`,
    startedAt: $localize`:@@studio.studio-workflow-labels.ts.demarre.le.cec2e3b8:Démarré le`,
    dueAt: $localize`:@@studio.studio-workflow-labels.ts.echeance.f9a77ff6:Échéance`,
    currentStep: $localize`:@@studio.studio-workflow-labels.ts.etape.courante.8f6130c8:Étape courante`,
    error: $localize`:@@studio.studio-workflow-labels.ts.erreur.ab546c23:Erreur`,
    timeline: $localize`:@@studio.studio-workflow-labels.ts.deroule.bed9bab8:Déroulé`,
    duration: '{value}',
    approvals: $localize`:@@studio.studio-workflow-labels.ts.approbations.77db6494:Approbations`,
    noApprovals: $localize`:@@studio.studio-workflow-labels.ts.aucune.approbation.3082d32a:Aucune approbation.`,
    context: $localize`:@@studio.studio-workflow-labels.ts.contexte.masque.7f3f8a49:Contexte masqué.`,
    summary: $localize`:@@studio-workflow-labels.summary._done_tape_s_:{done} étape(s) terminée(s) · {waiting} en attente · {todo} à venir`
  },

  approvals: {
    title: $localize`:@@studio.studio-workflow-labels.ts.mes.approbations.8f2a2f56:Mes approbations`,
    subtitle: $localize`:@@studio.studio-workflow-labels.ts.approbations.qui.vous.sont.assignees.ou.a86f2602:Approbations qui vous sont assignées ou assignées à votre rôle.`,
    kpiPending: $localize`:@@studio.studio-workflow-labels.ts.a.traiter.db4de492:À traiter`,
    kpiLate: $localize`:@@studio.studio-workflow-labels.ts.en.retard.40c1dde3:En retard`,
    kpiSoon: $localize`:@@studio.studio-workflow-labels.ts.sous.24.h.519f8430:Sous 24 h`,
    tabPending: $localize`:@@studio.studio-workflow-labels.ts.a.traiter.db4de492:À traiter`,
    // 4.7 « v1.1 » (D-47-60/61) — onglets de la page ; « Déléguées » désactivé (pas de concept de
    // délégation dans le domaine — convention « Bientôt », aucune donnée inventée).
    tabDelegated: $localize`:@@studio.studio-workflow-labels.ts.deleguees.a444bf2f:Déléguées`,
    tabHistory: $localize`:@@studio.studio-workflow-labels.ts.historique.34f3a06a:Historique`,
    delegatedSoon: $localize`:@@studio.studio-workflow-labels.ts.bientot.a60303f4:Bientôt`,
    colDecidedAt: $localize`:@@studio.studio-workflow-labels.ts.decidee.le.08fb0e00:Décidée le`,
    colDecision: $localize`:@@studio.studio-workflow-labels.ts.decision.2887915b:Décision`,
    colComment: $localize`:@@studio.studio-workflow-labels.ts.commentaire.bcb916ab:Commentaire`,
    decisionApproved: $localize`:@@studio.studio-workflow-labels.ts.approuvee.7d606a51:Approuvée`,
    decisionRejected: $localize`:@@studio.studio-workflow-labels.ts.refusee.ce45da5d:Refusée`,
    historyEmpty: $localize`:@@studio.studio-workflow-labels.ts.aucune.decision.passee.a2a405b4:Aucune décision passée`,
    historyEmptyHint: $localize`:@@studio.studio-workflow-labels.ts.vos.decisions.d.approbation.apparaitront.658ddbf4:Vos décisions d'approbation apparaîtront ici (conservées 180 jours).`,
    historyLoadError: $localize`:@@studio.studio-workflow-labels.ts.impossible.de.charger.l.historique.2e5c79df:Impossible de charger l'historique.`,
    columns: {
      workflow: $localize`:@@studio.studio-workflow-labels.ts.workflow.d7a48414:Workflow`,
      record: $localize`:@@studio.studio-workflow-labels.ts.enregistrement.932edd5e:Enregistrement`,
      requestedBy: $localize`:@@studio.studio-workflow-labels.ts.demande.par.eee441e6:Demandé par`,
      requestedAt: $localize`:@@studio.studio-workflow-labels.ts.demande.le.cc6bd02e:Demandé le`,
      dueAt: $localize`:@@studio.studio-workflow-labels.ts.echeance.f9a77ff6:Échéance`,
      actions: $localize`:@@studio.studio-workflow-labels.ts.actions.c3cd636a:Actions`
    },
    approve: $localize`:@@studio.studio-workflow-labels.ts.approuver.3033e7d6:Approuver`,
    reject: $localize`:@@studio.studio-workflow-labels.ts.refuser.62897154:Refuser`,
    detail: $localize`:@@studio-workflow-labels.detail.Détail:Détail`,
    comment: $localize`:@@studio.studio-workflow-labels.ts.commentaire.bcb916ab:Commentaire`,
    commentRequired: $localize`:@@studio.studio-workflow-labels.ts.le.commentaire.est.obligatoire.pour.refu.e092f03b:Le commentaire est obligatoire pour refuser.`,
    approved: $localize`:@@studio.studio-workflow-labels.ts.approbation.enregistree.f2688f62:Approbation enregistrée.`,
    rejected: $localize`:@@studio.studio-workflow-labels.ts.refus.enregistre.cdf53abe:Refus enregistré.`,
    alreadyDecided: $localize`:@@studio.studio-workflow-labels.ts.cette.approbation.a.deja.ete.traitee.604633d9:Cette approbation a déjà été traitée.`,
    notAssigned: $localize`:@@studio.studio-workflow-labels.ts.cette.approbation.ne.vous.est.plus.assig.0074ac42:Cette approbation ne vous est plus assignée.`,
    empty: $localize`:@@studio.studio-workflow-labels.ts.aucune.approbation.en.attente.a79bc432:Aucune approbation en attente`,
    emptyHint: $localize`:@@studio.studio-workflow-labels.ts.vous.etes.a.jour.fe4629c6:Vous êtes à jour.`,
    noDue: $localize`:@@studio.studio-workflow-labels.ts.aucune.echeance.edaacd03:Aucune échéance`,
    late: $localize`:@@studio.studio-workflow-labels.ts.en.retard.de.value.3be22c52:En retard de {value}`,
    due: $localize`:@@studio.studio-workflow-labels.ts.dans.value.6b7a78b6:Dans {value}`,
    openRecord: $localize`:@@studio.studio-workflow-labels.ts.ouvrir.la.fiche.f7086ea9:Ouvrir la fiche`,
    readOnly: $localize`:@@studio.studio-workflow-labels.ts.lecture.seule.votre.role.ne.permet.pas.d.a10dad33:Lecture seule : votre rôle ne permet pas de décider.`,
    // 4.4g2 (H-3, ajout additif) — les clés déjà définies en 4.4a1 (`subtitle`, `commentRequired`,
    // `approved`, `rejected`, `alreadyDecided`, `notAssigned`, `emptyHint`, `readOnly`…) gardent
    // leur libellé d'origine ; la page n'utilise que les clés plates ci-dessous pour les colonnes.
    refresh: $localize`:@@studio.studio-workflow-labels.ts.actualiser.9d3b2a7d:Actualiser`,
    colWorkflow: $localize`:@@studio.studio-workflow-labels.ts.workflow.etape.0068f9c3:Workflow / étape`,
    colRecord: $localize`:@@studio.studio-workflow-labels.ts.enregistrement.932edd5e:Enregistrement`,
    colStartedAt: $localize`:@@studio.studio-workflow-labels.ts.lance.le.f2d6df37:Lancé le`,
    colRequestedBy: $localize`:@@studio.studio-workflow-labels.ts.demande.par.eee441e6:Demandé par`,
    colRequestedAt: $localize`:@@studio.studio-workflow-labels.ts.demande.le.cc6bd02e:Demandé le`,
    colDue: $localize`:@@studio.studio-workflow-labels.ts.echeance.f9a77ff6:Échéance`,
    colActions: $localize`:@@studio.studio-workflow-labels.ts.actions.c3cd636a:Actions`,
    approveTitle: $localize`:@@studio.studio-workflow-labels.ts.approuver.la.demande.e9b2c738:Approuver la demande`,
    rejectTitle: $localize`:@@studio.studio-workflow-labels.ts.refuser.la.demande.45e4dcf4:Refuser la demande`,
    commentOptional: $localize`:@@studio.studio-workflow-labels.ts.commentaire.facultatif.902c305c:Commentaire (facultatif)`,
    commentMissing: $localize`:@@studio.studio-workflow-labels.ts.indiquez.le.motif.du.refus.53ff51be:Indiquez le motif du refus.`,
    cancel: $localize`:@@studio.studio-workflow-labels.ts.annuler.49ba3292:Annuler`,
    decisionError: $localize`:@@studio.studio-workflow-labels.ts.la.decision.n.a.pas.pu.etre.enregistree.94b4e259:La décision n'a pas pu être enregistrée.`,
    loadError: $localize`:@@studio.studio-workflow-labels.ts.impossible.de.charger.vos.approbations.4e0f3e57:Impossible de charger vos approbations.`,
    retry: $localize`:@@studio.studio-workflow-labels.ts.reessayer.895d416b:Réessayer`,
    // 4.4h1 (ajout additif, panneau de détail) — `detail` existait déjà (4.4a1) ; `due` N'EST
    // PAS repris : il vaut déjà 'Dans {value}' (gabarit d'échéance) et le panneau utilise
    // `colDue` (« Échéance ») pour l'étiquette du dt.
    close: $localize`:@@studio.studio-workflow-labels.ts.fermer.5ab4ec64:Fermer`,
    record: $localize`:@@studio.studio-workflow-labels.ts.enregistrement.932edd5e:Enregistrement`,
    startedAt: $localize`:@@studio.studio-workflow-labels.ts.lance.le.f2d6df37:Lancé le`,
    requestedBy: $localize`:@@studio.studio-workflow-labels.ts.demande.par.eee441e6:Demandé par`,
    requestedAt: $localize`:@@studio.studio-workflow-labels.ts.demande.le.cc6bd02e:Demandé le`,
    requestComment: $localize`:@@studio.studio-workflow-labels.ts.message.du.demandeur.d0d42a73:Message du demandeur`,
    openInstance: $localize`:@@studio.studio-workflow-labels.ts.voir.l.instance.cda715c3:Voir l'instance`
  },

  /** 4.7c2 — dialogue « Tester sur un enregistrement » (simulation pure, 4.7c1). */
  test: {
    button: $localize`:@@studio.studio-workflow-labels.ts.tester.sur.un.enregistrement.bd64d624:Tester sur un enregistrement`,
    saveFirst: $localize`:@@studio.studio-workflow-labels.ts.enregistrez.d.abord.pour.tester.ac060b2b:Enregistrez d’abord pour tester.`,
    dialogTitle: $localize`:@@studio.studio-workflow-labels.ts.tester.le.workflow.c3f45984:Tester le workflow`,
    banner: $localize`:@@studio.studio-workflow-labels.ts.simulation.aucune.donnee.n.a.ete.ecrite.7e79983c:Simulation — aucune donnée n’a été écrite.`,
    searchPlaceholder: $localize`:@@studio.studio-workflow-labels.ts.rechercher.un.enregistrement.ca4738bc:Rechercher un enregistrement…`,
    searching: $localize`:@@studio.studio-workflow-labels.ts.recherche.af776274:Recherche…`,
    noRecords: $localize`:@@studio.studio-workflow-labels.ts.aucun.enregistrement.3acbe7b2:Aucun enregistrement.`,
    run: $localize`:@@studio.studio-workflow-labels.ts.lancer.le.test.97a5952a:Lancer le test`,
    error: $localize`:@@studio.studio-workflow-labels.ts.la.simulation.a.echoue.e7e3b599:La simulation a échoué.`,
    rendered: $localize`:@@studio.studio-workflow-labels.ts.valeurs.rendues.ddfebb09:Valeurs rendues`,
    evaluatedSuffix: $localize`:@@studio.studio-workflow-labels.ts.etape.s.reellement.evaluee.s.8e0ffea3:étape(s) réellement évaluée(s)`,
    suspendedSuffix: $localize`:@@studio.studio-workflow-labels.ts.le.workflow.s.arreterait.en.attente.36ff8c9e:le workflow s’arrêterait en attente`,
    verdicts: {
      wouldRun: $localize`:@@studio.studio-workflow-labels.ts.executee.e6f2dc15:Exécutée`,
      skipped: $localize`:@@studio.studio-workflow-labels.ts.sautee.f49c05ec:Sautée`,
      wouldSuspend: $localize`:@@studio.studio-workflow-labels.ts.en.attente.5231158f:En attente`,
      wouldFail: $localize`:@@studio.studio-workflow-labels.ts.en.echec.363c6c87:En échec`
    }
  },

  recordTab: {
    label: $localize`:@@studio.studio-workflow-labels.ts.workflows.825ce9e9:Workflows`,
    launch: $localize`:@@studio.studio-workflow-labels.ts.lancer.un.workflow.203c7e31:Lancer un workflow`,
    launchPick: $localize`:@@studio.studio-workflow-labels.ts.choisir.un.workflow.372bac07:Choisir un workflow`,
    run: $localize`:@@studio.studio-workflow-labels.ts.lancer.6a009498:Lancer`,
    started: $localize`:@@studio.studio-workflow-labels.ts.workflow.lance.b3da5e5e:Workflow lancé.`,
    quota: $localize`:@@studio.studio-workflow-labels.ts.limite.de.200.instances.atteinte.pour.ce.03b57ebb:Limite de 200 instances atteinte pour cet enregistrement.`,
    empty: $localize`:@@studio.studio-workflow-labels.ts.aucun.workflow.execute.sur.cet.enregistr.ff35b7c7:Aucun workflow exécuté sur cet enregistrement.`,
    // 4.4h2 (H-3, ajout additif) — les clés déjà définies en 4.4a1 (`label`, `launch`, `run`
    // = « Lancer », `started`, `empty` = « Aucun workflow exécuté sur cet enregistrement. »…)
    // gardent leur libellé d'origine ; l'onglet n'utilise que les clés plates ci-dessous
    // (même motif que les `colXxx` de `approvals` en 4.4g2).
    tabLabel: $localize`:@@studio.studio-workflow-labels.ts.workflows.825ce9e9:Workflows`,
    title: $localize`:@@studio.studio-workflow-labels.ts.workflows.825ce9e9:Workflows`,
    hint: $localize`:@@studio.studio-workflow-labels.ts.instances.de.workflow.liees.a.cet.enregi.fa40a0f8:Instances de workflow liées à cet enregistrement.`,
    runTitle: $localize`:@@studio.studio-workflow-labels.ts.lancer.un.workflow.203c7e31:Lancer un workflow`,
    runPlaceholder: $localize`:@@studio.studio-workflow-labels.ts.choisir.un.workflow.372bac07:Choisir un workflow`,
    runEmpty: $localize`:@@studio.studio-workflow-labels.ts.aucun.workflow.actif.a.lancement.manuel.667d1908:Aucun workflow actif à lancement manuel pour cette table.`,
    alreadyRunning: $localize`:@@studio.studio-workflow-labels.ts.une.instance.de.ce.workflow.est.deja.en.4149cefa:Une instance de ce workflow est déjà en cours pour cet enregistrement.`,
    runError: $localize`:@@studio.studio-workflow-labels.ts.le.workflow.n.a.pas.pu.etre.lance.7286770b:Le workflow n'a pas pu être lancé.`,
    cancel: $localize`:@@studio.studio-workflow-labels.ts.annuler.49ba3292:Annuler`,
    cancelled: $localize`:@@studio.studio-workflow-labels.ts.instance.annulee.4795ebd9:Instance annulée.`,
    remind: $localize`:@@studio.studio-workflow-labels.ts.relancer.les.approbateurs.12e80688:Relancer les approbateurs`,
    reminded: $localize`:@@studio.studio-workflow-labels.ts.rappel.envoye.50ada7ce:Rappel envoyé.`,
    actionError: $localize`:@@studio.studio-workflow-labels.ts.l.action.n.a.pas.pu.etre.effectuee.482aa73a:L'action n'a pas pu être effectuée.`,
    /** 4.6d2 (D-44-96) — confirmation d'annulation inline, même motif et libellés que le tiroir (D-44-26). */
    cancelConfirmTitle: $localize`:@@studio.studio-workflow-labels.ts.annuler.cette.instance.261907a0:Annuler cette instance ?`,
    cancelReason: $localize`:@@studio.studio-workflow-labels.ts.motif.optionnel.500.caracteres.max.d0287186:Motif (optionnel, 500 caractères max.)`,
    cancelConfirm: $localize`:@@studio.studio-workflow-labels.ts.confirmer.l.annulation.92040a54:Confirmer l'annulation`,
    cancelBack: $localize`:@@studio.studio-workflow-labels.ts.retour.e5befb1f:Retour`,
    colActions: $localize`:@@studio.studio-workflow-labels.ts.actions.c3cd636a:Actions`,
    detail: $localize`:@@studio-workflow-labels.detail.Détail:Détail`,
    close: $localize`:@@studio.studio-workflow-labels.ts.fermer.5ab4ec64:Fermer`,
    colWorkflow: $localize`:@@studio.studio-workflow-labels.ts.workflow.d7a48414:Workflow`,
    colStatus: $localize`:@@studio.studio-workflow-labels.ts.statut.659499f3:Statut`,
    colStep: $localize`:@@studio.studio-workflow-labels.ts.etape.13146b48:Étape`,
    colStarted: $localize`:@@studio.studio-workflow-labels.ts.demarre.le.cec2e3b8:Démarré le`,
    /** 4.6c1 (D-46-F03) — nom du lanceur servi par `WorkflowInstanceDto.startedByName` (4.6b1) ; « — » si inconnu. */
    colRequestedBy: $localize`:@@studio.studio-workflow-labels.ts.demande.par.eee441e6:Demandé par`,
    colDue: $localize`:@@studio.studio-workflow-labels.ts.echeance.f9a77ff6:Échéance`
  },

  soon: $localize`:@@studio.studio-workflow-labels.ts.bientot.a60303f4:Bientôt`
} as const;

export type StudioWorkflowLabels = typeof STUDIO_WORKFLOW_LABELS;

/** Remplace les `{jetons}` d'un libellé — alias ré-exporté de `formatLabel` (shared/studio-text.util.ts, 4.5h — D-44-08 clos). */
export { formatLabel as formatWorkflowLabel } from '../shared/studio-text.util';

/** Libellé d'un type d'étape : `label` du catalogue s'il est fourni, sinon repli FR local, sinon la clé brute. */
export function stepTypeLabel(type: WorkflowStepType, catalogLabel?: string | null): string {
  return catalogLabel?.trim() || STUDIO_WORKFLOW_LABELS.stepTypes[type] || type;
}

/** Icônes Font Awesome par type d'étape (vocabulaire partagé avec les maquettes — D-44-09). */
export const STEP_TYPE_ICONS: Readonly<Record<WorkflowStepType, string>> = { condition: 'fa-solid fa-code-branch', update_field: 'fa-solid fa-pen-to-square', erp_action: 'fa-solid fa-bolt', notify: 'fa-solid fa-bell', approval: 'fa-solid fa-user-check', wait: 'fa-solid fa-hourglass-half', create_record: 'fa-solid fa-file-circle-plus' };
