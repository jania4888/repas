/**
 * Synthetic public-street fixtures and WebGL oracles for the virtual-street
 * baseline E2E. Data is fully synthetic (`.invalid` contact, demo names) and
 * shaped exactly like the real public DTOs (`StreetMapEntry`, `StorefrontDetail`,
 * `ApiResponse<T>` in `src/app/features/virtual-street/services/street-api.service.ts`).
 */
import type { Page } from '@playwright/test';

export interface SyntheticStreetMapEntry {
  slug: string;
  displayName: string;
  tagline: string | null;
  publicLogoUrl: string | null;
  category: number;
  streetPositionIndex: number;
  facadeTheme: number;
  brandPrimaryColorHex: string;
  brandSecondaryColorHex: string;
}

/** Single deterministic storefront: exact-count assertions stay stable. */
export const SYNTHETIC_STREET_MAP: readonly SyntheticStreetMapEntry[] = [
  {
    slug: 'mode-demo',
    displayName: 'Maison Démo Mode',
    tagline: 'Boutique de démonstration',
    publicLogoUrl: null,
    category: 0,
    streetPositionIndex: 0,
    facadeTheme: 1,
    brandPrimaryColorHex: '#7c2d12',
    brandSecondaryColorHex: '#f8fafc'
  }
];

const SYNTHETIC_STOREFRONT_DETAIL = {
  id: 'synthetic-demo-1',
  slug: 'mode-demo',
  displayName: 'Maison Démo Mode',
  tagline: 'Boutique de démonstration',
  descriptionMarkdown: null,
  brandPrimaryColorHex: '#7c2d12',
  brandSecondaryColorHex: '#f8fafc',
  publicLogoUrl: null,
  publicCoverImageUrl: null,
  category: 0,
  facadeTheme: 1,
  publicContactEmail: 'demo@example.invalid',
  publicContactPhone: null,
  publicContactWhatsApp: null,
  orderSubmissionEnabled: false,
  streetPositionIndex: 0
};

function fulfillJson(route: import('@playwright/test').Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: status < 400, data: status < 400 ? data : null, message: null, errors: status < 400 ? null : ['synthetic-error'] })
  });
}

/** Nonempty street + matching fiche/catalogue so navigation targets render for real. */
export async function installPublicStreetFixtures(page: Page): Promise<void> {
  await page.route('**/api/public/street/map', route => fulfillJson(route, SYNTHETIC_STREET_MAP));
  await page.route('**/api/public/street/storefronts/mode-demo', route =>
    fulfillJson(route, SYNTHETIC_STOREFRONT_DETAIL)
  );
  await page.route('**/api/public/street/storefronts/mode-demo/products**', route =>
    fulfillJson(route, { items: [], page: 1, pageSize: 24, totalCount: 0 })
  );
}

/** Published-but-empty street: the page must show the empty state and mount no canvas. */
export async function installEmptyStreetFixture(page: Page): Promise<void> {
  await page.route('**/api/public/street/map', route => fulfillJson(route, []));
}

/** Failing public API: the page must show its own error banner, no canvas. */
export async function installFailingStreetFixture(page: Page): Promise<void> {
  await page.route('**/api/public/street/map', route => fulfillJson(route, null, 500));
}

export interface StreetCanvasPixelStats {
  /** RGBA samples taken on the drawing buffer just after a real render. */
  samples: string[];
  /** True when every sample is fully transparent black (nothing rendered). */
  blank: boolean;
  /** Distinct colors across samples (facade/ground/sky must differ). */
  distinctColors: number;
}

/**
 * Reads WebGL pixels inside a requestAnimationFrame callback so the samples are
 * taken in the same frame tick right after the scene's own render (the drawing
 * buffer without `preserveDrawingBuffer` is only valid there). Returns null
 * when no WebGL context exists — callers must treat that as a hard failure on
 * WebGL-capable qualification profiles, never as a skip.
 */
export async function readStreetCanvasPixels(page: Page): Promise<StreetCanvasPixelStats | null> {
  return page.evaluate(
    () =>
      new Promise<StreetCanvasPixelStats | null>(resolve => {
        const el = document.querySelector('canvas.street-canvas');
        if (!(el instanceof HTMLCanvasElement)) {
          resolve(null);
          return;
        }
        const gl = el.getContext('webgl2') ?? el.getContext('webgl');
        if (!gl) {
          resolve(null);
          return;
        }
        requestAnimationFrame(() => {
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const points: Array<readonly [number, number]> = [
            [0.5, 0.5],
            [0.25, 0.35],
            [0.75, 0.35],
            [0.15, 0.9],
            [0.85, 0.85]
          ];
          const samples: string[] = [];
          for (const [fx, fy] of points) {
            const px = new Uint8Array(4);
            const x = Math.max(0, Math.min(w - 1, Math.floor(w * fx)));
            const y = Math.max(0, Math.min(h - 1, Math.floor(h * fy)));
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            samples.push(Array.from(px).join(','));
          }
          resolve({
            samples,
            blank: samples.every(s => s === '0,0,0,0'),
            distinctColors: new Set(samples).size
          });
        });
      })
  );
}
