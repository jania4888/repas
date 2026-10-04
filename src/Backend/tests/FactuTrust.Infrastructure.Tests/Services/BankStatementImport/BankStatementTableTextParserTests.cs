using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Repli déterministe du stade « Table Recognition: » de GLM-OCR (plan §3.3) : le tableau HTML ou
/// Markdown renvoyé par le modèle est converti en lignes de page sans nouvel appel IA ; un tableau
/// sans ligne datée ni montant confirme une page vide (pas de stade 3).
/// </summary>
public sealed class BankStatementTableTextParserTests
{
    [Fact]
    public void Parse_reads_an_html_table_with_named_columns()
    {
        const string raw = """
            <table>
              <tr><th>DATE</th><th>DATE VALEUR</th><th>LIBELLE</th><th>DEBIT</th><th>CREDIT</th></tr>
              <tr><td>05/01/2026</td><td>05/01/2026</td><td>VIREMENT RECU CLIENT</td><td></td><td>1 200,500</td></tr>
              <tr><td>07/01/2026</td><td>08/01/2026</td><td>CHEQUE 4587123</td><td>340,000</td><td></td></tr>
            </table>
            """;

        var result = BankStatementTableTextParser.Parse(raw, pageNumber: 1);

        Assert.False(result.IsConfirmedEmpty);
        Assert.NotNull(result.Page);
        Assert.Equal(2, result.Page!.Lines.Count);
        Assert.Equal("2026-01-05", result.Page.Lines[0].Date);
        Assert.Equal("VIREMENT RECU CLIENT", result.Page.Lines[0].Label);
        Assert.Null(result.Page.Lines[0].Debit);
        Assert.NotNull(result.Page.Lines[0].Credit);
        Assert.NotNull(result.Page.Lines[1].Debit);
        Assert.Equal("2026-01-08", result.Page.Lines[1].ValueDate);
    }

    [Fact]
    public void Parse_reads_a_markdown_table_with_a_positional_fallback()
    {
        const string raw = """
            | Date | Opération | Débit | Crédit |
            |------|-----------|-------|--------|
            | 12.05.2026 | REGLEMENT FACTURE | 2 500,000 | |
            | 15/05/26 | REMISE CHEQUE | | 4 100,250 |
            """;

        var result = BankStatementTableTextParser.Parse(raw, pageNumber: 2);

        Assert.NotNull(result.Page);
        Assert.Equal(2, result.Page!.Lines.Count);
        Assert.Equal("2026-05-12", result.Page.Lines[0].Date);
        Assert.Equal("2026-05-15", result.Page.Lines[1].Date);
        Assert.NotNull(result.Page.Lines[0].Debit);
        Assert.NotNull(result.Page.Lines[1].Credit);
        Assert.Equal(3, result.Page.PrintedDecimals);
    }

    [Fact]
    public void Parse_reads_the_page_rib_and_balances()
    {
        const string raw = """
            <table>
              <tr><th>Date</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr>
              <tr><td></td><td>SOLDE AU 01/05/2026</td><td></td><td>965,323</td></tr>
              <tr><td>10/05/2026</td><td>PRELEVEMENT</td><td>100,000</td><td></td></tr>
              <tr><td></td><td>NOUVEAU SOLDE</td><td></td><td>865,323</td></tr>
            </table>
            RIB : 12345678901234567887
            """;

        var result = BankStatementTableTextParser.Parse(raw, pageNumber: 1);

        Assert.NotNull(result.Page);
        Assert.Equal("12345678901234567887", result.Page!.Rib);
        Assert.Equal(965.323m, result.Page.OpeningBalance);
        Assert.Equal(865.323m, result.Page.ClosingBalance);
        Assert.Single(result.Page.Lines);
        Assert.Equal("PRELEVEMENT", result.Page.Lines[0].Label);
    }

    [Fact]
    public void Parse_appends_a_label_only_row_to_the_previous_line()
    {
        const string raw = """
            | Date | Libellé | Débit | Crédit |
            | 05/01/2026 | VIREMENT RECU | | 1 200,500 |
            | | FACTURE FA-2026-042 | | |
            """;

        var result = BankStatementTableTextParser.Parse(raw, pageNumber: 1);

        Assert.NotNull(result.Page);
        Assert.Single(result.Page!.Lines);
        Assert.Contains("FACTURE FA-2026-042", result.Page.Lines[0].Label);
    }

    [Fact]
    public void A_table_without_any_dated_line_or_amount_confirms_an_empty_page()
    {
        const string raw = """
            <table>
              <tr><td>RELEVE DE COMPTE</td><td>Page 2/5</td></tr>
              <tr><td>Agence Centre</td><td>Tel 71 000 000</td></tr>
            </table>
            """;

        var result = BankStatementTableTextParser.Parse(raw, pageNumber: 2);

        Assert.True(result.IsConfirmedEmpty);
        Assert.Empty(result.Page!.Lines);
    }

    [Fact]
    public void Parse_returns_no_table_for_plain_prose()
    {
        Assert.Same(BankStatementTableTextParser.TableParseResult.NoTable, BankStatementTableTextParser.Parse(null, 1));
        Assert.Same(BankStatementTableTextParser.TableParseResult.NoTable, BankStatementTableTextParser.Parse("   ", 1));
        var prose = BankStatementTableTextParser.Parse("Le modèle n'a trouvé aucun tableau sur cette page.", 1);
        Assert.False(prose.IsConfirmedEmpty);
        Assert.Equal(0, prose.RowCount);
    }
}
