using System.Globalization;
using System.Text;
using System.Text.Json;
using CsvHelper;
using CsvHelper.Configuration;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Migration;

/// <summary>
/// Migration assistée par IA (N1) — orchestration des 4 moteurs :
/// M0 fingerprint (déterministe), M1 mapping de colonnes (synonymes → catalogue → LLM borné),
/// M2 mapping comptable (identité → préfixe → LLM restreint au plan local), M3 doublons de tiers.
/// <para>
/// RÈGLES STRUCTURANTES — ne jamais déroger :
/// 1. Aucune écriture en base : ce service produit des SUGGESTIONS consommées ensuite par
///    <see cref="ReferenceDataImportService"/> / <c>JournalImportService</c>, inchangés.
/// 2. Le LLM choisit dans des ensembles FERMÉS (colonnes canoniques, comptes du plan local) ;
///    toute sortie hors ensemble est rejetée programmatiquement après parsing.
/// 3. Abstention par défaut : en dessous du seuil ou en cas d'indisponibilité du modèle, la
///    colonne/le compte reste non mappé et l'utilisateur tranche — jamais de classification forcée.
/// 4. Aucune donnée sensible ne part au modèle : en-têtes, numéros et libellés de comptes
///    uniquement ; jamais de soldes, jamais de tiers.
/// </para>
/// </summary>
public sealed class MigrationAssistantService : IMigrationAssistantService
{
    private const string ErrorCode = "MigrationAssistant";

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly IAiStructuredExtractionPipeline _pipeline;
    private readonly MigrationAiSettings _settings;
    private readonly ILogger<MigrationAssistantService> _logger;

    public MigrationAssistantService(
        ITenantDbContextFactory contextFactory,
        IAiStructuredExtractionPipeline pipeline,
        IOptions<MigrationAiSettings> settings,
        ILogger<MigrationAssistantService> logger)
    {
        _contextFactory = contextFactory;
        _pipeline = pipeline;
        _settings = settings.Value;
        _logger = logger;
    }

    // ── M0 : analyse / fingerprint ──────────────────────────────────────────

    public Task<Result<MigrationAnalysisDto>> AnalyzeAsync(
        string fileName, byte[] content, CancellationToken cancellationToken)
    {
        if (content is not { Length: > 0 })
            return Task.FromResult(Result.Failure<MigrationAnalysisDto>(
                Error.Validation(ErrorCode, "Fichier vide ou absent.")));

        var format = MigrationFileInspector.DetectFormat(fileName);
        var shape = MigrationFileInspector.Inspect(content, format);
        if (shape is null || shape.Headers.Count == 0)
        {
            return Task.FromResult(Result.Failure<MigrationAnalysisDto>(
                Error.Validation(ErrorCode, "Fichier illisible ou sans en-tête. Vérifiez le format (CSV, Excel).")));
        }

        var fp = SourceFormatFingerprinter.Fingerprint(shape);
        var dto = new MigrationAnalysisDto
        {
            FileName = fileName,
            DetectedSource = fp.System,
            Confidence = fp.Confidence,
            Format = format,
            Delimiter = shape.Delimiter,
            SuggestedTarget = fp.Target,
            TargetConfidence = fp.TargetConfidence,
            Headers = shape.Headers,
            SampleRowCount = shape.DataRowCount,
            KnownFormatMatched = fp.KnownFormatMatched,
            Warnings = fp.Warnings
        };
        return Task.FromResult(Result.Success(dto));
    }

    // ── M1 : mapping de colonnes assisté ────────────────────────────────────

