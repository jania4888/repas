namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Lecture IA des pages scannées d'un relevé (repli de la lecture déterministe). Exécutée en
/// tâche de fond : un modèle local lit une page en plusieurs dizaines de secondes.
/// </summary>
public interface IBankStatementAiExtraction
{
    /// <summary>Le modèle d'import est-il configuré et joignable ? Quel type de fournisseur ?</summary>
    Task<BankStatementAiAvailability> CheckAvailabilityAsync(CancellationToken cancellationToken = default);

    /// <summary>Planifie la lecture IA des pages non résolues de la session.</summary>
    void Schedule(Guid tenantId, Guid sessionId);
}

/// <param name="ProviderKind">« local » (Ollama sur le serveur) ou « external » (OpenRouter, Modal, Cursor).</param>
public sealed record BankStatementAiAvailability(bool Available, string? ProviderKind, string? ModelRef, string? Reason)
{
    public static BankStatementAiAvailability Unavailable(string reason) => new(false, null, null, reason);
}
