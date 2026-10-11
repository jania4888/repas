using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Authorization;

public sealed class UserRolePermissionsTests
{
    [Theory]
    [InlineData(UserRole.Administrator)]
    [InlineData(UserRole.Accountant)]
    [InlineData(UserRole.Supervisor)]
    public void CompanyRoles_DoNotInclude_AccountingValidate(UserRole role)
    {
        Assert.DoesNotContain(Permissions.Accounting.Validate, role.GetPermissions());
    }

    [Fact]
    public void FirmAccountantDelegated_StillIncludes_AccountingValidate()
    {
        Assert.Contains(Permissions.Accounting.Validate, DelegatedPermissionCatalog.FirmAccountantDelegated);
    }

    [Fact]
    public void FirmManagerDelegated_StillIncludes_AccountingValidate()
    {
        Assert.Contains(Permissions.Accounting.Validate, DelegatedPermissionCatalog.FirmManagerDelegated);
    }

    #region Lettering (plan de refonte §6, D6/D7)

    [Theory]
    [InlineData(UserRole.Administrator)]
    [InlineData(UserRole.Supervisor)]
    public void AdministratorAndSupervisor_Include_AccountingUnletter(UserRole role)
    {
        Assert.Contains(Permissions.Accounting.Unletter, role.GetPermissions());
    }

    [Theory]
    [InlineData(UserRole.Accountant)]
    [InlineData(UserRole.Auditor)]
    [InlineData(UserRole.SalesRep)]
    [InlineData(UserRole.SalesManager)]
    [InlineData(UserRole.Client)]
    [InlineData(UserRole.Cashier)]
    [InlineData(UserRole.Warehouse)]
    [InlineData(UserRole.Purchaser)]
    [InlineData(UserRole.Developer)]
    public void CompanyAccountantAndOtherRoles_DoNotInclude_AccountingUnletter(UserRole role)
    {
        // D6 : le comptable entreprise ne peut plus délettrer ; il garde `accounting:create`
        // (lettrage et complétion restent permis). Les autres rôles n'ont jamais eu ce droit.
        Assert.DoesNotContain(Permissions.Accounting.Unletter, role.GetPermissions());
    }

    [Fact]
    public void Accountant_StillIncludes_AccountingCreate()
    {
        // D7 : le comptable entreprise peut toujours compléter un lettrage partiel (action
        // couverte par `accounting:create`), seul le délettrage lui est retiré.
        Assert.Contains(Permissions.Accounting.Create, UserRole.Accountant.GetPermissions());
    }

    [Fact]
    public void FirmAccountantDelegated_Includes_AccountingUnletter()
    {
        Assert.Contains(Permissions.Accounting.Unletter, DelegatedPermissionCatalog.FirmAccountantDelegated);
    }

    [Fact]
    public void FirmManagerDelegated_Includes_AccountingUnletter()
    {
        Assert.Contains(Permissions.Accounting.Unletter, DelegatedPermissionCatalog.FirmManagerDelegated);
    }

    #endregion

    #region SalesOrders permissions

    [Theory]
    [InlineData(UserRole.Administrator)]
    [InlineData(UserRole.Supervisor)]
    [InlineData(UserRole.SalesManager)]
    [InlineData(UserRole.SalesRep)]
    [InlineData(UserRole.Accountant)]
    public void SalesRoles_CanCreateReadUpdateSalesOrders(UserRole role)
    {
        Assert.Contains(Permissions.SalesOrders.Create, role.GetPermissions());
        Assert.Contains(Permissions.SalesOrders.Read, role.GetPermissions());
        Assert.Contains(Permissions.SalesOrders.Update, role.GetPermissions());
    }

    [Theory]
    [InlineData(UserRole.Administrator)]
    [InlineData(UserRole.Supervisor)]
    [InlineData(UserRole.SalesManager)]
    public void SalesManagers_CanDeleteSalesOrders(UserRole role)
    {
        Assert.Contains(Permissions.SalesOrders.Delete, role.GetPermissions());
    }

    [Theory]
    [InlineData(UserRole.SalesRep)]
    [InlineData(UserRole.Accountant)]
    [InlineData(UserRole.Auditor)]
    [InlineData(UserRole.Client)]
    [InlineData(UserRole.Cashier)]
    [InlineData(UserRole.Warehouse)]
    [InlineData(UserRole.Purchaser)]
    [InlineData(UserRole.Developer)]
    public void NonManagerRoles_CannotDeleteSalesOrders(UserRole role)
    {
        Assert.DoesNotContain(Permissions.SalesOrders.Delete, role.GetPermissions());
    }

