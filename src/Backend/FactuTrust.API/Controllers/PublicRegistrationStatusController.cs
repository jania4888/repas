using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/public/registration-status")]
[AllowAnonymous]
public sealed class PublicRegistrationStatusController : ControllerBase
{
    private readonly IPublicRegistrationFeature _publicRegistration;

    public PublicRegistrationStatusController(IPublicRegistrationFeature publicRegistration)
    {
        _publicRegistration = publicRegistration;
    }

    [HttpGet]
    [EnableRateLimiting("public-catalog")]
    [ProducesResponseType(typeof(ApiResponse<PublicRegistrationStatusDto>), StatusCodes.Status200OK)]
    public IActionResult Get()
    {
        return Ok(ApiResponse<PublicRegistrationStatusDto>.Ok(new PublicRegistrationStatusDto
        {
            CompanyEnabled = _publicRegistration.IsCompanyEnabled,
            FirmEnabled = _publicRegistration.IsFirmEnabled
        }));
    }
}
