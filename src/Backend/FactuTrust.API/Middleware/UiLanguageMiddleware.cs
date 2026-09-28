using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace FactuTrust.API.Middleware;

/// <summary>
/// Définit <see cref="CultureInfo.CurrentUICulture"/> depuis l'en-tête <c>X-UI-Locale</c> (ar uniquement).
/// Ne modifie jamais <see cref="CultureInfo.CurrentCulture"/> ni l'Accept-Language du navigateur.
/// </summary>
public sealed class UiLanguageMiddleware
{
    public const string UiLocaleHeaderName = "X-UI-Locale";
    private const int MaxHeaderLength = 16;

    private readonly RequestDelegate _next;
    private readonly bool _arabicEnabled;

    public UiLanguageMiddleware(RequestDelegate next, IConfiguration configuration)
    {
        _next = next;
        _arabicEnabled = configuration.GetValue("Localization:ArabicMessagesEnabled", false)
            || string.Equals(
                configuration["Localization:ArabicMessagesEnabled"],
                "true",
                StringComparison.OrdinalIgnoreCase);
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (_arabicEnabled)
        {
            var raw = context.Request.Headers.TryGetValue(UiLocaleHeaderName, out var values)
                ? values.ToString()
                : null;
            if (IsArabicUiLocale(raw))
            {
                try
                {
                    CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("ar-TN");
                }
                catch (CultureNotFoundException)
                {
                    CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("ar");
                }
            }
        }

        await _next(context);
    }

    public static bool IsArabicUiLocale(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > MaxHeaderLength)
        {
            return false;
        }

        var tag = raw.Trim();
        return tag.Equals("ar", StringComparison.OrdinalIgnoreCase)
               || tag.StartsWith("ar-", StringComparison.OrdinalIgnoreCase);
    }
}
