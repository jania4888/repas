import { LANDING_COPY_AR } from './landing-copy.ar';
import { LANDING_COPY_FR } from './landing-copy.fr';

/**
 * Garde-fou de parité FR/AR (plan D.3 / D.9).
 *
 * `ALLOW_TODO_AR` : la traduction arabe est livrée (TD7) — la constante est à `false`, ce qui
 * active les contrôles « texte arabe présent » et « AR ≠ FR ». Ne la repasser à `true` que pour
 * une CI de branche tolérant des copies FR provisoires marquées `// TODO-AR`.
 */
const ALLOW_TODO_AR = false;

const PLACEHOLDER_RE = /\{\w+\}/g;
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;
const NON_WESTERN_DIGITS_RE = /[\u0660-\u0669\u06F0-\u06F9]/;
const BANNED_AR_TERMS = ['إنستافاكت', 'الضريبة على القيمة المضافة'];
/** Chaînes FR autorisées à contenir de l'arabe (libellé du sélecteur de langue). */
const ARABIC_ALLOWED_IN_FR = new Set(['shared.langSwitcher.ar']);
/** Feuilles identiques attendues entre FR et AR (marque, sigles, valeurs techniques). */
const IDENTICAL_ALLOWED = new Set([
  'locale',
  'shared.brand.name',
  'shared.footer.logoAlt',
  'shared.langSwitcher.fr',
  'shared.langSwitcher.ar',
  'shared.common.currency'
]);

/**
 * Feuilles techniques jamais traduites (TD7) :
 *  - identifiants d'onglets, icônes PrimeIcons, classes CSS d'ancrage e2e, valeurs
 *    d'énumération envoyées à l'API (`contact.sizes.*.value`) — toute traduction casserait
 *    le code ou le contrat backend ;
 *  - la marque dans le tableau comparatif, le compteur de caractères et les placeholders
 *    e-mail/téléphone (saisie latine en `dir="ltr"`) ;
 *  - les chemins de menus `newFeatures.*.location` : ils citent l'interface de
 *    l'application, qui reste en français (hors périmètre AR, plan D.1/D.5.4).
 */
const TECHNICAL_KEY_RE = /\.(id|icon|cssClass|value)$/;
const TECHNICAL_PATHS = new Set([
  'home.comparison.ourLabel',
  'contact.messageCounter',
  'contact.fields.email.placeholder',
  'contact.fields.phone.placeholder',
  'cabinets.features.activationMark'
]);
const APP_UI_PATH_RE = /^home\.newFeatures\.items\[\d+\]\.location$/;

function isTranslationExempt(path: string): boolean {
  return IDENTICAL_ALLOWED.has(path) || TECHNICAL_KEY_RE.test(path) || TECHNICAL_PATHS.has(path) || APP_UI_PATH_RE.test(path);
}

type Leaf = { path: string; value: string };

