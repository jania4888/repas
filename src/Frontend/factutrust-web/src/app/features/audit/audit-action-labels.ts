import { erpCollatorCompare } from '@core/i18n/erp-format';

/** Libellés FR pour les actions d'audit (alignés sur AuditActions côté API). */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  'Auth.Login': 'Connexion',
  'Auth.LoginFailed': 'Échec de connexion',
  'Auth.Logout': 'Déconnexion',
  'Auth.PasswordChange': 'Changement de mot de passe',
  'Auth.TwoFactorEnabled': '2FA activée',
  'Auth.TwoFactorDisabled': '2FA désactivée',
  'Invoice.Created': 'Facture créée',
  'Invoice.Updated': 'Facture modifiée',
  'Invoice.Validated': 'Facture validée',
  'Invoice.Signed': 'Facture signée',
  'Invoice.Sent': 'Facture envoyée',
  'Invoice.Paid': 'Facture payée',
  'Invoice.Cancelled': 'Facture annulée',
  'Invoice.Archived': 'Facture archivée',
  'Invoice.Exported': 'Facture exportée',
  'Invoice.Viewed': 'Facture consultée',
  'Client.Created': 'Client créé',
  'Client.Updated': 'Client modifié',
  'Client.Deleted': 'Client supprimé',
  'Product.Created': 'Produit créé',
  'Product.Updated': 'Produit modifié',
  'Product.Deleted': 'Produit supprimé',
  'User.Created': 'Utilisateur créé',
  'User.Updated': 'Utilisateur modifié',
  'User.Deleted': 'Utilisateur supprimé',
  'User.RoleChanged': 'Rôle modifié',
  'Subscription.Upgraded': 'Abonnement surclassé',
  'Subscription.Downgraded': 'Abonnement rétrogradé',
  'Subscription.Cancelled': 'Abonnement résilié',
  'Subscription.Renewed': 'Abonnement renouvelé',
  'Settings.Updated': 'Paramètres modifiés',
  'Quote.Created': 'Devis créé',
  'Quote.Updated': 'Devis modifié',
  'Quote.Sent': 'Devis envoyé',
  'Quote.Accepted': 'Devis accepté',
  'Quote.Rejected': 'Devis refusé',
  'Quote.Cancelled': 'Devis annulé',
  'Quote.Converted': 'Devis converti',
  'Quote.Viewed': 'Devis consulté',
  'Export.Pdf': 'Export PDF',
  'Export.Xml': 'Export XML',
  'Export.Data': 'Export données',
  'DeliveryNote.Created': 'Bon de livraison créé',
  'DeliveryNote.Updated': 'Bon de livraison modifié',
  'DeliveryNote.Confirmed': 'Bon de livraison confirmé',
  'DeliveryNote.InTransit': 'En transit',
  'DeliveryNote.Delivered': 'Livré',
  'DeliveryNote.Failed': 'Échec livraison',
  'DeliveryNote.Invoiced': 'Facturé',
  'DeliveryNote.Cancelled': 'Bon annulé',
  'DeliveryNote.Viewed': 'Bon consulté',
  'DeliveryNote.Exported': 'Bon exporté',
  'DeliveryNote.ModificationAttempted': 'Tentative de modification',
  'SalesReturnNote.Created': 'Bon de retour créé',
  'SalesReturnNote.Updated': 'Bon de retour modifié',
  'SalesReturnNote.Confirmed': 'Bon de retour confirmé',
  'SalesReturnNote.Deleted': 'Bon de retour supprimé',
  'SalesReturnNote.Exported': 'Bon de retour exporté',
  'Supplier.Created': 'Fournisseur créé',
  'Supplier.Updated': 'Fournisseur modifié',
  'Supplier.Deleted': 'Fournisseur supprimé',
  'PurchaseOrder.Created': 'Bon de commande créé',
  'PurchaseOrder.Updated': 'Bon de commande modifié',
  'PurchaseOrder.Confirmed': 'Bon de commande confirmé',
  'PurchaseOrder.GoodsReceived': 'Réception marchandises',
  'PurchaseOrder.Cancelled': 'Bon de commande annulé',
  'PurchaseOrder.Deleted': 'Bon de commande supprimé',
  'PurchaseOrder.Exported': 'Bon de commande exporté',
  'PurchaseOrder.Sent': 'Bon de commande envoyé',
  'SupplierInvoice.Created': 'Facture fournisseur créée',
  'SupplierInvoice.Paid': 'Facture fournisseur payée',
  'SupplierInvoice.Cancelled': 'Facture fournisseur annulée',
  'CashExpense.Created': 'Dépense caisse créée',
  'CashExpense.Cancelled': 'Dépense caisse annulée',
  'CashOperation.Created': 'Opération caisse créée',
  'CashOperation.Cancelled': 'Opération caisse annulée',
  'CashRegisterSession.Opened': 'Session de caisse ouverte',
  'CashRegisterSession.Closed': 'Session de caisse clôturée',
  'BankAccount.Created': 'Compte bancaire créé',
  'BankAccount.Updated': 'Compte bancaire modifié',
  'BankAccount.Deleted': 'Compte bancaire supprimé',
  'BankAccount.DefaultChanged': 'Compte par défaut modifié',
  'BankDeposit.Created': 'Remise bancaire créée',
  'BankDeposit.Cancelled': 'Remise bancaire annulée',
  'WithholdingCertificate.Created': 'Attestation à la source créée',
  'WithholdingCertificate.Updated': 'Attestation à la source modifiée',
  'WithholdingCertificate.Validated': 'Attestation à la source validée',
  'WithholdingCertificate.Cancelled': 'Attestation à la source annulée',
  'WithholdingCertificate.Deleted': 'Attestation à la source supprimée',
  'WithholdingCertificate.Exported': 'Attestation exportée',
  'WithholdingCertificate.PdfGenerated': 'PDF attestation généré',
  'WithholdingCertificate.TejSubmitted': 'Attestation soumise TEJ',
  'TejExport.XmlGenerated': 'Export TEJ XML généré',
  'TejExport.XmlPreviewed': 'Aperçu TEJ XML',
  'TejExport.ValidationFailed': 'Validation TEJ échouée',
  'Accounting.ManualEntryCreated': 'Écriture manuelle créée',
  'Accounting.PeriodClosed': 'Période clôturée',
  'Accounting.PeriodReopened': 'Période rouverte',
  'Accounting.FiscalYearClosed': 'Exercice clôturé',
  'Accounting.VatDeclarationSaved': 'Déclaration TVA enregistrée',
  'Accounting.VatDeclarationSubmitted': 'Déclaration TVA transmise',
  'Accounting.Lettered': 'Lettrage',
  'Accounting.SubAccountCreated': 'Sous-compte créé',
  'Accounting.AccountLabelUpdated': 'Libellé de compte modifié',
  'Accounting.AccountToggled': 'Compte activé/désactivé',
  'Accounting.FecExported': 'Export FEC',
  'StockVoucher.Created': 'Bon de stock créé',
  'StockVoucher.Updated': 'Bon de stock modifié',
  'StockVoucher.Validated': 'Bon de stock validé',
  'StockVoucher.Cancelled': 'Bon de stock annulé',
  'StockVoucher.Deleted': 'Bon de stock supprimé',
  'StockVoucher.Exported': 'Bon de stock exporté'
};

