using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using FactuTrust.Application.Localization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Localization;

public sealed class MessageLocalizer : IMessageLocalizer
{
    private static readonly TimeSpan RegexTimeout = TimeSpan.FromMilliseconds(50);

    private readonly IReadOnlyDictionary<string, string> _arByFr;
    private readonly IReadOnlyList<TemplateRule> _templateRules;
    private readonly IReadOnlyDictionary<string, IReadOnlyList<TemplateRule>> _prefixIndex;
    private readonly bool _enabled;
    private readonly ILogger<MessageLocalizer> _logger;

    public MessageLocalizer(IConfiguration configuration, IHostEnvironment env, ILogger<MessageLocalizer> logger)
    {
        _enabled = configuration.GetValue("Localization:ArabicMessagesEnabled", false);
        _logger = logger;
        _arByFr = LoadCatalog(env);
        (_templateRules, _prefixIndex) = BuildTemplateIndex(_arByFr);
    }

    public string Localize(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return message ?? string.Empty;
        }

        if (!_enabled || !string.Equals(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName, "ar", StringComparison.OrdinalIgnoreCase))
        {
            return message;
        }

        if (_arByFr.TryGetValue(message, out var exact) && !string.IsNullOrWhiteSpace(exact))
        {
            return exact;
        }

        var localized = TryTemplateMatch(message);
        if (localized is not null)
        {
            return localized;
        }

        _logger.LogDebug("Message AR manquant (len={Length})", message.Length);
        return message;
    }

    private string? TryTemplateMatch(string message)
    {
        var prefix = message.Length >= 12 ? message[..12] : message;
        if (_prefixIndex.TryGetValue(prefix, out var bucket))
        {
            foreach (var rule in bucket)
            {
                var match = rule.TryMatch(message);
                if (match is not null)
                {
                    return match;
                }
            }
        }

        foreach (var rule in _templateRules)
        {
            var match = rule.TryMatch(message);
            if (match is not null)
            {
                return match;
            }
        }

        return null;
    }

    private static (IReadOnlyList<TemplateRule> rules, IReadOnlyDictionary<string, IReadOnlyList<TemplateRule>> prefixIndex)
        BuildTemplateIndex(IReadOnlyDictionary<string, string> arByFr)
    {
        var rules = new List<TemplateRule>();
        var prefixBuckets = new Dictionary<string, List<TemplateRule>>(StringComparer.Ordinal);

        foreach (var (fr, ar) in arByFr)
        {
            if (!fr.Contains('{', StringComparison.Ordinal))
            {
                continue;
            }

            var rule = TemplateRule.TryCreate(fr, ar);
            if (rule is null)
            {
                continue;
            }

            rules.Add(rule);
            var prefix = fr.Length >= 12 ? fr[..12] : fr;
            if (!prefixBuckets.TryGetValue(prefix, out var list))
            {
                list = [];
                prefixBuckets[prefix] = list;
            }

            list.Add(rule);
        }

        // Le gabarit le plus spécifique (le plus de texte littéral) gagne : un gabarit générique
        // (« … : {0} {1} maximum ») ne doit jamais masquer un gabarit précis qui traduit aussi le libellé.
        var frozenBuckets = prefixBuckets.ToDictionary(
            kv => kv.Key,
            kv => (IReadOnlyList<TemplateRule>)kv.Value.OrderByDescending(r => r.LiteralLength).ToList(),
            StringComparer.Ordinal);

        return (rules.OrderByDescending(r => r.LiteralLength).ToList(), frozenBuckets);
    }

    private static IReadOnlyDictionary<string, string> LoadCatalog(IHostEnvironment env)
    {
        var path = Path.Combine(env.ContentRootPath, "Localization", "messages.ar.json");
        if (!File.Exists(path))
        {
            return new Dictionary<string, string>();
        }

        try
        {
            using var stream = File.OpenRead(path);
            var doc = JsonDocument.Parse(stream);
            if (doc.RootElement.TryGetProperty("translations", out var translations))
            {
                var dict = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var prop in translations.EnumerateObject())
                {
                    if (prop.Value.ValueKind == JsonValueKind.String)
                    {
                        dict[prop.Name] = prop.Value.GetString() ?? string.Empty;
                    }
                }

                return dict;
            }
        }
        catch
        {
            /* repli FR */
        }

        return new Dictionary<string, string>();
    }

    private sealed class TemplateRule
    {
        private readonly string _arTemplate;
        private readonly Regex _pattern;

        private TemplateRule(string arTemplate, Regex pattern, int literalLength)
        {
            _arTemplate = arTemplate;
            _pattern = pattern;
            LiteralLength = literalLength;
        }

        /// <summary>Longueur du texte français hors placeholders : mesure de spécificité du gabarit.</summary>
        public int LiteralLength { get; }

        public static TemplateRule? TryCreate(string french, string arabic)
        {
            if (!Regex.IsMatch(french, @"\{\d+\}"))
            {
                return null;
            }

            var pattern = BuildPattern(french);
            if (pattern is null)
            {
                return null;
            }

            return new TemplateRule(arabic, pattern, Regex.Replace(french, @"\{\d+\}", string.Empty).Length);
        }

        public string? TryMatch(string message)
        {
            try
            {
                var match = _pattern.Match(message);
                if (!match.Success)
                {
                    return null;
                }

                var result = _arTemplate;
                foreach (var group in match.Groups.Values)
                {
                    if (group.Name.Length > 1
                        && group.Name.StartsWith("p", StringComparison.Ordinal)
                        && int.TryParse(group.Name.AsSpan(1), out var index))
                    {
                        result = result.Replace($"{{{index}}}", group.Value, StringComparison.Ordinal);
                    }
                }

                return result;
            }
            catch (RegexMatchTimeoutException)
            {
                return null;
            }
        }

        private static Regex? BuildPattern(string french)
        {
            var parts = Regex.Split(french, @"(\{\d+\})");
            var sb = new System.Text.StringBuilder();
            sb.Append('^');
            var groupIndex = 0;

            foreach (var part in parts)
            {
                if (string.IsNullOrEmpty(part))
                {
                    continue;
                }

                if (part.StartsWith("{", StringComparison.Ordinal) && part.EndsWith("}", StringComparison.Ordinal))
                {
                    sb.Append($"(?<p{groupIndex}>.+)");
                    groupIndex++;
                }
                else
                {
                    sb.Append(Regex.Escape(part));
                }
            }

            sb.Append('$');

            try
            {
                return new Regex(
                    sb.ToString(),
                    RegexOptions.CultureInvariant | RegexOptions.NonBacktracking,
                    RegexTimeout);
            }
            catch (ArgumentException)
            {
                return null;
            }
        }
    }
}
