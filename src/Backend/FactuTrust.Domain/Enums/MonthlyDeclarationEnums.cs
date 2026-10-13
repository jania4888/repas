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

public static class MonthlyDeclarationFamilyExtensions
{
    /// <summary>
    /// Libellé de l'onglet de l'écran Configuration DM. Un message serveur qui nomme une famille
    /// doit désigner l'onglet à ouvrir pour corriger, pas le nom technique de l'énumération.
    /// </summary>
    public static string ToDisplayString(this MonthlyDeclarationFamily family) => family switch
    {
        MonthlyDeclarationFamily.Withholding => "Retenue à la source",
        MonthlyDeclarationFamily.Tfp => "T.F.P",
        MonthlyDeclarationFamily.Foprolos => "FOPROLOS",
        MonthlyDeclarationFamily.ConsumptionDuty => "Droit de consommation",
        MonthlyDeclarationFamily.Vat => "T.V.A",
        MonthlyDeclarationFamily.OtherTurnoverTaxes => "Autres taxes C.A",
        MonthlyDeclarationFamily.StampDuty => "Droit de timbre",
        MonthlyDeclarationFamily.HotelTax => "Taxe hôtelière",
        MonthlyDeclarationFamily.Tcl => "T.C.L",
        MonthlyDeclarationFamily.LicenceFee => "Droit de licence",
        MonthlyDeclarationFamily.OtherInformation => "Autres informations",
        _ => family.ToString()
    };
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
    WithheldOverRate = 3,

    /// <summary>
    /// Valeur lue sur les documents de la période (factures, rapport de retenue à la source),
    /// désignée par <c>GrossDocumentSource</c>.
    /// </summary>
    Document = 4
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
    Payroll = 4,

    /// <summary>
    /// Valeur lue sur les documents de la période (factures, rapport de retenue à la source),
    /// désignée par <c>WithheldDocumentSource</c>.
    /// </summary>
    Document = 5
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
    Foprolos = 7,

    // ── TFP ventilée par activité ────────────────────────────────────────────
    // Le formulaire porte deux lignes exclusives — 1 % industries manufacturières, 2 % autres
    // activités — et le cycle n'a qu'un taux. Chaque paire rend la valeur du cycle si son taux
    // correspond à l'activité, 0 sinon : deux rubriques, une par ligne, ne peuvent donc jamais
    // compter la TFP deux fois. La règle est celle du formulaire (TfpActivity.IsManufacturing).

    /// <summary>Assiette des taxes sur salaires si la TFP est au taux « industries manufacturières », sinon 0.</summary>
    PayrollTaxBaseManufacturing = 8,

    /// <summary>TFP du cycle si elle est au taux « industries manufacturières », sinon 0.</summary>
    TfpManufacturing = 9,

    /// <summary>Assiette des taxes sur salaires si la TFP est au taux « autres activités », sinon 0.</summary>
    PayrollTaxBaseOtherActivities = 10,

    /// <summary>TFP du cycle si elle est au taux « autres activités », sinon 0.</summary>
    TfpOtherActivities = 11
}

/// <summary>
/// Valeur lue sur les documents de la période qu'une rubrique « Documents » consomme. Chaque
/// membre projette une propriété de <c>DeclarationDocumentContribution</c>, exactement comme
/// <see cref="PayrollContributionComponent"/> le fait pour la paie.
/// </summary>
/// <remarks>
/// <para>
/// Valeurs explicites, groupées par centaine, parce qu'elles sont persistées : insérer un membre ne
/// doit jamais renuméroter les autres.
/// </para>
/// <para>
/// Les membres <c>…Base</c> sont des assiettes (colonne brut), les membres <c>…Amount</c> des
/// montants (colonne retenue). La séparation est vérifiée à l'écriture de la rubrique
/// (<c>DeclarationDocumentSources.IsAllowedFor</c>).
/// </para>
/// <para>
/// Les compartiments de la retenue à la source reproduisent, ligne de rapport par ligne, la
/// ventilation historique vers le formulaire officiel ; le reliquat se calcule par différence avec
/// le total. La somme des compartiments égale donc le total du rapport par construction.
/// </para>
/// </remarks>
public enum DeclarationDocumentSource
{
    // ── Ventes et factures clients (factures éligibles de la période) ────────

