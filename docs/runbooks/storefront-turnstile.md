# Commandes publiques : validation Cloudflare Turnstile

## Périmètre et changement de comportement

Le serveur vérifie désormais le jeton reçu dans l'en-tête existant `X-Turnstile-Token`
du `POST /api/public/street/orders` auprès de Cloudflare **avant toute lecture ou
écriture de commande**. L'interface booléenne, la charge utile et l'erreur publique
`Vérification anti-bot invalide.` ne changent pas. Aucun widget ni véritable parcours
checkout n'est ajouté : le frontend actuel reste un placeholder.

**Avant déploiement, fournir le secret et les hôtes autorisés.** Avec
`OrderSubmissionRequiresCaptcha=true` (défaut), une configuration absente ou
invalide refuse toutes les commandes publiques sans contacter Cloudflare. Il ne
s'agit plus d'accepter n'importe quelle chaîne non vide. Les lectures publiques
et les autres fonctions ne sont pas désactivées par cette absence de configuration.

## Configuration serveur

Section .NET : `Features:Storefront`. Les valeurs suivies dans `appsettings.json`
restent vides, sans clé réelle ni hôte implicitement approuvé.

| Option | Variable d'environnement | Valeur attendue |
| --- | --- | --- |
| `OrderSubmissionRequiresCaptcha` | `Features__Storefront__OrderSubmissionRequiresCaptcha` | `true` en production |
| `TurnstileSecretKey` | `Features__Storefront__TurnstileSecretKey` | Secret du widget Cloudflare, injecté par le gestionnaire de secrets du déploiement |
| `TurnstileAllowedHostnames` | `Features__Storefront__TurnstileAllowedHostnames__0`, puis `__1`, etc. | Hôtes DNS exacts où le widget s'exécute, p. ex. `shop.example.com` |
| `TurnstileExpectedAction` | `Features__Storefront__TurnstileExpectedAction` | Optionnel, vide par défaut ; action exacte déjà définie sur le widget appelant |
| `Enabled` | `Features__Storefront__Enabled` | `false` conserve le refus existant du handler, sans validation HTTP ni accès aux repositories |

Les hôtes sont comparés en entier, sans tenir compte de la casse DNS : aucune
correspondance par suffixe ou sous-domaine. Chaque entrée doit être un nom DNS ASCII
valide (IDN sous forme punycode), sans schéma, port, chemin, wildcard, espace, adresse
IP ou point final. Une seule entrée invalide invalide toute la liste. Configurer
également les domaines autorisés du widget dans le tableau de bord Cloudflare.
L'hôte attendu est celui du **widget**, pas nécessairement celui de l'API.

L'action optionnelle est sensible à la casse et limitée à 32 caractères ASCII
alphanumériques, `_` ou `-`. Si configurée, elle doit être présente et identique dans
Siteverify. Ne pas inventer une action côté serveur avant son raccordement côté
appelant. Une action vide ne désactive jamais la vérification d'hôte.

La **site key** publique du widget et la **secret key** serveur sont distinctes.
Le secret se crée/se renouvelle dans Cloudflare Dashboard → Turnstile → widget.
Ne jamais le placer dans Angular, le dépôt, un exemple partagé ou les journaux.
Injecter le secret dans l'environnement de l'API via le système de déploiement ;
avec Docker Compose, vérifier qu'il est réellement transmis au conteneur API, et
pas seulement défini sur la machine hôte. Redémarrer/recréer l'API après changement
de configuration : les consommateurs actuels utilisent `IOptions.Value`, pas un
kill-switch de configuration garanti instantané.

## Garanties et limites opérationnelles

- Unique destination fixe : `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
  Autoriser la sortie HTTPS vers `challenges.cloudflare.com:443` avec validation TLS
  normale. Aucune URL fournisseur configurable et aucune redirection suivie.
- POST `application/x-www-form-urlencoded` avec `secret` et `response` uniquement,
  `Accept: application/json`. Aucune transmission d'IP supplémentaire.
- Jeton non vide, au plus 2048 caractères ; aucun décodage ou parseur local de jeton.
- Cloudflare fait autorité pour la durée de validité de **300 secondes** et l'usage
  unique. Un jeton expiré/rejoué (`timeout-or-duplicate`) est refusé. Aucun cache,
  aucune relance automatique : même après une panne, l'appelant doit obtenir un
  nouveau jeton plutôt que réutiliser celui dont la consommation est incertaine.
- Délai global de 5 secondes, lecture du corps comprise ; réponse limitée à 16 Kio,
  en-têtes à 16 Kio. Requête, réponse et flux libérés. Pas de cookies fournisseur.
- Accepter uniquement JSON valide UTF-8, `success` booléen `true`, hôte autorisé et
  action exacte si configurée. Réponse non-2xx, refus, données manquantes/ambiguës,
  JSON ou UTF-8 malformé, dépassement, panne réseau ou délai dépassé : refus fermé.
  L'annulation réelle de l'appelant est propagée, pas convertie en succès/refus CAPTCHA.
- Le validateur ne journalise ni jeton, ni secret, ni corps de requête/réponse, ni
  exception fournisseur. Maintenir aussi la redaction côté reverse proxy/APM : ne
  pas capturer `X-Turnstile-Token` ou les corps Siteverify.

`OrderSubmissionRequiresCaptcha=false` conserve le bypass historique **explicite**,
sans HTTP ni configuration requise. Réservé au développement/test isolé ; déconseillé
en production. Ne pas l'utiliser comme solution de secours à une panne Cloudflare
ou à un secret manquant : laisser les mutations échouer fermées ou désactiver
temporairement la fonctionnalité avec `Enabled=false` (impact sur toutes les vitrines).

## Vérification avant activation

1. Déployer la configuration serveur et vérifier sa présence sans afficher le secret.
2. En environnement de validation, utiliser un widget et des clés dédiés avec les
   bons hôtes ; ne pas intégrer de clé de test à la configuration de production.
3. Vérifier un jeton frais, un jeton falsifié, un rejeu et une expiration ; les refus
   ne doivent créer aucune commande. Tester aussi l'indisponibilité réseau.
4. Le checkout/widget frontend n'étant pas raccordé par cette correction, ne pas
   considérer les tests serveur comme preuve d'un parcours navigateur livré.

Tests unitaires locaux (HTTP simulé, sans clé utilisateur, Cloudflare ni base réelle) :

```sh
dotnet test src/Backend/tests/FactuTrust.Infrastructure.Tests/FactuTrust.Infrastructure.Tests.csproj \
  --filter 'FullyQualifiedName~StorefrontCaptcha|FullyQualifiedName~SubmitPublicStorefrontOrderCaptcha'
```

Référence officielle : https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
