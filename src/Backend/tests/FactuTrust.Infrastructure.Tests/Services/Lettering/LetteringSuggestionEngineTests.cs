using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Services.Lettering;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Lettering;

/// <summary>
/// Phase 3 du lettrage (p3-5) : moteur pur de propositions, partitions, clé et règle R1 (lien
/// documentaire facture ↔ règlements). Chaque sortie passe aussi par <see cref="AssertInvariants"/>.
/// </summary>
public sealed class LetteringSuggestionEngineTests
{
    private static readonly Guid Client1 = Guid.Parse("00000000-0000-0000-0000-00000000c001");
    private static readonly Guid Client2 = Guid.Parse("00000000-0000-0000-0000-00000000c002");
    private static readonly Guid Supplier1 = Guid.Parse("00000000-0000-0000-0000-00000000f001");

    private int _rank;
    private int _lineSeed;

    private LetteringCandidate Line(
        long signedMillimes,
        string account = "4111",
        string currency = "TND",
        Guid? thirdParty = null,
        ThirdPartyKind kind = ThirdPartyKind.Client,
        string? sourceType = null,
        Guid? sourceId = null,
        string? pieceRef = null,
        long? signedLocal = null,
        int day = 0)
    {
        _rank++;
        var id = new Guid(++_lineSeed, 0, 0, new byte[8]);
        return new LetteringCandidate(
            LineId: id,
            EntryId: new Guid(_lineSeed, 1, 0, new byte[8]),
            LineNumber: 1,
            AccountNumber: account,
            CurrencyCode: currency,
            SignedMillimesOp: signedMillimes,
            SignedMillimesLocal: signedLocal ?? signedMillimes,
            ThirdPartyKind: thirdParty is null ? ThirdPartyKind.None : kind,
            ThirdPartyId: thirdParty,
            Label: "ligne",
            PieceRef: pieceRef,
            EntryLabel: "écriture",
            JournalCode: "VT",
            EntryNumber: _rank,
            EntryDate: new DateTime(2026, 1, 1).AddDays(day),
            SourceEntityType: sourceType,
            SourceEntityId: sourceId,
            OrderRank: _rank);
    }

    private LetteringCandidate Invoice(Guid invoiceId, long amount, Guid? client = null, string account = "4111", string currency = "TND", long? local = null, string? pieceRef = "FAC-2026-001")
        => Line(amount, account, currency, client ?? Client1, sourceType: AccountingService.SourceInvoice, sourceId: invoiceId, pieceRef: pieceRef, signedLocal: local);

    private LetteringCandidate Payment(Guid paymentId, long amount, Guid? client = null, string account = "4111", string currency = "TND", long? local = null)
        => Line(-amount, account, currency, client ?? Client1, sourceType: AccountingService.SourcePayment, sourceId: paymentId, signedLocal: local is null ? null : -local);

    private static DocumentLinks Links(params (Guid Payment, Guid Invoice)[] links)
        => new(links.ToDictionary(l => l.Payment, l => l.Invoice), new Dictionary<Guid, Guid>());

    private static LetteringEngineOutput Run(IReadOnlyList<LetteringCandidate> candidates, DocumentLinks links, LetteringEngineOptions? options = null)
    {
        var output = LetteringSuggestionEngine.Run(candidates, links, options ?? LetteringEngineOptions.Default);
        AssertInvariants(output);
        return output;
    }

    [Fact]
    public void R1_InvoiceAndOnePayment_IsExactDocumentLink()
    {
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var invoice = Invoice(inv, 1_190_000);
        var payment = Payment(pay, 1_190_000);

        var output = Run(new[] { invoice, payment }, Links((pay, inv)));

        var s = Assert.Single(output.Suggestions);
        Assert.Equal(SuggestionKind.DocumentLink, s.Kind);
        Assert.Equal(SuggestionCategory.Exact, s.Category);
        Assert.Equal(100, s.Score); // 95 + même tiers (5) + dates proches (3), borné à 100
        Assert.Equal(SuggestionConfidence.High, s.Confidence);
        Assert.Equal(new[] { invoice.LineId, payment.LineId }, s.Lines.Select(l => l.LineId));
        Assert.Equal(1_190_000, s.TotalMillimesOp);
        Assert.Equal(0, s.LocalGapMillimes);
        Assert.Equal(Client1, s.ThirdPartyId);
        Assert.Equal(ThirdPartyKind.Client, s.ThirdPartyKind);
        var reason = Assert.Single(s.Reasons);
        Assert.Equal(EngineReasonCodes.DocumentLink, reason.Code);
        Assert.Equal("FAC-2026-001", reason.Args["invoiceNumber"]);
        Assert.Equal("1", reason.Args["paymentCount"]);
        Assert.False(output.Truncated);
        Assert.Equal(1, output.TotalFound);
    }

    [Fact]
    public void R1_InvoiceAndTwoPartialPayments_IsMultiple()
    {
        var inv = Guid.NewGuid();
        var (p1, p2) = (Guid.NewGuid(), Guid.NewGuid());
        var lines = new[] { Invoice(inv, 1_000_000), Payment(p1, 600_000), Payment(p2, 400_000) };

        var output = Run(lines, Links((p1, inv), (p2, inv)));

        var s = Assert.Single(output.Suggestions);
        Assert.Equal(SuggestionCategory.Multiple, s.Category);
        Assert.Equal(3, s.Lines.Count);
        Assert.Equal("2", s.Reasons[0].Args["paymentCount"]);
    }

    [Fact]
    public void R1_WithholdingTax_PaymentEntryWithNetAndWithholdingLines_IsGrouped()
    {
        // Règlement avec retenue à la source : 4111 crédité du net (985) et de la RS (15) sur la même pièce.
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var lines = new[] { Invoice(inv, 1_000_000), Payment(pay, 985_000), Payment(pay, 15_000) };

        var output = Run(lines, Links((pay, inv)));

        var s = Assert.Single(output.Suggestions);
        Assert.Equal(3, s.Lines.Count);
        Assert.Equal(SuggestionCategory.Multiple, s.Category);
        Assert.Equal("1", s.Reasons[0].Args["paymentCount"]);
    }

