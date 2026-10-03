namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Extrait d'une page TEXTE de relevé envoyé à l'IA : quelques opérations entières, lignes
/// reconstruites par la lecture directe (colonnes alignées) et précédées des en-têtes du tableau.
/// Les montants imprimés servent d'ancrage : une ligne proposée par l'IA dont le montant n'y figure
/// pas est refusée.
/// </summary>
/// <param name="Page">Page (1-based) d'où vient l'extrait.</param>
/// <param name="Index">Rang de l'extrait dans la page (0-based).</param>
/// <param name="Text">Texte envoyé à l'IA (RIB masqués, délimiteurs neutralisés).</param>
/// <param name="OperationAmounts">Montants imprimés sur les lignes d'opérations de l'extrait (valeurs absolues, doublons conservés).</param>
/// <param name="ContextAmounts">Montants imprimés hors opérations (en-têtes, solde d'ouverture, totaux, solde final).</param>
/// <param name="OperationSides">
/// Sens de la colonne où chaque montant de <paramref name="OperationAmounts"/> est imprimé (même ordre) :
/// true = Débit, false = Crédit, null = inconnu (pas d'en-têtes Débit / Crédit, montant dans le libellé).
/// </param>
public sealed record BankStatementAiTextChunk(
    int Page,
    int Index,
    string Text,
    IReadOnlyList<decimal> OperationAmounts,
    IReadOnlyList<decimal> ContextAmounts,
    IReadOnlyList<bool?>? OperationSides = null);
