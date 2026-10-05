using System.Diagnostics;
using System.Text.Json;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.Clients.Queries;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.AI.Commands;

/// <summary>
/// Commande d'import d'une facture à partir d'un fichier (PDF, image, Word, Excel).
/// Le contenu est extrait puis structuré par le LLM, sans passer par le chat de l'assistant.
/// </summary>
public sealed record ImportInvoiceFromFileCommand(
    Stream FileStream,
    string FileName,
    string ContentType,
    string? Model = null);

/// <summary>
/// Handler one-shot (requête/réponse, sans streaming SSE ni conversation persistée) :
/// extraction documentaire → appel LLM structuré → parsing/normalisation → rapprochement
/// clients/produits → <see cref="InvoiceImportResultDto"/>.
/// </summary>
public sealed class ImportInvoiceFromFileHandler
{
    /// <summary>Code d'erreur et préfixe de log historiques de l'import de facture.</summary>
    private const string ErrorCode = "InvoiceImport";

    private readonly IAiStructuredExtractionPipeline _pipeline;
    private readonly IMediator _mediator;
    private readonly ILogger<ImportInvoiceFromFileHandler> _logger;
    private readonly OllamaSettings _ollamaSettings;

    private const int MaxTextChars = 60_000;
    private const int MaxImages = 10;
    private const int MaxLinesToMatch = 50;

    private const string SystemPrompt = """
Tu es un moteur d'extraction de données de factures pour un logiciel de facturation tunisien.
Ta SEULE tâche est d'analyser le document fourni et d'en extraire les informations sous la forme d'un unique objet JSON.

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec un objet JSON valide. Aucun texte, aucune explication, aucun bloc markdown avant ou après.
2. N'invente JAMAIS de données. Si une information est absente du document, mets null. Pour une liste vide, mets [].
3. Tous les montants sont des nombres décimaux : séparateur décimal point, sans symbole monétaire, sans séparateur de milliers.
4. "unitPriceHT" est le prix unitaire HORS TAXES (hors TVA).
5. "vatRatePercent" doit valoir 0, 7, 13 ou 19 (taux de TVA tunisiens, en pourcentage). Arrondis au plus proche.
6. Les dates sont au format ISO "AAAA-MM-JJ". Convertis "JJ/MM/AAAA" vers "AAAA-MM-JJ". Date absente => null.
7. "currency" vaut "TND", "EUR" ou "USD". En l'absence d'indication, mets "TND".
8. Montants tunisiens : "650,000" ou "650.000" signifient 650 dinars (3 décimales TND) → renvoie 650.000 en JSON.
9. "documentType" vaut "INVOICE", "CREDIT_NOTE", "DELIVERY_NOTE" (bon de livraison), "PROFORMA" (devis), ou "UNKNOWN" si illisible.
10. Si bon de livraison / devis : extrais quand même client, lignes et montants ; documentType adapté ; ajoute un warning en français.
11. "invoiceNumber" : numéro de facture ou de BL (ex. 00396) si présent.
12. Chaque ligne d'article DOIT avoir une "designation" non vide. N'inclus pas les lignes sans désignation.
13. "client" est le DESTINATAIRE (acheteur), distinct de l'émetteur "seller". Conserve le nom en arabe ou français tel qu'affiché.
14. "confidence" vaut "high", "medium" ou "low" selon ta certitude globale.
15. "warnings" est une liste de messages courts en français signalant toute ambiguïté ou donnée douteuse.

SCHÉMA JSON EXACT À RESPECTER :
{
  "documentType": "INVOICE",
  "invoiceNumber": "string|null",
  "issueDate": "AAAA-MM-JJ|null",
  "dueDate": "AAAA-MM-JJ|null",
  "currency": "TND",
  "seller": { "name": "string|null", "nif": "string|null" },
  "client": {
    "name": "string|null",
    "nif": "string|null",
    "email": "string|null",
    "phone": "string|null",
    "address": { "street": "string|null", "city": "string|null", "postalCode": "string|null", "governorate": "string|null" }
  },
  "lines": [
    { "designation": "string", "description": "string|null", "quantity": 0, "unit": "string|null", "unitPriceHT": 0, "discountPercent": 0, "vatRatePercent": 19 }
  ],
  "totals": { "totalHT": 0, "totalVat": 0, "totalTTC": 0 },
  "confidence": "high",
  "warnings": []
}
""";

