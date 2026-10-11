using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Common;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Appel REST direct de Docstrange (Nanonets). Contrat figé dans
/// <c>docs/developer/docstrange-api-contract.md</c>, relevé par sonde réelle : les SDK publiés
/// décrivent des générations d'API différentes et le point d'entrée <c>/extract</c> du SDK Python
/// est déprécié.
/// </summary>
public sealed class DocStrangeHttpClient : IDocStrangeClient
{
    public const string HttpClientName = "DocStrange";

    /// <summary>Code d'erreur porté par les <see cref="Error"/> rendues, et préfixe des logs.</summary>
    private const string ErrorCode = "DocStrange";

    // La réponse est en snake_case (record_id, processing_time) : sans cette politique, les
    // champs correspondants resteraient nuls en silence.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly DocStrangeSettings _settings;
    private readonly ILogger<DocStrangeHttpClient> _logger;

    public DocStrangeHttpClient(
        IHttpClientFactory httpClientFactory,
        IOptions<DocStrangeSettings> settings,
        ILogger<DocStrangeHttpClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task<Result<DocStrangeExtraction>> ExtractAsync(
        DocStrangeExtractRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.ApiKey))
            return Failure("Aucune clé API Docstrange n'est configurée.");

        var baseUrl = (string.IsNullOrWhiteSpace(request.BaseUrl)
            ? "https://extraction-api.nanonets.com"
            : request.BaseUrl).TrimEnd('/');

        if (request.Output == DocStrangeOutput.Json && string.IsNullOrWhiteSpace(request.JsonSchema))
            return Failure("Un schéma JSON est requis pour une extraction structurée Docstrange.");

