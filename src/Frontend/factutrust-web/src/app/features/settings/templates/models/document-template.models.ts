export type PrintableDocumentType =
  | 'SalesInvoice'
  | 'CreditNote'
  | 'Quote'
  | 'PurchaseOrder'
  | 'DeliveryNote'
  | 'SupplierInvoice'
  | 'SalesReturnNote';

export interface DocumentTemplatePreferenceDto {
  documentType: PrintableDocumentType;
  documentTypeValue: number;
  documentTypeLabel: string;
  templateKey: string;
  templateName: string;
}

export interface DocumentTemplateCatalogItemDto {
  key: string;
  name: string;
  description: string;
  thumbnail: string;
  supportedDocumentTypes: string[];
}

export interface SaveDocumentTemplateRequest {
  templateKey: string;
}

export interface DocumentTypeTab {
  type: PrintableDocumentType;
  label: string;
  icon: string;
}

export const DOCUMENT_TYPE_TABS: DocumentTypeTab[] = [
  { type: 'SalesInvoice', label: $localize`:@@settings.document-template.ts.factures.de.vente.b3725913:Factures de vente`, icon: 'pi pi-file' },
  { type: 'CreditNote', label: $localize`:@@settings.document-template.ts.avoirs.38b0e7b7:Avoirs`, icon: 'pi pi-file-excel' },
  { type: 'Quote', label: $localize`:@@settings.document-template.ts.devis.f7622f90:Devis`, icon: 'pi pi-file-edit' },
  { type: 'PurchaseOrder', label: $localize`:@@settings.document-template.ts.bons.de.commande.aae719f0:Bons de commande`, icon: 'pi pi-shopping-cart' },
  { type: 'DeliveryNote', label: $localize`:@@settings.document-template.ts.bons.de.livraison.a283129d:Bons de livraison`, icon: 'pi pi-truck' },
  { type: 'SupplierInvoice', label: $localize`:@@settings.document-template.ts.factures.d.achat.c807159a:Factures d'achat`, icon: 'pi pi-receipt' },
  { type: 'SalesReturnNote', label: $localize`:@@settings.document-template.ts.bons.de.retour.d9f7ad6c:Bons de retour`, icon: 'pi pi-replay' }
];
