# Studio IA — aperçu enrichi, import/export et rejeu : frontend (PR 3.4)

**Date :** 15 septembre 2026 (PR 3.4a–h : types, store, barre de modes, onglets Vues/Relations,
panneau Tester, brouillon ; PR 3.4i1–3.4n : dialogs Exporter/Importer/Dupliquer, carte de résultat,
hub système, Rejouer, bibliothèque, changement de type dans le concepteur, E2E, documentation).
**Périmètre :** frontend Angular 19 (`src/Frontend/factutrust-web/src/app/features/studio/`), signals,
composants standalone, PrimeNG 19. Aucun contrat serveur nouveau : le frontend consomme les routes de
[PR 3.2](studio-ai-plans.md) (aperçu structuré, rejeu) et [PR 3.3](studio-system-export.md) (export,
duplication, import, modèles enrichis), plus `PATCH …/fields/{id}/type` de [PR 3.1](studio-ai-amendments.md).
**Documents liés :** [QA cas 99–102](../developer/studio-ai-assistant-qa.md) ·
[Guide utilisateur](../utilisateur/13-studio-ia.md) · E2E `e2e/studio-ai-preview.spec.ts`.

---

## 1. Composants

Préfixe implicite : `src/app/features/studio/`. Le store `StudioAiSessionStore`
(`ai/studio-ai-session.store.ts`) est fourni **au niveau de la page atelier**
(`ai/studio-ai-page.component.ts`, `providers: [StudioAiSessionStore]`) : tout ce qui vit hors de la
page (Mes projets, hub système, bibliothèque) parle directement à `StudioAiBuildService` /
`StudioService`.

| Zone | Composant | Rôle |
|---|---|---|
| Aperçu | `ai/preview/studio-ai-preview.component.ts` | Conteneur : en-tête + compteurs, bandeaux (capacité, erreur globale `store.error()`, erreurs de brouillon `store.validation().errors` — D25, avertissements), barre de modes, dix onglets. |
| Aperçu | `ai/preview/studio-ai-mode-bar.component.ts` | Modes **Aperçu / Tester / Personnaliser**, badge du nombre de modifications, pilule « Expire dans » ⇒ « Expiré », bouton **Régénérer** (`regenerate` output). |
| Aperçu | `ai/preview/studio-ai-test-panel.component.ts` | Mode Tester : `DynamicFormComponent` réel alimenté par la spec (`specEntityToCustomFields`, `specFormToLayout`), échantillon serveur optionnel, carte Rapport (`summary.sample` sinon agrégation locale). |
| Aperçu | `ai/preview/studio-ai-{tables,views,relations,seed,forms,reports,overview}-tab.component.ts` | Onglets ; en mode Personnaliser les onglets éditables émettent la spec complète (`store.updateDraft`) ou des mutations ciblées (`updateField`, `toggleFieldRemoval`, `reorderFields`, `updateView`…). |
| Aperçu | `ai/preview/studio-ai-progress.component.ts` | Étapes SSE `studio_progress` ; puce « Vues n/m » sur les étapes `phase === 'creating_views'`. |
| Aperçu | `ai/preview/studio-ai-result-card.component.ts` | Carte finale : 8 compteurs (`counters` input, `countSpec`), actions de navigation, **Exporter (JSON)** / **Dupliquer** (si `exportEnabled && systemKey`), **Rejouer** (si `replayable`). |
| Import/export | `ai/import-export/studio-ai-export-dialog.component.ts` | Autonome (pas de store) : `systemKey` préréglé ou `p-select` des systèmes (`StudioService.listSystems`), `GET export`, JSON via `{{ }}` dans un `<pre>`, **Copier** / **Télécharger** (Blob). |
| Import/export | `ai/import-export/studio-ai-import-dialog.component.ts` | Fichier ou collage, parse local, compteurs `countSpec`, `displayNameOverride`, `includeSeed` ; émet `ImportCustomSystemRequest`. |
| Import/export | `ai/import-export/studio-ai-duplicate-dialog.component.ts` | Source préréglée ou `p-select`, nom de la copie (`{name} (copie)` par défaut) ; émet `{ key, displayName }`. |
| Rail | `ai/rail/studio-ai-history-card.component.ts`, `studio-ai-rail.component.ts`, `studio-ai-quick-actions.component.ts` | Historique (compteurs, **Rejouer**, **Ouvrir le système** via `openUrl`), actions rapides Import / Dupliquer / Exporter. |
| Pages | `ai/projects/studio-ai-projects-page.component.ts` | Mes projets : colonnes Relations/Vues, **Rejouer** direct (`builds.replayPlan`), **Dupliquer** ⇒ `/studio/ai?duplicate=<key>`. |
| Pages | `ai/templates/studio-ai-templates-page.component.ts` | Bibliothèque : `moduleTag`, `relationCount`, `viewModes` normalisés (`normalizeViewMode`, dédoublonnés). |
| Hub | `studio-system-hub.component.ts` | En-tête : **Exporter** / **Dupliquer** (dialog Exporter embarqué ; Dupliquer ⇒ `/studio/ai?duplicate=<key>`). |
| Concepteur | `studio-entity-designer.component.ts` | Changement de type d'un champ existant : `type-check` puis `PATCH …/type`. |

