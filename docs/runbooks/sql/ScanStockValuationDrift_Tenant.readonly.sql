-- Valorisation de stock CMUP / FIFO / LIFO — DIAGNOSTIC (lecture seule)
--
-- Contexte
--   Le stock a DEUX représentations de sa valeur :
--     1. StockItems.AverageCost — un scalaire decimal(18,4). Autoritaire UNIQUEMENT en CMUP.
--     2. StockValuationLayers   — les couches. Autoritaires en FIFO/LIFO.
--   Toutes les lectures de l'application lisent aujourd'hui le scalaire, sans jamais regarder la
--   méthode de l'article. Pour un article FIFO/LIFO, ce scalaire n'est qu'un CACHE d'affichage,
--   rafraîchi seulement quand une mutation passe par le chemin « tracé », puis ARRONDI À 4
--   DÉCIMALES en base. Il peut donc diverger des couches, et cette divergence se propage : sept
--   chemins d'écriture lisent ce cache pour valoriser un nouveau mouvement.
--
--   CE SCRIPT N'ÉCRIT RIEN. Il chiffre la dérive AVANT toute correction de code, et fournit le
--   chiffre à soumettre à l'expert-comptable.
--
-- Ordre d'utilisation
--   À exécuter sur CHAQUE base tenant, avant le lot B. Conserver la sortie : la section 6 est la
--   photo « avant », à comparer après la réparation
--   (RepairStockItemAverageCostFromLayers_Tenant.idempotent.sql).
--
-- Lecture des résultats
--   Section 1 : articles FIFO/LIFO SANS couche mais avec du stock. L'écran affiche pour eux la
--               valeur du cache (repli assumé). Ils ne sont PAS réparables automatiquement :
--               créer une couche d'ouverture est une décision métier (bouton de la fiche article).
--   Section 2 : quantité des couches ≠ quantité en stock. L'anomalie la plus grave : la prochaine
--               sortie peut échouer sur « Couches de valorisation insuffisantes ».
--   Section 3 : valeur des couches ≠ valeur du cache. C'est l'écart que l'écran affiche à tort.
--   Section 4 : le P.U. affiché (cache) vs le coût de la prochaine sortie (nouvelle règle).
--   Section 5 : articles non valorisés (quantité > 0, coût 0) — stock entré par inventaire.
--   Section 6 : totaux par entrepôt, « cache » vs « couches ». Le chiffre pour le comptable.
--   Section 7 : récapitulatif d'une ligne, pour le journal de bord.
--
-- Pièges
--   sqlcmd doit tourner avec QUOTED_IDENTIFIER ON (sinon Msg 1934) :
--     sqlcmd -S <serveur> -d <base> -I -i ScanStockValuationDrift_Tenant.readonly.sql
--   L'option -I active QUOTED_IDENTIFIER. Ne pas l'oublier.

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

-- Tolérances : alignées sur ValuationLayerInvariant.Tolerance (quantités) et sur la précision des
-- montants (une quantité à 4 décimales × un coût à 4 décimales ne se compare pas à 0.0001).
DECLARE @TolQte    decimal(18,6) = 0.0001;
DECLARE @TolValeur decimal(18,6) = 0.001;

-- Jeu de travail : un article de stock, sa méthode, et l'agrégat de ses couches ouvertes.
-- CostingMethod : 0 = Average (CMUP), 1 = Fifo, 2 = Lifo.
IF OBJECT_ID('tempdb..#Valorisation') IS NOT NULL DROP TABLE #Valorisation;

