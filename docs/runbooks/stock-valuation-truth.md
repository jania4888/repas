# Runbook — Valorisation de stock selon la méthode (CMUP / FIFO / LIFO)

> **Objectif** : faire en sorte que la **valeur de stock** et le **coût unitaire affiché** soient calculés selon la méthode de valorisation de l'article, et non lus sur un cache qui dérive.

> **Stratégie** : diagnostic d'abord (lecture seule), puis une **source de vérité unique** partagée par les écrans et par le grand-livre, puis réparation des données existantes. Chaque lot est réversible sauf l'`UPDATE` de réparation.

Voir aussi : [`docs/utilisateur/06-stock.md`](../utilisateur/06-stock.md), [`docs/runbooks/stock-lots-cutover.md`](stock-lots-cutover.md).

---

## 0. Le problème en une page

Le stock a **deux représentations** de sa valeur :

| | source | autoritaire pour |
|---|---|---|
| `StockItems.AverageCost` — scalaire `decimal(18,4)` | une colonne | **CMUP uniquement** |
| `StockValuationLayers` — les couches | des lignes | **FIFO / LIFO** |

Toutes les lectures de l'application lisent le **scalaire**, sans jamais consulter la méthode de l'article. Pour un article FIFO/LIFO ce scalaire n'est qu'un cache d'affichage : il n'est rafraîchi que lorsqu'une mutation emprunte le chemin « tracé », puis il est **arrondi à 4 décimales** en base. Il peut donc diverger des couches — et cette divergence se **propage**, parce que sept chemins d'écriture lisent ce même cache pour valoriser un nouveau mouvement.

Trois symptômes typiques, tous visibles à l'écran :

1. Un article FIFO/LIFO dont le P.U. affiché ne correspond à aucune de ses couches.
2. Un article avec de la quantité et une valeur à `0,000` — son stock n'est entré que par inventaire, et `AdjustStock` n'injecte jamais de coût.
3. Un total de stock qui ne recoupe pas la somme des couches.

---

## 1. Diagnostic — à faire EN PREMIER, avant toute modification de code

Script : [`sql/ScanStockValuationDrift_Tenant.readonly.sql`](sql/ScanStockValuationDrift_Tenant.readonly.sql). **Il n'écrit rien.**

```bash
sqlcmd -S <serveur> -d <base_tenant> -I -i docs/runbooks/sql/ScanStockValuationDrift_Tenant.readonly.sql -o scan-<tenant>-avant.txt
```

> ⚠️ L'option `-I` (QUOTED_IDENTIFIER ON) est **obligatoire** : sans elle, SQL Server échoue avec `Msg 1934`.
> ⚠️ Sous Git Bash, `MSYS_NO_PATHCONV=1` est requis pour les binaires Windows, mais il **casse** `-o` en silence. Préférer la redirection shell : `... > scan-<tenant>-avant.txt`.

À exécuter sur **chaque** base tenant. Conserver chaque sortie : la section 6 est la photo « avant ».

### Grille de lecture

| section | ce qu'elle dit | action |
|---|---|---|
| **1** | Articles FIFO/LIFO **sans aucune couche**, avec du stock | **Non réparable par script.** Créer la couche d'ouverture depuis la fiche article (bouton « Créer la couche d'ouverture FIFO/LIFO »), ou repasser l'article en CMUP. |
| **2** | Quantité des couches ≠ quantité en stock | Le plus grave : `ValuationLayerInvariant` rejettera toute mutation tracée sur ces articles. À traiter article par article, avec un inventaire. |
| **3** | Valeur des couches ≠ valeur du cache | Réparable : [`sql/RepairStockItemAverageCostFromLayers_Tenant.idempotent.sql`](sql/RepairStockItemAverageCostFromLayers_Tenant.idempotent.sql) (lot G). |
| **4** | Le P.U. affiché **avant / après** le changement de règle | Rien à faire : c'est le chiffrage de l'impact visuel, à montrer avant livraison. |
| **5** | Articles non valorisés (quantité > 0, coût 0) | Corriger par un **bon d'entrée chiffré**, ou activer `InventoryAutoValuationEnabled` (lot E) après accord du comptable. |
| **6** | Totaux par entrepôt, « cache » vs « couches » | **Le chiffre à soumettre à l'expert-comptable.** |
| **7** | Récapitulatif d'une ligne | À coller dans le journal de bord du cutover. |

### Seuils

- Quantités : `0,0001` — la constante `ValuationLayerInvariant.Tolerance`.
- Valeurs : `0,001` — une quantité à 4 décimales multipliée par un coût à 4 décimales ne peut pas se comparer à `0,0001`.

### Décider à partir du scan

- **Section 1 non vide** → ces articles continueront d'afficher la valeur du cache (repli assumé, pas de régression visible), mais leur première sortie échouera. Les traiter avant d'activer quoi que ce soit.
- **Section 2 non vide** → ne pas livrer le lot D avant de les avoir résolus : les écritures iraient chercher un coût dans des couches incohérentes.
- **Section 6, colonne `Ecart` significative** → c'est la correction de valeur que verra la comptabilité. Elle doit être acceptée **avant** livraison, pas découverte après.

