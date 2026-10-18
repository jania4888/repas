using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Application.Features.Clients.Queries;
using FactuTrust.Application.Features.Suppliers.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Services.DocumentImport;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

public sealed class AccountingEntryProposalServiceTests
{
    private const string OurNif = "9545455/D/F/F/555";

    private sealed record Harness(
        AccountingEntryProposalService Service,
        Mock<IChartOfAccountRepository> Chart,
        Mock<IAccountingPeriodRepository> Periods,
        Mock<IMediator> Mediator);

    private static ChartOfAccount Account(string number, bool active = true)
    {
        var account = ChartOfAccount.Create(
            number, $"Compte {number}", int.Parse(number[..1].ToString()), null, AccountNatureType.Debit).Value;
        if (!active)
            account.ToggleActive();
        return account;
    }

    /// <summary>Compte auxiliaire Client/Fournisseur portant un matricule fiscal, pour (a)/(c).</summary>
    private static ChartOfAccount AuxiliaryAccount(
        string number, string label, AccountType accountType, string? fiscalId = null, bool active = true)
    {
        var account = ChartOfAccount.Create(
            number, label, int.Parse(number[..1].ToString()), null, AccountNatureType.Debit,
            accountType: accountType, isAuxiliary: true, fiscalId: fiscalId).Value;
        if (!active)
            account.ToggleActive();
        return account;
    }

    private static AuxiliaryAccountCandidate Candidate(ChartOfAccount account) =>
        new(account.Id, account.AccountNumber, account.Label, account.FiscalIdNormalized,
            account.AffectationAccountNumber, account.ParentAccountNumber);

