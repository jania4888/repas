using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Application.Features.Accounting.Validators;
using FluentValidation.TestHelper;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>Bornes de la requête du tableau de bord délégué (plan §3.3).</summary>
public sealed class GetAccountingOverviewQueryValidatorTests
{
    private static readonly GetAccountingOverviewQueryValidator Validator = new();

    [Theory]
    [InlineData(null, null)]
    [InlineData(2026, null)]
    [InlineData(2026, 1)]
    [InlineData(2000, 12)]
    [InlineData(2100, 6)]
    public void Valid_Requests_Pass(int? fiscalYear, int? month)
    {
        Validator.TestValidate(new GetAccountingOverviewQuery(fiscalYear, month)).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData(1999)]
    [InlineData(2101)]
    public void FiscalYear_OutOfRange_Fails(int fiscalYear)
    {
        Validator.TestValidate(new GetAccountingOverviewQuery(fiscalYear, null))
            .ShouldHaveValidationErrorFor(x => x.FiscalYear);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(13)]
    public void Month_OutOfRange_Fails(int month)
    {
        Validator.TestValidate(new GetAccountingOverviewQuery(2026, month))
            .ShouldHaveValidationErrorFor(x => x.Month);
    }

    [Fact]
    public void Month_WithoutFiscalYear_Fails_WithFrenchMessage()
    {
        var result = Validator.TestValidate(new GetAccountingOverviewQuery(null, 3));

        Assert.Contains(result.Errors, e => e.ErrorMessage == GetAccountingOverviewQueryValidator.MonthRequiresFiscalYear);
    }

    [Fact]
    public void Comparison_UndefinedEnum_Fails_WithFrenchMessage()
    {
        var result = Validator.TestValidate(new GetAccountingOverviewQuery(2026, 3, (DashboardComparison)42));

        result.ShouldHaveValidationErrorFor(x => x.Comparison)
            .WithErrorMessage(GetAccountingOverviewQueryValidator.InvalidComparison);
    }
}
