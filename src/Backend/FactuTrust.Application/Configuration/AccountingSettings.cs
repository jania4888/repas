using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Payroll;

namespace FactuTrust.Application.Configuration;

/// <summary>
/// Interrupteurs (feature flags) du programme « cycle de révision & dépôt légal » du module
/// comptabilité. Tous <c>false</c> par défaut : le comportement historique est strictement préservé
/// tant qu'un dossier ne les active pas explicitement (activation progressive, réversible sans
/// redéploiement). Cf. le plan de non-régression.
/// </summary>
public sealed class AccountingSettings
{
    public const string SectionName = "Accounting";

    /// <summary>
    /// Active le workflow brouillard/validation pour les écritures qui exigent une relecture :
    /// saisie manuelle, imports de dossier, relevés bancaires IA, assistant d'inventaire,
    /// « créer écriture » du rapprochement et extourne manuelle. Quand false, ces écritures
    /// naissent <c>Validee</c>.
    /// </summary>
    /// <remarks>
    /// Les écritures générées automatiquement depuis une pièce métier (factures, achats, paiements,
    /// caisse, paie, immobilisations, à-nouveaux, modèles récurrents et leurs extournes) naissent
    /// toujours <c>Validee</c>, que ce drapeau soit actif ou non. L'éteindre ne les change pas ;
    /// il retire seulement le brouillon des saisies et imports ci-dessus. La génération des relevés
    /// IA reste refusée quand le drapeau est inactif.
    /// </remarks>
    public bool BrouillardEnabled { get; set; }

    /// <summary>
    /// Politique d'inclusion des écritures en brouillard dans les états de consultation
    /// (journal, grand livre, balance). true = incluses avec marqueur (comportement Sage) ;
    /// les sorties légales (FEC, clôture, déclarations, liasse) opèrent toujours sur le validé.
    /// </summary>
    public bool IncludeBrouillardInReports { get; set; } = true;

    /// <summary>Active l'extourne (contre-passation) manuelle d'une écriture validée depuis l'UI.</summary>
    public bool ManualReversalEnabled { get; set; }

    /// <summary>Active la reprise de dossier par import (Excel/CSV + FEC) et l'écran associé.</summary>
    public bool DossierImportEnabled { get; set; }

    /// <summary>
    /// Active la déclaration mensuelle unique complète (TVA + RS + TCL + TFP/FOPROLOS + timbre +
    /// acomptes + rectificative). Quand false, la déclaration TVA historique (19/13/7) est servie.
    /// </summary>
    public bool MonthlyDeclarationV2Enabled { get; set; }

    /// <summary>
    /// Active l'export de la déclaration mensuelle au format du <b>formulaire officiel DGI</b>
    /// (tamponnage du gabarit arabe préimprimé « التصريح الشهري بالأداءات »). Quand false, seul le
    /// PDF de synthèse historique est exposé — le bouton correspondant est masqué et l'endpoint
    /// refuse la demande. Sans effet sur le calcul de la déclaration.
    /// </summary>
    public bool MonthlyDeclarationOfficialFormEnabled { get; set; }

    /// <summary>
    /// Active les états financiers au format NCT (bilan/résultat structurés + flux + variation des
    /// capitaux propres + notes). Quand false, seuls les états historiques sont exposés.
    /// </summary>
    public bool NctStatementsEnabled { get; set; }

    /// <summary>
    /// Active la partie fiscale de la liasse (détermination du résultat fiscal, calcul IS/IRPP,
    /// export consolidé). Défaut true — mettre à false pour masquer la fonctionnalité.
    /// </summary>
    public bool FiscalLiasseEnabled { get; set; } = true;

    /// <summary>
    /// Taux du FODEC (%) appliqué à la base HT de la période pour préremplir la déclaration mensuelle.
    /// Standard tunisien : 1 %. Mis à 0 pour désactiver le préremplissage FODEC.
    /// </summary>
    public decimal FodecRatePercent { get; set; } = 1.0m;

    /// <summary>
    /// Taux de la TCL (%) appliqué au chiffre d'affaires TTC de la période. Standard tunisien : 0,2 %.
    /// Mis à 0 pour désactiver le préremplissage TCL.
    /// </summary>
    public decimal TclRatePercent { get; set; } = 0.2m;

    /// <summary>
    /// Active l'outil de remplacement de compte (remplace un compte par un autre sur les lignes
    /// d'écriture des périodes ouvertes). OFF par défaut (opération de maintenance sensible).
    /// </summary>
    public bool AccountReplacementEnabled { get; set; }

