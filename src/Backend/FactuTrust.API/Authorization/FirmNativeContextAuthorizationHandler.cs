using FactuTrust.Domain.Authorization;
using Microsoft.AspNetCore.Authorization;

namespace FactuTrust.API.Authorization;

public sealed class FirmNativeContextAuthorizationHandler
    : AuthorizationHandler<FirmNativeContextRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        FirmNativeContextRequirement requirement)
    {
        if (AccountingValidationAccess.IsAccountingFirmNativeContext(context.User))
            context.Succeed(requirement);

        return Task.CompletedTask;
    }
}
