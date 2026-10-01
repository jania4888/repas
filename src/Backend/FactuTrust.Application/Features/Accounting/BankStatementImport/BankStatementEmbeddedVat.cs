using System.Globalization;
using System.Text.RegularExpressions;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// TVA incluse dans une commission bancaire, imprimée dans le libellé (Attijari) :
/// « COMMISSION VIR AUT BQ 004242 DONT TVA: 0,285 » pour un débit de 1,785
/// ⇒ commission HT 1,500 (6278) + TVA déductible 0,285 (43666).
///
/// La ventilation n'est proposée que si la TVA lue est cohérente avec le taux de 19 % appliqué
/// aux commissions bancaires (à 1 millime près) ; sinon on n'invente rien.
/// </summary>
public static partial class BankStatementEmbeddedVat
{
    public const decimal BankCommissionVatRate = 0.19m;

    public sealed record Split(decimal NetAmount, decimal VatAmount, bool RateConsistent);

    /// <summary>
    /// Lit « DONT TVA: x » dans le libellé. Retourne null si absent, si plusieurs mentions
    /// (libellé mal découpé entre deux opérations) ou si x ≥ montant.
    /// </summary>
    public static Split? TryRead(string? label, decimal amount)
    {
        if (string.IsNullOrWhiteSpace(label) || amount <= 0)
            return null;

        var matches = DontTvaRegex().Matches(label);
        if (matches.Count != 1)
            return null;

        var raw = matches[0].Groups["vat"].Value.Replace(" ", string.Empty).Replace(',', '.');
        if (!decimal.TryParse(raw, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var vat))
            return null;
        if (vat <= 0 || vat >= amount)
            return null;

        var net = amount - vat;
        var expectedVat = Math.Round(net * BankCommissionVatRate, 3, MidpointRounding.AwayFromZero);
        return new Split(net, vat, Math.Abs(expectedVat - vat) <= 0.001m);
    }

    [GeneratedRegex(@"DONT\s+T\.?V\.?A\s*:?\s*(?<vat>\d{1,6}(?:[.,]\d{1,3})?)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DontTvaRegex();
}
