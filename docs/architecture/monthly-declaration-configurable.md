# Déclaration mensuelle paramétrable

Rendre configurable, par dossier, le calcul de chaque rubrique de la déclaration mensuelle des
impôts — origine du montant brut, origine de la retenue, comptes et sens par colonne, taux, fenêtre
d'application — puis produire la déclaration préremplie et le formulaire officiel DGI à partir de ce
paramétrage.

Ce document consigne les décisions qui ne se lisent pas dans le code.

## Pourquoi

La déclaration était câblée en dur : `VatDeclaration` porte quinze scalaires, et
`GetVatDeclarationQuery` les dérive de sources figées (rapports TVA ventes/achats, TVA caisse,
sommes FODEC et timbre sur factures, `TclRatePercent × CA TTC`, cycle de paie, rapport RS, préfixe
de compte `613`). Un dossier dont le plan comptable ou le régime diffère ne pouvait corriger une
ligne sans modification de code. Quatre familles du formulaire — droit de consommation, taxe
hôtelière, droit de licence, autres informations — n'existaient pas du tout dans le domaine : le
gabarit PDF a leurs cases, aucun code ne les alimentait.

## Le remplacement se fait par rampe, pas par bascule

Le moteur paramétré **remplace** le calcul historique ; c'est l'état visé. Mais la bascule sèche
transformerait toute rubrique oubliée en zéro silencieux — et un zéro silencieux sur une déclaration
part à la recette des finances.

`MonthlyDeclarationSettings.Mode`, par dossier :

| Mode | Effet |
|---|---|
| `Legacy` (défaut) | Calcul historique. Le composeur sort sur un test booléen : **zéro requête**. |
| `Parity` | Les deux calculs tournent. Les montants **déclarés** restent ceux du calcul historique ; l'écart est publié en millimes. Aucune écriture ne change. |
| `Configured` | Le moteur paramétré est la source unique. Une famille incluse sans rubrique applicable produit `MissingRubricForFamily` au lieu d'un zéro. |

Le passage `Parity` vers `Configured` exige trois périodes **consécutives** sans écart, ou une
dérogation nominative et motivée, conservée dans l'entité et dans l'audit. `ConfiguredSince` fige la
frontière : une période antérieure reste calculée comme avant, de sorte qu'une déclaration ancienne
rouverte se recalcule à l'identique.

La série ne s'allonge que sur des périodes contiguës et ne se rallonge pas en rejouant le même mois —
sans quoi relancer trois fois le contrôle de janvier suffirait à ouvrir la bascule.

**Limite connue : l'écart ne mesure que ce qui est inclus.** Un contrôle dont les familles incluses
ne déplacent aucun scalaire (famille sans rubrique active, T.V.A seule, hors moteur) rend un écart
nul par construction et allonge la série sans rien prouver. Consigne d'exploitation, en attendant un
lot dédié : inclure **toutes** les familles visées **avant** les contrôles de parité, et repasser en
parité si une famille est incluse après la bascule.

## Ce qui reste hors du périmètre, et pourquoi

**La T.V.A.** Ses montants ne viennent pas du journal mais des documents de facture ; l'enregistrement
les redérive systématiquement du recalcul en direct, quel que soit le corps de la requête ; et
`VatDue` / `CreditToCarry` sont le produit d'une arithmétique de solde chaînée d'un mois sur l'autre,
pas d'une ligne paramétrable. Les rubriques de famille TVA existent, s'affichent et se calculent —
mais ne déplacent aucun scalaire de TVA. Un lot dédié traitera le chaînage du crédit.

**« Retenu/taux » sur l'axe retenue.** Définir la retenue à partir d'elle-même n'a pas de lecture
fiscale univoque. La valeur existe dans l'énumération et dans la liste déroulante ; l'évaluateur rend
0 et signale `UnsupportedCombination`, la ligne restant saisissable. Même posture, et pour la même
raison, que la ventilation de la retenue à la source : mieux vaut une déclaration moins détaillée
qu'une déclaration fausse. À activer après validation par un fiscaliste.

## Décisions de conception

