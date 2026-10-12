using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Application.Features.Accounting.Validators;
using FactuTrust.Domain.Common;
using FluentValidation.TestHelper;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Plan v2, Phase 3 (p3-10) : validation et handler de <c>GET api/accounting/lettering/suggestions</c>.
/// Le filtre suit exactement les règles de <c>lettering/lines</c> ; le drapeau éteint arrête tout
/// avant le service.
/// </summary>
public sealed class GetLetteringSuggestionsQueryTests
{
    private readonly GetLetteringSuggestionsQueryValidator _validator = new();

    private static GetLetteringLinesQuery Filter(
        string account = "411000", DateTime? from = null, DateTime? to = null,
        Guid? thirdPartyId = null, decimal? minAmount = null, decimal? maxAmount = null) =>
        new(account, LetteringAccountMatch.Exact, from ?? new DateTime(2026, 1, 1), to ?? new DateTime(2026, 12, 31),
            LetteringStateFilter.Unlettered, null, null, thirdPartyId, null, LetteringSideFilter.All,
            minAmount, maxAmount, null);

    [Fact]
    public void ValidQuery_Passes()
        => _validator.TestValidate(new GetLetteringSuggestionsQuery(Filter())).ShouldNotHaveAnyValidationErrors();

    [Theory]
    [InlineData("")]
    [InlineData("41A")]
    public void Account_IsRequiredAndNumeric(string account)
        => Assert.False(_validator.Validate(new GetLetteringSuggestionsQuery(Filter(account))).IsValid);

    [Fact]
    public void PeriodLongerThan732Days_IsRejected()
    {
        var result = _validator.Validate(new GetLetteringSuggestionsQuery(
            Filter(from: new DateTime(2024, 1, 1), to: new DateTime(2026, 1, 3))));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.ErrorMessage.Contains("732"));
    }

    [Fact]
    public void MissingDates_AreRejected()
        => Assert.False(_validator.Validate(new GetLetteringSuggestionsQuery(Filter() with { From = default, To = default })).IsValid);

    [Fact]
    public void ThirdPartyWithoutKind_AndInvertedAmounts_AreRejected()
    {
        Assert.False(_validator.Validate(new GetLetteringSuggestionsQuery(Filter(thirdPartyId: Guid.NewGuid()))).IsValid);
        Assert.False(_validator.Validate(new GetLetteringSuggestionsQuery(Filter(minAmount: 10m, maxAmount: 5m))).IsValid);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(50, true)]
    [InlineData(200, true)]
    [InlineData(201, false)]
    [InlineData(-1, false)]
    public void MaxResults_IsBetween1And200(int maxResults, bool valid)
    {
        var result = _validator.TestValidate(new GetLetteringSuggestionsQuery(Filter(), maxResults));
        if (valid)
            result.ShouldNotHaveValidationErrorFor(q => q.MaxResults);
        else
            result.ShouldHaveValidationErrorFor(q => q.MaxResults);
    }

    [Fact]
    public async Task Handler_FeatureOff_ReturnsFeatureDisabled_WithoutCallingTheService()
    {
        var service = new Mock<ILetteringSuggestionService>(MockBehavior.Strict);
        var handler = new GetLetteringSuggestionsQueryHandler(
            service.Object, Options.Create(new AccountingSettings { LetteringSuggestionsEnabled = false }));

        var result = await handler.Handle(new GetLetteringSuggestionsQuery(Filter()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.FeatureDisabled, result.Error.Code);
        service.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Handler_FeatureOn_DelegatesFilterAndMaxResults()
    {
        var dto = new LetteringSuggestionsResultDto(Array.Empty<LetteringSuggestionDto>(), 0, 0, 0, false, null, DateTime.UtcNow);
        var query = new GetLetteringSuggestionsQuery(Filter(), 17);
        using var cts = new CancellationTokenSource();
        var service = new Mock<ILetteringSuggestionService>(MockBehavior.Strict);
        service.Setup(s => s.SuggestAsync(query.Filter, 17, cts.Token)).ReturnsAsync(Result.Success(dto));
        var handler = new GetLetteringSuggestionsQueryHandler(
            service.Object, Options.Create(new AccountingSettings { LetteringSuggestionsEnabled = true }));

        var result = await handler.Handle(query, cts.Token);

        Assert.True(result.IsSuccess);
        Assert.Same(dto, result.Value);
        service.VerifyAll();
    }
}
