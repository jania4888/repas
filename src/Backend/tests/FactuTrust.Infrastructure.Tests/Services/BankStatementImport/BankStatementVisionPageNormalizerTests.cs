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
    public void TryNormalizeRib_accepts_the_2923_numeric_iban_form()
    {
        // « TN » converti en chiffres (T=29, N=23) + clé IBAN « 59 » + RIB : 26 chiffres.
        Assert.Equal("12345678901234567887", BankStatementVisionPageNormalizer.TryNormalizeRib("2923 5912 3456 7890 1234 5678 87"));
        // La forme tronquée à 24 chiffres (sans la clé) n'est pas un RIB : mieux vaut « non lu ».
        Assert.Null(BankStatementVisionPageNormalizer.TryNormalizeRib("292312345678901234567887"));
    }

    [Fact]
    public void ParseBalance_tolerates_a_tnd_suffix_without_reading_a_debit_sign()
    {
        // « 1 234,567 TND » : le « D » final de TND n'est pas un suffixe DÉBITEUR.
        var (value, signed) = BankStatementVisionPageNormalizer.ParseBalance("1 234,567 TND");
        Assert.Equal(1_234.567m, value);
        Assert.False(signed);

        var (negative, negativeSigned) = BankStatementVisionPageNormalizer.ParseBalance("1 234,567 TND D");
        Assert.Equal(-1_234.567m, negative);
        Assert.True(negativeSigned);
    }

    [Fact]
    public void ParseSideAmount_tolerates_a_tnd_suffix()
    {
        Assert.Equal(1_234.567m, BankStatementVisionPageNormalizer.ParseSideAmount("1 234,567 TND", isDebitColumn: true));
        Assert.Equal(1_234.567m, BankStatementVisionPageNormalizer.ParseSideAmount("1 234,567 TND", isDebitColumn: false));
        Assert.Equal(-1_234.567m, BankStatementVisionPageNormalizer.ParseSideAmount("1 234,567 D", isDebitColumn: false));
    }

    [Fact]
    public void TryNormalizeRib_rejects_an_incoherent_rib_key()
    {
        // Mieux vaut « RIB non lu » qu'un faux RIB (chiffre mal lu) qui bloquerait l'import.
        Assert.Null(BankStatementVisionPageNormalizer.TryNormalizeRib("12 345678901234567890"));
    }
}
