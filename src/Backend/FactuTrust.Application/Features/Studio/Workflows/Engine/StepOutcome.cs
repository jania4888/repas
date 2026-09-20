using System.Text.Json.Nodes;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Workflows.Engine;

/// <summary>
/// Issue de l'exécution d'une étape de workflow Studio (D6) : ce que le moteur
/// doit faire ensuite. <see cref="Kind"/> donne la valeur persistée dans la
/// colonne <c>StudioWorkflowStepRuns.Outcome</c>.
/// </summary>
public abstract record StepOutcome
{
    /// <summary>Passe à l'étape suivante, avec un résultat optionnel (journal, tronqué à 8 Ko).</summary>
    public sealed record Continue(JsonObject? Result = null) : StepOutcome;

    /// <summary>Saute l'étape sans la compter comme un échec (condition non remplie…).</summary>
    public sealed record Skip(string Reason) : StepOutcome;

    /// <summary>Saute vers l'étape <paramref name="TargetKey"/> (postérieure — vérifié par le moteur).</summary>
    public sealed record Goto(string TargetKey, JsonObject? Result = null) : StepOutcome;

    /// <summary>Termine le workflow avec succès avant la fin des étapes.</summary>
    public sealed record Stop(string Reason) : StepOutcome;

    /// <summary>Suspend l'instance (attente ou approbation) jusqu'à <paramref name="DueAt"/>.</summary>
    public sealed record Suspend(StudioWorkflowInstanceStatus Status, DateTime? DueAt, JsonObject? Result = null) : StepOutcome;

    /// <summary>Échoue l'étape ; <paramref name="ContinueAnyway"/> permet de poursuivre malgré l'échec.</summary>
    public sealed record Fail(string Error, bool ContinueAnyway = false) : StepOutcome;

    /// <summary>Valeur persistée correspondant au sous-type concret (commutateur exhaustif).</summary>
    public StudioWorkflowStepOutcome Kind => this switch
    {
        Continue => StudioWorkflowStepOutcome.Continue,
        Skip => StudioWorkflowStepOutcome.Skip,
        Goto => StudioWorkflowStepOutcome.Goto,
        Stop => StudioWorkflowStepOutcome.Stop,
        Suspend => StudioWorkflowStepOutcome.Suspend,
        Fail => StudioWorkflowStepOutcome.Fail,
        _ => throw new InvalidOperationException($"Issue d'étape non prise en charge : {GetType().Name}.")
    };
}
