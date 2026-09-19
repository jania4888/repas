namespace FactuTrust.Application.Configuration;

/// <summary>
/// Drapeaux de déploiement de la gestion des codes-barres. Tous éteints par défaut.
/// </summary>
public sealed class BarcodeOptions
{
    public const string SectionName = "Features:Barcodes";

    /// <summary>
    /// Autorise l'<b>écriture</b> d'un code-barres autre qu'un EAN-8 ou un EAN-13 : UPC-A,
    /// GTIN-14, Code 128.
    ///
    /// <para>
    /// La <b>lecture</b> n'est jamais gardée : elle tolère déjà le plus large, ce qui est sans
    /// effet tant qu'aucune valeur étendue n'existe en base. Garder l'écriture seule donne un
    /// vrai interrupteur d'arrêt — éteindre le drapeau ramène exactement le comportement
    /// d'avant, sans laisser en base des valeurs que l'application ne saurait plus relire.
    /// </para>
    /// </summary>
    public bool ExtendedSymbologiesEnabled { get; set; }

    /// <summary>Ouvre l'impression d'étiquettes (endpoint PDF). Éteint, l'endpoint répond 404.</summary>
    public bool LabelPrintingEnabled { get; set; }

    /// <summary>
    /// Sous-préfixe à deux chiffres des codes-barres internes engendrés par l'application.
    ///
    /// <para>
    /// Le premier chiffre est toujours <c>2</c> : GS1 réserve le préfixe <c>2</c> à la
    /// circulation restreinte, de sorte qu'un code interne ne peut par construction jamais
    /// entrer en collision avec le GTIN d'un fabricant.
    /// </para>
    /// </summary>
    public string InternalPrefix { get; set; } = "00";
}
