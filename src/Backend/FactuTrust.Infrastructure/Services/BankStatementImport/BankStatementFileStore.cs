using FactuTrust.Application.Configuration;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Stockage des relevés importés, HORS wwwroot :
/// <c>{StorageBasePath}/tenants/{tenantId}/sessions/{sessionId}{ext}</c> pendant l'analyse, puis
/// <c>…/statements/{statementId}{ext}</c> une fois le relevé enregistré (pièce justificative du
/// journal de banque, téléchargeable seulement par un endpoint authentifié).
///
/// Les noms sont générés (identifiants) : le nom fourni par le client n'entre jamais dans un
/// chemin. Tout chemin résolu est vérifié contenu dans le dossier racine (anti-traversée).
/// </summary>
public sealed class BankStatementFileStore
{
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".csv", ".xlsx"
    };

    private readonly string _basePath;

    public BankStatementFileStore(IOptions<AccountingSettings> settings)
    {
        var configured = settings.Value.BankStatementImport.StorageBasePath;
        _basePath = Path.GetFullPath(string.IsNullOrWhiteSpace(configured) ? "App_Data/bank-statements" : configured);
    }

    public async Task<string> SaveSessionFileAsync(Guid tenantId, Guid sessionId, string extension, byte[] content, CancellationToken cancellationToken)
    {
        var relative = Path.Combine("tenants", tenantId.ToString("D"), "sessions", sessionId.ToString("N") + CheckedExtension(extension));
        var full = Resolve(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, content, cancellationToken);
        return relative;
    }

    public async Task<byte[]?> ReadAsync(string? relativePath, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
            return null;
        var full = Resolve(relativePath);
        return File.Exists(full) ? await File.ReadAllBytesAsync(full, cancellationToken) : null;
    }

    /// <summary>Déplace le fichier d'analyse vers le dossier des relevés enregistrés ; rend le nouveau chemin relatif.</summary>
    public string? MoveToStatement(Guid tenantId, string? sessionRelativePath, Guid statementId)
    {
        if (string.IsNullOrWhiteSpace(sessionRelativePath))
            return null;
        var source = Resolve(sessionRelativePath);
        if (!File.Exists(source))
            return null;

        var relative = Path.Combine("tenants", tenantId.ToString("D"), "statements",
            statementId.ToString("N") + CheckedExtension(Path.GetExtension(source)));
        var target = Resolve(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.Move(source, target, overwrite: true);
        return relative;
    }

    public void TryDelete(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
            return;
        try
        {
            var full = Resolve(relativePath);
            if (File.Exists(full))
                File.Delete(full);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            // Purge best-effort : un fichier verrouillé sera repris au prochain passage.
        }
    }

    /// <summary>Chemin absolu de <paramref name="relativePath"/>, refusé s'il sort du dossier racine.</summary>
    public string Resolve(string relativePath)
    {
        var root = _basePath.EndsWith(Path.DirectorySeparatorChar) ? _basePath : _basePath + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(_basePath, relativePath));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Chemin de stockage hors du dossier des relevés.");
        return full;
    }

    public static bool IsAllowedExtension(string? extension) =>
        !string.IsNullOrWhiteSpace(extension) && AllowedExtensions.Contains(extension);

    private static string CheckedExtension(string extension)
    {
        var ext = extension.ToLowerInvariant();
        if (!IsAllowedExtension(ext))
            throw new InvalidOperationException("Extension de relevé non autorisée.");
        return ext;
    }
}
