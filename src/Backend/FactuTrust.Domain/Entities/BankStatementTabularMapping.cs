using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Mappage de colonnes CSV/XLSX mémorisé pour un compte bancaire (case « Mémoriser » de l'étape
/// Mappage). Une ligne par compte bancaire (<see cref="BankAccountId"/> unique). Ne porte jamais
/// les soldes saisis ni les lignes ignorées de la session qui l'a enregistré : seules les
/// positions de colonnes et les conventions de lecture sont réutilisables d'un relevé à l'autre.
/// </summary>
public sealed class BankStatementTabularMapping : Entity
{
    public const int FormatMaxLength = 10;
    public const int MappingJsonMaxLength = 4000;

    public Guid BankAccountId { get; private set; }

    /// <summary><c>csv</c> ou <c>xlsx</c> — format du fichier qui a produit ce mappage.</summary>
    public string Format { get; private set; } = null!;

    /// <summary>
    /// Sérialisation JSON de <c>BankStatementTabularMapping</c> (contrat applicatif) SANS
    /// <c>openingBalance</c>, <c>closingBalance</c> ni <c>ignoredRows</c> : propres à chaque fichier,
    /// jamais réutilisables.
    /// </summary>
    public string MappingJson { get; private set; } = null!;

    private BankStatementTabularMapping() { }

    public static BankStatementTabularMapping Create(Guid bankAccountId, string format, string mappingJson)
    {
        if (bankAccountId == Guid.Empty)
            throw new ArgumentException("Compte bancaire requis.", nameof(bankAccountId));

        var mapping = new BankStatementTabularMapping { BankAccountId = bankAccountId };
        mapping.Update(format, mappingJson);
        return mapping;
    }

    public void Update(string format, string mappingJson)
    {
        var normalizedFormat = format?.Trim().ToLowerInvariant() ?? string.Empty;
        if (string.IsNullOrEmpty(normalizedFormat) || normalizedFormat.Length > FormatMaxLength)
            throw new ArgumentException("Format invalide.", nameof(format));
        if (string.IsNullOrWhiteSpace(mappingJson))
            throw new ArgumentException("Mappage requis.", nameof(mappingJson));
        if (mappingJson.Length > MappingJsonMaxLength)
            throw new ArgumentException($"Le mappage dépasse {MappingJsonMaxLength} caractères.", nameof(mappingJson));

        Format = normalizedFormat;
        MappingJson = mappingJson;
    }
}
