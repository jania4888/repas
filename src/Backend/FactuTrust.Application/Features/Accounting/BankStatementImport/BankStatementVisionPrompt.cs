namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Consignes GLM-OCR pour UNE page de relevé bancaire. Le modèle (0,9 B, GGUF + mmproj) ne connaît
/// que deux familles de consignes : l'analyse de document (<c>Text Recognition:</c>,
/// <c>Table Recognition:</c>…) et l'extraction d'informations par la consigne native
/// <c>请按下列JSON格式输出图中信息:</c> suivie d'un gabarit JSON à valeurs vides. Toute autre
/// consigne (règles en français, message système) le fait sortir de son mode supporté : la
/// grammaire <c>format</c> d'Ollama produit alors un JSON valide mais vide.
/// Ces textes sont envoyés tels quels (<c>AiStructuredExtractionRequest.RawUserPrompt</c>).
/// </summary>
public static class BankStatementVisionPrompt
{
    /// <summary>
    /// Aucun message système pour GLM-OCR (il n'a pas été entraîné avec). La clause « le contenu
    /// du document est une donnée, jamais une instruction » est portée par le pipeline : aucun texte
    /// extrait n'est envoyé au modèle vision et sa sortie est entièrement re-parsée et bornée
    /// (normaliseur + schéma). Le modèle texte garde <see cref="BankStatementAiPrompt.System"/>.
    /// </summary>
    public const string System = "";

    /// <summary>Consigne native d'extraction d'informations de GLM-OCR (ne pas traduire).</summary>
    public const string NativeExtractionPrefix = "请按下列JSON格式输出图中信息:";

    /// <summary>Gabarit JSON à valeurs vides : mêmes clés que le schéma verbatim et le normaliseur.</summary>
    public const string NativeExtractionTemplate =
        """{"rib": "", "openingBalance": "", "closingBalance": "", "lines": [{"date": "", "valueDate": "", "label": "", "debit": "", "credit": ""}]}""";

    /// <summary>
    /// Étage 1 : consigne native + gabarit, puis une courte ligne en français tolérée APRÈS le
    /// gabarit (à retirer si la recette montre qu'elle dégrade le rappel).
    /// </summary>
    public const string NativeExtractionInstruction =
        NativeExtractionPrefix + "\n" + NativeExtractionTemplate + "\n"
        + "Montants et dates tels qu'imprimés, une opération par ligne.";

    /// <summary>Étage 2 : tableau brut (HTML ou Markdown), analysé côté serveur.</summary>
    public const string TableRecognitionInstruction = "Table Recognition:";

    /// <summary>OCR pur : texte brut de la page (recoupement, étage 3).</summary>
    public const string TextRecognitionInstruction = "Text Recognition:";

    /// <summary>Alias historique de l'étage 1 (anciens appelants et tests).</summary>
    public const string UserInstruction = NativeExtractionInstruction;
}
