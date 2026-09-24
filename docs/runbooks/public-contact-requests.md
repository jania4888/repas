# Demandes de contact publiques (landing) — `POST /api/public/contact-requests`

## Périmètre

Endpoint **anonyme** de capture des prospects de la landing publique (FR/AR) :
demande d'accès entreprise, demande de démo cabinet, demande entreprise sur mesure,
autre. Chaque demande valide est persistée dans `PublicContactRequests` (base
**MasterDb**), notifiée par e-mail interne via `IEmailService` (Hangfire) et purgée
automatiquement. Aucune authentification, aucun compte créé, aucune base tenant
touchée. Le formulaire Angular associé vit dans la landing (`#contact`).

Le changement est **additif** : une table, une politique de limitation, des options,
des gabarits d'e-mail, un job de purge. Aucun comportement existant n'est modifié.

## Contrat (gelé avec le frontend)

- `POST /api/public/contact-requests`, `Content-Type: application/json`, corps ≤ 16 Ko,
  sans en-tête `Authorization`.
- Champs : `subject` (`acces-entreprise` | `demo-cabinet` | `entreprise` | `autre`),
  `fullName` et `organization` (2–120, mono-ligne), `email` (≤ 254), `phone` (≤ 32,
  normalisé puis `^(\+216)?[2-9]\d{7}$`), `size` (liste blanche `dossiers:*` /
  `employes:*`, optionnel), `message` (10–2000), `consent: true`, `locale` (`fr`|`ar`),
  `honeypot`, `elapsedMs` (entier ≥ 0), `turnstileToken` (optionnel, ≤ 2048).
- Réponses : `202 { success, data: { reference: "CR-XXXXXX" } }` ; `400`
  `ValidationErrorResponse` (clés camelCase) ou enveloppe `ApiResponse` pour le captcha ;
  `413` (corps trop grand) ; `415` (non JSON) ; `429` + en-tête `Retry-After` (5 envois
  / heure / IP en production, 100 en développement) ; `503` tant que `Enabled=false`.
- Anti-abus (ordre du handler) : (1) sujet valide → (2) honeypot rempli = 202 factice,
  rien persisté → (3) Turnstile si `RequireCaptcha` (seul cas 400 non-FluentValidation)
  → (4) `elapsedMs < MinElapsedMs` = ligne en statut `Spam` (rétention courte, jamais
  notifiée) → (5) doublon e-mail normalisé + sujet < `DuplicateWindowMinutes` = 202 avec
  la **même référence**, pas de nouvelle ligne → (6) garde `MaxAcceptedPerHour` =
  ligne persistée mais notification supprimée → (7) persistance (référence publique
  CSPRNG `CR-XXXXXX`, index unique, 3 tentatives) → (8) notification → (9) 202.
- Confidentialité : IP jamais stockée en clair (`IIpAddressHasher`, SHA-256 salé),
  User-Agent tronqué, journaux sans donnée personnelle (événements `PublicContact.*`
  avec référence, sujet, préfixe du haché IP uniquement), `ConsentTextVersion` horodaté
  sur chaque ligne, `CreatedAtUtc` / `RetentionUntilUtc` par rétention.

## Configuration (`Features:PublicContact`, appsettings vides par défaut)

