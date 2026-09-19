# 04 - Achats

Ce chapitre couvre la gestion des achats : fournisseurs, bons de commande, bons de réception et factures fournisseurs.

---

## Fournisseurs

Les **fournisseurs** sont les entreprises ou personnes chez qui vous achetez des marchandises ou des services.

### Liste des fournisseurs

1. Dans le menu, cliquez sur **Achats** puis **Fournisseurs**.
2. La liste de tous vos fournisseurs s'affiche.

![Liste des fournisseurs](../screenshots/04-achats/fournisseurs-liste.png)

### Créer un fournisseur

1. Cliquez sur **Nouveau fournisseur**.
2. Renseignez les informations :
   - Nom (obligatoire)
   - NIF
   - Adresse
   - Téléphone, email
3. Cliquez sur **Enregistrer**.

### Voir une fiche fournisseur

Cliquez sur un fournisseur dans la liste. La fiche affiche ses informations, ses bons de commande et ses factures.

### Modifier un fournisseur

1. Ouvrez la fiche du fournisseur.
2. Cliquez sur **Modifier**.
3. Effectuez vos modifications puis enregistrez.

---

## Bons de commande

Un **bon de commande** (BC) est le document que vous envoyez à un fournisseur pour commander des marchandises.

### Liste des bons de commande

1. Dans le menu, cliquez sur **Achats** puis **Bons de commande**.
2. La liste de tous vos bons de commande s'affiche.

![Liste des bons de commande](../screenshots/04-achats/bc-liste.png)

### Créer un bon de commande

1. Cliquez sur **Nouveau bon de commande**.
2. Sélectionnez le fournisseur.
3. Ajoutez les articles commandés (produits, quantités, prix).
4. Enregistrez.

### États d'un bon de commande

| État | Signification |
|------|---------------|
| **Brouillon** | Le bon de commande n'est pas encore envoyé. Vous pouvez le modifier. |
| **Confirmé** | Le bon de commande a été envoyé au fournisseur. |
| **Réceptionné** | Les marchandises ont été reçues. |

### Réceptionner un bon de commande

Quand vous recevez les marchandises :

1. Ouvrez le bon de commande (état Confirmé ou Partiellement reçu).
2. Cliquez sur **Réception marchandise**.
3. Vous êtes redirigé vers un **bon de réception** prérempli avec les quantités restantes.
4. Vérifiez l'entrepôt, les quantités reçues, puis enregistrez ou validez.

---

## Bons de réception

Un **bon de réception** (BR) enregistre la réception physique des marchandises d'un fournisseur. Il peut être lié à un bon de commande pour imputer les quantités et mettre à jour le stock à la validation.

### Liste des bons de réception

1. Dans le menu, cliquez sur **Achats** puis **Bons de réception**.
2. La liste affiche les réceptions avec filtres (statut, fournisseur, période) et les totaux agrégés.

### Créer un bon de réception

1. Cliquez sur **Nouveau bon de réception**, ou partez d'un bon de commande via **Réception marchandise**.
2. Renseignez le fournisseur, l'entrepôt et la date de réception.
3. Sélectionnez éventuellement un bon de commande confirmé : les lignes et quantités en attente sont préremplies.
4. Ajustez les **quantités reçues**, les prix et remises si besoin.
5. Complétez les informations complémentaires (transporteur, n° BL, notes).
6. Utilisez :
   - **Enregistrer en brouillon** pour sauvegarder sans impact stock ;
   - **Enregistrer** pour sauvegarder et ouvrir le détail ;
   - **Valider la réception** pour confirmer (stock + imputation BC).

Les pièces jointes (PDF, JPG, PNG) peuvent être ajoutées après le premier enregistrement.

### États d'un bon de réception

| État | Signification |
|------|---------------|
| **Brouillon** | Modifiable, sans impact stock. |
| **Validé** | Stock mis à jour, quantités du BC imputées, document verrouillé. |
| **Partiellement facturé** | Au moins une facture fournisseur a été créée ; il reste des quantités reçues non facturées. |
| **Facturé** | Toutes les quantités reçues ont été facturées. |
| **Annulé** | Annulé ; si le BR était validé, stock et BC sont contrepassés. |

