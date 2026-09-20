namespace FactuTrust.Application.Features.Studio.Workflows.Spec;

/// <summary>
/// Les 7 types d'étapes d'un workflow Studio (ordre figé, affiché tel quel par le concepteur 4.4)
/// et le catalogue typé de leurs propriétés (§0.5) consommé par <c>GET workflows/step-catalog</c>.
/// Pur : aucune dépendance Infrastructure.
/// </summary>
public static class StudioWorkflowStepTypes
{
    public const string Condition = "condition";
    public const string UpdateField = "update_field";
    public const string ErpAction = "erp_action";
    public const string Notify = "notify";
    public const string Approval = "approval";
    public const string Wait = "wait";
    public const string CreateRecord = "create_record";

    /// <summary>Les 7 types, dans l'ordre figé du catalogue.</summary>
    public static readonly IReadOnlyList<string> All = new[]
    {
        Condition, UpdateField, ErpAction, Notify, Approval, Wait, CreateRecord
    };

    private static readonly IReadOnlyList<StepCatalogEntry> CatalogEntries = BuildCatalog();

    /// <summary>Catalogue des types avec libellés/aides FR et propriétés typées (§0.5).</summary>
    public static IReadOnlyList<StepCatalogEntry> Catalog() => CatalogEntries;

    private static IReadOnlyList<StepCatalogEntry> BuildCatalog() => new[]
    {
        new StepCatalogEntry(
            Condition,
            "Condition",
            "Ne poursuit le workflow que si les filtres sont remplis ; sinon arrête, ignore ou saute.",
            new StepCatalogProperty[]
            {
                new("filters", "filters", true,
                    "1 à 10 filtres { field, op, value, value2? } ; field ∈ champs actifs, _previous.<champ>, _approval.<clé>.status, _results.<clé>.<prop>.",
                    null, 1, 10),
                new("match", "enum", false,
                    "« all » (défaut) : tous les filtres ; « any » : au moins un.",
                    new[] { "all", "any" }, null, null),
                new("onFalse", "enum", false,
                    "Quand la condition est fausse : « stop » (défaut), « skip » ou « goto ».",
                    new[] { "stop", "skip", "goto" }, null, null),
                new("gotoKey", "string", false,
                    "Clé d'une étape postérieure (requis quand onFalse = « goto »).",
                    null, null, null)
            }),
        new StepCatalogEntry(
            UpdateField,
            "Mettre à jour un champ",
            "Écrit une ou plusieurs valeurs dans l'enregistrement courant (gabarits {{…}} autorisés).",
            new StepCatalogProperty[]
            {
                new("set", "fieldMap", true,
                    "1 à 10 paires champ → valeur ; champs actifs non calculés de la table.",
                    null, 1, 10)
            }),
        new StepCatalogEntry(
            ErpAction,
            "Action ERP (pont)",
            "Déclenche une action métier du catalogue Pont (créer une facture, une dépense…).",
            new StepCatalogProperty[]
            {
                new("action", "string", true,
                    "Clé d'une action du catalogue Pont (outil mutant hors studio_*).",
                    null, null, null),
                new("mapping", "mapping", false,
                    "0 à 20 entrées { param, source ∈ field|const|template, value } ; les paramètres requis de l'action doivent être couverts.",
                    null, 0, 20),
                new("onFailure", "enum", false,
                    "« fail » (défaut) : le workflow échoue ; « continue » : l'échec est ignoré.",
                    new[] { "fail", "continue" }, null, null),
                new("saveResultAs", "string", false,
                    "Mémorise le résultat sous ce nom (_results.<nom>) : a-z, 0-9, _ ; 1 à 32 caractères.",
                    null, null, null)
            }),
        new StepCatalogEntry(
            Notify,
            "Notifier",
            "Envoie une notification à un utilisateur, un rôle ou le lanceur du workflow.",
            new StepCatalogProperty[]
            {
                new("to", "recipient", true,
                    "{ kind ∈ user|role|startedBy, value } ; value = Guid (user) ou nom de rôle (role).",
                    null, null, null),
                new("title", "template", true,
                    "Titre de la notification (≤ 200 caractères, gabarits autorisés).",
                    null, null, 200),
                new("body", "template", false,
                    "Corps de la notification (≤ 1000 caractères, gabarits autorisés).",
                    null, null, 1000),
                new("link", "string", false,
                    "Lien relatif commençant par « / » (≤ 300 caractères).",
                    null, null, 300)
            }),
        new StepCatalogEntry(
            Approval,
            "Approbation",
            "Suspend le workflow jusqu'à la décision d'un utilisateur ou d'un rôle.",
            new StepCatalogProperty[]
            {
                new("assignee", "recipient", true,
                    "{ kind ∈ user|role, value } ; le lanceur (startedBy) n'est pas accepté.",
                    null, null, null),
                new("title", "template", true,
                    "Titre de la demande (≤ 200 caractères, gabarits autorisés).",
                    null, null, 200),
                new("message", "template", false,
                    "Message de la demande (≤ 1000 caractères, gabarits autorisés).",
                    null, null, 1000),
                new("dueInHours", "int", false,
                    "Délai de décision en heures (défaut 72).",
                    null, 1, 720),
                new("onTimeout", "enum", false,
                    "À l'expiration : « reject » (défaut), « approve » ou « fail ».",
                    new[] { "reject", "approve", "fail" }, null, null),
                new("onReject", "enum", false,
                    "Au refus : « stop » (défaut), « goto » ou « continue ».",
                    new[] { "stop", "goto", "continue" }, null, null),
                new("gotoKey", "string", false,
                    "Clé d'une étape postérieure (requis quand onReject = « goto »).",
                    null, null, null)
            }),
        new StepCatalogEntry(
            Wait,
            "Attendre",
            "Suspend le workflow pendant une durée ou jusqu'à une date.",
            new StepCatalogProperty[]
            {
                new("hours", "int", false,
                    "Durée d'attente en heures — « hours » ou « until », exactement un des deux.",
                    null, 1, 720),
                new("until", "template", false,
                    "Gabarit d'une date d'échéance (ex. {{date_livraison}}) — exclusif avec « hours ».",
                    null, null, null),
                new("maxHours", "int", false,
                    "Plafond d'attente en heures (défaut 720).",
                    null, 1, 720)
            }),
        new StepCatalogEntry(
            CreateRecord,
            "Créer un enregistrement",
            "Crée un enregistrement dans une autre table active (standard) du tenant.",
            new StepCatalogProperty[]
            {
                new("entity", "entity", true,
                    "Clé d'une table active et standard (jonctions exclues).",
                    null, null, null),
                new("set", "fieldMap", true,
                    "1 à 10 paires champ → valeur ; champs actifs non calculés de la table cible.",
                    null, 1, 10),
                new("saveResultAs", "string", false,
                    "Mémorise l'identifiant créé sous ce nom (_results.<nom>) : a-z, 0-9, _ ; 1 à 32 caractères.",
                    null, null, null)
            })
    };
}

/// <summary>Une entrée du catalogue des types d'étapes (consommée par le concepteur 4.4).</summary>
public sealed record StepCatalogEntry(
    string Type,
    string Label,
    string Description,
    IReadOnlyList<StepCatalogProperty> Properties);

/// <summary>
/// Une propriété typée d'un type d'étape. <paramref name="Kind"/> ∈
/// <c>string|int|bool|field|fieldMap|filters|mapping|recipient|template|enum|entity</c>.
/// </summary>
public sealed record StepCatalogProperty(
    string Name,
    string Kind,
    bool Required,
    string Help,
    IReadOnlyList<string>? AllowedValues,
    int? Min,
    int? Max);
