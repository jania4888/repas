using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Application.Features.Accounting.Validators;
using FactuTrust.Domain.Enums;
using FluentValidation.TestHelper;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Plan de refonte du lettrage (Phase 1, Annexe A §3, plan §11) : règles de validation de
/// <c>GET api/accounting/lettering/lines</c> — compte obligatoire numérique (≤32 car.), bornes de
/// dates (fin ≥ début, fenêtre ≤ 732 jours), page/pageSize bornés, cohérence min/max de montant,
/// longueur de recherche, et tiers nécessitant son type.
/// </summary>
public sealed class GetLetteringLinesQueryValidatorTests
{
    private readonly GetLetteringLinesQueryValidator _validator = new();

    private static GetLetteringLinesQuery NewQuery(
        string account = "411000",
        LetteringAccountMatch accountMatch = LetteringAccountMatch.Exact,
        DateTime? from = null,
        DateTime? to = null,
        LetteringStateFilter state = LetteringStateFilter.All,
        string? journalCode = null,
        IReadOnlyList<string>? sourceCategories = null,
        Guid? thirdPartyId = null,
        ThirdPartyKind? thirdPartyKind = null,
        LetteringSideFilter side = LetteringSideFilter.All,
        decimal? minAmount = null,
        decimal? maxAmount = null,
        string? search = null,
        int page = 1,
        int pageSize = 500)
    {
        var fromDate = from ?? new DateTime(2026, 1, 1);
        var toDate = to ?? new DateTime(2026, 1, 31);
        return new GetLetteringLinesQuery(
            account,
            accountMatch,
            fromDate,
            toDate,
            state,
            journalCode,
            sourceCategories,
            thirdPartyId,
            thirdPartyKind,
            side,
            minAmount,
            maxAmount,
            search,
            page,
            pageSize);
    }

    [Fact]
    public void ValidQuery_Passes()
    {
        var result = _validator.TestValidate(NewQuery());
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void EmptyAccount_Fails()
    {
        var result = _validator.TestValidate(NewQuery(account: ""));
        result.ShouldHaveValidationErrorFor(x => x.Account);
    }

    [Fact]
    public void AccountTooLong_Fails()
    {
        var result = _validator.TestValidate(NewQuery(account: new string('4', 33)));
        result.ShouldHaveValidationErrorFor(x => x.Account);
    }

    [Fact]
    public void AccountAt32Chars_Passes()
    {
        var result = _validator.TestValidate(NewQuery(account: new string('4', 32)));
        result.ShouldNotHaveValidationErrorFor(x => x.Account);
    }

    [Fact]
    public void AccountWithLetters_Fails()
    {
        var result = _validator.TestValidate(NewQuery(account: "411ABC"));
        result.ShouldHaveValidationErrorFor(x => x.Account);
    }

    /// <summary>
    /// Bornes de période OBLIGATOIRES (revue PR 1, 2e passe) : un <c>DateTime</c> non renseigné
    /// (defaut, liaison de requête absente) balaierait tout l'historique du compte.
    /// </summary>
    [Fact]
    public void MissingFrom_Fails()
    {
        var result = _validator.TestValidate(NewQuery(from: new DateTime()));
        result.ShouldHaveValidationErrorFor(x => x.From);
    }

    [Fact]
    public void MissingTo_Fails()
    {
        var result = _validator.TestValidate(NewQuery(to: new DateTime()));
        result.ShouldHaveValidationErrorFor(x => x.To);
    }

    [Fact]
    public void ToBeforeFrom_Fails()
    {
        var result = _validator.TestValidate(NewQuery(from: new DateTime(2026, 2, 1), to: new DateTime(2026, 1, 1)));
        result.ShouldHaveValidationErrorFor(x => x.To);
    }

    [Fact]
    public void ToEqualsFrom_Passes()
    {
        var day = new DateTime(2026, 1, 15);
        var result = _validator.TestValidate(NewQuery(from: day, to: day));
        result.ShouldNotHaveValidationErrorFor(x => x.To);
    }

    [Fact]
    public void WindowOver732Days_Fails()
    {
        var from = new DateTime(2024, 1, 1);
        var to = from.AddDays(733);
        var result = _validator.TestValidate(NewQuery(from: from, to: to));
        Assert.Contains(result.Errors, e => e.ErrorMessage.Contains("732"));
    }

    [Fact]
    public void WindowAt732Days_Passes()
    {
        var from = new DateTime(2024, 1, 1);
        var to = from.AddDays(732);
        var result = _validator.TestValidate(NewQuery(from: from, to: to));
        Assert.DoesNotContain(result.Errors, e => e.ErrorMessage.Contains("732"));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2001)]
    public void PageSize_OutOfBounds_Fails(int pageSize)
    {
        var result = _validator.TestValidate(NewQuery(pageSize: pageSize));
        result.ShouldHaveValidationErrorFor(x => x.PageSize);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2000)]
    public void PageSize_AtBounds_Passes(int pageSize)
    {
        var result = _validator.TestValidate(NewQuery(pageSize: pageSize));
        result.ShouldNotHaveValidationErrorFor(x => x.PageSize);
    }

    [Fact]
    public void Page_ZeroOrNegative_Fails()
    {
        var result = _validator.TestValidate(NewQuery(page: 0));
        result.ShouldHaveValidationErrorFor(x => x.Page);
    }

    [Fact]
    public void MinAmountGreaterThanMaxAmount_Fails()
    {
        var result = _validator.TestValidate(NewQuery(minAmount: 100m, maxAmount: 50m));
        Assert.Contains(result.Errors, e => e.ErrorMessage.Contains("montant minimum"));
    }

    [Fact]
    public void MinAmountEqualsMaxAmount_Passes()
    {
        var result = _validator.TestValidate(NewQuery(minAmount: 100m, maxAmount: 100m));
        Assert.DoesNotContain(result.Errors, e => e.ErrorMessage.Contains("montant minimum"));
    }

    [Fact]
    public void SearchTooLong_Fails()
    {
        var result = _validator.TestValidate(NewQuery(search: new string('a', 101)));
        result.ShouldHaveValidationErrorFor(x => x.Search);
    }

    [Fact]
    public void SearchAt100Chars_Passes()
    {
        var result = _validator.TestValidate(NewQuery(search: new string('a', 100)));
        result.ShouldNotHaveValidationErrorFor(x => x.Search);
    }

    [Fact]
    public void ThirdPartyId_WithoutKind_Fails()
    {
        var result = _validator.TestValidate(NewQuery(thirdPartyId: Guid.NewGuid(), thirdPartyKind: null));
        Assert.Contains(result.Errors, e => e.ErrorMessage.Contains("type de tiers"));
    }

    [Fact]
    public void ThirdPartyId_WithKind_Passes()
    {
        var result = _validator.TestValidate(NewQuery(thirdPartyId: Guid.NewGuid(), thirdPartyKind: ThirdPartyKind.Client));
        Assert.DoesNotContain(result.Errors, e => e.ErrorMessage.Contains("type de tiers"));
    }
}
