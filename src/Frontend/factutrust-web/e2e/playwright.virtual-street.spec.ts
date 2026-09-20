import { test, expect } from '@playwright/test';
import {
  installEmptyStreetFixture,
  installFailingStreetFixture,
  installPublicStreetFixtures,
  readStreetCanvasPixels,
  SYNTHETIC_STREET_MAP
} from './helpers/virtual-street.helpers';

test.describe('Visite virtuelle — rue publique', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  test("la page d'accueil propose un lien vers la visite virtuelle", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /visite virtuelle/i }).first()).toBeVisible();
  });

  test('la route /visite-virtuelle affiche la Rue InstaFact', async ({ page }) => {
    await page.goto('/visite-virtuelle');
    await expect(page.getByRole('heading', { name: 'Rue InstaFact' })).toBeVisible();
    await expect(page.getByRole('link', { name: /version accessible/i })).toBeVisible();
  });

  test('canvas 3D : scène réellement prête, pixels rendus et gestes historiques préservés', async ({ page }) => {
    await installPublicStreetFixtures(page);
    await page.goto('/visite-virtuelle');
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    test.skip(reduced, 'Le repli sans scène WebGL reste couvert par le parcours liste.');

    const canvas = page.locator('canvas.street-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('tabindex', '0');
    // Requis (jamais conditionnel) : la scène n'est « prête » qu'après une frame
    // réellement rendue avec le GLB legacy de chaque vitrine attendue attaché.
    await expect(canvas).toHaveAttribute('data-scene-ready', 'true', { timeout: 20_000 });
    await expect(canvas).toHaveAttribute(
      'data-scene-ready-facades',
      String(SYNTHETIC_STREET_MAP.length)
    );
    await expect(canvas).not.toHaveAttribute('data-scene-unavailable', 'true');
    await expect(page.locator('.store-list li')).toHaveCount(SYNTHETIC_STREET_MAP.length);

    // Oracle pixels : lecture corrélée à la frame, plusieurs échantillons non
    // vides et distincts (façade/sol/ciel) — un canvas noir ne suffit pas.
    const pixelStats = await readStreetCanvasPixels(page);
    expect(pixelStats, 'WebGL doit être disponible dans le profil de qualification').not.toBeNull();
    expect(pixelStats!.blank, 'La scène doit produire des pixels non vides').toBe(false);
    expect(pixelStats!.distinctColors, 'Façade, sol et ciel doivent produire des pixels distincts').toBeGreaterThan(1);

    // Attendre la fin de l'intro cinématique (~1,2 s) pour des clics déterministes.
    await page.waitForTimeout(1_400);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Clic au sol (rapide, sans glisser) : aucune activation.
    await page.mouse.click(box!.x + box!.width * 0.08, box!.y + box!.height * 0.92);
    await expect(page).toHaveURL(/\/visite-virtuelle\/?$/);

    // Glisser au-delà du seuil de drag : aucune activation.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 48, cy, { steps: 4 });
    await page.mouse.up();
    await expect(page).toHaveURL(/\/visite-virtuelle\/?$/);

    // Clic façade (pointeur) : ouvre la fiche.
    await page.mouse.click(cx, cy);
    await expect(page).toHaveURL(/\/visite-virtuelle\/mode-demo$/);
    await expect(page.getByRole('heading', { name: 'Maison Démo Mode' })).toBeVisible();

    // Retour rue : la scène se re-prépare explicitement (re-montage complet).
    await page.goBack();
    await expect(canvas).toHaveAttribute('data-scene-ready', 'true', { timeout: 20_000 });

    // Clavier : flèche puis Entrée ouvre aussi la fiche.
    await canvas.press('ArrowRight');
    await canvas.press('Enter');
    await expect(page).toHaveURL(/\/visite-virtuelle\/mode-demo$/);
    await expect(page.getByRole('heading', { name: 'Maison Démo Mode' })).toBeVisible();
  });

  test('carte publique vide : état explicite, aucun canvas 3D monté', async ({ page }) => {
    await installEmptyStreetFixture(page);
    await page.goto('/visite-virtuelle');
    await expect(page.getByText(/Aucune vitrine publiée pour le moment/i)).toBeVisible();
    await expect(page.locator('canvas.street-canvas')).toHaveCount(0);
  });

  test('API publique en erreur : bannière explicite, aucun canvas 3D monté', async ({ page }) => {
    await installFailingStreetFixture(page);
    await page.goto('/visite-virtuelle');
    await expect(page.getByRole('alert')).toContainText(/Impossible de charger la rue virtuelle/i);
    await expect(page.locator('canvas.street-canvas')).toHaveCount(0);
  });

  test('la liste accessible est joignable', async ({ page }) => {
    await page.goto('/visite-virtuelle/liste');
    await expect(page.locator('body')).toContainText(/vitrine|liste|rue/i);
  });

  test('les GLB de façades statiques sont servis (même origine)', async ({ request }) => {
    const files = ['classic.glb', 'modern.glb', 'vintage.glb', 'minimal.glb', 'artisan.glb'];
    for (const name of files) {
      const res = await request.get(`/assets/virtual-street/facades/${name}`);
      expect(res.status(), name).toBe(200);
      const ct = (res.headers()['content-type'] ?? '').toLowerCase();
      if (ct.length > 0) {
        expect(ct).toMatch(/octet-stream|model\/gltf-binary|application\/octet-stream/);
      }
    }
  });

  test('slug vitrine inconnu : état d’erreur explicite et navigation', async ({ page }) => {
    const randomSlug = `zz-no-such-store-${Date.now()}`;
    await page.goto(`/visite-virtuelle/${randomSlug}`, { waitUntil: 'domcontentloaded' });
    // Avec API locale : 404 → message « pas disponible publiquement ». Sans backend : message réseau.
    await expect(page.getByRole('alert')).toContainText(
      /pas disponible publiquement|Impossible de joindre le service des vitrines publiques/i
    );
    await expect(page.getByRole('navigation', { name: 'Navigation visite virtuelle' })).toBeVisible();
  });
});
