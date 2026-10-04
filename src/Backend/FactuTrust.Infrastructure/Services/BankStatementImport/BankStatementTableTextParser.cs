using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using FactuTrust.Application.Features.Accounting.BankStatementImport;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Étage 2 de la lecture vision : analyse le tableau brut renvoyé par GLM-OCR en mode
/// « Table Recognition: » (HTML <c>&lt;table&gt;</c> ou Markdown <c>| … |</c>) et le convertit en
/// <see cref="LlmBankStatementPage"/> (mêmes chaînes que la sortie verbatim : dates telles
/// qu'imprimées, montants tunisiens). Fonctions pures, sans IA ; rien n'est inventé : une cellule
/// illisible reste vide et sera signalée par le lecteur.
/// </summary>
public static partial class BankStatementTableTextParser
{
    /// <param name="Page">Page typée (null si aucun tableau n'a été reconnu : l'étage a échoué).</param>
    /// <param name="IsConfirmedEmpty">
    /// Vrai quand un tableau a bien été reconnu mais ne contient ni ligne datée ni montant : la page
    /// est une page sans opération (en-tête, conditions, page blanche), pas une page mal lue.
    /// </param>
    /// <param name="RowCount">Nombre de lignes de tableau exploitées (en-tête comprise).</param>
    /// <param name="PlainText">Texte brut du tableau (cellules séparées par « | ») : recoupement des montants et entrée de l'étage 3.</param>
    public sealed record TableParseResult(LlmBankStatementPage? Page, bool IsConfirmedEmpty, int RowCount, string PlainText)
    {
        public static TableParseResult NoTable { get; } = new(null, false, 0, string.Empty);
    }

    private enum Column { None, Date, ValueDate, Label, Debit, Credit, Balance }

    public static TableParseResult Parse(string? raw, int pageNumber)
    {
        _ = pageNumber;
        if (string.IsNullOrWhiteSpace(raw))
            return TableParseResult.NoTable;

        var rows = ExtractRows(raw);
        if (rows.Count == 0)
            return TableParseResult.NoTable;

        var plainText = string.Join('\n', rows.Select(r => string.Join(" | ", r)));
        var rib = FindRib(raw, plainText);

        var headerIndex = FindHeaderRow(rows, out var columns);
        if (headerIndex < 0)
            columns = InferColumns(rows);

        var dataRows = rows.Where((_, i) => i != headerIndex).ToList();
        var lines = new List<LlmBankStatementPageLine>();
        var decimals = new List<int>();
        decimal? opening = null;
        var openingSigned = false;
        decimal? closing = null;
        var closingSigned = false;
        var sawAmount = false;
        var sawDatedLine = false;

        foreach (var row in dataRows)
        {
            var cells = row;
            var date = CellOf(cells, columns, Column.Date);
            var valueDate = CellOf(cells, columns, Column.ValueDate);
            var label = CellOf(cells, columns, Column.Label);
            var debit = CellOf(cells, columns, Column.Debit);
            var credit = CellOf(cells, columns, Column.Credit);
            var balance = CellOf(cells, columns, Column.Balance);

            // Sans colonne identifiée (ou cellules décalées) : la date est le premier jeton date de la
            // ligne, le libellé la plus longue cellule non numérique.
            if (!IsDateLike(date))
            {
                var alt = cells.FirstOrDefault(IsDateLike);
                if (alt is not null)
                {
                    date = alt;
                    if (string.IsNullOrWhiteSpace(valueDate))
                        valueDate = cells.Skip(cells.IndexOf(alt) + 1).FirstOrDefault(IsDateLike);
                }
            }

            if (string.IsNullOrWhiteSpace(label))
                label = cells.Where(c => !IsDateLike(c) && !IsAmountLike(c)).OrderByDescending(c => c.Length).FirstOrDefault();

            var rowHasAmount = IsAmountLike(debit) || IsAmountLike(credit) || IsAmountLike(balance)
                               || cells.Any(IsAmountLike);
            sawAmount |= rowHasAmount;

            var normalizedLabel = NormalizeLabel(label);
            if (IsBalanceRow(normalizedLabel))
            {
                var printed = FirstAmountLike(balance, credit, debit) ?? cells.LastOrDefault(IsAmountLike);
                var (value, signed) = BankStatementVisionPageNormalizer.ParseBalance(printed);
                if (value is not null)
                {
                    if (IsOpeningKeyword(normalizedLabel) || (!sawDatedLine && opening is null && !IsClosingKeyword(normalizedLabel)))
                    {
                        opening = value;
                        openingSigned = signed;
                    }
                    else
                    {
                        closing = value;
                        closingSigned = signed;
                    }
                }
                continue;
            }

            if (!IsDateLike(date))
            {
                // Ligne de libellé seul (suite d'un libellé sur plusieurs lignes) : rattachée à l'opération précédente.
                if (!rowHasAmount && !string.IsNullOrWhiteSpace(label) && lines.Count > 0)
                {
                    var previous = lines[^1];
                    previous.Label = string.IsNullOrEmpty(previous.Label) ? label!.Trim() : previous.Label + " / " + label!.Trim();
                    continue;
                }

                if (!rowHasAmount)
                    continue;
            }

            if (!IsAmountLike(debit) && !IsAmountLike(credit))
            {
                // Repli positionnel : les deux dernières colonnes numériques = débit / crédit.
                var numericCells = cells.Where(IsAmountLike).ToList();
                if (columns.ContainsValue(Column.Balance) && numericCells.Count > 0 && IsAmountLike(balance))
                    numericCells.Remove(balance!);
                if (numericCells.Count >= 2)
                {
                    debit = numericCells[^2];
                    credit = numericCells[^1];
                }
                else if (numericCells.Count == 1)
                {
                    // Une seule colonne numérique : le lecteur signalera la ligne si le sens ne se déduit pas.
                    var only = numericCells[0];
                    var isNegative = only.TrimStart().StartsWith('-') || only.TrimEnd().EndsWith('-');
                    debit = isNegative ? only : null;
                    credit = isNegative ? null : only;
                }
            }

            sawDatedLine |= IsDateLike(date);
            lines.Add(new LlmBankStatementPageLine
            {
                Date = BankStatementVisionPageNormalizer.NormalizeDate(date),
                ValueDate = BankStatementVisionPageNormalizer.NormalizeDate(valueDate),
                Label = (label ?? string.Empty).Trim(),
                Debit = ParseSide(debit, true, decimals),
                Credit = ParseSide(credit, false, decimals)
            });
        }

        var confirmedEmpty = !sawDatedLine && !sawAmount && lines.Count == 0;
        var page = new LlmBankStatementPage
        {
            Rib = rib,
            OpeningBalance = opening,
            OpeningBalanceSigned = openingSigned,
            ClosingBalance = closing,
            ClosingBalanceSigned = closingSigned,
            Lines = lines,
            PrintedDecimals = BankStatementVisionPageNormalizer.ModalDecimals(decimals)
        };
        return new TableParseResult(page, confirmedEmpty, rows.Count, plainText);
    }

