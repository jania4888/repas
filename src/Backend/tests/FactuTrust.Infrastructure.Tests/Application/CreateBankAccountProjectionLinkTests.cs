using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.BankAccounts.Commands;
using FactuTrust.Domain.Banking;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class CreateBankAccountProjectionLinkTests
{
    private const string Rib = "08001000123456789012";
    private static string Iban => TunisianIban.FromRib(Rib)!;

    [Fact]
    public async Task Linking_existing_53211_enriches_the_projection_instead_of_inserting()
    {
        var companyId = Guid.NewGuid();
        var projection = BankAccount.CreateFromChartProjection(companyId, "53211", "Banque Biat", "BIAT", "TND", true).Value;

        var banks = new Mock<IBankAccountRepository>();
        banks.Setup(b => b.GetByCompanyAndChartNumberAsync(companyId, "53211", It.IsAny<CancellationToken>()))
            .ReturnsAsync(projection);
        banks.Setup(b => b.UpdateAsync(It.IsAny<BankAccount>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = Handler(companyId, banks);
        var result = await handler.Handle(new CreateBankAccountCommand(Request(chart: "53211", autoCreate: false)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.LinkedExistingChartProjection);
        Assert.Equal(projection.Id, result.Value.Id);
        Assert.Equal("53211", result.Value.ChartOfAccountNumber);
        Assert.Equal(Iban, result.Value.Iban);
        banks.Verify(b => b.AddAsync(It.IsAny<BankAccount>(), It.IsAny<CancellationToken>()), Times.Never);
        banks.Verify(b => b.UpdateAsync(projection, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AutoCreate_allocates_a_new_auxiliary_and_leaves_53211_untouched()
    {
        var companyId = Guid.NewGuid();
        var projection = BankAccount.CreateFromChartProjection(companyId, "53211", "Banque Biat", "BIAT", "TND", true).Value;
        BankAccount? inserted = null;

        var banks = new Mock<IBankAccountRepository>();
        banks.Setup(b => b.CountActiveByCompanyAsync(companyId, It.IsAny<CancellationToken>())).ReturnsAsync(1);
        banks.Setup(b => b.ExistsIbanForCompanyAsync(companyId, Iban, null, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        banks.Setup(b => b.AddAsync(It.IsAny<BankAccount>(), It.IsAny<CancellationToken>()))
            .Callback<BankAccount, CancellationToken>((account, _) => inserted = account)
            .ReturnsAsync((BankAccount account, CancellationToken _) => account);

        var charts = new Mock<IBankAccountChartProvisioningService>();
        charts.Setup(c => c.ResolveChartAccountNumberAsync(
                It.IsAny<BankAccount>(), null, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<string?>("53210001"));

        var handler = Handler(companyId, banks, charts);
        var result = await handler.Handle(new CreateBankAccountCommand(Request(chart: null, autoCreate: true)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.LinkedExistingChartProjection);
        Assert.Equal("53210001", result.Value.ChartOfAccountNumber);
        Assert.NotEqual(projection.Id, result.Value.Id);
        Assert.NotNull(inserted);
        Assert.Equal("53210001", inserted!.ChartOfAccountNumber);
        banks.Verify(b => b.GetByCompanyAndChartNumberAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        banks.Verify(b => b.UpdateAsync(It.IsAny<BankAccount>(), It.IsAny<CancellationToken>()), Times.Never);
        Assert.False(projection.HasBankingIdentity);
    }

    private static CreateBankAccountCommandHandler Handler(
        Guid companyId,
        Mock<IBankAccountRepository> banks,
        Mock<IBankAccountChartProvisioningService>? charts = null)
    {
        var companies = new Mock<IEnsureDefaultCompanyService>();
        companies.Setup(c => c.GetOrCreateDefaultCompanyIdAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(companyId));
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.TenantId).Returns(Guid.NewGuid());
        var audit = new Mock<IAuditService>();
        audit.Setup(a => a.LogAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<Guid?>(),
                It.IsAny<object?>(),
                It.IsAny<object?>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        return new CreateBankAccountCommandHandler(
            banks.Object,
            companies.Object,
            (charts ?? new Mock<IBankAccountChartProvisioningService>()).Object,
            user.Object,
            audit.Object);
    }

    private static CreateBankAccountRequest Request(string? chart, bool autoCreate) => new()
    {
        BankCode = "BIAT",
        BankName = "Banque Biat",
        Rib = Rib,
        Iban = Iban,
        ChartOfAccountNumber = chart,
        AutoCreateChartAccount = autoCreate,
        Currency = "TND"
    };
}
