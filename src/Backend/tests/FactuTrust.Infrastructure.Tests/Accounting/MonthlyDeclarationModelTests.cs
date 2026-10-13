using System.Text.Json;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Accounting;

/// <summary>
/// Format d'échange de la configuration DM. Ce qui est vérifié ici, c'est qu'un catalogue
/// d'amorçage et un modèle exporté passent par le <b>même</b> analyseur, et qu'un aller-retour
/// export → import ne perd rien de ce que le comptable a saisi.
/// </summary>
public sealed class MonthlyDeclarationModelTests
{
    private const string MinimalRubric = """
    {
      "rubrics": [
        {
          "code": "F9_TCL",
          "family": "Tcl",
          "label": "T.C.L sur chiffre d'affaires",
          "reportCode": "*",
          "grossKind": "Account",
          "withheldKind": "GrossTimesRate",
          "grossSide": "Credit",
          "withheldSide": "Credit",
          "ratePercent": 0.2,
          "grossAccounts": [{ "number": "70", "mode": "Prefix" }],
          "withheldAccounts": [],
          "displayOrder": 10
        }
      ]
    }
    """;

    // ── Analyse ──────────────────────────────────────────────────────────────

    [Fact]
    public void Un_document_vide_est_refuse()
    {
        Assert.True(MonthlyDeclarationModel.Parse(null).IsFailure);
        Assert.True(MonthlyDeclarationModel.Parse("   ").IsFailure);
    }

