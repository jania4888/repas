using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces;

public enum CompanyRegistrationFailureKind
{
    Validation,
    DuplicateEmail,
    ConflictNif,
    IdentityError,
    ProvisioningFailed,
    Internal
}

/// <param name="Plan">
/// Forfait a appliquer. Il pilote le plafond de modules accordables
/// (<c>ApplyModuleSelectionAsync</c>) et, apres le commit, la mise a jour de l'abonnement.
/// Le chemin public impose <see cref="SubscriptionPlan.Free"/> en dur : cette valeur ne doit
/// jamais pouvoir provenir du corps d'une requete anonyme.
/// </param>
public sealed record CompanyRegistrationContext(
    bool IssueAuthTokens,
    bool ForceEmailConfirmed,
    Guid? PlatformActorUserId,
    string Source,
    SubscriptionPlan Plan = SubscriptionPlan.Free)
{
    public static CompanyRegistrationContext Public() =>
        new(IssueAuthTokens: true, ForceEmailConfirmed: false, PlatformActorUserId: null, Source: "public", Plan: SubscriptionPlan.Free);

    public static CompanyRegistrationContext Platform(Guid platformActorUserId, SubscriptionPlan plan = SubscriptionPlan.Free) =>
        new(IssueAuthTokens: false, ForceEmailConfirmed: true, PlatformActorUserId: platformActorUserId, Source: "platform", Plan: plan);
}

public sealed class CompanyRegistrationResult
{
    public bool Success { get; init; }
    public CompanyRegistrationFailureKind? FailureKind { get; init; }
    public string? ErrorMessage { get; init; }
    public IReadOnlyList<string> Errors { get; init; } = Array.Empty<string>();
    public AuthResponseDto? Tokens { get; init; }
    public PlatformProvisionTenantResultDto? Provision { get; init; }
    public string? CorrelationId { get; init; }

    public static CompanyRegistrationResult ValidationFailure(string message) =>
        new() { Success = false, FailureKind = CompanyRegistrationFailureKind.Validation, ErrorMessage = message, Errors = new[] { message } };

    public static CompanyRegistrationResult ValidationFailure(IEnumerable<string> errors)
    {
        var list = errors.ToList();
        return new()
        {
            Success = false,
            FailureKind = CompanyRegistrationFailureKind.Validation,
            ErrorMessage = list.FirstOrDefault(),
            Errors = list
        };
    }

    /// <summary>
    /// Le genre <see cref="CompanyRegistrationFailureKind.DuplicateEmail"/> existait dans
    /// l'énumération mais n'était jamais produit : la fabrique retombait sur
    /// <see cref="CompanyRegistrationFailureKind.Validation"/>. Sans effet sur le fil (le
    /// contrôleur mappe les deux genres sur 400), mais l'énumération est désormais honnête et
    /// exploitable par l'appelant.
    /// </summary>
    public static CompanyRegistrationResult DuplicateEmailFailure()
    {
        const string message = "Un compte existe déjà avec cette adresse e-mail.";
        return new()
        {
            Success = false,
            FailureKind = CompanyRegistrationFailureKind.DuplicateEmail,
            ErrorMessage = message,
            Errors = new[] { message }
        };
    }

    public static CompanyRegistrationResult ConflictNifFailure(string message) =>
        new() { Success = false, FailureKind = CompanyRegistrationFailureKind.ConflictNif, ErrorMessage = message, Errors = new[] { message } };

    public static CompanyRegistrationResult IdentityFailure(IEnumerable<string> errors) =>
        new()
        {
            Success = false,
            FailureKind = CompanyRegistrationFailureKind.IdentityError,
            Errors = errors.ToList(),
            ErrorMessage = errors.FirstOrDefault()
        };

    public static CompanyRegistrationResult ProvisioningFailed(string message, string correlationId) =>
        new()
        {
            Success = false,
            FailureKind = CompanyRegistrationFailureKind.ProvisioningFailed,
            ErrorMessage = message,
            Errors = new[] { message },
            CorrelationId = correlationId
        };

    public static CompanyRegistrationResult InternalFailure(string message, string correlationId) =>
        new()
        {
            Success = false,
            FailureKind = CompanyRegistrationFailureKind.Internal,
            ErrorMessage = message,
            Errors = new[] { message },
            CorrelationId = correlationId
        };
}

public interface ICompanyRegistrationService
{
    Task<CompanyRegistrationResult> RegisterAsync(
        RegisterDto dto,
        CompanyRegistrationContext context,
        CancellationToken cancellationToken = default);
}
