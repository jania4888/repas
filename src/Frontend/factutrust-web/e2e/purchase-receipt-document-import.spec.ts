import { expect, test, type Page, type Route } from '@playwright/test';
import { installErpSession, settle } from './helpers/erp-session.mock';

/**
 * Import d'un bon de réception depuis un document (PDF/image) : dépôt du fichier,
 * relecture des données extraites, résolution des lignes non reconnues, création
 * rapide de fournisseur/produit, puis enregistrement et jointure du document source.
 * Backend entièrement simulé par des routes Playwright (voir plan v1, §13).
 */

test.setTimeout(120_000);

const ok = <T,>(data: T) => ({ success: true, data, message: null, errors: [] });
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const PDF = {
  name: 'bon-de-reception.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
};

const CAPABILITIES = {
  available: true,
  extractionProvider: 'docstrange',
  ocrAvailable: true,
  visionCapable: false,
  externalProcessing: true,
  maxFileBytes: 10 * 1024 * 1024,
  acceptedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  canCreateSupplier: true,
  canCreateProduct: true,
  canAttach: true
};

function product(id: string, code: string, name: string, unitPrice: number, purchasePrice: number) {
  return {
    id, code, name, description: null, typeDisplay: 'Produit', categoryId: 'c-1', category: 'Produit',
    unitPrice, purchasePrice, unit: 'Un', vatRate: 19, isActive: true, isStockManaged: true,
    trackingMode: 0, imageUrl: null
  };
}

const PRODUCTS = {
  'p-chair': product('p-chair', 'CH', 'chaise', 80, 45),
  'p-table': product('p-table', 'TAB', 'table', 100, 60),
  'p-shelf': product('p-shelf', 'SHL', 'Étagère métallique', 45, 30)
};

interface ProposalOptions {
  confidence?: 'high' | 'medium' | 'low';
  supplier?: Record<string, unknown>;
  lines?: Record<string, unknown>[];
  warnings?: Record<string, unknown>[];
  documentTotals?: Record<string, unknown>;
  expectedReceiptTotals?: Record<string, unknown>;
  canCreateSupplier?: boolean;
  canCreateProduct?: boolean;
  canAttach?: boolean;
}

const MATCHED_LINE_1 = {
  index: 0, extractedCode: 'CH', designation: 'chaise', unit: 'Un', quantity: 5, unitPriceHt: 45,
  discountPercent: 0, vatRatePercent: 19, lineTotalHt: 225, matchMethod: 'code',
  productId: 'p-chair', productCode: 'CH', productName: 'chaise', productVatRatePercent: 19,
  vatMismatch: false, candidates: [], prefill: null
};

const MATCHED_LINE_2 = {
  index: 1, extractedCode: 'TAB', designation: 'table', unit: 'Un', quantity: 2, unitPriceHt: 60,
  discountPercent: 0, vatRatePercent: 19, lineTotalHt: 120, matchMethod: 'code',
  productId: 'p-table', productCode: 'TAB', productName: 'table', productVatRatePercent: 19,
  vatMismatch: false, candidates: [], prefill: null
};

const PENDING_LINE = {
  index: 2, extractedCode: 'SHL', designation: 'Étagère métallique', unit: 'Un', quantity: 3, unitPriceHt: 30,
  discountPercent: 0, vatRatePercent: 19, lineTotalHt: 90, matchMethod: 'none',
  productId: null, productCode: null, productName: null, productVatRatePercent: null,
  vatMismatch: false,
  candidates: [{ id: 'p-shelf', code: 'SHL', name: 'Étagère métallique', vatRatePercent: 19, purchasePrice: 30 }],
  prefill: {
    code: 'SHL-NEW', codeConflict: false, name: 'Étagère métallique', type: 'Product',
    purchasePrice: 30, vatRate: 'Standard', unit: 'Unité', barcode: null,
    isStockManaged: true, preferredSupplierId: 'sup-1'
  }
};

