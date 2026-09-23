using System.Text.RegularExpressions;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Common.Validation;

/// <summary>
/// Centralized Tunisian validation rules.
/// Single source of truth for all validation patterns and constants.
/// </summary>
public static partial class TunisianValidationRules
{
    // ============================================
    // PATTERNS - Tunisian Specific
    // ============================================

    /// <summary>
    /// Forme stockée du matricule fiscal : <c>NNNNNNNL/A/M/NNN</c> (ex. <c>1772793W/A/M/000</c>).
    /// La validation d'une saisie passe par <see cref="IsValidNif"/>, qui accepte aussi l'écriture historique.
    /// </summary>
    public static readonly Regex NifPattern = NifRegex();

    /// <summary>
    /// Tunisian phone number pattern.
    /// Accepts: +216XXXXXXXX, 216XXXXXXXX, XXXXXXXX
    /// Must start with 2, 3, 4, 5, 7, 9 after country code.
    /// </summary>
    public static readonly Regex TunisianPhonePattern = TunisianPhoneRegex();

    /// <summary>
    /// International phone pattern (fallback).
    /// </summary>
    public static readonly Regex InternationalPhonePattern = InternationalPhoneRegex();

    /// <summary>
    /// Tunisian postal code: exactly 4 digits.
    /// </summary>
    public static readonly Regex PostalCodePattern = PostalCodeRegex();

    /// <summary>
    /// Tunisian IBAN: TN + 2 check digits + 20 digits.
    /// Total: 24 characters.
    /// </summary>
    public static readonly Regex TunisianIbanPattern = TunisianIbanRegex();

    /// <summary>
    /// Tunisian RIB: 20 digits (can have spaces).
    /// Format: BB AAA CCCCCCCCCCCCC KK
    /// </summary>
    public static readonly Regex RibPattern = RibRegex();

    /// <summary>Tunisian CIN (Carte d'identité nationale): 8 digits.</summary>
    public static readonly Regex CinPattern = CinRegex();

    /// <summary>Tunisian CNSS employee matricule: 10 digits.</summary>
    public static readonly Regex CnssPattern = CnssRegex();

    /// <summary>
    /// Standard email pattern.
    /// </summary>
    public static readonly Regex EmailPattern = EmailRegex();

    /// <summary>
    /// SWIFT/BIC (ISO 9362): 8 or 11 alphanumeric characters.
    /// </summary>
    public static readonly Regex SwiftBicPattern = SwiftBicRegex();

    // ============================================
    // VALID VALUES
    // ============================================

    /// <summary>Valid Tunisian VAT rates (%).</summary>
    public static readonly int[] ValidVatRates = { 0, 7, 13, 19 };

    /// <summary>Valid currencies.</summary>
    public static readonly string[] ValidCurrencies = { "TND", "EUR", "USD" };

    /// <summary>Valid invoice types.</summary>
    public static readonly string[] ValidInvoiceTypes = { "INVOICE", "CREDIT_NOTE" };

    /// <summary>Valid client tax types.</summary>
    public static readonly string[] ValidClientTaxTypes = { "TAX_SUBJECT", "NON_TAX_SUBJECT", "TAX_EXEMPT" };

    /// <summary>Valid payment methods.</summary>
    public static readonly string[] ValidPaymentMethods = { "CASH", "BANK_TRANSFER", "CHECK", "CARD", "EFFECT" };

    /// <summary>All 24 Tunisian governorates.</summary>
    public static readonly HashSet<string> TunisianGovernorates = new(StringComparer.OrdinalIgnoreCase)
    {
        "Ariana", "Béja", "Ben Arous", "Bizerte", "Gabès", "Gafsa", "Jendouba",
        "Kairouan", "Kasserine", "Kébili", "Le Kef", "Mahdia", "La Manouba",
        "Médenine", "Monastir", "Nabeul", "Sfax", "Sidi Bouzid", "Siliana",
        "Sousse", "Tataouine", "Tozeur", "Tunis", "Zaghouan"
    };

    // ============================================
    // LENGTH CONSTRAINTS
    // ============================================

