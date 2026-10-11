using System.Net;
using System.Text;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// Contrat du client Docstrange, figé par sonde réelle le 2026-10-08
/// (voir <c>docs/developer/docstrange-api-contract.md</c>).
///
/// Les deux exigences non négociables vérifiées ici : la clé ne fuit jamais dans un message
/// d'erreur, et le corps brut du fournisseur non plus (CWE-209).
/// </summary>
public sealed class DocStrangeHttpClientTests
{
    private const string Key = "cle-de-test-0000-1111-2222";

    [Fact]
    public async Task Markdown_extraction_sends_the_documented_contract_and_returns_the_content()
    {
        var handler = new RecordingHandler();
        handler.Enqueue(HttpStatusCode.OK, """
            {
              "success": true,
              "record_id": "17958884",
              "status": "completed",
              "processing_time": 28.98,
              "result": {
                "markdown": { "content": "## Page 1\n<table><tr><td>02/03/2026</td></tr></table>" },
                "html": null, "json": null, "csv": null
              }
            }
            """);

        var result = await CreateSut(handler).ExtractAsync(Request(DocStrangeOutput.Markdown), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Contains("<table>", result.Value.Content, StringComparison.Ordinal);
        Assert.Equal("17958884", result.Value.RecordId);
        Assert.Equal(28.98, result.Value.ProcessingSeconds);

        // Le contrat : /api/v1/extract/sync, Bearer, et output_format (PAS output_type, qui
        // appartient au point d'entree /extract deprecie).
        Assert.Equal("https://extraction-api.nanonets.com/api/v1/extract/sync", handler.LastUrl);
        Assert.Equal("Bearer", handler.LastAuthScheme);
        Assert.Equal(Key, handler.LastAuthParameter);
        Assert.Contains("name=\"output_format\"", handler.LastBody, StringComparison.Ordinal);
        Assert.Contains("markdown", handler.LastBody, StringComparison.Ordinal);
        Assert.DoesNotContain("output_type", handler.LastBody, StringComparison.Ordinal);
        Assert.DoesNotContain("json_options", handler.LastBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Structured_extraction_sends_the_schema_and_returns_the_raw_json()
    {
        var handler = new RecordingHandler();
        handler.Enqueue(HttpStatusCode.OK, """
            {
              "record_id": "1", "status": "completed",
              "result": { "markdown": null, "json": { "content": { "invoiceNumber": "F-1" } } }
            }
            """);

        var result = await CreateSut(handler).ExtractAsync(
            Request(DocStrangeOutput.Json) with { JsonSchema = """{"type":"object"}""" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Rendu RE-SERIALISE : l'appelant le desserialise avec ses propres controles.
        Assert.Contains("\"invoiceNumber\"", result.Value.Content, StringComparison.Ordinal);
        Assert.Contains("name=\"json_options\"", handler.LastBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Structured_extraction_without_a_schema_is_refused_before_any_call()
    {
        var handler = new RecordingHandler();

        var result = await CreateSut(handler).ExtractAsync(Request(DocStrangeOutput.Json), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(0, handler.SendCount);
    }

    [Fact]
    public async Task A_missing_key_is_refused_before_any_call()
    {
        var handler = new RecordingHandler();

        var result = await CreateSut(handler).ExtractAsync(
            Request(DocStrangeOutput.Markdown) with { ApiKey = "" }, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(0, handler.SendCount);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "refus")]
    [InlineData(HttpStatusCode.TooManyRequests, "quota")]
    [InlineData(HttpStatusCode.InternalServerError, "échoué")]
    public async Task Provider_errors_are_mapped_to_a_stable_message(HttpStatusCode status, string expected)
    {
        var handler = new RecordingHandler();
        // Corps du fournisseur contenant un detail technique ET quelque chose qui ressemble a un secret.
        handler.Enqueue(status, $$"""
            {"detail":"Authentication required. Please provide a valid API key or sign in. token={{Key}}"}
            """);

        var result = await CreateSut(handler).ExtractAsync(Request(DocStrangeOutput.Markdown), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains(expected, result.Error.Description, StringComparison.OrdinalIgnoreCase);

        // Ni la cle, ni le corps brut du fournisseur ne doivent atteindre l'utilisateur.
        Assert.DoesNotContain(Key, result.Error.Description, StringComparison.Ordinal);
        Assert.DoesNotContain("Authentication required", result.Error.Description, StringComparison.Ordinal);
        Assert.DoesNotContain("detail", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_success_without_content_is_a_failure_not_an_empty_reading()
    {
        var handler = new RecordingHandler();
        handler.Enqueue(HttpStatusCode.OK, """
            {"record_id":"1","status":"completed","result":{"markdown":null,"json":null}}
            """);

        var result = await CreateSut(handler).ExtractAsync(Request(DocStrangeOutput.Markdown), CancellationToken.None);

        // Une page « lue » mais vide serait bien pire qu'un echec : elle passerait pour un
        // releve sans operation. Voir la correction c1c28e76.
        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task An_unreachable_provider_is_a_failure_and_never_throws()
    {
        var handler = new RecordingHandler { Throw = new HttpRequestException("socket") };

        var result = await CreateSut(handler).ExtractAsync(Request(DocStrangeOutput.Markdown), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("injoignable", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("socket", result.Error.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_unreadable_body_is_a_failure_not_an_exception()
    {
        var handler = new RecordingHandler();
        handler.Enqueue(HttpStatusCode.OK, "<html>maintenance</html>");

        var result = await CreateSut(handler).ExtractAsync(Request(DocStrangeOutput.Markdown), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.DoesNotContain("maintenance", result.Error.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_file_name_sent_in_the_multipart_cannot_inject_a_header()
    {
        var handler = new RecordingHandler();
        handler.Enqueue(HttpStatusCode.OK, """{"result":{"markdown":{"content":"ok"}}}""");

        await CreateSut(handler).ExtractAsync(
            Request(DocStrangeOutput.Markdown) with { FileName = "fac\"\r\nX-Evil: 1.pdf" },
            CancellationToken.None);

        Assert.DoesNotContain("\r\nX-Evil", handler.LastBody, StringComparison.Ordinal);
        Assert.Contains("filename=\"facX-Evil 1.pdf\"", handler.LastBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("Facture 592.pdf", "Facture 592.pdf")]
    [InlineData("fac\"\r\nX-Evil: 1.pdf", "facX-Evil 1.pdf")]
    [InlineData("..\\..\\etc/passwd.pdf", "....etcpasswd.pdf")]
    [InlineData("", DocStrangeHttpClient.FallbackFileName)]
    [InlineData("   ", DocStrangeHttpClient.FallbackFileName)]
    [InlineData("\"\"::", DocStrangeHttpClient.FallbackFileName)]
    [InlineData(null, DocStrangeHttpClient.FallbackFileName)]
    public void SanitizeFileName_keeps_normal_names_and_cleans_dangerous_ones(string? input, string expected)
    {
        Assert.Equal(expected, DocStrangeHttpClient.SanitizeFileName(input));
    }

    [Fact]
    public void SanitizeFileName_truncates_long_names_and_keeps_the_extension()
    {
        var sanitized = DocStrangeHttpClient.SanitizeFileName(new string('a', 300) + ".pdf");

        Assert.Equal(DocStrangeHttpClient.MaxFileNameLength, sanitized.Length);
        Assert.EndsWith(".pdf", sanitized, StringComparison.Ordinal);
    }

    // ---- outillage -----------------------------------------------------------------------

    private static DocStrangeExtractRequest Request(DocStrangeOutput output) =>
        new(
            BaseUrl: "https://extraction-api.nanonets.com",
            ApiKey: Key,
            File: new MemoryStream(Encoding.UTF8.GetBytes("%PDF-1.4 fake")),
            FileName: "page.pdf",
            ContentType: "application/pdf",
            Output: output);

    private static DocStrangeHttpClient CreateSut(RecordingHandler handler)
    {
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(x => x.CreateClient(It.IsAny<string>()))
            .Returns(() => new HttpClient(handler, disposeHandler: false) { Timeout = TimeSpan.FromSeconds(30) });

        return new DocStrangeHttpClient(
            factory.Object,
            Options.Create(new DocStrangeSettings { DefaultBaseUrl = "https://extraction-api.nanonets.com" }),
            NullLogger<DocStrangeHttpClient>.Instance);
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses = new();

        public Exception? Throw { get; init; }
        public int SendCount { get; private set; }
        public string? LastUrl { get; private set; }
        public string? LastAuthScheme { get; private set; }
        public string? LastAuthParameter { get; private set; }
        public string LastBody { get; private set; } = "";

        public void Enqueue(HttpStatusCode status, string body) =>
            _responses.Enqueue(new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            });

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            SendCount++;
            LastUrl = request.RequestUri?.ToString();
            LastAuthScheme = request.Headers.Authorization?.Scheme;
            LastAuthParameter = request.Headers.Authorization?.Parameter;
            LastBody = request.Content is null
                ? ""
                : await request.Content.ReadAsStringAsync(cancellationToken);

            if (Throw is not null)
                throw Throw;

            return _responses.Dequeue();
        }
    }
}
