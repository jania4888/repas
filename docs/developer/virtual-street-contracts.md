# Visite virtuelle réaliste — contrats L0 figés

Statut : **L0 acquis + première tranche L0-R V4, validation déclarative commune**.
Aucun chargeur, résolveur de taxonomie, catalogue de production ou intérieur n'est
activé. Les versions wire 1/2/1, Angular 19 et Three r161 restent inchangées.

| Lot canonique V4 | Responsabilité | Ancien alias documentaire L0 |
|---|---|---|
| L0 puis L0-R | Contrats/fixtures puis écarts et requalification | L0 acquis, pas reconstruit |
| L1 | Consentement et référence publique | L2 référence publique consentie |
| L2 | Configuration à chaud et fraîcheur | Aucun alias fiable |
| L3 | Chargeur, registre et moteur | L1 moteur/chargeur |
| L4 / L5 | Rue et routes / quatre intérieurs pilotes | Autrefois englobés dans moteur |
| L6 | Couverture après acceptation des quatre pilotes | L3 couverture |
| L7 | Qualification globale et réversibilité | G0–G4 sont des gates, pas des lots |

Fichiers de référence (frontend/outillage uniquement) :

| Fichier | Rôle |
|---|---|
| `WEB/src/app/features/virtual-street/3d/business-scene-contracts.ts` | Types readonly + constantes figées |
| `WEB/src/app/features/virtual-street/3d/business-scene-contract-validation.ts` | Validateurs purs sur données inconnues (aucune dépendance Angular/Three/HTTP) |
| `WEB/src/app/features/virtual-street/3d/business-scene-contracts.spec.ts` | Tests Jasmine des contrats et validateurs |
| `WEB/src/app/features/virtual-street/testing/business-taxonomy-fixture.ts` | Base taxonomique synthétique 36 + 6 + 24 + 8 |
| `WEB/src/app/features/virtual-street/testing/business-taxonomy-fixture.spec.ts` | Parité de la base avec la source domaine + règle de couverture |

La porte Node `WEB/scripts/validate-street-catalog.mjs` compile le **même module
TypeScript pur** en CommonJS dans un répertoire temporaire, nettoyé après exécution.
Elle ne maintient plus de deuxième validation de versions, budgets, navigation,
identités, dépendances ou attribution. La compilation ciblée utilise TypeScript
existant ; elle ne charge ni Angular ni Three et ne génère aucun asset.
Les 79 cas du corpus JSON partagé et de son adaptateur synthétique dans `VS/testing/`
sont exécutés séparément dans les suites TS/Jasmine et Node, avec codes attendus
explicites et roundtrip JSON côté Node. Ces assertions portent sur les résultats
attendus, pas sur l'autocomparaison de deux appels au même validateur. Jasmine
contrôle aussi la non-mutation ; des processus enfant vérifient les vrais résultats
et codes de sortie CLI.

## 1. Les versions à ne pas confondre (plan §6.1)

| Version / clé | Porteur | Règle figée |
|---|---|---|
| `schemaVersion` du manifeste | Catalogue 3D | Vaut `BUSINESS_CATALOG_SCHEMA_VERSION = 2` ; majeure inconnue = rejet contrôlé |
| `catalogVersion` | Catalogue + `visualProfile.catalogVersion` | Jeton de livraison immuable (convention `v2.<release>`) ; sélectionne une livraison, **ne substitue jamais** une identité acceptée |
| `profileKey` | Référence publique consentie | Clé métier stable ; ne change jamais de sens |
| `editorialRevision` | Référence publique consentie + preuve Master | `r<entier positif>` ; toute transformation substantielle = nouvelle révision à accepter |
| Version de taxonomie effective | Proposition propriétaire / audit interne | Jamais exposée au visiteur |
| `FacadeTheme` (0–4) | DTO/publication + adaptateur legacy | Dimension esthétique orthogonale : Classic=0, Modern=1, Vintage=2, Minimal=3, Artisan=4 ; n'encode aucune activité |
| Version de consentement visuel | Preuve Master **non publique** | Absente des DTO publics et de ces contrats frontend |

**L'acceptation publique lie `profileKey` + `editorialRevision`** (type
`VisualProfileIdentity`), pas `catalogVersion`. Une mise à jour technique de
compression/LOD/matériaux change `catalogVersion` sans toucher l'identité éditoriale
acceptée. La conservation N−1 n'autorise pas la consommation : les futurs
consommateurs devront vérifier que la révision est toujours active, supportée et
autorisée. Retrait/révocation prime sur fichiers conservés et consentement passé.

