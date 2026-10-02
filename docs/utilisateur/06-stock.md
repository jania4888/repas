# 06 - Stock

Ce chapitre explique comment gérer votre **stock** et effectuer un **inventaire physique**.

---

## Gestion du stock

La gestion du stock permet de suivre les quantités de produits disponibles dans votre entreprise.

### Accéder à la gestion du stock

1. Dans le menu, cliquez sur **Stock** puis **Gestion de stock**.
2. La liste des produits avec suivi de stock s'affiche.

### État de stock (rapport actuel)

1. Dans le menu, cliquez sur **Stock** puis **État de stock**.
2. Consultez les quantités et valeurs par **entrepôt** et **catégorie**, avec filtres et regroupement.
3. Utilisez **Imprimer (PDF)** ou **Exporter** pour obtenir un document imprimable.
4. Pour un stock **à une date passée**, utilisez **Stock → Rapports** (section « état à une date antérieure »).

![Gestion du stock](../screenshots/06-stock/stock-gestion.png)

### Vue simple et vue avancée

Vous pouvez basculer entre deux modes d'affichage :

- **Vue simple** : liste des produits avec quantité disponible
- **Vue avancée** : vue détaillée avec plus d'informations

### Bons d'entrée (BE)

Un **bon d'entrée** est un document numéroté (préfixe **BE**) pour enregistrer une entrée de stock **hors achat commercial**.

Utilisez-le pour :

- le **stock initial**
- un **retour client** hors bon de retour (BRT) / avoir
- un **achat hors réception** (sans bon de réception, sans commande, sans facture)
- un article **trouvé / autre**

1. Dans le menu, cliquez sur **Stock** puis **Bons d'entrée**.
2. Cliquez sur **Nouveau bon d'entrée**.
3. Choisissez le dépôt, la date et le motif.
4. Ajoutez une ou plusieurs lignes (produits gérés en stock, quantité, coût unitaire).
5. Enregistrez le **brouillon**, puis **validez**. Le stock n'est mis à jour qu'à la validation.

Vous pouvez télécharger un PDF, annuler un bon validé (si le stock est encore disponible) ou dupliquer un bon en brouillon.

> **Important** : pour une réception fournisseur, utilisez **Achats > Bons de réception**. Un BE « Achat hors réception » n'impute pas de commande et ne crée pas de facture.

La confirmation d'un **bon de retour** (menu Ventes) crée automatiquement une entrée au **même dépôt** que le bon de livraison, au coût moyen (CMUP), motif « Retour Client ». Le brouillon ne touche pas le stock. Ce n'est pas un avoir : l'avoir n'intervient qu'après facture. Ce flux n'utilise pas de bon d'entrée BE.

![Formulaire entrée de stock](../screenshots/06-stock/stock-entree.png)

### Bons de sortie (BS)

Un **bon de sortie** est un document numéroté (préfixe **BS**) pour une sortie **hors vente**.

Utilisez-le pour :

- une **casse / perte**
- un **retour fournisseur** hors flux achat
- une **consommation interne**
- un **don / échantillon**

1. Dans le menu, cliquez sur **Stock** puis **Bons de sortie**.
2. Cliquez sur **Nouveau bon de sortie**.
3. Choisissez le dépôt, la date et le motif.
4. Ajoutez les lignes. Le coût est le **CMUP** (non saisissable). Une alerte s'affiche si la quantité dépasse le disponible.
5. Enregistrez le brouillon, puis validez. Si le stock est insuffisant, la validation est refusée.

Les ventes et livraisons sortent le stock via la **facture** ou le **bon de livraison**, pas via un BS. Les transferts entre dépôts se font dans **Stock > Transferts**.

![Formulaire sortie de stock](../screenshots/06-stock/stock-sortie.png)

> **Attention** : le stock ne peut pas devenir négatif. L'annulation d'un BE validé est refusée si les articles ont déjà quitté le dépôt.

### Historique du stock

Pour voir l'historique des mouvements d'un produit :

1. Cliquez sur le produit dans la liste ou sur **Historique**.
2. La liste des entrées et sorties s'affiche avec les dates et quantités.

---

## Inventaire physique

Un **inventaire physique** consiste à compter réellement les produits en stock pour vérifier que les quantités enregistrées correspondent à la réalité.

### Démarrer un inventaire

1. Dans le menu, cliquez sur **Stock** puis **Inventaire**.
2. Cliquez sur **Démarrer un inventaire**.

![Inventaire - Démarrage](../screenshots/06-stock/inventaire-start.png)

### Compter les produits

1. Suivez les instructions à l'écran.
2. Pour chaque produit dont le stock réel diffère, saisissez la **quantité comptée**.
3. Vous n'êtes pas obligé de retoucher chaque article : les quantités non modifiées restent celles du système.

![Inventaire - Comptage](../screenshots/06-stock/inventaire-count.png)