    /// <summary>Chiffre d'affaires hors taxes facturé.</summary>
    SalesTaxableBase = 100,

    /// <summary>Chiffre d'affaires TTC facturé : assiette historique de la TCL.</summary>
    SalesGrossBase = 101,

    /// <summary>
    /// Assiette FODEC telle que le formulaire la reporte : assiette des lignes soumises au FODEC,
    /// à défaut le chiffre d'affaires hors taxes.
    /// </summary>
    FodecFormBase = 102,

    /// <summary>FODEC facturé.</summary>
    FodecAmount = 103,

    /// <summary>Droit de timbre facturé.</summary>
    FiscalStampAmount = 104,

    // ── Retenue à la source sur factures fournisseurs (rapport RS mensuel) ───

    /// <summary>Salaires et traitements retenus hors cycle de paie — assiette (article 1).</summary>
    WithholdingSalariesBase = 200,
    WithholdingSalariesAmount = 201,

    /// <summary>Honoraires au taux de 3 % — régime réel et personnes morales (article 6).</summary>
    WithholdingFeesRealRegimeBase = 202,
    WithholdingFeesRealRegimeAmount = 203,

    /// <summary>Honoraires aux autres taux — personnes physiques hors régime réel (article 5).</summary>
    WithholdingFeesOtherBase = 204,
    WithholdingFeesOtherAmount = 205,

    /// <summary>Commissions, courtages et loyers (article 4, personnes morales).</summary>
    WithholdingCommissionsAndRentsBase = 206,
    WithholdingCommissionsAndRentsAmount = 207,

    /// <summary>Acquisitions au taux de 1 % (article 17.1).</summary>
    WithholdingPurchasesRate1Base = 208,
    WithholdingPurchasesRate1Amount = 209,

    /// <summary>Acquisitions au taux de 0,5 % (article 17.2).</summary>
    WithholdingPurchasesRate05Base = 210,
    WithholdingPurchasesRate05Amount = 211,

    /// <summary>Acquisitions au taux de 1,5 % (article 17.3).</summary>
    WithholdingPurchasesRate15Base = 212,
    WithholdingPurchasesRate15Amount = 213,

    /// <summary>Revenus de capitaux mobiliers (article 10).</summary>
    WithholdingCapitalIncomeBase = 214,
    WithholdingCapitalIncomeAmount = 215,

    /// <summary>Dividendes (article 12).</summary>
    WithholdingDividendsBase = 216,
    WithholdingDividendsAmount = 217,

    /// <summary>Revenus immobiliers (article 16).</summary>
    WithholdingRealEstateBase = 218,
    WithholdingRealEstateAmount = 219,

    /// <summary>Retenue au titre de la TVA à 100 % — non établis en Tunisie (article 19).</summary>
    WithholdingVatFullBase = 220,
    WithholdingVatFullAmount = 221,

    /// <summary>Retenue au titre de la TVA aux autres taux — marchés publics (article 18).</summary>
    WithholdingVatOtherBase = 222,
    WithholdingVatOtherAmount = 223,

    /// <summary>Plus-values (article 24).</summary>
    WithholdingCapitalGainsBase = 224,
    WithholdingCapitalGainsAmount = 225,

    /// <summary>Non-résidents (article 25).</summary>
    WithholdingNonResidentsBase = 226,
    WithholdingNonResidentsAmount = 227,

    /// <summary>
    /// Reliquat : ce que le rapport totalise sans le ventiler sur une ligne (jeux, autres
    /// catégories, acquisitions à un autre taux, lignes à retenue négative).
    /// </summary>
    WithholdingRemainderBase = 228,
    WithholdingRemainderAmount = 229
}

