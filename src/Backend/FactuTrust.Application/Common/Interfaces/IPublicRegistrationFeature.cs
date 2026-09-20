namespace FactuTrust.Application.Common.Interfaces;

public interface IPublicRegistrationFeature
{
    bool IsCompanyEnabled { get; }

    bool IsFirmEnabled { get; }
}
