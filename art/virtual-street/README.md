# Production artistique hors ligne — socle A0

Ce dossier prépare la production originale du V4 approuvé (Volet II et annexe
II-A). **Aucun modèle, rendu final, droit, consentement propriétaire, budget réel
ou résultat artistique n'est livré ou validé par ce socle.** Ce n'est ni le
catalogue public L0, ni son gate d'assets, ni un générateur de huit pièces
recolorées. Aucun téléchargement, achat, service génératif ou rendu n'est exécuté.

## Commandes autonomes (Python 3.10+, bibliothèque standard)

Depuis la racine du dépôt :

```sh
python3 art/virtual-street/source/production.py validate
python3 art/virtual-street/source/production.py plan
python3 art/virtual-street/source/production.py preflight
python3 art/virtual-street/source/production.py stage-pilots --run-id a0-pilots-01
python3 -m unittest discover -s art/virtual-street/source/tests -v
```

- `validate` : CSV, comparaison exacte à la V3, empreintes des entrées approuvées,
  invariants de production et schéma du registre de droits. Code 0 signifie
  **entrées A0 valides**, jamais release prête. Le registre vide est admis ici,
  mais reste un blocage de production.
- `plan` : mêmes vérifications, puis JSON des cibles, références des 43 fiches de
  revue et briefs des quatre pilotes. Les fiches sont des **exigences**, sans
  images ni décisions humaines inventées.
- `preflight` : mêmes vérifications, puis disponibilité/version de Blender
  (`--version` seulement, délai 5 s), versions non épinglées, sources et déclarations
  de droits manquantes. Code **2 = bloqué**, y compris si Blender est installé :
  l'authoring, l'export et les gates réels ne sont pas implémentés dans cette tranche.
- `stage-pilots` : écrit uniquement `build/<run-id>/job-spec.json`, contenant les
  quatre briefs exacts, collections, cibles, sous-budgets et preuves futures.
  Aucun GLB, `.blend`, image ou manifeste runtime n'est fabriqué. Destination fixe
  hors assets ; identifiant borné ; refus des symlinks de destination et de toute
  réécriture d'un run existant. Aucun paramètre pour débloquer les 32 autres.
- Code **1 = entrée/écriture invalide**. Les commandes de lecture ne modifient pas
  les entrées ; les tests vérifient leurs empreintes avant/après.

## Source de vérité et couverture sans double comptage

`source/canonical36.csv` est une copie textuelle exacte du CSV du plan approuvé.
`source/v3-matrix-canonical.md` conserve l'extraction V3 fournie par l'utilisateur.
Le lock de `release-spec/` détecte les changements de ces deux entrées ; c'est une
protection contre la dérive documentaire, **pas une signature d'acceptation**.
Toute évolution de leurs dimensions, zones, accessoires, thème ou implantation
demande une revue éditoriale explicite, pas une régénération automatique du lock.

Les contrôles préservent les 36 couples, leurs dimensions **L×P×H**, leur programme,
la liste **complète** des props (pas seulement les trois indices), les 36 placements
et cinq styles. Les rappels legacy restent **L×H×P**, sans inversion des axes.
Familles : F01–F08 = **5/3/2/6/7/3/5/5** ; ce partage n'autorise pas huit modèles
indistinguables. Les huit grands gardent un extérieur local entier : leur image
extérieure canonique ne peut être celle du raccord de rue.

Les comptages calculés sont des **objectifs**, pas des compteurs de livraison :

| Objectif | Comptage |
|---|---:|
| Couples / familles / pilotes / grands | 36 / 8 / 4 / 8 |
| Fiches de revue | 36 + 6 aliases + 1 global = 43 |
| Images distinctes minimum | 36 × 2 + 2 globales = 74 |
| Résolutions métier/style | 36 × 5 = 180 |
| Configurations métier/style/qualité | 180 × 2 = 360 |
| Captures runtime de base | 36 × 5 × 2 × 2 = 720 |
| Exports théoriques avant partage/partition | 2 × (72 + 8 + 2) = 164 |

Les six aliases référencent exactement les douze images des couples `autre` :
**zéro nouvelle image**. Ils ne sélectionnent aucun profil public sans acceptation
explicite. Le global n'est pas un 37e couple spécialisé. Les 74 identifiants de
cibles ne prouvent pas 74 compositions visuelles : les futurs exports/images
exigeront vérification des fichiers, hashes, doublons exacts, revue perceptuelle
et décision humaine. Recadrages, miniatures, réencodages, teintes et aliases ne
comptent pas comme nouvelles compositions. Les preuves complémentaires grands,
aliases, global et scénarios d'erreur s'ajoutent aux 720 captures de base.

## Frontières source / staging / release

