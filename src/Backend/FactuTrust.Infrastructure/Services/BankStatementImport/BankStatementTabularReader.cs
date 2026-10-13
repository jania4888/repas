using System.Globalization;
using System.IO.Compression;
using System.Text;
using ClosedXML.Excel;
using CsvHelper;
using CsvHelper.Configuration;
using DocumentFormat.OpenXml.Packaging;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Lecture déterministe d'un relevé bancaire CSV / XLSX mappé par colonnes (sans IA). On ne touche
/// pas à <c>TabularFileParsing</c> / <c>TabularRowReader</c> (import de journaux, migration), qui
/// gardent leur comportement — <c>TabularFileParsing.Normalize</c> et
/// <c>TabularFileParsing.ResolveColumns</c> sont seulement appelés en lecture, jamais modifiés.
/// Aucune exception n'est jamais exposée au client : seuls des codes stables
/// (<see cref="BankStatementTabularErrorCodes"/>) et des compteurs sont renvoyés/journalisés.
/// </summary>
internal static class BankStatementTabularReader
{
    private const int HeaderScanRows = 15;
    private const int DelimiterSampleLines = 20;
    private const int MaxDecimalsBeforeRounding = 3;
    private const decimal DecimalNormalizationUnit = 1.000000000000000000000000000m;

    private static readonly string[] DelimiterCandidates = { ";", ",", "\t" };

    private static readonly string[] SupportedDateFormats =
    {
        "dd/MM/yyyy", "dd-MM-yyyy", "dd.MM.yyyy", "yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yy"
    };

    private static readonly string[] FooterKeywords = { "TOTAL", "SOLDE", "REPORT", "NOUVEAUSOLDE" };

    private static readonly Dictionary<string, string[]> ColumnSynonyms = new()
    {
        ["date"] = new[] { "date", "dateoperation", "dateop", "datecomptable", "datetransaction", "dateecriture" },
        ["datevaleur"] = new[] { "datevaleur", "valeur", "datedevaleur" },
        ["libelle"] = new[] { "libelle", "label", "description", "operation", "intitule", "designation", "libelleoperation", "libellecomplet" },
        ["reference"] = new[] { "reference", "ref", "refoperation", "numero", "piece", "numpiece", "numerocheque", "numcheque", "numerooperation" },
        ["debit"] = new[] { "debit", "retrait", "sortie", "decaissement" },
        ["credit"] = new[] { "credit", "versement", "depot", "entree", "encaissement" },
        ["montant"] = new[] { "montant", "amount", "valeurmontant" },
        ["solde"] = new[] { "solde", "soldeprogressif", "soldecourant", "balance", "soldecompte" },
    };

    // ── Résultat intermédiaire : table brute (toutes les lignes, 0-based) ─────────────────────

    public sealed record RawTable
    {
        public required string Format { get; init; }
        public required string Encoding { get; init; }
        public string? Delimiter { get; init; }
        public IReadOnlyList<string> SheetNames { get; init; } = Array.Empty<string>();
        public int SheetIndex { get; init; }
        public required int HeaderRowIndex { get; init; }
        public required IReadOnlyList<string[]> Rows { get; init; }
        public int ColumnCount { get; init; }
        public bool Truncated { get; init; }
        public bool HasFormulaCells { get; init; }

        /// <summary>
        /// XLSX seulement (<c>null</c> pour un CSV, toujours du texte) : pour chaque ligne de <see
        /// cref="Rows"/>, quelles cellules étaient de VRAIES cellules numériques (par opposition à du
        /// texte). <see cref="FormatCellValue"/> les formate toujours en invariant (point décimal,
        /// jamais de séparateur de milliers), donc le parseur de montant les lit ainsi quel que soit le
        /// <c>decimalSeparator</c> choisi par le mappage (§3.4) — sinon par ex. "125.75" serait relu
        /// comme 12575 avec un mappage « virgule décimale ».
        /// </summary>
        public IReadOnlyList<bool[]>? NumericCells { get; init; }
    }

    public sealed record ParsedLine(
        int RowIndex,
        int RowNumber,
        DateOnly? TransactionDate,
        DateOnly? ValueDate,
        string Label,
        string? Reference,
        decimal? Amount,
        bool? IsDebit,
        decimal? Balance,
        string? Error,
        bool IsFooter)
    {
        /// <summary>Pied « TOTAL » lisible (<see cref="LooksLikeFooter"/>) : total débits de la colonne mappée, le cas échéant.</summary>
        public decimal? FooterTotalDebit { get; init; }

        /// <summary>Pied « TOTAL » lisible : total crédits de la colonne mappée, le cas échéant.</summary>
        public decimal? FooterTotalCredit { get; init; }

        /// <summary>Le montant comportait plus de 3 décimales et a été arrondi (<see cref="MaxDecimalsBeforeRounding"/>).</summary>
        public bool AmountRounded { get; init; }
    }

    private static Error Unreadable() => new(BankStatementTabularErrorCodes.TabularUnreadable, "Fichier illisible.");
    private static Error Rejected() => new(BankStatementTabularErrorCodes.TabularRejected, "Fichier refusé pour des raisons de sécurité.");
    private static Error NoLines() => new(BankStatementTabularErrorCodes.TabularNoLines, "Aucune ligne d'opération trouvée.");
    private static Error TooManyRows(int max) => new(BankStatementTabularErrorCodes.TabularTooManyRows, $"Fichier trop volumineux (maximum {max} lignes).");

    /// <summary>Plafond de lignes brutes chargées (au-delà, <see cref="RawTable.Truncated"/>) : marge de <see cref="HeaderScanRows"/> + 64 au-delà du maximum opérationnel, pour détecter la troncature même si l'en-tête/les lignes ignorées grignotent la marge.</summary>
    private static int RowCap(BankStatementImportLimits limits) => limits.MaxTabularRows + HeaderScanRows + 64;

