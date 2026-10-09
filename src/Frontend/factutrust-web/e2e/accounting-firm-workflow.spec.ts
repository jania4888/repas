import { test, expect } from '@playwright/test';

/**
 * End-to-end smoke for accounting firm workflow.
 * Requires Features:AccountingFirms:Enabled and a running API for authenticated flows.
 */
test.describe('Cabinet comptable — workflow', () => {
  test.skip(
    () => process.env['E2E_PUBLIC_REGISTRATION'] === 'false',
    'Public firm registration disabled (staging build)'
  );
  test('register firm page is reachable', async ({ page }) => {
    await page.goto('/auth/register-firm');
    await expect(page.getByRole('heading', { name: /cabinet comptable/i })).toBeVisible();
    await expect(page.getByRole('group', { name: /progression : étape 1 sur 3/i })).toBeVisible();
  });

  test('register firm wizard advances from step 1 to step 2', async ({ page }) => {
    await page.goto('/auth/register-firm');
    await page.getByPlaceholder('Prénom *').fill('Jean');
    await page.getByPlaceholder('Nom *').fill('Dupont');
    await page.getByPlaceholder('Email connexion *').fill('jean.dupont@example.com');
    await page.locator('#password input').fill('SecurePass123!');
    await page.locator('#confirmPassword input').fill('SecurePass123!');
    await page.getByLabel(/conditions d'utilisation/i).check();
    await page.getByRole('button', { name: /étape suivante/i }).click();
    await expect(page.getByRole('heading', { name: /2\. votre cabinet/i })).toBeVisible();
  });

  test('register firm full flow submits step 3', async ({ page }) => {
    test.skip(process.env['E2E_FIRM_REGISTER'] !== '1', 'Set E2E_FIRM_REGISTER=1 with API + SQL to run full registration');

    const unique = Date.now();
    await page.goto('/auth/register-firm');

    await page.getByPlaceholder('Prénom *').fill('Jean');
    await page.getByPlaceholder('Nom *').fill('Dupont');
    await page.getByPlaceholder('Email connexion *').fill(`firm-${unique}@example.com`);
    await page.locator('#password input').fill('SecurePass123!');
    await page.locator('#confirmPassword input').fill('SecurePass123!');
    await page.getByLabel(/conditions d'utilisation/i).check();
    await page.getByRole('button', { name: /étape suivante/i }).click();

    await page.getByPlaceholder('Raison sociale *').fill(`Cabinet E2E ${unique}`);
    await page.getByPlaceholder('Matricule fiscal *').fill('7654321/A/B/C/000');
    await page.getByPlaceholder('Email cabinet *').fill(`contact-${unique}@example.com`);
    await page.getByPlaceholder('Téléphone *').fill('71123456');
    await page.getByRole('button', { name: /étape suivante/i }).click();

    await page.getByPlaceholder('Adresse *').fill('123 Avenue de la République');
    await page.getByPlaceholder('Ville *').fill('Tunis');
    await page.getByRole('button', { name: /créer le cabinet/i }).click();

    await expect(page).toHaveURL(/\/firm\/dashboard/, { timeout: 180_000 });
    const skipTour = page.locator('.ft-product-tour__skip, .driver-popover-close-btn, button:has-text("Ignorer")').first();
    if (await skipTour.isVisible().catch(() => false)) {
      await expect(page.locator('.driver-popover')).not.toContainText('Ventes');
      await skipTour.click();
    }
  });

  test('login page loads for firm users', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
});

test.describe('Cabinet comptable — authenticated (staging)', () => {
  const authEnabled = process.env['E2E_FIRM_AUTH'] === '1';

  test.skip(!authEnabled, 'Set E2E_FIRM_AUTH=1 with dedicated test tenants to run authenticated firm flows');

  test('firm manager sees firm sidemenu without Ventes', async ({ page }) => {
    // Login as FirmManager test account, assert sidemenu labels
  });

  test('firm manager decision tables on dashboard', async ({ page }) => {
    // Login FirmManager → /firm/dashboard
    // await expect(page.getByRole('heading', { name: /pilotage décisionnel/i })).toBeVisible();
    // await expect(page.getByText(/échéances fiscales critiques/i)).toBeVisible();
    // Clic « Voir tout » échéances → /firm/fiscal-schedule
  });

  test('firm dashboard shows no access denied modal after login', async ({ page }) => {
    // Login as FirmManager → /firm/dashboard
    // await expect(page.getByRole('dialog', { name: /accès refusé/i })).not.toBeVisible();
  });

  test('return to cabinet from ledger without 403 modal', async ({ page }) => {
    // 1. Login as FirmManager → open Ste Bouzgarou dossier
    // 2. Navigate to /accounting/ledger
    // 3. Click header or sidebar "Retour au cabinet"
    // 4. await expect(page.getByRole('dialog', { name: /accès refusé/i })).not.toBeVisible();
    // 5. await expect(page).toHaveURL(/\/firm\/dashboard/);
    // 6. await expect(page.getByRole('navigation', { name: /navigation principale/i })).toContainText('Mes dossiers clients');
    // 7. Repeat with "Changer de dossier" → /firm/clients, no 403 modal
  });

  test('delegated session never shows the cabinet dashboard', async ({ page }) => {
    // 1. Login as FirmManager → open a client dossier (lands on /accounting/chart)
    // 2. await page.goto('/firm/dashboard');
    // 3. await expect(page).toHaveURL(/\/accounting\/chart/);
    // 4. await expect(page.getByRole('heading', { name: /tableau de bord cabinet/i })).not.toBeVisible();
    // 5. await expect(page.locator('.main-header__firm-context')).toContainText('Dossier :');
    // 6. Same with /firm/clients and /firm/governance/time-sheets
  });

  test('reload inside a dossier keeps one coherent state', async ({ page }) => {
    // 1. Login as FirmManager → open a client dossier → /accounting/ledger
    // 2. await page.reload();
    // 3. await expect(page.locator('.main-header__firm-context')).toContainText('Dossier :');
    // 4. await expect(page.getByRole('heading', { name: /tableau de bord cabinet/i })).not.toBeVisible();
    // 5. await expect(page.getByRole('navigation', { name: /navigation principale/i })).toContainText('Comptabilité');
  });

  test('token refresh inside a dossier does not reveal the cabinet area', async ({ page }) => {
    // Needs JwtSettings:ExpiryMinutes shortened on the test API (or page.clock.fastForward).
    // 1. Login as FirmManager → open a client dossier
    // 2. await page.clock.fastForward('16:00'); trigger any API call
    // 3. await expect(page).not.toHaveURL(/\/firm\//);
    // 4. await expect(page.getByRole('heading', { name: /tableau de bord cabinet/i })).not.toBeVisible();
    // 5. await expect(page.getByRole('dialog', { name: /accès refusé/i })).not.toBeVisible();
  });

  test('firm API is refused while a dossier is open', async ({ page }) => {
    // 1. Login as FirmManager → open a client dossier
    // 2. const res = await page.request.get('/api/firm/dashboard');
    // 3. expect(res.status()).toBe(403);
    // 4. expect((await res.json()).success).toBe(false);
    // 5. const clear = await page.request.post('/api/firm/context/clear'); expect(clear.ok()).toBeTruthy();
  });

  test('firm opens vat-declaration without 403 modal', async ({ page }) => {
    // Login as FirmManager → open client dossier → /accounting/vat-declaration
    // await expect(page.getByRole('dialog', { name: /accès refusé/i })).not.toBeVisible();
    // await expect(page.getByRole('heading', { name: /déclaration mensuelle/i })).toBeVisible();
    // await expect(page.getByText(/total à payer/i)).toBeVisible();
  });

  test('honoraires billing smoke — factures / devis / encaissements', async ({ page }) => {
    // Requires E2E_FIRM_AUTH=1 + FirmManager credentials (see CI secrets / local .env).
    // Flow under test after auth:
    // 1. Sidemenu Facturation includes Encaissements (no separate Paiements rail)
    // await expect(page.getByRole('navigation')).toContainText(/Facturation/i);
    // await expect(page.getByRole('navigation')).toContainText(/Encaissements/i);
    //
    // 2. Create draft invoice with activity code, save
    // await page.goto('/firm/billing/invoices/new');
    // select dossier + service (TENUE) → Enregistrer
    //
    // 3. Finaliser → Encaisser via dialog (net + RS) → statut Payée / Partiellement payée
    // await expect(page.getByText(/Validée|Payée|Partiellement payée/i)).toBeVisible();
    // await page.getByRole('button', { name: /Encaisser/i }).click();
    // await page.getByRole('button', { name: /Enregistrer l'encaissement/i }).click();
    //
    // 4. Payments list shows the encaissement
    // await page.goto('/firm/billing/payments');
    // await expect(page.getByText(/Aucun encaissement/i)).not.toBeVisible();
    //
    // 5. Paid invoice must NOT show Encaisser
    // await expect(page.getByRole('button', { name: /^Encaisser$/i })).toHaveCount(0);
    //
    // 6. Créer un avoir depuis l'éditeur (Créer un avoir) → Finaliser l'avoir
    // await page.getByRole('button', { name: /Créer un avoir/i }).click();
    // await page.getByRole('button', { name: /Finaliser l'avoir/i }).click();
  //
    // 7. Avoir list: Nouvel avoir + dialog sélection facture
    // await page.goto('/firm/billing/credit-notes');
    // await page.getByRole('button', { name: /Nouvel avoir/i }).click();
    //
    // await expect(page).toHaveURL(/\/firm\/billing\//);
  });

  test('firm accountant cannot access manager-only cabinet routes', async ({ page }) => {
    // 1. Login as FirmAccountant → sidemenu must not show Facturation (incl. Encaissements),
    //    Rentabilité de collaborateurs, Collaborateurs
    // 2. Direct /firm/collaborateurs → /access-denied (no 403 modal)
    // 3. Direct /firm/billing/invoices → /access-denied
    // 4. Direct /firm/governance/dossier-time-profitability → /access-denied
    // 5. /firm/governance/time-sheets accessible ; no "Analyse rentabilité dossiers" link
    // await expect(page.getByRole('dialog', { name: /accès refusé/i })).not.toBeVisible();
    // await expect(page).toHaveURL(/\/access-denied/);
  });
});

/**
 * Parcours invitation → acceptation/refus (refonte 2026-07). Nécessite deux
 * comptes (admin société + FirmManager cabinet) et Features:AccountingFirms.
 * Documenté ici pour exécution manuelle en staging tant que les tenants de
 * test dédiés ne sont pas provisionnés.
 */
test.describe('Cabinet comptable — invitation & acceptation (staging)', () => {
  const authEnabled = process.env['E2E_FIRM_AUTH'] === '1';

  test.skip(!authEnabled, 'Set E2E_FIRM_AUTH=1 with two dedicated test tenants (company + firm)');

  test('company compares directory cards then sends one request', async ({ page }) => {
    // 1. Login admin société → /settings/accounting-firm
    // 2. await expect(page.getByRole('heading', { name: /cabinet comptable/i })).toBeVisible();
    // 3. Filter by governorate. Cards show name, city, domains and "N° d'inscription"
    //    (never a raw phone). No autocomplete panel.
    // 4. Click "Choisir ce cabinet", fill optional notes, click "Envoyer la demande".
    // 5. Confirm in the confirmation dialog.
    // 6. await expect(page.getByText(/en attente d'acceptation/i)).toBeVisible();
    // 7. await expect(page.getByRole('button', { name: /annuler la demande/i })).toBeVisible();
    // 8. The directory cards are hidden while the request is pending.
  });

  test('company can cancel a pending request', async ({ page }) => {
    // On /settings/accounting-firm with a pending request:
    // click "Annuler la demande" → confirm → the search card reappears.
  });

  test('firm rejects with a reason; company sees it and can re-request', async ({ page }) => {
    // 1. Login FirmManager → /firm/invitations
    // 2. Click "Refuser" → dialog → type a reason → confirm.
    // 3. Sidebar "Invitations" badge decreases WITHOUT a page reload.
    // 4. Login admin société → /settings/accounting-firm shows the rejection
    //    banner with the reason and the search card is available again.
  });

  test('firm accepts; dossier appears and badge clears; company sees active link', async ({ page }) => {
    // 1. FirmManager → /firm/invitations → "Accepter" → confirm → toast.
    // 2. /firm/clients lists the new dossier; sidebar badge back to 0.
    // 3. Company → /settings/accounting-firm shows "Liaison active" (not "Active").
  });

  test('bell shows an in-app notification after each firm decision', async ({ page }) => {
    // After accept/reject, the recipient's header bell badge increments and the
    // dropdown lists the notification with a working navigation link.
  });
});

test.describe('Cabinet comptable — gouvernance (staging)', () => {
  const authEnabled = process.env['E2E_FIRM_AUTH'] === '1';

  test.skip(!authEnabled, 'Set E2E_FIRM_AUTH=1 with dedicated test tenants to run governance flows');

  test('governance workflow: permanent file, timesheet, expense note', async ({ page }) => {
    // 1. Login FirmManager → /firm/dashboard (KPI DP complets / en cours visibles, section gouvernance)
    // 1b. Section « Pilotage décisionnel » visible avec tableaux (échéances, dossiers à risque, …)
    // 1c. Collaborateur cabinet : section pilotage absente
    // 2. Clic KPI « Dossiers permanents complets » → /permanent-files?status=2 → tableau visible
    // 3. « Ouvrir » sur Complet → ?mode=view → titre « Consultation dossier permanent »
    // 4. « Modifier » → wizard étape 6 (pas étape 1)
    // 5. Liste : section « Clients actifs sans dossier permanent » sous le tableau
    // 6. Hadad : « Prochaine action » → Compléter avec ?mode=edit&step=4
    // 7. Si GET /permanent-files échoue → bannière erreur + bouton Réessayer (pas init seule)
    // 8. /firm/governance/time-sheets → select client → submit → validate (manager)
    // 9. /firm/governance/dossier-time-profitability → filters + export PDF
    // 10. /firm/governance/collaborator-rentability → prefill → save snapshot année
    // 11. /firm/governance/expense-notes → create note → submit
  });

  test('timesheet page exposes speed-oriented views', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('timesheetRichUi', '1'));
    await page.goto('/firm/governance/time-sheets');
    await expect(page.getByRole('heading', { name: /feuilles de temps/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^liste$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^semaine$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^jour$/i })).toBeVisible();

    await page.getByRole('button', { name: /^semaine$/i }).click();
    await expect(page.getByText(/vue semaine/i)).toBeVisible();

    await page.getByRole('button', { name: /^jour$/i }).click();
    await expect(page.getByText(/vue jour/i)).toBeVisible();
  });

  test('timesheet rich UI shows calendar KPI and timer', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('timesheetRichUi', '1'));
    await page.goto('/firm/governance/time-sheets');
    await expect(page.getByRole('heading', { name: /feuilles de temps/i })).toBeVisible();

    await page.getByRole('button', { name: /mode enrichi/i }).click();
    await expect(page.getByRole('button', { name: /chronomètre/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /dupliquer la semaine/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /exporter csv/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /ajouter du temps/i })).toBeVisible();
    await expect(page.getByText(/répartition de la période/i)).toBeVisible();
    await expect(page.locator('.grid-wrap')).toBeVisible();
    await expect(page.locator('.day-column').first()).toBeVisible();
    await expect(page.locator('.total-column')).toBeVisible();

    await page.getByRole('button', { name: /ajouter du temps/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: /^enregistrer$/i })).toBeVisible();
  });
});