    /// <summary>
    /// Active le catalogue de journaux modifiable (création/édition de journaux et familles). OFF par
    /// défaut : la liste standard figée (JV/JA/JC/JB/JOD/JIM/JAN) reste utilisée.
    /// </summary>
    public bool JournalCatalogEnabled { get; set; }

    /// <summary>Active l'import PDF/OCR de relevés bancaires dans le rapprochement.</summary>
    public bool BankStatementPdfImportEnabled { get; set; } = true;

    /// <summary>
    /// Assistant de rapprochement : quand le parseur historique ne lit AUCUNE ligne d'un PDF, essayer
    /// la lecture déterministe par profils bancaires (gabarits STB, BH, Zitouna, Attijari, BIAT
    /// mensuel…, fichiers à plusieurs relevés découpés par période) AVANT l'OCR et l'IA. Retenue
    /// seulement si chaque relevé est lu sans anomalie bloquante (soldes vérifiés au millime).
    /// OFF par défaut : sans lui, l'aperçu suit exactement le chemin historique.
    /// </summary>
    public bool BankStatementLayoutParserEnabled { get; set; }

    /// <summary>
    /// Budget total (secondes) de la lecture OCR + IA d'un relevé dans l'aperçu de l'assistant, attente
    /// de la file IA comprise. Toujours inférieur au délai du proxy (nginx : 300 s) pour rendre un
    /// message clair au lieu d'une 504. Borné à [1 ; 280] (défaut 240).
    /// </summary>
    public int BankStatementPreviewTimeoutSeconds { get; set; } = 240;

    /// <summary>
    /// Active l'import d'une facture (vente ou achat) depuis la saisie manuelle d'écritures :
    /// détection des zones de la pièce puis proposition de l'écriture selon le plan comptable
    /// tunisien. L'endpoint est en lecture seule — il ne fait que proposer.
    /// </summary>
    public bool DocumentImportEnabled { get; set; } = true;

    /// <summary>
    /// Délai maximal, en secondes, accordé au service d'extraction documentaire (Docstrange) pour
    /// l'import d'une pièce depuis la saisie manuelle. Il reste sous le délai du navigateur (190 s),
    /// lui-même sous nginx (300 s) et Traefik : c'est donc l'application qui rend le message, pas
    /// un proxy (« Bad Gateway »). N'affecte ni les relevés bancaires ni l'import Ventes/Achats,
    /// qui gardent <c>DocStrange:TimeoutSeconds</c>. Défaut 170, borné à [30 ; 180] : le plafond
    /// laisse 10 s de marge sous le délai fixe du navigateur (190 s), sinon le navigateur
    /// abandonnerait avant que l'application ne rende son message.
    /// </summary>
    public int DocumentImportExternalBudgetSeconds { get; set; } = 170;

    /// <summary>Plancher du budget : en dessous, Docstrange n'a pas le temps de lire 5 pages.</summary>
    public const int MinDocumentImportExternalBudgetSeconds = 30;

    /// <summary>Plafond du budget : délai du navigateur (190 s) moins 10 s de marge.</summary>
    public const int MaxDocumentImportExternalBudgetSeconds = 180;

    /// <summary>Valeur bornée de <see cref="DocumentImportExternalBudgetSeconds"/>.</summary>
    public int EffectiveDocumentImportExternalBudgetSeconds =>
        Math.Clamp(DocumentImportExternalBudgetSeconds, MinDocumentImportExternalBudgetSeconds, MaxDocumentImportExternalBudgetSeconds);

    /// <summary>
    /// Fenêtre de dates (± jours) utilisée par l'association automatique du rapprochement bancaire
    /// pour apparier une ligne de relevé à une écriture de même montant. Défaut : 10 jours.
    /// </summary>
    public int BankMatchWindowDays { get; set; } = 10;

    /// <summary>
    /// Active l'import IA de relevés bancaires vers des brouillons du journal de banque
    /// (« Importer un relevé bancaire » depuis la saisie manuelle). OFF par défaut : sans lui, les
    /// endpoints répondent 404 et le menu ne propose pas l'action.
    /// </summary>
    public bool BankStatementAiPostingEnabled { get; set; }

    /// <summary>
    /// Sous-drapeau de <see cref="BankStatementAiPostingEnabled"/> : active l'entrée CSV / XLSX
    /// (mappage de colonnes) dans le même pipeline d'import vers des brouillons du journal de
    /// banque. OFF par défaut : sans lui, <c>tabular/preview</c> et <c>sessions/tabular</c>
    /// répondent 404, comme le drapeau maître désactivé. N'a d'effet que si
    /// <see cref="BankStatementAiPostingEnabled"/> est aussi actif (voir
    /// <see cref="TabularImportEffective"/>).
    /// </summary>
    public bool BankStatementTabularImportEnabled { get; set; }

