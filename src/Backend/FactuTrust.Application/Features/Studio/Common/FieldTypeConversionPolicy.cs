using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Common;

/// <summary>
/// Résultat de <see cref="FieldTypeConversionPolicy.Classify"/> : la conversion préserve les valeurs
/// existantes (<see cref="Lossless"/>), exige une table vide car la sémantique change (<see cref="RequiresEmptyTable"/>),
/// ou n'est jamais autorisée (<see cref="Forbidden"/>).
/// </summary>
public enum FieldTypeConversion
{
    Lossless = 0,
    RequiresEmptyTable = 1,
    Forbidden = 2
}

/// <summary>
/// PR 3.1 — Point de vérité UNIQUE pour le changement de type d'un champ Studio (matrice D4),
/// partagé par <c>ChangeCustomFieldTypeCommand</c>/<c>PATCH …/fields/{id}/type</c>,
/// <c>GET …/type-check</c> et (PR 3.1b) l'outil IA <c>change_field_type</c>. Aucune réécriture de
/// <c>CustomRecord.DataJson</c> n'est jamais nécessaire : une conversion <see cref="RequiresEmptyTable"/>
/// n'est acceptée que sur une table vide, et la lecture existante tolère déjà les valeurs (TRY_CONVERT /
/// parsing tolérant) pour les conversions <see cref="Lossless"/>.
/// </summary>
public static class FieldTypeConversionPolicy
{
    /// <summary>
    /// Types qui se créent toujours comme un NOUVEAU champ (calculés/lus à la volée, ou immuables après
    /// création) : ils ne peuvent jamais être la CIBLE d'un changement de type (règle D4 n°2).
    /// </summary>
    private static readonly IReadOnlySet<CustomFieldType> CreateOnlyTargetTypes = new HashSet<CustomFieldType>
    {
        CustomFieldType.Formula,
        CustomFieldType.Lookup,
        CustomFieldType.Rollup,
        CustomFieldType.Attachment,
        CustomFieldType.Signature,
        CustomFieldType.AutoNumber
    };

    /// <summary>
    /// Types dont un champ EXISTANT ne peut jamais changer de type (règle D4 n°3) : la valeur stockée
    /// (fichier, expression, agrégat…) n'a pas d'équivalent dans un autre type.
    /// </summary>
    private static readonly IReadOnlySet<CustomFieldType> ImmutableSourceTypes = new HashSet<CustomFieldType>
    {
        CustomFieldType.Attachment,
        CustomFieldType.Signature,
        CustomFieldType.Formula,
        CustomFieldType.Lookup,
        CustomFieldType.Rollup
    };

    private static readonly IReadOnlySet<CustomFieldType> RelationTypes = new HashSet<CustomFieldType>
    {
        CustomFieldType.RelationCustom,
        CustomFieldType.RelationExisting
    };

    /// <summary>Decimal/Money/Percentage : trois représentations décimales interconvertibles sans perte.</summary>
    private static readonly IReadOnlySet<CustomFieldType> DecimalLike = new HashSet<CustomFieldType>
    {
        CustomFieldType.Decimal,
        CustomFieldType.Money,
        CustomFieldType.Percentage
    };

    /// <summary>Text/MultilineText/QrCode/Barcode : quatre représentations texte interconvertibles sans perte.</summary>
    private static readonly IReadOnlySet<CustomFieldType> TextLike = new HashSet<CustomFieldType>
    {
        CustomFieldType.Text,
        CustomFieldType.MultilineText,
        CustomFieldType.QrCode,
        CustomFieldType.Barcode
    };

    /// <summary>
    /// Tout type dont la valeur se sérialise trivialement en texte (règle D4 n°5) — cible Text ou
    /// MultilineText toujours Lossless, quel que soit l'affichage perdu (R11).
    /// </summary>
    private static readonly IReadOnlySet<CustomFieldType> TextConvertibleSources = new HashSet<CustomFieldType>
    {
        CustomFieldType.Text, CustomFieldType.MultilineText, CustomFieldType.Number, CustomFieldType.Decimal,
        CustomFieldType.Boolean, CustomFieldType.Date, CustomFieldType.DateTime, CustomFieldType.Select,
        CustomFieldType.MultiSelect, CustomFieldType.Money, CustomFieldType.Percentage, CustomFieldType.Rating,
        CustomFieldType.QrCode, CustomFieldType.Barcode, CustomFieldType.AutoNumber
    };

