# Alignement Odoo Project + Timesheets

Spec de référence pour le module Projets / Feuilles de temps FactuTrust.

## Chaîne commerciale (Odoo-like)

```
Devis/Commande (SalesOrder)
  → Projet (Project) + compte analytique (AnalyticAccountCode)
  → Tâche (ProjectTask) + jalon (ProjectMilestone)
  → Feuille de temps (ProjectTimeEntry)
  → Livraison (SalesOrderLine.DeliveredQuantity)
  → Facture (Invoice via ProjectBilling)
```

## Politique de facturation service (Product)

| Odoo Invoicing Policy | Enum `ServiceInvoicingPolicy` |
|-----------------------|-------------------------------|
| Prepaid / Fixed Price | `PrepaidFixedPrice` |
| Based on Timesheets | `BasedOnTimesheets` |
| Based on Milestones | `BasedOnMilestones` |
| Delivered quantities | `BasedOnDeliveredQuantities` |
| BTP (extension) | `ProgressSituations` |

## Facturable — 2 niveaux

1. **Saisie** : `ProjectTimeEntry.IsBillable` — choix par ligne de temps (case à cocher)
2. **Ligne commande** : `ProjectTimeEntry.SalesOrderLineId` — requis pour une saisie facturable si le projet est lié à une commande (`SalesOrderId`)

## Rentabilité — 3 colonnes

API `GET /api/projects/{id}/profitability` :

- **Expected** : budget / commande
- **To invoice / To bill** : temps validé non facturé, jalons atteints
- **Invoiced / Billed** : factures confirmées, coûts comptabilisés

## Timesheets app

- `GET /api/timesheets/grid` — vue grille avec codes couleur
- `POST /api/timesheets/timer/start|stop` — chronomètre
- KPI objectif : `EmployeeBillingTimeTarget`
- Leaderboard : `GET /api/timesheets/leaderboard`
- Congés : `TimeOffRequest` → entrées auto sur projet interne

## Entités tenant

- `TenantTimesheetSettings` — configuration globale
- `EmployeeBillingTimeTarget` — objectif mensuel par employé
- `TimesheetTip` — conseils leaderboard
- `ProjectUpdate` — snapshots statut projet
- `TimeOffRequest` — demandes congés