    public static class MaxLengths
    {
        public const int ClientName = 200;
        public const int Street = 200;
        public const int City = 100;
        public const int Designation = 500;
        public const int Description = 2000;
        public const int InternalReference = 50;
        public const int CustomMention = 1000;
        public const int PaymentTerms = 500;
        public const int BankName = 100;
        public const int Email = 256;
        public const int Phone = 20;
    }

    public static class MinLengths
    {
        public const int ClientName = 2;
        public const int Designation = 2;
    }

    // ============================================
    // NUMERIC CONSTRAINTS
    // ============================================

    public static class NumericLimits
    {
        /// <summary>Minimum quantity for invoice lines.</summary>
        public const decimal MinQuantity = 0.001m;

        /// <summary>Minimum unit price.</summary>
        public const decimal MinUnitPrice = 0m;

        /// <summary>Maximum discount percentage.</summary>
        public const decimal MaxDiscountPercent = 100m;

        /// <summary>Maximum payment days.</summary>
        public const int MaxPaymentDays = 365;

        /// <summary>Calculation tolerance in TND (millimes).</summary>
        public const decimal CalculationTolerance = 0.001m;
    }

    // ============================================
    // VALIDATION METHODS
    // ============================================

    /// <summary>Validates a Tunisian NIF (forme officielle ou historique).</summary>
    public static bool IsValidNif(string? nif) => NIF.IsValid(nif);

