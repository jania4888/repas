namespace FactuTrust.Domain.Entities.PublicContact;

/// <summary>
/// Dictionnaire bidirectionnel code JSON (contrat public figé) ↔ <see cref="PublicContactSubject"/>
/// ↔ libellé français (e-mail interne). Les codes sont sensibles à la casse (liste blanche stricte).
/// </summary>
public static class PublicContactSubjectCodes
{
    public const string AccesEntreprise = "acces-entreprise";
    public const string DemoCabinet = "demo-cabinet";
    public const string Entreprise = "entreprise";
    public const string Autre = "autre";

    private static readonly IReadOnlyDictionary<string, PublicContactSubject> CodeToSubject =
        new Dictionary<string, PublicContactSubject>(StringComparer.Ordinal)
        {
            [AccesEntreprise] = PublicContactSubject.AccesEntreprise,
            [DemoCabinet] = PublicContactSubject.DemoCabinet,
            [Entreprise] = PublicContactSubject.Entreprise,
            [Autre] = PublicContactSubject.Autre
        };

    /// <summary>Codes acceptés par l'API, dans l'ordre d'affichage du formulaire.</summary>
    public static IReadOnlyList<string> All { get; } = new[] { AccesEntreprise, DemoCabinet, Entreprise, Autre };

    /// <summary>Résout un code JSON en objet. Refuse null, vide, casse différente ou code inconnu.</summary>
    public static bool TryParse(string? code, out PublicContactSubject subject)
    {
        if (!string.IsNullOrEmpty(code) && CodeToSubject.TryGetValue(code, out subject))
        {
            return true;
        }

        subject = default;
        return false;
    }

    /// <summary>Code JSON d'un objet (inverse de <see cref="TryParse"/>).</summary>
    public static string ToCode(PublicContactSubject subject) => subject switch
    {
        PublicContactSubject.AccesEntreprise => AccesEntreprise,
        PublicContactSubject.DemoCabinet => DemoCabinet,
        PublicContactSubject.Entreprise => Entreprise,
        PublicContactSubject.Autre => Autre,
        _ => throw new ArgumentOutOfRangeException(nameof(subject), subject, "Unknown public contact subject.")
    };

    /// <summary>Libellé français lisible, destiné à l'e-mail interne et au back-office.</summary>
    public static string ToLabelFr(PublicContactSubject subject) => subject switch
    {
        PublicContactSubject.AccesEntreprise => "Demande d'accès entreprise",
        PublicContactSubject.DemoCabinet => "Démo cabinet comptable",
        PublicContactSubject.Entreprise => "Plan Entreprise",
        PublicContactSubject.Autre => "Autre demande",
        _ => throw new ArgumentOutOfRangeException(nameof(subject), subject, "Unknown public contact subject.")
    };
}