    /// <summary>Effet réel de <see cref="BankStatementTabularImportEnabled"/> : l'import maître doit être actif.</summary>
    public bool TabularImportEffective => BankStatementAiPostingEnabled && BankStatementTabularImportEnabled;

    /// <summary>
    /// Tout relevé PDF ou image passe par l'import IA : la lecture directe reste la première passe et
    /// l'IA relit automatiquement chaque page non lue avec certitude (page scannée, banque inconnue,
    /// ligne douteuse, solde qui ne boucle pas). L'assistant de rapprochement bascule alors ces
    /// fichiers vers l'import IA, et son ancien aperçu PDF/image (IA synchrone) est fermé.
    /// OFF par défaut : sans lui, tous les chemins restent strictement identiques. N'a d'effet que si
    /// <see cref="BankStatementAiPostingEnabled"/> est aussi actif (voir <see cref="AiForAllDocumentsEffective"/>).
    /// </summary>
    public bool BankStatementAiForAllDocumentsEnabled { get; set; }

    /// <summary>Effet réel de <see cref="BankStatementAiForAllDocumentsEnabled"/> : l'import IA doit être actif.</summary>
    public bool AiForAllDocumentsEffective => BankStatementAiPostingEnabled && BankStatementAiForAllDocumentsEnabled;

    /// <summary>
    /// Mode « tout document par l'IA » pour un dossier : posting actif, drapeau global, et dossier pilote si liste non vide.
    /// </summary>
    public bool IsAiForAllDocumentsEnabledFor(Guid? tenantId) =>
        BankStatementAiPostingEnabled
        && BankStatementAiForAllDocumentsEnabled
        && BankStatementImport.IsPilotTenant(tenantId);

    /// <summary>
    /// Mode « IA seule » pour un dossier (D1 + D3) : « tout document par l'IA » actif pour ce dossier
    /// et <see cref="BankStatementImportLimits.AiOnlyReadingEnabled"/>.
    /// </summary>
    public bool IsAiOnlyReadingEnabledFor(Guid? tenantId) =>
        IsAiForAllDocumentsEnabledFor(tenantId) && BankStatementImport.AiOnlyReadingEnabled;

    /// <summary>
    /// D4 pour un dossier : écart de solde en avertissement à reconnaître quand tout a été lu par l'IA.
    /// N'a d'effet qu'en mode « IA seule ».
    /// </summary>
    public bool IsAiBalanceMismatchAsWarningFor(Guid? tenantId) =>
        IsAiOnlyReadingEnabledFor(tenantId) && BankStatementImport.AiBalanceMismatchAsWarning;

    /// <summary>
    /// Rapprochement automatique « v2 » : priorité au lien source (écriture générée depuis la ligne
    /// de relevé) et comparaison de compte dans les deux sens (5321 ↔ sous-compte). OFF par défaut :
    /// l'association automatique historique reste strictement identique.
    /// </summary>
    public bool BankReconciliationMatchingV2Enabled { get; set; }

    /// <summary>Limites de l'import IA de relevés bancaires.</summary>
    public BankStatementImportLimits BankStatementImport { get; set; } = new();

    /// <summary>
    /// Active la checklist des contrôles de pré-clôture (brouillons, comptes d'attente non soldés,
    /// lettrage en suspens, dotations non passées, TVA compta vs déclarée…) et le blocage de la
    /// clôture annuelle / du verrouillage définitif sur les contrôles bloquants.
    /// </summary>
    public bool PreClosingControlsEnabled { get; set; }

    /// <summary>
    /// Seuil d'ancienneté (jours) au-delà duquel une ligne de tiers non lettrée est signalée par les
    /// contrôles de pré-clôture. Défaut : 90 jours.
    /// </summary>
    public int UnletteredAgeThresholdDays { get; set; } = 90;

    /// <summary>Active l'assistant d'écritures d'inventaire (CCA/PCA, charges à payer, provisions…).</summary>
    public bool InventoryAssistantEnabled { get; set; }

    /// <summary>
    /// Active le verrouillage définitif (irréversible) d'un exercice : bloque la réouverture des
    /// périodes et toute création d'écriture sur l'exercice verrouillé.
    /// </summary>
    public bool DefinitiveLockEnabled { get; set; }

    /// <summary>
    /// Active la comptabilité budgétaire : postes budgétaires, budgets annuels mensualisés
    /// (versions Initial/Révisé) et état budget vs réalisé. OFF = feature totalement inerte.
    /// </summary>
    public bool BudgetingEnabled { get; set; }

