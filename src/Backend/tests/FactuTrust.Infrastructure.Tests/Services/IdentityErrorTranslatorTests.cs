using FactuTrust.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Les descriptions viennent du <see cref="IdentityErrorDescriber"/> réel : c'est lui qui porte le
/// seuil chiffré que la traduction doit restituer.
/// </summary>
public sealed class IdentityErrorTranslatorTests
{
    private static readonly IdentityErrorDescriber Describer = new();

    [Fact]
    public void PasswordTooShort_StatesTheRequiredLength()
    {
        var message = IdentityErrorTranslator.TranslateToFrench(Describer.PasswordTooShort(12));

        Assert.Equal("Le mot de passe doit contenir au moins 12 caractères.", message);
    }

    [Fact]
    public void PasswordRequiresUniqueChars_StatesTheRequiredCount()
    {
        var message = IdentityErrorTranslator.TranslateToFrench(Describer.PasswordRequiresUniqueChars(4));

        Assert.Equal("Le mot de passe doit contenir au moins 4 caractères différents.", message);
    }

    [Fact]
    public void PasswordTooShort_WithoutCountInDescription_FallsBackToGenericMessage()
    {
        var message = IdentityErrorTranslator.TranslateToFrench(
            new IdentityError { Code = "PasswordTooShort", Description = "Too short." });

        Assert.Equal("Le mot de passe est trop court.", message);
    }

    [Fact]
    public void SeveralPasswordErrors_AreJoinedWithSinglePeriods()
    {
        // Ce que renvoie la politique de production pour « Test1234 ».
        var message = IdentityErrorTranslator.TranslateToFrench(new[]
        {
            Describer.PasswordTooShort(12),
            Describer.PasswordRequiresNonAlphanumeric()
        });

        Assert.Equal(
            "Le mot de passe doit contenir au moins 12 caractères. "
            + "Le mot de passe doit contenir au moins un caractère non alphanumérique.",
            message);
        Assert.DoesNotContain("{0}", message);
        Assert.DoesNotContain("..", message);
    }

    [Fact]
    public void DuplicateEmail_KeepsTheAddressInTheMessage()
    {
        var message = IdentityErrorTranslator.TranslateToFrench(new[] { Describer.DuplicateEmail("collab@test.tn") });

        Assert.Equal("L'adresse email 'collab@test.tn' est déjà utilisée.", message);
    }

    [Fact]
    public void DuplicateUserNameAndEmail_WithSameValue_AreCombined()
    {
        var message = IdentityErrorTranslator.TranslateToFrench(new[]
        {
            Describer.DuplicateUserName("collab@test.tn"),
            Describer.DuplicateEmail("collab@test.tn")
        });

        Assert.Equal("Le nom d'utilisateur et l'adresse email 'collab@test.tn' sont déjà utilisés.", message);
    }

    [Fact]
    public void NoErrors_ReturnsEmptyString()
    {
        Assert.Equal(string.Empty, IdentityErrorTranslator.TranslateToFrench(Array.Empty<IdentityError>()));
    }
}
