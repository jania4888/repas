using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;
using Engine = FactuTrust.Infrastructure.Services.BankStatementImport.BankStatementProposalEngine;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Moteur de propositions sur des libellés RÉELS (STB, BH, Zitouna, Attijari, BIAT) : rien n'est
/// proposé deux fois, rien n'est deviné en dessous des seuils, aucun compte n'est inventé.
/// </summary>
public sealed class BankStatementProposalEngineTests
{
    private static readonly Dictionary<string, Engine.ChartAccount> FullChart = new[]
    {
        "4111", "4011", "413", "403", "425", "4251", "43666", "453", "58", "6278", "6516", "6511", "616", "6654", "16"
    }.ToDictionary(a => a, a => new Engine.ChartAccount($"Compte {a}", true));

    private static Engine.Line Line(string label, decimal amount, bool isDebit, string date = "2026-01-10", string reference = "") =>
        new(Guid.NewGuid(), DateOnly.Parse(date), null, label, reference, amount, isDebit, false, null);

    private static Engine.Context Ctx(params Engine.Line[] lines) => new()
    {
        StatementId = Guid.NewGuid(),
        BankAccountId = Guid.NewGuid(),
        BankGlAccount = "53210001",
        Lines = lines,
        Chart = FullChart
    };

    private static BankLineProposalDto Single(Engine.Context ctx) => Assert.Single(Engine.Propose(ctx));

    // ── Catalogue ───────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("TVA SUR COMMISSION VIREMENT REÇU EN DINARS AUTRE BANQUE", true, "vat-on-fees")]
    [InlineData("TVA", true, "vat-on-fees")]
    [InlineData("T.V.A IB AUTRES", true, "vat-on-fees")]
    [InlineData("COMMISSION VIREMENT REÇU EN DINARS AUTRE BANQUE", true, "bank-fees")]
    [InlineData("VIR IBQ A DISTANCE COMMISSION VIR AUT BQ 004242 DONT TVA: 0,285", true, "bank-fees")]
    [InlineData("EFFET COMPENSE 13237 COM ET TVA 011126708592 DONT TVA: 0,570", true, "fees-with-vat")]
    [InlineData("COM ET TVA/VIR AUT BQ 00000901", true, "fees-with-vat")]
    [InlineData("SWIFT", true, "bank-fees")]
    [InlineData("ARRETE DE COMPTE ECHELLES", true, "overdraft-interest")]
    [InlineData("AGIOS DU 30/09/25 AU 31/12/25", true, "overdraft-interest")]
    [InlineData("PAIEMENT PROFIT", true, "islamic-financing-profit")]
    [InlineData("VERSEMENT ESPECE DEP VERSEMENT AUTRE AG( 021 ) 462829", false, "cash-deposit")]
    [InlineData("VRST. 1000001", false, "cash-deposit")]
    [InlineData("ENCAISSEMENT EFFET EFF N° 011220000001", false, "bill-collected")]
    [InlineData("VIREMENT REÇU ALPHA INDUSTRIES SA", false, "transfer-received")]
    [InlineData("VIR RECU VIR RECU TN AUT BQ 111111 CAISSE NATIONALE D ASSURANCE M", false, "transfer-received")]
    [InlineData("REGLEMENT EFFET N°010860000002 SOCIETE BETAMEC", true, "bill-paid")]
    [InlineData("RÈG CHÈQUE N° 0001234", true, "cheque-paid")]
    [InlineData("PAIEMENT CHQ 0000777", true, "cheque-paid")]
    [InlineData("VIR IBQ A DISTANCE VIR EMIS TN AUT BQ 004242 BEN FOULEN EP BEN FALTEN SALMA Salaire", true, "salary-transfer")]
    [InlineData("PRÉLÈVEMENT CNSS", true, "social-security")]
    [InlineData("PRÉLÈVEMENT MINISTERE DES FINANCES", true, "tax-office")]
    [InlineData("VIREMENTS EMIS SUR L'ÉTRANGER", true, "transfer-sent")]
    [InlineData("VIREMENT TN MEME BQ 0101010", true, "transfer-sent")]
    [InlineData("PRÉLÈVEMENT OLS", true, "direct-debit")]
    public void Catalog_recognizes_real_bank_labels(string label, bool isDebit, string expectedRule) =>
        Assert.Equal(expectedRule, TunisianBankOperationCatalog.Default.Match(label, isDebit)?.Id);

    [Fact]
    public void Catalog_respects_the_direction()
    {
        // Une commission n'est jamais une entrée d'argent ; un versement n'est jamais une sortie.
        Assert.Null(TunisianBankOperationCatalog.Default.Match("VERSEMENT ESPECES", isDebit: true));
        Assert.NotEqual("bank-fees", TunisianBankOperationCatalog.Default.Match("COMMISSION", isDebit: false)?.Id);
    }