## 2. Formats normatifs (validateur pur)

| Champ | Règle | Prédicat |
|---|---|---|
| `profileKey`, `sceneKey`, `recipeKey`, clés de viewpoint/interaction | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 | `isContractKey` |
| `assetKey` | `^[0-9A-Za-z][0-9A-Za-z._-]*$`, ≤ 128 (règle de la porte de build) | `isAssetKey` |
| `catalogVersion` | même alphabet, ≤ 64, sans `..` (sert de nom de répertoire) | `isValidCatalogVersionToken` |
| `editorialRevision` | `^r[1-9][0-9]*$` | `isValidEditorialRevision` |
| Nœuds/matériaux GLB | `^[A-Za-z0-9_.-]{1,128}$` (conserve `Sign_Plane`, `StorefrontRoot_LOD1`) | `isNodeName` |
| `sha256` | exactement 64 hex minuscules | `isValidSha256Hex` |
| `path` d'asset | relatif immuable sous `<catalogVersion>/` ; **aucune URI** (`http:`, `data:`, `blob:`…), aucun chemin absolu, aucun `..`, aucun `\`, aucun segment vide ; segments ASCII `[A-Za-z0-9_-][A-Za-z0-9._-]*`, donc sans `%`, `?`, `#`, `:`, espaces ou contrôles Unicode | `isValidCatalogAssetPath` |

Les champs inconnus supplémentaires sont **tolérés** (évolution additive) ; les valeurs
inconnues des champs connus sont rejetées. Les types readonly ne sont pas une frontière
de confiance : toute donnée reçue passe par les validateurs avant usage.
La validation ne nettoie ni ne clone le manifeste : le futur consommateur doit
construire ses objets internes par allowlist et ne jamais réémettre les champs
inconnus. Cette projection n'est **pas** livrée par cette tranche.

## 3. Manifeste (plan §6.2) — points de contrôle

`validateBusinessCatalogManifest(unknown) : ContractViolation[]` ne lève jamais
d'exception ; chaque écart porte un code stable (`manifest.schema-version`,
`asset.path`, `profile.scene-kind`, …) exploitable par les tests et les outils.

