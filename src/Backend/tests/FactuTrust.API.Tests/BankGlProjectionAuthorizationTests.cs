using System.Reflection;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using Microsoft.AspNetCore.Authorization;
using Xunit;

namespace FactuTrust.API.Tests;

public sealed class BankGlProjectionAuthorizationTests
{
    private static MethodInfo Action(string name) =>
        typeof(AccountingController).GetMethod(name, BindingFlags.Public | BindingFlags.Instance)!;

    [Fact]
    public void Ensure_requires_accounting_create()
    {
        Assert.Contains(
            Action(nameof(AccountingController.EnsureBankGlProjections)).GetCustomAttributes<AuthorizeAttribute>(),
            a => a.Policy == PermissionPolicies.AccountingCreate);
    }

    [Fact]
    public void Importable_list_requires_accounting_read_not_payments()
    {
        var policies = Action(nameof(AccountingController.GetImportableBankAccounts))
            .GetCustomAttributes<AuthorizeAttribute>()
            .Select(a => a.Policy)
            .ToList();
        Assert.Contains(PermissionPolicies.AccountingRead, policies);
        Assert.DoesNotContain(PermissionPolicies.PaymentsRead, policies);
    }

    [Fact]
    public void Tunisian_banks_catalog_requires_accounting_read()
    {
        Assert.Contains(
            Action(nameof(AccountingController.GetTunisianBanks)).GetCustomAttributes<AuthorizeAttribute>(),
            a => a.Policy == PermissionPolicies.AccountingRead);
    }

    // ── Matricule fiscal (plan « Matricule fiscal sur les comptes auxiliaires ») ──
    // La saisie du MF passe par les mêmes actions que la création/modification de compte : pas de
    // nouvelle route, donc pas de nouvelle policy à verrouiller, mais une régression qui
    // relâcherait ces deux actions exposerait aussi la pose d'un matricule fiscal sans droit.

    [Fact]
    public void Chart_of_accounts_list_requires_accounting_read()
    {
        Assert.Contains(
            Action(nameof(AccountingController.GetChartOfAccounts)).GetCustomAttributes<AuthorizeAttribute>(),
            a => a.Policy == PermissionPolicies.AccountingRead);
    }

    [Fact]
    public void Create_sub_account_requires_accounting_create()
    {
        Assert.Contains(
            Action(nameof(AccountingController.CreateSubAccount)).GetCustomAttributes<AuthorizeAttribute>(),
            a => a.Policy == PermissionPolicies.AccountingCreate);
    }

    [Fact]
    public void Update_account_label_requires_accounting_create()
    {
        Assert.Contains(
            Action(nameof(AccountingController.UpdateAccountLabel)).GetCustomAttributes<AuthorizeAttribute>(),
            a => a.Policy == PermissionPolicies.AccountingCreate);
    }
}
