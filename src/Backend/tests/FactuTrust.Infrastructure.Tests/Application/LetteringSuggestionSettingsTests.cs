using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Entities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Phase 3 du lettrage (p3-1) : réglages des propositions et du lettrage en masse, codes d'erreur
/// et action d'audit. Aucun consommateur encore : ces tests figent le contrat (défauts de
/// l'annexe C §2.7, drapeau éteint, bornes dures qui ne bloquent jamais le démarrage).
/// </summary>
public sealed class LetteringSuggestionSettingsTests
{
    [Fact]
    public void Flag_IsOff_ByDefault()
    {
        Assert.False(new AccountingSettings().LetteringSuggestionsEnabled);
        Assert.NotNull(new AccountingSettings().LetteringSuggestions);
    }

    [Fact]
    public void Defaults_MatchAnnexC()
    {
        var s = new LetteringSuggestionSettings();
        Assert.Equal(5000, s.MaxCandidateLines);
        Assert.Equal(200, s.MaxSuggestions);
        Assert.Equal(4, s.SubsetMaxSize);
        Assert.Equal(25, s.SubsetMaxCandidates);
        Assert.Equal(20_000, s.SubsetNodeBudgetPerTarget);
        Assert.Equal(500_000, s.SubsetGlobalNodeBudget);
        Assert.Equal(20, s.MaxLinesPerReference);
        Assert.Equal(20, s.MaxDocumentPayments);
        Assert.Equal(3000, s.TimeFuseMilliseconds);
        Assert.Equal(200, s.BulkMaxGroups);
        Assert.Equal(50, s.BulkMaxLinesPerGroup);
        Assert.Equal(2000, s.BulkMaxTotalLines);
    }

    [Fact]
    public void Defaults_AreWithinBounds_AndClampedIsIdentity()
    {
        var s = new LetteringSuggestionSettings();
        Assert.Empty(s.OutOfRangeKeys());
        Assert.Equivalent(s, s.Clamped(), strict: true);
    }

    [Fact]
    public void Bounds_CoverEveryIntProperty()
    {
        var props = typeof(LetteringSuggestionSettings).GetProperties()
            .Where(p => p.PropertyType == typeof(int)).Select(p => p.Name).OrderBy(n => n);
        Assert.Equal(props, LetteringSuggestionSettings.Bounds.Select(b => b.Key).OrderBy(n => n));
    }

    [Fact]
    public void Clamped_RaisesTooSmallValues_ToMinimum()
    {
        var s = new LetteringSuggestionSettings
        {
            MaxCandidateLines = 0, MaxSuggestions = -5, SubsetMaxSize = 1, SubsetMaxCandidates = 0,
            SubsetNodeBudgetPerTarget = 0, SubsetGlobalNodeBudget = -1, MaxLinesPerReference = 0,
            MaxDocumentPayments = 0, TimeFuseMilliseconds = 10, BulkMaxGroups = 0,
            BulkMaxLinesPerGroup = 1, BulkMaxTotalLines = int.MinValue,
        };

        var c = s.Clamped();

        Assert.Equal(1, c.MaxCandidateLines);
        Assert.Equal(1, c.MaxSuggestions);
        Assert.Equal(2, c.SubsetMaxSize);
        Assert.Equal(2, c.SubsetMaxCandidates);
        Assert.Equal(1, c.SubsetNodeBudgetPerTarget);
        Assert.Equal(1, c.SubsetGlobalNodeBudget);
        Assert.Equal(1, c.MaxLinesPerReference);
        Assert.Equal(1, c.MaxDocumentPayments);
        Assert.Equal(100, c.TimeFuseMilliseconds);
        Assert.Equal(1, c.BulkMaxGroups);
        Assert.Equal(2, c.BulkMaxLinesPerGroup);
        Assert.Equal(2, c.BulkMaxTotalLines);
        Assert.Equal(12, s.OutOfRangeKeys().Count());
    }

