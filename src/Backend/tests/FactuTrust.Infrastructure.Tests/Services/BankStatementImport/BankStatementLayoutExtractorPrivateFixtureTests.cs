using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Recette sur de VRAIS relevés clients (STB, BH, Zitouna, Attijari). Ces PDF et tout ce qui en
/// est tiré (RIB, soldes, libellés, noms, références) sont des données personnelles : ils ne sont
/// JAMAIS commités. Le dossier désigné par <c>FACTUTRUST_PRIVATE_BANK_FIXTURES</c> contient les PDF
/// et <c>expected.json</c>, les valeurs relevées à la main sur les PDF (solde initial + crédits −
/// débits = solde final). Sans ce dossier (CI comprise), les tests sont ignorés.
///
/// <c>expected.json</c> :
/// <code>
/// { "statements": [ { "file", "profile", "rib", "opening", "closing", "totalDebits", "totalCredits",
///                     "lineCount"?, "creditCount"?, "periodStart", "periodEnd", "totalsLabelled"? } ],
///   "probes": [ { "name", "file", "index"? | "lastOfPage"? | "firstOfPage"? | "amount"? | "labelContains",
///                 "labelStartsWith"?, "labelEndsWith"?, "isDebit"?, "transactionDate"?, "valueDate"?,
///                 "labelLineCount"?, "embeddedVat"? { "net", "vat" }, "singleDontTva"? } ] }
/// </code>
/// Une sonde désigne une opération (par position, par page, par montant ou par libellé) et vérifie
/// ce que l'extraction doit en lire : sens tiré de la colonne (BH), débit négatif (Zitouna),
/// libellé multi-lignes et coupé par un saut de page (Attijari), TVA incluse, libellé sur deux lignes (STB).
/// </summary>
[Trait("Category", "PrivateBankFixtures")]
public sealed class BankStatementLayoutExtractorPrivateFixtureTests
{
    private const string FixturesVariable = "FACTUTRUST_PRIVATE_BANK_FIXTURES";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };

    public static IEnumerable<object[]> Statements => Indexes(e => e.Statements.Count);

    public static IEnumerable<object[]> Probes => Indexes(e => e.Probes.Count);

    [SkippableTheory]
    [MemberData(nameof(Statements))]
    public void Extract_real_statement_reconciles_to_the_millime(int index)
    {
        var expected = Expected().Statements[index];
        var result = Extract(expected.File);

        Assert.Empty(result.Issues.Where(i => i.Severity == StatementIssueSeverity.Blocking).Select(i => i.Message));
        Assert.Equal(expected.Profile, result.ProfileId);
        Assert.Equal(expected.Rib, result.Header.Rib);
        Assert.Equal("TND", result.Header.Currency);
        Assert.Equal(expected.Opening, result.Header.OpeningBalance!.Value);
        Assert.Equal(expected.Closing, result.Header.ClosingBalance!.Value);
        Assert.Equal(DateOnly.Parse(expected.PeriodStart, CultureInfo.InvariantCulture), result.Header.PeriodStart);
        Assert.Equal(DateOnly.Parse(expected.PeriodEnd, CultureInfo.InvariantCulture), result.Header.PeriodEnd);
        if (expected.TotalsLabelled is { } labelled)
            Assert.Equal(labelled, result.Header.TotalsLabelled);

        var check = BankStatementBalanceCheck.Evaluate(result.Header, result.Lines);
        Assert.True(check.IsBalanced, $"écart {check.Difference}");
        Assert.InRange(check.SumDebits, expected.TotalDebits - 0.005m, expected.TotalDebits + 0.005m);
        Assert.InRange(check.SumCredits, expected.TotalCredits - 0.005m, expected.TotalCredits + 0.005m);

        if (expected.LineCount is { } lineCount)
            Assert.Equal(lineCount, result.Lines.Count);
        if (expected.CreditCount is { } creditCount)
            Assert.Equal(creditCount, result.Lines.Count(l => !l.IsDebit));
        Assert.All(result.Lines, l => Assert.True(l.Amount > 0));
        Assert.All(result.Lines, l => Assert.False(string.IsNullOrWhiteSpace(l.Label)));
    }

    [SkippableTheory]
    [MemberData(nameof(Probes))]
    public void Probed_operation_is_read_as_printed(int index)
    {
        var probe = Expected().Probes[index];
        var result = Extract(probe.File);
        var line = Select(result, probe);

        foreach (var fragment in probe.LabelContains ?? Array.Empty<string>())
            Assert.Contains(fragment, line.Label, StringComparison.Ordinal);
        if (probe.LabelStartsWith is not null)
            Assert.StartsWith(probe.LabelStartsWith, line.Label, StringComparison.Ordinal);
        if (probe.LabelEndsWith is not null)
            Assert.EndsWith(probe.LabelEndsWith, line.Label, StringComparison.Ordinal);
        if (probe.Amount is { } amount)
            Assert.Equal(amount, line.Amount);
        if (probe.IsDebit is { } isDebit)
            Assert.Equal(isDebit, line.IsDebit);
        if (probe.TransactionDate is not null)
            Assert.Equal(DateOnly.Parse(probe.TransactionDate, CultureInfo.InvariantCulture), line.TransactionDate);
        if (probe.ValueDate is not null)
            Assert.Equal(DateOnly.Parse(probe.ValueDate, CultureInfo.InvariantCulture), line.ValueDate);
        if (probe.LabelLineCount is { } labelLines)
            Assert.Equal(labelLines, line.LabelLines.Count);
        if (probe.SingleDontTva == true)
            Assert.Single(System.Text.RegularExpressions.Regex.Matches(line.Label, "DONT TVA"));
        if (probe.EmbeddedVat is { } expectedVat)
        {
            var vat = BankStatementEmbeddedVat.TryRead(line.Label, line.Amount);
            Assert.NotNull(vat);
            Assert.Equal(expectedVat.Net, vat!.NetAmount);
            Assert.Equal(expectedVat.Vat, vat.VatAmount);
            Assert.True(vat.RateConsistent);
        }
    }

    private static ExtractedStatementLine Select(ExtractedBankStatement result, Probe probe)
    {
        if (probe.Index is { } index)
            return result.Lines[index];
        if (probe.LastOfPage is { } lastPage)
            return result.Lines.Last(l => l.PageNumber == lastPage);
        if (probe.FirstOfPage is { } firstPage)
            return result.Lines.First(l => l.PageNumber == firstPage);
        var candidates = result.Lines.Where(l =>
            (probe.Amount is not { } amount || l.Amount == amount)
            && (probe.LabelStartsWith is null || l.Label.StartsWith(probe.LabelStartsWith, StringComparison.Ordinal))
            && (probe.LabelContains ?? Array.Empty<string>()).All(f => l.Label.Contains(f, StringComparison.Ordinal)));
        return candidates.First();
    }

    private static IEnumerable<object[]> Indexes(Func<ExpectedFile, int> count)
    {
        // La découverte des tests a lieu même sans dossier privé : une ligne factice, ignorée à l'exécution.
        var expected = TryLoadExpected();
        var total = expected is null ? 1 : Math.Max(1, count(expected));
        return Enumerable.Range(0, total).Select(i => new object[] { i });
    }

    private static ExpectedFile Expected()
    {
        var directory = Directory();
        var path = Path.Combine(directory, "expected.json");
        Skip.IfNot(File.Exists(path), $"{path} absent : recette privée ignorée.");
        return JsonSerializer.Deserialize<ExpectedFile>(File.ReadAllText(path), JsonOptions)!;
    }

    private static ExpectedFile? TryLoadExpected()
    {
        var directory = Environment.GetEnvironmentVariable(FixturesVariable);
        if (string.IsNullOrWhiteSpace(directory))
            return null;
        var path = Path.Combine(directory, "expected.json");
        return File.Exists(path) ? JsonSerializer.Deserialize<ExpectedFile>(File.ReadAllText(path), JsonOptions) : null;
    }

    private static string Directory()
    {
        var directory = Environment.GetEnvironmentVariable(FixturesVariable);
        Skip.If(string.IsNullOrWhiteSpace(directory), $"{FixturesVariable} non défini : recette privée ignorée.");
        return directory!;
    }

    private static ExtractedBankStatement Extract(string file)
    {
        var path = Path.Combine(Directory(), file);
        Skip.IfNot(File.Exists(path), $"{path} absent : recette privée ignorée.");
        return new BankStatementLayoutExtractor().Extract(File.ReadAllBytes(path));
    }

    private sealed record ExpectedFile(List<ExpectedStatement> Statements, List<Probe> Probes);

    private sealed record ExpectedStatement(
        string File, string Profile, string Rib, decimal Opening, decimal Closing, decimal TotalDebits, decimal TotalCredits,
        int? LineCount, int? CreditCount, string PeriodStart, string PeriodEnd, bool? TotalsLabelled);

    private sealed record Probe(
        string Name, string File, int? Index, int? LastOfPage, int? FirstOfPage, decimal? Amount, string[]? LabelContains,
        string? LabelStartsWith, string? LabelEndsWith, bool? IsDebit, string? TransactionDate, string? ValueDate,
        int? LabelLineCount, ExpectedVat? EmbeddedVat, bool? SingleDontTva);

    private sealed record ExpectedVat(decimal Net, decimal Vat);
}
