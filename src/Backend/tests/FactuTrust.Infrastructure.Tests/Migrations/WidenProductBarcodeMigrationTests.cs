using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Verrouille le contrat de la migration qui élargit <c>Products.Barcode</c>.
///
/// <para>
/// Trois défauts de cette migration bloqueraient le tenant au démarrage
/// (<c>TenantMigrationGuard</c> → 503 <c>TENANT_MIGRATION_FAILED</c>), et aucun ne se voit à
/// la relecture d'un diff :
/// </para>
/// <list type="number">
///   <item><c>ALTER COLUMN</c> sans supprimer d'abord l'index filtré, dont le prédicat
///   référence la colonne (erreur SQL 5074) ;</item>
///   <item>un <c>CREATE UNIQUE INDEX</c> glissé par mégarde, alors que le parc n'a pas encore
///   été balayé pour les doublons ;</item>
///   <item>un <c>Down</c> qui rétrécit la colonne sans vérifier qu'aucune valeur ne dépasse
///   13 caractères, donc qui tronque.</item>
/// </list>
///
/// Assertions sur le TEXTE SOURCE : aucun serveur SQL requis.
/// </summary>
public sealed class WidenProductBarcodeMigrationTests
{
    private const string MigrationId = "20260918120000_WidenProductBarcode_Tenant";

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
            "docs", "runbooks", "sql", "WidenProductBarcode_Tenant.idempotent.sql"));

    private static string ReadRequired(string path)
    {
        Assert.True(File.Exists(path), $"Fichier introuvable : {path}");
        return File.ReadAllText(path);
    }

    [Fact]
    public void Migration_carries_the_expected_identity()
    {
        var source = MigrationSource();

        Assert.Contains("[DbContext(typeof(TenantDbContext))]", source);
        Assert.Contains($"[Migration(\"{MigrationId}\")]", source);
    }

    [Fact]
    public void Up_drops_the_filtered_index_before_altering_the_column()
    {
        // Le prédicat [Barcode] IS NOT NULL crée une dépendance de schéma sur la colonne :
        // un ALTER COLUMN sans DROP préalable échoue (erreur 5074).
        var source = MigrationSource();

        var dropIndex = source.IndexOf("DROP INDEX [IX_Products_Barcode]", StringComparison.Ordinal);
        var alterColumn = source.IndexOf("ALTER COLUMN [Barcode] nvarchar(48) NULL", StringComparison.Ordinal);

        Assert.True(dropIndex >= 0, "Le Up doit supprimer IX_Products_Barcode.");
        Assert.True(alterColumn >= 0, "Le Up doit élargir la colonne en nvarchar(48).");
        Assert.True(dropIndex < alterColumn, "Le DROP INDEX doit précéder l'ALTER COLUMN.");
    }

    [Fact]
    public void Up_recreates_the_index_with_its_filter_behind_an_independent_guard()
    {
        var source = MigrationSource();

        Assert.Contains("CREATE INDEX [IX_Products_Barcode]", source);
        Assert.Contains("WHERE [Barcode] IS NOT NULL", source);
        Assert.Contains("IF NOT EXISTS (", source);
        Assert.Contains("FROM sys.indexes", source);
    }

    [Fact]
    public void Up_is_guarded_on_the_current_column_width_so_a_replay_is_inert()
    {
        // nvarchar(48) => max_length = 96. Rejouer la migration sur une base déjà élargie ne
        // doit ni supprimer ni recréer quoi que ce soit.
        var source = MigrationSource();

        Assert.Contains("[max_length] < 96", source);
    }

    [Fact]
    public void Migration_never_creates_a_unique_index()
    {
        // Doctrine : aucun index UNIQUE tant que le parc n'a pas été balayé — une migration
        // UNIQUE en échec bloque le tenant au démarrage.
        // Voir docs/runbooks/invoice-number-uniqueness.md.
        Assert.DoesNotContain("CREATE UNIQUE INDEX", MigrationSource());
        Assert.DoesNotContain("CREATE UNIQUE INDEX", IdempotentScript());
    }

    [Fact]
    public void Down_refuses_to_shrink_the_column_when_a_value_would_be_truncated()
    {
        var source = MigrationSource();

        Assert.Contains("LEN([Barcode]) > 13", source);
        Assert.Contains("ALTER COLUMN [Barcode] nvarchar(13) NULL", source);
    }

    [Fact]
    public void Idempotent_script_matches_the_migration_and_registers_the_history_row()
    {
        var script = IdempotentScript();

        Assert.Contains("[max_length] < 96", script);
        Assert.Contains("ALTER COLUMN [Barcode] nvarchar(48) NULL", script);
        Assert.Contains("DROP INDEX [IX_Products_Barcode]", script);
        Assert.Contains("CREATE INDEX [IX_Products_Barcode]", script);
        Assert.Contains($"WHERE [MigrationId] = N'{MigrationId}'", script);
        Assert.Contains($"VALUES (N'{MigrationId}', N'8.0.1')", script);
    }

    [Fact]
    public void Context_and_snapshot_agree_on_the_new_column_width()
    {
        // Le snapshot du contexte tenant est édité à la main (il est désynchronisé de
        // l'historique des migrations, cf. docs/backend-tenant-migrations.md). Rien ne
        // garantit donc sa cohérence avec la configuration du contexte, sinon ce test.
        var context = ReadRequired(RepoRelativePath(
            "src", "Backend", "FactuTrust.Infrastructure", "Persistence", "TenantDbContext.cs"));
        var snapshot = ReadRequired(RepoRelativePath(
            "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant",
            "TenantDbContextModelSnapshot.cs"));

        Assert.Contains(".HasColumnName(\"Barcode\")", context);
        Assert.Contains(".HasMaxLength(48)", context);

        Assert.Contains(".HasColumnType(\"nvarchar(48)\")", snapshot);
        Assert.DoesNotContain(".HasColumnType(\"nvarchar(13)\")", snapshot);
    }
}
