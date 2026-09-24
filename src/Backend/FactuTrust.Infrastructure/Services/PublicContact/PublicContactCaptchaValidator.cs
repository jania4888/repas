using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Services.Captcha;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.PublicContact;

/// <summary>
/// Lot C — Turnstile verification for the anonymous contact form. Fail-closed: when
/// <c>RequireCaptcha</c> is on but the secret or the allowed hostnames are missing, every
/// submission is rejected (400) rather than silently accepted. <c>remoteip</c> is forwarded when known.
/// </summary>
public sealed class PublicContactCaptchaValidator : IPublicContactCaptchaValidator
{
    private readonly HttpClient _httpClient;
    private readonly IOptions<PublicContactOptions> _options;

    public PublicContactCaptchaValidator(HttpClient httpClient, IOptions<PublicContactOptions> options)
    {
        _httpClient = httpClient;
        _options = options;
    }

    public Task<bool> IsValidAsync(string? token, string? remoteIp, CancellationToken cancellationToken = default)
    {
        var options = _options.Value;
        if (!options.RequireCaptcha)
            return Task.FromResult(true);

        return TurnstileSiteverifyClient.VerifyAsync(
            _httpClient,
            token,
            remoteIp,
            options.TurnstileSecretKey,
            options.TurnstileAllowedHostnames,
            options.TurnstileExpectedAction,
            cancellationToken);
    }
}
