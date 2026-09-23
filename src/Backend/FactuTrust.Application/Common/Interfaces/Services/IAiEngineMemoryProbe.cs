namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Mémoire du MOTEUR d'inférence (Ollama), et non du processus API.
///
/// <para><b>Pourquoi ce contrat existe</b> : le contrôle de faisabilité comparait la taille
/// d'un fichier modèle Ollama à <c>GC.GetGCMemoryInfo().TotalAvailableMemoryBytes</c> moins
/// le working set de l'API. Or le modèle ne se charge pas dans le processus API : il se
/// charge dans Ollama, qui a son propre espace mémoire et sa propre limite. En déploiement
/// conteneurisé, le back-office affichait « RAM totale 4,5 Go » — soit exactement 75 % de la
/// limite du conteneur API — et l'import de facture par photo était refusé alors qu'Ollama
/// avait la place. La même heuristique vivait dans deux fichiers ; elle est désormais ici,
/// et seulement ici.</para>
/// </summary>
/// <param name="TotalBytes">Capacité mémoire du moteur d'inférence.</param>
/// <param name="AvailableBytes">
/// Mémoire qu'un modèle peut occuper pour être chargeable. Avec un budget déclaré, elle vaut le
/// budget entier : les modèles résidents ne sont pas déduits, Ollama évinçant un modèle inactif
/// pour charger le suivant.
/// </param>
/// <param name="IsMeaningful">
/// Faux quand l'API n'a aucun moyen fiable de connaître la mémoire du moteur (moteur distant
/// et aucun budget déclaré). Les appelants doivent alors <b>renoncer au verdict mémoire</b>
/// plutôt que de refuser un modèle sur une mesure qui ne le concerne pas.
/// </param>
public readonly record struct AiEngineMemorySnapshot(
    long TotalBytes,
    long AvailableBytes,
    bool IsMeaningful)
{
    /// <summary>Mesure indisponible : ne jamais s'en servir pour refuser un modèle.</summary>
    public static AiEngineMemorySnapshot Unknown { get; } = new(0, 0, false);
}

public interface IAiEngineMemoryProbe
{
    Task<AiEngineMemorySnapshot> ReadAsync(CancellationToken cancellationToken = default);
}
