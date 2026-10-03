using FactuTrust.Infrastructure.Services.BankStatementImport;
using SkiaSharp;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

public sealed class BankStatementImageMegapixelGuardTests
{
    [Fact]
    public void Tiny_png_does_not_exceed_limit()
    {
        using var surface = SKSurface.Create(new SKImageInfo(10, 10));
        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        Assert.NotNull(data);

        Assert.False(BankStatementImageMegapixelGuard.ExceedsMegapixelLimit(data.ToArray(), maxMegapixels: 1));
    }
}
