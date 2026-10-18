using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class UpdateAccountLabelCommandHandlerTests
{
    private static (
        UpdateAccountLabelCommandHandler Handler,
        Mock<IChartOfAccountRepository> Repo,
        Mock<IAuditService> Audit,
        Mock<IBankGlTreasuryProjectionService> Projection) Build(
            ChartOfAccount? account, ChartOfAccount? auxiliaryAccountByFiscalId = null)
    {
        var repo = new Mock<IChartOfAccountRepository>();
        repo.Setup(r => r.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(account);
        repo.Setup(r => r.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        repo.Setup(r => r.FindAuxiliaryByFiscalIdAsync(
                It.IsAny<AccountType>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(auxiliaryAccountByFiscalId);

        var audit = new Mock<IAuditService>();
        audit.Setup(a => a.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var projection = new Mock<IBankGlTreasuryProjectionService>();
        projection.Setup(p => p.SyncLabelAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        return (
            new UpdateAccountLabelCommandHandler(repo.Object, audit.Object, projection.Object),
            repo,
            audit,
            projection);
    }

    private static ChartOfAccount AuxiliaryClientAccount(string number = "41105", string? fiscalId = null) =>
        ChartOfAccount.Create(
            number, "Ste Slimen", 4, null, AccountNatureType.Debit,
            accountType: AccountType.Client, isAuxiliary: true, fiscalId: fiscalId).Value;

    [Fact]
    public async Task Handle_NoActualChange_ShortCircuitsWithoutUpdateOrAudit()
    {
        var account = AuxiliaryClientAccount();
        var (handler, repo, audit, _) = Build(account);

        var result = await handler.Handle(
            new UpdateAccountLabelCommand(account.Id, account.Label), CancellationToken.None);

        Assert.True(result.IsSuccess);
        repo.Verify(r => r.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Never);
        audit.Verify(a => a.LogAsync(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_LabelOnlyChange_UpdatesAndLogsOnlyTheLabelAudit()
    {
        var account = AuxiliaryClientAccount();
        var (handler, repo, audit, projection) = Build(account);

        var result = await handler.Handle(
            new UpdateAccountLabelCommand(account.Id, "Nouveau libellé"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        repo.Verify(r => r.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Once);
        projection.Verify(p => p.SyncLabelAsync(
            account.AccountNumber, "Ste Slimen", "Nouveau libellé", It.IsAny<CancellationToken>()), Times.Once);
        audit.Verify(a => a.LogAsync(
            AuditActions.Accounting.AccountLabelUpdated,
            "ChartOfAccount", account.Id, It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()),
            Times.Once);
        audit.Verify(a => a.LogAsync(
            AuditActions.Accounting.AccountFiscalIdUpdated,
            "ChartOfAccount", account.Id, It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Handle_FiscalIdOnlyChange_UpdatesAndLogsOnlyTheFiscalIdAudit()
    {
        var account = AuxiliaryClientAccount();
        var (handler, repo, audit, projection) = Build(account);

        var result = await handler.Handle(
            new UpdateAccountLabelCommand(account.Id, account.Label, UpdateFiscalId: true, FiscalId: "1525071P/B/M/000"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("1525071P/B/M/000", account.FiscalId);
        repo.Verify(r => r.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Once);
        projection.Verify(p => p.SyncLabelAsync(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        audit.Verify(a => a.LogAsync(
            AuditActions.Accounting.AccountFiscalIdUpdated,
            "ChartOfAccount", account.Id, It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()),
            Times.Once);
        audit.Verify(a => a.LogAsync(
            AuditActions.Accounting.AccountLabelUpdated,
            "ChartOfAccount", account.Id, It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Handle_BothLabelAndFiscalIdChange_LogsBothAudits()
    {
        var account = AuxiliaryClientAccount();
        var (handler, repo, audit, _) = Build(account);

        var result = await handler.Handle(
            new UpdateAccountLabelCommand(account.Id, "Nouveau libellé", UpdateFiscalId: true, FiscalId: "1525071P/B/M/000"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        audit.Verify(a => a.LogAsync(
            AuditActions.Accounting.AccountLabelUpdated,
            "ChartOfAccount", account.Id, It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()),
            Times.Once);
        audit.Verify(a => a.LogAsync(
            AuditActions.Accounting.AccountFiscalIdUpdated,
            "ChartOfAccount", account.Id, It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task Handle_ClearingTheFiscalId_UpdatesAndLogsTheFiscalIdAudit()
    {
        var account = AuxiliaryClientAccount(fiscalId: "1525071P/B/M/000");
        var (handler, repo, audit, _) = Build(account);

        var result = await handler.Handle(
            new UpdateAccountLabelCommand(account.Id, account.Label, UpdateFiscalId: true, FiscalId: null),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Null(account.FiscalId);
        repo.Verify(r => r.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Once);
        audit.Verify(a => a.LogAsync(
            AuditActions.Accounting.AccountFiscalIdUpdated,
            "ChartOfAccount", account.Id, It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task Handle_FiscalIdAlreadyUsedByAnotherAccount_FailsWithoutUpdate()
    {
        var account = AuxiliaryClientAccount();
        var other = AuxiliaryClientAccount("41110", fiscalId: "1525071P/B/M/000");
        var (handler, repo, _, _) = Build(account, auxiliaryAccountByFiscalId: other);

        var result = await handler.Handle(
            new UpdateAccountLabelCommand(account.Id, account.Label, UpdateFiscalId: true, FiscalId: "1525071P/B/M/000"),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("ChartAccount.FiscalIdDuplicate", result.Error.Code);
        Assert.Contains("41110", result.Error.Description, StringComparison.Ordinal);
        repo.Verify(r => r.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_FiscalIdDuplicateCheck_ExcludesTheAccountItself()
    {
        // Le compte porte déjà ce MF (aucun changement de valeur normalisée attendu) : le re-poser
        // ne doit jamais se heurter à sa propre ligne dans la recherche de doublon.
        var account = AuxiliaryClientAccount(fiscalId: "1525071P/B/M/000");
        var (handler, repo, _, _) = Build(account, auxiliaryAccountByFiscalId: account);

        var result = await handler.Handle(
            new UpdateAccountLabelCommand(account.Id, account.Label, UpdateFiscalId: true, FiscalId: "1525071P/B/M/000"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Valeur canonique inchangée : short-circuit, aucune écriture.
        repo.Verify(r => r.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_AccountNotFound_FailsWithNotFound()
    {
        var (handler, _, _, _) = Build(account: null);

        var result = await handler.Handle(
            new UpdateAccountLabelCommand(Guid.NewGuid(), "x"), CancellationToken.None);

        Assert.True(result.IsFailure);
    }
}
