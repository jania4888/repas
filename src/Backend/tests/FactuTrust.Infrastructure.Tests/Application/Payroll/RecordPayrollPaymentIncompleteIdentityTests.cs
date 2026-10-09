using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Payroll.Payments;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application.Payroll;

public sealed class RecordPayrollPaymentIncompleteIdentityTests
{
    [Fact]
    public async Task Incomplete_projection_is_refused_before_any_payment()
    {
        var run = PayrollRun.Create(2026, 8, 2026).Value;
        var bank = BankAccount.CreateFromChartProjection(Guid.NewGuid(), "53211", "Banque Biat", "BIAT", "TND", true).Value;

        var runs = new Mock<IPayrollRunRepository>();
        runs.Setup(r => r.GetByIdWithPayslipsForPaymentAsync(run.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(run);
        var banks = new Mock<IBankAccountRepository>();
        banks.Setup(b => b.GetByIdAsync(bank.Id, It.IsAny<CancellationToken>())).ReturnsAsync(bank);

        var handler = new RecordPayrollRunPaymentCommandHandler(
            runs.Object,
            new Mock<IPayrollPaymentRepository>().Object,
            banks.Object,
            new Mock<IAccountingService>().Object,
            new Mock<ILetteringService>().Object,
            new PassthroughUnitOfWork(),
            new Mock<ICurrentUser>().Object,
            Options.Create(new AccountingSettings { PayrollTreasuryLinkEnabled = true }),
            NullLogger<RecordPayrollRunPaymentCommandHandler>.Instance);

        var result = await handler.Handle(new RecordPayrollRunPaymentCommand(run.Id, new RecordPayrollRunPaymentRequest
        {
            PaymentDate = new DateTime(2026, 8, 31),
            Method = PaymentMethod.BankTransfer,
            BankAccountId = bank.Id
        }), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.BankAccount", result.Error.Code);
        Assert.Contains("RIB", result.Error.Description, StringComparison.Ordinal);
    }

    private sealed class PassthroughUnitOfWork : ITenantUnitOfWork
    {
        public Task<Result> ExecuteAsync(Func<CancellationToken, Task<Result>> action, CancellationToken cancellationToken = default)
            => action(cancellationToken);

        public Task<Result<T>> ExecuteAsync<T>(Func<CancellationToken, Task<Result<T>>> action, CancellationToken cancellationToken = default)
            => action(cancellationToken);
    }
}
