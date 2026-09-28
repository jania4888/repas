namespace FactuTrust.Application.DTOs;

/// <summary>
/// Unified validation error response.
/// Compatible with RFC 7807 (Problem Details) standards.
/// Designed for seamless frontend/backend error mapping.
/// </summary>
public sealed record ValidationErrorResponse
{
    /// <summary>Always false for error responses.</summary>
    public bool Success => false;

    /// <summary>Global error code (e.g., "VALIDATION_FAILED", "COMPLIANCE_ERROR").</summary>
    public string Code { get; init; } = ValidationErrorCodes.ValidationFailed;

    /// <summary>Human-readable error message.</summary>
    public string Message { get; init; } = "La validation a échoué";

    /// <summary>Field-specific errors (mappable to form fields).</summary>
    public Dictionary<string, FieldError[]> FieldErrors { get; init; } = new();

    /// <summary>Global errors not tied to a specific field.</summary>
    public string[] GlobalErrors { get; init; } = [];

    /// <summary>Wizard step with the first error (0-indexed, null if not wizard context).</summary>
    public int? WizardStep { get; init; }

    /// <summary>Can the operation proceed despite errors (warnings only)?</summary>
    public bool CanProceed { get; init; }

    /// <summary>Total blocking error count.</summary>
    public int ErrorCount { get; init; }

    /// <summary>Warning count (non-blocking).</summary>
    public int WarningCount { get; init; }

    /// <summary>Create a validation error response from field errors.</summary>
    public static ValidationErrorResponse FromFieldErrors(
        Dictionary<string, FieldError[]> fieldErrors,
        string? message = null,
        int? wizardStep = null)
    {
        var errorCount = fieldErrors.Values
            .SelectMany(e => e)
            .Count(e => e.Severity == ErrorSeverity.Error);

        var warningCount = fieldErrors.Values
            .SelectMany(e => e)
            .Count(e => e.Severity == ErrorSeverity.Warning);

        return new ValidationErrorResponse
        {
            Code = ValidationErrorCodes.ValidationFailed,
            Message = message ?? "La validation a échoué",
            FieldErrors = fieldErrors,
            WizardStep = wizardStep,
            CanProceed = errorCount == 0,
            ErrorCount = errorCount,
            WarningCount = warningCount
        };
    }

    /// <summary>Create a validation error response from global errors.</summary>
    public static ValidationErrorResponse FromGlobalErrors(params string[] errors)
    {
        return new ValidationErrorResponse
        {
            Code = ValidationErrorCodes.ValidationFailed,
            Message = errors.FirstOrDefault() ?? "Une erreur est survenue",
            GlobalErrors = errors,
            ErrorCount = errors.Length,
            CanProceed = false
        };
    }

    /// <summary>Create a compliance error response.</summary>
    public static ValidationErrorResponse ComplianceError(
        Dictionary<string, FieldError[]> fieldErrors,
        string message = "La facture ne respecte pas les exigences de conformité")
    {
        return FromFieldErrors(fieldErrors, message) with
        {
            Code = ValidationErrorCodes.ComplianceError
        };
    }
}

/// <summary>
/// Individual field error with normalized code.
/// </summary>
public sealed record FieldError
{
    /// <summary>Normalized error code for programmatic handling.</summary>
    public string Code { get; init; } = ValidationErrorCodes.Required;

    /// <summary>Human-readable error message in French.</summary>
    public string Message { get; init; } = "";

    /// <summary>The rejected value (for debugging purposes).</summary>
    public object? AttemptedValue { get; init; }

    /// <summary>Error severity: ERROR (blocking) or WARNING (non-blocking).</summary>
    public ErrorSeverity Severity { get; init; } = ErrorSeverity.Error;

    /// <summary>Create a required field error.</summary>
    public static FieldError Required(string fieldLabel)
        => new()
        {
            Code = ValidationErrorCodes.Required,
            Message = $"{fieldLabel} est obligatoire"
        };

    /// <summary>Create a format error.</summary>
    public static FieldError InvalidFormat(string fieldLabel, string expectedFormat)
        => new()
        {
            Code = ValidationErrorCodes.InvalidFormat,
            Message = $"Format invalide pour {fieldLabel}. Attendu: {expectedFormat}"
        };

    /// <summary>Create a min length error.</summary>
    public static FieldError MinLength(string fieldLabel, int minLength)
        => new()
        {
            Code = ValidationErrorCodes.MinLength,
            Message = $"{fieldLabel} doit contenir au moins {minLength} caractères"
        };

    /// <summary>Create a max length error.</summary>
    public static FieldError MaxLength(string fieldLabel, int maxLength)
        => new()
        {
            Code = ValidationErrorCodes.MaxLength,
            Message = $"{fieldLabel} ne peut pas dépasser {maxLength} caractères"
        };

