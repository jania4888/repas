# ADR: Symbologies de codes-barres article

## Status

Accepté — 2026-09-18. Implémenté par les lots 0 à 7 du chantier codes-barres.

## Context

Le catalogue portait déjà un code-barres (`Products.Barcode`, `nvarchar(13)`, value object `Barcode`), mais restreint à **EAN-8 et EAN-13** avec vérification de la clé de contrôle GTIN. Cette restriction bloquait trois usages réels :

- **UPC-A** (12 chiffres) sur les articles importés d'Amérique du Nord ;
- **GTIN-14** sur les unités logistiques (carton, palette) ;
- **Code 128 alphanumérique** pour les références internes et fournisseur.

Trois contraintes du dépôt ont façonné la solution.

### C1 — `Barcode` est un type possédé *optionnel*

`TenantDbContext` le déclare en `OwnsOne` sans `.IsRequired()`. EF Core se sert de la colonne `Barcode` (elle-même `IsRequired()` au sein du type possédé) comme **sentinelle de présence** du dépendant.

Ajouter une seconde colonne au type possédé — par exemple `BarcodeSymbology` — force EF à la rendre nullable en base (règle du partage de table pour un dépendant optionnel). Les lignes existantes porteraient alors `Barcode` renseigné et `BarcodeSymbology` à `NULL`, ce qui déclenche une **`InvalidOperationException` de matérialisation** dès la première lecture de l'entité. Le résultat n'est pas une erreur ponctuelle : c'est un catalogue devenu illisible sur le tenant, jusqu'à ce qu'un backfill correct soit passé.

### C2 — La recherche par code-barres passe par un segment de chemin

`GET api/products/by-barcode/{barcode}`. ASP.NET Core rejette `%2F` dans un segment de chemin par défaut ; `?`, `#` et `&` cassent l'URL côté client même encodés par certains intermédiaires.

### C3 — L'index est filtré, et l'unicité est délibérément différée

`IX_Products_Barcode` porte `WHERE [Barcode] IS NOT NULL` et **n'est pas unique** : la doctrine du dépôt (`docs/runbooks/invoice-number-uniqueness.md`) interdit de livrer un index UNIQUE avant un balayage complet du parc, une migration en échec bloquant le tenant au démarrage via `TenantMigrationGuard`.

## Decision

### D1 — La symbologie est **dérivée**, jamais persistée

`Barcode.Symbology` est une propriété calculée à partir de `Value` seule, via la fonction pure `TryClassify` que `Create` utilise aussi pour valider. Une seule fonction sert donc à la fois à accepter et à classer : les deux ne peuvent pas diverger.

| Entrée (après détourage) | Classement |
|---|---|
| tout-chiffres, longueur 8 / 12 / 13 / 14, **clé GTIN valide** | `Ean8` / `UpcA` / `Ean13` / `Gtin14` |
| tout-chiffres, longueur 8 / 12 / 13 / 14, clé invalide | **refusé** |
| tout-chiffres, autre longueur (3–48) | `Code128` |
| contient un non-chiffre du jeu autorisé, longueur 3–48 | `Code128` |
| reste | refusé |

Conséquences :

- **C1 disparaît** : zéro colonne, zéro backfill, zéro risque de matérialisation, une seule ligne à corriger dans le snapshot EF (la longueur).
- `GetEqualityComponents()` continue de ne céder que `Value` : le contrat d'égalité est **inchangé**, donc aucun comportement de dictionnaire ou de comparaison ailleurs dans le code ne bouge.
- Un numérique de longueur GTIN **ne peut pas** se replier sur `Code128`. Sans cette règle, fausser un chiffre suffirait à contourner la vérification de clé — ce qui rouvrirait exactement le défaut de sûreté que cette vérification corrige.

**Alternative rejetée :** une colonne `BarcodeSymbology` explicite. Elle rapporterait la seule capacité de déclarer « ce 13-chiffres est un Code 128 », besoin qui n'existe pas — une douchette qui lit 13 chiffres à clé valide lit un EAN-13. En échange, elle apporterait C1, un backfill obligatoire, et une valeur susceptible de devenir incohérente avec `Value` après tout import SQL direct.

### D2 — UPC-A stocké tel que scanné ; équivalence résolue à la lecture

Pas de normalisation `0` + 12 chiffres → EAN-13 en écriture.

Le zéro de tête est une convention d'échange, pas la valeur imprimée. Normaliser en base aurait deux effets inacceptables : la douchette, qui renvoie 12 chiffres sur un UPC-A dans sa configuration par défaut, ne trouverait plus rien en égalité stricte ; et l'étiquette réimprimée changerait de symbologie, donc de largeur physique, donc de gabarit.

La lecture (`GetByBarcodeAsync`) construit à la place un jeu d'**au plus deux valeurs équivalentes** (12 ↔ `0`+12). Deux égalités sur paramètres non nuls impliquent `Barcode IS NOT NULL` : l'optimiseur conserve le *seek* sur l'index filtré, sans dégradation.

### D3 — `nvarchar(48)`

