namespace FactuTrust.Domain.Services.Accounting;

/// <summary>
/// Identifie les comptes feuille de banques (sous 5321 dinars ou 5324 devises) qui doivent
/// apparaître dans l'import de relevés. Les collectifs NCT 532 / 5321 / 5324 ne sont pas des feuilles.
/// </summary>
public static class BankGlAccountRules
{
    public const string ParentTnd = "5321";
    public const string ParentFx = "5324";

    /// <summary>Devise sentinelle d'un compte 5324 sans devise ISO : jamais TND, donc non importable.</summary>
    public const string UnspecifiedFxCurrency = "XXX";

    public static bool IsProvisionableLeaf(string? accountNumber, bool isActive) =>
        isActive && IsProvisionableLeafNumber(accountNumber);

    public static bool IsProvisionableLeafNumber(string? accountNumber)
    {
        var digits = Digits(accountNumber);
        if (digits.Length == 0)
            return false;
        if (digits is "532" or "5321" or "5324")
            return false;
        return digits.StartsWith(ParentTnd, StringComparison.Ordinal)
            || digits.StartsWith(ParentFx, StringComparison.Ordinal);
    }

    public static bool IsDinarLeaf(string? accountNumber) =>
        Digits(accountNumber).StartsWith(ParentTnd, StringComparison.Ordinal)
        && Digits(accountNumber) != ParentTnd;

    /// <summary>
    /// TND pour une feuille 5321. Pour une feuille 5324 : code ISO fourni, sauf TND (qui rendrait
    /// le compte faussement éligible à l'import dinars) — alors <see cref="UnspecifiedFxCurrency"/>.
    /// </summary>
    public static string ResolveProjectionCurrency(string? accountNumber, string? requestedCurrency)
    {
        var digits = Digits(accountNumber);
        if (digits.StartsWith(ParentTnd, StringComparison.Ordinal))
            return "TND";

        var requested = string.IsNullOrWhiteSpace(requestedCurrency)
            ? null
            : requestedCurrency.Trim().ToUpperInvariant();
        if (requested is { Length: 3 }
            && requested != "TND"
            && requested.All(static c => c is >= 'A' and <= 'Z'))
            return requested;

        return UnspecifiedFxCurrency;
    }

    public static string Digits(string? accountNumber)
    {
        if (string.IsNullOrWhiteSpace(accountNumber))
            return string.Empty;

        Span<char> buffer = stackalloc char[accountNumber.Length];
        var n = 0;
        foreach (var c in accountNumber)
        {
            if (char.IsAsciiDigit(c))
                buffer[n++] = c;
        }

        return n == 0 ? string.Empty : new string(buffer[..n]);
    }
}
