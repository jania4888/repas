# Statut du chantier i18n ERP

Dernière mise à jour : 2026-09-27 — lots 0 à 5 livrés sur `i18n/erp-arabe` (worktree `C:\wt\ar`),
passe « REVIEW » des littéraux TS terminée.
Les drapeaux arabes restent **OFF** en production (`environment.erp.arabicEnabled`,
`Localization:ArabicMessagesEnabled`).

## Portes (base `fr-reference` = `32a2f4c1`)

| Porte | Commande | Résultat |
|-------|----------|----------|
| Toutes | `npm run i18n:gate` | vert (règles de traduction, ID, concaténations, payloads IA, valeurs, catalogue strict, parités) |
| ID uniques | `npm run i18n:ids` | 20 097 messages, tous à `@@id` sauf 18 ICU imbriqués (ID calculé par le compilateur), 0 collision |
| Phrases découpées | `node scripts/i18n/gate/check-concat-messages.mjs` | 0 (32 fusionnées en un seul `$localize`) |
| Payloads IA | `node scripts/i18n/gate/check-ai-payload-messages.mjs` | 0 `$localize` dans le contexte d'écran envoyé au LLM ni dans les fichiers de prompts |
| Messages-valeurs | `npm run i18n:values` | 0 (enum, clé, URL, classe d'icône… jamais en `$localize`) |
| Catalogue AR | `node scripts/i18n/build-runtime-translations.mjs --strict` | **16 614 / 16 930** messages, 0 rejet, 1 639 Kio (cible 1,75 Mio, plafond 2 Mio) |
| Parité FR templates | `npm run i18n:parity:template` | 0 écart non justifié (113 approuvés, motif par template) |
| Parité FR TypeScript | `npm run i18n:parity:ts` | 0 écart non justifié (63 approuvés) |
| Codemods | `npm run i18n:codemod:test` | vert (templates, ternaires, littéraux TS, listes d'approbation) |
| Karma | `npx ng test --watch=false --browsers=ChromeHeadless` | 16 échecs, **identiques à fr-reference** |
| Backend | `dotnet test --filter MessageLocalizer\|LocalizeApiResponse\|UiLanguage\|ExceptionHandling…` | Infrastructure 23/23 (dont marqueur front gardé en français), API 28/28 |

Les 316 messages non traduits sont volontaires : sigles et exemples identiques (TVA, NIF, IBAN…),
libellés internes de ng-bootstrap, traces de diagnostic.

**Cible de taille du catalogue** : relevée de 1,5 à 1,75 Mio (plafond dur du chargeur : 2 Mio). À couverture
complète, le catalogue pèse ~1,6 Mio dont ~51 % d'ID ; raccourcir les ID ne gagnerait que ~33 Kio.
Transfert compressé : ~370 Kio.

## Livré

- **Lot 1 — outillage** : extraction par le compilateur (`ng extract-i18n`), catalogue sans repli français,
  validation stricte (placeholders, ICU, bidi, HTML, jetons `{x}` et `{{x}}` identiques à la source),
  unicité des ID, parités FR sur AST. Les blancs de bord de la source sont repris dans la traduction
  (écart icône/libellé, suffixe concaténé).
- **Lot 2 — sûreté** : codes d'erreur stables (`FailWithCode`) pour tous les cas où le front lisait le
  texte français d'une erreur ; formats de date sans texte français.
- **Lot 3 — balisage** :
  - codemod AST des templates (2 000 textes/attributs, phrases entières avec éléments en ligne) ;
  - ternaires de libellés → ICU `select` ; pluriels bricolés → ICU `plural` ou `erpPlural` ;
  - classifieur TS (DISPLAY / NEVER / REVIEW) + codemod : 3 593 littéraux DISPLAY en `$localize` ;
  - passe REVIEW : ~1 230 littéraux relus fichier par fichier (listes d'approbation `--approve`, dont
    dictionnaires de libellés Studio, audit, fil d'Ariane, statuts, mois affichés, messages de validation).
- **Lot 4 — traduction** : toutes les vagues v1 à v7 (terminologie tunisienne, voir `ar-glossary-erp.md`),
  pluriels arabes par catégorie CLDR (zéro, un, deux, 3–10, 11+).
- **Lot 5 — backend** : extracteur Roslyn étendu (2 850 messages), tous les messages de périmètre société
  traduits ; `MessageLocalizer` essaie les gabarits du plus spécifique au plus générique.

## Corrigé en chemin

- Locale `ar-TN` hybride : la fonction de pluriel était perdue au clonage (plantage des ICU en arabe).
- Traduction arabe qui injectait le « s » français (`فصلs`) via des placeholders de pluriel.
- Ticket POS : marqueurs i18n retirés (reste en français, `lang="fr" dir="ltr"`).
- Recherche du tableau de bord projets : les groupes étaient filtrés sur des libellés français alors
  que « Tâches » était traduit — en arabe, les résultats de tâches disparaissaient. Regroupement par nature.
- Contexte d'écran envoyé à l'IA (grand livre, compte de résultat, caisse) : 5 libellés avaient été passés
  en `$localize` ; rétablis en français et protégés par la porte `check-ai-payload-messages`.
- `apply-translation-batch` ne réécrit plus un ID déjà traduit (homonymes), sauf `--overwrite`.

## Restent volontairement en français

- Suggestions de l'assistant IA (`agent-scopes.config.ts`, panneau de chat) : le routage d'intention du
  backend (`AiToolIntentRouter`) reconnaît leur formulation française. À traiter avec le chantier
  « langue de réponse de l'IA ».
- Mois des services de rapports (ventes, achats, paiements) et des objectifs CRM : partagés entre les
  graphiques et les exports CSV/Excel (qui restent en français). Il faut d'abord séparer les deux usages.
- Prompts préremplis du Studio IA, exemples de demandes, diagnostic « Copier » destiné au support.
- Gouvernorats, unités, modes de paiement : ce sont des valeurs enregistrées (seuls leurs libellés
  d'option sont traduits là où ils sont distincts de la valeur).

## Reste à faire

- **Lot 6 — RTL** : dialogues, formulaires, tableaux (`erp-rtl.css`, `dir="ltr"` ciblé sur montants et codes).
- **Lot 7 — recette** : E2E authentifié sur toutes les routes société (fuites latines), captures, revue sécurité.
- **Relecture native** de chaque vague (`npm run i18n:export-review`) avant activation ; points d'attention :
  terme « bulletin » (كشف أجر / بطاقة خلاص), accords de genre dans les messages « {champ} إلزامي ».
- **Lot 8 — activation** : uniquement sur feu vert explicite (`Deploy-Hostinger.ps1`) ; retour arrière = drapeaux à `false`.
