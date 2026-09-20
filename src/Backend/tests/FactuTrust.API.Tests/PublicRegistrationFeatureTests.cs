using System.Net;
using System.Net.Http.Json;
using FactuTrust.Application.DTOs;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace FactuTrust.API.Tests;

public sealed class PublicRegistrationFeatureTests
{
    private sealed class PublicRegistrationDisabledFactory : ChannelsDisabledWebApplicationFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Features:PublicRegistration:CompanyEnabled"] = "false",
                    ["Features:PublicRegistration:FirmEnabled"] = "false"
                });
            });
        }
    }

    [Fact]
    public async Task Register_returns_404_when_public_company_registration_disabled()
    {
        await using var factory = new PublicRegistrationDisabledFactory();
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var dto = new RegisterDto
        {
            Email = "off@example.com",
            Password = "SecurePass123!",
            ConfirmPassword = "SecurePass123!",
            FirstName = "A",
            LastName = "B",
            CompanyName = "Off Co",
            Nif = "1234567/A/B/C/000",
            TaxRegime = 0,
            Street = "1 rue",
            City = "Tunis",
            Governorate = "Tunis",
            CompanyEmail = "co@example.com",
            Phone = "71123456"
        };

        var response = await client.PostAsJsonAsync("/api/auth/register", dto);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Register_firm_returns_404_when_public_firm_registration_disabled()
    {
        await using var factory = new PublicRegistrationDisabledFactory();
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var dto = new RegisterAccountingFirmDto
        {
            Email = "firm@example.com",
            Password = "SecurePass123!",
            ConfirmPassword = "SecurePass123!",
            FirstName = "A",
            LastName = "B",
            FirmName = "Cabinet Off",
            Nif = "7654321/A/B/C/000",
            Street = "1 rue",
            City = "Tunis",
            Governorate = "Tunis",
            FirmEmail = "contact@cabinet.test",
            Phone = "71123456"
        };

        var response = await client.PostAsJsonAsync("/api/auth/register-firm", dto);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Registration_status_returns_flags()
    {
        await using var factory = new PublicRegistrationDisabledFactory();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/public/registration-status");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ApiResponse<PublicRegistrationStatusDto>>();
        Assert.NotNull(body?.Data);
        Assert.False(body.Data!.CompanyEnabled);
        Assert.False(body.Data.FirmEnabled);
    }
}
