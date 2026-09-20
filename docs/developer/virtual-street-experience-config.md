# L2 — configuration 3D : première tranche dormante

Cette tranche fournit `StorefrontExperienceOptions`, sa validation et **un seul**
`StorefrontExperienceStateProvider`. Elle ne rend pas la coupure opérateur fonctionnelle
dans l'application. Aucun service n'est enregistré, aucun endpoint n'est ajouté,
aucune option existante ou donnée métier n'est modifiée.

## Contrat et admission locale

- Schéma 1, modes exacts `list`, `legacy`, `catalog-v2` ; défaut `list`.
- Bail fini dans `(0, 60]`, fractions admises conformément à L0 ; proposition 50 s.
- Révision non vide, au plus 128 caractères, sans contrôles ni espaces périphériques.
  Ces bornes opérateur sont plus restrictives que le simple non-vide du consommateur L0.
- Version catalogue : 1–64 caractères ASCII, premier alphanumérique puis
  alphanumériques/`.`/`_`/`-`, sans `..` ; obligatoire pour `catalog-v2`,
  strictement `null` pour `list` et `legacy`.
- Document UTF-8 de 4 Kio maximum, profondeur JSON 4 maximum, cinq propriétés camelCase
  obligatoires ; types incorrects, doublons, inconnues, commentaires et virgules finales refusés.
  Une configuration partielle ne reçoit pas les valeurs par défaut pendant sa lecture.
- Options immuables, état lu sous verrou, génération de lecture à usage unique.
  Le hash SHA-256 décrit les mêmes octets copiés que ceux soumis au parseur.
- Santé distincte de la dernière valeur validée : démarrage, lecture en cours, erreur
  ou contrôle expiré = `Unavailable` ; document invalide = `Invalid` ; catalogue
  sans index de livraison raccordé = `OutOfSync`. Dans tous ces cas, `GetState()`
  ne retourne que la configuration `list`, avec ancienne révision/hash **diagnostiques**.
- Contrôle frais pendant **moins de 5 s depuis le début de la lecture**, sur le
  `TimeProvider` monotone .NET 8. À 5 s exactement, aucune nouvelle admission favorable.
  Une relecture réelle des mêmes octets peut renouveler ce contrôle : une révision stable
  n'est pas intrinsèquement périmée. Un callback répété ou ancien ne le peut pas.

`catalog-v2` est validé syntaxiquement mais reste **toujours refusé par le provider**
dans cette tranche : aucun index N/N−1 autorisé n'est encore raccordé. Les tests
favorables utilisent `legacy` ; ils ne prétendent pas autoriser un catalogue de production.

## Frontière à raccorder ensuite

Le futur adaptateur doit appeler `BeginReload()` **avant** toute lecture/signal de changement,
puis `CompleteReload(token, bytes)` uniquement avec les nouveaux octets, ou
`FailReload(token)` pour fichier absent, refus d'accès, erreur I/O ou erreur de rechargement.
Une erreur qui empêche même ce callback laisse déjà l'admission fermée depuis `BeginReload`.
Il ne faut jamais fournir `IOptionsMonitor.CurrentValue` comme substitut d'une lecture
échouée : `IOptionsMonitor` seul ne garantit pas ce comportement fail-closed.

Restent à implémenter et qualifier, sans second provider concurrent :

1. Source opérateur isolée, limite effective lors de la lecture du fichier, priorité sur
   les autres sources, watchers/erreurs de chargement, watchdog, rename atomique et montage
   du répertoire. Les 4 Kio ici bornent le parsing, pas les allocations d'un lecteur externe.
2. Index de livraison autorisé N/N−1, comparaison révision/hash attendus, refus des
   versions absentes/incompatibles/révoquées et santé de convergence multi-instance.
3. Raccordement DI/Program et endpoint `experience-config` avec projection dédiée,
   enveloppe ApiResponse et `Cache-Control: no-store`. Ne pas sérialiser l'état interne,
   ni `StorefrontOptions` qui contient des options serveur sensibles.
4. Contrôle du bail navigateur, arrêt/reprise, indépendance de la fraîcheur publique,
   tests filesystem .NET réels, HTTP, multi-instance et navigateur.

Le flag `Features:Storefront:Enabled`, les endpoints actuels, la fiche/liste HTML,
le frontend, SQL et les assets restent inchangés. Aucun serveur frontend n'est lancé.
La combinaison opérationnelle proposée 50 s de bail + contrôle/propagation ≤5 s + arrêt
actif ≤1 s reste **à mesurer** ; aucun délai global 60 s n'est garanti, notamment sur
un navigateur ou système suspendu. La réadmission doit précéder toute frame au réveil.

## Tests ciblés

```sh
dotnet test src/Backend/tests/FactuTrust.Infrastructure.Tests/FactuTrust.Infrastructure.Tests.csproj \
  --configuration Release --filter 'FullyQualifiedName~StorefrontExperience' \
  --logger 'console;verbosity=minimal'
```

Ces tests unitaires utilisent une horloge manuelle, pas SQL ni le système de fichiers.
Ils couvrent notamment une valeur favorable suivie d'un document invalide, les erreurs
de source signalées, les générations tardives/répétées et les frontières de fraîcheur.
Ils ne clôturent pas L2/G2/G4 ni les scénarios SQL/renderer V04/V05.
