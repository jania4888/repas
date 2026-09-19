# Runbook — Déploiement de la gestion des codes-barres

Rampe de mise en service du chantier codes-barres (achat, vente, stock). Chaque étape est
réversible ; l'ordre entre les étapes 2 et 3 est **contraint**, les autres sont souples.

Décisions de conception : `docs/architecture/adr-barcode-symbologies.md`.

## Drapeaux

Plafonds de l'impression : **500 étiquettes**, **200 articles distincts**, **500 par article**
et par requête, plus une limite de débit de 10 impressions par minute et par utilisateur
(politique `labels`). Ils protègent d'une erreur de sélection, pas d'un abus.

| Drapeau | Emplacement | Défaut | Portée |
|---|---|---|---|
| `Features:Barcodes:ExtendedSymbologiesEnabled` | `FactuTrust.API/appsettings.json` | `false` | Écriture d'un code autre qu'EAN-8/EAN-13 |
| `Features:Barcodes:LabelPrintingEnabled` | idem | `false` | Endpoint PDF d'étiquettes |
| `barcodeScanOnDocuments` | `environment.featureFlags` | `false` | Champ de scan sur les documents |
| `barcodeLabelPrinting` | idem | `false` | Bouton d'impression d'étiquettes |

Le point de vente **n'est pas drapeauté** : son comportement est inchangé par le chantier.

## Étapes

| # | Étape | Action | Réversible ? |
|---|---|---|---|
| 1 | **Balayage préalable** | Sur **chaque** base tenant : `SELECT MAX(LEN([Barcode])) FROM [Products];` (doit être ≤ 13 avant migration) et le balayage des doublons du jumeau SQL. Consigner le résultat. | n/a (lecture seule) |
| 2 | **Migration de schéma** | `WidenProductBarcode_Tenant` par l'API au démarrage, ou le jumeau `docs/runbooks/sql/WidenProductBarcode_Tenant.idempotent.sql` si la migration ne peut pas être appliquée. Vérifier `SELECT COL_LENGTH('Products','Barcode')` = 96. | Oui — `Down` non destructif |
| 3 | **Déploiement back**, drapeaux éteints | ⚠️ **Après l'étape 2, jamais avant.** Déployer le binaire avec les deux drapeaux à `false`. Comportement observable : identique à l'existant. | Oui — rollback binaire |
| 4 | **Symbologies étendues** | `ExtendedSymbologiesEnabled = true`, un environnement à la fois. Les utilisateurs peuvent alors enregistrer UPC-A, GTIN-14 et Code 128. | Oui — bascule du drapeau |
| 5 | **Déploiement front**, drapeaux éteints | Les écrans sont pixel-identiques à l'existant. | Oui |
| 6 | **Pilote** | `barcodeScanOnDocuments = true` sur **un** dossier volontaire. Faire scanner une réception et un inventaire réels. | Oui — override `localStorage` puis configuration |
| 7 | **Étiquettes** | `LabelPrintingEnabled` + `barcodeLabelPrinting`. Imprimer une planche `A4_65` **sur papier** et la relire à la douchette avant généralisation. | Oui |
| 8 | **Généralisation** | Étendre les drapeaux front à l'ensemble du parc. | Oui |

### Vérifier une planche avant de généraliser

L'impression est le seul point du chantier qu'aucun test ne peut clore : un PDF correct peut
donner une étiquette illisible. Trois contrôles sur la première planche papier :

1. **Échelle** — mesurer la largeur des barres d'une étiquette. Une impression « ajustée à la
   page » réduit de quelques pourcents et rend le symbole hors tolérance. Imprimer à **100 %**,
   sans mise à l'échelle.
2. **Marge blanche** — il doit rester un blanc net à gauche et à droite des barres. Sans cette
   « quiet zone », la douchette ne trouve pas le début du symbole : c'est la cause la plus
   fréquente d'une étiquette pourtant bien imprimée qui ne se lit pas.
3. **Relecture** — scanner trois étiquettes prises à des endroits différents de la planche
   (haut gauche, centre, bas droite). Une dérive de gabarit ne se voit que sur les dernières
   rangées.

Gabarits disponibles : `A4_65`, `A4_40`, `A4_24`, `A4_21`, `Roll_58x40`, `Roll_40x30`
(`LabelSheetLayout.All`). En ajouter un tient en une ligne — les dimensions doivent être celles
imprimées par le fabricant du support, au millimètre.

## Le piège de l'étape 2

`IX_Products_Barcode` est un index **filtré** (`WHERE [Barcode] IS NOT NULL`). Son prédicat
référence la colonne, ce qui crée une dépendance de schéma : un `ALTER COLUMN` direct échoue
(erreur SQL 5074). La migration supprime l'index, élargit, puis le recrée — chaque étape gardée
indépendamment, de sorte qu'un `Up` interrompu entre le DROP et le CREATE soit rattrapé au rejeu.

Une migration en échec **bloque le tenant au démarrage** (`TenantMigrationGuard` → 503
`TENANT_MIGRATION_FAILED`). C'est la raison d'être du test `WidenProductBarcodeMigrationTests`,
qui vérifie sur le texte source que le DROP précède l'ALTER.

## L'ordre 2 → 3 est contraint

Déployer le back avant la migration expose à une troncature SQL silencieuse ou à une
`SqlException` sur tout tenant non encore migré, dès qu'un code de plus de 13 caractères est
enregistré. L'inverse est sans risque : élargir un `nvarchar` est une opération de métadonnées
seules, et une instance d'API non encore déployée continue de lire et d'écrire des valeurs de
13 caractères ou moins sur une colonne qui en accepte 48.

## Retour arrière

| Depuis | Action |
|---|---|
| Étapes 6–8 | Éteindre les drapeaux front. Les codes déjà saisis restent en base et restent lisibles. |
| Étape 4 | Éteindre `ExtendedSymbologiesEnabled`. **Les codes étendus déjà enregistrés restent lisibles et scannables** — le drapeau ne garde que l'écriture. Ils ne seront simplement plus modifiables tant qu'il est éteint. |
| Étape 3 | Rollback binaire. Le schéma élargi reste compatible. |
| Étape 2 | `Down` de la migration. Il **refuse de rétrécir** la colonne si une valeur dépasse déjà 13 caractères : dans ce cas, la colonne reste large, ce qui est sans conséquence fonctionnelle. |

## Hors périmètre

- **Index UNIQUE sur `Products.Barcode`** — chantier séparé. Conditions préalables : la garde
  d'unicité applicative déployée depuis assez longtemps pour que le parc ne produise plus de
  doublons, **et** un balayage vide sur **tous** les tenants. Tant qu'un seul tenant a un
  doublon, cette migration bloque son démarrage. Doctrine : `docs/runbooks/invoice-number-uniqueness.md`.
- Scan par caméra, GS1-128 avec identifiants d'application, journal d'audit des scans,
  plusieurs codes-barres par article.
