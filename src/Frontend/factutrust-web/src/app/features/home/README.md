# Landing publique (`features/home`)

Pages publiques bilingues FR/AR : `/`, `/cabinets-comptables`, `/ar`, `/ar/cabinets-comptables`.
Documentation complète : `docs/landing/i18n.md` (i18n), `docs/landing/ar-glossary.md` (terminologie),
`docs/runbooks/public-contact-requests.md` (formulaire de contact).

## Règles obligatoires (gardées par CI)

1. **Aucune chaîne visible en dur** dans les templates : tout libellé, `aria-label`, `alt`,
   `title` ou `placeholder` vient du dictionnaire (`t().…` via `LandingCopyService`).
   Garde-fou : `npm run check:landing-copy`.
2. **CSS logique uniquement** dans les `styles` des composants : `margin-inline-start`,
   `padding-inline-end`, `inset-inline-start`, `text-align: start`, `border-start-start-radius`…
   — jamais `margin-left`, `padding-right`, `left:`, `text-align: left`… (le miroir RTL est
   automatique). Les rares exceptions (centrage `translate(-50%)`, retrait hors écran) portent
   un commentaire `/* rtl-ok */`. Garde-fou : `npm run check:landing-css`.
3. **Liens internes localisés** : tout `routerLink` vers la landing passe par
   `homePath(locale)` / `cabinetsPath(locale)` / `localizedPath(path, locale)`
   (`i18n/landing-locale.util.ts`) — jamais de `"/cabinets-comptables"` en dur (la version
   arabe est `/ar/cabinets-comptables`). Les liens `/auth/*` et `/visite-virtuelle` restent
   non préfixés.
4. **CTA d'inscription** : toujours `<app-landing-cta>` (état ouvert/fermé dynamique) —
   jamais de lien direct vers `/auth/register*` dans un template de section.
5. **Nombres, prix, e-mails, téléphones** : en chiffres occidentaux et sens LTR dans les deux
   langues (`.ltr-inline` / `<span dir="ltr">` / marqueur `[[ltr]]` du dictionnaire).

## Structure

| Élément | Rôle |
|---|---|
| `home.routes.ts` | Routes `''` (FR) + `ar` conditionnelles (`landingCopyGuard` charge le chunk AR ; repli `ar/**` → FR si désactivé). |
| `landing-shell.component.ts` | Coquille : locale → thème Chain (LTR/RTL) → SEO par page ; restauration à la sortie. |
| `content/{fr,ar}/*.ts` | Dictionnaires FR (source) et AR ; parité vérifiée par `landing-copy.parity.spec.ts`. |
| `shared/landing-cta/` | Bouton d'action unique (ouvert → `/auth/register*`, fermé → formulaire de contact). |
| `shared/landing-lang-switcher/` | Sélecteur FR/العربية (visible si `environment.landing.arabicEnabled`). |
| `shared/public-header/`, `shared/public-footer/` | En-tête et pied de page publics. |
| `sections/*-section/` | Sections de l'accueil (ordre figé dans `home.component.ts`, plan § 5.2). |
| `cabinets/` | Page « Cabinets comptables » (9 blocs). |
| `contact/` | Section + formulaire de demande d'accès/démo (`#contact`, `?objet=`). |

## Tests

- Unitaires : `npx ng test --watch=false --browsers=ChromeHeadless --include="**/features/home/**"`.
- Gardes : `npm run test:landing` (copy + CSS).
- E2e (dev server sur :4200, API simulée par `page.route`) :
  `npx playwright test e2e/landing-smoke.spec.ts e2e/landing-cabinets.spec.ts e2e/landing-contact.spec.ts e2e/landing-i18n.spec.ts --project=chromium`.
- Captures de référence : `LANDING_SCREENSHOTS_DIR=/tmp/shots npx playwright test e2e/capture-landing-screenshots.spec.ts --project=chromium`
  (écrire directement dans `docs/` pendant que le dev server tourne déclenche un rechargement HMR).

## Activation de l'arabe en production

`environment.prod.ts → landing.arabicEnabled: true`, **uniquement après** que
`docs/landing/ar-copy-review.md` est 100 % « Validé » (porte client, plan D.6.3).
Rollback : repasser à `false` — le sélecteur disparaît, `/ar/**` redirige vers le FR,
aucune feuille RTL n'est chargée.
