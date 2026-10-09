using Microsoft.AspNetCore.Authorization;

namespace FactuTrust.API.Authorization;

/// <summary>
/// Requires an accounting firm user operating at the firm itself (NOT inside a client dossier).
/// Miroir de <see cref="FirmDelegatedContextRequirement"/> pour l'espace cabinet.
/// </summary>
public sealed class FirmNativeContextRequirement : IAuthorizationRequirement;
