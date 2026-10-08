using System.Text.Json;

namespace FactuTrust.Application.Features.AI.Json;

/// <summary>
/// Schémas JSON transmis à Ollama (clé <c>format</c>) pour contraindre le décodage du modèle.
///
/// <para>C'est la correction « à la source » du défaut de typage : avec <c>format: "json"</c>, seule
/// la syntaxe est garantie, et un modèle 4B écrit volontiers <c>19.0</c> là où un entier est
/// attendu. Avec un schéma, le décodeur d'Ollama ne peut plus produire cette forme.</para>
///
/// <para><b>Cela ne remplace jamais les convertisseurs tolérants</b> : OpenRouter n'est pas
/// concerné, les versions d'Ollama antérieures à 0.5 ignorent ou rejettent le schéma, et un modèle
/// peut toujours renvoyer une valeur absurde dans le bon type. <see cref="LlmJsonOptions.Tolerant"/>
/// reste la défense réelle.</para>
///
/// <para>Le schéma est volontairement PARTIEL : il fixe les types qui posaient problème (entiers,
/// nombres, chaînes énumérées, tableaux de chaînes) sans lister <c>required</c>, afin qu'un champ
/// absent reste licite — le mapping aval sait déjà vivre avec des trous.</para>
/// </summary>
public static class LlmOutputSchemas
{
    private const string AccountingDocumentSchemaJson = """
        {
          "type": "object",
          "properties": {
            "documentType": { "type": "string", "enum": ["INVOICE","CREDIT_NOTE","DELIVERY_NOTE","PROFORMA","UNKNOWN"] },
            "documentNumber": { "type": ["string","null"] },
            "issueDate": { "type": ["string","null"] },
            "dueDate": { "type": ["string","null"] },
            "documentStatus": { "type": ["string","null"] },
            "currency": { "type": ["string","null"] },
            "seller": { "$ref": "#/$defs/party" },
            "buyer": { "$ref": "#/$defs/party" },
            "lines": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "designation": { "type": ["string","null"] },
                  "reference": { "type": ["string","null"] },
                  "quantity": { "type": ["number","null"] },
                  "unit": { "type": ["string","null"] },
                  "unitPriceHt": { "type": ["number","null"] },
                  "discountPercent": { "type": ["number","null"] },
                  "vatRatePercent": { "type": ["integer","null"] }
                }
              }
            },
            "vatBreakdown": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "ratePercent": { "type": ["integer","null"] },
                  "baseAmount": { "type": ["number","null"] },
                  "vatAmount": { "type": ["number","null"] }
                }
              }
            },
            "totalHt": { "type": ["number","null"] },
            "totalVat": { "type": ["number","null"] },
            "fodecAmount": { "type": ["number","null"] },
            "fiscalStampAmount": { "type": ["number","null"] },
            "withholdingAmount": { "type": ["number","null"] },
            "totalTtc": { "type": ["number","null"] },
            "confidence": { "type": ["string","null"], "enum": ["high","medium","low",null] },
            "warnings": { "type": "array", "items": { "type": "string" } }
          },
          "$defs": {
            "party": {
              "type": ["object","null"],
              "properties": {
                "name": { "type": ["string","null"] },
                "nif": { "type": ["string","null"] },
                "email": { "type": ["string","null"] },
                "phone": { "type": ["string","null"] },
                "street": { "type": ["string","null"] },
                "city": { "type": ["string","null"] },
                "postalCode": { "type": ["string","null"] },
                "governorate": { "type": ["string","null"] }
              }
            }
          }
        }
        """;

    /// <summary>
    /// Schéma de <c>LlmAccountingDocument</c>, désérialisé une seule fois.
    /// <see cref="JsonElement"/> est immuable et sérialisable tel quel dans la requête Ollama.
    /// </summary>
    public static JsonElement AccountingDocument { get; } =
        JsonDocument.Parse(AccountingDocumentSchemaJson).RootElement.Clone();

    /// <summary>
    /// Même document, mais TOUT MONTANT TYPÉ EN CHAÎNE : recopie telle qu'imprimée.
    ///
    /// <para>Destiné aux services d'extraction documentaire externes, qui convertissent les
    /// nombres eux-mêmes. Mesuré sur Docstrange le 2026-10-08 : « 1138,155 » demandé en
    /// <c>number</c> revient <c>1138155</c> — la virgule décimale tunisienne est lue comme un
    /// séparateur de milliers et le montant sort multiplié par 1000, sans aucun signal. Voir
    /// <c>docs/developer/docstrange-api-contract.md</c>.</para>
    ///
    /// <para>En chaîne, la valeur est recopiée et la conversion reste serveur :
    /// <c>LlmJsonOptions.Tolerant</c> la confie à <c>TunisianNumberParsing.ParseDecimal</c>, qui
    /// connaît la convention TND. Même raison d'être que
    /// <see cref="BankStatementPageVerbatim"/>.</para>
    ///
    /// <para>Les définitions sont inlinées : la prise en charge de <c>$ref</c> / <c>$defs</c> par
    /// ces services n'est pas établie.</para>
    /// </summary>
    public static JsonElement AccountingDocumentVerbatim { get; } =
        JsonDocument.Parse(AccountingDocumentVerbatimSchemaJson).RootElement.Clone();