    public async Task<Result<ColumnMappingSuggestionDto>> SuggestColumnMappingAsync(
        byte[] content, JournalImportFormat format, ReferenceImportTarget target,
        CancellationToken cancellationToken)
    {
        var shape = MigrationFileInspector.Inspect(content, format);
        if (shape is null || shape.Headers.Count == 0)
            return Result.Failure<ColumnMappingSuggestionDto>(
                Error.Validation(ErrorCode, "Fichier illisible ou sans en-tête."));

        var (synonyms, required, _) = ReferenceDataImportService.Schema(target);
        var canonicalOrder = synonyms.Keys.ToList();
        var warnings = new List<string>();

        // Signature catalogue correspondant au fichier ET à la cible demandée.
        var fp = SourceFormatFingerprinter.Fingerprint(shape);
        var catalogSignature = fp.KnownFormatMatched && fp.Signature is not null && fp.Signature.Target == target
            ? fp.Signature
            : null;

        var items = new List<ColumnMappingSuggestionItemDto>();
        var unmapped = new List<string>();

        foreach (var header in shape.Headers.Where(h => !string.IsNullOrWhiteSpace(h)))
        {
            var normalized = TabularFileParsing.Normalize(header);

            // Étage 1 : synonymes historiques du pipeline d'import (comportement strictement existant).
            var canonical = canonicalOrder.FirstOrDefault(c => synonyms[c].Contains(normalized));
            if (canonical is not null)
            {
                items.Add(new ColumnMappingSuggestionItemDto
                {
                    SourceColumn = header, CanonicalColumn = canonical,
                    Confidence = 1.0, Origin = MigrationSuggestionOrigin.Synonyme
                });
                continue;
            }

            // Étage 2 : synonymes du format reconnu par le catalogue.
            canonical = catalogSignature?.Synonyms
                .FirstOrDefault(kv => kv.Value.Contains(normalized)).Key;
            if (canonical is not null)
            {
                items.Add(new ColumnMappingSuggestionItemDto
                {
                    SourceColumn = header, CanonicalColumn = canonical,
                    Confidence = 0.95, Origin = MigrationSuggestionOrigin.Catalogue
                });
                continue;
            }

            unmapped.Add(header);
        }

        // Étage 3 : LLM borné sur les colonnes restantes — ensemble fermé = colonnes canoniques.
        if (unmapped.Count > 0)
        {
            var llmItems = await TrySuggestColumnsWithModelAsync(unmapped, canonicalOrder, required, cancellationToken);
            items.AddRange(llmItems.Items);
            warnings.AddRange(llmItems.Warnings);
        }

        // Unicité d'affectation : une colonne canonique n'est couverte qu'une fois (meilleure confiance).
        items = EnforceUniqueTargets(items, warnings);

        var complete = required.All(r => items.Any(i => i.CanonicalColumn == r));
        if (!complete)
        {
            var missing = required.Where(r => items.All(i => i.CanonicalColumn != r));
            warnings.Add($"Colonne(s) obligatoire(s) non couverte(s) : {string.Join(", ", missing)} — à mapper manuellement.");
        }

        return Result.Success(new ColumnMappingSuggestionDto
        {
            Target = target,
            RequiredCanonical = required,
            Items = items,
            Complete = complete,
            Warnings = warnings
        });
    }

    private static List<ColumnMappingSuggestionItemDto> EnforceUniqueTargets(
        List<ColumnMappingSuggestionItemDto> items, List<string> warnings)
    {
        var result = new List<ColumnMappingSuggestionItemDto>();
        foreach (var group in items.Where(i => i.CanonicalColumn is not null).GroupBy(i => i.CanonicalColumn!))
        {
            var ordered = group
                .OrderByDescending(i => i.Confidence)
                .ThenBy(i => i.Origin == MigrationSuggestionOrigin.Ia ? 1 : 0)
                .ToList();
            result.Add(ordered[0]);
            foreach (var extra in ordered.Skip(1))
            {
                warnings.Add($"Colonne « {extra.SourceColumn} » : « {group.Key} » déjà couverte par « {ordered[0].SourceColumn} » — laissée non mappée.");
                result.Add(extra with { CanonicalColumn = null, Confidence = 0 });
            }
        }

        // Réinjecter les non-mappées (jamais en conflit).
        result.AddRange(items.Where(i => i.CanonicalColumn is null && result.All(r => r.SourceColumn != i.SourceColumn)));
        return result;
    }

