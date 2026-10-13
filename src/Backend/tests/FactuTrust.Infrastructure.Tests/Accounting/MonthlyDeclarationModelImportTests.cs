using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Accounting;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Accounting;

/// <summary>
/// Import d'un modèle d'intégration DM, depuis que le catalogue a une v2 : un fichier ancien ne
/// décoche plus le dossier, et un fichier récent ne décoche une famille qu'avec confirmation.
/// </summary>
public sealed class MonthlyDeclarationModelImportTests
{
    private static string File(string? modelVersion, bool includeTfp) => $$"""
    {
      {{(modelVersion is null ? "" : $"\"modelVersion\": \"{modelVersion}\",")}}
      "families": [ { "family": "Tfp", "isIncluded": {{(includeTfp ? "true" : "false")}} } ],
      "rubrics": [
        {
          "code": "F2_1", "family": "Tfp", "label": "Industrie manufacturiere", "reportCode": "1",
          "grossKind": "Payroll", "withheldKind": "GrossTimesRate", "grossSide": "Credit", "withheldSide": "Credit",
          "ratePercent": 1, "payrollComponent": "PayrollTaxBase", "displayOrder": 17
        }
      ]
    }
    """;

    private sealed record Harness(
        ImportMonthlyDeclarationModelCommandHandler Handler,
        Mock<IMonthlyDeclarationModelImporter> Importer);

    private static Harness Build(bool tfpIncluded = true)
    {
        var importer = new Mock<IMonthlyDeclarationModelImporter>();
        importer.Setup(i => i.ImportAsync(
                It.IsAny<IReadOnlyList<MonthlyDeclarationRubricDraft>>(),
                It.IsAny<IReadOnlyList<MonthlyDeclarationFamilyDraft>>(),
                It.IsAny<bool>(), It.IsAny<CancellationToken>(), It.IsAny<MonthlyDeclarationImportUpgrade?>()))
            .ReturnsAsync(Result.Success(new MonthlyDeclarationModelImportOutcome(1, 0, [], [], 0)));

        var config = new Mock<IMonthlyDeclarationConfigRepository>();
        config.Setup(c => c.IsCatalogAppliedAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        config.Setup(c => c.GetRubricsAsync(true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<MonthlyDeclarationRubric>());
        config.Setup(c => c.GetFamilySettingsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { MonthlyDeclarationFamilySetting.Create(MonthlyDeclarationFamily.Tfp, tfpIncluded).Value });

        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.IsAccountingFirmDelegatedContext).Returns(true);
        user.SetupGet(u => u.Email).Returns("comptable@cabinet.tn");

        var settings = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = true,
            TclRatePercent = 0.2m
        });

