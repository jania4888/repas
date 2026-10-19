namespace FactuTrust.Application.Common.Files;

/// <summary>
/// Shared upload validation (CWE-434 hardening) for attachment endpoints that accept arbitrary
/// user-supplied files (project attachments, honoraires billing attachments, etc.).
///
/// Defense layers, in order:
/// 1. File name normalization via <see cref="Path.GetFileName(string)"/> (strips any directory
///    component — callers MUST use the returned <see cref="ValidationResult.SafeFileName"/>, never
///    the raw client-supplied name, when building storage paths).
/// 2. Double-extension rejection (e.g. <c>invoice.pdf.exe</c>, <c>report.csv.php</c>): any
///    intermediate "extension-shaped" segment that matches a known allow-listed or known-dangerous
///    extension is rejected, even if the final extension alone would be allowed.
/// 3. Extension + declared Content-Type allow-list (both must match one of the configured pairs).
/// 4. Size cap.
/// 5. Magic-byte signature check for binary formats that have a reliable signature: PDF (<c>%PDF</c>),
///    PNG, JPEG, GIF, WEBP, and ZIP/Office-Open-XML (<c>docx</c>/<c>xlsx</c>/<c>pptx</c>/<c>zip</c>,
///    all ZIP containers starting with <c>PK</c>). This catches a renamed/spoofed binary (e.g. an
///    executable saved with a <c>.pdf</c> extension and a forged Content-Type header) that steps
///    1-4 alone would not detect.
///
/// IMPORTANT — formats with NO reliable magic-byte signature (<c>.csv</c>, <c>.txt</c>: plain text,
/// no fixed header) are validated on name + declared Content-Type ONLY. This is a known, accepted
/// limitation for those two extensions, not an oversight: a malicious payload that is valid UTF-8/
/// ASCII text cannot be told apart from a legitimate CSV/TXT by signature alone. Callers that store
/// such files should still avoid ever executing or including them as script/HTML.
/// </summary>
public static class UploadValidator
{
    public const long DefaultMaxSizeBytes = 10 * 1024 * 1024; // 10 MB

    /// <summary>Number of leading bytes callers should read from the upload stream for <see cref="Validate"/>.</summary>
    public const int RequiredHeaderBytes = 16;

    public readonly record struct ValidationResult(bool IsValid, string? ErrorMessage, string? SafeFileName)
    {
        public static ValidationResult Success(string safeFileName) => new(true, null, safeFileName);
        public static ValidationResult Failure(string message) => new(false, message, null);
    }

    /// <summary>Allow-listed extension → declared Content-Type(s) accepted for that extension.</summary>
    private static readonly IReadOnlyDictionary<string, string[]> AllowedExtensionsToContentTypes =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            [".pdf"] = new[] { "application/pdf" },
            [".png"] = new[] { "image/png" },
            [".jpg"] = new[] { "image/jpeg" },
            [".jpeg"] = new[] { "image/jpeg" },
            [".gif"] = new[] { "image/gif" },
            [".webp"] = new[] { "image/webp" },
            [".doc"] = new[] { "application/msword" },
            [".docx"] = new[] { "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            [".xls"] = new[] { "application/vnd.ms-excel" },
            [".xlsx"] = new[] { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            [".ppt"] = new[] { "application/vnd.ms-powerpoint" },
            [".pptx"] = new[] { "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
            [".zip"] = new[] { "application/zip", "application/x-zip-compressed" },
            [".csv"] = new[] { "text/csv", "application/vnd.ms-excel", "text/plain" },
            [".txt"] = new[] { "text/plain" },
        };

    /// <summary>
    /// Extensions never accepted, used only to detect double-extension smuggling
    /// (e.g. <c>invoice.pdf.php</c>) — these are NOT part of the allow-list above.
    /// </summary>
    private static readonly IReadOnlySet<string> KnownDangerousExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".dll", ".msi", ".bat", ".cmd", ".sh", ".ps1", ".vbs", ".js",
        ".php", ".php3", ".php4", ".php5", ".phtml", ".pht",
        ".asp", ".aspx", ".jsp", ".jspx", ".cgi", ".htm", ".html", ".svg",
    };

    /// <summary>
    /// Browsers/clients commonly send a loose, generic, or legacy Content-Type for perfectly
    /// legitimate files (empty header, the catch-all <c>application/octet-stream</c>, or the
    /// pre-RFC JPEG aliases <c>image/jpg</c> / <c>image/pjpeg</c>). Rejecting those outright is a
    /// functional regression, not a security gain — the extension + magic-byte checks already
    /// catch a genuinely spoofed file. These are normalized to the extension's expected type by
    /// <see cref="NormalizeDeclaredContentType"/> before <see cref="Validate"/> runs.
    /// </summary>
    private static readonly IReadOnlySet<string> GenericOrLegacyContentTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        string.Empty, "application/octet-stream", "image/jpg", "image/pjpeg",
    };