**Une rubrique ne référence jamais une autre rubrique.** C'est la décision centrale : elle supprime
le graphe de dépendances, donc la récursion, l'ordre d'évaluation inter-lignes et la détection de
cycle à l'exécution. Les seules dépendances possibles sont internes à la rubrique, entre ses deux
colonnes ; le seul cycle qu'elles peuvent former — brut déduit de la retenue **et** retenue déduite du
brut — est refusé à l'écriture par une erreur nommée.

**Les comptes sélectionnés vivent dans une table fille, pas dans une chaîne `61;62`.** Deux raisons.
`Nct01ChartMigrationService` réécrit les colonnes portant un numéro de compte par une boucle
générique ; une colonne agrégeant plusieurs numéros en sort et exige un découpeur dédié — c'est ce
qu'a coûté `BudgetPosts.AccountPrefixes`. Et le moteur interroge l'union des comptes de toutes les
rubriques en une requête : sur une colonne agrégée, cette union redevient un découpage de chaîne sur
le chemin du SQL. `("MonthlyDeclarationRubricAccounts", "AccountNumber")` est inscrit dans la boucle
de réécriture **et** dans l'allow-list.

**Le recouvrement est refusé à l'intérieur d'une colonne.** « 70 » en racine et « 707 » en compte
exact sur la même colonne additionneraient 707 deux fois, sans que le montant produit n'ait l'air
faux. Entre deux rubriques, le recouvrement reste permis : une déclaration n'est pas une partition du
plan comptable — la RS loyers et l'assiette TCL peuvent légitimement lire le même compte.

**`null` ne vaut pas zéro sur une constante.** Une rubrique « Fixe » sans montant enregistré attend
une saisie ; c'est le sens porté par l'absence de valeur, et l'évaluation le remonte
(`RequiresManualInput`) plutôt que de le confondre avec un montant nul.

**Le moteur n'écrête pas.** Les montants rendus sont signés. L'écrêtage appartient à l'enregistrement
(`SetAdditionalTaxes`) et à l'édition du formulaire (« un montant nul ne produit aucune valeur ») ;
l'appliquer dans le moteur casserait ce que les mouvements signés ont été introduits pour réparer —
une période d'extourne.

**Une seule requête journal par calcul.** Le composeur réunit l'union des comptes de toutes les
rubriques actives avant d'appeler `SumMovementsByAccountsAsync`. Les plafonds — 300 rubriques par
dossier, 20 comptes par (rubrique, rôle) — existent pour que le nombre de paramètres de cette requête
soit borné et non seulement espéré.

**Le prédicat de racine est composé, pas écrit en LINQ.** `prefixes.Any(p => col.StartsWith(p))`
n'est traduisible ni par le fournisseur en mémoire ni de façon fiable en SQL. La chaîne
`StartsWith(p1) || … || StartsWith(pN)` est construite par expression, chaque racine étant capturée
dans un objet dont on lit une propriété — ce qui la transmet en **paramètre** (`LIKE @p + '%'`) et non
en littéral. Rien n'est concaténé dans le texte de la requête.

**L'arrondi au millime intervient une seule fois, en sortie de colonne.** Arrondir les intermédiaires
ferait dériver « brut × taux » d'un millime sur les grandes assiettes. Les sites historiques
(`Tcl`, retenue sur loyers) utilisent un arrondi bancaire et **ne sont pas rétro-corrigés** : les
toucher déplacerait des montants déjà déposés. Les deux ne coexistent jamais dans une même
déclaration, le régime étant global au dossier.

**Le code rapport n'est pas une clé de case.** La carte géométrique du formulaire appartient au
millésime, pas au dossier : un nouveau millésime se traite en remplaçant le **triplet** (gabarit,
carte géométrique, carte des codes rapport) sans modification C#. Stocker des clés de case dans N
bases tenant inverserait cette propriété — une renumérotation de la DGI deviendrait une migration de
données dans chaque dossier. La rubrique porte le code que le comptable lit sur le formulaire
(« 1 », « 4.1 », « 17.2 ») ; `MonthlyDeclarationReportCodeMap` le traduit en cases, et
`MonthlyDeclarationFormBinder.FormVersion` est la source unique du millésime, partagée par le
tamponnage et la traduction.

