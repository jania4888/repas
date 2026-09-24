using System.Security.Cryptography;
using ClosedXML.Excel;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.FirmGovernance;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using FluentValidation;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

public sealed class FirmCollaboratorStorageOptions
{
    public const string SectionName = "FirmCollaboratorAttachments";
    public string BasePath { get; set; } = "App_Data/attachments";
}

public sealed class FirmCollaboratorService : IFirmCollaboratorService
{
    private const long MaxCniBytes = 10 * 1024 * 1024;
    private static readonly HashSet<string> AllowedCniTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/pdf"
    };

    private readonly MasterDbContext _db;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly FirmCollaboratorStorageOptions _storageOptions;
    private readonly IFirmInternalPayrollProvisioningService _provisioning;
    private readonly ITenantService _tenantService;
    private readonly IValidator<FirmCollaboratorPayrollOnboardingDto> _payrollOnboardingValidator;
    private readonly FirmGovernanceOptions _governanceOptions;
    private readonly ILogger<FirmCollaboratorService> _logger;

    public FirmCollaboratorService(
        MasterDbContext db,
        UserManager<ApplicationUser> userManager,
        IEmailService emailService,
        IConfiguration configuration,
        IOptions<FirmCollaboratorStorageOptions> storageOptions,
        IFirmInternalPayrollProvisioningService provisioning,
        ITenantService tenantService,
        IValidator<FirmCollaboratorPayrollOnboardingDto> payrollOnboardingValidator,
        IOptions<FirmGovernanceOptions> governanceOptions,
        ILogger<FirmCollaboratorService> logger)
    {
        _db = db;
        _userManager = userManager;
        _emailService = emailService;
        _configuration = configuration;
        _storageOptions = storageOptions.Value;
        _provisioning = provisioning;
        _tenantService = tenantService;
        _payrollOnboardingValidator = payrollOnboardingValidator;
        _governanceOptions = governanceOptions.Value;
        _logger = logger;
    }

    public async Task<Result<IReadOnlyList<FirmUserDto>>> ListAsync(
        Guid firmTenantId,
        string? name,
        string? qualification,
        bool? isActive,
        CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure<IReadOnlyList<FirmUserDto>>(contextError);

        var users = await _db.Users.AsNoTracking()
            .Where(u => u.TenantId == firmTenantId)
            .OrderBy(u => u.LastName)
            .ThenBy(u => u.FirstName)
            .ToListAsync(cancellationToken);

        if (isActive.HasValue)
            users = users.Where(u => u.IsActive == isActive.Value).ToList();

        if (!string.IsNullOrWhiteSpace(name) && name.Trim().Length >= 2)
        {
            var n = name.Trim();
            users = users.Where(u =>
                (u.FirstName + " " + u.LastName).Contains(n, StringComparison.OrdinalIgnoreCase)
                || (u.LastName + " " + u.FirstName).Contains(n, StringComparison.OrdinalIgnoreCase)
                || (u.Email ?? "").Contains(n, StringComparison.OrdinalIgnoreCase)).ToList();
        }

        var userIds = users.Select(u => u.Id).ToList();
        var profiles = await _db.FirmCollaboratorProfiles.AsNoTracking()
            .Where(p => userIds.Contains(p.UserId))
            .ToDictionaryAsync(p => p.UserId, cancellationToken);

        if (!string.IsNullOrWhiteSpace(qualification))
        {
            var q = qualification.Trim();
            users = users.Where(u =>
                profiles.TryGetValue(u.Id, out var p)
                && p.Qualification.Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();
            userIds = users.Select(u => u.Id).ToList();
        }

        var roleMap = await GetRoleMapAsync(userIds, cancellationToken);
        var binomeMap = await GetBinomeDisplayMapAsync(firmTenantId, userIds, cancellationToken);

        var result = users.Select(u =>
        {
            profiles.TryGetValue(u.Id, out var profile);
            binomeMap.TryGetValue(u.Id, out var binomes);
            return MapDto(u, roleMap.GetValueOrDefault(u.Id, UserRole.FirmAccountant), profile, binomes ?? Array.Empty<FirmUserBinomeDto>());
        }).ToList();

        return Result.Success<IReadOnlyList<FirmUserDto>>(result);
    }

    public async Task<Result<FirmUserDto>> GetByIdAsync(Guid firmTenantId, Guid userId, CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure<FirmUserDto>(contextError);

        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == firmTenantId, cancellationToken);
        if (user is null)
            return Result.Failure<FirmUserDto>(Error.NotFound("Collaborator", userId));

        var profile = await _db.FirmCollaboratorProfiles.AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        var role = await GetUserRoleAsync(user);
        var binomes = await GetBinomesForUserAsync(firmTenantId, userId, cancellationToken);
        return Result.Success(MapDto(user, role, profile, binomes));
    }

    public async Task<Result<FirmUserDto>> CreateAsync(
        Guid firmTenantId,
        CreateFirmUserDto dto,
        Stream? cniContent,
        string? cniFileName,
        string? cniContentType,
        CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure<FirmUserDto>(contextError);

        var validation = ValidateCreate(dto);
        if (validation is not null)
            return Result.Failure<FirmUserDto>(validation);

        // AddToRoleAsync lève sur un rôle absent, alors que le compte est déjà inséré : on le vérifie
        // tant que rien n'est écrit.
        var roleName = dto.Role.ToString();
        var normalizedRoleName = _userManager.NormalizeName(roleName);
        if (!await _db.Roles.AsNoTracking().AnyAsync(r => r.NormalizedName == normalizedRoleName, cancellationToken))
        {
            _logger.LogError("Role {Role} is missing: cannot create collaborator for firm {TenantId}", roleName, firmTenantId);
            return Result.Failure<FirmUserDto>(Error.Validation("Role", "Rôle cabinet indisponible. Contactez le support."));
        }

        if (FirmGovernanceNativeAccess.ShouldAutoProvisionPayrollOnCollaboratorCreate(_governanceOptions))
        {
            var connectionString = await _tenantService.GetConnectionStringAsync(firmTenantId, cancellationToken);
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                return Result.Failure<FirmUserDto>(Error.Validation(
                    "PayrollProvision",
                    "Impossible de créer le salarié paie : aucune base de paie n'est rattachée au cabinet."));
            }

            if (dto.Payroll is null)
            {
                return Result.Failure<FirmUserDto>(Error.Validation(
                    "PayrollProvision",
                    "Impossible de créer le salarié paie : le dossier paie est obligatoire."));
            }

            var payrollValidation = await _payrollOnboardingValidator.ValidateAsync(dto.Payroll, cancellationToken);
            if (!payrollValidation.IsValid)
            {
                var reason = string.Join(" ", payrollValidation.Errors.Select(e => e.ErrorMessage));
                return Result.Failure<FirmUserDto>(Error.Validation(
                    "PayrollProvision",
                    $"Impossible de créer le salarié paie : {reason}"));
            }
        }

        var password = string.IsNullOrWhiteSpace(dto.Password)
            ? GenerateSecurePassword()
            : dto.Password.Trim();
        // Invite when no password was supplied, or when explicitly requested.
        var sendInvite = string.IsNullOrWhiteSpace(dto.Password) || dto.SendInvite;

        var user = new ApplicationUser
        {
            UserName = dto.Email.Trim(),
            Email = dto.Email.Trim(),
            FirstName = dto.FirstName.Trim(),
            LastName = dto.LastName.Trim(),
            TenantId = firmTenantId,
            EmailConfirmed = !sendInvite,
            IsActive = true,
            PhoneNumber = string.IsNullOrWhiteSpace(dto.PhoneNumber) ? null : dto.PhoneNumber.Trim()
        };
        user.ApplyNewInteractiveProductOnboarding();

        var createResult = await _userManager.CreateAsync(user, password);
        if (!createResult.Succeeded)
            return Result.Failure<FirmUserDto>(Error.Validation(
                ClassifyIdentityErrors(createResult.Errors),
                IdentityErrorTranslator.TranslateToFrench(createResult.Errors)));

        // Le compte est écrit : toute sortie en échec doit désormais le retirer, sinon l'e-mail reste
        // pris et chaque nouvelle tentative échoue en doublon.
        FirmCollaboratorProfile? profile = null;
        try
        {
            var roleResult = await _userManager.AddToRoleAsync(user, roleName);
            if (!roleResult.Succeeded)
            {
                _logger.LogError(
                    "Role {Role} could not be assigned to collaborator {UserId} ({ErrorCodes})",
                    roleName, user.Id, string.Join(", ", roleResult.Errors.Select(e => e.Code)));
                await RollbackCreatedCollaboratorAsync(firmTenantId, user, profile);
                return Result.Failure<FirmUserDto>(Error.Validation(
                    "Role",
                    "Le rôle cabinet n'a pas pu être attribué. Réessayez ou contactez le support."));
            }

            profile = new FirmCollaboratorProfile
            {
                UserId = user.Id,
                Civility = dto.Civility,
                Qualification = (dto.Qualification ?? string.Empty).Trim(),
                PhoneLandline = string.IsNullOrWhiteSpace(dto.PhoneLandline) ? null : dto.PhoneLandline.Trim(),
                UseFirmAddress = dto.UseFirmAddress,
                UpdatedAt = DateTime.UtcNow
            };

            await ApplyAddressSnapshotAsync(firmTenantId, profile, dto.UseFirmAddress, dto.AddressLine, dto.PostalCode, dto.City, dto.Country, cancellationToken);

            if (cniContent is not null)
            {
                var cniResult = await StoreCniFileAsync(
                    firmTenantId,
                    user.Id,
                    cniContent,
                    cniFileName ?? "cni.pdf",
                    cniContentType ?? "application/pdf",
                    cniContent.CanSeek ? cniContent.Length : -1,
                    cancellationToken);
                if (!cniResult.IsSuccess)
                {
                    await RollbackCreatedCollaboratorAsync(firmTenantId, user, profile);
                    return Result.Failure<FirmUserDto>(cniResult.Error);
                }

                profile.CniFileName = cniResult.Value.FileName;
                profile.CniContentType = cniResult.Value.ContentType;
                profile.CniUploadedAt = DateTime.UtcNow;
            }

            _db.FirmCollaboratorProfiles.Add(profile);
            await _db.SaveChangesAsync(cancellationToken);

            if (FirmGovernanceNativeAccess.ShouldAutoProvisionPayrollOnCollaboratorCreate(_governanceOptions))
            {
                try
                {
                    var provision = await _provisioning.ProvisionCollaboratorAsync(
                        firmTenantId,
                        isManager: true,
                        user.Id,
                        dto.Payroll,
                        cancellationToken);

                    if (provision.IsFailure || provision.Value is { Created: 0, Linked: 0 })
                    {
                        await RollbackCreatedCollaboratorAsync(firmTenantId, user, profile);
                        var reason = provision.IsFailure
                            ? provision.Error.Description
                            : provision.Value!.Messages.FirstOrDefault() ?? "Provision paie impossible.";
                        return Result.Failure<FirmUserDto>(Error.Validation(
                            "PayrollProvision",
                            $"Impossible de créer le salarié paie : {reason}"));
                    }
                }
                catch (Exception ex)
                {
                    // Le message d'une exception peut exposer la base (SQL, colonnes, serveur) : le
                    // client ne reçoit qu'une référence, retrouvable dans ce journal.
                    var reference = NewErrorReference();
                    _logger.LogError(
                        ex,
                        "Payroll auto-provision failed for collaborator {UserId} (ref. {ErrorReference})",
                        user.Id, reference);
                    await RollbackCreatedCollaboratorAsync(firmTenantId, user, profile);
                    return Result.Failure<FirmUserDto>(Error.Validation(
                        "PayrollProvision",
                        "Impossible de créer le salarié paie : erreur technique. "
                        + $"Réessayez ou contactez le support (réf. {reference})."));
                }
            }
        }
        catch
        {
            // Échec imprévu (enregistrement du profil, stockage de la CNI…) : on retire le compte puis
            // on relaie l'exception, dont la traduction HTTP reste celle du middleware.
            await RollbackCreatedCollaboratorAsync(firmTenantId, user, profile);
            throw;
        }

        if (sendInvite)
            await TrySendInviteAsync(user, password, firmTenantId, cancellationToken);

        return await GetByIdAsync(firmTenantId, user.Id, cancellationToken);
    }

    public async Task<Result<FirmUserDto>> UpdateAsync(
        Guid firmTenantId,
        Guid userId,
        Guid currentUserId,
        UpdateFirmUserDto dto,
        CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure<FirmUserDto>(contextError);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == firmTenantId, cancellationToken);
        if (user is null)
            return Result.Failure<FirmUserDto>(Error.NotFound("Collaborator", userId));

        // Never force EmailConfirmed — preserve existing confirmation state (Décisiel bug fix).
        var emailConfirmedBefore = user.EmailConfirmed;

        if (!string.IsNullOrWhiteSpace(dto.FirstName))
            user.FirstName = dto.FirstName.Trim();
        if (!string.IsNullOrWhiteSpace(dto.LastName))
            user.LastName = dto.LastName.Trim();
        if (dto.PhoneNumber is not null)
            user.PhoneNumber = string.IsNullOrWhiteSpace(dto.PhoneNumber) ? null : dto.PhoneNumber.Trim();

        if (dto.Role.HasValue)
        {
            if (dto.Role.Value is not (UserRole.FirmManager or UserRole.FirmAccountant))
                return Result.Failure<FirmUserDto>(Error.Validation("Role", "Rôle cabinet invalide"));
            if (user.Id == currentUserId)
            {
                var previous = await GetUserRoleAsync(user);
                if (previous != dto.Role.Value)
                    return Result.Failure<FirmUserDto>(Error.Validation("Role", "Vous ne pouvez pas modifier votre propre rôle"));
            }

            var currentRoles = await _userManager.GetRolesAsync(user);
            await _userManager.RemoveFromRolesAsync(user, currentRoles);
            await _userManager.AddToRoleAsync(user, dto.Role.Value.ToString());
        }

        if (!string.IsNullOrWhiteSpace(dto.NewPassword))
        {
            var token = await _userManager.GeneratePasswordResetTokenAsync(user);
            var pwd = await _userManager.ResetPasswordAsync(user, token, dto.NewPassword);
            if (!pwd.Succeeded)
                return Result.Failure<FirmUserDto>(Error.Validation("Password", IdentityErrorTranslator.TranslateToFrench(pwd.Errors)));
        }

        user.EmailConfirmed = emailConfirmedBefore;
        await _userManager.UpdateAsync(user);

        var profile = await _db.FirmCollaboratorProfiles.FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        if (profile is null)
        {
            profile = new FirmCollaboratorProfile { UserId = userId, UpdatedAt = DateTime.UtcNow };
            _db.FirmCollaboratorProfiles.Add(profile);
        }

        if (dto.Civility.HasValue)
            profile.Civility = dto.Civility.Value;
        if (dto.Qualification is not null)
            profile.Qualification = dto.Qualification.Trim();
        if (dto.PhoneLandline is not null)
            profile.PhoneLandline = string.IsNullOrWhiteSpace(dto.PhoneLandline) ? null : dto.PhoneLandline.Trim();

        var useFirmAddress = dto.UseFirmAddress ?? profile.UseFirmAddress;
        profile.UseFirmAddress = useFirmAddress;
        await ApplyAddressSnapshotAsync(
            firmTenantId,
            profile,
            useFirmAddress,
            dto.AddressLine ?? profile.AddressLine,
            dto.PostalCode ?? profile.PostalCode,
            dto.City ?? profile.City,
            dto.Country ?? profile.Country,
            cancellationToken);

        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);

        // Safety: ensure EmailConfirmed was not mutated by Identity UpdateAsync side-effects from DTO mapping.
        var reloaded = await _userManager.FindByIdAsync(user.Id.ToString());
        if (reloaded is not null && reloaded.EmailConfirmed != emailConfirmedBefore)
        {
            reloaded.EmailConfirmed = emailConfirmedBefore;
            await _userManager.UpdateAsync(reloaded);
        }

        return await GetByIdAsync(firmTenantId, userId, cancellationToken);
    }

    public async Task<Result> SetActiveAsync(
        Guid firmTenantId,
        Guid userId,
        Guid currentUserId,
        bool isActive,
        CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure(contextError);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == firmTenantId, cancellationToken);
        if (user is null)
            return Result.Failure(Error.NotFound("Collaborator", userId));

        if (!isActive && user.Id == currentUserId)
            return Result.Failure(Error.Validation("Status", "Vous ne pouvez pas désactiver votre propre compte"));

        user.IsActive = isActive;
        await _userManager.UpdateAsync(user);
        return Result.Success();
    }

    public async Task<Result> ResendInviteAsync(Guid firmTenantId, Guid userId, CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure(contextError);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == firmTenantId, cancellationToken);
        if (user is null)
            return Result.Failure(Error.NotFound("Collaborator", userId));

        if (user.EmailConfirmed)
            return Result.Failure(Error.Validation("Invite", "Le compte est déjà confirmé — aucune invitation à renvoyer."));

        var newPassword = GenerateSecurePassword();
        var token = await _userManager.GeneratePasswordResetTokenAsync(user);
        var reset = await _userManager.ResetPasswordAsync(user, token, newPassword);
        if (!reset.Succeeded)
            return Result.Failure(Error.Validation("Password", IdentityErrorTranslator.TranslateToFrench(reset.Errors)));

        await TrySendInviteAsync(user, newPassword, firmTenantId, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> SetBinomesAsync(
        Guid firmTenantId,
        Guid userId,
        IReadOnlyList<Guid> binomeUserIds,
        CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure(contextError);

        var userExists = await _db.Users.AnyAsync(u => u.Id == userId && u.TenantId == firmTenantId, cancellationToken);
        if (!userExists)
            return Result.Failure(Error.NotFound("Collaborator", userId));

        var distinct = binomeUserIds.Where(id => id != userId).Distinct().ToList();
        if (distinct.Count > 0)
        {
            var validCount = await _db.Users.CountAsync(
                u => distinct.Contains(u.Id) && u.TenantId == firmTenantId && u.IsActive, cancellationToken);
            if (validCount != distinct.Count)
                return Result.Failure(Error.Validation("Binomes", "Un ou plusieurs binômes sont invalides ou hors cabinet."));
        }

        var existing = await _db.FirmCollaboratorLinks
            .Where(l => l.ParentUserId == userId && l.IsSecondManager)
            .ToListAsync(cancellationToken);
        _db.FirmCollaboratorLinks.RemoveRange(existing);

        foreach (var childId in distinct)
        {
            _db.FirmCollaboratorLinks.Add(new FirmCollaboratorLink
            {
                Id = Guid.NewGuid(),
                ParentUserId = userId,
                ChildUserId = childId,
                IsSecondManager = true,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<FirmCollaboratorCniInfoDto>> UploadCniAsync(
        Guid firmTenantId,
        Guid userId,
        Stream content,
        string fileName,
        string contentType,
        long contentLength,
        CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure<FirmCollaboratorCniInfoDto>(contextError);

        var userExists = await _db.Users.AnyAsync(u => u.Id == userId && u.TenantId == firmTenantId, cancellationToken);
        if (!userExists)
            return Result.Failure<FirmCollaboratorCniInfoDto>(Error.NotFound("Collaborator", userId));

        var store = await StoreCniFileAsync(firmTenantId, userId, content, fileName, contentType, contentLength, cancellationToken);
        if (!store.IsSuccess)
            return Result.Failure<FirmCollaboratorCniInfoDto>(store.Error);

        var profile = await _db.FirmCollaboratorProfiles.FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        if (profile is null)
        {
            profile = new FirmCollaboratorProfile { UserId = userId, Qualification = string.Empty };
            _db.FirmCollaboratorProfiles.Add(profile);
        }
        else if (!string.IsNullOrWhiteSpace(profile.CniFileName))
        {
            TryDeleteCniFile(firmTenantId, userId, profile.CniFileName);
        }

        profile.CniFileName = store.Value.FileName;
        profile.CniContentType = store.Value.ContentType;
        profile.CniUploadedAt = DateTime.UtcNow;
        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);

        return Result.Success(new FirmCollaboratorCniInfoDto
        {
            HasCni = true,
            FileName = profile.CniFileName,
            ContentType = profile.CniContentType,
            UploadedAt = profile.CniUploadedAt
        });
    }

    public async Task<Result<(Stream Stream, string FileName, string ContentType)>> DownloadCniAsync(
        Guid firmTenantId,
        Guid userId,
        CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure<(Stream, string, string)>(contextError);

        var profile = await _db.FirmCollaboratorProfiles.AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        if (profile?.CniFileName is null)
            return Result.Failure<(Stream, string, string)>(Error.NotFound("CNI", userId));

        var userExists = await _db.Users.AnyAsync(u => u.Id == userId && u.TenantId == firmTenantId, cancellationToken);
        if (!userExists)
            return Result.Failure<(Stream, string, string)>(Error.NotFound("Collaborator", userId));

        var fullPath = GetCniFullPath(firmTenantId, userId, profile.CniFileName);
        if (!File.Exists(fullPath))
            return Result.Failure<(Stream, string, string)>(Error.NotFound("CNI", userId));

        Stream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Result.Success((stream, profile.CniFileName, profile.CniContentType ?? "application/pdf"));
    }

    public async Task<Result> DeleteCniAsync(Guid firmTenantId, Guid userId, CancellationToken cancellationToken = default)
    {
        var contextError = await EnsureFirmTenantAsync(firmTenantId, cancellationToken);
        if (contextError is not null)
            return Result.Failure(contextError);

        var profile = await _db.FirmCollaboratorProfiles.FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        if (profile is null || string.IsNullOrWhiteSpace(profile.CniFileName))
            return Result.Success();

        var userExists = await _db.Users.AnyAsync(u => u.Id == userId && u.TenantId == firmTenantId, cancellationToken);
        if (!userExists)
            return Result.Failure(Error.NotFound("Collaborator", userId));

        TryDeleteCniFile(firmTenantId, userId, profile.CniFileName);
        profile.CniFileName = null;
        profile.CniContentType = null;
        profile.CniUploadedAt = null;
        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<(byte[] Content, string FileName)>> ExportExcelAsync(
        Guid firmTenantId,
        string? name,
        string? qualification,
        bool? isActive,
        CancellationToken cancellationToken = default)
    {
        var list = await ListAsync(firmTenantId, name, qualification, isActive, cancellationToken);
        if (!list.IsSuccess)
            return Result.Failure<(byte[], string)>(list.Error!);

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Collaborateurs");
        ws.Cell(1, 1).Value = "Collaborateur";
        ws.Cell(1, 2).Value = "Email";
        ws.Cell(1, 3).Value = "Téléphone";
        ws.Cell(1, 4).Value = "Qualification";
        ws.Cell(1, 5).Value = "Actif";
        ws.Cell(1, 6).Value = "Binôme(s)";
        ws.Range(1, 1, 1, 6).Style.Font.Bold = true;

        var row = 2;
        foreach (var u in list.Value!)
        {
            ws.Cell(row, 1).Value = $"{u.FirstName} {u.LastName}";
            ws.Cell(row, 2).Value = u.Email;
            ws.Cell(row, 3).Value = u.PhoneNumber ?? "";
            ws.Cell(row, 4).Value = u.Qualification ?? "";
            ws.Cell(row, 5).Value = u.IsActive ? "Oui" : "Non";
            ws.Cell(row, 6).Value = u.BinomesDisplay ?? "";
            row++;
        }

        ws.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        var fileName = $"collaborateurs_{DateTime.UtcNow:yyyyMMdd_HHmmss}.xlsx";
        return Result.Success((ms.ToArray(), fileName));
    }

    public async Task<Result<FirmAddressSnapshotDto>> GetFirmAddressAsync(Guid firmTenantId, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == firmTenantId, cancellationToken);
        if (tenant is null || tenant.Kind != TenantKind.AccountingFirm)
            return Result.Failure<FirmAddressSnapshotDto>(Error.Validation("Tenant", "Contexte cabinet invalide"));

        var addr = tenant.Address;
        return Result.Success(new FirmAddressSnapshotDto
        {
            AddressLine = string.IsNullOrWhiteSpace(addr.StreetLine2) ? addr.Street : $"{addr.Street}, {addr.StreetLine2}",
            PostalCode = addr.PostalCode,
            City = addr.City,
            Country = addr.Country,
            Governorate = addr.Governorate
        });
    }

    private async Task ApplyAddressSnapshotAsync(
        Guid firmTenantId,
        FirmCollaboratorProfile profile,
        bool useFirmAddress,
        string? addressLine,
        string? postalCode,
        string? city,
        string? country,
        CancellationToken cancellationToken)
    {
        if (useFirmAddress)
        {
            var firmAddress = await GetFirmAddressAsync(firmTenantId, cancellationToken);
            if (firmAddress.IsSuccess)
            {
                profile.AddressLine = firmAddress.Value!.AddressLine;
                profile.PostalCode = firmAddress.Value.PostalCode;
                profile.City = firmAddress.Value.City;
                profile.Country = firmAddress.Value.Country;
            }
            return;
        }

        profile.AddressLine = string.IsNullOrWhiteSpace(addressLine) ? null : addressLine.Trim();
        profile.PostalCode = string.IsNullOrWhiteSpace(postalCode) ? null : postalCode.Trim();
        profile.City = string.IsNullOrWhiteSpace(city) ? null : city.Trim();
        profile.Country = string.IsNullOrWhiteSpace(country) ? null : country.Trim();
    }

    private async Task<Result<(string FileName, string ContentType)>> StoreCniFileAsync(
        Guid firmTenantId,
        Guid userId,
        Stream content,
        string fileName,
        string contentType,
        long contentLength,
        CancellationToken cancellationToken)
    {
        if (contentLength == 0 || (content.CanSeek && content.Length <= 0))
            return Result.Failure<(string, string)>(Error.Validation("CNI", "Fichier vide."));
        if (contentLength > MaxCniBytes || (content.CanSeek && content.Length > MaxCniBytes))
            return Result.Failure<(string, string)>(Error.Validation("CNI", "Le fichier CNI ne doit pas dépasser 10 Mo."));

        var ct = (contentType ?? "").Trim();
        if (!AllowedCniTypes.Contains(ct)
            && !fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
            return Result.Failure<(string, string)>(Error.Validation("CNI", "Seuls les fichiers PDF sont acceptés."));

        ct = "application/pdf";
        var safeName = $"{Guid.NewGuid():N}.pdf";
        var fullPath = GetCniFullPath(firmTenantId, userId, safeName);
        var basePath = ResolveBasePath();
        if (!fullPath.StartsWith(basePath, StringComparison.OrdinalIgnoreCase))
            return Result.Failure<(string, string)>(Error.Validation("CNI", "Chemin de stockage invalide."));

        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        try
        {
            await using (var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                long total = 0;
                var buffer = new byte[81920];
                int read;
                while ((read = await content.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken)) > 0)
                {
                    total += read;
                    if (total > MaxCniBytes)
                    {
                        fs.Close();
                        TryDeleteCniFile(firmTenantId, userId, safeName);
                        return Result.Failure<(string, string)>(Error.Validation("CNI", "Le fichier CNI ne doit pas dépasser 10 Mo."));
                    }
                    await fs.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }

                if (total == 0)
                {
                    fs.Close();
                    TryDeleteCniFile(firmTenantId, userId, safeName);
                    return Result.Failure<(string, string)>(Error.Validation("CNI", "Fichier vide."));
                }
            }
        }
        catch
        {
            // Copie interrompue (flux coupé, disque plein…) : ne pas laisser un fichier tronqué
            // qu'aucun profil ne référence.
            TryDeleteCniFile(firmTenantId, userId, safeName);
            throw;
        }

        return Result.Success((safeName, ct));
    }

    private string GetCniFullPath(Guid firmTenantId, Guid userId, string fileName)
    {
        var basePath = ResolveBasePath();
        var relative = Path.Combine("firms", firmTenantId.ToString(), "collaborators", userId.ToString(), Path.GetFileName(fileName));
        return Path.GetFullPath(Path.Combine(basePath, relative));
    }

    private string ResolveBasePath()
    {
        var configured = string.IsNullOrWhiteSpace(_storageOptions.BasePath)
            ? "App_Data/attachments"
            : _storageOptions.BasePath;
        return Path.IsPathRooted(configured)
            ? Path.GetFullPath(configured)
            : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, configured));
    }

    private void TryDeleteCniFile(Guid firmTenantId, Guid userId, string fileName)
    {
        try
        {
            var path = GetCniFullPath(firmTenantId, userId, fileName);
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to delete CNI file {FileName} for user {UserId}", fileName, userId);
        }
    }

    /// <summary>
    /// Retire un compte collaborateur dont la création n'a pas abouti.
    /// </summary>
    /// <remarks>
    /// Ne lève jamais : elle s'exécute sur un chemin d'échec, dont l'erreur d'origine doit rester
    /// celle rapportée. Un échec est journalisé avec l'identifiant du compte, seul moyen de le
    /// retrouver pour le supprimer à la main.
    /// </remarks>
    private async Task RollbackCreatedCollaboratorAsync(
        Guid firmTenantId,
        ApplicationUser user,
        FirmCollaboratorProfile? profile)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(profile?.CniFileName))
                TryDeleteCniFile(firmTenantId, user.Id, profile.CniFileName);

            // Un profil ou un rôle dont l'écriture vient d'échouer est encore suivi « Added » : la
            // suppression en cascade du compte le détache, DeleteAsync ne le rejoue donc pas.
            var deletion = await _userManager.DeleteAsync(user);
            if (!deletion.Succeeded)
            {
                _logger.LogError(
                    "Rollback failed: collaborator {UserId} of firm {TenantId} could not be deleted ({ErrorCodes})",
                    user.Id, firmTenantId, string.Join(", ", deletion.Errors.Select(e => e.Code)));
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Rollback failed: collaborator {UserId} of firm {TenantId} could not be deleted",
                user.Id, firmTenantId);
        }
    }

    private async Task TrySendInviteAsync(ApplicationUser user, string initialPassword, Guid firmTenantId, CancellationToken cancellationToken)
    {
        try
        {
            var inviteUrl = _configuration["App:FrontendBaseUrl"] ?? "http://localhost:4200";
            await _emailService.EnqueueTemplatedAsync(
                user.Email!,
                $"{user.FirstName} {user.LastName}",
                "firm-collaborator-invited",
                new Dictionary<string, object?>
                {
                    ["recipientName"] = $"{user.FirstName} {user.LastName}",
                    ["initialPassword"] = initialPassword,
                    ["inviteUrl"] = inviteUrl.TrimEnd('/') + "/auth/login",
                    ["companyName"] = (await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == firmTenantId, cancellationToken))?.CompanyName ?? "Cabinet"
                },
                firmTenantId,
                cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to enqueue collaborator invite for {Email}", user.Email);
        }
    }

    private async Task<Error?> EnsureFirmTenantAsync(Guid firmTenantId, CancellationToken cancellationToken)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == firmTenantId, cancellationToken);
        if (tenant is null || tenant.Kind != TenantKind.AccountingFirm)
            return Error.Validation("Tenant", "Contexte cabinet invalide");
        return null;
    }

    private Error? ValidateCreate(CreateFirmUserDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Email)) return Error.Validation("Create", "L'email est requis");
        if (string.IsNullOrWhiteSpace(dto.FirstName)) return Error.Validation("Create", "Le prénom est requis");
        if (string.IsNullOrWhiteSpace(dto.LastName)) return Error.Validation("Create", "Le nom est requis");
        if (dto.Role is not (UserRole.FirmManager or UserRole.FirmAccountant)) return Error.Validation("Create", "Rôle cabinet invalide");

        // L'e-mail sert aussi d'identifiant de connexion : Identity le refuserait ensuite par un
        // « nom d'utilisateur non valide » que l'utilisateur, qui n'a saisi aucun identifiant, ne
        // peut pas comprendre. Même règle que Identity, lue dans sa configuration.
        var allowed = _userManager.Options.User.AllowedUserNameCharacters;
        if (!string.IsNullOrEmpty(allowed) && dto.Email.Trim().Any(c => !allowed.Contains(c)))
        {
            return Error.Validation(
                "Email",
                "L'adresse email contient des caractères non autorisés (lettres sans accent, chiffres et . _ - + @ uniquement).");
        }

        return null;
    }

    /// <summary>
    /// Rattache un refus Identity au champ fautif, pour que l'écran le signale au bon endroit.
    /// </summary>
    /// <remarks>
    /// Identity valide le mot de passe avant le compte et s'arrête au premier échec : les deux
    /// familles d'erreurs ne se mélangent jamais dans un même résultat.
    /// </remarks>
    private static string ClassifyIdentityErrors(IEnumerable<IdentityError> errors)
    {
        var codes = errors.Select(e => e.Code).ToList();
        if (codes.Count > 0 && codes.All(c => c.StartsWith("Password", StringComparison.Ordinal)))
            return "Password";
        if (codes.Any(c => c is "DuplicateEmail" or "DuplicateUserName" or "InvalidEmail" or "InvalidUserName"))
            return "Email";
        return "Identity";
    }

    private static string NewErrorReference() => Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();

    private static string GenerateSecurePassword()
    {
        const string alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        var chars = new char[16];
        for (var i = 0; i < 16; i++)
            chars[i] = alphabet[bytes[i] % alphabet.Length];
        return new string(chars) + "aA1!";
    }

    private async Task<Dictionary<Guid, UserRole>> GetRoleMapAsync(IReadOnlyList<Guid> userIds, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
            return new Dictionary<Guid, UserRole>();

        var userRoles = await _db.Set<IdentityUserRole<Guid>>()
            .AsNoTracking()
            .Where(ur => userIds.Contains(ur.UserId))
            .ToListAsync(cancellationToken);
        var rolesById = await _db.Roles.AsNoTracking()
            .ToDictionaryAsync(r => r.Id, r => r.Name ?? UserRole.FirmAccountant.ToString(), cancellationToken);

        return userRoles
            .GroupBy(ur => ur.UserId)
            .ToDictionary(
                g => g.Key,
                g =>
                {
                    var name = g.Select(ur => rolesById.GetValueOrDefault(ur.RoleId, UserRole.FirmAccountant.ToString())).FirstOrDefault()
                               ?? UserRole.FirmAccountant.ToString();
                    return Enum.TryParse<UserRole>(name, out var role) ? role : UserRole.FirmAccountant;
                });
    }

    private async Task<UserRole> GetUserRoleAsync(ApplicationUser user)
    {
        var roles = await _userManager.GetRolesAsync(user);
        var name = roles.FirstOrDefault() ?? UserRole.FirmAccountant.ToString();
        return Enum.TryParse<UserRole>(name, out var role) ? role : UserRole.FirmAccountant;
    }

    private async Task<Dictionary<Guid, IReadOnlyList<FirmUserBinomeDto>>> GetBinomeDisplayMapAsync(
        Guid firmTenantId,
        IReadOnlyList<Guid> userIds,
        CancellationToken cancellationToken)
    {
        var map = new Dictionary<Guid, IReadOnlyList<FirmUserBinomeDto>>();
        if (userIds.Count == 0)
            return map;

        var links = await _db.FirmCollaboratorLinks.AsNoTracking()
            .Where(l => l.IsSecondManager && (userIds.Contains(l.ParentUserId) || userIds.Contains(l.ChildUserId)))
            .ToListAsync(cancellationToken);

        var relatedIds = links.SelectMany(l => new[] { l.ParentUserId, l.ChildUserId }).Distinct().ToList();
        var people = await _db.Users.AsNoTracking()
            .Where(u => relatedIds.Contains(u.Id) && u.TenantId == firmTenantId)
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        foreach (var userId in userIds)
        {
            var binomes = new List<FirmUserBinomeDto>();
            foreach (var link in links.Where(l => l.ParentUserId == userId || l.ChildUserId == userId))
            {
                var otherId = link.ParentUserId == userId ? link.ChildUserId : link.ParentUserId;
                if (!people.TryGetValue(otherId, out var other))
                    continue;
                if (binomes.Any(b => b.Id == other.Id))
                    continue;
                binomes.Add(new FirmUserBinomeDto
                {
                    Id = other.Id,
                    FullName = $"{other.FirstName} {other.LastName}",
                    Email = other.Email ?? ""
                });
            }
            map[userId] = binomes;
        }

        return map;
    }

    private async Task<IReadOnlyList<FirmUserBinomeDto>> GetBinomesForUserAsync(
        Guid firmTenantId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var map = await GetBinomeDisplayMapAsync(firmTenantId, new[] { userId }, cancellationToken);
        return map.GetValueOrDefault(userId) ?? Array.Empty<FirmUserBinomeDto>();
    }

    private static FirmUserDto MapDto(
        ApplicationUser user,
        UserRole role,
        FirmCollaboratorProfile? profile,
        IReadOnlyList<FirmUserBinomeDto> binomes)
    {
        return new FirmUserDto
        {
            Id = user.Id,
            Email = user.Email ?? "",
            FirstName = user.FirstName,
            LastName = user.LastName,
            Role = role,
            RoleDisplay = role.ToDisplayString(),
            IsActive = user.IsActive,
            EmailConfirmed = user.EmailConfirmed,
            Civility = profile?.Civility,
            Qualification = profile?.Qualification,
            PhoneNumber = user.PhoneNumber,
            PhoneLandline = profile?.PhoneLandline,
            UseFirmAddress = profile?.UseFirmAddress ?? false,
            AddressLine = profile?.AddressLine,
            PostalCode = profile?.PostalCode,
            City = profile?.City,
            Country = profile?.Country,
            HasCni = !string.IsNullOrWhiteSpace(profile?.CniFileName),
            CniUploadedAt = profile?.CniUploadedAt,
            Binomes = binomes,
            BinomesDisplay = binomes.Count == 0 ? null : string.Join(", ", binomes.Select(b => b.FullName)),
            PayrollEmployeeId = profile?.PayrollEmployeeId,
            PayrollLinkSourceDisplay = profile?.PayrollEmployeeId is { } payrollId && payrollId != Guid.Empty
                ? DescribePayrollLinkSource(profile.PayrollLinkSource)
                : null
        };
    }

    private static string? DescribePayrollLinkSource(FirmPayrollLinkSource source) => source switch
    {
        FirmPayrollLinkSource.Manual => "Manuelle",
        FirmPayrollLinkSource.AutoEmail => "Auto (email)",
        FirmPayrollLinkSource.ProvisionedFromCollaborator => "Provisionné",
        _ => null
    };
}
