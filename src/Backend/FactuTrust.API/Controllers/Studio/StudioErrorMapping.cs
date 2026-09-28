using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Common;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers.Studio;

/// <summary>
/// Mappage Result → IActionResult pour les NOUVEAUX endpoints Studio (workbench P0 et suivants).
/// Les actions historiques gardent leur comportement d'origine (404/400) et n'utilisent pas ce
/// helper. Codes reconnus : <c>Conflict</c> ⇒ 409, <c>Unauthorized</c> ⇒ 401, <c>Forbidden</c>
/// ⇒ 403, <c>*.NotFound</c> ⇒ 404, <see cref="StudioErrorCodes.RecordDuplicateLink"/> ⇒ 409,
/// tout le reste (dont <c>Validation.*</c>) ⇒ 400.
/// <para>
/// Le code de l'erreur est toujours transmis (<c>code</c> de l'enveloppe) : le client s'appuie sur
/// lui, jamais sur le texte du message, qui peut être traduit (ex. <c>Validation.Plan</c> pour la
/// limite du plan).
/// </para>
/// </summary>
internal static class StudioErrorMapping
{
    public static IActionResult ToActionResult<T>(
        ControllerBase controller, Result<T> result, Func<T, IActionResult> ok) =>
        result.IsSuccess ? ok(result.Value) : Map(controller, result.Error);

    public static IActionResult Map(ControllerBase controller, Error error) => error.Code switch
    {
        "Conflict" => controller.Conflict(Body(error)),
        StudioErrorCodes.RecordDuplicateLink => controller.Conflict(Body(error)),
        "Unauthorized" => controller.StatusCode(StatusCodes.Status401Unauthorized, Body(error)),
        "Forbidden" => controller.StatusCode(StatusCodes.Status403Forbidden, Body(error)),
        var code when code.EndsWith(".NotFound", StringComparison.Ordinal)
            || string.Equals(code, "NotFound", StringComparison.Ordinal) =>
            controller.NotFound(Body(error)),
        _ => controller.BadRequest(Body(error)),
    };

    private static ApiResponse<string> Body(Error error) =>
        string.IsNullOrEmpty(error.Code)
            ? ApiResponse<string>.Fail(error.Description)
            : ApiResponse<string>.FailWithCode(error.Description, error.Code);
}