Tous les libellés sont dans `ai/studio-ai-labels.ts` (`STUDIO_AI_LABELS`, `formatLabel`) ; aucun texte
codé en dur dans les templates.

## 2. Flux

### 2.1 Tester (lecture seule)

`store.setMode('test')` ⇒ `loadPreview()` ⇒ **un seul** `GET api/studio/ai/plans/{id}/preview` par plan
(garde `preview() || previewLoading() || previewUnavailable()`). `200` ⇒ `preview` (échantillons
`entities[].seedSample`, `summary.sample`) ; `404` ⇒ `previewUnavailable = true` **sans** erreur
globale (mode dégradé : le panneau fonctionne depuis la spec seule, décision Q1 b). Le panneau n'émet
aucune requête : « Enregistrer » affiche un message de simulation, le rapport est calculé localement,
son export est neutralisé (`pointer-events` + `aria-disabled`, décision 21).

### 2.2 Personnaliser (brouillon + `rowVersion`)

`setMode('customize')` ⇒ `startEditing()` (phase `editing`, `draft = cloneSpec(spec)`). Les mutations
n'écrivent que dans `draft` ; `diffSpec(spec, draft)` alimente le badge (`changeCount`) et les
marquages Modifié / Ajouté / Retiré. `saveDraft()` ⇒ `PUT api/studio/ai/plans/{id}/spec` avec
`{ specJson, rowVersion }` ; `200` ⇒ `spec`/`draft` remplacés par la spec canonique renvoyée, nouveau
`rowVersion`/`expiresAt`, retraits marqués rendus définitifs, phase `awaiting_confirmation`. Erreur
⇒ `validation.errors = [studioAiHttpError(err, 'plan')]` (409 ⇒ `errors.conflict` : « Ce plan a été
modifié entre-temps. Rechargez l’aperçu. »), rendue dans un bandeau `role="alert"`
(`data-testid="sai-validation-error"`) ; le brouillon est **conservé**. Un plan sans `rowVersion`
ne peut pas être enregistré (même message). `canConfirm()` exige `!dirty()` : un brouillon non
enregistré bloque **Créer maintenant**.

### 2.3 Régénérer / Rejouer (201 / 409)

Trois entrées, un seul chemin `store.startCreation(request$, openedText, conflictText?)` partagé avec
Importer / Dupliquer / modèles :

- barre de modes (plan expiré) et carte de résultat ⇒ `store.replay(planId)` ;
- rail ⇒ `replayHistoryPlan(item)` (confirmation « Remplacer la proposition en cours ? » si un plan
  est affiché) ⇒ `store.replay(item.id)` ;
- Mes projets (hors store) ⇒ `builds.replayPlan(id)` ⇒ `201` ⇒
  `router.navigate(['/studio/ai'], { queryParams: { plan } })`, `409` ⇒ toast.

`POST api/studio/ai/plans/{id}/replay` ⇒ `201 { plan, spec }` ⇒ `openCreationResponse` (plan + spec
canonique + résumé, phase `awaiting_confirmation`) puis `refreshHistory()`. `409` ⇒ `error =
replay.conflict`. L'en-tête `Location` n'est pas consommé (D14). `store.regenerate()` est une API du
store sans point d'entrée UI en 3.4 : elle renverrait au chat la demande initiale enrichie du résumé
des changements.

### 2.4 Import / export / duplication / `?duplicate=`

- **Export** : `GET api/studio/systems/{key}/export?includeSeed=` ⇒ `StudioSystemExportDto` ;
  compteurs `entityCount · relationCount · viewCount`, `warnings[]` ⇒ « Points à vérifier » ;
  **Télécharger** = Blob `application/json` nommé `studio-system-<slugify(key)>.json` contenant la
  **spec seule** (même artefact que `?download=true`, D16).
- **Import** : parse local (spec seule **ou** enveloppe `{ spec }`), `specVersion` ≠ 1 refusé,
  `countSpec` pour les compteurs ⇒ `POST api/studio/systems/import`
  `{ spec, displayNameOverride?, includeSeed }` ⇒ `201` ⇒ plan ouvert ; le dialog se ferme quand la
  phase quitte `planning` sans erreur ; le `400` serveur est affiché tel quel (`serverError`).
