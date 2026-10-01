using System.Text.Json;
using FactuTrust.Application.Features.Accounting.BankStatementImport;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

public enum BankOperationParty
{
    None = 0,
    Client = 1,
    Supplier = 2,
    Employee = 3
}

/// <summary>Règle du catalogue tunisien des opérations bancaires (voir <c>tn-bank-operations-catalog.json</c>).</summary>
public sealed record BankOperationRule
{
    public required string Id { get; init; }

    /// <summary>« debit », « credit » ou « any ».</summary>
    public string Side { get; init; } = "any";

    public IReadOnlyList<string> StartsWith { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Contains { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> ExactMatches { get; init; } = Array.Empty<string>();

    /// <summary>Compte de contrepartie (racine NCT 01) ; null = à préciser par l'utilisateur.</summary>
    public string? Account { get; init; }

    /// <summary>Compte de TVA déductible pour la ventilation d'une commission TVA comprise.</summary>
    public string? VatAccount { get; init; }

    /// <summary>Taux de TVA réputé inclus (commission « COM ET TVA » sans « DONT TVA » imprimé).</summary>
    public decimal? ImpliedVatRate { get; init; }

    public BankOperationParty Party { get; init; }

    /// <summary>« probable » ou « toCheck ».</summary>
    public string Confidence { get; init; } = "toCheck";

    public string Explanation { get; init; } = string.Empty;

    public bool Matches(string normalizedLabel, bool isDebit)
    {
        if (Side == "debit" && !isDebit)
            return false;
        if (Side == "credit" && isDebit)
            return false;

        return ExactMatches.Any(e => normalizedLabel == e)
               || StartsWith.Any(s => normalizedLabel.StartsWith(s, StringComparison.Ordinal))
               || Contains.Any(c => normalizedLabel.Contains(c, StringComparison.Ordinal));
    }
}

/// <summary>Catalogue embarqué, chargé une fois ; la première règle qui correspond l'emporte.</summary>
public sealed class TunisianBankOperationCatalog
{
    public const string ResourceName = "FactuTrust.Infrastructure.Resources.Accounting.tn-bank-operations-catalog.json";

    private static readonly Lazy<TunisianBankOperationCatalog> DefaultInstance = new(Load);

    public TunisianBankOperationCatalog(IReadOnlyList<BankOperationRule> rules) => Rules = rules;

    public static TunisianBankOperationCatalog Default => DefaultInstance.Value;

    public IReadOnlyList<BankOperationRule> Rules { get; }

    public BankOperationRule? Match(string label, bool isDebit)
    {
        var normalized = BankLabelNormalizer.Normalize(label);
        return Rules.FirstOrDefault(r => r.Matches(normalized, isDebit));
    }

    private static TunisianBankOperationCatalog Load()
    {
        using var stream = typeof(TunisianBankOperationCatalog).Assembly.GetManifestResourceStream(ResourceName)
                           ?? throw new InvalidOperationException($"Ressource embarquée introuvable : {ResourceName}");
        using var document = JsonDocument.Parse(stream);
        var rules = new List<BankOperationRule>();
        foreach (var rule in document.RootElement.GetProperty("rules").EnumerateArray())
        {
            rules.Add(new BankOperationRule
            {
                Id = rule.GetProperty("id").GetString()!,
                Side = Str(rule, "side") ?? "any",
                StartsWith = List(rule, "startsWith"),
                Contains = List(rule, "contains"),
                ExactMatches = List(rule, "equals"),
                Account = Str(rule, "account"),
                VatAccount = Str(rule, "vatAccount"),
                ImpliedVatRate = rule.TryGetProperty("impliedVatRate", out var rate) && rate.ValueKind == JsonValueKind.Number ? rate.GetDecimal() : null,
                Party = (Str(rule, "party") ?? "none") switch
                {
                    "client" => BankOperationParty.Client,
                    "supplier" => BankOperationParty.Supplier,
                    "employee" => BankOperationParty.Employee,
                    _ => BankOperationParty.None
                },
                Confidence = Str(rule, "confidence") ?? "toCheck",
                Explanation = Str(rule, "explanation") ?? string.Empty
            });
        }

        return new TunisianBankOperationCatalog(rules);
    }

    private static string? Str(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static IReadOnlyList<string> List(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray().Select(v => BankLabelNormalizer.Normalize(v.GetString())).Where(v => v.Length > 0).ToList()
            : Array.Empty<string>();
}

/// <summary>
/// Nom du tiers dans un libellé bancaire : la plus longue suite de mots alphabétiques qui ne sont
/// pas des mots techniques du relevé (« VIR », « EMIS », « TN », « BQ », « EFFET », « N° »…).
/// « REGLEMENT EFFET N°010860000002 SOCIETE BETAMEC » ⇒ « SOCIETE BETAMEC » ;
/// « VIR IBQ A DISTANCE VIR EMIS TN AUT BQ 004242 BEN FOULEN EP BEN FALTEN SALMA SALAIRE » ⇒
/// « BEN FOULEN EP BEN FALTEN SALMA ».
/// </summary>
public static class BankLabelPartyExtractor
{
    private static readonly HashSet<string> StopWords = new(StringComparer.Ordinal)
    {
        "VIREMENT", "VIREMENTS", "VIR", "RECU", "RECUS", "EMIS", "TN", "AUT", "AUTRE", "BQ", "BANQUE", "IBQ", "A", "DISTANCE",
        "MEME", "EN", "DINARS", "DINAR", "DE", "DU", "DES", "LA", "LE", "LES", "SUR", "L", "D", "ETRANGER",
        "REGLEMENT", "REG", "PAIEMENT", "EFFET", "EFF", "N", "N°", "NO", "ENCAISSEMENT", "CHEQUE", "CHQ", "REMISE",
        "PRELEVEMENT", "PRLV", "COMPENSE", "ECHEANCE", "ORG", "SALAIRE", "LOYER", "PAIE", "PAIEMENTPRINCIPAL",
        "VERSEMENT", "ESPECE", "ESPECES", "DEP", "AG", "TPE", "REM", "COMMISSION", "COM", "TVA", "DONT",
        "DELIVRANCE", "BON", "PAYER", "CERTIF", "CLIENTELE", "RECEVEUR", "RES", "PECC", "MM", "PP", "CDT", "HA"
    };

    public static string? Extract(string? label)
    {
        var normalized = BankLabelNormalizer.Normalize(label);
        if (normalized.Length == 0)
            return null;

        var best = new List<string>();
        var current = new List<string>();
        foreach (var token in normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var word = token.Trim(',', '.', ';', ':', '-', '"', '\'', '(', ')', '/');
            var isName = word.Length > 0 && word.All(c => char.IsLetter(c) || c == '\'' || c == '&') && !StopWords.Contains(word);
            if (isName)
            {
                current.Add(word);
                continue;
            }

            if (current.Count > best.Count)
                best = current;
            current = new List<string>();
        }

        if (current.Count > best.Count)
            best = current;

        // Un mot isolé de moins de 3 lettres n'est pas un nom (« S », « EP »…).
        var name = string.Join(' ', best);
        return best.Count == 0 || (best.Count == 1 && name.Length < 3) ? null : name;
    }
}
