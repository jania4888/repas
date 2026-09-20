using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Services.Storefront;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Storefront;

public sealed class StorefrontCaptchaDependencyInjectionTests
{
    [Fact]
    public void Production_registration_binds_options_and_uses_bounded_non_redirecting_http_client()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Features:Storefront:OrderSubmissionRequiresCaptcha"] = "true",
            ["Features:Storefront:TurnstileSecretKey"] = "synthetic-di-secret",
            ["Features:Storefront:TurnstileAllowedHostnames:0"] = "shop.example.com",
            ["Features:Storefront:TurnstileExpectedAction"] = "order"
        }).Build();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging();
        services.AddInfrastructure(configuration);
        Assert.Single(services.Where(service => service.ServiceType == typeof(IStorefrontCaptchaValidator)));
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        Assert.IsType<StorefrontCaptchaValidator>(scope.ServiceProvider.GetRequiredService<IStorefrontCaptchaValidator>());
        var options = provider.GetRequiredService<IOptions<StorefrontOptions>>().Value;
        Assert.True(options.OrderSubmissionRequiresCaptcha);
        Assert.Equal("synthetic-di-secret", options.TurnstileSecretKey);
        Assert.Equal(new[] { "shop.example.com" }, options.TurnstileAllowedHostnames);
        Assert.Equal("order", options.TurnstileExpectedAction);

        using var client = provider.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(IStorefrontCaptchaValidator));
        Assert.Equal(TimeSpan.FromSeconds(5), client.Timeout);
        var handler = provider.GetRequiredService<IHttpMessageHandlerFactory>().CreateHandler(nameof(IStorefrontCaptchaValidator));
        while (handler is DelegatingHandler delegating) handler = delegating.InnerHandler!;
        var primary = Assert.IsType<HttpClientHandler>(handler);
        Assert.False(primary.AllowAutoRedirect);
        Assert.False(primary.UseCookies);
        Assert.Equal(16, primary.MaxResponseHeadersLength);
    }

    [Fact]
    public void Defaults_require_captcha_but_contain_no_secret_or_trusted_hostname()
    {
        var options = new StorefrontOptions();
        Assert.True(options.OrderSubmissionRequiresCaptcha);
        Assert.Empty(options.TurnstileSecretKey);
        Assert.Empty(options.TurnstileAllowedHostnames);
        Assert.Null(options.TurnstileExpectedAction);
    }
}
