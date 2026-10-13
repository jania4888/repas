using System.Data.Common;
using FactuTrust.Application.Common.Interfaces;

namespace FactuTrust.Infrastructure.MultiTenancy;

/// <summary>
/// Porteur scoped de la transaction ambiante ouverte par <see cref="TenantUnitOfWork"/>.
/// Quand elle est active, <see cref="TenantDbContextFactory.CreateContext"/> enrôle les
/// contextes créés par les repositories sur la MÊME connexion/transaction : les écritures
/// multi-repositories deviennent atomiques sans modifier les repositories.
/// Les services qui ouvrent leur propre transaction (audit, numérotation, périodes)
/// doivent utiliser <see cref="ITenantDbContextFactory.CreateIsolatedContext"/>.
/// </summary>
public sealed class TenantAmbientTransaction : IAmbientTransactionState
{
    public DbConnection? Connection { get; private set; }
    public DbTransaction? Transaction { get; private set; }

    public bool IsActive => Transaction is not null;

    internal void Activate(DbConnection connection, DbTransaction transaction)
    {
        if (IsActive)
            throw new InvalidOperationException(
                "Une transaction ambiante est déjà active dans ce scope (les unités de travail imbriquées doivent réutiliser la transaction en cours).");
        Connection = connection;
        Transaction = transaction;
    }

    internal void Clear()
    {
        Connection = null;
        Transaction = null;
    }
}
