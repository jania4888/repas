using System.Globalization;
using Xunit;
using FactuTrust.Infrastructure.Localization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace FactuTrust.Infrastructure.Tests.Localization;

public sealed class MessageLocalizerTests
{
    [Fact]
    public void Localize_FrenchCulture_ReturnsOriginal()
    {
        var localizer = CreateLocalizer(enabled: true, ("Connexion réussie", "تم تسجيل الدخول بنجاح"));
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("fr-FR");
            Assert.Equal("Connexion réussie", localizer.Localize("Connexion réussie"));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public void Localize_ArabicCulture_ReturnsCatalogTranslation()
    {
        var localizer = CreateLocalizer(enabled: true, ("Connexion réussie", "تم تسجيل الدخول بنجاح"));
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("ar-TN");
            Assert.Equal("تم تسجيل الدخول بنجاح", localizer.Localize("Connexion réussie"));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public void Localize_ArabicCulture_TemplateWithPlaceholder()
    {
        var localizer = CreateLocalizer(enabled: true, ("Le champ {0} est requis.", "الحقل {0} مطلوب."));
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("ar");
            Assert.Equal("الحقل email مطلوب.", localizer.Localize("Le champ email est requis."));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static MessageLocalizer CreateLocalizer(bool enabled, params (string fr, string ar)[] pairs)
    {
        var translations = pairs.ToDictionary(p => p.fr, p => p.ar, StringComparer.Ordinal);
        var json = System.Text.Json.JsonSerializer.Serialize(new { translations });
        var root = Path.Combine(Path.GetTempPath(), "ft-i18n-" + Guid.NewGuid().ToString("N"));
        var locDir = Path.Combine(root, "Localization");
        Directory.CreateDirectory(locDir);
        File.WriteAllText(Path.Combine(locDir, "messages.ar.json"), json);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Localization:ArabicMessagesEnabled"] = enabled ? "true" : "false"
            })
            .Build();

        var env = new HostEnvironmentStub(root);
        return new MessageLocalizer(config, env, NullLogger<MessageLocalizer>.Instance);
    }

    private sealed class HostEnvironmentStub(string contentRoot) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "Test";
        public string ContentRootPath { get; set; } = contentRoot;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
