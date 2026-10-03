using FactuTrust.Application.Features.AI;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>Vérifie que les nouvelles options du pipeline gardent les défauts historiques.</summary>
public sealed class AiStructuredExtractionPipelineCompatibilityTests
{
    [Fact]
    public void Request_defaults_match_invoice_import_expectations()
    {
        var request = new AiStructuredExtractionRequest
        {
            FileStream = Stream.Null,
            FileName = "x.pdf",
            ContentType = "application/pdf",
            SystemPrompt = "p"
        };

        Assert.True(request.IncludeExtractedTextWithImages);
        Assert.False(request.RequireVision);
        Assert.Null(request.VisionModelOverride);
        Assert.Null(request.MaxOutputTokens);
        Assert.Null(request.RenderDpi);
    }
}
