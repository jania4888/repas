namespace FactuTrust.Application.Common.Identity;

/// <summary>
/// Contexte ambiant de l'identité impersonnée, stocké en <see cref="AsyncLocal{T}"/> : il suit le
/// flux asynchrone vers les tâches enfantes mais ne remonte jamais vers le parent ni vers un flux
/// frère. Seule <see cref="Enter"/> écrit la valeur — il n'existe pas de <c>Set</c> public — afin
/// de garantir la restauration de la valeur précédente au <see cref="IDisposable.Dispose"/>.
/// Copie structurelle de <c>StudioWorkflowExecutionScope</c>.
/// </summary>
public static class ImpersonatedUserContext
{
    private static readonly AsyncLocal<ImpersonatedUserSnapshot?> _current = new();

    /// <summary>Instantané courant du flux asynchrone, <c>null</c> hors de toute impersonation.</summary>
    public static ImpersonatedUserSnapshot? Current => _current.Value;

    /// <summary>
    /// Entre dans une impersonation ; la valeur précédente est restaurée au
    /// <see cref="IDisposable.Dispose"/> (idempotent).
    /// </summary>
    public static IDisposable Enter(ImpersonatedUserSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        var previous = _current.Value;
        _current.Value = snapshot;
        return new Scope(previous);
    }

    private sealed class Scope(ImpersonatedUserSnapshot? previous) : IDisposable
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
