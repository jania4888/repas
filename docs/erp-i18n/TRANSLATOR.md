# ERP i18n — checklist traducteur

- Traduire depuis le français source ; glossaire `ar-glossary-erp.md`.
- Conserver placeholders `{0}` / `{$…}` ; pas de caractères de contrôle bidi.
- `npm run i18n:inventory` produit trois rapports dans `scripts/i18n/reports/` : repli français, templates non balisés, littéraux TS.
- Statut **relu** : entrée présente dans `scripts/i18n/translations-ar/*.json` hors génération automatique, validée sur l'écran.
- Statut **jet** : entrée encore absente, ou égale au français (repli explicite). Ne pas remplacer par un placeholder illisible.
- `npm run i18n:export-review` puis `npm run i18n:check`.
- Recette arabe par vague : liste, formulaire, dialogue, toast, erreur 400/403, sens RTL. Les PDF, e-mails et le ticket POS restent en français.
