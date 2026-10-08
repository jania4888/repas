namespace FactuTrust.Application.Configuration;

/// <summary>
/// Réglages NON SECRETS du service d'extraction documentaire Docstrange (Nanonets).
///
/// La clé d'API ne figure volontairement PAS ici : les secrets de fournisseur IA saisis par
/// l'administrateur vivent chiffrés dans la base Master (<c>PlatformAiSettings</c>), jamais dans
/// appsettings. Voir <c>docs/developer/secrets-configuration.md</c>.
///
/// Docstrange n'est pas un LLM conversationnel : il est absent de <c>LlmProviderKind</c> et de
/// <c>ModelRef</c>, et ne se choisit pas comme un modèle.
/// </summary>
public sealed class DocStrangeSettings
{
    public const string SectionName = "DocStrange";

    /// <summary>
    /// Racine de l'API, sans barre oblique finale. Vide = le back-office doit fournir l'URL.
    /// </summary>
    public string DefaultBaseUrl { get; set; } = string.Empty;

    /// <summary>Délai d'un appel d'extraction, en secondes (borné 30 à 600 à l'usage).</summary>
    public int TimeoutSeconds { get; set; } = 300;

    /// <summary>
    /// Nombre de pages au-delà duquel l'extraction passe par la voie asynchrone (sondage par
    /// identifiant d'enregistrement) plutôt que synchrone. Valeur annoncée par le fournisseur.
    /// </summary>
    public int SyncPageThreshold { get; set; } = 5;

    /// <summary>Intervalle de sondage du résultat asynchrone, en secondes.</summary>
    public int AsyncPollIntervalSeconds { get; set; } = 3;

    /// <summary>Attente maximale d'un résultat asynchrone, en secondes.</summary>
    public int AsyncMaxWaitSeconds { get; set; } = 600;
}
