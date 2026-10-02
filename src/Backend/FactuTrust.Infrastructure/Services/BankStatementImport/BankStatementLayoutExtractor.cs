using System.Globalization;
using System.Text.RegularExpressions;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Lecture déterministe d'un relevé bancaire PDF à couche texte, par la GÉOMÉTRIE des mots
/// (PdfPig) et non par le flux de texte — qui est réordonné chez plusieurs banques (Zitouna,
/// Attijari) et perd le sens débit/crédit chez d'autres (BH).
///
/// Principes (mesurés sur des relevés réels STB, BH, Zitouna, Attijari) :
/// <list type="bullet">
/// <item>une opération = une date d'opération dans la colonne de gauche (« ancre ») ;</item>
/// <item>les mots d'une opération sont ceux de sa cellule de tableau quand le PDF dessine des
/// filets (STB, Attijari : libellés sur plusieurs lignes, centrés sur la date), sinon ceux de la
/// ligne de l'ancre la plus proche (BH, Zitouna : une ligne par opération) ;</item>
/// <item>le sens vient de la colonne du montant (filets, en-têtes « Débit/Crédit », ou deux groupes
/// de montants) ou de son signe — jamais du libellé ;</item>
/// <item>les montants coupés en plusieurs mots (« 1 » « 657 » « 861.592 ») sont reconstitués ;</item>
/// <item>soldes et totaux sont lus par leur libellé, puis contrôlés par <see cref="BankStatementBalanceCheck"/>.</item>
/// </list>
/// Aucune donnée n'est inventée : une ligne illisible produit un signalement bloquant.
/// </summary>
public sealed partial class BankStatementLayoutExtractor
{
    /// <summary>Au-delà, le fichier est refusé avant toute lecture (garde-fou de charge).</summary>
    public const int MaxPages = 60;

    private const int LineAmountDecimals = 3;
    private const double BandTolerance = 2.6;
    private const double FragmentMaxGap = 6.5;
    private const int MinLettersForTextLayer = 30;

    private static readonly string[] OpeningLabels =
    {
        "SOLDE INITIAL", "SOLDE DEBUT", "SOLDE DE DEPART", "SOLDE PRECEDENT", "ANCIEN SOLDE",
        "SOLDE D'OUVERTURE", "SOLDE OUVERTURE"
    };

    private static readonly string[] ClosingLabels =
    {
        "SOLDE COMPTABLE", "SOLDE DE FIN", "SOLDE FINAL", "NOUVEAU SOLDE", "SOLDE DE CLOTURE",
        "CREDITEUR", "DEBITEUR"
    };

    /// <summary>« SOLDE AU » ouvre (BH) ou clôt (Zitouna) : tranché par la position par rapport aux opérations.</summary>
    private static readonly string[] PositionalBalanceLabels = { "SOLDE AU" };

    private static readonly string[] BothSidesTotalLabels = { "TOTAUX", "TOTAL" };
    private static readonly string[] DebitTotalLabels = { "TOTAL DEBITS", "TOTAL DEBIT", "TOTAL DES DEBITS" };
    private static readonly string[] CreditTotalLabels = { "TOTAL CREDITS", "TOTAL CREDIT", "TOTAL DES CREDITS" };

    private readonly BankStatementProfileRegistry _profiles;

    public BankStatementLayoutExtractor(BankStatementProfileRegistry? profiles = null)
    {
        _profiles = profiles ?? BankStatementProfileRegistry.Default;
    }

    public ExtractedBankStatement Extract(byte[] pdf)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        var issues = new List<StatementExtractionIssue>();

