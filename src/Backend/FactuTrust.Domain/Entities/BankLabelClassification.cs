using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Cache de classification IA d'un libellé bancaire DISTINCT (normalisé + sens) : évite de
/// redemander à l'IA chaque mois les mêmes « COMMISSION VIREMENT REÇU… ». Le compte proposé reste
/// une suggestion « à vérifier » ; il est ignoré s'il n'est plus actif dans le plan du dossier.
/// </summary>
public sealed class BankLabelClassification : Entity
{
    public const int NormalizedLabelMaxLength = 300;

    /// <summary>SHA-256 (hexadécimal) de « libellé normalisé | D/C ».</summary>
    public string LabelHash { get; private set; } = null!;

    public string NormalizedLabel { get; private set; } = null!;
    public bool IsDebit { get; private set; }

    /// <summary>Compte proposé ; null = l'IA n'a pas su (on ne la réinterroge pas pour autant).</summary>
    public string? AccountNumber { get; private set; }

    public string ModelRef { get; private set; } = null!;

    private BankLabelClassification() { }

    public static BankLabelClassification Create(string labelHash, string normalizedLabel, bool isDebit, string? accountNumber, string modelRef)
    {
        var label = normalizedLabel ?? string.Empty;
        return new BankLabelClassification
        {
            LabelHash = labelHash,
            NormalizedLabel = label.Length > NormalizedLabelMaxLength ? label[..NormalizedLabelMaxLength] : label,
            IsDebit = isDebit,
            AccountNumber = string.IsNullOrWhiteSpace(accountNumber) ? null : accountNumber.Trim(),
            ModelRef = string.IsNullOrWhiteSpace(modelRef) ? "inconnu" : modelRef.Trim()
        };
    }
}