    /// <summary>
    /// Types pour lesquels <c>IsUnique</c> a un sens (index/contrainte applicative) — un champ unique qui
    /// change vers un type absent de cet ensemble perd automatiquement son unicité (PR 3.1).
    /// </summary>
    public static readonly IReadOnlySet<CustomFieldType> UniqueCapable = new HashSet<CustomFieldType>
    {
        CustomFieldType.Text, CustomFieldType.Number, CustomFieldType.Decimal, CustomFieldType.Money,
        CustomFieldType.Date, CustomFieldType.DateTime, CustomFieldType.Select, CustomFieldType.QrCode,
        CustomFieldType.Barcode, CustomFieldType.AutoNumber, CustomFieldType.RelationCustom, CustomFieldType.RelationExisting
    };

    /// <summary>
    /// Classe la conversion <paramref name="from"/> → <paramref name="to"/> selon la matrice D4,
    /// évaluée STRICTEMENT dans cet ordre (deny-by-default en dernier recours — voir règle 7).
    /// </summary>
    public static FieldTypeConversion Classify(CustomFieldType from, CustomFieldType to)
    {
        // 1. Même type : rien à faire, jamais autorisé (l'appelant doit détecter le no-op avant d'appeler).
        if (from == to)
            return FieldTypeConversion.Forbidden;

        // 2. La cible est un type qui se crée comme un nouveau champ.
        if (CreateOnlyTargetTypes.Contains(to))
            return FieldTypeConversion.Forbidden;

        // 3. La source ne peut jamais changer de type.
        if (ImmutableSourceTypes.Contains(from))
            return FieldTypeConversion.Forbidden;

        // 4. Relations : uniquement interconvertibles entre elles (table vide requise), jamais vers un scalaire.
        if (RelationTypes.Contains(from))
            return RelationTypes.Contains(to) ? FieldTypeConversion.RequiresEmptyTable : FieldTypeConversion.Forbidden;

        // 5. Sans perte.
        if (IsLossless(from, to))
            return FieldTypeConversion.Lossless;

        // 6. Exige une table vide (changement de sémantique de la valeur).
        if (IsRequiresEmptyTable(from, to))
            return FieldTypeConversion.RequiresEmptyTable;

        // 7. Deny-by-default : toute paire non explicitement listée est interdite.
        return FieldTypeConversion.Forbidden;
    }

    private static bool IsLossless(CustomFieldType from, CustomFieldType to)
    {
        // Tout scalaire → Text | MultilineText (R11 : Date → Text, Select → Text inclus).
        if (TextConvertibleSources.Contains(from) && (to == CustomFieldType.Text || to == CustomFieldType.MultilineText))
            return true;

        // Number → Decimal | Money | Percentage.
        if (from == CustomFieldType.Number && DecimalLike.Contains(to))
            return true;

        // Decimal ↔ Money ↔ Percentage.
        if (DecimalLike.Contains(from) && DecimalLike.Contains(to))
            return true;

        // Date → DateTime.
        if (from == CustomFieldType.Date && to == CustomFieldType.DateTime)
            return true;

        // Select → MultiSelect.
        if (from == CustomFieldType.Select && to == CustomFieldType.MultiSelect)
            return true;

        // Text ↔ MultilineText ↔ QrCode ↔ Barcode.
        if (TextLike.Contains(from) && TextLike.Contains(to))
            return true;

        // Rating → Number | Decimal.
        if (from == CustomFieldType.Rating && (to == CustomFieldType.Number || to == CustomFieldType.Decimal))
            return true;

        return false;
    }

