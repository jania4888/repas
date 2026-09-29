namespace FactuTrust.Application.DTOs;

/// <summary>
/// Un compte sélectionné sur une colonne d'une rubrique. <c>MatchMode</c> : 0 = compte exact,
/// 1 = racine (le compte et sa descendance).
/// </summary>
public sealed record MonthlyDeclarationRubricAccountDto
{
    /// <summary>0 = colonne brut, 1 = colonne retenue.</summary>
    public int Role { get; init; }
    public string AccountNumber { get; init; } = null!;
    public int MatchMode { get; init; }
}

/// <summary>Rubrique paramétrable de la déclaration mensuelle, telle que l'écran la manipule.</summary>
public sealed record MonthlyDeclarationRubricDto
{
    public Guid Id { get; init; }

    /// <summary>1 = RS, 2 = TFP, 3 = FOPROLOS, 4 = DC, 5 = TVA, 6 = autres taxes sur CA,
    /// 7 = droit de timbre, 8 = taxe hôtelière, 9 = TCL, 10 = droit de licence,
    /// 99 = autres informations.</summary>
    public int Family { get; init; }

    public string Code { get; init; } = null!;
    public string Label { get; init; } = null!;
    public string ReportCode { get; init; } = null!;

    /// <summary>0 = Fixe, 1 = Paie, 2 = Compte, 3 = Retenu/taux.</summary>
    public int GrossKind { get; init; }

    /// <summary>0 = Fixe, 1 = Compte, 2 = Brut×Taux, 3 = Retenu/taux (non implémenté).</summary>
    public int WithheldKind { get; init; }

    /// <summary>0 = débiteur, 1 = créditeur.</summary>
    public int GrossSide { get; init; }
    public int WithheldSide { get; init; }

    public decimal RatePercent { get; init; }

    /// <summary><c>null</c> ne vaut pas zéro : la ligne attend une saisie au Calcul DM.</summary>
    public decimal? FixedGrossAmount { get; init; }
    public decimal? FixedWithheldAmount { get; init; }

    /// <summary>Valeur du cycle de paie de la colonne brut (obligatoire si le brut est de type paie).</summary>
    public int? PayrollComponent { get; init; }

    /// <summary>
    /// Valeur du cycle de paie de la colonne retenue (obligatoire si la retenue est de type paie).
    /// Distincte de la précédente : l'article 1 lit le net imposable en brut et l'IRPP en retenue.
    /// </summary>
    public int? WithheldPayrollComponent { get; init; }

    /// <summary>Valeur documentaire de la colonne brut (obligatoire si le brut est de type documents).</summary>
    public int? GrossDocumentSource { get; init; }

    /// <summary>Valeur documentaire de la colonne retenue (obligatoire si la retenue est de type documents).</summary>
    public int? WithheldDocumentSource { get; init; }

    public DateTime? EffectiveFrom { get; init; }

    /// <summary>« Maximum date d'application » : la rubrique s'applique à tout le mois de cette date.</summary>
    public DateTime? EffectiveTo { get; init; }

    public bool IsActive { get; init; }
    public int DisplayOrder { get; init; }

    public IReadOnlyList<MonthlyDeclarationRubricAccountDto> Accounts { get; init; } =
        Array.Empty<MonthlyDeclarationRubricAccountDto>();
}

/// <summary>Inclusion d'une famille dans la déclaration du dossier.</summary>
public sealed record MonthlyDeclarationFamilySettingDto
{
    public int Family { get; init; }
    public bool IsIncluded { get; init; }
}

/// <summary>Régime de calcul du dossier et état de sa rampe de bascule.</summary>
public sealed record MonthlyDeclarationSettingsDto
{
    /// <summary>0 = Legacy (calcul historique), 1 = Parity (recette), 2 = Configured.</summary>
    public int Mode { get; init; }

    public DateTime? ConfiguredSince { get; init; }
    public DateTime? LastParityRunAt { get; init; }
    public long LastParityMaxGapMillimes { get; init; }
    public int ParityCleanStreak { get; init; }
    public int RequiredCleanParityPeriods { get; init; }
    public bool CanSwitchToConfigured { get; init; }
    public string? ParityOverrideBy { get; init; }
    public string? ParityOverrideReason { get; init; }

