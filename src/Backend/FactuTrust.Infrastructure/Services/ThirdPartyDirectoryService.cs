using System.Globalization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Plan tiers unifié : agrège les référentiels Clients et Fournisseurs (intacts), joint les fiches
/// comptables (<see cref="ThirdPartyAccountingProfile"/>) et calcule le solde courant par tiers
/// (une requête agrégée, politique brouillard identique aux états auxiliaires).
/// </summary>
public sealed class ThirdPartyDirectoryService : IThirdPartyDirectoryService
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public ThirdPartyDirectoryService(
        ITenantDbContextFactory contextFactory,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _contextFactory = contextFactory;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    private bool ShowDrafts => _settings.IncludeBrouillardInReports;

    public async Task<Result<ThirdPartyDirectoryResultDto>> GetDirectoryAsync(
        ThirdPartyKind? kind, string? search, bool includeInactive, int page, int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / 200);
        pageSize = Math.Clamp(pageSize, 1, 200);

        await using var ctx = _contextFactory.CreateContext();

        var rows = new List<(Guid Id, ThirdPartyKind Kind, string Name, string? Email, bool IsActive)>();
        if (kind is null or ThirdPartyKind.Client)
        {
            var clients = await ctx.Clients.AsNoTracking()
                .Select(c => new { c.Id, c.Name, Email = c.Email.Value, c.IsActive })
                .ToListAsync(cancellationToken);
            rows.AddRange(clients.Select(c => (c.Id, ThirdPartyKind.Client, c.Name, (string?)c.Email, c.IsActive)));
        }
        if (kind is null or ThirdPartyKind.Supplier)
        {
            var suppliers = await ctx.Suppliers.AsNoTracking()
                .Select(s => new { s.Id, s.Name, Email = s.Email.Value, s.IsActive })
                .ToListAsync(cancellationToken);
            rows.AddRange(suppliers.Select(s => (s.Id, ThirdPartyKind.Supplier, s.Name, (string?)s.Email, s.IsActive)));
        }

        if (!includeInactive)
            rows = rows.Where(r => r.IsActive).ToList();

        var profiles = await ctx.ThirdPartyAccountingProfiles.AsNoTracking()
            .ToDictionaryAsync(p => (p.Kind, p.ThirdPartyId), cancellationToken);

        // Recherche sur nom, e-mail OU code auxiliaire (après jointure des fiches).
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            rows = rows.Where(r =>
                r.Name.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                (r.Email?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (profiles.TryGetValue((r.Kind, r.Id), out var p) &&
                 p.AuxiliaryCode.Contains(term, StringComparison.OrdinalIgnoreCase))).ToList();
        }

        // Soldes courants par tiers : mêmes règles brouillard que la balance auxiliaire.
        var balanceQuery = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.ThirdPartyId != null && l.ThirdPartyKind != ThirdPartyKind.None);
        if (!ShowDrafts)
            balanceQuery = balanceQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);
        var balances = (await balanceQuery
                .GroupBy(l => new { l.ThirdPartyId, l.ThirdPartyKind })
                .Select(g => new
                {
                    g.Key.ThirdPartyId,
                    g.Key.ThirdPartyKind,
                    Debit = g.Sum(l => l.DebitAmount.Amount),
                    Credit = g.Sum(l => l.CreditAmount.Amount)
                })
                .ToListAsync(cancellationToken))
            .ToDictionary(b => (b.ThirdPartyKind, b.ThirdPartyId!.Value), b => (b.Debit, b.Credit));

        var ordered = rows.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase).ToList();
        var total = ordered.Count;
        var items = ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r =>
            {
                profiles.TryGetValue((r.Kind, r.Id), out var profile);
                balances.TryGetValue((r.Kind, r.Id), out var bal);
                var net = bal.Debit - bal.Credit;
                return new ThirdPartyDirectoryRowDto
                {
                    ThirdPartyId = r.Id,
                    Kind = (int)r.Kind,
                    Name = r.Name,
                    Email = r.Email,
                    AuxiliaryCode = profile?.AuxiliaryCode,
                    CollectiveAccountNumber = profile?.CollectiveAccountNumber
                        ?? ThirdPartyAccountingProfile.DefaultCollectiveAccount(r.Kind),
                    PaymentTermDays = profile?.PaymentTermDays,
                    IsActive = r.IsActive,
                    BalanceDebit = net > 0 ? net : 0m,
                    BalanceCredit = net < 0 ? -net : 0m
                };
            })
            .ToList();

        return Result.Success(new ThirdPartyDirectoryResultDto
        {
            Items = items,
            TotalCount = total,
            Page = page,
            PageSize = pageSize
        });
    }

    public async Task<Result<ThirdPartyProfileDto>> GetProfileAsync(
        ThirdPartyKind kind, Guid thirdPartyId, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var name = await ResolveNameAsync(ctx, kind, thirdPartyId, cancellationToken);
        if (name is null)
            return Result.Failure<ThirdPartyProfileDto>(Error.NotFound("ThirdParty", thirdPartyId));

        var profile = await ctx.ThirdPartyAccountingProfiles.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Kind == kind && p.ThirdPartyId == thirdPartyId, cancellationToken);

        return Result.Success(new ThirdPartyProfileDto
        {
            Kind = (int)kind,
            ThirdPartyId = thirdPartyId,
            ThirdPartyName = name,
            AuxiliaryCode = profile?.AuxiliaryCode,
            CollectiveAccountNumber = profile?.CollectiveAccountNumber
                ?? ThirdPartyAccountingProfile.DefaultCollectiveAccount(kind),
            PaymentTermDays = profile?.PaymentTermDays,
            AccountingNotes = profile?.AccountingNotes,
            HasProfile = profile is not null
        });
    }

    public async Task<Result> UpsertProfileAsync(
        ThirdPartyKind kind, Guid thirdPartyId, UpsertThirdPartyProfileRequest request,
        CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var name = await ResolveNameAsync(ctx, kind, thirdPartyId, cancellationToken);
        if (name is null)
            return Result.Failure(Error.NotFound("ThirdParty", thirdPartyId));

        var normalizedCode = request.AuxiliaryCode?.Trim().ToUpperInvariant() ?? string.Empty;
        var codeOwner = await ctx.ThirdPartyAccountingProfiles.AsNoTracking()
            .FirstOrDefaultAsync(p => p.AuxiliaryCode == normalizedCode, cancellationToken);
        if (codeOwner is not null && (codeOwner.Kind != kind || codeOwner.ThirdPartyId != thirdPartyId))
            return Result.Failure(Error.Conflict($"Le code auxiliaire {normalizedCode} est déjà attribué à un autre tiers."));

        var user = _currentUser.Email ?? "system";
        var existing = await ctx.ThirdPartyAccountingProfiles
            .FirstOrDefaultAsync(p => p.Kind == kind && p.ThirdPartyId == thirdPartyId, cancellationToken);
        if (existing is null)
        {
            var create = ThirdPartyAccountingProfile.Create(
                kind, thirdPartyId, normalizedCode, request.CollectiveAccountNumber,
                request.PaymentTermDays, request.AccountingNotes);
            if (create.IsFailure)
                return Result.Failure(create.Error);
            create.Value.SetAuditInfo(user, false);
            ctx.ThirdPartyAccountingProfiles.Add(create.Value);
        }
        else
        {
            var update = existing.Update(
                normalizedCode, request.CollectiveAccountNumber, request.PaymentTermDays, request.AccountingNotes);
            if (update.IsFailure)
                return update;
            existing.SetAuditInfo(user, true);
        }

        await ctx.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<int>> EnsureAuxiliaryCodesAsync(CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var user = _currentUser.Email ?? "system";

        var existing = await ctx.ThirdPartyAccountingProfiles.AsNoTracking().ToListAsync(cancellationToken);
        var byThirdParty = existing.Select(p => (p.Kind, p.ThirdPartyId)).ToHashSet();

        var created = 0;
        created += await EnsureForKindAsync(ctx, ThirdPartyKind.Client,
            await ctx.Clients.AsNoTracking().Where(c => c.IsActive).Select(c => c.Id).ToListAsync(cancellationToken),
            existing, byThirdParty, user, cancellationToken);
        created += await EnsureForKindAsync(ctx, ThirdPartyKind.Supplier,
            await ctx.Suppliers.AsNoTracking().Where(s => s.IsActive).Select(s => s.Id).ToListAsync(cancellationToken),
            existing, byThirdParty, user, cancellationToken);

        if (created > 0)
            await ctx.SaveChangesAsync(cancellationToken);

        return Result.Success(created);
    }

    private static Task<int> EnsureForKindAsync(
        Persistence.TenantDbContext ctx, ThirdPartyKind kind, List<Guid> thirdPartyIds,
        List<ThirdPartyAccountingProfile> existingProfiles, HashSet<(ThirdPartyKind, Guid)> byThirdParty,
        string user, CancellationToken cancellationToken)
    {
        var prefix = ThirdPartyAccountingProfile.CodePrefix(kind);
        var next = existingProfiles
            .Where(p => p.AuxiliaryCode.StartsWith(prefix, StringComparison.Ordinal))
            .Select(p => int.TryParse(p.AuxiliaryCode[prefix.Length..], NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0)
            .DefaultIfEmpty(0)
            .Max() + 1;

        var created = 0;
        foreach (var id in thirdPartyIds)
        {
            if (byThirdParty.Contains((kind, id)))
                continue;

            var code = $"{prefix}{next.ToString("0000", CultureInfo.InvariantCulture)}";
            next++;
            var profile = ThirdPartyAccountingProfile.Create(
                kind, id, code, ThirdPartyAccountingProfile.DefaultCollectiveAccount(kind));
            if (profile.IsFailure)
                continue;
            profile.Value.SetAuditInfo(user, false);
            ctx.ThirdPartyAccountingProfiles.Add(profile.Value);
            created++;
        }

        return Task.FromResult(created);
    }

    private static async Task<string?> ResolveNameAsync(
        Persistence.TenantDbContext ctx, ThirdPartyKind kind, Guid id, CancellationToken ct)
    {
        return kind switch
        {
            ThirdPartyKind.Client => await ctx.Clients.AsNoTracking()
                .Where(c => c.Id == id).Select(c => c.Name).FirstOrDefaultAsync(ct),
            ThirdPartyKind.Supplier => await ctx.Suppliers.AsNoTracking()
                .Where(s => s.Id == id).Select(s => s.Name).FirstOrDefaultAsync(ct),
            _ => null
        };
    }
}
