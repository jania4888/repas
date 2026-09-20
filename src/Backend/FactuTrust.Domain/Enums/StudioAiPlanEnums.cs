namespace FactuTrust.Domain.Enums;

/// <summary>Nature d'un plan de construction Studio IA en attente de validation utilisateur.</summary>
public enum StudioAiPlanKind
{
    /// <summary>Création d'une table simple (équivalent différé de studio_generate_app).</summary>
    CreateApp = 0,

    /// <summary>Création d'un système multi-tables (équivalent différé de studio_generate_system).</summary>
    CreateSystem = 1,

    /// <summary>Modification d'artefacts Studio existants (champs, formulaire, rapport).</summary>
    Amendment = 2,

    /// <summary>Création d'une fenêtre (vue lecture seule sur une table SQL réelle).</summary>
    View = 3,

    /// <summary>
    /// Création d'un ÉTAT sur les tables réelles du tenant (lecture seule, agrégation SQL).
    /// Ajouté en fin d'énumération : valeur persistée en <c>int</c>, aucune migration requise.
    /// </summary>
    Report = 4,

    /// <summary>
    /// Création d'une VUE ENREGISTRÉE (liste / kanban / calendrier) sur une table Studio existante
    /// (PR 2.4). Ajouté en fin d'énumération : valeur persistée en <c>int</c>, aucune migration requise.
    /// </summary>
    RecordView = 5,

    /// <summary>
    /// Création de WORKFLOWS (déclencheur + étapes : validation, relance, facturation automatique) sur
    /// des tables Studio existantes — plan de création de workflows, PR 4.3.
    /// Ajouté en fin d'énumération : valeur persistée en <c>int</c>, aucune migration requise.
    /// </summary>
    Workflow = 6
}

/// <summary>Cycle de vie d'un plan Studio IA : proposé → confirmé/annulé → exécuté.</summary>
public enum StudioAiPlanStatus
{
    /// <summary>Proposé par l'IA, en attente de la validation utilisateur.</summary>
    Pending = 0,

    /// <summary>Confirmation reçue, exécution en cours (transition protégée par RowVersion).</summary>
    Executing = 1,

    /// <summary>Exécution terminée avec succès.</summary>
    Completed = 2,

    /// <summary>Exécution terminée en échec (voir ErrorMessage).</summary>
    Failed = 3,

    /// <summary>Annulé par l'utilisateur avant exécution.</summary>
    Cancelled = 4,

    /// <summary>Expiré sans confirmation (durée de vie dépassée).</summary>
    Expired = 5
}
