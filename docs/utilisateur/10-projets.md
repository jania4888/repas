# 10 - Projets (ESN / Services / BTP)

Le module **Projets** suit vos affaires, chantiers et missions : tâches, temps, budget opérationnel, puis facturation commerciale (régie, jalons, forfait ou situations de travaux).

Il est indépendant des **feuilles de temps cabinet** et des **honoraires**. Une facture projet est une **facture de vente** classique.

---

## Activer le module

1. Le module **Projets** doit figurer sur le plan (back-office) et être accordé à l'utilisateur.
2. L'API exige aussi `Features:Projects:Enabled`.
3. Le menu **Projets** apparaît si vous avez la permission `projects:read`.

---

## Tableau de bord PSA

Le menu **Projets → Tableau de bord** (`/projects/dashboard`) affiche :

- **KPI avec tendances** (semaine ou mois) : projets actifs, tâches en cours / terminées, retards, heures à facturer
- **Graphiques** : donut avec avancement moyen, répartition par statut, évolution des tâches (créées, terminées, en attente, en retard), jauge d'avancement global (objectif 90 %)
- **Projets récents** : recherche locale, pagination, accès rapide au détail
- **Recherche hero** : projets, tâches et documents du module Projets uniquement (pas les formulaires ni documents commerciaux de toute l'application)
- **Sidebar** : prochaines échéances et membres actifs (statut basé sur l'activité récente, pas la présence en ligne)
- **Bannière performance** : synthèse motivante selon les tendances de la période

Sur le **tableau de bord Projets**, **Ctrl+K** focalise la barre de recherche hero (projets / tâches / documents). Sur le reste de l'application, **Ctrl+K** ouvre la recherche globale du header. Les notifications restent dans l'en-tête.

La **liste des projets** reste accessible via **Projets → Liste des projets** ou le lien « Voir tout ».

---

## Cycle de vie (obligatoire)

1. **Créer** le projet → statut **Brouillon**.
2. **Activer** → statut **Actif**.
3. Saisir du **temps** (projets Actif uniquement).
4. **Soumettre** puis **Valider** les lignes.
5. Renseignez un **tarif de vente** (et un **coût horaire interne** pour le suivi des coûts) sur l'équipe (régie).
6. **Facturer** → facture de vente brouillon (`FAC`).

Un projet **Brouillon** ne peut ni recevoir de temps, ni être facturé. Un projet **Terminé** peut encore être facturé, mais plus recevoir de temps. **Pause**, **Clôture** et **Annulation** demandent une confirmation.

Le type (Général / ESN / BTP) est **fixé à la création** et ne peut plus être modifié.

---

## Créer un projet

1. Ouvrez **Projets** → **Nouveau projet** (liste ou tableau de bord).
2. Choisissez le client, le nom, le **type** (cartes Général / ESN / BTP) :
   - **Général** : suivi d'affaire simple (colonnes À faire / En cours / …)
   - **ESN / Services** : régie, tarif de vente, jalons (colonnes Backlog → Livré)
   - **BTP / Chantier** : situations, retenue, sous-traitants (colonnes Préparation → Clôturé)
3. Un **aperçu Kanban** montre les colonnes qui seront créées automatiquement.
4. Renseignez dates, chef de projet, budget. Pour le BTP : adresse chantier et n° de marché.
5. **Activer** le projet pour saisir du temps.

Le type détermine le mode de facturation par défaut (Régie pour ESN, Situations pour BTP). Les situations de travaux restent réservées au BTP.

La liste des projets affiche le **chef de projet**, l'**avancement** (%), l'**échéance** et les tâches ouvertes. Pagination serveur (20 par page) et filtres par statut et type.

---

## Fiche projet

La fiche projet comporte un **résumé latéral** (budget, heures, prochaines échéances, activité) et plusieurs onglets. Les onglets **Temps** et **Facturation** sont mis en avant pour les projets ESN ; **Budget** et **Facturation** pour le BTP.

Vous pouvez marquer un projet en **favori** (étoile) : le marquage est enregistré localement sur votre navigateur.

---

## Paramètres

L'onglet **Paramètres** regroupe les options opérationnelles du projet (inspiré d'Odoo Project) :

| Option | Effet |
|--------|-------|
| **Facturable** | Autorise la facturation du temps et des prestations. Si désactivé, l'onglet **Rentabilité** disparaît. |
| **Mode de facturation** | Régie, forfait, jalons ou situations (selon le type de projet). |
| **Feuilles de temps** | Active la saisie du temps. Si désactivé, l'onglet **Temps** disparaît. |
| **Jalons** | Active le suivi et la facturation par jalons (ESN, BTP ou mode Jalons). |
| **Heures allouées** | Budget horaire de référence pour le suivi. |

Le bouton **Modifier le projet** (en-tête) reste réservé aux informations d'identité : nom, description, dates, budget, chef de projet et champs chantier BTP. Les paramètres ci-dessus se modifient uniquement dans cet onglet.

La permission `projects:update` est requise pour enregistrer les changements.

---

## Tâches

L'onglet **Tâches** propose **Liste** (vue par défaut), **Tableau** (Kanban), **Calendrier** (échéances, semaine commençant le lundi) et **Gantt** (timeline simplifiée : date début projet → échéance). Votre dernier mode d'affichage est mémorisé dans le navigateur.

La **vue Liste** affiche une barre d'outils (filtres actifs, tri, actualisation), un **bandeau de répartition** (Total, Terminées, En cours, En attente, En retard — cliquable pour filtrer) et des **filtres** (recherche sur titre et phase, statut, responsable, priorité, échéance, réinitialisation). Le tableau pagine les tâches (10 par page par défaut) avec avatars, pastilles de statut et priorité, échéance relative (« Dans 5 jours »), barre d'avancement et temps saisi / estimé.

Le bouton **play** sur une ligne ouvre une saisie rapide de **temps** (projet **Actif** et permission requise) — ce n'est pas un chronomètre. Le menu **…** permet d'ouvrir la fiche ou de saisir du temps.

Glissez une carte Kanban pour changer de colonne : le **statut** de la tâche est aligné automatiquement sur la colonne. Ouvrez une tâche pour accéder aux onglets **Aperçu**, **Sous-tâches**, **Fichiers**, **Temps passé** et **Historique**, avec une **modale de changement de statut** (commentaire recommandé pour « En attente » ou « Terminé »). L'onglet **Temps passé** reste disponible pour consulter l'historique des saisies sur la tâche dès qu'il existe du temps enregistré, y compris si la saisie est désactivée sur le projet (consultation seule). La **suppression** est possible si aucun temps n'est saisi sur la tâche.

---

## Temps

Saisie depuis **Projets → Saisie des temps** ou l'onglet **Temps** du projet (date, heures, tâche, facturable).

Cycle : **Brouillon → Soumis → Validé**. Les lignes **Brouillon** peuvent être modifiées. Filtrez par période et statut. Les temps déjà facturés affichent un lien vers la facture.

Ces temps ne sont **pas** les feuilles de temps du cabinet.

---

## Budget

L'onglet **Budget** compare le budget HT au réalisé (coût temps, coûts manuels, sorties de stock). C'est un P&L **opérationnel** : il n'écrit pas d'axes analytiques au grand livre.

Sur un chantier BTP : sortie de stock (produit, quantité, entrepôt optionnel, notes) et **rattachement d'un bon de commande** au projet.

---

## Facturation ESN (régie / jalons / forfait)

Prérequis affichés dans l'onglet **Facturation** (liste complète des blocages) :

1. Projet **Actif** ou **Terminé**.
2. Pour la régie : temps **validés** non facturés + **tarif de vente** sur l'équipe.

**Par membre** : **Facturer les temps validés** crée une facture brouillon agrégée par **intervenant** (notes optionnelles).

**Par tâche** : choisissez **Forfaitaire** ou **À l'heure**, sélectionnez une ou plusieurs tâches, puis **Facturer les tâches sélectionnées** :
- **Forfaitaire** : saisissez le montant HT par tâche à la facturation ;
- **À l'heure** : montant = heures validées non facturées × tarif horaire de vente (tarif de vente ÷ 8).

Le **coût horaire interne** sert au suivi des coûts projet (validation des temps) ; le **tarif de vente** sert à la facturation régie.

Une tâche déjà facturée en forfait ou à l'heure (via Par tâche) n'est plus proposée. Les heures déjà facturées (y compris par membre) ne sont jamais reproposées ; seules les heures restantes validées et non facturées comptent pour **Par tâche → À l'heure**.

**Jalons** : saisissez nom, % d'avancement, montant HT et échéance ; facturez un jalon à la fois.

**Forfait** : si le mode de facturation est « Forfait », une seule facture forfait peut être émise (montant HT, par défaut le budget).

---

## Facturation BTP (situations)

1. Créez une **situation** : période, % cumulé, brut HT, retenue de garantie, **TVA** (0 / 7 / 13 / 19 %).
2. Une situation **brouillon** reste modifiable ; la **validation** est définitive (confirmation demandée).
3. Le % cumulé ne peut **jamais diminuer** par rapport à la dernière situation validée.
4. **Facturer** crée une facture brouillon sur le net HT (brut − retenue).

Les **sous-traitants** se rattachent au chantier (fournisseur, marché, montant, retenue %) et peuvent être modifiés. Les bons de commande peuvent être rattachés au projet depuis l'onglet Budget.

---

## Équipe

Renseignez **tarif de vente**, **coût horaire interne** et capacité hebdomadaire. La **charge** (planifié vs saisi) s'affiche pour les projets ESN ou en régie.

---

## Fichiers

Téléversez un document (**max 10 Mo**). Commentaires au niveau projet dans le même onglet.

---

## Permissions utiles

| Action | Permission |
|--------|------------|
| Voir les projets | `projects:read` |
| Équipe / tarifs | `projects:manage_team` |
| Tâches | `project_tasks:*` |
| Saisir / valider le temps | `project_time:create` / `project_time:validate` |
| Facturer | `project_billing:create` |
