using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Services.Payroll.BankTransfer;
using MediatR;

namespace FactuTrust.Application.Features.Payroll.BankTransfer;

/// <summary>
/// Orchestration partagée preview/export : charge cycle, salariés, société, compte débiteur.
/// </summary>
internal static class PayrollBankTransferOrchestrator
{
    public static async Task<Result<(PayrollBankTransferBatch Batch, Guid? DebtorAccountId)>> BuildBatchAsync(
        Guid runId,
        Guid? bankAccountId,
        string? transferLabel,
        IPayrollRunRepository runs,
        IEmployeeRepository employees,
        ICompanyRepository companies,
        IBankAccountRepository bankAccounts,
        IEmployeeGarnishmentRepository? garnishments = null,
        CancellationToken cancellationToken = default)    {
        var run = await runs.GetByIdWithPayslipsAsync(runId, cancellationToken);
        if (run is null)
            return Result.Failure<(PayrollBankTransferBatch, Guid?)>(Error.NotFound("PayrollRun", runId));

        if (!PayrollBankTransferBuilder.CanExport(run.Status))
        {
            return Result.Failure<(PayrollBankTransferBatch, Guid?)>(Error.Validation(
                "Status",
                "L'export virement n'est disponible qu'après validation de la paie."));
        }

        var payslips = run.Payslips.ToList();
        var employeeIds = payslips.Select(p => p.EmployeeId).Distinct().ToList();
        var employeesById = await employees.GetByIdsAsync(employeeIds, cancellationToken);

        var company = await companies.GetDefaultAsync(cancellationToken);
        BankTransferCompanyInfo? companyInfo = company is null
            ? null
            : new BankTransferCompanyInfo(company.Name);

        var (debtorInfo, debtorId) = await ResolveDebtorAsync(
            company, bankAccountId, bankAccounts, cancellationToken);

        var label = string.IsNullOrWhiteSpace(transferLabel) ? run.Label : transferLabel.Trim();
        var options = new BankTransferExportOptions
        {
            TransferLabel = label,
            Format = PayrollBankTransferFormat.StandardCsv,
            ExportDateUtc = DateTime.UtcNow
        };

        var garnishmentTransferLines = new List<GarnishmentTransferLineInput>();
        if (garnishments is not null)
        {
            var garnishmentEntities = await garnishments.ListWithInstallmentsForRunAsync(runId, cancellationToken);
            var payslipByEmployee = payslips.ToDictionary(p => p.EmployeeId);
            foreach (var garnishment in garnishmentEntities)
            {
                foreach (var installment in garnishment.Installments.Where(i => i.PayrollRunId == runId && i.AppliedAmount > 0))
                {
                    if (!payslipByEmployee.TryGetValue(garnishment.EmployeeId, out var payslip))
                        continue;

                    var employee = employeesById.GetValueOrDefault(garnishment.EmployeeId);
                    garnishmentTransferLines.Add(new GarnishmentTransferLineInput(
                        garnishment.Id,
                        garnishment.EmployeeId,
                        payslip.Id,
                        employee?.EmployeeNumber ?? payslip.EmployeeNumber,
                        garnishment.BeneficiaryName,
                        garnishment.BeneficiaryRib,
                        garnishment.Reference,
                        installment.AppliedAmount));
                }
            }
        }

        var batch = PayrollBankTransferBuilder.Build(
            run,
            payslips,
            employeesById,
            options,
            companyInfo,
            debtorInfo,
            garnishmentTransferLines);
        return Result.Success((batch, debtorId));
    }

    private static async Task<(BankTransferDebtorAccountInfo? Info, Guid? Id)> ResolveDebtorAsync(
        Company? company,
        Guid? bankAccountId,
        IBankAccountRepository bankAccounts,
        CancellationToken cancellationToken)
    {
        if (company is null)
            return (null, null);

        BankAccount? account = null;
        if (bankAccountId.HasValue)
        {
            account = await bankAccounts.GetByIdAndCompanyAsync(
                bankAccountId.Value, company.Id, cancellationToken);
            // Compte explicite invalide/inactif : on laisse le builder signaler NoDebtorAccount
            // plutôt que de basculer silencieusement sur le défaut (évite un mauvais débit).
            if (account is null || !account.IsActive)
                return (null, null);
        }
        else
        {
            account = await bankAccounts.GetDefaultAsync(company.Id, cancellationToken);
        }

        if (account is null || !account.HasBankingIdentity || account.Rib is null || account.Iban is null)
            return (null, null);

        return (
            new BankTransferDebtorAccountInfo(
                account.Rib,
                account.Iban,
                account.BankName,
                account.BankCode),
            account.Id);
    }
}