        return new Harness(
            new ImportMonthlyDeclarationModelCommandHandler(
                importer.Object, config.Object, Mock.Of<IAuditService>(), user.Object, settings),
            importer);
    }

    private static ImportMonthlyDeclarationModelCommand Command(string content, bool confirm = false) =>
        new(new ImportMonthlyDeclarationModelRequest { Content = content, ConfirmFamilyExclusions = confirm });

    /// <summary>
    /// Tout export antérieur à la v2 porte ses familles à « non incluse » : les appliquer décocherait
    /// le dossier entier. Elles sont ignorées, et le compte rendu le dit.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("dm-model-v1")]
    public async Task Un_fichier_ancien_ne_touche_pas_aux_inclusions(string? version)
    {
        var harness = Build();

        var result = await harness.Handler.Handle(Command(File(version, includeTfp: false)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.True(result.Value.FamilyInclusionsIgnored);
        harness.Importer.Verify(i => i.ImportAsync(
            It.IsAny<IReadOnlyList<MonthlyDeclarationRubricDraft>>(),
            It.Is<IReadOnlyList<MonthlyDeclarationFamilyDraft>>(f => f.Count == 0),
            It.IsAny<bool>(), It.IsAny<CancellationToken>(), It.IsAny<MonthlyDeclarationImportUpgrade?>()), Times.Once);
    }

    [Fact]
    public async Task Un_fichier_v2_ne_decoche_une_famille_incluse_qu_avec_confirmation()
    {
        var harness = Build(tfpIncluded: true);

        var refused = await harness.Handler.Handle(Command(File("dm-model-v2", includeTfp: false)), CancellationToken.None);

        Assert.True(refused.IsFailure);
        Assert.Contains("« T.F.P »", refused.Error.Description);
        harness.Importer.VerifyNoOtherCalls();

        var confirmed = await harness.Handler.Handle(
            Command(File("dm-model-v2", includeTfp: false), confirm: true), CancellationToken.None);

        Assert.True(confirmed.IsSuccess);
        harness.Importer.Verify(i => i.ImportAsync(
            It.IsAny<IReadOnlyList<MonthlyDeclarationRubricDraft>>(),
            It.Is<IReadOnlyList<MonthlyDeclarationFamilyDraft>>(f => f.Single().Family == MonthlyDeclarationFamily.Tfp && !f.Single().IsIncluded),
            It.IsAny<bool>(), It.IsAny<CancellationToken>(), It.IsAny<MonthlyDeclarationImportUpgrade?>()), Times.Once);
    }

    [Fact]
    public async Task Un_fichier_v2_qui_coche_ou_laisse_les_familles_passe_sans_confirmation()
    {
        var harness = Build(tfpIncluded: false);

        var result = await harness.Handler.Handle(Command(File("dm-model-v2", includeTfp: false)), CancellationToken.None);

        Assert.True(result.IsSuccess);
    }

    /// <summary>
    /// Un fichier ancien est TOUJOURS passé en v2 : le dossier qui le reçoit porte le catalogue v2,
    /// et y réinjecter des définitions v1 lui ferait déclarer des zéros.
    /// </summary>
    [Fact]
    public async Task Un_fichier_ancien_est_toujours_passe_en_v2()
    {
        var harness = Build();

        await harness.Handler.Handle(Command(File("dm-model-v1", includeTfp: true)), CancellationToken.None);

        harness.Importer.Verify(i => i.ImportAsync(
            It.IsAny<IReadOnlyList<MonthlyDeclarationRubricDraft>>(),
            It.IsAny<IReadOnlyList<MonthlyDeclarationFamilyDraft>>(),
            It.IsAny<bool>(), It.IsAny<CancellationToken>(),
            It.Is<MonthlyDeclarationImportUpgrade?>(u => u != null && u.TclRatePercent == 0.2m)),
            Times.Once);
    }

    // ── Passage v1 → v2 d'un fichier (même règle que la montée) ──────────────

    [Fact]
    public void Un_fichier_egal_au_catalogue_v1_est_importe_en_v2()
    {
        var (rubrics, upgraded) = MonthlyDeclarationCatalogV2.UpgradeDrafts(MonthlyDeclarationCatalogs.V1.Rubrics, 0.2m);

        Assert.Contains(MonthlyDeclarationFamily.Withholding, upgraded);
        Assert.Contains(MonthlyDeclarationFamily.Tfp, upgraded);
        Assert.Equal(RubricWithheldKind.Document, rubrics.Single(r => r.Code == "F6_1").WithheldKind);
        Assert.Contains(rubrics, r => r.Code == "F1_RS_AUTRES");
        Assert.Equal(MonthlyDeclarationCatalogs.V2.Rubrics.Count, rubrics.Count);
    }

    [Fact]
    public void Une_famille_retouchee_dans_le_fichier_reste_telle_quelle()
    {
        var drafts = MonthlyDeclarationCatalogs.V1.Rubrics
            .Select(r => r.Code == "F2_2" ? r with { RatePercent = 2.5m } : r)
            .ToList();

        var (rubrics, upgraded) = MonthlyDeclarationCatalogV2.UpgradeDrafts(drafts, 0.2m);

        Assert.DoesNotContain(MonthlyDeclarationFamily.Tfp, upgraded);
        Assert.Equal(RubricWithheldKind.GrossTimesRate, rubrics.Single(r => r.Code == "F2_1").WithheldKind);
        Assert.Equal(2.5m, rubrics.Single(r => r.Code == "F2_2").RatePercent);
    }

    [Fact]
    public void Un_fichier_partiel_ne_passe_en_v2_que_les_familles_completes()
    {
        var drafts = MonthlyDeclarationCatalogs.V1.Rubrics
            .Where(r => r.Family is MonthlyDeclarationFamily.OtherTurnoverTaxes or MonthlyDeclarationFamily.Tfp)
            .Where(r => r.Code != "F2_2")
            .ToList();

        var (_, upgraded) = MonthlyDeclarationCatalogV2.UpgradeDrafts(drafts, 0.2m);

        Assert.Equal([MonthlyDeclarationFamily.OtherTurnoverTaxes], upgraded);
    }
}
