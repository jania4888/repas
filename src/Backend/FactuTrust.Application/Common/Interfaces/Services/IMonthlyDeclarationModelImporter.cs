using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Applique un modèle d'intégration DM déjà analysé au dossier courant — l'écriture de
/// « Modèle Intégration DM ».
/// </summary>
/// <remarks>
/// L'analyse du fichier reste en couche application (<see cref="MonthlyDeclarationModel"/>) : elle
/// est pure et se teste sans base. Seule l'écriture descend ici, parce qu'elle partage son point
/// d'écriture avec la duplication inter-dossiers, lequel travaille directement sur le contexte
/// tenant. La commande décide ; ce service exécute.
/// </remarks>
public interface IMonthlyDeclarationModelImporter
{
    /// <param name="rubrics">Rubriques déjà validées. Une entrée fautive n'arrive jamais jusqu'ici.</param>
    /// <param name="families">
    /// Inclusions à aligner. Vide lorsque le fichier n'en porte pas — un catalogue d'amorçage, par
    /// exemple — et dans ce cas aucune inclusion du dossier n'est touchée.
    /// </param>
    /// <param name="overwrite">
    /// Faux : seules les rubriques dont le code est absent sont créées. Vrai : les codes en commun
    /// sont remplacés. Dans les deux cas, rien n'est supprimé en masse.
    /// </param>
    /// <param name="upgradeToV2">
    /// Non nul pour un fichier v1 importé une fois la montée v2 autorisée : ses familles identiques
    /// au catalogue v1 sont importées dans leur définition v2, par la même règle que la montée.
    /// </param>
    Task<Result<MonthlyDeclarationModelImportOutcome>> ImportAsync(
        IReadOnlyList<MonthlyDeclarationRubricDraft> rubrics,
        IReadOnlyList<MonthlyDeclarationFamilyDraft> families,
        bool overwrite,
        CancellationToken cancellationToken = default,
        MonthlyDeclarationImportUpgrade? upgradeToV2 = null);
}

/// <summary>Passage v1 → v2 d'un fichier importé.</summary>
/// <param name="TclRatePercent">Taux de TCL de la plateforme, repris par la rubrique TCL.</param>
public sealed record MonthlyDeclarationImportUpgrade(decimal TclRatePercent);

/// <summary>Ce que l'écriture a réellement fait.</summary>
public sealed record MonthlyDeclarationModelImportOutcome(
    int Inserted,
    int Replaced,
    IReadOnlyList<string> SkippedCodes,
    IReadOnlyList<string> UnknownAccounts,
    int FamiliesChanged,
    IReadOnlyList<MonthlyDeclarationFamily>? UpgradedFamilies = null);