    /// <summary>
    /// Active l'envoi automatique quotidien de rappels e-mail aux responsables des échéances
    /// fiscales (J-7/J-1 et relance hebdomadaire en retard). OFF = aucun envoi (le rappel
    /// manuel de l'écran reste disponible).
    /// </summary>
    public bool FiscalEmailRemindersEnabled { get; set; }

    /// <summary>
    /// Jours d'anticipation déclenchant un rappel avant l'échéance (défaut : J-7 et J-1).
    /// </summary>
    public int[] FiscalReminderLeadDays { get; set; } = [7, 1];

    /// <summary>
    /// Synchronise l'échéancier fiscal depuis la déclaration mensuelle : à chaque
    /// enregistrement/soumission, l'échéance « Déclaration mensuelle » de la période est liée
    /// (SourceId), son montant estimé aligné sur le total à payer, et la soumission la marque
    /// « Déposée » (créée automatiquement si absente). OFF = aucun couplage (comportement historique).
    /// </summary>
    public bool DeclarationScheduleSyncEnabled { get; set; }

    /// <summary>
    /// Active le mode de paiement « traite / effet de commerce » : exposition de l'option à
    /// l'encaissement (ventes &amp; achats), saisie de l'échéance, écritures comptables d'effets
    /// (réception 413/403, puis encaissement/paiement à échéance 532/413 ou 403/532) et l'action
    /// « Encaisser l'effet ». OFF = l'option traite est refusée à l'enregistrement d'un paiement et
    /// les endpoints de règlement d'effet sont inertes (comportement historique intégralement préservé).
    /// </summary>
    public bool EffetDeCommerceEnabled { get; set; }

    /// <summary>
    /// Active le plan tiers unifié : répertoire clients+fournisseurs avec fiche comptable
    /// (code auxiliaire, compte collectif, délai de règlement), génération des codes auxiliaires
    /// et export FEC avec CompAuxNum lisible. OFF = feature inerte (comportement historique).
    /// </summary>
    public bool ThirdPartyDirectoryEnabled { get; set; }

    /// <summary>
    /// Active le centre de contrôle d'intégrité comptable (lecture seule) : diagnostics à la demande
    /// hors clôture — contrôles de pré-clôture partagés + détection d'anomalies structurelles
    /// (comptes hors plan, écritures hors période, doublons de pièce, tiers non auxiliarisables).
    /// Aucune action corrective (jamais de mutation). OFF = endpoint indisponible.
    /// </summary>
    public bool AccountingHealthEnabled { get; set; }

    /// <summary>
    /// Active le tableau de bord d'audit comptable (anomalies granulaires, KPI, analytics).
    /// OFF = l'écran /accounting/health conserve l'UI checklist simple.
    /// </summary>
    public bool AccountingAuditDashboardEnabled { get; set; }

    /// <summary>
    /// Persiste les runs de contrôle et les anomalies détectées (workflow collaboratif).
    /// OFF = évaluation à la volée sans écriture en base.
    /// </summary>
    public bool AccountingAuditPersistenceEnabled { get; set; }

    /// <summary>
    /// Active la planification Hangfire des contrôles automatiques.
    /// </summary>
    public bool AccountingAuditSchedulingEnabled { get; set; }

    /// <summary>
    /// Active le lien trésorerie paie : enregistrement des paiements de salaires, écritures JB/JC
    /// et lettrage sur le compte 425. OFF = comportement historique (export virement CSV seul).
    /// </summary>
    public bool PayrollTreasuryLinkEnabled { get; set; } = true;

    /// <summary>
    /// Ventile le crédit 425 par salarié (comptes auxiliaires) à la validation de la paie.
    /// OFF = une seule ligne 425 agrégée (comportement historique).
    /// </summary>
    public bool PayrollEmployeeAuxiliaryEnabled { get; set; } = true;

    /// <summary>Compte SCE pour les prêts salariés en cours (retenues mensuelles).</summary>
    public string PayrollEmployeeLoansAccount { get; set; } = "421.1";

    /// <summary>Compte SCE pour les saisies sur salaire et pensions alimentaires.</summary>
    public string PayrollGarnishmentsAccount { get; set; } = "427";

    /// <summary>Compte SCE pour les retenues salariales mutuelle / caisse complémentaire.</summary>
    public string PayrollMutuelleEmployeeAccount { get; set; } = "428.1";

