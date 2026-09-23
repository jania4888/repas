namespace FactuTrust.Domain.Entities.PublicContact;

/// <summary>
/// Objet d'une demande de contact déposée depuis la landing publique. Les valeurs numériques
/// sont persistées (colonne int) : ne jamais renuméroter.
/// </summary>
public enum PublicContactSubject
{
    /// <summary>Demande d'accès (entreprise / TPE-PME).</summary>
    AccesEntreprise = 1,

    /// <summary>Demande de démo pour un cabinet comptable.</summary>
    DemoCabinet = 2,

    /// <summary>Intérêt pour le plan Entreprise.</summary>
    Entreprise = 3,

    /// <summary>Autre demande.</summary>
    Autre = 4
}