function proposal(opts: ProposalOptions = {}) {
  return {
    extractionProvider: 'docstrange',
    ocrApplied: false,
    documentType: 'DELIVERY_NOTE',
    documentNumber: 'BL-9001',
    header: {
      receiptDate: '2026-10-15',
      deliveryNoteNumber: 'BL-9001',
      supplierReference: 'REF-ALPHA-1',
      currency: 'TND',
      suggestedNotes: null,
      suggestedWarehouseId: 'w-e2e'
    },
    supplier: opts.supplier ?? {
      matchOutcome: 'MatchedByNif',
      supplierId: 'sup-1',
      supplierName: 'Fournisseur Alpha',
      extractedName: 'Fournisseur Alpha',
      extractedNif: '1234567A',
      candidates: [],
      prefill: null
    },
    lines: opts.lines ?? [MATCHED_LINE_1, MATCHED_LINE_2, PENDING_LINE],
    documentTotals: opts.documentTotals ?? { totalHt: 435, totalVat: 82.65, fodecAmount: null, fiscalStampAmount: null, withholdingAmount: null, totalTtc: 517.65, vatBreakdown: [] },
    expectedReceiptTotals: opts.expectedReceiptTotals ?? { subTotal: 435, totalVat: 82.65, totalAmount: 517.65 },
    confidence: opts.confidence ?? 'medium',
    warnings: opts.warnings ?? [],
    canCreateSupplier: opts.canCreateSupplier ?? true,
    canCreateProduct: opts.canCreateProduct ?? true,
    canAttach: opts.canAttach ?? true
  };
}

const SUPPLIERS = [{
  id: 'sup-1', name: 'Fournisseur Alpha', type: 'Business', typeDisplay: 'Entreprise', nif: '1234567A',
  email: null, phone: null, city: 'Tunis', governorate: 'Tunis', contactPerson: null,
  paymentTermDays: 30, isActive: true, totalOrders: 0
}];

async function installMocks(page: Page, locale: 'fr' | 'ar' = 'fr'): Promise<void> {
  await installErpSession(page, { locale });
  await page.route('**/api/purchasereceipts/import-document/capabilities**', route => json(route, ok(CAPABILITIES)));
  await page.route(/\/api\/products\/(p-chair|p-table|p-shelf)$/, route => {
    const id = route.request().url().split('/').pop()!;
    json(route, ok(PRODUCTS[id as keyof typeof PRODUCTS]));
  });
  await page.route('**/api/suppliers**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    json(route, ok({ items: SUPPLIERS, page: 1, pageSize: 200, totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }));
  });
}