    private const string CompactSystemPrompt = """
Tu extrais une facture ou pièce commerciale tunisienne (facture, bon de livraison, devis) en JSON strict. Réponds UNIQUEMENT avec un objet JSON valide, sans markdown.
Montants décimaux (point), TND 3 décimales (650,000 → 650.000), TVA 0/7/13/19, dates ISO AAAA-MM-JJ, devise TND/EUR/USD, client=acheteur.
documentType: INVOICE|CREDIT_NOTE|DELIVERY_NOTE|PROFORMA|UNKNOWN. Bon de livraison → DELIVERY_NOTE + warnings.
Schéma: documentType, invoiceNumber, issueDate, dueDate, currency, seller{name,nif}, client{name,nif,email,phone,address{street,city,postalCode,governorate}}, lines[{designation,description,quantity,unit,unitPriceHT,discountPercent,vatRatePercent}], totals{totalHT,totalVat,totalTTC}, confidence, warnings[].
""";

    public ImportInvoiceFromFileHandler(
        IOllamaClient ollamaClient,
        IOpenAiChatCompletionsClient openAiClient,
        IAiDocumentTextExtractor documentTextExtractor,
        IOllamaModelReadinessChecker readinessChecker,
        IPlatformAiSettingsService platformAiSettings,
        IOllamaInferenceProfileResolver inferenceProfileResolver,
        IMediator mediator,
        ILogger<ImportInvoiceFromFileHandler> logger,
        IOptions<OllamaSettings> ollamaSettings,
        IAiStructuredExtractionPipeline? pipeline = null,
        IImportAiModelResolutionService? importModelResolver = null)
    {
        _mediator = mediator;
        _logger = logger;
        _ollamaSettings = ollamaSettings.Value;

        importModelResolver ??= new ImportAiModelResolutionService(
            platformAiSettings,
            ollamaSettings,
            NullLogger<ImportAiModelResolutionService>.Instance);

        // Le pipeline est injecté en production. Le repli construit la même implémentation à partir
        // des dépendances déjà reçues : les appelants historiques (dont les tests) restent valides.
        _pipeline = pipeline ?? new AiStructuredExtractionPipeline(
            ollamaClient,
            openAiClient,
            documentTextExtractor,
            readinessChecker,
            platformAiSettings,
            importModelResolver,
            inferenceProfileResolver,
            NullLogger<AiStructuredExtractionPipeline>.Instance,
            ollamaSettings,
            ModalCredentialsFallback.ForPlatform(platformAiSettings),
            ModalCredentialsFallback.EmptyTenant);
    }

