using FactuTrust.Infrastructure.Accounting;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Accounting;

public sealed class SceChartCatalogTests
{
    [Fact]
    public void LoadAccounts_ContainsFullNct01PlusOverlay()
    {
        var accounts = SceChartCatalog.LoadAccounts();
        var byNumber = accounts.ToDictionary(a => a.Number, StringComparer.Ordinal);

        Assert.True(accounts.Count >= 600, $"Catalogue trop court : {accounts.Count}");
        Assert.Equal(SceChartCatalog.Version, "nct01-v1");

        foreach (var required in new[] { "603", "6031", "6032", "6037", "79", "7865", "7866", "7868" })
            Assert.True(byNumber.ContainsKey(required), $"Compte NCT manquant : {required}");

        Assert.False(byNumber.ContainsKey("4477"));
        Assert.True(byNumber.ContainsKey("43652"));
        Assert.Equal("4365", byNumber["43652"].Parent);
        Assert.True(byNumber.ContainsKey("4371"));
        Assert.Equal("437", byNumber["4371"].Parent);
        Assert.True(byNumber.ContainsKey("641"));
        foreach (var rs in new[] { "4320", "4321", "4322", "4323", "4324", "4325", "4326", "4327" })
        {
            Assert.True(byNumber.ContainsKey(rs), rs);
            Assert.Equal("432", byNumber[rs].Parent);
        }

        Assert.StartsWith("4365", byNumber["43651"].Number);
        Assert.Equal("21", byNumber["21"].Number);
        Assert.Contains("incorporelles", byNumber["21"].Label, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("corporelles", byNumber["22"].Label, StringComparison.OrdinalIgnoreCase);

        foreach (var posting in new[] { "43652", "4371", "6654", "228", "413", "425", "421.1", "641", "603" })
            Assert.True(byNumber.ContainsKey(posting), $"Compte de posting absent du catalogue : {posting}");
    }

    /// <summary>
    /// L'empreinte du catalogue est ce qui rend l'idempotence sensible au CONTENU : une base
    /// estampillée avec la seule constante <c>nct01-v1</c> ne reverrait jamais un catalogue corrigé.
    /// </summary>
    [Fact]
    public void CatalogHash_IsStable_AndMatchesTheEmbeddedResourceBytes()
    {
        var hash = SceChartCatalog.CatalogHash;

        Assert.False(string.IsNullOrWhiteSpace(hash));
        Assert.Equal(16, hash.Length);
        Assert.Matches("^[0-9a-f]{16}$", hash);
        Assert.Equal(hash, SceChartCatalog.CatalogHash);

        using var stream = typeof(SceChartCatalog).Assembly
            .GetManifestResourceStream(SceChartCatalog.CatalogResourceName)!;
        var expected = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stream))[..16]
            .ToLowerInvariant();

        Assert.Equal(expected, hash);
    }

    [Fact]
    public void CatalogAndRemapShareTheSameMapVersion()
    {
        Assert.Equal("nct01-v1", SceChartCatalog.Version);
        Assert.Equal(SceChartCatalog.Version, SceChartCatalog.LoadRemap().Version);
        Assert.Equal(SceChartCatalog.Version, Nct01ChartMigrationService.MapVersion);
    }

    [Fact]
    public void LoadAccounts_EveryChildStartsWithItsParent()
    {
        var accounts = SceChartCatalog.LoadAccounts();
        foreach (var account in accounts.Where(a => !string.IsNullOrWhiteSpace(a.Parent)))
        {
            Assert.StartsWith(account.Parent!, account.Number, StringComparison.Ordinal);
            Assert.InRange(account.AccountClass, 1, 7);
            Assert.InRange(account.NatureType, 0, 1);
        }

        Assert.Equal(accounts.Count, accounts.Select(a => a.Number).Distinct(StringComparer.Ordinal).Count());
    }
}
