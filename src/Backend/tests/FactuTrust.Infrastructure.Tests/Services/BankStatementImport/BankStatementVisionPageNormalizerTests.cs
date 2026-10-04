using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

public sealed class BankStatementVisionPageNormalizerTests
{
    [Fact]
    public void Normalize_parses_tunisian_amount_strings()
    {
        const string json = """
            {"rib":null,"openingBalance":null,"closingBalance":null,"lines":[{"date":"14/07/2026","valueDate":null,"label":"VIR","debit":null,"credit":"1 234,567"}]}
            """;
        var page = BankStatementVisionPageNormalizer.Normalize(json, 1);
        var line = Assert.Single(page.Lines);
        Assert.Equal(1234.567m, line.Credit);
    }

    [Fact]
    public void TryNormalizeRib_accepts_20_digits()
    {
        Assert.Equal("12345678901234567887", BankStatementVisionPageNormalizer.TryNormalizeRib("12 345678901234567887"));
    }

    [Fact]
    public void TryNormalizeRib_rejects_an_incoherent_rib_key()
    {
        // Mieux vaut « RIB non lu » qu'un faux RIB (chiffre mal lu) qui bloquerait l'import.
        Assert.Null(BankStatementVisionPageNormalizer.TryNormalizeRib("12 345678901234567890"));
    }
}