    // ── Chargement ──────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <paramref name="encodingOverride"/>/<paramref name="delimiterOverride"/>/<paramref name="sheetIndexOverride"/>
    /// viennent du mappage client (préview ou démarrage) : honorés quand fournis plutôt que l'auto-détection,
    /// avec repli silencieux sur l'auto-détection si la valeur forcée est invalide/inconnue.
    /// </summary>
    public static Result<RawTable> LoadRawTable(
        byte[] content, string extension, BankStatementImportLimits limits,
        string? encodingOverride = null, string? delimiterOverride = null, int? sheetIndexOverride = null) =>
        extension switch
        {
            ".csv" => LoadCsv(content, limits, encodingOverride, delimiterOverride),
            ".xlsx" => LoadXlsx(content, limits, sheetIndexOverride),
            _ => Result.Failure<RawTable>(Unreadable())
        };

    private static Result<RawTable> LoadCsv(byte[] content, BankStatementImportLimits limits, string? encodingOverride = null, string? delimiterOverride = null)
    {
        string text;
        string encodingName;
        try
        {
            (text, encodingName) = DecodeText(content, encodingOverride);
        }
        catch (DecoderFallbackException)
        {
            return Result.Failure<RawTable>(Unreadable());
        }

        var delimiter = !string.IsNullOrEmpty(delimiterOverride) ? delimiterOverride : DetectDelimiter(text);
        var rows = new List<string[]>();
        var cap = RowCap(limits);
        var truncated = false;

        try
        {
            using var reader = new StringReader(text);
            var config = new CsvConfiguration(CultureInfo.InvariantCulture)
            {
                Delimiter = delimiter,
                HasHeaderRecord = false,
                MissingFieldFound = null,
                BadDataFound = null,
                TrimOptions = TrimOptions.Trim,
                DetectDelimiter = false,
                IgnoreBlankLines = true
            };

            using var csv = new CsvReader(reader, config);
            while (csv.Read())
            {
                if (rows.Count >= cap)
                {
                    truncated = true;
                    break;
                }

                var record = csv.Parser.Record ?? Array.Empty<string>();
                var row = record.Take(limits.MaxTabularColumns)
                    .Select(c => BankStatementImportGuards.Truncate(c ?? string.Empty, limits.MaxTabularCellLength))
                    .ToArray();
                rows.Add(row);
            }
        }
        catch (CsvHelperException)
        {
            return Result.Failure<RawTable>(Unreadable());
        }
        catch (FormatException)
        {
            return Result.Failure<RawTable>(Unreadable());
        }

        if (rows.Count == 0)
            return Result.Failure<RawTable>(NoLines());

        var headerRowIndex = DetectHeaderRow(rows);
        return Result.Success(new RawTable
        {
            Format = BankStatementImportExtractionMethods.Csv,
            Encoding = encodingName,
            Delimiter = delimiter,
            HeaderRowIndex = headerRowIndex,
            Rows = rows,
            ColumnCount = rows.Max(r => r.Length),
            Truncated = truncated
        });
    }