    private async Task<(List<ColumnMappingSuggestionItemDto> Items, List<string> Warnings)> TrySuggestColumnsWithModelAsync(
        IReadOnlyList<string> unmappedHeaders, IReadOnlyList<string> canonicalOrder, string[] required,
        CancellationToken ct)
    {
        var warnings = new List<string>();
        var items = new List<ColumnMappingSuggestionItemDto>();
        try
        {
            var payload = new StringBuilder()
                .AppendLine("COLONNES SOURCE À MAPPER (une par ligne) :")
                .AppendLine(string.Join(Environment.NewLine, unmappedHeaders))
                .AppendLine()
                .AppendLine("COLONNES CIBLES AUTORISÉES (schéma canonique, ensemble fermé) :")
                .AppendLine(string.Join(Environment.NewLine,
                    canonicalOrder.Select(c => $"- {c}{(required.Contains(c) ? " (obligatoire)" : " (optionnelle)")}")))
                .ToString();

            var raw = await CallModelAsync(payload.ToString(), ColumnMappingSystemPrompt, ct);
            if (raw is null)
            {
                warnings.Add("Suggestions IA indisponibles pour les colonnes restantes — mapping manuel possible.");
                return (items, warnings);
            }

            var parsed = TryParse<LlmColumnMappings>(raw);
            if (parsed?.Mappings is null)
            {
                warnings.Add("Réponse IA inexploitable pour le mapping de colonnes — mapping manuel possible.");
                return (items, warnings);
            }

            var canonicalSet = canonicalOrder.ToHashSet(StringComparer.Ordinal);
            var sourceSet = unmappedHeaders.ToHashSet(StringComparer.Ordinal);
            var covered = new HashSet<string>(StringComparer.Ordinal);
            foreach (var m in parsed.Mappings)
            {
                var sourceName = m.Source?.Trim();
                if (string.IsNullOrWhiteSpace(sourceName) || !sourceSet.Contains(sourceName))
                    continue; // hallucination de colonne source : ignorée
                string? target = null;
                var confidence = Clamp01(m.Confidence);
                if (!string.IsNullOrWhiteSpace(m.Target))
                {
                    var normalizedTarget = TabularFileParsing.Normalize(m.Target);
                    if (canonicalSet.Contains(normalizedTarget) && covered.Add(normalizedTarget))
                        target = normalizedTarget;
                    // cible hors ensemble fermé ou déjà couverte : rejetée (abstention)
                }

                items.Add(new ColumnMappingSuggestionItemDto
                {
                    SourceColumn = sourceName, CanonicalColumn = target,
                    Confidence = target is null ? 0 : confidence,
                    Origin = MigrationSuggestionOrigin.Ia
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[MigrationAssistant] Échec du mapping de colonnes par le modèle.");
            warnings.Add("Suggestions IA indisponibles — mapping manuel possible.");
        }

        return (items, warnings);
    }

    // ── M2 : mapping comptable source → plan local ──────────────────────────

    public async Task<Result<AccountMappingSuggestionDto>> SuggestAccountMappingAsync(
        byte[] content, JournalImportFormat format,
        IReadOnlyDictionary<string, string>? manualColumnMapping,
        CancellationToken cancellationToken)
    {
        // Synonymes effectifs : schéma canonique du plan comptable + mapping de colonnes validé
        // par l'utilisateur (en-tête source → canonique). La lecture réutilise TabularRowReader,
        // le lecteur du pipeline d'import existant.
        var (synonyms, _, expected) = ReferenceDataImportService.Schema(ReferenceImportTarget.ChartOfAccounts);
        var effectiveSynonyms = synonyms.ToDictionary(kv => kv.Key, kv => kv.Value.ToList());
        if (manualColumnMapping is not null)
        {
            foreach (var (sourceHeader, canonical) in manualColumnMapping)
            {
                if (!effectiveSynonyms.TryGetValue(canonical, out var list)) continue;
                var normalized = TabularFileParsing.Normalize(sourceHeader);
                if (normalized.Length > 0 && !list.Contains(normalized)) list.Add(normalized);
            }
        }

        var (rows, readIssues) = TabularRowReader.Read(
            content, format,
            effectiveSynonyms.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray()),
            new[] { "compte" }, expected);
        var blocking = readIssues.FirstOrDefault(i => i.IsBlocking);
        if (blocking is not null)
            return Result.Failure<AccountMappingSuggestionDto>(
                Error.Validation(ErrorCode, $"Lecture impossible : {blocking.Message}"));

        // Comptes source distincts, ordre de première apparition, premier libellé non vide.
        var sources = new List<(string Account, string? Label)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            var account = row.GetValueOrDefault("compte", string.Empty).Trim();
            if (account.Length == 0 || !seen.Add(account)) continue;
            var label = row.GetValueOrDefault("libelle", string.Empty).Trim();
            sources.Add((account, label.Length == 0 ? null : label));
        }

        if (sources.Count == 0)
            return Result.Failure<AccountMappingSuggestionDto>(
                Error.Validation(ErrorCode, "Aucun compte exploitable dans le fichier."));

        await using var ctx = _contextFactory.CreateContext();
        var localAccounts = await ctx.ChartOfAccounts.AsNoTracking()
            .Select(c => new LocalAccountRef(c.AccountNumber, c.Label))
            .ToListAsync(cancellationToken);
        var localSet = localAccounts.Select(a => a.AccountNumber).ToHashSet(StringComparer.Ordinal);

        var warnings = new List<string>();
        var items = new List<AccountMappingSuggestionItemDto>();
        var unresolved = new List<(string Account, string? Label)>();
        var resolvedWithoutModel = 0;

        foreach (var (account, label) in sources)
        {
            // Étage 1 : identité — le compte existe déjà dans le plan local (NCT déjà utilisé).
            if (localSet.Contains(account))
            {
                resolvedWithoutModel++;
                items.Add(new AccountMappingSuggestionItemDto
                {
                    SourceAccount = account, SourceLabel = label, TargetAccount = account,
                    Confidence = 1.0, Origin = MigrationSuggestionOrigin.Identite,
                    Justification = "Compte identique présent dans le plan local."
                });
                continue;
            }

            // Étage 2 : préfixe de codification (613200 → 6132), même classe, au moins 2 chiffres.
            var prefix = localAccounts
                .Where(l => account.StartsWith(l.AccountNumber, StringComparison.Ordinal)
                            && l.AccountNumber.Length >= 2
                            && l.AccountNumber.Length < account.Length
                            && l.AccountNumber[0] == account[0])
                .OrderByDescending(l => l.AccountNumber.Length)
                .FirstOrDefault();
            if (prefix is not null)
            {
                resolvedWithoutModel++;
                var confidence = 0.55 + 0.25 * ((double)prefix.AccountNumber.Length / account.Length);
                items.Add(new AccountMappingSuggestionItemDto
                {
                    SourceAccount = account, SourceLabel = label, TargetAccount = prefix.AccountNumber,
                    Confidence = Math.Round(confidence, 2), Origin = MigrationSuggestionOrigin.Prefixe,
                    Justification = $"Rattachement par préfixe de codification ({prefix.AccountNumber} — {prefix.Label})."
                });
                continue;
            }

            unresolved.Add((account, label));
        }

        // Étage 3 : LLM restreint à la liste FERMÉE des comptes locaux.
        if (unresolved.Count > 0)
        {
            var llmResult = await TrySuggestAccountsWithModelAsync(unresolved, localAccounts, warnings, cancellationToken);
            items.AddRange(llmResult);
        }

        var abstained = items.Count(i => i.TargetAccount is null);

        return Result.Success(new AccountMappingSuggestionDto
        {
            TotalAccounts = sources.Count,
            ResolvedWithoutModel = resolvedWithoutModel,
            Abstained = abstained,
            Items = items,
            Warnings = warnings
        });
    }

    /// <summary>Référence aplatie d'un compte du plan local (numéro + libellé).</summary>
    private sealed record LocalAccountRef(string AccountNumber, string Label);

    private async Task<List<AccountMappingSuggestionItemDto>> TrySuggestAccountsWithModelAsync(
        IReadOnlyList<(string Account, string? Label)> unresolved,
        IReadOnlyList<LocalAccountRef> localAccounts,
        List<string> warnings,
        CancellationToken ct)
    {
        var items = new List<AccountMappingSuggestionItemDto>();
        try
        {
            // Bornage du contexte : classes réellement concernées par les comptes à mapper.
            var unresolvedClasses = unresolved.Select(u => u.Account[0]).ToHashSet();
            var candidates = localAccounts
                .Where(a => unresolvedClasses.Contains(a.AccountNumber[0]))
                .Select(a => a.AccountNumber + " — " + a.Label)
                .ToList();
            if (candidates.Count == 0)
                candidates = localAccounts.Select(a => a.AccountNumber + " — " + a.Label).ToList();

            if (candidates.Count > _settings.MaxAccountsSentToModel)
            {
                candidates = candidates.Take(_settings.MaxAccountsSentToModel).ToList();
                warnings.Add($"Plan local volumineux : seuls {_settings.MaxAccountsSentToModel} comptes candidats ont été soumis au modèle.");
            }

            var payload = new StringBuilder()
                .AppendLine("COMPTES SOURCE À MAPPER (numéro — libellé) :")
                .AppendLine(string.Join(Environment.NewLine,
                    unresolved.Select(u => u.Label is null ? u.Account : $"{u.Account} — {u.Label}")))
                .AppendLine()
                .AppendLine("COMPTES CIBLES AUTORISÉS (plan comptable du dossier, ensemble fermé) :")
                .AppendLine(string.Join(Environment.NewLine, candidates))
                .ToString();

            var raw = await CallModelAsync(payload.ToString(), AccountMappingSystemPrompt, ct);
            var parsed = raw is null ? null : TryParse<LlmAccountMappings>(raw);
            var localSet = localAccounts.Select(a => a.AccountNumber).ToHashSet(StringComparer.Ordinal);
            var coveredSources = new HashSet<string>(StringComparer.Ordinal);

            if (parsed?.Mappings is not null)
            {
                foreach (var m in parsed.Mappings)
                {
                    if (string.IsNullOrWhiteSpace(m.Source) || !coveredSources.Add(m.Source))
                        continue;
                    var source = unresolved.FirstOrDefault(u => u.Account == m.Source.Trim());
                    if (source.Account is null) continue; // compte source inventé : ignoré

                    string? target = null;
                    var confidence = Clamp01(m.Confidence);
                    var justification = m.Justification;
                    if (!string.IsNullOrWhiteSpace(m.Target) && localSet.Contains(m.Target.Trim()))
                    {
                        target = m.Target.Trim();
                        if (target[0] != source.Account[0])
                        {
                            confidence = Math.Min(confidence, 0.5);
                            justification = "[Classe différente — à vérifier] " + justification;
                        }
                    }

                    items.Add(new AccountMappingSuggestionItemDto
                    {
                        SourceAccount = source.Account, SourceLabel = source.Label,
                        TargetAccount = target,
                        Confidence = target is null ? 0 : confidence,
                        Origin = MigrationSuggestionOrigin.Ia,
                        Justification = target is null ? null : justification
                    });
                }
            }
            else
            {
                warnings.Add("Suggestions IA indisponibles pour les comptes restants — ils sont laissés à mapper manuellement.");
            }

            // Tout compte non couvert par le modèle est une abstention explicite.
            foreach (var u in unresolved.Where(u => !coveredSources.Contains(u.Account)))
            {
                items.Add(new AccountMappingSuggestionItemDto
                {
                    SourceAccount = u.Account, SourceLabel = u.Label,
                    TargetAccount = null, Confidence = 0,
                    Origin = MigrationSuggestionOrigin.Ia,
                    Justification = null
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[MigrationAssistant] Échec du mapping de comptes par le modèle.");
            warnings.Add("Suggestions IA indisponibles — les comptes restants sont à mapper manuellement.");
            foreach (var u in unresolved)
            {
                items.Add(new AccountMappingSuggestionItemDto
                {
                    SourceAccount = u.Account, SourceLabel = u.Label,
                    TargetAccount = null, Confidence = 0,
                    Origin = MigrationSuggestionOrigin.Ia
                });
            }
        }

        return items;
    }

    // ── M3 : doublons de tiers ──────────────────────────────────────────────

    public async Task<Result<ThirdPartyDuplicateDetectionDto>> DetectThirdPartyDuplicatesAsync(
        byte[] content, JournalImportFormat format, CancellationToken cancellationToken)
    {
        // Lecture leniente : seul « nom » est exigé ici — l'import final appliquera la validation
        // complète du référentiel tiers (email/adresse obligatoires), inchangée.
        var (synonyms, _, expected) = ReferenceDataImportService.Schema(ReferenceImportTarget.ThirdParties);
        var (rows, readIssues) = TabularRowReader.Read(content, format, synonyms, new[] { "nom" }, expected);
        var blocking = readIssues.FirstOrDefault(i => i.IsBlocking);
        if (blocking is not null)
            return Result.Failure<ThirdPartyDuplicateDetectionDto>(
                Error.Validation(ErrorCode, $"Lecture impossible : {blocking.Message}"));

        var imported = rows.Select((r, i) => new ThirdPartySnapshot(
                $"ligne {i + 2}",
                r.GetValueOrDefault("nom", string.Empty).Trim(),
                NullIfEmpty(r.GetValueOrDefault("nif", string.Empty)),
                NullIfEmpty(r.GetValueOrDefault("email", string.Empty)),
                NullIfEmpty(r.GetValueOrDefault("telephone", string.Empty)),
                NullIfEmpty(r.GetValueOrDefault("ville", string.Empty)),
                "fichier"))
            .Where(s => s.Name.Length > 0)
            .ToList();

        await using var ctx = _contextFactory.CreateContext();
        var clients = await ctx.Clients.AsNoTracking()
            .Select(c => new ThirdPartySnapshot(
                c.Id.ToString(), c.Name,
                c.NIF != null ? c.NIF.Value : null,
                c.Email != null ? c.Email.Value : null,
                c.Phone != null ? c.Phone.Value : null,
                c.Address.City,
                "client"))
            .ToListAsync(cancellationToken);
        var suppliers = await ctx.Suppliers.AsNoTracking()
            .Select(s => new ThirdPartySnapshot(
                s.Id.ToString(), s.Name,
                s.NIF != null ? s.NIF.Value : null,
                s.Email != null ? s.Email.Value : null,
                s.Phone != null ? s.Phone.Value : null,
                s.Address.City,
                "fournisseur"))
            .ToListAsync(cancellationToken);

        var existing = clients.Concat(suppliers).ToList();
        var matches = ThirdPartyDuplicateDetector.Detect(
            imported, existing, _settings.DuplicateMinScore, _settings.MaxDuplicatePairs);

        var warnings = new List<string>();
        if (matches.Count >= _settings.MaxDuplicatePairs)
            warnings.Add($"Plus de {_settings.MaxDuplicatePairs} paires candidates : seules les plus probables sont remontées.");

        return Result.Success(new ThirdPartyDuplicateDetectionDto
        {
            ImportedCount = imported.Count,
            ExistingCount = existing.Count,
            CandidatePairs = matches.Count,
            Pairs = matches.Select(m => new ThirdPartyDuplicatePairDto
            {
                ImportedName = m.Imported.Name,
                ImportedRef = m.Imported.Ref,
                ImportedNif = m.Imported.Nif,
                ExistingOrigin = m.Existing.Origin,
                ExistingName = m.Existing.Name,
                ExistingNif = m.Existing.Nif,
                Score = Math.Round(m.Score, 2),
                Reason = m.Reason
            }).ToList(),
            Warnings = warnings
        });
    }

    // ── Transformation : fichier source → CSV à en-têtes canoniques ─────────

    /// <inheritdoc />
    public Task<Result<byte[]>> ApplyColumnMappingAsync(
        byte[] content, JournalImportFormat format, ReferenceImportTarget target,
        IReadOnlyDictionary<string, string> columnMapping, CancellationToken cancellationToken)
    {
        if (columnMapping is null || columnMapping.Count == 0)
        {
            return Task.FromResult(Result.Failure<byte[]>(
                Error.Validation(ErrorCode, "Le mapping de colonnes validé est obligatoire.")));
        }

        var (synonyms, required, expected) = ReferenceDataImportService.Schema(target);
        var canonicalOrder = synonyms.Keys.ToList();

        // Ensemble fermé : chaque cible du mapping doit être une colonne canonique connue.
        var invalid = columnMapping.Values.Where(v => !synonyms.ContainsKey(v)).Distinct().ToList();
        if (invalid.Count > 0)
        {
            return Task.FromResult(Result.Failure<byte[]>(
                Error.Validation(ErrorCode, $"Colonne(s) canonique(s) inconnue(s) : {string.Join(", ", invalid)}.")));
        }

        var missingRequired = required.Where(r => !columnMapping.Values.Contains(r)).ToList();
        if (missingRequired.Count > 0)
        {
            return Task.FromResult(Result.Failure<byte[]>(
                Error.Validation(ErrorCode, $"Colonne(s) obligatoire(s) non mappée(s) : {string.Join(", ", missingRequired)}.")));
        }

        // Lecture pilotée par le mapping validé (canonique → en-tête source normalisé), via le
        // lecteur du pipeline d'import existant : mêmes règles de parsing, aucune duplication.
        var effectiveSynonyms = synonyms.ToDictionary(kv => kv.Key, _ => Array.Empty<string>());
        foreach (var (sourceHeader, canonical) in columnMapping)
        {
            var normalized = TabularFileParsing.Normalize(sourceHeader);
            if (normalized.Length == 0) continue;
            effectiveSynonyms[canonical] = effectiveSynonyms[canonical].Append(normalized).ToArray();
        }

        var (rows, readIssues) = TabularRowReader.Read(content, format, effectiveSynonyms, required, expected);
        var blocking = readIssues.FirstOrDefault(i => i.IsBlocking);
        if (blocking is not null)
        {
            return Task.FromResult(Result.Failure<byte[]>(
                Error.Validation(ErrorCode, $"Lecture impossible : {blocking.Message}")));
        }

        // Réécriture CSV canonique (délimiteur ';', détecté par l'import standard).
        using var writer = new StringWriter();
        var mappedCanonical = canonicalOrder.Where(c => columnMapping.Values.Contains(c)).ToList();
        using (var csv = new CsvWriter(writer, new CsvConfiguration(CultureInfo.InvariantCulture) { Delimiter = ";" }))
        {
            foreach (var canonical in mappedCanonical)
                csv.WriteField(canonical);
            csv.NextRecord();
            foreach (var row in rows)
            {
                foreach (var canonical in mappedCanonical)
                    csv.WriteField(row.GetValueOrDefault(canonical, string.Empty));
                csv.NextRecord();
            }
        }

        return Task.FromResult(Result.Success(Encoding.UTF8.GetBytes(writer.ToString())));
    }

    // ── Appel modèle partagé (pipeline d'extraction existant, fichier texte en mémoire) ──

    private async Task<string?> CallModelAsync(string payload, string systemPrompt, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(payload);
        await using var stream = new MemoryStream(bytes);
        var result = await _pipeline.RunAsync(new AiStructuredExtractionRequest
        {
            FileStream = stream,
            FileName = "migration-context.txt",
            ContentType = "text/plain",
            SystemPrompt = systemPrompt,
            ModelOverride = _settings.Model,
            ErrorCode = ErrorCode,
            MaxTextChars = 60_000,
            MaxImages = 0
        }, ct);

        if (result.IsFailure)
        {
            _logger.LogWarning("[MigrationAssistant] Pipeline IA en échec : {Error}", result.Error.Description);
            return null;
        }

        return result.Value.RawContent;
    }

    private static T? TryParse<T>(string raw) where T : class
    {
        var json = InvoiceImportParsing.ExtractFirstJsonObject(raw);
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<T>(json, LlmJsonOptions.Tolerant); }
        catch (JsonException) { return null; }
    }

    private static double Clamp01(double value) => value < 0 ? 0 : value > 1 ? 1 : value;

    private static string? NullIfEmpty(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // ── Prompts système (patron strict « JSON uniquement », calqué sur l'import de facture) ──

    private const string ColumnMappingSystemPrompt = """
Tu es un moteur de correspondance de colonnes pour la migration comptable vers un logiciel tunisien.
Ta SEULE tâche : associer chaque colonne source à UNE colonne cible autorisée, en un unique objet JSON.

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec un objet JSON valide. Aucun texte, aucun markdown.
2. "target" DOIT être l'une des colonnes cibles autorisées listées dans le message, en minuscules, sans modification.
3. Si aucune cible ne correspond raisonnablement, mets "target": null. N'invente JAMAIS de cible.
4. "confidence" est un nombre entre 0 et 1.
5. Inclus une entrée pour CHAQUE colonne source fournie.

SCHÉMA JSON EXACT :
{ "mappings": [ { "source": "CG_NUM", "target": "compte", "confidence": 0.98 } ] }
""";

    private const string AccountMappingSystemPrompt = """
Tu es un moteur de correspondance de plans comptables (migration vers le référentiel tunisien NCT/SCE).
Ta SEULE tâche : proposer pour chaque compte source un compte cible PARMI la liste autorisée, en un unique objet JSON.

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec un objet JSON valide. Aucun texte, aucun markdown.
2. "target" DOIT être un numéro de compte figurant EXACTEMENT dans la liste des comptes cibles autorisés. N'invente JAMAIS de compte.
3. Privilégie la même classe (premier chiffre) et la nature de l'opération décrite par le libellé.
4. Si aucun compte cible n'est raisonnable, mets "target": null — l'abstention est un comportement attendu.
5. "confidence" est un nombre entre 0 et 1. "justification" : une phrase courte en français.
6. Inclus une entrée pour CHAQUE compte source fourni.

SCHÉMA JSON EXACT :
{ "mappings": [ { "source": "617100", "target": "6134", "confidence": 0.7, "justification": "Charges de location assimilées" } ] }
""";

    // ── Schémas de sortie LLM (désérialisation tolérante) ───────────────────

    private sealed class LlmColumnMappings
    {
        public List<LlmColumnMappingItem>? Mappings { get; set; }
    }

    private sealed class LlmColumnMappingItem
    {
        public string? Source { get; set; }
        public string? Target { get; set; }
        public double Confidence { get; set; }
    }

    private sealed class LlmAccountMappings
    {
        public List<LlmAccountMappingItem>? Mappings { get; set; }
    }

    private sealed class LlmAccountMappingItem
    {
        public string? Source { get; set; }
        public string? Target { get; set; }
        public double Confidence { get; set; }
        public string? Justification { get; set; }
    }
}
