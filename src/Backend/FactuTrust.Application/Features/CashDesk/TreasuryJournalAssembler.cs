using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.CashDesk;

internal static class TreasuryJournalAssembler
{
    public static Result Validate(DateTime from, DateTime to, PaymentMethod? method)
    {
        if (from.Date > to.Date)
            return Result.Failure(Error.Validation("Period", "La date de début ne peut pas être après la date de fin."));

        var days = (to.Date - from.Date).Days + 1;
        if (days > TreasuryJournalConstants.MaxPeriodDays)
            return Result.Failure(Error.Validation("Period", TreasuryJournalConstants.PeriodTooLongMessage));

        if (method.HasValue && !Enum.IsDefined(method.Value))
            return Result.Failure(Error.Validation("Method", TreasuryJournalConstants.InvalidMethodMessage));

        return Result.Success();
    }

    public static int ClampPage(int page) => Math.Max(1, page);

    public static int ClampPageSize(int pageSize) =>
        Math.Clamp(pageSize, 1, TreasuryJournalConstants.MaxPageSize);

    public static IReadOnlyList<TreasuryJournalGroupDto> BuildGroups(IReadOnlyList<CashJournalCategoryTotal> totals)
    {
        var lookup = new Dictionary<(CashOperationType Type, int? Code), CashJournalCategoryTotal>();
        foreach (var row in totals)
            lookup[(row.OperationType, row.CategoryCode)] = row;

        var groups = new List<TreasuryJournalGroupDto>();
        Append(groups, lookup, CashOperationType.Credit, Codes(TreasuryJournalLabels.RevenueOrder));
        Append(groups, lookup, CashOperationType.Debit, Codes(TreasuryJournalLabels.ExpenseOrder));

        foreach (var row in totals)
        {
            if (groups.Any(g => g.OperationType == (int)row.OperationType && g.Category == row.CategoryCode))
                continue;
            if (row.Count <= 0)
                continue;
            groups.Add(ToDto(row));
        }

        return groups;
    }

    public static (decimal Credits, decimal Debits, int Count) Summarize(IReadOnlyList<CashJournalCategoryTotal> totals)
    {
        decimal credits = 0;
        decimal debits = 0;
        var count = 0;
        foreach (var row in totals)
        {
            count += row.Count;
            if (row.OperationType == CashOperationType.Credit)
                credits += row.Total;
            else
                debits += row.Total;
        }

        return (credits, debits, count);
    }

    private static IEnumerable<int?> Codes<T>(IReadOnlyList<T> order) where T : struct, Enum
    {
        foreach (var value in order)
            yield return Convert.ToInt32(value);
        yield return null;
    }

    private static void Append(
        List<TreasuryJournalGroupDto> groups,
        IReadOnlyDictionary<(CashOperationType Type, int? Code), CashJournalCategoryTotal> lookup,
        CashOperationType type,
        IEnumerable<int?> codes)
    {
        foreach (var code in codes)
        {
            if (!lookup.TryGetValue((type, code), out var row) || row.Count <= 0)
                continue;
            groups.Add(ToDto(row));
        }
    }

    private static TreasuryJournalGroupDto ToDto(CashJournalCategoryTotal row) => new()
    {
        OperationType = (int)row.OperationType,
        Category = row.CategoryCode,
        Count = row.Count,
        Total = row.Total
    };
}
