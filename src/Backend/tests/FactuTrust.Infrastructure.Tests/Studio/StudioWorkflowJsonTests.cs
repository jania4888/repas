using FactuTrust.Application.Features.Studio.Workflows.Spec;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA 4.7★3 (D-47-80) : <see cref="StudioWorkflowJson.TryParseObject"/> testée directement — le contrat est
/// désormais partagé par la lecture du cron (<c>StudioWorkflowScheduleService</c>), des filtres du déclencheur
/// planifié (<c>StudioWorkflowScheduledJob</c>) et des colonnes JSON du mapping (<c>StudioWorkflowMapping</c>) ;
/// il n'était couvert qu'indirectement (<c>"pas du json"</c>, <c>"{}"</c>). Seul un objet JSON lisible réussit ;
/// absent, blanc, illisible ou d'une autre forme (tableau, <c>null</c>, scalaire) échoue sans lever.
/// </summary>
public sealed class StudioWorkflowJsonTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("pas du json")]
    [InlineData("{ \"a\": ")]          // objet tronqué ⇒ JsonException absorbée
    [InlineData("[]")]                 // tableau
    [InlineData("null")]               // littéral null
    [InlineData("42")]                 // scalaire
    [InlineData("\"texte\"")]          // chaîne
    public void Returns_false_and_null_when_the_text_is_not_a_readable_json_object(string? json)
    {
        var ok = StudioWorkflowJson.TryParseObject(json, out var obj);

        Assert.False(ok);
        Assert.Null(obj);
    }

    [Theory]
    [InlineData("{}", 0)]
    [InlineData("{\"a\":1}", 1)]
    [InlineData("  { \"cron\": \"0 6 * * 1\", \"filters\": [] }  ", 2)] // espaces autour tolérés par l'analyseur
    public void Returns_the_object_when_the_text_is_a_json_object(string json, int expectedPropertyCount)
    {
        var ok = StudioWorkflowJson.TryParseObject(json, out var obj);

        Assert.True(ok);
        Assert.NotNull(obj);
        Assert.Equal(expectedPropertyCount, obj.Count);
    }
}
