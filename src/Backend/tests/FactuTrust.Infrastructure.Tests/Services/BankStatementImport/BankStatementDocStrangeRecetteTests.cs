using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Recette du chemin Docstrange sur un relevé RÉEL, de bout en bout : réponse du service →
/// <see cref="BankStatementVisionPageNormalizer"/> → <see cref="BankStatementAiPageReader"/>.
///
/// <para>C'est le seul test qui juge réellement le correctif. Les autres emploient des PDF
/// synthétiques, dont les colonnes sont régulières ; le relevé BH ne l'est pas — ses libellés
/// portent des numéros de pièce (« VRST. 5055968 ») que la lecture du tableau en Markdown prenait
/// pour des montants, et ses dates d'opération sont imprimées sans année (« 05-06 »).</para>
///
/// <para>La réponse rejouée ici a été relevée contre l'API le 2026-10-09 avec
/// <c>LlmOutputSchemas.BankStatementPageVerbatim</c>. Elle vit dans le dossier privé, <b>jamais
/// dans le dépôt</b> : c'est un relevé bancaire réel.</para>
/// </summary>
[Trait("Category", "PrivateBankFixtures")]
public sealed class BankStatementDocStrangeRecetteTests
{
    private const string FixturesVariable = "FACTUTRUST_PRIVATE_BANK_FIXTURES";
    private const string ResponseFile = "bh-docstrange-page1.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };

    [SkippableFact]
    public void The_real_bh_statement_read_by_docstrange_reconciles_to_the_millime()
    {
        var (raw, expected) = Load();

        var page = BankStatementVisionPageNormalizer.Normalize(raw, pageNumber: 1);
        var reading = BankStatementAiPageReader.Read(
            page, pageNumber: 1, ocrText: null,
            BankStatementAiReadOptions.AiOnlyText(
                DateOnly.Parse(expected.PeriodStart!), DateOnly.Parse(expected.PeriodEnd!)));

        // 1. Le compte d'opérations. Le tableau en Markdown en produisait davantage : il y faisait
        //    entrer la ligne de solde initial et l'en-tête des colonnes.
        Assert.Equal(expected.LineCount!.Value, reading.Lines.Count);

        // 2. Les totaux, au millime. C'est ce que l'écran comparait au total imprimé, et l'écart
        //    annoncé était de 11 515,464 sur les crédits.
        Assert.Equal(expected.TotalDebits, reading.Lines.Where(l => l.IsDebit).Sum(l => l.Amount));
        Assert.Equal(expected.TotalCredits, reading.Lines.Where(l => !l.IsDebit).Sum(l => l.Amount));
        Assert.Equal(expected.CreditCount!.Value, reading.Lines.Count(l => !l.IsDebit));

        // 3. Le relevé boucle : solde initial + crédits − débits = solde final imprimé.
        Assert.Equal(expected.Opening, page.OpeningBalance);
        Assert.Equal(expected.Closing, page.ClosingBalance);
        Assert.Equal(expected.Closing, expected.Opening + expected.TotalCredits - expected.TotalDebits);

        // 4. Le RIB est lu, clé comprise.
        Assert.Equal(expected.Rib, page.Rib);

        // 5. Aucune page en échec, aucune ligne à corriger : la lecture est propre d'emblée.
        Assert.DoesNotContain(reading.Issues, i => i.Code == StatementIssueCodes.AiPageFailed);
        Assert.DoesNotContain(reading.Issues, i => i.Code == StatementIssueCodes.AiLineNeedsReview);
    }

