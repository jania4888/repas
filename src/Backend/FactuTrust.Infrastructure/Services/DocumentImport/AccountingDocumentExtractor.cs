using System.Text.Json;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Domain.Common;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.DocumentImport;

/// <summary>
/// Extraction d'une pièce comptable en deux passes :
/// <list type="number">
/// <item>parseur déterministe du gabarit InstaFact — instantané, gratuit, exact, et incapable de
/// rendre un résultat non réconcilié ;</item>
/// <item>extraction IA (OCR + LLM) pour toute autre pièce — typiquement une facture fournisseur
/// tierce, scannée ou photographiée.</item>
/// </list>
/// </summary>
public sealed class AccountingDocumentExtractor : IAccountingDocumentExtractor
{
    /// <summary>Code d'erreur et préfixe de log de ce chemin d'import.</summary>
    private const string ErrorCode = "AccountingDocumentImport";

    private readonly InstaFactInvoicePdfParser _nativeParser;
    private readonly IAiStructuredExtractionPipeline _pipeline;
    private readonly OllamaSettings _ollamaSettings;
    private readonly ILogger<AccountingDocumentExtractor> _logger;

    public AccountingDocumentExtractor(
        InstaFactInvoicePdfParser nativeParser,
        IAiStructuredExtractionPipeline pipeline,
        IOptions<OllamaSettings> ollamaSettings,
        ILogger<AccountingDocumentExtractor> logger)
    {
        _nativeParser = nativeParser;
        _pipeline = pipeline;
        _ollamaSettings = ollamaSettings.Value;
        _logger = logger;
    }

    public async Task<Result<AccountingDocumentExtractionDto>> ExtractAsync(
        AccountingDocumentExtractionRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Le flux est lu une seule fois : le parseur natif a besoin des octets, et le pipeline IA
        // repart du même buffer si la 1re passe n'aboutit pas.
        var bytes = await ReadAllBytesAsync(request.FileStream, cancellationToken);
        if (bytes.Length == 0)
            return Result.Failure<AccountingDocumentExtractionDto>(
                Error.Validation(ErrorCode, "Le fichier est vide."));

        if (LooksLikePdf(bytes))
        {
            var native = _nativeParser.TryParse(bytes, request.FileName);
            if (native is not null)
            {
                _logger.LogInformation(
                    "[{Scope}] Pièce {FileName} lue par le parseur natif (aucun appel IA) : "
                    + "n°={Number} HT={Ht} TVA={Vat} TTC={Ttc}",
                    ErrorCode, request.FileName, native.DocumentNumber,
                    native.TotalHt, native.TotalVat, native.TotalTtc);
                return Result.Success(native);
            }
        }

        if (!request.AllowAiFallback)
        {
            return Result.Failure<AccountingDocumentExtractionDto>(Error.Validation(ErrorCode,
                "Cette pièce n'est pas au format des factures émises par InstaFact et son analyse "
                + "nécessite l'assistant IA, pour lequel vous n'avez pas d'autorisation. "
                + "Contactez votre administrateur ou saisissez l'écriture manuellement."));
        }

        return await ExtractWithAiAsync(bytes, request, cancellationToken);
    }

