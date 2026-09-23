using System.Text.RegularExpressions;
using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.ValueObjects;

/// <summary>
/// Represents a validated email address.
/// </summary>
public sealed partial class Email : ValueObject
{
    private const string EmailPattern = @"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$";

    public string Value { get; private set; }

    // Required for EF Core
    private Email() 
    {
        Value = string.Empty;
    }

    private Email(string value)
    {
        Value = value.ToLowerInvariant();
    }

    public static Result<Email> Create(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Result.Failure<Email>(Error.Validation("Email", "L'email est obligatoire"));

        var normalizedValue = value.Trim().ToLowerInvariant();

        if (normalizedValue.Length > 256)
            return Result.Failure<Email>(Error.Validation("Email", "L'email est trop long"));

        if (!EmailRegex().IsMatch(normalizedValue))
            return Result.Failure<Email>(Error.Validation("Email", "Format d'email invalide"));

        return Result.Success(new Email(normalizedValue));
    }

    /// <summary>
    /// Absent (null, vide ou blancs) devient <c>null</c>. Toute valeur non vide reste validée par <see cref="Create"/>.
    /// </summary>
    public static Result<Email?> CreateOptional(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Result.Success<Email?>(null);

        var created = Create(value);
        if (created.IsFailure)
            return Result.Failure<Email?>(created.Error);

        return Result.Success<Email?>(created.Value);
    }

    public static bool IsValid(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 256)
            return false;

        return EmailRegex().IsMatch(value.Trim());
    }

    public override string ToString() => Value;

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }

    [GeneratedRegex(EmailPattern, RegexOptions.Compiled)]
    private static partial Regex EmailRegex();
}
