using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.FiscalSchedule;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// SaveVatDeclarationCommandHandler : un brouillon existant est re-enregistrable/soumettable EN PLACE
/// (sans rectificative) ; une déclaration soumise n'accepte qu'une rectificative V2 (sinon Conflict
/// avec message clair) ; la création reste inchangée. Écriture réservée au cabinet délégué.
/// </summary>
public sealed class SaveVatDeclarationCommandTests
{
    private const string Tnd = "TND";
    private readonly Mock<IVatDeclarationRepository> _repo = new();
    private readonly Mock<IMediator> _mediator = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ICurrentUser> _currentUser = new();

    public SaveVatDeclarationCommandTests()
    {
        _currentUser.SetupGet(u => u.Email).Returns("comptable@cabinet.tn");
        _currentUser.SetupGet(u => u.IsAccountingFirmDelegatedContext).Returns(true);
    }

    private static VatDeclarationDto Dto(decimal vatDue = 800m, decimal collectedVat19 = 1000m) => new()
    {
        Year = 2026,
        Month = 7,
        CollectedVat19 = collectedVat19,
        CollectedVat13 = 0m,
        CollectedVat7 = 0m,
        DeductibleVatGoods = 200m,
        DeductibleVatAssets = 0m,
        PreviousCredit = 0m,
        VatDue = vatDue,
        Currency = Tnd
    };

    private static VatDeclaration Draft() => VatDeclaration.CreateDraft(
        2026, 7,
        Money.Create(1000m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
        Money.Create(200m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd), Tnd);

    private SaveVatDeclarationCommandHandler BuildHandler(bool v2 = true, VatDeclarationDto? dto = null)
    {
        _mediator
            .Setup(m => m.Send(It.IsAny<GetVatDeclarationQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(dto ?? Dto()));

        var settings = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = v2,
            DeclarationScheduleSyncEnabled = false // synchro échéancier no-op (couverte ailleurs)
        });

        var sync = new DeclarationScheduleSynchronizer(
            Mock.Of<IFiscalScheduleRepository>(),
            Mock.Of<ITunisianFiscalDeadlineService>(),
            settings,
            NullLogger<DeclarationScheduleSynchronizer>.Instance);

        return new SaveVatDeclarationCommandHandler(
            _repo.Object, _mediator.Object, _audit.Object, _currentUser.Object,
            settings, sync, NullLogger<SaveVatDeclarationCommandHandler>.Instance);
    }

    private static SaveVatDeclarationCommand Command(bool submit = false, bool rectificative = false) =>
        new(new SaveVatDeclarationRequest { Year = 2026, Month = 7, Submit = submit, IsRectificative = rectificative });

    // ── Création (non-régression) ──────────────────────────────────────────

