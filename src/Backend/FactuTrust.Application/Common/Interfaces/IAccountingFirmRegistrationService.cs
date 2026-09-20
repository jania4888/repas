using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces;

public enum AccountingFirmRegistrationFailureKind
{
    Validation,
    DuplicateEmail,
    ConflictNif,
    Internal
}

/// <param name="Plan">
/// Forfait a appliquer apres le commit. Le chemin public impose
/// <see cref="SubscriptionPlan.Free"/> en dur.
/// </param>
public sealed record AccountingFirmRegistrationContext(
    bool IssueAuthTokens,
    bool ForceEmailConfirmed,
    Guid? PlatformActorUserId,
    string Source,
    SubscriptionPlan Plan = SubscriptionPlan.Free)
{
    public static AccountingFirmRegistrationContext Public() =>
        new(IssueAuthTokens: true, ForceEmailConfirmed: true, PlatformActorUserId: null, Source: "public", Plan: SubscriptionPlan.Free);

    public static AccountingFirmRegistrationContext Platform(Guid platformActorUserId, SubscriptionPlan plan = SubscriptionPlan.Free) =>
        new(IssueAuthTokens: false, ForceEmailConfirmed: true, PlatformActorUserId: platformActorUserId, Source: "platform", Plan: plan);
}

public sealed class AccountingFirmRegistrationResult
{
    public bool Success { get; init; }
    public AuthResponseDto? Tokens { get; init; }
    public PlatformProvisionTenantResultDto? Provision { get; init; }
    public IReadOnlyList<string> Errors { get; init; } = Array.Empty<string>();
    public AccountingFirmRegistrationFailureKind? FailureKind { get; init; }
    public string? CorrelationId { get; init; }
    public long TotalDurationMs { get; init; }

    public static AccountingFirmRegistrationResult ValidationFailure(params string[] errors) =>
        new() { Success = false, FailureKind = AccountingFirmRegistrationFailureKind.Validation, Errors = errors };

    public static AccountingFirmRegistrationResult DuplicateEmailFailure() =>
        new()
        {
            Success = false,
            FailureKind = AccountingFirmRegistrationFailureKind.DuplicateEmail,
            Errors = new[] { "Un compte existe déjà avec cette adresse e-mail." }
        };

    public static AccountingFirmRegistrationResult ConflictNifFailure(string message) =>
        new()
        {
            Success = false,
            FailureKind = AccountingFirmRegistrationFailureKind.ConflictNif,
            Errors = new[] { message }
        };

    public static AccountingFirmRegistrationResult InternalFailure(string correlationId) =>
        new()
        {
            Success = false,
            FailureKind = AccountingFirmRegistrationFailureKind.Internal,
            CorrelationId = correlationId,
            Errors = new[] { "L'inscription du cabinet n'a pas pu être finalisée." }
        };

    public static AccountingFirmRegistrationResult Ok(
        AuthResponseDto? tokens,
        PlatformProvisionTenantResultDto provision,
        long totalDurationMs) =>
        new() { Success = true, Tokens = tokens, Provision = provision, TotalDurationMs = totalDurationMs };
}

public interface IAccountingFirmRegistrationService
{
    Task<AccountingFirmRegistrationResult> RegisterAsync(
        RegisterAccountingFirmDto dto,
        AccountingFirmRegistrationContext context,
        CancellationToken cancellationToken = default);
}
