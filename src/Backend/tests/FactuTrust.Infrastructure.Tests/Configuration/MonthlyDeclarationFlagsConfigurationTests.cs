using System.Text.Json;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Configuration;

/// <summary>
/// Déclaration mensuelle paramétrable — activée pour toute la plateforme depuis le 2026-09-24 par
/// <c>appsettings.json</c>. Les deux clés dont <c>AccountingSettings.ConfigurableLinesActive</c> fait
/// la conjonction doivent y valoir <c>true</c>, et aucun fichier d'environnement ne doit les
/// rabattre à <c>false</c> : une surcharge oubliée rallumerait en production le refus « non
/// activée » que ce changement supprime. Le repli opérationnel passe par variable d'environnement
/// (<c>Accounting__MonthlyDeclarationConfigurableLinesEnabled=false</c>), qui prime sur les fichiers,
/// pas par le dépôt. Motif <c>RepoRelativePath</c> repris de <c>ProductionStudioFlagsTests</c>.
/// </summary>
public sealed class MonthlyDeclarationFlagsConfigurationTests
{
    private static readonly string[] Flags =
    [
        "MonthlyDeclarationV2Enabled",
        "MonthlyDeclarationConfigurableLinesEnabled"
    ];

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static JsonElement? ReadAccountingSection(string fileName)
    {
        var path = RepoRelativePath("src", "Backend", "FactuTrust.API", fileName);
        Assert.True(File.Exists(path), $"Settings file not found: {path}");

        using var document = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions
        {
            CommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        });

        return document.RootElement.TryGetProperty("Accounting", out var accounting)
            ? accounting.Clone()
            : null;
    }

    [Fact]
    public void Base_settings_enable_the_configurable_monthly_declaration()
    {
        var accounting = ReadAccountingSection("appsettings.json");

        Assert.NotNull(accounting);
        foreach (var flag in Flags)
        {
            Assert.True(accounting.Value.TryGetProperty(flag, out var value), $"{flag} absent de appsettings.json");
            Assert.Equal(JsonValueKind.True, value.ValueKind);
        }
    }

    /// <summary>
    /// La montée vers le catalogue v2 est la seule modification de données du retrait du calcul
    /// historique : elle se déploie après le code, par variable d'environnement, jamais par le dépôt.
    /// Aucun fichier ne doit donc l'allumer.
    /// </summary>
    [Theory]
    [InlineData("appsettings.json")]
    [InlineData("appsettings.Production.json")]
    [InlineData("appsettings.Development.json")]
    public void No_settings_file_turns_the_catalog_v2_upgrade_on(string fileName)
    {
        var accounting = ReadAccountingSection(fileName);
        if (accounting is null)
            return;

        if (accounting.Value.TryGetProperty("MonthlyDeclarationCatalogV2UpgradeEnabled", out var value))
            Assert.Equal(JsonValueKind.False, value.ValueKind);
    }

    [Theory]
    [InlineData("appsettings.Production.json")]
    [InlineData("appsettings.Development.json")]
    public void Environment_settings_never_turn_the_configurable_monthly_declaration_off(string fileName)
    {
        var accounting = ReadAccountingSection(fileName);
        if (accounting is null)
            return; // Section absente : la valeur de base s'applique.

        foreach (var flag in Flags)
        {
            if (accounting.Value.TryGetProperty(flag, out var value))
                Assert.True(value.ValueKind == JsonValueKind.True, $"{fileName} rabat {flag} à {value}");
        }
    }
}
