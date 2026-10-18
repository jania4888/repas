using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Application.Features.Accounting.Commands;

/// <summary>
/// Détecte les violations de la contrainte d'unicité filtrée
/// <c>IX_ChartOfAccounts_AccountType_FiscalIdNormalized</c> survenues entre la vérification applicative
/// (<c>FindAuxiliaryByFiscalIdAsync</c>) et l'écriture — deux créations/éditions concurrentes sur le même
/// matricule fiscal. Modèle : <c>AccountingFirmRegistrationService.IsNifUniqueViolation</c>.
/// </summary>
public static class ChartOfAccountUniqueViolations
{
    private const string IndexName = "IX_ChartOfAccounts_AccountType_FiscalIdNormalized";

    public static bool IsFiscalIdUniqueViolation(DbUpdateException ex)
    {
        if (ex.InnerException is not Microsoft.Data.SqlClient.SqlException sqlEx)
            return false;

        return sqlEx.Number is 2601 or 2627 && sqlEx.Message.Contains(IndexName, StringComparison.OrdinalIgnoreCase);
    }
}