    [Theory]
    [InlineData("REGLEMENT EFFET N°010860000002 SOCIETE BETAMEC", "SOCIETE BETAMEC")]
    [InlineData("VIREMENT REÇU ALPHA INDUSTRIES SA", "ALPHA INDUSTRIES SA")]
    [InlineData("VIR IBQ A DISTANCE VIR EMIS TN AUT BQ 004242 BEN FOULEN EP BEN FALTEN SALMA Salaire", "BEN FOULEN EP BEN FALTEN SALMA")]
    [InlineData("RÈG CHÈQUE N° 0001234", null)]
    public void Party_name_is_extracted_from_the_label(string label, string? expected) =>
        Assert.Equal(expected, BankLabelPartyExtractor.Extract(label));

    // ── Déjà comptabilisé ───────────────────────────────────────────────────────────────────

    private static Engine.BankJournalLine Posted(decimal debit, decimal credit, string date, string? pieceRef = null, string label = "Encaissement") =>
        new(Guid.NewGuid(), Guid.NewGuid(), "JB", 12, DateOnly.Parse(date), debit, credit, pieceRef, label, label, IsDraft: false);

    [Fact]
    public void Receipt_already_recorded_in_instafact_is_not_proposed_again()
    {
        var line = Line("VIREMENT REÇU ALPHA INDUSTRIES SA", 2_221.931m, isDebit: false, "2026-01-19");
        var ctx = Ctx(line) with { BankJournalLines = new[] { Posted(2_221.931m, 0m, "2026-01-16") } };

        var proposal = Single(ctx);

        Assert.Equal(BankLineStatuses.AlreadyPosted, proposal.Status);
        Assert.Equal(BankLineSources.ExistingEntry, proposal.Source);
        Assert.False(proposal.SelectedByDefault);
    }

    [Fact]
    public void A_debit_never_matches_a_bank_debit_line()
    {
        var line = Line("RÈG CHÈQUE N° 0001234", 2_400m, isDebit: true);
        var ctx = Ctx(line) with { BankJournalLines = new[] { Posted(2_400m, 0m, "2026-01-10") } };
        Assert.NotEqual(BankLineStatuses.AlreadyPosted, Single(ctx).Status);
    }

    [Fact]
    public void Cheque_number_settles_between_identical_amounts()
    {
        var line = Line("RÈG CHÈQUE N° 0001234", 2_400m, isDebit: true);
        var right = Posted(0m, 2_400m, "2026-01-08", pieceRef: "CHQ 1234");
        var ctx = Ctx(line) with { BankJournalLines = new[] { Posted(0m, 2_400m, "2026-01-09"), right } };

        var proposal = Single(ctx);

        Assert.Equal(BankLineStatuses.AlreadyPosted, proposal.Status);
        Assert.Equal(BankLineConfidences.Certain, proposal.Confidence);
        Assert.Equal(right.EntryId, proposal.ExistingEntry!.JournalEntryId);
    }

    [Fact]
    public void Several_candidates_without_reference_stay_ambiguous()
    {
        var line = Line("VIREMENT REÇU STE GAMMA SERVICES SARL", 1_422.627m, isDebit: false);
        var ctx = Ctx(line) with { BankJournalLines = new[] { Posted(1_422.627m, 0m, "2026-01-09"), Posted(1_422.627m, 0m, "2026-01-11") } };

        var proposal = Single(ctx);

        Assert.Equal(BankLineStatuses.Ambiguous, proposal.Status);
        Assert.Equal(2, proposal.CandidateCount);
        Assert.False(proposal.SelectedByDefault);
    }

    [Fact]
    public void An_existing_entry_is_claimed_by_one_line_only()
    {
        var first = Line("COMMISSION DE DOMICILIATION", 10m, true, "2026-04-07");
        var second = Line("COMMISSION DE DOMICILIATION", 10m, true, "2026-04-07");
        var ctx = Ctx(first, second) with { BankJournalLines = new[] { Posted(0m, 10m, "2026-04-07") } };

        var proposals = Engine.Propose(ctx);

        Assert.Equal(1, proposals.Count(p => p.Status == BankLineStatuses.AlreadyPosted));
        Assert.Equal(1, proposals.Count(p => p.Status == BankLineStatuses.Proposed));
    }