        List<PageData> pages;
        int pageCount;
        try
        {
            using var document = PdfDocument.Open(pdf);
            pageCount = document.NumberOfPages;
            if (pageCount > MaxPages)
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.TooManyPages, StatementIssueSeverity.Blocking,
                    $"Le relevé compte {pageCount} pages (maximum {MaxPages})."));
                return Empty(issues, pageCount);
            }

            pages = document.GetPages().Select(LoadPage).ToList();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            var message = ex.Message.Contains("password", StringComparison.OrdinalIgnoreCase)
                          || ex.Message.Contains("encrypt", StringComparison.OrdinalIgnoreCase)
                ? "Le PDF est protégé par mot de passe : exportez une version non protégée depuis votre banque."
                : "Le fichier n'a pas pu être lu comme un PDF.";
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.Unreadable, StatementIssueSeverity.Blocking, message));
            return Empty(issues, 0);
        }

        var textPages = pages.Where(p => p.HasTextLayer).ToList();
        var unresolved = pages.Where(p => !p.HasTextLayer).Select(p => p.Number).ToList();
        foreach (var page in unresolved)
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.NoTextLayer, StatementIssueSeverity.Blocking,
                $"La page {page} n'a pas de texte lisible (document scanné) : lecture par OCR / IA nécessaire.", page));
        }

        var bands = textPages.SelectMany(BuildBands).ToList();
        var rib = FindRib(bands, issues);
        var documentText = BankLabelNormalizer.Normalize(string.Join(' ', bands.Select(b => b.Text)));
        var profile = _profiles.Resolve(TunisianIban.BankCodeOf(rib), documentText);

        if (profile.MergeSplitDates)
        {
            textPages = textPages.Select(MergeSplitDates).ToList();
            bands = textPages.SelectMany(BuildBands).ToList();
        }

        var anchors = FindAnchors(textPages, profile);
        var valueColumn = FindValueDateColumn(textPages, anchors, profile);
        if (anchors.Count == 0)
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.NoTransactions, StatementIssueSeverity.Blocking,
                "Aucune opération datée n'a été trouvée dans le relevé."));
        }

        var headers = textPages.ToDictionary(p => p.Number, p => FindHeader(p, bands));
        var columns = ResolveColumns(textPages, headers, anchors, profile, issues);
        var period = FindPeriod(bands, profile);

        var rows = BuildRows(textPages, headers, anchors, columns, issues);
        var summary = ReadSummary(bands, anchors, columns, profile);

        var referenceYear = period.End?.Year ?? summary.ClosingDate?.Year ?? summary.OpeningDate?.Year;
        var periodStart = period.Start ?? summary.OpeningDate?.AddDays(1);
        var periodEnd = period.End ?? summary.ClosingDate;
        var lines = BuildLines(rows, profile, columns, valueColumn, referenceYear, periodStart, periodEnd, issues);

        if (periodStart is null && lines.Count > 0)
            periodStart = lines.Min(l => l.TransactionDate);
        if (periodEnd is null && lines.Count > 0)
            periodEnd = lines.Max(l => l.TransactionDate);

        var header = new ExtractedStatementHeader
        {
            Rib = rib,
            BankCode = TunisianIban.BankCodeOf(rib),
            Currency = FindCurrency(bands),
            PeriodStart = periodStart,
            PeriodEnd = periodEnd,
            OpeningBalance = summary.Opening,
            ClosingBalance = summary.Closing,
            TotalDebits = summary.TotalDebits,
            TotalCredits = summary.TotalCredits,
            TotalsLabelled = summary.TotalsLabelled,
            CreditTotalIncludesOpening = profile.CreditTotalIncludesOpening
        };

        if (header.Currency is null)
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.CurrencyNotFound, StatementIssueSeverity.Info,
                "Devise non imprimée sur le relevé : celle du compte bancaire sera retenue."));
        }

        if (lines.Count > 0 && unresolved.Count == 0)
            issues.AddRange(BankStatementBalanceCheck.Evaluate(header, lines).Issues);

        return new ExtractedBankStatement
        {
            Header = header,
            Lines = lines,
            Issues = issues,
            ProfileId = profile.Id,
            PageCount = pageCount,
            UnresolvedPages = unresolved
        };
    }

    // ── Chargement ──────────────────────────────────────────────────────────────────────────

    private static PageData LoadPage(Page page)
    {
        var words = page.GetWords()
            .Where(w => !string.IsNullOrWhiteSpace(w.Text))
            .Select(w => new TextWord(w.Text.Trim(), new Box(w.BoundingBox.Left, w.BoundingBox.Right, w.BoundingBox.Bottom, w.BoundingBox.Top), page.Number))
            .ToList();

        var rules = new List<HRule>();
        try
        {
            foreach (var path in page.Paths)
            {
                var rect = path.GetBoundingRectangle();
                if (rect is null)
                    continue;
                var r = rect.Value;
                if (r.Height <= 1.6 && r.Width >= 12)
                    rules.Add(new HRule((r.Bottom + r.Top) / 2, r.Left, r.Right));
            }
        }
        catch (Exception)
        {
            // Les filets ne sont qu'une aide : sans eux, l'appariement par ligne d'ancre prend le relais.
        }

        return new PageData(page.Number, page.Width, page.Height, words, rules, page.Letters.Count >= MinLettersForTextLayer);
    }

    private static IEnumerable<Band> BuildBands(PageData page) =>
        ClusterBands(page.Words).Select(b => new Band(page.Number, b.Average(w => w.Box.CenterY), b));

    /// <summary>Lignes visuelles : mots dont le centre vertical est à ± <see cref="BandTolerance"/>, triés de gauche à droite.</summary>
    private static List<List<TextWord>> ClusterBands(IEnumerable<TextWord> words)
    {
        var bands = new List<List<TextWord>>();
        foreach (var word in words.OrderByDescending(w => w.Box.CenterY))
        {
            var band = bands.LastOrDefault();
            if (band is not null && Math.Abs(band.Average(w => w.Box.CenterY) - word.Box.CenterY) <= BandTolerance)
                band.Add(word);
            else
                bands.Add(new List<TextWord> { word });
        }

        foreach (var band in bands)
            band.Sort((a, b) => a.Box.Left.CompareTo(b.Box.Left));
        return bands;
    }

    // ── RIB, devise, période ────────────────────────────────────────────────────────────────

    private static string? FindRib(IReadOnlyList<Band> bands, List<StatementExtractionIssue> issues)
    {
        var candidates = new List<string>();
        foreach (var band in bands)
        {
            var digitRun = new List<TextWord>();
            foreach (var word in band.Words.Append(new TextWord("\u0000", new Box(double.MaxValue, double.MaxValue, 0, 0), band.Page)))
            {
                var isDigits = word.Text.All(char.IsDigit);
                var contiguous = digitRun.Count == 0 || word.Box.Left - digitRun[^1].Box.Right <= 8;
                if (isDigits && contiguous)
                {
                    digitRun.Add(word);
                    continue;
                }

                var joined = string.Concat(digitRun.Select(w => w.Text));
                if (joined.Length == 20)
                    candidates.Add(joined);
                foreach (var single in digitRun.Where(w => w.Text.Length == 20))
                    candidates.Add(single.Text);
                digitRun.Clear();
                if (isDigits)
                    digitRun.Add(word);
            }
        }

        var valid = candidates.FirstOrDefault(TunisianIban.HasValidRibKey);
        if (valid is not null)
            return valid;

        if (candidates.Count > 0)
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.RibInvalidKey, StatementIssueSeverity.Warning,
                "Le RIB lu sur le relevé a une clé incohérente : vérifiez le compte bancaire choisi."));
            return candidates[0];
        }

        issues.Add(new StatementExtractionIssue(StatementIssueCodes.RibNotFound, StatementIssueSeverity.Warning,
            "RIB introuvable sur le relevé : la correspondance avec le compte bancaire choisi ne peut pas être vérifiée."));
        return null;
    }

    private static string? FindCurrency(IReadOnlyList<Band> bands)
    {
        foreach (var band in bands)
        {
            var normalized = band.Words.Select(w => BankLabelNormalizer.Normalize(w.Text)).ToList();
            var deviseIndex = normalized.FindIndex(t => t.StartsWith("DEVISE", StringComparison.Ordinal));
            if (deviseIndex < 0)
                continue;
            var code = normalized.Skip(deviseIndex + 1).FirstOrDefault(t => CurrencyCodeRegex().IsMatch(t));
            if (code is not null)
                return code;
        }

        if (bands.SelectMany(b => b.Words).Any(w => w.Text == "TND"))
            return "TND";
        return bands.Any(b => BankLabelNormalizer.Normalize(b.Text).Contains("DINAR TUNISIEN", StringComparison.Ordinal)) ? "TND" : null;
    }

    private static (DateOnly? Start, DateOnly? End) FindPeriod(IReadOnlyList<Band> bands, BankStatementProfile profile)
    {
        foreach (var band in bands.Where(b => b.Page == 1))
        {
            var dates = band.Words
                .Select(w => ParseDate(w.Text, profile.StatementDateFormats))
                .Where(d => d is { Year: not null })
                .Select(d => new DateOnly(d!.Value.Year!.Value, d.Value.Month, d.Value.Day))
                .ToList();
            if (dates.Count != 2 || dates[0] > dates[1])
                continue;

            var normalized = band.Words.Select(w => BankLabelNormalizer.Normalize(w.Text)).ToList();
            if (normalized.Contains("AU") || normalized.Contains("DU"))
                return (dates[0], dates[1]);
        }

        return (null, null);
    }

    // ── Ancres (dates d'opération) ──────────────────────────────────────────────────────────

    private static List<TextWord> FindAnchors(IReadOnlyList<PageData> pages, BankStatementProfile profile)
    {
        var dated = pages.SelectMany(p => p.Words)
            .Where(w => ParseDate(w.Text, profile.OperationDateFormats) is not null)
            .ToList();
        if (dated.Count == 0)
            return new List<TextWord>();

        // Colonne d'ancres = la plus à gauche parmi les abscisses quasi aussi peuplées que la plus
        // peuplée : date d'opération et date valeur ont souvent le même format et le même nombre
        // d'occurrences, à une date imprimée près (date d'arrêté, de clôture) qui ne doit pas faire
        // basculer le choix vers la colonne des dates valeur.
        var buckets = dated.GroupBy(w => Math.Round(w.Box.Left / 6.0)).ToList();
        var densest = buckets.Max(g => g.Count());
        var column = buckets
            .Where(g => g.Count() >= densest * 0.8)
            .OrderBy(g => g.Key)
            .First();
        var minLeft = column.Min(w => w.Box.Left) - 4;
        var maxLeft = column.Max(w => w.Box.Left) + 4;

        return dated.Where(w => w.Box.Left >= minLeft && w.Box.Left <= maxLeft).ToList();
    }

    /// <summary>
    /// Colonne des dates valeur = abscisse la plus peuplée de dates au format valeur (hors ancres).
    /// Évite de prendre pour une date valeur une référence numérique qui en aurait la forme.
    /// </summary>
    private static (double Min, double Max)? FindValueDateColumn(IReadOnlyList<PageData> pages, IReadOnlyList<TextWord> anchors, BankStatementProfile profile)
    {
        var anchorSet = anchors.ToHashSet();
        var dated = pages.SelectMany(p => p.Words)
            .Where(w => !anchorSet.Contains(w) && ParseDate(w.Text, profile.ValueDateFormats) is not null)
            .ToList();
        if (dated.Count == 0)
            return null;

        var column = dated.GroupBy(w => Math.Round(w.Box.Left / 6.0)).MaxBy(g => g.Count())!;
        return (column.Min(w => w.Box.Left) - 4, column.Max(w => w.Box.Left) + 4);
    }

    /// <summary>« 02 » « 01 » [« 2026 »] (mots contigus) → « 02/01[/2026] » (BIAT).</summary>
    private static PageData MergeSplitDates(PageData page)
    {
        var merged = new List<TextWord>();
        foreach (var band in ClusterBands(page.Words))
        {
            for (var i = 0; i < band.Count; i++)
            {
                var day = band[i];
                if (i + 1 < band.Count && TwoDigitsRegex().IsMatch(day.Text) && TwoDigitsRegex().IsMatch(band[i + 1].Text)
                    && band[i + 1].Box.Left - day.Box.Right <= FragmentMaxGap)
                {
                    var parts = new List<TextWord> { day, band[i + 1] };
                    if (i + 2 < band.Count && FourDigitsRegex().IsMatch(band[i + 2].Text)
                        && band[i + 2].Box.Left - band[i + 1].Box.Right <= FragmentMaxGap)
                        parts.Add(band[i + 2]);

                    merged.Add(new TextWord(string.Join('/', parts.Select(p => p.Text)), Union(parts), page.Number));
                    i += parts.Count - 1;
                    continue;
                }

                merged.Add(day);
            }
        }

        return page with { Words = merged };
    }

    // ── En-têtes et colonnes ────────────────────────────────────────────────────────────────

    private static PageHeader? FindHeader(PageData page, IReadOnlyList<Band> bands)
    {
        foreach (var band in bands.Where(b => b.Page == page.Number))
        {
            var debit = band.Words.FirstOrDefault(w => BankLabelNormalizer.Normalize(w.Text) == "DEBIT");
            var credit = band.Words.FirstOrDefault(w => BankLabelNormalizer.Normalize(w.Text) == "CREDIT");
            if (debit is null || credit is null || credit.Box.Left <= debit.Box.Right)
                continue;
            if (!band.Words.Any(w => BankLabelNormalizer.Normalize(w.Text) == "DATE"))
                continue;

            var valueHeader = band.Words.FirstOrDefault(w => BankLabelNormalizer.Normalize(w.Text) == "VALEUR");
            return new PageHeader(band.Words.Min(w => w.Box.Bottom), debit.Box, credit.Box, valueHeader?.Box);
        }

        return null;
    }

    private static Columns ResolveColumns(
        IReadOnlyList<PageData> pages,
        IReadOnlyDictionary<int, PageHeader?> headers,
        IReadOnlyList<TextWord> anchors,
        BankStatementProfile profile,
        List<StatementExtractionIssue> issues)
    {
        var anchorRight = anchors.Count > 0 ? anchors.Max(a => a.Box.Right) : 0;

        // 1. En-têtes texte, affinés par les filets de colonne quand le PDF en dessine.
        foreach (var page in pages)
        {
            var header = headers[page.Number];
            if (header is null)
                continue;

            var segments = page.Rules
                .Where(r => r.Right - r.Left < page.Width * 0.6)
                .Select(r => (Left: Math.Round(r.Left), Right: Math.Round(r.Right)))
                .Distinct()
                .ToList();
            var debitSegment = NarrowestSegmentContaining(segments, header.Debit.CenterX);
            var creditSegment = NarrowestSegmentContaining(segments, header.Credit.CenterX);

            if (debitSegment is not null && creditSegment is not null && debitSegment.Value.Right <= creditSegment.Value.Left + 2)
            {
                return new Columns(
                    AmountZoneLeft: debitSegment.Value.Left - 1,
                    Boundary: (debitSegment.Value.Right + creditSegment.Value.Left) / 2,
                    AnchorRight: anchorRight);
            }

            var zoneLeft = header.Debit.Left - 35;
            if (header.Value is { } valueBox && valueBox.Right < header.Debit.Left)
                zoneLeft = Math.Max(zoneLeft, valueBox.Right + 1);
            return new Columns(zoneLeft, (header.Debit.Right + header.Credit.Left) / 2, anchorRight);
        }

        // 2. Sans en-tête texte (BH) : la zone des montants commence après la colonne des dates
        //    valeur ; la frontière est le plus grand écart entre les centres des montants.
        var valueDateRight = pages.SelectMany(p => p.Words)
            .Where(w => w.Box.Left > anchorRight && ParseDate(w.Text, profile.ValueDateFormats) is { Year: not null })
            .Select(w => w.Box.Right)
            .DefaultIfEmpty(0)
            .Max();
        var pageWidth = pages.Count > 0 ? pages[0].Width : 595;
        var amountZoneLeft = valueDateRight > 0 ? valueDateRight + 1 : pageWidth * 0.6;

        var centers = pages.SelectMany(p => BuildBands(p))
            .Where(b => anchors.Any(a => a.Page == b.Page && Math.Abs(a.Box.CenterY - b.CenterY) <= BandTolerance))
            .SelectMany(b => AmountGroups(b.Words))
            .Where(g => g.Box.Left >= amountZoneLeft && g.Decimals == LineAmountDecimals)
            .Select(g => g.Box.CenterX)
            .OrderBy(x => x)
            .ToList();

        double? boundary = null;
        if (centers.Count >= 2)
        {
            var (gap, at) = centers.Zip(centers.Skip(1), (a, b) => (Gap: b - a, At: (a + b) / 2)).MaxBy(t => t.Gap);
            if (gap >= 20)
                boundary = at;
        }

        if (boundary is null && profile.DebitCreditBoundaryRatio is { } ratio)
            boundary = pageWidth * ratio;

        if (boundary is null)
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.LineAmbiguousSide, StatementIssueSeverity.Blocking,
                "Les colonnes Débit et Crédit n'ont pas pu être identifiées : le sens des opérations est indéterminé."));
        }

        return new Columns(amountZoneLeft, boundary, anchorRight);
    }

    private static (double Left, double Right)? NarrowestSegmentContaining(IEnumerable<(double Left, double Right)> segments, double x)
    {
        (double Left, double Right)? best = null;
        foreach (var segment in segments)
        {
            if (segment.Left > x || segment.Right < x)
                continue;
            if (best is null || segment.Right - segment.Left < best.Value.Right - best.Value.Left)
                best = segment;
        }

        return best;
    }

    // ── Lignes ──────────────────────────────────────────────────────────────────────────────

    private static List<RowCandidate> BuildRows(
        IReadOnlyList<PageData> pages,
        IReadOnlyDictionary<int, PageHeader?> headers,
        IReadOnlyList<TextWord> anchors,
        Columns columns,
        List<StatementExtractionIssue> issues)
    {
        var rows = new List<RowCandidate>();
        var anchorLeft = anchors.Count > 0 ? anchors.Min(a => a.Box.Left) - 2 : 0;

        foreach (var page in pages)
        {
            var pageAnchors = anchors.Where(a => a.Page == page.Number).OrderByDescending(a => a.Box.CenterY).ToList();
            if (pageAnchors.Count == 0)
                continue;

            var tableTop = headers[page.Number]?.Bottom ?? double.MaxValue;
            var tableWords = page.Words.Where(w => w.Box.CenterY < tableTop && !pageAnchors.Contains(w)).ToList();
            var pageRows = pageAnchors.Select(a => new RowCandidate(a)).ToList();

            var boundaries = page.Rules
                .Where(r => r.Left <= anchorLeft + 4 && r.Right >= columns.AnchorRight - 4)
                .Select(r => Math.Round(r.Y, 1))
                .Distinct()
                .OrderByDescending(y => y)
                .ToList();

            // Mode « grille » seulement si chaque opération occupe sa propre cellule : un tableau
            // simplement encadré (Zitouna : filets de haut et de bas seulement) n'en est pas une.
            var gridUsable = boundaries.Count >= 3 && pageRows.All(r =>
                boundaries.Any(b => b > r.Anchor.Box.CenterY) && boundaries.Any(b => b < r.Anchor.Box.CenterY));
            if (gridUsable)
            {
                foreach (var row in pageRows)
                {
                    row.CellTop = boundaries.Where(b => b > row.Anchor.Box.CenterY).Min();
                    row.CellBottom = boundaries.Where(b => b < row.Anchor.Box.CenterY).Max();
                }

                gridUsable = pageRows.Select(r => (r.CellTop, r.CellBottom)).Distinct().Count() == pageRows.Count;
            }

            double? firstCellTop = null;
            if (gridUsable)
            {
                firstCellTop = pageRows[0].CellTop;
                foreach (var word in tableWords)
                {
                    var owner = pageRows.FirstOrDefault(r => word.Box.CenterY < r.CellTop && word.Box.CenterY > r.CellBottom);
                    if (owner is not null)
                        owner.Words.Add(word);
                }
            }
            else
            {
                var gaps = pageRows.Zip(pageRows.Skip(1), (a, b) => a.Anchor.Box.CenterY - b.Anchor.Box.CenterY).OrderBy(g => g).ToList();
                var pitch = gaps.Count > 0 ? gaps[gaps.Count / 2] : 14;
                var maxDistance = Math.Max(4, pitch * 0.55);
                foreach (var word in tableWords)
                {
                    var owner = pageRows.MinBy(r => Math.Abs(r.Anchor.Box.CenterY - word.Box.CenterY))!;
                    if (Math.Abs(owner.Anchor.Box.CenterY - word.Box.CenterY) <= maxDistance)
                        owner.Words.Add(word);
                }

                firstCellTop = pageRows[0].Anchor.Box.CenterY + maxDistance;
                foreach (var row in pageRows)
                {
                    row.CellTop = row.Anchor.Box.CenterY + maxDistance;
                    row.CellBottom = row.Anchor.Box.CenterY - maxDistance;
                }
            }

            // Libellé coupé par le saut de page (Attijari) : les mots situés entre l'en-tête et la
            // première cellule de la page prolongent la dernière opération de la page précédente.
            if (rows.Count > 0 && firstCellTop is { } top)
            {
                var continuation = tableWords.Where(w => w.Box.CenterY > top && w.Box.Left > columns.AnchorRight).ToList();
                var continuationAmounts = AmountGroups(continuation).Where(g => g.Box.Left >= columns.AmountZoneLeft).ToList();
                if (continuationAmounts.Count > 0)
                {
                    issues.Add(new StatementExtractionIssue(StatementIssueCodes.OrphanAmount, StatementIssueSeverity.Blocking,
                        "Un montant en haut de page n'est rattaché à aucune opération.", page.Number));
                }
                else if (continuation.Count > 0 && headers[page.Number] is not null)
                {
                    rows[^1].Words.AddRange(continuation);
                }
            }

            // Montant présent entre deux opérations mais rattaché à aucune : quelque chose a échappé.
            var assigned = pageRows.SelectMany(r => r.Words).ToHashSet();
            var lowest = pageRows[^1].CellBottom;
            foreach (var band in BuildBands(page with { Words = tableWords.Where(w => !assigned.Contains(w)).ToList() }))
            {
                if (band.CenterY >= firstCellTop || band.CenterY <= lowest)
                    continue;
                if (AmountGroups(band.Words).Any(g => g.Box.Left >= columns.AmountZoneLeft && g.Decimals == LineAmountDecimals))
                {
                    issues.Add(new StatementExtractionIssue(StatementIssueCodes.OrphanAmount, StatementIssueSeverity.Blocking,
                        $"Un montant n'a été rattaché à aucune opération (« {Snippet(band.Text)} »).", page.Number));
                }
            }

            rows.AddRange(pageRows);
        }

        return rows;
    }

    private static List<ExtractedStatementLine> BuildLines(
        IReadOnlyList<RowCandidate> rows,
        BankStatementProfile profile,
        Columns columns,
        (double Min, double Max)? valueColumn,
        int? referenceYear,
        DateOnly? periodStart,
        DateOnly? periodEnd,
        List<StatementExtractionIssue> issues)
    {
        var lines = new List<ExtractedStatementLine>();
        foreach (var row in rows)
        {
            var anchorDate = ParseDate(row.Anchor.Text, profile.OperationDateFormats)!.Value;
            var rowBands = BuildBands(new PageData(row.Anchor.Page, 0, 0, row.Words, Array.Empty<HRule>(), true)).ToList();

            var amounts = rowBands
                .SelectMany(b => AmountGroups(b.Words))
                .Where(g => g.Box.Left >= columns.AmountZoneLeft && g.Decimals == LineAmountDecimals)
                .ToList();

            var valueDateWord = row.Words
                .Where(w => w.Box.Left < columns.AmountZoneLeft && ParseDate(w.Text, profile.ValueDateFormats) is not null)
                .Where(w => valueColumn is not { } vc || (w.Box.Left >= vc.Min && w.Box.Left <= vc.Max))
                .OrderBy(w => Math.Abs(w.Box.CenterY - row.Anchor.Box.CenterY))
                .ThenBy(w => w.Box.Left)
                .FirstOrDefault();
            var valueDateParts = valueDateWord is null ? null : ParseDate(valueDateWord.Text, profile.ValueDateFormats);

            var excluded = amounts.SelectMany(a => a.Words).ToHashSet();
            if (valueDateWord is not null)
                excluded.Add(valueDateWord);
            var labelLines = rowBands
                .Select(b => string.Join(' ', b.Words.Where(w => !excluded.Contains(w)).Select(w => w.Text)).Trim())
                .Where(t => t.Length > 0)
                .ToList();
            var label = string.Join(' ', labelLines);

            var snippet = $"{row.Anchor.Text} {Snippet(label)}";
            if (amounts.Count == 0)
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.LineNoAmount, StatementIssueSeverity.Blocking,
                    $"Opération sans montant lisible : « {snippet} ».", row.Anchor.Page));
                continue;
            }

            if (amounts.Count > 1)
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.LineSeveralAmounts, StatementIssueSeverity.Blocking,
                    $"Opération avec plusieurs montants : « {snippet} ».", row.Anchor.Page));
                continue;
            }

            var amount = amounts[0];
            bool isDebit;
            if (amount.Value < 0)
            {
                isDebit = true;
                if (columns.Boundary is { } b && amount.Box.CenterX > b)
                {
                    issues.Add(new StatementExtractionIssue(StatementIssueCodes.LineAmbiguousSide, StatementIssueSeverity.Blocking,
                        $"Montant négatif imprimé dans la colonne Crédit : « {snippet} ».", row.Anchor.Page));
                }
            }
            else if (columns.Boundary is { } boundary)
            {
                isDebit = amount.Box.CenterX < boundary;
            }
            else
            {
                // Déjà signalé (colonnes indéterminées) : la ligne est conservée pour la relecture.
                isDebit = true;
            }

            var transactionDate = ResolveDate(anchorDate, referenceYear, periodStart, periodEnd, valueDateParts);
            if (transactionDate is null)
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.LineInvalidDate, StatementIssueSeverity.Blocking,
                    $"Date d'opération illisible : « {snippet} ».", row.Anchor.Page));
                continue;
            }

            var valueDate = valueDateParts is null ? null : ResolveDate(valueDateParts.Value, transactionDate.Value.Year, null, null, null);
            lines.Add(new ExtractedStatementLine
            {
                Index = lines.Count,
                PageNumber = row.Anchor.Page,
                TransactionDate = transactionDate.Value,
                ValueDate = valueDate,
                Label = label,
                LabelLines = labelLines,
                Amount = Math.Abs(amount.Value),
                IsDebit = isDebit,
                Source = StatementLineSource.Layout
            });
        }

        return lines;
    }

    // ── Soldes et totaux ────────────────────────────────────────────────────────────────────

    private static SummaryReading ReadSummary(
        IReadOnlyList<Band> bands,
        IReadOnlyList<TextWord> anchors,
        Columns columns,
        BankStatementProfile profile)
    {
        var anchorSet = anchors.ToHashSet();
        var first = anchors.Count > 0 ? anchors.MinBy(a => (a.Page, -a.Box.CenterY)) : null;
        var last = anchors.Count > 0 ? anchors.MaxBy(a => (a.Page, -a.Box.CenterY)) : null;
        var reading = new SummaryReading();
        var labelledTotals = false;
        var consumed = new HashSet<TextWord>();

        var ordered = bands.OrderBy(b => b.Page).ThenByDescending(b => b.CenterY).ToList();
        for (var i = 0; i < ordered.Count; i++)
        {
            var band = ordered[i];
            if (band.Words.Any(anchorSet.Contains))
                continue;
            var normalizedBand = BankLabelNormalizer.Normalize(band.Text);
            if (profile.ExcludedSummaryLabels.Any(e => normalizedBand.Contains(e, StringComparison.Ordinal)))
                continue;

            var matches = FindLabels(band, profile.ClosingLabels);
            for (var m = 0; m < matches.Count; m++)
            {
                var match = matches[m];
                var nextLeft = m + 1 < matches.Count ? matches[m + 1].Left : double.MaxValue;
                var groups = AmountGroups(band.Words)
                    .Where(g => g.Box.Left > match.Right && g.Box.Left < nextLeft && !g.Words.Any(consumed.Contains))
                    .ToList();

                if (match.Kind is LabelKind.Opening or LabelKind.Closing or LabelKind.Positional)
                {
                    var kind = match.Kind;
                    if (kind == LabelKind.Positional)
                        kind = IsBefore(band, first) ? LabelKind.Opening : LabelKind.Closing;

                    var group = groups.FirstOrDefault() ?? FindAmountBelow(ordered, i, consumed, profile.ClosingLabels);
                    if (group is null)
                        continue;
                    foreach (var w in group.Words)
                        consumed.Add(w);

                    var signed = SignBalance(group, normalizedBand, columns);
                    var date = band.Words.Select(w => ParseDate(w.Text, profile.StatementDateFormats))
                        .FirstOrDefault(d => d is { Year: not null });
                    var dateOnly = date is { } d ? new DateOnly(d.Year!.Value, d.Month, d.Day) : (DateOnly?)null;

                    if (kind == LabelKind.Opening && reading.Opening is null)
                    {
                        reading.Opening = signed;
                        reading.OpeningDate = dateOnly;
                    }
                    else if (kind == LabelKind.Closing && reading.Closing is null)
                    {
                        reading.Closing = signed;
                        reading.ClosingDate = dateOnly ?? FindDateBelow(ordered, i, profile);
                    }
                }
                else if (!IsBefore(band, last))
                {
                    var candidates = groups.Where(g => g.Value >= 0).ToList();
                    if (match.Kind == LabelKind.DebitTotal && candidates.Count > 0 && reading.TotalDebits is null)
                        reading.TotalDebits = new StatementAmount(candidates[0].Value, candidates[0].Decimals);
                    else if (match.Kind == LabelKind.CreditTotal && candidates.Count > 0 && reading.TotalCredits is null)
                        reading.TotalCredits = new StatementAmount(candidates[0].Value, candidates[0].Decimals);
                    else if (match.Kind == LabelKind.BothTotals)
                        AssignTotals(groups, columns, reading);
                    else
                        continue;
                    labelledTotals = true;
                    foreach (var w in groups.SelectMany(g => g.Words))
                        consumed.Add(w);
                }
            }
        }

        // Ligne de totaux sans libellé (BH) : premier groupe de montants après la dernière opération.
        if (reading.TotalDebits is null && reading.TotalCredits is null && last is not null)
        {
            var totalsBand = ordered.FirstOrDefault(b =>
                !IsBefore(b, last) && b != ordered.FirstOrDefault(x => x.Words.Contains(last)) &&
                FindLabels(b, profile.ClosingLabels).Count == 0 &&
                b.Words.All(w => ParseDate(w.Text, profile.StatementDateFormats) is null) &&
                AmountGroups(b.Words).Count(g => g.Box.Left >= columns.AmountZoneLeft && !g.Words.Any(consumed.Contains)) is 1 or 2);
            if (totalsBand is not null)
            {
                AssignTotals(AmountGroups(totalsBand.Words).Where(g => g.Box.Left >= columns.AmountZoneLeft).ToList(), columns, reading);
            }
        }

        reading.TotalsLabelled = labelledTotals;
        return reading;
    }

    private static void AssignTotals(IReadOnlyList<AmountGroup> groups, Columns columns, SummaryReading reading)
    {
        foreach (var group in groups)
        {
            var amount = new StatementAmount(Math.Abs(group.Value), group.Decimals);
            var isDebit = group.Value < 0 || (columns.Boundary is { } b && group.Box.CenterX < b);
            if (isDebit && reading.TotalDebits is null)
                reading.TotalDebits = amount;
            else if (!isDebit && reading.TotalCredits is null)
                reading.TotalCredits = amount;
        }
    }

    private static StatementAmount SignBalance(AmountGroup group, string normalizedBand, Columns columns)
    {
        if (group.Value < 0)
            return new StatementAmount(group.Value, group.Decimals, StatementSignSource.Column);
        if (normalizedBand.Contains("DEBITEUR", StringComparison.Ordinal))
            return new StatementAmount(-group.Value, group.Decimals, StatementSignSource.Keyword);
        if (normalizedBand.Contains("CREDITEUR", StringComparison.Ordinal))
            return new StatementAmount(group.Value, group.Decimals, StatementSignSource.Keyword);
        if (columns.Boundary is { } boundary && group.Box.Left >= columns.AmountZoneLeft)
        {
            return group.Box.CenterX < boundary
                ? new StatementAmount(-group.Value, group.Decimals, StatementSignSource.Column)
                : new StatementAmount(group.Value, group.Decimals, StatementSignSource.Column);
        }

        return new StatementAmount(group.Value, group.Decimals, StatementSignSource.Assumed);
    }

    private static AmountGroup? FindAmountBelow(IReadOnlyList<Band> ordered, int index, ISet<TextWord> consumed, IReadOnlyList<string> extraClosingLabels)
    {
        var origin = ordered[index];
        for (var j = index + 1; j < ordered.Count; j++)
        {
            var band = ordered[j];
            if (band.Page != origin.Page || origin.CenterY - band.CenterY > 30)
                break;
            if (FindLabels(band, extraClosingLabels).Count > 0)
                break;
            var group = AmountGroups(band.Words).FirstOrDefault(g => !g.Words.Any(consumed.Contains));
            if (group is not null)
                return group;
        }

        return null;
    }

    private static DateOnly? FindDateBelow(IReadOnlyList<Band> ordered, int index, BankStatementProfile profile)
    {
        var origin = ordered[index];
        for (var j = index + 1; j < ordered.Count; j++)
        {
            var band = ordered[j];
            if (band.Page != origin.Page || origin.CenterY - band.CenterY > 30)
                break;
            var date = band.Words.Select(w => ParseDate(w.Text, profile.StatementDateFormats)).FirstOrDefault(d => d is { Year: not null });
            if (date is { } d)
                return new DateOnly(d.Year!.Value, d.Month, d.Day);
        }

        return null;
    }

    private static List<LabelMatch> FindLabels(Band band, IReadOnlyList<string> extraClosingLabels)
    {
        var tokens = band.Words.Select(w => BankLabelNormalizer.Normalize(w.Text)).ToList();
        var matches = new List<LabelMatch>();
        var i = 0;
        while (i < tokens.Count)
        {
            var match = TryMatch(tokens, i, DebitTotalLabels, LabelKind.DebitTotal)
                        ?? TryMatch(tokens, i, CreditTotalLabels, LabelKind.CreditTotal)
                        ?? TryMatch(tokens, i, OpeningLabels, LabelKind.Opening)
                        ?? TryMatch(tokens, i, ClosingLabels.Concat(extraClosingLabels), LabelKind.Closing)
                        ?? TryMatch(tokens, i, PositionalBalanceLabels, LabelKind.Positional)
                        ?? TryMatchTotal(tokens, i);
            if (match is { } found)
            {
                matches.Add(new LabelMatch(found.Kind, band.Words[i].Box.Left, band.Words[i + found.Length - 1].Box.Right));
                i += found.Length;
            }
            else
            {
                i++;
            }
        }

        return matches;
    }

    private static (LabelKind Kind, int Length)? TryMatch(IReadOnlyList<string> tokens, int start, IEnumerable<string> labels, LabelKind kind)
    {
        foreach (var label in labels.OrderByDescending(l => l.Length))
        {
            var parts = label.Split(' ');
            if (start + parts.Length > tokens.Count)
                continue;
            var ok = true;
            for (var p = 0; p < parts.Length && ok; p++)
                ok = tokens[start + p] == parts[p];
            if (ok)
                return (kind, parts.Length);
        }

        return null;
    }

    /// <summary>« TOTAL » / « TOTAUX » seuls (pas « TOTAL DES REMISES », exclu par profil).</summary>
    private static (LabelKind Kind, int Length)? TryMatchTotal(IReadOnlyList<string> tokens, int start)
    {
        if (tokens[start] is not ("TOTAL" or "TOTAUX"))
            return null;
        var next = start + 1 < tokens.Count ? tokens[start + 1] : null;
        if (next is "DES" or "DE" or "D")
            return null;
        return (LabelKind.BothTotals, 1);
    }

    private static bool IsBefore(Band band, TextWord? anchor) =>
        anchor is not null && (band.Page < anchor.Page || (band.Page == anchor.Page && band.CenterY > anchor.Box.CenterY));

    // ── Montants ────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Regroupe les fragments d'un même montant (« 1 » « 657 » « 861.592 ») puis les lit.
    /// Grammaire : séparateur décimal = dernier « , » ou « . » suivi de 2 ou 3 chiffres ;
    /// milliers séparés par espace, ou par « . » quand la décimale est « , » (BIAT).
    /// </summary>
    private static List<AmountGroup> AmountGroups(IEnumerable<TextWord> words)
    {
        var groups = new List<AmountGroup>();
        foreach (var band in ClusterBands(words))
            groups.AddRange(AmountGroupsInBand(band));
        return groups;
    }

    private static List<AmountGroup> AmountGroupsInBand(IReadOnlyList<TextWord> ordered)
    {
        var groups = new List<AmountGroup>();
        var current = new List<TextWord>();

        void Flush()
        {
            if (current.Count == 0)
                return;
            var text = string.Join(' ', current.Select(w => w.Text));
            if (TryParseAmount(text, out var value, out var decimals))
            {
                groups.Add(new AmountGroup(value, decimals, Union(current), current.ToList()));
            }
            else
            {
                foreach (var single in current)
                {
                    if (TryParseAmount(single.Text, out var v, out var d))
                        groups.Add(new AmountGroup(v, d, single.Box, new List<TextWord> { single }));
                }
            }

            current.Clear();
        }

        foreach (var word in ordered)
        {
            if (!AmountFragmentRegex().IsMatch(word.Text))
            {
                Flush();
                continue;
            }

            if (current.Count > 0)
            {
                var previous = current[^1];
                var close = word.Box.Left - previous.Box.Right <= FragmentMaxGap;
                var previousIsIntegerGroup = LeadingGroupRegex().IsMatch(string.Join(' ', current.Select(w => w.Text)));
                var continuesGroups = ThousandsContinuationRegex().IsMatch(word.Text);
                if (!(close && previousIsIntegerGroup && continuesGroups))
                    Flush();
            }

            current.Add(word);
        }

        Flush();
        return groups;
    }

    public static bool TryParseAmount(string text, out decimal value, out int decimals)
    {
        value = 0;
        decimals = 0;
        var match = AmountRegex().Match(text.Trim());
        if (!match.Success)
            return false;

        var integer = match.Groups["int"].Value;
        var decimalSeparator = match.Groups["sep"].Value;
        var fraction = match.Groups["frac"].Value;

        // Milliers à point uniquement si la décimale est une virgule (« 17.837,479 »).
        if (integer.Contains('.') && decimalSeparator != ",")
            return false;
        if (integer.Contains(',') && decimalSeparator != ".")
            return false;

        var digits = integer.Replace(" ", string.Empty).Replace(".", string.Empty).Replace(",", string.Empty);
        if (!decimal.TryParse($"{digits}.{fraction}", NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value))
            return false;
        if (match.Groups["neg"].Success)
            value = -value;
        decimals = fraction.Length;
        return true;
    }

    // ── Dates ───────────────────────────────────────────────────────────────────────────────

    private readonly record struct DateParts(int Day, int Month, int? Year);

    private static DateParts? ParseDate(string text, IReadOnlyList<string> formats)
    {
        var token = text.Trim().TrimEnd(':', ',', ';');
        foreach (var format in formats)
        {
            var parts = format switch
            {
                "dd/MM/yyyy" => Match(DmySlash4Regex(), token, yearDigits: 4),
                "dd-MM-yyyy" => Match(DmyDash4Regex(), token, yearDigits: 4),
                "dd.MM.yyyy" => Match(DmyDot4Regex(), token, yearDigits: 4),
                "dd/MM/yy" => Match(DmySlash2Regex(), token, yearDigits: 2),
                "dd-MM-yy" => Match(DmyDash2Regex(), token, yearDigits: 2),
                "yyyy-MM-dd" => MatchIso(token),
                "dd-MM" => Match(DmDashRegex(), token, yearDigits: 0),
                "dd/MM" => Match(DmSlashRegex(), token, yearDigits: 0),
                "ddMMyyyy" => Match(CompactDmyRegex(), token, yearDigits: 4),
                _ => null
            };
            if (parts is not null)
                return parts;
        }

        return null;
    }

    private static DateParts? Match(Regex regex, string token, int yearDigits)
    {
        var m = regex.Match(token);
        if (!m.Success)
            return null;
        var day = int.Parse(m.Groups["d"].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture);
        int? year = yearDigits switch
        {
            4 => int.Parse(m.Groups["y"].Value, CultureInfo.InvariantCulture),
            2 => 2000 + int.Parse(m.Groups["y"].Value, CultureInfo.InvariantCulture),
            _ => null
        };
        return IsValid(day, month, year ?? 2000) ? new DateParts(day, month, year) : null;
    }

    private static DateParts? MatchIso(string token)
    {
        var m = IsoDateRegex().Match(token);
        if (!m.Success)
            return null;
        var year = int.Parse(m.Groups["y"].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(m.Groups["d"].Value, CultureInfo.InvariantCulture);
        return IsValid(day, month, year) ? new DateParts(day, month, year) : null;
    }

    private static bool IsValid(int day, int month, int year) =>
        year is >= 2000 and <= 2100 && month is >= 1 and <= 12 && day >= 1 && day <= DateTime.DaysInMonth(year, month);

    /// <summary>
    /// Date complète d'une opération. Sans année imprimée (BH « 05-06 »), l'année est celle qui
    /// place la date dans la période (± 45 jours) au plus près de la date valeur ; à défaut, au
    /// plus près de la fin de période. Jamais la date du jour.
    /// </summary>
    private static DateOnly? ResolveDate(DateParts parts, int? referenceYear, DateOnly? periodStart, DateOnly? periodEnd, DateParts? valueDate)
    {
        if (parts.Year is { } year)
            return IsValid(parts.Day, parts.Month, year) ? new DateOnly(year, parts.Month, parts.Day) : null;
        if (referenceYear is not { } reference)
            return null;

        DateOnly? valueAnchor = valueDate is { Year: { } vy } v && IsValid(v.Day, v.Month, vy) ? new DateOnly(vy, v.Month, v.Day) : null;
        var target = valueAnchor ?? periodEnd ?? new DateOnly(reference, 12, 31);
        var candidates = new[] { reference - 1, reference, reference + 1 }
            .Where(y => IsValid(parts.Day, parts.Month, y))
            .Select(y => new DateOnly(y, parts.Month, parts.Day))
            .Where(d => (periodStart is null || d >= periodStart.Value.AddDays(-45)) && (periodEnd is null || d <= periodEnd.Value.AddDays(45)))
            .ToList();
        if (candidates.Count == 0)
            return null;
        return candidates.MinBy(d => Math.Abs(d.DayNumber - target.DayNumber));
    }

    // ── Utilitaires ─────────────────────────────────────────────────────────────────────────

    private static Box Union(IReadOnlyList<TextWord> words) => new(
        words.Min(w => w.Box.Left), words.Max(w => w.Box.Right), words.Min(w => w.Box.Bottom), words.Max(w => w.Box.Top));

    private static string Snippet(string text) => text.Length <= 60 ? text : text[..60] + "…";

    private static ExtractedBankStatement Empty(List<StatementExtractionIssue> issues, int pageCount) => new()
    {
        Header = new ExtractedStatementHeader(),
        Lines = Array.Empty<ExtractedStatementLine>(),
        Issues = issues,
        ProfileId = BankStatementProfileRegistry.GenericProfileId,
        PageCount = pageCount
    };

    private sealed record Box(double Left, double Right, double Bottom, double Top)
    {
        public double CenterX => (Left + Right) / 2;
        public double CenterY => (Bottom + Top) / 2;
    }

    private sealed record TextWord(string Text, Box Box, int Page);

    private sealed record HRule(double Y, double Left, double Right);

    private sealed record PageData(int Number, double Width, double Height, IReadOnlyList<TextWord> Words, IReadOnlyList<HRule> Rules, bool HasTextLayer);

    private sealed record Band(int Page, double CenterY, IReadOnlyList<TextWord> Words)
    {
        public string Text => string.Join(' ', Words.Select(w => w.Text));
    }

    private sealed record PageHeader(double Bottom, Box Debit, Box Credit, Box? Value);

    /// <param name="AmountZoneLeft">Abscisse à partir de laquelle un nombre est un montant d'opération.</param>
    /// <param name="Boundary">Frontière Débit | Crédit (null = indéterminée).</param>
    /// <param name="AnchorRight">Bord droit de la colonne des dates d'opération.</param>
    private sealed record Columns(double AmountZoneLeft, double? Boundary, double AnchorRight);

    private sealed record AmountGroup(decimal Value, int Decimals, Box Box, IReadOnlyList<TextWord> Words);

    private sealed class RowCandidate(TextWord anchor)
    {
        public TextWord Anchor { get; } = anchor;
        public List<TextWord> Words { get; } = new();
        public double CellTop { get; set; }
        public double CellBottom { get; set; }
    }

    private enum LabelKind { Opening, Closing, Positional, BothTotals, DebitTotal, CreditTotal }

    private sealed record LabelMatch(LabelKind Kind, double Left, double Right);

    private sealed class SummaryReading
    {
        public StatementAmount? Opening { get; set; }
        public StatementAmount? Closing { get; set; }
        public DateOnly? OpeningDate { get; set; }
        public DateOnly? ClosingDate { get; set; }
        public StatementAmount? TotalDebits { get; set; }
        public StatementAmount? TotalCredits { get; set; }
        public bool TotalsLabelled { get; set; }
    }

    [GeneratedRegex(@"^(?<neg>-)?(?<int>\d{1,3}(?:[  ]\d{3})+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+|\d+)(?<sep>[.,])(?<frac>\d{2,3})$", RegexOptions.CultureInvariant)]
    private static partial Regex AmountRegex();

    [GeneratedRegex(@"^-?\d[\d.,]*$", RegexOptions.CultureInvariant)]
    private static partial Regex AmountFragmentRegex();

    [GeneratedRegex(@"^-?\d{1,3}(?: \d{3})*$", RegexOptions.CultureInvariant)]
    private static partial Regex LeadingGroupRegex();

    [GeneratedRegex(@"^\d{3}(?:[.,]\d{2,3})?$", RegexOptions.CultureInvariant)]
    private static partial Regex ThousandsContinuationRegex();

    [GeneratedRegex(@"^[A-Z]{3}$", RegexOptions.CultureInvariant)]
    private static partial Regex CurrencyCodeRegex();

    [GeneratedRegex(@"^(?<d>\d{2})/(?<m>\d{2})/(?<y>\d{4})$")] private static partial Regex DmySlash4Regex();
    [GeneratedRegex(@"^(?<d>\d{2})-(?<m>\d{2})-(?<y>\d{4})$")] private static partial Regex DmyDash4Regex();
    [GeneratedRegex(@"^(?<d>\d{2})\.(?<m>\d{2})\.(?<y>\d{4})$")] private static partial Regex DmyDot4Regex();
    [GeneratedRegex(@"^(?<d>\d{2})/(?<m>\d{2})/(?<y>\d{2})$")] private static partial Regex DmySlash2Regex();
    [GeneratedRegex(@"^(?<d>\d{2})-(?<m>\d{2})-(?<y>\d{2})$")] private static partial Regex DmyDash2Regex();
    [GeneratedRegex(@"^(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})$")] private static partial Regex IsoDateRegex();
    [GeneratedRegex(@"^(?<d>\d{2})-(?<m>\d{2})$")] private static partial Regex DmDashRegex();
    [GeneratedRegex(@"^(?<d>\d{2})/(?<m>\d{2})$")] private static partial Regex DmSlashRegex();
    [GeneratedRegex(@"^(?<d>\d{2})(?<m>\d{2})(?<y>\d{4})$")] private static partial Regex CompactDmyRegex();
    [GeneratedRegex(@"^\d{2}$")] private static partial Regex TwoDigitsRegex();
    [GeneratedRegex(@"^\d{4}$")] private static partial Regex FourDigitsRegex();
}