    /// <summary>Validates a Tunisian phone number.</summary>
    public static bool IsValidTunisianPhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone))
            return true; // Optional field

        var cleaned = phone.Replace(" ", "").Replace("-", "").Replace(".", "");
        return TunisianPhonePattern.IsMatch(cleaned);
    }

    /// <summary>Validates an international phone number.</summary>
    public static bool IsValidInternationalPhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone))
            return true; // Optional field

        var cleaned = phone.Replace(" ", "").Replace("-", "").Replace(".", "");
        return InternationalPhonePattern.IsMatch(cleaned);
    }

    /// <summary>Validates a Tunisian postal code.</summary>
    public static bool IsValidPostalCode(string? postalCode)
    {
        if (string.IsNullOrWhiteSpace(postalCode))
            return true; // Optional field

        return PostalCodePattern.IsMatch(postalCode);
    }

    /// <summary>Validates a Tunisian IBAN.</summary>
    public static bool IsValidTunisianIban(string? iban)
    {
        if (string.IsNullOrWhiteSpace(iban))
            return true; // Optional field

        var cleaned = iban.Replace(" ", "").ToUpperInvariant();
        return TunisianIbanPattern.IsMatch(cleaned);
    }

    /// <summary>Validates a Tunisian RIB.</summary>
    public static bool IsValidRib(string? rib)
    {
        if (string.IsNullOrWhiteSpace(rib))
            return true; // Optional field

        var cleaned = rib.Replace(" ", "");
        return RibPattern.IsMatch(cleaned);
    }

    /// <summary>Validates a Tunisian CIN (8 digits).</summary>
    public static bool IsValidCin(string? cin)
    {
        if (string.IsNullOrWhiteSpace(cin))
            return true;

        var cleaned = cin.Trim().Replace(" ", "");
        return CinPattern.IsMatch(cleaned);
    }

    /// <summary>Validates a Tunisian CNSS matricule (10 digits).</summary>
    public static bool IsValidCnssNumber(string? cnss)
    {
        if (string.IsNullOrWhiteSpace(cnss))
            return true;

        var cleaned = cnss.Trim().Replace(" ", "").Replace("-", "");
        return CnssPattern.IsMatch(cleaned);
    }

    /// <summary>Validates a SWIFT/BIC code (optional field).</summary>
    public static bool IsValidSwiftBic(string? swiftBic)
    {
        if (string.IsNullOrWhiteSpace(swiftBic))
            return true;

        var cleaned = swiftBic.Trim().Replace(" ", "").ToUpperInvariant();
        return SwiftBicPattern.IsMatch(cleaned);
    }

    /// <summary>Validates a Tunisian VAT rate.</summary>
    public static bool IsValidVatRate(int rate) => ValidVatRates.Contains(rate);

    /// <summary>Validates a Tunisian VAT rate (decimal).</summary>
    public static bool IsValidVatRate(decimal rate) => ValidVatRates.Contains((int)rate);

    /// <summary>Validates a governorate name.</summary>
    public static bool IsValidGovernorate(string? governorate)
    {
        if (string.IsNullOrWhiteSpace(governorate))
            return false;

        return TunisianGovernorates.Contains(governorate);
    }

    /// <summary>Validates an email address.</summary>
    public static bool IsValidEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return false;

        return EmailPattern.IsMatch(email);
    }

    /// <summary>Checks if client tax type requires NIF.</summary>
    public static bool RequiresNif(string? taxType)
    {
        return string.Equals(taxType, "TAX_SUBJECT", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Checks if client tax type requires exemption mention.</summary>
    public static bool RequiresExemptionMention(string? taxType)
    {
        return string.Equals(taxType, "TAX_EXEMPT", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Ramène un matricule à la forme stockée, ou trim + majuscules s'il n'est pas reconnu.</summary>
    public static string? NormalizeNif(string? nif)
    {
        if (string.IsNullOrWhiteSpace(nif))
            return null;

        return NIF.TryCanonicalize(nif, out var canonical) ? canonical : nif.Trim().ToUpperInvariant();
    }

    /// <summary>Formats phone number to standard format.</summary>
    public static string? NormalizePhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone))
            return null;

        var cleaned = phone.Trim().Replace(" ", "").Replace("-", "").Replace(".", "");

        // Add +216 prefix if missing for Tunisian numbers
        if (cleaned.Length == 8 && !cleaned.StartsWith("216") && !cleaned.StartsWith("+"))
        {
            cleaned = "+216" + cleaned;
        }
        else if (cleaned.StartsWith("216"))
        {
            cleaned = "+" + cleaned;
        }

        return cleaned;
    }

    /// <summary>Rounds amount to Tunisian millimes (3 decimal places).</summary>
    public static decimal RoundToMillimes(decimal amount)
    {
        return Math.Round(amount, 3, MidpointRounding.AwayFromZero);
    }

    /// <summary>Compares two amounts with millime tolerance.</summary>
    public static bool AmountsEqual(decimal a, decimal b)
    {
        return Math.Abs(a - b) < NumericLimits.CalculationTolerance;
    }

    // ============================================
    // REGEX GENERATORS
    // ============================================

    [GeneratedRegex(@"^[0-9]{7}[A-Z]/[A-Z]/[A-Z]/[0-9]{3}$", RegexOptions.CultureInvariant | RegexOptions.Compiled)]
    private static partial Regex NifRegex();

    [GeneratedRegex(@"^(\+?216)?[2-57-9]\d{7}$", RegexOptions.Compiled)]
    private static partial Regex TunisianPhoneRegex();

    [GeneratedRegex(@"^\+?[0-9]{8,20}$", RegexOptions.Compiled)]
    private static partial Regex InternationalPhoneRegex();

    [GeneratedRegex(@"^\d{4}$", RegexOptions.Compiled)]
    private static partial Regex PostalCodeRegex();

    [GeneratedRegex(@"^TN\d{22}$", RegexOptions.Compiled)]
    private static partial Regex TunisianIbanRegex();

    [GeneratedRegex(@"^\d{20}$", RegexOptions.Compiled)]
    private static partial Regex RibRegex();

    [GeneratedRegex(@"^\d{8}$", RegexOptions.Compiled)]
    private static partial Regex CinRegex();

    [GeneratedRegex(@"^\d{10}$", RegexOptions.Compiled)]
    private static partial Regex CnssRegex();

    [GeneratedRegex(@"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", RegexOptions.Compiled)]
    private static partial Regex EmailRegex();

    [GeneratedRegex(@"^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$", RegexOptions.Compiled)]
    private static partial Regex SwiftBicRegex();
}

/// <summary>
/// Extension methods for validation.
/// </summary>
public static class ValidationExtensions
{
    /// <summary>Checks if a string is null, empty, or whitespace.</summary>
    public static bool IsNullOrEmpty(this string? value) => string.IsNullOrWhiteSpace(value);

    /// <summary>Checks if a string has content.</summary>
    public static bool HasContent(this string? value) => !string.IsNullOrWhiteSpace(value);
}