    [Fact]
    public void Generated_reconciled_and_already_imported_lines_are_never_proposed()
    {
        var generated = Line("SWIFT", 10m, true);
        var reconciled = Line("SWIFT", 11m, true) with { IsReconciled = true };
        var duplicate = Line("SWIFT", 12m, true);
        var ctx = Ctx(generated, reconciled, duplicate) with
        {
            GeneratedByLine = new Dictionary<Guid, Engine.EntryRef>
            {
                [generated.Id] = new(Guid.NewGuid(), null, "JB", 7, generated.Date, IsDraft: true)
            },
            AlreadyImported = new HashSet<Guid> { duplicate.Id }
        };

        var byId = Engine.Propose(ctx).ToDictionary(p => p.LineId);

        Assert.Equal(BankLineStatuses.Generated, byId[generated.Id].Status);
        Assert.Equal(BankLineStatuses.Reconciled, byId[reconciled.Id].Status);
        Assert.Equal(BankLineStatuses.AlreadyImported, byId[duplicate.Id].Status);
        Assert.DoesNotContain(byId.Values, p => p.SelectedByDefault);
    }

    // ── Classification ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Commission_with_printed_vat_is_split_into_net_and_deductible_vat()
    {
        var proposal = Single(Ctx(Line("VIR IBQ A DISTANCE COMMISSION VIR AUT BQ 004242 DONT TVA: 0,285", 1.785m, true)));

        Assert.Equal(BankLineStatuses.Proposed, proposal.Status);
        Assert.Equal("6278", proposal.AccountNumber);
        Assert.Equal(new BankLineVatSplitDto(1.500m, 0.285m, "43666", Implied: false), proposal.VatSplit);
        Assert.True(proposal.SelectedByDefault);
    }

    [Fact]
    public void Commission_vat_is_implied_only_when_it_falls_exactly_on_the_millime()
    {
        var exact = Single(Ctx(Line("COM ET TVA/VIR AUT BQ 00000901", 2.380m, true)));
        Assert.Equal(new BankLineVatSplitDto(2.000m, 0.380m, "43666", Implied: true), exact.VatSplit);
        // TVA déduite (non imprimée) : jamais pré-cochée, toujours « à vérifier ».
        Assert.Equal(BankLineConfidences.ToCheck, exact.Confidence);
        Assert.False(exact.SelectedByDefault);

        // 0,009 : aucun hors-taxe au millime dont la TVA à 19 % donne le reste ⇒ pas de ventilation.
        var inexact = Single(Ctx(Line("COM ET TVA/VIR AUT BQ 00000902", 0.009m, true)));
        Assert.Null(inexact.VatSplit);
        Assert.Equal("6278", inexact.AccountNumber);
    }

    [Fact]
    public void Transfer_received_is_matched_to_the_client_by_name()
    {
        var clientId = Guid.NewGuid();
        var ctx = Ctx(Line("VIREMENT REÇU ALPHA INDUSTRIES SA", 2_221.931m, isDebit: false)) with
        {
            Parties = new[]
            {
                new Engine.Party(clientId, ThirdPartyKind.Client, "Alpha Industries SA", "ALPHA INDUSTRIES SA", null),
                new Engine.Party(Guid.NewGuid(), ThirdPartyKind.Client, "Alpha", "ALPHA", null)
            }
        };

        var proposal = Single(ctx);

        Assert.Equal(BankLineStatuses.Proposed, proposal.Status);
        Assert.Equal("4111", proposal.AccountNumber);
        Assert.Equal(clientId, proposal.ThirdPartyId);
        Assert.Equal(ThirdPartyKind.Client, proposal.ThirdPartyKind);
        Assert.True(proposal.RequiresThirdParty);
    }

    [Fact]
    public void Unknown_client_leaves_the_line_to_complete_instead_of_guessing()
    {
        var ctx = Ctx(Line("VIREMENT REÇU LES ATELIERS DE SFAX .", 1_876.211m, isDebit: false)) with
        {
            Parties = new[] { new Engine.Party(Guid.NewGuid(), ThirdPartyKind.Client, "Sfax Distribution", "SFAX DISTRIBUTION", null) }
        };

        var proposal = Single(ctx);

        Assert.Equal(BankLineStatuses.ToComplete, proposal.Status);
        Assert.Equal("4111", proposal.AccountNumber);
        Assert.Null(proposal.ThirdPartyId);
        Assert.Contains(proposal.Diagnostics, d => d.Code == "third_party_required");
    }

    [Fact]
    public void Bill_number_of_a_recorded_payment_identifies_the_client_with_certainty()
    {
        var clientId = Guid.NewGuid();
        var ctx = Ctx(Line("ENCAISSEMENT EFFET EFF N° 011220000001", 7_564.143m, isDebit: false, "2026-01-02")) with
        {
            Parties = new[] { new Engine.Party(clientId, ThirdPartyKind.Client, "Client Effets", "CLIENT EFFETS", "4112") },
            Payments = new[] { new Engine.PaymentReference("11220000001", clientId, ThirdPartyKind.Client, new DateOnly(2025, 12, 1), 7_564.143m) }
        };

        var proposal = Single(ctx);

        Assert.Equal(BankLineConfidences.Certain, proposal.Confidence);
        Assert.Equal("413", proposal.AccountNumber); // l'effet reste sur 413, pas le collectif du client
        Assert.Equal(clientId, proposal.ThirdPartyId);
    }

