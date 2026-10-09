namespace FactuTrust.Application.DTOs;

/// <summary>Reference row for Tunisian bank dropdowns.</summary>
public sealed record TunisianBankReferenceDto
{
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public string? DefaultSwiftBic { get; init; }
}

public sealed record BankAccountDto
{
    public Guid Id { get; init; }
    public Guid CompanyId { get; init; }
    public string BankCode { get; init; } = null!;
    public string BankName { get; init; } = null!;
    public string? Designation { get; init; }
    public string? AgencyName { get; init; }
    public string Rib { get; init; } = "";
    public string Iban { get; init; } = "";
    public string? SwiftBic { get; init; }
    public bool IsDefault { get; init; }
    public bool IsActive { get; init; }
    public string? ChartOfAccountNumber { get; init; }
    public string Currency { get; init; } = "TND";
    /// <summary>RIB et IBAN tunisiens complets. Faux pour une projection issue du plan comptable.</summary>
    public bool HasBankingIdentity { get; init; }
    /// <summary>Vrai seulement sur la réponse de création quand un 532x déjà projeté a été complété.</summary>
    public bool LinkedExistingChartProjection { get; init; }
}

public sealed record CreateBankAccountRequest
{
    public string BankCode { get; init; } = null!;
    public string BankName { get; init; } = null!;
    public string Rib { get; init; } = null!;
    public string Iban { get; init; } = null!;
    public string? Designation { get; init; }
    public string? AgencyName { get; init; }
    public string? SwiftBic { get; init; }
    /// <summary>When true, this account becomes the default treasury account.</summary>
    public bool SetAsDefault { get; init; }
    /// <summary>Compte 532x existant à lier. Ignoré si <see cref="AutoCreateChartAccount"/> est true.</summary>
    public string? ChartOfAccountNumber { get; init; }
    /// <summary>Crée automatiquement un sous-compte auxiliaire 532x si aucun compte n'est fourni.</summary>
    public bool AutoCreateChartAccount { get; init; } = true;
    public string Currency { get; init; } = "TND";
}

/// <summary>Compte bancaire visible dans l'import de relevés, sans RIB ni IBAN en clair.</summary>
public sealed record ImportableBankAccountDto
{
    public Guid Id { get; init; }
    public string BankName { get; init; } = "";
    public string? Designation { get; init; }
    public string ChartOfAccountNumber { get; init; } = "";
    public string Currency { get; init; } = "TND";
    public bool IsActive { get; init; }
    public bool IsDefault { get; init; }
    public bool HasBankingIdentity { get; init; }
    public string? RibMasked { get; init; }
}

public sealed record UpdateBankAccountRequest
{
    public string BankCode { get; init; } = null!;
    public string BankName { get; init; } = null!;
    public string Rib { get; init; } = null!;
    public string Iban { get; init; } = null!;
    public string? Designation { get; init; }
    public string? AgencyName { get; init; }
    public string? SwiftBic { get; init; }
    public string? ChartOfAccountNumber { get; init; }
    public bool AutoCreateChartAccount { get; init; }
    public string Currency { get; init; } = "TND";
}