- **En-tête** : `schemaVersion = 2`, `catalogVersion` valide, `renderer = { engine: 'three', revision: '161', minContractVersion: 1 }`.
- **Profils** : identité `(profileKey, editorialRevision)` unique ; `representationKind = 'illustrative'` ; `facadeSceneKey` et `interiorSceneKey` obligatoires et typés (`street-facade` / `interior`) ; `localExteriorSceneKey` nul ou scène `local-exterior` (le raccord de rue d'un hall est une entrée, pas la façade complète) ; `coverage` pointe des assets `render` (preuves façade + intérieur) et `attribution`.
- **FacadeTheme orthogonal** : `styleRecipes` contient **exactement** les clés `0..4`, chacune avec `recipeKey`, `materialNames`, `assetKeys` résolubles. Aucun thème ne varie selon le domaine.
- **Scènes** : `sceneKey` unique ; `kind ∈ {street-facade, local-exterior, interior}` ; unités mètres, `+Y` up, façade `+Z`, origine au seuil ; bornes cohérentes (`min ≤ max`) ; variantes `economy` **et** `standard` (pas de tier `enhanced` en L0) respectant les plafonds déclarés `SCENE_VARIANT_BUDGETS` (120 000/300 000 triangles, 100/180 draw calls, 96/192 Mio textures) ; LODs triés par distance croissante.
- **Navigation** : `spawn`/`exit`/`viewpoints` finis ; `walkableBounds`/`collisionBounds` valides ; interactions à rôle fermé `exit | openStorefront | inspectScene`, libellé ≤ 120 caractères, `inspectScene` référence un viewpoint existant. Aucune action n'exécute d'URL, de POST ou de commande métier.
- **Assets** : `assetKey` unique ; chemin/hash/tailles conformes ; `dependencyAssetKeys` résolues, sans auto-dépendance ni cycle ; bloc `gltf` réservé aux GLB, extensions requises limitées à `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_texture_basisu` (décodeurs auto-hébergés, activés après pilote) ; lightmaps `texCoord = 1` (r161 : `TEXCOORD_1` → `uv1`, `lightMap.channel = 1`).

## 4. Propriété des ressources (plan §7.2)

`ResourceOwnership` est une union discriminée (`visit-runtime` | `asset-registry` |
`scene-instance` | `scene-scope` avec `generation`) : déclaration de cycle de vie pour
le futur runtime, sans remplacer le registre `street-disposable-registry.ts` existant.
La génération distingue l'annulation logique de l'annulation transport ; un résultat
tardif sans propriétaire est libéré, jamais attaché à une nouvelle scène.
`BusinessAssetCacheKey = (catalogVersion, assetKey, quality)` déduplique les
téléchargements ; aucun intérieur n'est préchargé sans intention explicite.

## 5. Configuration à chaud (plan §9)

`StreetExperienceConfig` (payload futur, endpoint non implémenté ici) :
`schemaVersion = 1`, `mode ∈ {list, legacy, catalog-v2}`, `catalogVersion` nul sauf en
`catalog-v2`, `leaseSeconds ∈ (0, 60]`, `configRevision` non vide. Le bail expire sur
horloge monotone côté client ; son expiration arrête la 3D (repli liste/fiche), jamais
de prolongation sur échec réseau. Le mode `list` ne désactive que la 3D.

## 6. Base taxonomique synthétique (tâche 1)

`business-taxonomy-fixture.ts` gèle ce que la résolution visuelle devra absorber.
Toutes les lignes sont synthétiques ; aucune lecture de base ni de tenant réel.

| Groupe | Lignes | Attente |
|---|---:|---|
| Paires seedées | 36 | Profil spécialisé dédié `syn-<segment>-<domaine>` ; **couverture = façade + intérieur exigés** |
| Segment sans domaine | 6 | Alias du profil seedé `(segment, autre)` ; l'alias affiche mais **ne couvre pas** un domaine |
| Connues non seedées | 24 (produit cartésien 6×10 − 36, vérifié) | Repli neutre de famille (`syn-neutral-boutique|bureau|atelier`), puis file art |
| Cas limites | 8 | Codes custom admin (kebab ≤ 50), codes inactifs, classification partielle/absente → neutre global/famille |

La spec compare la matrice seedée à `SEGMENT_ALLOWED_DOMAINS` / `SEGMENT_OPTIONS` /
`DOMAIN_OPTIONS` (miroir frontend documenté comme copie exacte de
`SectorConfigurationCatalog.cs`) : égalité des 36 liens, des 6 segments et des 10
domaines, ordre compris. Huit paires seedées exigent en outre une scène
`local-exterior` à grande échelle (colonne `facade_locale_grande_echelle` de
`/code/.plans/catalogue-coverage.csv`).

**Règle de couverture** : seuls les 36 profils spécialisés comptent comme couverture ;
chacun exige façade **et** intérieur. Les replis neutres restent de l'affichage et ne
couvrent aucun domaine — y compris l'alias `(segment, autre)` des lignes sans domaine.
Toute classification privée (segment/domaine réel d'un tenant) n'apparaît jamais dans
un DTO public : la résolution privée est une décision serveur (L1), hors de ce fichier.

## 7. Hors périmètre L0 (lots suivants)

Champ `visualProfile` dans les DTO publics et migration Master ; endpoints
propriétaire et `experience-config` ; runtime `business-scene.runtime.ts`, registry,
loader, navigation ; validation de GLB réels et assets pilotes ; activation
production. Le catalogue legacy (5 GLB, budgets historiques, alias de nœuds) reste
inchangé et validé par ses propres outils.


## 8. Première tranche L0-R : contrôles et limites explicites

### Exécution sans serveur ni génération

Depuis `WEB` :

```bash
npm run test:street-catalog
node --test scripts/validate-street-catalog.spec.mjs
npm run validate:street-catalog -- --schema-only --manifest /tmp/synthetic-manifest.json --json
npm run validate:street-catalog -- --catalog-root src/assets/virtual-street/catalogs --version v4-pilots-r1 --manifest src/assets/virtual-street/catalogs/v4-pilots-r1/manifest-v2.json --json
```

La commande de test compile les specs pures Jasmine existantes et le corpus partagé,
puis lance les tests Node. Elle n'est pas un test Angular/WebGL/API ou une recette
artistique. Les exemples de manifests nécessitent des fichiers fournis explicitement ;
aucun catalogue de production n'est ajouté ici.

- Le manifeste canonique est `<catalog-root>/<catalogVersion>/manifest-v2.json`.
  Les chemins d'assets restent relatifs **au répertoire de cette version**.
- Aucun défaut mutable `/catalogs/manifest-v2.json`, argument positionnel historique,
  liste arbitraire de fichiers, option inconnue ou option dupliquée n'est accepté.
- `--schema-only` est explicitement **non qualifiant**. Le manifeste vide reste
  valide au niveau bas ; il est refusé en mode fichiers (`release.empty`).
- Le mode fichiers parcourt **tous** les descripteurs, y compris `render` et
  `attribution` : frontière réelle du répertoire, refus des symlinks du sous-arbre,
  fichier régulier, taille effective et SHA-256, puis glTF validator sur les GLB.
  La lecture refuse les fichiers non réguliers avant ouverture et recontrôle le
  descripteur ; l'ouverture non bloquante, lorsqu'elle est disponible, évite une
  attente sur FIFO remplacé entre ces contrôles. Les régressions POSIX utilisent
  des FIFO sans writer et des processus enfant avec timeout de cinq secondes,
  pour le manifeste (deux modes), un rendu et une attribution.
  Un succès vaut `file-integrity-only`, jamais une release complète ; le résultat
  contient toujours `productionReleaseQualified: false`.
- `quality:gate:street-catalog` n'est pas encore une gate V4 de publication : son
  orchestration/forwarding de flags et son raccord CI sont à reprendre dans la
  prochaine tranche. Utiliser les commandes ciblées ci-dessus pour ce checkpoint.

### Bornes communes avant validation détaillée

`CATALOG_VALIDATION_LIMITS` fixe 4 096 assets, 1 024 scènes, 512 profils,
16 384 arêtes, des chaînes d'au plus 64 assets, 250 000 valeurs JSON,
32 niveaux, 16 384 entrées par tableau et 4 096 caractères par chaîne/clé.
Les champs supplémentaires sont également bornés. Le graphe utilise un parcours
topologique itératif O(assets + arêtes), sans DFS récursif ni accumulation de chemins.
Les graphes partagés et l'ordre inversé sont couverts ; la profondeur ne dépend pas
de l'ordre du manifeste. Les comptes/tailles déclarés sont des entiers sûrs ;
triangles/draw calls/textures peuvent rester à zéro dans un fixture bas niveau,
mais les octets encodés/transférés sont strictement positifs et entiers.

La CLI refuse les fichiers JSON > 8 Mio avant allocation/parse et les assets >
64 Mio avant lecture. Ces bornes d'outillage ne relèvent **aucun budget de scène**.
Elles ne prouvent pas une borne de mémoire/temps du décodeur glTF.

### Tranche suivante requise — L0-R n'est pas clos

| Scénario V4 | Acquis ici | Prochaine tranche / preuve manquante |
|---|---|---|
| V06 | Chemins lexicaux fermés, version explicite, dépendances, realpath/symlinks statiques, fichiers render/attribution hashés | Transport/redirects et allowlist runtime ; robustesse contre remplacement concurrent des fichiers dans un espace non fiable |
| V07 | Schéma commun, enums MIME/extensions déclarées, glTF validator existant | Magic bytes/MIME réels de chaque format, contenu incorporé et URI/buffers/images, décodeurs approuvés et aucun fetch implicite |
| V08 | JSON/collections/graphe bornés, tailles de fichiers contrôlées avant lecture | Inspection bornée GLB/accessors/nœuds/offsets, textures réelles/mips/layers/décompression, limites CPU/mémoire du runner r161 ; budgets transitifs mesurés |
| V19 | Corpus positif/négatif à résultats attendus partagé entre TS/Jasmine et Node, enfants réellement rouges, hashes inchangés | Manifest d'attendus de release non vide, couverture/droits approuvés, orchestration CI bloquante et attestation liée au candidat |

La navigation, les UV/ancrages, les estimations, les images et l'attribution restent
déclaratifs : une scène synthétique sans géométrie peut passer ces checks, **pas**
être publiée. L'index immuable N/N−1 et l'allowlist dérivée, la projection interne
par allowlist, l'union de demande neutre, le runtime et la baseline WebGL requalifiée
restent aussi à livrer. Aucun nouveau consentement, art, publication ou activation UI
n'est autorisé implicitement par cette tranche.
