using System.Security.Claims;
using FactuTrust.Application.DTOs;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/me/preferences")]
[Authorize]
public sealed class MePreferencesController : ControllerBase
{
    private static readonly HashSet<string> AllowedLanguages = new(StringComparer.OrdinalIgnoreCase) { "fr", "ar" };

    private readonly UserManager<ApplicationUser> _userManager;

    public MePreferencesController(UserManager<ApplicationUser> userManager) => _userManager = userManager;

    [HttpPut("language")]
    [EnableRateLimiting("user-preferences")]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SetLanguage([FromBody] UpdatePreferredLanguageDto request, CancellationToken cancellationToken)
    {
        var lang = (request?.Language ?? "").Trim().ToLowerInvariant();
        if (!AllowedLanguages.Contains(lang))
        {
            return BadRequest(ApiResponse<object>.Fail("Langue non prise en charge."));
        }

        var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(ApiResponse<object>.Fail("Identité utilisateur invalide"));
        }

        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null)
        {
            return Unauthorized(ApiResponse<object>.Fail("Utilisateur introuvable"));
        }

        user.PreferredLanguage = lang;
        var result = await _userManager.UpdateAsync(user);
        if (!result.Succeeded)
        {
            return BadRequest(ApiResponse<object>.Fail("Impossible d'enregistrer la préférence de langue."));
        }

        return Ok(ApiResponse<object>.Ok(new { language = lang }));
    }
}
