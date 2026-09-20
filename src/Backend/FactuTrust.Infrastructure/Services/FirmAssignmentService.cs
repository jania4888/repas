using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services;

public sealed class FirmAssignmentService : IFirmAssignmentService
{
    /// <summary>Statuts « ouverts » (une seule liaison ouverte par société) — traduisible en SQL via Contains.</summary>
    private static readonly FirmAssignmentStatus[] OpenStatuses =
    [
        FirmAssignmentStatus.PendingFirmApproval,
        FirmAssignmentStatus.Active
    ];

    private readonly MasterDbContext _masterContext;
    private readonly INotificationService _notificationService;
    private readonly ICompanyProfileSnapshotProvider _companyProfileSnapshot;
    private readonly IFirmDossierAccessService _dossierAccess;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<FirmAssignmentService> _logger;

    public FirmAssignmentService(
        MasterDbContext masterContext,
        INotificationService notificationService,
        ICompanyProfileSnapshotProvider companyProfileSnapshot,
        IFirmDossierAccessService dossierAccess,
        ICurrentUser currentUser,
        ILogger<FirmAssignmentService> logger)
    {
        _masterContext = masterContext;
        _notificationService = notificationService;
        _companyProfileSnapshot = companyProfileSnapshot;
        _dossierAccess = dossierAccess;
        _currentUser = currentUser;
        _logger = logger;
    }

    public async Task<IReadOnlyList<AccountingFirmDirectoryItemDto>> SearchDirectoryAsync(
        string? search, int page, int pageSize, CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / 50);
        pageSize = Math.Clamp(pageSize, 1, 50);

