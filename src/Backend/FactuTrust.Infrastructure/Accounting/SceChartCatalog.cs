using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FactuTrust.Infrastructure.Accounting;

/// <summary>
/// Catalogue NCT 01 + overlay métier, chargé depuis la ressource embarquée
/// <c>Resources/Accounting/nct01-coa-catalog.json</c>.
/// </summary>
public static class SceChartCatalog
{
    public const string Version = "nct01-v1";
    public const string CatalogResourceName = "FactuTrust.Infrastructure.Resources.Accounting.nct01-coa-catalog.json";
    public const string RemapResourceName = "FactuTrust.Infrastructure.Resources.Accounting.coa-remap-v1.json";

    /// <summary>
    /// Empreinte du catalogue <b>embarqué</b>, calculée une fois sur ses octets.
    /// </summary>
    /// <remarks>
    /// <see cref="Version"/> est une constante : une base estampillée avec elle ne reverrait jamais
    /// le catalogue, même après une correction de libellé ou l'ajout d'un compte. L'empreinte rend
    /// l'idempotence sensible au <b>contenu</b> : elle est stockée à côté de la version de remap et
    /// déclenche une resynchronisation (non destructive) quand elle diffère.
    /// </remarks>
    public static string CatalogHash => LazyCatalogHash.Value;

    private static readonly Lazy<string> LazyCatalogHash = new(() =>
    {
        var assembly = typeof(SceChartCatalog).Assembly;
        using var stream = assembly.GetManifestResourceStream(CatalogResourceName)
            ?? throw new InvalidOperationException($"Ressource embarquée introuvable : {CatalogResourceName}.");
        return Convert.ToHexString(SHA256.HashData(stream))[..16].ToLowerInvariant();
    });

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip
    };

    public static IReadOnlyList<SceChartAccount> LoadAccounts()
    {
        var dto = Deserialize<CatalogDto>(CatalogResourceName);
        return dto.Accounts
            .Select(a => new SceChartAccount(
                a.Number,
                a.Label,
                a.AccountClass,
                string.IsNullOrWhiteSpace(a.Parent) ? null : a.Parent,
                a.NatureType,
                a.Level,
                a.IsSystem,
                a.Layer ?? "nct01"))
            .ToList();
    }

    public static CoaRemapTable LoadRemap()
    {
        var dto = Deserialize<RemapDto>(RemapResourceName);
        var entries = dto.Entries
            .Select(e => new CoaRemapEntry(e.From, e.To, e.Mode, e.Prefix, e.Reason))
            .ToList();
        return new CoaRemapTable(dto.Version, dto.ProtectedPrefixes ?? [], entries);
    }

    private static T Deserialize<T>(string resourceName)
    {
        var assembly = typeof(SceChartCatalog).Assembly;
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Ressource embarquée introuvable : {resourceName}. "
                + $"Ressources : {string.Join(", ", assembly.GetManifestResourceNames())}");
        return JsonSerializer.Deserialize<T>(stream, JsonOptions)
            ?? throw new InvalidOperationException($"JSON vide : {resourceName}");
    }

    private sealed class CatalogDto
    {
        public string Version { get; set; } = "";
        public List<AccountDto> Accounts { get; set; } = [];
    }

    private sealed class AccountDto
    {
        public string Number { get; set; } = "";
        public string Label { get; set; } = "";
        public int AccountClass { get; set; }
        public string? Parent { get; set; }
        public int NatureType { get; set; }
        public int Level { get; set; }
        public bool IsSystem { get; set; }
        public string? Layer { get; set; }
    }

    private sealed class RemapDto
    {
        public string Version { get; set; } = "";
        public List<string> ProtectedPrefixes { get; set; } = [];
        public List<EntryDto> Entries { get; set; } = [];
    }

    private sealed class EntryDto
    {
        [JsonPropertyName("from")]
        public string From { get; set; } = "";
        [JsonPropertyName("to")]
        public string? To { get; set; }
        public string Mode { get; set; } = "move";
        public bool Prefix { get; set; } = true;
        public string Reason { get; set; } = "";
    }
}
