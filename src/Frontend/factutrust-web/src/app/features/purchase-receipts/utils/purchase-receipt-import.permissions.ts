import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

/**
 * True si l'utilisateur peut importer un bon de réception depuis un document
 * (PDF / image). Même garde que pour la création manuelle, plus le droit
 * d'usage de l'assistant IA requis par l'endpoint d'import
 * (voir purchase-receipt-document-import, policy AiChat).
 */
export function canImportPurchaseReceipt(auth: AuthService): boolean {
  return !auth.isFirmDelegatedReadonly()
    && auth.hasPermission(PERMISSIONS.purchaseReceipts.create)
    && auth.hasAllPermissions(['ai:chat']);
}
