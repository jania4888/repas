using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Services.Captcha;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Storefront;

/// <summary>
/// Server-side Turnstile verification for public storefront mutations. The HTTP exchange lives in
/// <see cref="TurnstileSiteverifyClient"/> (shared with the public contact form); behaviour is
/// unchanged: <c>remoteip</c> is not sent, only <c>secret</c> and <c>response</c>.
/// </summary>
public sealed class StorefrontCaptchaValidator : IStorefrontCaptchaValidator
{
    private readonly HttpClient _httpClient;
    private readonly StorefrontOptions _options;

    public StorefrontCaptchaValidator(HttpClient httpClient, IOptions<StorefrontOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
    }

    public Task<bool> IsValidAsync(string? token, CancellationToken cancellationToken = default)
    {
        if (!_options.OrderSubmissionRequiresCaptcha)
            return Task.FromResult(true);

        return TurnstileSiteverifyClient.VerifyAsync(
            _httpClient,
            token,
            remoteIp: null,
            _options.TurnstileSecretKey,
            _options.TurnstileAllowedHostnames,
            _options.TurnstileExpectedAction,
            cancellationToken);
    }
}