14 caractères pour un GTIN-14, une trentaine pour un Code 128 réaliste. 48 laisse de la marge en gardant la clé d'index à 96 octets, très en-deçà de la limite de 1700. `MAX` est exclu : incompatible avec une clé d'index.

L'élargissement impose de **supprimer l'index filtré avant l'`ALTER COLUMN`** : le prédicat référence la colonne, ce qui crée une dépendance de schéma (erreur SQL 5074). La migration fait DROP → ALTER → CREATE, chaque étape gardée indépendamment pour qu'un `Up` interrompu soit rattrapable.

### D4 — Jeu de caractères Code 128 restreint

Lettres ASCII, chiffres, et `-` `.` `_` espace. Sont **exclus** `/ \ % ? # & < > " '` et tout le reste, au titre de C2. Bénéfice collatéral : ces valeurs étant réimprimées sur des étiquettes, aucun vecteur d'injection ne subsiste.

### D5 — Unicité : garde applicative d'abord, index UNIQUE plus tard

L'index reste non unique (C3). Un contrôle applicatif renvoyant `Error.Conflict` est ajouté aux trois chemins d'écriture, ce qui **arrête la production de nouveaux doublons** — condition préalable au futur index UNIQUE, qui reste un chantier séparé conditionné à un balayage vide sur l'ensemble du parc.

### D6 — Le drapeau garde l'écriture, jamais la lecture

`Features:Barcodes:ExtendedSymbologiesEnabled`, éteint par défaut, n'est consulté que par `BarcodePolicy.EnsureWritable`, appelée depuis les trois handlers d'écriture. La lecture reste tolérante en permanence.

C'est ce qui en fait un véritable interrupteur d'arrêt : l'éteindre ramène exactement le comportement antérieur sans jamais rendre illisible une valeur déjà enregistrée. L'inverse — garder la lecture — créerait un état où des codes présents en base cesseraient d'être trouvables.

### D7 — Encodeur écrit à la main, rendu vectoriel, aucune dépendance ajoutée

Aucun générateur de code-barres linéaire n'existait dans le dépôt : QRCoder ne produit que du
QR. Plutôt qu'ajouter un paquet NuGet à une solution en `TreatWarningsAsErrors`, les trois
familles nécessaires sont implémentées directement — EAN/UPC (tables L/G/R et parité), ITF-14
(entrelacé 2 parmi 5), Code 128 jeu B (107 motifs, somme de contrôle modulo 103).

L'encodeur ne renvoie **pas une image** mais une suite de **largeurs de modules**. Le rendu
QuestPDF en fait des rectangles : le symbole est donc vectoriel et reste net à n'importe quelle
résolution. Une image rastérisée perdrait un demi-pixel par barre sur une thermique 203 dpi,
qui est précisément le support visé.

La correction est établie par **aller-retour** : un décodeur indépendant, écrit dans le projet
de test à partir de la spécification, doit retrouver la valeur d'origine. Épingler des motifs
recopiés depuis l'encodeur figerait une erreur au lieu de la révéler. Le balayage couvre les
dix familles de préfixe EAN-13 (la parité de la moitié gauche dépend du premier chiffre, donc
une erreur peut n'affecter qu'une famille) et tout l'ASCII imprimable en Code 128.

### D8 — Les étiquettes ne passent pas par `PdfService`

`ProductLabelPdfRenderer` est un service à part, et non un fichier partiel de `PdfService`.
Deux raisons : le constructeur de `PdfService` aurait dû accueillir l'encodeur, ce qui touche
un fichier partagé par une quinzaine de documents commerciaux ; et surtout, mêler les deux
ferait porter à la facture le risque d'une régression d'étiquette. Les géométries n'ont rien
en commun.

## Conséquences

**Pour un catalogue EAN-13 existant, rien ne change** : mêmes valeurs acceptées, mêmes messages d'erreur (celui de la clé de contrôle est conservé mot pour mot), même colonne, même égalité. La seule nouveauté observable est la propriété `Symbology`, qui vaut `Ean13`.

Deux tests unitaires existants ont dû être **réécrits plutôt qu'amendés**, parce que leur intention avait basculé :

- `WrongLengthIsRejected` utilisait `"123456789012"` comme exemple de longueur invalide. Or c'est un **UPC-A parfaitement valide** (somme pondérée 98, clé attendue 2, dernier chiffre 2). Le cas passait donc d'échec attendu à succès.
- `NonDigitIsRejected` utilisait `"400638133393A"` et `"4006-38133393"`, qui sont désormais des Code 128 valides.

Ces bascules sont la raison pour laquelle le chantier a commencé par un lot de tests de caractérisation écrits **avant** toute modification.

## Voir aussi

- `docs/runbooks/barcode-cutover.md` — rampe de déploiement
- `docs/runbooks/sql/WidenProductBarcode_Tenant.idempotent.sql` — jumeau SQL de la migration
- `docs/runbooks/invoice-number-uniqueness.md` — doctrine sur les index UNIQUE
- `docs/backend-tenant-migrations.md` — migrations tenant écrites à la main
