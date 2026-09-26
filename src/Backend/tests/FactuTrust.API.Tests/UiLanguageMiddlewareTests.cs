using System.Globalization;
using FactuTrust.API.Middleware;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace FactuTrust.API.Tests;

[Collection(nameof(UiLanguageMiddlewareTests))]
public sealed class UiLanguageMiddlewareTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("fr")]
    [InlineData("fr-TN")]
    [InlineData("en-US")]
    [InlineData("arn")]
    public async Task Without_arabic_header_keeps_default_ui_culture(string? header)
    {
        var prevUi = CultureInfo.CurrentUICulture;
        var prevCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-TN");
            var config = EnabledArabicConfig();
            var middleware = new UiLanguageMiddleware(_ => Task.CompletedTask, config);
            var ctx = new DefaultHttpContext();
            if (header != null)
            {
                ctx.Request.Headers[UiLanguageMiddleware.UiLocaleHeaderName] = header;
            }

            await middleware.InvokeAsync(ctx);

            Assert.Equal("fr", CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);
            Assert.Equal("fr-TN", CultureInfo.CurrentCulture.Name);
        }
        finally
        {
            CultureInfo.CurrentUICulture = prevUi;
            CultureInfo.CurrentCulture = prevCulture;
        }
    }

    [Fact]
    public async Task Arabic_header_is_recognized_and_keeps_current_culture()
    {
        var prevUi = CultureInfo.CurrentUICulture;
        var prevCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-TN");
            var middleware = new UiLanguageMiddleware(_ => Task.CompletedTask, EnabledArabicConfig());
            var ctx = new DefaultHttpContext();
            ctx.Request.Headers.Append(UiLanguageMiddleware.UiLocaleHeaderName, "ar");
            Assert.True(
                ctx.Request.Headers.TryGetValue(UiLanguageMiddleware.UiLocaleHeaderName, out var hv)
                && UiLanguageMiddleware.IsArabicUiLocale(hv.ToString()));

            await middleware.InvokeAsync(ctx);

            Assert.Equal("fr-TN", CultureInfo.CurrentCulture.Name);
        }
        finally
        {
            CultureInfo.CurrentUICulture = prevUi;
            CultureInfo.CurrentCulture = prevCulture;
        }
    }

    [Fact]
    public async Task Accept_language_is_ignored()
    {
        var prevUi = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
            var middleware = new UiLanguageMiddleware(_ => Task.CompletedTask, EnabledArabicConfig());
            var ctx = new DefaultHttpContext();
            ctx.Request.Headers.AcceptLanguage = "ar-TN,fr;q=0.9";

            await middleware.InvokeAsync(ctx);

            Assert.Equal("fr", CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);
        }
        finally
        {
            CultureInfo.CurrentUICulture = prevUi;
        }
    }

    [Fact]
    public async Task Oversized_header_is_rejected()
    {
        var prevUi = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
            var middleware = new UiLanguageMiddleware(_ => Task.CompletedTask, EnabledArabicConfig());
            var ctx = new DefaultHttpContext();
            ctx.Request.Headers[UiLanguageMiddleware.UiLocaleHeaderName] = new string('a', 17);

            await middleware.InvokeAsync(ctx);

            Assert.Equal("fr", CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);
        }
        finally
        {
            CultureInfo.CurrentUICulture = prevUi;
        }
    }

    [Fact]
    public async Task When_arabic_disabled_header_is_ignored()
    {
        var prevUi = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["Localization:ArabicMessagesEnabled"] = "false" })
                .Build();
            var middleware = new UiLanguageMiddleware(_ => Task.CompletedTask, config);
            var ctx = new DefaultHttpContext();
            ctx.Request.Headers[UiLanguageMiddleware.UiLocaleHeaderName] = "ar";

            await middleware.InvokeAsync(ctx);

            Assert.Equal("fr", CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);
        }
        finally
        {
            CultureInfo.CurrentUICulture = prevUi;
        }
    }

    [Theory]
    [InlineData("ar", true)]
    [InlineData("ar-TN", true)]
    [InlineData("fr", false)]
    [InlineData("en-US", false)]
    public void IsArabicUiLocale_whitelist(string tag, bool expected)
    {
        Assert.Equal(expected, UiLanguageMiddleware.IsArabicUiLocale(tag));
    }

    private static IConfiguration EnabledArabicConfig() =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Localization:ArabicMessagesEnabled"] = "true" })
            .Build();
}
