using System.Globalization;
using FactuTrust.Application.DTOs;

namespace FactuTrust.Application.Features.Accounting.OfficialForm;

/// <summary>
/// Traduit une <see cref="VatDeclarationDto"/> en valeurs prêtes à être tamponnées sur le
/// formulaire officiel « التصريح الشهري بالأداءات » (déclaration mensuelle des impôts et taxes).
///
/// Fonction <b>pure</b> : aucune dépendance sur le PDF ni sur l'infrastructure, donc entièrement
/// testable. Les clés produites correspondent à celles de la carte de coordonnées
/// <c>mensuelle-&lt;millésime&gt;.map.json</c>.
///
/// Règle transverse : un montant nul ne produit <b>aucune</b> valeur. Sur une déclaration
/// fiscale, une case vide et un « 0,000 » ne portent pas le même sens, et le formulaire se
/// remplit traditionnellement en n'inscrivant que les lignes concernées.
/// </summary>
public static class MonthlyDeclarationFormBinder
{
    /// <summary>
    /// Millésime du formulaire officiel en vigueur.
    /// </summary>
    /// <remarks>
    /// Source unique : le gabarit PDF, la carte de coordonnées et la carte des codes rapport sont
    /// tous trois nommés d'après cette constante. Un nouveau millésime DGI se traite en déposant le
    /// triplet correspondant et en faisant évoluer cette seule valeur. Elle vit côté application
    /// parce que la traduction des codes rapport en a besoin autant que le tamponnage.
    /// </remarks>
    public const string FormVersion = "mensuelle-2026";

    /// <summary>
    /// Format des montants du formulaire : séparateur de milliers = espace, décimale = virgule,
    /// 3 décimales (millime).
    ///
    /// Volontairement distinct du <c>TnAmountFormat</c> employé par les états internes (qui
    /// utilise le point) : ce document part à la recette des finances et doit suivre la
    /// convention typographique tunisienne, celle-là même qu'affiche l'écran de saisie.
    /// </summary>
    private static readonly NumberFormatInfo AmountFormat = new()
    {
        NumberGroupSeparator = " ",
        NumberDecimalSeparator = ",",
        NumberDecimalDigits = 3
    };

    /// <summary>Code « رمز التصريح » — note (1) du formulaire.</summary>
    private const string CodeSpontaneous = "0";
    private const string CodeCorrective = "2";

    /// <summary>
    /// Construit le dictionnaire clé de case → valeur formatée.
    /// </summary>
    /// <param name="declaration">Déclaration calculée pour la période.</param>
    /// <param name="withholdingLines">
    /// Ventilation de la retenue à la source par ligne officielle (clé = suffixe de ligne,
    /// ex. <c>"Line1"</c>). Vide = seul le total de la page 4 est reporté.
    /// </param>
    /// <param name="configuredBoxes">
    /// Cases issues des rubriques paramétrées (<c>MonthlyDeclarationLineFormBinder.Project</c>).
    /// Fusionnées en dernier : sur un dossier passé au calcul paramétré, c'est la configuration qui
    /// décrit la ventilation, et elle prime donc sur les correspondances internes.
    /// </param>
    public static IReadOnlyDictionary<string, string?> Bind(
        VatDeclarationDto declaration,
        IReadOnlyDictionary<string, decimal>? withholdingLines = null,
        IReadOnlyDictionary<string, decimal>? configuredBoxes = null)
    {
        ArgumentNullException.ThrowIfNull(declaration);

        var values = new Dictionary<string, string?>(StringComparer.Ordinal);

        BindHeader(values, declaration);
        BindIdentity(values, declaration);
        BindCheckboxes(values, declaration);
        BindWithholding(values, declaration, withholdingLines);
        BindPayrollTaxes(values, declaration);
        BindVat(values, declaration);
        BindOtherDuties(values, declaration);
        BindRecap(values, declaration);
        BindConfiguredBoxes(values, configuredBoxes);

        return values;
    }

    /// <summary>
    /// Fusionne les cases produites par les rubriques paramétrées.
    /// </summary>
    /// <remarks>
    /// <c>Amount</c> rendant <c>null</c> pour zéro, la règle transverse « un montant nul ne produit
    /// aucune valeur » vaut ici comme ailleurs : une rubrique à zéro laisse sa case vierge plutôt
    /// que d'y inscrire « 0,000 ».
    /// </remarks>
    private static void BindConfiguredBoxes(
        IDictionary<string, string?> values, IReadOnlyDictionary<string, decimal>? configuredBoxes)
    {
        if (configuredBoxes is null || configuredBoxes.Count == 0)
            return;

        foreach (var (key, amount) in configuredBoxes)
            values[key] = Amount(amount);
    }

