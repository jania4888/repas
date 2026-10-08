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

    /// <summary>Planifie la lecture IA de plusieurs sessions (même fichier multi-relevés), séquentiellement.</summary>
    void ScheduleMany(Guid tenantId, IReadOnlyList<Guid> sessionIds);
}

/// <param name="ProviderKind">« local » (Ollama sur le serveur) ou « external » (OpenRouter, Modal, Cursor).</param>
/// <param name="Reason">Cause lisible (français) quand <paramref name="Available"/> est faux.</param>
/// <param name="Engine"><c>vision</c>, <c>text</c> ou null.</param>
/// <param name="VisionModelRef">Modèle vision retenu quand <paramref name="Engine"/> = <c>vision</c>.</param>
/// <param name="VisionUnavailableReason">
/// Renseigné quand la lecture vision est activée mais que le modèle vision n'est pas prêt : le moteur
/// retombe alors sur <c>text</c> et la cause est DITE (jamais un repli muet, D2). Null si GLM-OCR est prêt
/// ou si la lecture vision est désactivée.
/// </param>
/// <param name="ReasonCode">Code stable (<see cref="BankStatementAiAvailabilityReasons"/>) de l'indisponibilité, pour le DTO et l'audit.</param>
public sealed record BankStatementAiAvailability(
    bool Available,
    string? ProviderKind,
    string? ModelRef,
    string? Reason,
    string? Engine = null,
    string? VisionModelRef = null,
    string? VisionUnavailableReason = null,
    string? ReasonCode = null)
{
    public static BankStatementAiAvailability Unavailable(string reason) => new(false, null, null, reason);

    public static BankStatementAiAvailability Unavailable(string reason, string reasonCode) =>
        new(false, null, null, reason, ReasonCode: reasonCode);

    public bool IsVision => Available && string.Equals(Engine, BankStatementAiEngines.Vision, StringComparison.Ordinal);

    /// <summary>
    /// Le service d'extraction documentaire externe lit, et lui seul : ni modèle vision local, ni
    /// modèle texte, ni parseur. Distinct d'<see cref="BankStatementAiProviderKinds.External"/>,
    /// qui désigne un fournisseur <b>LLM</b> hors plateforme et reste gouverné par
    /// <c>AiComplementAllowExternal</c>.
    /// </summary>
    public bool IsDocStrange => Available && string.Equals(ProviderKind, BankStatementAiProviderKinds.DocStrange, StringComparison.Ordinal);
}

/// <summary>
/// Valeurs de <see cref="BankStatementAiAvailability.ProviderKind"/>, persistées dans
/// <c>BankStatementImportSession.AiProviderKind</c> et publiées à l'écran de relecture.
/// </summary>
public static class BankStatementAiProviderKinds
{
    /// <summary>Moteur local (Ollama) : rien ne quitte le serveur.</summary>
    public const string Local = "local";

    /// <summary>Fournisseur <b>LLM</b> hors plateforme, gouverné par <c>AiComplementAllowExternal</c>.</summary>
    public const string External = "external";

    /// <summary>
    /// Service d'extraction documentaire externe (Docstrange). Volontairement DISTINCT de
    /// <see cref="External"/> : les gardes <c>AiComplementAllowExternal</c> ne gouvernent que les
    /// fournisseurs LLM, et confondre les deux ferait qu'ouvrir l'un ouvrirait l'autre.
    /// </summary>
    public const string DocStrange = "docstrange";
}

/// <summary>Moteurs de lecture IA d'un relevé (valeurs de <see cref="BankStatementAiAvailability.Engine"/> et de <see cref="BankStatementAiPlan.Engine"/>).</summary>
public static class BankStatementAiEngines
{
    /// <summary>GLM-OCR page par page (image).</summary>
    public const string Vision = "vision";

    /// <summary>Modèle texte local (qwen) sur le texte extrait / OCR.</summary>
    public const string Text = "text";
}

/// <summary>Codes stables d'indisponibilité de l'IA de lecture (capacités, signalements, audit).</summary>
public static class BankStatementAiAvailabilityReasons
{
    /// <summary>Moteur IA local injoignable (Ollama arrêté) ou aucun modèle configuré.</summary>
    public const string EngineUnavailable = "engine_unavailable";

    /// <summary>Modèle vision (GLM-OCR) non installé ou refusé par le vérificateur (mémoire).</summary>
    public const string VisionModelUnavailable = "vision_model_unavailable";

    /// <summary>Fournisseur IA externe non autorisé pour les relevés (<c>AiComplementAllowExternal = false</c>).</summary>
    public const string ExternalNotAllowed = "external_not_allowed";

    /// <summary>Modèle texte de repli non prêt.</summary>
    public const string TextModelUnavailable = "text_model_unavailable";
}