- **Dupliquer** : `POST api/studio/systems/{key}/duplicate` `{ displayName? }` ⇒ `201` ⇒ plan
  « (copie) » ouvert.
- **`/studio/ai?duplicate=<key>`** (hub, Mes projets) : lu dans `applyQueryParams`, ouvre le dialog
  Dupliquer prérempli **seulement si** `systemExportEnabled`, puis effacé de l'URL avec `intent`,
  `template` et `plan` (`replaceUrl`) pour qu'un rechargement ne rouvre rien.

### 2.5 Changement de type (concepteur)

Sélection d'un autre type en édition ⇒ `timer(300)` + `switchMap` ⇒
`GET api/studio/entities/{entityId}/fields/{fieldId}/type-check?to=<Type>` ⇒ `p-message` `info`
(`lossless`) / `warn` (`requires_empty_table`) / `error` (`forbidden`) avec le message serveur.
**Enregistrer** est désactivé si `saving() || typeBlocked() || typeChecking()` ; à l'enregistrement,
`PATCH …/fields/{fieldId}/type` précède le `PUT` du champ (`switchMap`). Revenir au type d'origine
efface la vérification.

## 3. Règles fail-closed

| Garde | Où | Effet |
|---|---|---|
| `planPreviewEnabled` (capabilities) | aperçu, rail | Bandeau « aperçu désactivé », carte Historique absente, aucun `GET plans`. |
| `systemExportEnabled` | actions rapides, carte de résultat, Mes projets, hub, `?duplicate=` | Boutons masqués (Exporter marqué « Bientôt » dans le rail) ; le paramètre `duplicate` est ignoré. |
| Permission `studio:design_entities` | routes `ai`, `ai/projects`, `ai/templates` (`permissionGuard`) ; hub `systems/:key` (`auth.hasPermission(PERMISSIONS.studio.designEntities)` **et** flag, D18) | Le hub n'exige que `custom_data:records_read` en route : les actions Exporter / Dupliquer vérifient explicitement la permission. |
| Capabilities non chargées | Mes projets (`capabilities.state() === 'ready'`) | Dupliquer masqué tant que l'état n'est pas connu. |

## 4. Bornes client

| Borne | Valeur | Où |
|---|---|---|
| Fichier / texte importé | **256 Ko** (`IMPORT_MAX_BYTES`) — vérifié sur `file.size` **avant** tout `FileReader`, et sur la longueur du texte collé | `studio-ai-import-dialog.component.ts` (borne du handler serveur ; le contrôleur accepte 512 Ko ⇒ 413 au-delà, D12) |
| Nom affiché (import, duplication) | **128** caractères (`IMPORT_MAX_DISPLAY_NAME`, `DUPLICATE_MAX_DISPLAY_NAME`), `maxlength` + troncature programmatique | dialogs Importer / Dupliquer (`MaxDisplayNameOverrideLength` serveur) |
| Spec (tables, champs…) | `STUDIO_SPEC_LIMITS` (validation locale ⇒ `validation.warnings`) | `ai/studio-ai-spec.util.ts` |
| Aperçu JSON | interpolation `{{ }}` dans `<pre>`, jamais `innerHTML` | dialog Exporter |

Les erreurs HTTP passent toutes par `studioAiHttpError(err, 'plan')` (`ai/studio-ai-spec.util.ts`) :
400 ⇒ message serveur, 404 ⇒ « plan introuvable », 409 ⇒ conflit, 413 ⇒ trop volumineux, 429 ⇒ quota.
Aucune PII n'est journalisée côté client ; aucun secret n'est manipulé.

## 5. Tests

- Unitaires (Karma/Jasmine) : `src/app/features/studio/**/*.spec.ts` ; fixtures partagées dans
  `ai/preview/testing/studio-ai-spec.fixture.ts` (`studioAiSpecFixture`, `studioAiSpecWithViewsFixture`
  — champ `statut` sur `demandes` depuis 3.4n, D5 —, `studioAiPlanPreviewFixture`,
  `studioSystemExportFixture`).
- E2E (Playwright, backend mocké) : `e2e/studio-ai-preview.spec.ts` avec `installStudioPreviewMocks`
  (`e2e/helpers/studio-mock.helpers.ts`) : doublons, brouillon + `PUT spec`, 409, Tester GET-only,
  expiration ⇒ replay, import, export. Les captures `docs/screenshots/studio-ia-apercu-*.png`
  (`test.describe('captures')`) sont ignorées par défaut et ne se régénèrent qu'avec
  `STUDIO_DOC_SCREENSHOTS=1` (PNG suivis, pixels non déterministes).