### Actions sur le détail

Selon le statut et vos droits : **PDF**, **Modifier**, **Valider**, **Annuler** (motif obligatoire) ou **Supprimer** (brouillon uniquement).

Astuces de saisie sur le formulaire :
- **Scanner un code-barres** pour ajouter rapidement un article — voir [14 - Codes-barres](14-codes-barres.md).
- **Importer depuis BL** pour reporter le numéro de bon de livraison fournisseur.

### Créer une facture fournisseur

La facturation des **marchandises gérées en stock** est **partielle et multiple** : vous pouvez créer plusieurs factures fournisseur tant qu'il reste des quantités **reçues et non encore facturées**. Pour ces articles, la réception (bon de réception validé) **reste obligatoire** avant facturation.

Les **charges et services hors stock** (loyers, STEG, honoraires, prestations, immobilisations non gérées en stock) peuvent être saisis **directement** depuis la liste des factures fournisseurs, sans bon de commande ni bon de réception. Une facture directe **ne met pas à jour le stock**.

#### Depuis un bon de réception (recommandé pour le stock)

1. Validez le bon de réception.
2. Sur la fiche du BR, cliquez sur **Créer facture fournisseur**.
3. Dans la fenêtre, ajustez les **quantités à facturer** par ligne si besoin.
4. Renseignez le numéro de facture fournisseur, la date et les conditions de paiement.
5. Cliquez sur **Créer la facture** — vous êtes redirigé vers la fiche de la facture créée.

#### Depuis un bon de commande

Une fois le bon de commande réceptionné (totalement ou partiellement) :

1. Ouvrez le bon de commande.
2. Cliquez sur **Créer facture fournisseur** (visible uniquement s'il reste des quantités reçues non facturées).
3. Sélectionnez les quantités à facturer dans la fenêtre.
4. Validez la création.

Les factures liées apparaissent sur les fiches BC et BR. L'annulation d'une facture fournisseur **libère** les quantités facturées pour une nouvelle imputation.

![Modal création facture fournisseur](../screenshots/04-achats/modal-facture-fournisseur.png)

---

## Factures fournisseurs

Les **factures fournisseurs** sont les factures que vos fournisseurs vous envoient pour les achats que vous avez effectués.

### Liste des factures fournisseurs

1. Dans le menu, cliquez sur **Achats** puis **Factures fournisseurs**.
2. La liste de toutes vos factures fournisseurs s'affiche.
3. Un bouton **Nouvelle facture** permet de saisir une facture directe (charges / services hors stock).
4. Les factures sans bon de commande ni bon de réception sont identifiées par le tag **Directe**.

Si la liste est vide, le message propose de créer une facture depuis un bon de commande, un bon de réception, ou directement.

### Créer une facture directe depuis la liste

Utilisez ce flux pour les factures **sans mouvement de stock** (loyers, énergie, honoraires, services, immobilisations hors stock).

1. Dans **Factures fournisseurs**, cliquez sur **Nouvelle facture**.
2. Sélectionnez le fournisseur, la date, le délai de paiement et, si besoin, le n° papier du fournisseur.
3. Ajoutez des lignes en choisissant des articles **non gérés en stock** (services ou charges). Les articles de stock sont refusés : passez alors par un bon de réception.
4. Cliquez sur **Créer la facture**. La facture est enregistrée immédiatement (pas de brouillon) et une écriture comptable d'achat est générée.
5. Joignez le **scan PDF** de la facture à l'écriture d'achat (journal JA), depuis la comptabilité. La fiche facture n'attache pas de pièce native.

Pour corriger une facture directe : **annulez-la** puis saisissez-en une nouvelle.

### Voir le détail d'une facture fournisseur

Cliquez sur une facture dans la liste. La fiche affiche toutes les informations, le fournisseur associé et, le cas échéant, le bon de commande ou le bon de réception lié. Une facture sans BC ni BR est indiquée comme **Facture directe**, avec un rappel pour joindre la pièce à l'écriture comptable.

---

[Retour à l'index](README.md) | [Précédent : Ventes](03-ventes.md) | [Suivant : Fiches](05-fiches.md)
