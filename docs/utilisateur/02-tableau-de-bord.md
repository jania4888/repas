# 02 - Tableau de bord

Le tableau de bord est la première page que vous voyez après la connexion. Il vous donne une vue d'ensemble de votre activité.

Pour un **nouveau compte**, une carte **Premiers pas** apparaît au-dessus des indicateurs. Elle propose les actions essentielles (fiche entreprise, premier client, premier article, première facture). Vous pouvez la masquer. La visite guidée se relance depuis le menu profil.

---

## Vue d'ensemble

![Tableau de bord complet](../screenshots/02-tableau-de-bord/dashboard-complet.png)

Le tableau de bord est divisé en plusieurs zones. Chacune affiche des informations utiles au quotidien. La plupart des indicateurs sont **cliquables** : un clic ouvre la page de détail correspondante, avec les filtres adaptés.

---

## Indicateurs principaux (KPIs)

En haut de la page, cinq cartes affichent vos chiffres clés :

| Indicateur | Signification | Clic → destination |
|------------|---------------|-------------------|
| **Chiffre d'affaires HT** | Montant total hors taxes des ventes (factures moins avoirs, statuts Payée et Validée) | Rapports → Analyse du CA |
| **Ventes aujourd'hui** | Encaissements du jour | Liste des factures du jour |
| **CA HT du mois en cours** | Chiffre d'affaires hors taxes du 1er du mois à aujourd'hui (factures moins avoirs, statuts Payée et Validée) | Factures et avoirs du mois en cours |
| **Factures impayées** | Factures non payées et non annulées | Liste des factures impayées |
| **Produits en alerte** | Produits en rupture ou stock faible | Stock (section alertes) |

---

## Factures et avoirs

Un clic sur **CA HT du mois en cours** (ou sur une barre du graphique) ouvre la vue **Factures et avoirs**. Elle liste les factures (FAC) et les avoirs (AVO) sur la période choisie, avec leur montant hors taxes (HT) et toutes taxes comprises (TTC) — les montants des avoirs sont négatifs.

La case **Comptés dans le CA (Payée + Validée)**, cochée par défaut, limite la liste aux documents au statut Payée ou Validée : ce sont ceux qui composent le chiffre d'affaires affiché sur le tableau de bord. Décochez-la pour voir aussi les documents à d'autres statuts (Brouillon, Signée...), qui n'entrent pas dans le calcul du CA.

Le total **CA HT** affiché en haut de la liste correspond toujours exactement à la carte du tableau de bord pour la même période.

---

## Actions requises

Une section **Actions requises** apparaît lorsqu'une action prioritaire est nécessaire :

| Alerte | Clic → destination |
|--------|-------------------|
| Stock bas / rupture | Stock (section alertes) |
| Livraisons en attente | Bons de livraison (statut Confirmé) |
| Factures en retard | Liste des factures (statut En retard) |

Cliquez sur une alerte pour accéder directement à la page concernée avec le filtre approprié.

---

## Cartes latérales et graphique

| Zone | Clic → destination |
|------|-------------------|
| **Livraisons en attente** (carte à droite des actions rapides) | Bons de livraison en attente |
| **Devis en cours** | Liste des devis actifs |
| **Évolution du CA HT** (titre ou barre d'un mois) | Analyse du CA ou Factures et avoirs du mois sélectionné |

---

## Comptabilité et CRM

Si les modules sont activés :

| Indicateur | Clic → destination |
|------------|-------------------|
| TVA due (estim.) / Prochaine échéance TVA | Déclaration TVA |
| Créances +90 j. | Balance âgée |
| Factures non comptabilisées | Journal comptable |
| Mes relances CRM | Mes activités CRM |
| Opportunités ouvertes | Liste des opportunités |

---

## Actions rapides

Des boutons permettent d'accéder rapidement aux actions les plus courantes :

| Action | Description |
|--------|-------------|
| **Créer une facture** | Créer une facture client |
| **Nouveau devis** | Accéder aux devis |
| **Bon de livraison** | Créer un bon de livraison |
| **Bon de retour** | Créer un bon de retour (livré, non facturé) |
| **Mes clients** | Gérer votre liste de clients |
| **Paiements** | Voir et enregistrer les paiements |
| **Rapports** | Consulter les statistiques |

---

## Dernières factures

Un tableau affiche vos **dernières factures** : numéro, client, montant, statut. Cliquez sur une ligne pour ouvrir le détail de la facture.

---

## Top clients

La section **Top clients** affiche vos clients qui ont le plus acheté. Cliquez sur un client pour accéder à sa fiche.

---

## Devis récents

Les **devis récents** sont listés avec leur numéro, client et statut. Cliquez pour voir le détail ou le modifier.

---

## Activité récente

La **timeline d'activité** montre les dernières actions effectuées sur la plateforme (factures créées, paiements enregistrés, etc.). Cliquez sur un élément pour ouvrir le document concerné.

---

## Navigation latérale (menu)

À gauche de l'écran, le **menu** permet d'accéder à toutes les sections :

- **Tableau de bord** (page actuelle)
- **Ventes** : Devis, Bons de livraison, Factures, Rapports
- **Achats** : Fournisseurs, Bons de commande, Factures fournisseurs, Rapports
- **Fiches** : Clients, Produits, Rapports
- **Stock** : Gestion de stock, Inventaire, Rapports
- **Paiements** : Vue d'ensemble, Rapports
- **Paramètres**

Cliquez sur une section pour l'ouvrir. Certaines sections ont des sous-menus (par exemple Ventes > Factures).

---

[Retour à l'index](README.md) | [Précédent : Premiers pas](01-premiers-pas.md) | [Suivant : Ventes](03-ventes.md)
