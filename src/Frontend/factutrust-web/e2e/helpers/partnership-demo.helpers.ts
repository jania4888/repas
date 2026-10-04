/**
 * Helpers for partnership expert-comptable demo video recording.
 */
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
export const PARTNERSHIP_RAW_DIR = path.join(
  PROJECT_ROOT,
  'docs',
  'partnership',
  'expert-comptable',
  'raw'
);

export function getDemoCredentials(): { email: string; password: string } | null {
  const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
  const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;
  if (email && password) return { email, password };

  const credsFile = path.join(
    PROJECT_ROOT,
    'docs',
    'partnership',
    'expert-comptable',
    '.demo-credentials.json'
  );
  if (fs.existsSync(credsFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(credsFile, 'utf-8')) as { email?: string; password?: string };
      if (saved.email && saved.password) {
        return { email: saved.email, password: saved.password };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function logScene(chapterId: string, label: string): void {
  console.log(`[SCENE:${chapterId}] ${label}`);
}

export async function hideAiFab(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `.ai-fab, .ai-assistant-panel { display: none !important; }`
  });
}

export async function pause(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}

export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('load');
  await pause(page, 600);
}

export async function scrollToSection(page: Page, selector: string): Promise<void> {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await pause(page, 1500);
}

/** Login and land on dashboard (handles warehouse selection when needed). */
export async function loginAsDemoUser(page: Page): Promise<void> {
  const creds = getDemoCredentials();
  if (!creds) {
    throw new Error('DOC_EMAIL and DOC_PASSWORD must be set for partnership video recording.');
  }

  await page.goto('/auth/login');
  await waitForAppReady(page);
  await page.fill('input[formcontrolname="email"]', creds.email);
  await page.locator('p-password[formcontrolname="password"] input').fill(creds.password);
  await page.click('button[type="submit"]');

  // 60 s : à froid, le serveur de dev compile les routes paresseuses authentifiées
  // au premier accès (surtout depuis Angular 20) — 20 s ne suffisent pas en CI.
  await page.waitForURL(/\/(dashboard|auth\/select-warehouse)/, { timeout: 60000 });

  if (page.url().includes('/auth/select-warehouse')) {
    const warehouseName = process.env.DOC_WAREHOUSE;
    if (warehouseName) {
      await page.getByText(warehouseName, { exact: false }).first().click();
    }
    await page.click('button:has-text("Continuer"), button:has-text("Confirmer")').catch(async () => {
      await page.locator('button.p-button, button.btn-primary').first().click();
    });
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
  }

  await page.waitForLoadState('load');
  await hideAiFab(page);
}

export async function gotoAndSettle(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await waitForAppReady(page);
}

export function ensureRawDir(): void {
  fs.mkdirSync(PARTNERSHIP_RAW_DIR, { recursive: true });
}

export async function finishChapterRecording(page: Page, chapterFileName: string): Promise<void> {
  ensureRawDir();
  const dest = path.join(PARTNERSHIP_RAW_DIR, chapterFileName);

  await pause(page, 800);

  const video = page.video();
  if (video) {
    try {
      await Promise.race([
        video.saveAs(dest),
        new Promise((_, reject) => setTimeout(() => reject(new Error('saveAs timeout')), 15_000))
      ]);
      console.log(`  Video saved: ${dest}`);
      return;
    } catch {
      // fall through to rename latest webm
    }
  }

  const files = fs
    .readdirSync(PARTNERSHIP_RAW_DIR)
    .filter(f => f.endsWith('.webm') && f !== chapterFileName && !f.startsWith('chapitre-'))
    .map(f => ({ f, mtime: fs.statSync(path.join(PARTNERSHIP_RAW_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length > 0) {
    fs.renameSync(path.join(PARTNERSHIP_RAW_DIR, files[0].f), dest);
    console.log(`  Video renamed: ${dest}`);
    return;
  }

  const chapterFiles = fs.readdirSync(PARTNERSHIP_RAW_DIR).filter(f => f === chapterFileName);
  if (chapterFiles.length > 0) {
    console.log(`  Video already present: ${dest}`);
    return;
  }

  console.warn(`No video captured for ${chapterFileName}`);
}

export async function saveChapterVideoFromPage(page: Page, chapterFileName: string): Promise<void> {
  return finishChapterRecording(page, chapterFileName);
}

export async function saveChapterVideo(
  testInfo: import('@playwright/test').TestInfo,
  chapterFileName: string
): Promise<void> {
  ensureRawDir();
  const video = testInfo.video;
  if (!video) {
    console.warn(`No video attached for ${chapterFileName}`);
    return;
  }
  const dest = path.join(PARTNERSHIP_RAW_DIR, chapterFileName);
  await video.saveAs(dest);
  console.log(`  Video saved: ${dest}`);
}