    // ------------------------------------------------------------------ lignes/cellules

    private static List<List<string>> ExtractRows(string raw)
    {
        var rows = new List<List<string>>();
        if (raw.Contains("<tr", StringComparison.OrdinalIgnoreCase))
        {
            foreach (Match tr in HtmlRowRegex().Matches(raw))
            {
                var cells = HtmlCellRegex().Matches(tr.Groups["body"].Value)
                    .Select(m => CleanCell(StripTags(m.Groups["body"].Value)))
                    .ToList();
                if (cells.Count > 0 && cells.Any(c => c.Length > 0))
                    rows.Add(cells);
            }
            if (rows.Count > 0)
                return rows;
        }

        foreach (var line in raw.Split('\n'))
        {
            var t = line.Trim();
            if (t.Length < 2 || t.Count(c => c == '|') < 2)
                continue;
            if (MarkdownSeparatorRegex().IsMatch(t))
                continue;
            var inner = t.StartsWith('|') ? t[1..] : t;
            if (inner.EndsWith('|'))
                inner = inner[..^1];
            var cells = inner.Split('|').Select(c => CleanCell(c)).ToList();
            if (cells.Any(c => c.Length > 0))
                rows.Add(cells);
        }
        return rows;
    }

    private static string StripTags(string html) =>
        HtmlTagRegex().Replace(html.Replace("<br>", " ", StringComparison.OrdinalIgnoreCase)
            .Replace("<br/>", " ", StringComparison.OrdinalIgnoreCase)
            .Replace("<br />", " ", StringComparison.OrdinalIgnoreCase), " ");

    private static string CleanCell(string value)
    {
        var t = WebUtility.HtmlDecode(value).Replace('\u00A0', ' ').Replace('\u202F', ' ');
        t = ControlChars().Replace(t, " ");
        t = MultiSpaceRegex().Replace(t, " ").Trim();
        return t.Length > 300 ? t[..300] : t;
    }

