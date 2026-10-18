using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Orchestration du tableau de bord délégué (plan §3.2) : période résolue par le service, balances
/// âgées repliées en « à échéance / échus », dégradation gracieuse quand une balance échoue.
/// </summary>
public sealed class GetAccountingOverviewQueryHandlerTests
{
    private static readonly DateTime Today = new(2026, 10, 18);

    /// <summary>
    /// Horloge fixée à 23:30 UTC avec un fuseau local UTC+1 : la date locale est déjà le 19.
    /// La date de référence des situations 411/401 doit rester la date UTC (comme les balances âgées).
    /// </summary>
    private sealed class FixedTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(Today.AddHours(23).AddMinutes(30), TimeSpan.Zero);
        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.CreateCustomTimeZone("UTC+1", TimeSpan.FromHours(1), "UTC+1", "UTC+1");
    }

    private static AccountingOverviewDashboardDto Core(params string[] warnings) => new()
    {
        FiscalYear = 2026,
        Month = 10,
        Comparison = "previous-month",
        TotalRevenue = new OverviewKpiDto(),
        TotalExpenses = new OverviewKpiDto(),
        NetResult = new OverviewKpiDto(),
        AvailableCash = new OverviewKpiDto(),
        Warnings = warnings
    };

    private static AgingReportRowDto Row(decimal notYetDue, decimal d0, decimal d31, decimal d61, decimal over90) => new()
    {
        ThirdPartyId = Guid.NewGuid(),
        ThirdPartyName = "Tiers",
        Total = notYetDue + d0 + d31 + d61 + over90,
        NotYetDue = notYetDue,
        Days0To30 = d0,
        Days31To60 = d31,
        Days61To90 = d61,
        DaysOver90 = over90
    };

    private static (GetAccountingOverviewQueryHandler handler, Mock<IAccountingOverviewService> service, Mock<IMediator> mediator) Build(
        Result<IReadOnlyList<AgingReportRowDto>> clients,
        Result<IReadOnlyList<AgingReportRowDto>> suppliers,
        AccountingOverviewDashboardDto? core = null)
    {
        var service = new Mock<IAccountingOverviewService>();
        service.Setup(s => s.ResolvePeriodAsync(It.IsAny<int?>(), It.IsAny<int?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OverviewPeriod(2026, 10));
        service.Setup(s => s.GetOverviewAsync(It.IsAny<OverviewPeriod>(), It.IsAny<DashboardComparison>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(core ?? Core()));

        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetClientAgingReportQuery>(), It.IsAny<CancellationToken>())).ReturnsAsync(clients);
        mediator.Setup(m => m.Send(It.IsAny<GetSupplierAgingReportQuery>(), It.IsAny<CancellationToken>())).ReturnsAsync(suppliers);

        var handler = new GetAccountingOverviewQueryHandler(
            service.Object, mediator.Object, new FixedTimeProvider(), NullLogger<GetAccountingOverviewQueryHandler>.Instance);
        return (handler, service, mediator);
    }

    [Fact]
    public async Task Handle_FoldsAgingIntoNotDueAndOverdue_AsOfToday()
    {
        IReadOnlyList<AgingReportRowDto> clientRows = new[] { Row(100m, 10m, 20m, 30m, 40m), Row(50m, 0m, 0m, 0m, 5m) };
        IReadOnlyList<AgingReportRowDto> supplierRows = new[] { Row(200m, 0m, 0m, 0m, 0m) };
        var (handler, _, _) = Build(Result.Success(clientRows), Result.Success(supplierRows));

        var result = await handler.Handle(new GetAccountingOverviewQuery(null, null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var clients = result.Value.Clients!;
        Assert.Equal(Today, clients.AsOf);
        Assert.Equal(255m, clients.Total);
        Assert.Equal(150m, clients.NotDue);
        Assert.Equal(105m, clients.Overdue);
        Assert.Equal(2, clients.ThirdPartyCount);

        var suppliers = result.Value.Suppliers!;
        Assert.Equal(200m, suppliers.Total);
        Assert.Equal(200m, suppliers.NotDue);
        Assert.Equal(0m, suppliers.Overdue);
        Assert.Equal(1, suppliers.ThirdPartyCount);
        Assert.Empty(result.Value.Warnings);
    }

    [Fact]
    public async Task Handle_PassesResolvedPeriodAndComparison_ToService()
    {
        IReadOnlyList<AgingReportRowDto> none = Array.Empty<AgingReportRowDto>();
        var (handler, service, _) = Build(Result.Success(none), Result.Success(none));

        await handler.Handle(new GetAccountingOverviewQuery(2026, 3, DashboardComparison.PreviousYear), CancellationToken.None);

        service.Verify(s => s.ResolvePeriodAsync(2026, 3, It.IsAny<CancellationToken>()), Times.Once);
        service.Verify(s => s.GetOverviewAsync(new OverviewPeriod(2026, 10), DashboardComparison.PreviousYear, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_WhenAgingFails_BlockIsNull_AndWarningIsAdded()
    {
        IReadOnlyList<AgingReportRowDto> supplierRows = new[] { Row(10m, 0m, 0m, 0m, 0m) };
        var (handler, _, _) = Build(
            Result.Failure<IReadOnlyList<AgingReportRowDto>>(Error.Validation("Aging", "boom")),
            Result.Success(supplierRows),
            Core("existing"));

        var result = await handler.Handle(new GetAccountingOverviewQuery(null, null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.Clients);
        Assert.NotNull(result.Value.Suppliers);
        Assert.Equal(new[] { "existing", GetAccountingOverviewQueryHandler.ClientsAgingUnavailable }, result.Value.Warnings);
    }

    [Fact]
    public async Task Handle_WhenAgingThrows_DashboardStillSucceeds()
    {
        IReadOnlyList<AgingReportRowDto> none = Array.Empty<AgingReportRowDto>();
        var (handler, _, mediator) = Build(Result.Success(none), Result.Success(none));
        mediator.Setup(m => m.Send(It.IsAny<GetSupplierAgingReportQuery>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("db down"));

        var result = await handler.Handle(new GetAccountingOverviewQuery(null, null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value.Clients);
        Assert.Null(result.Value.Suppliers);
        Assert.Contains(GetAccountingOverviewQueryHandler.SuppliersAgingUnavailable, result.Value.Warnings);
    }

    [Fact]
    public async Task Handle_WhenCoreFails_ReturnsFailure_WithoutCallingAging()
    {
        IReadOnlyList<AgingReportRowDto> none = Array.Empty<AgingReportRowDto>();
        var (handler, service, mediator) = Build(Result.Success(none), Result.Success(none));
        service.Setup(s => s.GetOverviewAsync(It.IsAny<OverviewPeriod>(), It.IsAny<DashboardComparison>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<AccountingOverviewDashboardDto>(Error.Validation("Period", "Période invalide.")));

        var result = await handler.Handle(new GetAccountingOverviewQuery(null, null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Période invalide.", result.Error.Description);
        mediator.Verify(m => m.Send(It.IsAny<IRequest<Result<IReadOnlyList<AgingReportRowDto>>>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(null, DashboardComparison.PreviousMonth)]
    [InlineData("", DashboardComparison.PreviousMonth)]
    [InlineData("previous-month", DashboardComparison.PreviousMonth)]
    [InlineData("Previous-Year", DashboardComparison.PreviousYear)]
    public void ComparisonCodes_TryParse_AcceptsKnownCodes(string? code, DashboardComparison expected)
    {
        Assert.Equal(expected, DashboardComparisonCodes.TryParse(code));
    }

    [Fact]
    public void ComparisonCodes_TryParse_RejectsUnknownCode()
    {
        Assert.Null(DashboardComparisonCodes.TryParse("last-quarter"));
    }
}