    [Fact]
    public void Un_json_malforme_est_refuse_avec_son_motif()
    {
        var parsed = MonthlyDeclarationModel.Parse("{ ceci n'est pas du json");

        Assert.True(parsed.IsFailure);
        Assert.Contains("JSON", parsed.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Un_document_sans_rubrique_est_refuse()
    {
        var parsed = MonthlyDeclarationModel.Parse("""{ "rubrics": [] }""");

        Assert.True(parsed.IsFailure);
    }

    [Fact]
    public void Une_rubrique_minimale_est_lue_et_son_code_normalise()
    {
        var parsed = MonthlyDeclarationModel.Parse(MinimalRubric.Replace("F9_TCL", "f9_tcl"));

        Assert.True(parsed.IsSuccess);
        var draft = Assert.Single(parsed.Value.Rubrics);
        Assert.Equal("F9_TCL", draft.Code);
        Assert.Equal(MonthlyDeclarationFamily.Tcl, draft.Family);
        Assert.Equal(0.2m, draft.RatePercent);
        Assert.Equal(RubricAccountMatchMode.Prefix, Assert.Single(draft.Accounts).MatchMode);
    }

    /// <summary>
    /// Le catalogue embarqué ne dit rien de l'état actif. Le brouillon doit porter « rien dit » et
    /// non « actif » : c'est ce qui empêche un import de catalogue de réactiver une rubrique que le
    /// dossier avait écartée.
    /// </summary>
    [Fact]
    public void Un_document_muet_sur_l_etat_actif_ne_le_decide_pas()
    {
        var parsed = MonthlyDeclarationModel.Parse(MinimalRubric);

        Assert.Null(Assert.Single(parsed.Value.Rubrics).IsActive);
    }

    [Fact]
    public void Une_entree_fautive_est_rejetee_avec_son_code_et_son_motif()
    {
        var parsed = MonthlyDeclarationModel.Parse(
            MinimalRubric.Replace("\"family\": \"Tcl\"", "\"family\": \"Inventee\""));

        Assert.True(parsed.IsSuccess);
        Assert.Empty(parsed.Value.Rubrics);
        var rejected = Assert.Single(parsed.Value.Rejected);
        Assert.Equal("F9_TCL", rejected.Code);
        Assert.Contains("Famille inconnue", rejected.Reason);
    }

    [Fact]
    public void Un_code_present_deux_fois_est_rejete_plutot_qu_ecrase()
    {
        var json = """
        {
          "rubrics": [
            { "code": "A", "family": "Tcl", "label": "Un", "reportCode": "*",
              "grossKind": "Fixed", "withheldKind": "Fixed", "grossSide": "Credit",
              "withheldSide": "Credit", "ratePercent": 0, "fixedGrossAmount": 1,
              "fixedWithheldAmount": 1, "displayOrder": 0 },
            { "code": "A", "family": "Tcl", "label": "Deux", "reportCode": "*",
              "grossKind": "Fixed", "withheldKind": "Fixed", "grossSide": "Credit",
              "withheldSide": "Credit", "ratePercent": 0, "fixedGrossAmount": 2,
              "fixedWithheldAmount": 2, "displayOrder": 1 }
          ]
        }
        """;

        var parsed = MonthlyDeclarationModel.Parse(json);

        Assert.Single(parsed.Value.Rubrics);
        Assert.Contains("deux fois", Assert.Single(parsed.Value.Rejected).Reason);
    }

    [Fact]
    public void Les_inclusions_de_familles_sont_lues_quand_le_fichier_les_porte()
    {
        var json = MinimalRubric.TrimEnd().TrimEnd('}')
            + """, "families": [ { "family": "Tcl", "isIncluded": true } ] }""";

        var parsed = MonthlyDeclarationModel.Parse(json);

        var family = Assert.Single(parsed.Value.Families);
        Assert.Equal(MonthlyDeclarationFamily.Tcl, family.Family);
        Assert.True(family.IsIncluded);
    }

    /// <summary>
    /// La promesse du chantier : un catalogue d'amorçage s'importe tel quel. S'il fallait le
    /// convertir, le format d'échange et le catalogue auraient déjà divergé.
    /// </summary>
    [Fact]
    public void Le_catalogue_embarque_passe_par_le_meme_analyseur_sans_rejet()
    {
        var json = ReadEmbeddedCatalog();

        var parsed = MonthlyDeclarationModel.Parse(json);

        Assert.True(parsed.IsSuccess);
        Assert.Empty(parsed.Value.Rejected);
        Assert.NotEmpty(parsed.Value.Rubrics);
        Assert.Equal("tn-2026-v1", parsed.Value.CatalogVersion);
    }

    // ── Aller-retour ─────────────────────────────────────────────────────────

    /// <summary>
    /// Exporter puis réimporter doit rendre la même configuration. Sans les champs que le catalogue
    /// n'a pas besoin de dire — montants fixes, bornes de période, état actif — l'aller-retour
    /// effacerait en silence ce que le comptable a saisi.
    /// </summary>
    [Fact]
    public void L_aller_retour_conserve_montants_fixes_bornes_et_etat_actif()
    {
        var create = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.HotelTax, "F8_FIX", "Taxe hôtelière forfaitaire", "*",
            RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            ratePercent: 0m, fixedGrossAmount: 1234.567m, fixedWithheldAmount: 89.012m,
            payrollComponent: null, withheldPayrollComponent: null,
            effectiveFrom: new DateTime(2026, 1, 1), effectiveTo: new DateTime(2026, 12, 31),
            accounts: [], displayOrder: 7);
        Assert.True(create.IsSuccess);

        var rubric = create.Value;
        rubric.ToggleActive(); // désactivée par le dossier

        var families = new[]
        {
            MonthlyDeclarationFamilySetting.Create(MonthlyDeclarationFamily.HotelTax, true).Value,
            MonthlyDeclarationFamilySetting.Create(MonthlyDeclarationFamily.Tcl, false).Value
        };

        var json = MonthlyDeclarationModel.Serialize([rubric], families, DateTime.UtcNow);
        var parsed = MonthlyDeclarationModel.Parse(json);

        Assert.True(parsed.IsSuccess);
        Assert.Empty(parsed.Value.Rejected);

        var draft = Assert.Single(parsed.Value.Rubrics);
        Assert.Equal("F8_FIX", draft.Code);
        Assert.Equal(1234.567m, draft.FixedGrossAmount);
        Assert.Equal(89.012m, draft.FixedWithheldAmount);
        Assert.Equal(new DateTime(2026, 1, 1), draft.EffectiveFrom);
        Assert.Equal(new DateTime(2026, 12, 31), draft.EffectiveTo);
        Assert.Equal(7, draft.DisplayOrder);
        Assert.False(draft.IsActive);

        Assert.Equal(2, parsed.Value.Families.Count);
        Assert.True(parsed.Value.Families.Single(f => f.Family == MonthlyDeclarationFamily.HotelTax).IsIncluded);
    }

    /// <summary>
    /// Le modèle ne transporte ni régime de calcul ni état de rampe : les importer ferait basculer
    /// un dossier en calcul paramétré sur la foi d'un fichier.
    /// </summary>
    [Fact]
    public void Le_modele_ne_porte_ni_regime_ni_rampe()
    {
        var rubric = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.Tcl, "F9_TCL", "T.C.L", "*",
            RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0m, 1m, 1m, null, null, null, null, [], 0).Value;

        var json = MonthlyDeclarationModel.Serialize([rubric], [], DateTime.UtcNow);

        using var document = JsonDocument.Parse(json);
        Assert.False(document.RootElement.TryGetProperty("mode", out _));
        Assert.False(document.RootElement.TryGetProperty("parityCleanStreak", out _));
        Assert.False(document.RootElement.TryGetProperty("configuredSince", out _));
    }

