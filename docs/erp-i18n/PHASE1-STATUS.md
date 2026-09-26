# Phase 1 — statut des filets de sécurité i18n ERP

Dernière mise à jour : 2026-09-25 (implémentation scripts + CI).

## Scripts ajoutés

| Commande | Rôle |
|----------|------|
| `npm run i18n:parity:template` | Canonicalise les templates (`parseTemplate`, `preserveWhitespaces: false`) vs tag `fr-reference` ; `--write-baseline` → `e2e/baselines/fr-static/` |
| `npm run i18n:parity:ts` | Multiensembles de littéraux TS (périmètre ERP société) vs `fr-reference` |

## Baselines Karma / build / .NET

| Porte | Commande | Résultat local (2026-09-25) |
|-------|----------|-------------------------------|
| Runtime AR | `npm run i18n:build` | OK — 5386 clés, manifest + `messages.ar.<hash>.json` |
| Validation | `npm run i18n:check` | OK — mode legacy `messages.ar.json` (pas encore de paire ARB) |
| Karma | `npx ng test --watch=false --browsers=ChromeHeadless` | _À exécuter_ (non lancé ici — ~plusieurs minutes) |
| Build prod | `npm run build:prod` | _À exécuter_ |
| Backend | `dotnet build src/Backend/FactuTrust.sln -c Release` | OK — 0 erreur, 17 avertissements (~13 min) |
| Parité TS | `npm run i18n:parity:ts` | Échec attendu — 6166 écarts multiset (~8 min) |
| Parité templates | `npm run i18n:parity:template` | Échec attendu — 5 écarts / 509 templates (~10 min) ; CI `continue-on-error: true` |

## E2E

- `e2e/i18n/erp-ar-leak.spec.ts` v2 : `localStorage['instafact_erp_locale']=ar` via `addInitScript`, sans sélecteur login ; pièces jointes `findBasicLatinLeaks`.

## Prochaines étapes

1. `npm run i18n:parity:template -- --write-baseline` après gel FR si on veut comparer à des snapshots statiques.
2. Introduire `src/locale/messages.fr.arb` + `messages.ar.arb` (`npm run i18n:extract`) pour activer les contrôles ARB stricts (`identical-fr`, `مسمّى`).
3. Raccourcir les scripts de parité (cache `git cat-file --batch`) si le temps d’exécution devient gênant en local.
