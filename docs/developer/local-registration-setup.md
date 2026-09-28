# Inscription entreprise en local (dev)

Guide pour éviter les erreurs `ECONNREFUSED` (proxy Vite) et les HTTP 500 lors de `POST /api/auth/register`.

## Ordre de démarrage

1. **SQL Server LocalDB** : `sqllocaldb start MSSQLLocalDB` (état `Running`).
2. **API** : depuis `src/Backend/FactuTrust.API`, avec `ASPNETCORE_ENVIRONMENT=Development` et l’URL `https://localhost:7001` (profil launch ou `dotnet run --urls "https://localhost:7001;http://localhost:7000"`).
3. **Secrets** : `JwtSettings:SecretKey` et `SignatureSettings:SecretKey` via `dotnet user-secrets` (voir [secrets-configuration.md](secrets-configuration.md)).
4. **Frontend** : `npm start` dans `src/Frontend/factutrust-web` (proxy vers `https://localhost:7001` via `proxy.conf.js`).

Vérifications rapides :

- `GET https://localhost:7001/api/public/registration-status` → `companyEnabled: true`
- `GET https://localhost:7001/api/public/sector-catalog` → 200

## Provisionnement des bases tenant (développement)

`appsettings.Development.json` utilise :

- `TenantProvisioning:Strategy: Migrate` — création par migrations EF (plus fiable sur LocalDB que `TemplateClone` sans template `.bak` prêt).
- `TenantMigrations:ApplyOnStartup: false` — évite de migrer **tous** les dossiers existants à chaque `dotnet run` (démarrage API en quelques secondes).

En production, conserver la stratégie et les options définies dans `appsettings.json` / déploiement.

## Échecs d’inscription fréquents

| Symptôme | Cause | Action |
|----------|--------|--------|
| Proxy Vite `ECONNREFUSED` | API arrêtée ou mauvais port | Démarrer l’API sur 7001 |
| HTTP **409** matricule fiscal | NIF déjà utilisé par un tenant actif | Autre NIF ou désactiver le dossier test en master |
| HTTP **400** secteur | Segment/domaine hors catalogue | Choisir des codes issus de `sector-catalog` |
| HTTP **500** + réf. `REG-…` | Provisionnement SQL après commit master | Consulter les logs `Tenant database provisioning failed` ; vérifier LocalDB, espace disque |
| Compte créé mais connexion refusée | `ProvisioningStatus` Pending/Failed | Reprise via backoffice / ne pas réutiliser le même email sans nettoyage |

## Dossiers en échec (`ProvisioningStatus = Failed`)

Des lignes `Tenants` en statut **Failed** peuvent rester après des tests. Elles n’empêchent pas une nouvelle inscription avec **un nouvel email et un nouveau NIF**. Ne supprimez pas de bases en production ; en local, nettoyage manuel via SSMS uniquement si vous maîtrisez l’impact (utilisateur Identity + tenant + base `FactuTrust_Tenant_*`).

## Tests automatisés

- API : `dotnet test` sur `CompanyRegistrationServiceTests`
- E2E wizard : `npx playwright test e2e/playwright.registration.spec.ts` (API + front sur 4200)
