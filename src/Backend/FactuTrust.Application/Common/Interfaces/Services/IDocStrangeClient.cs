using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>Format demandé à Docstrange. Voir <c>docs/developer/docstrange-api-contract.md</c>.</summary>
public enum DocStrangeOutput
{
    /// <summary>
    /// Transcription Markdown, tableaux rendus en <c>&lt;table&gt;</c> HTML. <b>Valeurs recopiées
    /// telles qu'imprimées</b> — c'est la seule voie qui préserve la virgule décimale.
    /// </summary>
    Markdown = 0,

    /// <summary>
    /// JSON conforme au schéma fourni. <b>Attention :</b> tout champ typé <c>number</c> perd la
    /// virgule décimale (« 1138,155 » revient « 1138155 »). Les montants doivent donc être typés
    /// en <c>string</c> dans le schéma, la conversion restant serveur.
    /// </summary>
    Json = 1
}

/// <param name="BaseUrl">Racine de l'API, sans barre oblique finale.</param>
/// <param name="ApiKey">Clé en clair, déchiffrée juste avant l'appel. Jamais journalisée.</param>
/// <param name="JsonSchema">JSON Schema sérialisé ; requis pour <see cref="DocStrangeOutput.Json"/>, ignoré sinon.</param>
public sealed record DocStrangeExtractRequest(
    string BaseUrl,
    string ApiKey,
    Stream File,
    string FileName,
    string ContentType,
    DocStrangeOutput Output,
    string? JsonSchema = null);

/// <param name="Content">Contenu utile : le Markdown, ou le JSON sérialisé.</param>
/// <param name="RecordId">Identifiant d'extraction du fournisseur, pour la traçabilité.</param>
/// <param name="ProcessingSeconds">Durée annoncée par le fournisseur.</param>
public sealed record DocStrangeExtraction(
    string Content,
    string? RecordId,
    double? ProcessingSeconds);

/// <summary>
/// Client HTTP du service d'extraction documentaire Docstrange (Nanonets).
///
/// <para>Sans état vis-à-vis du fournisseur : <c>BaseUrl</c> et <c>ApiKey</c> sont passés
/// <b>par appel</b>, comme <see cref="IOpenAiChatCompletionsClient"/>. Aucun secret n'est retenu
/// entre deux appels.</para>
///
/// <para>Ne lève jamais pour une erreur du fournisseur : tout est rendu en <see cref="Result"/>
/// porteur d'un message <b>stable et assaini</b>. Le corps brut de la réponse n'est jamais
/// remonté à l'utilisateur (CWE-209).</para>
/// </summary>
public interface IDocStrangeClient
{
    Task<Result<DocStrangeExtraction>> ExtractAsync(
        DocStrangeExtractRequest request,
        CancellationToken cancellationToken);
}
