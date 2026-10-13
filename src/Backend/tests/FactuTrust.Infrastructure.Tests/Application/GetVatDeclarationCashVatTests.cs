using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.FiscalSchedule;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Application.Features.WithholdingTax.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using FactuTrust.Infrastructure.Services;
using FluentAssertions;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using FactuTrust.Infrastructure.Tests.Fakes;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Contribution caisse à la déclaration TVA (plan §6.7) : <c>GetPostedCashSaleVatByRateAsync</c>
/// alimente <c>CollectedVat19/13/7</c> et <c>CollectedVatBreakdown</c>, jamais gardée par le flag
/// TVA (seule la création l'est), sans écrêtage des contributions négatives (extourne), et sans
/// jamais toucher aux bases facturières (<c>SalesTaxableBase</c>/<c>SalesGrossBase</c>/<c>Tcl</c>).
/// </summary>
public sealed class GetVatDeclarationCashVatTests
{
    private static Mock<ITenantCompanySummaryProvider> CreateTenantSummaryMock()
    {
        var mock = new Mock<ITenantCompanySummaryProvider>();
        mock.Setup(p => p.GetCurrentTenantSummaryAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TenantCompanySummaryDto
            {
                CompanyName = "Ma Société SARL",
                Nif = "1234567/A/B/C/000",
                TaxRegimeDisplay = "Régime réel",
                TradeName = "Commerce"
            });
        return mock;
    }