    [Fact]
    public async Task NoExisting_Submit_CreatesSubmittedDeclaration()
    {
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);
        VatDeclaration? added = null;
        _repo.Setup(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()))
            .Callback<VatDeclaration, CancellationToken>((d, _) => added = d)
            .ReturnsAsync((VatDeclaration d, CancellationToken _) => d);

        var result = await BuildHandler().Handle(Command(submit: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(added);
        Assert.Equal(VatDeclarationStatus.Submitted, added!.Status);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>
    /// Garde-fou : la sauvegarde doit réclamer la valorisation LIVE. En mode « déclaré » (défaut de
    /// la query), elle réécrirait le dépôt existant sur lui-même et la TVA d'un brouillon ne se
    /// rafraîchirait plus jamais depuis les écritures.
    /// </summary>
    [Fact]
    public async Task Save_RequestsLiveValuation_SoVatKeepsRefreshingFromLedger()
    {
        var existing = Draft();
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var result = await BuildHandler().Handle(Command(submit: false), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _mediator.Verify(
            m => m.Send(
                It.Is<GetVatDeclarationQuery>(q => q.Valuation == VatDeclarationValuation.Live),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    /// <summary>
    /// Mouvements signés caisse (plan §6.7 / v2.1) : une extourne sans TVA facturière compensatrice
    /// peut rendre le CollectedVat19 recalculé NÉGATIF pour la période. Money.Create rejetterait ce
    /// montant à la construction — la sauvegarde doit persister le NET signé sans lever d'exception
    /// (seul VatDue/CreditToCarry, dérivés du net global, reste garanti non négatif).
    /// </summary>
    [Fact]
    public async Task NoExisting_NegativeCollectedVat19_CreatesDraftWithoutThrowing()
    {
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);
        VatDeclaration? added = null;
        _repo.Setup(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()))
            .Callback<VatDeclaration, CancellationToken>((d, _) => added = d)
            .ReturnsAsync((VatDeclaration d, CancellationToken _) => d);

        var negativeDto = Dto(vatDue: 0m, collectedVat19: -19.000m);
        var result = await BuildHandler(dto: negativeDto).Handle(Command(submit: false), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(added);
        Assert.Equal(-19.000m, added!.CollectedVat19.Amount);
    }

    // ── Brouillon existant : le bug de départ ──────────────────────────────

    [Fact]
    public async Task ExistingDraft_NegativeCollectedVat19_UpdatesInPlaceWithoutThrowing()
    {
        var existing = Draft();
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var negativeDto = Dto(vatDue: 0m, collectedVat19: -19.000m);
        var result = await BuildHandler(dto: negativeDto).Handle(Command(submit: false), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(-19.000m, existing.CollectedVat19.Amount);
        _repo.Verify(r => r.UpdateAsync(existing, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ExistingDraft_ReSave_Succeeds_UpdatesInPlace_NoRectificative()
    {
        var existing = Draft();
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var result = await BuildHandler().Handle(Command(submit: false), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, existing.RevisionNumber);           // pas de bump
        Assert.False(existing.IsRectificative);
        Assert.Equal(VatDeclarationStatus.Draft, existing.Status);
        _repo.Verify(r => r.UpdateAsync(existing, It.IsAny<CancellationToken>()), Times.Once);
        _repo.Verify(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ExistingDraft_Submit_Succeeds_MarksSubmitted_NoVersionBump()
    {
        var existing = Draft();
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var result = await BuildHandler().Handle(Command(submit: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(VatDeclarationStatus.Submitted, existing.Status);
        Assert.Equal(1, existing.RevisionNumber);
        Assert.False(existing.IsRectificative);
    }

    [Fact]
    public async Task ExistingDraft_V1FlagOff_StillSaves()
    {
        var existing = Draft();
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var result = await BuildHandler(v2: false).Handle(Command(submit: true), CancellationToken.None);

        Assert.True(result.IsSuccess); // le !v2 ne bloque plus un brouillon
        Assert.Equal(VatDeclarationStatus.Submitted, existing.Status);
    }

    // ── Déclaration déjà soumise ───────────────────────────────────────────

    [Fact]
    public async Task ExistingSubmitted_ReSubmit_WithoutRectificative_Conflicts()
    {
        var existing = Draft();
        existing.Submit();
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var result = await BuildHandler().Handle(Command(submit: true, rectificative: false), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("déjà soumise", result.Error.Description);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ExistingSubmitted_Rectificative_BumpsVersion_AndResubmits()
    {
        var existing = Draft();
        existing.Submit();
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var result = await BuildHandler().Handle(Command(submit: true, rectificative: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, existing.RevisionNumber);
        Assert.True(existing.IsRectificative);
        Assert.Equal(VatDeclarationStatus.Submitted, existing.Status); // ApplyRevision → Draft puis Submit
        _repo.Verify(r => r.UpdateAsync(existing, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ExistingSubmitted_Rectificative_NegativeCollectedVat19_AppliesWithoutThrowing()
    {
        var existing = Draft();
        existing.Submit();
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var negativeDto = Dto(vatDue: 0m, collectedVat19: -19.000m);
        var result = await BuildHandler(dto: negativeDto)
            .Handle(Command(submit: true, rectificative: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(-19.000m, existing.CollectedVat19.Amount);
        Assert.Equal(2, existing.RevisionNumber);
        Assert.True(existing.IsRectificative);
    }

    [Fact]
    public async Task CompanyUser_Save_IsForbidden_DoesNotTouchRepository()
    {
        _currentUser.SetupGet(u => u.IsAccountingFirmDelegatedContext).Returns(false);

        var result = await BuildHandler().Handle(Command(submit: true), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Forbidden", result.Error.Code);
        Assert.Equal(VatDeclarationAccess.WriteDeniedMessage, result.Error.Description);
        _repo.Verify(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
        _repo.Verify(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
        _mediator.Verify(m => m.Send(It.IsAny<GetVatDeclarationQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Famille incluse sans rubrique applicable ──────────────────────────

    private static VatDeclarationDto WithMissingRubric(MonthlyDeclarationMode mode, params MonthlyDeclarationFamily[] families) =>
        Dto() with
        {
            MonthlyDeclarationMode = (int)mode,
            MonthlyDeclarationDiagnostics = families
                .Select(f => new MonthlyDeclarationDiagnosticDto
                {
                    Kind = (int)RubricDiagnosticKind.MissingRubricForFamily,
                    Detail = f.ToString()
                })
                .ToList()
        };

    /// <summary>
    /// Une famille incluse sans rubrique produirait un zéro que rien ne signalerait une fois déposé.
    /// Le refus était annoncé par l'écran et par la documentation, jamais appliqué côté serveur.
    /// </summary>
    [Fact]
    public async Task Periode_configuree_avec_famille_sans_rubrique_refuse_l_enregistrement_et_n_ecrit_rien()
    {
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var result = await BuildHandler(dto: WithMissingRubric(
                MonthlyDeclarationMode.Configured, MonthlyDeclarationFamily.Tfp, MonthlyDeclarationFamily.StampDuty))
            .Handle(Command(submit: true), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("« T.F.P »", result.Error.Description);
        Assert.Contains("« Droit de timbre »", result.Error.Description);
        _repo.Verify(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>
    /// Deux rubriques qui reprennent la même source déclareraient le montant deux fois : la
    /// période configurée n'est pas enregistrable tant que la configuration n'est pas corrigée.
    /// </summary>
    [Fact]
    public async Task Periode_configuree_avec_double_lecture_refuse_l_enregistrement()
    {
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var dto = Dto() with
        {
            MonthlyDeclarationMode = (int)MonthlyDeclarationMode.Configured,
            MonthlyDeclarationDiagnostics = new[]
            {
                new MonthlyDeclarationDiagnosticDto
                {
                    Kind = (int)RubricDiagnosticKind.DuplicateSourceRead,
                    Detail = "La rubrique F1_1 reprendrait « IRPP retenu par la paie », déjà reprise par la rubrique F1_1B."
                }
            }
        };

        var result = await BuildHandler(dto: dto).Handle(Command(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("F1_1B", result.Error.Description);
        _repo.Verify(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>
    /// L'origine du calcul est consignée au dépôt : c'est elle, et non le régime actuel du
    /// dossier, qui dira plus tard d'où viennent les montants. Le contrôle de parité reste
    /// historique : ses montants le sont.
    /// </summary>
    [Theory]
    [InlineData(MonthlyDeclarationMode.Configured, DeclarationCalculationOrigin.Configured)]
    [InlineData(MonthlyDeclarationMode.Parity, DeclarationCalculationOrigin.Historic)]
    [InlineData(MonthlyDeclarationMode.Legacy, DeclarationCalculationOrigin.Historic)]
    public async Task L_enregistrement_consigne_l_origine_du_calcul(
        MonthlyDeclarationMode mode, DeclarationCalculationOrigin expected)
    {
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);
        VatDeclaration? added = null;
        _repo.Setup(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()))
            .Callback<VatDeclaration, CancellationToken>((d, _) => added = d)
            .ReturnsAsync((VatDeclaration d, CancellationToken _) => d);

        var result = await BuildHandler(dto: Dto() with { MonthlyDeclarationMode = (int)mode })
            .Handle(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(expected, added!.CalculationOrigin);
    }

    /// <summary>
    /// Hors mode configuré, la famille sans rubrique retombe sur le calcul historique : aucun zéro,
    /// donc aucune raison de refuser.
    /// </summary>
    [Theory]
    [InlineData(MonthlyDeclarationMode.Legacy)]
    [InlineData(MonthlyDeclarationMode.Parity)]
    public async Task Hors_mode_configure_la_famille_sans_rubrique_ne_bloque_pas(MonthlyDeclarationMode mode)
    {
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var result = await BuildHandler(dto: WithMissingRubric(mode, MonthlyDeclarationFamily.Tfp))
            .Handle(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
    }

    /// <summary>
    /// Déclaration mensuelle unique éteinte : seule la TVA est déposée. Les familles et le détail du
    /// moteur ne doivent pas être écrits — l'indentation le laissait croire, l'absence d'accolades
    /// les écrivait quand même.
    /// </summary>
    [Fact]
    public async Task V2_eteinte_n_ecrit_ni_les_familles_du_moteur_ni_le_detail()
    {
        _repo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);
        VatDeclaration? added = null;
        _repo.Setup(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()))
            .Callback<VatDeclaration, CancellationToken>((d, _) => added = d)
            .ReturnsAsync((VatDeclaration d, CancellationToken _) => d);

        var dto = Dto() with
        {
            HotelTax = 45m,
            Lines = new[]
            {
                new MonthlyDeclarationLineDto
                {
                    Code = "F8_1", Label = "Taxe hôtelière", Family = (int)MonthlyDeclarationFamily.HotelTax,
                    ReportCode = "1", Gross = 2_250m, Withheld = 45m
                }
            }
        };

        var result = await BuildHandler(v2: false, dto: dto).Handle(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0m, added!.HotelTax);
        Assert.Empty(added.Lines);
    }
}
