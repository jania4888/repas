using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

public sealed class PublicRegistrationFeature : IPublicRegistrationFeature
{
    private readonly PublicRegistrationOptions _options;

    public PublicRegistrationFeature(IOptions<PublicRegistrationOptions> options)
    {
        _options = options.Value;
    }

    public bool IsCompanyEnabled => _options.CompanyEnabled;

    public bool IsFirmEnabled => _options.FirmEnabled;
}