    private async Task<Result<AccountingDocumentExtractionDto>> ExtractWithAiAsync(
        byte[] bytes,
        AccountingDocumentExtractionRequest request,
        CancellationToken cancellationToken)
    {
        var outcomeResult = await RunPipelineAsync(bytes, request, forceVision: false, cancellationToken);
        if (outcomeResult.IsFailure)
            return Result.Failure<AccountingDocumentExtractionDto>(outcomeResult.Error);

        var outcome = outcomeResult.Value;
        var parsed = TryParseLlmDocument(outcome.RawContent, out var json, out var jsonError);

        if (parsed is null && await ShouldRetryWithVisionAsync(outcome, request.ModelOverride, cancellationToken))
        {
            _logger.LogWarning(
                "[{Scope}] Réponse inexploitable sur le chemin texte pour {FileName} ; repli vision.",
                ErrorCode, request.FileName);

            var visionRetry = await RunPipelineAsync(bytes, request, forceVision: true, cancellationToken);
            if (visionRetry.IsFailure)
                return Result.Failure<AccountingDocumentExtractionDto>(visionRetry.Error);

            outcome = visionRetry.Value;
            parsed = TryParseLlmDocument(outcome.RawContent, out json, out jsonError);
        }

        if (parsed is null)
        {
            LogUnparseableLlmResponse(request.FileName, outcome.RawContent, json, jsonError);
            return Result.Failure<AccountingDocumentExtractionDto>(
                Error.Validation(ErrorCode,
                    await BuildUnparseableMessageAsync(json, jsonError, outcome, request.ModelOverride, cancellationToken)));
        }

        var method = outcome.VisionUsed
            ? AccountingDocumentExtractionMethods.LlmVision
            : AccountingDocumentExtractionMethods.LlmText;

        var document = AccountingDocumentMapping.FromLlm(
            parsed, method, outcome.Extraction.OcrApplied, outcome.TextTruncated);

        _logger.LogInformation(
            "[{Scope}] Pièce {FileName} extraite par l'IA : méthode={Method} type={Type} n°={Number} "
            + "lignes={LineCount} tauxTva={RateCount} confiance={Confidence}",
            ErrorCode, request.FileName, method, document.DocumentType, document.DocumentNumber,
            document.Lines.Count, document.VatBreakdown.Count, document.Confidence);

        return Result.Success(document);
    }

    private async Task<Result<AiStructuredExtractionOutcome>> RunPipelineAsync(
        byte[] bytes,
        AccountingDocumentExtractionRequest request,
        bool forceVision,
        CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream(bytes, writable: false);
        return await _pipeline.RunAsync(
            new AiStructuredExtractionRequest
            {
                FileStream = buffer,
                FileName = request.FileName,
                ContentType = request.ContentType,
                SystemPrompt = _ollamaSettings.UseCompactImportPrompt
                    ? AccountingDocumentPrompt.CompactSystem
                    : AccountingDocumentPrompt.System,
                ModelOverride = request.ModelOverride,
                ErrorCode = ErrorCode,
                ForceVision = forceVision,

                // Contraint les types côté Ollama (vatRatePercent entier, confidence énumérée…).
                // Réduit la fréquence des coercitions ; les convertisseurs tolérants restent la
                // défense réelle, notamment pour OpenRouter et les moteurs plus anciens.
                OutputSchema = LlmOutputSchemas.AccountingDocument
            },
            cancellationToken);
    }

    /// <summary>
    /// Le repli vision n'a de sens que pour ESCALADER : passer d'une lecture texte/OCR à une lecture
    /// de l'image.
    ///
    /// <para>Il était jusqu'ici inatteignable pour deux raisons cumulées : il exigeait
    /// <c>Format == "image"</c>, ce qui excluait tout PDF scanné ; et l'appelant le gardait derrière
    /// <c>!outcome.VisionUsed</c> alors qu'avec <c>InvoiceImportVisionOnImages = true</c> (valeur par
    /// défaut) toute image part DÉJÀ en vision dès la 1re passe. Le repli ne pouvait donc jamais
    /// s'exécuter. La règle correcte tient en quatre conditions, exprimées ici et nulle part
    /// ailleurs.</para>
    /// </summary>
    private async Task<bool> ShouldRetryWithVisionAsync(
        AiStructuredExtractionOutcome outcome,
        string? modelOverride,
        CancellationToken cancellationToken)
    {
        if (!_ollamaSettings.InvoiceImportVisionRetryEnabled)
            return false;

        // Déjà en vision : rien à escalader. C'est aussi le garde anti-boucle.
        if (outcome.VisionUsed)
            return false;

        var visionId = await _pipeline.ResolveEffectiveVisionModelIdAsync(modelOverride, cancellationToken);
        if (string.IsNullOrWhiteSpace(visionId))
            return false;

        // Critère réel : disposer d'une image à soumettre — quel que soit le format d'origine.
        // Inclut donc les PDF scannés, dont les pages sont rasterisées pour l'OCR.
        return outcome.Extraction.Pages.Any(p => !string.IsNullOrWhiteSpace(p.ImageBase64));
    }

