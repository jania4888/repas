using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.PublicContact.Commands;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Lot C — dépôt anonyme d'une demande de contact / démo depuis la landing (FR/AR).
/// Pas de journalisation ici : tout est tracé dans le handler (une seule source).
/// </summary>
[ApiController]
[Route("api/public/contact-requests")]
[AllowAnonymous]
public sealed class PublicContactRequestsController : ControllerBase
{
    private const string UnavailableMessage = "Le formulaire de contact est temporairement indisponible.";

    private readonly IMediator _mediator;
    private readonly IOptions<PublicContactOptions> _options;

    public PublicContactRequestsController(IMediator mediator, IOptions<PublicContactOptions> options)
    {
        _mediator = mediator;
        _options = options;
    }

    /// <summary>
    /// Dépose une demande de contact/démo (anonyme). Répond 202 même en cas de détection bot
    /// (pot de miel) pour ne rien révéler ; 503 quand la fonctionnalité est désactivée.
    /// </summary>
    [HttpPost]
    [EnableRateLimiting("public-contact")]
    [RequestSizeLimit(16 * 1024)]
    [Consumes("application/json")]
    [ProducesResponseType(typeof(ApiResponse<SubmitPublicContactRequestResponse>), StatusCodes.Status202Accepted)]
    [ProducesResponseType(typeof(ValidationErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Submit([FromBody] SubmitPublicContactRequestDto dto, CancellationToken cancellationToken)
    {
        if (!_options.Value.Enabled)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, ApiResponse<object>.Fail(UnavailableMessage));

        var command = new SubmitPublicContactRequestCommand(
            dto.Subject, dto.FullName, dto.Organization, dto.Email, dto.Phone, dto.Size, dto.Message, dto.Consent,
            dto.Locale, dto.Honeypot, dto.ElapsedMs, dto.TurnstileToken,
            RemoteIp: HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent: Request.Headers.UserAgent.ToString());

        var result = await _mediator.Send(command, cancellationToken);
        return result.IsSuccess
            ? Accepted(ApiResponse<SubmitPublicContactRequestResponse>.Ok(result.Value, "Demande enregistrée."))
            : MapFailure(result.Error);
    }

    private ObjectResult MapFailure(Error error) => error.Code switch
    {
        "Forbidden" => StatusCode(StatusCodes.Status503ServiceUnavailable, ApiResponse<object>.Fail(UnavailableMessage)),
        _ when error.Code.StartsWith("Validation.", StringComparison.Ordinal) => BadRequest(ApiResponse<object>.Fail(error.Description)),
        _ => BadRequest(ApiResponse<object>.Fail("Demande invalide."))
    };
}
