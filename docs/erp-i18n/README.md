# ERP société — internationalisation (FR/AR)

## Mécanisme

- **Source** : français dans les templates (`i18n`, `i18n-*`) et le TypeScript (`$localize`).
- **Runtime** : `@angular/localize` charge `src/assets/i18n/messages.ar.json` avant le bootstrap (`src/main.ts` → `erp-boot-locale.ts`).
- **Direction** : `ErpLocaleService` pose `html[lang][dir]`, injecte `erp-rtl.css` et persiste `localStorage['instafact_erp_locale']`.
- **API** : `localeInterceptor` envoie `X-UI-Locale: ar` uniquement en interface arabe ; `UiLanguageMiddleware` fixe `CurrentUICulture` sans toucher `CurrentCulture`. `LocalizeApiResponseFilter` traduit les enveloppes API lorsque l’arabe est actif.

## Commandes

```bash
cd src/Frontend/factutrust-web
npm run i18n:codemod:mark
npm run i18n:codemod:assign
npm run i18n:build
npm run i18n:pluto-rtl
npm run i18n:backend-labels
npm run i18n:check
npm run test:erp-i18n
```

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
