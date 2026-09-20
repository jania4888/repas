namespace FactuTrust.Application.DTOs;

/// <summary>
/// Non-blocking registration warning, typed so the client can render it correctly and offer a
/// targeted action instead of guessing what the message is about.
///
/// Historique : la réponse ne transportait que <c>Warnings: string[]</c>, et le front préfixait
/// TOUTES les entrées par « Certains modules n'ont pas pu être activés : ». Un avis de cohérence
/// NIF/segment — qui n'a rien à voir avec les modules, lesquels étaient bien activés — était donc
/// présenté comme un échec d'activation. Le code lève cette ambiguïté sans changer les messages.
///
/// <c>Warnings</c> reste renseigné (dérivé de <see cref="Message"/>) pour ne casser aucun client.
/// </summary>
/// <param name="Code">Stable machine-readable code — see <see cref="RegistrationWarningCodes"/>.</param>
/// <param name="Message">French, human-readable text (unchanged from the previous string-only contract).</param>
/// <param name="Severity">See <see cref="RegistrationWarningSeverities"/>.</param>
public sealed record RegistrationWarningDto(string Code, string Message, string Severity)
{
    public static RegistrationWarningDto Info(string code, string message)
        => new(code, message, RegistrationWarningSeverities.Info);

    public static RegistrationWarningDto Warning(string code, string message)
        => new(code, message, RegistrationWarningSeverities.Warning);
}

/// <summary>Stable codes for <see cref="RegistrationWarningDto.Code"/>. Never renamed: clients branch on them.</summary>
public static class RegistrationWarningCodes
{
    /// <summary>Segment/domain selection dropped because the sector kill-switch is off.</summary>
    public const string SectorSelectionIgnored = "SECTOR_SELECTION_IGNORED";

    /// <summary>The NIF taxpayer category and the chosen segment look incoherent (informational).</summary>
    public const string NifSegmentMismatch = "NIF_SEGMENT_MISMATCH";

    /// <summary>Module selection dropped because the sector kill-switch is off.</summary>
    public const string ModulesSelectionIgnored = "MODULES_SELECTION_IGNORED";

    /// <summary>Requested modules that belong to a paid plan.</summary>
    public const string ModulesDeniedByPlan = "MODULES_DENIED_BY_PLAN";

    /// <summary>Requested modules refused by the plan ceiling although they are not premium — server-side misconfiguration.</summary>
    public const string ModulesActivationFailed = "MODULES_ACTIVATION_FAILED";

    /// <summary>Module ids not offered at registration and therefore ignored.</summary>
    public const string ModulesIgnoredAtRegistration = "MODULES_IGNORED_AT_REGISTRATION";

    /// <summary>
    /// Platform provisioning only: the tenant was created but the requested subscription plan
    /// could not be applied afterwards. Never blocking — the plan is adjustable from the tenant
    /// detail page.
    /// </summary>
    public const string SubscriptionPlanNotApplied = "SUBSCRIPTION_PLAN_NOT_APPLIED";
}

/// <summary>Severity values for <see cref="RegistrationWarningDto.Severity"/> (lowercase, stable).</summary>
public static class RegistrationWarningSeverities
{
    /// <summary>Nothing is wrong with the account; the user is simply told what was not applied.</summary>
    public const string Info = "info";

    /// <summary>Worth the user's attention (data to double-check, or an anomaly reported to support).</summary>
    public const string Warning = "warning";
}