| Option | Variable d'environnement | Défaut | Rôle |
| --- | --- | --- | --- |
| `Enabled` | `Features__PublicContact__Enabled` | `false` | `false` → 503 immédiat (aucune écriture) |
| `RecipientEmails` | `Features__PublicContact__RecipientEmails__0`, `__1`… | `[]` | Destinataires internes de la notification |
| `RequireCaptcha` | `Features__PublicContact__RequireCaptcha` | `false` | `true` sans secret/hôtes valides = refus de tout (fail-closed) |
| `TurnstileSecretKey` | `Features__PublicContact__TurnstileSecretKey` | `""` | Secret Cloudflare du widget **dédié** (action `contact`) |
| `TurnstileAllowedHostnames` | `Features__PublicContact__TurnstileAllowedHostnames__0`… | `[]` | Hôtes exacts du widget (p. ex. `instafact.shop`) |
| `TurnstileExpectedAction` | `Features__PublicContact__TurnstileExpectedAction` | `contact` | Action attendue dans Siteverify |
| `SendAcknowledgement` | `Features__PublicContact__SendAcknowledgement` | `false` | Accusé au demandeur (gabarit `contact-request-ack`) — à n'activer qu'avec captcha vérifié |
| `MinElapsedMs` | `Features__PublicContact__MinElapsedMs` | `3000` | Sous ce délai de saisie : ligne `Spam`, pas d'e-mail |
| `MaxMessageLength` | `Features__PublicContact__MaxMessageLength` | `2000` | Limite du message |
| `RetentionDays` | `Features__PublicContact__RetentionDays` | `365` | Durée de conservation d'une demande |
| `SpamRetentionDays` | `Features__PublicContact__SpamRetentionDays` | `30` | Conservation des lignes `Spam` |
| `DuplicateWindowMinutes` | `Features__PublicContact__DuplicateWindowMinutes` | `10` | Fenêtre de détection de doublon |
| `MaxAcceptedPerHour` | `Features__PublicContact__MaxAcceptedPerHour` | `60` | Garde globale anti-botnet multi-IP |
| `ConsentTextVersion` | `Features__PublicContact__ConsentTextVersion` | `2026-09-v1` | À incrémenter à chaque modification du texte de consentement affiché |

Au démarrage, l'API journalise les flags effectifs et avertit si `Enabled=true` sans
destinataire, ou si `RequireCaptcha=true` sans secret/hôte (soumissions refusées).
La validation des options au démarrage refuse une configuration incohérente
(délais négatifs, liste de tailles inconnue…).

## Déploiement (ordre recommandé)

> **Avertissement — limitation par IP et `X-Forwarded-For`.** La limite 5 envois/h/IP
> repose sur l'IP distante réelle. L'API ne doit **jamais** être publiée directement
> (sans le proxy nginx en frontal) : `KnownProxies`/`KnownNetworks` sont vidés, donc un
> client qui atteint le port de l'API sans passer par nginx pourrait fournir un en-tête
> `X-Forwarded-For` arbitraire si `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` — contournement
> trivial de la limite. Règle : n'activer `ASPNETCORE_FORWARDEDHEADERS_ENABLED` que si
> nginx réécrit l'en-tête, et ne jamais exposer le port de l'API sur l'hôte public.

1. Déployer l'API avec `Features__PublicContact__Enabled=false`. La migration
   `AddPublicContactRequests` s'applique au démarrage (`MigrateAsync`, SQL idempotent).
   Vérifier : `/health/ready`, `SELECT COUNT(*) FROM PublicContactRequests`, job
   récurrent `purge-public-contact-requests` visible dans Hangfire.
2. Renseigner `Features__PublicContact__RecipientEmails__0` (boîte commerciale) et
   vérifier que `Smtp__Enabled=true` + `Smtp__Password` sont bien injectés dans le
   conteneur API (`docker compose config` — pas seulement définis sur l'hôte).
3. `Features__PublicContact__Enabled=true` puis `docker compose up -d api`.
4. Test de bout en bout externe :

   ```bash
   curl -i -X POST https://instafact.shop/api/public/contact-requests \
     -H 'Content-Type: application/json' \
     -d '{"subject":"demo-cabinet","fullName":"Test Équipe","organization":"Cabinet Test","email":"test@example.com","phone":"71 234 567","message":"Test de bout en bout du formulaire.","consent":true,"locale":"fr","honeypot":"","elapsedMs":8000}'
   ```

   Attendu : `202` + référence. Un 6ᵉ envoi dans l'heure depuis la même IP → `429`
   avec en-tête `Retry-After`. Contrôler la réception de l'e-mail interne
   (`api/platform/email-messages`, statut `Sent`) puis supprimer la ligne de test.
5. Quand le widget Turnstile est en ligne sur la landing : créer un widget dédié
   (action `contact`, hôte exact), injecter secret + hôtes, passer
   `Features__PublicContact__RequireCaptcha=true`, recréer l'API, vérifier qu'un envoi
   sans jeton répond `400` (« Vérification anti-bot invalide. »).
6. Activer l'arabe sur la landing uniquement après relecture du texte (décision
   frontend, sans impact ici : `locale` est déjà transportée).

