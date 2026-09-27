import { erpCollatorCompare } from '@core/i18n/erp-format';

/** Libellés FR pour les actions d'audit (alignés sur AuditActions côté API). */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  'Auth.Login': $localize`:@@audit.audit-action-labels.ts.connexion.a33c58f5:Connexion`,
  'Auth.LoginFailed': $localize`:@@audit.audit-action-labels.ts.echec.de.connexion.beee15fc:Échec de connexion`,
  'Auth.Logout': $localize`:@@audit.audit-action-labels.ts.deconnexion.903dca17:Déconnexion`,
  'Auth.PasswordChange': $localize`:@@audit.audit-action-labels.ts.changement.de.mot.de.passe.d74af09f:Changement de mot de passe`,
  'Auth.TwoFactorEnabled': $localize`:@@audit.audit-action-labels.ts.2fa.activee.0c29b0e1:2FA activée`,
  'Auth.TwoFactorDisabled': $localize`:@@audit.audit-action-labels.ts.2fa.desactivee.36602bdd:2FA désactivée`,
  'Invoice.Created': $localize`:@@audit.audit-action-labels.ts.facture.creee.a77fc444:Facture créée`,
  'Invoice.Updated': $localize`:@@audit.audit-action-labels.ts.facture.modifiee.26f4e010:Facture modifiée`,
  'Invoice.Validated': $localize`:@@audit.audit-action-labels.ts.facture.validee.a82be105:Facture validée`,
  'Invoice.Signed': $localize`:@@audit.audit-action-labels.ts.facture.signee.f616de33:Facture signée`,
  'Invoice.Sent': $localize`:@@audit.audit-action-labels.ts.facture.envoyee.fe46677d:Facture envoyée`,
  'Invoice.Paid': $localize`:@@audit.audit-action-labels.ts.facture.payee.1e1aca61:Facture payée`,
  'Invoice.Cancelled': $localize`:@@audit.audit-action-labels.ts.facture.annulee.4f480a90:Facture annulée`,
  'Invoice.Archived': $localize`:@@audit.audit-action-labels.ts.facture.archivee.71c03f36:Facture archivée`,
  'Invoice.Exported': $localize`:@@audit.audit-action-labels.ts.facture.exportee.5bbf2236:Facture exportée`,
  'Invoice.Viewed': $localize`:@@audit.audit-action-labels.ts.facture.consultee.d6474b81:Facture consultée`,
  'Client.Created': $localize`:@@audit.audit-action-labels.ts.client.cree.84ddb7d0:Client créé`,
  'Client.Updated': $localize`:@@audit.audit-action-labels.ts.client.modifie.c7e5737d:Client modifié`,
  'Client.Deleted': $localize`:@@audit.audit-action-labels.ts.client.supprime.24e0b4ff:Client supprimé`,
  'Product.Created': $localize`:@@audit.audit-action-labels.ts.produit.cree.b0d23c14:Produit créé`,
  'Product.Updated': $localize`:@@audit.audit-action-labels.ts.produit.modifie.c107b459:Produit modifié`,
  'Product.Deleted': $localize`:@@audit.audit-action-labels.ts.produit.supprime.0da53e06:Produit supprimé`,
  'User.Created': $localize`:@@audit.audit-action-labels.ts.utilisateur.cree.ba68874f:Utilisateur créé`,
  'User.Updated': $localize`:@@audit.audit-action-labels.ts.utilisateur.modifie.5f33f511:Utilisateur modifié`,
  'User.Deleted': $localize`:@@audit.audit-action-labels.ts.utilisateur.supprime.01bba9b9:Utilisateur supprimé`,
  'User.RoleChanged': $localize`:@@audit.audit-action-labels.ts.role.modifie.6a2f1d31:Rôle modifié`,
  'Subscription.Upgraded': $localize`:@@audit.audit-action-labels.ts.abonnement.surclasse.272196e2:Abonnement surclassé`,
  'Subscription.Downgraded': $localize`:@@audit.audit-action-labels.ts.abonnement.retrograde.ec798b5f:Abonnement rétrogradé`,
  'Subscription.Cancelled': $localize`:@@audit.audit-action-labels.ts.abonnement.resilie.f5326fe8:Abonnement résilié`,
  'Subscription.Renewed': $localize`:@@audit.audit-action-labels.ts.abonnement.renouvele.28d3e2f5:Abonnement renouvelé`,
  'Settings.Updated': $localize`:@@audit.audit-action-labels.ts.parametres.modifies.c87f369b:Paramètres modifiés`,
  'Quote.Created': $localize`:@@audit.audit-action-labels.ts.devis.cree.d5abd25e:Devis créé`,
  'Quote.Updated': $localize`:@@audit.audit-action-labels.ts.devis.modifie.a238c924:Devis modifié`,
  'Quote.Sent': $localize`:@@audit.audit-action-labels.ts.devis.envoye.b1e44c68:Devis envoyé`,
  'Quote.Accepted': $localize`:@@audit.audit-action-labels.ts.devis.accepte.7670ef87:Devis accepté`,
  'Quote.Rejected': $localize`:@@audit.audit-action-labels.ts.devis.refuse.33e9b1c2:Devis refusé`,
  'Quote.Cancelled': $localize`:@@audit.audit-action-labels.ts.devis.annule.a867d18d:Devis annulé`,
  'Quote.Converted': $localize`:@@audit.audit-action-labels.ts.devis.converti.53a92640:Devis converti`,
  'Quote.Viewed': $localize`:@@audit.audit-action-labels.ts.devis.consulte.692aefe2:Devis consulté`,
  'Export.Pdf': $localize`:@@audit.audit-action-labels.ts.export.pdf.3dd7d56a:Export PDF`,
  'Export.Xml': $localize`:@@audit.audit-action-labels.ts.export.xml.f6a2de23:Export XML`,
  'Export.Data': $localize`:@@audit.audit-action-labels.ts.export.donnees.0eb232e9:Export données`,
  'DeliveryNote.Created': $localize`:@@audit.audit-action-labels.ts.bon.de.livraison.cree.b2891a13:Bon de livraison créé`,
  'DeliveryNote.Updated': $localize`:@@audit.audit-action-labels.ts.bon.de.livraison.modifie.9c60b66b:Bon de livraison modifié`,
  'DeliveryNote.Confirmed': $localize`:@@audit.audit-action-labels.ts.bon.de.livraison.confirme.086f497d:Bon de livraison confirmé`,
  'DeliveryNote.InTransit': $localize`:@@audit.audit-action-labels.ts.en.transit.5b090eba:En transit`,
  'DeliveryNote.Delivered': $localize`:@@audit.audit-action-labels.ts.livre.0a1317e9:Livré`,
  'DeliveryNote.Failed': $localize`:@@audit.audit-action-labels.ts.echec.livraison.b77f9682:Échec livraison`,
  'DeliveryNote.Invoiced': $localize`:@@audit.audit-action-labels.ts.facture.55e253e6:Facturé`,
  'DeliveryNote.Cancelled': $localize`:@@audit.audit-action-labels.ts.bon.annule.a2da6e66:Bon annulé`,
  'DeliveryNote.Viewed': $localize`:@@audit.audit-action-labels.ts.bon.consulte.0b3853d5:Bon consulté`,
  'DeliveryNote.Exported': $localize`:@@audit.audit-action-labels.ts.bon.exporte.f7c7513f:Bon exporté`,
  'DeliveryNote.ModificationAttempted': $localize`:@@audit.audit-action-labels.ts.tentative.de.modification.c577757b:Tentative de modification`,
  'SalesReturnNote.Created': $localize`:@@audit.audit-action-labels.ts.bon.de.retour.cree.d26d693a:Bon de retour créé`,
  'SalesReturnNote.Updated': $localize`:@@audit.audit-action-labels.ts.bon.de.retour.modifie.f3f0e309:Bon de retour modifié`,
  'SalesReturnNote.Confirmed': $localize`:@@audit.audit-action-labels.ts.bon.de.retour.confirme.a329e997:Bon de retour confirmé`,
  'SalesReturnNote.Deleted': $localize`:@@audit.audit-action-labels.ts.bon.de.retour.supprime.90536c71:Bon de retour supprimé`,
  'SalesReturnNote.Exported': $localize`:@@audit.audit-action-labels.ts.bon.de.retour.exporte.164e671a:Bon de retour exporté`,
  'Supplier.Created': $localize`:@@audit.audit-action-labels.ts.fournisseur.cree.6f48243e:Fournisseur créé`,
  'Supplier.Updated': $localize`:@@audit.audit-action-labels.ts.fournisseur.modifie.4ddb46c1:Fournisseur modifié`,
  'Supplier.Deleted': $localize`:@@audit.audit-action-labels.ts.fournisseur.supprime.c61b5566:Fournisseur supprimé`,
  'PurchaseOrder.Created': $localize`:@@audit.audit-action-labels.ts.bon.de.commande.cree.d88e27b8:Bon de commande créé`,
  'PurchaseOrder.Updated': $localize`:@@audit.audit-action-labels.ts.bon.de.commande.modifie.94d7af32:Bon de commande modifié`,
  'PurchaseOrder.Confirmed': $localize`:@@audit.audit-action-labels.ts.bon.de.commande.confirme.f14d85d3:Bon de commande confirmé`,
  'PurchaseOrder.GoodsReceived': $localize`:@@audit.audit-action-labels.ts.reception.marchandises.f21fae85:Réception marchandises`,
  'PurchaseOrder.Cancelled': $localize`:@@audit.audit-action-labels.ts.bon.de.commande.annule.4afe942c:Bon de commande annulé`,
  'PurchaseOrder.Deleted': $localize`:@@audit.audit-action-labels.ts.bon.de.commande.supprime.893f8273:Bon de commande supprimé`,
  'PurchaseOrder.Exported': $localize`:@@audit.audit-action-labels.ts.bon.de.commande.exporte.6430d6b9:Bon de commande exporté`,
  'PurchaseOrder.Sent': $localize`:@@audit.audit-action-labels.ts.bon.de.commande.envoye.84f4a699:Bon de commande envoyé`,
  'SupplierInvoice.Created': $localize`:@@audit.audit-action-labels.ts.facture.fournisseur.creee.1956acbc:Facture fournisseur créée`,
  'SupplierInvoice.Paid': $localize`:@@audit.audit-action-labels.ts.facture.fournisseur.payee.2759539a:Facture fournisseur payée`,
  'SupplierInvoice.Cancelled': $localize`:@@audit.audit-action-labels.ts.facture.fournisseur.annulee.0ba70de2:Facture fournisseur annulée`,
  'CashExpense.Created': $localize`:@@audit.audit-action-labels.ts.depense.caisse.creee.b6dd5d52:Dépense caisse créée`,
  'CashExpense.Cancelled': $localize`:@@audit.audit-action-labels.ts.depense.caisse.annulee.e44b7f9e:Dépense caisse annulée`,
  'CashOperation.Created': $localize`:@@audit.audit-action-labels.ts.operation.caisse.creee.b7d5062f:Opération caisse créée`,
  'CashOperation.Cancelled': $localize`:@@audit.audit-action-labels.ts.operation.caisse.annulee.7d9409c7:Opération caisse annulée`,
  'CashRegisterSession.Opened': $localize`:@@audit.audit-action-labels.ts.session.de.caisse.ouverte.d669b146:Session de caisse ouverte`,
  'CashRegisterSession.Closed': $localize`:@@audit.audit-action-labels.ts.session.de.caisse.cloturee.7f00358e:Session de caisse clôturée`,
  'BankAccount.Created': $localize`:@@audit.audit-action-labels.ts.compte.bancaire.cree.faed4e82:Compte bancaire créé`,
  'BankAccount.Updated': $localize`:@@audit.audit-action-labels.ts.compte.bancaire.modifie.d4c1d155:Compte bancaire modifié`,
  'BankAccount.Deleted': $localize`:@@audit.audit-action-labels.ts.compte.bancaire.supprime.d2a1e770:Compte bancaire supprimé`,
  'BankAccount.DefaultChanged': $localize`:@@audit.audit-action-labels.ts.compte.par.defaut.modifie.affb1eb2:Compte par défaut modifié`,
  'BankDeposit.Created': $localize`:@@audit.audit-action-labels.ts.remise.bancaire.creee.027fbaae:Remise bancaire créée`,
  'BankDeposit.Cancelled': $localize`:@@audit.audit-action-labels.ts.remise.bancaire.annulee.ff1c3734:Remise bancaire annulée`,
  'WithholdingCertificate.Created': $localize`:@@audit.audit-action-labels.ts.attestation.a.la.source.creee.5284c456:Attestation à la source créée`,
  'WithholdingCertificate.Updated': $localize`:@@audit.audit-action-labels.ts.attestation.a.la.source.modifiee.ce9901f6:Attestation à la source modifiée`,
  'WithholdingCertificate.Validated': $localize`:@@audit.audit-action-labels.ts.attestation.a.la.source.validee.65cfee16:Attestation à la source validée`,
  'WithholdingCertificate.Cancelled': $localize`:@@audit.audit-action-labels.ts.attestation.a.la.source.annulee.44cc4050:Attestation à la source annulée`,
  'WithholdingCertificate.Deleted': $localize`:@@audit.audit-action-labels.ts.attestation.a.la.source.supprimee.f9f5a1b9:Attestation à la source supprimée`,
  'WithholdingCertificate.Exported': $localize`:@@audit.audit-action-labels.ts.attestation.exportee.54752fdc:Attestation exportée`,
  'WithholdingCertificate.PdfGenerated': $localize`:@@audit.audit-action-labels.ts.pdf.attestation.genere.202d8b15:PDF attestation généré`,
  'WithholdingCertificate.TejSubmitted': $localize`:@@audit.audit-action-labels.ts.attestation.soumise.tej.9a7c00f5:Attestation soumise TEJ`,
  'TejExport.XmlGenerated': $localize`:@@audit.audit-action-labels.ts.export.tej.xml.genere.ca1d5719:Export TEJ XML généré`,
  'TejExport.XmlPreviewed': $localize`:@@audit.audit-action-labels.ts.apercu.tej.xml.1532cbbf:Aperçu TEJ XML`,
  'TejExport.ValidationFailed': $localize`:@@audit.audit-action-labels.ts.validation.tej.echouee.3e5e53a3:Validation TEJ échouée`,
  'Accounting.ManualEntryCreated': $localize`:@@audit.audit-action-labels.ts.ecriture.manuelle.creee.12e50efb:Écriture manuelle créée`,
  'Accounting.PeriodClosed': $localize`:@@audit.audit-action-labels.ts.periode.cloturee.1d6377bd:Période clôturée`,
  'Accounting.PeriodReopened': $localize`:@@audit.audit-action-labels.ts.periode.rouverte.23331393:Période rouverte`,
  'Accounting.FiscalYearClosed': $localize`:@@audit.audit-action-labels.ts.exercice.cloture.1d9b913f:Exercice clôturé`,
  'Accounting.VatDeclarationSaved': $localize`:@@audit.audit-action-labels.ts.declaration.tva.enregistree.e4972b99:Déclaration TVA enregistrée`,
  'Accounting.VatDeclarationSubmitted': $localize`:@@audit.audit-action-labels.ts.declaration.tva.transmise.9ea967be:Déclaration TVA transmise`,
  'Accounting.Lettered': $localize`:@@audit.audit-action-labels.ts.lettrage.cfcdd333:Lettrage`,
  'Accounting.SubAccountCreated': $localize`:@@audit.audit-action-labels.ts.sous.compte.cree.52578981:Sous-compte créé`,
  'Accounting.AccountLabelUpdated': $localize`:@@audit.audit-action-labels.ts.libelle.de.compte.modifie.361c1e54:Libellé de compte modifié`,
  'Accounting.AccountToggled': $localize`:@@audit.audit-action-labels.ts.compte.active.desactive.859ab080:Compte activé/désactivé`,
  'Accounting.FecExported': $localize`:@@audit.audit-action-labels.ts.export.fec.e7d31585:Export FEC`,
  'StockVoucher.Created': $localize`:@@audit.audit-action-labels.ts.bon.de.stock.cree.b4674fd5:Bon de stock créé`,
  'StockVoucher.Updated': $localize`:@@audit.audit-action-labels.ts.bon.de.stock.modifie.30f1358b:Bon de stock modifié`,
  'StockVoucher.Validated': $localize`:@@audit.audit-action-labels.ts.bon.de.stock.valide.5942e848:Bon de stock validé`,
  'StockVoucher.Cancelled': $localize`:@@audit.audit-action-labels.ts.bon.de.stock.annule.d5e00c77:Bon de stock annulé`,
  'StockVoucher.Deleted': $localize`:@@audit.audit-action-labels.ts.bon.de.stock.supprime.1f61698d:Bon de stock supprimé`,
  'StockVoucher.Exported': $localize`:@@audit.audit-action-labels.ts.bon.de.stock.exporte.0c58d6c8:Bon de stock exporté`
};

