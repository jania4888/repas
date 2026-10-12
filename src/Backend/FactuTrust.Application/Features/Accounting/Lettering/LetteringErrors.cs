using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Features.Accounting.Lettering;

/// <summary>
/// Codes d'erreur métier stables du lettrage (plan de refonte, section 4.6). Le contrôleur les
/// transmet au front via <c>ApiResponse&lt;object&gt;.FailWithCode(message, code)</c>, afin que le
/// front puisse réagir sans analyser le message français.
/// </summary>
public static class LetteringErrorCodes
{
    public const string Validation = "LETTERING_VALIDATION";
    public const string LinesNotFound = "LETTERING_LINES_NOT_FOUND";
    public const string AlreadyLettered = "LETTERING_ALREADY_LETTERED";
    public const string AccountMismatch = "LETTERING_ACCOUNT_MISMATCH";
    public const string CurrencyMismatch = "LETTERING_CURRENCY_MISMATCH";
    public const string Unbalanced = "LETTERING_UNBALANCED";
    public const string PeriodLocked = "LETTERING_PERIOD_LOCKED";
    public const string GroupNotFound = "LETTERING_GROUP_NOT_FOUND";
    public const string GroupNotPartial = "LETTERING_GROUP_NOT_PARTIAL";

    /// <summary>
    /// Défensif (donnée historique corrompue, pré-index unique) : un membre du groupe ne porte
    /// plus le code du groupe. Non listé en §4.6 car jamais atteignable via l'application
    /// réparée — compléter un tel groupe masquerait l'incohérence au lieu de la signaler.
    /// </summary>
    public const string GroupInconsistent = "LETTERING_GROUP_INCONSISTENT";

    /// <summary>Phase 3 (lettrage en masse) : réservé, non émis en Phase 1.</summary>
    public const string ExchangeDifference = "LETTERING_EXCHANGE_DIFFERENCE";

    /// <summary>Phase 3 (propositions / masse) : réservé, non émis en Phase 1.</summary>
    public const string FeatureDisabled = "LETTERING_FEATURE_DISABLED";
}

/// <summary>Fabriques d'<see cref="Error"/> portant les codes stables ci-dessus.</summary>
public static class LetteringErrors
{
    public static Error Validation(string message) => new(LetteringErrorCodes.Validation, message);

    public static Error LinesNotFound(string message) => new(LetteringErrorCodes.LinesNotFound, message);

    public static Error AlreadyLettered(string message) => new(LetteringErrorCodes.AlreadyLettered, message);

    public static Error AccountMismatch(string message) => new(LetteringErrorCodes.AccountMismatch, message);

    public static Error CurrencyMismatch(string message) => new(LetteringErrorCodes.CurrencyMismatch, message);

    public static Error Unbalanced(string message) => new(LetteringErrorCodes.Unbalanced, message);

    public static Error PeriodLocked(string message) => new(LetteringErrorCodes.PeriodLocked, message);

    public static Error GroupNotFound(string message) => new(LetteringErrorCodes.GroupNotFound, message);

    public static Error GroupNotPartial(string message) => new(LetteringErrorCodes.GroupNotPartial, message);

    public static Error GroupInconsistent(string message) => new(LetteringErrorCodes.GroupInconsistent, message);
}
