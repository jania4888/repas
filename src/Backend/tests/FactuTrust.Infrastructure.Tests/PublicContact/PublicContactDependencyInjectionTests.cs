using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Repositories;
using FactuTrust.Infrastructure.Services.Background;
using FactuTrust.Infrastructure.Services.PublicContact;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

/// <summary>
/// Lot C — DI: options bound + validated at start-up, hardened Turnstile HttpClient (same profile
/// as the storefront one), repository / validator / purge job registered unconditionally.
/// </summary>
public sealed class PublicContactDependencyInjectionTests
{
    [Fact]
    public void Registration_binds_options_and_uses_bounded_non_redirecting_http_client()
    {
        var services = Build(new Dictionary<string, string?>
        {
            ["Features:PublicContact:Enabled"] = "true",
            ["Features:PublicContact:RecipientEmails:0"] = "contact@instafact.example",
            ["Features:PublicContact:RequireCaptcha"] = "true",
            ["Features:PublicContact:TurnstileSecretKey"] = "synthetic-di-secret",
            ["Features:PublicContact:TurnstileAllowedHostnames:0"] = "instafact.example"
        });
        Assert.Single(services.Where(s => s.ServiceType == typeof(IPublicContactCaptchaValidator)));
        Assert.Single(services.Where(s => s.ServiceType == typeof(IPublicContactRequestRepository)));
        Assert.Single(services.Where(s => s.ServiceType == typeof(PublicContactRequestsPurgeJob)));
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        Assert.IsType<PublicContactCaptchaValidator>(scope.ServiceProvider.GetRequiredService<IPublicContactCaptchaValidator>());
        Assert.IsType<PublicContactRequestRepository>(scope.ServiceProvider.GetRequiredService<IPublicContactRequestRepository>());
        var options = provider.GetRequiredService<IOptions<PublicContactOptions>>().Value;
        Assert.True(options.Enabled);
        Assert.True(options.RequireCaptcha);
        Assert.Equal(new[] { "contact@instafact.example" }, options.RecipientEmails);
        Assert.Equal("synthetic-di-secret", options.TurnstileSecretKey);
        Assert.Equal("contact", options.TurnstileExpectedAction);

        using var client = provider.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(IPublicContactCaptchaValidator));
        Assert.Equal(TimeSpan.FromSeconds(5), client.Timeout);
        var handler = provider.GetRequiredService<IHttpMessageHandlerFactory>().CreateHandler(nameof(IPublicContactCaptchaValidator));
        while (handler is DelegatingHandler delegating) handler = delegating.InnerHandler!;
        var primary = Assert.IsType<HttpClientHandler>(handler);
        Assert.False(primary.AllowAutoRedirect);
        Assert.False(primary.UseCookies);
        Assert.Equal(16, primary.MaxResponseHeadersLength);
    }

    [Fact]
    public void Defaults_are_disabled_with_no_recipient_and_no_secret()
    {
        using var provider = Build(new Dictionary<string, string?>()).BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<PublicContactOptions>>().Value;
        Assert.False(options.Enabled);
        Assert.Empty(options.RecipientEmails);
        Assert.False(options.RequireCaptcha);
        Assert.Empty(options.TurnstileSecretKey);
        Assert.Equal("contact", options.TurnstileExpectedAction);
        Assert.Equal(365, options.RetentionDays);
        Assert.Equal(30, options.SpamRetentionDays);
    }

    [Theory]
    [InlineData("Features:PublicContact:RecipientEmails:0", "pas-une-adresse")]
    [InlineData("Features:PublicContact:RetentionDays", "0")]
    [InlineData("Features:PublicContact:SpamRetentionDays", "-1")]
    [InlineData("Features:PublicContact:MaxAcceptedPerHour", "0")]
    [InlineData("Features:PublicContact:MinElapsedMs", "-1")]
    [InlineData("Features:PublicContact:ConsentTextVersion", "")]
    public void Invalid_configuration_fails_validation(string key, string value)
    {
        using var provider = Build(new Dictionary<string, string?> { [key] = value }).BuildServiceProvider();
        Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IOptions<PublicContactOptions>>().Value);
    }

    [Fact]
    public void Options_are_validated_on_start()
    {
        var services = Build(new Dictionary<string, string?>());
        Assert.Contains(services, s => s.ServiceType == typeof(IStartupValidator));
    }

    private static ServiceCollection Build(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging();
        services.AddInfrastructure(configuration);
        return services;
    }
}
