using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.ValueObjects;

/// <summary>
/// Code-barres article : EAN-8, UPC-A, EAN-13, GTIN-14 ou Code 128.
///
/// <para>
/// Pour les symbologies numériques de longueur GTIN (8, 12, 13, 14), la clé de contrôle est
/// vérifiée à la création : un code mal recopié est refusé à la saisie plutôt que de dormir au
/// catalogue jusqu'à ce qu'un scan tombe à côté. Tout le reste — longueur non-GTIN, présence
/// d'une lettre — est classé Code 128, qui ne porte pas de clé lisible.
/// </para>
///
/// <para>
/// <b>Un numérique de longueur GTIN ne peut donc PAS se replier sur Code 128.</b> C'est
/// délibéré : sans cette règle, il suffirait de fausser un chiffre pour contourner le contrôle
/// de clé, ce qui rouvrirait exactement le défaut de sûreté que la vérification corrige — le
/// scan du point de vente cherchait autrefois dans le CODE PRODUIT interne avec repli sur une
/// correspondance approchée, et pouvait donc encaisser un autre article.
/// </para>
///
/// <para>
/// La <see cref="Symbology"/> est <b>dérivée</b> de la valeur, jamais stockée. Voir
/// <see cref="BarcodeSymbology"/> et <c>docs/architecture/adr-barcode-symbologies.md</c>.
/// </para>
/// </summary>
public sealed class Barcode : ValueObject
{
    /// <summary>Plancher aligné sur celui du détecteur de douchette côté caisse.</summary>
    public const int MinLength = 3;

    /// <summary>
    /// Plafond aligné sur la colonne <c>Products.Barcode</c> (<c>nvarchar(48)</c>). 14 suffit
    /// pour un GTIN-14 ; la marge sert aux références Code 128.
    /// </summary>
    public const int MaxLength = 48;

    /// <summary>
    /// Jeu de caractères admis pour un Code 128.
    ///
    /// <para>
    /// Volontairement restreint. <c>/</c> et <c>\</c> sont exclus parce que la recherche par
    /// code-barres passe par un <b>segment de chemin</b> (<c>GET api/products/by-barcode/{barcode}</c>) :
    /// un <c>%2F</c> y est rejeté par défaut, et le code deviendrait irrécupérable. <c>?</c>,
    /// <c>#</c> et <c>&amp;</c> cassent l'URL côté client. Les guillemets et chevrons sont
    /// exclus par prudence : ces valeurs sont réimprimées sur des étiquettes.
    /// </para>
    /// </summary>
    private const string Code128AllowedPunctuation = "-._ ";

    public string Value { get; }

    /// <summary>8, 12, 13, 14 pour un GTIN ; de 3 à 48 pour un Code 128.</summary>
    public int Length => Value.Length;

    /// <summary>
    /// Symbologie déduite de la valeur. Jamais persistée, donc toujours cohérente avec
    /// <see cref="Value"/>, y compris après un aller-retour en base.
    /// </summary>
    public BarcodeSymbology Symbology =>
        TryClassify(Value, out var symbology, out _) ? symbology : BarcodeSymbology.Code128;

    private Barcode(string value) => Value = value;

    // Requis par EF Core. Laisse Value vide ; la sentinelle Code128 de Symbology n'est jamais
    // observée sur une instance valide, EF renseignant Value juste après.
    private Barcode() => Value = string.Empty;

    public static Result<Barcode> Create(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Result.Failure<Barcode>(Error.Validation("Barcode", "Le code-barres est obligatoire"));

        var normalized = value.Trim();

        return TryClassify(normalized, out _, out var error)
            ? Result.Success(new Barcode(normalized))
            : Result.Failure<Barcode>(error!);
    }

    /// <summary>Vrai si la chaîne est un code-barres accepté, clé de contrôle comprise.</summary>
    public static bool IsValid(string? value) => Create(value).IsSuccess;

