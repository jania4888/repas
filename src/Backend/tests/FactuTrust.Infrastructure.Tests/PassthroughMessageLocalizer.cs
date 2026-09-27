using FactuTrust.Application.Localization;

namespace FactuTrust.Infrastructure.Tests;

internal sealed class PassthroughMessageLocalizer : IMessageLocalizer
{
    public string Localize(string? message) => message ?? string.Empty;
}
