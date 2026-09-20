using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Storefront.Public;
using FactuTrust.Application.Features.Storefront.Public.Commands;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Storefront;

public sealed class SubmitPublicStorefrontOrderCaptchaTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Rejection_stops_before_any_repository_or_hashing_call(bool featureEnabled)
    {
        var read = new Mock<IPublicStorefrontReadRepository>(MockBehavior.Strict);
        var orders = new Mock<IStorefrontOrderRepository>(MockBehavior.Strict);
        var profiles = new Mock<IStorefrontProfileRepository>(MockBehavior.Strict);
        var hasher = new Mock<IIpAddressHasher>(MockBehavior.Strict);
        var captcha = new Mock<IStorefrontCaptchaValidator>(MockBehavior.Strict);
        using var cancellation = new CancellationTokenSource();
        if (featureEnabled)
            captcha.Setup(c => c.IsValidAsync("synthetic-token", cancellation.Token)).ReturnsAsync(false);

        var handler = new SubmitPublicStorefrontOrderCommandHandler(
            read.Object, orders.Object, profiles.Object, hasher.Object, captcha.Object,
            Options.Create(new StorefrontOptions { Enabled = featureEnabled }));
        var request = new SubmitPublicStorefrontOrderCommand(new SubmitPublicStorefrontOrderRequest
        {
            GuestFullName = "Test Guest",
            GuestEmail = "guest@example.com",
            GuestPhone = "12345678",
            DeliveryStreet = "Test Street",
            DeliveryCity = "Tunis",
            DeliveryGovernorate = "Tunis",
            Lines = new[] { new PublicOrderLineRequest { StorefrontProductId = Guid.NewGuid(), Quantity = 1 } }
        }, "synthetic-token", "192.0.2.1", "synthetic-agent");

        var result = await handler.Handle(request, cancellation.Token);

        Assert.True(result.IsFailure);
        Assert.Equal(featureEnabled ? "Vérification anti-bot invalide." : "La fonctionnalité Rue virtuelle est désactivée.", result.Error.Description);
        captcha.Verify(c => c.IsValidAsync("synthetic-token", cancellation.Token), featureEnabled ? Times.Once() : Times.Never());
        captcha.VerifyNoOtherCalls();
        read.VerifyNoOtherCalls();
        orders.VerifyNoOtherCalls();
        profiles.VerifyNoOtherCalls();
        hasher.VerifyNoOtherCalls();
    }
}