const ENTITY_LABELS: Readonly<Record<string, string>> = {
  Invoice: $localize`:@@audit.audit-action-labels.ts.facture.3953b9f5:Facture`,
  Client: $localize`:@@audit.audit-action-labels.ts.client.1bdd79b1:Client`,
  Product: $localize`:@@audit.audit-action-labels.ts.produit.ff673dc2:Produit`,
  User: $localize`:@@audit.audit-action-labels.ts.utilisateur.0b20cd7f:Utilisateur`,
  Quote: $localize`:@@audit.audit-action-labels.ts.devis.f7622f90:Devis`,
  DeliveryNote: $localize`:@@audit.audit-action-labels.ts.bon.de.livraison.1a60dc44:Bon de livraison`,
  SalesReturnNote: $localize`:@@audit.audit-action-labels.ts.bon.de.retour.58d2db35:Bon de retour`,
  Supplier: $localize`:@@audit.audit-action-labels.ts.fournisseur.97d91d89:Fournisseur`,
  PurchaseOrder: $localize`:@@audit.audit-action-labels.ts.bon.de.commande.4b9aea29:Bon de commande`,
  SupplierInvoice: $localize`:@@audit.audit-action-labels.ts.facture.fournisseur.37c58151:Facture fournisseur`,
  CashExpense: $localize`:@@audit.audit-action-labels.ts.depense.caisse.2237da81:Dépense caisse`,
  CashOperation: $localize`:@@audit.audit-action-labels.ts.operation.caisse.3c422a25:Opération caisse`,
  BankAccount: $localize`:@@audit.audit-action-labels.ts.compte.bancaire.485b42ca:Compte bancaire`,
  BankDeposit: $localize`:@@audit.audit-action-labels.ts.remise.bancaire.0097046a:Remise bancaire`,
  WithholdingCertificate: $localize`:@@audit.audit-action-labels.ts.attestation.a.la.source.bc92e9d8:Attestation à la source`,
  TejExport: $localize`:@@audit.audit-action-labels.ts.export.tej.c237f45b:Export TEJ`,
  Accounting: $localize`:@@audit.audit-action-labels.ts.comptabilite.20af7266:Comptabilité`,
  StockVoucher: $localize`:@@audit.audit-action-labels.ts.bon.d.entree.sortie.39dbb600:Bon d’entrée / sortie`,
  Settings: $localize`:@@audit.audit-action-labels.ts.parametres.ef8f0121:Paramètres`,
  Subscription: $localize`:@@audit.audit-action-labels.ts.abonnement.96422751:Abonnement`,
  Export: $localize`:@@audit.audit-action-labels.ts.export.f3e4fadb:Export`,
  Auth: $localize`:@@audit.audit-action-labels.ts.authentification.6a9cba9c:Authentification`
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
