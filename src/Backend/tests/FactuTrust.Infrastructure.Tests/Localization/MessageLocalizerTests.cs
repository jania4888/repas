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
    public void Localize_ArabicCulture_SpecificTemplateWinsOverGenericOne()
    {
        // Le gabarit générique est déclaré en premier : l'ordre du catalogue ne doit pas décider.
        var localizer = CreateLocalizer(
            enabled: true,
            ("Limite atteinte : {0} {1} maximum.", "تم بلوغ الحد: {0} {1} كحد أقصى."),
            ("Limite atteinte : {0} champs par table maximum.", "تم بلوغ الحد: {0} حقول لكل جدول كحد أقصى."));
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("ar");
            Assert.Equal(
                "تم بلوغ الحد: 200 حقول لكل جدول كحد أقصى.",
                localizer.Localize("Limite atteinte : 200 champs par table maximum."));
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

    /// <summary>
    /// Catalogue réel : les messages dont le client dépend (limite du plan Studio, 429, couche
    /// d'ouverture, confirmation du BL) sont entièrement traduits, sans libellé français résiduel.
    /// Format de la limite du plan : StudioQuotaService.EnsureUnderLimitAsync.
    /// </summary>
    [Theory]
    [InlineData("Limite du plan atteinte : 50 tables personnalisées maximum. Mettez à niveau votre abonnement pour en créer davantage.", "50")]
    [InlineData("Limite du plan atteinte : 200 champs par table maximum. Mettez à niveau votre abonnement pour en créer davantage.", "200")]
    [InlineData("Limite du plan atteinte : 10000 enregistrements par table maximum. Mettez à niveau votre abonnement pour en créer davantage.", "10000")]
    [InlineData("Limite du plan atteinte : 10 vues par table maximum. Mettez à niveau votre abonnement pour en créer davantage.", "10")]
    [InlineData("Limite du plan atteinte : 20 workflows par table maximum. Mettez à niveau votre abonnement pour en créer davantage.", "20")]
    [InlineData("Trop de requêtes. Veuillez réessayer plus tard.", null)]
    [InlineData("Trop de requêtes. Veuillez patienter avant de réessayer.", null)]
    [InlineData("Le passage CMUP → FIFO/LIFO exige une couche d'ouverture (inventaire). Stock physique non nul.", null)]
    [InlineData("Ce bon de livraison ne peut pas être confirmé", null)]
    public void Localize_RealCatalog_TranslatesClientFacingMessages(string french, string? number)
    {
        var localizer = CreateLocalizerFromRealCatalog();
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("ar-TN");
            var arabic = localizer.Localize(french);
            Assert.NotEqual(french, arabic);
            Assert.Matches(@"\p{IsArabic}", arabic);
            Assert.DoesNotMatch(@"\b(tables|champs|enregistrements|vues|workflows|requêtes|couche|bon)\b", arabic);
            if (number is not null)
                Assert.Contains(number, arabic, StringComparison.Ordinal);

            CultureInfo.CurrentUICulture = new CultureInfo("fr-TN");
            Assert.Equal(french, localizer.Localize(french));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    /// <summary>
    /// Messages dont le front reconnaît le texte français (vat-declaration.component.ts,
    /// COMPANY_NOT_SUBMITTED_MARKER) : traduits, l'écran afficherait une erreur au lieu de son état vide.
    /// </summary>
    [Fact]
    public void Localize_RealCatalog_KeepsFrontMarkersInFrench()
    {
        var localizer = CreateLocalizerFromRealCatalog();
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("ar-TN");
            Assert.Equal(
                FactuTrust.Domain.Authorization.VatDeclarationAccess.NotSubmittedMessage,
                localizer.Localize(FactuTrust.Domain.Authorization.VatDeclarationAccess.NotSubmittedMessage));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static MessageLocalizer CreateLocalizerFromRealCatalog()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        string? catalog = null;
        while (dir is not null && catalog is null)
        {
            var candidate = Path.Combine(dir.FullName, "FactuTrust.API", "Localization", "messages.ar.json");
            if (File.Exists(candidate))
                catalog = candidate;
            dir = dir.Parent;
        }
        Assert.NotNull(catalog);

        var root = Path.Combine(Path.GetTempPath(), "ft-i18n-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "Localization"));
        File.Copy(catalog!, Path.Combine(root, "Localization", "messages.ar.json"));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Localization:ArabicMessagesEnabled"] = "true" })
            .Build();
        return new MessageLocalizer(config, new HostEnvironmentStub(root), NullLogger<MessageLocalizer>.Instance);
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