### Récapitulatif et validation

1. Cliquez sur **Valider** (ou, en mode assistant, **Terminer / voir le récapitulatif**).
2. Les articles non saisis sont **confirmés à la quantité système** : aucun mouvement de stock pour ces lignes.
3. Seuls les **écarts saisis** ajustent le stock.
4. Vérifiez le récapitulatif, puis confirmez la validation.

![Inventaire - Récapitulatif](../screenshots/06-stock/inventaire-summary.png)

> **Astuce** : Effectuez l'inventaire à un moment calme (fin de journée ou week-end) pour éviter les mouvements pendant le comptage.

---

## Variantes de produit (SKU)

Certaines familles (textile, chaussure, etc.) se déclinent en **taille, couleur** ou autre axe. Dans FactuTrust, chaque combinaison est un **produit à part** (un SKU), avec son code, son code-barres et son stock (voir [14 - Codes-barres](14-codes-barres.md)).

1. Créez les **axes de variantes** (Paramètres > Axes de variantes) : ex. Taille (S, M, L) et Couleur (Bleu, Rouge).
2. Créez un produit **modèle** et activez **Modèle de variantes**.
3. Sélectionnez les valeurs d'axes puis **Générez les SKU**.
4. Ajustez les **prix par SKU** dans le tableau des enfants (ou appliquez les prix du modèle).
5. Le modèle n'est **ni vendable ni stockable** : sur une facture, un BL ou au POS, sélectionnez toujours une **variante** (SKU).
6. Le code d'une variante est du type `{CODE-PARENT}-{AXE1}-{AXE2}` (50 caractères max).

**En vente** : utilisez la recherche SKU directe ou le sélecteur **Par modèle** (bouton variantes sur les lignes de document).

Le **POS** et les listes de vente n'affichent pas les modèles ; seuls les SKU enfants sont vendables.

> Cette fonction n'apparaît que si l'option **variantes** est activée pour votre entreprise.

---

## Lots, dates de péremption et FEFO

Pour l'agro, la pharma ou tout article à **n° de lot** / **DLUO** :

1. Sur la fiche produit, activez le suivi **Lot** (et éventuellement **Péremption**). Impossible d'activer le lot si un stock existe déjà sans lots : faites d'abord un inventaire d'ouverture ou un lot technique unique.
2. À la **réception** (BR) et au **bon d'entrée**, saisissez le n° de lot, la DLUO et la quantité par lot.
3. À la **sortie** (BL, facture sans BL, bon de sortie), le système sort d'abord le lot qui **expire le plus tôt** (FEFO), sauf saisie manuelle.
4. Un article suivi **ne peut pas** partir en rupture partielle : s'il manque du stock (ou un lot périmé bloqué), le document reste brouillon.
5. Un **avoir** ou une **annulation** remet le stock **sur les mêmes lots** que la sortie d'origine.
6. Un **transfert** conserve le n° de lot entre dépôts.

Dans **Stock > Gestion de stock**, un bandeau signale les lots bientôt périmés. Cliquez une ligne pour voir le détail des lots.

> Cette fonction n'apparaît que si le suivi des lots est activé. Sans activation, le stock reste au produit × dépôt, comme aujourd'hui.

---

## Valorisation FIFO / LIFO

Par défaut, le coût de stock est le **CMUP** (coût moyen unitaire pondéré). Pour un produit, vous pouvez passer en **FIFO** (premier entré, premier sorti) ou **LIFO**.

- FIFO / LIFO ne s'activent pas tant qu'il reste du stock valorisé en CMUP : créez d'abord une **couche d'ouverture** (bouton sur la fiche produit).
- L'écran stock continue d'afficher un **coût unitaire** : pour FIFO/LIFO, c'est la valeur restante des couches / quantité.
- Un **transfert** recopie les couches (quantité, coût, date de réception, lot) vers l'entrepôt destination. Un **avoir** ou une **annulation** restitue les couches d'origine, pas une nouvelle couche à la date du jour.
- Une facture **mixte** (FIFO + CMUP) déduit toutes les lignes gérées en stock dans la même transaction.
- **LIFO** est disponible opérationnellement mais souvent **non retenu** pour les comptes statutaires tunisiens / IFRS. Demandez à votre expert-comptable avant de l'utiliser.

---

## Inventaire par lot

Si un produit est suivi par lot, l'inventaire **éclate une ligne par lot** lorsque des lots existent déjà en stock. Comptez chaque lot séparément. Le comptage rapide (ajustement global) est **refusé** sur ces articles.

Pour un **inventaire d'ouverture** (produit suivi par lot, stock théorique à 0, aucun lot enregistré), saisissez le **n° de lot** en même temps que la quantité comptée. Ce lot sera créé à la validation de l'inventaire.

---

[Retour à l'index](README.md) | [Précédent : Fiches](05-fiches.md) | [Suivant : Paiements](07-paiements.md)

