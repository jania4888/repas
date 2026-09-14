namespace FactuTrust.Application.Common.Interfaces;

/// <summary>
/// Manages NON-persisted computed-column indexes on the tenant <c>CustomRecords</c> table to
/// accelerate per-field lookups (currently: unique-field checks). All operations are best-effort:
/// indexing is a performance optimization, never a correctness requirement, so failures never
/// propagate to the caller.
/// </summary>
public interface IJsonIndexManager
{
    /// <summary>Ensures the computed column + filtered index exist for a (sanitized) field key. Idempotent, best-effort.</summary>
    Task EnsureUniqueFieldIndexAsync(Guid tenantId, string fieldKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// R10 (PR 2.1) : ensures the NON-unique computed column + filtered index <c>jx_&lt;key&gt;</c> exist for a
    /// (sanitized) field key so server-side filters (<c>filterField</c>/<c>filterValue</c>) and pair-uniqueness
    /// checks on junction tables can seek the index. Idempotent, best-effort (never throws).
    /// </summary>
    Task EnsureFieldIndexAsync(Guid tenantId, string fieldKey, CancellationToken cancellationToken = default);

    /// <summary>True if the indexed computed column exists for the field key (cached). Used to decide whether to seek the index.</summary>
    Task<bool> IndexedColumnExistsAsync(Guid tenantId, string fieldKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// PR 3.1 (changement de type de champ) : supprime l'index filtré puis la colonne calculée
    /// <c>jx_&lt;key&gt;</c> (unique ou non, même mécanisme) si elles existent, et invalide le cache de
    /// <see cref="IndexedColumnExistsAsync"/>. Idempotent, best-effort (jamais d'exception) : la colonne
    /// calculée est typée par l'ancien type de champ, elle doit disparaître avant qu'un nouveau type ne
    /// la recrée (<c>Ensure*FieldIndexAsync</c>) pour éviter des erreurs de conversion en lecture.
    /// </summary>
    Task DropFieldIndexAsync(Guid tenantId, string fieldKey, CancellationToken cancellationToken = default);
}
