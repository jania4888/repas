using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Configuration;

/// <summary>Value validation only: a valid value does not establish source health or delivery authorization.</summary>
public sealed class StorefrontExperienceOptionsValidator : IValidateOptions<StorefrontExperienceOptions>
{
    public ValidateOptionsResult Validate(string? name, StorefrontExperienceOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = new List<string>();

        if (options.SchemaVersion != StorefrontExperienceOptions.SupportedSchemaVersion)
            failures.Add("schemaVersion must be 1.");

        // Operator input is bounded and canonical; never silently trim a revision identifier.
        var revision = options.ConfigRevision;
        if (string.IsNullOrWhiteSpace(revision)
            || revision.Length > StorefrontExperienceOptions.MaximumConfigRevisionLength
            || revision != revision.Trim()
            || revision.Any(char.IsControl))
            failures.Add("configRevision must be non-empty, at most 128 characters, without controls or surrounding whitespace.");

        if (!double.IsFinite(options.LeaseSeconds)
            || options.LeaseSeconds <= 0
            || options.LeaseSeconds > StorefrontExperienceOptions.MaximumLeaseSeconds)
            failures.Add("leaseSeconds must be finite and in (0, 60].");

        if (options.Mode is not ("list" or "legacy" or "catalog-v2"))
            failures.Add("mode must be list, legacy or catalog-v2.");

        if (options.Mode == "catalog-v2")
        {
            if (!IsCatalogVersion(options.CatalogVersion))
                failures.Add("catalog-v2 requires an immutable catalogVersion token of at most 64 characters.");
        }
        else if (options.CatalogVersion is not null)
        {
            failures.Add("list and legacy require catalogVersion null.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static bool IsCatalogVersion(string? value) =>
        value is { Length: > 0 and <= StorefrontExperienceOptions.MaximumCatalogVersionLength }
        && char.IsAsciiLetterOrDigit(value[0])
        && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-')
        && !value.Contains("..", StringComparison.Ordinal);
}
