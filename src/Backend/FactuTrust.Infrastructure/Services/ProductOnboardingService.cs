using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Onboarding;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Constants;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ProductOnboarding;
using FactuTrust.Domain.Services;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

public sealed class ProductOnboardingService : IProductOnboardingService
{
    /// <summary>
    /// Generic fallback default-warehouse name, used as the "still untouched" baseline for the
    /// plan §2.6 <c>check-default-warehouse</c> onboarding item when no sector-specific name
    /// resolves. The segment-aware baseline is <c>SectorProfile.DefaultWarehouseName</c>
    /// (e.g. "Magasin principal" for Commerce, "Dépôt chantier" for BTP) — the same value
    /// <c>AuthController</c> passes into tenant DB provisioning at registration — so a fresh
    /// Commerce/BTP tenant is not wrongly flagged as "renamed ⇒ done" at day 0.
    /// </summary>
    private const string DefaultWarehouseSeedName = "Entrepôt Principal";

    /// <summary>
    /// Warehouse codes auto-seeded by the plan §3.4 sector data templates (Commerce provisions
    /// "Boutique"/"Réserve" reserves). They are provisioning artifacts, not user engagement, so they
    /// are excluded from the "created a second warehouse" auto-completion signal — otherwise a fresh
    /// Commerce tenant would be auto-completed at day 0 merely for having its provisioned reserves.
    /// </summary>
    private static readonly HashSet<string> SectorTemplateSeededWarehouseCodes =
        new(StringComparer.OrdinalIgnoreCase) { "BOUTIQUE", "RESERVE" };

    private readonly MasterDbContext _master;
    private readonly ICurrentUser _currentUser;
    private readonly ITenantDbContextFactory _tenantDbFactory;
    private readonly ProductOnboardingSettings _settings;
    private readonly ILogger<ProductOnboardingService> _logger;
    private readonly IRegistrationSectorService _registrationSectorService;

    public ProductOnboardingService(
        MasterDbContext master,
        ICurrentUser currentUser,
        ITenantDbContextFactory tenantDbFactory,
        IOptions<ProductOnboardingSettings> settings,
        ILogger<ProductOnboardingService> logger,
        IRegistrationSectorService registrationSectorService)
    {
        _master = master;
        _currentUser = currentUser;
        _tenantDbFactory = tenantDbFactory;
        _settings = settings.Value;
        _logger = logger;
        _registrationSectorService = registrationSectorService;
    }

    public async Task<ProductOnboardingDto> GetMineAsync(CancellationToken cancellationToken)
    {
        var user = await LoadCurrentUserAsync(cancellationToken);
        if (user is null)
            return DisabledEmpty();

        var autoIds = await CollectAutoCompletedIdsSafeAsync(user, cancellationToken);
        return MapDto(user, autoIds);
    }

    public async Task<Result<ProductOnboardingDto>> PatchMineAsync(
        PatchProductOnboardingRequest request,
        CancellationToken cancellationToken)
    {
        var user = await LoadCurrentUserAsync(cancellationToken);
        if (user is null)
            return Result.Failure<ProductOnboardingDto>(Error.Unauthorized("Aucun utilisateur authentifié."));

        if (request.Status is { } status && !Enum.IsDefined(status))
            return Result.Failure<ProductOnboardingDto>(Error.Validation("Status", "Statut d'accueil invalide."));

        var checklist = ProductOnboardingChecklistSerializer.Deserialize(user.ProductOnboardingChecklistJson);

        if (request.Status is { } nextStatus)
            user.ProductOnboardingStatus = nextStatus;

        if (request.ChecklistDismissed is { } dismissed)
            checklist = checklist with { Dismissed = dismissed };

        if (!string.IsNullOrWhiteSpace(request.ChecklistDoneId))
            checklist = ProductOnboardingChecklistSerializer.WithDoneId(checklist, request.ChecklistDoneId);

        user.ProductOnboardingChecklistJson = ProductOnboardingChecklistSerializer.Serialize(checklist);
        user.ProductOnboardingUpdatedAt = DateTime.UtcNow;
        await _master.SaveChangesAsync(cancellationToken);

        var autoIds = await CollectAutoCompletedIdsSafeAsync(user, cancellationToken);
        return Result.Success(MapDto(user, autoIds));
    }

