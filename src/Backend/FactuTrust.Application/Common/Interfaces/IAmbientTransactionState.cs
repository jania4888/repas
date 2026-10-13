namespace FactuTrust.Application.Common.Interfaces;

/// <summary>
/// Sonde en lecture seule de la transaction ambiante du scope (unité de travail tenant).
/// </summary>
/// <remarks>
/// Le lettrage en masse (plan v2, annexe C §4) exige une transaction par groupe. Dans une
/// transaction ambiante, chaque groupe serait absorbé par la transaction englobante : un échec
/// tardif annulerait alors tout le lot. Le handler de masse refuse donc de s'exécuter quand
/// <see cref="IsActive"/> est vrai.
/// </remarks>
public interface IAmbientTransactionState
{
    /// <summary>Vrai si une transaction ambiante est ouverte dans le scope courant.</summary>
    bool IsActive { get; }
}
