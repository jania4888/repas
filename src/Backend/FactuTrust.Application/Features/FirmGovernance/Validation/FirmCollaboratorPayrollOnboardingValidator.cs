using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;
using FluentValidation;

namespace FactuTrust.Application.Features.FirmGovernance.Validation;

public sealed class FirmCollaboratorPayrollOnboardingValidator : AbstractValidator<FirmCollaboratorPayrollOnboardingDto>
{
    /// <summary>Longueur de la colonne <c>Employees.EmployeeNumber</c> de la base paie.</summary>
    private const int EmployeeNumberMaxLength = 50;

    public FirmCollaboratorPayrollOnboardingValidator()
    {
        RuleFor(x => x.EmployeeNumber)
            .NotEmpty()
            .WithMessage("Le matricule du salarié est obligatoire.");

        RuleFor(x => x.EmployeeNumber)
            .MaximumLength(EmployeeNumberMaxLength)
            .WithMessage($"Le matricule ne doit pas dépasser {EmployeeNumberMaxLength} caractères.");

        RuleFor(x => x.HireDate)
            .NotEmpty()
            .WithMessage("La date d'embauche est obligatoire.");

        RuleFor(x => x.Contract)
            .NotNull()
            .WithMessage("Le contrat est obligatoire.");

        // Le provisionnement applique aussi ces règles, mais après la création du compte : les
        // vérifier ici évite de créer un compte pour aussitôt le retirer.
        When(x => x.Contract is not null, () =>
        {
            RuleFor(x => x.Contract.StartDate)
                .NotEmpty()
                .WithMessage("La date de début du contrat est obligatoire.");

            RuleFor(x => x.Contract.BaseSalary)
                .GreaterThan(0)
                .WithMessage("Le salaire de base doit être supérieur à zéro.");

            RuleFor(x => x.Contract.WorkAccidentRate)
                .InclusiveBetween(0, 100)
                .WithMessage("Le taux d'accident de travail doit être compris entre 0 et 100 %.");

            RuleFor(x => x.Contract)
                .Must(c => c.Type != "Cdd" || c.EndDate.HasValue)
                .WithMessage("La date de fin est obligatoire pour un CDD.");

            RuleFor(x => x.Contract)
                .Must(c => !c.EndDate.HasValue || c.EndDate.Value.Date >= c.StartDate.Date)
                .WithMessage("La date de fin ne peut pas être antérieure à la date de début.");

            RuleFor(x => x.Contract.Type)
                .Must(IsDefinedName<ContractType>)
                .WithMessage("Type de contrat invalide.");

            RuleFor(x => x.Contract.Regime)
                .Must(IsDefinedName<SocialRegime>)
                .WithMessage("Régime social invalide.");

            RuleFor(x => x.Contract.WeeklyRegime)
                .Must(IsDefinedName<WeeklyWorkRegime>)
                .WithMessage("Régime hebdomadaire invalide.");
        });
    }

    /// <summary>
    /// Même lecture que le provisionnement (<c>Enum.TryParse</c>, sensible à la casse), sans les
    /// valeurs numériques hors énumération que <c>TryParse</c> laisse passer.
    /// </summary>
    private static bool IsDefinedName<TEnum>(string? value) where TEnum : struct, Enum =>
        !string.IsNullOrWhiteSpace(value)
        && Enum.TryParse<TEnum>(value, out var parsed)
        && Enum.IsDefined(parsed);
}
