# 14 - Codes-barres

Ce chapitre explique comment renseigner les **codes-barres** de vos articles, les **scanner**
sur vos documents, et **imprimer des étiquettes**.

> Cette fonctionnalité s'active par étapes. Si vous ne voyez pas le champ de scan ou le bouton
> d'impression, c'est qu'elle n'a pas encore été ouverte sur votre dossier : contactez votre
> administrateur.

---

## Renseigner le code-barres d'un article

1. Ouvrez **Produits**, puis la fiche de l'article.
2. Le champ **Code-barres** se trouve dans « Informations générales », sous la catégorie.
3. Scannez l'étiquette de l'article avec votre douchette, ou saisissez le code à la main.
4. Enregistrez.

Le type de code est reconnu automatiquement et affiché sous le champ : EAN-13, EAN-8, UPC-A,
GTIN-14 ou Code 128.

### Le code-barres n'est pas le code produit

Ce sont deux identifiants distincts, et c'est voulu :

- le **code produit** est le vôtre : `TAB-001`, `CHAISE-BUREAU`… vous le choisissez ;
- le **code-barres** est celui imprimé sur l'emballage par le fabricant.

Un même article a donc les deux. La caisse interroge le code-barres en priorité, et se rabat sur
votre code produit si l'article n'a pas encore d'EAN renseigné.

### Un code mal recopié est refusé tout de suite

Les codes-barres du commerce portent un **chiffre de contrôle** : le dernier chiffre est calculé
à partir des précédents. Si vous en recopiez un de travers, FactuTrust le refuse à
l'enregistrement, avec le message « Clé de contrôle invalide ».

C'est une protection, pas une contrariété : sans elle, l'erreur ne se découvrirait qu'au premier
scan en caisse, sur un article qui ne se trouve pas.

### Articles sans code-barres du fabricant

Pour un article que vous fabriquez, reconditionnez ou vendez en vrac, cliquez sur
**Générer un code interne**. FactuTrust propose un code valide, réservé à l'usage interne, qui
ne peut par construction jamais entrer en collision avec celui d'un fabricant.

Le code proposé n'est enregistré que si vous enregistrez la fiche.

### Un code-barres par article

Le même code ne peut pas être porté par deux articles de votre dossier : au scan, rien ne
permettrait de savoir lequel encaisser. Si le code est déjà pris, l'enregistrement est refusé et
vous indique le conflit.

En revanche, deux **dossiers différents** peuvent parfaitement utiliser le même code-barres.

---

## Scanner sur vos documents

Un champ **Scanner un code-barres** apparaît au-dessus de la grille des lignes sur :

| Domaine | Documents |
|---|---|
| Achats | commande fournisseur, bon de réception, facture fournisseur |
| Ventes | facture, devis, bon de livraison, commande client |
| Stock | bon d'entrée, bon de sortie, transfert inter-dépôts |
| Inventaire | comptage physique |

**Comment s'en servir** : cliquez dans le champ, puis scannez. La douchette tape le code et
valide toute seule. Le champ se vide et reprend le curseur, ce qui permet d'enchaîner les scans
sans toucher la souris.

- Article déjà présent sur le document ⇒ sa **quantité augmente de 1**.
- Article absent ⇒ une **nouvelle ligne** est créée, au prix du catalogue.

Un bip aigu confirme, un double bip grave signale un refus. Le motif s'affiche toujours à
l'écran.

### Sur l'inventaire physique, le scan ne crée rien

C'est la seule exception, et elle est importante. Le périmètre d'un inventaire est arrêté à son
ouverture : y ajouter un article au vol fausserait l'écart entre le stock théorique et le stock
compté, qui est précisément ce que l'inventaire mesure.

Ici, le scan **vous amène directement sur l'article** dans la liste et place le curseur dans le
champ de quantité. Plus besoin de chercher une référence parmi plusieurs centaines.

Un article scanné hors du périmètre vous est signalé, jamais ajouté.

### Pourquoi un scan peut être refusé

| Message | Raison |
|---|---|
| Aucun article ne correspond | Le code n'est renseigné sur aucune fiche. Renseignez-le d'abord sur l'article. |
| Choisissez une variante (SKU) | Vous avez scanné un **modèle** de variantes. Scannez la déclinaison précise (taille, couleur). |
| L'article est désactivé | Réactivez-le depuis sa fiche si c'est voulu. |
| L'article n'est pas géré en stock | Un bon d'entrée, de sortie ou un transfert ne porte que des articles suivis en stock. |
| Utilisez un bon de réception | Sur une **facture fournisseur directe**, les articles suivis en stock sont refusés : ils doivent passer par un bon de réception, seul document qui mouvemente le stock. |
| Plusieurs articles portent ce code | Deux fiches ont le même code produit interne. Choisissez dans la liste, puis corrigez les fiches. |

### La caisse (POS)

Le point de vente n'a pas besoin de ce champ : il écoute la douchette en permanence, dès que
l'écran de caisse est ouvert. Son fonctionnement n'a pas changé.

---

## Imprimer des étiquettes

1. Depuis la **liste des produits**, cliquez sur l'icône imprimante de la ligne ; ou depuis la
   **fiche article**, sur le bouton **Étiquettes**.
2. Choisissez le **gabarit** correspondant à vos planches adhésives ou à votre rouleau.
3. Indiquez le **nombre d'étiquettes**.
4. Cochez éventuellement **Imprimer le prix TTC**.
5. Cliquez sur **Générer le PDF**.

Le nombre de planches nécessaires s'affiche avant l'impression.

### Gabarits disponibles

| Gabarit | Étiquette | Par planche |
|---|---|---|
| A4 — 65 étiquettes | 38,1 × 21,2 mm | 65 |
| A4 — 40 étiquettes | 52,5 × 29,7 mm | 40 |
| A4 — 24 étiquettes | 70 × 37 mm | 24 |
| A4 — 21 étiquettes | 70 × 42,3 mm | 21 |
| Rouleau thermique | 58 × 40 mm | en continu |
| Rouleau thermique | 40 × 30 mm | en continu |

### Imprimer à 100 %, sans mise à l'échelle

C'est le point le plus important, et la cause la plus fréquente d'étiquettes illisibles.

Dans la fenêtre d'impression de votre navigateur, réglez l'échelle sur **100 %** et
**désactivez** « Ajuster à la page ». Une réduction de quelques pourcents suffit à sortir les
barres des tolérances, et la douchette ne les lit plus — alors que l'étiquette paraît
parfaitement nette à l'œil.

Avant de lancer une grosse série, imprimez **une planche d'essai** et relisez à la douchette
trois étiquettes prises à des endroits différents : en haut à gauche, au centre, en bas à
droite.

### Le prix est facultatif, et éteint par défaut

Une étiquette survit à un changement de tarif. Un prix imprimé sur un article en rayon vous
engage : ne le cochez que si vous réimprimez à chaque changement.

### Articles sans code-barres

Ils reçoivent quand même une étiquette, portant leur **code produit** en clair à la place des
barres. Inutile de trier votre sélection.

---

## Voir aussi

- [05 - Fiches](05-fiches.md) — créer et modifier un article
- [06 - Stock](06-stock.md) — inventaire physique, variantes
- [12 - POS](12-pos.md) — la caisse
