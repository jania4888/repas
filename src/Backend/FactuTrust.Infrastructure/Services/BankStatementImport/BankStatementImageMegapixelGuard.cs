using SkiaSharp;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Garde « image trop grande » des relevés image, FERMÉE par défaut : une image dont les dimensions ne
/// se lisent pas (codec inconnu, en-tête corrompu, exception) est traitée comme dépassant la limite.
/// On ne décode jamais une image dont on ne connaît pas la taille. Seule une limite nulle ou négative
/// (garde désactivée par configuration) laisse passer.
/// </summary>
internal static class BankStatementImageMegapixelGuard
{
    internal static bool ExceedsMegapixelLimit(ReadOnlySpan<byte> content, int maxMegapixels)
    {
        if (maxMegapixels <= 0)
            return false;

        if (content.IsEmpty)
            return true;

        try
        {
            using var codec = SKCodec.Create(new MemoryStream(content.ToArray()));
            if (codec is null)
                return true;

            var info = codec.Info;
            if (info.Width <= 0 || info.Height <= 0)
                return true;

            var pixels = (long)info.Width * info.Height;
            return pixels > (long)maxMegapixels * 1_000_000;
        }
        catch
        {
            return true;
        }
    }
}
