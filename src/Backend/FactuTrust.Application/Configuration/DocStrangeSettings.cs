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

    // ── Relevés bancaires : plafonds propres à ce lecteur ──
    //
    // Ceux de BankStatementImportLimits (MaxAiPages = 20, VisionEstimatedSecondsPerPage = 180) sont
    // calibrés pour le modèle vision LOCAL, qui lit une page en une à trois minutes. Mesuré contre
    // l'API réelle, ce service lit une page en 6 à 35 s (voir docs/developer/docstrange-api-contract.md) :
    // appliquer les plafonds du modèle local ferait refuser des relevés qu'il lit sans peine et
    // annoncerait à l'écran un temps d'attente six fois trop long.

    /// <summary>
    /// Pages de relevé au plus par session quand ce service lit. 60 est aussi la borne haute du
    /// plafond général (<c>BankStatementImportLimits.EffectiveMaxAiPages</c>) : aucune borne à
    /// déplacer ailleurs. Le budget du travail de fond reste large — 60 pages à 35 s font 35 min,
    /// sous les 120 min par défaut.
    /// </summary>
    public int MaxStatementPages { get; set; } = 60;

    /// <summary>
    /// Durée estimée par page, en secondes, pour l'affichage du temps restant. 30 s couvre le haut
    /// de la fourchette mesurée sans promettre l'optimisme de 6 s.
    /// </summary>
    public int EstimatedSecondsPerPage { get; set; } = 30;

    /// <summary>Plafond de pages borné à la plage du plafond général (1 à 60).</summary>
    public int EffectiveMaxStatementPages => Math.Clamp(MaxStatementPages, 1, 60);

    /// <summary>Estimation bornée à la fourchette plausible d'un service d'OCR distant (5 à 300 s).</summary>
    public int EffectiveEstimatedSecondsPerPage => Math.Clamp(EstimatedSecondsPerPage, 5, 300);
}
