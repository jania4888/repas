using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities.CompanySupport;

public sealed class CompanySupportAttachment : Entity
{
    public const int FileNameMaxLength = 260;
    public const int StoragePathMaxLength = 500;
    public const int ContentTypeMaxLength = 120;

    public Guid MessageId { get; private set; }
    public string FileName { get; private set; } = null!;
    public string StoragePath { get; private set; } = null!;
    public string ContentType { get; private set; } = null!;
    public long SizeBytes { get; private set; }
    public Guid UploadedByUserId { get; private set; }

    private CompanySupportAttachment() { }

    public static Result<CompanySupportAttachment> Create(
        Guid messageId,
        string fileName,
        string storagePath,
        string contentType,
        long sizeBytes,
        Guid uploadedByUserId)
    {
        if (messageId == Guid.Empty)
            return Result.Failure<CompanySupportAttachment>(Error.Validation("Message", "Message invalide"));
        if (string.IsNullOrWhiteSpace(fileName))
            return Result.Failure<CompanySupportAttachment>(Error.Validation("FileName", "Nom de fichier obligatoire"));
        if (string.IsNullOrWhiteSpace(storagePath))
            return Result.Failure<CompanySupportAttachment>(Error.Validation("StoragePath", "Chemin de stockage obligatoire"));
        if (sizeBytes <= 0)
            return Result.Failure<CompanySupportAttachment>(Error.Validation("Size", "Taille de fichier invalide"));
        if (uploadedByUserId == Guid.Empty)
            return Result.Failure<CompanySupportAttachment>(Error.Validation("Uploader", "Utilisateur invalide"));

        return Result.Success(new CompanySupportAttachment
        {
            MessageId = messageId,
            FileName = Truncate(fileName.Trim(), FileNameMaxLength),
            StoragePath = Truncate(storagePath.Trim().Replace('\\', '/'), StoragePathMaxLength),
            ContentType = Truncate(string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim(), ContentTypeMaxLength),
            SizeBytes = sizeBytes,
            UploadedByUserId = uploadedByUserId
        });
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}