    [Fact]
    public void Clamped_LowersTooLargeValues_ToHardCaps()
    {
        var s = new LetteringSuggestionSettings
        {
            MaxCandidateLines = 1_000_000, MaxSuggestions = 10_000, SubsetMaxSize = 30,
            SubsetMaxCandidates = 1000, SubsetNodeBudgetPerTarget = int.MaxValue,
            SubsetGlobalNodeBudget = int.MaxValue, MaxLinesPerReference = 100_000,
            MaxDocumentPayments = 100_000, TimeFuseMilliseconds = 600_000, BulkMaxGroups = 5000,
            BulkMaxLinesPerGroup = 500, BulkMaxTotalLines = 100_000,
        };

        var c = s.Clamped();

        Assert.Equal(5000, c.MaxCandidateLines);
        Assert.Equal(200, c.MaxSuggestions);
        Assert.Equal(6, c.SubsetMaxSize);
        Assert.Equal(40, c.SubsetMaxCandidates);
        Assert.Equal(200_000, c.SubsetNodeBudgetPerTarget);
        Assert.Equal(5_000_000, c.SubsetGlobalNodeBudget);
        Assert.Equal(200, c.MaxLinesPerReference);
        Assert.Equal(200, c.MaxDocumentPayments);
        Assert.Equal(10_000, c.TimeFuseMilliseconds);
        Assert.Equal(200, c.BulkMaxGroups);
        Assert.Equal(50, c.BulkMaxLinesPerGroup);
        Assert.Equal(2000, c.BulkMaxTotalLines);
    }

    [Fact]
    public void Clamped_DoesNotMutateSource_AndKeepsInRangeValues()
    {
        var s = new LetteringSuggestionSettings { SubsetMaxSize = 9, MaxSuggestions = 50 };

        var c = s.Clamped();

        Assert.Equal(9, s.SubsetMaxSize);
        Assert.Equal(6, c.SubsetMaxSize);
        Assert.Equal(50, c.MaxSuggestions);
        var bad = Assert.Single(s.OutOfRangeKeys());
        Assert.Equal((nameof(LetteringSuggestionSettings.SubsetMaxSize), 9, 2, 6), bad);
    }

    [Fact]
    public void Binding_FromConfiguration_ReadsFlagAndNestedSection()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Accounting:LetteringSuggestionsEnabled"] = "true",
            ["Accounting:LetteringSuggestions:SubsetMaxSize"] = "5",
            ["Accounting:LetteringSuggestions:BulkMaxGroups"] = "999",
        }).Build();
        var services = new ServiceCollection();
        services.Configure<AccountingSettings>(config.GetSection(AccountingSettings.SectionName));

        var value = services.BuildServiceProvider().GetRequiredService<IOptions<AccountingSettings>>().Value;

        Assert.True(value.LetteringSuggestionsEnabled);
        Assert.Equal(5, value.LetteringSuggestions.SubsetMaxSize);
        Assert.Equal(200, value.LetteringSuggestions.Clamped().BulkMaxGroups);
        Assert.Equal(25, value.LetteringSuggestions.SubsetMaxCandidates);
    }

    [Fact]
    public void ErrorFactories_CarryStableCodes()
    {
        Assert.Equal("LETTERING_EXCHANGE_DIFFERENCE", LetteringErrors.ExchangeDifference("m").Code);
        Assert.Equal("LETTERING_FEATURE_DISABLED", LetteringErrors.FeatureDisabled("m").Code);
        Assert.Equal("LETTERING_BULK_IN_PROGRESS", LetteringErrors.BulkInProgress("m").Code);
        Assert.Equal("m", LetteringErrors.BulkInProgress("m").Description);
    }

    [Fact]
    public void AuditAction_LetteredBulk_IsDistinct()
    {
        Assert.Equal("Accounting.LetteredBulk", AuditActions.Accounting.LetteredBulk);
        Assert.NotEqual(AuditActions.Accounting.Lettered, AuditActions.Accounting.LetteredBulk);
    }
}