        var query = from profile in _masterContext.AccountingFirmProfiles.AsNoTracking()
                    join tenant in _masterContext.Tenants.AsNoTracking() on profile.TenantId equals tenant.Id
                    where profile.IsPublicInDirectory && tenant.IsActive && tenant.Kind == TenantKind.AccountingFirm
                    select new { profile, tenant };

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(x =>
                x.profile.DisplayName.ToLower().Contains(term) ||
                x.profile.City.ToLower().Contains(term) ||
                x.profile.Governorate.ToLower().Contains(term));
        }

        return await query
            .OrderBy(x => x.profile.DisplayName)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new AccountingFirmDirectoryItemDto
            {
                FirmTenantId = x.profile.TenantId,
                DisplayName = x.profile.DisplayName,
                City = x.profile.City,
                Governorate = x.profile.Governorate,
                Description = x.profile.Description,
                ProfessionalRegistrationNumber = x.profile.ProfessionalRegistrationNumber
            })
            .ToListAsync(cancellationToken);
    }

    public Task<FirmClientAssignmentDto?> GetCompanyCurrentAssignmentAsync(
        Guid companyTenantId, CancellationToken cancellationToken = default)
        => GetCompanyCurrentAssignmentAsync(_masterContext, companyTenantId, cancellationToken);

    /// <summary>
    /// Surcharge interne : accepte un <see cref="MasterDbContext"/> explicite. Voir la doc
    /// de <see cref="GetActiveClientsAsync(MasterDbContext, Guid, CancellationToken)"/> pour
    /// le rationnel — utilisée par le bootstrap company qui doit rester sur un contexte isolé.
    /// </summary>
    internal async Task<FirmClientAssignmentDto?> GetCompanyCurrentAssignmentAsync(
        MasterDbContext masterContext,
        Guid companyTenantId,
        CancellationToken cancellationToken = default)
    {
        var assignment = await masterContext.FirmClientAssignments.AsNoTracking()
            .Where(a => a.CompanyTenantId == companyTenantId && OpenStatuses.Contains(a.Status))
            .OrderByDescending(a => a.RequestedAt)
            .FirstOrDefaultAsync(cancellationToken);

        return assignment is null ? null : await MapAssignmentAsync(masterContext, assignment, cancellationToken);
    }

    public async Task<IReadOnlyList<FirmClientAssignmentDto>> GetCompanyAssignmentHistoryAsync(
        Guid companyTenantId, CancellationToken cancellationToken = default)
    {
        var assignments = await _masterContext.FirmClientAssignments.AsNoTracking()
            .Where(a => a.CompanyTenantId == companyTenantId)
            .OrderByDescending(a => a.RequestedAt)
            .ToListAsync(cancellationToken);

        return await MapAssignmentsAsync(assignments, cancellationToken);
    }

    public async Task<Result<FirmClientAssignmentDto>> RequestAssignmentAsync(
        Guid companyTenantId, Guid requestedByUserId, RequestFirmAssignmentDto dto, CancellationToken cancellationToken = default)
    {
        var company = await _masterContext.Tenants.FindAsync([companyTenantId], cancellationToken);
        if (company is null || !company.IsActive || company.Kind != TenantKind.Company)
            return Result.Failure<FirmClientAssignmentDto>(Error.Validation("Company", "Société invalide"));

        var firm = await _masterContext.Tenants.FindAsync([dto.FirmTenantId], cancellationToken);
        if (firm is null || !firm.IsActive || firm.Kind != TenantKind.AccountingFirm)
            return Result.Failure<FirmClientAssignmentDto>(Error.Validation("Firm", "Cabinet comptable invalide"));

        var hasOpen = await _masterContext.FirmClientAssignments
            .AnyAsync(a => a.CompanyTenantId == companyTenantId && OpenStatuses.Contains(a.Status),
                cancellationToken);
        if (hasOpen)
            return Result.Failure<FirmClientAssignmentDto>(Error.Validation("Assignment", "Une demande ou affectation est déjà en cours"));

        var createResult = FirmClientAssignment.Request(companyTenantId, dto.FirmTenantId, requestedByUserId, dto.Notes);
        if (createResult.IsFailure)
            return Result.Failure<FirmClientAssignmentDto>(createResult.Error);

        var assignment = createResult.Value;
        try
        {
            var snapshot = await _companyProfileSnapshot.CaptureForCompanyTenantAsync(companyTenantId, cancellationToken);
            assignment.AttachCompanyProfileSnapshot(
                _companyProfileSnapshot.Serialize(snapshot),
                snapshot.CapturedAtUtc);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Capture du profil société ignorée pour le tenant {TenantId}", companyTenantId);
        }

        _masterContext.FirmClientAssignments.Add(assignment);
        try
        {
            await _masterContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
        {
            // Course entre deux demandes concurrentes : l'index unique filtré fait foi.
            _masterContext.FirmClientAssignments.Remove(assignment);
            return Result.Failure<FirmClientAssignmentDto>(Error.Validation("Assignment", "Une demande ou affectation est déjà en cours"));
        }

        await TryNotifyAsync(
            dto.FirmTenantId,
            nameof(UserRole.FirmManager),
            NotificationType.FirmAssignmentRequested,
            "Nouvelle demande de liaison",
            $"{company.CompanyName} souhaite vous confier sa comptabilité.",
            "/firm/invitations");

        var mapped = await MapAssignmentAsync(assignment, cancellationToken);
        return Result.Success(mapped);
    }

    public async Task<Result> CancelPendingByCompanyAsync(
        Guid companyTenantId, Guid cancelledByUserId, CancellationToken cancellationToken = default)
    {
        var assignment = await _masterContext.FirmClientAssignments
            .FirstOrDefaultAsync(a => a.CompanyTenantId == companyTenantId && a.Status == FirmAssignmentStatus.PendingFirmApproval, cancellationToken);

        if (assignment is null)
            return Result.Failure(Error.Validation("Assignment", "Aucune demande en attente"));

        var cancelResult = assignment.CancelByCompany(cancelledByUserId);
        if (cancelResult.IsFailure)
            return cancelResult;

        await _masterContext.SaveChangesAsync(cancellationToken);

        await TryNotifyAsync(
            assignment.FirmTenantId,
            nameof(UserRole.FirmManager),
            NotificationType.FirmAssignmentCancelled,
            "Demande de liaison annulée",
            $"{await GetTenantNameAsync(assignment.CompanyTenantId)} a annulé sa demande de liaison.",
            "/firm/invitations");

        return Result.Success();
    }

    public async Task<Result> RevokeByCompanyAsync(
        Guid companyTenantId, Guid revokedByUserId, CancellationToken cancellationToken = default)
    {
        var assignment = await _masterContext.FirmClientAssignments
            .FirstOrDefaultAsync(a => a.CompanyTenantId == companyTenantId && a.Status == FirmAssignmentStatus.Active, cancellationToken);

        if (assignment is null)
            return Result.Failure(Error.Validation("Assignment", "Aucune affectation active"));

        var revokeResult = assignment.RevokeByCompany(revokedByUserId);
        if (revokeResult.IsFailure)
            return revokeResult;

        await _masterContext.SaveChangesAsync(cancellationToken);

        await TryNotifyAsync(
            assignment.FirmTenantId,
            nameof(UserRole.FirmManager),
            NotificationType.FirmAssignmentRevoked,
            "Liaison révoquée",
            $"{await GetTenantNameAsync(assignment.CompanyTenantId)} a révoqué la liaison comptable.",
            "/firm/dashboard");

        return Result.Success();
    }

    public async Task<IReadOnlyList<FirmClientAssignmentDto>> GetIncomingInvitationsAsync(
        Guid firmTenantId, CancellationToken cancellationToken = default)
    {
        var assignments = await _masterContext.FirmClientAssignments.AsNoTracking()
            .Where(a => a.FirmTenantId == firmTenantId && a.Status == FirmAssignmentStatus.PendingFirmApproval)
            .OrderByDescending(a => a.RequestedAt)
            .ToListAsync(cancellationToken);

        return await MapAssignmentsAsync(assignments, cancellationToken);
    }

    public Task<IReadOnlyList<FirmClientDossierDto>> GetActiveClientsAsync(
        Guid firmTenantId, CancellationToken cancellationToken = default)
        => GetActiveClientsAsync(_masterContext, firmTenantId, cancellationToken);

    /// <summary>
    /// Surcharge interne : accepte un <see cref="MasterDbContext"/> explicite.
    /// Utilisée par <c>ExchangeService.BootstrapAsync</c> pour opérer sur un DbContext
    /// dédié (produit par <c>IDbContextFactory&lt;MasterDbContext&gt;</c>) et éviter tout
    /// partage d'instance avec le scope de requête (DataProtection, autres services scoped)
    /// qui déclenche « A second operation was started on this context instance… ».
    /// Aucun impact sur les appelants existants (ils passent par la surcharge publique).
    /// </summary>
    internal async Task<IReadOnlyList<FirmClientDossierDto>> GetActiveClientsAsync(
        MasterDbContext masterContext,
        Guid firmTenantId,
        CancellationToken cancellationToken = default)
    {
        IReadOnlySet<Guid>? allowedCompanyIds = null;
        if (_currentUser.TryGetAccessScope(out var scope))
        {
            // On propage le contexte isolé au calcul de portée dossier pour rester sur la
            // même instance EF Core de bout en bout — la version publique appelée resterait
            // sur _dossierAccess._master (scoped), rouvrant le vecteur de concurrence.
            allowedCompanyIds = await FirmDossierAccessService.GetAccessibleCompanyTenantIdsAsync(
                masterContext, firmTenantId, scope, cancellationToken);
            if (allowedCompanyIds is { Count: 0 })
                return [];
        }
        else if (_currentUser.IsAuthenticated
                 && _currentUser.Role is UserRole.FirmAccountant)
        {
            // Fail-closed: comptable sans scope exploitable.
            return [];
        }

        var clientsQuery =
            from a in masterContext.FirmClientAssignments.AsNoTracking()
            join t in masterContext.Tenants.AsNoTracking() on a.CompanyTenantId equals t.Id
            where a.FirmTenantId == firmTenantId && a.Status == FirmAssignmentStatus.Active
            select new
            {
                a.Id,
                a.CompanyTenantId,
                t.CompanyName,
                ActiveSince = a.RespondedAt ?? a.RequestedAt,
                IsFirmManaged = t.ManagedByFirmTenantId != null
            };

        if (allowedCompanyIds is not null)
            clientsQuery = clientsQuery.Where(c => allowedCompanyIds.Contains(c.CompanyTenantId));

        var clients = await clientsQuery.OrderBy(c => c.CompanyName).ToListAsync(cancellationToken);

        var permanentByAssignment = await masterContext.PermanentFiles.AsNoTracking()
            .Where(p => p.FirmTenantId == firmTenantId)
            .Select(p => new
            {
                p.FirmClientAssignmentId,
                p.Status,
                p.AssignedAccountantUserId,
                p.AssignedAccountantName
            })
            .ToDictionaryAsync(p => p.FirmClientAssignmentId, cancellationToken);

        return clients.Select(c =>
        {
            permanentByAssignment.TryGetValue(c.Id, out var pf);
            var awaiting = pf is null || pf.AssignedAccountantUserId is null;
            return new FirmClientDossierDto
            {
                AssignmentId = c.Id,
                CompanyTenantId = c.CompanyTenantId,
                CompanyName = c.CompanyName,
                ActiveSince = c.ActiveSince,
                HasPermanentFile = pf is not null,
                PermanentFileStatus = pf is not null ? (int?)pf.Status : null,
                PermanentFileStatusDisplay = pf is null
                    ? null
                    : pf.Status == PermanentFileStatus.Complete
                        ? "Complet"
                        : pf.Status == PermanentFileStatus.InProgress
                            ? "En cours"
                            : pf.Status == PermanentFileStatus.Archived
                                ? "Archivé"
                                : "Brouillon",
                AssignedAccountantUserId = pf?.AssignedAccountantUserId,
                AssignedAccountantName = pf?.AssignedAccountantName,
                IsAwaitingAccountantAssignment = awaiting,
                IsFirmManaged = c.IsFirmManaged
            };
        }).ToList();
    }

    public async Task<Result> AcceptAssignmentAsync(
        Guid firmTenantId, Guid assignmentId, Guid respondedByUserId, CancellationToken cancellationToken = default)
    {
        var assignment = await _masterContext.FirmClientAssignments
            .FirstOrDefaultAsync(a => a.Id == assignmentId && a.FirmTenantId == firmTenantId, cancellationToken);

        if (assignment is null)
            return Result.Failure(Error.NotFound("Assignment", assignmentId));

        var acceptResult = assignment.Accept(respondedByUserId);
        if (acceptResult.IsFailure)
            return acceptResult;

        await _masterContext.SaveChangesAsync(cancellationToken);

        await TryNotifyAsync(
            assignment.CompanyTenantId,
            nameof(UserRole.Administrator),
            NotificationType.FirmAssignmentAccepted,
            "Demande acceptée",
            $"Le cabinet {await GetFirmDisplayNameAsync(assignment.FirmTenantId)} a accepté votre demande de liaison.",
            "/settings/accounting-firm");

        return Result.Success();
    }

    public async Task<Result> RejectAssignmentAsync(
        Guid firmTenantId, Guid assignmentId, Guid respondedByUserId, string? reason = null, CancellationToken cancellationToken = default)
    {
        var assignment = await _masterContext.FirmClientAssignments
            .FirstOrDefaultAsync(a => a.Id == assignmentId && a.FirmTenantId == firmTenantId, cancellationToken);

        if (assignment is null)
            return Result.Failure(Error.NotFound("Assignment", assignmentId));

        var rejectResult = assignment.Reject(respondedByUserId, reason);
        if (rejectResult.IsFailure)
            return rejectResult;

        await _masterContext.SaveChangesAsync(cancellationToken);

        var rejectionBody = $"Le cabinet {await GetFirmDisplayNameAsync(assignment.FirmTenantId)} a refusé votre demande de liaison.";
        if (!string.IsNullOrEmpty(assignment.RejectionReason))
            rejectionBody += $" Motif : {assignment.RejectionReason}";

        await TryNotifyAsync(
            assignment.CompanyTenantId,
            nameof(UserRole.Administrator),
            NotificationType.FirmAssignmentRejected,
            "Demande refusée",
            rejectionBody,
            "/settings/accounting-firm");

        return Result.Success();
    }

    public async Task<Result> RevokeByFirmAsync(
        Guid firmTenantId, Guid assignmentId, Guid revokedByUserId, CancellationToken cancellationToken = default)
    {
        var assignment = await _masterContext.FirmClientAssignments
            .FirstOrDefaultAsync(a => a.Id == assignmentId && a.FirmTenantId == firmTenantId, cancellationToken);

        if (assignment is null)
            return Result.Failure(Error.NotFound("Assignment", assignmentId));

        var revokeResult = assignment.RevokeByFirm(revokedByUserId);
        if (revokeResult.IsFailure)
            return revokeResult;

        // Dossier créé et géré par le cabinet (sans compte plateforme) : la résiliation
        // désactive aussi le tenant, sinon il resterait orphelin et inaccessible à tous.
        var companyTenant = await _masterContext.Tenants
            .FirstOrDefaultAsync(t => t.Id == assignment.CompanyTenantId, cancellationToken);
        var isFirmManaged = companyTenant?.ManagedByFirmTenantId == firmTenantId;
        if (isFirmManaged)
            companyTenant!.Deactivate();

        await _masterContext.SaveChangesAsync(cancellationToken);

        // Pas de notification pour un dossier géré : la société n'a aucun utilisateur.
        if (!isFirmManaged)
        {
            await TryNotifyAsync(
                assignment.CompanyTenantId,
                nameof(UserRole.Administrator),
                NotificationType.FirmAssignmentRevoked,
                "Liaison résiliée",
                $"Le cabinet {await GetFirmDisplayNameAsync(assignment.FirmTenantId)} a résilié la liaison comptable.",
                "/settings/accounting-firm");
        }

        return Result.Success();
    }

    public async Task<bool> HasActiveAssignmentAsync(
        Guid firmTenantId, Guid companyTenantId, CancellationToken cancellationToken = default)
    {
        return await _masterContext.FirmClientAssignments.AsNoTracking()
            .AnyAsync(a =>
                a.FirmTenantId == firmTenantId &&
                a.CompanyTenantId == companyTenantId &&
                a.Status == FirmAssignmentStatus.Active,
                cancellationToken);
    }

    public async Task<AccountingFirmProfileDto?> GetFirmProfileAsync(
        Guid firmTenantId, CancellationToken cancellationToken = default)
    {
        var profile = await _masterContext.AccountingFirmProfiles.AsNoTracking()
            .FirstOrDefaultAsync(p => p.TenantId == firmTenantId, cancellationToken);

        return profile is null ? null : MapProfile(profile);
    }

    public async Task<Result> UpdateFirmProfileAsync(
        Guid firmTenantId, UpdateAccountingFirmProfileDto dto, CancellationToken cancellationToken = default)
    {
        var profile = await _masterContext.AccountingFirmProfiles
            .FirstOrDefaultAsync(p => p.TenantId == firmTenantId, cancellationToken);

        if (profile is null)
            return Result.Failure(Error.Validation("Profile", "Profil cabinet introuvable"));

        profile.Update(
            dto.DisplayName,
            dto.City,
            dto.Governorate,
            dto.ContactEmail,
            dto.ContactPhone,
            dto.Description,
            dto.ProfessionalRegistrationNumber,
            dto.IsPublicInDirectory);

        await _masterContext.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private Task<FirmClientAssignmentDto> MapAssignmentAsync(
        FirmClientAssignment assignment, CancellationToken cancellationToken)
        => MapAssignmentAsync(_masterContext, assignment, cancellationToken);

    private async Task<FirmClientAssignmentDto> MapAssignmentAsync(
        MasterDbContext masterContext,
        FirmClientAssignment assignment,
        CancellationToken cancellationToken)
    {
        var mapped = await MapAssignmentsAsync(masterContext, [assignment], cancellationToken);
        return mapped[0];
    }

    /// <summary>Mapping par lots : 2 requêtes au total (Tenants + AccountingFirmProfiles) quel que soit le nombre d'assignments.</summary>
    private Task<IReadOnlyList<FirmClientAssignmentDto>> MapAssignmentsAsync(
        IReadOnlyList<FirmClientAssignment> assignments, CancellationToken cancellationToken)
        => MapAssignmentsAsync(_masterContext, assignments, cancellationToken);

    private async Task<IReadOnlyList<FirmClientAssignmentDto>> MapAssignmentsAsync(
        MasterDbContext masterContext,
        IReadOnlyList<FirmClientAssignment> assignments,
        CancellationToken cancellationToken)
    {
        if (assignments.Count == 0)
            return Array.Empty<FirmClientAssignmentDto>();

        var tenantIds = assignments
            .SelectMany(a => new[] { a.CompanyTenantId, a.FirmTenantId })
            .Distinct()
            .ToList();

        var tenantInfos = await masterContext.Tenants.AsNoTracking()
            .Where(t => tenantIds.Contains(t.Id))
            .Select(t => new { t.Id, t.CompanyName, IsFirmManaged = t.ManagedByFirmTenantId != null })
            .ToDictionaryAsync(t => t.Id, cancellationToken);

        var tenantNames = tenantInfos.ToDictionary(kv => kv.Key, kv => kv.Value.CompanyName);

        var firmIds = assignments.Select(a => a.FirmTenantId).Distinct().ToList();
        var firmProfileNames = await masterContext.AccountingFirmProfiles.AsNoTracking()
            .Where(p => firmIds.Contains(p.TenantId))
            .ToDictionaryAsync(p => p.TenantId, p => p.DisplayName, cancellationToken);

        return assignments.Select(assignment => new FirmClientAssignmentDto
        {
            Id = assignment.Id,
            CompanyTenantId = assignment.CompanyTenantId,
            CompanyName = tenantNames.GetValueOrDefault(assignment.CompanyTenantId, string.Empty),
            FirmTenantId = assignment.FirmTenantId,
            FirmDisplayName = firmProfileNames.GetValueOrDefault(assignment.FirmTenantId)
                ?? tenantNames.GetValueOrDefault(assignment.FirmTenantId, string.Empty),
            Status = assignment.Status,
            StatusDisplay = assignment.Status.ToDisplayString(),
            RequestedAt = assignment.RequestedAt,
            RespondedAt = assignment.RespondedAt,
            RevokedAt = assignment.RevokedAt,
            Notes = assignment.Notes,
            RejectionReason = assignment.RejectionReason,
            CompanyProfile = _companyProfileSnapshot.TryDeserialize(assignment.CompanyProfileSnapshotJson),
            IsFirmManaged = tenantInfos.TryGetValue(assignment.CompanyTenantId, out var companyInfo) && companyInfo.IsFirmManaged
        }).ToList();
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException ex) =>
        ex.InnerException is SqlException { Number: 2601 or 2627 };

    /// <summary>
    /// Émission best-effort d'une notification in-app : ne fait jamais échouer
    /// l'opération métier qui vient d'être validée (log warning au pire).
    /// </summary>
    private async Task TryNotifyAsync(
        Guid recipientTenantId,
        string recipientRole,
        NotificationType type,
        string title,
        string body,
        string? linkUrl)
    {
        try
        {
            await _notificationService.CreateAsync(
                recipientTenantId, recipientRole, type, title, body, linkUrl, CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Échec d'émission de la notification {Type} vers le tenant {TenantId}", type, recipientTenantId);
        }
    }

    /// <summary>Nom d'affichage du cabinet (profil annuaire, sinon tenant) — sans exception (usage notification).</summary>
    private async Task<string> GetFirmDisplayNameAsync(Guid firmTenantId)
    {
        try
        {
            var profileName = await _masterContext.AccountingFirmProfiles.AsNoTracking()
                .Where(p => p.TenantId == firmTenantId)
                .Select(p => p.DisplayName)
                .FirstOrDefaultAsync();

            return !string.IsNullOrEmpty(profileName) ? profileName : await GetTenantNameAsync(firmTenantId);
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>Nom du tenant — sans exception (usage notification).</summary>
    private async Task<string> GetTenantNameAsync(Guid tenantId)
    {
        try
        {
            return await _masterContext.Tenants.AsNoTracking()
                .Where(t => t.Id == tenantId)
                .Select(t => t.CompanyName)
                .FirstOrDefaultAsync() ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static AccountingFirmProfileDto MapProfile(AccountingFirmProfile profile) => new()
    {
        TenantId = profile.TenantId,
        DisplayName = profile.DisplayName,
        Description = profile.Description,
        City = profile.City,
        Governorate = profile.Governorate,
        IsPublicInDirectory = profile.IsPublicInDirectory,
        ProfessionalRegistrationNumber = profile.ProfessionalRegistrationNumber,
        ContactEmail = profile.ContactEmail,
        ContactPhone = profile.ContactPhone
    };
}
