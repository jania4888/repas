namespace FactuTrust.API.Controllers;

/// <summary>
/// Enveloppe de réponse JSON de fait pour l'API FactuTrust.
/// Masque volontairement <see cref="FactuTrust.Application.DTOs.ApiResponse{T}"/> pour les
/// contrôleurs déclarés dans ce namespace ou ses namespaces enfants (.Projects, .Studio, .Honoraires).
/// Contrat wire : <c>success</c>, <c>data</c>, <c>message</c>, <c>error</c> (singulier).
/// </summary>
public sealed record ApiResponse<T>
{
    public bool Success { get; init; }
    public T? Data { get; init; }
    public string? Message { get; init; }
    public string? Error { get; init; }

    public static ApiResponse<T> Ok(T data, string? message = null) => new()
    {
        Success = true,
        Data = data,
        Message = message
    };

    /// <summary>
    /// Note : le paramètre <paramref name="code"/> est accepté pour compatibilité d'appel mais
    /// n'est pas sérialisé — ce type n'expose pas de propriété <c>Code</c>. Pour faire parvenir
    /// une référence de corrélation au client, l'inclure dans <paramref name="error"/>.
    ///
    /// <para>
    /// <b>N'ajoutez pas de propriété <c>Code</c> ici sans revue dédiée</b> : ~258 sites d'appel
    /// passent aujourd'hui un <c>code</c> silencieusement abandonné, dont au moins un
    /// (<c>TENANT_MIGRATION_FAILED</c>) sur lequel <c>error-handler.service.ts</c> de
    /// l'application web branche pour substituer un autre message — les exposer d'un coup
    /// changerait des textes visibles côté public.
    /// </para>
    ///
    /// <para>
    /// <c>Message</c> reçoit la même chaîne que <c>Error</c> : les clients qui lisent
    /// <c>message</c> (le champ de l'enveloppe <c>Application.DTOs</c>) obtiennent ainsi le motif
    /// réel de l'échec au lieu de <c>null</c>. <c>Error</c> reste renseigné pour les consommateurs
    /// existants.
    /// </para>
    /// </summary>
    public static ApiResponse<T> Fail(string error, string? code = null) => new()
    {
        Success = false,
        Message = error,
        Error = error
    };
}
