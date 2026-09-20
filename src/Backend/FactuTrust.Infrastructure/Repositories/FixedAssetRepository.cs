using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.FixedAssets;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed class FixedAssetRepository : IFixedAssetRepository
{
    private const int MaxConcurrencyAttempts = 3;

    private readonly ITenantDbContextFactory _contextFactory;

    public FixedAssetRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<FixedAsset?> GetByIdAsync(
        Guid id,
        bool includeSchedule = false,
        bool includeEvents = false,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        IQueryable<FixedAsset> query = context.FixedAssets.AsSplitQuery();

        if (includeSchedule)
            query = query.Include(a => a.ScheduleLines.OrderBy(l => l.FiscalYear).ThenBy(l => l.PeriodMonth));
        if (includeEvents)
            query = query.Include(a => a.Events.OrderByDescending(e => e.EventDate));
        query = query.Include(a => a.DepreciationRateCategory);

        return await query.FirstOrDefaultAsync(a => a.Id == id, cancellationToken);
    }

    public async Task<FixedAsset?> GetByInventoryNumberAsync(string inventoryNumber, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var n = inventoryNumber.Trim();
        return await context.FixedAssets.AsNoTracking()
            .FirstOrDefaultAsync(a => a.InventoryNumber == n, cancellationToken);
    }

    public async Task<(IReadOnlyList<FixedAsset> Items, int TotalCount)> SearchAsync(
        int page,
        int pageSize,
        FixedAssetStatus? status,
        Guid? categoryId,
        int? fiscalYear,
        string? search,
        int fiscalYearStartMonth = 1,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.FixedAssets.AsNoTracking().AsQueryable();

        if (status.HasValue)
            query = query.Where(a => a.Status == status.Value);
        if (categoryId.HasValue)
            query = query.Where(a => a.DepreciationRateCategoryId == categoryId.Value);
        if (fiscalYear.HasValue)
        {
            // Éligibilité par frontière d'exercice (P3) : la clé d'exercice de la mise en service
            // (année de début d'exercice contenant la date) doit être ≤ l'exercice filtré. La
            // comparaison est inlinée (EF ne traduit pas les méthodes statiques) et équivaut à
            // FiscalYearMath.Key(InServiceDate, startMonth) <= fiscalYear. Exercice civil
            // (startMonth=1) ⇒ InServiceDate.Year <= fiscalYear (comportement historique identique).
            var fy = fiscalYear.Value;
            query = query.Where(a => a.InServiceDate != null &&
                (a.InServiceDate.Value.Month >= fiscalYearStartMonth
                    ? a.InServiceDate.Value.Year
                    : a.InServiceDate.Value.Year - 1) <= fy);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            query = query.Where(a => a.Label.Contains(s) || a.InventoryNumber.Contains(s));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(a => a.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .Include(a => a.DepreciationRateCategory)
            .ToListAsync(cancellationToken);

        return (items, total);
    }

    public async Task<(IReadOnlyList<FixedAssetAmortizationTableRowDto> Items, int TotalCount)> SearchCurrentYearAmortizationTableAsync(
        int page,
        int pageSize,
        int fiscalYear,
        FixedAssetStatus? status,
        Guid? categoryId,
        string? search,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.FixedAssets.AsNoTracking().AsQueryable();

        if (status.HasValue)
            query = query.Where(a => a.Status == status.Value);
        if (categoryId.HasValue)
            query = query.Where(a => a.DepreciationRateCategoryId == categoryId.Value);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            query = query.Where(a => a.Label.Contains(s) || a.InventoryNumber.Contains(s));
        }

        var total = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderBy(a => a.InventoryNumber)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .Select(a => new
            {
                a.Id,
                a.InventoryNumber,
                a.Label,
                a.Status,
                a.DepreciationRateCategoryId,
                CategoryLabel = a.DepreciationRateCategory != null ? a.DepreciationRateCategory.Label : string.Empty,
                a.DepreciationMethod,
                a.AcquisitionDate,
                a.InServiceDate,
                OriginValue = a.TotalCapitalizedCost,
                a.AccumulatedDepreciation,
                a.NetBookValue,
                DotationCalculeeExercice = a.ScheduleLines
                    .Where(l => l.FiscalYear == fiscalYear)
                    .Sum(l => (decimal?)l.DepreciationAmount) ?? 0m,
                DotationComptabiliseeExercice = a.ScheduleLines
                    .Where(l => l.FiscalYear == fiscalYear && l.IsPosted)
                    .Sum(l => (decimal?)l.DepreciationAmount) ?? 0m,
                TotalLineCount = a.ScheduleLines.Count(l => l.FiscalYear == fiscalYear && l.DepreciationAmount > 0),
                PostedLineCount = a.ScheduleLines.Count(l => l.FiscalYear == fiscalYear && l.DepreciationAmount > 0 && l.IsPosted)
            })
            .ToListAsync(cancellationToken);

        var rows = items.Select(i =>
        {
            var postingStatus = i.PostedLineCount <= 0
                ? CurrentYearPostingStatus.None
                : i.PostedLineCount >= i.TotalLineCount
                    ? CurrentYearPostingStatus.FullyPosted
                    : CurrentYearPostingStatus.Partial;

            return new FixedAssetAmortizationTableRowDto(
                i.Id,
                i.InventoryNumber,
                i.Label,
                i.Status,
                i.DepreciationRateCategoryId,
                i.CategoryLabel,
                i.DepreciationMethod,
                i.AcquisitionDate,
                i.InServiceDate,
                i.OriginValue,
                i.AccumulatedDepreciation,
                i.NetBookValue,
                fiscalYear,
                i.DotationCalculeeExercice,
                i.DotationComptabiliseeExercice,
                postingStatus);
        }).ToList();

        return (rows, total);
    }

    public async Task<AmortizationReportResponse> GetAmortizationReportAsync(
        int fiscalYear,
        AmortizationReportGroupingMode groupingMode,
        FixedAssetStatus? status,
        Guid? categoryId,
        string? search,
        string companyName,
        int fiscalYearStartMonth = 1,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var priorYear = fiscalYear - 1;
        var query = context.FixedAssets.AsNoTracking().AsQueryable();

        if (status.HasValue)
            query = query.Where(a => a.Status == status.Value);
        if (categoryId.HasValue)
            query = query.Where(a => a.DepreciationRateCategoryId == categoryId.Value);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            query = query.Where(a => a.Label.Contains(s) || a.InventoryNumber.Contains(s));
        }

        var items = await query
            .OrderBy(a => a.AssetAccountNumber)
            .ThenBy(a => a.InventoryNumber)
            .Select(a => new
            {
                a.Id,
                a.AssetAccountNumber,
                a.InventoryNumber,
                a.Label,
                a.AcquisitionDate,
                OriginValue = a.TotalCapitalizedCost,
                a.UsefulLifeYears,
                a.DepreciationMethod,
                CategoryCode = a.DepreciationRateCategory != null ? a.DepreciationRateCategory.Code : string.Empty,
                CategoryLabel = a.DepreciationRateCategory != null ? a.DepreciationRateCategory.Label : string.Empty,
                PriorFromCurrentYear = a.ScheduleLines
                    .Where(l => l.FiscalYear == fiscalYear)
                    .Min(l => (decimal?)l.PriorAccumulatedDepreciation),
                PriorFromPreviousYear = a.ScheduleLines
                    .Where(l => l.FiscalYear == priorYear)
                    .Max(l => (decimal?)l.AccumulatedDepreciation),
                DotationCalculeeExercice = a.ScheduleLines
                    .Where(l => l.FiscalYear == fiscalYear)
                    .Sum(l => (decimal?)l.DepreciationAmount) ?? 0m,
                DotationComptabiliseeExercice = a.ScheduleLines
                    .Where(l => l.FiscalYear == fiscalYear && l.IsPosted)
                    .Sum(l => (decimal?)l.DepreciationAmount) ?? 0m,
                EndAccumulatedFromLines = a.ScheduleLines
                    .Where(l => l.FiscalYear == fiscalYear)
                    .Max(l => (decimal?)l.AccumulatedDepreciation),
                EndNbvFromLines = a.ScheduleLines
                    .Where(l => l.FiscalYear == fiscalYear)
                    .Min(l => (decimal?)l.ClosingNbv),
                TotalLineCount = a.ScheduleLines.Count(l => l.FiscalYear == fiscalYear && l.DepreciationAmount > 0),
                PostedLineCount = a.ScheduleLines.Count(l => l.FiscalYear == fiscalYear && l.DepreciationAmount > 0 && l.IsPosted)
            })
            .ToListAsync(cancellationToken);

        var projections = items.Select(i =>
        {
            var prior = i.PriorFromCurrentYear ?? i.PriorFromPreviousYear ?? 0m;
            var endAccumulated = i.EndAccumulatedFromLines ?? prior + i.DotationCalculeeExercice;
            var endNbv = i.EndNbvFromLines ?? Math.Max(0m, i.OriginValue - endAccumulated);

            return new AmortizationReportAssetProjection(
                i.Id,
                i.AssetAccountNumber,
                i.InventoryNumber,
                i.Label,
                i.AcquisitionDate,
                i.OriginValue,
                i.UsefulLifeYears,
                i.DepreciationMethod,
                i.CategoryCode,
                i.CategoryLabel,
                prior,
                i.DotationCalculeeExercice,
                i.DotationComptabiliseeExercice,
                endAccumulated,
                endNbv,
                i.TotalLineCount,
                i.PostedLineCount);
        }).ToList();

        return AmortizationReportAssembler.Assemble(projections, fiscalYear, groupingMode, companyName, fiscalYearStartMonth);
    }

    public async Task<int> CountByYearPrefixAsync(int year, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var prefix = $"IMMO-{year}-";
        return await context.FixedAssets.CountAsync(a => a.InventoryNumber.StartsWith(prefix), cancellationToken);
    }

    public async Task<int> GetNextInventorySequenceAsync(int year, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var prefix = $"IMMO-{year}-";
        var suffixes = await context.FixedAssets
            .Where(a => a.InventoryNumber.StartsWith(prefix))
            .Select(a => a.InventoryNumber)
            .ToListAsync(cancellationToken);

        var max = 0;
        foreach (var number in suffixes)
        {
            var suffix = number.Length > prefix.Length ? number[prefix.Length..] : string.Empty;
            if (int.TryParse(suffix, out var value) && value > max)
                max = value;
        }

        return max + 1;
    }

    public async Task<Result<FixedAsset>> AddWithGeneratedInventoryNumberAsync(
        Func<string, Result<FixedAsset>> factory,
        int year,
        CancellationToken cancellationToken = default)
    {
        for (var attempt = 1; attempt <= MaxConcurrencyAttempts; attempt++)
        {
            var sequence = await GetNextInventorySequenceAsync(year, cancellationToken);
            var inventoryNumber = $"IMMO-{year}-{sequence:D4}";

            var built = factory(inventoryNumber);
            if (built.IsFailure)
                return built;

            var entity = built.Value;

            try
            {
                await using var context = _contextFactory.CreateContext();

                if (entity.DepreciationRateCategory != null)
                {
                    context.Entry(entity.DepreciationRateCategory).State = EntityState.Unchanged;
                }

                context.FixedAssets.Add(entity);
                await context.SaveChangesAsync(cancellationToken);
                return Result.Success(entity);
            }
            catch (DbUpdateException ex) when (attempt < MaxConcurrencyAttempts && IsInventoryNumberUniqueViolation(ex))
            {
                // Violation d'unicité sur IX_FixedAssets_InventoryNumber : une autre création concurrente
                // a pris ce numéro entre le calcul de la séquence et l'insert — on retente avec un
                // nouveau contexte et une séquence recalculée (MAX+1, pas de COUNT+1).
            }
        }

        return Result.Failure<FixedAsset>(Error.Conflict(
            "Impossible de générer un numéro d'inventaire unique après plusieurs tentatives."));
    }

    private static bool IsInventoryNumberUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is SqlException { Number: 2601 or 2627 } sqlEx &&
        sqlEx.Message.Contains("IX_FixedAssets_InventoryNumber", StringComparison.OrdinalIgnoreCase);

    public async Task<IReadOnlyList<FixedAsset>> GetBySupplierInvoiceIdAsync(
        Guid supplierInvoiceId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.FixedAssets.AsNoTracking()
            .Where(a => a.SupplierInvoiceId == supplierInvoiceId)
            .OrderBy(a => a.InventoryNumber)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<FixedAsset>> GetActiveForDepreciationRunAsync(int fiscalYear, int fiscalYearStartMonth = 1, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        // Éligibilité par frontière d'exercice (P3) — voir SearchAsync. Inlinée pour la traduction
        // EF (FiscalYearMath.Key non traduisible). Exercice civil ⇒ InServiceDate.Year <= fiscalYear.
        return await context.FixedAssets
            .Where(a => a.Status == FixedAssetStatus.InService || a.Status == FixedAssetStatus.FullyDepreciated)
            .Where(a => a.InServiceDate != null &&
                (a.InServiceDate.Value.Month >= fiscalYearStartMonth
                    ? a.InServiceDate.Value.Year
                    : a.InServiceDate.Value.Year - 1) <= fiscalYear)
            .Where(a => a.DepreciationRatePercent > 0)
            .Include(a => a.ScheduleLines)
            .ToListAsync(cancellationToken);
    }

    public async Task<FixedAsset> AddAsync(FixedAsset entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        if (entity.DepreciationRateCategory != null)
        {
            context.Entry(entity.DepreciationRateCategory).State = EntityState.Unchanged;
        }

        context.FixedAssets.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(FixedAsset entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var existingEventIds = (await context.FixedAssetEvents
            .Where(e => e.FixedAssetId == entity.Id)
            .Select(e => e.Id)
            .ToListAsync(cancellationToken)).ToHashSet();

        var existingLineIds = (await context.DepreciationScheduleLines
            .Where(l => l.FixedAssetId == entity.Id)
            .Select(l => l.Id)
            .ToListAsync(cancellationToken)).ToHashSet();

        AttachReferenceNavigationsAsUnchanged(context, entity);

        context.Attach(entity);
        context.Entry(entity).State = EntityState.Modified;
        entity.IncrementVersion();

        EnsureChildEntityStates(context, entity, existingEventIds, existingLineIds);

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<Result<FixedAsset>> PutInServiceInTransactionAsync(
        Guid id,
        DateTime inServiceDate,
        string creditAccountNumber,
        IReadOnlyList<DepreciationScheduleLine>? scheduleLinesToReplace,
        string updatedBy,
        CancellationToken cancellationToken = default)
    {
        for (var attempt = 1; attempt <= MaxConcurrencyAttempts; attempt++)
        {
            try
            {
                await using var context = _contextFactory.CreateIsolatedContext();
                var strategy = context.Database.CreateExecutionStrategy();

                return await strategy.ExecuteAsync(async () =>
                    await ExecutePutInServiceInTransactionAsync(
                        context,
                        id,
                        inServiceDate,
                        creditAccountNumber,
                        scheduleLinesToReplace,
                        updatedBy,
                        cancellationToken));
            }
            catch (DbUpdateConcurrencyException) when (attempt < MaxConcurrencyAttempts)
            {
                // Retry after optimistic concurrency conflict on Version.
            }
        }

        return Result.Failure<FixedAsset>(Error.Conflict(
            "Les données ont été modifiées entre-temps. Actualisez la page et réessayez."));
    }

    private static async Task<Result<FixedAsset>> ExecutePutInServiceInTransactionAsync(
        TenantDbContext context,
        Guid id,
        DateTime inServiceDate,
        string creditAccountNumber,
        IReadOnlyList<DepreciationScheduleLine>? scheduleLinesToReplace,
        string updatedBy,
        CancellationToken cancellationToken)
    {
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var asset = await context.FixedAssets
                .Include(a => a.ScheduleLines)
                .FirstOrDefaultAsync(a => a.Id == id, cancellationToken);

            if (asset is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Result.Failure<FixedAsset>(Error.Validation("FixedAsset", "Immobilisation introuvable."));
            }

            // Idempotent: execution strategy (or client retry) may run this delegate more than once after a successful commit.
            if (asset.Status == FixedAssetStatus.InService)
            {
                await transaction.RollbackAsync(cancellationToken);
                await context.Entry(asset).Collection(a => a.ScheduleLines).LoadAsync(cancellationToken);
                return Result.Success(asset);
            }

            var existingEventIds = (await context.FixedAssetEvents
                .Where(e => e.FixedAssetId == id)
                .Select(e => e.Id)
                .ToListAsync(cancellationToken)).ToHashSet();

            var put = asset.PutInService(inServiceDate, creditAccountNumber);
            if (put.IsFailure)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Result.Failure<FixedAsset>(put.Error);
            }

            asset.SetAuditInfo(updatedBy, isUpdate: true);
            asset.IncrementVersion();
            EnsureNewFixedAssetEventsAreAdded(context, asset, existingEventIds);

            await context.SaveChangesAsync(cancellationToken);

            if (scheduleLinesToReplace is { Count: > 0 })
            {
                await MergeScheduleLinesInContextAsync(context, asset.Id, scheduleLinesToReplace, skipPostedLines: false, cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);

            if (scheduleLinesToReplace is { Count: > 0 })
            {
                await context.Entry(asset).Collection(a => a.ScheduleLines).LoadAsync(cancellationToken);
            }

            return Result.Success(asset);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task ReplaceScheduleLinesAsync(
        Guid fixedAssetId,
        IReadOnlyList<DepreciationScheduleLine> lines,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        await MergeScheduleLinesInContextAsync(context, fixedAssetId, lines, skipPostedLines: false, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Flux de cession (T4, B1) : merge des lignes non postées uniquement. La ligne de l'année de
    /// cession (présente dans <paramref name="targetLines"/>) est mise à jour en place via
    /// <see cref="DepreciationScheduleLine.UpdateAmounts"/> (Id et JournalEntryId conservés) ;
    /// les lignes non postées sans correspondance (exercices postérieurs) sont supprimées ; les
    /// lignes <c>IsPosted</c> sont laissées intactes (jamais touchées). S'enrôle dans la
    /// transaction ambiante via <c>CreateContext()</c>.
    /// </summary>
    public async Task ReplaceUnpostedScheduleLinesAsync(
        Guid fixedAssetId,
        IReadOnlyList<DepreciationScheduleLine> targetLines,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        await MergeScheduleLinesInContextAsync(context, fixedAssetId, targetLines, skipPostedLines: true, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DepreciationScheduleLine>> GetUnpostedScheduleLinesForYearAsync(
        int fiscalYear,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.DepreciationScheduleLines
            .Include(l => l.FixedAsset)
            .Where(l => l.FiscalYear == fiscalYear && !l.IsPosted && l.DepreciationAmount > 0)
            .Where(l => l.FixedAsset!.Status == FixedAssetStatus.InService || l.FixedAsset.Status == FixedAssetStatus.FullyDepreciated)
            .OrderBy(l => l.FixedAsset!.InventoryNumber)
            .ToListAsync(cancellationToken);
    }

    public async Task SaveScheduleLineAsync(DepreciationScheduleLine line, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var existing = await context.DepreciationScheduleLines
            .AsNoTracking()
            .AnyAsync(l => l.Id == line.Id, cancellationToken);

        if (existing)
        {
            context.DepreciationScheduleLines.Update(line);
        }
        else
        {
            context.DepreciationScheduleLines.Add(line);
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<int> GetPostedScheduleLineCountForYearAsync(int fiscalYear, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.DepreciationScheduleLines
            .Where(l => l.FiscalYear == fiscalYear && l.IsPosted && l.DepreciationAmount > 0)
            .Where(l => l.FixedAsset!.Status == FixedAssetStatus.InService || l.FixedAsset.Status == FixedAssetStatus.FullyDepreciated)
            .CountAsync(cancellationToken);
    }

    /// <summary>
    /// Projection de l'état d'extourne (T13, C6) : <c>LEFT JOIN JournalEntries</c> sur
    /// <c>JournalEntryId</c>. Conservateur — <c>JournalEntryId</c> nul ou écriture absente →
    /// <c>IsReversed = false</c> (via <c>entry != null &amp;&amp; entry.IsReversed</c>).
    /// </summary>
    public async Task<IReadOnlyList<(DepreciationScheduleLine Line, bool IsReversed)>> GetScheduleLinesWithReversalStateAsync(
        Guid fixedAssetId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var rows = await (
            from line in context.DepreciationScheduleLines.AsNoTracking()
            where line.FixedAssetId == fixedAssetId
            join entry in context.JournalEntries.AsNoTracking()
                on line.JournalEntryId equals entry.Id into entries
            from entry in entries.DefaultIfEmpty()
            orderby line.FiscalYear, line.PeriodMonth
            select new
            {
                Line = line,
                IsReversed = entry != null && entry.IsReversed
            }).ToListAsync(cancellationToken);

        return rows
            .Select(r => (r.Line, r.IsReversed))
            .ToList();
    }

    /// <summary>
    /// Met à jour uniquement les colonnes cumul de l'actif (T13, C6) : <c>Attach</c> marque les
    /// navigations accessibles (lignes, événements, catégorie) <c>Unchanged</c> → aucune écriture
    /// sur les lignes, seul l'actif est <c>Modified</c>. Évite le repli par state-management des
    /// lignes de <c>UpdateAsync</c> (qui re-sauverait/insérerait des lignes périmées en mémoire).
    /// </summary>
    public async Task UpdateDepreciationTotalsAsync(FixedAsset asset, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.FixedAssets.Attach(asset);
        context.Entry(asset).State = EntityState.Modified;
        asset.IncrementVersion();
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Merge par clé <c>(FiscalYear, PeriodMonth)</c> — préserve l'identité (Id) et le lien d'audit
    /// (<c>JournalEntryId</c>) des lignes existantes (T4/T13, C6) au lieu d'un delete+recreate qui
    /// cassait <c>JournalEntries.SourceEntityId → DepreciationScheduleLine.Id</c>.
    /// <list type="bullet">
    /// <item>Ligne existante <c>IsPosted</c> : exception si <paramref name="skipPostedLines"/> est
    ///   <c>false</c> (flux « regénérer ») ; ignorée (intacte) si <c>true</c> (flux cession).</item>
    /// <item>Ligne existante non postée avec correspondance dans <paramref name="lines"/> :
    ///   <see cref="DepreciationScheduleLine.UpdateAmounts"/> (même Id, JournalEntryId conservé).</item>
    /// <item>Ligne de <paramref name="lines"/> sans existant : <c>Add</c>.</item>
    /// <item>Ligne existante non postée sans correspondance : <c>Remove</c>.</item>
    /// </list>
    /// </summary>
    private static async Task MergeScheduleLinesInContextAsync(
        TenantDbContext context,
        Guid fixedAssetId,
        IReadOnlyList<DepreciationScheduleLine> lines,
        bool skipPostedLines,
        CancellationToken cancellationToken)
    {
        var existing = await context.DepreciationScheduleLines
            .Where(l => l.FixedAssetId == fixedAssetId)
            .ToListAsync(cancellationToken);

        if (!skipPostedLines && existing.Any(l => l.IsPosted))
            throw new InvalidOperationException("Des dotations comptabilisées empêchent la regénération du tableau.");

        // Les lignes postées sont ignorées dans le flux de cession (skipPostedLines) : jamais
        // modifiées ni supprimées. Seules les lignes non postées participent au merge.
        var unpostedByKey = existing
            .Where(l => !l.IsPosted)
            .ToDictionary(l => (l.FiscalYear, l.PeriodMonth));

        foreach (var target in lines)
        {
            var key = (target.FiscalYear, target.PeriodMonth);
            if (unpostedByKey.TryGetValue(key, out var match))
            {
                var update = match.UpdateAmounts(
                    target.OpeningNbv,
                    target.NormalAnnualAmount,
                    target.PriorAccumulatedDepreciation,
                    target.DepreciationAmount,
                    target.AccumulatedDepreciation,
                    target.ClosingNbv,
                    target.PeriodMonth);
                if (update.IsFailure)
                    throw new InvalidOperationException(update.Error.Description);
                unpostedByKey.Remove(key);
            }
            else
            {
                context.DepreciationScheduleLines.Add(target);
            }
        }

        // Lignes non postées restantes (sans correspondance dans le tableau cible) → suppression.
        foreach (var remaining in unpostedByKey.Values)
        {
            context.DepreciationScheduleLines.Remove(remaining);
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    private static void AttachReferenceNavigationsAsUnchanged(TenantDbContext context, FixedAsset entity)
    {
        if (entity.DepreciationRateCategory is null)
            return;

        var trackedCategory = context.ChangeTracker.Entries<DepreciationRateCategory>()
            .FirstOrDefault(e => e.Entity.Id == entity.DepreciationRateCategory.Id)?.Entity;

        if (trackedCategory is not null && !ReferenceEquals(trackedCategory, entity.DepreciationRateCategory))
        {
            typeof(FixedAsset).GetProperty(nameof(FixedAsset.DepreciationRateCategory))!
                .SetValue(entity, trackedCategory);
        }

        context.Entry(entity.DepreciationRateCategory).State = EntityState.Unchanged;
    }

    /// <summary>
    /// EF Core can track new domain events/lines as Modified when attaching a detached aggregate;
    /// that produces UPDATE with 0 rows and DbUpdateConcurrencyException.
    /// </summary>
    private static void EnsureChildEntityStates(
        TenantDbContext context,
        FixedAsset asset,
        IReadOnlySet<Guid> existingEventIds,
        IReadOnlySet<Guid> existingLineIds)
    {
        foreach (var evt in asset.Events)
        {
            var entry = context.Entry(evt);
            entry.State = existingEventIds.Contains(evt.Id) ? EntityState.Unchanged : EntityState.Added;
        }

        foreach (var line in asset.ScheduleLines)
        {
            var entry = context.Entry(line);
            entry.State = existingLineIds.Contains(line.Id) ? EntityState.Modified : EntityState.Added;
            if (line.FixedAsset != null)
                context.Entry(line.FixedAsset).State = EntityState.Unchanged;
        }

        ResetReferenceNavigationsAsUnchanged(context, asset);
    }

    private static void ResetReferenceNavigationsAsUnchanged(TenantDbContext context, FixedAsset asset)
    {
        if (asset.DepreciationRateCategory != null)
            context.Entry(asset.DepreciationRateCategory).State = EntityState.Unchanged;
    }

    /// <summary>
    /// EF Core can track new events as Modified when they are added via the domain collection on a tracked FixedAsset;
    /// that produces UPDATE with 0 rows and DbUpdateConcurrencyException.
    /// </summary>
    private static void EnsureNewFixedAssetEventsAreAdded(
        TenantDbContext context,
        FixedAsset asset,
        IReadOnlySet<Guid> eventIdsBefore)
    {
        foreach (var evt in asset.Events)
        {
            if (eventIdsBefore.Contains(evt.Id))
                continue;

            var entry = context.Entry(evt);
            if (entry.State != EntityState.Added)
                entry.State = EntityState.Added;
        }
    }
}