    public async Task<Result<InvoiceImportResultDto>> HandleAsync(
        ImportInvoiceFromFileCommand command,
        CancellationToken cancellationToken)
    {
        var totalSw = Stopwatch.StartNew();

        // 1-5. Extraction documentaire (texte/OCR), repli vision, disponibilité du fournisseur
        //      puis appel LLM one-shot — mutualisés dans le pipeline d'extraction structurée.
        var pipelineResult = await _pipeline.RunAsync(
            new AiStructuredExtractionRequest
            {
                FileStream = command.FileStream,
                FileName = command.FileName,
                ContentType = command.ContentType,
                SystemPrompt = ResolveSystemPrompt(),
                ModelOverride = command.Model,
                ErrorCode = ErrorCode,
                MaxTextChars = MaxTextChars,
                MaxImages = MaxImages
            },
            cancellationToken);

        if (pipelineResult.IsFailure)
            return Result.Failure<InvoiceImportResultDto>(pipelineResult.Error);

        var outcome = pipelineResult.Value;
        var extraction = outcome.Extraction;
        var textTruncated = outcome.TextTruncated;
        var raw = outcome.RawContent;

        // 6. Parsing JSON robuste.
        var json = InvoiceImportParsing.ExtractFirstJsonObject(raw);
        LlmInvoiceExtraction? parsed = null;
        if (!string.IsNullOrWhiteSpace(json))
        {
            try
            {
                parsed = JsonSerializer.Deserialize<LlmInvoiceExtraction>(json, LlmJsonOptions.Tolerant);
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Import facture : JSON renvoyé par le LLM non désérialisable.");
            }
        }

        if (parsed is null)
            return Result.Failure<InvoiceImportResultDto>(Error.Validation("InvoiceImport",
                "L'IA n'a pas pu produire des données exploitables à partir de ce fichier. "
                + "Réessayez ou saisissez la facture manuellement."));

        _logger.LogInformation(
            "[InvoiceImport] documentTypeDetected={DocumentType} confidence={Confidence}",
            parsed.DocumentType, parsed.Confidence);

        // 7-9. Validation, normalisation fiscale, rapprochement clients/produits.
        var matchSw = Stopwatch.StartNew();
        var dto = await MapValidateAndMatchAsync(parsed, extraction, textTruncated, cancellationToken);
        matchSw.Stop();

        totalSw.Stop();
        _logger.LogInformation(
            "[InvoiceImport] Import terminé en {TotalMs} ms (rapprochement={MatchMs} ms) : "
            + "modèle={Model} vision={UsedVision} lignes={LineCount}",
            totalSw.ElapsedMilliseconds, matchSw.ElapsedMilliseconds,
            outcome.ModelUsed, outcome.VisionUsed, dto.Lines.Count);

        return Result.Success(dto);
    }

    // ========================================================================
    // Préchauffage
    // ========================================================================

    /// <summary>
    /// Préchauffe le modèle d'import : charge Ollama en mémoire et signale les problèmes RAM.
    /// Délégué au pipeline d'extraction structurée, partagé avec l'import de pièce comptable.
    /// </summary>
    public Task<InvoiceImportWarmUpResult> WarmUpAsync(CancellationToken cancellationToken) =>
        _pipeline.WarmUpAsync(cancellationToken);

    private string ResolveSystemPrompt() =>
        _ollamaSettings.UseCompactImportPrompt ? CompactSystemPrompt : SystemPrompt;

    // ========================================================================
    // Validation / normalisation / rapprochement
    // ========================================================================