    private static Harness BuildHarness(
        string? companyNif = OurNif,
        IReadOnlySet<string>? missingAccounts = null,
        IReadOnlySet<string>? inactiveAccounts = null,
        AccountingPeriod? period = null,
        IReadOnlyList<ClientListDto>? clients = null,
        IReadOnlyList<SupplierListDto>? suppliers = null,
        ChartOfAccount? auxiliaryAccountByFiscalId = null,
        IReadOnlyList<AuxiliaryAccountCandidate>? auxiliaryAccountCandidates = null,
        string? ficheCollectiveAccountOverride = null)
    {
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string n, CancellationToken _) =>
            {
                if (missingAccounts?.Contains(n) == true)
                    return null;
                return Account(n, active: inactiveAccounts?.Contains(n) != true);
            });

        // (a) Rapprochement du compte auxiliaire par matricule fiscal : aucun par défaut.
        chart.Setup(x => x.FindAuxiliaryByFiscalIdAsync(
                It.IsAny<AccountType>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(auxiliaryAccountByFiscalId);

        // (c) Rapprochement du compte auxiliaire par nom : aucun candidat par défaut. Un mock loose
        // renverrait null (pas une liste vide) faute de configuration, ce qui provoquerait un NRE
        // dans AccountingEntryProposalService — la configurer explicitement couvre tous les tests.
        chart.Setup(x => x.ListActiveAuxiliaryAccountsAsync(
                It.IsAny<AccountType>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(auxiliaryAccountCandidates ?? Array.Empty<AuxiliaryAccountCandidate>());

        var periods = new Mock<IAccountingPeriodRepository>();
        periods.Setup(x => x.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(period);

        var companies = new Mock<ICompanyRepository>();
        companies.Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(companyNif is null ? [] : new[] { NewCompany(companyNif) });

        var directory = new Mock<IThirdPartyDirectoryService>();
        directory.Setup(x => x.GetProfileAsync(
                It.IsAny<ThirdPartyKind>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ficheCollectiveAccountOverride is null
                ? Result.Failure<ThirdPartyProfileDto>(
                    Error.Validation("ThirdPartyProfile", "Annuaire des tiers désactivé."))
                : Result.Success(new ThirdPartyProfileDto
                {
                    CollectiveAccountNumber = ficheCollectiveAccountOverride,
                    HasProfile = true
                }));

        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetClientsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PagedResult<ClientListDto>
            {
                Items = clients ?? [],
                TotalCount = clients?.Count ?? 0,
                Page = 1,
                PageSize = 10
            });
        mediator.Setup(x => x.Send(It.IsAny<GetSuppliersQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PagedResult<SupplierListDto>
            {
                Items = suppliers ?? [],
                TotalCount = suppliers?.Count ?? 0,
                Page = 1,
                PageSize = 10
            });

        // Volontairement non configurée : le contrôle anti-doublon échoue silencieusement et
        // n'empêche jamais la proposition (comportement attendu, couvert par un test dédié).
        var contextFactory = new Mock<ITenantDbContextFactory>();

        var service = new AccountingEntryProposalService(
            chart.Object,
            periods.Object,
            companies.Object,
            directory.Object,
            contextFactory.Object,
            mediator.Object,
            NullLogger<AccountingEntryProposalService>.Instance);

        return new Harness(service, chart, periods, mediator);
    }

    private static Company NewCompany(string nif)
    {
        var address = Address.Create("Avenue Habib Bourguiba", "Monastir", "Monastir").Value;
        return Company.Create(
            "Ste Bouzgarou",
            address,
            NIF.Create(nif).Value,
            Email.Create("bouzgaou22@yahoo.com").Value).Value;
    }

    /// <summary>La facture FAC-2026-000012 telle que lue par le parseur natif.</summary>
    private static AccountingDocumentExtractionDto SampleInvoice(
        string? sellerNif = OurNif,
        string? buyerNif = "9545555/E/E/E/525",
        DateOnly? issueDate = null) => new()
    {
        DocumentType = DocumentTypes.Invoice,
        DocumentNumber = "FAC-2026-000012",
        IssueDate = issueDate ?? new DateOnly(2026, 7, 12),
        Seller = new ExtractedPartyDto { Name = "Ste Bouzgarou", Nif = sellerNif },
        Buyer = new ExtractedPartyDto { Name = "Ste Slimen", Nif = buyerNif },
        VatBreakdown =
        [
            new ExtractedVatBucketDto(13, 2500.000m, 325.000m),
            new ExtractedVatBucketDto(19, 1200.000m, 228.000m)
        ],
        TotalHt = 3700.000m,
        TotalVat = 553.000m,
        FiscalStampAmount = 1.000m,
        TotalTtc = 4254.000m,
        ExtractionMethod = AccountingDocumentExtractionMethods.NativePdf
    };

    private static async Task<JournalEntryProposalDto> ProposeAsync(
        Harness harness, AccountingDocumentExtractionDto document, string? direction = null)
    {
        var result = await harness.Service.ProposeAsync(document, direction, CancellationToken.None);
        Assert.True(result.IsSuccess, result.Error?.Description);
        return result.Value;
    }

    // ========================================================================
    // Sens de la pièce
    // ========================================================================

    [Fact]
    public async Task ProposeAsync_WhenWeAreTheIssuer_DetectsASale()
    {
        var proposal = await ProposeAsync(BuildHarness(), SampleInvoice());

        Assert.Equal(DocumentDirections.Sale, proposal.Direction);
        Assert.Equal(TunisianPostingAccounts.SalesJournalCode, proposal.JournalCode);
        Assert.Contains("Émetteur", proposal.DirectionReason);
        Assert.Equal("Facture vente FAC-2026-000012", proposal.Label);
    }

    [Fact]
    public async Task ProposeAsync_WhenWeAreTheRecipient_DetectsAPurchase()
    {
        var document = SampleInvoice(sellerNif: "1111111/A/A/A/000", buyerNif: OurNif);

        var proposal = await ProposeAsync(BuildHarness(), document);

        Assert.Equal(DocumentDirections.Purchase, proposal.Direction);
        Assert.Equal(TunisianPostingAccounts.PurchaseJournalCode, proposal.JournalCode);
        Assert.Equal("Facture fournisseur FAC-2026-000012", proposal.Label);
    }

    [Fact]
    public async Task ProposeAsync_WhenNeitherPartyIsUs_WarnsAndAssumesAPurchase()
    {
        var document = SampleInvoice(sellerNif: "1111111/A/A/A/000", buyerNif: "2222222/B/B/B/000") with
        {
            Seller = new ExtractedPartyDto { Name = "Fournisseur X", Nif = "1111111/A/A/A/000" },
            Buyer = new ExtractedPartyDto { Name = "Client Y", Nif = "2222222/B/B/B/000" }
        };

        var proposal = await ProposeAsync(BuildHarness(), document);

        Assert.Equal(DocumentDirections.Purchase, proposal.Direction);
        Assert.Contains(proposal.Diagnostics,
            d => d.Code == ProposalDiagnosticCodes.DirectionAmbiguous && d.Severity == ProposalSeverities.Warning);
    }

    [Fact]
    public async Task ProposeAsync_WithAnExplicitDirection_OverridesTheDetection()
    {
        var proposal = await ProposeAsync(BuildHarness(), SampleInvoice(), DocumentDirections.Purchase);

        Assert.Equal(DocumentDirections.Purchase, proposal.Direction);
        Assert.Equal(TunisianPostingAccounts.PurchaseJournalCode, proposal.JournalCode);
        Assert.Contains(TunisianPostingAccounts.PurchasesOfGoods, proposal.Lines.Select(l => l.AccountNumber));
        Assert.Contains(TunisianPostingAccounts.Supplier, proposal.Lines.Select(l => l.AccountNumber));
    }

    // ========================================================================
    // Écriture proposée
    // ========================================================================

    [Fact]
    public async Task ProposeAsync_SaleInvoice_ProducesTheExpectedBalancedEntry()
    {
        var proposal = await ProposeAsync(BuildHarness(), SampleInvoice());

        Assert.Equal(4254.000m, proposal.TotalDebit);
        Assert.Equal(4254.000m, proposal.TotalCredit);
        Assert.Equal(4254.000m, proposal.DocumentTotalTtc);
        Assert.Equal(new DateOnly(2026, 7, 12), proposal.EntryDate);
        Assert.Equal("FAC-2026-000012", proposal.PieceRef);

        Assert.Equal(
            new[]
            {
                TunisianPostingAccounts.Client,
                TunisianPostingAccounts.SalesOfGoods,
                TunisianPostingAccounts.VatCollected,
                TunisianPostingAccounts.VatCollected,
                TunisianPostingAccounts.FiscalStampOnSale
            },
            proposal.Lines.Select(l => l.AccountNumber));
    }

    [Fact]
    public async Task ProposeAsync_AnnotatesEveryLineWithItsAccountLabel()
    {
        var proposal = await ProposeAsync(BuildHarness(), SampleInvoice());

        Assert.All(proposal.Lines, l =>
        {
            Assert.Equal(ProposedAccountStatuses.Found, l.AccountStatus);
            Assert.False(string.IsNullOrWhiteSpace(l.AccountLabel));
        });
    }

    // ========================================================================
    // Garantie « la proposition n'écrit jamais »
    // ========================================================================

    [Fact]
    public async Task ProposeAsync_WithAMissingAccount_ReportsItAndNeverCreatesIt()
    {
        var harness = BuildHarness(
            missingAccounts: new HashSet<string> { TunisianPostingAccounts.FiscalStampOnSale });

        var proposal = await ProposeAsync(harness, SampleInvoice());

        var stampLine = Assert.Single(
            proposal.Lines, l => l.AccountNumber == TunisianPostingAccounts.FiscalStampOnSale);
        Assert.Equal(ProposedAccountStatuses.Missing, stampLine.AccountStatus);
        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.AccountMissing);

        // Le cœur de la garantie : la comptabilisation automatique crée le sous-compte manquant,
        // le chemin de proposition ne doit surtout pas le faire.
        harness.Chart.Verify(
            x => x.AddAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Never);
        harness.Chart.Verify(
            x => x.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProposeAsync_WithAnInactiveAccount_ReportsIt()
    {
        var harness = BuildHarness(
            inactiveAccounts: new HashSet<string> { TunisianPostingAccounts.SalesOfGoods });

        var proposal = await ProposeAsync(harness, SampleInvoice());

        var salesLine = Assert.Single(
            proposal.Lines, l => l.AccountNumber == TunisianPostingAccounts.SalesOfGoods);
        Assert.Equal(ProposedAccountStatuses.Inactive, salesLine.AccountStatus);
        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.AccountInactive);
    }

    // ========================================================================
    // Diagnostics bloquants
    // ========================================================================

    [Fact]
    public async Task ProposeAsync_WithAClosedPeriod_BlocksTheProposal()
    {
        var period = AccountingPeriod.Create(2026, 7, new DateTime(2026, 7, 1), new DateTime(2026, 7, 31));
        period.Close("expert");

        var proposal = await ProposeAsync(BuildHarness(period: period), SampleInvoice());

        Assert.True(proposal.HasBlockingDiagnostic);
        Assert.Contains(proposal.Diagnostics,
            d => d.Code == ProposalDiagnosticCodes.PeriodClosed && d.Severity == ProposalSeverities.Blocking);
    }

    [Fact]
    public async Task ProposeAsync_WithAFutureDate_BlocksTheProposal()
    {
        var future = DateOnly.FromDateTime(DateTime.UtcNow.Date.AddDays(30));

        var proposal = await ProposeAsync(BuildHarness(), SampleInvoice(issueDate: future));

        Assert.True(proposal.HasBlockingDiagnostic);
        Assert.Contains(proposal.Diagnostics,
            d => d.Code == ProposalDiagnosticCodes.FutureDate && d.Severity == ProposalSeverities.Blocking);
    }

    [Fact]
    public async Task ProposeAsync_WithoutAnIssueDate_BlocksTheProposal()
    {
        var document = SampleInvoice() with { IssueDate = null };

        var proposal = await ProposeAsync(BuildHarness(), document);

        Assert.True(proposal.HasBlockingDiagnostic);
        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.MissingIssueDate);
    }

    // ========================================================================
    // Tiers
    // ========================================================================

    [Fact]
    public async Task ProposeAsync_WhenTheThirdPartyIsUnknown_WarnsAndKeepsTheCollectiveAccount()
    {
        var proposal = await ProposeAsync(BuildHarness(), SampleInvoice());

        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyNotMatched);
        Assert.Equal(TunisianPostingAccounts.Client, proposal.ThirdParty?.CollectiveAccountNumber);
        Assert.Null(proposal.ThirdParty?.MatchedId);

        // Les données extraites sont conservées pour pré-remplir la création du tiers.
        Assert.Equal("Ste Slimen", proposal.ThirdParty?.Name);
        Assert.Equal("9545555/E/E/E/525", proposal.ThirdParty?.Nif);

        var counterpart = proposal.Lines[0];
        Assert.Null(counterpart.ThirdPartyId);
        Assert.Null(counterpart.ThirdPartyKind);
    }

    [Fact]
    public async Task ProposeAsync_MatchesTheClientByItsTaxIdAndAttachesTheAuxiliary()
    {
        var clientId = Guid.NewGuid();
        var harness = BuildHarness(clients:
        [
            new ClientListDto { Id = clientId, Name = "STE SLIMEN SARL", Nif = "9545555/E/E/E/525" }
        ]);

        var proposal = await ProposeAsync(harness, SampleInvoice());

        Assert.Equal(clientId, proposal.ThirdParty?.MatchedId);
        Assert.Equal("nif", proposal.ThirdParty?.MatchedBy);
        Assert.DoesNotContain(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyNotMatched);

        var counterpart = proposal.Lines[0];
        Assert.Equal(clientId, counterpart.ThirdPartyId);
        Assert.Equal((int)ThirdPartyKind.Client, counterpart.ThirdPartyKind);
    }

    [Fact]
    public async Task ProposeAsync_MatchesTheSupplierByItsTaxId()
    {
        var supplierId = Guid.NewGuid();
        var harness = BuildHarness(suppliers:
        [
            new SupplierListDto
            {
                Id = supplierId, Name = "Fournisseur X", Nif = "1111111/A/A/A/000",
                Type = "Business", TypeDisplay = "Entreprise", Email = "f@x.tn",
                City = "Tunis", Governorate = "Tunis"
            }
        ]);
        var document = SampleInvoice(sellerNif: "1111111/A/A/A/000", buyerNif: OurNif) with
        {
            Seller = new ExtractedPartyDto { Name = "Fournisseur X", Nif = "1111111/A/A/A/000" }
        };

        var proposal = await ProposeAsync(harness, document);

        Assert.Equal(DocumentDirections.Purchase, proposal.Direction);
        Assert.Equal(supplierId, proposal.ThirdParty?.MatchedId);
        Assert.Equal((int)ThirdPartyKind.Supplier, proposal.ThirdParty?.Kind);

        var counterpart = proposal.Lines[^1];
        Assert.Equal(TunisianPostingAccounts.Supplier, counterpart.AccountNumber);
        Assert.Equal(supplierId, counterpart.ThirdPartyId);
    }

    [Fact]
    public async Task ProposeAsync_MatchesTheAuxiliaryAccountByFiscalIdAndUsesItAsCounterpart()
    {
        var auxiliary = AuxiliaryAccount(
            "41105", "STE SLIMEN SARL", AccountType.Client, fiscalId: "9545555/E/E/E/525");
        var harness = BuildHarness(auxiliaryAccountByFiscalId: auxiliary);

        var proposal = await ProposeAsync(harness, SampleInvoice());

        Assert.Equal(auxiliary.AccountNumber, proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Equal("nif", proposal.ThirdParty?.MatchedAccountBy);
        Assert.Null(proposal.ThirdParty?.MatchedId);
        Assert.DoesNotContain(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyNotMatched);

        var counterpart = proposal.Lines[0];
        Assert.Equal(auxiliary.AccountNumber, counterpart.AccountNumber);
    }

    [Fact]
    public async Task ProposeAsync_WhenTheAuxiliaryAccountAndFicheBothMatchByFiscalId_AttachesBoth()
    {
        var clientId = Guid.NewGuid();
        var auxiliary = AuxiliaryAccount(
            "41105", "STE SLIMEN SARL", AccountType.Client, fiscalId: "9545555/E/E/E/525");
        var harness = BuildHarness(
            auxiliaryAccountByFiscalId: auxiliary,
            clients: [new ClientListDto { Id = clientId, Name = "STE SLIMEN SARL", Nif = "9545555/E/E/E/525" }]);

        var proposal = await ProposeAsync(harness, SampleInvoice());

        Assert.Equal(auxiliary.AccountNumber, proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Equal(clientId, proposal.ThirdParty?.MatchedId);
        Assert.Equal("nif", proposal.ThirdParty?.MatchedBy);
        Assert.DoesNotContain(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyAccountConflict);

        var counterpart = proposal.Lines[0];
        Assert.Equal(auxiliary.AccountNumber, counterpart.AccountNumber);
        Assert.Equal(clientId, counterpart.ThirdPartyId);
    }

    [Fact]
    public async Task ProposeAsync_WhenTheFicheProfilePointsToADifferentAccount_WarnsAConflictButKeepsTheAuxiliary()
    {
        var clientId = Guid.NewGuid();
        var auxiliary = AuxiliaryAccount(
            "41105", "STE SLIMEN SARL", AccountType.Client, fiscalId: "9545555/E/E/E/525");
        var harness = BuildHarness(
            auxiliaryAccountByFiscalId: auxiliary,
            clients: [new ClientListDto { Id = clientId, Name = "STE SLIMEN SARL", Nif = "9545555/E/E/E/525" }],
            ficheCollectiveAccountOverride: "41106");

        var proposal = await ProposeAsync(harness, SampleInvoice());

        Assert.Equal(auxiliary.AccountNumber, proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyAccountConflict);

        // Le compte auxiliaire rapproché par matricule fiscal l'emporte sur le profil de la fiche.
        var counterpart = proposal.Lines[0];
        Assert.Equal(auxiliary.AccountNumber, counterpart.AccountNumber);
    }

    [Fact]
    public async Task ProposeAsync_WhenSeveralAuxiliaryAccountsMatchTheNameEqually_WarnsAmbiguousAndDoesNotPick()
    {
        var document = SampleInvoice() with { Buyer = new ExtractedPartyDto { Name = "Ste Slimen", Nif = null } };
        var candidates = new[]
        {
            Candidate(AuxiliaryAccount("41105", "Ste Slimen", AccountType.Client)),
            Candidate(AuxiliaryAccount("41106", "Ste Slimen", AccountType.Client))
        };
        var harness = BuildHarness(auxiliaryAccountCandidates: candidates);

        var proposal = await ProposeAsync(harness, document);

        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyAmbiguous);
        Assert.Null(proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Null(proposal.ThirdParty?.MatchedId);
    }

    [Fact]
    public async Task ProposeAsync_WhenOneAuxiliaryAccountMatchesTheNameUniquely_AttachesItWithAWarning()
    {
        var document = SampleInvoice() with { Buyer = new ExtractedPartyDto { Name = "Ste Slimen", Nif = null } };
        var candidates = new[] { Candidate(AuxiliaryAccount("41105", "Ste Slimen", AccountType.Client)) };
        var harness = BuildHarness(auxiliaryAccountCandidates: candidates);

        var proposal = await ProposeAsync(harness, document);

        Assert.Equal("41105", proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Equal("name", proposal.ThirdParty?.MatchedAccountBy);
        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyMatchedByName);
    }

    [Fact]
    public async Task ProposeAsync_WhenOnlyTheFicheMatchesByName_AttachesItWithAWarning()
    {
        var clientId = Guid.NewGuid();
        var document = SampleInvoice() with { Buyer = new ExtractedPartyDto { Name = "Ste Slimen", Nif = null } };
        var harness = BuildHarness(clients: [new ClientListDto { Id = clientId, Name = "Ste Slimen" }]);

        var proposal = await ProposeAsync(harness, document);

        Assert.Equal(clientId, proposal.ThirdParty?.MatchedId);
        Assert.Equal("name", proposal.ThirdParty?.MatchedBy);
        Assert.Null(proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyMatchedByName);
    }

    [Fact]
    public async Task ProposeAsync_WhenTheNameMatchesAHomonymWithADifferentFiscalId_RejectsItAndWarnsCitingTheHomonym()
    {
        var document = SampleInvoice() with
        {
            Buyer = new ExtractedPartyDto { Name = "Ste Slimen", Nif = "9545555/E/E/E/525" }
        };
        var candidates = new[]
        {
            Candidate(AuxiliaryAccount("41105", "Ste Slimen", AccountType.Client, fiscalId: "1111111/A/A/A/000"))
        };
        var harness = BuildHarness(auxiliaryAccountCandidates: candidates);

        var proposal = await ProposeAsync(harness, document);

        Assert.Null(proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Null(proposal.ThirdParty?.MatchedId);
        var diagnostic = Assert.Single(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyNotMatched);
        Assert.Contains("41105", diagnostic.Message);
        // Le MF de la pièce ne doit jamais être recopié dans un message destiné à l'utilisateur.
        Assert.DoesNotContain("9545555", diagnostic.Message);
    }

    [Fact]
    public async Task ProposeAsync_AuxiliaryMatchByFiscalId_ExposesItsAffectationAsCollectiveAccount()
    {
        // Contrat §4.3 : avec un compte rapproché, le collectif affiché est son compte
        // d'affectation (sinon son parent, sinon le collectif par défaut).
        var auxiliary = ChartOfAccount.Create(
            "41105", "STE SLIMEN SARL", 4, null, AccountNatureType.Debit,
            accountType: AccountType.Client, isAuxiliary: true,
            affectationAccountNumber: "411", fiscalId: "9545555/E/E/E/525").Value;
        var harness = BuildHarness(auxiliaryAccountByFiscalId: auxiliary);

        var proposal = await ProposeAsync(harness, SampleInvoice());

        Assert.Equal("41105", proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Equal("411", proposal.ThirdParty?.CollectiveAccountNumber);
    }

    [Fact]
    public async Task ProposeAsync_AuxiliaryMatchByName_ExposesItsParentAsCollectiveAccount()
    {
        var document = SampleInvoice() with { Buyer = new ExtractedPartyDto { Name = "Ste Slimen", Nif = null } };
        var auxiliary = ChartOfAccount.Create(
            "41105", "Ste Slimen", 4, "411", AccountNatureType.Debit,
            accountType: AccountType.Client, isAuxiliary: true).Value;
        var harness = BuildHarness(auxiliaryAccountCandidates: [Candidate(auxiliary)]);

        var proposal = await ProposeAsync(harness, document);

        Assert.Equal("41105", proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Equal("411", proposal.ThirdParty?.CollectiveAccountNumber);
    }

    [Fact]
    public async Task ProposeAsync_AuxiliaryMatchByFiscalId_OutsideTheThirdPartyPrefix_IsIgnored()
    {
        // Défense en profondeur : un compte fournisseur (40… ou autre) remonté pour une vente
        // (préfixe 41 attendu) n'est jamais proposé, même si les données le permettaient.
        var supplierAccount = AuxiliaryAccount(
            "40114", "STE SLIMEN SARL", AccountType.Supplier, fiscalId: "9545555/E/E/E/525");
        var harness = BuildHarness(auxiliaryAccountByFiscalId: supplierAccount);

        var proposal = await ProposeAsync(harness, SampleInvoice());

        Assert.Null(proposal.ThirdParty?.MatchedAccountNumber);
        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.ThirdPartyNotMatched);
    }

    // ========================================================================
    // Contrôles arithmétiques et nature de la pièce
    // ========================================================================

    [Fact]
    public async Task ProposeAsync_WhenTheDocumentTotalDisagrees_WarnsButStaysBalanced()
    {
        var document = SampleInvoice() with { TotalTtc = 4999.000m };

        var proposal = await ProposeAsync(BuildHarness(), document);

        Assert.Equal(proposal.TotalDebit, proposal.TotalCredit);
        Assert.Equal(4254.000m, proposal.TotalDebit);
        Assert.Contains(proposal.Diagnostics,
            d => d.Code == ProposalDiagnosticCodes.TotalsMismatch && d.Severity == ProposalSeverities.Warning);
        Assert.False(proposal.HasBlockingDiagnostic);
    }

    [Fact]
    public async Task ProposeAsync_ForAProforma_WarnsThatItIsNotAnInvoice()
    {
        var document = SampleInvoice() with { DocumentType = DocumentTypes.Proforma };

        var proposal = await ProposeAsync(BuildHarness(), document);

        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.DocumentNotInvoice);
    }

    [Fact]
    public async Task ProposeAsync_WithWithholding_ReportsItAsInfoAndKeepsItOutOfTheEntry()
    {
        var document = SampleInvoice() with { WithholdingAmount = 55.000m };

        var proposal = await ProposeAsync(BuildHarness(), document);

        Assert.Contains(proposal.Diagnostics,
            d => d.Code == ProposalDiagnosticCodes.WithholdingIgnored && d.Severity == ProposalSeverities.Info);
        Assert.DoesNotContain(proposal.Lines, l => l.AccountNumber.StartsWith("4456", StringComparison.Ordinal));
        Assert.Equal(4254.000m, proposal.TotalDebit);
    }

    [Fact]
    public async Task ProposeAsync_WithoutCompanyInformation_WarnsInsteadOfFailing()
    {
        var proposal = await ProposeAsync(BuildHarness(companyNif: null), SampleInvoice());

        Assert.Contains(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.DirectionAmbiguous);
        Assert.NotEmpty(proposal.Lines);
    }

    [Fact]
    public async Task ProposeAsync_WhenTheDuplicateCheckFails_StillReturnsTheProposal()
    {
        // ITenantDbContextFactory non configurée : le contrôle anti-doublon lève, et cela ne doit
        // jamais empêcher l'utilisateur d'obtenir sa proposition.
        var proposal = await ProposeAsync(BuildHarness(), SampleInvoice());

        Assert.NotEmpty(proposal.Lines);
        Assert.DoesNotContain(proposal.Diagnostics, d => d.Code == ProposalDiagnosticCodes.AlreadyPosted);
    }

    [Fact]
    public async Task ProposeAsync_PageWindowWarning_StaysAWarning()
    {
        var warning = InvoicePdfReadingWindow.DescribeSkippedPages(12, new[] { 1, 2, 10, 11, 12 });
        var document = SampleInvoice() with { Warnings = new[] { warning } };

        var proposal = await ProposeAsync(BuildHarness(), document);

        var diagnostic = Assert.Single(proposal.Diagnostics, d => d.Message == warning);
        Assert.Equal(ProposalDiagnosticCodes.ExtractionWarning, diagnostic.Code);
        Assert.Equal(ProposalSeverities.Warning, diagnostic.Severity);
        Assert.NotEqual(ProposalSeverities.Blocking, diagnostic.Severity);
    }
}
