using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Instantané du détail par rubrique d'une déclaration déposée. Ce qui est vérifié ici est une seule
/// propriété, mais c'est la plus coûteuse à perdre : un document déposé ne bouge plus, quoi qu'il
/// advienne ensuite de la configuration qui l'a produit.
/// </summary>
public sealed class VatDeclarationLineSnapshotTests
{
    private static MonthlyDeclarationLineDto Computed(
        string code = "F9_3_1",
        string label = "Le chiffre d'affaires brut local",
        MonthlyDeclarationFamily family = MonthlyDeclarationFamily.Tcl,
        string reportCode = "3.1",
        decimal gross = 3_255.000m,
        decimal withheld = 6.510m,
        bool requiresManualInput = false) => new()
        {
            RubricId = Guid.NewGuid(),
            Code = code,
            Label = label,
            Family = (int)family,
            ReportCode = reportCode,
            Gross = gross,
            Withheld = withheld,
            RatePercentApplied = 0.2m,
            RequiresManualInput = requiresManualInput
        };

    private static VatDeclaration Draft() => VatDeclaration.CreateDraft(
        2026, 9,
        Money.FromSignedAmount(1_900m, Money.DefaultCurrency),
        Money.FromSignedAmount(130m, Money.DefaultCurrency),
        Money.FromSignedAmount(70m, Money.DefaultCurrency),
        Money.Create(500m, Money.DefaultCurrency),
        Money.Create(120m, Money.DefaultCurrency),
        Money.Zero(Money.DefaultCurrency));

    [Fact]
    public void Le_gel_reporte_le_detail_calcule_ligne_a_ligne()
    {
        var frozen = MonthlyDeclarationLineSnapshot.Freeze(new[] { Computed() });

        var line = Assert.Single(frozen);
        Assert.Equal("F9_3_1", line.RubricCode);
        Assert.Equal("Le chiffre d'affaires brut local", line.Label);
        Assert.Equal(MonthlyDeclarationFamily.Tcl, line.Family);
        Assert.Equal("3.1", line.ReportCode);
        Assert.Equal(3_255.000m, line.GrossAmount);
        Assert.Equal(6.510m, line.WithheldAmount);
        Assert.Equal(VatDeclarationLineOrigin.Computed, line.Origin);
        Assert.False(line.DivergesFromComputed);
    }

    /// <summary>
    /// Une rubrique « Fixe » sans constante attend une saisie : la ligne déposée doit porter cette
    /// origine, sans quoi un zéro à remplir deviendrait un zéro déclaré.
    /// </summary>
    [Fact]
    public void Une_ligne_en_attente_de_saisie_est_marquee_comme_telle()
    {
        var frozen = MonthlyDeclarationLineSnapshot.Freeze(
            new[] { Computed(gross: 0m, withheld: 0m, requiresManualInput: true) });

        Assert.Equal(VatDeclarationLineOrigin.Manual, Assert.Single(frozen).Origin);
    }

    [Fact]
    public void Le_gel_conserve_l_ordre_d_affichage()
    {
        var frozen = MonthlyDeclarationLineSnapshot.Freeze(new[]
        {
            Computed(code: "F1_1"),
            Computed(code: "F1_3"),
            Computed(code: "F1_4_1")
        });

        Assert.Equal(new[] { 0, 1, 2 }, frozen.Select(l => l.DisplayOrder));
        Assert.Equal(new[] { "F1_1", "F1_3", "F1_4_1" }, frozen.Select(l => l.RubricCode));
    }

    /// <summary>
    /// Le détail est informatif, les scalaires font foi : une ligne mal formée est écartée sans
    /// faire échouer le dépôt. Refuser une déclaration entière parce qu'un code déborde serait hors
    /// de proportion.
    /// </summary>
    [Fact]
    public void Une_ligne_mal_formee_est_ecartee_sans_faire_echouer_le_depot()
    {
        var frozen = MonthlyDeclarationLineSnapshot.Freeze(new[]
        {
            Computed(code: "F1_1"),
            Computed(code: "")
        });

        Assert.Equal("F1_1", Assert.Single(frozen).RubricCode);
    }