    /// <summary>Canonical Content-Type derived from the extension alone, for <see cref="NormalizeDeclaredContentType"/>.</summary>
    private static readonly IReadOnlyDictionary<string, string> CanonicalContentTypeByExtension =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [".pdf"] = "application/pdf",
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".png"] = "image/png",
        };

    /// <summary>
    /// Normalizes a client-declared Content-Type before it reaches <see cref="Validate"/>:
    /// <list type="bullet">
    /// <item>empty, <c>application/octet-stream</c>, or a legacy JPEG alias
    /// (<c>image/jpg</c> / <c>image/pjpeg</c>) is replaced by the type <paramref name="extension"/>
    /// is expected to carry (PDF/JPEG/PNG only — other extensions are returned unchanged, since
    /// <see cref="Validate"/> already rejects their mismatches on its own allow-list);</item>
    /// <item>a case variant of the extension's allowed type (e.g. <c>APPLICATION/PDF</c>) is
    /// rewritten to the canonical casing so the exact-match allow-list in <see cref="Validate"/>
    /// still accepts it.</item>
    /// </list>
    /// Magic bytes still decide the final verdict — this only stops a sloppy-but-honest
    /// Content-Type header from rejecting a legitimate upload.
    /// </summary>
    public static string NormalizeDeclaredContentType(string? declaredContentType, string? extension)
    {
        var trimmed = (declaredContentType ?? string.Empty).Trim();
        var ext = extension ?? string.Empty;

        if (GenericOrLegacyContentTypes.Contains(trimmed)
            && CanonicalContentTypeByExtension.TryGetValue(ext, out var derived))
            return derived;

        if (AllowedExtensionsToContentTypes.TryGetValue(ext, out var allowed))
        {
            var canonicalCasing = Array.Find(allowed, t => string.Equals(t, trimmed, StringComparison.OrdinalIgnoreCase));
            if (canonicalCasing is not null)
                return canonicalCasing;
        }

        return trimmed;
    }

    /// <summary>Extensions with a fixed, reliable magic-byte signature we can verify.</summary>
    private static readonly IReadOnlyDictionary<string, Func<ReadOnlyMemory<byte>, bool>> MagicByteCheckers =
        new Dictionary<string, Func<ReadOnlyMemory<byte>, bool>>(StringComparer.OrdinalIgnoreCase)
        {
            [".pdf"] = header => StartsWith(header, 0x25, 0x50, 0x44, 0x46), // %PDF
            [".png"] = header => StartsWith(header, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A),
            [".jpg"] = IsJpeg,
            [".jpeg"] = IsJpeg,
            [".gif"] = header => StartsWith(header, 0x47, 0x49, 0x46, 0x38), // "GIF8"
            [".webp"] = IsWebp,
            // ZIP / Office Open XML (docx/xlsx/pptx are ZIP containers) — "PK\x03\x04" (also empty/spanned archives).
            [".zip"] = IsZip,
            [".docx"] = IsZip,
            [".xlsx"] = IsZip,
            [".pptx"] = IsZip,
        };

    /// <summary>Extensions intentionally left without a magic-byte check (see class doc comment).</summary>
    public static readonly IReadOnlySet<string> ExtensionsWithoutMagicByteCheck = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        ".csv", ".txt", ".doc", ".xls", ".ppt", // legacy binary Office (OLE/CFBF) not checked here
    };

    private static bool IsJpeg(ReadOnlyMemory<byte> header) => StartsWith(header, 0xFF, 0xD8, 0xFF);

    private static bool IsWebp(ReadOnlyMemory<byte> header)
    {
        if (header.Length < 12) return false;
        var span = header.Span;
        return span[0] == (byte)'R' && span[1] == (byte)'I' && span[2] == (byte)'F' && span[3] == (byte)'F'
            && span[8] == (byte)'W' && span[9] == (byte)'E' && span[10] == (byte)'B' && span[11] == (byte)'P';
    }

    private static bool IsZip(ReadOnlyMemory<byte> header)
    {
        if (header.Length < 4) return false;
        var span = header.Span;
        if (span[0] != 0x50 || span[1] != 0x4B) return false; // "PK"
        return span[2] is 0x03 or 0x05 or 0x07; // local file header / empty archive / spanned archive
    }

    /// <summary>
    /// True only if <paramref name="extension"/> has a known magic-byte signature and
    /// <paramref name="header"/> matches it — fails closed for unknown extensions. Shared by
    /// callers (e.g. Studio file storage) that do their own extension/MIME allow-listing but
    /// still need the signature check.
    /// </summary>
    public static bool MatchesMagicBytes(string extension, ReadOnlyMemory<byte> header) =>
        MagicByteCheckers.TryGetValue(extension, out var checker) && checker(header);

    private static bool StartsWith(ReadOnlyMemory<byte> header, params byte[] signature)
    {
        if (header.Length < signature.Length) return false;
        var span = header.Span;
        for (var i = 0; i < signature.Length; i++)
        {
            if (span[i] != signature[i]) return false;
        }
        return true;
    }

    /// <summary>
    /// Reads up to <paramref name="requiredLength"/> bytes from the start of <paramref name="stream"/>,
    /// looping until either that many bytes have been read or the stream reaches EOF (a
    /// <see cref="Stream.ReadAsync(Memory{byte}, CancellationToken)"/> call returns 0).
    ///
    /// A single <c>ReadAsync</c> call is NOT guaranteed to fill the requested buffer — it may return
    /// fewer bytes than asked for before EOF, which is standard .NET stream semantics and especially
    /// relevant for chunked/network streams. Callers that used only the byte count from one call as
    /// "the header" could incorrectly reject a valid upload (magic-byte mismatch) simply because a
    /// slow/chunked stream happened to deliver the signature bytes across more than one read.
    /// </summary>
    /// <returns>
    /// The buffer (always exactly <paramref name="requiredLength"/> bytes long) and the number of
    /// bytes actually populated at its start (fewer than <paramref name="requiredLength"/> only if
    /// the stream reached EOF first, e.g. for a file smaller than the header size).
    /// </returns>
    public static async Task<(byte[] Buffer, int BytesRead)> ReadHeaderAsync(
        Stream stream, int requiredLength, CancellationToken cancellationToken = default)
    {
        var buffer = new byte[requiredLength];
        var totalRead = 0;
        while (totalRead < requiredLength)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(totalRead, requiredLength - totalRead), cancellationToken);
            if (read == 0) break; // EOF
            totalRead += read;
        }
        return (buffer, totalRead);
    }

    /// <summary>
    /// Validates an upload's name, declared extension/Content-Type pair, size, and (where a reliable
    /// signature exists) magic bytes. Does not read the whole stream — callers should pass at least
    /// <see cref="RequiredHeaderBytes"/> bytes read from the START of the stream in <paramref name="header"/>
    /// (fewer is fine for small files; the checkers below tolerate shorter spans by failing closed).
    /// </summary>
    public static ValidationResult Validate(
        string? fileName,
        string? contentType,
        long sizeBytes,
        ReadOnlyMemory<byte> header,
        long maxSizeBytes = DefaultMaxSizeBytes)
    {
        var safeName = Path.GetFileName(fileName ?? string.Empty);
        if (string.IsNullOrWhiteSpace(safeName))
            return ValidationResult.Failure("Le nom du fichier est obligatoire.");

        if (sizeBytes <= 0)
            return ValidationResult.Failure("Le fichier est vide.");
        if (sizeBytes > maxSizeBytes)
            return ValidationResult.Failure($"Fichier trop volumineux (max {maxSizeBytes / (1024 * 1024)} Mo).");

        var doubleExtensionError = CheckForDoubleExtension(safeName);
        if (doubleExtensionError is not null)
            return ValidationResult.Failure(doubleExtensionError);

        var ext = Path.GetExtension(safeName);
        if (string.IsNullOrEmpty(ext) || !AllowedExtensionsToContentTypes.TryGetValue(ext, out var allowedTypes))
            return ValidationResult.Failure("Extension de fichier non autorisée.");

        if (string.IsNullOrWhiteSpace(contentType) || !allowedTypes.Contains(contentType.Trim()))
            return ValidationResult.Failure("Type de contenu (Content-Type) non autorisé pour cette extension.");

        if (MagicByteCheckers.TryGetValue(ext, out var checker) && !checker(header))
            return ValidationResult.Failure("Le contenu du fichier ne correspond pas à l'extension déclarée.");

        return ValidationResult.Success(safeName);
    }

    /// <summary>
    /// Rejects names with an intermediate "extension-shaped" segment that is itself known-dangerous,
    /// e.g. <c>invoice.exe.pdf</c> or <c>report.php.csv</c> — the attacker relies on some consumer
    /// looking only at the LAST extension while a web server executes an earlier one.
    ///
    /// Only <see cref="KnownDangerousExtensions"/> trigger this: an intermediate segment that is
    /// merely allow-listed (e.g. <c>scan.pdf.pdf</c>, a common artifact of "Save As" re-appending
    /// the extension) is harmless and must still be accepted — none of the allow-listed extensions
    /// are ever treated as executable by this application.
    /// </summary>
    private static string? CheckForDoubleExtension(string safeName)
    {
        var parts = safeName.Split('.');
        if (parts.Length <= 2) return null; // "name.ext" — nothing to check

        for (var i = 1; i < parts.Length - 1; i++)
        {
            var candidate = "." + parts[i];
            if (KnownDangerousExtensions.Contains(candidate))
                return "Nom de fichier avec double extension non autorisé.";
        }

        return null;
    }
}