    // ── En-tête ───────────────────────────────────────────────────────────────

    private static void BindHeader(IDictionary<string, string?> values, VatDeclarationDto d)
    {
        var year = d.Year.ToString("D4", CultureInfo.InvariantCulture);
        for (var i = 0; i < 4 && i < year.Length; i++)
            values[$"Header.Year.D{i + 1}"] = year[i].ToString();

        var month = d.Month.ToString("D2", CultureInfo.InvariantCulture);
        for (var i = 0; i < 2 && i < month.Length; i++)
            values[$"Header.Month.D{i + 1}"] = month[i].ToString();

        // 0 = spontanée, 2 = correction. Les autres codes (régularisation, taxation d'office,
        // cessation d'activité) relèvent de situations que l'application ne modélise pas.
        values["Header.DeclarationCode"] = d.IsRectificative ? CodeCorrective : CodeSpontaneous;

        BindNif(values, d.Nif);
    }

    /// <summary>
    /// Éclate le matricule fiscal <c>NNNNNNN/L/A/M/NNN</c> dans les cases de l'en-tête.
    ///
    /// Les 8 cases de « المعرف الجبائي » reçoivent les 7 chiffres puis la lettre de catégorie ;
    /// « رمز الأداء على القيمة المضافة » reçoit le code TVA et « رمز الصنف » le code
    /// d'établissement. Correspondance à faire confirmer par un fiscaliste.
    /// </summary>
    private static void BindNif(IDictionary<string, string?> values, string? nif)
    {
        if (string.IsNullOrWhiteSpace(nif))
            return;

        var parts = nif.Split('/', StringSplitOptions.TrimEntries);
        var digits = parts[0];

        for (var i = 0; i < 7 && i < digits.Length; i++)
            values[$"Header.Nif.D{i + 1}"] = digits[i].ToString();

        if (parts.Length > 1 && parts[1].Length > 0)
            values["Header.Nif.D8"] = parts[1][..1];       // lettre de catégorie contribuable
        if (parts.Length > 2 && parts[2].Length > 0)
            values["Header.VatCode"] = parts[2][..1];      // code TVA
        if (parts.Length > 3 && parts[3].Length > 0)
            values["Header.CategoryCode"] = parts[3][..1]; // code établissement secondaire
    }

    private static void BindIdentity(IDictionary<string, string?> values, VatDeclarationDto d)
    {
        var name = !string.IsNullOrWhiteSpace(d.CompanyName) ? d.CompanyName : d.TradeName;
        values["Identity.Name"] = Truncate(name, 60);

        // L'adresse tient sur deux lignes du formulaire : on coupe sur une virgule pour éviter
        // de scinder un mot.
        var (line1, line2) = SplitAddress(d.AddressLine);
        values["Identity.Address1"] = Truncate(line1, 60);
        values["Identity.Address2"] = Truncate(line2, 55);

        // « النشاط » : le domaine ne porte aucun libellé d'activité (seule la lettre du matricule
        // existe, qui n'est pas un intitulé). La case reste vierge, à compléter à la main.
    }

    private static void BindCheckboxes(IDictionary<string, string?> values, VatDeclarationDto d)
    {
        // « ضع علامة (x) في الخانة المناسبة » : on ne coche que les impôts effectivement déclarés.
        Check(values, "Check.Withholding", d.WithholdingTax);
        Check(values, "Check.Tfp", d.Tfp);
        Check(values, "Check.Foprolos", d.Foprolos);
        Check(values, "Check.OtherDuties", d.Fodec);
        Check(values, "Check.StampDuty", d.DroitTimbre);
        Check(values, "Check.Tcl", d.Tcl);
        Check(values, "Check.ConsumptionDuty", d.ConsumptionDuty);
        Check(values, "Check.HotelTax", d.HotelTax);
        Check(values, "Check.LicenceFee", d.LicenceFee);

        // La TVA se déclare dès qu'il y a une opération, même si le solde est nul ou créditeur.
        var hasVatActivity = d.CollectedVat19 != 0m || d.CollectedVat13 != 0m || d.CollectedVat7 != 0m
                             || d.DeductibleVatGoods != 0m || d.DeductibleVatAssets != 0m
                             || d.VatDue != 0m || d.CreditToCarry != 0m;
        if (hasVatActivity)
            values["Check.Vat"] = "X";
    }

