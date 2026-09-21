/**
 * Libellés FR centralisés spécifiques à la page Entreprises.
 *
 * Ces clés sont importées depuis le composant via :
 *  ```ts
 *  import { TENANTS_FR } from './tenants.i18n.fr';
 *  ```
 * et accessibles via `TENANTS_FR['list.kpi.total']`. Voir aussi `core/i18n/fr.ts`
 * pour les libellés transverses.
 */

export const TENANTS_FR = {
  // ----- Page header -------------------------------------------------------
  'list.title': 'Entreprises',
  'list.subtitle':
    'Annuaire des entreprises onboardées. Filtrez par abonnement, régime fiscal et statut.',
  'list.actions.export': 'Exporter',
  'list.actions.create': 'Nouvelle entreprise',
  'list.actions.createFirm': 'Nouveau cabinet comptable',
  'kind.accountingFirm': 'Cabinet',
  'kind.company': 'Entreprise',
  'filters.kind': 'Type de dossier',

  // ----- KPIs --------------------------------------------------------------
  'kpi.total': 'Entreprises',
  'kpi.total.hint': '{count} sur 30j',
  'kpi.paying': 'Abonnés payants',
  'kpi.paying.hint': '≈ {mrr} TND/mois',
  'kpi.conversion': 'Conv. essai → payant',
  'kpi.conversion.hint': '30 derniers jours',
  'kpi.risk': 'Tenants en risque',
  'kpi.risk.hint': 'Impayé + suspendu',

  // ----- Toolbar / filtres --------------------------------------------------
  'filters.search.placeholder': 'Rechercher (raison sociale, email, NIF)…',
  'filters.segment': 'Segment',
  'filters.plan': 'Plan',
  'filters.status': 'Statut abonnement',
  'filters.tenantState': 'Entreprise',
  'filters.taxRegime': 'Régime fiscal',
  'filters.reset': 'Réinitialiser',
  'filters.savedViews': 'Vues',
  'filters.savedViews.save': 'Sauvegarder ce filtre',
  'filters.savedViews.delete': 'Supprimer cette vue',
  'filters.savedViews.namePrompt': 'Nom de la vue',
  'filters.activeChips.clearAll': 'Effacer tout',

  // ----- Segment options ---------------------------------------------------
  'segment.paying': 'Abonnés payants',
  'segment.nonPaying': 'Non abonnés',

  // ----- Plan options ------------------------------------------------------
  'plan.free': 'Gratuit',
  'plan.monthly': 'Mensuel',
  'plan.annual': 'Annuel',

  // ----- Status options ----------------------------------------------------
  'status.active': 'Actif',
  'status.trial': 'Essai',
  'status.expired': 'Expiré',
  'status.cancelled': 'Annulé',
  'status.pastDue': 'Impayé',
  'status.suspended': 'Suspendu',

  // ----- Tenant state options ----------------------------------------------
  'tenantState.active': 'Active',
  'tenantState.inactive': 'Inactive',

  // ----- Tax regime options ------------------------------------------------
  'taxRegime.real': 'Régime réel',
  'taxRegime.flatRate': 'Régime forfaitaire',
  'taxRegime.exempt': 'Exonéré',

  // ----- Table columns -----------------------------------------------------
  'col.companyName': 'Entreprise',
  'col.nif': 'NIF',
  'col.taxRegime': 'Régime',
  'col.plan': 'Plan',
  'col.status': 'Statut',
  'col.mrr': 'MRR',
  'col.lastActivity': 'Dernière activité',
  'col.actions': 'Actions',

  // ----- Row actions -------------------------------------------------------
  'rowAction.viewDetails': 'Voir les détails',
  'rowAction.quickView': 'Aperçu rapide',
  'rowAction.editSubscription': 'Modifier l’abonnement',
  'rowAction.aiConfig': 'Configuration IA',
  'rowAction.suspend': 'Suspendre',
  'rowAction.reactivate': 'Réactiver',
  'rowAction.sendEmail': 'Envoyer un email',
  'rowAction.viewAudit': 'Voir l’audit',
  'rowAction.copyId': 'Copier l’identifiant',

  // ----- Bulk actions ------------------------------------------------------
  'bulk.selected': '{count} entreprise(s) sélectionnée(s)',
  'bulk.suspend': 'Suspendre',
  'bulk.export': 'Exporter sélection',
  'bulk.email': 'Envoyer email',
  'bulk.clear': 'Désélectionner',

  // ----- Empty / error states ----------------------------------------------
  'empty.noResult.title': 'Aucune entreprise ne correspond',
  'empty.noResult.desc': 'Essayez de retirer un filtre ou modifier votre recherche.',
  'empty.noTenant.title': 'Aucune entreprise enregistrée',
  'empty.noTenant.desc': 'Les entreprises apparaîtront ici dès leur premier onboarding.',
  'error.title': 'Une erreur est survenue',
  'error.desc': 'Impossible de récupérer la liste. Réessayez dans un instant.',

  // ----- Drawer (quick view) -----------------------------------------------
  'drawer.title': 'Aperçu',
  'drawer.tab.overview': 'Aperçu',
  'drawer.tab.subscription': 'Abonnement',
  'drawer.tab.modules': 'Modules',
  'drawer.tab.activity': 'Activité',
  'drawer.tab.migrations': 'Migrations',
  'drawer.tab.storefront': 'Vitrine',
  'drawer.field.email': 'Email',
  'drawer.field.phone': 'Téléphone',
  'drawer.field.nif': 'NIF',
  'drawer.field.taxRegime': 'Régime fiscal',
  'drawer.field.address': 'Adresse',
  'drawer.field.website': 'Site web',
  'drawer.field.createdAt': 'Inscrite le',
  'drawer.field.deactivatedAt': 'Désactivée le',
  'drawer.field.databaseName': 'Base de données',
  'drawer.field.plan': 'Plan',
  'drawer.field.status': 'Statut',
  'drawer.field.startDate': 'Début',
  'drawer.field.endDate': 'Prochaine facture',
  'drawer.field.migrationStatus': 'Migrations EF',
  'drawer.migrations.applied': 'Appliquées',
  'drawer.migrations.missing': 'Manquantes',
  'drawer.action.openFullPage': 'Voir page complète',
  'drawer.action.openAiConfig': 'Configuration IA',
  'drawer.placeholder.modules':
    'La gestion des modules par tenant arrive avec le Lot C1 (Plans configurables).',
  'drawer.placeholder.activity':
    'Le journal d’activité par tenant arrive avec le Lot D3 (impersonation + audit dédié).',
  'drawer.placeholder.storefront':
    'Le détail vitrine arrive avec le Lot D5 (signalements + historique).',

  // ----- Pagination --------------------------------------------------------
  'pagination.template': '{first}–{last} sur {totalRecords}',

  // ----- Phase 2 (WP-F8) — Configuration sectorielle -------------------------
  // ATTENTION : « Secteur » désigne ici le secteur d'activité (commerce, BTP…), à ne jamais
  // confondre avec le filtre « Segment » de facturation (payant/non payant) déjà existant.
  'sector.tab.label': 'Configuration sectorielle',
  'sector.card.title': 'Configuration sectorielle actuelle',
  'sector.card.subtitle': 'Secteur d’activité et domaine utilisés pour déterminer les modules recommandés et les modèles de données.',
  'sector.segment': 'Secteur',
  'sector.domain': 'Domaine',
  'sector.lastChange': 'Dernière reconfiguration',
  'sector.lastChange.unknown': 'Inconnue',
  'sector.action.modify': 'Modifier',
  'sector.empty.title': 'Aucun profil sectoriel',
  'sector.empty.desc': 'Cette entreprise n’a pas encore été classifiée (créée avant Phase 2, ou onboarding non finalisé).',
  'sector.picker.newSegment': 'Nouveau secteur',
  'sector.picker.newDomain': 'Nouveau domaine',
  'sector.action.preview': 'Prévisualiser la reconfiguration',
  'sector.action.apply': 'Appliquer la reconfiguration',
  'sector.action.cancel': 'Annuler',
  'sector.preview.title': 'Prévisualisation — {from} → {to}',
  'sector.preview.computedAt': 'Calculée le {date} · règles version {version}',
  'sector.diff.modulesEnabled': 'Modules à activer',
  'sector.diff.modulesDisabled': 'Modules à désactiver',
  'sector.diff.modulesDisabled.warning':
    'La désactivation masque le module sans supprimer les données. Il peut être réactivé manuellement à tout moment.',
  'sector.diff.templates': 'Modèles de données à appliquer',
  'sector.diff.settings': 'Paramètres',
  'sector.diff.warnings': 'Avertissements',
  'sector.diff.none': 'Aucun changement',
  'sector.audit.note': 'Chaque reconfiguration est journalisée dans l’audit plateforme.',
  'sector.confirm.checkbox':
    'J’ai vérifié la prévisualisation ci-dessus et je comprends que les modules désactivés seront masqués (sans perte de données).',
  'sector.confirm.tenantWarning': 'Cette action modifie la configuration de {tenant}.',
  'sector.toast.apply.success': 'Reconfiguration sectorielle appliquée',
  'sector.toast.preview.error': 'Impossible de calculer la prévisualisation',
  'sector.readonly.hint': 'Vous n’avez pas la permission de modifier la configuration sectorielle.',

  // ---------------------------------------------------------------------------
  // Assistant de creation d'entreprise (/tenants/new/company)
  // ---------------------------------------------------------------------------
  'create.title': 'Nouvelle entreprise',
  'create.subtitle': 'Création d’un dossier client par un opérateur plateforme.',
  'create.step.sector': 'Secteur',
  'create.step.identity': 'Identité',
  'create.step.modules': 'Modules',
  'create.step.address': 'Adresse & forfait',
  'create.step.recap': 'Récapitulatif',

  'create.catalog.loading': 'Chargement du catalogue sectoriel…',
  'create.catalog.disabled':
    'La configuration sectorielle est désactivée sur cette instance : le dossier sera créé avec la configuration par défaut.',
  'create.catalog.fallback':
    'Catalogue sectoriel indisponible — recommandations par défaut. Vérifiez la sélection avant de valider.',

  'create.field.segment': 'Type de société',
  'create.field.domain': 'Domaine d’activité',
  'create.field.email': 'Email de l’administrateur',
  'create.field.password': 'Mot de passe',
  'create.field.confirmPassword': 'Confirmation du mot de passe',
  'create.field.firstName': 'Prénom',
  'create.field.lastName': 'Nom',
  'create.field.companyName': 'Raison sociale',
  'create.field.nif': 'Matricule fiscal (NIF)',
  'create.field.companyEmail': 'Email de la société',
  'create.field.phone': 'Téléphone',
  'create.field.street': 'Rue',
  'create.field.streetLine2': 'Complément d’adresse',
  'create.field.city': 'Ville',
  'create.field.governorate': 'Gouvernorat',
  'create.field.postalCode': 'Code postal',
  'create.field.taxRegime': 'Régime fiscal',
  'create.field.warehouseName': 'Entrepôt par défaut',
  'create.field.website': 'Site web',
  'create.field.plan': 'Forfait',

  'create.placeholder.segment': 'Sélectionnez un type de société',
  'create.placeholder.domain': 'Sélectionnez un domaine',
  'create.placeholder.governorate': 'Sélectionnez un gouvernorat',
  'create.placeholder.nif': '1234567/A/B/C/000',

  'create.hint.segmentFirst': 'Choisissez d’abord un type de société.',
  'create.hint.password':
    'Le mot de passe est défini par vous et n’est envoyé à personne. Transmettez-le au dirigeant par un canal sûr.',
  'create.hint.plan':
    'Le forfait reste modifiable à tout moment depuis la fiche entreprise.',
  'create.hint.warehouse': 'Pré-rempli d’après le type de société ; modifiable.',

  'create.modules.core': 'Modules du socle',
  'create.modules.core.hint': 'Toujours actifs, non modifiables.',
  'create.modules.recommended': 'Modules recommandés',
  'create.modules.optional': 'Autres modules',
  'create.modules.premium': 'Forfait supérieur requis',
  'create.modules.autoAdded': 'Prérequis ajouté automatiquement : {modules}',
  'create.modules.blocked': 'Impossible de retirer ce module : {modules} en dépend(ent).',

  'create.recap.sector': 'Secteur',
  'create.recap.identity': 'Identité',
  'create.recap.modules': 'Modules activés',
  'create.recap.address': 'Adresse & forfait',
  'create.recap.edit': 'Modifier',
  'create.recap.none': 'Non renseigné',
  'create.confirm.checkbox':
    'Je confirme créer ce dossier pour le compte du client, avec les informations ci-dessus.',

  'create.action.prev': 'Précédent',
  'create.action.next': 'Suivant',
  'create.action.submit': 'Créer l’entreprise',
  'create.action.cancel': 'Annuler',

  'create.success.title': 'Entreprise créée',
  'create.success.titlePending': 'Entreprise enregistrée — base de données en cours de création',
  'create.success.titleFailed': 'Entreprise enregistrée — la création de la base a échoué',
  'create.success.pendingHint':
    'Le dossier existe mais sa base n’est pas encore utilisable : l’utilisateur ne peut pas encore se connecter.',
  'create.success.failedHint':
    'Le dossier existe mais sa base n’a pas pu être créée. Relancez le provisionnement depuis la fiche entreprise.',
  'create.success.credentials':
    'Communiquez ces identifiants au dirigeant. Le compte est pré-vérifié : aucun email n’a été envoyé par la plateforme.',
  'create.success.managerEmail': 'Identifiant',
  'create.success.password': 'Mot de passe : celui que vous venez de saisir.',
  'create.success.warnings': 'Avertissements',
  'create.success.openTenant': 'Voir la fiche entreprise',
  'create.success.createAnother': 'Créer une autre entreprise',
  'create.success.reference': 'Référence support',

  'create.error.title': 'La création a échoué',
  'create.error.stepInvalid': 'Corrigez les champs en erreur avant de continuer.',

  // ---------------------------------------------------------------------------
  // Statut de provisionnement
  // ---------------------------------------------------------------------------
  'provisioning.ready': 'Prêt',
  'provisioning.pending': 'Provisionnement…',
  'provisioning.failed': 'Échec de provisionnement',

  // ---------------------------------------------------------------------------
  // Creation de cabinet comptable (/tenants/new/firm)
  // ---------------------------------------------------------------------------
  'createFirm.title': 'Nouveau cabinet comptable',
  'createFirm.subtitle': 'Création d’un cabinet par un opérateur plateforme.',
  'createFirm.section.manager': 'Compte responsable',
  'createFirm.section.firm': 'Cabinet',
  'createFirm.section.address': 'Adresse',
  'createFirm.field.firmName': 'Nom du cabinet',
  'createFirm.field.firmEmail': 'Email du cabinet',
  'createFirm.field.description': 'Description',
  'createFirm.field.registrationNumber': 'Numéro d’inscription à l’ordre',
  'createFirm.field.directory': 'Visible dans l’annuaire public',
  'createFirm.action.submit': 'Créer le cabinet',
  'createFirm.success.title': 'Cabinet créé',
  'createFirm.error.title': 'La création du cabinet a échoué',
} as const satisfies Record<string, string>;

export type TenantsFrKey = keyof typeof TENANTS_FR;