    [SkippableFact]
    public void Every_operation_is_dated_by_its_own_printed_day_not_by_its_value_date()
    {
        // Le defaut le plus trompeur du chemin Markdown : « 05-06 » etant juge illisible, chaque
        // ligne heritait d'une autre date. TABKA, imprimee au 12-06 (valeur 15-06), s'affichait au
        // 15/06. Toutes les dates etaient decalees sans que rien ne le signale.
        var (raw, expected) = Load();
        var start = DateOnly.Parse(expected.PeriodStart!);
        var end = DateOnly.Parse(expected.PeriodEnd!);

        var page = BankStatementVisionPageNormalizer.Normalize(raw, pageNumber: 1);
        var reading = BankStatementAiPageReader.Read(
            page, pageNumber: 1, ocrText: null, BankStatementAiReadOptions.AiOnlyText(start, end));

        Assert.All(reading.Lines, l =>
        {
            Assert.InRange(l.TransactionDate, start, end);
            // La date d'operation et la date valeur different sur ce releve : les confondre se
            // verrait ici.
            Assert.NotEqual(default, l.TransactionDate);
        });

        var tabka = Assert.Single(reading.Lines, l => l.Label.Contains("TABKA", StringComparison.Ordinal));
        Assert.Equal(new DateOnly(2026, 6, 12), tabka.TransactionDate);
        Assert.Equal(new DateOnly(2026, 6, 15), tabka.ValueDate);
        Assert.Equal(10_000.000m, tabka.Amount);
        Assert.False(tabka.IsDebit);
    }

    [SkippableFact]
    public void A_reference_number_inside_a_label_is_never_read_as_an_amount()
    {
        // « VRST. 5055968 » : le Markdown lisait 5 055 968,000 au debit. C'est un credit de 2 500.
        var (raw, expected) = Load();

        var page = BankStatementVisionPageNormalizer.Normalize(raw, pageNumber: 1);
        var reading = BankStatementAiPageReader.Read(
            page, pageNumber: 1, ocrText: null,
            BankStatementAiReadOptions.AiOnlyText(DateOnly.Parse(expected.PeriodStart!), DateOnly.Parse(expected.PeriodEnd!)));

        var versement = reading.Lines.First(l => l.Label.StartsWith("VRST", StringComparison.Ordinal));
        Assert.Equal(2_500.000m, versement.Amount);
        Assert.False(versement.IsDebit);

        // Aucun montant aberrant : le plus gros du releve reste du meme ordre que son total.
        Assert.All(reading.Lines, l => Assert.InRange(l.Amount, 0m, expected.TotalCredits));
    }

    // ---- outillage -------------------------------------------------------------------------

    private static (string Raw, ExpectedStatement Expected) Load()
    {
        var directory = Environment.GetEnvironmentVariable(FixturesVariable);
        Skip.If(string.IsNullOrWhiteSpace(directory), $"{FixturesVariable} non défini : recette privée ignorée.");

        var responsePath = Path.Combine(directory!, ResponseFile);
        Skip.IfNot(File.Exists(responsePath),
            $"{ResponseFile} absent : rejouez la sonde Docstrange sur bh.pdf pour l'enregistrer.");

        var expectedPath = Path.Combine(directory!, "expected.json");
        Skip.IfNot(File.Exists(expectedPath), "expected.json absent : recette privée ignorée.");

        var file = JsonSerializer.Deserialize<ExpectedFile>(File.ReadAllText(expectedPath), JsonOptions)!;
        var expected = file.Statements.Single(s => s.File == "bh.pdf");

        // La verite de reference doit etre complete, sinon le test ne prouverait rien.
        Assert.NotNull(expected.LineCount);
        Assert.NotNull(expected.CreditCount);
        Assert.NotNull(expected.PeriodStart);
        Assert.NotNull(expected.PeriodEnd);
        Assert.NotNull(expected.Rib);

        return (File.ReadAllText(responsePath), expected);
    }

    private sealed record ExpectedFile(List<ExpectedStatement> Statements);

    /// <summary>
    /// Tous les champs facultatifs sont nullables : <c>expected.json</c> décrit plusieurs relevés
    /// et n'en renseigne pas autant pour chacun. Seule l'entrée BH est exploitée ici, et
    /// <see cref="Load"/> vérifie que ce qu'elle doit porter y est.
    /// </summary>
    private sealed record ExpectedStatement(
        string File,
        string? Rib,
        decimal Opening,
        decimal Closing,
        decimal TotalDebits,
        decimal TotalCredits,
        int? LineCount,
        int? CreditCount,
        string? PeriodStart,
        string? PeriodEnd);
}