    private static void Check(IDictionary<string, string?> values, string key, decimal amount)
    {
        if (amount > 0m)
            values[key] = "X";
    }

    // ── Retenue à la source (pages 1 à 4) ─────────────────────────────────────

    private static void BindWithholding(
        IDictionary<string, string?> values,
        VatDeclarationDto d,
        IReadOnlyDictionary<string, decimal>? lines)
    {
        values["Withholding.Total"] = Amount(d.WithholdingTax);

        if (lines is null || lines.Count == 0)
            return;

        foreach (var (suffix, amount) in lines)
            values[$"Withholding.{suffix}"] = Amount(amount);
    }

    // ── TFP et FOPROLOS (page 4) ──────────────────────────────────────────────

    private static void BindPayrollTaxes(IDictionary<string, string?> values, VatDeclarationDto d)
    {
        // Assiette de la TFP et du FOPROLOS : la masse salariale soumise, jamais le chiffre
        // d'affaires. Elle vient du cycle de paie du mois ; à défaut (dossier sans module paie,
        // saisie manuelle), la case reste vierge — un chiffre faux ne se corrige pas à la main,
        // une case vide si.
        var basis = d.PayrollTaxBase;

        if (d.Tfp > 0m)
        {
            var prefix = TfpPrefix(d, basis);
            if (basis > 0m)
                values[$"{prefix}.Base"] = Amount(basis);
            values[$"{prefix}.Amount"] = Amount(d.Tfp);
            values["Tfp.Total"] = Amount(d.Tfp);
            values["Tfp.Remainder"] = Amount(d.Tfp);
        }

        if (d.Foprolos > 0m)
        {
            if (basis > 0m)
                values["Foprolos.Base"] = Amount(basis);
            values["Foprolos.Amount"] = Amount(d.Foprolos);
        }
    }

    /// <summary>
    /// Le formulaire distingue deux lignes exclusives : 1 % (industries manufacturières) et 2 %
    /// (autres activités). On retient le taux réellement appliqué par le cycle de paie ; à défaut,
    /// on le reconstitue depuis l'assiette ; en dernier recours « autres activités », cas le plus
    /// fréquent et le plus prudent (taux le plus élevé).
    /// </summary>
    private static string TfpPrefix(VatDeclarationDto d, decimal basis)
    {
        var ratePercent = d.TfpRatePercent > 0m
            ? d.TfpRatePercent
            : basis > 0m ? d.Tfp / basis * 100m : 0m;

        return ratePercent > 0m && Math.Abs(ratePercent - 1m) < 0.05m
            ? "Tfp.Manufacturing"
            : "Tfp.Other";
    }

    // ── TVA (page 5) ──────────────────────────────────────────────────────────

    private static void BindVat(IDictionary<string, string?> values, VatDeclarationDto d)
    {
        foreach (var rate in new[] { 7, 13, 19 })
        {
            var breakdown = d.CollectedVatBreakdown?.FirstOrDefault(b => b.RatePercent == rate);
            var vat = rate switch
            {
                7 => d.CollectedVat7,
                13 => d.CollectedVat13,
                _ => d.CollectedVat19
            };

            if (breakdown is not null && breakdown.TaxableBase != 0m)
                values[$"Vat.Rate{rate}.Base"] = Amount(breakdown.TaxableBase);
            values[$"Vat.Rate{rate}.Due"] = Amount(vat);
        }

        // Achats ouvrant droit à déduction. L'application distingue « biens et services » et
        // « immobilisations » ; le formulaire ventile par nature (immeubles / équipements /
        // autres) et par origine (locale / importée). On retient la correspondance la plus
        // fidèle possible : immobilisations → équipements locaux, biens et services → autres
        // achats locaux. La ventilation locale/importée n'est pas modélisée.
        if (d.DeductibleVatAssets != 0m)
            values["Vat.Purchase.EquipmentLocal.Deductible"] = Amount(d.DeductibleVatAssets);

        if (d.DeductibleVatGoods != 0m)
        {
            values["Vat.Purchase.OtherLocal.Deductible"] = Amount(d.DeductibleVatGoods);
            if (d.DeductiblePurchasesTaxableBase != 0m)
                values["Vat.Purchase.OtherLocal.Base"] = Amount(d.DeductiblePurchasesTaxableBase);
        }

        var collected = d.CollectedVat19 + d.CollectedVat13 + d.CollectedVat7;
        var deductible = d.DeductibleVatGoods + d.DeductibleVatAssets;

        values["Vat.Total.Due"] = Amount(collected);
        values["Vat.Total.Deductible"] = Amount(deductible);

        // « الباقي: (ب) مستوجب أو (ف) فائض » : montant dû, ou crédit reportable préfixé « ف ».
        values["Vat.Remainder"] = d.VatDue > 0m
            ? Amount(d.VatDue)
            : d.CreditToCarry > 0m ? $"(ف) {Amount(d.CreditToCarry)}" : null;

        values["Vat.PreviousCredit"] = Amount(d.PreviousCredit);
    }

