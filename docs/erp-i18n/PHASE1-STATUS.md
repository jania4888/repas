# Statut du chantier i18n ERP

Dernière mise à jour : 2026-09-27 — lots 0 à 5 livrés sur `i18n/erp-arabe` (worktree `C:\wt\ar`).
Les drapeaux arabes restent **OFF** en production (`environment.erp.arabicEnabled`,
`Localization:ArabicMessagesEnabled`).

## Portes (base `fr-reference` = `32a2f4c1`)

| Porte | Commande | Résultat |
|-------|----------|----------|
| Toutes | `npm run i18n:gate` | vert (règles de traduction, ID, concaténations, valeurs, catalogue strict, parités) |
| ID uniques | `npm run i18n:ids` | 17 910 messages, tous à `@@id` sauf 18 ICU imbriqués (ID calculé par le compilateur), 0 collision |
| Phrases découpées | `node scripts/i18n/gate/check-concat-messages.mjs` | 0 (27 fusionnées en un seul `$localize`) |
| Messages-valeurs | `npm run i18n:values` | 0 (enum, clé, URL, classe d'icône… jamais en `$localize`) |
| Catalogue AR | `node scripts/i18n/build-runtime-translations.mjs --strict` | **14 614 / 14 933** messages, 0 rejet, 1 430 Kio (plafond 2 Mio) |
| Parité FR templates | `npm run i18n:parity:template` | 0 écart non justifié (113 approuvés, motif par template) |
| Parité FR TypeScript | `npm run i18n:parity:ts` | 0 écart non justifié (57 approuvés) |
| Codemods | `npm run i18n:codemod:test` | vert (templates, ternaires, littéraux TS) |
| Karma | `npx ng test --watch=false --browsers=ChromeHeadless` | 16 échecs, **identiques à fr-reference** |
| Backend | `dotnet test --filter MessageLocalizer\|LocalizeApiResponse\|UiLanguage\|ExceptionHandling…` | Infrastructure 22/22, API 28/28 |

Les 319 messages non traduits sont volontaires : sigles et exemples identiques (TVA, NIF, IBAN…),
traces de diagnostic, en-tête CSV d'export, titre du PDF d'avoir, et le ticket POS (documents : français).

## Livré

- **Lot 1 — outillage** : extraction par le compilateur (`ng extract-i18n`), catalogue sans repli français,
  validation stricte (placeholders, ICU, bidi, HTML), unicité des ID, parités FR sur AST.
- **Lot 2 — sûreté** : codes d'erreur stables (`FailWithCode`) pour tous les cas où le front lisait le
  texte français d'une erreur ; formats de date sans texte français.
- **Lot 3 — balisage** :
  - codemod AST des templates (2 000 textes/attributs, phrases entières avec éléments en ligne) ;
  - ternaires de libellés → ICU `select` ; pluriels bricolés → ICU `plural` ou `erpPlural` ;
  - classifieur TS (DISPLAY / NEVER / REVIEW) + codemod : 3 593 littéraux en `$localize`, jamais les
    valeurs, clés, routes, fichiers, journaux, charges d'API ni prompts IA.
- **Lot 4 — traduction** : toutes les vagues v1 à v7 (terminologie tunisienne, voir `ar-glossary-erp.md`),
  pluriels arabes par catégorie CLDR (zéro, un, deux, 3–10, 11+).
- **Lot 5 — backend** : extracteur Roslyn étendu (2 850 messages), tous les messages de périmètre société
  traduits ; `MessageLocalizer` essaie les gabarits du plus spécifique au plus générique.

## Corrigé en chemin

- Locale `ar-TN` hybride : la fonction de pluriel était perdue au clonage (plantage des ICU en arabe).
- Traduction arabe qui injectait le « s » français (`فصلs`) via des placeholders de pluriel.
- Ticket POS : marqueurs i18n retirés (reste en français, `lang="fr" dir="ltr"`).

## Reste à faire

- **REVIEW** (~6 800 littéraux TS non classés, surtout techniques) : revue ciblée des tableaux de libellés,
  des valeurs affichées via `labelFr`, et des colonnes partagées entre tableau et export Excel client.
- **Lot 6 — RTL** : dialogues, formulaires, tableaux (`erp-rtl.css`, `dir="ltr"` ciblé sur montants et codes).
- **Lot 7 — recette** : E2E authentifié sur toutes les routes société (fuites latines), captures, revue sécurité.
- **Relecture native** de chaque vague (`npm run i18n:export-review`) avant activation.
- **Lot 8 — activation** : uniquement sur feu vert explicite (`Deploy-Hostinger.ps1`) ; retour arrière = drapeaux à `false`.