    [Fact]
    public void Le_detail_negatif_n_est_pas_ecrete()
    {
        var frozen = MonthlyDeclarationLineSnapshot.Freeze(
            new[] { Computed(gross: -500.000m, withheld: -50.000m) });

        var line = Assert.Single(frozen);
        Assert.Equal(-500.000m, line.GrossAmount);
        Assert.Equal(-50.000m, line.WithheldAmount);
    }

    // ── L'invariant décisif ───────────────────────────────────────────────────

    /// <summary>
    /// <b>Le test qui justifie toute la dénormalisation.</b> Une rubrique renommée, dont le taux
    /// change et que l'on finit par supprimer, ne doit rien changer au document déjà déposé.
    /// Conserver seulement un identifiant de rubrique ferait dépendre l'édition d'une déclaration
    /// de janvier de l'état présent de la configuration.
    /// </summary>
    [Fact]
    public void Une_ligne_deposee_survit_au_renommage_puis_a_la_suppression_de_sa_rubrique()
    {
        var rubric = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.Tcl, "F9_3_1", "Le chiffre d'affaires brut local", "3.1",
            RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0.2m, null, null, null, null, null, null,
            new[] { new RubricAccountInput(RubricAccountRole.Gross, "707", RubricAccountMatchMode.Prefix) }).Value;

        var declaration = Draft();
        declaration.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(new[]
        {
            Computed() with { RubricId = rubric.Id }
        }));

        // La configuration évolue : libellé, code rapport et taux changent.
        rubric.Update(
            "Chiffre d'affaires brut local (LF 2027)", "3.2",
            RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0.5m, null, null, null, null, null, null,
            new[] { new RubricAccountInput(RubricAccountRole.Gross, "706", RubricAccountMatchMode.Prefix) },
            0);

        var deposited = Assert.Single(declaration.Lines);
        Assert.Equal("Le chiffre d'affaires brut local", deposited.Label);
        Assert.Equal("3.1", deposited.ReportCode);
        Assert.Equal(0.2m, deposited.RatePercentApplied);
        Assert.Equal(6.510m, deposited.WithheldAmount);
    }

    /// <summary>
    /// Une rectificative produit un nouveau détail ; c'est <c>RevisionNumber</c> qui distingue les
    /// versions, pas un empilement de lignes.
    /// </summary>
    [Fact]
    public void Une_rectificative_remplace_le_detail_et_ne_l_empile_pas()
    {
        var declaration = Draft();
        declaration.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(new[]
        {
            Computed(code: "F9_3_1", withheld: 6.510m)
        }));

        declaration.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(new[]
        {
            Computed(code: "F9_3_1", withheld: 7.000m),
            Computed(code: "F9_3_2", withheld: 1.250m)
        }));

        Assert.Equal(2, declaration.Lines.Count);
        Assert.Equal(7.000m, declaration.Lines.Single(l => l.RubricCode == "F9_3_1").WithheldAmount);
    }

    [Fact]
    public void Les_lignes_sont_rattachees_a_leur_declaration()
    {
        var declaration = Draft();
        declaration.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(new[] { Computed() }));

        Assert.All(declaration.Lines, l => Assert.Equal(declaration.Id, l.VatDeclarationId));
    }

    [Fact]
    public void Un_detail_vide_laisse_la_declaration_sans_ligne()
    {
        var declaration = Draft();
        declaration.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(Array.Empty<MonthlyDeclarationLineDto>()));

        Assert.Empty(declaration.Lines);
    }

    // ── Relecture ─────────────────────────────────────────────────────────────

    [Fact]
    public void La_relecture_restitue_le_detail_depose_sans_repasser_par_le_calcul()
    {
        var declaration = Draft();
        declaration.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(new[]
        {
            Computed(code: "F1_3", withheld: 2.000m),
            Computed(code: "F1_1", withheld: 1.000m)
        }));

        var read = MonthlyDeclarationLineSnapshot.Read(declaration.Lines);

        // L'ordre d'affichage figé au dépôt est celui qui ressort, pas l'ordre alphabétique.
        Assert.Equal(new[] { "F1_3", "F1_1" }, read.Select(l => l.Code));
        Assert.Equal(2.000m, read[0].Withheld);
    }
}
