using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Application.Features.AI.Json;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>Convertit la sortie verbatim GLM-OCR en <see cref="LlmBankStatementPage"/> typé.</summary>
public static partial class BankStatementVisionPageNormalizer
{
    public static LlmBankStatementPage Normalize(string json, int pageNumber)
    {
        var verbatim = JsonSerializer.Deserialize<LlmBankStatementPageVerbatim>(json, LlmJsonOptions.Tolerant)
                       ?? new LlmBankStatementPageVerbatim();
        return new LlmBankStatementPage
        {
            OpeningBalance = ParseBalance(verbatim.OpeningBalance),
            ClosingBalance = ParseBalance(verbatim.ClosingBalance),
            Lines = (verbatim.Lines ?? new List<LlmBankStatementPageVerbatimLine>())
                .Select(l => new LlmBankStatementPageLine
                {
                    Date = Sanitize(l.Date),
                    ValueDate = Sanitize(l.ValueDate),
                    Label = SanitizeLabel(l.Label),
                    Debit = ParseSideAmount(l.Debit, isDebitColumn: true),
                    Credit = ParseSideAmount(l.Credit, isDebitColumn: false)
                })
                .ToList()
        };
    }

    public static string? TryNormalizeRib(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        return digits.Length == 20 ? digits : null;
    }

    private static string? Sanitize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        var t = ControlChars().Replace(value.Trim(), " ");
        return t.Length > 300 ? t[..300] : t;
    }

    private static string SanitizeLabel(string? value) => Sanitize(value) ?? string.Empty;

    private static decimal? ParseBalance(string? printed)
    {
        if (string.IsNullOrWhiteSpace(printed))
            return null;
        if (!BankStatementLayoutExtractor.TryParseAmount(printed.Trim(), out var value, out _))
            return null;
        return Math.Round(value, 3, MidpointRounding.AwayFromZero);
    }

    private static decimal? ParseSideAmount(string? printed, bool isDebitColumn)
    {
        if (string.IsNullOrWhiteSpace(printed))
            return null;
        var t = printed.Trim();
        var negative = t.StartsWith("-", StringComparison.Ordinal) || (t.Length >= 2 && t[0] == '(' && t[^1] == ')');
        if (negative)
            t = t.Trim().TrimStart('(').TrimEnd(')').TrimStart('-').Trim();
        if (!BankStatementLayoutExtractor.TryParseAmount(t, out var value, out _))
            return null;
        value = Math.Abs(value);
        if (negative && !isDebitColumn)
            return -value;
        return value;
    }

    private sealed class LlmBankStatementPageVerbatim
    {
        public string? Rib { get; set; }
        public string? OpeningBalance { get; set; }
        public string? ClosingBalance { get; set; }
        public List<LlmBankStatementPageVerbatimLine>? Lines { get; set; }
    }

    private sealed class LlmBankStatementPageVerbatimLine
    {
        public string? Date { get; set; }
        public string? ValueDate { get; set; }
        public string? Label { get; set; }
        public string? Debit { get; set; }
        public string? Credit { get; set; }
    }

    [GeneratedRegex(@"[\u0000-\u001F\u007F]", RegexOptions.CultureInvariant)]
    private static partial Regex ControlChars();
}