    /// <summary>Reflet de <c>AccountingSettings.ConfigurableLinesActive</c> : pilote l'affichage.</summary>
    public bool ConfigurableLinesEnabled { get; init; }
}

/// <summary>Configuration complète du dossier, en une lecture pour l'écran Configuration DM.</summary>
public sealed record MonthlyDeclarationConfigurationDto
{
    public MonthlyDeclarationSettingsDto Settings { get; init; } = new();
    public IReadOnlyList<MonthlyDeclarationFamilySettingDto> Families { get; init; } =
        Array.Empty<MonthlyDeclarationFamilySettingDto>();
    public IReadOnlyList<MonthlyDeclarationRubricDto> Rubrics { get; init; } =
        Array.Empty<MonthlyDeclarationRubricDto>();

    /// <summary>
    /// Avertissements de cohérence de la configuration (même assiette multipliée deux fois dans une
    /// famille, double lecture d'une même source). Ils n'empêchent pas l'affichage.
    /// </summary>
    public IReadOnlyList<string> Warnings { get; init; } = Array.Empty<string>();
}

/// <summary>Création d'une rubrique.</summary>
public sealed record CreateMonthlyDeclarationRubricRequest
{
    public int Family { get; init; }
    public string Code { get; init; } = null!;
    public string Label { get; init; } = null!;
    public string ReportCode { get; init; } = null!;
    public int GrossKind { get; init; }
    public int WithheldKind { get; init; }
    public int GrossSide { get; init; }
    public int WithheldSide { get; init; }
    public decimal RatePercent { get; init; }
    public decimal? FixedGrossAmount { get; init; }
    public decimal? FixedWithheldAmount { get; init; }
    public int? PayrollComponent { get; init; }
    public int? WithheldPayrollComponent { get; init; }
    public int? GrossDocumentSource { get; init; }
    public int? WithheldDocumentSource { get; init; }
    public DateTime? EffectiveFrom { get; init; }
    public DateTime? EffectiveTo { get; init; }
    public int DisplayOrder { get; init; }
    public IReadOnlyList<MonthlyDeclarationRubricAccountDto> Accounts { get; init; } =
        Array.Empty<MonthlyDeclarationRubricAccountDto>();
}

/// <summary>
/// Modification d'une rubrique. Ni la famille ni le code n'y figurent : le code relie la rubrique
/// aux lignes déjà déposées, et changer de famille déplacerait un montant d'un impôt à un autre
/// sous le même identifiant.
/// </summary>
public sealed record UpdateMonthlyDeclarationRubricRequest
{
    public string Label { get; init; } = null!;
    public string ReportCode { get; init; } = null!;
    public int GrossKind { get; init; }
    public int WithheldKind { get; init; }
    public int GrossSide { get; init; }
    public int WithheldSide { get; init; }
    public decimal RatePercent { get; init; }
    public decimal? FixedGrossAmount { get; init; }
    public decimal? FixedWithheldAmount { get; init; }
    public int? PayrollComponent { get; init; }
    public int? WithheldPayrollComponent { get; init; }
    public int? GrossDocumentSource { get; init; }
    public int? WithheldDocumentSource { get; init; }
    public DateTime? EffectiveFrom { get; init; }
    public DateTime? EffectiveTo { get; init; }
    public int DisplayOrder { get; init; }
    public IReadOnlyList<MonthlyDeclarationRubricAccountDto> Accounts { get; init; } =
        Array.Empty<MonthlyDeclarationRubricAccountDto>();
}

/// <summary>Signalement émis par le moteur pendant l'évaluation d'une rubrique.</summary>
public sealed record MonthlyDeclarationDiagnosticDto
{
    /// <summary>
    /// 0 = compte inconnu, 1 = taux requis, 2 = cycle de paie non arrêté,
    /// 3 = combinaison non prise en charge, 4 = code rapport non cartographié,
    /// 5 = ligne écartée du formulaire, 6 = famille incluse sans rubrique applicable,
    /// 7 = même source reprise par deux rubriques.
    /// </summary>
    public int Kind { get; init; }

