-- Déclaration mensuelle — ÉTAT DE LA POSE DU CATALOGUE DE RUBRIQUES (lecture seule)
--
-- Contexte
--   Le calcul de la déclaration mensuelle n'a plus qu'une source : la configuration du dossier. Le
--   catalogue tn-2026-v2 est celui qui reproduit, au millime, ce que l'ancien calcul câblé produisait
--   (origine « documents », T.F.P par activité, FOPROLOS de la paie). Il est posé une fois par
--   dossier, à son amorçage, par MonthlyDeclarationCatalogReset : la configuration antérieure est
--   REMPLACÉE, et sauvegardée dans l'audit au format du Modèle d'intégration.
--
--   CE SCRIPT N'ÉCRIT RIEN. À exécuter sur CHAQUE base tenant après un déploiement.
--
--   Rappel d'exploitation : la pose a lieu à la PREMIÈRE REQUÊTE de chaque dossier. Appliquer les
--   migrations en masse (POST /api/platform/migrations/tenants/apply-migrations) ne la déclenche pas.
--   Il faut ouvrir chaque dossier avant de conclure de ce script.
--
-- Lecture
--   Section 1 : la pose a-t-elle eu lieu ? Sans la ligne « tn-2026-v2-reset », le dossier calcule
--               encore sur son ancienne configuration et l'enregistrement d'une déclaration y est
--               REFUSÉ. Rouvrir le dossier ; si la ligne ne vient pas, lire les journaux de l'API.
--   Section 2 : le compte rendu de la pose, tel que l'audit l'a conservé.
--   Section 3 : ce que le dossier porte aujourd'hui — 46 rubriques attendues, 11 familles cochées.
--   Section 4 : les retouches faites APRÈS la pose. C'est le travail du comptable : il doit survivre
--               à tout déploiement ultérieur.

SET NOCOUNT ON;

-- ── 1. La pose a-t-elle eu lieu ? ────────────────────────────────────────────────────────────
SELECT
    Marqueur = l.CatalogVersion,
    PoseLe   = l.AppliedAt
FROM dbo.MonthlyDeclarationRubricSeedLogs AS l
ORDER BY l.AppliedAt;

SELECT CatalogueEnVigueurPose = CASE
    WHEN EXISTS (SELECT 1 FROM dbo.MonthlyDeclarationRubricSeedLogs WHERE CatalogVersion = 'tn-2026-v2-reset')
        THEN 'OUI'
    ELSE 'NON — le dossier refuse l''enregistrement d''une déclaration, rouvrir le dossier'
END;

-- ── 2. Compte rendu de la pose (audit) ───────────────────────────────────────────────────────
--   NewValues : nombre de rubriques posées, familles cochées, taux de TCL retenu.
--   OldValues : la configuration remplacée, au format du Modèle d'intégration. Elle est réimportable
--               — mais ses familles décochées remettraient les montants à zéro sous le calcul actuel :
--               c'est une trace, pas un chemin de retour.
SELECT TOP (5)
    a.CreatedAt,
    a.UserEmail,
    ConfigurationPosee    = a.NewValues,
    TailleSauvegardeChars = LEN(a.OldValues)
FROM dbo.AuditLogs AS a
WHERE a.Action = 'Accounting.MonthlyDeclarationCatalogReset'
ORDER BY a.CreatedAt DESC;

-- ── 3. Ce que le dossier porte aujourd'hui ───────────────────────────────────────────────────
SELECT
    RubriquesTotal   = COUNT(*),
    RubriquesActives = SUM(CASE WHEN r.IsActive = 1 THEN 1 ELSE 0 END)
FROM dbo.MonthlyDeclarationRubrics AS r;

--   Famille : 1 retenue à la source, 2 T.F.P, 3 FOPROLOS, 4 droit de consommation, 5 T.V.A,
--             6 autres taxes sur le chiffre d'affaires, 7 droit de timbre, 8 taxe hôtelière,
--             9 T.C.L, 10 droit de licence, 11 autres informations.
SELECT
    f.Family,
    f.IsIncluded,
    Rubriques = (SELECT COUNT(*) FROM dbo.MonthlyDeclarationRubrics AS r
                 WHERE r.Family = f.Family AND r.IsActive = 1)
FROM dbo.MonthlyDeclarationFamilySettings AS f
ORDER BY f.Family;

--   Une famille cochée sans aucune rubrique active fait REFUSER l'enregistrement de la déclaration,
--   plutôt que de déclarer un zéro silencieux. Hors T.V.A (5) et autres informations (11), qui ne
--   déplacent aucun montant.
SELECT
    FamilleCocheeSansRubrique = f.Family
FROM dbo.MonthlyDeclarationFamilySettings AS f
WHERE f.IsIncluded = 1
  AND f.Family NOT IN (5, 11)
  AND NOT EXISTS (SELECT 1 FROM dbo.MonthlyDeclarationRubrics AS r
                  WHERE r.Family = f.Family AND r.IsActive = 1)
ORDER BY f.Family;

-- ── 4. Retouches postérieures à la pose ──────────────────────────────────────────────────────
--   Le travail du comptable. Il ne doit jamais être écrasé par un déploiement : la pose n'a lieu
--   qu'une fois, le marqueur de la section 1 en est la garantie.
SELECT
    r.Code,
    r.Family,
    r.IsActive,
    r.UpdatedBy,
    r.UpdatedAt
FROM dbo.MonthlyDeclarationRubrics AS r
WHERE r.UpdatedBy IS NOT NULL
  AND r.UpdatedBy <> 'system'
ORDER BY r.UpdatedAt DESC;
