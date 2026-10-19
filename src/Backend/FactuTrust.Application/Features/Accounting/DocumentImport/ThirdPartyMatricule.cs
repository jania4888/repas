using FactuTrust.Application.Features.AI;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Features.Accounting.DocumentImport;

/// <summary>
/// Comparaison de matricules fiscaux tunisiens, extraite — à comportement identique — de
/// <c>AccountingEntryProposalService.SameMatricule</c> (méthode privée historique) afin d'être
/// partagée avec l'import de bon de réception (<c>SupplierDocumentMatcher</c>). Un refactor
/// mécanique, sans effet de bord : voir <c>ThirdPartyMatriculeTests</c>.
/// </summary>
public static class ThirdPartyMatricule
{
    /// <summary>
    /// Même matricule si les deux côtés se canonisent vers la forme carte, sinon repli sur la
    /// comparaison alphanumérique (saisie incomplète déjà tolérée à l'import).
    /// </summary>
    public static bool SameMatricule(string? left, string? right)
    {
        if (NIF.TryCanonicalize(left, out var canonicalLeft) && NIF.TryCanonicalize(right, out var canonicalRight))
            return string.Equals(canonicalLeft, canonicalRight, StringComparison.Ordinal);

        var normalizedLeft = InvoiceImportParsing.NormalizeNif(left);
        var normalizedRight = InvoiceImportParsing.NormalizeNif(right);
        return normalizedLeft.Length > 0 && normalizedLeft == normalizedRight;
    }
}
