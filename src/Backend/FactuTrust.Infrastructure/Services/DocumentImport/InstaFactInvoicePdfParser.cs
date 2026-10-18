using System.Globalization;
using System.Text.RegularExpressions;
using FactuTrust.Application.Common;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using Microsoft.Extensions.Logging;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.DocumentLayoutAnalysis.WordExtractor;

namespace FactuTrust.Infrastructure.Services.DocumentImport;

/// <summary>
/// Parseur déterministe des factures PDF produites par InstaFact
/// (<c>PdfService.SalesInvoiceLayout</c> et gabarits dérivés).
///
/// Ces PDF portent une couche texte propre : on lit les valeurs exactes, sans OCR ni appel LLM.
/// Le parseur ne rend un résultat que si la pièce se réconcilie parfaitement au millime
/// (<see cref="AccountingDocumentReconciliation.IsUsableWithoutFallback"/>) ; sinon il renvoie
/// <c>null</c> et l'appelant bascule sur l'extraction IA. Il ne peut donc pas produire
/// silencieusement un résultat faux.
/// </summary>
public sealed class InstaFactInvoicePdfParser
{
    /// <summary>Tolérance verticale de regroupement des mots en lignes visuelles (points PDF).</summary>
    private const double LineToleranceY = 3.0;

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // --- Ancres d'en-tête -----------------------------------------------------------------
    private static readonly Regex DocumentNumberRx =
        new(@"n°\s*:\s*([A-Za-z0-9][A-Za-z0-9\-_/]*)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex IssueDateRx =
        new(@"Date\s+facture\s*:\s*(\d{2}/\d{2}/\d{4})", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex DueDateRx =
        new(@"Échéance\s*:\s*(\d{2}/\d{2}/\d{4})", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex StatusRx =
        new(@"Statut\s*:\s*([A-Za-zÀ-ÿ]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    // Le premier séparateur est optionnel : les pièces impriment la forme canonique stockée
    // « 1478395Q/B/N/000 », tandis que d'anciennes pièces l'imprimaient « 1478395/Q/B/N/000 ».
    private static readonly Regex SellerNifRx =
        new(@"\bMF\s*:\s*([0-9]{6,8}\s*/?\s*[A-Za-z]\s*/\s*[A-Za-z]\s*/\s*[A-Za-z]\s*/\s*[0-9]{3})",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex BuyerNifRx =
        new(@"N°\s*Fisc\.?\s*:\s*([0-9]{6,8}\s*/?\s*[A-Za-z]\s*/\s*[A-Za-z]\s*/\s*[A-Za-z]\s*/\s*[0-9]{3})",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex EmailRx =
        new(@"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", RegexOptions.Compiled);

    // --- Colonne des totaux (libellé « : valeur TND ») -------------------------------------
    private static readonly Regex TotalHtRx =
        new(@"Total\s+HT\s*:\s*([+\-]?[\d\s.,]+?)\s*TND", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex TotalTtcRx =
        new(@"TOTAL\s+TTC[^:]*:\s*([+\-]?[\d\s.,]+?)\s*TND", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex FodecTotalRx =
        new(@"FODEC\s*:\s*([+\-]?[\d\s.,]+?)\s*TND", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex StampTotalRx =
        new(@"Timbre\s+fiscal\s*:\s*([+\-]?[\d\s.,]+?)\s*TND", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex VatTotalRx =
        new(@"TVA\s*(\d{1,2})\s*%\s*:\s*([+\-]?[\d\s.,]+?)\s*TND", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex WithholdingTotalRx =
        new(@"Retenue\s+à\s+la\s+source[^:]*:\s*([+\-]?[\d\s.,]+?)\s*TND", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Toute étiquette « … : montant TND » de la colonne de droite, à retirer avant de lire le tableau de gauche.</summary>
    private static readonly Regex AnyTotalRx =
        new(@"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 %'’]*\s*:\s*[+\-]?[\d\s.,]+\s*TND", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Ligne du tableau de ventilation : « TVA 13% 2,500.000 325.000 ».</summary>
    private static readonly Regex VatBreakdownRowRx =
        new(@"^(?:TVA\s*(\d{1,2})\s*%|(Exon\w*|Exo\.?))\s+([\d.,]+)\s+([\d.,]+)$",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Ligne d'article : « 1 CUIS003 cuisinière moderne 2.00 Unité 1,250.000 TVA 13% — 2,825.000 ».</summary>
    private static readonly Regex ItemRowRx = new(
        @"^(?<num>\d{1,3})\s+(?<ref>\S+)\s+(?<designation>.+?)\s+(?<qty>[\d.,]+)\s+(?<unit>\S+)\s+"
        + @"(?<price>[\d.,]+)\s+(?:(?<vat>TVA\s*\d{1,2}\s*%)|(?<exo>Exo\.?))\s+"
        + @"(?<discount>—|-|[\d.,]+\s*%)\s+(?<total>[\d.,]+)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex VatPercentRx = new(@"(\d{1,2})", RegexOptions.Compiled);

    private readonly ILogger<InstaFactInvoicePdfParser> _logger;

    public InstaFactInvoicePdfParser(ILogger<InstaFactInvoicePdfParser> logger) => _logger = logger;

    /// <summary>
    /// Tente de lire une facture au gabarit InstaFact. Renvoie <c>null</c> dès que le document
    /// n'est pas reconnu ou ne se réconcilie pas exactement.
    /// </summary>
    public AccountingDocumentExtractionDto? TryParse(byte[] pdfBytes, string fileName)
    {
        ArgumentNullException.ThrowIfNull(pdfBytes);

        List<string> lines;
        try
        {
            lines = ReadVisualLines(pdfBytes);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Parseur natif : PDF {FileName} illisible, bascule sur l'extraction IA.", fileName);
            return null;
        }

        if (lines.Count == 0)
            return null;

        var document = BuildDocument(lines);
        if (document is null)
            return null;

        if (!AccountingDocumentReconciliation.IsUsableWithoutFallback(document))
        {
            var report = AccountingDocumentReconciliation.Check(document);
            _logger.LogInformation(
                "Parseur natif : {FileName} non réconcilié (baseOk={BaseOk} tvaOk={VatOk} totalOk={TotalOk} écart={Delta}) "
                + "— bascule sur l'extraction IA.",
                fileName, report.VatBaseMatchesTotalHt, report.VatAmountMatchesTotalVat,
                report.GrandTotalMatches, report.GrandTotalDelta);
            return null;
        }

        return document;
    }

    // ========================================================================
    // Lecture des lignes visuelles
    // ========================================================================

    /// <summary>
    /// Regroupe les mots par ligne visuelle (même ordonnée) puis les ordonne de gauche à droite.
    /// Indispensable : le tableau de ventilation TVA (à gauche) et la colonne de totaux (à droite)
    /// partagent des ordonnées ; une lecture purement séquentielle les entrelace.
    /// </summary>
    private static List<string> ReadVisualLines(byte[] pdfBytes)
    {
        var result = new List<string>();
        using var pdf = PdfDocument.Open(pdfBytes);

        foreach (var page in pdf.GetPages())
        {
            var letters = page.Letters;
            if (letters is null || letters.Count == 0)
                continue;

            var words = NearestNeighbourWordExtractor.Instance.GetWords(letters)
                .Where(w => !string.IsNullOrWhiteSpace(w.Text))
                .ToList();
            if (words.Count == 0)
                continue;

            // PdfPig place l'origine en bas de page : on trie par ordonnée décroissante.
            foreach (var group in GroupByBaseline(words))
            {
                var text = string.Join(" ", group.OrderBy(w => w.BoundingBox.Left).Select(w => w.Text));
                text = NormalizeWhitespace(text);
                if (text.Length > 0)
                    result.Add(text);
            }
        }

        return result;
    }

    private static IEnumerable<List<Word>> GroupByBaseline(List<Word> words)
    {
        var ordered = words.OrderByDescending(w => w.BoundingBox.Bottom).ToList();
        var current = new List<Word> { ordered[0] };
        var reference = ordered[0].BoundingBox.Bottom;

        for (var i = 1; i < ordered.Count; i++)
        {
            var word = ordered[i];
            if (Math.Abs(reference - word.BoundingBox.Bottom) <= LineToleranceY)
            {
                current.Add(word);
                continue;
            }

            yield return current;
            current = new List<Word> { word };
            reference = word.BoundingBox.Bottom;
        }

        yield return current;
    }

    private static string NormalizeWhitespace(string value) =>
        Regex.Replace(value.Replace(' ', ' '), @"\s+", " ").Trim();

    // ========================================================================
    // Reconstruction du document
    // ========================================================================

    private AccountingDocumentExtractionDto? BuildDocument(List<string> lines)
    {
        var joined = string.Join("\n", lines);

        var documentType = DetectDocumentType(joined);
        if (documentType is null)
            return null;

        var warnings = new List<string>();

        var totals = ReadTotals(lines);
        var breakdown = ReadVatBreakdown(lines);
        var items = ReadItemLines(lines, warnings);

        var seller = ReadSeller(lines);
        var buyer = ReadBuyer(lines);

        var number = FirstMatch(lines, DocumentNumberRx);
        var issueDate = ParseDate(FirstMatch(lines, IssueDateRx));
        var dueDate = ParseDate(FirstMatch(lines, DueDateRx));
        var status = FirstMatch(lines, StatusRx);

        var isCreditNote = documentType == DocumentTypes.CreditNote;
        if (isCreditNote)
            warnings.Add("Avoir détecté : les sens débit/crédit sont inversés par rapport à une facture.");

        if (!string.IsNullOrWhiteSpace(status)
            && status.StartsWith("Brouillon", StringComparison.OrdinalIgnoreCase))
        {
            warnings.Add("La pièce porte le statut « Brouillon ». Vérifiez qu'elle doit être comptabilisée.");
        }

        if (totals.Withholding is { } rs && rs != 0m)
        {
            warnings.Add(
                "Retenue à la source détectée sur la pièce : elle n'est pas intégrée à l'écriture de facture "
                + "(elle est comptabilisée séparément au paiement).");
        }

        return new AccountingDocumentExtractionDto
        {
            DocumentType = documentType,
            DocumentNumber = number,
            IssueDate = issueDate,
            DueDate = dueDate,
            DocumentStatus = status,
            Currency = "TND",
            Seller = seller,
            Buyer = buyer,
            Lines = items,
            VatBreakdown = breakdown,
            TotalHt = totals.Ht,
            TotalVat = totals.Vat ?? (breakdown.Count > 0 ? breakdown.Sum(b => b.VatAmount) : null),
            FodecAmount = totals.Fodec,
            FiscalStampAmount = totals.Stamp,
            WithholdingAmount = totals.Withholding,
            TotalTtc = totals.Ttc,
            Confidence = "high",
            Warnings = warnings,
            ExtractionMethod = AccountingDocumentExtractionMethods.NativePdf,
            OcrApplied = false,
            VatBreakdownRecomputed = false
        };
    }

    private static string? DetectDocumentType(string joined)
    {
        if (joined.Contains("FACTURE D'AVOIR", StringComparison.OrdinalIgnoreCase)
            || joined.Contains("AVOIR N", StringComparison.OrdinalIgnoreCase))
            return DocumentTypes.CreditNote;

        if (joined.Contains("BON DE LIVRAISON", StringComparison.OrdinalIgnoreCase))
            return DocumentTypes.DeliveryNote;

        if (joined.Contains("PROFORMA", StringComparison.OrdinalIgnoreCase)
            || joined.Contains("DEVIS", StringComparison.OrdinalIgnoreCase))
            return DocumentTypes.Proforma;

        if (joined.Contains("FACTURE", StringComparison.OrdinalIgnoreCase))
            return DocumentTypes.Invoice;

        // Gabarit non reconnu : on laisse l'IA faire.
        return null;
    }

    // --- Totaux ---------------------------------------------------------------------------

    private readonly record struct DocumentTotals(
        decimal? Ht, decimal? Vat, decimal? Fodec, decimal? Stamp, decimal? Withholding, decimal? Ttc);

    private static DocumentTotals ReadTotals(List<string> lines)
    {
        decimal? ht = null, fodec = null, stamp = null, withholding = null, ttc = null;
        var vatByRate = new Dictionary<int, decimal>();

        foreach (var line in lines)
        {
            // TOTAL TTC doit être testé avant Total HT : les deux libellés contiennent « TOTAL ».
            if (ttc is null && TotalTtcRx.Match(line) is { Success: true } ttcMatch)
                ttc = ParseAmount(ttcMatch.Groups[1].Value);

            if (ht is null && TotalHtRx.Match(line) is { Success: true } htMatch)
                ht = ParseAmount(htMatch.Groups[1].Value);

            if (fodec is null && FodecTotalRx.Match(line) is { Success: true } fodecMatch)
                fodec = ParseAmount(fodecMatch.Groups[1].Value);

            if (stamp is null && StampTotalRx.Match(line) is { Success: true } stampMatch)
                stamp = ParseAmount(stampMatch.Groups[1].Value);

            if (withholding is null && WithholdingTotalRx.Match(line) is { Success: true } rsMatch)
                withholding = ParseAmount(rsMatch.Groups[1].Value);

            foreach (Match m in VatTotalRx.Matches(line))
            {
                if (!int.TryParse(m.Groups[1].Value, NumberStyles.Integer, Inv, out var rate))
                    continue;
                var amount = ParseAmount(m.Groups[2].Value);
                if (amount is null)
                    continue;
                vatByRate[rate] = amount.Value;
            }
        }

        decimal? vat = vatByRate.Count > 0 ? vatByRate.Values.Sum() : null;
        return new DocumentTotals(ht, vat, fodec, stamp, withholding, ttc);
    }

    // --- Ventilation TVA ------------------------------------------------------------------

    private static List<ExtractedVatBucketDto> ReadVatBreakdown(List<string> lines)
    {
        var buckets = new Dictionary<int, (decimal Base, decimal Vat)>();

        foreach (var raw in lines)
        {
            // On retire d'abord la colonne de totaux (« … : montant TND ») qui partage l'ordonnée
            // avec le tableau de ventilation, sinon la ligne ne matche jamais.
            var line = NormalizeWhitespace(AnyTotalRx.Replace(raw, " "));
            if (line.Length == 0)
                continue;

            var m = VatBreakdownRowRx.Match(line);
            if (!m.Success)
                continue;

            var rate = m.Groups[1].Success
                ? int.Parse(m.Groups[1].Value, NumberStyles.Integer, Inv)
                : 0;
            var baseAmount = ParseAmount(m.Groups[3].Value);
            var vatAmount = ParseAmount(m.Groups[4].Value);
            if (baseAmount is null || vatAmount is null)
                continue;

            buckets.TryGetValue(rate, out var existing);
            buckets[rate] = (existing.Base + baseAmount.Value, existing.Vat + vatAmount.Value);
        }

        return buckets
            .OrderBy(kv => kv.Key)
            .Select(kv => new ExtractedVatBucketDto(kv.Key, kv.Value.Base, kv.Value.Vat))
            .ToList();
    }

    // --- Lignes d'articles ----------------------------------------------------------------

    private static List<ExtractedLineDto> ReadItemLines(List<string> lines, List<string> warnings)
    {
        var items = new List<ExtractedLineDto>();
        var inTable = false;
        var skipped = 0;

        foreach (var raw in lines)
        {
            var line = NormalizeWhitespace(raw);

            if (!inTable)
            {
                if (line.Contains("DESCRIPTION", StringComparison.OrdinalIgnoreCase)
                    && line.Contains("PRIX", StringComparison.OrdinalIgnoreCase))
                {
                    inTable = true;
                }
                continue;
            }

            // Fin du tableau : on atteint la zone des totaux ou la ventilation TVA.
            if (TotalHtRx.IsMatch(line)
                || line.StartsWith("Taxe", StringComparison.OrdinalIgnoreCase)
                || TotalTtcRx.IsMatch(line))
            {
                break;
            }

            var m = ItemRowRx.Match(line);
            if (!m.Success)
            {
                // Une ligne de tableau non reconnue (description sur deux lignes, en-tête replié…)
                // n'invalide pas l'extraction : les lignes sont best-effort, la vérité comptable
                // reste la ventilation TVA et les totaux.
                if (Regex.IsMatch(line, @"^\d{1,3}\s"))
                    skipped++;
                continue;
            }

            var quantity = ParseAmount(m.Groups["qty"].Value) ?? 1m;
            var unitPrice = ParseAmount(m.Groups["price"].Value) ?? 0m;
            var discount = ParseDiscountPercent(m.Groups["discount"].Value);
            var vatRate = m.Groups["exo"].Success
                ? 0
                : ParseVatPercent(m.Groups["vat"].Value);

            var reference = m.Groups["ref"].Value;
            if (reference is "—" or "-")
                reference = null;

            var grossHt = quantity * unitPrice;
            var lineHt = discount is { } d && d > 0m
                ? grossHt * (1m - d / 100m)
                : grossHt;

            items.Add(new ExtractedLineDto
            {
                Designation = m.Groups["designation"].Value.Trim(),
                Reference = reference,
                Quantity = quantity,
                Unit = m.Groups["unit"].Value.Trim(),
                UnitPriceHt = unitPrice,
                DiscountPercent = discount,
                VatRatePercent = vatRate,
                LineTotalHt = Domain.Common.MillimeRounding.Round(lineHt)
            });
        }

        if (skipped > 0)
            warnings.Add($"{skipped} ligne(s) d'article n'ont pas pu être lues et sont absentes du détail.");

        return items;
    }

    private static int ParseVatPercent(string token)
    {
        var m = VatPercentRx.Match(token ?? string.Empty);
        return m.Success && int.TryParse(m.Groups[1].Value, NumberStyles.Integer, Inv, out var rate)
            ? rate
            : 0;
    }

    private static decimal? ParseDiscountPercent(string token)
    {
        if (string.IsNullOrWhiteSpace(token) || token is "—" or "-")
            return null;
        return ParseAmount(token.Replace("%", string.Empty));
    }

    // --- Parties --------------------------------------------------------------------------

    private static ExtractedPartyDto? ReadSeller(List<string> lines)
    {
        var nif = FirstMatch(lines, SellerNifRx);

        // Le nom de l'émetteur est le premier fragment de la page, à gauche du titre « FACTURE ».
        string? name = null;
        foreach (var line in lines)
        {
            var candidate = Regex.Replace(line, @"\s*FACTURE(\s+D'AVOIR)?\s*$", string.Empty,
                RegexOptions.IgnoreCase).Trim();
            if (candidate.Length is > 1 and < 120 && !candidate.Contains(':'))
            {
                name = candidate;
                break;
            }
        }

        if (name is null && nif is null)
            return null;

        return new ExtractedPartyDto { Name = name, Nif = NormalizeNifSpacing(nif) };
    }

    private static ExtractedPartyDto? ReadBuyer(List<string> lines)
    {
        var anchor = lines.FindIndex(l => l.StartsWith("Facturé à", StringComparison.OrdinalIgnoreCase));
        if (anchor < 0)
            return null;

        string? name = null;
        var address = new List<string>();
        string? email = null;

        for (var i = anchor + 1; i < lines.Count && i <= anchor + 10; i++)
        {
            // La colonne de droite (n° de pièce, dates, statut) partage l'ordonnée du bloc client :
            // on la retire avant de lire le bloc de gauche.
            var line = NormalizeWhitespace(Regex.Replace(
                lines[i],
                @"(FACTURE\s+n°|Date\s+facture|Échéance|Statut|Entrepôt)\s*:.*$",
                string.Empty,
                RegexOptions.IgnoreCase));

            if (line.Length == 0)
                continue;

            if (line.Contains("RÉF.", StringComparison.OrdinalIgnoreCase)
                || line.Contains("DESCRIPTION", StringComparison.OrdinalIgnoreCase))
                break;

            if (BuyerNifRx.IsMatch(line))
                continue;

            if (EmailRx.Match(line) is { Success: true } emailMatch)
            {
                email ??= emailMatch.Value;
                continue;
            }

            if (name is null)
                name = line;
            else
                address.Add(line);
        }

        var nif = FirstMatch(lines, BuyerNifRx);
        if (name is null && nif is null)
            return null;

        return new ExtractedPartyDto
        {
            Name = name,
            Nif = NormalizeNifSpacing(nif),
            Email = email,
            Street = address.Count > 0 ? address[0] : null,
            City = ExtractCity(address),
            PostalCode = ExtractPostalCode(address),
            Governorate = address.Count > 1 ? address[^1] : null
        };
    }

    /// <summary>« 5000 Monastir » — le code postal tunisien précède la ville.</summary>
    private static readonly Regex PostalCityRx = new(@"^(\d{4})\s+(.+)$", RegexOptions.Compiled);

    private static string? ExtractPostalCode(List<string> address) =>
        address.Select(a => PostalCityRx.Match(a)).FirstOrDefault(m => m.Success)?.Groups[1].Value;

    private static string? ExtractCity(List<string> address) =>
        address.Select(a => PostalCityRx.Match(a)).FirstOrDefault(m => m.Success)?.Groups[2].Value;

    private static string? NormalizeNifSpacing(string? nif) =>
        string.IsNullOrWhiteSpace(nif) ? null : Regex.Replace(nif, @"\s+", string.Empty).ToUpperInvariant();

    // ========================================================================
    // Utilitaires
    // ========================================================================

    private static string? FirstMatch(List<string> lines, Regex regex)
    {
        foreach (var line in lines)
        {
            var m = regex.Match(line);
            if (m.Success)
                return m.Groups[1].Value.Trim();
        }
        return null;
    }

    private static DateOnly? ParseDate(string? value) =>
        DateOnly.TryParseExact(value, "dd/MM/yyyy", Inv, DateTimeStyles.None, out var date) ? date : null;

    /// <summary>
    /// Lit un montant tunisien. Gère « 1,250.000 » (virgule = millier), « +3700.000 »,
    /// « 1 250,000 » (format français) et « 650,000 ».
    ///
    /// Le corps a été déplacé tel quel dans <see cref="TunisianNumberParsing.ParseDecimal"/> afin
    /// d'être partagé avec la désérialisation tolérante des sorties de LLM. Nom, signature et
    /// accessibilité sont conservés : les tests golden de ce parseur exercent toujours ce code.
    /// </summary>
    internal static decimal? ParseAmount(string? raw) => TunisianNumberParsing.ParseDecimal(raw);
}