    private async Task<InvoiceImportResultDto> MapValidateAndMatchAsync(
        LlmInvoiceExtraction parsed,
        AiDocumentExtractionResult extraction,
        bool textTruncated,
        CancellationToken cancellationToken)
    {
        var warnings = new List<string>();
        if (parsed.Warnings is { Count: > 0 })
        {
            warnings.AddRange(parsed.Warnings
                .Where(w => !string.IsNullOrWhiteSpace(w))
                .Select(w => w.Trim()));
        }

        if (textTruncated)
            warnings.Add("Le document est volumineux : seule une partie a été analysée. Vérifiez que rien ne manque.");

        if (InvoiceImportParsing.IsUnknownDocumentType(parsed.DocumentType))
            warnings.Add("Le document ne semble pas être une facture : vérifiez attentivement les données extraites.");
        if (InvoiceImportParsing.IsDeliveryNoteDocumentType(parsed.DocumentType))
            warnings.Add("Document importé depuis un bon de livraison : vérifiez la TVA, le numéro de facture et les montants avant validation.");
        if (InvoiceImportParsing.IsProformaDocumentType(parsed.DocumentType))
            warnings.Add("Document importé depuis un devis : vérifiez les conditions commerciales avant de facturer.");
        var documentType = InvoiceImportParsing.NormalizeDocumentType(parsed.DocumentType);

        var currency = InvoiceImportParsing.NormalizeCurrency(parsed.Currency);

        var issueDate = InvoiceImportParsing.ParseDate(parsed.IssueDate);
        var dueDate = InvoiceImportParsing.ParseDate(parsed.DueDate);

        // Lignes.
        var lines = new List<InvoiceImportLineDto>();
        var skipped = 0;
        foreach (var l in parsed.Lines ?? new List<LlmInvoiceLine>())
        {
            var mapped = InvoiceImportParsing.MapLine(l);
            if (mapped is null)
            {
                skipped++;
                continue;
            }

            lines.Add(mapped);
        }

        if (skipped > 0)
            warnings.Add($"{skipped} ligne(s) sans désignation ont été ignorées.");
        if (lines.Count == 0)
            warnings.Add("Aucune ligne d'article n'a pu être extraite : ajoutez les articles manuellement.");

        // Totaux + contrôle de cohérence.
        InvoiceImportTotalsDto? totals = parsed.Totals is null
            ? null
            : new InvoiceImportTotalsDto
            {
                TotalHT = parsed.Totals.TotalHT,
                TotalVat = parsed.Totals.TotalVat,
                TotalTTC = parsed.Totals.TotalTTC
            };

        if (lines.Count > 0 && lines.All(l => l.VatRatePercent == 19)
            && (InvoiceImportParsing.IsDeliveryNoteDocumentType(parsed.DocumentType)
                || totals?.TotalVat is null or 0))
            warnings.Add("TVA par défaut (19 %) appliquée : le document source ne mentionnait pas la TVA.");

        if (totals?.TotalHT is { } declaredHt && declaredHt > 0m && lines.Count > 0)
        {
            var computedHt = lines.Sum(x =>
                x.Quantity * x.UnitPriceHT * (1m - (x.DiscountPercent ?? 0m) / 100m));
            if (Math.Abs(computedHt - declaredHt) > declaredHt * 0.01m)
                warnings.Add("Le total HT extrait ne correspond pas exactement à la somme des lignes : vérifiez les montants.");
        }

        // Rapprochement clients/produits.
        var client = await MatchClientAsync(parsed.Client, warnings, cancellationToken);
        lines = await MatchProductsAsync(lines, warnings, cancellationToken);

        var confidence = InvoiceImportParsing.NormalizeConfidence(parsed.Confidence);

        return new InvoiceImportResultDto
        {
            DocumentType = documentType,
            InvoiceNumber = InvoiceImportParsing.CleanOrNull(parsed.InvoiceNumber),
            IssueDate = issueDate,
            DueDate = dueDate,
            Currency = currency,
            Client = client,
            Lines = lines,
            Totals = totals,
            Confidence = confidence,
            Warnings = warnings,
            ExtractionFormat = extraction.Format,
            OcrApplied = extraction.OcrApplied
        };
    }

