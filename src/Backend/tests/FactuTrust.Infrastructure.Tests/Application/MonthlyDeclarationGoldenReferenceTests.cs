using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// <b>References dorees de la declaration mensuelle.</b> Ce que le calcul <b>cable</b> produisait
/// sur la periode « pleine » de juillet 2026, fige avant son retrait — et ce que la configuration
/// doit continuer de produire.
/// </summary>
/// <remarks>
/// <para>
/// Sans ces constantes, la preuve de non-regression disparaitrait avec le code qu'elle mesure : une
/// fois le calcul historique supprime, plus rien ne dirait quels montants la declaration portait.
/// Les valeurs ci-dessous ont ete relevees sur le commit <c>b59bfc2c</c>, calcul historique en
/// place, et ne doivent plus bouger.
/// </para>
/// <para>
/// Le catalogue v2 est construit <b>directement</b> depuis sa ressource embarquee, jamais par
/// l'amorcage v1 suivi d'une montee : la preuve doit survivre a la suppression de ce code.
/// </para>
/// </remarks>
public sealed class MonthlyDeclarationGoldenReferenceTests
{
    // -- Montants de la periode « pleine » (juillet 2026) ----------------------

    private const decimal Fodec = 10m;
    private const decimal DroitTimbre = 12m;
    private const decimal Tcl = 2.38m;
    private const decimal Tfp = 1.68m;
    private const decimal Foprolos = 1.68m;
    private const decimal WithholdingTax = 205m;
    private const decimal ConsumptionDuty = 0m;
    private const decimal HotelTax = 0m;
    private const decimal LicenceFee = 0m;
    private const decimal TotalToPay = 365.74m;
    private const decimal VatDue = 133m;
    private const decimal CreditToCarry = 0m;

    /// <summary>
    /// Les 77 cases du formulaire officiel, telles que le calcul historique les tamponne. Une case
    /// vide s'ecrit « VIDE ».
    /// </summary>
    private const string GoldenBoxes =
        """
        Check.Foprolos=X
        Check.OtherDuties=X
        Check.StampDuty=X
        Check.Tcl=X
        Check.Tfp=X
        Check.Vat=X
        Check.Withholding=X
        Fodec.Amount=10,000
        Fodec.Base=1 000,000
        Foprolos.Amount=1,680
        Foprolos.Base=168,000
        Header.CategoryCode=C
        Header.DeclarationCode=0
        Header.Month.D1=0
        Header.Month.D2=7
        Header.Nif.D1=1
        Header.Nif.D2=2
        Header.Nif.D3=3
        Header.Nif.D4=4
        Header.Nif.D5=5
        Header.Nif.D6=6
        Header.Nif.D7=7
        Header.Nif.D8=A
        Header.VatCode=B
        Header.Year.D1=2
        Header.Year.D2=0
        Header.Year.D3=2
        Header.Year.D4=6
        Identity.Address1=VIDE
        Identity.Address2=VIDE
        Identity.Name=Ma Société SARL
        Recap.Foprolos.Due=1,680
        Recap.Foprolos.Principal=1,680
        Recap.Foprolos.Total=1,680
        Recap.OtherDuties.Due=10,000
        Recap.OtherDuties.Principal=10,000
        Recap.OtherDuties.Total=10,000
        Recap.StampDuty.Due=12,000
        Recap.StampDuty.Principal=12,000
        Recap.StampDuty.Total=12,000
        Recap.Tcl.Due=2,380
        Recap.Tcl.Principal=2,380
        Recap.Tcl.Total=2,380
        Recap.Tfp.Due=1,680
        Recap.Tfp.Principal=1,680
        Recap.Tfp.Total=1,680
        Recap.Total.Deduction=VIDE
        Recap.Total.Due=365,740
        Recap.Total.Principal=365,740
        Recap.Total.Total=365,740
        Recap.Vat.Due=133,000
        Recap.Vat.Principal=133,000
        Recap.Vat.Total=133,000
        Recap.Withholding.Due=205,000
        Recap.Withholding.Principal=205,000
        Recap.Withholding.Total=205,000
        Tfp.Manufacturing.Amount=1,680
        Tfp.Manufacturing.Base=168,000
        Tfp.Remainder=1,680
        Tfp.Total=1,680
        Vat.PreviousCredit=VIDE
        Vat.Purchase.OtherLocal.Base=300,000
        Vat.Purchase.OtherLocal.Deductible=57,000
        Vat.Rate13.Due=VIDE
        Vat.Rate19.Base=1 000,000
        Vat.Rate19.Due=190,000
        Vat.Rate7.Due=VIDE
        Vat.Remainder=133,000
        Vat.Total.Deductible=57,000
        Vat.Total.Due=190,000
        Withholding.Line1.Amount=25,500
        Withholding.Line1.Base=150,000
        Withholding.Line3.Amount=4,500
        Withholding.Line3.Base=150,000
        Withholding.Line4Individuals.Amount=135,000
        Withholding.Line4Individuals.Base=1 350,000
        Withholding.Total=205,000
        """;

