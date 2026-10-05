using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class PhoneNumberTests
{
    [Fact]
    public void Create_RejectsBlank()
    {
        var result = PhoneNumber.Create("  ");

        Assert.True(result.IsFailure);
        Assert.Contains("obligatoire", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void CreateOptional_Blank_IsAbsent(string? value)
    {
        var result = PhoneNumber.CreateOptional(value);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value);
    }

    [Fact]
    public void CreateOptional_Invalid_Fails()
    {
        var result = PhoneNumber.CreateOptional("abc");

        Assert.True(result.IsFailure);
        Assert.Contains("invalide", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("73123456", "+21673123456")]
    [InlineData("+216 71 123 456", "+21671123456")]
    public void CreateOptional_Valid_IsCanonical(string input, string expected)
    {
        var result = PhoneNumber.CreateOptional(input);

        Assert.True(result.IsSuccess);
        Assert.Equal(expected, result.Value!.Value);
    }
}
