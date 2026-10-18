using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Validators;
using FactuTrust.Domain.ValueObjects;
using FluentValidation.TestHelper;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class CreateSubAccountCommandValidatorTests
{
    private readonly CreateSubAccountCommandValidator _validator = new();

    [Theory]
    [InlineData("428.3")]
    [InlineData("425.1")]
    [InlineData("421.1")]
    [InlineData("41100001")]
    [InlineData("42")]
    public void AccountNumber_ValidSce_Passes(string accountNumber)
    {
        var result = _validator.TestValidate(Command(accountNumber));
        result.ShouldNotHaveValidationErrorFor(x => x.Request.AccountNumber);
    }

    [Theory]
    [InlineData("428.")]
    [InlineData(".428")]
    [InlineData("42..1")]
    [InlineData("A28")]
    [InlineData("")]
    public void AccountNumber_InvalidSce_Fails(string accountNumber)
    {
        var result = _validator.TestValidate(Command(accountNumber));
        result.ShouldHaveValidationErrorFor(x => x.Request.AccountNumber);
    }

    private static CreateSubAccountCommand Command(string accountNumber) =>
        new(new CreateSubAccountRequest
        {
            AccountNumber = accountNumber,
            Label = "Personnel — mutuelle",
            AccountClass = 4,
            NatureType = 2,
            AccountType = 3
        });

    // ── Matricule fiscal (plan « Matricule fiscal sur les comptes auxiliaires »). ──

    private static CreateSubAccountCommand AuxiliaryClientCommand(string? fiscalId, bool isAuxiliary = true, int accountType = 1) =>
        new(new CreateSubAccountRequest
        {
            AccountNumber = "41105",
            Label = "Ste Slimen",
            AccountClass = 4,
            NatureType = 0,
            AccountType = accountType,
            IsAuxiliary = isAuxiliary,
            FiscalId = fiscalId
        });

    [Fact]
    public void FiscalId_Empty_DoesNotTriggerAnyRule()
    {
        var result = _validator.TestValidate(AuxiliaryClientCommand(null));
        result.ShouldNotHaveValidationErrorFor(x => x.Request.FiscalId);
    }

    [Fact]
    public void FiscalId_ValidOnAnEligibleAuxiliaryAccount_Passes()
    {
        var result = _validator.TestValidate(AuxiliaryClientCommand("1525071P/B/M/000"));
        result.ShouldNotHaveValidationErrorFor(x => x.Request.FiscalId);
    }

    [Fact]
    public void FiscalId_WithAnInvalidFormat_Fails()
    {
        var result = _validator.TestValidate(AuxiliaryClientCommand("not-a-nif"));
        result.ShouldHaveValidationErrorFor(x => x.Request.FiscalId)
            .WithErrorMessage(NIF.FormatError);
    }

    [Fact]
    public void FiscalId_LongerThanTheMaxInputLength_Fails()
    {
        var tooLong = new string('1', NIF.MaxInputLength + 1);
        var result = _validator.TestValidate(AuxiliaryClientCommand(tooLong));
        result.ShouldHaveValidationErrorFor(x => x.Request.FiscalId);
    }

    [Fact]
    public void FiscalId_OnANonAuxiliaryAccount_Fails()
    {
        var result = _validator.TestValidate(AuxiliaryClientCommand("1525071P/B/M/000", isAuxiliary: false));
        result.ShouldHaveValidationErrorFor(x => x.Request.FiscalId)
            .WithErrorMessage("Le matricule fiscal n'est saisissable que sur un compte auxiliaire Client ou Fournisseur.");
    }

    [Fact]
    public void FiscalId_OnAnAuxiliaryAccountOfTypeOther_Fails()
    {
        var result = _validator.TestValidate(AuxiliaryClientCommand("1525071P/B/M/000", accountType: 3));
        result.ShouldHaveValidationErrorFor(x => x.Request.FiscalId);
    }
}