    public string? Detail { get; init; }
}

/// <summary>
/// Ligne de déclaration produite par le moteur paramétré pour une période.
/// </summary>
public sealed record MonthlyDeclarationLineDto
{
    /// <summary>Rubrique d'origine, à titre de référence (vide sur une ligne déposée orpheline).</summary>
    public Guid RubricId { get; init; }

    public string Code { get; init; } = null!;
    public string Label { get; init; } = null!;
    public int Family { get; init; }
    public string ReportCode { get; init; } = null!;

    /// <summary>Colonne « Montant brut », au millime. Peut être négative sur une période d'extourne.</summary>
    public decimal Gross { get; init; }

    /// <summary>Colonne « Retenue », au millime.</summary>
    public decimal Withheld { get; init; }

    public decimal RatePercentApplied { get; init; }

    /// <summary>La rubrique attend une saisie : type « Fixe » sans constante enregistrée.</summary>
    public bool RequiresManualInput { get; init; }

    public IReadOnlyList<MonthlyDeclarationDiagnosticDto> Diagnostics { get; init; } =
        Array.Empty<MonthlyDeclarationDiagnosticDto>();
}

/// <summary>Bascule de la case « Inclure cette famille dans déclaration mensuelle ? ».</summary>
public sealed record SetMonthlyDeclarationFamilyRequest
{
    public int Family { get; init; }
    public bool IsIncluded { get; init; }
}

/// <summary>Demande de duplication de la configuration depuis un autre dossier du cabinet.</summary>
public sealed record DuplicateMonthlyDeclarationConfigRequest
{
    /// <summary>Dossier source, vérifié côté serveur contre le portefeuille du cabinet appelant.</summary>
    public Guid SourceCompanyTenantId { get; init; }

    /// <summary>Remplacer les rubriques de même code au lieu de les ignorer.</summary>
    public bool Overwrite { get; init; }
}

/// <summary>Compte rendu d'une duplication de configuration.</summary>
public sealed record MonthlyDeclarationDuplicationResultDto
{
    public int Inserted { get; init; }
    public int Replaced { get; init; }

    /// <summary>Codes déjà présents et laissés intacts (mode sans remplacement).</summary>
    public IReadOnlyList<string> SkippedCodes { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Comptes copiés qui n'existent pas au plan du dossier de destination. Ils sont créés quand
    /// même : les retirer effacerait l'indication de ce qui devrait exister.
    /// </summary>
    public IReadOnlyList<string> UnknownAccounts { get; init; } = Array.Empty<string>();
}

/// <summary>Changement de régime de calcul du dossier.</summary>
public sealed record SetMonthlyDeclarationModeRequest
{
    /// <summary>0 = Legacy, 1 = Parity, 2 = Configured.</summary>
    public int Mode { get; init; }

    /// <summary>Premier jour du mois d'effet ; requis pour passer en mode configuré.</summary>
    public DateTime? ConfiguredSince { get; init; }

    /// <summary>
    /// Motif de dérogation, exigé lorsque la série de contrôles de parité sans écart n'est pas
    /// atteinte. Conservé dans l'audit : c'est la trace de qui a décidé de passer outre.
    /// </summary>
    public string? OverrideReason { get; init; }
}

/// <summary>Fichier de modèle produit par l'export de la configuration DM.</summary>
public sealed record MonthlyDeclarationModelFileDto
{
    /// <summary>Nom proposé au téléchargement, dossier et date compris.</summary>
    public string FileName { get; init; } = null!;

    /// <summary>Contenu JSON du modèle.</summary>
    public string Content { get; init; } = null!;
}

/// <summary>Import d'un fichier de modèle sur le dossier courant.</summary>
public sealed record ImportMonthlyDeclarationModelRequest
{
    /// <summary>Contenu du fichier, tel que lu par l'écran.</summary>
    public string Content { get; init; } = null!;