    // ── Écriture ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task L_import_insere_puis_ignore_les_codes_deja_presents()
    {
        var name = $"DmModelDb_{Guid.NewGuid()}";
        var drafts = MonthlyDeclarationModel.Parse(MinimalRubric).Value.Rubrics;

        await using (var context = NewContext(name))
        {
            var first = await MonthlyDeclarationConfigWriter.ApplyAsync(
                context, drafts, [], overwrite: false, "tester", CancellationToken.None);
            Assert.Equal(1, first.Value.Inserted);
        }

        await using (var context = NewContext(name))
        {
            var second = await MonthlyDeclarationConfigWriter.ApplyAsync(
                context, drafts, [], overwrite: false, "tester", CancellationToken.None);

            Assert.Equal(0, second.Value.Inserted);
            Assert.Equal(0, second.Value.Replaced);
            Assert.Equal("F9_TCL", Assert.Single(second.Value.SkippedCodes));
        }
    }

    [Fact]
    public async Task L_import_ne_supprime_jamais_une_rubrique_absente_du_fichier()
    {
        var name = $"DmModelDb_{Guid.NewGuid()}";
        await using var context = NewContext(name);

        var other = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.Tfp, "GARDEE", "Rubrique du dossier", "*",
            RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0m, 1m, 1m, null, null, null, null, [], 0).Value;
        context.MonthlyDeclarationRubrics.Add(other);
        await context.SaveChangesAsync();

        var drafts = MonthlyDeclarationModel.Parse(MinimalRubric).Value.Rubrics;
        await MonthlyDeclarationConfigWriter.ApplyAsync(
            context, drafts, [], overwrite: true, "tester", CancellationToken.None);

