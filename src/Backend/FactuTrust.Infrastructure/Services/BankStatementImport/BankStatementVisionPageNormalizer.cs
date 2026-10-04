using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Domain.Banking;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Convertit la sortie verbatim GLM-OCR (chaînes recopiées telles qu'imprimées) en
/// <see cref="LlmBankStatementPage"/> typé : montants tunisiens (« 1 234,567 », suffixes D/C,
/// signe final), dates jour-d'abord ramenées en ISO, RIB/IBAN normalisé avec contrôle de clé,
/// décimales imprimées. Fonctions pures ; rien n'est inventé : ce qui ne se lit pas devient null.
/// </summary>
public static partial class BankStatementVisionPageNormalizer
{
    public static LlmBankStatementPage Normalize(string json, int pageNumber)
    {
        var verbatim = JsonSerializer.Deserialize<LlmBankStatementPageVerbatim>(json, LlmJsonOptions.Tolerant)
                       ?? new LlmBankStatementPageVerbatim();
        return Normalize(verbatim);
    }

    private static LlmBankStatementPage Normalize(LlmBankStatementPageVerbatim verbatim)
    {
        var decimals = new List<int>();
        var lines = (verbatim.Lines ?? new List<LlmBankStatementPageVerbatimLine>())
            .Select(l => new LlmBankStatementPageLine
            {
                Date = NormalizeDate(Sanitize(l.Date)),
                ValueDate = NormalizeDate(Sanitize(l.ValueDate)),
                Label = SanitizeLabel(l.Label),
                Debit = ParseSideAmount(l.Debit, isDebitColumn: true, decimals),
                Credit = ParseSideAmount(l.Credit, isDebitColumn: false, decimals)
            })
            .ToList();

        var opening = ParseBalance(verbatim.OpeningBalance, decimals);
        var closing = ParseBalance(verbatim.ClosingBalance, decimals);

        return new LlmBankStatementPage
        {
            Rib = TryNormalizeRib(verbatim.Rib),
            OpeningBalance = opening.Value,
            OpeningBalanceSigned = opening.Signed,
            ClosingBalance = closing.Value,
            ClosingBalanceSigned = closing.Signed,
            Lines = lines,
            PrintedDecimals = ModalDecimals(decimals)
        };
    }

    /// <summary>
    /// RIB tunisien à 20 chiffres lu sur la page : accepte le RIB nu (espaces/points tolérés),
    /// l'IBAN « TN59 » + 20 chiffres, la forme 22 chiffres « 59 » + RIB (IBAN sans lettres) et la
    /// forme 26 chiffres « 2923 » + clé IBAN + RIB (« TN » converti en chiffres, T=29, N=23).
    /// Retourne null si la clé RIB est incohérente (chiffre mal lu) : mieux vaut « RIB non lu »
    /// qu'un faux RIB qui bloquerait l'import pour un compte différent.
    /// </summary>
    public static string? TryNormalizeRib(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var trimmed = raw.Trim();
        var digits = new string(trimmed.Where(char.IsDigit).ToArray());

        string? candidate = null;
        if (digits.Length == 20)
            candidate = digits;
        else if (digits.Length == 22 && trimmed.StartsWith("TN", StringComparison.OrdinalIgnoreCase))
            candidate = digits[2..]; // « TN59 » + RIB : la clé IBAN (2 chiffres) précède le RIB.
        else if (digits.Length == 22 && digits.StartsWith("59", StringComparison.Ordinal))
            candidate = digits[2..]; // IBAN recopié sans les lettres.
        else if (digits.Length == 26 && digits.StartsWith("2923", StringComparison.Ordinal))
            candidate = digits[6..]; // « TN » converti en chiffres (T=29, N=23) + clé IBAN + RIB.

        if (candidate is null)
            return null;

        return TunisianIban.HasValidRibKey(candidate) ? candidate : null;
    }

    /// <summary>
    /// Date imprimée ramenée en ISO (« 14/07/2026 », « 14-07-26 », « 14.07.2026 » → « 2026-07-14 »).
    /// Déjà en ISO : inchangée. Illisible : la chaîne nettoyée est conservée telle quelle (le lecteur la
    /// signalera comme illisible et pourra l'afficher).
    /// </summary>
    public static string? NormalizeDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        var t = value.Trim();
        if (DateOnly.TryParseExact(t, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var iso))
            return iso.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (DateOnly.TryParseExact(t, DayFirstFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dayFirst))
            return dayFirst.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        // « 14/07/2026 12:30 » ou « 14/07/2026 (valeur) » : on ne garde que le premier jeton date.
        var m = DateTokenRegex().Match(t);
        if (m.Success && m.Value != t)
            return NormalizeDate(m.Value) ?? t;
        return t;
    }

    private static readonly string[] DayFirstFormats =
    {
        "dd/MM/yyyy", "dd-MM-yyyy", "dd.MM.yyyy", "d/M/yyyy",
        "dd/MM/yy", "dd-MM-yy", "dd.MM.yy"
    };

    private static string? Sanitize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        var t = ControlChars().Replace(value.Trim(), " ");
        return t.Length > 300 ? t[..300] : t;
    }

    private static string SanitizeLabel(string? value) => Sanitize(value) ?? string.Empty;

    /// <summary>
    /// Solde imprimé : « 1 234,567 », « 1 234,567 D » / « DB » / « DEBITEUR » (négatif),
    /// « C » / « CR » / « CREDITEUR » (positif), « -1 234,567 », « 1 234,567- », « (1 234,567) ».
    /// </summary>
    public static (decimal? Value, bool Signed) ParseBalance(string? printed) => ParseBalance(printed, null);

    private static (decimal? Value, bool Signed) ParseBalance(string? printed, List<int>? decimals)
    {
        if (string.IsNullOrWhiteSpace(printed))
            return (null, false);

        var t = StripCurrencyMarkers(ControlChars().Replace(printed.Trim(), " ").Trim());
        var sign = 1;
        var signed = false;

        var suffix = BalanceSuffixRegex().Match(t);
        if (suffix.Success)
        {
            var word = suffix.Groups["w"].Value.ToUpperInvariant();
            sign = word.StartsWith('D') ? -1 : 1;
            signed = true;
            t = t[..suffix.Index].Trim();
        }

        if (t.StartsWith("-", StringComparison.Ordinal))
        {
            sign = -1;
            signed = true;
            t = t[1..].Trim();
        }
        else if (t.EndsWith("-", StringComparison.Ordinal))
        {
            sign = -1;
            signed = true;
            t = t[..^1].Trim();
        }
        else if (t.Length >= 2 && t[0] == '(' && t[^1] == ')')
        {
            sign = -1;
            signed = true;
            t = t[1..^1].Trim();
        }
        else if (t.StartsWith("+", StringComparison.Ordinal))
        {
            signed = true;
            t = t[1..].Trim();
        }

        t = StripCurrencyMarkers(t);

        if (!TryParseAmountLenient(t, out var value, out var printedDecimals))
            return (null, false);
        decimals?.Add(printedDecimals);
        return (Math.Round(sign * Math.Abs(value), 3, MidpointRounding.AwayFromZero), signed);
    }

    /// <summary>Montant d'une colonne débit/crédit ; un signe négatif en colonne crédit reste négatif (débit imprimé signé).</summary>
    public static decimal? ParseSideAmount(string? printed, bool isDebitColumn) =>
        ParseSideAmount(printed, isDebitColumn, null);

    private static decimal? ParseSideAmount(string? printed, bool isDebitColumn, List<int>? decimals)
    {
        if (string.IsNullOrWhiteSpace(printed))
            return null;
        var t = StripCurrencyMarkers(ControlChars().Replace(printed.Trim(), " ").Trim());
        var negative = false;
        if (t.StartsWith("-", StringComparison.Ordinal))
        {
            negative = true;
            t = t[1..].Trim();
        }
        else if (t.EndsWith("-", StringComparison.Ordinal))
        {
            negative = true;
            t = t[..^1].Trim();
        }
        else if (t.Length >= 2 && t[0] == '(' && t[^1] == ')')
        {
            negative = true;
            t = t[1..^1].Trim();
        }

        var suffix = BalanceSuffixRegex().Match(t);
        if (suffix.Success)
        {
            negative |= suffix.Groups["w"].Value.ToUpperInvariant().StartsWith('D') && !isDebitColumn;
            t = t[..suffix.Index].Trim();
        }

        t = StripCurrencyMarkers(t);

        if (!TryParseAmountLenient(t, out var value, out var printedDecimals))
            return null;
        decimals?.Add(printedDecimals);
        value = Math.Abs(value);
        if (negative && !isDebitColumn)
            return -value;
        return value;
    }

    /// <summary>
    /// <see cref="BankStatementLayoutExtractor.TryParseAmount"/> (2–3 décimales obligatoires), puis
    /// tolérance aux séparateurs OCR : espace insécable/fine, apostrophe de milliers, « 1234,5 »
    /// (1 décimale) et entiers « 1 234 » sans décimales (décimales imprimées = 0).
    /// </summary>
    internal static bool TryParseAmountLenient(string text, out decimal value, out int decimals)
    {
        value = 0m;
        decimals = 0;
        if (string.IsNullOrWhiteSpace(text))
            return false;

        var t = text.Replace('\u00A0', ' ').Replace('\u202F', ' ').Replace('\u2009', ' ').Replace('\'', ' ').Trim();
        if (BankStatementLayoutExtractor.TryParseAmount(t, out value, out decimals))
            return true;

        // Un seul séparateur suivi de 1 à 3 chiffres = décimales (« 1,234 » = 1 dinar 234 millimes,
        // convention tunisienne à 3 décimales) ; groupes de milliers séparés par des espaces ou
        // « 1.234,5 » ; entier nu = 0 décimale.
        var m = LenientDecimalRegex().Match(t);
        if (!m.Success)
            m = LenientGroupedRegex().Match(t);
        if (!m.Success)
            return false;

        var intPart = new string(m.Groups["int"].Value.Where(char.IsDigit).ToArray());
        var frac = m.Groups["frac"].Success ? m.Groups["frac"].Value : string.Empty;
        if (intPart.Length == 0 || intPart.Length > 15)
            return false;

        var normalized = frac.Length > 0 ? intPart + "." + frac : intPart;
        if (!decimal.TryParse(normalized, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value))
            return false;
        decimals = frac.Length;
        return true;
    }

    internal static int? ModalDecimals(List<int> decimals)
    {
        if (decimals.Count == 0)
            return null;
        return decimals.GroupBy(d => d)
            .OrderByDescending(g => g.Count())
            .ThenByDescending(g => g.Key)
            .First().Key;
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

    /// <summary>
    /// Retire les mentions de devise (« TND », « DT ») avant l'analyse des suffixes D/C : sinon le
    /// « D » final de « TND » serait lu comme un suffixe DÉBITEUR et laisserait un reliquat « TN ».
    /// </summary>
    private static string StripCurrencyMarkers(string value) =>
        value.Replace("TND", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("DT", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Trim();

    [GeneratedRegex(@"\s*(?<w>DEBITEUR|DÉBITEUR|CREDITEUR|CRÉDITEUR|DB|CR|D|C)\.?\s*$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex BalanceSuffixRegex();

    [GeneratedRegex(@"^(?<int>\d+|\d{1,3}(?:[ .,]\d{3})+)[.,](?<frac>\d{1,3})$", RegexOptions.CultureInvariant)]
    private static partial Regex LenientDecimalRegex();

    [GeneratedRegex(@"^(?<int>\d{1,3}(?: \d{3})+|\d+)$", RegexOptions.CultureInvariant)]
    private static partial Regex LenientGroupedRegex();

    [GeneratedRegex(@"\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}", RegexOptions.CultureInvariant)]
    private static partial Regex DateTokenRegex();
}
