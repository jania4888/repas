using FactuTrust.Domain.Entities.Studio.Workflows;

namespace FactuTrust.Application.Features.Studio.Workflows.Engine;

/// <summary>
/// Synchronisation « décision mémorisée + instance due » (D-05) partagée par la décision utilisateur
/// (4.2e, <c>DecideApprovalCommand</c>) et l'expiration planifiée (4.2d, job de reprise) : le statut
/// d'approbation est inscrit au contexte et l'instance est suspendue <i>à son statut courant</i> —
/// donc rendue due — sans changer d'étape. L'appelant persiste ensuite l'instance.
/// Contrat moteur : si la sérialisation du contexte échoue (contexte trop volumineux), l'ancien JSON
/// est conservé — le marqueur de décision n'y figure pas et le moteur l'ignorera au prochain tick ;
/// cas extrême accepté (la décision, elle, est déjà persistée sur l'approbation).
/// </summary>
public static class StudioWorkflowDecisionSync
{
    /// <summary>
    /// Mémorise la décision dans le contexte de <paramref name="instance"/> et la rend due.
    /// Retourne <c>false</c> si le repli JSON a été appliqué (l'appelant peut alors journaliser).
    /// </summary>
    public static bool Apply(
        StudioWorkflowInstance instance, string stepKey, string status, string? comment, Guid? decidedBy, DateTime now)
    {
        var context = StudioWorkflowContext.Parse(instance.ContextJson);
        context.SetApproval(stepKey, status, comment, decidedBy, now);
        var serialized = context.Serialize();
        instance.Suspend(instance.Status, now, serialized.IsSuccess ? serialized.Value : instance.ContextJson);
        return serialized.IsSuccess;
    }
}
