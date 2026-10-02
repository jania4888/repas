using System.Reflection;
using System.Text.Json;
using FactuTrust.Application.Features.Accounting.BankStatementImport;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>Profil de mise en page d'un relevé (voir <c>Resources/Accounting/bank-statement-profiles.json</c>).</summary>
public sealed record BankStatementProfile
{
    public required string Id { get; init; }
    public string? BankName { get; init; }
    public IReadOnlyList<string> RibBankCodes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> TextMarkers { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> OperationDateFormats { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> ValueDateFormats { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> StatementDateFormats { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> ExcludedSummaryLabels { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Repli quand la frontière débit/crédit ne se déduit ni des en-têtes ni des filets ni de deux
    /// groupes de montants distincts : fraction de la largeur de page. Null = pas de repli (bloquant).
    /// </summary>
    public double? DebitCreditBoundaryRatio { get; init; }

    /// <summary>Dates imprimées en mots séparés (« 02 » « 01 » « 2026 ») à recoller en « 02/01/2026 » (BIAT).</summary>
    public bool MergeSplitDates { get; init; }

    /// <summary>Libellés de solde final propres à la banque (en plus des libellés communs).</summary>
    public IReadOnlyList<string> ClosingLabels { get; init; } = Array.Empty<string>();

    /// <summary>Le total crédit imprimé inclut le solde d'ouverture (BIAT).</summary>
    public bool CreditTotalIncludesOpening { get; init; }

    /// <summary>
    /// Libellés de solde d'ouverture propres à la banque, essayés AVANT les libellés de clôture
    /// (BIAT mensuel : « SOLDE AU » ouvre, « SOLDE » seul clôt).
    /// </summary>
    public IReadOnlyList<string> OpeningLabels { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Boîtes de mots reconstruites depuis l'avance des lettres (ligne de base) au lieu des
    /// rectangles de glyphes : PDF régénérés (pdf-lib…) dont la police déclare des métriques fausses,
    /// qui élargissent les mots (« 2,380 » de 17 pt mesuré sur 44 pt) et faussent colonnes et lignes.
    /// </summary>
    public bool UseAdvanceBoxes { get; init; }

    /// <summary>
    /// Montant d'un solde ou d'un total imprimé légèrement AU-DESSUS de son libellé (écart vertical
    /// maximal en points). 0 = sur la même ligne ou en dessous seulement (comportement historique).
    /// </summary>
    public double SummaryAmountAboveTolerance { get; init; }

    /// <summary>Période imprimée sur deux lignes (« Du : 01/08/2026 » puis « Au : 31/08/2026 »).</summary>
    public bool PeriodBoundsOnSeparateLines { get; init; }

    /// <summary>Dates d'opération cherchées seulement sous l'en-tête texte du tableau (s'il existe).</summary>
    public bool AnchorsBelowHeaderOnly { get; init; }
}

/// <summary>Charge les profils embarqués ; sélection par code banque du RIB puis par marqueurs textuels.</summary>
public sealed class BankStatementProfileRegistry
{
    public const string ResourceName = "FactuTrust.Infrastructure.Resources.Accounting.bank-statement-profiles.json";
    public const string GenericProfileId = "generic";

    private static readonly Lazy<BankStatementProfileRegistry> DefaultInstance = new(LoadEmbedded);

    private readonly IReadOnlyList<BankStatementProfile> _profiles;

    public BankStatementProfileRegistry(IReadOnlyList<BankStatementProfile> profiles)
    {
        _profiles = profiles;
        Generic = profiles.FirstOrDefault(p => p.Id == GenericProfileId)
                  ?? throw new InvalidOperationException("Profil de relevé « generic » absent.");
    }

    public static BankStatementProfileRegistry Default => DefaultInstance.Value;

    public BankStatementProfile Generic { get; }

    public IReadOnlyList<BankStatementProfile> Profiles => _profiles;

    /// <summary>
    /// Profil du code banque (RIB) en priorité, sinon d'après les marqueurs du texte, sinon générique.
    /// Une banque peut avoir plusieurs gabarits (BIAT : relevé « DINAR TUNISIEN » et relevé mensuel
    /// bilingue) : parmi les profils du code, celui dont un marqueur figure dans le document l'emporte ;
    /// à défaut, le premier déclaré pour ce code (comportement historique).
    /// </summary>
    public BankStatementProfile Resolve(string? ribBankCode, string normalizedDocumentText)
    {
        if (!string.IsNullOrEmpty(ribBankCode))
        {
            var byCode = _profiles.Where(p => p.RibBankCodes.Contains(ribBankCode, StringComparer.Ordinal)).ToList();
            if (byCode.Count > 0)
                return byCode.FirstOrDefault(p => HasMarker(p, normalizedDocumentText)) ?? byCode[0];
        }

        foreach (var profile in _profiles)
        {
            if (HasMarker(profile, normalizedDocumentText))
                return profile;
        }

        return Generic;
    }

    private static bool HasMarker(BankStatementProfile profile, string normalizedDocumentText) =>
        profile.TextMarkers.Any(m => normalizedDocumentText.Contains(BankLabelNormalizer.Normalize(m), StringComparison.Ordinal));

    private static BankStatementProfileRegistry LoadEmbedded()
    {
        var assembly = typeof(BankStatementProfileRegistry).Assembly;
        using var stream = assembly.GetManifestResourceStream(ResourceName)
                           ?? throw new InvalidOperationException($"Ressource embarquée introuvable : {ResourceName}");
        var document = JsonSerializer.Deserialize<ProfilesDocument>(stream, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip
        }) ?? throw new InvalidOperationException("Profils de relevé illisibles.");

        var generic = document.Profiles.FirstOrDefault(p => p.Id == GenericProfileId)
                      ?? throw new InvalidOperationException("Profil de relevé « generic » absent.");

        // Un profil qui ne précise pas un champ hérite du profil générique.
        var merged = document.Profiles
            .Select(p => p.Id == GenericProfileId ? p.ToProfile(null) : p.ToProfile(generic))
            .ToList();
        return new BankStatementProfileRegistry(merged);
    }

    private sealed class ProfilesDocument
    {
        public int Version { get; set; }
        public List<ProfileDto> Profiles { get; set; } = new();
    }

    private sealed class ProfileDto
    {
        public string Id { get; set; } = string.Empty;
        public string? BankName { get; set; }
        public List<string>? RibBankCodes { get; set; }
        public List<string>? TextMarkers { get; set; }
        public List<string>? OperationDateFormats { get; set; }
        public List<string>? ValueDateFormats { get; set; }
        public List<string>? StatementDateFormats { get; set; }
        public List<string>? ExcludedSummaryLabels { get; set; }
        public double? DebitCreditBoundaryRatio { get; set; }
        public bool MergeSplitDates { get; set; }
        public List<string>? ClosingLabels { get; set; }
        public bool CreditTotalIncludesOpening { get; set; }
        public List<string>? OpeningLabels { get; set; }
        public bool UseAdvanceBoxes { get; set; }
        public double SummaryAmountAboveTolerance { get; set; }
        public bool PeriodBoundsOnSeparateLines { get; set; }
        public bool AnchorsBelowHeaderOnly { get; set; }

        public BankStatementProfile ToProfile(ProfileDto? fallback) => new()
        {
            Id = Id,
            BankName = BankName,
            RibBankCodes = RibBankCodes ?? new List<string>(),
            TextMarkers = TextMarkers ?? new List<string>(),
            OperationDateFormats = Pick(OperationDateFormats, fallback?.OperationDateFormats),
            ValueDateFormats = Pick(ValueDateFormats, fallback?.ValueDateFormats),
            StatementDateFormats = Pick(StatementDateFormats, fallback?.StatementDateFormats),
            ExcludedSummaryLabels = (ExcludedSummaryLabels ?? new List<string>())
                .Concat(fallback?.ExcludedSummaryLabels ?? new List<string>())
                .Select(BankLabelNormalizer.Normalize)
                .Distinct(StringComparer.Ordinal)
                .ToList(),
            DebitCreditBoundaryRatio = DebitCreditBoundaryRatio,
            MergeSplitDates = MergeSplitDates,
            ClosingLabels = (ClosingLabels ?? new List<string>()).Select(BankLabelNormalizer.Normalize).ToList(),
            CreditTotalIncludesOpening = CreditTotalIncludesOpening,
            OpeningLabels = (OpeningLabels ?? new List<string>()).Select(BankLabelNormalizer.Normalize).ToList(),
            UseAdvanceBoxes = UseAdvanceBoxes,
            SummaryAmountAboveTolerance = Math.Clamp(SummaryAmountAboveTolerance, 0, 12),
            PeriodBoundsOnSeparateLines = PeriodBoundsOnSeparateLines,
            AnchorsBelowHeaderOnly = AnchorsBelowHeaderOnly
        };

        private static IReadOnlyList<string> Pick(List<string>? own, List<string>? fallback) =>
            own is { Count: > 0 } ? own : fallback ?? new List<string>();
    }
}
