using FactuTrust.Application.Common.Files;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Common;

/// <summary>
/// CWE-434 hardening: <see cref="UploadValidator"/> is the shared allow-list + magic-bytes gate for
/// user-supplied attachments (project attachments, honoraires billing attachments).
/// </summary>
public sealed class UploadValidatorTests
{
    private static readonly byte[] ValidPdfHeader = "%PDF-1.4"u8.ToArray();
    private static readonly byte[] ValidPngHeader = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0 };
    private static readonly byte[] PeExecutableHeader = { 0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00 }; // "MZ..."

    [Fact]
    public void Accepts_valid_pdf()
    {
        var result = UploadValidator.Validate("invoice.pdf", "application/pdf", 1024, ValidPdfHeader);

        Assert.True(result.IsValid);
        Assert.Equal("invoice.pdf", result.SafeFileName);
    }

    [Fact]
    public void Rejects_forbidden_extension()
    {
        var result = UploadValidator.Validate("script.exe", "application/octet-stream", 10, PeExecutableHeader);

        Assert.False(result.IsValid);
    }

    [Theory]
    [InlineData("invoice.exe.pdf")]
    [InlineData("report.php.csv")]
    [InlineData("photo.html.png")]
    public void Rejects_double_extension(string fileName)
    {
        // The dangerous extension is the INTERMEDIATE segment here (the classic smuggling shape:
        // some consumer may execute based on an earlier extension while another only looks at the
        // last one) — not the final one, which is itself allow-listed.
        var result = UploadValidator.Validate(fileName, "application/pdf", 10, ValidPdfHeader);

        Assert.False(result.IsValid);
        Assert.Contains("double extension", result.ErrorMessage);
    }

    [Fact]
    public void Rejects_content_type_mismatched_with_extension()
    {
        // .pdf extension but a Content-Type only valid for a different extension.
        var result = UploadValidator.Validate("invoice.pdf", "image/png", 1024, ValidPdfHeader);

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Rejects_spoofed_content_with_mismatched_magic_bytes()
    {
        // Extension + declared Content-Type both say PDF, but the actual bytes are a PE executable.
        var result = UploadValidator.Validate("invoice.pdf", "application/pdf", 1024, PeExecutableHeader);

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Accepts_valid_png_with_correct_magic_bytes()
    {
        var result = UploadValidator.Validate("photo.png", "image/png", 2048, ValidPngHeader);

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Normalizes_path_traversal_attempt_in_file_name()
    {
        var result = UploadValidator.Validate("../../evil.pdf", "application/pdf", 1024, ValidPdfHeader);

        Assert.True(result.IsValid);
        Assert.Equal("evil.pdf", result.SafeFileName);
        Assert.DoesNotContain("..", result.SafeFileName);
    }

    [Fact]
    public void Rejects_oversized_file()
    {
        var result = UploadValidator.Validate("invoice.pdf", "application/pdf", 20 * 1024 * 1024, ValidPdfHeader);

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Rejects_empty_file()
    {
        var result = UploadValidator.Validate("invoice.pdf", "application/pdf", 0, ValidPdfHeader);

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Rejects_missing_file_name()
    {
        var result = UploadValidator.Validate("   ", "application/pdf", 1024, ValidPdfHeader);

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Csv_and_txt_are_accepted_without_a_magic_byte_signature_by_design()
    {
        // No reliable fixed signature exists for plain text — validated on name + declared type only.
        Assert.Contains(".csv", UploadValidator.ExtensionsWithoutMagicByteCheck);
        Assert.Contains(".txt", UploadValidator.ExtensionsWithoutMagicByteCheck);

        var csvBytes = "id,name\n1,foo\n"u8.ToArray();
        var result = UploadValidator.Validate("export.csv", "text/csv", 14, csvBytes);

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Rejects_zip_declared_but_not_actually_a_zip_container()
    {
        var result = UploadValidator.Validate("bundle.zip", "application/zip", 100, ValidPdfHeader);

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Accepts_docx_with_zip_signature()
    {
        byte[] zipHeader = { 0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0 }; // "PK\x03\x04"
        var result = UploadValidator.Validate(
            "contract.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            2048,
            zipHeader);

        Assert.True(result.IsValid);
    }

    // ---------- NormalizeDeclaredContentType (code review item 1) ----------

    [Theory]
    [InlineData("application/octet-stream", ".pdf", "application/pdf")]
    [InlineData("", ".pdf", "application/pdf")]
    [InlineData("application/octet-stream", ".jpg", "image/jpeg")]
    [InlineData("image/jpg", ".jpg", "image/jpeg")]
    [InlineData("image/pjpeg", ".jpeg", "image/jpeg")]
    [InlineData("application/octet-stream", ".png", "image/png")]
    public void NormalizeDeclaredContentType_maps_generic_or_legacy_types_to_the_canonical_type(
        string declared, string extension, string expected)
    {
        Assert.Equal(expected, UploadValidator.NormalizeDeclaredContentType(declared, extension));
    }

    [Fact]
    public void NormalizeDeclaredContentType_fixes_up_case_variants_of_the_allowed_type()
    {
        Assert.Equal("application/pdf", UploadValidator.NormalizeDeclaredContentType("APPLICATION/PDF", ".pdf"));
    }

    [Fact]
    public void NormalizeDeclaredContentType_leaves_an_unrelated_declared_type_untouched()
    {
        // Not generic/legacy and not a recognized case-variant of an allowed type for this
        // extension — Validate's own allow-list check still rejects the mismatch afterwards.
        Assert.Equal("image/png", UploadValidator.NormalizeDeclaredContentType("image/png", ".pdf"));
    }

    [Theory]
    [InlineData("application/pdf", ".pdf", "application/pdf")]
    [InlineData("application/octet-stream", null, "application/octet-stream")]
    public void NormalizeDeclaredContentType_handles_already_correct_or_missing_extension(
        string declared, string? extension, string expected)
    {
        Assert.Equal(expected, UploadValidator.NormalizeDeclaredContentType(declared, extension));
    }

    [Fact]
    public void Accepts_pdf_with_octet_stream_content_type_after_normalization()
    {
        var normalized = UploadValidator.NormalizeDeclaredContentType("application/octet-stream", ".pdf");
        var result = UploadValidator.Validate("bon.pdf", normalized, 1024, ValidPdfHeader);

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Accepts_jpg_with_legacy_image_jpg_content_type_after_normalization()
    {
        byte[] jpegHeader = { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0 };
        var normalized = UploadValidator.NormalizeDeclaredContentType("image/jpg", ".jpg");
        var result = UploadValidator.Validate("photo.jpg", normalized, 1024, jpegHeader);

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Accepts_upper_case_mime_variant_after_normalization()
    {
        var normalized = UploadValidator.NormalizeDeclaredContentType("APPLICATION/PDF", ".pdf");
        var result = UploadValidator.Validate("bon.pdf", normalized, 1024, ValidPdfHeader);

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Normalization_never_rescues_spoofed_content_from_magic_byte_rejection()
    {
        // Declared type says PDF (even after "normalization" it stays application/pdf), but the
        // actual bytes are a PE executable — the magic-byte check must still reject it.
        var normalized = UploadValidator.NormalizeDeclaredContentType("application/octet-stream", ".pdf");
        var result = UploadValidator.Validate("invoice.pdf", normalized, 1024, PeExecutableHeader);

        Assert.False(result.IsValid);
    }

    // ---------- Double-extension: same-family names accepted (code review item 1) ----------

    [Fact]
    public void Accepts_same_family_double_extension_as_a_benign_save_as_artifact()
    {
        // "scan.pdf.pdf" : the intermediate segment ".pdf" is allow-listed, not dangerous — this is
        // no longer flagged as a double-extension attack.
        var result = UploadValidator.Validate("scan.pdf.pdf", "application/pdf", 10, ValidPdfHeader);

        Assert.True(result.IsValid);
    }

    [Theory]
    [InlineData("invoice.exe.pdf")]
    [InlineData("report.php.csv")]
    [InlineData("photo.html.png")]
    public void Still_rejects_double_extension_with_a_truly_dangerous_intermediate_segment(string fileName)
    {
        var result = UploadValidator.Validate(fileName, "application/pdf", 10, ValidPdfHeader);

        Assert.False(result.IsValid);
        Assert.Contains("double extension", result.ErrorMessage);
    }
}

