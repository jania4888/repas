using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Validators;
using FluentValidation.TestHelper;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Plan v2, Phase 3, p3-12 (annexe C §4) : validation du lot de lettrage en masse. Une seule erreur
/// rejette toute la requête, avant tout lettrage.
/// </summary>
public sealed class BulkLetterCommandValidatorTests
{
    private static BulkLetterCommandValidator Validator(Action<LetteringSuggestionSettings>? configure = null)
    {
        var settings = new AccountingSettings();
        configure?.Invoke(settings.LetteringSuggestions);
        return new BulkLetterCommandValidator(Options.Create(settings));
    }

    private static BulkLetterGroup Group(string key, int lines = 2) =>
        new(key, Enumerable.Range(0, lines).Select(_ => Guid.NewGuid()).ToList());

    private static BulkLetterCommand Command(params BulkLetterGroup[] groups) => new(Guid.NewGuid(), groups);

    [Fact]
    public void ValidBatch_Passes()
    {
        Validator().TestValidate(Command(Group("a1"), Group("b2", 5))).ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void EmptyRequestId_Fails()
    {
        var cmd = new BulkLetterCommand(Guid.Empty, new[] { Group("a1") });
        Validator().TestValidate(cmd).ShouldHaveValidationErrorFor(x => x.RequestId);
    }

    [Fact]
    public void NoGroup_Fails()
    {
        Validator().TestValidate(Command()).ShouldHaveValidationErrorFor(x => x.Groups);
    }

    [Fact]
    public void NullGroups_Fails_WithoutThrowing()
    {
        var cmd = new BulkLetterCommand(Guid.NewGuid(), null!);
        Validator().TestValidate(cmd).ShouldHaveValidationErrorFor(x => x.Groups);
    }

    [Fact]
    public void NullGroupElement_Fails_WithoutThrowing()
    {
        var cmd = new BulkLetterCommand(Guid.NewGuid(), new BulkLetterGroup[] { Group("a1"), null! });
        Assert.False(Validator().Validate(cmd).IsValid);
    }

    [Fact]
    public void NullLineList_Fails_WithoutThrowing()
    {
        var cmd = Command(new BulkLetterGroup("a1", null!));
        Assert.False(Validator().Validate(cmd).IsValid);
    }

    [Fact]
    public void GroupCount_AtCap_Passes_AboveCap_Fails()
    {
        var atCap = Command(Enumerable.Range(0, 200).Select(i => Group($"k{i}")).ToArray());
        Validator().TestValidate(atCap).ShouldNotHaveAnyValidationErrors();

        var above = Command(Enumerable.Range(0, 201).Select(i => Group($"k{i}")).ToArray());
        Validator().TestValidate(above).ShouldHaveValidationErrorFor(x => x.Groups);
    }

    [Fact]
    public void ConfiguredGroupCap_IsApplied()
    {
        var cmd = Command(Group("a"), Group("b"), Group("c"));
        Validator(s => s.BulkMaxGroups = 2).TestValidate(cmd).ShouldHaveValidationErrorFor(x => x.Groups);
    }

    /// <summary>Une configuration hors bornes ne peut pas élargir le lot (plafond dur 200).</summary>
    [Fact]
    public void OutOfRangeConfiguration_IsClampedToTheHardCap()
    {
        var cmd = Command(Enumerable.Range(0, 201).Select(i => Group($"k{i}")).ToArray());
        Validator(s => s.BulkMaxGroups = 10_000).TestValidate(cmd).ShouldHaveValidationErrorFor(x => x.Groups);
    }

    [Fact]
    public void ConfiguredLinesPerGroupCap_IsApplied_AndClamped()
    {
        Validator(s => s.BulkMaxLinesPerGroup = 3).TestValidate(Command(Group("a1", 4)))
            .ShouldHaveValidationErrorFor("Groups[0].JournalEntryLineIds")
            .WithErrorMessage("3 lignes au maximum par groupe.");
        Validator(s => s.BulkMaxLinesPerGroup = 10_000).TestValidate(Command(Group("a1", 51)))
            .ShouldHaveValidationErrorFor("Groups[0].JournalEntryLineIds")
            .WithErrorMessage("50 lignes au maximum par groupe.");
    }

    [Fact]
    public void ConfiguredTotalLinesCap_IsApplied_AndClamped()
    {
        Validator(s => s.BulkMaxTotalLines = 5).TestValidate(Command(Group("a", 3), Group("b", 3)))
            .ShouldHaveValidationErrorFor(x => x.Groups)
            .WithErrorMessage("5 lignes au maximum peuvent être lettrées en une seule fois.");
        var cmd = Command(Enumerable.Range(0, 41).Select(i => Group($"k{i}", 50)).ToArray());
        Validator(s => s.BulkMaxTotalLines = 1_000_000).TestValidate(cmd)
            .ShouldHaveValidationErrorFor(x => x.Groups)
            .WithErrorMessage("2000 lignes au maximum peuvent être lettrées en une seule fois.");
    }

    /// <summary>Revue p3-12 : au-delà du plafond de groupes, aucune règle par groupe ne s'exécute.</summary>
    [Fact]
    public void AboveGroupCap_ReportsOnlyTheCap_WithoutPerGroupRules()
    {
        var groups = Enumerable.Range(0, 201).Select(_ => new BulkLetterGroup("bad key", new[] { Guid.Empty })).ToArray();

        var result = Validator().Validate(Command(groups));

        var error = Assert.Single(result.Errors);
        Assert.Equal("200 groupes au maximum peuvent être lettrés en une seule fois.", error.ErrorMessage);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(51)]
    public void LinesPerGroup_OutsideTwoToFifty_Fails(int lines)
    {
        var result = Validator().TestValidate(Command(Group("a1", lines)));
        result.ShouldHaveValidationErrorFor("Groups[0].JournalEntryLineIds");
    }

    [Fact]
    public void LinesPerGroup_AtFifty_Passes()
    {
        Validator().TestValidate(Command(Group("a1", 50))).ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void TotalLines_AboveCap_Fails()
    {
        // 41 groupes de 50 lignes = 2 050 > 2 000 (chaque groupe reste valide seul).
        var cmd = Command(Enumerable.Range(0, 41).Select(i => Group($"k{i}", 50)).ToArray());
        Validator().TestValidate(cmd).ShouldHaveValidationErrorFor(x => x.Groups)
            .WithErrorMessage("2000 lignes au maximum peuvent être lettrées en une seule fois.");
    }

    [Fact]
    public void TotalLines_AtCap_Passes()
    {
        var cmd = Command(Enumerable.Range(0, 40).Select(i => Group($"k{i}", 50)).ToArray());
        Validator().TestValidate(cmd).ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void EmptyLineId_Fails()
    {
        var cmd = Command(new BulkLetterGroup("a1", new[] { Guid.NewGuid(), Guid.Empty }));
        Validator().TestValidate(cmd).ShouldHaveValidationErrorFor("Groups[0].JournalEntryLineIds");
    }

    [Fact]
    public void DuplicateLineInsideAGroup_Fails()
    {
        var id = Guid.NewGuid();
        var cmd = Command(new BulkLetterGroup("a1", new[] { id, id }));
        Validator().TestValidate(cmd).ShouldHaveValidationErrorFor("Groups[0].JournalEntryLineIds");
    }

    [Fact]
    public void SameLineInTwoGroups_RejectsTheWholeRequest()
    {
        var shared = Guid.NewGuid();
        var cmd = Command(
            new BulkLetterGroup("a1", new[] { shared, Guid.NewGuid() }),
            new BulkLetterGroup("b2", new[] { Guid.NewGuid(), shared }));
        Validator().TestValidate(cmd).ShouldHaveValidationErrorFor(x => x.Groups)
            .WithErrorMessage("Une même ligne apparaît dans plusieurs groupes.");
    }

    [Fact]
    public void DuplicateClientKey_Fails()
    {
        Validator().TestValidate(Command(Group("same"), Group("same"))).ShouldHaveValidationErrorFor(x => x.Groups)
            .WithErrorMessage("Une même clé de proposition apparaît dans plusieurs groupes.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("a b")]
    [InlineData("clé")]
    [InlineData("a/b")]
    [InlineData("<script>")]
    [InlineData("a1\n")]   // revue p3-12 : « $ » acceptait un saut de ligne final
    public void InvalidClientKey_Fails(string key)
    {
        Validator().TestValidate(Command(Group(key))).ShouldHaveValidationErrorFor("Groups[0].ClientKey");
    }

    [Fact]
    public void ClientKey_AtMaxLength_Passes_AboveMax_Fails()
    {
        Validator().TestValidate(Command(Group(new string('a', 32)))).ShouldNotHaveAnyValidationErrors();
        Validator().TestValidate(Command(Group(new string('a', 33)))).ShouldHaveValidationErrorFor("Groups[0].ClientKey");
    }

    [Fact]
    public void ClientKey_WithHexDashAndUnderscore_Passes()
    {
        Validator().TestValidate(Command(Group("a1B2-c3_D4"))).ShouldNotHaveAnyValidationErrors();
    }
}