    /// <summary>
    /// Classe une valeur déjà normalisée (sans espaces de bord), ou explique le refus.
    ///
    /// <para>
    /// Fonction unique et pure : <see cref="Create"/> et <see cref="Symbology"/> s'appuient
    /// tous deux dessus, de sorte qu'une valeur acceptée ne peut pas être classée autrement
    /// après rechargement.
    /// </para>
    /// </summary>
    private static bool TryClassify(string normalized, out BarcodeSymbology symbology, out Error? error)
    {
        symbology = BarcodeSymbology.Code128;
        error = null;

        if (string.IsNullOrEmpty(normalized))
        {
            error = Error.Validation("Barcode", "Le code-barres est obligatoire");
            return false;
        }

        if (normalized.Length > MaxLength)
        {
            error = Error.Validation("Barcode",
                $"Le code-barres ne peut pas dépasser {MaxLength} caractères (reçu : {normalized.Length})");
            return false;
        }

        if (normalized.Length < MinLength)
        {
            error = Error.Validation("Barcode",
                $"Le code-barres doit comporter au moins {MinLength} caractères (reçu : {normalized.Length})");
            return false;
        }

        if (normalized.All(char.IsAsciiDigit))
        {
            var gtin = GtinSymbologyForLength(normalized.Length);

            if (gtin is null)
            {
                // Numérique mais de longueur non-GTIN : c'est une référence, pas un GTIN.
                symbology = BarcodeSymbology.Code128;
                return true;
            }

            if (!HasValidCheckDigit(normalized))
            {
                // Message conservé mot pour mot : il est déjà connu des utilisateurs.
                error = Error.Validation("Barcode",
                    "Clé de contrôle invalide — vérifiez la saisie du code-barres");
                return false;
            }

            symbology = gtin.Value;
            return true;
        }

        if (!normalized.All(IsCode128Character))
        {
            error = Error.Validation("Barcode",
                "Le code-barres ne peut contenir que des lettres, des chiffres, et les signes - . _");
            return false;
        }

        symbology = BarcodeSymbology.Code128;
        return true;
    }

    private static BarcodeSymbology? GtinSymbologyForLength(int length) => length switch
    {
        8 => BarcodeSymbology.Ean8,
        12 => BarcodeSymbology.UpcA,
        13 => BarcodeSymbology.Ean13,
        14 => BarcodeSymbology.Gtin14,
        _ => null
    };

    private static bool IsCode128Character(char c) =>
        char.IsAsciiLetterOrDigit(c) || Code128AllowedPunctuation.Contains(c);

    /// <summary>
    /// Vérifie la clé de contrôle GTIN : somme pondérée 3/1 en partant de la droite, le
    /// dernier chiffre devant compléter à la dizaine supérieure. Valable pour 8, 12, 13 et 14
    /// chiffres — l'alternance des poids se cale sur la droite, pas sur la longueur.
    /// </summary>
    public static bool HasValidCheckDigit(string digits)
    {
        if (string.IsNullOrEmpty(digits) || !digits.All(char.IsAsciiDigit))
            return false;

        var sum = 0;
        // On parcourt de l'avant-dernier chiffre vers le premier ; le poids alterne 3, 1, 3, 1…
        for (int i = digits.Length - 2, weight = 3; i >= 0; i--, weight = weight == 3 ? 1 : 3)
            sum += (digits[i] - '0') * weight;

        var expected = (10 - (sum % 10)) % 10;
        return expected == digits[^1] - '0';
    }

    /// <summary>
    /// Calcule la clé de contrôle d'un code partiel et renvoie le GTIN complet. Sert à générer
    /// un code-barres interne valide pour un article sans code fournisseur.
    ///
    /// <para>
    /// Longueurs acceptées : 7 (→ EAN-8), 11 (→ UPC-A), 12 (→ EAN-13), 13 (→ GTIN-14).
    /// </para>
    /// </summary>
    public static Result<Barcode> FromBody(string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return Result.Failure<Barcode>(Error.Validation("Barcode", "Le corps du code-barres est obligatoire"));

        var normalized = body.Trim();

        if (!normalized.All(char.IsAsciiDigit))
            return Result.Failure<Barcode>(Error.Validation("Barcode", "Le corps ne doit contenir que des chiffres"));

        if (GtinSymbologyForLength(normalized.Length + 1) is null)
            return Result.Failure<Barcode>(Error.Validation("Barcode",
                "Le corps doit comporter 7 chiffres (EAN-8), 11 (UPC-A), 12 (EAN-13) ou 13 (GTIN-14)"));

        var sum = 0;
        for (int i = normalized.Length - 1, weight = 3; i >= 0; i--, weight = weight == 3 ? 1 : 3)
            sum += (normalized[i] - '0') * weight;

        var check = (10 - (sum % 10)) % 10;
        return Create(normalized + check);
    }

    public override string ToString() => Value;

    protected override IEnumerable<object> GetEqualityComponents()
    {
        // La symbologie est dérivée : l'inclure ne changerait rien, et l'omettre garantit que
        // le contrat d'égalité reste exactement celui d'avant l'extension.
        yield return Value;
    }

    public static implicit operator string(Barcode barcode) => barcode.Value;
}
