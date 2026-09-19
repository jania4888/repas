using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Encode une valeur en <b>largeurs de modules</b>, pas en image.
///
/// <para>
/// Le résultat est une alternance barre / espace <b>commençant toujours par une barre</b>,
/// chaque entier valant un multiple de la largeur du module le plus étroit. Le rendu final —
/// PDF, écran, étiquette thermique — n'a plus qu'à dessiner des rectangles à partir de cette
/// suite, ce qui donne un tracé <b>vectoriel</b> net à n'importe quelle résolution. Une image
/// rastérisée, elle, se dégraderait sur une imprimante thermique 203 dpi, où un demi-pixel
/// d'écart suffit à rendre un code illisible à la douchette.
/// </para>
/// </summary>
public interface IBarcodeEncoder
{
    /// <summary>
    /// Largeurs de modules, alternance barre/espace en commençant par une barre.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// La valeur ne peut pas être représentée dans cette symbologie.
    /// </exception>
    IReadOnlyList<int> Encode(string value, BarcodeSymbology symbology);

    /// <summary>
    /// Texte lisible imprimé sous les barres (HRI), au découpage conventionnel de la
    /// symbologie. C'est ce que recopie un opérateur quand la douchette ne lit plus.
    /// </summary>
    string HumanReadable(string value, BarcodeSymbology symbology);
}