    /// <summary>Create a min value error.</summary>
    public static FieldError MinValue(string fieldLabel, decimal minValue)
        => new()
        {
            Code = ValidationErrorCodes.MinValue,
            Message = $"{fieldLabel} doit être supérieur ou égal à {minValue}"
        };

    /// <summary>Create a max value error.</summary>
    public static FieldError MaxValue(string fieldLabel, decimal maxValue)
        => new()
        {
            Code = ValidationErrorCodes.MaxValue,
            Message = $"{fieldLabel} doit être inférieur ou égal à {maxValue}"
        };

    /// <summary>Create an invalid NIF error.</summary>
    public static FieldError InvalidNif()
        => new()
        {
            Code = ValidationErrorCodes.InvalidNif,
            Message = "Matricule fiscal invalide. Format attendu: 1772793W/A/M/000"
        };

    /// <summary>Create an invalid email error.</summary>
    public static FieldError InvalidEmail()
        => new()
        {
            Code = ValidationErrorCodes.InvalidEmail,
            Message = "Adresse email invalide"
        };

    /// <summary>Create an invalid phone error.</summary>
    public static FieldError InvalidPhone()
        => new()
        {
            Code = ValidationErrorCodes.InvalidPhone,
            Message = "Numéro de téléphone invalide. Format attendu: +216 XX XXX XXX"
        };

    /// <summary>Create an invalid IBAN error.</summary>
    public static FieldError InvalidIban()
        => new()
        {
            Code = ValidationErrorCodes.InvalidIban,
            Message = "IBAN invalide. Format tunisien attendu: TN59XXXX..."
        };

    /// <summary>Create an invalid RIB error.</summary>
    public static FieldError InvalidRib()
        => new()
        {
            Code = ValidationErrorCodes.InvalidRib,
            Message = "RIB invalide. 20 chiffres attendus"
        };

    /// <summary>Create a warning.</summary>
    public static FieldError Warning(string code, string message)
        => new()
        {
            Code = code,
            Message = message,
            Severity = ErrorSeverity.Warning
        };
}

/// <summary>Error severity levels.</summary>
public enum ErrorSeverity
{
    /// <summary>Blocking error - must be fixed.</summary>
    Error,
    
    /// <summary>Non-blocking warning - can proceed.</summary>
    Warning
}

/// <summary>
/// Normalized validation error codes.
/// Used for programmatic error handling and i18n.
/// </summary>
public static class ValidationErrorCodes
{
    // General
    public const string ValidationFailed = "VALIDATION_FAILED";
    public const string ComplianceError = "COMPLIANCE_ERROR";
    public const string SecurityError = "SECURITY_ERROR";
    
    // Field validation
    public const string Required = "REQUIRED";
    public const string MinLength = "MIN_LENGTH";
    public const string MaxLength = "MAX_LENGTH";
    public const string InvalidFormat = "INVALID_FORMAT";
    public const string InvalidEnum = "INVALID_ENUM";
    public const string MinValue = "MIN_VALUE";
    public const string MaxValue = "MAX_VALUE";
    public const string InvalidDate = "INVALID_DATE";
    public const string FutureDate = "FUTURE_DATE";
    public const string PastDate = "PAST_DATE";
    public const string DateRange = "DATE_RANGE";
    
    // Tunisian-specific
    public const string InvalidNif = "INVALID_NIF";
    public const string InvalidEmail = "INVALID_EMAIL";
    public const string InvalidPhone = "INVALID_PHONE";
    public const string InvalidIban = "INVALID_IBAN";
    public const string InvalidRib = "INVALID_RIB";
    public const string InvalidPostalCode = "INVALID_POSTAL_CODE";
    public const string InvalidGovernorate = "INVALID_GOVERNORATE";
    public const string InvalidVatRate = "INVALID_VAT_RATE";
    
    // Business logic
    public const string Duplicate = "DUPLICATE";
    public const string NotFound = "NOT_FOUND";
    public const string AlreadyExists = "ALREADY_EXISTS";
    public const string CalculationMismatch = "CALCULATION_MISMATCH";
    public const string InsufficientData = "INSUFFICIENT_DATA";
    public const string InvalidState = "INVALID_STATE";
    /// <summary>Optimistic concurrency / row modified between read and write (EF).</summary>
    public const string ConcurrencyConflict = "CONCURRENCY_CONFLICT";
    public const string DiscountExceedsTotal = "DISCOUNT_EXCEEDS_TOTAL";
    public const string CreditNoteExceedsInvoice = "CREDIT_NOTE_EXCEEDS_INVOICE";

