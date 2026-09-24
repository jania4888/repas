namespace FactuTrust.Domain.Entities.PublicContact;

/// <summary>
/// Statut de traitement interne d'une demande de contact. Les valeurs numériques sont
/// persistées (colonne int) : ne jamais renuméroter.
/// </summary>
public enum PublicContactRequestStatus
{
    /// <summary>Demande reçue, pas encore traitée.</summary>
    New = 0,

    /// <summary>Le prospect a été recontacté.</summary>
    Contacted = 1,

    /// <summary>Demande clôturée.</summary>
    Closed = 2,

    /// <summary>Demande classée comme spam (time-trap ou tri manuel) : rétention courte.</summary>
    Spam = 3
}