    private async Task<InvoiceImportClientDto> MatchClientAsync(
        LlmParty? client,
        List<string> warnings,
        CancellationToken cancellationToken)
    {
        var name = (client?.Name ?? string.Empty).Trim();
        var nif = (client?.Nif ?? string.Empty).Trim();
        var address = client?.Address;
        var hasNif = nif.Length > 0;

        var fallback = new InvoiceImportClientDto
        {
            IsNewClient = true,
            Name = InvoiceImportParsing.CleanOrNull(name),
            Nif = InvoiceImportParsing.CleanOrNull(nif),
            Email = InvoiceImportParsing.CleanOrNull(client?.Email),
            Phone = InvoiceImportParsing.CleanOrNull(client?.Phone),
            Street = InvoiceImportParsing.CleanOrNull(address?.Street),
            City = InvoiceImportParsing.CleanOrNull(address?.City),
            PostalCode = InvoiceImportParsing.CleanOrNull(address?.PostalCode),
            Governorate = InvoiceImportParsing.CleanOrNull(address?.Governorate),
            TaxType = hasNif ? "TAX_SUBJECT" : "NON_TAX_SUBJECT"
        };

        if (name.Length == 0 && !hasNif)
            return fallback;

        try
        {
            if (hasNif)
            {
                var byNif = await _mediator.Send(new GetClientsQuery(Search: nif, PageSize: 10), cancellationToken);
                var normalizedNif = InvoiceImportParsing.NormalizeNif(nif);
                var nifHit = byNif.Items.FirstOrDefault(c =>
                    !string.IsNullOrEmpty(c.Nif) && InvoiceImportParsing.NormalizeNif(c.Nif!) == normalizedNif);
                if (nifHit is not null)
                    return ToMatchedClient(nifHit);
            }

            if (name.Length > 0)
            {
                var byName = await _mediator.Send(new GetClientsQuery(Search: name, PageSize: 10), cancellationToken);
                var nameHits = byName.Items
                    .Where(c => InvoiceImportParsing.Similarity(c.Name, name) >= InvoiceImportParsing.NameMatchThreshold)
                    .ToList();
                if (nameHits.Count == 1)
                    return ToMatchedClient(nameHits[0]);
                if (nameHits.Count > 1)
                    warnings.Add($"Plusieurs clients existants correspondent à « {name} » : sélectionnez le bon dans le wizard.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Import facture : rapprochement client échoué, bascule en nouveau client.");
        }

        return fallback;
    }

    private static InvoiceImportClientDto ToMatchedClient(ClientListDto c) => new()
    {
        MatchedClientId = c.Id,
        MatchedClientName = c.Name,
        IsNewClient = false,
        Name = c.Name,
        Nif = c.Nif,
        Email = c.Email,
        Phone = c.Phone,
        Street = c.Street,
        City = c.City,
        PostalCode = c.PostalCode,
        Governorate = c.Governorate,
        TaxType = !string.IsNullOrWhiteSpace(c.Nif) ? "TAX_SUBJECT" : "NON_TAX_SUBJECT"
    };

    private async Task<List<InvoiceImportLineDto>> MatchProductsAsync(
        List<InvoiceImportLineDto> lines,
        List<string> warnings,
        CancellationToken cancellationToken)
    {
        if (lines.Count == 0)
            return lines;

        if (lines.Count > MaxLinesToMatch)
            warnings.Add($"Le rapprochement automatique des articles s'est limité aux {MaxLinesToMatch} premières lignes.");

        var result = new List<InvoiceImportLineDto>(lines.Count);
        var matchTasks = new List<Task<(int Index, InvoiceImportLineDto Line)>>(Math.Min(lines.Count, MaxLinesToMatch));

        for (var i = 0; i < Math.Min(lines.Count, MaxLinesToMatch); i++)
            matchTasks.Add(MatchSingleProductLineAsync(i, lines[i], cancellationToken));

        var matched = await Task.WhenAll(matchTasks);
        var matchedByIndex = matched.ToDictionary(m => m.Index, m => m.Line);

        for (var i = 0; i < lines.Count; i++)
        {
            if (matchedByIndex.TryGetValue(i, out var matchedLine))
                result.Add(matchedLine);
            else
                result.Add(lines[i]);
        }

        return result;
    }

    private async Task<(int Index, InvoiceImportLineDto Line)> MatchSingleProductLineAsync(
        int index,
        InvoiceImportLineDto line,
        CancellationToken cancellationToken)
    {
        try
        {
            var query = new GetProductsQuery(Search: line.Designation, IsActive: true, PageSize: 10);
            var res = await _mediator.Send(query, cancellationToken);
            if (res.IsSuccess)
            {
                var hits = res.Value.Items
                    .Where(p => InvoiceImportParsing.Similarity(p.Name, line.Designation) >= InvoiceImportParsing.NameMatchThreshold
                                || string.Equals(p.Code, line.Designation, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (hits.Count == 1)
                    return (index, line with { MatchedProductId = hits[0].Id, MatchedProductCode = hits[0].Code });
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Import facture : rapprochement produit échoué pour « {Designation} ».", line.Designation);
        }

        return (index, line);
    }
}