SELECT
    StockItemId       = s.Id,
    s.ProductId,
    s.WarehouseId,
    ProduitCode       = p.Code,
    ProduitNom        = p.Name,
    EntrepotCode      = w.Code,
    EntrepotNom       = w.Name,
    p.CostingMethod,
    Methode           = CASE p.CostingMethod
                            WHEN 0 THEN 'CMUP' WHEN 1 THEN 'FIFO' WHEN 2 THEN 'LIFO'
                            ELSE 'INCONNUE(' + CONVERT(nvarchar(12), p.CostingMethod) + ')' END,
    s.QuantityOnHand,
    CacheCoutUnitaire = s.AverageCost,
    CacheValeur       = s.QuantityOnHand * s.AverageCost,
    NbCouches         = ISNULL(l.NbCouches, 0),
    CouchesQuantite   = ISNULL(l.Quantite, 0),
    CouchesValeur     = ISNULL(l.Valeur, 0),
    -- Coût de la prochaine sortie, DANS L'ORDRE EXACT de ConsumeCostAndExit :
    -- FIFO = ReceivedAt croissant puis Id ; LIFO = ReceivedAt décroissant puis Id décroissant.
    -- Le départage par Id est indispensable : deux réceptions dans la même milliseconde sont
    -- fréquentes (import, transfert, restauration d'avoir), et MIN(ReceivedAt) les confondrait.
    CoutProchaineSortie = CASE
        WHEN p.CostingMethod = 2 THEN (SELECT TOP 1 x.UnitCost FROM StockValuationLayers x
                                       WHERE x.StockItemId = s.Id AND x.RemainingQuantity > 0
                                       ORDER BY x.ReceivedAt DESC, x.Id DESC)
        WHEN p.CostingMethod = 1 THEN (SELECT TOP 1 x.UnitCost FROM StockValuationLayers x
                                       WHERE x.StockItemId = s.Id AND x.RemainingQuantity > 0
                                       ORDER BY x.ReceivedAt ASC, x.Id ASC)
        ELSE NULL END,
    p.LastPurchasePrice,
    p.PurchasePrice
INTO #Valorisation
FROM StockItems s
INNER JOIN Products   p ON p.Id = s.ProductId
INNER JOIN Warehouses w ON w.Id = s.WarehouseId
OUTER APPLY (
    SELECT NbCouches = COUNT(1),
           Quantite  = SUM(v.RemainingQuantity),
           Valeur    = SUM(v.RemainingQuantity * v.UnitCost)
    FROM StockValuationLayers v
    WHERE v.StockItemId = s.Id AND v.RemainingQuantity > 0
) l
WHERE s.IsActive = 1 AND p.IsActive = 1 AND p.IsStockManaged = 1 AND w.IsActive = 1;

-- ── 1. Articles FIFO/LIFO SANS aucune couche, mais avec du stock ──────────────────────────────
--    Cause habituelle : méthode passée à FIFO/LIFO sans créer la couche d'ouverture, ou stock
--    entré alors que Features:Stock:FifoLifoValuationEnabled était à false (le moteur bascule
--    alors en CMUP et NE CRÉE PAS de couche).
--    Non réparable par script : passer par le bouton « Créer la couche d'ouverture » de la fiche.
SELECT Anomalie = '1. FIFO/LIFO sans couche',
       ProduitCode, ProduitNom, Methode, EntrepotNom,
       QuantityOnHand, CacheCoutUnitaire, CacheValeur
FROM #Valorisation
WHERE CostingMethod IN (1, 2) AND NbCouches = 0 AND QuantityOnHand > 0
ORDER BY CacheValeur DESC, ProduitCode;

-- ── 2. Dérive de QUANTITÉ : couches ≠ stock physique ──────────────────────────────────────────
--    Bloquant à terme : ValuationLayerInvariant rejette toute mutation tracée sur ces articles.
--    Cause la plus probable : des mouvements appliqués drapeau FIFO/LIFO à false.
SELECT Anomalie = '2. Derive quantite',
       ProduitCode, ProduitNom, Methode, EntrepotNom,
       QuantityOnHand, CouchesQuantite,
       EcartQuantite = CouchesQuantite - QuantityOnHand,
       NbCouches
FROM #Valorisation
WHERE CostingMethod IN (1, 2) AND NbCouches > 0
  AND ABS(CouchesQuantite - QuantityOnHand) > @TolQte
ORDER BY ABS(CouchesQuantite - QuantityOnHand) DESC;

-- ── 3. Dérive de VALEUR : couches ≠ cache ─────────────────────────────────────────────────────
--    C'est l'écart que l'écran affiche à tort aujourd'hui. Réparable par le runbook idempotent.
SELECT Anomalie = '3. Derive valeur',
       ProduitCode, ProduitNom, Methode, EntrepotNom,
       QuantityOnHand, CacheValeur, CouchesValeur,
       EcartValeur = CouchesValeur - CacheValeur,
       CacheCoutUnitaire,
       CoutUnitaireCible = CASE WHEN QuantityOnHand > 0 THEN CouchesValeur / QuantityOnHand ELSE 0 END
FROM #Valorisation
WHERE CostingMethod IN (1, 2) AND NbCouches > 0
  AND ABS(CouchesValeur - CacheValeur) > @TolValeur
ORDER BY ABS(CouchesValeur - CacheValeur) DESC;

-- ── 4. Ce que le P.U. affiché va devenir ──────────────────────────────────────────────────────
--    Nouvelle règle : pour un article FIFO/LIFO, le P.U. affiché devient le coût de la PROCHAINE
--    SORTIE, et non plus la moyenne des couches. La VALEUR reste la somme des couches.
--    Conséquence assumée : P.U. × Qté ≠ Valeur sur ces lignes.
SELECT Impact = '4. Changement du P.U. affiche',
       ProduitCode, ProduitNom, Methode, EntrepotNom, QuantityOnHand,
       PuAvant         = CacheCoutUnitaire,
       PuApres         = CoutProchaineSortie,
       Ecart           = CoutProchaineSortie - CacheCoutUnitaire,
       ValeurInchangee = CouchesValeur,
       NbCouches
FROM #Valorisation
WHERE CostingMethod IN (1, 2) AND NbCouches > 0
  AND (CoutProchaineSortie IS NULL OR ABS(CoutProchaineSortie - CacheCoutUnitaire) > @TolValeur)
ORDER BY ABS(ISNULL(CoutProchaineSortie, 0) - CacheCoutUnitaire) DESC;

-- ── 5. Articles NON VALORISÉS : quantité > 0 mais coût nul ────────────────────────────────────
--    Cause : AdjustStock n'injecte jamais de coût. Un stock entré uniquement par inventaire ou
--    comptage rapide reste à 0. Les colonnes de repli indiquent ce que la valorisation
--    automatique (drapeau InventoryAutoValuationEnabled, OFF par défaut) retiendrait.
SELECT Anomalie = '5. Article non valorise',
       ProduitCode, ProduitNom, Methode, EntrepotNom,
       QuantityOnHand, CacheCoutUnitaire, NbCouches,
       ReplDernierPrixAchat = LastPurchasePrice,
       ReplPrixAchatFiche   = PurchasePrice,
       ValeurSiAutoValorise = QuantityOnHand * ISNULL(NULLIF(LastPurchasePrice, 0), ISNULL(PurchasePrice, 0))
FROM #Valorisation
WHERE QuantityOnHand > 0
  AND ISNULL(CacheCoutUnitaire, 0) = 0
  AND ISNULL(CouchesValeur, 0) = 0
ORDER BY QuantityOnHand DESC, ProduitCode;

-- ── 6. Totaux par entrepôt : « cache » vs « couches » ─────────────────────────────────────────
--    LE chiffre à montrer au comptable. ValeurVraie applique la règle cible : couches pour les
--    articles FIFO/LIFO qui en ont, cache sinon (CMUP, ou FIFO/LIFO sans couche).
SELECT Synthese = '6. Totaux par entrepot',
       EntrepotCode, EntrepotNom,
       NbLignes       = COUNT(1),
       QuantiteTotale = SUM(QuantityOnHand),
       ValeurCache    = SUM(CacheValeur),
       ValeurVraie    = SUM(CASE WHEN CostingMethod IN (1, 2) AND NbCouches > 0
                                 THEN CouchesValeur ELSE CacheValeur END),
       Ecart          = SUM(CASE WHEN CostingMethod IN (1, 2) AND NbCouches > 0
                                 THEN CouchesValeur ELSE CacheValeur END) - SUM(CacheValeur),
       NbFifoLifo     = SUM(CASE WHEN CostingMethod IN (1, 2) THEN 1 ELSE 0 END),
       NbSansCouche   = SUM(CASE WHEN CostingMethod IN (1, 2) AND NbCouches = 0 AND QuantityOnHand > 0
                                 THEN 1 ELSE 0 END),
       NbNonValorise  = SUM(CASE WHEN QuantityOnHand > 0 AND ISNULL(CacheCoutUnitaire, 0) = 0
                                 AND ISNULL(CouchesValeur, 0) = 0 THEN 1 ELSE 0 END)
FROM #Valorisation
GROUP BY EntrepotCode, EntrepotNom
ORDER BY EntrepotNom;

-- ── 7. Récapitulatif d'une ligne, pour le journal de bord ─────────────────────────────────────
SELECT Synthese = '7. Total base',
       NbArticlesStock = COUNT(1),
       NbFifoLifo      = SUM(CASE WHEN CostingMethod IN (1, 2) THEN 1 ELSE 0 END),
       NbSansCouche    = SUM(CASE WHEN CostingMethod IN (1, 2) AND NbCouches = 0 AND QuantityOnHand > 0
                                  THEN 1 ELSE 0 END),
       NbDeriveQte     = SUM(CASE WHEN CostingMethod IN (1, 2) AND NbCouches > 0
                                  AND ABS(CouchesQuantite - QuantityOnHand) > @TolQte THEN 1 ELSE 0 END),
       NbDeriveValeur  = SUM(CASE WHEN CostingMethod IN (1, 2) AND NbCouches > 0
                                  AND ABS(CouchesValeur - CacheValeur) > @TolValeur THEN 1 ELSE 0 END),
       NbNonValorise   = SUM(CASE WHEN QuantityOnHand > 0 AND ISNULL(CacheCoutUnitaire, 0) = 0
                                  AND ISNULL(CouchesValeur, 0) = 0 THEN 1 ELSE 0 END),
       ValeurCache     = SUM(CacheValeur),
       ValeurVraie     = SUM(CASE WHEN CostingMethod IN (1, 2) AND NbCouches > 0
                                  THEN CouchesValeur ELSE CacheValeur END)
FROM #Valorisation;

DROP TABLE #Valorisation;
