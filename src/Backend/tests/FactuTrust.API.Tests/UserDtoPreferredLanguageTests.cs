using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.API.Tests;

public sealed class UserDtoPreferredLanguageTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    [Fact]
    public void UserDto_serializes_null_preferred_language_for_legacy_users()
    {
        var dto = new UserDto
        {
            Id = Guid.NewGuid(),
            Email = "legacy@example.com",
            FirstName = "Legacy",
            LastName = "User",
            Role = UserRole.Administrator,
            RoleDisplay = "Administrateur",
            TenantId = Guid.NewGuid(),
            CompanyName = "Société",
            PreferredLanguage = null
        };

        var json = JsonSerializer.Serialize(dto, JsonOptions);
        using var doc = JsonDocument.Parse(json);
        Assert.True(doc.RootElement.TryGetProperty("preferredLanguage", out var prop));
        Assert.Equal(JsonValueKind.Null, prop.ValueKind);
    }

    [Fact]
    public void UserDto_serializes_ar_preferred_language()
    {
        var dto = new UserDto
        {
            Id = Guid.NewGuid(),
            Email = "ar@example.com",
            FirstName = "Ar",
            LastName = "User",
            Role = UserRole.Administrator,
            RoleDisplay = "Administrateur",
            TenantId = Guid.NewGuid(),
            CompanyName = "Société",
            PreferredLanguage = "ar"
        };

        var json = JsonSerializer.Serialize(dto, JsonOptions);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("ar", doc.RootElement.GetProperty("preferredLanguage").GetString());
    }
}
