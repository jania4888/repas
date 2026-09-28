# ERP i18n — checklist développeur

- [ ] Tout texte affiché porte un ID personnalisé : `i18n="@@<feature>.<composant>.<slug>.<hash8>"`, `i18n-label="@@…"`, `$localize`:@@…:Texte``. Jamais `i18n-x="Texte"` : la valeur de `i18n-x` est le *meaning*, pas l'ID.
- [ ] Un ID = un texte (`npm run i18n:ids`). Générer l'ID avec `scripts/i18n/codemod/id-slug.mjs` (slug + SHA-1 du texte).
- [ ] Placeholders nommés : `$localize`:@@id:Entrepôt : ${nom}:name:``. Jamais la même expression deux fois (`${x}:n:${x}` affiche la valeur en double).
- [ ] **Traduire l'affichage, jamais les valeurs** : valeurs d'options et de formulaire, clés, `case`, comparaisons, données API, query params, clés de stockage, noms de fichiers, prompts IA. Modèle : `{ label: $localize`…`, value: 'Valeur API' }` (voir `shared/constants/coded-option-labels.ts`).
- [ ] Pas de logique sur un libellé : comparer des ID (`NAV_ID`, `id` d'action) ou des codes d'erreur API (`code`), jamais `label === '…'` ni `message.includes('…')`.
- [ ] Libellés venant de l'API (statuts, types) : pipe `backendLabel` (renvoie `null`/`undefined` tels quels, `?? '—'` reste valable).
- [ ] Menus PrimeNG : tableau `[model]` stable (champ ou `computed`), jamais recréé par un getter.
- [ ] Rien d'évalué avant `loadTranslations` : pas de `$localize` dans les modules importés statiquement par `src/main.ts`.
- [ ] Après balisage : `npm run i18n:restore-whitespace`, puis `npm run i18n:gate` (0 écart FR non approuvé).
- [ ] CSS logique (`check-erp-physical-css`) ; `appNoBidiControls` / `NotContainBidiControls()` sur les champs identifiants.
- [ ] `npm run i18n:pluto-rtl` ; `npm run i18n:backend-labels`.
- [ ] Catalogue API : `messages.ar.json` ; extraction : `tools/i18n-backend-extract`.
