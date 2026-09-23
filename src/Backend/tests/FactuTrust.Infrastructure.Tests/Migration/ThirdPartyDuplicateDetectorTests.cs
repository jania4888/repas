using FactuTrust.Infrastructure.Services.Migration;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migration;

/// <summary>
/// Détection déterministe de doublons de tiers (N1/M3) : signaux forts (NIF, email, téléphone),
/// normalisation des noms avec retrait des formes juridiques, proximité orthographique bornée,
/// doublons internes au fichier importé.
/// </summary>
public sealed class ThirdPartyDuplicateDetectorTests
{
    private static ThirdPartySnapshot Snap(
        string name, string? nif = null, string? email = null, string? phone = null,
        string? city = null, string origin = "client", string reference = "ligne 2")
        => new(reference, name, nif, email, phone, city, origin);

    [Fact]
    public void SameNif_IsQuasiCertainMatch()
    {
        var imported = new[] { Snap("Alpha", nif: "1234567/A/M/P/000") };
        var existing = new[] { Snap("STE ALPHA SARL", nif: "1234567/A/M/P/000") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        var m = Assert.Single(matches);
        Assert.Equal(1.0, m.Score);
        Assert.Contains("matricule fiscal", m.Reason);
    }

    /// <summary>
    /// Régression de la canonicalisation du NIF : la base stocke désormais la forme carte, le
    /// fichier importé porte la forme historique. Le doublon doit rester certain (1,0), et non
    /// retomber sur la similarité de nom (0,85).
    /// </summary>
    [Theory]
    [InlineData("1234567/A/M/P/000", "1234567A/M/P/000")]
    [InlineData("1234567A/M/P/000", "1234567/A/M/P/000")]
    [InlineData("1234567/a/m/p/000", "1234567A/M/P/000")]
    [InlineData(" 1234567/A/M/P/000 ", "1234567A/M/P/000")]
    public void SameNif_LegacyAndOfficialSpellings_IsQuasiCertainMatch(string importedNif, string existingNif)
    {
        var imported = new[] { Snap("Alpha", nif: importedNif) };
        var existing = new[] { Snap("Société totalement différente", nif: existingNif) };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        var m = Assert.Single(matches);
        Assert.Equal(1.0, m.Score);
        Assert.Contains("matricule fiscal", m.Reason);
    }

    /// <summary>Deux matricules réellement différents ne doivent pas être rapprochés par le NIF.</summary>
    [Fact]
    public void DifferentNif_SameDigits_IsNotANifMatch()
    {
        var imported = new[] { Snap("Alpha", nif: "1234567/A/M/P/000") };
        var existing = new[] { Snap("Gamma Services", nif: "1234567B/M/P/000") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        Assert.DoesNotContain(matches, m => m.Reason.Contains("matricule fiscal"));
    }

    /// <summary>Une valeur qui n'est pas un NIF garde la comparaison historique (brute, insensible à la casse).</summary>
    [Fact]
    public void UnparseableNif_FallsBackToRawComparison()
    {
        var imported = new[] { Snap("Alpha", nif: "ABC-123") };
        var existing = new[] { Snap("Zeta Holding", nif: "abc-123") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        var m = Assert.Single(matches);
        Assert.Equal(1.0, m.Score);
    }

    [Fact]
    public void SameEmail_IsStrongMatch()
    {
        var imported = new[] { Snap("Beta", email: "Contact@Beta.tn") };
        var existing = new[] { Snap("Beta Industries", email: "contact@beta.tn") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        var m = Assert.Single(matches);
        Assert.Equal(0.95, m.Score);
    }

    [Fact]
    public void Phone_InternationalTrunk_IsNormalized()
    {
        var imported = new[] { Snap("Gamma", phone: "+216 71 234 567") };
        var existing = new[] { Snap("Gamma Plus", phone: "71 234 567") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        var m = Assert.Single(matches);
        Assert.Equal(0.9, m.Score);
    }

    [Fact]
    public void LegalForms_AreRemovedFromNames()
    {
        // « STE Alpha Distribution SARL » == « Alpha Distribution » après retrait des formes juridiques.
        Assert.Equal(
            ThirdPartyDuplicateDetector.NormalizeName("STE Alpha Distribution SARL"),
            ThirdPartyDuplicateDetector.NormalizeName("Alpha Distribution"));

        var imported = new[] { Snap("STE Alpha Distribution SARL") };
        var existing = new[] { Snap("Alpha Distribution") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        var m = Assert.Single(matches);
        Assert.Equal(0.85, m.Score);
    }

    [Fact]
    public void LegalFormTokens_DoNotCorruptRealNames()
    {
        // « Santé » contient « sa » mais ne doit PAS être amputé (retrait par token, pas par sous-chaîne).
        var normalized = ThirdPartyDuplicateDetector.NormalizeName("Clinique Santé SA");
        Assert.Contains("sante", normalized);
    }

    [Fact]
    public void CloseNames_SameCity_AreMatched()
    {
        var imported = new[] { Snap("Alpha Disribution", city: "Tunis") }; // faute de frappe
        var existing = new[] { Snap("Alpha Distribution", city: "Tunis") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        var m = Assert.Single(matches);
        Assert.Equal(0.7, m.Score);
        Assert.Contains("même ville", m.Reason);
    }

    [Fact]
    public void CloseNames_DifferentCities_AreNotMatchedAtHighThreshold()
    {
        var imported = new[] { Snap("Alpha Disribution", city: "Sfax") };
        var existing = new[] { Snap("Alpha Distribution", city: "Tunis") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.7, 200);

        Assert.Empty(matches);
    }

    [Fact]
    public void UnrelatedThirdParties_ProduceNoMatch()
    {
        var imported = new[] { Snap("Menuiserie du Nord", city: "Bizerte") };
        var existing = new[] { Snap("Transport Sud Express", city: "Gabès") };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 200);

        Assert.Empty(matches);
    }

    [Fact]
    public void InternalDuplicates_InsideImportedFile_AreDetected()
    {
        var imported = new[]
        {
            Snap("STE Delta", nif: "7654321/A/M/P/000", origin: "fichier", reference: "ligne 2"),
            Snap("Delta", nif: "7654321/A/M/P/000", origin: "fichier", reference: "ligne 9")
        };

        var matches = ThirdPartyDuplicateDetector.Detect(imported, Array.Empty<ThirdPartySnapshot>(), 0.6, 200);

        Assert.Single(matches);
    }

    [Fact]
    public void MaxPairs_CapsTheOutput()
    {
        var imported = Enumerable.Range(1, 5).Select(i => Snap($"Alpha{i}", nif: "0000000/A/M/P/000")).ToList();
        var existing = Enumerable.Range(1, 5).Select(i => Snap($"Beta{i}", nif: "0000000/A/M/P/000")).ToList();

        var matches = ThirdPartyDuplicateDetector.Detect(imported, existing, 0.6, 3);

        Assert.Equal(3, matches.Count);
    }

    [Fact]
    public void BoundedLevenshtein_RespectsTheBound()
    {
        Assert.Equal(1, ThirdPartyDuplicateDetector.BoundedLevenshtein("alpha", "alphe", 2));
        Assert.Equal(3, ThirdPartyDuplicateDetector.BoundedLevenshtein("alpha", "omega", 2)); // > max → max+1
        Assert.Equal(3, ThirdPartyDuplicateDetector.BoundedLevenshtein("ab", "abcdef", 2));   // écart de longueur
    }
}
