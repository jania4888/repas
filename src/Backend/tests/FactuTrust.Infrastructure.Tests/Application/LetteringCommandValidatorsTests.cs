using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Application.Features.Accounting.Validators;
using FluentValidation.TestHelper;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Plan de refonte du lettrage (Phase 1, Annexe A §3) : règles de durcissement des commandes de
/// lettrage/délettrage/complétion — bornes de lignes (≥2 pour lettrer, ≤500, distinctes, non
/// vides), origine restreinte côté HTTP (Manual/Suggestion uniquement), et format de code stable
/// (« L00001 » pour un groupe définitif, « P00001 » pour un groupe partiel).
/// </summary>
public sealed class LetteringCommandValidatorsTests
{
    private readonly LetterAccountEntriesCommandValidator _letterValidator = new();
    private readonly UnletterAccountEntriesCommandValidator _unletterValidator = new();
    private readonly CompletePartialLetteringCommandValidator _completeValidator = new();

    // ---- LetterAccountEntriesCommand ----

    [Fact]
    public void Letter_TwoDistinctIds_Passes()
    {
        var cmd = new LetterAccountEntriesCommand(new[] { Guid.NewGuid(), Guid.NewGuid() });
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldNotHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Letter_EmptyIds_Fails()
    {
        var cmd = new LetterAccountEntriesCommand(Array.Empty<Guid>());
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Letter_SingleId_Fails_AtLeastTwoRequired()
    {
        var cmd = new LetterAccountEntriesCommand(new[] { Guid.NewGuid() });
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Letter_MoreThan500Ids_Fails()
    {
        var ids = Enumerable.Range(0, 501).Select(_ => Guid.NewGuid()).ToArray();
        var cmd = new LetterAccountEntriesCommand(ids);
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Letter_Exactly500Ids_Passes()
    {
        var ids = Enumerable.Range(0, 500).Select(_ => Guid.NewGuid()).ToArray();
        var cmd = new LetterAccountEntriesCommand(ids);
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldNotHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Letter_EmptyGuidAmongIds_Fails()
    {
        var cmd = new LetterAccountEntriesCommand(new[] { Guid.NewGuid(), Guid.Empty });
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Letter_DuplicateIds_Fails()
    {
        var id = Guid.NewGuid();
        var cmd = new LetterAccountEntriesCommand(new[] { id, id });
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Theory]
    [InlineData(LetteringOrigin.Manual)]
    [InlineData(LetteringOrigin.Suggestion)]
    public void Letter_AllowedHttpOrigin_Passes(LetteringOrigin origin)
    {
        var cmd = new LetterAccountEntriesCommand(new[] { Guid.NewGuid(), Guid.NewGuid() }, Origin: origin);
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldNotHaveValidationErrorFor(x => x.Origin);
    }

    [Theory]
    [InlineData(LetteringOrigin.Automatic)]
    [InlineData(LetteringOrigin.Bulk)]
    [InlineData(LetteringOrigin.DraftUpdate)]
    [InlineData(LetteringOrigin.PayrollCancellation)]
    [InlineData(LetteringOrigin.ExchangeDifference)]
    public void Letter_InternalOnlyOrigin_RejectedFromHttpCommand(LetteringOrigin origin)
    {
        // Plan §4.3 : ces origines ne doivent arriver que par des flux internes (AutoLetterPaymentAsync,
        // paie, mise à jour de brouillon, apurement d'écart de change) qui n'empruntent pas cette
        // commande MediatR exposée en HTTP — le validator doit donc les refuser.
        var cmd = new LetterAccountEntriesCommand(new[] { Guid.NewGuid(), Guid.NewGuid() }, Origin: origin);
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.Origin);
    }

    [Fact]
    public void Letter_SuggestionKeyTooLong_Fails()
    {
        var cmd = new LetterAccountEntriesCommand(
            new[] { Guid.NewGuid(), Guid.NewGuid() }, SuggestionKey: new string('a', 33));
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.SuggestionKey);
    }

    [Fact]
    public void Letter_SuggestionKeyAt32Chars_Passes()
    {
        var cmd = new LetterAccountEntriesCommand(
            new[] { Guid.NewGuid(), Guid.NewGuid() }, SuggestionKey: new string('a', 32));
        var result = _letterValidator.TestValidate(cmd);
        result.ShouldNotHaveValidationErrorFor(x => x.SuggestionKey);
    }

    // ---- UnletterAccountEntriesCommand ----

    [Theory]
    [InlineData("L00001")]
    [InlineData("P00001")]
    [InlineData("l00001")]
    [InlineData("L123456789012345")]
    public void Unletter_ValidCode_Passes(string code)
    {
        var result = _unletterValidator.TestValidate(new UnletterAccountEntriesCommand(code));
        result.ShouldNotHaveValidationErrorFor(x => x.Code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("00001")]
    [InlineData("X00001")]
    [InlineData("L1")]
    [InlineData("L1234567890123456")]
    public void Unletter_InvalidCode_Fails(string code)
    {
        var result = _unletterValidator.TestValidate(new UnletterAccountEntriesCommand(code));
        result.ShouldHaveValidationErrorFor(x => x.Code);
    }

    // ---- CompletePartialLetteringCommand ----

    [Fact]
    public void Complete_PartialCode_WithNewLines_Passes()
    {
        var cmd = new CompletePartialLetteringCommand("P00001", new[] { Guid.NewGuid() });
        var result = _completeValidator.TestValidate(cmd);
        result.ShouldNotHaveValidationErrorFor(x => x.Code);
        result.ShouldNotHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Complete_DefinitiveCode_Fails_OnlyPartialAllowed()
    {
        var cmd = new CompletePartialLetteringCommand("L00001", new[] { Guid.NewGuid() });
        var result = _completeValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.Code);
    }

    [Fact]
    public void Complete_EmptyLines_Fails()
    {
        var cmd = new CompletePartialLetteringCommand("P00001", Array.Empty<Guid>());
        var result = _completeValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Complete_DuplicateLines_Fails()
    {
        var id = Guid.NewGuid();
        var cmd = new CompletePartialLetteringCommand("P00001", new[] { id, id });
        var result = _completeValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    [Fact]
    public void Complete_MoreThan500Lines_Fails()
    {
        var ids = Enumerable.Range(0, 501).Select(_ => Guid.NewGuid()).ToArray();
        var cmd = new CompletePartialLetteringCommand("P00001", ids);
        var result = _completeValidator.TestValidate(cmd);
        result.ShouldHaveValidationErrorFor(x => x.JournalEntryLineIds);
    }

    // ---- GetLetteringGroupQuery ----

    private readonly GetLetteringGroupQueryValidator _groupValidator = new();

    [Theory]
    [InlineData("L00001")]
    [InlineData("P00001")]
    [InlineData("l00001")]   // normalisé en majuscules avant validation
    [InlineData("  P12345  ")]
    public void GetGroup_ValidCode_Passes(string code)
    {
        var result = _groupValidator.TestValidate(new GetLetteringGroupQuery(code));
        result.ShouldNotHaveValidationErrorFor(x => x.Code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("00001")]
    [InlineData("X00001")]
    [InlineData("L1")]
    [InlineData("L1234567890123456")]
    public void GetGroup_InvalidCode_Fails(string code)
    {
        var result = _groupValidator.TestValidate(new GetLetteringGroupQuery(code));
        result.ShouldHaveValidationErrorFor(x => x.Code);
    }
}
