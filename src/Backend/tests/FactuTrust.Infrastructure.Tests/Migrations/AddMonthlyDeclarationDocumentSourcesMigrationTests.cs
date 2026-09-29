using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Verrouille le contrat de la migration qui prépare le retrait du calcul historique de la
/// déclaration mensuelle : valeurs documentaires des rubriques et origine du calcul des dépôts.
///
/// <para>
/// Ce qui ne se voit pas à la relecture d'un diff, et qui casserait le retour arrière ou les
/// dépôts existants :
/// </para>
/// <list type="number">
///   <item>un <c>CalculationOrigin</c> sans défaut SQL : l'image précédente, qui n'écrit pas la
///   colonne, ne pourrait plus insérer de déclaration ;</item>
///   <item>des colonnes de rubrique non nullables : l'image précédente ne pourrait plus créer de
///   rubrique ;</item>
///   <item>un rétro-remplissage qui repasserait à 0 ou qui se déduirait de la présence de lignes
///   (un dépôt en contrôle de parité en porte, avec des montants historiques) ;</item>
///   <item>un <c>UPDATE</c> compilé dans le lot qui ajoute la colonne — erreur « nom de colonne
///   non valide » au premier passage.</item>
/// </list>
///
/// Assertions sur le TEXTE SOURCE : aucun serveur SQL requis.
/// </summary>
public sealed class AddMonthlyDeclarationDocumentSourcesMigrationTests
{
    private const string MigrationId = "20260925100000_AddMonthlyDeclarationDocumentSources_Tenant";

    /// <summary>Chemin absolu depuis la racine du dépôt (bin/Debug|Release/net8.0 ⇒ 7 niveaux au-dessus).</summary>
    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static string MigrationSource() =>
        ReadRequired(RepoRelativePath(
            "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant", $"{MigrationId}.cs"));

    private static string IdempotentScript() =>
        ReadRequired(RepoRelativePath(
            "docs", "runbooks", "sql", "AddMonthlyDeclarationDocumentSources_Tenant.idempotent.sql"));

    private static string ReadRequired(string path)
    {
        Assert.True(File.Exists(path), $"Fichier introuvable : {path}");
        return File.ReadAllText(path);
    }

    private static string UpSection(string source)
    {
        var up = source.IndexOf("protected override void Up", StringComparison.Ordinal);
        var down = source.IndexOf("protected override void Down", StringComparison.Ordinal);
        Assert.True(up >= 0 && down > up, "Up puis Down attendus.");
        return source[up..down];
    }

    [Fact]
    public void Migration_carries_the_expected_identity()
    {
        var source = MigrationSource();

        Assert.Contains("[DbContext(typeof(TenantDbContext))]", source);
        Assert.Contains($"[Migration(\"{MigrationId}\")]", source);
    }

    [Theory]
    [InlineData("GrossDocumentSource")]
    [InlineData("WithheldDocumentSource")]
    public void Rubric_columns_are_nullable_and_guarded(string column)
    {
        foreach (var text in new[] { UpSection(MigrationSource()), IdempotentScript() })
        {
            Assert.Contains($"COL_LENGTH(N'dbo.MonthlyDeclarationRubrics', N'{column}') IS NULL", text);
            Assert.Contains($"ADD [{column}] int NULL", text);
        }
    }

    [Fact]
    public void Calculation_origin_has_a_sql_default_of_historic()
    {
        foreach (var text in new[] { UpSection(MigrationSource()), IdempotentScript() })
        {
            Assert.Contains("COL_LENGTH(N'dbo.VatDeclarations', N'CalculationOrigin') IS NULL", text);
            Assert.Contains("ADD [CalculationOrigin] int NOT NULL", text);
            Assert.Contains("CONSTRAINT [DF_VatDeclarations_CalculationOrigin] DEFAULT (0)", text);
        }
    }

    /// <summary>
    /// Même règle que <c>ResolveModeFor</c> : mode configuré, mois au moins égal à la date de
    /// bascule. Et le rétro-remplissage ne fait que monter à 1, pour rester rejouable.
    /// </summary>
    [Fact]
    public void Backfill_follows_the_configured_mode_and_only_moves_to_configured()
    {
        foreach (var text in new[] { UpSection(MigrationSource()), IdempotentScript() })
        {
            Assert.Contains("SET v.[CalculationOrigin] = 1", text);
            Assert.Contains("s.[Mode] = 2", text);
            Assert.Contains("DATEFROMPARTS(v.[Year], v.[Month], 1) >= CAST(s.[ConfiguredSince] AS date)", text);
            Assert.Contains("v.[CalculationOrigin] = 0", text);
            Assert.DoesNotContain("SET v.[CalculationOrigin] = 0", text);
            Assert.DoesNotContain("VatDeclarationLines", text);
        }
    }

    /// <summary>
    /// La migration EF envoie tout en un lot : l'UPDATE doit être différé par EXEC, sinon SQL
    /// Server le compile avant que la colonne n'existe. Le script manuel, lui, sépare par GO.
    /// </summary>
    [Fact]
    public void Backfill_is_compiled_after_the_column_exists()
    {
        var up = UpSection(MigrationSource());
        var addColumn = up.IndexOf("ADD [CalculationOrigin]", StringComparison.Ordinal);
        var exec = up.IndexOf("EXEC(N'", StringComparison.Ordinal);
        var update = up.IndexOf("UPDATE v", StringComparison.Ordinal);

        Assert.True(addColumn >= 0 && exec > addColumn && update > exec,
            "Le rétro-remplissage doit suivre l'ajout de la colonne, dans un EXEC.");

        var script = IdempotentScript();
        var go = script.IndexOf("GO", script.IndexOf("ADD [CalculationOrigin]", StringComparison.Ordinal), StringComparison.Ordinal);
        Assert.True(go >= 0 && go < script.IndexOf("UPDATE v", StringComparison.Ordinal),
            "Le script manuel doit séparer l'ajout de la colonne et le rétro-remplissage par GO.");
    }

    [Fact]
    public void Down_removes_the_default_constraint_with_the_column()
    {
        var source = MigrationSource();
        var down = source[source.IndexOf("protected override void Down", StringComparison.Ordinal)..];

        Assert.Contains("DROP CONSTRAINT [DF_VatDeclarations_CalculationOrigin]", down);
        Assert.Contains("DROP COLUMN [WithheldDocumentSource]", down);
        Assert.Contains("DROP COLUMN [GrossDocumentSource]", down);
    }
}
