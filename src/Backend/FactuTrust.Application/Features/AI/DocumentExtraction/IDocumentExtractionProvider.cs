using System.Text.Json;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Features.AI.DocumentExtraction;

/// <summary>
/// Service d'extraction documentaire externe, consulté <b>au-dessus</b> du pipeline LLM.
///
/// <para><b>Pourquoi une couture séparée.</b> Un tel service n'est pas un LLM conversationnel :
/// il n'a ni streaming de jetons, ni appels d'outils, ni messages système. L'ajouter à
/// <see cref="LlmProviderKind"/> obligerait à écrire une branche « non supporté » dans la dizaine
/// de <c>switch</c> exhaustifs qui pilotent le chat, la rédaction narrative et le conseil de
/// trésorerie, pour aucun bénéfice.</para>
///
/// <para><b>Conséquence de sécurité, à ne jamais perdre de vue.</b> Le garde-fou des relevés
/// (<c>AiComplementAllowExternal</c>) déduit « externe » de
/// <c>ParsedModelRef.Kind != LlmProviderKind.Ollama</c>, et <c>ModelRef.Parse</c> fait retomber
/// <b>tout préfixe inconnu sur Ollama</b>. Introduire un préfixe <c>docstrange:</c> ferait donc
/// classer ce service « local » et laisserait des pages de relevés partir chez un tiers en
/// silence, tests verts. Aucun fournisseur d'extraction ne doit apparaître dans
/// <c>ModelRef</c> : l'autorisation d'envoi passe par un drapeau explicite, pas par un modèle.</para>
///
/// <para>Chaque appelant reste responsable de son repli : un échec ici ne doit jamais bloquer
/// l'import, le chemin LLM existant reprend la main.</para>
/// </summary>
public interface IDocumentExtractionProvider
{
    /// <summary>Nom court du fournisseur, pour la traçabilité et l'audit (jamais un secret).</summary>
    string Name { get; }

    /// <summary>
    /// Vrai si le fournisseur est activé ET qu'une clé est configurée. Ne lève jamais : une
    /// erreur de lecture des credentials rend <c>false</c> et l'appelant garde son chemin actuel.
    /// </summary>
    Task<bool> IsAvailableAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Demande un JSON conforme à <paramref name="jsonSchema"/>. Le résultat est rendu <b>brut</b> :
    /// la désérialisation et la validation restent celles de l'appelant, pour qu'aucun contrôle
    /// existant ne soit contourné.
    /// </summary>
    Task<Result<string>> ExtractStructuredAsync(
        Stream file,
        string fileName,
        string contentType,
        JsonElement jsonSchema,
        CancellationToken cancellationToken);

    /// <summary>
    /// Demande une transcription textuelle propre du document (Markdown). Destinée aux appelants
    /// qui possèdent déjà un analyseur déterministe — pour les relevés, le texte rendu est confié
    /// à <c>BankStatementTableTextParser</c>, et le fournisseur ne fait donc que l'OCR.
    /// </summary>
    Task<Result<string>> ExtractTextAsync(
        Stream file,
        string fileName,
        string contentType,
        CancellationToken cancellationToken);
}