    [Fact]
    public void Auditor_CanReadSalesOrdersOnly()
    {
        Assert.Contains(Permissions.SalesOrders.Read, UserRole.Auditor.GetPermissions());
        Assert.DoesNotContain(Permissions.SalesOrders.Create, UserRole.Auditor.GetPermissions());
        Assert.DoesNotContain(Permissions.SalesOrders.Update, UserRole.Auditor.GetPermissions());
        Assert.DoesNotContain(Permissions.SalesOrders.Delete, UserRole.Auditor.GetPermissions());
    }

    [Theory]
    [InlineData(UserRole.Client)]
    [InlineData(UserRole.Cashier)]
    [InlineData(UserRole.Warehouse)]
    [InlineData(UserRole.Purchaser)]
    [InlineData(UserRole.Developer)]
    public void NonSalesRoles_CannotAccessSalesOrders(UserRole role)
    {
        Assert.DoesNotContain(Permissions.SalesOrders.Create, role.GetPermissions());
        Assert.DoesNotContain(Permissions.SalesOrders.Read, role.GetPermissions());
        Assert.DoesNotContain(Permissions.SalesOrders.Update, role.GetPermissions());
        Assert.DoesNotContain(Permissions.SalesOrders.Delete, role.GetPermissions());
    }

    #endregion

    [Fact]
    public void FirmAccountant_DoesNotInclude_NativeHonorairesPermissions()
    {
        var permissions = UserRole.FirmAccountant.GetPermissions();

        Assert.DoesNotContain(Permissions.HonorairesInvoices.Read, permissions);
        Assert.DoesNotContain(Permissions.HonorairesInvoices.Create, permissions);
        Assert.DoesNotContain(Permissions.HonorairesQuotes.Read, permissions);
        Assert.DoesNotContain(Permissions.HonorairesPayments.Read, permissions);
    }

    [Fact]
    public void FirmManager_Includes_NativeHonorairesPermissions()
    {
        var permissions = UserRole.FirmManager.GetPermissions();

        Assert.Contains(Permissions.HonorairesInvoices.Read, permissions);
        Assert.Contains(Permissions.HonorairesInvoices.Create, permissions);
        Assert.Contains(Permissions.HonorairesPayments.Read, permissions);
    }

    [Theory]
    [InlineData(UserRole.Administrator)]
    [InlineData(UserRole.Accountant)]
    [InlineData(UserRole.Supervisor)]
    public void CompanyManagers_CanManageProjects(UserRole role)
    {
        var permissions = role.GetPermissions();
        Assert.Contains(Permissions.Projects.Read, permissions);
        Assert.Contains(Permissions.Projects.Create, permissions);
        Assert.Contains(Permissions.ProjectTime.Validate, permissions);
        Assert.Contains(Permissions.ProjectBilling.Create, permissions);
    }

    [Fact]
    public void Auditor_CanReadProjectsOnly()
    {
        var permissions = UserRole.Auditor.GetPermissions();
        Assert.Contains(Permissions.Projects.Read, permissions);
        Assert.DoesNotContain(Permissions.Projects.Create, permissions);
        Assert.DoesNotContain(Permissions.ProjectBilling.Create, permissions);
    }

    [Fact]
    public void AppModuleProjects_ExposesPermissionKeys()
    {
        Assert.Contains(Permissions.Projects.Read, AppModule.Projects.GetPermissionKeys());
        Assert.Equal(16, (int)AppModule.Projects);
        Assert.Equal(15, (int)AppModule.Honoraires);
    }

    [Fact]
    public void FirmAccountant_DoesNotInclude_ProjectsPermissions()
    {
        var permissions = UserRole.FirmAccountant.GetPermissions();
        Assert.DoesNotContain(Permissions.Projects.Read, permissions);
        Assert.DoesNotContain(Permissions.ProjectTime.Read, permissions);
        Assert.DoesNotContain(Permissions.ProjectBilling.Create, permissions);
    }

    [Fact]
    public void FirmDelegatedCatalogs_DoNotInclude_Projects()
    {
        Assert.DoesNotContain(Permissions.Projects.Read, DelegatedPermissionCatalog.FirmAccountantDelegated);
        Assert.DoesNotContain(Permissions.Projects.Read, DelegatedPermissionCatalog.FirmManagerDelegated);
        Assert.DoesNotContain(Permissions.ProjectTime.Validate, DelegatedPermissionCatalog.FirmAccountantDelegated);
    }

    [Fact]
    public void Client_has_portal_access_without_staff_invoice_read()
    {
        var permissions = UserRole.Client.GetPermissions();
        Assert.Contains(Permissions.Portal.Access, permissions);
        Assert.Contains(Permissions.Portal.InvoicesRead, permissions);
        Assert.DoesNotContain(Permissions.Invoices.Read, permissions);
        Assert.DoesNotContain(Permissions.Payments.Read, permissions);
    }

    [Fact]
    public void Accountant_still_has_staff_invoice_read()
    {
        Assert.Contains(Permissions.Invoices.Read, UserRole.Accountant.GetPermissions());
    }
}
