using System.Text.RegularExpressions;

namespace FactuTrust.Application.Features.Studio.Common;

/// <summary>
/// Validation and sanitization for Studio machine names (entity/field/form/report keys).
/// Keys are never injected into SQL identifiers (no runtime DDL), but they are URL/JSON keys,
/// so we still constrain them to a safe shape and block reserved names.
/// </summary>
public static partial class StudioKey
{
    public const int MaxLength = 64;

    /// <summary>Reserved field keys that collide with persistence/audit columns or framework concepts.</summary>
    public static readonly IReadOnlySet<string> ReservedFieldKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "id", "tenantid", "tenant_id", "entitydefinitionid", "entity_definition_id",
        "rowversion", "row_version", "isdeleted", "is_deleted", "deletedat", "deleted_at",
        "createdat", "created_at", "updatedat", "updated_at", "createdby", "created_by",
        "updatedby", "updated_by", "datajson", "data_json"
    };

    /// <summary>
    /// Reserved system keys: route literals under <c>api/studio/systems/</c> that would otherwise
    /// shadow a system (e.g. <c>POST api/studio/systems/import</c>, PR 3.3).
    /// </summary>
    public static readonly IReadOnlySet<string> ReservedSystemKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "import"
    };

    [GeneratedRegex("^[a-z][a-z0-9_]{1,63}$")]
    private static partial Regex KeyPattern();

    public static bool IsValidShape(string? key) =>
        !string.IsNullOrWhiteSpace(key) && KeyPattern().IsMatch(key);

    public static bool IsReservedFieldKey(string key) => ReservedFieldKeys.Contains(key);

    public static bool IsReservedSystemKey(string key) => ReservedSystemKeys.Contains(key);

    /// <summary>
    /// Normalizes a free-text label into a candidate key (lowercase, non-alnum → underscore).
    /// Callers should still validate the result with <see cref="IsValidShape"/>.
    /// </summary>
    public static string Slugify(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return string.Empty;
        var lowered = input.Trim().ToLowerInvariant();
        var slug = NonAlnum().Replace(lowered, "_").Trim('_');
        if (slug.Length == 0) return string.Empty;
        if (!char.IsLetter(slug[0])) slug = "f_" + slug;
        return slug.Length > MaxLength ? slug[..MaxLength] : slug;
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlnum();
}
