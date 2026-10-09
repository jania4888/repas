using FactuTrust.Domain.Banking;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Services.Accounting;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class BankGlAccountRulesTests
{
    [Theory]
    [InlineData("53211", true)]
    [InlineData("53210001", true)]
    [InlineData("53241", true)]
    [InlineData("5324.01", true)]
    [InlineData("532", false)]
    [InlineData("5321", false)]
    [InlineData("5324", false)]
    [InlineData("531", false)]
    [InlineData("411", false)]
    public void IsProvisionableLeafNumber_matches_bank_leaves_only(string number, bool expected)
    {
        Assert.Equal(expected, BankGlAccountRules.IsProvisionableLeafNumber(number));
    }

    [Fact]
    public void Inactive_leaf_is_not_provisionable()
    {
        Assert.False(BankGlAccountRules.IsProvisionableLeaf("53211", isActive: false));
        Assert.True(BankGlAccountRules.IsProvisionableLeaf("53211", isActive: true));
    }

    [Fact]
    public void Currency_is_tnd_for_dinars_and_xxx_for_unspecified_fx()
    {
        Assert.Equal("TND", BankGlAccountRules.ResolveProjectionCurrency("53211", "EUR"));
        Assert.Equal("EUR", BankGlAccountRules.ResolveProjectionCurrency("53241", "eur"));
        Assert.Equal(BankGlAccountRules.UnspecifiedFxCurrency, BankGlAccountRules.ResolveProjectionCurrency("53241", null));
        Assert.Equal(BankGlAccountRules.UnspecifiedFxCurrency, BankGlAccountRules.ResolveProjectionCurrency("53241", "TND"));
    }

    [Fact]
    public void Label_banque_biat_resolves_catalog_code()
    {
        Assert.Equal("BIAT", BankGlBankCodeResolver.Resolve(null, "Banque Biat"));
        Assert.Equal("AUTRE", BankGlBankCodeResolver.Resolve(null, "Caisse locale"));
        Assert.Equal("STB", BankGlBankCodeResolver.Resolve("stb", "Autre libellé"));
    }
}

public sealed class BankAccountChartProjectionTests
{
    private const string Rib = "08001000123456789012";
    private static string Iban => TunisianIban.FromRib(Rib)!;

    [Fact]
    public void Create_still_requires_rib_and_iban()
    {
        var missing = BankAccount.Create(Guid.NewGuid(), "BIAT", "BIAT", "", "");
        Assert.True(missing.IsFailure);

        var created = BankAccount.Create(Guid.NewGuid(), "BIAT", "Banque Biat", Rib, Iban);
        Assert.True(created.IsSuccess);
        Assert.True(created.Value.HasBankingIdentity);
    }

    [Fact]
    public void Projection_accepts_missing_rib_and_refuses_rib_alone()
    {
        var companyId = Guid.NewGuid();
        var created = BankAccount.CreateFromChartProjection(companyId, "53211", "Banque Biat", "BIAT", "TND", true);
        Assert.True(created.IsSuccess);
        Assert.Null(created.Value.Rib);
        Assert.Null(created.Value.Iban);
        Assert.False(created.Value.IsDefault);
        Assert.False(created.Value.HasBankingIdentity);
        Assert.Equal("TND", created.Value.Currency);
        Assert.Equal("53211", created.Value.ChartOfAccountNumber);

        var ribOnly = BankAccount.CreateFromChartProjection(companyId, "53211", "Banque Biat", "BIAT", "TND", true, rib: Rib);
        Assert.True(ribOnly.IsFailure);

        var collective = BankAccount.CreateFromChartProjection(companyId, "5321", "Comptes en dinars", "AUTRE", "TND", true);
        Assert.True(collective.IsFailure);
    }

    [Fact]
    public void Incomplete_projection_cannot_become_default()
    {
        var account = BankAccount.CreateFromChartProjection(Guid.NewGuid(), "53211", "Banque Biat", "BIAT", "TND", true).Value;
        var set = account.SetAsDefault();
        Assert.True(set.IsFailure);
        Assert.False(account.IsDefault);
        Assert.True(account.RequireCompleteIdentity().IsFailure);
    }

    [Fact]
    public void Fx_projection_without_currency_is_not_tnd()
    {
        var account = BankAccount.CreateFromChartProjection(Guid.NewGuid(), "53241", "Banque devise", "AUTRE", "", true).Value;
        Assert.Equal(BankGlAccountRules.UnspecifiedFxCurrency, account.Currency);
    }
}
