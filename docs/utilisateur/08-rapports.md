# 08 - Rapports

FactuTrust propose des **rapports** pour analyser votre activité : ventes, achats, stock, fiches et paiements.

---

## Accéder aux rapports

Les rapports sont accessibles depuis le menu :

- **Ventes** > **Rapports**
- **Achats** > **Rapports**
- **Fiches** > **Rapports**
- **Stock** > **Rapports**
- **Paiements** > **Rapports**

---

## Rapports Ventes

![Rapports ventes](../screenshots/08-rapports/rapports-ventes.png)

Les rapports ventes affichent notamment :

- **Chiffre d'affaires** sur une période
- **Factures** récentes ou en attente
- **Graphiques** d'évolution des ventes

---

## Rapports Achats

Les rapports achats affichent :

- Montant des achats par période
- Factures fournisseurs
- Statistiques par fournisseur

---

## Rapports Stock

Les rapports stock affichent :

- **État de stock (actuel)** : menu **Stock → État de stock** (`/reports/stock-status`) — quantités et valeurs par entrepôt et catégorie, PDF imprimable
- **Alertes de stock** : produits en rupture ou en stock bas (hub Rapports Stock)
- **Mouvements** de stock
- **Valeur** du stock

---

## Rapports Fiches (Clients et Produits)

Les rapports fiches affichent :

- **Top clients** : clients avec le plus de chiffre d'affaires
- **Produits** les plus vendus
- Liens directs vers les fiches détaillées

---

## Rapports Paiements

Les rapports paiements affichent :

- **Trésorerie** : cash flow, encaissements, décaissements
- **Factures impayées**
- **Échéances** à venir

---

## Hub Rapports (`/reports`)

Depuis le hub central **Rapports**, vous accédez notamment à :

| Rapport hub | Emplacement |
|---|---|
| Soldes client | Rapports Fiches → section Soldes client |
| Soldes fournisseur | Rapports Achats → onglet Soldes fournisseur |
| État de stock (actuel) | Stock → État de stock |
| État de stock à une date antérieure | Rapports Stock → section snapshot (date + entrepôt) |
| Total des retenues pour les clients | Rapports Ventes → onglet Retenues clients (période = date d'encaissement) |
| Total des retenues pour les fournisseurs | Rapports Achats → onglet Retenues fournisseurs (période = date de solde PaidAt, aligné TEJ) |

Les liens du hub ouvrent directement la page et la section ou onglet correspondant.

---

## États sur mesure (Studio)

En plus des rapports ci-dessus, le **Studio** permet de construire vos propres états sur les données
de la solution : ventes, achats, stock, trésorerie, comptabilité, paie.

### Avec l'assistant IA

Depuis **Studio** > **Assistant IA**, décrivez ce que vous voulez voir :

> « Crée un rapport avancé des ventes de produits pour ce trimestre »

L'assistant affiche directement le tableau, avec bascule en graphique et export CSV/Excel.
Si le résultat vous convient, **« Enregistrer comme état »** vous propose un aperçu — montrant un
échantillon de vos vraies données — que vous validez pour le conserver dans **Studio** > **Rapports**.

Quelques formulations qui fonctionnent bien :

- « Chiffre d'affaires par client du 1er janvier au 31 mars »
- « Ventes par mois de cette année »
- « Remises accordées par client »
- « Mouvements de stock par produit »
- « Encaissements par mode de règlement »

### Dans le concepteur

**Studio** > **Rapports** > **Nouveau** permet la même chose à la main : choisissez une source
(les tables sont regroupées par domaine — Ventes, Achats, Stock…), un regroupement, des calculs
(somme, moyenne, nombre, min, max), des filtres et un tri. L'aperçu se met à jour en direct.

### Bon à savoir

- Vous ne voyez que les données auxquelles vous avez droit : sans accès à la paie, les états de paie
  n'apparaissent pas dans la liste des sources.
- Un état ne modifie **jamais** vos données : il ne fait que les lire.
- Si un état affiche un bandeau orange « résultat tronqué », les totaux ne portent pas sur la
  totalité des données — affinez la période ou les filtres.

---

[Retour à l'index](README.md) | [Précédent : Paiements](07-paiements.md) | [Suivant : Paramètres](09-parametres.md)