        using var content = new MultipartFormDataContent();
        var fileContent = new StreamContent(request.File);
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
            string.IsNullOrWhiteSpace(request.ContentType) ? "application/octet-stream" : request.ContentType);
        AddFilePart(content, fileContent, request.FileName);
        AddFieldPart(content, "output_format", ToFormValue(request.Output));
        if (request.Output == DocStrangeOutput.Json)
            AddFieldPart(content, "json_options", request.JsonSchema!);

        using var message = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/api/v1/extract/sync")
        {
            Content = content
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", request.ApiKey);

        var client = _httpClientFactory.CreateClient(HttpClientName);
        var sw = Stopwatch.StartNew();

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(message, HttpCompletionOption.ResponseContentRead, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Y compris le dépassement de délai, que HttpClient rend en TaskCanceledException.
            _logger.LogWarning(ex, "[{Scope}] Appel Docstrange injoignable après {ElapsedMs} ms.", ErrorCode, sw.ElapsedMilliseconds);
            return Failure("Le service d'extraction Docstrange est injoignable.");
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                // Le corps du fournisseur n'est JAMAIS remonté à l'utilisateur (CWE-209) : il est
                // journalisé, et l'appelant reçoit un message stable.
                _logger.LogWarning(
                    "[{Scope}] Docstrange a refusé l'extraction : HTTP {Status} en {ElapsedMs} ms. Corps : {Body}",
                    ErrorCode, (int)response.StatusCode, sw.ElapsedMilliseconds, Truncate(body, 400));
                return Failure(MapStatus(response.StatusCode));
            }

            DocStrangeResponse? parsed;
            try
            {
                parsed = JsonSerializer.Deserialize<DocStrangeResponse>(body, JsonOptions);
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "[{Scope}] Réponse Docstrange illisible.", ErrorCode);
                return Failure("La réponse du service d'extraction Docstrange est illisible.");
            }

            var extracted = ExtractContent(parsed, request.Output);
            if (string.IsNullOrWhiteSpace(extracted))
            {
                _logger.LogWarning(
                    "[{Scope}] Docstrange n'a renvoyé aucun contenu en {ElapsedMs} ms (format {Format}, statut {Status}).",
                    ErrorCode, sw.ElapsedMilliseconds, request.Output, parsed?.Status);
                return Failure("Le service d'extraction Docstrange n'a renvoyé aucun contenu.");
            }

            _logger.LogInformation(
                "[{Scope}] Extraction Docstrange terminée en {ElapsedMs} ms : format {Format}, {Chars} caractères, "
                + "durée annoncée {ProviderSeconds} s, enregistrement {RecordId}",
                ErrorCode, sw.ElapsedMilliseconds, request.Output, extracted.Length,
                parsed?.ProcessingTime, parsed?.RecordId);

            return Result.Success(new DocStrangeExtraction(extracted, parsed?.RecordId, parsed?.ProcessingTime));
        }
    }

    private static string ToFormValue(DocStrangeOutput output) =>
        output == DocStrangeOutput.Json ? "json" : "markdown";

    // MultipartFormDataContent.Add(content, name) écrit « name=output_format », SANS guillemets.
    // La sonde qui a établi le contrat employait la forme entre guillemets de la RFC 7578, seule
    // prouvée acceptée par ce fournisseur : on la force plutôt que de parier sur sa tolérance.
    private static void AddFieldPart(MultipartFormDataContent content, string name, string value)
    {
        var part = new StringContent(value);
        part.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data")
        {
            Name = $"\"{name}\""
        };
        content.Add(part);
    }

    private static void AddFilePart(MultipartFormDataContent content, HttpContent file, string fileName)
    {
        file.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data")
        {
            Name = "\"file\"",
            FileName = $"\"{SanitizeFileName(fileName)}\""
        };
        content.Add(file);
    }

    /// <summary>Longueur maximale du nom de fichier transmis au fournisseur.</summary>
    internal const int MaxFileNameLength = 120;

    /// <summary>Nom transmis lorsque le nom reçu est vide après nettoyage.</summary>
    internal const string FallbackFileName = "document.pdf";

    private static readonly char[] ForbiddenFileNameChars = { '"', '\\', '/', ':', '*', '?', '<', '>', '|' };

    /// <summary>
    /// Nom de fichier sûr pour l'en-tête multipart : le nom vient de l'utilisateur et est placé
    /// entre guillemets dans <c>Content-Disposition</c>. Les caractères de contrôle (dont CR/LF),
    /// les guillemets et les séparateurs de chemin sont retirés pour qu'aucun nom ne puisse
    /// fermer le paramètre ou injecter un en-tête. Un nom normal est transmis à l'identique.
    /// </summary>
    internal static string SanitizeFileName(string? fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName))
            return FallbackFileName;

        var builder = new StringBuilder(fileName.Length);
        foreach (var c in fileName)
        {
            if (char.IsControl(c) || Array.IndexOf(ForbiddenFileNameChars, c) >= 0)
                continue;
            builder.Append(c);
        }

        var cleaned = builder.ToString().Trim();
        if (cleaned.Length == 0)
            return FallbackFileName;

        if (cleaned.Length <= MaxFileNameLength)
            return cleaned;

        // Tronque en conservant l'extension (le fournisseur peut s'appuyer dessus).
        var extension = Path.GetExtension(cleaned);
        if (extension.Length is 0 or > 10)
            return cleaned[..MaxFileNameLength];

        var stem = cleaned[..(cleaned.Length - extension.Length)];
        return stem[..(MaxFileNameLength - extension.Length)] + extension;
    }

    /// <summary>
    /// Une seule branche de <c>result</c> est renseignée, celle du format demandé. Le JSON est
    /// rendu RÉ-SÉRIALISÉ : l'appelant le désérialise avec ses propres contrôles.
    /// </summary>
    private static string? ExtractContent(DocStrangeResponse? parsed, DocStrangeOutput output)
    {
        var result = parsed?.Result;
        if (result is null)
            return null;

        if (output == DocStrangeOutput.Markdown)
            return result.Markdown?.Content;

        var json = result.Json?.Content;
        return json is null || json.Value.ValueKind == JsonValueKind.Null
            ? null
            : json.Value.GetRawText();
    }

    private static string MapStatus(HttpStatusCode status) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
            "La clé API Docstrange est refusée par le fournisseur.",
        HttpStatusCode.TooManyRequests =>
            "Le quota Docstrange est épuisé : réessayez plus tard ou vérifiez l'abonnement.",
        HttpStatusCode.RequestEntityTooLarge =>
            "Le document est trop volumineux pour le service d'extraction Docstrange.",
        _ => "Le service d'extraction Docstrange a échoué."
    };

    private static Result<DocStrangeExtraction> Failure(string message) =>
        Result.Failure<DocStrangeExtraction>(Error.Validation(ErrorCode, message));

    private static string Truncate(string value, int max) =>
        string.IsNullOrEmpty(value) || value.Length <= max ? value : value[..max];

    // ---- Forme de la réponse (contrat figé le 2026-10-08) ----

    private sealed record DocStrangeResponse
    {
        public string? RecordId { get; init; }
        public string? Status { get; init; }
        public double? ProcessingTime { get; init; }
        public DocStrangeResult? Result { get; init; }
    }

    private sealed record DocStrangeResult
    {
        public DocStrangeTextPayload? Markdown { get; init; }
        public DocStrangeJsonPayload? Json { get; init; }
    }

    private sealed record DocStrangeTextPayload
    {
        public string? Content { get; init; }
    }

    private sealed record DocStrangeJsonPayload
    {
        public JsonElement? Content { get; init; }
    }
}
