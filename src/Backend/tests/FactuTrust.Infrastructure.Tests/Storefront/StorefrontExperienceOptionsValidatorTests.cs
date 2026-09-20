using FactuTrust.Application.Configuration;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Storefront;

public sealed class StorefrontExperienceOptionsValidatorTests
{
    private readonly StorefrontExperienceOptionsValidator _validator = new();

    [Fact]
    public void Defaults_are_valid_list_with_proposed_fifty_second_lease()
    {
        var options = new StorefrontExperienceOptions();
        Assert.True(_validator.Validate(null, options).Succeeded);
        Assert.Equal("list", options.Mode);
        Assert.Equal(1, options.SchemaVersion);
        Assert.Null(options.CatalogVersion);
        Assert.Equal(50, options.LeaseSeconds);
    }

    [Theory]
    [InlineData("list", null)]
    [InlineData("legacy", null)]
    [InlineData("catalog-v2", "v2.2026-09-17")]
    [InlineData("catalog-v2", "v4-pilots-r1")]
    public void Supported_modes_obey_their_catalog_rule(string mode, string? catalog)
    {
        Assert.True(_validator.Validate(null, new() { Mode = mode, CatalogVersion = catalog }).Succeeded);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("List")]
    [InlineData("legacy ")]
    [InlineData("immersive")]
    public void Unknown_modes_fail(string? mode)
    {
        Assert.True(_validator.Validate(null, new() { Mode = mode! }).Failed);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(-1)]
    public void Unknown_schema_fails(int schema)
    {
        Assert.True(_validator.Validate(null, new() { SchemaVersion = schema }).Failed);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData(" cfg-1")]
    [InlineData("cfg-1 ")]
    [InlineData("cfg\n1")]
    [InlineData("cfg\01")]
    public void Revision_is_required_and_not_silently_normalized(string? revision)
    {
        Assert.True(_validator.Validate(null, new() { ConfigRevision = revision! }).Failed);
    }

    [Theory]
    [InlineData(128, true)]
    [InlineData(129, false)]
    public void Revision_length_is_bounded(int length, bool valid)
    {
        Assert.Equal(valid, _validator.Validate(null, new() { ConfigRevision = new string('r', length) }).Succeeded);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("../v2")]
    [InlineData("v2..1")]
    [InlineData("v2/1")]
    [InlineData("v2\\1")]
    [InlineData("v2%2f1")]
    [InlineData("v2?1")]
    [InlineData("v2#1")]
    [InlineData(".v2")]
    [InlineData("v2é")]
    [InlineData("v2\n")]
    public void Catalog_requires_a_safe_immutable_token(string? catalog)
    {
        Assert.True(_validator.Validate(null, new() { Mode = "catalog-v2", CatalogVersion = catalog }).Failed);
    }

    [Theory]
    [InlineData(64, true)]
    [InlineData(65, false)]
    public void Catalog_token_length_matches_L0(int length, bool valid)
    {
        Assert.Equal(valid, _validator.Validate(null, new()
        {
            Mode = "catalog-v2", CatalogVersion = new string('v', length)
        }).Succeeded);
    }

    [Theory]
    [InlineData("list")]
    [InlineData("legacy")]
    public void Non_catalog_modes_require_null_not_empty_catalog(string mode)
    {
        Assert.True(_validator.Validate(null, new() { Mode = mode, CatalogVersion = "" }).Failed);
        Assert.True(_validator.Validate(null, new() { Mode = mode, CatalogVersion = "v2.1" }).Failed);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(-1, false)]
    [InlineData(0.5, true)]
    [InlineData(50, true)]
    [InlineData(60, true)]
    [InlineData(60.001, false)]
    [InlineData(double.NaN, false)]
    [InlineData(double.PositiveInfinity, false)]
    [InlineData(double.NegativeInfinity, false)]
    public void Lease_matches_the_finite_positive_L0_bound(double lease, bool valid)
    {
        Assert.Equal(valid, _validator.Validate(null, new() { LeaseSeconds = lease }).Succeeded);
    }
}
