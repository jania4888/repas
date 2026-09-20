namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>
/// Une étape d'avancement d'un plan Studio. <paramref name="Status"/> ∈ <c>running</c> |
/// <c>done</c> | <c>error</c> | <c>skipped</c> (étape volontairement ignorée — p. ex. opération
/// d'amendement connue de la spec mais pas encore exécutable, PR 3.1b).
/// </summary>
public sealed record StudioBuildStep(
    string Phase,
    string Label,
    string Status,
    string? EntityRef = null,
    string? Detail = null);

public interface IStudioBuildProgress
{
    void Report(StudioBuildStep step);
}