    private static PayrollDeclarationContributionProvider CreatePayrollProvider()
    {
        var runs = new Mock<IPayrollRunRepository>();
        runs.Setup(r => r.GetByPeriodAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PayrollRun?)null);
        var settings = new Mock<IPayrollParametersRepository>();
        settings.Setup(r => r.GetByFiscalYearAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PayrollYearParameters?)null);
        return new PayrollDeclarationContributionProvider(runs.Object, settings.Object);
    }

    /// <summary>
    /// Fabrique un handler avec une base facturière fixe (1000 HT / 190 TVA @19%) et un mock du
    /// dépôt journal configurable pour la contribution caisse.
    /// </summary>
    private static GetVatDeclarationQueryHandler BuildHandler(
        IReadOnlyList<CashSaleVatPosting>? cashVat,
        bool cashVatSetup = true,
        decimal invoiceVat19 = 190m,
        decimal invoiceHt19 = 1000m)
    {
        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        journals.Setup(r => r.SumDebitsByAccountPrefixAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        if (cashVatSetup)
        {
            journals.Setup(r => r.GetPostedCashSaleVatByRateAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(cashVat!); // null autorisé intentionnellement : simule un mock non configuré (cf. test JournalRepositoryReturnsNull)
        }

        return BuildHandlerCore(journals.Object, vatRepo.Object, invoiceVat19, invoiceHt19);
    }

    /// <summary>
    /// Cœur commun de fabrique de <see cref="GetVatDeclarationQueryHandler"/> : base facturière
    /// fixe (mediator) + invoices/supplierInvoices fixes ; seuls <paramref name="journals"/> et
    /// <paramref name="vatRepo"/> sont injectables (mock caisse pur, ou dépôt journal RÉEL branché
    /// sur une base InMemory pour les tests d'édition cabinet ci-dessous, plan §6.7/tâche 6).
    /// </summary>
    private static GetVatDeclarationQueryHandler BuildHandlerCore(
        IJournalEntryRepository journals,
        IVatDeclarationRepository vatRepo,
        decimal invoiceVat19 = 190m,
        decimal invoiceHt19 = 1000m)
    {
        var mediator = new Mock<IMediator>();
        var salesRows = new List<SalesVatReportRowDto>();
        if (invoiceVat19 != 0m || invoiceHt19 != 0m)
        {
            salesRows.Add(new() { VatRatePercent = 19, VatRateDisplay = "19 %", TotalVatAmount = invoiceVat19, TotalTaxableAmount = invoiceHt19, Currency = "TND" });
        }
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(salesRows));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2026, 7, new(), 0m, 0m, 0));

        var invoices = new Mock<IInvoiceRepository>();
        invoices.Setup(r => r.SumFodecTaxableBaseAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1000m);
        invoices.Setup(r => r.SumFodecAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        invoices.Setup(r => r.SumFiscalStampAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var settings = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = true,
            FodecRatePercent = 1.0m,
            TclRatePercent = 0.2m
        });

        return new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo, journals, invoices.Object, supplierInvoices.Object,
            CreateTenantSummaryMock().Object, CreatePayrollProvider(), MonthlyDeclarationTestComposer.Inactive(settings), settings);
    }

    // ── Édition cabinet (plan v3, tâche 6, niveau query) ─────────────────────
    // Dépôt journal RÉEL (InMemory) branché sur GetVatDeclarationQueryHandler : la contribution
    // caisse doit suivre les lignes ÉDITÉES par le cabinet, en respectant la distinction
    // Declared/Live (plan §1.3/D2) : une déclaration déposée en `Declared` ne bouge jamais toute
    // seule ; seule la valorisation `Live` (tableau de bord, sauvegarde) suit immédiatement.

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;
        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;

        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }

    private static ITenantDbContextFactory CreateFactory() =>
        new TestTenantDbContextFactory($"GetVatDeclarationCashVatTestDb_{Guid.NewGuid()}");

    /// <summary>Mock <see cref="ICurrentUser"/> minimal : seul <see cref="IsAccountingFirmDelegatedContext"/> est paramétrable.</summary>
    private sealed class FakeCurrentUser : ICurrentUser
    {
        public bool IsAccountingFirmDelegatedContext { get; set; }
        public Guid? UserId => null;
        public string? Email => "comptable@cabinet.tn";
        public Guid? TenantId => null;
        public UserRole? Role => null;
        public bool IsAuthenticated => true;
        public bool HasPermission(string permission) => true;
        public Guid? PortalClientId => null;
        public bool IsClientPortal => false;
        public string? IpAddress => null;
        public string? UserAgent => null;
    }

    /// <summary>Modèle : <c>ValidatePurchaseReceiptCommandHandlerTests.cs</c> — pas de transaction,
    /// l'atomicité réelle est prouvée par les tests SQL (tâche 5, hors périmètre ici).</summary>
    private sealed class PassthroughTenantUnitOfWork : ITenantUnitOfWork
    {
        public Task<Result> ExecuteAsync(
            Func<CancellationToken, Task<Result>> action,
            CancellationToken cancellationToken = default)
            => action(cancellationToken);

        public Task<Result<T>> ExecuteAsync<T>(
            Func<CancellationToken, Task<Result<T>>> action,
            CancellationToken cancellationToken = default)
            => action(cancellationToken);
    }

    /// <summary>Période comptable réelle requise par <c>GetByIdForUpdateAsync</c> (Include AccountingPeriod).</summary>
    private static AccountingPeriod SeedPeriod(ITenantDbContextFactory factory, int year, int month)
    {
        var start = new DateTime(year, month, 1);
        var period = AccountingPeriod.Create(year, month, start, start.AddMonths(1).AddDays(-1));
        period.SetAuditInfo("test", false);
        using var ctx = factory.CreateContext();
        ctx.AccountingPeriods.Add(period);
        ctx.SaveChanges();
        return period;
    }

    private static CashOperation SeedCashSalesOperation(VatRate? vatRate, int sequence = 1, decimal amount = 119m)
    {
        var number = CashOperationNumber.Create(CashOperationNumber.CreditPrefix, 2026, sequence).Value;
        return CashOperation.Create(
            number,
            CashOperationType.Credit,
            new DateTime(2026, 3, 10),
            PaymentMethod.Cash,
            Money.Create(amount, "TND"),
            "Encaissement ventes au comptant",
            revenueCategory: CashRevenueCategory.CashSalesReceipt,
            vatRate: vatRate).Value;
    }

    /// <summary>Écriture caisse à 3 lignes (débit trésorerie TTC / crédit 707 HT / crédit 436711 TVA).</summary>
    private static JournalEntry CashSaleEntry(
        int entryNumber, DateTime date, decimal ht, decimal vat, Guid sourceOperationId, Guid accountingPeriodId,
        JournalEntryStatus status = JournalEntryStatus.Brouillon)
    {
        var lines = new[]
        {
            new JournalLineInput("5411", "Caisse", ht + vat, 0, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Ventes HT", 0, ht, null, ThirdPartyKind.None),
            new JournalLineInput("436711", "TVA collectée", 0, vat, null, ThirdPartyKind.None)
        };

        return JournalEntry.Create(
            entryNumber, "JC", date, "Encaissement ventes au comptant", accountingPeriodId,
            isAutoGenerated: true, sourceEntityType: "CashOperation", sourceEntityId: sourceOperationId,
            lineInputs: lines, initialStatus: status).Value;
    }

    private static async Task SeedAsync(
        ITenantDbContextFactory factory, IEnumerable<CashOperation> operations, IEnumerable<JournalEntry> entries)
    {
        await using var context = factory.CreateContext();
        context.CashOperations.AddRange(operations);
        context.JournalEntries.AddRange(entries);
        await context.SaveChangesAsync();
    }

    private static UpdateDraftJournalEntryCommandHandler BuildUpdateHandler(
        ITenantDbContextFactory factory, IJournalEntryRepository repository, bool isFirm = true)
    {
        var lettering = new LetteringService(factory, new TenantAmbientTransaction());
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string acc, CancellationToken _) =>
                ChartOfAccount.Create(acc, $"Compte {acc}", int.Parse(acc[..1]), null, AccountNatureType.Debit).Value);
        return new UpdateDraftJournalEntryCommandHandler(
            repository, chart.Object, ExistingThirdParties.Clients().Object, ExistingThirdParties.Suppliers().Object, new Mock<IAuditService>().Object,
            new FakeCurrentUser { IsAccountingFirmDelegatedContext = isFirm },
            lettering,
            new PassthroughTenantUnitOfWork(),
            new FakeExchangeRateResolver(),
            NullLogger<UpdateDraftJournalEntryCommandHandler>.Instance);
    }

    private static UpdateDraftJournalEntryRequest CashRequest(decimal ht, decimal vat, string label) => new()
    {
        Label = label,
        Lines = new[]
        {
            new ManualJournalLineRequest { AccountNumber = "5411", LineLabel = "Caisse", Debit = ht + vat, Credit = 0m },
            new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Ventes HT", Debit = 0m, Credit = ht },
            new ManualJournalLineRequest { AccountNumber = "436711", LineLabel = "TVA collectée", Debit = 0m, Credit = vat }
        }
    };

    private static Mock<IVatDeclarationRepository> VatRepoMock(VatDeclaration? existing)
    {
        var mock = new Mock<IVatDeclarationRepository>();
        mock.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(existing);
        return mock;
    }

    /// <summary>
    /// Fabrique <see cref="SaveVatDeclarationCommandHandler"/> avec un <c>IMediator</c> qui relaie
    /// <see cref="GetVatDeclarationQuery"/> vers le VRAI <paramref name="queryHandler"/> (évite
    /// d'enregistrer tout le pipeline MediatR) et <c>DeclarationScheduleSyncEnabled=false</c> pour
    /// que la synchro d'échéancier reste un no-op garanti (mocks lâches suffisants).
    /// </summary>
    private static SaveVatDeclarationCommandHandler BuildSaveHandler(
        GetVatDeclarationQueryHandler queryHandler, IVatDeclarationRepository vatRepo)
    {
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(m => m.Send(It.IsAny<GetVatDeclarationQuery>(), It.IsAny<CancellationToken>()))
            .Returns((GetVatDeclarationQuery q, CancellationToken ct) => queryHandler.Handle(q, ct));

        var settings = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = true,
            DeclarationScheduleSyncEnabled = false
        });
        var sync = new DeclarationScheduleSynchronizer(
            Mock.Of<IFiscalScheduleRepository>(),
            Mock.Of<ITunisianFiscalDeadlineService>(),
            settings,
            NullLogger<DeclarationScheduleSynchronizer>.Instance);

        return new SaveVatDeclarationCommandHandler(
            vatRepo, mediator.Object, new Mock<IAuditService>().Object,
            new FakeCurrentUser { IsAccountingFirmDelegatedContext = true },
            settings, sync, NullLogger<SaveVatDeclarationCommandHandler>.Instance);
    }

    [Fact]
    public async Task EditedCashDraft_NoSavedDeclaration_DeclaredEqualsLive_WithEditedAmounts()
    {
        var factory = CreateFactory();
        var period = SeedPeriod(factory, 2026, 3);
        var op = SeedCashSalesOperation(VatRate.Standard);
        var draft = CashSaleEntry(1, new DateTime(2026, 3, 10), ht: 100m, vat: 19m, sourceOperationId: op.Id,
            accountingPeriodId: period.Id);
        await SeedAsync(factory, [op], [draft]);

        var repository = new JournalEntryRepository(factory);
        var editResult = await BuildUpdateHandler(factory, repository).Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, CashRequest(200m, 38m, "Corrigé par le cabinet")),
            CancellationToken.None);
        Assert.True(editResult.IsSuccess, editResult.Error?.Description);

        var vatRepo = VatRepoMock(existing: null);
        var queryHandler = BuildHandlerCore(repository, vatRepo.Object);

        var declared = await queryHandler.Handle(new GetVatDeclarationQuery(2026, 3), CancellationToken.None);
        var live = await queryHandler.Handle(
            new GetVatDeclarationQuery(2026, 3, Valuation: VatDeclarationValuation.Live), CancellationToken.None);

        declared.IsSuccess.Should().BeTrue();
        live.IsSuccess.Should().BeTrue();
        // Facturier (190 @19%) + caisse éditée (38, ht=200) = 228 ; aucune déclaration enregistrée
        // → Declared == Live (plan §1.3).
        declared.Value.CollectedVat19.Should().Be(228m);
        live.Value.CollectedVat19.Should().Be(228m);
    }

    [Fact]
    public async Task EditedCashDraft_SavedDraftDeclaration_DeclaredKeepsRecordedAmounts_LiveShowsEditedAmounts()
    {
        var factory = CreateFactory();
        var period = SeedPeriod(factory, 2026, 3);
        var op = SeedCashSalesOperation(VatRate.Standard);
        var draft = CashSaleEntry(1, new DateTime(2026, 3, 10), ht: 100m, vat: 19m, sourceOperationId: op.Id,
            accountingPeriodId: period.Id);
        await SeedAsync(factory, [op], [draft]);
        var repository = new JournalEntryRepository(factory);

        // Déclaration en brouillon enregistrée AVANT l'édition, avec les montants alors exacts
        // (190 facturier + 19 caisse = 209).
        var existing = VatDeclaration.CreateDraft(
            2026, 3,
            Money.Create(209m, "TND"), Money.Zero("TND"), Money.Zero("TND"),
            Money.Zero("TND"), Money.Zero("TND"), Money.Zero("TND"), "TND");
        var vatRepo = VatRepoMock(existing);
        var queryHandler = BuildHandlerCore(repository, vatRepo.Object);

        // Le cabinet édite le brouillon caisse APRÈS le dépôt du brouillon de déclaration.
        var editResult = await BuildUpdateHandler(factory, repository).Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, CashRequest(200m, 38m, "Corrigé par le cabinet")),
            CancellationToken.None);
        Assert.True(editResult.IsSuccess, editResult.Error?.Description);

        var declaredBefore = await queryHandler.Handle(new GetVatDeclarationQuery(2026, 3), CancellationToken.None);
        var liveAfterEdit = await queryHandler.Handle(
            new GetVatDeclarationQuery(2026, 3, Valuation: VatDeclarationValuation.Live), CancellationToken.None);

        // Le dépôt existant fait foi en `Declared` : il ne bouge PAS derrière le dos de
        // l'utilisateur malgré l'édition (plan §1.3).
        declaredBefore.Value.CollectedVat19.Should().Be(209m);
        // `Live` (recalcul, sauvegarde/tableau de bord) suit immédiatement les lignes éditées.
        liveAfterEdit.Value.CollectedVat19.Should().Be(228m);

        // Un nouvel enregistrement (non rectificatif) rafraîchit le brouillon EN PLACE.
        var saveHandler = BuildSaveHandler(queryHandler, vatRepo.Object);
        var saveResult = await saveHandler.Handle(
            new SaveVatDeclarationCommand(new SaveVatDeclarationRequest { Year = 2026, Month = 3, Submit = false, IsRectificative = false }),
            CancellationToken.None);
        Assert.True(saveResult.IsSuccess, saveResult.Error?.Description);
        existing.RevisionNumber.Should().Be(1); // pas une rectificative
        existing.Status.Should().Be(VatDeclarationStatus.Draft);

        var declaredAfterSave = await queryHandler.Handle(new GetVatDeclarationQuery(2026, 3), CancellationToken.None);
        declaredAfterSave.Value.CollectedVat19.Should().Be(228m);
    }

    [Fact]
    public async Task EditedCashDraft_SubmittedDeclaration_DeclaredUnchanged_SaveWithoutRectificativeRejected()
    {
        var factory = CreateFactory();
        var period = SeedPeriod(factory, 2026, 3);
        var op = SeedCashSalesOperation(VatRate.Standard);
        var draft = CashSaleEntry(1, new DateTime(2026, 3, 10), ht: 100m, vat: 19m, sourceOperationId: op.Id,
            accountingPeriodId: period.Id);
        await SeedAsync(factory, [op], [draft]);
        var repository = new JournalEntryRepository(factory);

        var existing = VatDeclaration.CreateDraft(
            2026, 3,
            Money.Create(209m, "TND"), Money.Zero("TND"), Money.Zero("TND"),
            Money.Zero("TND"), Money.Zero("TND"), Money.Zero("TND"), "TND");
        existing.Submit();
        var vatRepo = VatRepoMock(existing);
        var queryHandler = BuildHandlerCore(repository, vatRepo.Object);

        var editResult = await BuildUpdateHandler(factory, repository).Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, CashRequest(200m, 38m, "Corrigé par le cabinet")),
            CancellationToken.None);
        Assert.True(editResult.IsSuccess, editResult.Error?.Description);

        var declaredAfterEdit = await queryHandler.Handle(new GetVatDeclarationQuery(2026, 3), CancellationToken.None);
        declaredAfterEdit.Value.CollectedVat19.Should().Be(209m); // déclaration soumise : inchangée

        var saveHandler = BuildSaveHandler(queryHandler, vatRepo.Object);
        var saveResult = await saveHandler.Handle(
            new SaveVatDeclarationCommand(new SaveVatDeclarationRequest { Year = 2026, Month = 3, Submit = false, IsRectificative = false }),
            CancellationToken.None);

        saveResult.IsFailure.Should().BeTrue();
        saveResult.Error.Description.Should().Contain("déjà soumise");
        saveResult.Error.Description.Should().Contain("Rectificative");

        var declaredAfterRejectedSave = await queryHandler.Handle(new GetVatDeclarationQuery(2026, 3), CancellationToken.None);
        declaredAfterRejectedSave.Value.CollectedVat19.Should().Be(209m); // ni l'édition ni la tentative de save ne l'ont modifiée
    }

    [Fact]
    public async Task Handle_CashVatContribution_IncreasesCollectedVatByRateAndBreakdown()
    {
        var cashVat = new List<CashSaleVatPosting>
        {
            new(19, 100.000m, 19.000m),
            new(13, 10.000m, 1.300m),
            new(7, 10.000m, 0.700m)
        };
        var handler = BuildHandler(cashVat);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        var dto = result.Value;

        // Facturier (190 @19%) + caisse : 190 + 19 = 209 ; 0 + 1.3 = 1.3 ; 0 + 0.7 = 0.7.
        dto.CollectedVat19.Should().Be(209.000m);
        dto.CollectedVat13.Should().Be(1.300m);
        dto.CollectedVat7.Should().Be(0.700m);

        dto.CollectedVatBreakdown.Should().HaveCount(3);
        var b19 = dto.CollectedVatBreakdown.Single(b => b.RatePercent == 19);
        b19.TaxableBase.Should().Be(1100.000m); // 1000 facturier + 100 caisse
        b19.VatAmount.Should().Be(209.000m);

        var b13 = dto.CollectedVatBreakdown.Single(b => b.RatePercent == 13);
        b13.TaxableBase.Should().Be(10.000m);
        b13.VatAmount.Should().Be(1.300m);

        var b7 = dto.CollectedVatBreakdown.Single(b => b.RatePercent == 7);
        b7.TaxableBase.Should().Be(10.000m);
        b7.VatAmount.Should().Be(0.700m);
    }

    [Fact]
    public async Task Handle_CashVatContribution_DoesNotChangeSalesBasesOrTcl()
    {
        var withoutCash = await BuildHandler([]).Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);
        var withCash = await BuildHandler(new List<CashSaleVatPosting> { new(19, 100.000m, 19.000m) })
            .Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        withoutCash.IsSuccess.Should().BeTrue();
        withCash.IsSuccess.Should().BeTrue();

        // Bases facturières et TCL strictement inchangées malgré la contribution caisse (plan §6.7).
        withCash.Value.SalesTaxableBase.Should().Be(withoutCash.Value.SalesTaxableBase);
        withCash.Value.SalesGrossBase.Should().Be(withoutCash.Value.SalesGrossBase);
        withCash.Value.Tcl.Should().Be(withoutCash.Value.Tcl);

        withoutCash.Value.SalesTaxableBase.Should().Be(1000m);
        withoutCash.Value.SalesGrossBase.Should().Be(1190m);
    }

    [Fact]
    public async Task Handle_NegativeCashVatContribution_DecreasesCollectedVatWithoutClamping()
    {
        var cashVat = new List<CashSaleVatPosting> { new(19, -100.000m, -19.000m) };
        var handler = BuildHandler(cashVat);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        // 190 (facturier) − 19 (extourne caisse) = 171, aucun écrêtage à zéro.
        result.Value.CollectedVat19.Should().Be(171.000m);

        var b19 = result.Value.CollectedVatBreakdown.Single(b => b.RatePercent == 19);
        b19.TaxableBase.Should().Be(900.000m);
        b19.VatAmount.Should().Be(171.000m);
    }

    /// <summary>
    /// Bug corrigé (revue de code) : sans TVA facturière pour compenser une extourne caisse, le
    /// NET recalculé (<c>ComputeLiveAsync</c>) est négatif. <c>Money.Create</c> rejetterait ce
    /// montant à la construction — le calcul doit rester en <c>Money.FromSignedAmount</c> pour ce
    /// mouvement et ne pas lever d'exception.
    /// </summary>
    [Fact]
    public async Task Handle_NoInvoiceVatAndNegativeCashContribution_ReturnsNegativeCollectedVatWithoutThrowing()
    {
        var cashVat = new List<CashSaleVatPosting> { new(19, -100.000m, -19.000m) };
        var handler = BuildHandler(cashVat, invoiceVat19: 0m, invoiceHt19: 0m);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.CollectedVat19.Should().Be(-19.000m);
        result.Value.CollectedVat13.Should().Be(0m);
        result.Value.CollectedVat7.Should().Be(0m);

        var b19 = result.Value.CollectedVatBreakdown.Single(b => b.RatePercent == 19);
        b19.TaxableBase.Should().Be(-100.000m);
        b19.VatAmount.Should().Be(-19.000m);
    }

    [Fact]
    public async Task Handle_JournalRepositoryReturnsNull_DoesNotCrashAndContributesNothing()
    {
        var handler = BuildHandler(null);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.CollectedVat19.Should().Be(190.000m);
        result.Value.CollectedVat13.Should().Be(0m);
        result.Value.CollectedVat7.Should().Be(0m);
    }
}