    [Fact]
    public void Salary_transfer_goes_to_the_employee_payable_account()
    {
        var employeeId = Guid.NewGuid();
        var ctx = Ctx(Line("VIR IBQ A DISTANCE VIR EMIS TN AUT BQ 004242 BEN FOULEN EP BEN FALTEN SALMA Salaire", 950.000m, true)) with
        {
            Parties = new[] { new Engine.Party(employeeId, ThirdPartyKind.Employee, "Salma Ben Foulen Ep Ben Falten", "BEN FOULEN EP BEN FALTEN SALMA", "4251") }
        };

        var proposal = Single(ctx);

        Assert.Equal("4251", proposal.AccountNumber);
        Assert.Equal(employeeId, proposal.ThirdPartyId);
        Assert.Equal(ThirdPartyKind.Employee, proposal.ThirdPartyKind);
    }

    [Fact]
    public void Transfer_from_another_bank_of_the_dossier_is_an_internal_transfer()
    {
        var ctx = Ctx(Line("VIREMENT REÇU BANQUE ZITOUNA", 93_873.563m, isDebit: false)) with { OtherBankNames = new[] { "ZITOUNA" } };

        var proposal = Single(ctx);

        Assert.Equal("58", proposal.AccountNumber);
        Assert.Null(proposal.ThirdPartyId);
        Assert.Equal(BankLineStatuses.Proposed, proposal.Status);
    }

    [Fact]
    public void Dossier_rule_beats_the_catalog()
    {
        var supplierId = Guid.NewGuid();
        var rule = BankPostingRule.Create(null, BankPostingRuleDirection.Debit, BankPostingRuleMatchKind.StartsWith,
            "PRELEVEMENT OLS", "4011", supplierId, ThirdPartyKind.Supplier, false, null);
        var ctx = Ctx(Line("PRÉLÈVEMENT OLS", 1_607.673m, true)) with
        {
            DossierRules = new[] { rule },
            Parties = new[] { new Engine.Party(supplierId, ThirdPartyKind.Supplier, "Omega Leasing Services", "OMEGA LEASING SERVICES", null) }
        };

        var proposal = Single(ctx);

        Assert.Equal(BankLineSources.DossierRule, proposal.Source);
        Assert.Equal(BankLineConfidences.Certain, proposal.Confidence);
        Assert.Equal(supplierId, proposal.ThirdPartyId);
        Assert.Equal(BankLineStatuses.Proposed, proposal.Status);
    }

    [Fact]
    public void Missing_account_is_reported_never_created()
    {
        var chart = new Dictionary<string, Engine.ChartAccount> { ["627"] = new("Services bancaires", true) };
        var withParent = Single(Ctx(Line("SWIFT", 10m, true)) with { Chart = chart });
        Assert.Equal("627", withParent.AccountNumber); // 6278 absent ⇒ parent actif le plus précis
        Assert.Equal("found", withParent.AccountStatus);

        var none = Single(Ctx(Line("SWIFT", 10m, true)) with { Chart = new Dictionary<string, Engine.ChartAccount>() });
        Assert.Equal("missing", none.AccountStatus);
        Assert.Equal(BankLineStatuses.ToComplete, none.Status);
    }

    [Fact]
    public void Closed_period_blocks_the_line()
    {
        var proposal = Single(Ctx(Line("SWIFT", 10m, true, "2026-01-10")) with { ClosedPeriods = new HashSet<(int, int)> { (2026, 1) } });
        Assert.Equal(BankLineStatuses.Blocked, proposal.Status);
        Assert.Contains(proposal.Diagnostics, d => d.Code == "period_closed" && d.Severity == "blocking");
    }

    [Fact]
    public void Unknown_operation_is_left_to_the_user_or_the_ai()
    {
        var line = Line("REG REMISE IMP / CPTE DT /N°RID26/10001", 53_693.042m, true);
        var unknown = Single(Ctx(line));
        Assert.Equal(BankLineStatuses.ToComplete, unknown.Status);
        Assert.Null(unknown.Source);

        var cached = Single(Ctx(line) with
        {
            AiCache = new Dictionary<string, string?> { [Engine.LabelHash(line.Description, true)] = "6278" }
        });
        Assert.Equal(BankLineSources.Ai, cached.Source);
        Assert.Equal(BankLineConfidences.ToCheck, cached.Confidence);
        Assert.False(cached.SelectedByDefault);
    }
}
