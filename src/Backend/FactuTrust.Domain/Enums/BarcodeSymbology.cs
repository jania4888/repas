namespace FactuTrust.Domain.Enums;

/// <summary>
/// Symbologie d'un code-barres article.
///
/// <para>
/// Cette valeur n'est <b>jamais persistée</b> : elle se dérive de la valeur du code-barres.
/// Une colonne dédiée sur un type possédé optionnel rendrait illisibles les articles déjà en
/// base — EF se sert de la colonne <c>Barcode</c> comme sentinelle de présence, et une
/// seconde colonne non renseignée sur les lignes existantes ferait échouer la matérialisation
/// de l'entité. Voir <c>docs/architecture/adr-barcode-symbologies.md</c>.
/// </para>
///
/// <para>
/// Les valeurs numériques sont figées : elles peuvent apparaître dans des exports.
/// </para>
/// </summary>
public enum BarcodeSymbology
{
    /// <summary>GTIN-8 : 8 chiffres, clé de contrôle comprise. Petits conditionnements.</summary>
    Ean8 = 1,

    /// <summary>UPC-A : 12 chiffres, clé de contrôle comprise. Équivalent à un EAN-13 préfixé d'un zéro.</summary>
    UpcA = 2,

    /// <summary>GTIN-13 : 13 chiffres, clé de contrôle comprise. Le cas courant du commerce de détail.</summary>
    Ean13 = 3,

    /// <summary>GTIN-14 : 14 chiffres, clé de contrôle comprise. Unité logistique (carton, palette).</summary>
    Gtin14 = 4,

    /// <summary>
    /// Code 128 : alphanumérique, sans clé de contrôle lisible. Sert aux références internes
    /// et fournisseur. C'est le classement de repli de tout code qui n'est pas un GTIN.
    /// </summary>
    Code128 = 5
}