    /// <summary>Remplacer les rubriques de même code au lieu de les ignorer.</summary>
    public bool Overwrite { get; init; }

    /// <summary>
    /// Autorise un fichier à décocher des familles aujourd'hui incluses. Sans cette confirmation,
    /// l'import est refusé et le refus nomme les familles : décocher une famille, c'est cesser de la
    /// déclarer.
    /// </summary>
    public bool ConfirmFamilyExclusions { get; init; }
}

/// <summary>Entrée du fichier refusée par l'analyseur, avec son motif.</summary>
public sealed record MonthlyDeclarationModelRejectionDto
{
    public string Code { get; init; } = null!;
    public string Reason { get; init; } = null!;
}

/// <summary>Compte rendu d'un import de modèle.</summary>
public sealed record MonthlyDeclarationModelImportResultDto
{
    public int Inserted { get; init; }
    public int Replaced { get; init; }

    /// <summary>Codes déjà présents et laissés intacts (mode sans remplacement).</summary>
    public IReadOnlyList<string> SkippedCodes { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Comptes cités par le fichier qui n'existent pas au plan du dossier. Ils sont enregistrés
    /// quand même : les retirer effacerait l'indication de ce qui devrait exister.
    /// </summary>
    public IReadOnlyList<string> UnknownAccounts { get; init; } = Array.Empty<string>();

    /// <summary>Nombre d'inclusions de familles réellement modifiées par l'import.</summary>
    public int FamiliesChanged { get; init; }

    /// <summary>
    /// Familles d'un fichier v1 importées dans leur définition v2, parce qu'elles étaient celles du
    /// catalogue v1 à l'identique.
    /// </summary>
    public IReadOnlyList<int> UpgradedFamilies { get; init; } = Array.Empty<int>();

    /// <summary>
    /// Vrai quand le fichier, antérieur à la version 2, portait des inclusions de familles : elles
    /// ont été ignorées, tout export antérieur les ayant toutes à « non incluse ».
    /// </summary>
    public bool FamilyInclusionsIgnored { get; init; }

    /// <summary>
    /// Entrées refusées. Toujours vide sur un import réussi : une seule entrée fautive fait
    /// échouer le fichier entier, et cette liste est alors portée par le message d'erreur.
    /// </summary>
    public IReadOnlyList<MonthlyDeclarationModelRejectionDto> Rejected { get; init; } =
        Array.Empty<MonthlyDeclarationModelRejectionDto>();
}

/// <summary>Un mois de l'exercice, vu par le « Suivi DM ».</summary>
public sealed record MonthlyDeclarationTrackingRowDto
{
    public int Month { get; init; }

    /// <summary>Une déclaration est-elle enregistrée pour cette période ?</summary>
    public bool Exists { get; init; }

    /// <summary>0 = brouillon, 1 = déposée, 2 = verrouillée. Sans objet si <c>Exists</c> est faux.</summary>
    public int Status { get; init; }

    public DateTime? SubmittedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
    public decimal TotalToPay { get; init; }
    public decimal VatDue { get; init; }
    public int RevisionNumber { get; init; }
    public bool IsRectificative { get; init; }

    /// <summary>Échéance de dépôt de la période.</summary>
    public DateTime FilingDeadline { get; init; }

    /// <summary>
    /// Régime qui s'applique à <b>cette</b> période, et non le régime courant du dossier : une
    /// période antérieure à la date d'effet reste calculée à l'ancienne.
    /// </summary>
    public int Mode { get; init; }
}

/// <summary>Les douze mois d'un exercice, et l'état de la rampe du dossier.</summary>
public sealed record MonthlyDeclarationTrackingDto
{
    public int Year { get; init; }

    public MonthlyDeclarationSettingsDto Settings { get; init; } = new();

    /// <summary>Toujours douze lignes, même sans aucun dépôt : un trou se voit, une ligne absente non.</summary>
    public IReadOnlyList<MonthlyDeclarationTrackingRowDto> Months { get; init; } =
        Array.Empty<MonthlyDeclarationTrackingRowDto>();
}
