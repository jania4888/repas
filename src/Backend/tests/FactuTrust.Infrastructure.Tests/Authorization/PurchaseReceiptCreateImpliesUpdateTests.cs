using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Authorization;

/// <summary>
/// L'import de document de bon de réception réutilise <c>PurchaseReceipts.Update</c> pour la
/// pièce jointe auto-attachée après création (voir le plan, section 9). Un rôle qui peut créer
/// un bon de réception depuis un document doit donc toujours pouvoir y attacher le fichier
/// source, sous peine d'un échec silencieux de l'auto-attachement.
/// </summary>
public sealed class PurchaseReceiptCreateImpliesUpdateTests
{
    public static IEnumerable<object[]> AllRoles() =>
        Enum.GetValues<UserRole>().Select(role => new object[] { role });

    [Theory]
    [MemberData(nameof(AllRoles))]
    public void Role_with_purchase_receipts_create_also_has_purchase_receipts_update(UserRole role)
    {
        var permissions = role.GetPermissions();

        if (permissions.Contains(Permissions.PurchaseReceipts.Create))
            Assert.Contains(Permissions.PurchaseReceipts.Update, permissions);
    }
}
