using FactuTrust.Infrastructure.Services.BankStatementImport;
using SkiaSharp;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

public sealed class BankStatementImageMegapixelGuardTests
{
    [Fact]
    public void Tiny_png_does_not_exceed_limit()
    {
        var png = EncodePng(10, 10);

        Assert.False(BankStatementImageMegapixelGuard.ExceedsMegapixelLimit(png, maxMegapixels: 1));
    }

    [Fact]
    public void Large_png_exceeds_limit()
    {
        // 1 200 × 1 000 = 1,2 Mpx > 1 Mpx.
        var png = EncodePng(1200, 1000);

        Assert.True(BankStatementImageMegapixelGuard.ExceedsMegapixelLimit(png, maxMegapixels: 1));
    }

    [Fact]
    public void Unreadable_content_is_rejected_fail_closed()
    {
        // Garde fermée : contenu non décodable (pas d'en-tête image) => considéré comme trop grand.
        var garbage = new byte[] { 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09 };

        Assert.True(BankStatementImageMegapixelGuard.ExceedsMegapixelLimit(garbage, maxMegapixels: 1));
    }

    [Fact]
    public void Empty_content_is_rejected_fail_closed()
    {
        Assert.True(BankStatementImageMegapixelGuard.ExceedsMegapixelLimit(ReadOnlySpan<byte>.Empty, maxMegapixels: 1));
    }

    [Fact]
    public void Disabled_limit_lets_unreadable_content_through()
    {
        // Limite nulle = garde désactivée par configuration : aucune image n'est refusée ici.
        var garbage = new byte[] { 0x00, 0x01, 0x02, 0x03 };

        Assert.False(BankStatementImageMegapixelGuard.ExceedsMegapixelLimit(garbage, maxMegapixels: 0));
    }

    private static byte[] EncodePng(int width, int height)
    {
        using var surface = SKSurface.Create(new SKImageInfo(width, height));
        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        Assert.NotNull(data);
        return data.ToArray();
    }
}