Trois propriétés du pont méritent d'être notées :

- **Les suffixes de cases ne sont pas uniformes** — `.Base/.Amount` pour la retenue à la source, la
  TFP, le FOPROLOS et le FODEC, `.Base/.Due` pour la TVA collectée, `.Base/.Deductible` pour les
  achats. La carte porte donc des clés complètes, pas un préfixe et une convention.
- **Cinq familles n'ont aucune case de détail dans le millésime 2026** (droit de consommation, droit
  de timbre, taxe hôtelière, TCL, droit de licence). Leur entrée utilise le code rapport `*` : le
  montant ne rejoint que la ligne du récapitulatif. C'est exact, et préférable au silence.
- **Un contrôle croisé au chargement** refuse une carte dont une clé n'existe pas dans la géométrie,
  et un test l'exerce : une coquille casse la suite de tests, pas le tamponnage d'une déclaration.

**Les deux ventilations de la retenue à la source sont exclusives.** Dès que la configuration produit
des cases `Withholding.*`, l'export saute la chaîne interne (factures → salaires → loyers). Les faire
cohabiter compterait deux fois les mêmes montants sur les mêmes cases ; un seul `if` garantit qu'elles
ne se rencontrent jamais.

## Sécurité

Lecture sous `accounting:read` ; écritures de configuration et calcul sous **`accounting:declare`**,
clé déjà déclarée de bout en bout mais jusqu'ici câblée à aucun endpoint. `POST vat-declaration`
**reste** sous `accounting:create` : tout rôle portant Declare porte Create, mais les octrois de
module par utilisateur peuvent retirer Declare — resserrer révoquerait l'accès d'utilisateurs
existants.

Toute commande vérifie `IsAccountingFirmDelegatedContext`, comme l'enregistrement de la déclaration :
une société ne modifie pas la configuration fiscale de son propre dossier. Les *requêtes* se
contentent de `accounting:read` — la société peut regarder.

La lecture reste ouverte drapeau éteint et se contente de le signaler
(`Settings.ConfigurableLinesEnabled`) : un écran qui explique l'inactivité vaut mieux qu'un écran en
erreur, et la configuration amorcée n'est que de la donnée de référence inerte.

**Le drapeau est global à la plateforme, pas propre au dossier.** Le refus serveur et les bandeaux le
disent — l'ancien libellé « n'est pas activée pour ce dossier » a fait chercher un réglage de dossier
qui n'existe pas. Drapeau éteint, les écrans ne proposent plus d'action vouée au refus : Calcul DM
grise le calcul et le panneau de régime, Configuration DM passe ses écritures en lecture seule,
Modèle Intégration DM ferme l'import (l'export reste ouvert). Réglages non chargés sur Calcul et
Configuration = indisponible ; sur Modèle, seul un « éteint » explicite ferme l'import, une panne de
lecture laissant le serveur juge. Ce ne sont que des reflets : le serveur revérifie à chaque écriture.

## Activation

Depuis le **2026-09-24**, `MonthlyDeclarationConfigurableLinesEnabled` vaut `true` dans
`appsettings.json`, à côté de `MonthlyDeclarationV2Enabled` — une seule source, héritée par les
fichiers d'environnement. Le défaut du code reste `false`, filet si la clé disparaissait.
`MonthlyDeclarationFlagsConfigurationTests` fait échouer la suite si l'une des deux clés manque dans
la base ou si un fichier d'environnement la rabat à `false`.

**Retour arrière** sans reconstruire l'image : `Accounting__MonthlyDeclarationConfigurableLinesEnabled=false`
dans `deploy/.env` (la variable prime sur les fichiers), puis recréation du conteneur `api`. Les
réglages et rubriques saisis entre-temps restent en base, inertes, et reprennent effet à la
réactivation.

## Garantie de non-régression