    private static string? CellOf(List<string> cells, IReadOnlyDictionary<int, Column> columns, Column column)
    {
        foreach (var (index, kind) in columns)
        {
            if (kind == column && index < cells.Count)
                return cells[index];
        }
        return null;
    }

    private static string? FirstAmountLike(params string?[] candidates) => candidates.FirstOrDefault(IsAmountLike);

    private static decimal? ParseSide(string? printed, bool isDebitColumn, List<int> decimals)
    {
        var value = BankStatementVisionPageNormalizer.ParseSideAmount(printed, isDebitColumn);
        if (value is not null && BankStatementVisionPageNormalizer.TryParseAmountLenient(
                StripSign(printed!), out _, out var printedDecimals))
            decimals.Add(printedDecimals);
        return value;
    }

    private static string StripSign(string printed)
    {
        var t = printed.Trim().TrimStart('-', '+').TrimEnd('-').Trim();
        if (t.Length >= 2 && t[0] == '(' && t[^1] == ')')
            t = t[1..^1].Trim();
        return AmountSuffixRegex().Replace(t, string.Empty).Trim();
    }

    // ------------------------------------------------------------------ colonnes

    private static int FindHeaderRow(List<List<string>> rows, out Dictionary<int, Column> columns)
    {
        columns = new Dictionary<int, Column>();
        var limit = Math.Min(rows.Count, 6);
        for (var i = 0; i < limit; i++)
        {
            var mapped = new Dictionary<int, Column>();
            for (var c = 0; c < rows[i].Count; c++)
            {
                var kind = ClassifyHeader(NormalizeLabel(rows[i][c]));
                if (kind != Column.None && !mapped.ContainsValue(kind))
                    mapped[c] = kind;
            }

            var hasDate = mapped.ContainsValue(Column.Date);
            var hasSide = mapped.ContainsValue(Column.Debit) || mapped.ContainsValue(Column.Credit);
            if (hasDate && (hasSide || mapped.ContainsValue(Column.Label)))
            {
                columns = mapped;
                return i;
            }
        }
        return -1;
    }

    private static Column ClassifyHeader(string normalized)
    {
        if (normalized.Length == 0 || normalized.Length > 40)
            return Column.None;
        if (normalized.Contains("DATE VAL") || normalized.Contains("DATE DE VAL") || normalized == "VALEUR" || normalized == "VAL")
            return Column.ValueDate;
        if (normalized.StartsWith("DATE") || normalized == "DT OP" || normalized.StartsWith("DATE OP"))
            return Column.Date;
        if (normalized.Contains("LIBELLE") || normalized.Contains("OPERATION") || normalized.Contains("DESIGNATION")
            || normalized.Contains("NATURE") || normalized.Contains("DESCRIPTION") || normalized.Contains("INTITULE"))
            return Column.Label;
        if (normalized.Contains("DEBIT") || normalized.Contains("RETRAIT") || normalized.Contains("SORTIE"))
            return Column.Debit;
        if (normalized.Contains("CREDIT") || normalized.Contains("VERSEMENT") || normalized.Contains("ENTREE") || normalized.Contains("DEPOT"))
            return Column.Credit;
        if (normalized.Contains("SOLDE"))
            return Column.Balance;
        return Column.None;
    }

    /// <summary>
    /// Sans ligne d'en-tête : première colonne date = date, seconde = date de valeur, les deux
    /// dernières colonnes numériques = débit puis crédit, la plus longue colonne texte = libellé.
    /// </summary>
    private static Dictionary<int, Column> InferColumns(List<List<string>> rows)
    {
        var columns = new Dictionary<int, Column>();
        var sample = rows.FirstOrDefault(r => r.Any(IsDateLike) && r.Count(IsAmountLike) >= 1);
        if (sample is null)
            return columns;

        var dateCols = Enumerable.Range(0, sample.Count).Where(i => IsDateLike(sample[i])).ToList();
        var amountCols = Enumerable.Range(0, sample.Count).Where(i => IsAmountLike(sample[i]) && !dateCols.Contains(i)).ToList();
        if (dateCols.Count > 0) columns[dateCols[0]] = Column.Date;
        if (dateCols.Count > 1) columns[dateCols[1]] = Column.ValueDate;
        if (amountCols.Count >= 2)
        {
            columns[amountCols[^2]] = Column.Debit;
            columns[amountCols[^1]] = Column.Credit;
        }

        var labelCol = Enumerable.Range(0, sample.Count)
            .Where(i => !columns.ContainsKey(i))
            .OrderByDescending(i => sample[i].Length)
            .Cast<int?>()
            .FirstOrDefault();
        if (labelCol is not null)
            columns[labelCol.Value] = Column.Label;
        return columns;
    }