    private static readonly IReadOnlyList<WithholdingReportByCategoryDto> NoWithholdingRows =
        Array.Empty<WithholdingReportByCategoryDto>();

    // -- Outils partages -------------------------------------------------------

    /// <summary>
    /// Le catalogue v2 tel qu'une configuration de dossier le porte, construit depuis la ressource
    /// embarquee. Le taux de la rubrique TCL est celui de la plateforme, comme a la pose.
    /// </summary>
    internal static IReadOnlyList<MonthlyDeclarationRubric> V2Rubrics(decimal tclRatePercent = 0.2m)
    {
        var rubrics = new List<MonthlyDeclarationRubric>();
        foreach (var draft in MonthlyDeclarationCatalogs.V2.Rubrics)
        {
            var target = draft.Code == MonthlyDeclarationCatalogV2.TclRubricCode
                ? draft with { RatePercent = tclRatePercent }
                : draft;

            var created = MonthlyDeclarationCatalogV2.Create(target);
            Assert.True(
                created.IsSuccess,
                $"Rubrique {target.Code} refusee par le domaine : {(created.IsFailure ? created.Error.Description : null)}");
            rubrics.Add(created.Value);
        }

        return rubrics;
    }

    /// <summary>Loyers de la periode « pleine » : 1 350 au debit du 613.</summary>
    private static Dictionary<string, AccountPeriodMovement> RichPeriodMovements() =>
        new(StringComparer.Ordinal) { ["613000"] = new(Debit: 1_350m, Credit: 0m) };

    private static MonthlyDeclarationLineComposer ConfiguredV2(IOptions<AccountingSettings> settings) =>
        MonthlyDeclarationTestComposer.ConfiguredWithMovements(
            new Mock<IMonthlyDeclarationConfigRepository>(), settings, V2Rubrics(), RichPeriodMovements(),
            Enum.GetValues<MonthlyDeclarationFamily>());

