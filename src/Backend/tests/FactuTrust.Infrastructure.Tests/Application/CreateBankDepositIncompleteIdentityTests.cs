using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.BankDeposits.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using MediatR;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class CreateBankDepositIncompleteIdentityTests
{
    [Fact]
    public async Task Incomplete_projection_is_refused()
    {
        var companyId = Guid.NewGuid();
        var bank = BankAccount.CreateFromChartProjection(companyId, "53211", "Banque Biat", "BIAT", "TND", true).Value;

        var banks = new Mock<IBankAccountRepository>();
        banks.Setup(b => b.GetByIdAndCompanyAsync(bank.Id, companyId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(bank);

        var companies = new Mock<IEnsureDefaultCompanyService>();
        companies.Setup(c => c.GetOrCreateDefaultCompanyIdAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(companyId));

        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.TenantId).Returns(Guid.NewGuid());

        var handler = new CreateBankDepositCommandHandler(
            new Mock<IBankDepositRepository>().Object,
            banks.Object,
            new Mock<ICashOperationRepository>().Object,
            new Mock<ICashOperationNumberGenerator>().Object,
            new Mock<IBankDepositNumberGenerator>().Object,
            companies.Object,
            user.Object,
            new Mock<IAuditService>().Object,
            new Mock<IPublisher>().Object);

        var result = await handler.Handle(new CreateBankDepositCommand(new CreateBankDepositRequest
        {
            DepositType = BankDepositType.Cash,
            DepositDate = new DateTime(2026, 10, 9),
            BankAccountId = bank.Id,
            Amount = 10m
        }), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.BankAccount", result.Error.Code);
        Assert.Contains("RIB", result.Error.Description, StringComparison.Ordinal);
    }
}
