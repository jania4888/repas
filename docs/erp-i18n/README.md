# ERP société — internationalisation (FR/AR)

## Mécanisme

- **Source** : français dans les templates (`i18n="@@id"`, `i18n-attr="@@id"`) et le TypeScript (`$localize`:@@id:…``).
- **ID et placeholders** : ceux du compilateur, extraits par `npm run i18n:extract` (`ng extract-i18n`) dans `src/locale/messages.fr.arb`. Aucune extraction par expression régulière.
- **Catalogue** : `npm run i18n:build` (lancé par `prestart`/`prebuild`/`pretest`) produit `src/assets/i18n/messages.ar.<hash>.json` + manifest. Sources de l'arabe, par priorité : `scripts/i18n/translations-ar/*.json` (par ID), `src/locale/messages.ar.arb` (par ID), `scripts/i18n/phrase-map-*.json` (par texte français exact). Une traduction invalide (placeholders, ICU, HTML, `${`, contrôles bidi, remplissage) est **écartée** : l'ID retombe sur le français avec les bonnes substitutions. Le français n'est jamais injecté dans le catalogue.
- **Runtime** : `@angular/localize` charge le catalogue avant le bootstrap (`src/main.ts` → `erp-boot-locale.ts`, plafond 2 Mio, délai 8 s, repli FR).
- **Direction** : `ErpLocaleService` pose `html[lang][dir]` d'après le **catalogue réellement chargé**, injecte `erp-rtl.css` et persiste `localStorage['instafact_erp_locale']`. Changer de langue recharge l'onglet.
- **Périmètre** : cabinet, portail client, plateforme, inscription cabinet et invitation portail restent en français. Si le catalogue arabe est chargé dans l'un de ces espaces (connexion depuis une page en arabe), l'onglet repart en français (`sessionStorage['instafact_erp_force_fr']`).
- **API** : `localeInterceptor` envoie `X-UI-Locale: ar` uniquement en interface arabe ; `UiLanguageMiddleware` fixe `CurrentUICulture` sans toucher `CurrentCulture`. `LocalizeApiResponseFilter` et `ExceptionHandlingMiddleware` traduisent les enveloppes (message, erreurs) ; `code` et données ne sont jamais traduits — le front teste les **codes**, jamais le texte des messages.

## Commandes

```bash
cd src/Frontend/factutrust-web
npm run i18n:extract            # ID/placeholders réels → src/locale/messages.fr.arb (build complet, ~2 min)
npm run i18n:build              # catalogue runtime ; --strict en CI
npm run i18n:gate               # ID uniques + catalogue strict + parité FR (templates et TS)
npm run i18n:ids                # un @@id ne porte qu'un texte
npm run i18n:parity:template    # rendu FR des templates identique à fr-reference (I18N_FR_REFERENCE pour une autre référence)
npm run i18n:parity:ts          # segments FR du TypeScript identiques à fr-reference (+ bilan global)
npm run i18n:restore-whitespace # rétablit les espaces de bord rognés par un balisage
npm run i18n:tm -- "bon de livraison"   # terminologie déjà traduite
npm run i18n:check
npm run test:erp-i18n
```

Écarts de parité relus et justifiés : `e2e/baselines/fr-static/approved.json` (templates) et
`scripts/i18n/verify/ts-fr-parity.approved.json` (TypeScript). Chaque approbation porte l'empreinte
de l'écart : toute nouvelle modification du fichier la rend caduque.

Backend (catalogue messages) :

```bash
dotnet run --project tools/i18n-backend-extract
dotnet test src/Backend/tests/FactuTrust.Infrastructure.Tests --filter MessageLocalizer
dotnet test src/Backend/tests/FactuTrust.API.Tests --filter LocalizeApiResponse
```

## Guides

- [TRANSLATOR.md](./TRANSLATOR.md) — checklist traduction
- [DEVELOPER.md](./DEVELOPER.md) — checklist développement
- [ar-glossary-erp.md](./ar-glossary-erp.md) — glossaire

## Production

- `environment.erp.arabicEnabled`
- `Localization:ArabicMessagesEnabled` (API)

Les deux drapeaux s'activent ensemble ; les repasser à `false` rend l'interface 100 % française sans revert.
