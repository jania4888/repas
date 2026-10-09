namespace FactuTrust.Domain.Banking;

/// <summary>
/// Déduit un code du catalogue tunisien (BIAT, STB, …) depuis le code demandé ou le libellé du plan.
/// </summary>
public static class BankGlBankCodeResolver
{
    public static string Resolve(string? requestedCode, string? label)
    {
        var explicitBank = TunisianBankCatalog.FindByCode(requestedCode);
        if (explicitBank is not null)
            return explicitBank.Code;

        var haystack = label?.Trim() ?? string.Empty;
        if (haystack.Length == 0)
            return "AUTRE";

        foreach (var bank in TunisianBankCatalog.Banks)
        {
            if (string.Equals(bank.Code, "AUTRE", StringComparison.OrdinalIgnoreCase))
                continue;
            if (haystack.Contains(bank.Code, StringComparison.OrdinalIgnoreCase))
                return bank.Code;
            if (haystack.Contains(bank.Name, StringComparison.OrdinalIgnoreCase))
                return bank.Code;
        }

        return "AUTRE";
    }
}
