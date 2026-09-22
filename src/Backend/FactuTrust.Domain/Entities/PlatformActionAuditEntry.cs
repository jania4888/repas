namespace FactuTrust.Domain.Entities;

/// <summary>
/// Journal d'audit des actions d'administration <b>plateforme</b>, en base maître.
///
/// <para>
/// Il existe pour une raison précise : la création d'un dossier client par un opérateur plateforme
/// n'était traçable que dans les logs Serilog. <c>AuditService</c> ne pouvait pas servir — il écrit
/// des lignes chaînées par hachage dans la base <b>du tenant</b>, qui n'existe pas encore au moment
/// où l'action a lieu.
/// </para>
///
/// <para>
/// Volontairement plus simple que l'audit tenant (pas de chaîne de hachage), au même titre que
/// <see cref="ModuleGrantAuditEntry"/> : il s'agit d'une action d'administration, pas d'une pièce
/// comptable. Table en ajout seul.
/// </para>
/// </summary>
public sealed class PlatformActionAuditEntry
{
    public Guid Id { get; private set; }

    /// <summary>Opérateur plateforme à l'origine de l'action.</summary>
    public Guid ActorUserId { get; private set; }

    /// <summary>Email de l'opérateur au moment de l'action (dénormalisé : reste lisible si le compte disparaît).</summary>
    public string? ActorEmail { get; private set; }

    /// <summary>Discriminant court, ex. <c>tenant.create.company</c>.</summary>
    public string Action { get; private set; } = null!;

    /// <summary><c>Success</c> ou <c>Failed</c> — les échecs sont ce qu'on cherche lors d'un incident.</summary>
    public string Outcome { get; private set; } = null!;

    /// <summary>Tenant concerné ; null quand l'action a échoué avant sa création.</summary>
    public Guid? TargetTenantId { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Identifiant de corrélation partagé avec les logs applicatifs.</summary>
    public string? CorrelationId { get; private set; }

    /// <summary>
    /// Contexte JSON sans donnée personnelle : secteur, domaine, modules, forfait, motif d'échec.
    /// Jamais de mot de passe ni de jeton.
    /// </summary>
    public string DetailsJson { get; private set; } = null!;

    private PlatformActionAuditEntry() { }

    public static PlatformActionAuditEntry Create(
        Guid actorUserId,
        string? actorEmail,
        string action,
        string outcome,
        Guid? targetTenantId,
        string? correlationId,
        string? detailsJson)
    {
        if (string.IsNullOrWhiteSpace(action))
            throw new ArgumentException("Action is required.", nameof(action));
        if (string.IsNullOrWhiteSpace(outcome))
            throw new ArgumentException("Outcome is required.", nameof(outcome));

        return new PlatformActionAuditEntry
        {
            Id = Guid.NewGuid(),
            ActorUserId = actorUserId,
            ActorEmail = actorEmail,
            Action = action.Trim(),
            Outcome = outcome.Trim(),
            TargetTenantId = targetTenantId,
            CreatedAtUtc = DateTime.UtcNow,
            CorrelationId = correlationId,
            DetailsJson = detailsJson ?? "{}"
        };
    }
}

/// <summary>Valeurs stables de <see cref="PlatformActionAuditEntry.Action"/>.</summary>
public static class PlatformAuditActions
{
    public const string TenantCreateCompany = "tenant.create.company";
    public const string TenantCreateFirm = "tenant.create.firm";
    public const string TenantProvisioningRetry = "tenant.provisioning.retry";

    /// <summary>
    /// Bascule du plan comptable d'un dossier vers la NCT 01. Action <b>irréversible</b> hors
    /// restauration de sauvegarde : elle réécrit les numéros de compte, y compris dans les périodes
    /// clôturées. Consignée en <c>dryRun</c> comme en application réelle.
    /// </summary>
    public const string ChartOfAccountsNct01Apply = "chart-of-accounts.nct01.apply";
}

/// <summary>Valeurs stables de <see cref="PlatformActionAuditEntry.Outcome"/>.</summary>
public static class PlatformAuditOutcomes
{
    public const string Success = "Success";
    public const string Failed = "Failed";
}
