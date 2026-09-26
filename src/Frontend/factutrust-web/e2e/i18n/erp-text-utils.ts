import type { Page } from '@playwright/test';

export type ErpTextSnapshot = {
  title: string;
  visibleText: string;
  placeholders: string[];
  titles: string[];
  ariaLabels: string[];
  alts: string[];
};

/** Texte visible normalisé (espaces, sans scripts/styles). */
export async function collectVisibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest('[aria-hidden="true"]')) {
          return NodeFilter.FILTER_REJECT;
        }
        const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        return t.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const parts: string[] = [];
    while (walker.nextNode()) {
      parts.push((walker.currentNode.textContent ?? '').replace(/\s+/g, ' ').trim());
    }
    return parts.join('\n').replace(/\n{2,}/g, '\n').trim();
  });
}

function collectAttr(page: Page, attr: string): Promise<string[]> {
  return page.evaluate(
    (name) =>
      Array.from(document.querySelectorAll(`[${name}]`))
        .map(el => (el.getAttribute(name) ?? '').trim())
        .filter(Boolean)
        .sort(),
    attr
  );
}

export async function snapshotErpText(page: Page): Promise<ErpTextSnapshot> {
  const title = await page.title();
  const visibleText = await collectVisibleText(page);
  const placeholders = await collectAttr(page, 'placeholder');
  const titles = await collectAttr(page, 'title');
  const ariaLabels = await collectAttr(page, 'aria-label');
  const alts = await collectAttr(page, 'alt');
  return { title, visibleText, placeholders, titles, ariaLabels, alts };
}

/** Mots français typiques (accents ou mots outils) hors liste blanche. */
const FRENCH_LEAK =
  /\b(?:de|du|des|le|la|les|un|une|et|ou|pour|avec|sans|votre|vous|nous|est|sont|être|avoir|pas|plus|tous|toute|toutes|connexion|enregistrer|annuler|supprimer|modifier|ajouter|rechercher|paramètres|facture|client|fournisseur|commande|stock|trésorerie|comptabilité|tableau|bord)\b|[àâäéèêëïîôùûüçœæ]/iu;

const DEFAULT_WHITELIST = [
  'InstaFact',
  'TEJ',
  'CRM',
  'POS',
  'TND',
  'NIF',
  'RIB',
  'IBAN',
  'PDF',
  'CSV',
  'API',
  'IA',
  'URL',
  'email',
  'Email',
  'Français'
];

export function findFrenchLeaks(text: string, whitelist: string[] = DEFAULT_WHITELIST): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const leaks: string[] = [];
  for (const token of tokens) {
    if (whitelist.some(w => token.includes(w))) continue;
    if (FRENCH_LEAK.test(token)) {
      leaks.push(token);
    }
  }
  return [...new Set(leaks)];
}

/** Segments latins (≥3 car.) hors liste blanche — fuites FR grossières en UI AR. */
const LATIN_CHUNK = /[A-Za-zÀ-ÖØ-öø-ÿœæ]{3,}/g;

export function findBasicLatinLeaks(text: string, whitelist: string[] = DEFAULT_WHITELIST): string[] {
  const leaks: string[] = [];
  let m;
  LATIN_CHUNK.lastIndex = 0;
  while ((m = LATIN_CHUNK.exec(text)) !== null) {
    const chunk = m[0];
    if (whitelist.some(w => chunk.includes(w))) continue;
    leaks.push(chunk);
  }
  return [...new Set(leaks)];
}
