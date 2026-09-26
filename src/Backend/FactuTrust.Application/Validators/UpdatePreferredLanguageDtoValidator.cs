using FactuTrust.Application.DTOs;
using FluentValidation;

namespace FactuTrust.Application.Validators;

public sealed class UpdatePreferredLanguageDtoValidator : AbstractValidator<UpdatePreferredLanguageDto>
{
    private static readonly string[] Allowed = ["fr", "ar"];

    public UpdatePreferredLanguageDtoValidator()
    {
        RuleFor(x => x.Language)
            .NotEmpty()
            .WithErrorCode("INVALID_ENUM")
            .Must(l => Allowed.Contains(l.Trim().ToLowerInvariant()))
            .WithMessage("Langue non prise en charge.")
            .WithErrorCode("INVALID_ENUM");
    }
}
