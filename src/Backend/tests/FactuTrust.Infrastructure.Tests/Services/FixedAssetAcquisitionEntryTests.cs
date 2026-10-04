using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Écriture d'acquisition d'immobilisation (<see cref="AccountingService.GenerateFixedAssetAcquisitionEntryAsync"/>)
/// — plan T2.4 : TVA déductible sur 43662 pour les actifs standards, TVA capitalisée (véhicules de
/// tourisme) sans ligne 43662, TVA nulle inchangée (non-régression), idempotence par source+asset.
/// </summary>
public sealed class FixedAssetAcquisitionEntryTests
{
    private static readonly Guid CategoryId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001");

    private static ChartOfAccount Acc(string number) =>
        ChartOfAccount.Create(number, $"Compte {number}", int.Parse(number[..1].ToString()), null, AccountNatureType.Debit).Value;

    private static (AccountingService service, List<JournalEntry> captured) BuildService(
        JournalEntry? existingBySource = null,
        bool brouillardEnabled = false)
    {
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.CountAsync(It.IsAny<CancellationToken>())).ReturnsAsync(50);
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string n, CancellationToken _) => Acc(n));

        var periodService = new Mock<IAccountingPeriodService>();
        var period = AccountingPeriod.Create(2026, 3, new DateTime(2026, 3, 1), new DateTime(2026, 3, 31));
        periodService.Setup(x => x.EnsureOpenPeriodAsync(It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(period));

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(x => x.GetBySourceAsync(AccountingService.SourceFixedAssetAcquisition, It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingBySource);
        journals.Setup(x => x.ReserveNextEntryNumberAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);
        var captured = new List<JournalEntry>();
        journals.Setup(x => x.AddAsync(It.IsAny<JournalEntry>(), It.IsAny<CancellationToken>()))
            .Callback<JournalEntry, CancellationToken>((e, _) => captured.Add(e))
            .ReturnsAsync((JournalEntry e, CancellationToken _) => e);

        var withholding = new Mock<IWithholdingTaxRepository>();
        var categories = new Mock<IDepreciationRateCategoryRepository>();
        var ctxFactory = new Mock<ITenantDbContextFactory>();
        var settings = Options.Create(new AccountingSettings { BrouillardEnabled = brouillardEnabled });

        var service = new AccountingService(
            chart.Object, periodService.Object, journals.Object, withholding.Object, categories.Object,
            ctxFactory.Object, NullLogger<AccountingService>.Instance, settings);

        return (service, captured);
    }

    private static FixedAsset CreateInServiceAsset(
        string assetAccount, decimal cost, decimal vatAmount, bool vatCapitalized, decimal residual = 0m)
    {
        var create = FixedAsset.Create(
            "IMMO-2026-0001", "Actif test", CategoryId, 15m, 6.67m,
            assetAccount, "2813", "6813", cost, 0m, residual, new DateTime(2026, 1, 15),
            vatAmount: vatAmount, vatCapitalized: vatCapitalized);
        var asset = create.Value;
        asset.PutInService(new DateTime(2026, 3, 1), "404");
        return asset;
    }

    [Fact]
    public async Task StandardAsset_WithVat_Produces3Lines_HtOn2xx_43662_TtcOn404()
    {
        var asset = CreateInServiceAsset("213", 50_000m, 9_500m, vatCapitalized: false);
        var (service, captured) = BuildService();

        var result = await service.GenerateFixedAssetAcquisitionEntryAsync(asset, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Should().HaveCount(3);
        entry.Lines.Single(l => l.AccountNumber == "213").DebitAmount.Amount.Should().Be(50_000m);
        entry.Lines.Single(l => l.AccountNumber == "43662").DebitAmount.Amount.Should().Be(9_500m);
        entry.Lines.Single(l => l.AccountNumber == "404").CreditAmount.Amount.Should().Be(59_500m);
        entry.Lines.Sum(l => l.DebitAmount.Amount).Should().Be(entry.Lines.Sum(l => l.CreditAmount.Amount));
    }

    [Fact]
    public async Task PassengerVehicle_VatCapitalized_Produces2Lines_TtcOnAssetAccount_No43662()
    {
        var asset = CreateInServiceAsset("2244", 50_000m, 9_500m, vatCapitalized: true, residual: 55_000m);
        var (service, captured) = BuildService();

        var result = await service.GenerateFixedAssetAcquisitionEntryAsync(asset, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Should().HaveCount(2);
        entry.Lines.Should().NotContain(l => l.AccountNumber == "43662");
        entry.Lines.Single(l => l.AccountNumber == "2244").DebitAmount.Amount.Should().Be(59_500m);
        entry.Lines.Single(l => l.AccountNumber == "404").CreditAmount.Amount.Should().Be(59_500m);
    }

    [Fact]
    public async Task VatAmountZero_Produces2Lines_LegacyBehaviorUnchanged()
    {
        var asset = CreateInServiceAsset("213", 30_000m, 0m, vatCapitalized: false);
        var (service, captured) = BuildService();

        var result = await service.GenerateFixedAssetAcquisitionEntryAsync(asset, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Should().HaveCount(2);
        entry.Lines.Should().NotContain(l => l.AccountNumber == "43662");
        entry.Lines.Single(l => l.AccountNumber == "213").DebitAmount.Amount.Should().Be(30_000m);
        entry.Lines.Single(l => l.AccountNumber == "404").CreditAmount.Amount.Should().Be(30_000m);
    }

    [Fact]
    public async Task Idempotence_ExistingEntryForSourceAndAsset_DoesNotCreateSecondEntry()
    {
        var asset = CreateInServiceAsset("213", 30_000m, 9_500m, vatCapitalized: false);
        var period = AccountingPeriod.Create(2026, 3, new DateTime(2026, 3, 1), new DateTime(2026, 3, 31));
        var existingLines = new List<JournalLineInput>
        {
            new("213", "Existing", 30_000m, 0, null, ThirdPartyKind.None),
            new("404", "Existing", 0, 30_000m, null, ThirdPartyKind.None)
        };
        var existing = JournalEntry.Create(
            1, AccountingService.FixedAssetJournalCode, new DateTime(2026, 3, 1), "Existing", period.Id, true,
            AccountingService.SourceFixedAssetAcquisition, asset.Id, existingLines).Value;

        var (service, captured) = BuildService(existingBySource: existing);

        var result = await service.GenerateFixedAssetAcquisitionEntryAsync(asset, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        captured.Should().BeEmpty();
    }

    [Fact]
    public async Task BrouillardEnabled_AutoEntryIsCreatedAsValidee()
    {
        var asset = CreateInServiceAsset("213", 30_000m, 9_500m, vatCapitalized: false);
        var (service, captured) = BuildService(brouillardEnabled: true);

        await service.GenerateFixedAssetAcquisitionEntryAsync(asset, CancellationToken.None);

        var entry = Assert.Single(captured);
        entry.Status.Should().Be(JournalEntryStatus.Validee);
        entry.IsAutoGenerated.Should().BeTrue();
        entry.ValidatedBy.Should().BeNull();
        entry.ValidatedAt.Should().BeNull();
    }
}
