namespace FactuTrust.Domain.Enums;

/// <summary>
/// Familles de la déclaration mensuelle des impôts et taxes (« التصريح الشهري بالأداءات »).
/// Une famille correspond à un onglet de l'écran de configuration, à une case « X » de l'en-tête du
/// formulaire officiel et à une ligne de son récapitulatif (page 9).
/// </summary>
/// <remarks>
/// Les valeurs sont numérotées à partir de 1 : le zéro est réservé, afin qu'une colonne non
/// renseignée (défaut CLR) ne se lise jamais comme « retenue à la source ». <see cref="OtherInformation"/>
/// vaut 99 parce que ce n'est pas un impôt — la famille ne porte aucun montant à payer et n'est
/// jamais sommée dans le total.
/// </remarks>
public enum MonthlyDeclarationFamily
{
    /// <summary>Retenue à la source (« الخصم من المورد »), articles 1 à 31 du formulaire.</summary>
    Withholding = 1,

    /// <summary>Taxe de formation professionnelle.</summary>
    Tfp = 2,

    /// <summary>Fonds de promotion des logements pour salariés.</summary>
    Foprolos = 3,

    /// <summary>Droit de consommation.</summary>
    ConsumptionDuty = 4,

    /// <summary>Taxe sur la valeur ajoutée.</summary>
    Vat = 5,

    /// <summary>Autres taxes sur le chiffre d'affaires (FODEC et assimilées).</summary>
    OtherTurnoverTaxes = 6,

    /// <summary>Droit de timbre.</summary>
    StampDuty = 7,

    /// <summary>Taxe hôtelière.</summary>
    HotelTax = 8,

    /// <summary>Taxe sur les établissements à caractère industriel, commercial ou professionnel.</summary>
    Tcl = 9,

    /// <summary>Droit de licence.</summary>
    LicenceFee = 10,

    /// <summary>
    /// Autres informations (achats en suspension, achats exonérés, exportations, ventes en
    /// suspension, chiffre d'affaires exonéré…). Déclaratif : aucun montant à payer.
    /// </summary>
    OtherInformation = 99
}

/// <summary>
/// Régime de calcul de la déclaration mensuelle pour un dossier. C'est la rampe de bascule vers le
/// moteur paramétré : elle existe pour que le remplacement du calcul historique se constate avant
/// de se subir.
/// </summary>
public enum MonthlyDeclarationMode
{
    /// <summary>
    /// Calcul historique câblé en dur. Défaut, et seul comportement d'un dossier qui n'a jamais
    /// ouvert l'écran de configuration.
    /// </summary>
    Legacy = 0,

    /// <summary>
    /// Les deux calculs tournent. Les montants <b>déclarés</b> restent ceux du calcul historique ;
    /// le calcul paramétré n'est exposé qu'en comparaison, écart en millimes à l'appui. Aucune
    /// écriture ne change : c'est le mode de recette.
    /// </summary>
    Parity = 1,

    /// <summary>
    /// Le moteur paramétré est la source unique. Une famille incluse sans rubrique applicable
    /// bloque l'enregistrement plutôt que de produire un zéro silencieux.
    /// </summary>
    Configured = 2
}

/// <summary>Origine du montant brut d'une rubrique (colonne « Type Calcul Montant Brut »).</summary>
public enum RubricGrossKind
{
    /// <summary>Constante portée par la rubrique, ou saisie par l'opérateur si elle est absente.</summary>
    Fixed = 0,

    /// <summary>Valeur du cycle de paie du mois, désignée par <c>PayrollComponent</c>.</summary>
    Payroll = 1,

    /// <summary>Somme des mouvements de la période sur les comptes de rôle « brut », selon le sens.</summary>
    Account = 2,

    /// <summary>Déduit de la retenue : <c>Retenue ÷ (Taux ÷ 100)</c>.</summary>
    WithheldOverRate = 3
}

/// <summary>Origine de la retenue d'une rubrique (colonne « type Calcul Retenu »).</summary>
public enum RubricWithheldKind
{
    /// <summary>Constante portée par la rubrique, ou saisie par l'opérateur si elle est absente.</summary>
    Fixed = 0,

