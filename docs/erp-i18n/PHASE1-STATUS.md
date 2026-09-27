# Statut du chantier i18n ERP

Dernière mise à jour : 2026-09-27 — stabilisation du WIP (lot 0) et fiabilisation de l'outillage (lot 1).

## Portes (worktree propre, base `fr-reference` = `32a2f4c1`)

| Porte | Commande | Résultat |
|-------|----------|----------|
| ID uniques | `npm run i18n:ids` | 0 collision (13 corrigées : un ID partagé affichait un message faux en arabe) |
| Catalogue AR | `npm run i18n:build -- --strict` | 7 877 / 9 704 messages traduits, 0 rejet, 634 Kio |
| Parité FR templates | `npm run i18n:parity:template` | 0 écart non justifié (88 approuvés, motif par template) |
| Parité FR TypeScript | `npm run i18n:parity:ts` | 0 écart non justifié (31 approuvés) ; bilan global : aucun texte FR perdu |
| Karma | `npx ng test --watch=false --browsers=ChromeHeadless` | 16 échecs, **identiques à fr-reference** (14 SupplierInvoiceForm, Studio fuseau, ProjectApi) |
| Backend | `dotnet test` (Infrastructure, API) | identique à la base (21 Projects ; FixedAssets SQL, Hangfire 15≠16, PlatformAiSettings) |
| Build prod | `npm run build:prod` | OK |

## Corrigé pendant la stabilisation

- Collisions d'ID (`localize-ts.mjs` tronquait le texte sans hash).
- Catalogue : le français n'est plus injecté pour les ID non traduits (affichait `${n}` brut).
- Source FR : extraction par le compilateur au lieu de la regex (`auto.*` et ID digest).
- Régressions FR du WIP : pourcentage des analyses (texte `loc_…` affiché), placeholder de modèle d'écriture, suggestions NIF/téléphone/mot de passe perdues, catégorie produit par défaut, espaces de bord (1 711), doublon d'interpolation (marque, badge), `?? '—'` neutralisé par le pipe `backendLabel`.
- Sécurité : `auth.interceptor` rétabli (le WIP envoyait le jeton sur `/auth/login`).
- Plantage du menu en mode délégué cabinet (`getNavId` levait sur une entrée dynamique).
- Périmètre : un espace cabinet/portail ne tourne jamais avec le catalogue arabe ; `html[dir]` suit le catalogue chargé.

## Reste à faire

Lots 2 à 8 du plan (`~/.claude/plans/il-faut-traduire-tout-squishy-toucan.md`) : codes d'erreur API pour les
derniers tests sur texte, balisage AST des ~1 900 messages sans ID et des textes non balisés, classification
et balisage du TypeScript, traduction (1 789 messages manquants + nouveaux), backend, RTL, E2E authentifié.
