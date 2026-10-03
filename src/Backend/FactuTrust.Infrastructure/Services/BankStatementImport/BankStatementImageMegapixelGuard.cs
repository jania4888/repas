using SkiaSharp;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

internal static class BankStatementImageMegapixelGuard
{
    internal static bool ExceedsMegapixelLimit(ReadOnlySpan<byte> content, int maxMegapixels)
    {
        if (maxMegapixels <= 0)
            return false;

        try
        {
            using var codec = SKCodec.Create(new MemoryStream(content.ToArray()));
            if (codec is null)
                return false;

            var info = codec.Info;
            if (info.Width <= 0 || info.Height <= 0)
                return false;

            var pixels = (long)info.Width * info.Height;
            return pixels > (long)maxMegapixels * 1_000_000;
        }
        catch
        {
            return false;
        }
    }
}
