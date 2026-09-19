using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Infrastructure.Services.Barcodes;

/// <summary>
/// Aiguillage vers l'encodeur de chaque symbologie.
///
/// <para>
/// Sans état, donc enregistrable en singleton : les tables de motifs sont des constantes et
/// l'encodage est une fonction pure de la valeur.
/// </para>
/// </summary>
public sealed class BarcodeEncoder : IBarcodeEncoder
{
    public IReadOnlyList<int> Encode(string value, BarcodeSymbology symbology)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);

        var normalized = value.Trim();

        return symbology switch
        {
            BarcodeSymbology.Ean8 => EanUpcEncoder.EncodeEan8(normalized),
            BarcodeSymbology.UpcA => EanUpcEncoder.EncodeUpcA(normalized),
            BarcodeSymbology.Ean13 => EanUpcEncoder.EncodeEan13(normalized),
            BarcodeSymbology.Gtin14 => Itf14Encoder.EncodeGtin14(normalized),
            BarcodeSymbology.Code128 => Code128Encoder.Encode(normalized),
            _ => throw new ArgumentOutOfRangeException(nameof(symbology), symbology, "Symbologie inconnue.")
        };
    }

    /// <summary>
    /// Découpage conventionnel du texte sous les barres. Il n'est pas cosmétique : c'est ce
    /// groupement que l'œil suit pour recopier un code de treize chiffres sans se perdre.
    /// </summary>
    public string HumanReadable(string value, BarcodeSymbology symbology)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);

        var v = value.Trim();

        return symbology switch
        {
            // EAN-13 : 1 + 6 + 6
            BarcodeSymbology.Ean13 when v.Length == 13 => $"{v[0]} {v[1..7]} {v[7..]}",
            // UPC-A : 1 + 5 + 5 + 1
            BarcodeSymbology.UpcA when v.Length == 12 => $"{v[0]} {v[1..6]} {v[6..11]} {v[11]}",
            // EAN-8 : 4 + 4
            BarcodeSymbology.Ean8 when v.Length == 8 => $"{v[..4]} {v[4..]}",
            // GTIN-14 : 1 + 2 + 5 + 5 + 1
            BarcodeSymbology.Gtin14 when v.Length == 14 => $"{v[0]} {v[1..3]} {v[3..8]} {v[8..13]} {v[13]}",
            _ => v
        };
    }
}