    private const string AccountingDocumentVerbatimSchemaJson = """
        {
          "type": "object",
          "properties": {
            "documentType": { "type": "string", "enum": ["INVOICE","CREDIT_NOTE","DELIVERY_NOTE","PROFORMA","UNKNOWN"] },
            "documentNumber": { "type": ["string","null"] },
            "issueDate": { "type": ["string","null"] },
            "dueDate": { "type": ["string","null"] },
            "documentStatus": { "type": ["string","null"] },
            "currency": { "type": ["string","null"] },
            "seller": {
              "type": ["object","null"],
              "properties": {
                "name": { "type": ["string","null"] },
                "nif": { "type": ["string","null"] },
                "email": { "type": ["string","null"] },
                "phone": { "type": ["string","null"] },
                "street": { "type": ["string","null"] },
                "city": { "type": ["string","null"] },
                "postalCode": { "type": ["string","null"] },
                "governorate": { "type": ["string","null"] }
              }
            },
            "buyer": {
              "type": ["object","null"],
              "properties": {
                "name": { "type": ["string","null"] },
                "nif": { "type": ["string","null"] },
                "email": { "type": ["string","null"] },
                "phone": { "type": ["string","null"] },
                "street": { "type": ["string","null"] },
                "city": { "type": ["string","null"] },
                "postalCode": { "type": ["string","null"] },
                "governorate": { "type": ["string","null"] }
              }
            },
            "lines": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "designation": { "type": ["string","null"] },
                  "reference": { "type": ["string","null"] },
                  "quantity": { "type": ["string","null"] },
                  "unit": { "type": ["string","null"] },
                  "unitPriceHt": { "type": ["string","null"] },
                  "discountPercent": { "type": ["string","null"] },
                  "vatRatePercent": { "type": ["string","null"] }
                }
              }
            },
            "vatBreakdown": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "ratePercent": { "type": ["string","null"] },
                  "baseAmount": { "type": ["string","null"] },
                  "vatAmount": { "type": ["string","null"] }
                }
              }
            },
            "totalHt": { "type": ["string","null"] },
            "totalVat": { "type": ["string","null"] },
            "fodecAmount": { "type": ["string","null"] },
            "fiscalStampAmount": { "type": ["string","null"] },
            "withholdingAmount": { "type": ["string","null"] },
            "totalTtc": { "type": ["string","null"] },
            "confidence": { "type": ["string","null"], "enum": ["high","medium","low",null] },
            "warnings": { "type": "array", "items": { "type": "string" } }
          }
        }
        """;

    private const string BankStatementPageSchemaJson = """
        {
          "type": "object",
          "properties": {
            "openingBalance": { "type": ["number","null"] },
            "closingBalance": { "type": ["number","null"] },
            "lines": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "date": { "type": ["string","null"] },
                  "valueDate": { "type": ["string","null"] },
                  "label": { "type": ["string","null"] },
                  "debit": { "type": ["number","null"] },
                  "credit": { "type": ["number","null"] }
                }
              }
            }
          }
        }
        """;

    /// <summary>Schéma d'une PAGE de relevé bancaire lue par l'IA (import vers le journal de banque).</summary>
    public static JsonElement BankStatementPage { get; } =
        JsonDocument.Parse(BankStatementPageSchemaJson).RootElement.Clone();

    private const string BankStatementPageVerbatimSchemaJson = """
        {
          "type": "object",
          "properties": {
            "rib": { "type": ["string","null"], "maxLength": 24 },
            "openingBalance": { "type": ["string","null"], "maxLength": 32 },
            "closingBalance": { "type": ["string","null"], "maxLength": 32 },
            "lines": {
              "type": "array",
              "maxItems": 120,
              "items": {
                "type": "object",
                "properties": {
                  "date": { "type": ["string","null"], "maxLength": 16 },
                  "valueDate": { "type": ["string","null"], "maxLength": 16 },
                  "label": { "type": ["string","null"], "maxLength": 300 },
                  "debit": { "type": ["string","null"], "maxLength": 32 },
                  "credit": { "type": ["string","null"], "maxLength": 32 }
                }
              }
            }
          }
        }
        """;

    /// <summary>Schéma vision : montants et dates recopiés tels qu'imprimés (chaînes).</summary>
    public static JsonElement BankStatementPageVerbatim { get; } =
        JsonDocument.Parse(BankStatementPageVerbatimSchemaJson).RootElement.Clone();

    /// <summary>Valeur historique : JSON syntaxiquement valide, sans contrainte de type.</summary>
    public const string PlainJson = "json";
}