**Drapeau allumé**, un dossier qui n'a jamais quitté le calcul historique — aucune ligne
`MonthlyDeclarationSettings`, état de tous les dossiers à l'activation puisque seul
`SetMonthlyDeclarationModeCommand` en crée une — ne paie qu'**une** lecture de ses réglages : le
composeur rend alors `Inactive`, et `Legacy` comme `Parity` rendent le jeu historique tel quel. La
preuve est prise de bout en bout : `GetVatDeclarationV2Tests` compare, champ par champ, la
déclaration d'une période pleine drapeau éteint puis allumé, dans les deux valorisations, avec et
sans dépôt ; `MonthlyDeclarationRollUpTests` vérifie, dépôts en `MockBehavior.Strict`, qu'aucune
autre lecture n'a lieu.

**Drapeau éteint**, en conjonction obligatoire avec `MonthlyDeclarationV2Enabled` : les scalaires
alimentés par le moteur ne sont calculés ni persistés hors V2.

Les trois familles ajoutées à `TotalToPay` (droit de consommation, taxe hôtelière, droit de licence)
valent `0` par défaut sur l'entité comme sur le jeu de montants : l'expression est **prouvablement
identique en valeur** pour tout dossier resté en calcul historique. L'échéancier consomme
`TotalToPay` et ne bouge donc que sur activation explicite ; le tableau de bord ne lit que `VatDue`
et la liasse fiscale ne lit pas la déclaration — tous deux intacts.

Les suites `GetVatDeclarationV2Tests`, `GetVatDeclarationCashVatTests` et
`GetVatDeclarationCompanyAccessTests` passent avec leurs assertions **inchangées** : seule la liste
d'arguments du constructeur a évolué. `MonthlyDeclarationRollUpTests` ajoute la preuve directe —
sans famille active la remontée rend le jeu historique tel quel, et le composeur monté sur des dépôts
`MockBehavior.Strict` n'émet aucun appel.

## Amorçage et duplication

Le catalogue en vigueur vit dans une ressource JSON embarquée
(`Resources/Accounting/monthly-declaration-rubrics-tn-v2.json`, 46 rubriques couvrant les onze
familles), régénérable par `tools/monthly-declaration-catalog/build_catalog.py`. Ni `InsertData` ni
catalogue C# : une migration est le mauvais outil pour des données de référence qui évoluent avec la
loi de finances, et 46 entrées × 4 énumérations se relisent en tableau, pas en littéral C#.

`MonthlyDeclarationCatalogReset` est appelé depuis `TenantRuntimeCatalogBootstrapper` — un point
d'appel unique qui couvre à la fois la création d'un dossier et le rattrapage des dossiers existants
à leur première requête après déploiement. Il **pose le catalogue une fois pour toutes** et coche les
onze familles.

**Pourquoi remplacer, et non compléter.** Le catalogue v1 amorcé jusqu'au retrait du calcul
historique ne reproduisait pas ce calcul — retenues sur honoraires et sur achats à zéro, T.F.P
comptée deux fois, FODEC et timbre lus sur des comptes au lieu des factures — et ses onze familles
étaient toutes décochées. Le laisser en place, alors que la configuration est devenue la seule source
des montants, reviendrait à déclarer des zéros. La configuration antérieure est donc remplacée, et
**sauvegardée dans l'entrée d'audit** au format du Modèle d'intégration : relisible, réimportable,
mais ce n'est pas un chemin de retour — ses familles décochées remettraient tout à zéro.

**La pose n'a lieu qu'une fois**, et le journal `MonthlyDeclarationRubricSeedLogs` en porte le
marqueur (`tn-2026-v2-reset`). C'est ce qui garantit qu'un déploiement n'écrase jamais le travail du
comptable. Tant que ce marqueur manque — pose en échec —, les écritures de configuration et
l'enregistrement d'une déclaration sont **refusés** plutôt que faussés, et l'amorçage du dossier est
remis en cache pour trente secondes au lieu d'une heure, pour que le nouvel essai soit rapide.

L'amorçage tourne **même drapeau éteint** : ce ne sont que des données inertes, et un dossier qui
activerait le drapeau pour découvrir un écran vide en conclurait que la fonctionnalité est cassée.

