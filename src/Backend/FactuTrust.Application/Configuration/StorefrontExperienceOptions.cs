namespace FactuTrust.Application.Configuration;

/// <summary>
/// Dedicated, non-sensitive 3D configuration. This does not replace StorefrontOptions.Enabled.
/// Immutable so a validated snapshot cannot change after admission. Not registered in DI yet.
/// </summary>
public sealed record StorefrontExperienceOptions
{
    public const int SupportedSchemaVersion = 1;
    public const double MaximumLeaseSeconds = 60;
    public const double ProposedLeaseSeconds = 50;
    public const int MaximumConfigRevisionLength = 128;
    public const int MaximumCatalogVersionLength = 64;

    public int SchemaVersion { get; init; } = SupportedSchemaVersion;
    public string ConfigRevision { get; init; } = "unavailable";
    public string Mode { get; init; } = "list";
    public string? CatalogVersion { get; init; }

    // L0 allows fractional seconds; do not silently narrow the wire contract to integers.
    public double LeaseSeconds { get; init; } = ProposedLeaseSeconds;
}
