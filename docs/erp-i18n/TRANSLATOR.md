# ERP i18n — checklist traducteur

- Traduire depuis le français source ; glossaire `ar-glossary-erp.md`.
- Conserver placeholders `{0}` / `{$…}` / `{entity}` ; pas de caractères de contrôle bidi.
- `npm run i18n:inventory` produit trois rapports dans `scripts/i18n/reports/` : repli français, templates non balisés, littéraux TS.
- Recette arabe par vague : liste, formulaire, dialogue, toast, erreur 400/403, sens RTL. Les PDF, e-mails, le ticket POS
  et les exports CSV/Excel restent en français.

## Relecture native (préalable à l'activation)

1. **Export** : `npm run i18n:export-review` écrit un CSV par vague dans `scripts/i18n/review/relecture-v1.csv` …
   `relecture-v7.csv` (UTF-8 avec BOM, lisible dans Excel et Google Sheets). Une ligne par couple texte français /
   traduction proposée ; `contexte` donne le ou les écrans concernés.
2. **Relecture** : pour chaque ligne, laisser `correction` vide si la traduction convient, sinon y écrire la
   traduction corrigée en gardant les jetons `{$…}`, `{…}` et `{{…}}` à l'identique ; passer `statut` à `relu` ;
   `commentaire` est libre. Ne jamais modifier les colonnes `cle` et `francais`.
3. **Réimport** : `npm run i18n:import-review -- --file=scripts/i18n/review/relecture-v3.csv --dry-run`, puis sans
   `--dry-run`. Chaque correction est validée comme au build (placeholders, ICU, HTML, bidi) ; une correction
   refusée est listée avec son motif et n'est pas écrite. Les lignes relues sont consignées dans
   `scripts/i18n/review-status.json` (versionné) ; un nouvel export les marque `relu`.
4. **Reconstruire et vérifier** : `npm run i18n:build -- --strict`, `npm run i18n:gate`, puis le balayage
   `npx playwright test -c playwright.i18n.config.ts erp-ar-routes`.

Une vague n'est livrée que lorsque toutes ses lignes sont relues. Points d'attention signalés au relecteur :
terme « bulletin » (كشف أجر / بطاقة خلاص), accords de genre dans « {champ} إلزامي », mois tunisiens (جانفي، فيفري…).