La duplication (`MonthlyDeclarationConfigDuplicator`) traverse deux bases tenant. Le dossier source
reçu n'est **jamais pris au mot** : il est confronté au portefeuille actif du cabinet appelant, puis
au périmètre du collaborateur. Le message de refus est identique à celui d'un dossier inexistant —
les distinguer révélerait l'existence de dossiers d'autres cabinets. La lecture se fait sur un
contexte isolé en lecture seule, l'écriture en une seule opération côté destination, avec de
**nouveaux identifiants** : recopier ceux de la source rendrait les deux dossiers indiscernables dans
un export d'audit. Pas de transaction distribuée : l'écriture unique et la politique « insérer ou
remplacer, jamais supprimer en masse » rendent l'opération rejouable, ce qui en tient lieu.

## L'écran Configuration DM

`/accounting/dm/configuration` — onze onglets, un par famille, chacun portant la case « Inclure
cette famille dans la déclaration mensuelle », la table des rubriques et la fiche d'édition.
Conteneur à signaux, sous-composants muets, **toute la logique d'affichage dans
`monthly-declaration-config.view-model.ts`** — des fonctions pures testables sans TestBed.

**Les comptes d'une colonne se saisissent par deux champs, pas un.** Le sélecteur multiple est
alimenté par le plan comptable du dossier et produit des comptes *exacts* ; les racines (« 70 » et
sa descendance) se saisissent à part, séparées par « ; », comme les postes budgétaires. Une racine
n'est pas nécessairement un compte du plan : l'imposer dans le sélecteur interdirait le cas le plus
courant.

