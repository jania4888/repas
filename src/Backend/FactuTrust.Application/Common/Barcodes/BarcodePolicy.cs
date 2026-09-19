using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Common.Barcodes;

/// <summary>
/// Applique le drapeau de déploiement au <b>chemin d'écriture</b> d'un code-barres.
///
/// <para>
/// La règle vit ici, hors du domaine : un value object n'a pas à connaître l'état d'un
/// déploiement, et la même valeur doit rester lisible quel que soit le drapeau. Ce sont donc
/// les trois handlers d'écriture — création, mise à jour, matrice de variantes — qui
/// interrogent cette politique juste après avoir construit le <see cref="Barcode"/>.
/// </para>
/// </summary>
public static class BarcodePolicy
{
    /// <summary>
    /// Symbologies écrivables lorsque le drapeau est éteint : exactement celles que le
    /// catalogue acceptait avant l'extension.
    /// </summary>
    private static bool IsLegacySymbology(BarcodeSymbology symbology) =>
        symbology is BarcodeSymbology.Ean8 or BarcodeSymbology.Ean13;

    /// <summary>
    /// Vérifie qu'un code-barres peut être enregistré dans l'état courant du déploiement.
    /// </summary>
    public static Result EnsureWritable(Barcode barcode, BarcodeOptions options)
    {
        ArgumentNullException.ThrowIfNull(barcode);
        ArgumentNullException.ThrowIfNull(options);

        if (options.ExtendedSymbologiesEnabled || IsLegacySymbology(barcode.Symbology))
            return Result.Success();

        return Result.Failure(Error.Validation("Barcode",
            $"Ce type de code-barres ({Describe(barcode.Symbology)}) n'est pas activé sur cette installation. " +
            "Seuls les codes EAN-8 et EAN-13 sont acceptés."));
    }

    /// <summary>Libellé destiné à l'utilisateur, jamais au contrat d'API.</summary>
    public static string Describe(BarcodeSymbology symbology) => symbology switch
    {
        BarcodeSymbology.Ean8 => "EAN-8",
        BarcodeSymbology.UpcA => "UPC-A",
        BarcodeSymbology.Ean13 => "EAN-13",
        BarcodeSymbology.Gtin14 => "GTIN-14",
        BarcodeSymbology.Code128 => "Code 128",
        _ => symbology.ToString()
    };
}
