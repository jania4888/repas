-- Déclaration mensuelle — ÉTAT DE LA MONTÉE VERS LE CATALOGUE DE RUBRIQUES v2 (lecture seule)
--
-- Contexte
--   Le catalogue tn-2026-v2 reproduit le calcul historique par la configuration (origine
--   « documents », TFP par activité, FOPROLOS de la paie). La montée est faite à l'amorçage de chaque
--   dossier par MonthlyDeclarationCatalogUpgrade, derrière l'interrupteur
--   Accounting__MonthlyDeclarationCatalogV2UpgradeEnabled (éteint par défaut). Elle est TOUT OU RIEN
--   PAR FAMILLE : une famille dont une rubrique v1 a été retouchée, supprimée ou complétée par le
--   dossier est laissée en v1, et le motif est consigné dans l'audit.
--
--   CE SCRIPT N'ÉCRIT RIEN. À exécuter sur CHAQUE base tenant. Il sert à la porte A → B du retrait
--   du calcul historique : la v2 doit être montée sur tous les dossiers actifs, y compris ceux dont la
--   migration NCT 01 est différée, et les familles laissées doivent avoir été revues.
--
-- Lecture
--   Section 1 : version(s) de catalogue posée(s).
--   Section 2 : compte rendu de la montée (familles montées, laissées et pourquoi, inclusions).
--   Section 3 : inclusion des familles et régime du dossier — un dossier en calcul paramétré
--               (Mode = 2) n'a PAS vu ses inclusions modifiées : à revoir avec le comptable.
--   Section 4 : rubriques v1 encore non montées dans les familles que la v2 modifie.

SET NOCOUNT ON;

-- ── 1. Versions de catalogue posées ──────────────────────────────────────────────────────────
SELECT
    l.CatalogVersion,
    l.AppliedAt
FROM dbo.MonthlyDeclarationRubricSeedLogs AS l
ORDER BY l.AppliedAt;

SELECT
    CASE WHEN EXISTS (SELECT 1 FROM dbo.MonthlyDeclarationRubricSeedLogs WHERE CatalogVersion = N'tn-2026-v2')
         THEN N'v2 montée' ELSE N'v2 NON montée' END AS EtatMontee;

-- ── 2. Compte rendu de la montée (audit) ─────────────────────────────────────────────────────
--    NewValues porte UpgradedFamilies, SkippedFamilies (avec le motif), InclusionsChanged et
--    ConfiguredDossierNeedsReview.
SELECT
    a.CreatedAt,
    a.UserEmail,
    a.NewValues
FROM dbo.AuditLogs AS a
WHERE a.Action = N'Accounting.MonthlyDeclarationCatalogUpgraded'
ORDER BY a.CreatedAt;

-- ── 3. Inclusion des familles et régime du dossier ───────────────────────────────────────────
--    Familles : 0 retenue à la source, 1 TFP, 2 FOPROLOS, 3 droit de consommation, 4 TVA,
--    5 autres taxes CA (FODEC), 6 droit de timbre, 7 taxe hôtelière, 8 TCL, 9 droit de licence,
--    99 autres informations.
SELECT
    s.Mode AS Regime,             -- 0 historique, 1 contrôle de parité, 2 paramétré
    s.ConfiguredSince
FROM dbo.MonthlyDeclarationSettings AS s;

SELECT
    f.Family,
    f.IsIncluded
FROM dbo.MonthlyDeclarationFamilySettings AS f
ORDER BY f.Family;

-- ── 4. Rubriques encore en v1 dans les familles que la v2 modifie ────────────────────────────
--    Après montée d'une famille, aucune de ces lignes ne doit subsister pour elle. Une ligne restante
--    signale une famille laissée (motif en section 2) : à revoir avant le retrait de l'historique.
SELECT
    r.Family,
    r.Code,
    r.GrossKind,       -- 4 = documents
    r.WithheldKind,    -- 5 = documents, 4 = paie
    r.RatePercent,
    r.IsActive
FROM dbo.MonthlyDeclarationRubrics AS r
WHERE (r.Code IN (N'F1_4_2', N'F1_5', N'F1_6', N'F1_10', N'F1_12', N'F1_16', N'F1_17_1', N'F1_17_2',
                  N'F1_17_3', N'F1_18', N'F1_19', N'F1_24', N'F1_25', N'F6_1', N'F7_1')
       AND r.WithheldKind <> 5)
   OR (r.Code IN (N'F2_1', N'F2_2', N'F3_1') AND r.WithheldKind <> 4)
   OR (r.Code = N'F9_3_1' AND r.GrossKind <> 4)
ORDER BY r.Family, r.Code;