    private static bool IsRequiresEmptyTable(CustomFieldType from, CustomFieldType to)
    {
        // Text | MultilineText → Number | Decimal | Money | Percentage | Rating | Boolean | Date | DateTime | Select | MultiSelect | RelationCustom | RelationExisting.
        if ((from == CustomFieldType.Text || from == CustomFieldType.MultilineText) && to is
            CustomFieldType.Number or CustomFieldType.Decimal or CustomFieldType.Money or CustomFieldType.Percentage
            or CustomFieldType.Rating or CustomFieldType.Boolean or CustomFieldType.Date or CustomFieldType.DateTime
            or CustomFieldType.Select or CustomFieldType.MultiSelect or CustomFieldType.RelationCustom or CustomFieldType.RelationExisting)
            return true;

        // DateTime → Date.
        if (from == CustomFieldType.DateTime && to == CustomFieldType.Date)
            return true;

        // Decimal | Money | Percentage → Number | Rating.
        if (DecimalLike.Contains(from) && (to == CustomFieldType.Number || to == CustomFieldType.Rating))
            return true;

        // MultiSelect → Select.
        if (from == CustomFieldType.MultiSelect && to == CustomFieldType.Select)
            return true;

        // Number | Decimal → Boolean.
        if ((from == CustomFieldType.Number || from == CustomFieldType.Decimal) && to == CustomFieldType.Boolean)
            return true;

        // Boolean → Number.
        if (from == CustomFieldType.Boolean && to == CustomFieldType.Number)
            return true;

        return false;
    }

    /// <summary>Code snake_case stable de la politique (API, audit) — jamais localisé.</summary>
    public static string PolicyCode(FieldTypeConversion conversion) => conversion switch
    {
        FieldTypeConversion.Lossless => "lossless",
        FieldTypeConversion.RequiresEmptyTable => "requires_empty_table",
        _ => "forbidden"
    };

    /// <summary>Message FR destiné à l'utilisateur ; <paramref name="recordCount"/> n'est utile que pour RequiresEmptyTable.</summary>
    public static string Describe(CustomFieldType from, CustomFieldType to, int recordCount = 0)
    {
        var policy = Classify(from, to);
        return policy switch
        {
            FieldTypeConversion.Lossless => LosslessMessage(from, to),
            FieldTypeConversion.RequiresEmptyTable =>
                $"Ce changement exige une table vide ({recordCount} enregistrement(s)). Videz-la ou créez un nouveau champ.",
            _ => ForbiddenMessage(from, to)
        };
    }

    private static string LosslessMessage(CustomFieldType from, CustomFieldType to)
    {
        // R11 : perte de l'affichage spécialisé (calendrier, liste, QR, note…) quand on rejoint du texte brut.
        if ((to == CustomFieldType.Text || to == CustomFieldType.MultilineText)
            && from != CustomFieldType.Text && from != CustomFieldType.MultilineText)
        {
            return "Conversion sans perte : les valeurs seront conservées telles quelles, mais le champ perd son " +
                   $"affichage « {Label(from)} » (calendrier / liste).";
        }

        return $"Conversion sans perte : les valeurs seront converties vers « {Label(to)} » sans perte de données.";
    }

    private static string ForbiddenMessage(CustomFieldType from, CustomFieldType to)
    {
        if (from == to)
            return "Le champ est déjà de ce type.";

        if (CreateOnlyTargetTypes.Contains(to))
            return "Ce type se crée comme un nouveau champ : il ne peut pas remplacer un champ existant.";

        if (ImmutableSourceTypes.Contains(from))
            return $"Un champ « {Label(from)} » ne peut pas changer de type. Créez un nouveau champ.";

        return $"Conversion « {Label(from)} → {Label(to)} » non prise en charge.";
    }

    /// <summary>Libellé FR court du type, pour les messages ci-dessus (indépendant du libellé de l'atelier IA).</summary>
    private static string Label(CustomFieldType type) => type switch
    {
        CustomFieldType.Text => "texte",
        CustomFieldType.MultilineText => "texte long",
        CustomFieldType.Number => "nombre",
        CustomFieldType.Decimal => "décimal",
        CustomFieldType.Boolean => "oui/non",
        CustomFieldType.Date => "date",
        CustomFieldType.DateTime => "date et heure",
        CustomFieldType.Select => "liste",
        CustomFieldType.MultiSelect => "choix multiple",
        CustomFieldType.RelationCustom => "relation",
        CustomFieldType.RelationExisting => "relation ERP",
        CustomFieldType.Money => "montant",
        CustomFieldType.Percentage => "pourcentage",
        CustomFieldType.Rating => "note",
        CustomFieldType.QrCode => "QR code",
        CustomFieldType.Barcode => "code-barres",
        CustomFieldType.AutoNumber => "numéro auto",
        CustomFieldType.Formula => "formule",
        CustomFieldType.Lookup => "recherche",
        CustomFieldType.Rollup => "agrégat",
        CustomFieldType.Attachment => "pièce jointe",
        CustomFieldType.Signature => "signature",
        _ => type.ToString().ToLowerInvariant()
    };
}
