using System.Security.Cryptography;
using System.Text;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Domain.ClientPortal;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using MediatR;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services;

public sealed class ClientPortalService : IClientPortalService
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly MasterDbContext _masterContext;
    private readonly ITenantDbContextFactory _tenantDbFactory;
    private readonly IClientRepository _clients;
    private readonly ICompanyRepository _companies;
    private readonly IInvoiceRepository _invoices;
    private readonly IPaymentRepository _payments;
    private readonly IClientOutstandingService _outstanding;
    private readonly IEmailService _email;
    private readonly ITenantAuthTokenService _tokens;
    private readonly ITenantContext _tenantContext;
    private readonly ITenantService _tenantService;
    private readonly ICurrentUser _currentUser;
    private readonly IMediator _mediator;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ClientPortalService> _logger;

    public ClientPortalService(
        UserManager<ApplicationUser> userManager,
        MasterDbContext masterContext,
        ITenantDbContextFactory tenantDbFactory,
        IClientRepository clients,
        ICompanyRepository companies,
        IInvoiceRepository invoices,
        IPaymentRepository payments,
        IClientOutstandingService outstanding,
        IEmailService email,
        ITenantAuthTokenService tokens,
        ITenantContext tenantContext,
        ITenantService tenantService,
        ICurrentUser currentUser,
        IMediator mediator,
        IConfiguration configuration,
        ILogger<ClientPortalService> logger)
    {
        _userManager = userManager;
        _masterContext = masterContext;
        _tenantDbFactory = tenantDbFactory;
        _clients = clients;
        _companies = companies;
        _invoices = invoices;
        _payments = payments;
        _outstanding = outstanding;
        _email = email;
        _tokens = tokens;
        _tenantContext = tenantContext;
        _tenantService = tenantService;
        _currentUser = currentUser;
        _mediator = mediator;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<Result<IReadOnlyList<ClientPortalContactDto>>> ListContactsAsync(
        Guid clientId, CancellationToken cancellationToken = default)
    {
        if (await _clients.GetByIdAsync(clientId, cancellationToken) is null)
            return Result.Failure<IReadOnlyList<ClientPortalContactDto>>(Error.NotFound("Client", clientId));

        await using var tenantDb = _tenantDbFactory.CreateContext();
        var rows = await tenantDb.ClientPortalContacts.AsNoTracking()
            .Where(c => c.ClientId == clientId)
            .OrderByDescending(c => c.InvitedAt)
            .ToListAsync(cancellationToken);

        return Result.Success<IReadOnlyList<ClientPortalContactDto>>(rows.Select(MapContact).ToList());
    }

    public async Task<Result<ClientPortalContactDto>> InviteAsync(
        Guid clientId, InviteClientPortalContactRequest request, CancellationToken cancellationToken = default)
    {
        var enabled = await EnsurePortalEnabledAsync(cancellationToken);
        if (enabled.IsFailure)
            return Result.Failure<ClientPortalContactDto>(enabled.Error);

        var client = await _clients.GetByIdAsync(clientId, cancellationToken);
        if (client is null)
            return Result.Failure<ClientPortalContactDto>(Error.NotFound("Client", clientId));

        var email = request.Email.Trim();
        if (!email.Contains('@', StringComparison.Ordinal))
            return Result.Failure<ClientPortalContactDto>(Error.Validation("Email", "Adresse email invalide."));

        var tenantId = _tenantContext.TenantId
            ?? _currentUser.TenantId
            ?? Guid.Empty;
        if (tenantId == Guid.Empty)
            return Result.Failure<ClientPortalContactDto>(Error.Unauthorized("Contexte entreprise introuvable."));

        var existingUser = await _userManager.FindByEmailAsync(email);
        ApplicationUser user;
        if (existingUser is not null)
        {
            if (existingUser.TenantId != tenantId)
                return Result.Failure<ClientPortalContactDto>(Error.Conflict(
                    "Cette adresse email est déjà utilisée sur un autre compte InstaFact."));

            if (existingUser.PortalClientId is null)
                return Result.Failure<ClientPortalContactDto>(Error.Conflict(
                    "Cette adresse email appartient déjà à un utilisateur interne. Utilisez une autre adresse."));

            if (existingUser.PortalClientId != clientId)
                return Result.Failure<ClientPortalContactDto>(Error.Conflict(
                    "Cette adresse email est déjà rattachée à un autre client de l'espace."));

            user = existingUser;
            user.IsActive = true;
            user.FirstName = request.FirstName.Trim();
            user.LastName = request.LastName.Trim();
        }
        else
        {
            user = new ApplicationUser
            {
                Id = Guid.NewGuid(),
                UserName = email,
                Email = email,
                FirstName = request.FirstName.Trim(),
                LastName = request.LastName.Trim(),
                TenantId = tenantId,
                EmailConfirmed = false,
                IsActive = true,
                PortalClientId = clientId,
                CreatedAt = DateTime.UtcNow
            };
            var created = await _userManager.CreateAsync(user);
            if (!created.Succeeded)
                return Result.Failure<ClientPortalContactDto>(Error.Validation(
                    "Identity",
                    string.Join(" ", created.Errors.Select(e => e.Description))));

            var role = await _userManager.AddToRoleAsync(user, UserRole.Client.ToString());
            if (!role.Succeeded)
                return Result.Failure<ClientPortalContactDto>(Error.Validation(
                    "Role",
                    string.Join(" ", role.Errors.Select(e => e.Description))));
        }

        user.PortalClientId = clientId;
        var rawToken = IssueInviteToken(user);
        await _userManager.UpdateAsync(user);

        await using var tenantDb = _tenantDbFactory.CreateContext();
        var contact = await tenantDb.ClientPortalContacts
            .FirstOrDefaultAsync(c => c.UserId == user.Id, cancellationToken);
        if (contact is null)
        {
            contact = ClientPortalContact.Invite(
                clientId,
                user.Id,
                email,
                $"{request.FirstName.Trim()} {request.LastName.Trim()}".Trim());
            tenantDb.ClientPortalContacts.Add(contact);
        }
        else
        {
            contact.MarkInvitedAgain();
        }

        await tenantDb.SaveChangesAsync(cancellationToken);
        await SendInviteEmailAsync(user, client, rawToken, cancellationToken);

        return Result.Success(MapContact(contact));
    }

    public async Task<Result> ResendInviteAsync(Guid clientId, Guid contactId, CancellationToken cancellationToken = default)
    {
        var enabled = await EnsurePortalEnabledAsync(cancellationToken);
        if (enabled.IsFailure)
            return enabled;

        await using var tenantDb = _tenantDbFactory.CreateContext();
        var contact = await tenantDb.ClientPortalContacts
            .FirstOrDefaultAsync(c => c.Id == contactId && c.ClientId == clientId, cancellationToken);
        if (contact is null)
            return Result.Failure(Error.NotFound("Contact portail", contactId));
        if (contact.Status == ClientPortalContactStatus.Revoked)
            return Result.Failure(Error.Validation("Status", "Ce contact a été révoqué. Invitez-le à nouveau."));

        var user = await _userManager.FindByIdAsync(contact.UserId.ToString());
        if (user is null)
            return Result.Failure(Error.NotFound("Utilisateur", contact.UserId));

        var client = await _clients.GetByIdAsync(clientId, cancellationToken);
        if (client is null)
            return Result.Failure(Error.NotFound("Client", clientId));

        var rawToken = IssueInviteToken(user);
        await _userManager.UpdateAsync(user);
        contact.MarkInvitedAgain();
        await tenantDb.SaveChangesAsync(cancellationToken);
        await SendInviteEmailAsync(user, client, rawToken, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> RevokeAsync(Guid clientId, Guid contactId, CancellationToken cancellationToken = default)
    {
        await using var tenantDb = _tenantDbFactory.CreateContext();
        var contact = await tenantDb.ClientPortalContacts
            .FirstOrDefaultAsync(c => c.Id == contactId && c.ClientId == clientId, cancellationToken);
        if (contact is null)
            return Result.Failure(Error.NotFound("Contact portail", contactId));

        contact.Revoke();
        var user = await _userManager.FindByIdAsync(contact.UserId.ToString());
        if (user is not null)
        {
            user.IsActive = false;
            user.PortalInviteTokenHash = null;
            user.PortalInviteExpiresAt = null;
            user.RefreshToken = null;
            await _userManager.UpdateAsync(user);
        }

        await tenantDb.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<AuthResponseDto>> AcceptInviteAsync(
        AcceptPortalInviteRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Token))
            return Result.Failure<AuthResponseDto>(Error.Validation("Token", "Le lien d'invitation est invalide."));
        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 12)
            return Result.Failure<AuthResponseDto>(Error.Validation("Password", "Le mot de passe doit contenir au moins 12 caractères."));
        if (!string.Equals(request.Password, request.ConfirmPassword, StringComparison.Ordinal))
            return Result.Failure<AuthResponseDto>(Error.Validation("ConfirmPassword", "Les mots de passe ne correspondent pas."));

        var dot = request.Token.IndexOf('.', StringComparison.Ordinal);
        if (dot <= 0 || !Guid.TryParseExact(request.Token[..dot], "N", out var userId))
            return Result.Failure<AuthResponseDto>(Error.Validation("Token", "Le lien d'invitation est invalide ou a expiré."));

        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null
            || string.IsNullOrEmpty(user.PortalInviteTokenHash)
            || user.PortalInviteExpiresAt is null
            || user.PortalInviteExpiresAt < DateTime.UtcNow
            || !CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(user.PortalInviteTokenHash),
                Encoding.UTF8.GetBytes(HashToken(request.Token))))
        {
            return Result.Failure<AuthResponseDto>(Error.Validation("Token", "Le lien d'invitation est invalide ou a expiré."));
        }

        if (!user.IsActive)
            return Result.Failure<AuthResponseDto>(Error.Forbidden("Ce compte a été désactivé."));

        if (await _userManager.HasPasswordAsync(user))
        {
            var reset = await _userManager.GeneratePasswordResetTokenAsync(user);
            var resetResult = await _userManager.ResetPasswordAsync(user, reset, request.Password);
            if (!resetResult.Succeeded)
                return Result.Failure<AuthResponseDto>(Error.Validation("Password", string.Join(" ", resetResult.Errors.Select(e => e.Description))));
        }
        else
        {
            var addPwd = await _userManager.AddPasswordAsync(user, request.Password);
            if (!addPwd.Succeeded)
                return Result.Failure<AuthResponseDto>(Error.Validation("Password", string.Join(" ", addPwd.Errors.Select(e => e.Description))));
        }

        user.EmailConfirmed = true;
        user.PortalInviteTokenHash = null;
        user.PortalInviteExpiresAt = null;
        await _userManager.UpdateAsync(user);

        await BindTenantAsync(user.TenantId, cancellationToken);

        await using var tenantDb = _tenantDbFactory.CreateContext();
        var contact = await tenantDb.ClientPortalContacts.FirstOrDefaultAsync(c => c.UserId == user.Id, cancellationToken);
        contact?.MarkAccepted();
        if (contact is not null)
            await tenantDb.SaveChangesAsync(cancellationToken);

        var allowed = await EnsurePortalLoginAllowedAsync(user.Id, cancellationToken);
        if (allowed.IsFailure)
            return Result.Failure<AuthResponseDto>(allowed.Error);

        var tokens = await _tokens.GenerateTokensAsync(user.Id, user.TenantId, cancellationToken: cancellationToken);
        return Result.Success(tokens);
    }

    public async Task<Result> EnsurePortalLoginAllowedAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null)
            return Result.Failure(Error.Unauthorized("Compte introuvable."));

        var roles = await _userManager.GetRolesAsync(user);
        if (!roles.Contains(UserRole.Client.ToString()))
            return Result.Success();

        if (user.PortalClientId is null)
            return Result.Failure(Error.Forbidden(
                "Ce compte portail n'est rattaché à aucune fiche client. Contactez votre fournisseur."));

        await BindTenantAsync(user.TenantId, cancellationToken);

        var company = await _companies.GetDefaultAsync(cancellationToken);
        if (company is not null && !company.ClientPortalEnabled)
            return Result.Failure(Error.Forbidden("L'espace client de cette entreprise est désactivé."));

        await using var tenantDb = _tenantDbFactory.CreateContext();
        var contact = await tenantDb.ClientPortalContacts
            .FirstOrDefaultAsync(c => c.UserId == user.Id && c.Status != ClientPortalContactStatus.Revoked, cancellationToken);
        if (contact is null)
            return Result.Failure(Error.Forbidden("Votre accès à l'espace client a été révoqué."));

        return Result.Success();
    }

    public async Task<Result<PortalMeDto>> GetMeAsync(CancellationToken cancellationToken = default)
    {
        var gate = await RequirePortalClientAsync(cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<PortalMeDto>(gate.Error);

        var client = await _clients.GetByIdAsync(gate.Value, cancellationToken);
        if (client is null)
            return Result.Failure<PortalMeDto>(Error.NotFound("Client", gate.Value));

        var company = await _companies.GetDefaultAsync(cancellationToken);
        var user = await _userManager.FindByIdAsync(_currentUser.UserId!.Value.ToString());

        return Result.Success(new PortalMeDto
        {
            SellerName = company?.Name ?? "",
            SellerTradeName = company?.TradeName,
            SellerLogoUrl = company?.LogoUrl,
            SellerEmail = company?.Email.Value,
            BankName = company?.BankName,
            Iban = company?.Iban,
            Rib = company?.Rib,
            ClientId = client.Id,
            ClientName = client.Name,
            ClientEmail = client.Email.Value,
            ClientNif = client.NIF?.Value,
            ContactEmail = user?.Email ?? _currentUser.Email ?? "",
            ContactName = user is null ? "" : $"{user.FirstName} {user.LastName}".Trim()
        });
    }

    public async Task<Result<PortalSummaryDto>> GetSummaryAsync(CancellationToken cancellationToken = default)
    {
        var gate = await RequirePortalClientAsync(cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<PortalSummaryDto>(gate.Error);

        var outstanding = await _outstanding.GetOutstandingAsync(gate.Value, cancellationToken);
        if (outstanding.IsFailure)
            return Result.Failure<PortalSummaryDto>(outstanding.Error);

        var invoices = await VisibleInvoicesAsync(gate.Value, cancellationToken);
        var paid = await _payments.GetTotalPaidByInvoiceIdsAsync(invoices.Select(i => i.Id), cancellationToken);
        var upcoming = invoices
            .Where(i => i.Status is InvoiceStatus.Validated or InvoiceStatus.Signed or InvoiceStatus.PartiallyPaid or InvoiceStatus.Overdue)
            .OrderBy(i => i.DueDate ?? i.IssueDate)
            .Take(5)
            .Select(i => MapInvoiceListItem(i, paid.GetValueOrDefault(i.Id)))
            .ToList();

        return Result.Success(new PortalSummaryDto
        {
            UnpaidAmount = outstanding.Value.UnpaidInvoicesAmount,
            UnpaidCount = outstanding.Value.UnpaidInvoiceCount,
            OverdueAmount = outstanding.Value.OverdueAmount,
            TotalOutstanding = outstanding.Value.TotalOutstanding,
            UpcomingInvoices = upcoming
        });
    }

    public async Task<Result<PagedResult<PortalInvoiceListItemDto>>> GetInvoicesAsync(
        InvoiceStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        bool unpaidOnly,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        var gate = await RequirePortalClientAsync(cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<PagedResult<PortalInvoiceListItemDto>>(gate.Error);

        page = Math.Clamp(page, 1, int.MaxValue / 100);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var invoices = await VisibleInvoicesAsync(gate.Value, cancellationToken);
        if (status.HasValue)
            invoices = invoices.Where(i => i.Status == status.Value).ToList();
        if (fromDate.HasValue)
            invoices = invoices.Where(i => i.IssueDate.Date >= fromDate.Value.Date).ToList();
        if (toDate.HasValue)
            invoices = invoices.Where(i => i.IssueDate.Date <= toDate.Value.Date).ToList();

        var paid = await _payments.GetTotalPaidByInvoiceIdsAsync(invoices.Select(i => i.Id), cancellationToken);
        if (unpaidOnly)
        {
            invoices = invoices
                .Where(i => Remaining(i, paid.GetValueOrDefault(i.Id)) > 0
                            && i.Status is not InvoiceStatus.Cancelled and not InvoiceStatus.Archived)
                .ToList();
        }

        var total = invoices.Count;
        var pageItems = invoices
            .OrderByDescending(i => i.IssueDate)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(i => MapInvoiceListItem(i, paid.GetValueOrDefault(i.Id)))
            .ToList();

        return Result.Success(PagedResult<PortalInvoiceListItemDto>.Create(pageItems, page, pageSize, total));
    }

    public async Task<Result<PortalInvoiceDetailDto>> GetInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default)
    {
        var owned = await LoadOwnedInvoiceAsync(invoiceId, cancellationToken);
        if (owned.IsFailure)
            return Result.Failure<PortalInvoiceDetailDto>(owned.Error);

        var invoice = owned.Value;
        var payments = await _payments.GetByInvoiceIdAsync(invoice.Id, cancellationToken);
        var active = payments.Where(p => !p.IsRefunded).ToList();
        var totalPaid = active.Sum(p => p.GetTotalAppliedTowardInvoice());

        return Result.Success(new PortalInvoiceDetailDto
        {
            Id = invoice.Id,
            Number = invoice.Number.Value,
            Type = invoice.Type == InvoiceType.CreditNote ? "CREDIT_NOTE" : "INVOICE",
            IsCreditNote = invoice.IsCreditNote,
            IssueDate = invoice.IssueDate,
            DueDate = invoice.DueDate,
            Status = invoice.Status,
            StatusDisplay = invoice.Status.ToDisplayString(),
            Reference = invoice.Reference,
            Notes = invoice.Notes,
            PaymentTerms = invoice.PaymentTerms,
            SubTotal = invoice.SubTotal.Amount,
            TotalVat = invoice.TotalVat.Amount,
            TotalAmount = invoice.TotalAmount.Amount,
            TotalPaid = totalPaid,
            RemainingAmount = Remaining(invoice, totalPaid),
            Currency = invoice.TotalAmount.Currency,
            Lines = invoice.Lines.Select(l => new PortalInvoiceLineDto
            {
                Description = l.ProductName,
                Quantity = l.Quantity,
                UnitPrice = l.UnitPrice.Amount,
                VatRatePercent = (int)l.VatRate,
                LineTotal = l.Total.Amount
            }).ToList(),
            Payments = active.Select(p => MapPayment(p, invoice.Number.Value)).ToList()
        });
    }

    public async Task<Result<InvoicePdfResult>> GetInvoicePdfAsync(Guid invoiceId, CancellationToken cancellationToken = default)
    {
        var owned = await LoadOwnedInvoiceAsync(invoiceId, cancellationToken);
        if (owned.IsFailure)
            return Result.Failure<InvoicePdfResult>(owned.Error);

        return await _mediator.Send(new ExportInvoicePdfQuery(invoiceId), cancellationToken);
    }

    public async Task<Result<IReadOnlyList<PortalPaymentDto>>> GetPaymentsAsync(
        DateTime? fromDate,
        DateTime? toDate,
        CancellationToken cancellationToken = default)
    {
        var gate = await RequirePortalClientAsync(cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<IReadOnlyList<PortalPaymentDto>>(gate.Error);

        var invoices = await VisibleInvoicesAsync(gate.Value, cancellationToken);
        var numbers = invoices.ToDictionary(i => i.Id, i => i.Number.Value);
        var from = fromDate ?? DateTime.UtcNow.AddYears(-10);
        var to = toDate ?? DateTime.UtcNow.AddDays(1);
        var payments = await _payments.GetByDateRangeAsync(from, to, cancellationToken);
        var list = payments
            .Where(p => numbers.ContainsKey(p.InvoiceId) && !p.IsRefunded)
            .OrderByDescending(p => p.PaymentDate)
            .Select(p => MapPayment(p, numbers[p.InvoiceId]))
            .ToList();

        return Result.Success<IReadOnlyList<PortalPaymentDto>>(list);
    }

    public async Task<Result<PortalStatementDto>> GetStatementAsync(
        DateTime? fromDate,
        DateTime? toDate,
        CancellationToken cancellationToken = default)
    {
        var gate = await RequirePortalClientAsync(cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<PortalStatementDto>(gate.Error);

        var client = await _clients.GetByIdAsync(gate.Value, cancellationToken);
        var invoices = await VisibleInvoicesAsync(gate.Value, cancellationToken);
        var from = fromDate?.Date;
        var to = toDate?.Date;

        var events = new List<(DateTime Date, string Kind, string Label, decimal Debit, decimal Credit)>();
        foreach (var invoice in invoices.Where(i => i.Status != InvoiceStatus.Cancelled))
        {
            var amount = Math.Abs(invoice.TotalAmount.Amount);
            var isCredit = invoice.IsCreditNote || invoice.TotalAmount.Amount < 0;
            events.Add((
                invoice.IssueDate.Date,
                isCredit ? "CREDIT_NOTE" : "INVOICE",
                invoice.Number.Value,
                isCredit ? 0 : amount,
                isCredit ? amount : 0));
        }

        var ids = invoices.Select(i => i.Id).ToHashSet();
        var payFrom = from ?? DateTime.MinValue.AddYears(1);
        var payTo = to?.AddDays(1) ?? DateTime.UtcNow.AddDays(1);
        var payments = await _payments.GetByDateRangeAsync(payFrom, payTo, cancellationToken);
        foreach (var payment in payments.Where(p => ids.Contains(p.InvoiceId) && !p.IsRefunded))
        {
            events.Add((
                payment.PaymentDate.Date,
                "PAYMENT",
                payment.Reference ?? "Paiement",
                0,
                payment.GetTotalAppliedTowardInvoice()));
        }

        var ordered = events.OrderBy(e => e.Date).ThenBy(e => e.Kind).ToList();
        var opening = 0m;
        var running = 0m;
        var lines = new List<PortalStatementLineDto>();
        foreach (var e in ordered)
        {
            if (from.HasValue && e.Date < from.Value)
            {
                opening += e.Debit - e.Credit;
                running = opening;
                continue;
            }

            if (to.HasValue && e.Date > to.Value)
                continue;

            running += e.Debit - e.Credit;
            lines.Add(new PortalStatementLineDto
            {
                Date = e.Date,
                Kind = e.Kind,
                Label = e.Label,
                Debit = e.Debit,
                Credit = e.Credit,
                Balance = running
            });
        }

        return Result.Success(new PortalStatementDto
        {
            ClientName = client?.Name ?? "",
            FromDate = from,
            ToDate = to,
            OpeningBalance = opening,
            ClosingBalance = running,
            Lines = lines
        });
    }

    public async Task<Result> SetPortalEnabledAsync(bool enabled, CancellationToken cancellationToken = default)
    {
        var company = await _companies.GetDefaultAsync(cancellationToken);
        if (company is null)
            return Result.Failure(Error.NotFound("Company", Guid.Empty));

        company.SetClientPortalEnabled(enabled);
        await _companies.UpdateAsync(company, cancellationToken);
        return Result.Success();
    }

    public async Task<bool> HasActiveContactAsync(Guid clientId, CancellationToken cancellationToken = default)
    {
        await using var tenantDb = _tenantDbFactory.CreateContext();
        return await tenantDb.ClientPortalContacts.AsNoTracking()
            .AnyAsync(
                c => c.ClientId == clientId && c.Status == ClientPortalContactStatus.Active,
                cancellationToken);
    }

    private async Task<Result<Guid>> RequirePortalClientAsync(CancellationToken cancellationToken)
    {
        if (!_currentUser.IsClientPortal || _currentUser.PortalClientId is not Guid clientId)
            return Result.Failure<Guid>(Error.Forbidden("Accès réservé à l'espace client."));

        var allowed = await EnsurePortalLoginAllowedAsync(_currentUser.UserId ?? Guid.Empty, cancellationToken);
        if (allowed.IsFailure)
            return Result.Failure<Guid>(allowed.Error);

        await using var tenantDb = _tenantDbFactory.CreateContext();
        var contact = await tenantDb.ClientPortalContacts
            .FirstOrDefaultAsync(c => c.UserId == _currentUser.UserId, cancellationToken);
        contact?.TouchLastAccess();
        if (contact is not null)
            await tenantDb.SaveChangesAsync(cancellationToken);

        return Result.Success(clientId);
    }

    private async Task<Result<Invoice>> LoadOwnedInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken)
    {
        var gate = await RequirePortalClientAsync(cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<Invoice>(gate.Error);

        var invoice = await _invoices.GetByIdWithLinesAsync(invoiceId, cancellationToken);
        if (invoice is null
            || invoice.ClientId != gate.Value
            || !ClientPortalAccess.IsInvoiceVisibleToPortal(invoice.Status))
        {
            return Result.Failure<Invoice>(Error.NotFound("Facture", invoiceId));
        }

        return Result.Success(invoice);
    }

    private async Task<List<Invoice>> VisibleInvoicesAsync(Guid clientId, CancellationToken cancellationToken)
    {
        var all = await _invoices.GetByClientIdAsync(clientId, cancellationToken);
        return all.Where(i => ClientPortalAccess.IsInvoiceVisibleToPortal(i.Status)).ToList();
    }

    private async Task<Result> EnsurePortalEnabledAsync(CancellationToken cancellationToken)
    {
        var company = await _companies.GetDefaultAsync(cancellationToken);
        if (company is not null && !company.ClientPortalEnabled)
            return Result.Failure(Error.Validation("ClientPortal", "L'espace client est désactivé pour cette entreprise."));
        return Result.Success();
    }

    private async Task BindTenantAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        if (_tenantContext.TenantId == tenantId && !string.IsNullOrEmpty(_tenantContext.ConnectionString))
            return;

        var cs = await _tenantService.GetConnectionStringAsync(tenantId, cancellationToken);
        if (!string.IsNullOrEmpty(cs))
            _tenantContext.SetTenant(tenantId, cs);
    }

    private async Task SendInviteEmailAsync(ApplicationUser user, Client client, string rawToken, CancellationToken cancellationToken)
    {
        var baseUrl = (_configuration["App:FrontendBaseUrl"] ?? "http://localhost:4200").TrimEnd('/');
        var inviteUrl = $"{baseUrl}/auth/accept-portal-invite?token={Uri.EscapeDataString(rawToken)}";
        var company = await _companies.GetDefaultAsync(cancellationToken);
        try
        {
            await _email.EnqueueTemplatedAsync(
                user.Email!,
                $"{user.FirstName} {user.LastName}".Trim(),
                "portal-invite",
                new Dictionary<string, object?>
                {
                    ["recipientName"] = user.FirstName,
                    ["companyName"] = company?.Name ?? "",
                    ["clientName"] = client.Name,
                    ["inviteUrl"] = inviteUrl
                },
                user.TenantId,
                cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Portal invite email failed for {Email}", user.Email);
        }
    }

    private static string IssueInviteToken(ApplicationUser user)
    {
        var random = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        var token = $"{user.Id:N}.{random}";
        user.PortalInviteTokenHash = HashToken(token);
        user.PortalInviteExpiresAt = DateTime.UtcNow.AddDays(7);
        return token;
    }

    private static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(bytes);
    }

    private static ClientPortalContactDto MapContact(ClientPortalContact c) => new()
    {
        Id = c.Id,
        UserId = c.UserId,
        Email = c.Email,
        DisplayName = c.DisplayName,
        Status = c.Status,
        StatusDisplay = c.Status switch
        {
            ClientPortalContactStatus.Invited => "Invité",
            ClientPortalContactStatus.Active => "Actif",
            ClientPortalContactStatus.Revoked => "Révoqué",
            _ => c.Status.ToString()
        },
        InvitedAt = c.InvitedAt,
        AcceptedAt = c.AcceptedAt,
        LastAccessAt = c.LastAccessAt
    };

    private static PortalInvoiceListItemDto MapInvoiceListItem(Invoice invoice, decimal paid) => new()
    {
        Id = invoice.Id,
        Number = invoice.Number.Value,
        Type = invoice.Type == InvoiceType.CreditNote ? "CREDIT_NOTE" : "INVOICE",
        IsCreditNote = invoice.IsCreditNote,
        IssueDate = invoice.IssueDate,
        DueDate = invoice.DueDate,
        Status = invoice.Status,
        StatusDisplay = invoice.Status.ToDisplayString(),
        TotalAmount = invoice.TotalAmount.Amount,
        TotalPaid = paid,
        RemainingAmount = Remaining(invoice, paid),
        Currency = invoice.TotalAmount.Currency
    };

    private static PortalPaymentDto MapPayment(Payment payment, string invoiceNumber) => new()
    {
        Id = payment.Id,
        InvoiceId = payment.InvoiceId,
        InvoiceNumber = invoiceNumber,
        PaymentDate = payment.PaymentDate,
        Amount = payment.GetTotalAppliedTowardInvoice(),
        MethodDisplay = payment.Method.ToDisplayString(),
        Reference = payment.Reference
    };

    private static decimal Remaining(Invoice invoice, decimal paid) =>
        Math.Max(0m, Math.Abs(invoice.TotalAmount.Amount) - paid);
}
