using System.Text.RegularExpressions;
using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.ValueObjects;

/// <summary>
/// Represents a Tunisian phone number.
/// Tunisian numbers are 8 digits, starting with 2, 3, 4, 5, 7, or 9.
/// </summary>
public sealed partial class PhoneNumber : ValueObject
{
    private const string TunisianPattern = @"^((\+216)|216)?[2-57-9]\d{7}$";

    public string Value { get; private set; }
    public string CountryCode { get; private set; }
    public string LocalNumber { get; private set; }

    // Required for EF Core
    private PhoneNumber() 
    {
        Value = string.Empty;
        CountryCode = string.Empty;
        LocalNumber = string.Empty;
    }

    private PhoneNumber(string value, string countryCode, string localNumber)
    {
        Value = value;
        CountryCode = countryCode;
        LocalNumber = localNumber;
    }

    public static Result<PhoneNumber> Create(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Result.Failure<PhoneNumber>(Error.Validation("PhoneNumber", "Le numéro de téléphone est obligatoire"));

        var cleanedValue = CleanPhoneNumber(value);

        if (!TunisianPhoneRegex().IsMatch(cleanedValue))
            return Result.Failure<PhoneNumber>(Error.Validation("PhoneNumber", 
                "Format de numéro de téléphone invalide. Un numéro tunisien doit contenir 8 chiffres."));

        string countryCode;
        string localNumber;

        if (cleanedValue.StartsWith("+216"))
        {
            countryCode = "+216";
            localNumber = cleanedValue[4..];
        }
        else if (cleanedValue.StartsWith("216"))
        {
            countryCode = "+216";
            localNumber = cleanedValue[3..];
        }
        else
        {
            countryCode = "+216";
            localNumber = cleanedValue;
        }

        var formattedValue = $"{countryCode}{localNumber}";

        return Result.Success(new PhoneNumber(formattedValue, countryCode, localNumber));
    }

    /// <summary>
    /// Absent (null, vide ou blancs) devient <c>null</c>. Toute valeur non vide reste validée par <see cref="Create"/>.
    /// </summary>
    public static Result<PhoneNumber?> CreateOptional(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Result.Success<PhoneNumber?>(null);

        var created = Create(value);
        if (created.IsFailure)
            return Result.Failure<PhoneNumber?>(created.Error);

        return Result.Success<PhoneNumber?>(created.Value);
    }

    public string ToLocalFormat() => $"{LocalNumber[..2]} {LocalNumber[2..5]} {LocalNumber[5..]}";
    
    public string ToInternationalFormat() => $"{CountryCode} {LocalNumber[..2]} {LocalNumber[2..5]} {LocalNumber[5..]}";

    private static string CleanPhoneNumber(string value)
    {
        return Regex.Replace(value, @"[\s\-\.\(\)]", "");
    }

    public override string ToString() => ToInternationalFormat();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }

    [GeneratedRegex(TunisianPattern, RegexOptions.Compiled)]
    private static partial Regex TunisianPhoneRegex();
}
