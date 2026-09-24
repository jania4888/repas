using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.FirmGovernance.Validation;
using FluentValidation.TestHelper;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class FirmCollaboratorPayrollOnboardingValidatorTests
{
    private readonly FirmCollaboratorPayrollOnboardingValidator _validator = new();

    private static FirmCollaboratorPayrollOnboardingDto Valid() => new()
    {
        EmployeeNumber = "CAB-001",
        HireDate = new DateTime(2025, 1, 10),
        Contract = new CreateContractDto
        {
            Type = "Cdi",
            Regime = "Rsna",
            WeeklyRegime = "FortyEightHours",
            StartDate = new DateTime(2025, 1, 10),
            BaseSalary = 1500m,
            WorkAccidentRate = 0.4m
        }
    };

    [Fact]
    public void Valid_minimal_passes()
    {
        var result = _validator.TestValidate(Valid());
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Empty_employee_number_fails()
    {
        var dto = Valid() with { EmployeeNumber = "" };
        var result = _validator.TestValidate(dto);
        result.ShouldHaveValidationErrorFor(x => x.EmployeeNumber)
            .WithErrorMessage("Le matricule du salarié est obligatoire.");
    }

    [Fact]
    public void Zero_base_salary_fails()
    {
        var dto = Valid() with
        {
            Contract = Valid().Contract with { BaseSalary = 0m }
        };
        var result = _validator.TestValidate(dto);
        result.ShouldHaveValidationErrorFor(x => x.Contract.BaseSalary)
            .WithErrorMessage("Le salaire de base doit être supérieur à zéro.");
    }

    [Fact]
    public void Cdd_without_end_date_fails()
    {
        var dto = Valid() with
        {
            Contract = Valid().Contract with { Type = "Cdd", EndDate = null }
        };
        var result = _validator.TestValidate(dto);
        result.ShouldHaveValidationErrorFor(x => x.Contract)
            .WithErrorMessage("La date de fin est obligatoire pour un CDD.");
    }

    [Fact]
    public void Employee_number_longer_than_payroll_column_fails()
    {
        var dto = Valid() with { EmployeeNumber = new string('A', 51) };
        var result = _validator.TestValidate(dto);
        result.ShouldHaveValidationErrorFor(x => x.EmployeeNumber)
            .WithErrorMessage("Le matricule ne doit pas dépasser 50 caractères.");
    }

    [Fact]
    public void Employee_number_at_payroll_column_length_passes()
    {
        var dto = Valid() with { EmployeeNumber = new string('A', 50) };
        _validator.TestValidate(dto).ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void End_date_before_start_date_fails()
    {
        var dto = Valid() with
        {
            Contract = Valid().Contract with { Type = "Cdd", EndDate = new DateTime(2025, 1, 9) }
        };
        var result = _validator.TestValidate(dto);
        result.ShouldHaveValidationErrorFor(x => x.Contract)
            .WithErrorMessage("La date de fin ne peut pas être antérieure à la date de début.");
    }

    [Theory]
    [InlineData("cdi")]      // le provisionnement lit les noms en respectant la casse
    [InlineData("Permanent")]
    [InlineData("7")]        // numérique hors énumération, que Enum.TryParse accepterait
    [InlineData("")]
    public void Unknown_contract_type_fails(string type)
    {
        var dto = Valid() with { Contract = Valid().Contract with { Type = type } };
        _validator.TestValidate(dto).ShouldHaveValidationErrorFor(x => x.Contract.Type)
            .WithErrorMessage("Type de contrat invalide.");
    }

    [Fact]
    public void Unknown_social_regime_fails()
    {
        var dto = Valid() with { Contract = Valid().Contract with { Regime = "Cnss" } };
        _validator.TestValidate(dto).ShouldHaveValidationErrorFor(x => x.Contract.Regime)
            .WithErrorMessage("Régime social invalide.");
    }

    [Fact]
    public void Unknown_weekly_regime_fails()
    {
        var dto = Valid() with { Contract = Valid().Contract with { WeeklyRegime = "ThirtyFiveHours" } };
        _validator.TestValidate(dto).ShouldHaveValidationErrorFor(x => x.Contract.WeeklyRegime)
            .WithErrorMessage("Régime hebdomadaire invalide.");
    }

    [Theory]
    [InlineData("Cdi", "Rsna", "FortyEightHours")]
    [InlineData("Sivp", "SivpExonere", "FortyHours")]
    [InlineData("Other", "None", "FortyHours")]
    public void Every_option_offered_by_the_screen_passes(string type, string regime, string weekly)
    {
        var dto = Valid() with
        {
            Contract = Valid().Contract with { Type = type, Regime = regime, WeeklyRegime = weekly }
        };
        _validator.TestValidate(dto).ShouldNotHaveAnyValidationErrors();
    }
}