    /// <summary>
    /// Profil d'imputation comptable de la paie (Legacy | Sce2026). Repli <c>Legacy</c> par défaut :
    /// le comportement historique est strictement préservé tant que le dossier ne bascule pas
    /// explicitement. La sélection effective par cycle tient compte de
    /// <see cref="PayrollAccountProfileEffectiveDate"/> (plan §5.3) : les cycles antérieurs à la
    /// date restent en <c>Legacy</c> (la réouverture→revalidation régénère les mêmes comptes),
    /// les cycles à partir de la date utilisent ce profil.
    /// </summary>
    public PayrollAccountProfile PayrollAccountProfile { get; set; } = PayrollAccountProfile.Legacy;

    /// <summary>
    /// Date de bascule du profil comptable paie (premier jour du mois d'effet). <c>null</c> = le
    /// <see cref="PayrollAccountProfile"/> s'applique à tous les cycles sans frontière temporelle
    /// (cas d'un nouveau dossier <c>Sce2026</c> dès le premier cycle).
    /// </summary>
    public DateTime? PayrollAccountProfileEffectiveDate { get; set; }

    /// <summary>
    /// Compte SCE de compensation des avantages en nature (retenue salarié) sous le profil Sce2026.
    /// Défaut 4286 « Personnel - autres charges à payer » : la contrepartie d'un avantage accordé au
    /// salarié appartient à la branche 42. Le défaut historique 4386 la rangeait sous 438
    /// « État - charges à payer », créant une dette envers l'État qui ne se solde jamais.
    /// Surchargeable par dossier ; le repli Legacy conserve le compte historique 421.
    /// </summary>
    public string PayrollInKindOffsetAccount { get; set; } = PayrollJournalEntryBuilder.InKindBenefitOffsetPayableAccount;

    /// <summary>
    /// Résout le profil d'imputation comptable d'un cycle paie (plan §5.3). Avant la date de bascule
    /// (<see cref="PayrollAccountProfileEffectiveDate"/>) → <c>Legacy</c> (la réouverture→revalidation
    /// régénère les mêmes comptes qu'à l'origine) ; à partir de la date → <see cref="PayrollAccountProfile"/>.
    /// Sans date de bascule, le profil configuré s'applique à tous les cycles. Source unique partagée
    /// par la génération réelle (AccountingService) et la simulation du journal de paie.
    /// </summary>
    public PayrollAccountProfile ResolvePayrollAccountProfile(int year, int month) =>
        ToPayrollProfileSnapshot().ResolveForPeriod(year, month);

    /// <summary>
    /// Instantané d'imputation issu de la configuration globale. Sert de repli quand le dossier ne
    /// porte pas de réglage propre (cf. <c>IPayrollAccountingProfileResolver</c>) et de source unique
    /// pour la résolution du profil et la carte de comptes.
    /// </summary>
    public PayrollAccountingProfileSnapshot ToPayrollProfileSnapshot() => new()
    {
        Profile = PayrollAccountProfile,
        EffectiveDate = PayrollAccountProfileEffectiveDate,
        InKindOffsetAccount = PayrollInKindOffsetAccount,
        LoansAccount = PayrollEmployeeLoansAccount,
        GarnishmentsAccount = PayrollGarnishmentsAccount,
        MutuelleEmployeeAccount = PayrollMutuelleEmployeeAccount,
        MealVoucherEmployeeAccount = PayrollMealVoucherEmployeeAccount,
        DisbursementEntriesEnabled = PayrollDisbursementEntriesEnabled,
        DetailedSalarySplitEnabled = PayrollDetailedSalarySplitEnabled,
        EmployeeAuxiliaryEnabled = PayrollEmployeeAuxiliaryEnabled,
        IsTenantOverride = false
    };

    /// <summary>
    /// Construit la carte de comptes SCE de l'OD de paie pour le profil résolu. La compensation
    /// d'avantage en nature utilise <see cref="PayrollInKindOffsetAccount"/> (4386) sous SCE et le
    /// compte historique 421 sous Legacy. Source unique partagée par la génération réelle
    /// (AccountingService) et la simulation du journal de paie.
    /// </summary>
    public PayrollJournalEntryAccountMap BuildPayrollAccountMap(PayrollAccountProfile profile) =>
        ToPayrollProfileSnapshot().BuildAccountMap(profile);

    /// <summary>
    /// Génère l'écriture de décaissement (débit 421 / 421.1, crédit 5321 ou 5411) à la création
    /// d'une avance et au versement d'un prêt salarié, et son extourne à la suppression / annulation.
    /// </summary>
    /// <remarks>
    /// OFF par défaut, réglable par dossier. Sans elle, le versement de l'avance ne laisse aucune
    /// trace : la retenue du mois suivant crédite 421 sans contrepartie et ce compte d'actif reste
    /// durablement créditeur — le comptable doit alors saisir l'OD à la main. Idempotente par source
    /// (<c>EmployeeAdvance</c> / <c>EmployeeLoan</c>).
    /// </remarks>
    public bool PayrollDisbursementEntriesEnabled { get; set; }

