# ERP i18n — checklist de release (phases 9–10)

À valider en pré-production avec `erp.arabicEnabled` et `Localization:ArabicMessagesEnabled` activés avant signature client.

## Portes automatiques

```bash
cd src/Frontend/factutrust-web
npm run i18n:verify-phase9
npm run i18n:codemod:mark-ast:check
npm run i18n:parity:template
npm run i18n:parity:ts
npm run build:prod
```

Backend :

```bash
dotnet test src/Backend/tests/FactuTrust.Infrastructure.Tests --filter MessageLocalizer
dotnet test src/Backend/tests/FactuTrust.API.Tests --filter LocalizeApiResponse
```

## Complétude arabe

- [ ] 100 % des clés `messages.fr.arb` / `messages.ar.arb` traduites et revues (pas de repli FR non whitelisté).
- [ ] Catalogue backend (`messages.ar.json` API) aligné sur les écrans de la vague livrée.
- [ ] `e2e/i18n/erp-ar-leak.spec.ts` : 0 fuite de latin de base sur les routes société couvertes.
- [ ] Revue RTL (~60 écrans) bureau + mobile ; `npm run i18n:pluto-rtl` à jour.

## Non-régression française

- [ ] Parité templates / TypeScript vs tag `fr-reference` (scripts `i18n:parity:*`).
- [ ] Captures ou recette manuelle : rendu FR identique au commit de référence (hors sélecteur de langue).
- [ ] Karma + build prod verts.

## Sécurité et performance

- [ ] Pas de nouveau `innerHTML` non sanitisé ; CSP inchangée.
- [ ] Champs identifiants : `appNoBidiControls` / `NotContainBidiControls`.
- [ ] Budgets de perf FR inchangés ; AR dans le budget convenu.

## Activation production

- [ ] Activer en une fois `environment.erp.arabicEnabled` et `Localization:ArabicMessagesEnabled`.
- [ ] Plan de retour arrière documenté : repasser les deux drapeaux à `false` (interface 100 % FR sans revert de code).
- [ ] Suivi post-release : taux de repli boot, messages serveur non traduits, erreurs JS.

## Documentation

- [ ] [DEVELOPER.md](./DEVELOPER.md) et [TRANSLATOR.md](./TRANSLATOR.md) à jour.
- [ ] Glossaire [ar-glossary-erp.md](./ar-glossary-erp.md) partagé avec le traducteur.