const ENTITY_LABELS: Readonly<Record<string, string>> = {
  Invoice: 'Facture',
  Client: 'Client',
  Product: 'Produit',
  User: 'Utilisateur',
  Quote: 'Devis',
  DeliveryNote: 'Bon de livraison',
  SalesReturnNote: 'Bon de retour',
  Supplier: 'Fournisseur',
  PurchaseOrder: 'Bon de commande',
  SupplierInvoice: 'Facture fournisseur',
  CashExpense: 'Dépense caisse',
  CashOperation: 'Opération caisse',
  BankAccount: 'Compte bancaire',
  BankDeposit: 'Remise bancaire',
  WithholdingCertificate: 'Attestation à la source',
  TejExport: 'Export TEJ',
  Accounting: 'Comptabilité',
  StockVoucher: 'Bon d’entrée / sortie',
  Settings: 'Paramètres',
  Subscription: 'Abonnement',
  Export: 'Export',
  Auth: 'Authentification'
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function auditEntityTypeLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

export function auditActionSeverity(
  action: string
): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined {
  if (action.includes('Paid') || action.includes('Accepted') || action.includes('Delivered') || action.includes('Validated')) {
    return 'success';
  }
  if (action.includes('Failed') || action.includes('Cancelled') || action.includes('Deleted') || action.includes('LoginFailed')) {
    return 'danger';
  }
  if (action.includes('Created') || action.includes('Sent') || action.includes('Signed')) {
    return 'info';
  }
  if (action.includes('Updated') || action.includes('Exported')) {
    return 'secondary';
  }
  return undefined;
}

export interface AuditSelectOption {
  label: string;
  value: string;
}

/** Options pour filtres (valeur = code technique API). */
export function auditEntityTypeSelectOptions(): AuditSelectOption[] {
  return Object.entries(ENTITY_LABELS)
    .map(([value, label]) => ({ label: `${label} (${value})`, value }))
    .sort((a, b) => erpCollatorCompare(a.label, b.label));
}

export function auditActionSelectOptions(): AuditSelectOption[] {
  return Object.entries(ACTION_LABELS)
    .map(([value, label]) => ({ label, value }))
    .sort((a, b) => erpCollatorCompare(a.label, b.label));
}