    [Fact]
    public void R1_SupplierInvoiceAndSupplierPayment_IsGrouped()
    {
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var invoice = Line(-500_000, "4011", thirdParty: Supplier1, kind: ThirdPartyKind.Supplier,
            sourceType: AccountingService.SourceSupplierInvoice, sourceId: inv);
        var payment = Line(500_000, "4011", thirdParty: Supplier1, kind: ThirdPartyKind.Supplier,
            sourceType: AccountingService.SourceSupplierPayment, sourceId: pay);
        var links = new DocumentLinks(new Dictionary<Guid, Guid>(), new Dictionary<Guid, Guid> { [pay] = inv });

        var output = Run(new[] { invoice, payment }, links);

        var s = Assert.Single(output.Suggestions);
        Assert.Equal(ThirdPartyKind.Supplier, s.ThirdPartyKind);
        Assert.Equal(500_000, s.TotalMillimesOp);
    }

    [Fact]
    public void R1_ClientPaymentIdNeverMatchesSupplierInvoiceWithSameId()
    {
        // Les deux tables de liens sont distinctes : un Payment ne pointe jamais vers une SupplierInvoice.
        var sharedId = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var supplierInvoice = Line(500_000, sourceType: AccountingService.SourceSupplierInvoice, sourceId: sharedId, thirdParty: Client1);
        var payment = Payment(pay, 500_000);

        var output = Run(new[] { supplierInvoice, payment }, Links((pay, sharedId)));

        Assert.DoesNotContain(output.Suggestions, s => s.Kind == SuggestionKind.DocumentLink);
    }

    [Fact]
    public void R1_SumNotZero_ProposesNothing()
    {
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();

        var output = Run(new[] { Invoice(inv, 1_000_000), Payment(pay, 999_999) }, Links((pay, inv)));

        Assert.Empty(output.Suggestions);
    }

    [Fact]
    public void R1_MoreThanMaxDocumentPayments_IsIgnored()
    {
        var inv = Guid.NewGuid();
        var lines = new List<LetteringCandidate> { Invoice(inv, 2_100_000) };
        var links = new List<(Guid, Guid)>();
        for (var i = 0; i < 21; i++)
        {
            var pay = Guid.NewGuid();
            lines.Add(Payment(pay, 100_000));
            links.Add((pay, inv));
        }

        Assert.Empty(Run(lines, Links(links.ToArray())).Suggestions);

        // Exactement 20 règlements : accepté.
        lines.RemoveAt(lines.Count - 1);
        lines[0] = Invoice(inv, 2_000_000);
        Assert.Single(Run(lines, Links(links.ToArray())).Suggestions);
    }

    [Fact]
    public void R1_EurAndTndLinesAreNeverGrouped()
    {
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var lines = new[] { Invoice(inv, 1_000_000, currency: "EUR"), Payment(pay, 1_000_000, currency: "TND") };

        var output = Run(lines, Links((pay, inv)));

        Assert.Empty(output.Suggestions);
    }

    [Fact]
    public void R1_DifferentAccountsAreNeverGrouped()
    {
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var lines = new[] { Invoice(inv, 1_000_000, account: "4111"), Payment(pay, 1_000_000, account: "4112") };

        Assert.Empty(Run(lines, Links((pay, inv))).Suggestions);
    }

    [Fact]
    public void R1_ContradictoryThirdParties_AreNeverGrouped()
    {
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var lines = new[] { Invoice(inv, 1_000_000, client: Client1), Payment(pay, 1_000_000, client: Client2) };

        Assert.Empty(Run(lines, Links((pay, inv))).Suggestions);
    }

    [Fact]
    public void R1_ForeignCurrencyBalancedWithLocalGap_ReportsExchangeDifference()
    {
        // 1 000 EUR facturés à 3,300 et réglés à 3,350 : équilibré en EUR, écart de 50 TND.
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var lines = new[]
        {
            Invoice(inv, 1_000_000, currency: "EUR", local: 3_300_000),
            Payment(pay, 1_000_000, currency: "EUR", local: 3_350_000),
        };

        var output = Run(lines, Links((pay, inv)));

        var s = Assert.Single(output.Suggestions);
        Assert.Equal("EUR", s.CurrencyCode);
        Assert.Equal(-50_000, s.LocalGapMillimes);
        Assert.True(s.HasExchangeDifference);
        var gap = Assert.Single(s.Reasons, r => r.Code == EngineReasonCodes.ExchangeDifference);
        Assert.Equal("-50.000", gap.Args["localGap"]);
    }

    // ------------------------------------------------------------ R2 : même référence