    private async Task<ApplicationUser?> LoadCurrentUserAsync(CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId;
        if (userId is null || userId == Guid.Empty)
            return null;

        return await _master.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, cancellationToken);
    }

    private ProductOnboardingDto MapDto(ApplicationUser user, IReadOnlyList<string> autoIds) =>
        new()
        {
            Enabled = _settings.Enabled,
            Status = user.ProductOnboardingStatus,
            Version = user.ProductOnboardingVersion,
            Checklist = ProductOnboardingChecklistSerializer.Deserialize(user.ProductOnboardingChecklistJson),
            AutoCompletedIds = autoIds
        };

    private ProductOnboardingDto DisabledEmpty() =>
        new()
        {
            Enabled = false,
            Status = ProductOnboardingStatus.Completed,
            Version = ProductOnboardingDefaults.CatalogVersion,
            Checklist = new ProductOnboardingChecklistDto { Dismissed = true },
            AutoCompletedIds = Array.Empty<string>()
        };

    private async Task<IReadOnlyList<string>> CollectAutoCompletedIdsSafeAsync(
        ApplicationUser user,
        CancellationToken cancellationToken)
    {
        try
        {
            return await CollectAutoCompletedIdsAsync(user, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Product onboarding auto-progress failed for user {UserId}", user.Id);
            return Array.Empty<string>();
        }
    }

    private async Task<IReadOnlyList<string>> CollectAutoCompletedIdsAsync(
        ApplicationUser user,
        CancellationToken cancellationToken)
    {
        var ids = new List<string>();
        var tenant = await _master.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == user.TenantId, cancellationToken);
        if (tenant is null)
            return ids;

        var otherUsers = await _master.Users.AsNoTracking()
            .CountAsync(u => u.TenantId == user.TenantId && u.IsActive && u.Id != user.Id, cancellationToken);

        if (tenant.Kind == TenantKind.AccountingFirm)
        {
            if (otherUsers > 0)
                ids.Add(ProductOnboardingDefaults.FirmItemIds.AddCollaborator);

            var hasDossier = await _master.FirmClientAssignments.AsNoTracking()
                .AnyAsync(
                    a => a.FirmTenantId == tenant.Id
                         && (a.Status == FirmAssignmentStatus.Active
                             || a.Status == FirmAssignmentStatus.PendingFirmApproval),
                    cancellationToken);
            if (hasDossier)
                ids.Add(ProductOnboardingDefaults.FirmItemIds.ClientDossier);

            var profile = await _master.AccountingFirmProfiles.AsNoTracking()
                .FirstOrDefaultAsync(p => p.TenantId == tenant.Id, cancellationToken);
            if (profile is not null
                && (!string.IsNullOrWhiteSpace(profile.Description)
                    || !string.IsNullOrWhiteSpace(profile.ProfessionalRegistrationNumber)))
            {
                ids.Add(ProductOnboardingDefaults.FirmItemIds.FirmSettings);
            }

            return ids;
        }

        if (otherUsers > 0)
            ids.Add(ProductOnboardingDefaults.CompanyItemIds.InviteUser);

        if (_currentUser.IsAccountingFirmDelegatedContext)
            return ids;

        await using var tenantDb = _tenantDbFactory.CreateContext();

        var companyComplete = await tenantDb.Companies.AsNoTracking()
            .AnyAsync(
                c => c.IsActive
                     && (c.LogoUrl != null
                         || c.BankName != null
                         || c.Rib != null
                         || c.CommerceRegistry != null),
                cancellationToken);
        if (companyComplete)
            ids.Add(ProductOnboardingDefaults.CompanyItemIds.CompanyProfile);

        var passengerEmail = DefaultPassengerClient.Email.Trim().ToLowerInvariant();
        var hasClient = await tenantDb.Clients.AsNoTracking()
            .AnyAsync(c => c.Email == null || c.Email.Value != passengerEmail, cancellationToken);
        if (hasClient)
            ids.Add(ProductOnboardingDefaults.CompanyItemIds.CreateClient);

        var hasProduct = await tenantDb.Products.AsNoTracking()
            .AnyAsync(cancellationToken);
        if (hasProduct)
            ids.Add(ProductOnboardingDefaults.CompanyItemIds.CreateProduct);

        var hasInvoice = await tenantDb.Invoices.AsNoTracking()
            .AnyAsync(cancellationToken);
        if (hasInvoice)
            ids.Add(ProductOnboardingDefaults.CompanyItemIds.CreateInvoice);

        // Plan §2.6 — "check-default-warehouse": the tenant engaged with warehouse setup, either by
        // renaming the default warehouse away from its segment-specific seed name or by creating an
        // extra warehouse of its own. The seed baseline is the tenant's segment DefaultWarehouseName
        // (same source TenantService uses to seed at registration); the §3.4 template-seeded reserve
        // warehouses (Commerce "Boutique"/"Réserve") are excluded so a fresh Commerce tenant isn't
        // auto-completed at day 0 just for having its provisioned reserves.
        var warehouses = await tenantDb.Warehouses.AsNoTracking()
            .Where(w => w.IsActive)
            .Select(w => new { w.IsDefault, w.Code, w.Name })
            .ToListAsync(cancellationToken);
        var sectorProfile = _registrationSectorService.ResolveProfile(tenant.CompanySegment, tenant.BusinessDomain);
        var expectedDefaultName = sectorProfile.IsSuccess && sectorProfile.Value is not null
            ? sectorProfile.Value.DefaultWarehouseName
            : null;
        var untouchedDefaultName = !string.IsNullOrWhiteSpace(expectedDefaultName)
            ? expectedDefaultName!
            : DefaultWarehouseSeedName;
        var defaultWarehouseRenamed = warehouses
            .FirstOrDefault(w => w.IsDefault)?.Name is { } defaultName
            && !string.Equals(defaultName, untouchedDefaultName, StringComparison.Ordinal);
        var userCreatedExtraWarehouses = warehouses
            .Count(w => !w.IsDefault && !SectorTemplateSeededWarehouseCodes.Contains(w.Code));
        if (userCreatedExtraWarehouses > 0 || defaultWarehouseRenamed)
            ids.Add(ProductOnboardingDefaults.CompanyItemIds.CheckDefaultWarehouse);

        // Plan §2.6 — "commerce-stock-receipt": at least one validated stock entry ("bon d'entrée").
        var hasStockReceipt = await tenantDb.StockVouchers.AsNoTracking()
            .AnyAsync(v => v.Kind == StockVoucherKind.Entry && v.Status == StockVoucherStatus.Validated, cancellationToken);
        if (hasStockReceipt)
            ids.Add(ProductOnboardingDefaults.CompanyItemIds.CommerceStockReceipt);

        // Plan §2.6 — "numbering": at least one numbering scheme's format or start number diverges
        // from the document type's default (StartNumber initializes to 1 and only an explicit
        // UpdateStartNumber call changes it; blocks are compared after deserialization — not as raw
        // JSON — so legacy PascalCase-persisted defaults still compare equal to the current
        // camelCase default serialization).
        var numberingSchemes = await tenantDb.DocumentNumberingSchemes.AsNoTracking()
            .Select(s => new { s.DocumentType, s.StartNumber, s.FormatBlocksJson })
            .ToListAsync(cancellationToken);
        var numberingCustomized = numberingSchemes.Any(s =>
            s.StartNumber != 1 || !MatchesDefaultBlocks(s.DocumentType, s.FormatBlocksJson));
        if (numberingCustomized)
            ids.Add(ProductOnboardingDefaults.CompanyItemIds.Numbering);

        return ids;
    }

    private static bool MatchesDefaultBlocks(NumberingDocumentType documentType, string formatBlocksJson)
    {
        var actual = NumberingSchemeDefaults.DeserializeBlocks(formatBlocksJson);
        var expected = NumberingSchemeDefaults.GetDefaultBlocks(documentType);

        return actual.Count == expected.Count
            && actual.Zip(expected, (a, e) => a.Type == e.Type && a.Order == e.Order && a.Value == e.Value).All(match => match);
    }
}
