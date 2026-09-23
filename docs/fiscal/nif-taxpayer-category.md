# NIF — lettre de « catégorie de contribuable » : hypothèse non sourcée (dette à lever)

> **Statut : hypothèse de code, non validée fiscalement.** Ce document existe pour qu'aucune règle
> métier ne soit ajoutée sur cette base sans validation préalable, et pour que la correction du jour
> où la sémantique sera confirmée soit mécanique.

## Ce que le code suppose aujourd'hui

`src/Backend/FactuTrust.Domain/ValueObjects/NIF.cs` stocke la forme carte
`NNNNNNNL/A/M/NNN` (ex. `1772793W/A/M/000`) et accepte encore la saisie historique
`NNNNNNN/L/A/M/NNN`. Les deux écritures sont le même matricule. Les segments sont lus
par structure, pas par index brut :

| Propriété | Segment | Interprétation supposée |
|---|---|---|
| `IdentificationNumber` | 7 chiffres | numéro d'identification |
| `TaxpayerCategory` | 1ʳᵉ lettre (clé, collée aux chiffres) | **catégorie de contribuable** (hypothèse) |
| `MainActivity` | 2ᵉ lettre | activité principale |
| `SecondaryEstablishment` | 3ᵉ lettre | établissement secondaire |
| `OfficeCode` | 3 chiffres | code bureau |

et `TaxpayerCategories` associe à la 1ʳᵉ lettre une table **A–G** :
A = personne physique, B = société de personnes, C = société de capitaux, **D = association**,
E = établissement public, F = personne morale étrangère, G = autre. Toute autre lettre ⇒ `"Inconnu"`.

## Pourquoi cette hypothèse est douteuse

Le format stocké est `^[0-9]{7}[A-Z]/[A-Z]/[A-Z]/[0-9]{3}$` (la saisie historique
`^[0-9]{7}/[A-Z]/[A-Z]/[A-Z]/[0-9]{3}$` est canonisée vers lui) : **les 26 lettres sont admises**, alors que
la table n'en décrit que 7. Or, dans la structure couramment documentée du matricule fiscal
tunisien, la **première lettre est la clé de contrôle** (calculée, donc quelconque) ; les lettres
porteuses de sens sont le **code TVA** et le **code catégorie** (M, P, N, C, E…), en 2ᵉ et 3ᵉ
position. Sous cette lecture, la table A–G ne décrit pas la bonne position **et** pas le bon jeu de
lettres.

Conséquence observée en production (inscription, 2026-09) : un matricule réel dont la 1ʳᵉ lettre
était `P` produisait le message

> « Le segment sélectionné est « Association », mais votre NIF indique la catégorie P (Inconnu) et
> non une association. »

c'est-à-dire une accusation construite sur une lettre que le code déclare lui-même ne pas savoir
interpréter.

## Ce qui a été fait (correctif conservateur)

1. `TaxpayerCategories.IsKnown(char)` — la table dit désormais explicitement ce qu'elle sait lire.
2. `NifCategorySegmentCoherenceChecker` **s'abstient** sur toute lettre hors A–G
   (`« Inconnu » = non interprétable`, jamais `« incohérent »`). Le contrat « fail-open, jamais de
   faux positif » écrit dans ce fichier est ainsi respecté.
3. Le contrôle entier est derrière un kill-switch :
   `Features:RegistrationSector:NifSegmentCoherenceWarningEnabled` (défaut `true`). Le passer à
   `false` supprime l'avertissement **sans redéploiement**, si le doute fiscal devait l'emporter.
4. Le front applique exactement la même abstention (`parseNifCategory` renvoie `null` hors A–G),
   verrouillée par des tests de parité.

Ce correctif **ne prétend pas** que la table A–G est juste : il empêche seulement d'affirmer
quelque chose à partir d'une lettre non interprétable.

## Faux positif encore possible (assumé, à trancher par la validation fiscale)

Si la 1ʳᵉ lettre est bien la **clé de contrôle**, alors :

- une société dont la clé vaut `D` s'entend dire « votre NIF indique une association » ;
- une association dont la clé vaut `A`–`C`/`E`–`G` s'entend dire l'inverse.

Ces cas restent possibles tant que la sémantique n'est pas validée. Ils sont **non bloquants**
(l'inscription aboutit, tous les modules demandés sont activés) et l'utilisateur peut confirmer son
segment. Si le volume devient gênant avant la validation : basculer le kill-switch à `false`.

## Comment lever la dette (quand une source officielle est disponible)

Source à obtenir : spécification DGI ou cahier des charges TTN/el-fatoora décrivant la composition
du matricule fiscal (position et jeu de valeurs de chaque lettre).

Points de code à modifier — le périmètre est volontairement minuscule :

1. `src/Backend/FactuTrust.Domain/ValueObjects/NIF.cs` — positions (`TaxpayerCategory`,
   `MainActivity`, `SecondaryEstablishment`) et table `TaxpayerCategories` (+ `IsKnown`,
   `GetDescription`).
2. `src/Backend/FactuTrust.Domain/SectorConfiguration/NifCategorySegmentCoherenceChecker.cs` —
   la lettre lue et le libellé « catégorie D » codé en dur dans le message.
3. `src/Frontend/factutrust-web/src/app/features/auth/shared/auth-nif-category.helpers.ts` —
   `NIF_CATEGORY_PATTERN` (groupe capturant), `NIF_CATEGORY_LABELS_FR`,
   `NIF_CATEGORY_SUGGESTED_SEGMENT`.

Consommateurs de `NIF.TaxpayerCategory` : **le seul est le checker de cohérence** (plus le champ
optionnel `TaxpayerCategory` de `INifRegistryLookupService`). Aucune donnée persistée ne dépend de
cette lecture — un re-mapping est donc sans migration.

Tests à mettre à jour en même temps :

- `src/Backend/tests/FactuTrust.Infrastructure.Tests/SectorRules/NifCategorySegmentCoherenceCheckerTests.cs`
- `src/Frontend/factutrust-web/src/app/features/auth/shared/auth-nif-category.helpers.spec.ts`
