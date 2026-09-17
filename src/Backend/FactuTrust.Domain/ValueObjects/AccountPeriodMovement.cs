using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.ValueObjects;

/// <summary>
/// Mouvement d'un compte sur une période : cumul des débits et cumul des crédits, non compensés.
/// </summary>
/// <remarks>
/// <para>
/// Les deux sens sont conservés séparément plutôt que réduits à un solde signé, parce que la
/// configuration de la déclaration mensuelle choisit explicitement le sens à lire (« Sens Brut »,
/// « Sens Retenu »). Un solde net ferait disparaître l'information : sur un compte de TVA collectée
/// mouvementé dans les deux sens, lire « le crédit » et lire « le net » ne donnent pas le même
/// montant, et c'est le premier que porte la déclaration.
/// </para>
/// <para>
/// Les montants sont ceux de la devise de tenue : les lignes d'écriture sont toujours tenues en
/// dinar, la devise de transaction vivant à côté.
/// </para>
/// </remarks>
public readonly record struct AccountPeriodMovement(decimal Debit, decimal Credit)
{
    public static AccountPeriodMovement Zero => new(0m, 0m);

    /// <summary>Cumul du sens demandé.</summary>
    public decimal For(AccountBalanceSide side) =>
        side == AccountBalanceSide.Debit ? Debit : Credit;

    /// <summary>Cumule deux mouvements du même compte (agrégation de plusieurs sources).</summary>
    public AccountPeriodMovement Add(AccountPeriodMovement other) =>
        new(Debit + other.Debit, Credit + other.Credit);
}