    /// <summary>
    /// Ventile le débit 640 (rémunérations du personnel) en sous-comptes 6400/6401/6402/6409 selon
    /// la nature du gain (<see cref="EarningKind"/>) ; les avantages en nature (6404) et les
    /// indemnités de rupture (64602) sont déjà isolés indépendamment de ce réglage.
    /// </summary>
    /// <remarks>
    /// OFF par défaut, réglable par dossier, et sans effet sous le profil <c>Legacy</c> : la
    /// ventilation est un confort d'analyse, non une exigence de conformité NCT 01 (640 est un
    /// compte de niveau 3 valide). Le reliquat non ventilable (prorata, absences) va au 6400, de
    /// sorte que le total débité reste exactement le brut.
    /// </remarks>
    public bool PayrollDetailedSalarySplitEnabled { get; set; }

    /// <summary>
    /// Règle de solde stricte (R-06) : à la validation, une avance/échéance/saisie n'est soldée
    /// que si une ligne de déduction figée du bulletin la référence (<c>SourceEntityId</c>) —
    /// plus de solde forfaitaire tenant-wide. Un garde-fou anti-staleness bloque la validation
    /// si une retenue a été créée/modifiée après le calcul du cycle. ON par défaut (plan §5) ;
    /// OFF = repli incident sur le comportement historique (solde forfaitaire).
    /// </summary>
    public bool PayrollStrictSettlementEnabled { get; set; } = true;

    /// <summary>Compte SCE pour la part employée des tickets restaurant.</summary>
    public string PayrollMealVoucherEmployeeAccount { get; set; } = "428.2";

    /// <summary>Active les caisses / mutuelles complémentaires dans le module paie.</summary>
    public bool PayrollSocialFundsEnabled { get; set; }

    /// <summary>Active les tickets restaurant dans le module paie.</summary>
    public bool PayrollMealVouchersEnabled { get; set; }

    /// <summary>Active les avantages en nature (véhicule, logement…) dans le module paie.</summary>
    public bool PayrollInKindBenefitsEnabled { get; set; }

    /// <summary>Active les prêts salariés avec échéancier dans le module paie.</summary>
    public bool PayrollEmployeeLoansEnabled { get; set; }

    /// <summary>Active les saisies sur salaire et pensions alimentaires dans le module paie.</summary>
    public bool PayrollGarnishmentsEnabled { get; set; }

    /// <summary>
    /// Active le bordereau CNSS mensuel et le suivi des versements (compte 453).
    /// Désactivé par défaut.
    /// </summary>
    public bool PayrollCnssRemittanceEnabled { get; set; }

    /// <summary>Active le calcul automatique des congés maladie (IJ CNSS, carence, subrogation).</summary>
    public bool PayrollStatutorySickLeaveEnabled { get; set; }

    /// <summary>Active le calcul automatique des congés maternité.</summary>
    public bool PayrollStatutoryMaternityLeaveEnabled { get; set; }

    /// <summary>Active le calcul automatique des congés paternité.</summary>
    public bool PayrollStatutoryPaternityLeaveEnabled { get; set; }

    /// <summary>Active le calcul des indemnités de rupture et soldes de tout compte.</summary>
    public bool PayrollTerminationIndemnityEnabled { get; set; }

    /// <summary>Active la génération des documents RH (STC, certificat de travail, attestation de salaire).</summary>
    public bool PayrollHrDocumentsEnabled { get; set; }

    /// <summary>Active les primes annuelles paramétrées (13e mois, ancienneté, vacances…).</summary>
    public bool PayrollAnnualBonusesEnabled { get; set; }

    /// <summary>Active les jours fériés tunisiens dans les calculs de jours ouvrables.</summary>
    public bool PayrollPublicHolidaysEnabled { get; set; }

    /// <summary>Active les fonctionnalités CIVP/SIVP étendues (attestation, alertes, validation).</summary>
    public bool PayrollCivpEnhancementsEnabled { get; set; }

    /// <summary>Active les plafonds CNSS et assiettes spécifiques dans le moteur de calcul.</summary>
    public bool PayrollCnssCeilingsEnabled { get; set; }

    /// <summary>
    /// Active l'historique des presets légaux multi-LF (lecture et comparaison).
    /// Safe par défaut : lecture seule, pas d'impact sur le calcul.
    /// </summary>
    public bool PayrollLegalPresetsHistoryEnabled { get; set; } = true;