    /// <summary>Somme des mouvements de la période sur les comptes de rôle « retenue », selon le sens.</summary>
    Account = 1,

    /// <summary>Dérivée du brut : <c>Brut × Taux ÷ 100</c>.</summary>
    GrossTimesRate = 2,

    /// <summary>
    /// Retenue déduite d'elle-même par le taux. <b>Non implémentée</b> : aucune lecture fiscale
    /// univoque ne s'en dégage. L'évaluateur rend 0 et signale la combinaison ; la ligne reste
    /// saisissable. À activer après validation par un fiscaliste.
    /// </summary>
    WithheldOverRate = 3,

    /// <summary>
    /// Valeur du cycle de paie du mois, désignée par le composant de paie de la colonne retenue.
    /// </summary>
    /// <remarks>
    /// Indispensable pour les articles 1 et 3 du formulaire : l'IRPP et la CSS ont la même assiette
    /// — le net imposable — mais deux retenues distinctes. Les lire sur un compte commun les
    /// compterait deux fois ; les lire sur le cycle de paie les distingue à la source.
    /// </remarks>
    Payroll = 4
}

/// <summary>Sens retenu pour lire le mouvement d'un compte sur la période.</summary>
public enum AccountBalanceSide
{
    /// <summary>Somme des débits.</summary>
    Debit = 0,

    /// <summary>Somme des crédits.</summary>
    Credit = 1
}

/// <summary>Colonne de la rubrique qu'un compte sélectionné alimente.</summary>
public enum RubricAccountRole
{
    /// <summary>Comptes de la colonne « Montant brut ».</summary>
    Gross = 0,

    /// <summary>Comptes de la colonne « Retenue ».</summary>
    Withheld = 1
}

/// <summary>Mode de rapprochement d'un compte sélectionné avec les numéros du plan.</summary>
public enum RubricAccountMatchMode
{
    /// <summary>Le numéro exact, et lui seul.</summary>
    Exact = 0,

    /// <summary>Le numéro et tous ses sous-comptes (« 617 et sa descendance »).</summary>
    Prefix = 1
}

/// <summary>
/// Valeur du cycle de paie du mois qu'une rubrique « Paie » consomme. Chaque membre projette une
/// propriété de <c>PayrollMonthlyContribution</c> : l'énumération existe parce que « Paie » seul
/// serait ambigu — une rubrique TFP et une rubrique IRPP ne lisent pas le même chiffre.
/// </summary>
public enum PayrollContributionComponent
{
    /// <summary>Masse salariale brute du mois.</summary>
    SalariesGrossBase = 0,

    /// <summary>Net imposable cumulé : assiette des articles 1 et 3 du formulaire officiel.</summary>
    SalariesNetTaxableBase = 1,

    /// <summary>Assiette des taxes sur salaires (TFP, FOPROLOS), figée sur le cycle.</summary>
    PayrollTaxBase = 2,

    /// <summary>IRPP retenu, régularisations annuelles comprises.</summary>
    WithholdingIrpp = 3,

    /// <summary>CSS salariale retenue, régularisations annuelles comprises.</summary>
    WithholdingCss = 4,

    /// <summary>IRPP + CSS.</summary>
    WithholdingTotal = 5,

    /// <summary>TFP calculée par le cycle.</summary>
    Tfp = 6,

    /// <summary>FOPROLOS calculé par le cycle.</summary>
    Foprolos = 7
}

/// <summary>Provenance du montant porté par une ligne de déclaration déposée.</summary>
public enum VatDeclarationLineOrigin
{
    /// <summary>Produit par le moteur et accepté tel quel.</summary>
    Computed = 0,

    /// <summary>Saisi par l'opérateur, sans calcul possible (rubrique à valeur fixe non renseignée).</summary>
    Manual = 1,

    /// <summary>Calculé puis corrigé à la main : l'écart avec le calcul reste lisible sur la ligne.</summary>
    ComputedThenEdited = 2
}
