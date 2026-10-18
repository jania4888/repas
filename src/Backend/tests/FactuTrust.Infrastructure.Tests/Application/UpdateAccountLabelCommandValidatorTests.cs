using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Validators;
using FactuTrust.Domain.ValueObjects;
using FluentValidation.TestHelper;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class UpdateAccountLabelCommandValidatorTests
{
    private readonly UpdateAccountLabelCommandValidator _validator = new();

    [Fact]
    public void Label_Empty_Fails()
    {
        var result = _validator.TestValidate(new UpdateAccountLabelCommand(Guid.NewGuid(), ""));
        result.ShouldHaveValidationErrorFor(x => x.Label);
    }

    [Fact]
    public void Label_TooLong_Fails()
    {
        var result = _validator.TestValidate(
            new UpdateAccountLabelCommand(Guid.NewGuid(), new string('a', 201)));
        result.ShouldHaveValidationErrorFor(x => x.Label);
    }

    [Fact]
    public void Label_Valid_Passes()
    {
        var result = _validator.TestValidate(new UpdateAccountLabelCommand(Guid.NewGuid(), "Ste Slimen"));
        result.ShouldNotHaveValidationErrorFor(x => x.Label);
    }

    // ── Matricule fiscal : les règles ne s'appliquent que quand UpdateFiscalId est vrai. L'éligibilité
    // (compte auxiliaire, préfixe) reste tranchée par ChartOfAccount.SetFiscalId, pas ici, car elle
    // dépend de l'état existant du compte. ──

    [Fact]
    public void FiscalId_WithUpdateFiscalIdFalse_IsNeverValidated_EvenIfMalformed()
    {
        // Par défaut (UpdateFiscalId=false), un client ancien qui n'envoie pas ce champ ne doit
        // jamais être bloqué par une valeur ignorée.
        var result = _validator.TestValidate(
            new UpdateAccountLabelCommand(Guid.NewGuid(), "Ste Slimen", UpdateFiscalId: false, FiscalId: "not-a-nif"));
        result.ShouldNotHaveValidationErrorFor(x => x.FiscalId);
    }

    [Fact]
    public void FiscalId_WithUpdateFiscalIdTrueAndEmptyValue_Passes()
    {
        // Effacer le MF reste toujours permis.
        var result = _validator.TestValidate(
            new UpdateAccountLabelCommand(Guid.NewGuid(), "Ste Slimen", UpdateFiscalId: true, FiscalId: null));
        result.ShouldNotHaveValidationErrorFor(x => x.FiscalId);
    }

    [Fact]
    public void FiscalId_WithUpdateFiscalIdTrueAndValidValue_Passes()
    {
        var result = _validator.TestValidate(
            new UpdateAccountLabelCommand(Guid.NewGuid(), "Ste Slimen", UpdateFiscalId: true, FiscalId: "1525071P/B/M/000"));
        result.ShouldNotHaveValidationErrorFor(x => x.FiscalId);
    }

    [Fact]
    public void FiscalId_WithUpdateFiscalIdTrueAndInvalidFormat_Fails()
    {
        var result = _validator.TestValidate(
            new UpdateAccountLabelCommand(Guid.NewGuid(), "Ste Slimen", UpdateFiscalId: true, FiscalId: "not-a-nif"));
        result.ShouldHaveValidationErrorFor(x => x.FiscalId)
            .WithErrorMessage(NIF.FormatError);
    }

    [Fact]
    public void FiscalId_WithUpdateFiscalIdTrueAndTooLongValue_Fails()
    {
        var tooLong = new string('1', NIF.MaxInputLength + 1);
        var result = _validator.TestValidate(
            new UpdateAccountLabelCommand(Guid.NewGuid(), "Ste Slimen", UpdateFiscalId: true, FiscalId: tooLong));
        result.ShouldHaveValidationErrorFor(x => x.FiscalId);
    }
}