## Rollback

| Besoin | Action | Effet |
| --- | --- | --- |
| Couper la capture | `Features__PublicContact__Enabled=false` + recréer l'API | 503 immédiat ; données conservées |
| Revert du code | `git revert` + redéploiement | Endpoint absent ; la table reste (inerte) |
| Supprimer la table | La migration `Down` supprime la table (`DROP TABLE`) ; un script SQL inverse optionnel peut être dérivé du jumeau `docs/runbooks/sql/AddPublicContactRequests_Master.idempotent.sql` ; ne jamais supprimer une table non vide sans export | — |
| Time-trap trop strict (faux positifs) | `Features__PublicContact__MinElapsedMs=0` | Plus aucune ligne marquée `Spam` |
| Captcha en échec | `Features__PublicContact__RequireCaptcha=false` | Envois acceptés sans jeton |

## Exploitation

- **Demandes enregistrées non notifiées** (spam, garde horaire, échec SMTP) :

  ```sql
  SELECT PublicReference, Subject, Status, CreatedAtUtc
  FROM PublicContactRequests
  WHERE NotificationEnqueued = 0 AND Status = 0
  ORDER BY CreatedAtUtc DESC;
  ```

- Ratio `PublicContact.NotificationSuppressed Reason=time-trap` dans les journaux :
  s'il décolle, vérifier `MinElapsedMs` (auto-remplissage navigateur) avant de durcir.
- Purge : job Hangfire `purge-public-contact-requests`, quotidien à **11 h UTC**
  (créneau libre ; 1 h–10 h sont occupés), au plus 10 000 lignes par exécution, le
  reste part à l'exécution suivante ; les journaux ne contiennent que des comptages.
- E-mails : gabarits `contact-request-received` (interne, toutes les valeurs
  utilisateur encodées HTML, sujet 100 % serveur) et `contact-request-ack` (accusé,
  inactif par défaut) ; retries SMTP 60 s / 600 s / 3 600 s via `SendEmailJob` ;
  relance possible depuis `api/platform/email-messages`.
- Accès / effacement (RGPD) : rechercher par `PublicReference` ou `Email`, exporter
  la ligne, puis `DELETE` ciblé.
- **Copies e-mail (RGPD)** : la notification interne `contact-request-received` copie
  nom, e-mail, téléphone et message dans `EmailMessages` (sujet =
  `… — {{ reference }}`, donc `WHERE Subject LIKE '%CR-XXXXXX%'` pour retrouver), et la
  purge quotidienne **ne supprime pas** ces lignes (rétention e-mail inchangée). Pour un
  effacement complet : supprimer la ligne `PublicContactRequests` **puis** anonymiser ou
  supprimer les `EmailMessages` correspondants (`Subject LIKE '%<référence>%'` ou corps
  contenant l'adresse). La purge seule « ne finit pas le travail » pour ces copies.

## Tests

```bash
cd src/Backend
dotnet build FactuTrust.sln -c Release
dotnet test tests/FactuTrust.Infrastructure.Tests --filter "FullyQualifiedName~PublicContact"
dotnet test tests/FactuTrust.API.Tests --filter "FullyQualifiedName~PublicContact"
dotnet ef migrations has-pending-model-changes --project FactuTrust.Infrastructure \
  --startup-project FactuTrust.API --context MasterDbContext
```

Jumeau SQL de la migration : `docs/runbooks/sql/AddPublicContactRequests_Master.idempotent.sql`.
