using FactuTrust.Application.DTOs;
using FluentValidation;

namespace FactuTrust.Application.Validators;

public static class BidiValidationExtensions
{
    private static readonly char[] BidiControlChars =
    [
        '\u061C', '\u200E', '\u200F', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
        '\u2066', '\u2067', '\u2068', '\u2069'
    ];

    public static IRuleBuilderOptions<T, string?> NotContainBidiControls<T>(this IRuleBuilder<T, string?> ruleBuilder)
    {
        return ruleBuilder
            .Must(value => value is null || !ContainsBidiControls(value))
            .WithErrorCode(ValidationErrorCodes.BidiControls)
            .WithMessage("Les caractères de contrôle bidirectionnel ne sont pas autorisés.");
    }

    public static bool ContainsBidiControls(string value)
    {
        return value.IndexOfAny(BidiControlChars) >= 0;
    }
}