    private static Result<RawTable> LoadXlsx(byte[] content, BankStatementImportLimits limits, int? sheetIndexOverride = null)
    {
        var zipCheck = CheckXlsxZipSafety(content, limits);
        if (zipCheck is not null)
            return Result.Failure<RawTable>(zipCheck);

        List<string> sheetNames;
        List<string[]> rows;
        List<bool[]> numericCells;
        int sheetIndex;
        var truncated = false;
        var hasFormulaCells = false;

        try
        {
            using var stream = new MemoryStream(content, writable: false);
            using var workbook = new XLWorkbook(stream);
            sheetNames = workbook.Worksheets.Select(w => w.Name).ToList();

            var sheet = sheetIndexOverride is { } idx && idx >= 0
                ? workbook.Worksheets.ElementAtOrDefault(idx)
                : null;
            sheet ??= workbook.Worksheets.FirstOrDefault(w => w.Visibility == XLWorksheetVisibility.Visible && w.RangeUsed() is not null)
                      ?? workbook.Worksheets.FirstOrDefault();
            if (sheet is null)
                return Result.Failure<RawTable>(NoLines());

            sheetIndex = sheet.Position - 1;
            var lastRow = sheet.LastRowUsed();
            var lastColumn = sheet.LastColumnUsed();
            if (lastRow is null || lastColumn is null)
                return Result.Failure<RawTable>(NoLines());

            var maxRow = lastRow.RowNumber();
            var maxCol = Math.Min(lastColumn.ColumnNumber(), limits.MaxTabularColumns);
            var cap = RowCap(limits);

            rows = new List<string[]>();
            numericCells = new List<bool[]>();
            for (var r = 1; r <= maxRow; r++)
            {
                if (rows.Count >= cap)
                {
                    truncated = true;
                    break;
                }

                var row = new string[maxCol];
                var numericRow = new bool[maxCol];
                for (var c = 1; c <= maxCol; c++)
                {
                    var cell = sheet.Cell(r, c);
                    if (cell.HasFormula)
                        hasFormulaCells = true;
                    numericRow[c - 1] = cell.CachedValue.IsNumber;
                    row[c - 1] = BankStatementImportGuards.Truncate(FormatCellValue(cell.CachedValue), limits.MaxTabularCellLength);
                }

                rows.Add(row);
                numericCells.Add(numericRow);
            }

            if (rows.Count == 0)
                return Result.Failure<RawTable>(NoLines());

            var headerRowIndex = DetectHeaderRow(rows);
            return Result.Success(new RawTable
            {
                Format = BankStatementImportExtractionMethods.Xlsx,
                Encoding = "utf-8",
                SheetNames = sheetNames,
                SheetIndex = sheetIndex,
                HeaderRowIndex = headerRowIndex,
                Rows = rows,
                ColumnCount = maxCol,
                Truncated = truncated,
                HasFormulaCells = hasFormulaCells,
                NumericCells = numericCells
            });
        }
        // ClosedXML / DocumentFormat.OpenXml peuvent lever des types variés sur un fichier corrompu,
        // chiffré ou malveillant (KeyNotFoundException, XmlException, NullReferenceException…) : tout
        // sauf l'annulation retombe sur un code stable, jamais le message de l'exception.
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Result.Failure<RawTable>(Unreadable());
        }
    }

    /// <summary>
    /// Pré-contrôle avant ClosedXML : nombre d'entrées, taille décompressée totale (comptée en
    /// streamant réellement chaque entrée — <c>entry.Length</c> seul n'est qu'une métadonnée du zip et
    /// peut être falsifié), ratio de compression déclaré par entrée (bombe zip) ; refus si une macro
    /// est présente (nom de fichier <c>xl/vbaProject.bin</c> OU type de contenu <c>vbaProject</c>
    /// déclaré dans <c>[Content_Types].xml</c>). Renvoie <c>null</c> si le fichier passe le contrôle.
    /// </summary>
    private static Error? CheckXlsxZipSafety(byte[] content, BankStatementImportLimits limits)
    {
        try
        {
            using var zipStream = new MemoryStream(content, writable: false);
            using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read, leaveOpen: true);

            if (archive.Entries.Count > limits.XlsxMaxZipEntries)
                return Rejected();

            long totalUncompressed = 0;
            var buffer = new byte[81920];
            foreach (var entry in archive.Entries)
            {
                if (string.Equals(entry.FullName, "xl/vbaProject.bin", StringComparison.OrdinalIgnoreCase))
                    return Rejected();

                if (entry.CompressedLength > 0 && entry.Length > 0)
                {
                    var ratio = (double)entry.Length / entry.CompressedLength;
                    if (ratio > limits.XlsxMaxCompressionRatio)
                        return Rejected();
                }
                else if (entry.CompressedLength == 0 && entry.Length > 0)
                {
                    // Taille compressée nulle pour un contenu non vide : forme suspecte, refusée par prudence.
                    return Rejected();
                }

                // Octets réellement décompressés, pas la métadonnée `entry.Length` (falsifiable) : seule
                // façon fiable de borner une bombe zip.
                using var entryStream = entry.Open();
                int read;
                while ((read = entryStream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    totalUncompressed += read;
                    if (totalUncompressed > limits.XlsxMaxUncompressedBytes)
                        return Rejected();
                }
            }

            var contentTypes = archive.GetEntry("[Content_Types].xml");
            if (contentTypes is not null)
            {
                using var entryStream = contentTypes.Open();
                using var sr = new StreamReader(entryStream, System.Text.Encoding.UTF8);
                var xml = sr.ReadToEnd();
                if (xml.Contains("macroEnabled", StringComparison.OrdinalIgnoreCase)
                    || xml.Contains("vbaProject", StringComparison.OrdinalIgnoreCase))
                    return Rejected();
            }

            return null;
        }
        catch (InvalidDataException)
        {
            return Unreadable();
        }
        // Entrée zip tronquée/corrompue (IOException) ou méthode de compression non supportée par
        // ZipArchive (NotSupportedException) : un fichier illisible, pas un refus de sécurité.
        catch (IOException)
        {
            return Unreadable();
        }
        catch (NotSupportedException)
        {
            return Unreadable();
        }
    }

    private static string FormatCellValue(XLCellValue value)
    {
        if (value.IsBlank) return string.Empty;
        if (value.IsDateTime) return value.GetDateTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (value.IsNumber) return value.GetNumber().ToString("0.###############", CultureInfo.InvariantCulture);
        if (value.IsBoolean) return value.GetBoolean() ? "1" : "0";
        if (value.IsText) return value.GetText();
        return value.ToString(CultureInfo.InvariantCulture);
    }

    // ── Encodage / délimiteur / en-tête ────────────────────────────────────────────────────────

    /// <summary>
    /// Décode le CSV en texte. <paramref name="encodingOverride"/> (venant du mappage client, ex.
    /// <c>windows-1256</c>, <c>utf-16</c>) force l'encodage au lieu de l'auto-détection ; un nom
    /// inconnu retombe sur l'auto-détection. BOM UTF-16 (LE/BE) détecté explicitement avant UTF-8.
    /// </summary>
    private static (string Text, string EncodingName) DecodeText(byte[] content, string? encodingOverride = null)
    {
        if (!string.IsNullOrWhiteSpace(encodingOverride))
        {
            // Idempotent (voir l'appel équivalent plus bas, non protégé) : ne lève jamais pour un
            // ré-enregistrement du même provider.
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

            try
            {
                var forced = Encoding.GetEncoding(encodingOverride.Trim());
                return (forced.GetString(StripKnownBom(content, forced)), encodingOverride.Trim().ToLowerInvariant());
            }
            catch (ArgumentException)
            {
                // Nom d'encodage inconnu : on retombe sur l'auto-détection ci-dessous.
            }
        }

        var span = content.AsSpan();
        if (span.Length >= 2 && span[0] == 0xFF && span[1] == 0xFE)
            return (Encoding.Unicode.GetString(content, 2, content.Length - 2), "utf-16");
        if (span.Length >= 2 && span[0] == 0xFE && span[1] == 0xFF)
            return (Encoding.BigEndianUnicode.GetString(content, 2, content.Length - 2), "utf-16be");

        var offset = span.Length >= 3 && span[0] == 0xEF && span[1] == 0xBB && span[2] == 0xBF ? 3 : 0;
        var bytes = content.AsSpan(offset).ToArray();

        try
        {
            var strict = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
            return (strict.GetString(bytes), "utf-8");
        }
        catch (DecoderFallbackException)
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            var legacy = Encoding.GetEncoding(1252);
            return (legacy.GetString(bytes), "windows-1252");
        }
    }

    private static byte[] StripKnownBom(byte[] content, Encoding encoding)
    {
        var preamble = encoding.GetPreamble();
        if (preamble.Length > 0 && content.Length >= preamble.Length && content.AsSpan(0, preamble.Length).SequenceEqual(preamble))
            return content[preamble.Length..];
        return content;
    }

    private static string DetectDelimiter(string text)
    {
        var lines = text.Split('\n')
            .Select(l => l.TrimEnd('\r'))
            .Where(l => l.Length > 0)
            .Take(DelimiterSampleLines)
            .ToList();

        if (lines.Count == 0)
            return ";";

        var best = ";";
        var bestScore = -1;
        foreach (var delimiter in DelimiterCandidates)
        {
            var ch = delimiter[0];
            var counts = lines.Select(l => l.Count(c => c == ch)).ToList();
            if (counts.All(c => c == 0))
                continue;

            var mode = counts.GroupBy(c => c).OrderByDescending(g => g.Count()).ThenByDescending(g => g.Key).First();
            var score = mode.Count() * 1000 + mode.Key;
            if (score > bestScore)
            {
                bestScore = score;
                best = delimiter;
            }
        }

        return best;
    }

    private static int DetectHeaderRow(IReadOnlyList<string[]> rows)
    {
        var limit = Math.Min(HeaderScanRows, rows.Count);
        var bestIndex = 0;
        var bestScore = -1;
        for (var i = 0; i < limit; i++)
        {
            var map = TabularFileParsing.ResolveColumns(rows[i], ColumnSynonyms);
            var score = map.Values.Count(v => v >= 0);
            if (score > bestScore)
            {
                bestScore = score;
                bestIndex = i;
            }
        }

        return bestScore >= 2 ? bestIndex : 0;
    }

    // ── Mappage suggéré ─────────────────────────────────────────────────────────────────────

    public static BankStatementTabularMappingDto SuggestMapping(RawTable table)
    {
        var header = table.HeaderRowIndex < table.Rows.Count ? table.Rows[table.HeaderRowIndex] : Array.Empty<string>();
        var map = TabularFileParsing.ResolveColumns(header, ColumnSynonyms);

        var labelColumns = map["libelle"] >= 0
            ? new List<int> { map["libelle"] }
            : new List<int>();

        var hasDebitCredit = map["debit"] >= 0 || map["credit"] >= 0;
        var dateFormat = DetectDateFormat(table, map["date"]);
        var amountColumns = new[] { map["montant"], map["debit"], map["credit"], map["solde"] }.Where(c => c >= 0).ToList();

        return new BankStatementTabularMappingDto
        {
            HeaderRowIndex = table.HeaderRowIndex,
            SheetIndex = table.Format == BankStatementImportExtractionMethods.Xlsx ? table.SheetIndex : null,
            DateFormat = dateFormat,
            DecimalSeparator = SuggestDecimalSeparator(table, amountColumns),
            AmountMode = hasDebitCredit ? "debitCredit" : "signed",
            SignConvention = hasDebitCredit ? null : "negativeIsDebit",
            DateColumn = Math.Max(map["date"], 0),
            ValueDateColumn = map["datevaleur"] >= 0 ? map["datevaleur"] : null,
            LabelColumns = labelColumns.Count > 0 ? labelColumns : new List<int> { 0 },
            ReferenceColumn = map["reference"] >= 0 ? map["reference"] : null,
            DebitColumn = hasDebitCredit && map["debit"] >= 0 ? map["debit"] : null,
            CreditColumn = hasDebitCredit && map["credit"] >= 0 ? map["credit"] : null,
            AmountColumn = !hasDebitCredit && map["montant"] >= 0 ? map["montant"] : null,
            BalanceColumn = map["solde"] >= 0 ? map["solde"] : null,
            Encoding = table.Encoding,
            Delimiter = table.Delimiter
        };
    }

    /// <summary>
    /// Convention tunisienne (virgule décimale) par défaut (§3.4). XLSX seulement : si les colonnes de
    /// montant échantillonnées sont majoritairement de VRAIES cellules numériques (toujours formatées en
    /// invariant par <see cref="FormatCellValue"/>, point décimal), le mappage suggéré penche plutôt vers
    /// <c>"."</c> — simple préférence d'affichage par défaut, sans effet sur la lecture elle-même
    /// (<see cref="TryParseAmountCore"/> ignore <c>decimalSeparator</c> pour une vraie cellule numérique).
    /// </summary>
    private static string SuggestDecimalSeparator(RawTable table, IReadOnlyList<int> amountColumns)
    {
        if (table.Format != BankStatementImportExtractionMethods.Xlsx || table.NumericCells is not { } numericCells || amountColumns.Count == 0)
            return ",";

        var sampleRows = numericCells.Skip(table.HeaderRowIndex + 1).Take(HeaderScanRows).ToList();
        if (sampleRows.Count == 0)
            return ",";

        var total = 0;
        var numeric = 0;
        foreach (var numericRow in sampleRows)
        {
            foreach (var column in amountColumns)
            {
                if (column < 0 || column >= numericRow.Length)
                    continue;
                total++;
                if (numericRow[column])
                    numeric++;
            }
        }

        return total > 0 && numeric * 2 > total ? "." : ",";
    }

    /// <summary>
    /// Format de date suggéré : le premier de <see cref="SupportedDateFormats"/> (dans cet ordre,
    /// <c>dd/MM/yyyy</c> d'abord) qui lit 100 % de l'échantillon de la colonne date — couvre les
    /// fichiers XLSX (dates réelles toujours formatées en <c>yyyy-MM-dd</c> par <see cref="FormatCellValue"/>)
    /// et les CSV <c>yyyy-MM-dd</c> / <c>dd.MM.yyyy</c>. Aucun format ne lit tout l'échantillon
    /// (ambigu ou données hétérogènes) : repli sur <c>dd/MM/yyyy</c>.
    /// </summary>
    private static string DetectDateFormat(RawTable table, int dateColumn)
    {
        const string defaultFormat = "dd/MM/yyyy";
        var sample = SampleDateColumn(table, dateColumn);
        if (sample.Count == 0)
            return defaultFormat;

        foreach (var format in SupportedDateFormats)
        {
            if (sample.All(v => DateOnly.TryParseExact(v, format, CultureInfo.InvariantCulture, DateTimeStyles.None, out _)))
                return format;
        }

        return defaultFormat;
    }

    public static bool DetectAmbiguousDateFormat(RawTable table, int dateColumn)
    {
        var sample = SampleDateColumn(table, dateColumn);
        if (sample.Count == 0)
            return false;

        var ddMmReadsAll = sample.All(v => DateOnly.TryParseExact(v, "dd/MM/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out _));
        var mmDdReadsAll = sample.All(v => DateOnly.TryParseExact(v, "MM/dd/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out _));
        // Ambigu seulement si les deux lectures diffèrent sur au moins un échantillon (jour > 12 tranche sinon).
        if (!ddMmReadsAll || !mmDdReadsAll)
            return false;

        return sample.Any(v =>
            DateOnly.TryParseExact(v, "dd/MM/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var a) &&
            DateOnly.TryParseExact(v, "MM/dd/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var b) &&
            a != b);
    }

    /// <summary>Échantillon non vide (au plus <see cref="HeaderScanRows"/> lignes après l'en-tête) de la colonne date, pour la détection de format (<see cref="DetectDateFormat"/>/<see cref="DetectAmbiguousDateFormat"/>).</summary>
    private static List<string> SampleDateColumn(RawTable table, int dateColumn)
    {
        if (dateColumn < 0)
            return new List<string>();

        return table.Rows.Skip(table.HeaderRowIndex + 1).Take(HeaderScanRows)
            .Select(r => dateColumn < r.Length ? r[dateColumn] : string.Empty)
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .ToList();
    }

    // ── Interprétation des lignes avec un mappage ──────────────────────────────────────────────

    /// <summary>
    /// Essaie <paramref name="dateFormat"/> (celui du mappage) puis, pour un fichier XLSX seulement,
    /// le format ISO <c>yyyy-MM-dd</c> que <see cref="FormatCellValue"/> produit toujours pour une
    /// vraie cellule date — accepté quel que soit le <c>dateFormat</c> choisi par l'utilisateur (§1).
    /// </summary>
    private static bool TryParseMappedDate(string dateText, string dateFormat, string tableFormat, out DateOnly result)
    {
        if (DateOnly.TryParseExact(dateText, dateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out result))
            return true;
        if (tableFormat == BankStatementImportExtractionMethods.Xlsx && dateFormat != "yyyy-MM-dd"
            && DateOnly.TryParseExact(dateText, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out result))
            return true;
        return false;
    }

    public static IReadOnlyList<ParsedLine> ParseLines(RawTable table, BankStatementTabularMappingDto mapping)
    {
        // Numéros de ligne DU FICHIER, 1-based (§13) : la 1ère ligne du fichier (en-tête) est la ligne
        // 1, identique à rows[]/parsedLines[].RowNumber — jamais un index 0-based interne.
        var ignoredRows = mapping.IgnoredRows is { Count: > 0 } ? new HashSet<int>(mapping.IgnoredRows) : null;
        var decimalSeparator = string.IsNullOrEmpty(mapping.DecimalSeparator) ? "," : mapping.DecimalSeparator;
        var dateFormat = SupportedDateFormats.Contains(mapping.DateFormat) ? mapping.DateFormat : "dd/MM/yyyy";
        var result = new List<ParsedLine>();

        for (var rowIndex = mapping.HeaderRowIndex + 1; rowIndex < table.Rows.Count; rowIndex++)
        {
            var rowNumber = rowIndex + 1; // 1-based, affiché à l'utilisateur et référencé par IgnoredRows
            if (ignoredRows is not null && ignoredRows.Contains(rowNumber))
                continue;

            var row = table.Rows[rowIndex];
            if (row.All(string.IsNullOrWhiteSpace))
                continue;

            // XLSX seulement : quelles cellules de cette ligne étaient de vraies cellules numériques
            // (§TryParseAmountCore) — toujours lues en invariant, quel que soit decimalSeparator.
            var numericRow = table.NumericCells is { } nc && rowIndex < nc.Count ? nc[rowIndex] : null;
            bool IsNumericCell(int column) => numericRow is not null && column >= 0 && column < numericRow.Length && numericRow[column];

            var label = string.Join(" ", mapping.LabelColumns
                .Select(c => Cell(row, c))
                .Where(v => !string.IsNullOrWhiteSpace(v))).Trim();

            var dateText = Cell(row, mapping.DateColumn);
            var hasDate = TryParseMappedDate(dateText, dateFormat, table.Format, out var transactionDate);

            if (!hasDate && LooksLikeFooter(label, dateText))
            {
                var (footerDebit, footerCredit) = label.Contains("TOTAL", StringComparison.OrdinalIgnoreCase)
                    ? ReadFooterTotals(row, numericRow, mapping, decimalSeparator)
                    : (null, null);
                result.Add(new ParsedLine(rowIndex, rowNumber, null, null, label, null, null, null, null, null, IsFooter: true)
                {
                    FooterTotalDebit = footerDebit,
                    FooterTotalCredit = footerCredit
                });
                continue;
            }

            DateOnly? valueDate = null;
            if (mapping.ValueDateColumn is { } valueDateColumn)
            {
                var valueDateText = Cell(row, valueDateColumn);
                if (TryParseMappedDate(valueDateText, dateFormat, table.Format, out var parsedValueDate))
                    valueDate = parsedValueDate;
            }

            var reference = mapping.ReferenceColumn is { } referenceColumn ? Cell(row, referenceColumn) : null;
            if (string.IsNullOrWhiteSpace(reference))
                reference = null;

            decimal? balance = null;
            if (mapping.BalanceColumn is { } balanceColumn)
            {
                var balanceText = Cell(row, balanceColumn);
                if (TryParseAmount(balanceText, decimalSeparator, out var parsedBalance, IsNumericCell(balanceColumn)))
                    balance = parsedBalance;
            }

            string? error = null;
            decimal? amount = null;
            bool? isDebit = null;
            var amountRounded = false;

            if (string.Equals(mapping.AmountMode, "signed", StringComparison.OrdinalIgnoreCase))
            {
                var amountColumn = mapping.AmountColumn ?? -1;
                var amountText = Cell(row, amountColumn);
                if (TryParseOperationAmount(amountText, decimalSeparator, out var signed, out var rounded, IsNumericCell(amountColumn)))
                {
                    isDebit = SignedIsDebit(signed, mapping.SignConvention);
                    amount = Math.Abs(signed);
                    amountRounded = rounded;
                }
            }
            else
            {
                var debitColumn = mapping.DebitColumn ?? -1;
                var creditColumn = mapping.CreditColumn ?? -1;
                var debitText = Cell(row, debitColumn);
                var creditText = Cell(row, creditColumn);
                var hasDebit = TryParseOperationAmount(debitText, decimalSeparator, out var debitValue, out var debitRounded, IsNumericCell(debitColumn)) && debitValue != 0;
                var hasCredit = TryParseOperationAmount(creditText, decimalSeparator, out var creditValue, out var creditRounded, IsNumericCell(creditColumn)) && creditValue != 0;

                if (hasDebit && hasCredit)
                {
                    error = StatementIssueCodes.TabularBothSides;
                    amount = 0m;
                }
                else if (hasDebit)
                {
                    amount = Math.Abs(debitValue);
                    isDebit = true;
                    amountRounded = debitRounded;
                }
                else if (hasCredit)
                {
                    amount = Math.Abs(creditValue);
                    isDebit = false;
                    amountRounded = creditRounded;
                }
            }

            if (!hasDate)
            {
                error ??= StatementIssueCodes.TabularDateInvalid;
                transactionDate = valueDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
            }

            if (amount is null || amount == 0m || isDebit is null)
            {
                error ??= StatementIssueCodes.TabularAmountInvalid;
                amount ??= 0m;
            }

            result.Add(new ParsedLine(rowIndex, rowNumber, transactionDate, valueDate, label, reference, amount, isDebit, balance, error, IsFooter: false)
            {
                AmountRounded = amountRounded
            });
        }

        return result;
    }

    private static string Cell(string[] row, int column) => column >= 0 && column < row.Length ? row[column] : string.Empty;

    /// <summary>Mode « montant signé » : sens de l'opération selon <see cref="BankStatementTabularMappingDto.SignConvention"/> (par défaut, négatif = débit).</summary>
    private static bool SignedIsDebit(decimal signed, string? signConvention)
    {
        var negativeIsDebit = !string.Equals(signConvention, "negativeIsCredit", StringComparison.OrdinalIgnoreCase);
        return negativeIsDebit ? signed < 0 : signed >= 0;
    }

    private static bool LooksLikeFooter(string label, string dateText)
    {
        if (!string.IsNullOrWhiteSpace(dateText))
            return false;

        var normalized = TabularFileParsing.Normalize(label).ToUpperInvariant();
        return FooterKeywords.Any(k => normalized.Contains(k));
    }

    /// <summary>
    /// Pied « TOTAL » lisible (ex. « TOTAL DES MOUVEMENTS ») : lit les mêmes colonnes que les lignes
    /// d'opération pour alimenter <c>Header.TotalDebits/TotalCredits</c> (<c>TotalsLabelled = true</c>) ;
    /// le contrôle de totaux existant (<see cref="BankStatementBalanceCheck"/>) s'applique ensuite tel quel.
    /// </summary>
    private static (decimal? Debit, decimal? Credit) ReadFooterTotals(string[] row, bool[]? numericRow, BankStatementTabularMappingDto mapping, string decimalSeparator)
    {
        bool IsNumericCell(int column) => numericRow is not null && column >= 0 && column < numericRow.Length && numericRow[column];

        if (string.Equals(mapping.AmountMode, "signed", StringComparison.OrdinalIgnoreCase))
        {
            var amountColumn = mapping.AmountColumn ?? -1;
            var amountText = Cell(row, amountColumn);
            if (!TryParseAmount(amountText, decimalSeparator, out var signed, IsNumericCell(amountColumn)) || signed == 0m)
                return (null, null);

            var isDebit = SignedIsDebit(signed, mapping.SignConvention);
            return isDebit ? (Math.Abs(signed), null) : (null, Math.Abs(signed));
        }

        decimal? debit = null;
        decimal? credit = null;
        var debitColumn = mapping.DebitColumn ?? -1;
        var creditColumn = mapping.CreditColumn ?? -1;
        if (TryParseAmount(Cell(row, debitColumn), decimalSeparator, out var debitValue, IsNumericCell(debitColumn)) && debitValue != 0m)
            debit = Math.Abs(debitValue);
        if (TryParseAmount(Cell(row, creditColumn), decimalSeparator, out var creditValue, IsNumericCell(creditColumn)) && creditValue != 0m)
            credit = Math.Abs(creditValue);
        return (debit, credit);
    }

    // ── Validation du mappage ──────────────────────────────────────────────────────────────

    public static Error? ValidateMapping(BankStatementTabularMappingDto mapping, int columnCount)
    {
        Error Invalid() => new(BankStatementTabularErrorCodes.TabularMappingInvalid, "Mappage de colonnes invalide.");
        bool InRange(int? column) => column is null || (column >= 0 && column < columnCount);

        if (!SupportedDateFormats.Contains(mapping.DateFormat)) return Invalid();
        if (mapping.DecimalSeparator is not ("," or ".")) return Invalid();
        if (mapping.AmountMode is not ("debitCredit" or "signed")) return Invalid();
        if (mapping.SignConvention is not (null or "negativeIsDebit" or "negativeIsCredit")) return Invalid();
        if (mapping.HeaderRowIndex < 0) return Invalid();
        if (mapping.DateColumn < 0 || mapping.DateColumn >= columnCount) return Invalid();
        if (mapping.LabelColumns is null || mapping.LabelColumns.Count is < 1 or > 3) return Invalid();
        if (mapping.LabelColumns.Any(c => !InRange(c))) return Invalid();
        if (!InRange(mapping.ValueDateColumn) || !InRange(mapping.ReferenceColumn) || !InRange(mapping.DebitColumn) ||
            !InRange(mapping.CreditColumn) || !InRange(mapping.AmountColumn) || !InRange(mapping.BalanceColumn))
            return Invalid();

        if (string.Equals(mapping.AmountMode, "signed", StringComparison.OrdinalIgnoreCase))
        {
            if (mapping.AmountColumn is null) return Invalid();
        }
        else if (mapping.DebitColumn is null && mapping.CreditColumn is null)
        {
            return Invalid();
        }

        return null;
    }

    // ── Construction de l'extraction (session CSV/XLSX) ────────────────────────────────────

    public static Result<ExtractedBankStatement> BuildExtraction(
        RawTable table, BankStatementTabularMappingDto mapping, BankStatementImportLimits limits, string? rib)
    {
        if (table.Truncated)
            return Result.Failure<ExtractedBankStatement>(TooManyRows(limits.MaxTabularRows));

        var parsed = ParseLines(table, mapping);
        var operationLines = parsed.Where(p => !p.IsFooter).ToList();

        if (operationLines.Count > limits.MaxTabularRows)
            return Result.Failure<ExtractedBankStatement>(TooManyRows(limits.MaxTabularRows));
        if (operationLines.Count == 0)
            return Result.Failure<ExtractedBankStatement>(NoLines());

        // Fichier antichronologique (plus récent en premier) : aucune paire consécutive n'avance dans le
        // temps et au moins une recule (lignes de même jour autorisées, ni avance ni recul).
        var reversed = false;
        var increasing = 0;
        var decreasing = 0;
        for (var i = 1; i < operationLines.Count; i++)
        {
            if (operationLines[i].TransactionDate > operationLines[i - 1].TransactionDate)
                increasing++;
            else if (operationLines[i].TransactionDate < operationLines[i - 1].TransactionDate)
                decreasing++;
        }
        if (operationLines.Count >= 2 && increasing == 0 && decreasing >= 1)
        {
            operationLines = Enumerable.Reverse(operationLines).ToList();
            reversed = true;
        }

        var issues = new List<StatementExtractionIssue>();
        var lines = new List<ExtractedStatementLine>(operationLines.Count);
        for (var i = 0; i < operationLines.Count; i++)
        {
            var p = operationLines[i];
            var label = string.IsNullOrEmpty(p.Label) ? string.Empty : p.Label;
            lines.Add(new ExtractedStatementLine
            {
                Index = i,
                PageNumber = 1,
                TransactionDate = p.TransactionDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
                ValueDate = p.ValueDate,
                Label = label,
                LabelLines = string.IsNullOrEmpty(label) ? Array.Empty<string>() : new[] { label },
                Amount = p.Amount ?? 0m,
                IsDebit = p.IsDebit ?? false,
                Source = StatementLineSource.Tabular,
                SourceRow = p.RowNumber,
                Reference = p.Reference
            });

            if (p.Error is not null)
                issues.Add(new StatementExtractionIssue(p.Error, StatementIssueSeverity.Blocking, FriendlyMessage(p.Error, p.RowNumber), LineIndex: i));

            if (p.AmountRounded)
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.TabularAmountRounded, StatementIssueSeverity.Info,
                    $"Montant arrondi à 3 décimales à la ligne {p.RowNumber} du fichier.", LineIndex: i));
            }
        }

        if (reversed)
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.TabularReversedOrder, StatementIssueSeverity.Info,
                "Lignes réordonnées : le fichier les listait de la plus récente à la plus ancienne."));
        }

        if (table.HasFormulaCells)
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.TabularFormulaCells, StatementIssueSeverity.Info,
                "Certaines cellules contiennent une formule : la dernière valeur calculée a été lue, sans recalcul."));
        }

        var opening = mapping.OpeningBalance is { } ob
            ? new StatementAmount(ob, BankStatementBalanceCheck.CurrencyDecimals)
            : DeduceOpeningFromColumn(operationLines, lines);
        var closing = mapping.ClosingBalance is { } cb
            ? new StatementAmount(cb, BankStatementBalanceCheck.CurrencyDecimals)
            : operationLines[^1].Balance is { } lastBalance
                ? new StatementAmount(lastBalance, BankStatementBalanceCheck.CurrencyDecimals)
                : null;

        if (mapping.BalanceColumn is not null)
        {
            decimal? running = opening?.Value;
            for (var i = 0; i < operationLines.Count; i++)
            {
                var p = operationLines[i];
                if (running is not null && p.Amount is { } amount && p.IsDebit is { } isDebit)
                    running += isDebit ? -amount : amount;

                if (p.Balance is { } printed && running is not null && Math.Abs(running.Value - printed) > 0.0005m)
                {
                    issues.Add(new StatementExtractionIssue(StatementIssueCodes.TabularRunningBalanceMismatch, StatementIssueSeverity.Warning,
                        $"Solde progressif en désaccord à la ligne {p.RowNumber} du fichier.", LineIndex: i));
                }

                if (p.Balance is { } b)
                    running = b; // Le solde imprimé prime pour la suite du contrôle.
            }
        }

        decimal? footerTotalDebits = null;
        decimal? footerTotalCredits = null;
        foreach (var footerLine in parsed.Where(p => p.IsFooter))
        {
            footerTotalDebits ??= footerLine.FooterTotalDebit;
            footerTotalCredits ??= footerLine.FooterTotalCredit;
        }
        var totalsLabelled = footerTotalDebits is not null || footerTotalCredits is not null;

        var header = new ExtractedStatementHeader
        {
            Rib = rib,
            BankCode = rib is { Length: 20 } ? rib[..2] : null,
            Currency = "TND",
            PeriodStart = lines.Min(l => l.TransactionDate),
            PeriodEnd = lines.Max(l => l.TransactionDate),
            PeriodPrinted = false,
            OpeningBalance = opening,
            ClosingBalance = closing,
            TotalDebits = footerTotalDebits is { } td ? new StatementAmount(td, BankStatementBalanceCheck.CurrencyDecimals) : null,
            TotalCredits = footerTotalCredits is { } tc ? new StatementAmount(tc, BankStatementBalanceCheck.CurrencyDecimals) : null,
            TotalsLabelled = totalsLabelled
        };

        var extraction = new ExtractedBankStatement
        {
            Header = header,
            Lines = lines,
            Issues = issues,
            ProfileId = BankStatementImportExtractionMethods.TabularProfileId,
            PageCount = 1,
            UnresolvedPages = Array.Empty<int>()
        };

        return Result.Success(BankStatementBalanceCheck.Reevaluate(extraction));
    }

    private static StatementAmount? DeduceOpeningFromColumn(IReadOnlyList<ParsedLine> operationLines, IReadOnlyList<ExtractedStatementLine> lines)
    {
        if (operationLines.Count == 0 || operationLines[0].Balance is not { } balanceAfterFirst)
            return null;

        var firstLine = lines[0];
        var opening = balanceAfterFirst + (firstLine.IsDebit ? firstLine.Amount : -firstLine.Amount);
        return new StatementAmount(opening, BankStatementBalanceCheck.CurrencyDecimals);
    }

    private static string FriendlyMessage(string code, int rowNumber) => code switch
    {
        StatementIssueCodes.TabularDateInvalid => $"Date illisible à la ligne {rowNumber} du fichier : corrigez-la ou excluez la ligne.",
        StatementIssueCodes.TabularAmountInvalid => $"Montant illisible ou nul à la ligne {rowNumber} du fichier : corrigez-le ou excluez la ligne.",
        StatementIssueCodes.TabularBothSides => $"Débit et crédit renseignés à la ligne {rowNumber} du fichier : corrigez le sens de l'opération.",
        _ => $"Anomalie à la ligne {rowNumber} du fichier."
    };

    /// <summary>
    /// Montant tolérant les espaces (dont insécables), parenthèses et signe en fin, strictement
    /// piloté par <paramref name="decimalSeparator"/> (§3) : <c>","</c> = convention tunisienne
    /// (point = milliers, virgule = décimales) ; <c>"."</c> = convention internationale (virgule =
    /// milliers, point = décimales). Plus de 3 décimales : arrondi (<paramref name="rounded"/> = true).
    /// Utilisé pour les colonnes solde / pied de page : aucune borne de plausibilité appliquée ici
    /// (un solde peut être négatif ou nul).
    /// </summary>
    private static bool TryParseAmount(string? value, string decimalSeparator, out decimal amount, bool isNumericCell = false) =>
        TryParseAmountCore(value, decimalSeparator, applyOperationBounds: false, isNumericCell, out amount, out _);

    /// <summary>
    /// Comme <see cref="TryParseAmount(string?, string, out decimal, bool)"/>, pour un montant d'opération
    /// (débit/crédit/montant signé) : applique en plus <see cref="TunisianBankAmountParsing.IsPlausibleOperationAmount"/>
    /// (échoue si le montant lu est invraisemblable).
    /// </summary>
    private static bool TryParseOperationAmount(string? value, string decimalSeparator, out decimal amount, out bool rounded, bool isNumericCell = false) =>
        TryParseAmountCore(value, decimalSeparator, applyOperationBounds: true, isNumericCell, out amount, out rounded);

    /// <summary>
    /// <paramref name="isNumericCell"/> : vraie cellule numérique XLSX (<see cref="FormatCellValue"/> l'a
    /// toujours formatée en invariant, point décimal, jamais de séparateur de milliers) — <paramref
    /// name="decimalSeparator"/> est alors ignoré (il ne pilote que le texte : CSV ou cellule texte XLSX),
    /// sous peine de relire par ex. "125.75" comme 12575 quand <paramref name="decimalSeparator"/> == ",".
    /// </summary>
    private static bool TryParseAmountCore(string? value, string decimalSeparator, bool applyOperationBounds, bool isNumericCell, out decimal amount, out bool rounded)
    {
        amount = 0m;
        rounded = false;
        if (string.IsNullOrWhiteSpace(value))
            return false;

        var text = value.Trim()
            .Replace(" ", string.Empty)
            .Replace("\u00A0", string.Empty)
            .Replace("\u202F", string.Empty);

        var negative = false;
        if (text.StartsWith('(') && text.EndsWith(')'))
        {
            negative = true;
            text = text[1..^1];
        }
        else if (text.EndsWith('-'))
        {
            negative = true;
            text = text[..^1];
        }

        // Signe en tête (ex. XLSX "-125.75" produit par FormatCellValue, ou export "-125,500" / "+125,500") :
        // extrait dans `negative` AVANT le contrôle de plausibilité ci-dessous. Sans cela, un débit négatif
        // légitime (mode signé) resterait négatif et échouerait IsPlausibleOperationAmount, qui rejette les
        // montants négatifs — faisant passer chaque ligne en tabular_amount_invalid.
        if (text.StartsWith('-'))
        {
            negative = !negative;
            text = text[1..];
        }
        else if (text.StartsWith('+'))
        {
            text = text[1..];
        }

        var parsedOk = isNumericCell
            ? decimal.TryParse(text, NumberStyles.Number | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var parsed)
            : decimalSeparator == "."
                ? TryParseDotDecimal(text, out parsed)
                : TryParseCommaDecimal(text, out parsed);
        if (!parsedOk)
            return false;

        // Dépouille les zéros de fin de la valeur lue avant de compter les décimales : sinon un texte
        // comme "10,0000" (4 chiffres après la virgule, valeur réelle à 0 décimale) serait signalé à
        // tort comme arrondi (CountDecimals sur une valeur non normalisée refléterait l'écriture, pas
        // la valeur).
        parsed = Normalize(parsed);
        if (CountDecimals(parsed) > MaxDecimalsBeforeRounding)
        {
            parsed = Math.Round(parsed, MaxDecimalsBeforeRounding, MidpointRounding.AwayFromZero);
            rounded = true;
        }

        if (applyOperationBounds && !TunisianBankAmountParsing.IsPlausibleOperationAmount(parsed))
            return false;

        amount = negative ? -parsed : parsed;
        return true;
    }

    /// <summary>Division par un <c>1m</c> à échelle maximale (27) : seul moyen fiable de dépouiller les zéros de fin d'un <see cref="decimal"/> sans en changer la valeur.</summary>
    private static decimal Normalize(decimal value) => value / DecimalNormalizationUnit;

    /// <summary>Point décimal : la virgule n'est jamais qu'un séparateur de milliers, à n'importe quelle position.</summary>
    private static bool TryParseDotDecimal(string text, out decimal amount) =>
        decimal.TryParse(text.Replace(",", string.Empty), NumberStyles.Number | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out amount);

    /// <summary>
    /// Virgule décimale (convention tunisienne) : la dernière virgule sépare les décimales, tout point
    /// avant elle est un séparateur de milliers ; sans virgule, un point éventuel est TOUJOURS un
    /// séparateur de milliers (jamais une décimale) — ex. <c>"1.190"</c> = 1190, pas 1,19.
    /// </summary>
    private static bool TryParseCommaDecimal(string text, out decimal amount)
    {
        string normalized;
        var lastComma = text.LastIndexOf(',');
        if (lastComma >= 0)
        {
            var intPart = text[..lastComma].Replace(".", string.Empty);
            var fracPart = text[(lastComma + 1)..];
            normalized = intPart + "." + fracPart;
        }
        else
        {
            normalized = text.Replace(".", string.Empty);
        }

        return decimal.TryParse(normalized, NumberStyles.Number | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out amount);
    }

    private static int CountDecimals(decimal value)
    {
        var bits = decimal.GetBits(value);
        return (bits[3] >> 16) & 0x7F;
    }
}
