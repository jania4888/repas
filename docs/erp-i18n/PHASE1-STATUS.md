# Statut du chantier i18n ERP

Dernière mise à jour : 2026-09-28 — lots 0 à 7 livrés sur `i18n/erp-arabe` (worktree `C:\wt\ar`) :
traduction, mise en page RTL, balayage des fuites sur toutes les routes société, revue de sécurité,
recette sur API réelle avec données (109 écrans).
Les drapeaux arabes restent **OFF** en production (`environment.erp.arabicEnabled`,
`Localization:ArabicMessagesEnabled`).

## Portes (base `fr-reference` = `32a2f4c1`)

| Porte | Commande | Résultat |
|-------|----------|----------|
| Toutes | `npm run i18n:gate` | vert (règles de traduction, ID, concaténations, payloads IA, valeurs, catalogue strict, CSS logique, attributs de templates, parités) |
| ID uniques | `npm run i18n:ids` | 20 494 messages, tous à `@@id` sauf 18 ICU imbriqués (ID calculé par le compilateur), 0 collision |
| CSS RTL | `npm run i18n:rtl:check` | 0 déclaration physique convertible (755 converties en propriétés logiques) ; surcharge Pluto/Bootstrap à jour |
| Attributs de templates | `node scripts/i18n/codemod/localize-bound-literals.mjs --check` | 0 texte français non balisé dans les attributs et liaisons |
| Phrases découpées | `node scripts/i18n/gate/check-concat-messages.mjs` | 0 (32 fusionnées en un seul `$localize`) |
| Payloads IA | `node scripts/i18n/gate/check-ai-payload-messages.mjs` | 0 `$localize` dans le contexte d'écran envoyé au LLM ni dans les fichiers de prompts |
| Messages-valeurs | `npm run i18n:values` | 0 (enum, clé, URL, classe d'icône… jamais en `$localize`) |
| Catalogue AR | `node scripts/i18n/build-runtime-translations.mjs --strict` | **16 872 / 17 187** messages, 0 rejet, 1 660 Kio (cible 1,75 Mio, plafond 2 Mio) |
| Parité FR templates | `npm run i18n:parity:template` | 0 écart non justifié (142 approuvés, motif par template) |
| Parité FR TypeScript | `npm run i18n:parity:ts` | 0 écart non justifié (74 approuvés) |
| Parité FR visuelle | `npx playwright test -c playwright.i18n.config.ts erp-rtl-fr-parity` | 14 écrans **identiques au pixel près** avant/après le passage aux propriétés logiques |
| Codemods | `npm run i18n:codemod:test` | vert (templates, ternaires, littéraux TS, listes d'approbation, CSS logique, attributs liés) |
| Fuites françaises (arabe) | `npx playwright test -c playwright.i18n.config.ts erp-ar-routes` | **112 / 112 routes sans fuite** (session simulée, listes vides) |
| Recette sur API réelle | `I18N_LIVE_ACCOUNT=<compte> E2E_API_BASE=https://localhost:7011 npx playwright test -c playwright.i18n.config.ts erp-ar-live` | connexion réelle, 103 routes du menu + 5 fiches + dialogue et refus de l'API : **109 écrans en arabe**, un écart connu (analyses de la prévision, ci-dessous) ; 12 routes comptables redirigées « accès refusé » pour une société (voulu) |
| Build de production | `npm run build:prod` | vert ; budgets FR inchangés (2 avertissements préexistants : secondary-nav, projects) |
| Karma | `npx ng test --watch=false --browsers=ChromeHeadless` | 16 échecs, **identiques à fr-reference** (lots 0-7) ; après la recette : 498/498 sur les écrans modifiés |
| Backend | `dotnet test --filter MessageLocalizer\|LocalizeApiResponse\|UiLanguage\|ExceptionHandling\|Accounting…` | Infrastructure MessageLocalizer 14/14 (messages portés par des constantes traduits), API 49/49 |

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
- **Lot 6 — RTL** :
  - `scripts/i18n/rtl/logicalize-css.mjs` : 755 déclarations physiques des styles de composants (SCSS,
    `styles:` en ligne, styles globaux) remplacées par leurs équivalents logiques (`margin-inline-start`,
    `inset-inline-end`, `text-align: start`, coins `border-start-end-radius`…) — identiques en LTR,
    retournées en RTL sans surcharge ; porte `--check` contre toute régression ;
  - `build-pluto-rtl.mjs` réécrit (postcss seul, sans dépendance nouvelle) : surcharges `[dir='rtl']` du thème
    Pluto / Bootstrap 4 chargées uniquement en arabe ; paires `.mx-2`/`.px-2` réparties sur deux règles
    reconnues symétriques ;
  - identifiants saisis en LTR (NIF, RIB, IBAN, CNSS, CIN, codes, téléphone, e-mail, y compris dans les
    `p-inputMask`), placeholder arabe conservé ; police arabe posée sur `body` et les contrôles de
    formulaire seulement (les icônes gardaient sinon la police arabe : cases vides) ;
  - locale hybride `ar-TN` complétée (formes autonomes des mois et jours, périodes du jour, gabarit
    date + heure sans « à ») ; `erpDateLocale()` pour les dates écrites en toutes lettres (mois
    tunisiens en arabe, rendu FR inchangé) ;
  - mois des rapports traduits pour l'affichage, exports CSV/Excel alimentés par une liste française
    dédiée (`reports/shared/report-export-fr.ts`).
- **Lot 7 — recette et sécurité** :
  - session ERP simulée (`e2e/helpers/erp-session.mock.ts` : administrateur, toutes permissions et routes lues
    dans le code, API interceptée) et configuration `playwright.i18n.config.ts` (port dédié) ;
  - `erp-rtl-screens.spec.ts` : 11 écrans en arabe et en français, dialogue, largeur téléphone, saisie
    d'identifiants — sens, débordement, position de la barre latérale ;
  - `erp-ar-routes.spec.ts` : les 112 routes société (menu + formulaires de création) balayées en arabe,
    toute ligne française hors liste blanche est une fuite (rapport par route) — **0 fuite sur 112 routes** ;
  - `localize-bound-literals.mjs` : 243 attributs restés en français (`data-label` des tableaux
    responsives, `aria-label` liés, ternaires, concaténations) ; une concaténation devient un seul
    message à placeholders pour que l'arabe puisse réordonner les mots ;
  - revue de sécurité (ci-dessous).

## Corrigé en chemin

- Locale `ar-TN` hybride : la fonction de pluriel était perdue au clonage (plantage des ICU en arabe).
- Traduction arabe qui injectait le « s » français (`فصلs`) via des placeholders de pluriel.
- Ticket POS : marqueurs i18n retirés (reste en français, `lang="fr" dir="ltr"`).
- Recherche du tableau de bord projets : les groupes étaient filtrés sur des libellés français alors
  que « Tâches » était traduit — en arabe, les résultats de tâches disparaissaient. Regroupement par nature.
- Contexte d'écran envoyé à l'IA (grand livre, compte de résultat, caisse) : 5 libellés avaient été passés
  en `$localize` ; rétablis en français et protégés par la porte `check-ai-payload-messages`.
- `apply-translation-batch` ne réécrit plus un ID déjà traduit (homonymes), sauf `--overwrite`.
- Icônes invisibles en arabe : la règle `:lang(ar) { font-family }` s'appliquait aussi aux `<i class="fa-…">`.
- « Entrée » / « Échap » laissés dans des traductions (touches clavier) ; « IA » en latin dans 11 traductions
  (aligné sur « المساعد الذكي » / « الذكاء الاصطناعي » du menu).
- Compteur d'onboarding, salutation du tableau de bord (virgule arabe), slogan de marque, libellé d'analyse
  générique : restés en dur en français, passés en `$localize`.

**Recette sur données réelles** (la session simulée, à listes vides, ne pouvait pas les voir) :
- Libellés renvoyés par l'API affichés bruts en français : statuts des factures, devis et paiements (badges
  « Brouillon », « Validée »), types client/fournisseur/produit, noms de modules, catégories de retenue,
  statuts et motifs de paie, nature/rôle/priorité des projets, fréquence et historique des contrats, types
  d'inventaire, bons de stock (~25 liaisons). Tous passent par `| backendLabel` / `backendDisplayLabel()`
  (dictionnaire généré, ID désormais stables d'une génération à l'autre ; aides `*Display` et constantes
  de DTO couvertes).
- Frise de la facture (Créée / Validée / Signée / Payée), étapes de l'inscription, « Requis par … » des
  modules, en-tête Client/Fournisseur des soldes, bouton « OK » des alertes d'erreur : en dur, passés en `$localize`.
- Déclaration mensuelle côté société : le front reconnaissait « aucune déclaration soumise » à son texte
  français, ce qui obligeait l'API à ne pas le traduire (toast en français). L'API renvoie désormais le code
  `VatDeclaration.NotSubmitted`, le front le teste, le message est traduit.
- Extracteur backend : les messages passés par une constante (`Error.Forbidden(Access.DeniedMessage)`,
  `new(code, Message)`) étaient invisibles — 23 récupérés, 18 traduits (les autres : plateforme, landing).
- Échanges : l'indication renvoyée par l'API (« Liez un cabinet comptable… ») est traduite à l'affichage.
- Recette : le détecteur « aspect français » ne voit pas « Brouillon » (ni accent ni mot-outil) ; le test
  compare aussi le texte visible aux clés du dictionnaire des libellés backend.

## Revue de sécurité (lot 7)

- **Injection HTML** : aucun nouveau `innerHTML` ; le seul existant (`empty-state`, `secondaryAction`) n'est
  lié nulle part et passe par l'assainisseur d'Angular. Toute traduction contenant du HTML est rejetée au build.
- **Catalogue** : même origine, délai de 8 s, plafond de 2 Mio vérifié deux fois, seules les valeurs chaîne
  sont chargées, repli français sur toute erreur.
- **API** : `X-UI-Locale` borné à 16 caractères, seul `ar`/`ar-*` change la culture ; gabarits regex en
  `NonBacktracking` avec délai de 50 ms (pas de ReDoS) ; journaux limités à la longueur des messages ;
  préférence de langue en liste blanche (`fr`/`ar`), limitée en débit, écrite pour l'utilisateur authentifié seul.
- **IA** : aucun `$localize` dans le contexte d'écran ni dans les prompts (porte dédiée) ; les questions
  d'exemple restent en français (`lang="fr"`) car le routage d'intention du backend les reconnaît.
- **Police arabe** : hébergée localement (`@fontsource`), CSP inchangée.

## Restent volontairement en français

- Suggestions de l'assistant IA (`agent-scopes.config.ts`, panneau de chat), marquées `lang="fr" dir="auto"` :
  le routage d'intention du backend (`AiToolIntentRouter`) reconnaît leur formulation française. À traiter
  avec le chantier « langue de réponse de l'IA ».
- Exports CSV/Excel : en-têtes et mois en français (liste dédiée), même en interface arabe.
- Prompts préremplis du Studio IA, exemples de demandes, diagnostic « Copier » destiné au support.
- Libellé d'accessibilité du bouton d'analyse IA : contient l'identifiant technique de l'écran
  (`stock-simple`) dans les deux langues ; le corriger modifierait le français.
- Gouvernorats, unités, modes de paiement : ce sont des valeurs enregistrées (seuls leurs libellés
  d'option sont traduits là où ils sont distincts de la valeur).
- Référentiels semés et données enregistrées : plan comptable NCT, journaux, catégories d'amortissement,
  types de retenue, libellés d'écritures générés à la comptabilisation (« Client — FAC-2026-000001 »).

## Reste à faire

- **Décisions de conception** (textes produits par le backend et enregistrés, non traduisibles en l'état) :
  - analyses de la prévision de trésorerie (`CashFlowAlertRules`, « Échéances clients », « 71 % des
    encaissements… ») et raisons de recommandation de module (`ReasonFr`) : à produire sous forme
    code + paramètres pour être rendues dans la langue de l'interface ;
  - types de retenue à la source : le champ `LabelAr` existe mais le seed le laisse vide (le remplir demande
    une mise à jour des dossiers existants et une relecture fiscale) ;
  - entrepôt par défaut « Entrepôt Principal » créé à l'inscription (donnée renommable ; un nom arabe par
    défaut apparaîtrait aussi sur les documents, qui restent en français).
- **Couverture de la recette réelle** : ventes, clients, fournisseurs, produits, écritures générées, prévision.
  Les modules sans données de test (paie, projets, stock, contrats, inventaire) ont été contrôlés
  statiquement (liaisons `*Display` / `*Label`) ; une recette avec données sur ces modules reste utile.
  Les 12 routes comptables réservées au cabinet n'ont été vues qu'en session simulée.
- **Limites connues, hors chantier** : à largeur téléphone, la barre latérale reste ouverte et comprime le
  contenu — en français comme en arabe (l'ERP n'est pas optimisé mobile). Les panneaux latéraux
  (`position="right"`) s'ouvrent à droite dans les deux langues (positions physiques de PrimeNG).
- **Relecture native** de chaque vague avant activation : `npm run i18n:export-review` produit 7 CSV
  (~12 200 lignes, v7 comptabilité/Studio la plus lourde), réimport validé par `npm run i18n:import-review`,
  avancement dans `scripts/i18n/review-status.json` — procédure dans `TRANSLATOR.md`.
- **Lot 8 — activation** : uniquement sur feu vert explicite (`Deploy-Hostinger.ps1`) ; retour arrière = drapeaux à `false`.
