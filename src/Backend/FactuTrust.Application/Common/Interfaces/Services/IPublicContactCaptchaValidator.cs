namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Validates the anti-bot token (Cloudflare Turnstile) attached to an anonymous contact request.
/// Distinct from <see cref="IStorefrontCaptchaValidator"/>: separate secret, hostnames and action.
/// </summary>
public interface IPublicContactCaptchaValidator
{
    /// <param name="token">Widget response token supplied by the browser.</param>
    /// <param name="remoteIp">Client IP forwarded to siteverify when known (never logged).</param>
    Task<bool> IsValidAsync(string? token, string? remoteIp, CancellationToken cancellationToken = default);
}