        Assert.NotNull(await context.MonthlyDeclarationRubrics.FirstOrDefaultAsync(r => r.Code == "GARDEE"));
    }

    /// <summary>
    /// Une source muette sur l'état actif — un catalogue, une duplication — ne doit pas réactiver
    /// une rubrique que le dossier a écartée. C'est la raison d'être du tri-état.
    /// </summary>
    [Fact]
    public async Task Une_source_muette_ne_reactive_pas_une_rubrique_ecartee()
    {
        var name = $"DmModelDb_{Guid.NewGuid()}";
        await using var context = NewContext(name);

        var existing = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.Tcl, "F9_TCL", "T.C.L", "*",
            RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0m, 1m, 1m, null, null, null, null, [], 0).Value;
        existing.ToggleActive();
        Assert.False(existing.IsActive);
        context.MonthlyDeclarationRubrics.Add(existing);
        await context.SaveChangesAsync();

        var drafts = MonthlyDeclarationModel.Parse(MinimalRubric).Value.Rubrics;
        await MonthlyDeclarationConfigWriter.ApplyAsync(
            context, drafts, [], overwrite: true, "tester", CancellationToken.None);

        var reloaded = await context.MonthlyDeclarationRubrics.SingleAsync(r => r.Code == "F9_TCL");
        Assert.False(reloaded.IsActive);
    }

    [Fact]
    public async Task Un_fichier_qui_demande_la_desactivation_est_suivi()
    {
        var name = $"DmModelDb_{Guid.NewGuid()}";
        await using var context = NewContext(name);

        var json = MinimalRubric.Replace("\"displayOrder\": 10", "\"displayOrder\": 10, \"isActive\": false");
        var drafts = MonthlyDeclarationModel.Parse(json).Value.Rubrics;

        await MonthlyDeclarationConfigWriter.ApplyAsync(
            context, drafts, [], overwrite: false, "tester", CancellationToken.None);

        var created = await context.MonthlyDeclarationRubrics.SingleAsync(r => r.Code == "F9_TCL");
        Assert.False(created.IsActive);
    }

    /// <summary>
    /// Une inclusion inchangée n'est pas réécrite : sans quoi l'audit ne distinguerait plus
    /// « importé » de « décidé par le comptable ».
    /// </summary>
    [Fact]
    public async Task Les_inclusions_ne_sont_comptees_que_lorsqu_elles_changent()
    {
        var name = $"DmModelDb_{Guid.NewGuid()}";
        await using var context = NewContext(name);

        context.MonthlyDeclarationFamilySettings.Add(
            MonthlyDeclarationFamilySetting.Create(MonthlyDeclarationFamily.Tcl, isIncluded: true).Value);
        await context.SaveChangesAsync();

        var drafts = MonthlyDeclarationModel.Parse(MinimalRubric).Value.Rubrics;
        var families = new[] { new MonthlyDeclarationFamilyDraft(MonthlyDeclarationFamily.Tcl, true) };

        var unchanged = await MonthlyDeclarationConfigWriter.ApplyAsync(
            context, drafts, families, overwrite: true, "tester", CancellationToken.None);
        Assert.Equal(0, unchanged.Value.FamiliesChanged);

        var flipped = await MonthlyDeclarationConfigWriter.ApplyAsync(
            context, drafts,
            [new MonthlyDeclarationFamilyDraft(MonthlyDeclarationFamily.Tcl, false)],
            overwrite: true, "tester", CancellationToken.None);
        Assert.Equal(1, flipped.Value.FamiliesChanged);
    }

    [Fact]
    public async Task Une_famille_absente_du_fichier_n_est_pas_revoquee()
    {
        var name = $"DmModelDb_{Guid.NewGuid()}";
        await using var context = NewContext(name);

        context.MonthlyDeclarationFamilySettings.Add(
            MonthlyDeclarationFamilySetting.Create(MonthlyDeclarationFamily.Tfp, isIncluded: true).Value);
        await context.SaveChangesAsync();

        var drafts = MonthlyDeclarationModel.Parse(MinimalRubric).Value.Rubrics;
        await MonthlyDeclarationConfigWriter.ApplyAsync(
            context, drafts,
            [new MonthlyDeclarationFamilyDraft(MonthlyDeclarationFamily.Tcl, true)],
            overwrite: true, "tester", CancellationToken.None);

        var tfp = await context.MonthlyDeclarationFamilySettings
            .SingleAsync(f => f.Family == MonthlyDeclarationFamily.Tfp);
        Assert.True(tfp.IsIncluded);
    }

    // ── Valeurs documentaires et jetons (dm-model-v2) ────────────────────────

    private const string DocumentRubric = """
    {
      "rubrics": [
        {
          "code": "F6_1",
          "family": "OtherTurnoverTaxes",
          "label": "FODEC",
          "reportCode": "1",
          "grossKind": "Document",
          "withheldKind": "Document",
          "grossSide": "Credit",
          "withheldSide": "Credit",
          "grossDocumentSource": "FodecFormBase",
          "withheldDocumentSource": "FodecAmount",
          "ratePercent": 0,
          "displayOrder": 10
        }
      ]
    }
    """;

    [Fact]
    public void Les_valeurs_documentaires_sont_lues_par_leur_nom()
    {
        var draft = Assert.Single(MonthlyDeclarationModel.Parse(DocumentRubric).Value.Rubrics);

        Assert.Equal(DeclarationDocumentSource.FodecFormBase, draft.GrossDocumentSource);
        Assert.Equal(DeclarationDocumentSource.FodecAmount, draft.WithheldDocumentSource);
    }

    [Fact]
    public void Les_valeurs_documentaires_font_l_aller_retour_export_import()
    {
        var rubric = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.StampDuty, "F7_1", "Timbre", "*",
            RubricGrossKind.Fixed, RubricWithheldKind.Document,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0m, 0m, null, null, null, null, null, [], 0,
            withheldDocumentSource: DeclarationDocumentSource.FiscalStampAmount).Value;

        var json = MonthlyDeclarationModel.Serialize([rubric], [], DateTime.UtcNow);
        var reread = Assert.Single(MonthlyDeclarationModel.Parse(json).Value.Rubrics);

        Assert.Contains("\"dm-model-v2\"", json);
        Assert.Contains("\"FiscalStampAmount\"", json);
        Assert.Equal(DeclarationDocumentSource.FiscalStampAmount, reread.WithheldDocumentSource);
        Assert.Null(reread.GrossDocumentSource);
    }

    /// <summary>
    /// <c>Enum.TryParse</c> accepte « 42 » et combine « Debit, Credit » : un fichier piégé
    /// produirait une valeur hors liste. Seul le nom exact est admis.
    /// </summary>
    [Theory]
    [InlineData("\"grossKind\": \"Account\"", "\"grossKind\": \"2\"")]
    [InlineData("\"grossKind\": \"Account\"", "\"grossKind\": \"42\"")]
    [InlineData("\"grossSide\": \"Credit\"", "\"grossSide\": \"Debit, Credit\"")]
    [InlineData("\"family\": \"Tcl\"", "\"family\": \"8\"")]
    [InlineData("\"mode\": \"Prefix\"", "\"mode\": \"1\"")]
    public void Un_jeton_numerique_ou_combine_est_refuse(string original, string trapped)
    {
        var parsed = MonthlyDeclarationModel.Parse(MinimalRubric.Replace(original, trapped));

        Assert.True(parsed.IsSuccess);
        Assert.Empty(parsed.Value.Rubrics);
        Assert.Single(parsed.Value.Rejected);
    }

    [Fact]
    public void Une_valeur_documentaire_inconnue_est_refusee()
    {
        var parsed = MonthlyDeclarationModel.Parse(DocumentRubric.Replace("\"FodecAmount\"", "\"103\""));

        Assert.Empty(parsed.Value.Rubrics);
        Assert.Contains("documentaire", Assert.Single(parsed.Value.Rejected).Reason);
    }

    /// <summary>
    /// Un import qui ferait lire deux fois la même source n'écrit rien : la configuration
    /// enregistrée ne doit jamais déclarer un montant deux fois.
    /// </summary>
    [Fact]
    public async Task Un_import_qui_ferait_lire_deux_fois_une_source_n_ecrit_rien()
    {
        var name = $"DmModelDb_{Guid.NewGuid()}";
        await using (var context = NewContext(name))
        {
            context.MonthlyDeclarationRubrics.Add(MonthlyDeclarationRubric.Create(
                MonthlyDeclarationFamily.OtherTurnoverTaxes, "FODEC_DOSSIER", "FODEC", "*",
                RubricGrossKind.Fixed, RubricWithheldKind.Document,
                AccountBalanceSide.Credit, AccountBalanceSide.Credit,
                0m, 0m, null, null, null, null, null, [], 0,
                withheldDocumentSource: DeclarationDocumentSource.FodecAmount).Value);
            await context.SaveChangesAsync();
        }

        await using (var context = NewContext(name))
        {
            var drafts = MonthlyDeclarationModel.Parse(DocumentRubric).Value.Rubrics;
            var applied = await MonthlyDeclarationConfigWriter.ApplyAsync(
                context, drafts, [], overwrite: false, "tester", CancellationToken.None);

            Assert.True(applied.IsFailure);
            Assert.Contains("FODEC_DOSSIER", applied.Error.Description);
        }

        await using (var context = NewContext(name))
        {
            Assert.Equal("FODEC_DOSSIER", (await context.MonthlyDeclarationRubrics.SingleAsync()).Code);
        }
    }

    private static TenantDbContext NewContext(string databaseName) =>
        new(new DbContextOptionsBuilder<TenantDbContext>()
            .UseInMemoryDatabase(databaseName: databaseName)
            .Options);

    private static string ReadEmbeddedCatalog()
    {
        var assembly = typeof(MonthlyDeclarationCatalogs).Assembly;
        var name = assembly.GetManifestResourceNames()
            .First(n => n.EndsWith("monthly-declaration-rubrics-tn.json", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