    /// <param name="json">
    /// Objet JSON isolé de la réponse brute, ou <c>null</c> si aucun objet équilibré n'a pu l'être.
    /// Remonté à l'appelant car les offsets de la <see cref="JsonException"/> s'y rapportent — pas
    /// à la réponse brute ; viser dans le mauvais tampon décalerait le diagnostic.
    /// </param>
    private LlmAccountingDocument? TryParseLlmDocument(
        string rawContent, out string? json, out JsonException? jsonError)
    {
        jsonError = null;
        json = InvoiceImportParsing.ExtractFirstJsonObject(rawContent);
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            return JsonSerializer.Deserialize<LlmAccountingDocument>(json, LlmJsonOptions.Tolerant);
        }
        catch (JsonException ex)
        {
            jsonError = ex;
            _logger.LogWarning(ex, "[{Scope}] JSON renvoyé par le LLM non désérialisable.", ErrorCode);
            return null;
        }
    }

    private void LogUnparseableLlmResponse(
        string fileName, string rawContent, string? json, JsonException? jsonError)
    {
        var max = Math.Clamp(_ollamaSettings.ImportRawResponseLogChars, 200, 20_000);
        var preview = rawContent.Length <= max ? rawContent : rawContent[..max] + "…";

        _logger.LogWarning(
            jsonError,
            "[{Scope}] Réponse LLM non exploitable pour {FileName} : {Diagnostic} | jsonIsolé={JsonFound} "
            + "longueurBrute={RawLength} aperçu={PreviewChars}car. : {Preview}",
            ErrorCode, fileName,
            LlmJsonDiagnostics.Describe(json, jsonError),
            json is not null, rawContent.Length, max, preview);
    }

    /// <summary>
    /// Message utilisateur construit à partir de ce qui a RÉELLEMENT échoué.
    ///
    /// L'ancien message constant accusait systématiquement l'absence d'un modèle vision — y compris,
    /// comme observé en production, quand gemma3:4b était installé, prêt, et avait effectivement
    /// produit la réponse. Il envoyait donc l'utilisateur corriger une configuration déjà correcte.
    /// </summary>
    private async Task<string> BuildUnparseableMessageAsync(
        string? json,
        JsonException? jsonError,
        AiStructuredExtractionOutcome outcome,
        string? modelOverride,
        CancellationToken cancellationToken)
    {
        if (json is null)
        {
            return "L'IA a été interrompue avant la fin de sa réponse : les données reçues sont "
                   + "incomplètes. Réessayez ; si la pièce comporte beaucoup de lignes, relevez "
                   + "« ImportMaxOutputTokens » côté serveur ou importez la pièce page par page.";
        }

        var field = string.IsNullOrWhiteSpace(jsonError?.Path) ? null : jsonError!.Path;
        var detail = field is null ? "." : $" (champ en cause : {field}).";
        var message = "L'IA a renvoyé une donnée que la comptabilité n'a pas pu interpréter" + detail
                      + " Le détail technique figure dans les journaux du serveur. Réessayez, ou "
                      + "saisissez l'écriture manuellement.";

        // La vision n'est évoquée QUE si elle manque réellement sur une pièce qui en aurait besoin.
        var isScanOrPhoto = outcome.Extraction.OcrApplied
            || string.Equals(outcome.Extraction.Format, "image", StringComparison.OrdinalIgnoreCase);
        var visionId = await _pipeline.ResolveEffectiveVisionModelIdAsync(modelOverride, cancellationToken);
        if (isScanOrPhoto && string.IsNullOrWhiteSpace(visionId))
        {
            message += " Cette pièce est un scan ou une photo : configurez un modèle d'import multimodal "
                       + "dans l'administration plateforme (Configuration IA) pour améliorer la lecture.";
        }

        return message;
    }

    private static async Task<byte[]> ReadAllBytesAsync(Stream stream, CancellationToken cancellationToken)
    {
        if (stream is MemoryStream ready)
            return ready.ToArray();

        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);
        return buffer.ToArray();
    }

    private static bool LooksLikePdf(byte[] bytes) =>
        bytes.Length >= 5
        && bytes[0] == 0x25 && bytes[1] == 0x50 && bytes[2] == 0x44 && bytes[3] == 0x46; // "%PDF"
}
