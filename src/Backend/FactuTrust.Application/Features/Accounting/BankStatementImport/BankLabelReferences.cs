using System.Text.RegularExpressions;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Référence d'une opération lue dans son libellé : numéro de chèque ou d'effet. Sert de
/// <c>Reference</c> à la ligne de relevé, de <c>PieceRef</c> à l'écriture générée, et de clé pour
/// reconnaître un paiement déjà saisi dans InstaFact (même numéro de chèque / d'effet).
/// </summary>
public static partial class BankLabelReferences
{
    public enum ReferenceKind
    {
        None = 0,
        Cheque = 1,
        Effet = 2
    }

    public sealed record Reference(ReferenceKind Kind, string Number);

    public static Reference? Extract(string? label)
    {
        if (string.IsNullOrWhiteSpace(label))
            return null;

        var normalized = BankLabelNormalizer.Normalize(label);

        var effet = EffetRegex().Match(normalized);
        if (effet.Success)
            return new Reference(ReferenceKind.Effet, effet.Groups["n"].Value);

        var cheque = ChequeRegex().Match(normalized);
        if (cheque.Success)
            return new Reference(ReferenceKind.Cheque, cheque.Groups["n"].Value);

        return null;
    }

    /// <summary>Numéro sans zéros de tête, pour comparer « 0001234 » et « 1234 ».</summary>
    public static string Canonical(string number) => number.TrimStart('0') is { Length: > 0 } trimmed ? trimmed : "0";

    // « EFF N° 011220000001 », « REGLEMENT EFFET N°010860000002 », « PAIEMENT EFFET 011080000003 »,
    // « REGLEMENT EFFET 011126708592 », « COM ET TVA 011190155710 » n'est PAS un effet (pas de mot EFFET).
    [GeneratedRegex(@"\bEFF(?:ET)?\b\s*(?:EFF\s*)?(?:N\s*°|N°|NO|N)?\s*(?<n>\d{6,})", RegexOptions.CultureInvariant)]
    private static partial Regex EffetRegex();

    // « RÈG CHÈQUE N° 0001234 », « ENCAISSEMENT CHÈQUE N°0004321 », « PAIEMENT CHQ 0000777 »,
    // « REGLEMENT CHEQUE N 101 », « CERTIF CHEQUE CLIENTELE 0002844 ».
    [GeneratedRegex(@"\b(?:CHEQUE|CHQ)\b(?:\s+CLIENTELE)?\s*(?:N\s*°|N°|NO|N)?\s*(?<n>\d{3,})", RegexOptions.CultureInvariant)]
    private static partial Regex ChequeRegex();
}