    private static async Task<VatDeclarationDto> RichPeriodAsync(
        Func<IOptions<AccountingSettings>, MonthlyDeclarationLineComposer>? composer = null,
        VatDeclaration? saved = null,
        VatDeclarationValuation valuation = VatDeclarationValuation.Live)
    {
        var settings = GetVatDeclarationV2Tests.RichPeriodSettings();
        var handler = GetVatDeclarationV2Tests.CreateRichPeriodHandler(settings, saved, composer);

        var result = await handler.Handle(
            new GetVatDeclarationQuery(2026, 7, Valuation: valuation), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        return result.Value;
    }

    /// <summary>Les cases du formulaire, triees, une par ligne — comparables d'un coup d'oeil.</summary>
    private static string Canonical(IReadOnlyDictionary<string, string?> boxes) =>
        string.Join(
            Environment.NewLine,
            boxes.OrderBy(b => b.Key, StringComparer.Ordinal)
                .Select(b => $"{b.Key}={b.Value ?? "VIDE"}"));

    private static string GoldenBoxText =>
        string.Join(Environment.NewLine, GoldenBoxes.Split('\n').Select(l => l.TrimEnd('\r')));

    private static void AssertGoldenAmounts(VatDeclarationDto d)
    {
        Assert.Equal(Fodec, d.Fodec);
        Assert.Equal(DroitTimbre, d.DroitTimbre);
        Assert.Equal(Tcl, d.Tcl);
        Assert.Equal(Tfp, d.Tfp);
        Assert.Equal(Foprolos, d.Foprolos);
        Assert.Equal(WithholdingTax, d.WithholdingTax);
        Assert.Equal(ConsumptionDuty, d.ConsumptionDuty);
        Assert.Equal(HotelTax, d.HotelTax);
        Assert.Equal(LicenceFee, d.LicenceFee);
        Assert.Equal(TotalToPay, d.TotalToPay);
        Assert.Equal(VatDue, d.VatDue);
        Assert.Equal(CreditToCarry, d.CreditToCarry);
    }

    // -- La periode « pleine » : montants et cases ------------------------------

    /// <summary>
    /// <b>La preuve du chantier.</b> Le catalogue v2 reproduit le calcul historique au millime,
    /// famille par famille — c'est ce qui autorise a retirer l'historique sans changer un montant.
    /// </summary>
    [Fact]
    public async Task Le_catalogue_v2_rend_les_montants_dores() =>
        AssertGoldenAmounts(await RichPeriodAsync(ConfiguredV2));

    /// <summary>
    /// Le catalogue v2 tamponne les memes cases que l'historique. Une regression de montant qui se
    /// compenserait entre deux familles se verrait ici, case par case.
    /// </summary>
    [Fact]
    public async Task Le_catalogue_v2_rend_les_cases_dorees()
    {
        var configured = await RichPeriodAsync(ConfiguredV2);

        Assert.Equal(
            GoldenBoxText,
            Canonical(MonthlyDeclarationOfficialFormInputs.Values(configured, NoWithholdingRows)));
    }

    /// <summary>
    /// <b>La preuve de bout en bout.</b> Non plus le catalogue lu depuis sa ressource, mais la
    /// configuration telle que la POSE l'ecrit reellement en base, relue puis evaluee. C'est la
    /// chaine complete — pose, lecture, composition, remontee, formulaire — confrontee a ce que le
    /// calcul cable produisait.
    /// </summary>
    [Fact]
    public async Task La_configuration_posee_en_base_rend_les_montants_et_les_cases_dores()
    {
        var name = $"DmGolden_{Guid.NewGuid()}";
        var options = new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options;

        await using (var context = new TenantDbContext(options))
        {
            var reset = await MonthlyDeclarationCatalogReset.EnsureAppliedAsync(
                context, new MonthlyDeclarationCatalogOptions(TclRatePercent: 0.2m));
            Assert.Equal(MonthlyDeclarationCatalogResetOutcome.Applied, reset.Outcome);
        }

        List<MonthlyDeclarationRubric> posed;
        await using (var context = new TenantDbContext(options))
        {
            posed = await context.MonthlyDeclarationRubrics
                .Include(r => r.Accounts)
                .Where(r => r.IsActive)
                .ToListAsync();
        }

        var declaration = await RichPeriodAsync(
            settings => MonthlyDeclarationTestComposer.ConfiguredWithMovements(
                new Mock<IMonthlyDeclarationConfigRepository>(), settings, posed, RichPeriodMovements(),
                Enum.GetValues<MonthlyDeclarationFamily>()));

        AssertGoldenAmounts(declaration);
        Assert.Equal(
            GoldenBoxText,
            Canonical(MonthlyDeclarationOfficialFormInputs.Values(declaration, NoWithholdingRows)));
    }

    // -- Reimpression d'un depot : ce qui ne doit jamais changer ----------------

    /// <summary>Un depot de la periode « pleine », aux montants historiques, sans aucune ligne.</summary>
    private static VatDeclaration SavedWithoutLines(DeclarationCalculationOrigin origin)
    {
        var saved = VatDeclaration.CreateDraft(
            2026, 7,
            Money.Create(190m, "TND"), Money.Zero("TND"), Money.Zero("TND"),
            Money.Create(57m, "TND"), Money.Zero("TND"), Money.Zero("TND"));
        saved.SetAdditionalTaxes(Fodec, DroitTimbre, Tcl, Tfp, Foprolos, WithholdingTax, 0m);
        saved.SetCalculationOrigin(origin);
        return saved;
    }

    /// <summary>
    /// <b>Invariant de reimpression.</b> Un depot sans ligne garde la ventilation de la retenue a la
    /// source par article — salaires, CSS, loyers — reconstituee a l'impression. C'est vrai des
    /// depots du calcul historique comme de ceux d'un dossier « parametre » qui n'avait coche aucune
    /// famille : les deux ont ete calcules par l'historique, et leur formulaire ne doit pas changer.
    /// </summary>
    [Theory]
    [InlineData(DeclarationCalculationOrigin.Historic)]
    [InlineData(DeclarationCalculationOrigin.Configured)]
    public async Task Un_depot_sans_ligne_garde_sa_ventilation_de_retenue(DeclarationCalculationOrigin origin)
    {
        var declared = await RichPeriodAsync(
            ConfiguredV2, SavedWithoutLines(origin), VatDeclarationValuation.Declared);

        Assert.Empty(declared.Lines);

        var boxes = MonthlyDeclarationOfficialFormInputs.Values(declared, NoWithholdingRows);
        Assert.Equal("25,500", boxes["Withholding.Line1.Amount"]);
        Assert.Equal("4,500", boxes["Withholding.Line3.Amount"]);
        Assert.Equal("135,000", boxes["Withholding.Line4Individuals.Amount"]);
        Assert.Equal("205,000", boxes["Withholding.Total"]);
    }

    /// <summary>
    /// A l'inverse, un depot qui porte son propre detail de retenue s'imprime sur ce detail : les
    /// deux ventilations sont exclusives, les faire cohabiter compterait deux fois les memes
    /// montants sur les memes cases.
    /// </summary>
    [Fact]
    public async Task Un_depot_avec_lignes_de_retenue_s_imprime_sur_ses_lignes()
    {
        var live = await RichPeriodAsync(ConfiguredV2);
        var saved = SavedWithoutLines(DeclarationCalculationOrigin.Configured);
        saved.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(live.Lines));

        var declared = await RichPeriodAsync(ConfiguredV2, saved, VatDeclarationValuation.Declared);

        Assert.NotEmpty(declared.Lines);
        Assert.Equal(
            GoldenBoxText,
            Canonical(MonthlyDeclarationOfficialFormInputs.Values(declared, NoWithholdingRows)));
    }
}
