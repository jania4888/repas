using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.OfficialForm;

/// <summary>
/// Cases du formulaire officiel visées par une rubrique.
/// </summary>
/// <param name="BaseKey">Case du montant brut, ou <c>null</c> si le millésime n'en a pas.</param>
/// <param name="AmountKey">Case de la retenue, ou <c>null</c>.</param>
/// <param name="RecapFamilyKey">Famille du récapitulatif (page 9) qui reçoit le montant.</param>
public sealed record OfficialFormTarget(string? BaseKey, string? AmountKey, string RecapFamilyKey);

/// <summary>
/// Traduit un couple (famille, code rapport) en cases du formulaire officiel.
/// </summary>
/// <remarks>
/// <para>
/// <b>Pourquoi la rubrique ne stocke pas la clé de case.</b> Les clés appartiennent au millésime,
/// pas au dossier : un nouveau formulaire se traite en remplaçant le triplet (gabarit, carte
/// géométrique, carte des codes rapport), sans toucher au C# ni aux données. Stocker des clés dans
/// N bases tenant inverserait cette propriété — une renumérotation de la DGI deviendrait une
/// migration de données dans chaque dossier.
/// </para>
/// <para>
/// Le code rapport, lui, est ce que le comptable lit sur le formulaire (« 1 », « 4.1 », « 17.2 ») :
/// il est stable, vérifiable à l'œil, et sa traduction vit ici.
/// </para>
/// </remarks>
public static class MonthlyDeclarationReportCodeMap
{
    /// <summary>Code rapport valant « quel que soit le code » : repli de famille.</summary>
    public const string FamilyFallbackCode = "*";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip
    };

    private static readonly ConcurrentDictionary<string, FormVersionMap> Cache = new(StringComparer.Ordinal);

    /// <summary>
    /// Résout les cases d'une rubrique, ou <c>null</c> si le code rapport n'est pas cartographié.
    /// </summary>
    /// <remarks>
    /// Rendre <c>null</c> n'est pas un échec : le montant reste porté par le scalaire de sa famille,
    /// donc par le récapitulatif. C'est le même contrat que la ventilation historique de la retenue
    /// à la source, qui laisse au total ce qu'elle ne sait pas ventiler.
    /// </remarks>
    public static OfficialFormTarget? Resolve(
        string formVersion, MonthlyDeclarationFamily family, string? reportCode)
    {
        var map = Load(formVersion);
        var code = (reportCode ?? string.Empty).Trim();

        if (code.Length > 0 && map.ByCode.TryGetValue((family, code), out var exact))
            return exact;

        return map.ByFamilyFallback.TryGetValue(family, out var fallback) ? fallback : null;
    }

    /// <summary>Toutes les clés de cases citées par un millésime — sert au contrôle croisé.</summary>
    public static IReadOnlyCollection<string> AllBoxKeys(string formVersion)
    {
        var map = Load(formVersion);
        return map.ByCode.Values
            .Concat(map.ByFamilyFallback.Values)
            .SelectMany(t => new[] { t.BaseKey, t.AmountKey })
            .Where(k => !string.IsNullOrEmpty(k))
            .Select(k => k!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    private static FormVersionMap Load(string formVersion) =>
        Cache.GetOrAdd(formVersion, static version =>
        {
            var assembly = typeof(MonthlyDeclarationReportCodeMap).Assembly;
            var suffix = $"{version}.report-codes.json";
            var name = assembly.GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith(suffix, StringComparison.Ordinal))
                ?? throw new InvalidOperationException(
                    $"Carte des codes rapport introuvable pour le millésime « {version} ».");

            using var stream = assembly.GetManifestResourceStream(name)
                ?? throw new InvalidOperationException($"Ressource embarquée illisible : {name}.");

            var dto = JsonSerializer.Deserialize<CatalogDto>(stream, JsonOptions)
                ?? throw new InvalidOperationException($"Carte des codes rapport vide : {name}.");

            var byCode = new Dictionary<(MonthlyDeclarationFamily, string), OfficialFormTarget>();
            var byFamily = new Dictionary<MonthlyDeclarationFamily, OfficialFormTarget>();

            foreach (var entry in dto.Targets)
            {
                if (!Enum.TryParse<MonthlyDeclarationFamily>(entry.Family, out var family))
                {
                    throw new InvalidOperationException(
                        $"Famille inconnue « {entry.Family} » dans {name}.");
                }

                var target = new OfficialFormTarget(entry.Base, entry.Amount, entry.Recap ?? string.Empty);
                var code = (entry.ReportCode ?? string.Empty).Trim();

                if (code == FamilyFallbackCode)
                {
                    byFamily[family] = target;
                    continue;
                }

                // Un doublon rendrait la case gagnante dépendante de l'ordre du fichier : refusé au
                // chargement, c'est-à-dire au premier test qui touche le tamponnage.
                if (!byCode.TryAdd((family, code), target))
                {
                    throw new InvalidOperationException(
                        $"Code rapport en doublon « {entry.Family}/{code} » dans {name}.");
                }
            }

            return new FormVersionMap(byCode, byFamily);
        });

    private sealed record FormVersionMap(
        IReadOnlyDictionary<(MonthlyDeclarationFamily Family, string Code), OfficialFormTarget> ByCode,
        IReadOnlyDictionary<MonthlyDeclarationFamily, OfficialFormTarget> ByFamilyFallback);

    private sealed class CatalogDto
    {
        public string FormVersion { get; set; } = string.Empty;
        public List<TargetDto> Targets { get; set; } = [];
    }

    private sealed class TargetDto
    {
        public string? Family { get; set; }
        public string? ReportCode { get; set; }
        public string? Base { get; set; }
        public string? Amount { get; set; }
        public string? Recap { get; set; }
    }
}