/// <summary>Colonne d'une rubrique qu'une source « Documents » peut alimenter.</summary>
public static class DeclarationDocumentSources
{
    /// <summary>
    /// Une assiette (<c>…Base</c>) n'alimente que le montant brut, un montant (<c>…Amount</c>) que
    /// la retenue : lire une assiette comme une retenue produirait un impôt égal au chiffre
    /// d'affaires.
    /// </summary>
    public static bool IsAllowedFor(DeclarationDocumentSource source, RubricAccountRole column)
    {
        if (!Enum.IsDefined(source))
            return false;

        return column == RubricAccountRole.Gross ? IsBase(source) : !IsBase(source);
    }

    public static bool IsBase(DeclarationDocumentSource source) => source switch
    {
        DeclarationDocumentSource.SalesTaxableBase
            or DeclarationDocumentSource.SalesGrossBase
            or DeclarationDocumentSource.FodecFormBase => true,
        DeclarationDocumentSource.FodecAmount
            or DeclarationDocumentSource.FiscalStampAmount => false,
        // Module RS : les assiettes portent un numéro pair, les montants le suivant.
        _ => (int)source % 2 == 0
    };

    /// <summary>Libellé de la valeur, tel que l'écran de configuration l'affiche.</summary>
    public static string Label(DeclarationDocumentSource source) => source switch
    {
        DeclarationDocumentSource.SalesTaxableBase => "Chiffre d'affaires HT facturé",
        DeclarationDocumentSource.SalesGrossBase => "Chiffre d'affaires TTC facturé",
        DeclarationDocumentSource.FodecFormBase => "Assiette FODEC",
        DeclarationDocumentSource.FodecAmount => "FODEC facturé",
        DeclarationDocumentSource.FiscalStampAmount => "Droit de timbre facturé",
        _ when WithholdingLabel(source) is { } label =>
            $"Retenue à la source — {label} ({(IsBase(source) ? "assiette" : "retenue")})",
        _ => source.ToString()
    };

    private static string? WithholdingLabel(DeclarationDocumentSource source) =>
        ((int)source & ~1) switch
        {
            (int)DeclarationDocumentSource.WithholdingSalariesBase => "salaires hors paie",
            (int)DeclarationDocumentSource.WithholdingFeesRealRegimeBase => "honoraires 3 %",
            (int)DeclarationDocumentSource.WithholdingFeesOtherBase => "honoraires autres taux",
            (int)DeclarationDocumentSource.WithholdingCommissionsAndRentsBase => "commissions et loyers",
            (int)DeclarationDocumentSource.WithholdingPurchasesRate1Base => "acquisitions 1 %",
            (int)DeclarationDocumentSource.WithholdingPurchasesRate05Base => "acquisitions 0,5 %",
            (int)DeclarationDocumentSource.WithholdingPurchasesRate15Base => "acquisitions 1,5 %",
            (int)DeclarationDocumentSource.WithholdingCapitalIncomeBase => "revenus de capitaux mobiliers",
            (int)DeclarationDocumentSource.WithholdingDividendsBase => "dividendes",
            (int)DeclarationDocumentSource.WithholdingRealEstateBase => "revenus immobiliers",
            (int)DeclarationDocumentSource.WithholdingVatFullBase => "TVA 100 %",
            (int)DeclarationDocumentSource.WithholdingVatOtherBase => "TVA autres taux",
            (int)DeclarationDocumentSource.WithholdingCapitalGainsBase => "plus-values",
            (int)DeclarationDocumentSource.WithholdingNonResidentsBase => "non-résidents",
            (int)DeclarationDocumentSource.WithholdingRemainderBase => "reliquat sans ligne dédiée",
            _ => null
        };
}

/// <summary>Comment une déclaration enregistrée a été produite.</summary>
public enum DeclarationCalculationOrigin
{
    /// <summary>Calcul historique câblé en dur (toutes les déclarations d'avant la bascule).</summary>
    Historic = 0,

    /// <summary>Calcul paramétré : les montants viennent des rubriques de la configuration DM.</summary>
    Configured = 1
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