    // ── Autres droits (page 6) ────────────────────────────────────────────────

    private static void BindOtherDuties(IDictionary<string, string?> values, VatDeclarationDto d)
    {
        if (d.Fodec <= 0m)
            return;

        var basis = d.FodecTaxableBase != 0m ? d.FodecTaxableBase : d.SalesTaxableBase;
        if (basis != 0m)
            values["Fodec.Base"] = Amount(basis);
        values["Fodec.Amount"] = Amount(d.Fodec);
    }

    // ── Récapitulatif (page 9) ────────────────────────────────────────────────

    private static void BindRecap(IDictionary<string, string?> values, VatDeclarationDto d)
    {
        // Colonne I = principal, colonne II = déduction (déclarations rectificatives seulement,
        // note (3) du formulaire), colonne III = I − II.
        RecapRow(values, "Withholding", d.WithholdingTax);
        RecapRow(values, "Tfp", d.Tfp);
        RecapRow(values, "Foprolos", d.Foprolos);
        RecapRow(values, "Vat", d.VatDue);
        RecapRow(values, "OtherDuties", d.Fodec);
        RecapRow(values, "StampDuty", d.DroitTimbre);
        RecapRow(values, "Tcl", d.Tcl);
        // Familles que seul le moteur paramétré alimente : nulles sur un dossier resté en calcul
        // historique, donc sans effet sur le récapitulatif existant.
        RecapRow(values, "ConsumptionDuty", d.ConsumptionDuty);
        RecapRow(values, "HotelTax", d.HotelTax);
        RecapRow(values, "LicenceFee", d.LicenceFee);

        var principal = d.WithholdingTax + d.Tfp + d.Foprolos + d.VatDue
                        + d.Fodec + d.DroitTimbre + d.Tcl
                        + d.ConsumptionDuty + d.HotelTax + d.LicenceFee;

        // Les acomptes provisionnels n'ont pas de ligne propre sur le formulaire mensuel : ils ne
        // sont reportés en colonne « الطرح (الأداء المدفوع) » que sur une rectificative, seul cas
        // prévu par la note (3). Hors rectificative, la colonne reste vide.
        var deduction = d.IsRectificative ? d.Acomptes : 0m;

        values["Recap.Total.Principal"] = Amount(principal);
        values["Recap.Total.Deduction"] = Amount(deduction);
        values["Recap.Total.Due"] = Amount(Math.Max(0m, principal - deduction));
        values["Recap.Total.Total"] = Amount(Math.Max(0m, principal - deduction));
    }

    private static void RecapRow(IDictionary<string, string?> values, string key, decimal amount)
    {
        if (amount <= 0m)
            return;

        values[$"Recap.{key}.Principal"] = Amount(amount);
        values[$"Recap.{key}.Due"] = Amount(amount);
        values[$"Recap.{key}.Total"] = Amount(amount);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Formate un montant, ou retourne <c>null</c> pour laisser la case vierge.</summary>
    private static string? Amount(decimal value)
        => value == 0m ? null : value.ToString("N3", AmountFormat);

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        value = value.Trim();
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static (string? First, string? Second) SplitAddress(string? address)
    {
        if (string.IsNullOrWhiteSpace(address))
            return (null, null);

        address = address.Trim();
        if (address.Length <= 60)
            return (address, null);

        var cut = address.LastIndexOf(',', Math.Min(60, address.Length - 1));
        if (cut <= 0)
            cut = address.LastIndexOf(' ', Math.Min(60, address.Length - 1));
        if (cut <= 0)
            return (address[..60], address[60..]);

        return (address[..cut].TrimEnd(), address[(cut + 1)..].TrimStart());
    }
}