    [Fact]
    public void R2_SameReferenceWithDifferentFormatting_IsGrouped()
    {
        var invoice = Line(500_000, thirdParty: Client1, pieceRef: "FAC-2026-001");
        var payment = Line(-500_000, thirdParty: Client1, pieceRef: "fac 2026/001");

        var s = Assert.Single(Run(new[] { invoice, payment }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionKind.SameReference, s.Kind);
        Assert.Equal(SuggestionCategory.Exact, s.Category);
        Assert.Equal(93, s.Score); // 85 + même tiers (5) + dates proches (3)
        Assert.Equal(2, s.RuleRank);
        var reason = Assert.Single(s.Reasons);
        Assert.Equal(EngineReasonCodes.SameReference, reason.Code);
        Assert.Equal("FAC-2026-001", reason.Args["reference"]);
    }

    [Fact]
    public void R2_ReferenceOnlyInEntryLabelOrPieceRef_IsFound()
    {
        var invoice = Line(500_000, pieceRef: "FAC-2026-002") with { Label = "Vente" };
        var payment = Line(-500_000) with { Label = "Virement", EntryLabel = "Règlement FAC 2026 002" };

        var s = Assert.Single(Run(new[] { invoice, payment }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionKind.SameReference, s.Kind);
        Assert.Null(s.ThirdPartyId);
    }

    [Fact]
    public void R2_WholeGroupBalanced_IsMultiple()
    {
        var lines = new[]
        {
            Line(1_000_000, thirdParty: Client1, pieceRef: "FAC-2026-003"),
            Line(-600_000, thirdParty: Client1, pieceRef: "FAC-2026-003"),
            Line(-400_000, pieceRef: "FAC-2026-003"),
        };

        var s = Assert.Single(Run(lines, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionCategory.Multiple, s.Category);
        Assert.Equal(3, s.Lines.Count);
        Assert.Equal(Client1, s.ThirdPartyId);
    }

    [Fact]
    public void R2_GroupNotBalanced_FallsBackToSameAmountPair()
    {
        var debit = Line(300_000, pieceRef: "FAC-2026-004");
        var credit = Line(-300_000, pieceRef: "FAC-2026-004");
        var extra = Line(-120_000, pieceRef: "FAC-2026-004");

        var s = Assert.Single(Run(new[] { debit, credit, extra }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionCategory.Exact, s.Category);
        Assert.Equal(new[] { debit.LineId, credit.LineId }, s.Lines.Select(l => l.LineId));
    }

    [Fact]
    public void R2_TokenOnMoreThanMaxLinesPerReference_IsIgnored()
    {
        var lines = new List<LetteringCandidate>();
        for (var i = 0; i < 11; i++)
        {
            lines.Add(Line(100_000 + i, pieceRef: "LOT-2026-777"));
            lines.Add(Line(-(100_000 + i), pieceRef: "LOT-2026-777"));
        }

        // 22 lignes > 20 : jeton ignoré par R2 (R5 peut encore apparier les montants uniques sans tiers).
        Assert.DoesNotContain(Run(lines, DocumentLinks.Empty).Suggestions, x => x.Kind == SuggestionKind.SameReference);

        lines.RemoveRange(20, 2);
        var s = Assert.Single(Run(lines, DocumentLinks.Empty).Suggestions); // 20 lignes : groupe entier équilibré
        Assert.Equal(20, s.Lines.Count);
        Assert.Equal(SuggestionCategory.Multiple, s.Category);
    }

    [Fact]
    public void R2_ContradictoryThirdParties_AreNeverGrouped()
    {
        var lines = new[]
        {
            Line(500_000, thirdParty: Client1, pieceRef: "FAC-2026-005"),
            Line(-500_000, thirdParty: Client2, pieceRef: "FAC-2026-005"),
        };

        Assert.Empty(Run(lines, DocumentLinks.Empty).Suggestions);
    }

    [Fact]
    public void R1_KeepsPriorityOverR2()
    {
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var invoice = Invoice(inv, 700_000, pieceRef: "FAC-2026-006");
        var payment = Line(-700_000, thirdParty: Client1, sourceType: AccountingService.SourcePayment, sourceId: pay, pieceRef: "FAC-2026-006");

        var s = Assert.Single(Run(new[] { invoice, payment }, Links((pay, inv))).Suggestions);

        Assert.Equal(SuggestionKind.DocumentLink, s.Kind);
    }

    // ------------------------------------------------------------ R3 : même tiers + même montant

    [Fact]
    public void R3_SameThirdPartySameAmount_IsSameAmount()
    {
        var debit = Line(250_000, thirdParty: Client1, day: 0);
        var credit = Line(-250_000, thirdParty: Client1, day: 10);

        var s = Assert.Single(Run(new[] { debit, credit }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionKind.SameThirdPartyAmount, s.Kind);
        Assert.Equal(SuggestionCategory.SameAmount, s.Category);
        Assert.Equal(78, s.Score); // 70 + même tiers (5) + dates proches (3)
        Assert.Equal(SuggestionConfidence.Medium, s.Confidence);
        Assert.Equal(new[] { EngineReasonCodes.SameThirdParty, EngineReasonCodes.ExactAmount }, s.Reasons.Select(r => r.Code));
        Assert.Equal("250.000", s.Reasons[1].Args["amount"]);
        Assert.Equal("TND", s.Reasons[1].Args["currency"]);
    }

    [Fact]
    public void R3_TwoDebitsForOneCredit_PicksClosestDateAndFlagsAmbiguity()
    {
        var far = Line(100_000, thirdParty: Client1, day: 0);
        var near = Line(100_000, thirdParty: Client1, day: 40);
        var credit = Line(-100_000, thirdParty: Client1, day: 45);

        var s = Assert.Single(Run(new[] { far, near, credit }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(new[] { near.LineId, credit.LineId }, s.Lines.Select(l => l.LineId));
        var ambiguous = Assert.Single(s.Reasons, r => r.Code == EngineReasonCodes.AmbiguousAmount);
        Assert.Equal("1", ambiguous.Args["alternatives"]);
    }

    [Fact]
    public void R3_EqualDateGap_PrefersPaymentAfterInvoice_OnClientAccount()
    {
        // Sur 411, la facture est au débit : le crédit postérieur (jour 15) gagne sur l'antérieur (jour 5).
        var invoice = Line(100_000, thirdParty: Client1, day: 10);
        var before = Line(-100_000, thirdParty: Client1, day: 5);
        var after = Line(-100_000, thirdParty: Client1, day: 15);

        var s = Assert.Single(Run(new[] { invoice, before, after }, DocumentLinks.Empty).Suggestions);

        Assert.Contains(s.Lines, l => l.LineId == after.LineId);
    }

    [Fact]
    public void R3_EqualDateGap_PrefersPaymentAfterInvoice_OnSupplierAccount()
    {
        // Sur 401, la facture est au crédit : le débit (règlement) postérieur gagne.
        var invoice = Line(-100_000, "4011", thirdParty: Supplier1, kind: ThirdPartyKind.Supplier, day: 10);
        var before = Line(100_000, "4011", thirdParty: Supplier1, kind: ThirdPartyKind.Supplier, day: 5);
        var after = Line(100_000, "4011", thirdParty: Supplier1, kind: ThirdPartyKind.Supplier, day: 15);

        var s = Assert.Single(Run(new[] { invoice, before, after }, DocumentLinks.Empty).Suggestions);

        Assert.Contains(s.Lines, l => l.LineId == after.LineId);
    }

    [Fact]
    public void R3_PairingIsIndependentOfWhichSideComesFirst()
    {
        // Le débit le plus ancien ne « vole » pas le crédit : la paire la plus proche gagne.
        var oldCredit = Line(-100_000, thirdParty: Client1, day: 0);
        var debit = Line(100_000, thirdParty: Client1, day: 30);
        var nearCredit = Line(-100_000, thirdParty: Client1, day: 31);
        var oldDebit = Line(100_000, thirdParty: Client1, day: 1);

        var output = Run(new[] { oldCredit, debit, nearCredit, oldDebit }, DocumentLinks.Empty);

        Assert.Equal(2, output.Suggestions.Count);
        Assert.Contains(output.Suggestions, s => s.Lines.Select(l => l.LineId).SequenceEqual(new[] { debit.LineId, nearCredit.LineId }));
        Assert.Contains(output.Suggestions, s => s.Lines.Select(l => l.LineId).SequenceEqual(new[] { oldCredit.LineId, oldDebit.LineId }));
    }

    [Fact]
    public void R3_ManyIdenticalAmounts_StaysBoundedAndPairsEverything()
    {
        // 100 × 100 paires possibles > MaxPairsPerAmount : appariement débit par débit, toujours complet.
        var lines = new List<LetteringCandidate>();
        for (var i = 0; i < 100; i++)
        {
            lines.Add(Line(50_000, thirdParty: Client1, day: i));
            lines.Add(Line(-50_000, thirdParty: Client1, day: i));
        }

        var output = Run(lines, DocumentLinks.Empty);

        Assert.Equal(100, output.Suggestions.Count);
        Assert.All(output.Suggestions, s => Assert.Equal(0, LetteringSuggestionEngine.DaysBetween(s.Lines[0], s.Lines[1])));
    }

    [Fact]
    public void R3_DifferentThirdParties_AreNeverPaired()
    {
        var lines = new[] { Line(100_000, thirdParty: Client1), Line(-100_000, thirdParty: Client2) };

        Assert.Empty(Run(lines, DocumentLinks.Empty).Suggestions);
    }

    [Fact]
    public void R3_SameIdButDifferentKind_AreNeverPaired()
    {
        var lines = new[]
        {
            Line(100_000, thirdParty: Client1, kind: ThirdPartyKind.Client),
            Line(-100_000, thirdParty: Client1, kind: ThirdPartyKind.Supplier),
        };

        Assert.Empty(Run(lines, DocumentLinks.Empty).Suggestions);
    }

    [Fact]
    public void R3_WithoutThirdParty_LeavesThePairToR5()
    {
        var lines = new[] { Line(100_000), Line(-100_000) };

        var s = Assert.Single(Run(lines, DocumentLinks.Empty).Suggestions);
        Assert.Equal(SuggestionKind.AmountOnly, s.Kind);
    }

    [Fact]
    public void R3_OneMillimeGap_IsNeverProposed()
    {
        var lines = new[] { Line(100_000, thirdParty: Client1), Line(-99_999, thirdParty: Client1) };

        Assert.Empty(Run(lines, DocumentLinks.Empty).Suggestions);
    }

    [Fact]
    public void R2_KeepsPriorityOverR3()
    {
        var debit = Line(100_000, thirdParty: Client1, pieceRef: "FAC-2026-010");
        var credit = Line(-100_000, thirdParty: Client1, pieceRef: "FAC-2026-010");

        var s = Assert.Single(Run(new[] { debit, credit }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionKind.SameReference, s.Kind);
    }

    // ------------------------------------------------------------ R4 : somme de sous-ensemble

    [Fact]
    public void R4_ThreePaymentsForOneInvoice_IsSubsetSum()
    {
        var invoice = Line(1_000_000, thirdParty: Client1, day: 0);
        var p1 = Line(-500_000, thirdParty: Client1, day: 10);
        var p2 = Line(-300_000, thirdParty: Client1, day: 20);
        var p3 = Line(-200_000, thirdParty: Client1, day: 30);
        var noise = Line(-450_000, thirdParty: Client1, day: 5);

        var s = Assert.Single(Run(new[] { invoice, p1, p2, p3, noise }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionKind.SubsetSum, s.Kind);
        Assert.Equal(SuggestionCategory.Multiple, s.Category);
        Assert.Equal(4, s.RuleRank);
        Assert.Equal(new[] { invoice.LineId, p1.LineId, p2.LineId, p3.LineId }, s.Lines.Select(l => l.LineId));
        Assert.Equal("4", Assert.Single(s.Reasons, r => r.Code == EngineReasonCodes.SubsetSum).Args["count"]);
        Assert.Equal(68, s.Score); // 60 + même tiers (5) + dates proches (3)
        Assert.Equal(SuggestionConfidence.Medium, s.Confidence);
    }

    [Fact]
    public void R4_OnePaymentForThreeInvoices_IsSubsetSum()
    {
        var i1 = Line(400_000, thirdParty: Client1, day: 0);
        var i2 = Line(350_000, thirdParty: Client1, day: 1);
        var i3 = Line(250_000, thirdParty: Client1, day: 2);
        var payment = Line(-1_000_000, thirdParty: Client1, day: 20);

        var s = Assert.Single(Run(new[] { i1, i2, i3, payment }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionKind.SubsetSum, s.Kind);
        Assert.Equal(4, s.Lines.Count);
    }

    [Fact]
    public void R4_WithoutThirdParty_IsNeverProposed()
    {
        var lines = new[] { Line(1_000_000), Line(-600_000), Line(-400_000) };

        Assert.Empty(Run(lines, DocumentLinks.Empty).Suggestions);
    }

    [Fact]
    public void R4_MixedThirdParties_AreNeverGrouped()
    {
        var lines = new[] { Line(1_000_000, thirdParty: Client1), Line(-600_000, thirdParty: Client1), Line(-400_000, thirdParty: Client2) };

        Assert.Empty(Run(lines, DocumentLinks.Empty).Suggestions);
    }

    [Fact]
    public void R4_BudgetExhausted_ReportsSearchBudgetAndIsDeterministic()
    {
        // 30 crédits pairs, cibles impaires : aucune solution, l'espace dépasse un budget de 50 nœuds.
        var lines = new List<LetteringCandidate>();
        for (var i = 0; i < 3; i++)
            lines.Add(Line(10_001 + (2 * i), thirdParty: Client1, day: i));
        for (var i = 0; i < 30; i++)
            lines.Add(Line(-(1_000 + (2L * i * i)), thirdParty: Client1, day: i));
        var options = LetteringEngineOptions.From(new LetteringSuggestionSettings { SubsetNodeBudgetPerTarget = 50, SubsetMaxSize = 6 });

        var first = Run(lines, DocumentLinks.Empty, options);
        var second = Run(lines, DocumentLinks.Empty, options);

        Assert.True(first.Truncated);
        Assert.Equal(LetteringEngineOutput.ReasonSearchBudget, first.TruncationReason);
        Assert.Equal(first.Suggestions.Select(s => s.Key), second.Suggestions.Select(s => s.Key));
        Assert.Equal(first.TruncationReason, second.TruncationReason);
    }

    [Fact]
    public void R4_GlobalBudget_StopsTheSearch()
    {
        var lines = new List<LetteringCandidate>();
        for (var c = 0; c < 5; c++)
        {
            var client = new Guid(0x100 + c, 0, 0, new byte[8]);
            lines.Add(Line(10_001, thirdParty: client));
            for (var i = 0; i < 20; i++)
                lines.Add(Line(-(1_000 + (2L * i)), thirdParty: client, day: i));
        }
        var options = LetteringEngineOptions.From(new LetteringSuggestionSettings { SubsetGlobalNodeBudget = 10 });

        var output = Run(lines, DocumentLinks.Empty, options);

        Assert.Equal(LetteringEngineOutput.ReasonSearchBudget, output.TruncationReason);
    }

    [Fact]
    public void R4_TargetDate_DecidesBetweenSolutionsOfSameSize()
    {
        // Deux solutions de 2 lignes : une paire très ancienne (étalement interne nul) et une paire proche
        // du règlement. L'étalement se mesure cible comprise : la paire proche gagne.
        var old1 = Line(600_000, thirdParty: Client1, day: 0);
        var old2 = Line(400_000, thirdParty: Client1, day: 0);
        var near1 = Line(700_000, thirdParty: Client1, day: 880);
        var near2 = Line(300_000, thirdParty: Client1, day: 895);
        var payment = Line(-1_000_000, thirdParty: Client1, day: 900);

        var s = Assert.Single(Run(new[] { old1, old2, near1, near2, payment }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(new HashSet<Guid> { payment.LineId, near1.LineId, near2.LineId }, s.Lines.Select(l => l.LineId).ToHashSet());
        Assert.DoesNotContain(s.Reasons, r => r.Code == EngineReasonCodes.DateGap);
    }

    [Fact]
    public void R4_RepeatedAmounts_AreReportedAsAmbiguous()
    {
        var invoice = Line(100_000, thirdParty: Client1, day: 0);
        var p1 = Line(-50_000, thirdParty: Client1, day: 1);
        var p2 = Line(-50_000, thirdParty: Client1, day: 2);
        var p3 = Line(-50_000, thirdParty: Client1, day: 3);

        var s = Assert.Single(Run(new[] { invoice, p1, p2, p3 }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(new[] { invoice.LineId, p1.LineId, p2.LineId }, s.Lines.Select(l => l.LineId));
        Assert.Equal("1", Assert.Single(s.Reasons, r => r.Code == EngineReasonCodes.AmbiguousAmount).Args["alternatives"]);
        Assert.Equal(53, s.Score); // 60 + 5 + 3 − 15
        Assert.Equal(SuggestionConfidence.Low, s.Confidence);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void R4_CandidateWindow_KeepsOnlyTheNearestLines(bool solutionIsNear)
    {
        // 30 crédits « bruit » (petits montants pairs, aucune somme n'atteint la cible) et une vraie
        // solution 600 000 + 400 000. La fenêtre garde les 25 crédits les plus proches de la facture.
        var lines = new List<LetteringCandidate> { Line(1_000_000, thirdParty: Client1, day: 100) };
        var solutionDay = solutionIsNear ? 100 : 0;
        var noiseDay = solutionIsNear ? 300 : 90;
        lines.Add(Line(-600_000, thirdParty: Client1, day: solutionDay));
        lines.Add(Line(-400_000, thirdParty: Client1, day: solutionDay + 1));
        for (var i = 0; i < 30; i++)
            lines.Add(Line(-(1_000 + (2L * i * i)), thirdParty: Client1, day: noiseDay + i));

        var subsets = Run(lines, DocumentLinks.Empty).Suggestions.Where(s => s.Kind == SuggestionKind.SubsetSum).ToList();

        if (solutionIsNear)
            Assert.Equal(3, Assert.Single(subsets).Lines.Count);
        else
            Assert.Empty(subsets);
    }

    [Fact]
    public void R4_SameDateCandidatesBeforeTheTarget_AreTakenByOrderRank()
    {
        // Fenêtre de 2 : parmi trois crédits du même jour, les deux plus petits rangs sont retenus.
        var invoice = Line(100_000, thirdParty: Client1, day: 10);
        var r1 = Line(-60_000, thirdParty: Client1, day: 5);
        var r2 = Line(-40_000, thirdParty: Client1, day: 5);
        var r3 = Line(-50_000, thirdParty: Client1, day: 5);
        var options = LetteringEngineOptions.From(new LetteringSuggestionSettings { SubsetMaxCandidates = 2 });

        var s = Assert.Single(Run(new[] { invoice, r3, r2, r1 }, DocumentLinks.Empty, options).Suggestions);

        Assert.Equal(new HashSet<Guid> { invoice.LineId, r1.LineId, r2.LineId }, s.Lines.Select(l => l.LineId).ToHashSet());
    }

    [Fact]
    public void R2_LinesSharingSeveralTokens_GiveOneSuggestion()
    {
        var debit = Line(100_000, pieceRef: "FAC-2026-001") with { Label = "CMD-2026-050" };
        var credit = Line(-100_000, pieceRef: "FAC-2026-001") with { Label = "CMD-2026-050" };

        var first = Assert.Single(Run(new[] { debit, credit }, DocumentLinks.Empty).Suggestions);
        var second = Assert.Single(Run(new[] { credit, debit }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionKind.SameReference, first.Kind);
        Assert.Equal(ReasonsText(first), ReasonsText(second));
    }

    [Fact]
    public void R2_TokenThreshold_CountsLinesAlreadyTakenByR1()
    {
        // 24 lignes portent le jeton ; R1 en prend 4. Les 20 restantes ne rendent pas le jeton spécifique.
        var lines = new List<LetteringCandidate>();
        var paymentLinks = new Dictionary<Guid, Guid>();
        for (var i = 0; i < 2; i++)
        {
            var (inv, pay) = (new Guid(0x7000 + i, 2, 0, new byte[8]), new Guid(0x7000 + i, 3, 0, new byte[8]));
            lines.Add(Invoice(inv, 200_000 + i, pieceRef: "LOT-2026-777"));
            lines.Add(Payment(pay, 200_000 + i) with { PieceRef = "LOT-2026-777" });
            paymentLinks[pay] = inv;
        }
        for (var i = 0; i < 10; i++)
        {
            lines.Add(Line(100_000 + i, pieceRef: "LOT-2026-777"));
            lines.Add(Line(-(100_000 + i), pieceRef: "LOT-2026-777"));
        }

        var output = Run(lines, new DocumentLinks(paymentLinks, new Dictionary<Guid, Guid>()));

        Assert.Equal(2, output.Suggestions.Count(s => s.Kind == SuggestionKind.DocumentLink));
        Assert.DoesNotContain(output.Suggestions, s => s.Kind == SuggestionKind.SameReference);
    }

    // ------------------------------------------------------------ R5 : montant identique sans tiers

    [Fact]
    public void R5_UniquePairWithoutThirdParty_IsLowConfidence()
    {
        var debit = Line(321_000, thirdParty: Client1);
        var credit = Line(-321_000);

        var s = Assert.Single(Run(new[] { debit, credit }, DocumentLinks.Empty).Suggestions);

        Assert.Equal(SuggestionKind.AmountOnly, s.Kind);
        Assert.Equal(SuggestionCategory.SameAmount, s.Category);
        Assert.Equal(SuggestionConfidence.Low, s.Confidence);
        Assert.Equal(33, s.Score); // 30 + dates proches (3)
        Assert.Equal(Client1, s.ThirdPartyId);
    }

    [Fact]
    public void R5_NotUnique_ProposesNothing()
    {
        var lines = new[] { Line(321_000), Line(321_000), Line(-321_000) };

        Assert.Empty(Run(lines, DocumentLinks.Empty).Suggestions);
    }

    [Fact]
    public void R5_TwoDifferentThirdParties_ProposesNothing()
    {
        var lines = new[] { Line(321_000, thirdParty: Client1), Line(-321_000, thirdParty: Client2) };

        Assert.Empty(Run(lines, DocumentLinks.Empty).Suggestions);
    }

    // ------------------------------------------------------------ score

    [Theory]
    [InlineData(95, true, true, 0, false, false, 100)]   // borné à 100
    [InlineData(70, false, true, 10, false, false, 78)]
    [InlineData(70, false, true, 10, true, false, 63)]   // ambiguïté −15
    [InlineData(70, false, true, 400, false, false, 65)] // écart > 365 j −10, pas de bonus de proximité
    [InlineData(70, false, true, 365, false, false, 75)] // 365 j : ni bonus ni pénalité
    [InlineData(70, false, true, 31, false, true, 73)]   // règlement antérieur −5
    [InlineData(30, false, false, 400, true, true, 0)]   // borné à 0
    [InlineData(30, true, true, 0, false, false, 43)]    // R5 au maximum : 43 < 60, donc toujours « Low »
    public void Scoring_AppliesBonusesAndPenalties(int baseScore, bool sharedRef, bool sameThirdParty, int gapDays, bool ambiguous, bool paymentBefore, int expected)
    {
        var score = LetteringSuggestionScoring.Score(baseScore, new ScoreFacts(sharedRef, sameThirdParty, gapDays, ambiguous, paymentBefore));

        Assert.Equal(expected, score);
    }

    [Theory]
    [InlineData(100, "High")]
    [InlineData(85, "High")]
    [InlineData(84, "Medium")]
    [InlineData(60, "Medium")]
    [InlineData(59, "Low")]
    public void Scoring_ConfidenceThresholds(int score, string expected)
        => Assert.Equal(expected, LetteringSuggestionScoring.Confidence(score).ToString());

    [Fact]
    public void R3_AmbiguityAndLatePayment_LowerTheScore()
    {
        // Paire retenue : écart 400 j (−10) ; une autre ligne de même montant reste (−15).
        var invoice = Line(100_000, thirdParty: Client1, day: 400);
        var payment = Line(-100_000, thirdParty: Client1, day: 0);
        var other = Line(-100_000, thirdParty: Client1, day: -500);

        var s = Assert.Single(Run(new[] { invoice, payment, other }, DocumentLinks.Empty).Suggestions);

        // 70 + même tiers 5 − ambiguïté 15 − écart 10 − règlement antérieur 5 = 45.
        Assert.Equal(45, s.Score);
        Assert.Equal(SuggestionConfidence.Low, s.Confidence);
        Assert.Contains(s.Reasons, r => r.Code == EngineReasonCodes.DateGap && r.Args["days"] == "400");
    }

    [Fact]
    public void R1_SharedReference_AddsReasonAndBonus()
    {
        var inv = Guid.NewGuid();
        var pay = Guid.NewGuid();
        var invoice = Invoice(inv, 1_000_000, client: Client1, pieceRef: "FAC-2026-050") with { Label = "x" };
        var payment = Line(-1_000_000, thirdParty: null, sourceType: AccountingService.SourcePayment, sourceId: pay, pieceRef: "FAC-2026-050");

        var s = Assert.Single(Run(new[] { invoice, payment }, Links((pay, inv))).Suggestions);

        Assert.Equal(SuggestionKind.DocumentLink, s.Kind);
        Assert.Equal(100, s.Score); // 95 + référence 5 + dates 3, borné
        Assert.Contains(s.Reasons, r => r.Code == EngineReasonCodes.SameReference && r.Args["reference"] == "FAC-2026-050");
    }

    // ------------------------------------------------------------ déterminisme et volume

    [Fact]
    public void Run_MixedDataset_IsDeterministicAcrossShuffles()
    {
        var (lines, links) = Generate(seed: 11, count: 600);
        var expected = Run(lines, links);
        Assert.NotEmpty(expected.Suggestions);
        Assert.True(expected.Suggestions.Select(s => s.Kind).Distinct().Count() >= 4, "le jeu doit exercer plusieurs règles");

        var random = new Random(99);
        for (var round = 0; round < 10; round++)
        {
            var shuffled = lines.OrderBy(_ => random.Next()).ToArray();
            var output = Run(shuffled, links);
            Assert.Equal(expected.Suggestions.Select(s => s.Key), output.Suggestions.Select(s => s.Key));
            Assert.Equal(expected.Suggestions.Select(s => s.Score), output.Suggestions.Select(s => s.Score));
            Assert.Equal(expected.Suggestions.Select(ReasonsText), output.Suggestions.Select(ReasonsText));
            Assert.Equal(expected.TotalFound, output.TotalFound);
            Assert.Equal(expected.TruncationReason, output.TruncationReason);
        }
    }

    [Fact]
    public void Run_FiveThousandCandidates_IsFastAndStable()
    {
        var (lines, links) = Generate(seed: 2026, count: 5_000);
        var options = LetteringEngineOptions.From(new LetteringSuggestionSettings { MaxSuggestions = 200 });
        Run(lines.Take(200).ToArray(), links, options); // échauffement JIT, hors mesure

        var watch = System.Diagnostics.Stopwatch.StartNew();
        var first = Run(lines, links, options);
        watch.Stop();
        var second = Run(lines, links, options);

        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(2), $"Durée {watch.Elapsed.TotalMilliseconds:0} ms");
        Assert.Equal(first.Suggestions.Select(s => s.Key), second.Suggestions.Select(s => s.Key));
        Assert.Equal(first.TotalFound, second.TotalFound);
        Assert.True(first.Suggestions.Count <= 200);
    }

    private static string ReasonsText(EngineSuggestion s) =>
        string.Join(";", s.Reasons.Select(r => r.Code + "(" + string.Join(",",
            r.Args.OrderBy(a => a.Key, StringComparer.Ordinal).Select(a => a.Key + "=" + a.Value)) + ")"));

    [Fact]
    public void Run_SingleThirdPartyIdenticalAmounts_UsesBoundedFallbackFastAndStable()
    {
        // 2 500 débits et 2 500 crédits de même montant, un seul tiers : repli glouton de R3.
        var lines = new List<LetteringCandidate>();
        for (var i = 0; i < 2_500; i++)
        {
            lines.Add(Line(100_000, thirdParty: Client1, day: i % 365));
            lines.Add(Line(-100_000, thirdParty: Client1, day: (i * 7) % 365));
        }
        Run(lines.Take(100).ToArray(), DocumentLinks.Empty); // échauffement JIT

        var watch = System.Diagnostics.Stopwatch.StartNew();
        var first = Run(lines, DocumentLinks.Empty);
        watch.Stop();
        var second = Run(lines.AsEnumerable().Reverse().ToArray(), DocumentLinks.Empty);

        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(2), $"Durée {watch.Elapsed.TotalMilliseconds:0} ms");
        Assert.Equal(2_500, first.TotalFound);
        Assert.Equal(first.Suggestions.Select(s => s.Key), second.Suggestions.Select(s => s.Key));
    }

    [Fact]
    public void Run_SingleThirdPartyWithoutAnySolution_StopsOnGlobalBudgetFastAndStable()
    {
        // Débits impairs, crédits pairs de 100 000 à 600 000 : beaucoup de sommes encadrent chaque cible sans
        // jamais tomber juste (parité) ; les élagages ne coupent donc pas tout et R4 épuise le budget global.
        var lines = new List<LetteringCandidate>();
        for (var i = 0; i < 2_500; i++)
        {
            lines.Add(Line(1_000_001 + (2L * i), thirdParty: Client1, day: i % 365));
            lines.Add(Line(-(100_000 + (200L * i)), thirdParty: Client1, day: (i * 3) % 365));
        }
        Run(lines.Take(100).ToArray(), DocumentLinks.Empty); // échauffement JIT

        var watch = System.Diagnostics.Stopwatch.StartNew();
        var first = Run(lines, DocumentLinks.Empty);
        watch.Stop();
        var second = Run(lines, DocumentLinks.Empty);

        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(2), $"Durée {watch.Elapsed.TotalMilliseconds:0} ms");
        Assert.Empty(first.Suggestions);
        Assert.Equal(LetteringEngineOutput.ReasonSearchBudget, first.TruncationReason);
        Assert.Equal(first.TruncationReason, second.TruncationReason);
    }

    /// <summary>Jeu mixte à graine fixe : factures liées, références, tiers, montants répétés, EUR.</summary>
    private (List<LetteringCandidate> Lines, DocumentLinks Links) Generate(int seed, int count)
    {
        var random = new Random(seed);
        var lines = new List<LetteringCandidate>(count);
        var paymentLinks = new Dictionary<Guid, Guid>();
        var clients = Enumerable.Range(0, 60).Select(i => new Guid(0x2000 + i, 0, 0, new byte[8])).ToArray();
        var amounts = new long[] { 100_000, 250_000, 333_000, 500_000, 1_190_000, 75_500 };

        while (lines.Count < count)
        {
            var client = random.Next(10) == 0 ? (Guid?)null : clients[random.Next(clients.Length)];
            var account = random.Next(5) == 0 ? "4112" : "4111";
            var currency = random.Next(8) == 0 ? "EUR" : "TND";
            var amount = amounts[random.Next(amounts.Length)] + (random.Next(4) == 0 ? random.Next(1, 999) * 1_000L : 0);
            var day = random.Next(0, 365);
            switch (random.Next(5))
            {
                case 0: // facture + règlement lié
                    var (inv, pay) = (new Guid(0x5000_0000 + lines.Count, 2, 0, new byte[8]), new Guid(0x5000_0000 + lines.Count, 3, 0, new byte[8]));
                    lines.Add(Line(amount, account, currency, client, sourceType: AccountingService.SourceInvoice, sourceId: inv, day: day));
                    lines.Add(Line(-amount, account, currency, client, sourceType: AccountingService.SourcePayment, sourceId: pay, day: day + random.Next(0, 60)));
                    paymentLinks[pay] = inv;
                    break;
                case 1: // même référence
                    var reference = $"FAC-2026-{random.Next(1, 400):000}";
                    lines.Add(Line(amount, account, currency, client, pieceRef: reference, day: day));
                    lines.Add(Line(-amount, account, currency, null, pieceRef: reference, day: day + random.Next(0, 30)));
                    break;
                case 2: // 1 facture, 2 ou 3 règlements partiels
                    var parts = random.Next(2, 4);
                    lines.Add(Line(amount * parts, account, currency, client ?? clients[0], day: day));
                    for (var i = 0; i < parts; i++)
                        lines.Add(Line(-amount, account, currency, client ?? clients[0], day: day + random.Next(0, 90)));
                    break;
                default: // ligne isolée
                    lines.Add(Line(random.Next(2) == 0 ? amount : -amount, account, currency, client, day: day));
                    break;
            }
        }
        return (lines.Take(count).ToList(), new DocumentLinks(paymentLinks, new Dictionary<Guid, Guid>()));
    }

    [Fact]
    public void Run_ManyInvoices_FinalOrderIsDeterministicAndIndependentOfInputOrder()
    {
        var lines = new List<LetteringCandidate>();
        var links = new List<(Guid, Guid)>();
        for (var i = 0; i < 12; i++)
        {
            var inv = Guid.NewGuid();
            var pay = Guid.NewGuid();
            var account = i % 3 == 0 ? "4112" : "4111";
            lines.Add(Invoice(inv, 100_000 * (i + 1), account: account));
            lines.Add(Payment(pay, 100_000 * (i + 1), account: account));
            if (i % 2 == 0)
            {
                // Facture en deux règlements : catégorie Multiple, classée après les 1-pour-1 de même score.
                var pay2 = Guid.NewGuid();
                lines[^1] = Payment(pay, 50_000 * (i + 1), account: account);
                lines.Add(Payment(pay2, 50_000 * (i + 1), account: account));
                links.Add((pay2, inv));
            }
            links.Add((pay, inv));
        }
        var documentLinks = Links(links.ToArray());

        var expected = Run(lines, documentLinks);
        Assert.Equal(12, expected.Suggestions.Count);
        // Même score : moins de lignes d'abord, puis plus petit rang d'ordre.
        Assert.True(expected.Suggestions.Take(6).All(s => s.Lines.Count == 2));
        Assert.True(expected.Suggestions.Skip(6).All(s => s.Lines.Count == 3));

        var random = new Random(7);
        for (var round = 0; round < 10; round++)
        {
            var shuffled = lines.OrderBy(_ => random.Next()).ToArray();
            var output = Run(shuffled, documentLinks);
            Assert.Equal(expected.Suggestions.Select(s => s.Key), output.Suggestions.Select(s => s.Key));
            Assert.Equal(expected.Suggestions.Select(s => s.Score), output.Suggestions.Select(s => s.Score));
        }
    }

    [Fact]
    public void Run_MaxSuggestions_CapsReturnedButCountsAll()
    {
        var lines = new List<LetteringCandidate>();
        var links = new List<(Guid, Guid)>();
        for (var i = 0; i < 5; i++)
        {
            var (inv, pay) = (Guid.NewGuid(), Guid.NewGuid());
            lines.Add(Invoice(inv, 100_000));
            lines.Add(Payment(pay, 100_000));
            links.Add((pay, inv));
        }
        var options = LetteringEngineOptions.From(new LetteringSuggestionSettings { MaxSuggestions = 3 });

        var output = Run(lines, Links(links.ToArray()), options);

        Assert.Equal(3, output.Suggestions.Count);
        Assert.Equal(5, output.TotalFound);
        Assert.False(output.Truncated);
    }

    [Fact]
    public void Run_CancelledToken_ReportsTimeFuse()
    {
        var (inv, pay) = (Guid.NewGuid(), Guid.NewGuid());
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var output = LetteringSuggestionEngine.Run(
            new[] { Invoice(inv, 100_000), Payment(pay, 100_000) }, Links((pay, inv)), LetteringEngineOptions.Default, cts.Token);

        Assert.True(output.Truncated);
        Assert.Equal(LetteringEngineOutput.ReasonTimeFuse, output.TruncationReason);
        Assert.Empty(output.Suggestions);
    }

    [Fact]
    public void Run_DuplicateAndZeroLines_AreIgnored()
    {
        var (inv, pay) = (Guid.NewGuid(), Guid.NewGuid());
        var invoice = Invoice(inv, 100_000);
        var payment = Payment(pay, 100_000);
        var zero = Line(0, sourceType: AccountingService.SourcePayment, sourceId: pay, thirdParty: Client1);

        var output = Run(new[] { invoice, payment, payment, zero }, Links((pay, inv)));

        var s = Assert.Single(output.Suggestions);
        Assert.Equal(2, s.Lines.Count);
    }

    [Fact]
    public void Options_AreAlwaysClamped()
    {
        var options = LetteringEngineOptions.From(new LetteringSuggestionSettings { SubsetMaxSize = 99, MaxDocumentPayments = 0 });

        Assert.Equal(6, options.SubsetMaxSize);
        Assert.Equal(1, options.MaxDocumentPayments);
    }

    [Fact]
    public void SuggestionKey_IsStableAndIndependentOfIdOrder()
    {
        var a = Guid.Parse("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
        var b = Guid.Parse("00000000-0000-0000-0000-000000000001");

        var key = SuggestionKey.Compute("4111", "TND", new[] { a, b });

        Assert.Equal(key, SuggestionKey.Compute("4111", "TND", new[] { b, a }));
        Assert.Equal(16, key.Length);
        Assert.Matches("^[0-9a-f]{16}$", key);
        Assert.NotEqual(key, SuggestionKey.Compute("4112", "TND", new[] { a, b }));
        Assert.NotEqual(key, SuggestionKey.Compute("4111", "EUR", new[] { a, b }));
        // Valeur figée : la clé circule entre le front, l'audit et les rapports de masse.
        Assert.Equal(SuggestionKeyReference("4111|TND|00000000-0000-0000-0000-000000000001|3f2504e0-4f89-11d3-9a0c-0305e82c3301"), key);
    }

    private static string SuggestionKeyReference(string payload)
        => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(payload)))[..16].ToLowerInvariant();

    /// <summary>
    /// Invariants de toute proposition (annexe C §2.3, §2.6) : au moins 2 lignes, un compte, une devise,
    /// somme d'équilibre nulle, tiers compatibles, clé correcte, aucune ligne dans deux propositions.
    /// </summary>
    private static void AssertInvariants(LetteringEngineOutput output)
    {
        var seen = new HashSet<Guid>();
        foreach (var s in output.Suggestions)
        {
            Assert.True(s.Lines.Count >= 2);
            Assert.All(s.Lines, l => Assert.Equal(s.AccountNumber, l.AccountNumber));
            Assert.All(s.Lines, l => Assert.Equal(s.CurrencyCode, l.CurrencyCode));
            Assert.Equal(0, s.Lines.Sum(l => l.SignedForBalance));
            Assert.True(LetteringSuggestionEngine.TryCommonThirdParty(s.Lines, out _, out _));
            Assert.Equal(SuggestionKey.Compute(s.AccountNumber, s.CurrencyCode, s.Lines.Select(l => l.LineId)), s.Key);
            Assert.All(s.Lines, l => Assert.True(seen.Add(l.LineId), "ligne dans deux propositions"));
            Assert.InRange(s.Score, 0, 100);
        }
        Assert.True(output.Suggestions.Count <= output.TotalFound);
    }
}