async function openImportDialog(page: Page): Promise<void> {
  await page.goto('/purchase-receipts', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByRole('button', { name: 'Importer depuis un document' }).click();
  await expect(page.getByRole('dialog', { name: 'Importer un bon de réception' })).toBeVisible();
}

async function uploadAndWaitForForm(page: Page, file: { name: string; mimeType: string; buffer: Buffer } = PDF): Promise<void> {
  await page.locator('.pid-file-input').setInputFiles(file);
  await expect(page).toHaveURL(/\/purchase-receipts\/new$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Nouveau bon de réception' })).toBeVisible({ timeout: 20_000 });
}

test('parcours nominal : import, résolution de la ligne en attente, enregistrement et pièce jointe', async ({ page }) => {
  await installMocks(page);
  await page.route('**/api/purchasereceipts/import-document', route => json(route, ok(proposal())));

  let createBody: Record<string, unknown> | null = null;
  let attachmentCalled = false;
  await page.route('**/api/purchasereceipts', route => {
    if (route.request().method() === 'POST') {
      createBody = route.request().postDataJSON();
      json(route, ok('receipt-1'));
      return;
    }
    route.fallback();
  });
  await page.route('**/api/purchasereceipts/receipt-1/attachments', route => {
    attachmentCalled = true;
    json(route, ok({ id: 'att-1' }));
  });

  await openImportDialog(page);
  await uploadAndWaitForForm(page);

  // Bandeau : confiance moyenne + fournisseur reconnu.
  await expect(page.getByText('Confiance moyenne : relisez les données extraites.')).toBeVisible();
  await expect(page.locator('#supplier')).toContainText('Fournisseur Alpha');

  // Deux lignes reconnues, une à résoudre ; l'enregistrement est bloqué.
  await expect(page.locator('.line-import-badge').filter({ hasText: 'Reconnu' })).toHaveCount(2);
  await expect(page.locator('.line-import-badge--pending')).toHaveCount(1);
  const draftButton = page.getByRole('button', { name: /Enregistrer en brouillon/ });
  await expect(draftButton).toBeDisabled();
  await expect(page.getByText("Associez ou créez le produit de la ligne 3.")).toBeVisible();

  // Résolution de la ligne en attente via le candidat proposé.
  await page.getByRole('button', { name: 'SHL — Étagère métallique' }).click();
  await expect(page.locator('.line-import-badge').filter({ hasText: 'Associé' })).toHaveCount(1);
  await expect(draftButton).toBeEnabled();

  await draftButton.click();
  await expect(page).toHaveURL(/\/purchase-receipts\/receipt-1\/edit$/, { timeout: 15_000 });

  expect(createBody).toBeTruthy();
  const lines = (createBody as { lines: Array<Record<string, unknown>> }).lines;
  expect(lines).toHaveLength(3);
  expect(lines.map(l => l.productId)).toEqual(['p-chair', 'p-table', 'p-shelf']);
  expect(lines[0].unitPriceHT).toBe(45);
  expect(lines[0].discountPercent).toBe(0);
  expect(attachmentCalled).toBe(true);
});

test('fournisseur et produit à créer depuis le document importé', async ({ page }) => {
  await installMocks(page);
  await page.route('**/api/purchasereceipts/import-document', route => json(route, ok(proposal({
    supplier: {
      matchOutcome: 'NotFound',
      supplierId: null,
      supplierName: null,
      extractedName: 'Nouveau Fournisseur SARL',
      extractedNif: '7654321B/A/M/000',
      candidates: [],
      prefill: {
        name: 'Nouveau Fournisseur SARL', type: 'Business', nif: '7654321B/A/M/000',
        street: 'Rue de la Gare', city: 'Sousse', postalCode: '4000', governorate: null,
        email: null, phone: null, missingRequiredFields: ['governorate']
      }
    },
    lines: [PENDING_LINE]
  }))));
  await page.route('**/api/suppliers**', route => {
    if (route.request().method() === 'GET') return json(route, ok({ items: [], page: 1, pageSize: 5, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false }));
    route.fallback();
  });

  let supplierBody: Record<string, unknown> | null = null;
  await page.route('**/api/suppliers', route => {
    if (route.request().method() === 'POST') {
      supplierBody = route.request().postDataJSON();
      json(route, ok('sup-new-1'));
      return;
    }
    route.fallback();
  });

  let productBody: Record<string, unknown> | null = null;
  await page.route('**/api/products', route => {
    if (route.request().method() === 'POST') {
      productBody = route.request().postDataJSON();
      json(route, ok('prod-new-1'));
      return;
    }
    route.fallback();
  });
  await page.route('**/api/products/prod-new-1', route => json(route, ok(product('prod-new-1', 'SHL-NEW', 'Étagère métallique', 30, 30))));

  await openImportDialog(page);
  await uploadAndWaitForForm(page);

  // Carte fournisseur : création rapide, pré-remplie, gouvernorat manquant à compléter.
  await page.getByRole('button', { name: 'Créer ce fournisseur' }).click();
  const supplierDialog = page.getByRole('dialog', { name: 'Créer un fournisseur' });
  await expect(supplierDialog.locator('#qcsd-name')).toHaveValue('Nouveau Fournisseur SARL');
  await supplierDialog.locator('#qcsd-governorate').click();
  await page.getByRole('option', { name: 'Sousse' }).click();
  await supplierDialog.getByRole('button', { name: 'Créer et sélectionner' }).click();
  await expect(supplierDialog).toBeHidden();

  expect(supplierBody).toBeTruthy();
  expect((supplierBody as Record<string, unknown>)['name']).toBe('Nouveau Fournisseur SARL');
  expect((supplierBody as Record<string, unknown>)['governorate']).toBe('Sousse');
  expect(typeof (supplierBody as Record<string, unknown>)['type']).toBe('number');

  // Carte produit : création rapide pré-remplie depuis la ligne non reconnue.
  await page.getByRole('button', { name: 'Créer le produit' }).click();
  const productDialog = page.getByRole('dialog', { name: 'Créer un produit' });
  await expect(productDialog.locator('#quick-code')).toHaveValue('SHL-NEW');
  await expect(productDialog.locator('#quick-name')).toHaveValue('Étagère métallique');
  await expect(productDialog.getByText("Prix d'achat lu sur le document importé : 30,000 TND")).toBeVisible();
  await productDialog.getByRole('button', { name: 'Créer et ajouter' }).click();
  await expect(productDialog).toBeHidden();

  expect(productBody).toBeTruthy();
  expect((productBody as Record<string, unknown>)['code']).toBe('SHL-NEW');
  expect((productBody as Record<string, unknown>)['name']).toBe('Étagère métallique');
  expect((productBody as Record<string, unknown>)['vatRate']).toBe(19);
  expect((productBody as Record<string, unknown>)['purchasePrice']).toBe(30);
});

test('fichier rejeté sans appel réseau : taille et format non supportés', async ({ page }) => {
  await installMocks(page);
  let importCalled = false;
  await page.route('**/api/purchasereceipts/import-document', route => {
    importCalled = true;
    json(route, ok(proposal()));
  });

  await openImportDialog(page);

  const oversized = { name: 'gros-fichier.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 'a') };
  await page.locator('.pid-file-input').setInputFiles(oversized);
  await expect(page.getByText('Fichier trop volumineux (maximum 10 Mo).')).toBeVisible();
  expect(importCalled).toBe(false);

  await page.getByRole('button', { name: 'Réessayer' }).click();
  const wrongFormat = { name: 'image.webp', mimeType: 'image/webp', buffer: Buffer.from('not-a-real-image') };
  await page.locator('.pid-file-input').setInputFiles(wrongFormat);
  await expect(page.getByText('Format non supporté. Utilisez un PDF ou une image (JPG, PNG).')).toBeVisible();
  expect(importCalled).toBe(false);
});

test("erreurs serveur (429, 500) et fermeture de la boîte de dialogue pendant un import en cours", async ({ page }) => {
  await installMocks(page);
  let mode: '429' | '500' = '429';
  await page.route('**/api/purchasereceipts/import-document', route => {
    if (mode === '429') {
      json(route, { success: false, message: 'Trop de demandes.' }, 429);
    } else {
      route.fulfill({ status: 500 });
    }
  });

  await openImportDialog(page);
  await page.locator('.pid-file-input').setInputFiles(PDF);
  await expect(page.getByText("Trop de demandes d'import. Réessayez dans un instant.")).toBeVisible({ timeout: 15_000 });

  mode = '500';
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await page.locator('.pid-file-input').setInputFiles(PDF);
  await expect(page.getByText('Erreur serveur. Veuillez réessayer plus tard.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/System\.|Exception|StackTrace/i)).toHaveCount(0);

  // Annulation pendant un envoi en cours : la requête part mais n'est jamais résolue ; le bouton
  // « Annuler » de la phase d'envoi désabonne l'import et ramène la boîte à l'état initial,
  // que l'on peut alors fermer sans blocage ni erreur.
  // (Le passage par la phase « analyse » avec sa barre « Annuler l'import » dépend d'événements
  // de progression d'upload réels, que les routes mockées de Playwright n'émettent jamais ; ce
  // cas est couvert au niveau unitaire dans purchase-receipt-import-dialog.component.spec.ts.)
  await page.unroute('**/api/purchasereceipts/import-document');
  await page.route('**/api/purchasereceipts/import-document', () => {
    // Ne jamais répondre : simule un import en cours, interrompu par l'utilisateur.
  });
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await page.locator('.pid-file-input').setInputFiles(PDF);
  await expect(page.getByText('Envoi du document…')).toBeVisible({ timeout: 15_000 });
  await page.locator('.pid-state').getByRole('button', { name: 'Annuler' }).click();
  // Retour à l'état initial : la zone de dépôt est de nouveau disponible, fermeture propre.
  await expect(page.getByRole('button', { name: 'Choisir un fichier' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Importer un bon de réception' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Bons de réception' })).toBeVisible();
});

test("échec de la jointe du document après enregistrement : avertissement, bon accessible en édition", async ({ page }) => {
  await installMocks(page);
  await page.route('**/api/purchasereceipts/import-document', route => json(route, ok(proposal({ lines: [MATCHED_LINE_1, MATCHED_LINE_2] }))));
  await page.route('**/api/purchasereceipts', route => {
    if (route.request().method() === 'POST') {
      json(route, ok('receipt-2'));
      return;
    }
    route.fallback();
  });
  await page.route('**/api/purchasereceipts/receipt-2/attachments', route => route.fulfill({ status: 500 }));

  await openImportDialog(page);
  await uploadAndWaitForForm(page);
  await page.getByRole('button', { name: /Enregistrer en brouillon/ }).click();

  await expect(page.getByText("Bon de réception enregistré, mais le document source n'a pas pu être joint. Ajoutez-le depuis la section Pièces jointes.")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/purchase-receipts\/receipt-2\/edit$/);
});

test('écart de totaux et avertissement de doublon affichés dans le bandeau', async ({ page }) => {
  await installMocks(page);
  await page.route('**/api/purchasereceipts/import-document', route => json(route, ok(proposal({
    lines: [MATCHED_LINE_1, MATCHED_LINE_2],
    documentTotals: { totalHt: 600, totalVat: 114, fodecAmount: null, fiscalStampAmount: null, withholdingAmount: null, totalTtc: 714, vatBreakdown: [] },
    expectedReceiptTotals: { subTotal: 600, totalVat: 114, totalAmount: 714 },
    warnings: [
      { code: 'PossibleDuplicate', severity: 'warning', message: null, lineIndex: null },
      { code: 'LineWarning', severity: 'warning', message: 'Quantité incohérente avec la commande.', lineIndex: 0 }
    ]
  }))));

  await openImportDialog(page);
  await uploadAndWaitForForm(page);

  await expect(page.getByText('Un bon de réception similaire existe peut-être déjà pour ce fournisseur.')).toBeVisible();
  await expect(page.getByText("Le total calculé ne correspond pas au total lu sur le document.")).toBeVisible();
  await expect(page.getByText('Les totaux diffèrent du document : vérifiez quantités, prix et remises.')).toBeVisible();
  // Bloc de comparaison : totaux imprimés (HT / TVA / TTC) face au total calculé du bon.
  const totals = page.locator('.ft-totals');
  await expect(totals.locator('.ft-totals__row', { hasText: 'Document (HT)' })).toContainText('600,000');
  await expect(totals.locator('.ft-totals__row', { hasText: 'Document (TVA)' })).toContainText('114,000');
  await expect(totals.locator('.ft-totals__row', { hasText: 'Document (TTC)' })).toContainText('714,000');
  await expect(totals.locator('.ft-totals__row', { hasText: 'Bon (calculé, TTC)' })).toBeVisible();
  // Ni timbre fiscal ni FODEC dans ce jeu de données : pas de note de comparaison.
  await expect(page.getByText('Hors timbre fiscal et FODEC.')).toHaveCount(0);
  // Le bandeau cite le fichier source et un libellé générique du moteur (jamais de nom commercial).
  const banner = page.locator('.pirb');
  await expect(banner).toContainText('bon-de-reception.pdf');
  await expect(banner).toContainText("Service d'extraction documentaire");
  expect(((await banner.textContent()) ?? '').toLowerCase()).not.toContain('docstrange');
  await expect(banner).toContainText("Sera joint au bon à l'enregistrement");
});

test('import en arabe (RTL) : parcours nominal sans fuite de texte latin', async ({ page }) => {
  await installMocks(page, 'ar');
  await page.route('**/api/purchasereceipts/import-document', route => json(route, ok(proposal({ lines: [MATCHED_LINE_1, MATCHED_LINE_2] }))));

  await page.goto('/purchase-receipts', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByRole('button', { name: 'استيراد من مستند' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // Nom de fichier arabe (type MIME suffit à la validation) : le bandeau affiche le nom du
  // fichier source — sans fuite latine.
  await page.locator('.pid-file-input').setInputFiles({ ...PDF, name: 'سند-قبض' });
  await expect(page).toHaveURL(/\/purchase-receipts\/new$/, { timeout: 30_000 });

  const banner = page.locator('.pirb');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  const bannerText = await banner.innerText();
  expect(bannerText).not.toMatch(/[A-Za-z]{3,}/);
});
