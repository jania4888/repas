using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.Projects;

public sealed class Project : AggregateRoot
{
    public Guid ClientId { get; private set; }
    public string Name { get; private set; } = null!;
    public string? Description { get; private set; }
    public ProjectKind Kind { get; private set; }
    public ProjectBillingMode BillingMode { get; private set; }
    public ProjectStatus Status { get; private set; }
    public DateTime? StartDate { get; private set; }
    public DateTime? EndDate { get; private set; }
    public decimal BudgetHt { get; private set; }
    public string Currency { get; private set; } = "TND";
    public Guid? OwnerUserId { get; private set; }

    public string? SiteAddress { get; private set; }
    public string? ContractNumber { get; private set; }
    public bool TimesheetsEnabled { get; private set; }
    public Guid? SalesOrderId { get; private set; }
    public string? AnalyticAccountCode { get; private set; }
    public bool MilestonesEnabled { get; private set; }
    public decimal AllocatedHours { get; private set; }

    private Project() { }

    public static Result<Project> Create(
        Guid clientId,
        string name,
        ProjectKind kind,
        ProjectBillingMode billingMode,
        Guid? ownerUserId,
        DateTime? startDate,
        DateTime? endDate,
        decimal budgetHt,
        string? description = null,
        string? siteAddress = null,
        string? contractNumber = null,
        string currency = "TND",
        bool timesheetsEnabled = true,
        Guid? salesOrderId = null,
        string? analyticAccountCode = null,
        bool milestonesEnabled = false,
        decimal allocatedHours = 0)
    {
        name = name?.Trim() ?? string.Empty;
        if (clientId == Guid.Empty)
            return Result.Failure<Project>(Error.Validation("ClientId", "Le client est obligatoire"));
        if (string.IsNullOrEmpty(name))
            return Result.Failure<Project>(Error.Validation("Name", "Le nom du projet est obligatoire"));
        if (name.Length > 200)
            name = name[..200];
        if (budgetHt < 0)
            return Result.Failure<Project>(Error.Validation("BudgetHt", "Le budget ne peut pas être négatif"));
        if (endDate.HasValue && startDate.HasValue && endDate.Value.Date < startDate.Value.Date)
            return Result.Failure<Project>(Error.Validation("EndDate", "La date de fin doit être postérieure au début"));

        if (kind != ProjectKind.Btp && billingMode == ProjectBillingMode.ProgressSituations)
            return Result.Failure<Project>(Error.Validation("BillingMode", "Les situations de travaux sont réservées au pack BTP"));

        return Result.Success(new Project
        {
            ClientId = clientId,
            Name = name,
            Description = description?.Trim(),
            Kind = kind,
            BillingMode = billingMode,
            Status = ProjectStatus.Draft,
            StartDate = startDate?.Date,
            EndDate = endDate?.Date,
            BudgetHt = decimal.Round(budgetHt, 3),
            Currency = string.IsNullOrWhiteSpace(currency) ? "TND" : currency.Trim().ToUpperInvariant(),
            OwnerUserId = ownerUserId,
            SiteAddress = siteAddress?.Trim(),
            ContractNumber = contractNumber?.Trim(),
            TimesheetsEnabled = timesheetsEnabled,
            SalesOrderId = salesOrderId == Guid.Empty ? null : salesOrderId,
            AnalyticAccountCode = analyticAccountCode?.Trim(),
            MilestonesEnabled = milestonesEnabled,
            AllocatedHours = decimal.Round(Math.Max(0, allocatedHours), 2)
        });
    }

    public Result LinkSalesOrder(Guid salesOrderId)
    {
        if (salesOrderId == Guid.Empty)
            return Result.Failure(Error.Validation("SalesOrderId", "La commande est obligatoire"));
        SalesOrderId = salesOrderId;
        IncrementVersion();
        return Result.Success();
    }

    public Result SetAnalyticAccountCode(string? code)
    {
        AnalyticAccountCode = string.IsNullOrWhiteSpace(code) ? null : code.Trim();
        IncrementVersion();
        return Result.Success();
    }

    public Result ConfigureTimesheets(bool enabled, bool milestonesEnabled, decimal allocatedHours)
    {
        TimesheetsEnabled = enabled;
        MilestonesEnabled = milestonesEnabled;
        AllocatedHours = decimal.Round(Math.Max(0, allocatedHours), 2);
        IncrementVersion();
        return Result.Success();
    }

    public Result Update(
        string name,
        string? description,
        ProjectBillingMode billingMode,
        Guid? ownerUserId,
        DateTime? startDate,
        DateTime? endDate,
        decimal budgetHt,
        string? siteAddress,
        string? contractNumber)
    {
        if (!Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Ce projet ne peut plus être modifié"));

        name = name?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(name))
            return Result.Failure(Error.Validation("Name", "Le nom du projet est obligatoire"));
        if (budgetHt < 0)
            return Result.Failure(Error.Validation("BudgetHt", "Le budget ne peut pas être négatif"));
        if (endDate.HasValue && startDate.HasValue && endDate.Value.Date < startDate.Value.Date)
            return Result.Failure(Error.Validation("EndDate", "La date de fin doit être postérieure au début"));

        if (Kind != ProjectKind.Btp && billingMode == ProjectBillingMode.ProgressSituations)
            return Result.Failure(Error.Validation("BillingMode", "Les situations de travaux sont réservées au pack BTP"));

        Name = name.Length > 200 ? name[..200] : name;
        Description = description?.Trim();
        BillingMode = billingMode;
        OwnerUserId = ownerUserId;
        StartDate = startDate?.Date;
        EndDate = endDate?.Date;
        BudgetHt = decimal.Round(budgetHt, 3);
        SiteAddress = Kind == ProjectKind.Btp ? siteAddress?.Trim() : SiteAddress;
        ContractNumber = Kind == ProjectKind.Btp ? contractNumber?.Trim() : ContractNumber;
        IncrementVersion();
        return Result.Success();
    }

    public Result Activate()
    {
        if (Status is not ProjectStatus.Draft and not ProjectStatus.OnHold)
            return Result.Failure(Error.Validation("Status", "Seul un projet brouillon ou en pause peut être activé"));
        Status = ProjectStatus.Active;
        IncrementVersion();
        return Result.Success();
    }

    public Result Hold()
    {
        if (Status != ProjectStatus.Active)
            return Result.Failure(Error.Validation("Status", "Seul un projet actif peut être mis en pause"));
        Status = ProjectStatus.OnHold;
        IncrementVersion();
        return Result.Success();
    }

    public Result Complete(bool hasOpenTimeEntries)
    {
        if (Status is not ProjectStatus.Active and not ProjectStatus.OnHold)
            return Result.Failure(Error.Validation("Status", "Ce projet ne peut pas être clôturé"));
        if (hasOpenTimeEntries)
            return Result.Failure(Error.Validation("Status", "Validez ou annulez les temps ouverts avant de clôturer"));
        Status = ProjectStatus.Completed;
        IncrementVersion();
        return Result.Success();
    }

    public Result Cancel()
    {
        if (Status is ProjectStatus.Completed or ProjectStatus.Cancelled)
            return Result.Failure(Error.Validation("Status", "Ce projet ne peut pas être annulé"));
        Status = ProjectStatus.Cancelled;
        IncrementVersion();
        return Result.Success();
    }
}