    // ------------------------------------------------------------------ détection

    private static bool IsDateLike(string? value) =>
        !string.IsNullOrWhiteSpace(value) && DateCellRegex().IsMatch(value.Trim());

    private static bool IsAmountLike(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return false;
        var t = StripSign(value);
        return t.Length > 0 && t.Any(char.IsDigit) && !IsDateLike(t)
               && BankStatementVisionPageNormalizer.TryParseAmountLenient(t, out _, out _);
    }

    private static bool IsBalanceRow(string normalizedLabel) =>
        normalizedLabel.StartsWith("SOLDE") || normalizedLabel.StartsWith("REPORT") || normalizedLabel.StartsWith("A NOUVEAU")
        || normalizedLabel.StartsWith("NOUVEAU SOLDE") || normalizedLabel.StartsWith("ANCIEN SOLDE")
        || normalizedLabel.StartsWith("TOTAL") || normalizedLabel.StartsWith("TOTAUX");

    private static bool IsOpeningKeyword(string normalizedLabel) =>
        normalizedLabel.StartsWith("REPORT") || normalizedLabel.StartsWith("A NOUVEAU") || normalizedLabel.StartsWith("ANCIEN SOLDE")
        || normalizedLabel.StartsWith("SOLDE PRECEDENT") || normalizedLabel.StartsWith("SOLDE INITIAL") || normalizedLabel.StartsWith("SOLDE DEBUT")
        || normalizedLabel.StartsWith("SOLDE DE DEPART") || normalizedLabel.StartsWith("SOLDE D OUVERTURE") || normalizedLabel.StartsWith("SOLDE OUVERTURE");

    private static bool IsClosingKeyword(string normalizedLabel) =>
        normalizedLabel.StartsWith("NOUVEAU SOLDE") || normalizedLabel.StartsWith("SOLDE FIN") || normalizedLabel.StartsWith("SOLDE FINAL")
        || normalizedLabel.StartsWith("SOLDE DE CLOTURE") || normalizedLabel.StartsWith("SOLDE CLOTURE") || normalizedLabel.StartsWith("SOLDE A REPORTER")
        || normalizedLabel.StartsWith("A REPORTER");

    /// <summary>Majuscules sans accents ni ponctuation, espaces normalisés.</summary>
    internal static string NormalizeLabel(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;
        var decomposed = value.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (cat == UnicodeCategory.NonSpacingMark)
                continue;
            sb.Append(char.IsLetterOrDigit(ch) ? char.ToUpperInvariant(ch) : ' ');
        }
        return MultiSpaceRegex().Replace(sb.ToString(), " ").Trim();
    }

    private static string? FindRib(string raw, string plainText)
    {
        foreach (var source in new[] { plainText, raw })
        {
            foreach (Match m in RibCandidateRegex().Matches(source))
            {
                var rib = BankStatementVisionPageNormalizer.TryNormalizeRib(m.Value);
                if (rib is not null)
                    return rib;
            }
        }
        return null;
    }

    [GeneratedRegex(@"<tr[^>]*>(?<body>.*?)</tr>", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex HtmlRowRegex();

    [GeneratedRegex(@"<t[dh][^>]*>(?<body>.*?)</t[dh]>", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex HtmlCellRegex();

    [GeneratedRegex(@"<[^>]+>", RegexOptions.CultureInvariant)]
    private static partial Regex HtmlTagRegex();

    [GeneratedRegex(@"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$", RegexOptions.CultureInvariant)]
    private static partial Regex MarkdownSeparatorRegex();

    [GeneratedRegex(@"[\u0000-\u001F\u007F]", RegexOptions.CultureInvariant)]
    private static partial Regex ControlChars();

    [GeneratedRegex(@"\s{2,}", RegexOptions.CultureInvariant)]
    private static partial Regex MultiSpaceRegex();

    [GeneratedRegex(@"^(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})(?:\s.*)?$", RegexOptions.CultureInvariant)]
    private static partial Regex DateCellRegex();

    [GeneratedRegex(@"\s*(?:DEBITEUR|DÉBITEUR|CREDITEUR|CRÉDITEUR|DB|CR|D|C|TND|DT)\.?\s*$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex AmountSuffixRegex();

    [GeneratedRegex(@"(?:TN\s?\d{2}\s?)?(?:\d[ .\-]?){20,22}", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex RibCandidateRegex();
}