- `source/` (singulier) : exigences versionnées, Python, puis futures sources
  originales éditables dans `profiles/vp-cNN/r1/scene.blend`, familles et ressources
  partagées. Aucune source Blender n'est présente à ce checkpoint.
- `build/` : staging local régénérable, ignoré par Git ; jamais une livraison
  approuvée. Il est créé à la demande par `stage-pilots`.
- `release-spec/` : **spécifications hors ligne**, pas `manifest-v2.json`. Le fichier
  `production-policy.json` est en schéma interne 1, milestone A0,
  `publicationAllowed: false`. Blender/exporteur restent volontairement non
  épinglés tant qu'une chaîne réelle n'a pas été qualifiée.
- `licenses.csv` : inventaire public minimal de provenance des ressources
  **effectivement retenues** ; actuellement en-tête seul. Le schéma de colonnes
  CSV et les règles exécutables sont dans `release-spec/licenses.schema.json`
  et `source/rights.py` (ce fichier décrit un CSV, pas JSON Schema draft).
- Les inspirations privées, masters haute résolution, contrats, coordonnées et
  preuves juridiques doivent rester dans un stockage restreint extérieur au dépôt.
  Des règles d'exclusion Git protègent aussi les dossiers `references/`,
  `highres/`, `rights/`, `restricted/` à toute profondeur. Elles ne remplacent
  ni le contrôle d'accès, ni une revue des fichiers avant commit/publication.

Le dossier `art/` n'entre pas dans les entrées d'assets Angular actuelles. Ce CLI
ne copie rien vers le frontend ; il ne faut jamais y ajouter le répertoire entier
comme glob public. Aucun JPEG privé ni chemin absolu d'inspiration n'est importé ;
les numéros de références du CSV ne sont que des renvois documentaires sans droit
de redistribution. Les tests synthétiques restent hors assets publics.

La future publication appartient à une autre tranche : seules les sorties
effectivement vérifiées de `build/` pourront alimenter un catalogue immuable
`catalogs/<catalogVersion>/` avec le contrat L0 existant, hashes réels, attribution
minimale et gates non générateurs. Ne pas écrire sous une version déjà publiée.
Pas de commande de promotion, contournement de gate ou activation dans A0.

## Droits et provenance

Pour chaque ressource future, enregistrer son auteur public, origine originale ou
gratuite, URL publique de notice sans secret, version et SHA-256 exacts, licence et
coût nul. Vérifier **séparément** commercial, modification, redistribution web et
redistribution des fichiers extractibles. Une licence « rendu uniquement », NC,
ND ou incertaine ne peut pas être marquée `reviewed` avec quatre droits `yes`.
Les fontes demandent en plus la revue web/rasterisation, copyright, noms réservés
et éventuelle modification. Le libellé de licence seul n'établit aucun droit.

Une ligne `pending` conserve des champs inconnus, sans prétendre à une validation.
Une déclaration `reviewed` doit être complète, avec date, relecteur public et
référence opaque vers la preuve restreinte ; le CLI vérifie la **structure**, pas
la vérité du contrat ni l'autorité du relecteur. Pas de preuves privées, URL signée
ou chemin de contrat dans le CSV. Ne pas inventer d'auteur, d'accord ou de ligne
pour combler le registre vide. Les notices synthétiques des tests n'ont aucune
valeur juridique et ne figurent jamais dans le registre réel.

La licence d'un asset n'est pas le consentement visuel d'un propriétaire, et
réciproquement. Les canoniques ne portent aucun nom/logo de tenant. FR/AR/mixte,
shaping des fontes licenciées et slots de branding restent des preuves futures,
pas des résultats de ce CLI.

## Prochaine étape artistique et arrêt obligatoire

Après provisioning par l'opérateur, authorer **C12 mode 6×10×3,4**, puis
**C17 bureau IT 7×10×3,2**, **C19 santé neutre 7×10×3,2** et
**C05 logistique 24×36×8** dans Blender. Le premier blocage métrique doit conserver
les zones et props exacts du brief, y compris rideau/miroir, réunion IT distincte,
conseil santé séparé, racks/palettes/colis/transpalette/portes et parcours quais.

Réouvrir les sources, épingler l'outillage après essais, produire les exports
déclarés sans guides/références, tester UV1/lightmaps dans r161 et les deux qualités
avec cinq recettes, puis huit vrais rendus canoniques et 80 captures runtime de
base (preuves logistique supplémentaires). Le préflight de présence ne valide
ni géométrie, ni UV, ni dépendances, ni collisions, ni réalisme, ni performance.

**Stop humain commun après les quatre vrais pilotes, avant les 32 restants.**
Une décision écrite art/métier/ingénierie autorise poursuivre/corriger/arrêter ;
aucun test unitaire vert ne la remplace. A0 n'est pas A1, A4 n'est pas une release
autorisée, et aucune acceptation n'est présumée ici.