    /// <summary>
    /// Tenant database schema behind the EF model (pending/failed migration). Emitted both by the
    /// tenant migration guard, before the request runs, and by the exception middleware when a
    /// query hits a missing table or column. The web client keys its "database upgrade" banner on
    /// this code (<c>ErrorHandlerService.isTenantMigrationFailure</c>), regardless of status code.
    /// </summary>
    public const string TenantMigrationFailed = "TENANT_MIGRATION_FAILED";
    /// <summary>JWT tenant / company context invalid (middleware).</summary>
    public const string TenantContextInvalid = "TENANT_CONTEXT_INVALID";
    /// <summary>Delegated dossier JWT claims malformed (change dossier — not a full logout).</summary>
    public const string DelegatedContextInvalid = "DELEGATED_CONTEXT_INVALID";

    // Security
    public const string Tampering = "TAMPERING_DETECTED";
    public const string IdempotencyViolation = "IDEMPOTENCY_VIOLATION";
    public const string RateLimitExceeded = "RATE_LIMIT_EXCEEDED";
    public const string Unauthorized = "UNAUTHORIZED";

    /// <summary>Unicode bidi control characters in user text (spoofing).</summary>
    public const string BidiControls = "BIDI_CONTROLS";
}

/// <summary>
/// Mapping between backend field paths and wizard steps.
/// </summary>
public static class WizardFieldMapping
{
    private static readonly Dictionary<string, int> FieldToStep = new(StringComparer.OrdinalIgnoreCase)
    {
        // Step 0: Metadata
        ["metadata.type"] = 0,
        ["metadata.issueDate"] = 0,
        ["metadata.dueDate"] = 0,
        ["metadata.currency"] = 0,
        ["metadata.internalReference"] = 0,
        ["metadata.linkedInvoiceId"] = 0,
        
        // Step 1: Seller
        ["seller"] = 1,
        ["sellerId"] = 1,
        ["seller.nif"] = 1,
        ["seller.companyName"] = 1,
        ["seller.address"] = 1,
        
        // Step 2: Client
        ["client"] = 2,
        ["clientId"] = 2,
        ["newClient"] = 2,
        ["client.name"] = 2,
        ["newClient.name"] = 2,
        ["client.nif"] = 2,
        ["newClient.nif"] = 2,
        ["client.taxType"] = 2,
        ["newClient.taxType"] = 2,
        ["client.email"] = 2,
        ["newClient.email"] = 2,
        ["client.phone"] = 2,
        ["newClient.phone"] = 2,
        ["client.address"] = 2,
        ["newClient.address"] = 2,
        ["client.address.street"] = 2,
        ["newClient.address.street"] = 2,
        ["client.address.city"] = 2,
        ["newClient.address.city"] = 2,
        ["client.address.governorate"] = 2,
        ["newClient.address.governorate"] = 2,
        ["client.address.postalCode"] = 2,
        ["newClient.address.postalCode"] = 2,
        
        // Step 3: Lines
        ["lines"] = 3,
        ["lines.designation"] = 3,
        ["lines.quantity"] = 3,
        ["lines.unitPriceHT"] = 3,
        ["lines.vatRate"] = 3,
        ["lines.discountValue"] = 3,
        ["lines.discountType"] = 3,
        ["totals"] = 3,
        
        // Step 4: Payment & Legal
        ["paymentMethod"] = 4,
        ["payment"] = 4,
        ["payment.method"] = 4,
        ["payment.daysUntilDue"] = 4,
        ["bankInfo"] = 4,
        ["bankInfo.rib"] = 4,
        ["bankInfo.iban"] = 4,
        ["legalMentions"] = 4,
        ["legalMentions.vatMention"] = 4,
        ["legalMentions.exemptionMention"] = 4,
        ["paymentLegal"] = 4,
        ["paymentLegal.paymentMethod"] = 4,
        ["paymentLegal.bankInfo.rib"] = 4,
        ["paymentLegal.bankInfo.iban"] = 4,
        ["paymentLegal.legalMentions.vatMention"] = 4,
        ["paymentLegal.legalMentions.exemptionMention"] = 4
    };

    /// <summary>Get the wizard step index for a field path.</summary>
    public static int? GetStepForField(string fieldPath)
    {
        if (FieldToStep.TryGetValue(fieldPath, out var step))
            return step;

        // Try to find by prefix
        var prefix = fieldPath.Split('.')[0];
        if (FieldToStep.TryGetValue(prefix, out step))
            return step;

        return null;
    }

    /// <summary>Get the first step with errors.</summary>
    public static int? GetFirstErrorStep(Dictionary<string, FieldError[]> fieldErrors)
    {
        int? firstStep = null;

        foreach (var field in fieldErrors.Keys)
        {
            var step = GetStepForField(field);
            if (step.HasValue && (!firstStep.HasValue || step.Value < firstStep.Value))
            {
                firstStep = step.Value;
            }
        }

        return firstStep;
    }
}