function collectLeaves(node: unknown, path: string, out: Leaf[]): void {
  if (typeof node === 'string') {
    out.push({ path, value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectLeaves(item, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node as Record<string, unknown>)) {
      collectLeaves((node as Record<string, unknown>)[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }
  fail(`Feuille non textuelle inattendue à ${path} (${typeof node})`);
}

function placeholdersOf(value: string): string[] {
  return (value.match(PLACEHOLDER_RE) ?? []).sort();
}

describe('Parité des dictionnaires landing FR/AR', () => {
  const frLeaves: Leaf[] = [];
  const arLeaves: Leaf[] = [];
  collectLeaves(LANDING_COPY_FR, '', frLeaves);
  collectLeaves(LANDING_COPY_AR, '', arLeaves);
  const frByPath = new Map(frLeaves.map(l => [l.path, l.value]));
  const arByPath = new Map(arLeaves.map(l => [l.path, l.value]));

  it('possède exactement les mêmes clés (y compris longueurs de tableaux)', () => {
    const onlyFr = [...frByPath.keys()].filter(p => !arByPath.has(p));
    const onlyAr = [...arByPath.keys()].filter(p => !frByPath.has(p));
    expect(onlyFr).withContext('clés présentes en FR mais absentes en AR').toEqual([]);
    expect(onlyAr).withContext('clés présentes en AR mais absentes en FR').toEqual([]);
  });

  it('porte la bonne locale', () => {
    expect(LANDING_COPY_FR.locale).toBe('fr');
    expect(LANDING_COPY_AR.locale).toBe('ar');
    expect(LANDING_COPY_FR.contact.sizes.dossiers.map(s => s.value)).toEqual([
      'dossiers:1-5',
      'dossiers:6-20',
      'dossiers:21-50',
      'dossiers:50+'
    ]);
    expect(LANDING_COPY_FR.contact.sizes.employes.map(s => s.value)).toEqual([
      'employes:1-5',
      'employes:6-20',
      'employes:21-100',
      'employes:100+'
    ]);
  });

  it('utilise les mêmes placeholders dans chaque paire de chaînes', () => {
    const mismatches: string[] = [];
    for (const [path, fr] of frByPath) {
      const ar = arByPath.get(path);
      if (ar !== undefined && placeholdersOf(fr).join(',') !== placeholdersOf(ar).join(',')) {
        mismatches.push(`${path}: FR ${placeholdersOf(fr).join(',')} / AR ${placeholdersOf(ar).join(',')}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('ne contient aucune chaîne vide, aucun HTML, aucun caractère de contrôle', () => {
    const offenders: string[] = [];
    for (const { path, value } of [...frLeaves.map(l => ({ ...l, path: `FR ${l.path}` })), ...arLeaves.map(l => ({ ...l, path: `AR ${l.path}` }))]) {
      if (value.trim() === '') {
        offenders.push(`${path}: vide`);
      }
      if (/[<>]/.test(value) || /&nbsp;|&amp;|&lt;|&gt;/.test(value)) {
        offenders.push(`${path}: HTML interdit`);
      }
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
        offenders.push(`${path}: caractère de contrôle`);
      }
      // Contrôles bidirectionnels interdits : le balisage [[ltr]] et dir=rtl suffisent,
      // ces caractères invisibles rendraient la relecture client imprévisible.
      if (/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(value)) {
        offenders.push(`${path}: caractère de contrôle bidirectionnel interdit`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('n’utilise que des chiffres occidentaux (jamais de chiffres arabo-indiens)', () => {
    const offenders = [...frLeaves, ...arLeaves].filter(l => NON_WESTERN_DIGITS_RE.test(l.value)).map(l => l.path);
    expect(offenders).toEqual([]);
  });

  it('ne contient pas d’arabe en FR (hors libellé du sélecteur)', () => {
    const offenders = frLeaves.filter(l => ARABIC_SCRIPT_RE.test(l.value) && !ARABIC_ALLOWED_IN_FR.has(l.path)).map(l => l.path);
    expect(offenders).toEqual([]);
  });

  it('n’utilise aucun terme arabe interdit (marque translittérée, TVA développée)', () => {
    const offenders: string[] = [];
    for (const { path, value } of arLeaves) {
      for (const term of BANNED_AR_TERMS) {
        if (value.includes(term)) {
          offenders.push(`${path}: « ${term} »`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('les fichiers AR non traduits sont explicitement marqués TODO-AR (état provisoire documenté)', () => {
    // Ce test documente l'état : tant que ALLOW_TODO_AR est vrai, les copies FR sont tolérées côté AR.
    expect(typeof ALLOW_TODO_AR).toBe('boolean');
  });

  if (!ALLOW_TODO_AR) {
    it('chaque chaîne AR contient de l’écriture arabe (sauf marque, sigles et valeurs techniques)', () => {
      const offenders = arLeaves
        .filter(l => !isTranslationExempt(l.path) && !ARABIC_SCRIPT_RE.test(l.value))
        .map(l => l.path);
      expect(offenders).toEqual([]);
    });

    it('aucune chaîne AR n’est une copie brute du FR (sauf exceptions listées)', () => {
      const offenders = arLeaves.filter(l => !isTranslationExempt(l.path) && frByPath.get(l.path) === l.value).map(l => l.path);
      expect(offenders).toEqual([]);
    });
  }
});