    /// <summary>
    /// Active la saisie du taux de TVA sur les encaissements manuels « ventes au comptant »
    /// et la génération d'écritures à 3 lignes (TTC / HT 707 / TVA 436711). Ne garde QUE la
    /// création : la déclaration mensuelle restitue toujours la TVA caisse déjà comptabilisée (436711).
    /// </summary>
    public bool CashDeskVatEnabled { get; set; }

    /// <summary>
    /// Active la comptabilité multi-devises : catalogue des devises, taux de change, saisie et
    /// lettrage en devise.
    /// </summary>
    /// <remarks>
    /// OFF par défaut. Drapeau éteint, le catalogue est en lecture seule, aucune écriture ne peut
    /// être saisie dans une devise autre que la devise de tenue, et l'écran de saisie est
    /// strictement identique à ce qu'il était avant le chantier.
    /// </remarks>
    public bool MultiCurrencyEnabled { get; set; }

    /// <summary>
    /// Active les propositions de lettrage déterministes et le lettrage en masse (Phase 3).
    /// </summary>
    /// <remarks>
    /// OFF par défaut. Drapeau éteint, les endpoints de propositions et de masse renvoient
    /// <c>LETTERING_FEATURE_DISABLED</c> et l'écran de lettrage est strictement identique.
    /// </remarks>
    public bool LetteringSuggestionsEnabled { get; set; }

    /// <summary>Plafonds et budgets du moteur de propositions et du lettrage en masse.</summary>
    /// <remarks>Les consommateurs lisent toujours <see cref="LetteringSuggestionSettings.Clamped"/>.</remarks>
    public LetteringSuggestionSettings LetteringSuggestions { get; set; } = new();

    /// <summary>
    /// Écart maximal toléré, en pourcentage, entre un taux saisi manuellement et celui de la table
    /// des taux. Au-delà, la saisie est refusée même avec la permission de surcharge.
    /// </summary>
    /// <remarks>
    /// La borne existe pour transformer une faute de frappe en refus plutôt qu'en écriture fausse :
    /// un taux à 33,1420 au lieu de 3,31420 multiplierait la contre-valeur par dix.
    /// </remarks>
    public decimal ExchangeRateOverrideTolerancePercent { get; set; } = 5m;

    /// <summary>
    /// Durée de vie (secondes) du cache mémoire du tableau de bord comptable du dossier délégué
    /// (<c>GET /api/accounting/dashboard/overview</c>), par tenant et par période. 0 désactive le cache.
    /// Les balances âgées (situation clients/fournisseurs) ne sont jamais mises en cache.
    /// </summary>
    public int DashboardOverviewCacheSeconds { get; set; } = 30;

    /// <summary>
    /// Numéros de compte SCE portés par la configuration, pour un contrôle de forme au démarrage.
    /// </summary>
    /// <remarks>
    /// Volontairement limité aux clés qui désignent un compte du plan comptable : ce sont elles qui
    /// finissent en <c>ChartOfAccount.Create</c>, lequel refuse désormais un numéro hors norme.
    /// </remarks>
    public IEnumerable<(string Key, string? Value)> ConfiguredAccountNumbers()
    {
        yield return (nameof(PayrollEmployeeLoansAccount), PayrollEmployeeLoansAccount);
        yield return (nameof(PayrollGarnishmentsAccount), PayrollGarnishmentsAccount);
        yield return (nameof(PayrollMutuelleEmployeeAccount), PayrollMutuelleEmployeeAccount);
    }
}

/// <summary>
/// Réglages du moteur de propositions de lettrage et du lettrage en masse (plan v2, annexe C §2.7).
/// </summary>
/// <remarks>
/// Une valeur hors bornes ne fait jamais échouer le démarrage : elle est signalée par un
/// avertissement (voir <see cref="OutOfRangeKeys"/>) et ramenée dans ses bornes par
/// <see cref="Clamped"/>. Les budgets sont exprimés en nœuds explorés, pour un résultat
/// déterministe ; le fusible en millisecondes n'est qu'une protection de dernier recours.
/// </remarks>
public sealed class LetteringSuggestionSettings
{
    public int MaxCandidateLines { get; set; } = 5000;
    public int MaxSuggestions { get; set; } = 200;
    public int SubsetMaxSize { get; set; } = 4;
    public int SubsetMaxCandidates { get; set; } = 25;
    public int SubsetNodeBudgetPerTarget { get; set; } = 20_000;
    public int SubsetGlobalNodeBudget { get; set; } = 500_000;
    public int MaxLinesPerReference { get; set; } = 20;
    public int MaxDocumentPayments { get; set; } = 20;
    public int TimeFuseMilliseconds { get; set; } = 3000;
    public int BulkMaxGroups { get; set; } = 200;
    public int BulkMaxLinesPerGroup { get; set; } = 50;
    public int BulkMaxTotalLines { get; set; } = 2000;

