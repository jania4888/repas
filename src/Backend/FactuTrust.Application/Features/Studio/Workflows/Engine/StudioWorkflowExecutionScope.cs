namespace FactuTrust.Application.Features.Studio.Workflows.Engine;

/// <summary>Marqueur de la portée d'exécution courante : instance d'origine de la chaîne et profondeur.</summary>
public sealed record StudioWorkflowExecutionMarker(Guid OriginInstanceId, int Depth);

/// <summary>
/// Portée d'exécution courante du moteur de workflows Studio (anti-boucle). Stockée en
/// <see cref="AsyncLocal{T}"/> : elle suit le flux asynchrone vers les tâches enfantes
/// mais ne remonte jamais vers le parent. Aucun autre état statique mutable.
/// </summary>
public static class StudioWorkflowExecutionScope
{
    /// <summary>
    /// Profondeur maximale d'une chaîne de workflows : A(0) → B(2) → refus (3 &gt; 2).
    /// </summary>
    public const int MaxDepth = 2;

    private static readonly AsyncLocal<StudioWorkflowExecutionMarker?> _current = new();

    /// <summary>Marqueur courant du flux asynchrone, <c>null</c> hors de toute portée.</summary>
    public static StudioWorkflowExecutionMarker? Current => _current.Value;

    /// <summary>
    /// Entre dans une portée d'exécution ; la valeur précédente est restaurée au
    /// <see cref="IDisposable.Dispose"/> (idempotent).
    /// </summary>
    public static IDisposable Enter(Guid originInstanceId, int depth)
    {
        var previous = _current.Value;
        _current.Value = new StudioWorkflowExecutionMarker(originInstanceId, depth);
        return new Scope(previous);
    }

    private sealed class Scope(StudioWorkflowExecutionMarker? previous) : IDisposable
    {
        private bool _disposed;

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _current.Value = previous;
        }
    }
}
