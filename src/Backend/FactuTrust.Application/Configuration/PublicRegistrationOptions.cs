namespace FactuTrust.Application.Configuration;

public sealed class PublicRegistrationOptions
{
    public const string SectionName = "Features:PublicRegistration";

    public bool CompanyEnabled { get; set; } = true;

    public bool FirmEnabled { get; set; } = true;
}