    private static readonly LetteringSuggestionSettings Defaults = new();

    /// <summary>Bornes dures (min, max) de chaque réglage, par nom de propriété.</summary>
    public static IReadOnlyList<(string Key, int Min, int Max)> Bounds { get; } =
    [
        (nameof(MaxCandidateLines), 1, 5000),
        (nameof(MaxSuggestions), 1, 200),
        (nameof(SubsetMaxSize), 2, 6),
        (nameof(SubsetMaxCandidates), 2, 40),
        (nameof(SubsetNodeBudgetPerTarget), 1, Defaults.SubsetNodeBudgetPerTarget * 10),
        (nameof(SubsetGlobalNodeBudget), 1, Defaults.SubsetGlobalNodeBudget * 10),
        (nameof(MaxLinesPerReference), 1, Defaults.MaxLinesPerReference * 10),
        (nameof(MaxDocumentPayments), 1, Defaults.MaxDocumentPayments * 10),
        (nameof(TimeFuseMilliseconds), 100, 10_000),
        (nameof(BulkMaxGroups), 1, 200),
        (nameof(BulkMaxLinesPerGroup), 2, 50),
        (nameof(BulkMaxTotalLines), 2, 2000),
    ];

    private IEnumerable<(string Key, int Value)> Values()
    {
        yield return (nameof(MaxCandidateLines), MaxCandidateLines);
        yield return (nameof(MaxSuggestions), MaxSuggestions);
        yield return (nameof(SubsetMaxSize), SubsetMaxSize);
        yield return (nameof(SubsetMaxCandidates), SubsetMaxCandidates);
        yield return (nameof(SubsetNodeBudgetPerTarget), SubsetNodeBudgetPerTarget);
        yield return (nameof(SubsetGlobalNodeBudget), SubsetGlobalNodeBudget);
        yield return (nameof(MaxLinesPerReference), MaxLinesPerReference);
        yield return (nameof(MaxDocumentPayments), MaxDocumentPayments);
        yield return (nameof(TimeFuseMilliseconds), TimeFuseMilliseconds);
        yield return (nameof(BulkMaxGroups), BulkMaxGroups);
        yield return (nameof(BulkMaxLinesPerGroup), BulkMaxLinesPerGroup);
        yield return (nameof(BulkMaxTotalLines), BulkMaxTotalLines);
    }

    /// <summary>Réglages hors bornes : nom, valeur lue, bornes.</summary>
    public IEnumerable<(string Key, int Value, int Min, int Max)> OutOfRangeKeys()
    {
        var bounds = Bounds.ToDictionary(b => b.Key);
        foreach (var (key, value) in Values())
        {
            var (_, min, max) = bounds[key];
            if (value < min || value > max)
                yield return (key, value, min, max);
        }
    }

    /// <summary>Copie dont chaque réglage est ramené dans ses bornes dures. Ne modifie pas l'instance.</summary>
    public LetteringSuggestionSettings Clamped()
    {
        var b = Bounds.ToDictionary(x => x.Key, x => (x.Min, x.Max));
        int C(string key, int value) => Math.Clamp(value, b[key].Min, b[key].Max);
        return new LetteringSuggestionSettings
        {
            MaxCandidateLines = C(nameof(MaxCandidateLines), MaxCandidateLines),
            MaxSuggestions = C(nameof(MaxSuggestions), MaxSuggestions),
            SubsetMaxSize = C(nameof(SubsetMaxSize), SubsetMaxSize),
            SubsetMaxCandidates = C(nameof(SubsetMaxCandidates), SubsetMaxCandidates),
            SubsetNodeBudgetPerTarget = C(nameof(SubsetNodeBudgetPerTarget), SubsetNodeBudgetPerTarget),
            SubsetGlobalNodeBudget = C(nameof(SubsetGlobalNodeBudget), SubsetGlobalNodeBudget),
            MaxLinesPerReference = C(nameof(MaxLinesPerReference), MaxLinesPerReference),
            MaxDocumentPayments = C(nameof(MaxDocumentPayments), MaxDocumentPayments),
            TimeFuseMilliseconds = C(nameof(TimeFuseMilliseconds), TimeFuseMilliseconds),
            BulkMaxGroups = C(nameof(BulkMaxGroups), BulkMaxGroups),
            BulkMaxLinesPerGroup = C(nameof(BulkMaxLinesPerGroup), BulkMaxLinesPerGroup),
            BulkMaxTotalLines = C(nameof(BulkMaxTotalLines), BulkMaxTotalLines),
        };
    }
}