---

## 2. Changement de contrat : ce que le P.U. affiché veut dire

**Avant** : pour un article FIFO/LIFO, le P.U. affiché était la valeur restante des couches ÷ quantité (une moyenne).

**Après** : le P.U. affiché est le **coût de la prochaine sortie** — la couche la plus ancienne en FIFO, la plus récente en LIFO, départagées par `Id` à `ReceivedAt` égal, exactement comme le fait le moteur de consommation.

La **valeur** ne change pas de définition : elle reste la somme des couches restantes.

> **Conséquence assumée : `P.U. × Qté ≠ Valeur` sur les lignes FIFO/LIFO.**
> C'est volontaire. L'écran doit le dire (badge de méthode + légende sous le tableau), sinon cela passe pour un bug. Pour un article CMUP, rien ne change : `P.U. × Qté = Valeur`.

Ce point et l'auto-valorisation des inventaires (§4) sont les **deux décisions à faire relire par l'expert-comptable**, avec le chiffrage de la section 6 du scan.

---

## 3. Ordre de livraison

| # | lot | contenu | bloque | réversible |
|---|---|---|---|---|
| 1 | **A** | scan SQL lecture seule + ce runbook | — | ✅ total |
| 2 | **B** | source de vérité unique, zéro changement de comportement | — | ✅ revert |
| 3 | **C** | les 4 lectures + front + coercion d'énum | B | ✅ revert (DTO additifs) |
| 4 | **D** | les 8 écritures sur la même source | B | ✅ revert (couches passées non réécrites) |
| 5 | **F** | invariant observationnel + journalisation | B | ✅ revert |
| 6 | **G** | réparation des données + doc utilisateur | A, C | ⚠️ **voir §5** |
| 7 | **E** | auto-valorisation d'inventaire (drapeau OFF) | D + accord comptable | ✅ par le drapeau |
| 8 | **H** | suppression des méthodes obsolètes | C | ✅ |

### Recette « flag-off » du lot C

Le lot C peut être livré avec `Features:Stock:FifoLifoValuationEnabled` à **`false`** sur un tenant pilote : les écrans doivent alors être **identiques au bit près**, et **aucune requête supplémentaire** ne doit partir (la lecture des couches n'est pas exécutée quand le drapeau est à false). C'est la preuve d'absence de régression. Rebasculer ensuite à `true`.

---

## 4. Auto-valorisation des entrées d'inventaire (lot E)

Drapeau `Features:Stock:InventoryAutoValuationEnabled`, **`false` par défaut**, posé explicitement dans `appsettings.json` et `appsettings.Production.json`.

Activé, une entrée d'inventaire ou de comptage rapide sans coût est valorisée par la cascade :

```
dernier prix d'achat  →  prix d'achat de la fiche  →  0
```

> **La question comptable** : sur un article **CMUP**, valoriser un écart d'inventaire positif **déplace le CMUP**, ce que `AdjustStock` ne fait pas aujourd'hui. À soumettre avec la liste de la section 5 du scan.

Rollback : remettre le drapeau à `false`. Les mouvements déjà écrits à un coût non nul **ne sont pas** réécrits.

---

## 5. Réparation des données (lot G)

Script : [`sql/RepairStockItemAverageCostFromLayers_Tenant.idempotent.sql`](sql/RepairStockItemAverageCostFromLayers_Tenant.idempotent.sql).

Il recale `AverageCost` sur la valeur des couches, **uniquement** pour les articles FIFO/LIFO **qui ont au moins une couche ouverte**.

- **Il n'invente aucune couche.** Les articles de la section 1 du scan sont *listés*, pas réparés : créer une couche d'ouverture est une décision métier, qui passe par la fiche article.
- **Idempotent** : une deuxième exécution met 0 ligne à jour.
- **Sauvegarder la base avant.** Le `SELECT` de rapport matérialise l'ancienne valeur de chaque ligne touchée : **c'est la seule trace permettant un retour arrière**. La conserver avec la sortie du scan.

Procédure : exécuter, **relire le rapport**, puis seulement `COMMIT`. Puis relancer le scan et comparer la section 6 à la photo « avant ».

---

## 6. Contrôles d'acceptation

- [ ] Scan exécuté et archivé sur chaque tenant, **avant** le lot B.
- [ ] Sections 1 et 2 vides, ou traitées article par article.
- [ ] Section 6 (écart de valeur) acceptée par l'expert-comptable.
- [ ] Changement de sens du P.U. (§2) validé, et `docs/utilisateur/06-stock.md` mis à jour.
- [ ] Recette flag-off du lot C : écrans identiques, aucune requête ajoutée.
- [ ] Après réparation : scan relancé, sections 2 et 3 vides, section 6 conforme à l'attendu.
- [ ] `InventoryAutoValuationEnabled` laissé à `false` tant que le comptable n'a pas tranché.