**La table dit la règle en toutes lettres** (« crédits de 70… », « Brut × 0,2 % », « Paie — Net
imposable ») plutôt qu'un code de type : c'est cette phrase que le comptable relira le jour où un
montant le surprendra. Deux états y sont signalés d'emblée plutôt que découverts au dépôt — la
combinaison non prise en charge (retenue déduite d'elle-même) et les comptes exacts absents du plan.
Un point sur l'onglet marque une **famille incluse sans rubrique active**, qui bloquera
l'enregistrement en mode paramétré.

**La validation côté écran est un confort de saisie, pas une autorisation.** Elle reprend les règles
de `MonthlyDeclarationRubric.Validate` pour éviter l'aller-retour d'une erreur évidente ; le serveur
revalide tout et reste seul juge. Même partage pour la duplication : la liste de dossiers proposée
vient du portefeuille du cabinet, mais c'est le serveur qui la reconfronte — ce que l'écran affiche
n'autorise rien.

La route est gardée par `permissionGuard` sur `accounting:read` et **non** sur `accounting:declare` :
la consultation doit rester ouverte, les écritures étant gardées endpoint par endpoint. `canWrite`
reflète le verrou serveur `IsAccountingFirmDelegatedContext` (cabinet, dossier ouvert) et bascule
l'écran en lecture seule ailleurs. Enfin, `/accounting/dm/*` est **délibérément absent** de
`COMPANY_ACCOUNTING_ALLOWED_ROUTE_PREFIXES` ; un test assère cette absence pour que personne ne
« corrige » l'oubli apparent. Le lien de navigation vit dans la section « Declarations » et non
« États », dont les routes alimentent justement cette liste d'autorisation.

## L'écran Calcul DM

`/accounting/dm/calcul` — on choisit une période, on calcule, on lit. La commande **ne dépose
rien** : séparer le calcul de l'enregistrement permet de le relancer autant de fois qu'il le faut
sans toucher au document.

**Le calcul est néanmoins une écriture**, et l'écran est construit autour de ce fait. En contrôle
de parité, il consigne le résultat de la comparaison sur les réglages du dossier, et c'est cette
série — elle seule — qui ouvre ensuite la bascule. D'où deux conséquences : la route est gardée
comme la configuration (`accounting:read` à l'entrée, `accounting:declare` **et** contexte cabinet
délégué côté serveur), et les réglages sont **relus après chaque calcul** — afficher une rampe
périmée à côté du résultat qui vient de la faire avancer serait le plus sûr moyen de faire douter
du chiffre.

**Le rapprochement vit dans l'en-tête de chaque famille**, pas dans une table à part : total du
détail, montant porté par la déclaration, et la phrase qui dit ce que l'écart signifie. Cette
phrase dépend entièrement du régime, et c'est ce qui la rend utile — en contrôle de parité
l'écart **est** l'objet de la mesure, en mode paramétré le détail et la case déclarée sont le même
calcul et toute différence est une anomalie. La table de correspondance famille → case reprend
exactement `GetVatDeclarationQuery.ApplyRollUp`, et un test l'énumère : la T.V.A et « Autres
renseignements » n'alimentent aucune case chiffrée, et l'écran le dit plutôt que d'afficher un
zéro trompeur.

**Les signalements sont traduits et dédoublonnés.** Le moteur envoie des jetons techniques — le
nom d'énumération de la famille pour `MissingRubricForFamily`, par exemple — que l'écran retraduit
dans le libellé de l'onglet à ouvrir pour corriger. Il répète aussi le même compte inconnu sur
chaque rubrique qui le cite : afficher la phrase quinze fois noierait les quatorze autres. Deux
gravités seulement, et le critère est ce que le lecteur doit en faire — « erreur » quand le montant
produit est faux tant que la configuration n'est pas corrigée, « avertissement » quand le montant
est juste mais que son sort mérite d'être dit.

Le changement de régime vit sur cet écran et non dans la configuration : c'est ici qu'on accumule
la preuve, c'est ici qu'on décide. Le panneau chiffre la rampe (« 1 sur 3, encore 2 périodes »)
plutôt que d'annoncer un verdict, et le champ « motif de dérogation » n'apparaît **que** lorsqu'il
est exigé — l'offrir en permanence suggérerait qu'on peut passer outre la série à volonté.

## Le modèle d'intégration

`/accounting/dm/modele` — emporter la configuration d'un dossier dans un fichier, et l'appliquer
ailleurs. La duplication inter-dossiers ne franchit pas les frontières du cabinet ; le modèle, si.

**Un seul format, un seul analyseur.** Le fichier d'échange est le même que le catalogue
d'amorçage embarqué, que `MonthlyDeclarationCatalogs` lit par `MonthlyDeclarationModel.Parse` —
exactement l'analyseur de l'import. Un catalogue s'importe donc
tel quel, et un modèle exporté peut servir de catalogue ; un test l'exerce sur la ressource
embarquée. Deux analyseurs auraient divergé au premier champ ajouté, et l'utilisateur aurait
découvert la divergence en important un fichier silencieusement tronqué.

**Les deux appelants n'attendent pas la même chose des entrées fautives**, et l'analyseur ne
tranche pas à leur place : il rend les entrées valides *et* la liste des rejets avec leur motif.
L'amorçage ignore les rejets — il tourne à la première requête d'un dossier, et une coquille dans
le catalogue ne doit pas mettre le dossier entier en erreur pour une ligne de référence. L'import
refuse le fichier **entier**, en nommant les entrées en cause : un fichier choisi par
l'utilisateur qui passerait à moitié laisserait une configuration dont personne ne sait dans quel
état elle est.

**L'état actif est un tri-état, pas un booléen.** Le catalogue n'en dit rien, un modèle exporté
le dit toujours. `null` signifie « la source ne se prononce pas » et laisse la rubrique existante
intacte : sans cette distinction, importer un catalogue réactiverait une rubrique que le comptable
avait écartée. Le modèle porte pour la même raison les montants fixes et les bornes de période,
que le catalogue ignore — sinon un aller-retour export/import les effacerait en silence.

**Ce que le modèle ne transporte pas**, délibérément : le régime de calcul et l'état de la rampe
de parité. Ils appartiennent au dossier et à son historique de contrôles ; les importer ferait
basculer un dossier en calcul paramétré sur la foi d'un fichier. Un test vérifie leur absence du
document sérialisé.

L'écriture passe par le **point d'écriture commun** à l'import et à la duplication
(`MonthlyDeclarationConfigWriter`) : même politique « insérer ou remplacer, jamais supprimer en
masse », donc même rejouabilité. Une différence subsiste entre les deux et elle est assumée : le
modèle transporte les inclusions de familles, la duplication non. Inclure une famille déplace des
montants déclarés ; l'écran l'annonce avant l'import, et une famille absente du fichier n'est
jamais révoquée.

L'export est ouvert sous `accounting:read`, **même drapeau éteint** : le fichier ne fait que
refléter des données déjà lisibles à l'écran. L'import est une écriture, sous
`accounting:declare` et contexte cabinet délégué.

## L'écran Suivi DM

`/accounting/dm/suivi` — les douze mois d'un exercice en une page : ce qui est déposé, ce qui
manque, sous quel régime, et où en est la rampe. C'est l'écran qui rend la migration observable :
tout le reste du chantier la rend *possible*.

**Les douze mois sont toujours rendus, même vides.** Une période sans dépôt est une ligne, avec
son échéance : c'est le trou que l'écran doit montrer, et l'omettre le rendrait invisible au
moment où il compte le plus. Un mois sans dépôt dont l'échéance est passée est « en retard »,
pas « à déposer » — les deux disent qu'il n'y a rien, mais l'un appelle une action aujourd'hui.

**Le régime affiché est celui de la période, pas celui du dossier.** Un dossier basculé en juillet
a ses six premiers mois restés au calcul historique ; les afficher tous « paramétrés »
raconterait une histoire fausse. La ligne passe par `MonthlyDeclarationSettings.ResolveModeFor`,
la même méthode que le moteur — et la synthèse compte les mois **effectivement** calculés par la
configuration, ce qui n'est pas la même chose que le régime déclaré du dossier.

**Un brouillon n'entre pas dans le cumul à payer.** Le total de l'exercice n'agrège que les
périodes réellement déposées ; y ajouter les brouillons annoncerait une dette qui n'est pas
engagée. Et le total à payer d'une ligne vient de l'expression **partagée** avec l'écran de
déclaration (`GetVatDeclarationQueryHandler.TotalToPay`, ouverte en `internal` pour cela) : deux
formules auraient fini par donner deux chiffres pour la même période.

La requête ne charge **pas** le détail par rubrique des douze déclarations : le suivi compte et
date, il n'affiche aucune ligne. Elle reste ouverte drapeau éteint — voir les trous de dépôt ne
dépend d'aucun drapeau, et l'écran le signale plutôt que de se taire.

C'est le seul écran DM en **lecture seule**, et un test vérifie qu'il n'offre aucune action
d'écriture. Sa requête serait légitimement ouverte à la société — elle ne dit rien qu'un dossier
ne puisse savoir de ses propres dépôts — mais la route reste hors de
`COMPANY_ACCOUNTING_ALLOWED_ROUTE_PREFIXES` comme tout `/accounting/dm/*` : l'ouvrir aux sociétés
est une décision de navigation à prendre pour elle-même, pas un effet de bord de l'ajout d'un
écran.

## Reste à faire

- Écrans restants : États et Récap DM — **sans définition écrite à ce jour**. À spécifier avant
  d'être construits plutôt que devinés.
- Suivi DM : ouvrir ou non la route aux sociétés (la requête s'y prêterait ; la navigation non).
- Calibration des pages 6, 7, 8, 11 et 12 du gabarit pour les familles sans case de détail
  (droit de consommation, taxe hôtelière, droit de licence, autres informations) — **non livrable
  sans épreuve remplie rendue en image et relecture fiscaliste**, comme l'exige la procédure de
  `tools/official-form-calibration`.
- Duplication inter-dossiers : étudier si elle doit, comme le modèle, transporter les inclusions
  de familles et l'état actif des rubriques. Comportement actuel conservé faute de décision.
- Retrait de l'ancien calcul une fois tous les dossiers actifs en mode configuré.

## Réserve fiscale

Les taux et les comptes du catalogue sont des **valeurs de départ**, pas une doctrine validée. Ils
reprennent ce que le formulaire officiel énonce (TFP 1 %/2 %, FOPROLOS 1 %, TCL 0,2 %/0,1 %, TVA
7/13/19 %, retenues 3 %, 10 %, 15 %, 20 %, 25 %, 100 %…) et les seuls comptes dont le dépôt porte
déjà la constante (436711, 43666, 43662, 43652, 4371, 613). Tout le reste est laissé « à saisir »
plutôt qu'inventé. Aucune famille n'étant cochée par défaut, rien n'est calculé tant qu'un dossier
ne l'a pas explicitement décidé — et le contrôle de parité reste le verrou avant toute bascule.
