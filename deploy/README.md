# FactuTrust — déploiement sur VPS Hostinger (Ubuntu 24.04)

Guide opérationnel : **SQL Server**, **API .NET 8**, **Ollama**, **Nginx**, applications
**Angular** (web `/`, backoffice `/admin`) sur un **domaine unique**, derrière le
**Traefik** installé par le template OS « Docker and Traefik » de Hostinger.

> Pour un VPS **sans** Traefik (Nginx en frontal, certbot), voir
> [§ 12 — Topologie alternative](#12--topologie-alternative--nginx-en-frontal).
> Pour le lab VMware, voir [`README-vmware-lab.md`](README-vmware-lab.md).

---

## Architecture

```
Internet ──443/80──▶ traefik (Hostinger)     TLS Let's Encrypt automatique
                        ▼
                     nginx (AUCUN port publié)
                        ├── /            SPA web
                        ├── /admin/      SPA backoffice
                        ├── /api/        API (buffering off, 300 s)
                        ├── /uploads/    fichiers servis par l'API (images produit)
                        └── /health…     sondes
                        ▼
                     api ──▶ sqlserver (interne)
                         └─▶ ollama (interne)
```

| Composant | Rôle |
|-----------|------|
| `sqlserver` | Base master + une base par dossier (créée à l'inscription) |
| `api` | FactuTrust.API — **et aussi** le serveur Hangfire et 10 services hébergés |
| `ollama` | IA locale (`qwen2.5:3b-instruct`, `qwen2.5:7b-instruct`, `gemma3:4b`) |
| `nginx` | Routage même-origine et fichiers statiques Angular. **Pas** le TLS. |
| `web-static-init` / `admin-static-init` | Copie des builds Angular vers les volumes Nginx (one-shot) |

Nginx reste indispensable même avec Traefik : Traefik ne sert pas de fichiers statiques,
et les deux SPA sont **compilées** avec `apiUrl: '/api'`. Il n'existe aucun mécanisme de
configuration au runtime : **la même origine est une contrainte d'architecture**, pas une
préférence.

Volumes persistants : `sqlserver-data`, `sqlserver-backups`, `tenant-provisioning`,
`api-wwwroot`, `api-appdata`, `api-logs`, `api-whatsapp-session`, `ollama-models`.

---

## Prérequis

- Ubuntu 22.04 / 24.04, **32 Go RAM** recommandés, 160 Go+ SSD
- Docker et Traefik **déjà installés** par le template Hostinger — ne pas réinstaller Docker
- Domaine avec un enregistrement **A** vers l'IP du VPS, **propagation vérifiée**
- Ports ouverts : **22**, **80**, **443** (80/443 sont déjà détenus par Traefik)

---

## 1. Reconnaissance du VPS (aucune modification)

**Prendre d'abord un instantané Hostinger** (Backups & Monitoring) : c'est le seul retour
arrière global.

Les cinq variables Traefik ne se devinent pas, elles se lisent :

```bash
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
ss -tlnp                                                      # qui détient 80/443 ?
docker inspect traefik --format '{{json .Config.Cmd}}'        # entrypoints + certresolver
docker inspect traefik --format '{{json .HostConfig.Binds}}'  # acme.json est-il persisté ?
docker inspect traefik --format '{{json .NetworkSettings.Networks}}'
docker network inspect <réseau>        # IPAM.Config[].Subnet -> TRUSTED_PROXY_CIDR
```

| À relever | Variable `.env` |
|---|---|
| Nom du réseau Traefik | `TRAEFIK_NETWORK` |
| Entrypoint TLS (`websecure` ?) | `TRAEFIK_ENTRYPOINT` |
| Entrypoint HTTP (`web` ?) | `TRAEFIK_HTTP_ENTRYPOINT` |
| Nom du `--certificatesresolvers.<nom>` | `TRAEFIK_CERTRESOLVER` |
| Sous-réseau du réseau Traefik | `TRUSTED_PROXY_CIDR` |

> ### Valeurs relevées sur le VPS `srv1995368` (template d'août 2026)
> À revérifier sur tout autre hôte — `cat /docker/traefik/docker-compose.yml`.
>
> | Point | Valeur |
> |---|---|
> | Conteneur | `traefik-traefik-1` (et non `traefik` : `docker inspect traefik` renvoie du vide) |
> | Réseau | **`network_mode: host`** — aucun réseau Docker à rejoindre |
> | Entrypoints | `web` (:80), `websecure` (:443) |
> | Certresolver | `letsencrypt`, défi **HTTP** sur l'entrypoint `web` |
> | `acme.json` | volume `traefik_traefik-letsencrypt` — **persisté** ✓ |
> | `exposedbydefault` | `false` — `traefik.enable=true` obligatoire |
> | Redirection http→https | **déjà globale** (`--entrypoints.web.http.redirections...`) |
> | Fichiers | `/docker/traefik/`, `/docker/ollama-zt1h/` |
>
> Conséquences pour `docker-compose.vps.yml`, toutes déjà intégrées :
> pas de réseau externe à déclarer ; **aucun routeur de redirection à ajouter** (il
> ferait double emploi) ; Traefik joint Nginx par l'IP du conteneur sur `factutrust-net`,
> donc `TRUSTED_PROXY_CIDR` est le sous-réseau de **ce pont**, pas celui de Traefik.

⚠️ **Vérifier que `acme.json` est sur un volume persistant.** Sinon les certificats sont
perdus à chaque recréation du conteneur, et Let's Encrypt limite à 5 certificats
identiques par semaine.

**Auditer le conteneur Ollama du template**, s'il existe :

```bash
docker port ollama-zt1h
curl -s -m 3 http://<IP-PUBLIQUE>:11434/api/tags || echo "non exposé"
```

S'il répond depuis l'extérieur, c'est une API LLM ouverte à tous : **la fermer avant de
continuer**. Sur `srv1995368` c'était le cas — `ports: - "11434"` sans adresse de liaison
donne un port hôte aléatoire ouvert sur `0.0.0.0` (constaté : `32768`, répondant depuis
internet), **et** des labels Traefik publiant `ollama-zt1h.<domaine>` en HTTPS. Retirer la
section `ports` du compose du template et, si le sous-domaine n'est pas voulu, `traefik.enable=false`. Puis `docker stop ollama-zt1h` (sans `rm`) : le stack lance son propre
service Ollama, versionné avec lui, et deux instances se disputeraient la mémoire.

---

## 2. Préparation de l'hôte

```bash
adduser deploy && usermod -aG sudo,docker deploy
# déposer une clé SSH, VÉRIFIER la connexion depuis un SECOND terminal, puis seulement :
#   PasswordAuthentication no / PermitRootLogin prohibit-password  dans /etc/ssh/sshd_config
#   systemctl reload ssh

apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw fail2ban unattended-upgrades

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

> **Piège UFW + Docker, dans les DEUX sens.**
>
> 1. Docker court-circuite la chaîne INPUT d'UFW pour les ports *publiés par des
>    conteneurs* : UFW ne vous protégera pas d'un conteneur qui publie un port par
>    erreur. Le contrôle réel est `ss -tlnp` **plus** un scan externe.
> 2. À l'inverse, **il faut bien ouvrir 80 et 443** ici. Le Traefik du template tourne en
>    `network_mode: host` : il écoute sur les interfaces de l'hôte, ce trafic passe donc
>    par INPUT et UFW le filtre. Les oublier coupe le site — y compris le défi ACME.

**Rotation des journaux à l'échelle du démon : NE PAS Y TOUCHER sur ce template.**

Le template Hostinger livre déjà un `/etc/docker/daemon.json` complet :

```json
{ "live-restore": true,
  "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" },
  "default-address-pools": [ { "base": "172.17.0.0/12", "size": 24 },
                             { "base": "192.168.0.0/16", "size": 24 } ] }
```

La rotation y est donc **déjà configurée** — le stack ajoute en plus la sienne, par service,
dans `docker-compose.yml`. Il n'y a rien à faire ici.

> ⚠️ **Retour d'expérience — ne pas réécrire ce fichier.** L'écraser par une version
> « rotation seule » supprime `live-restore` et `default-address-pools`. Le
> `systemctl restart docker` qui suit **arrête Traefik et Ollama, et ils ne reviennent
> pas** malgré `restart: unless-stopped` : le site tombe jusqu'à un `docker compose up -d`
> manuel dans `/docker/traefik/` et `/docker/ollama-zt1h/`.
>
> Si vous devez vraiment modifier ce fichier : le lire, **fusionner** dans les clés
> existantes, valider (`python3 -m json.tool`), sauvegarder l'original, et vérifier
> `docker ps` **plus** `ss -tlnp` après redémarrage.

**Horloge** : les crons Hangfire sont en UTC et le JWT a `ClockSkew = 0` — une dérive
d'horloge devient un échec d'authentification, pas un avertissement. Vérifier NTP.

---

## 3. Installation

```bash
sudo mkdir -p /opt/factutrust && sudo chown deploy:deploy /opt/factutrust
cd /opt/factutrust
git clone <dépôt> src && cd src        # clé de déploiement en LECTURE SEULE
```

**Toujours `git clone`, jamais un rsync depuis un poste de dev** : l'arbre de travail
local pèse ~23 Go et `.dockerignore` ne couvre pas tout.

### Secrets — obligatoirement AVANT le premier `up`

```bash
bash deploy/scripts/init-secrets.sh
```

> Le compose monte `./certs/dataprotection.pfx` en bind de **fichier**. Si le fichier
> n'existe pas, Docker crée un **répertoire** vide à sa place et l'API lève au démarrage.

Le script génère `MSSQL_SA_PASSWORD`, `JwtSettings__SecretKey`,
**`SignatureSettings__SecretKey`** (sans laquelle l'API refuse de démarrer), le
certificat DataProtection et son mot de passe, et le mot de passe admin plateforme.

Puis éditer `deploy/.env` :

| Variable | Remarque |
|---|---|
| `FACTUTRUST_DOMAIN` | |
| `AllowedOrigins` | **sans espace après la virgule** (découpé sans `Trim()` côté API) |
| `App__FrontendBaseUrl` | liens des e-mails — défaut `http://localhost:4200` |
| `Bootstrap__PlatformAdmin__Email` | |
| `Smtp__*` | **obligatoire en production** : sans SMTP, la réinitialisation de mot de passe n'envoie rien et l'utilisateur reste bloqué |
| `MSSQL_PID` | `Developer` n'est **pas licencié** pour la production |
| `TRAEFIK_*`, `TRUSTED_PROXY_CIDR` | relevés au § 1 |
| `Features__Storefront__*` | voir § 10 |

```bash
chmod 600 deploy/.env
```

### 🔑 À faire immédiatement, avant toute autre chose

Copier **hors du VPS, dans deux emplacements distincts** :

1. `deploy/certs/dataprotection.pfx`
2. la valeur `DataProtection__CertificatePassword` de `deploy/.env`

Le trousseau DataProtection vit **dans la base master** ; ce certificat ne fait que le
chiffrer au repos. L'ensemble récupérable est donc **sauvegarde master + PFX + mot de
passe**. L'un sans les autres : chaînes de connexion tenant, secrets TOTP et clés IA
définitivement illisibles. C'est le seul moment où les perdre ne coûte rien.

---

## 4. Premier démarrage

Toutes les commandes depuis la **racine du dépôt**. Raccourci :

```bash
alias ftc='docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.vps.yml'
```

L'ordre n'est pas stylistique : chaque étape dépend des effets de bord de la précédente.

```bash
# 1. Base de données seule : une erreur de configuration SQL surgit en 60 s au lieu
#    d'être enterrée dans 20 minutes de build.
ftc up -d sqlserver
ftc ps                                   # attendre (healthy)
ftc exec -u 0 sqlserver chown mssql:root /var/opt/mssql/provisioning   # UNE SEULE FOIS
ftc exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C \
    -Q "SELECT SERVERPROPERTY('Edition')"

# 2. Construction (10-25 min à froid), séparée du `up` pour ne pas entremêler les
#    échecs de build et d'exécution dans les journaux.
ftc build

# 3. API : les migrations master et le semis tournent ICI, avant app.Run().
ftc up -d api
ftc logs -f api
```

### ⛔ Porte GO / NO-GO

**Ne jamais utiliser `/health/ready` comme porte.** Cette sonde ne fait qu'un `SELECT 1`
sur la base master, et en Production une migration ou un semis en échec est **journalisé
puis avalé** : l'API démarre, se déclare `Healthy`, et le premier login renvoie 500.

Les quatre conditions doivent tenir :

```bash
ftc logs api | grep -E "FATAL: Error during database migration|FATAL: Database seeding failed"
```

1. la commande ci-dessus ne renvoie **rien** ;
2. `Database migration completed successfully.` est présent ;
3. `Database seeding completed successfully.` est présent ;
4. `Effective feature flags: … PublicRegistration.Company=False … Environment=Production`.

Si une condition tombe : **arrêter**. Ne pas passer au proxy. Une base master à moitié
migrée est une **restauration** (§ 9), pas un redémarrage.

### ⚠️ Au PREMIER démarrage seulement : redémarrer l'API une fois

Sur une base vide, **Hangfire perd sa course contre EF** et n'installe jamais son schéma.
Chronologie mesurée sur une mise en service à blanc :

```
+2s   Hangfire installe ses objets SQL
+15s  ECHEC x3 : Cannot open database "FactuTrust_Master"   <- elle n'existe pas encore
+16s  EF commence les migrations master
+24s  EF termine : la base est créée
+27s  les 15 jobs récurrents échouent : Invalid object name 'hangfire.Hash'
      ... et réessaient toutes les 60 s, indéfiniment
```

Hangfire n'installe son schéma **qu'une fois**, et le service de réenregistrement ne
réessaie que les *jobs*, jamais le schéma. Résultat : relances, rappels fiscaux,
facturation récurrente, recalcul de trésorerie, contrôles comptables planifiés, nettoyage
des bases orphelines et reprise des workflows Studio **ne s'exécutent jamais** — pendant
que `/health/ready` répond `Healthy`.

Le redémarrage suffit, la base existant désormais :

```bash
ftc restart api
```

**Vérifier** (11 tables et 15 jobs attendus — ne pas passer à la suite sinon) :

```bash
ftc exec -T -e "SQLCMDPASSWORD=$(grep -E '^MSSQL_SA_PASSWORD=' deploy/.env | cut -d= -f2-)"   sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -h -1 -W -Q   "SET NOCOUNT ON; USE FactuTrust_Master;
   SELECT 'tables hangfire: ' + CONVERT(varchar,COUNT(*)) FROM sys.tables t
     JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='hangfire';
   SELECT 'jobs recurrents: ' + CONVERT(varchar,COUNT(DISTINCT [Key]))
     FROM hangfire.[Hash] WHERE [Key] LIKE 'recurring-job:%';"
```

> Les démarrages suivants ne sont pas concernés : la base existe, Hangfire s'initialise
> normalement. Le correctif de fond appartient au code (ordonner l'initialisation Hangfire
> après `MigrateAsync`, ou rendre sa migration de schéma réessayable) et reste à faire.

```bash
# 4. Fichiers statiques — puis VÉRIFIER que les volumes ont bien reçu quelque chose.
#    Un volume vide produit une page blanche plus tard, sans erreur nulle part.
ftc run --rm web-static-init
ftc run --rm admin-static-init
docker run --rm -v factutrust_web-static:/d alpine ls /d | head

# 5. Proxy. Vérifier qu'il ne publie RIEN sur l'hôte.
ftc up -d nginx
docker port factutrust-nginx            # doit être VIDE

# 6. TLS : rien à faire, Traefik émet le certificat.
docker logs traefik | grep -i acme
curl -vI https://VOTRE_DOMAINE/

# 7. Modèles Ollama (~10 Go, 15-40 min). Non critique dans l'ordre : peut tourner en
#    parallèle des étapes 5-6.
bash deploy/scripts/pull-ollama-models.sh

# 8. Fumée — TOUJOURS passer l'URL explicitement (le défaut est https://localhost,
#    qui échoue et dont l'échec est masqué par un `|| true` dans release.sh).
SMOKE_URL=https://VOTRE_DOMAINE bash deploy/scripts/smoke-test.sh https://VOTRE_DOMAINE
```

> ### Patience au démarrage à froid
> `nginx` attend que l'API soit *healthy* (`start_period: 300s`, 20 relances de 15 s). Sur
> un démarrage à froid où SQL est lent, cela peut laisser **jusqu'à ~8 minutes sans rien
> en écoute** — pas même une page de maintenance. C'est le comportement attendu.
> **Ne pas tuer de conteneur pendant ce temps** : c'est exactement la fenêtre où l'on
> interrompt un `MigrateAsync`.

### Modèle de vision d'import — installation manuelle obligatoire

`pull-ollama-models.sh` **ne télécharge pas** `hf.co/ggml-org/GLM-OCR-GGUF:Q8_0` : il se
contente de vérifier sa présence. Ollama refuse la redirection de Hugging Face vers son CDN
Xet (`blocked redirect to a different host`), donc `ollama pull hf.co/...` échoue sur cet
hôte. Le modèle s'installe en trois temps.

**1. Télécharger les DEUX fichiers.** Le projecteur `mmproj` n'est pas optionnel : sans lui,
le modèle démarre mais **ignore les images** — il produirait alors un JSON inventé, ce qui
est pire qu'une erreur.

```bash
BASE=https://huggingface.co/ggml-org/GLM-OCR-GGUF/resolve/main
mkdir -p /opt/factutrust/glm-ocr && cd /opt/factutrust/glm-ocr
curl -L -o GLM-OCR-Q8_0.gguf        "$BASE/GLM-OCR-Q8_0.gguf"          # ~950 Mo
curl -L -o mmproj-GLM-OCR-Q8_0.gguf "$BASE/mmproj-GLM-OCR-Q8_0.gguf"   # ~484 Mo
sha256sum *.gguf
curl -s https://huggingface.co/api/models/ggml-org/GLM-OCR-GGUF/tree/main | tr ',' '
' | grep -E 'oid|path'
```

Les empreintes doivent correspondre aux `oid` LFS renvoyés par l'API. C'est le seul contrôle
d'approvisionnement de la chaîne : ne pas le sauter.

**2. Créer le modèle sous le nom exact attendu par `appsettings.Production.json`.**

```bash
docker exec factutrust-ollama mkdir -p /root/.ollama/import
docker cp GLM-OCR-Q8_0.gguf        factutrust-ollama:/root/.ollama/import/
docker cp mmproj-GLM-OCR-Q8_0.gguf factutrust-ollama:/root/.ollama/import/
docker exec factutrust-ollama sh -c 'printf "FROM /root/.ollama/import/GLM-OCR-Q8_0.gguf
FROM /root/.ollama/import/mmproj-GLM-OCR-Q8_0.gguf
" > /root/.ollama/import/Modelfile'
docker exec factutrust-ollama ollama create 'hf.co/ggml-org/GLM-OCR-GGUF:Q8_0' -f /root/.ollama/import/Modelfile
```

**3. Prouver que la vision fonctionne — porte bloquante.**

```bash
docker exec factutrust-ollama ollama show 'hf.co/ggml-org/GLM-OCR-GGUF:Q8_0'   # doit annoncer « vision »
```

Puis un test différentiel : le même prompt envoyé **avec** puis **sans** `images:[...]` doit
donner des réponses **différentes**, et la première doit restituer du texte réellement
présent sur l'image. Si ce n'est pas le cas, le projecteur n'est pas câblé.

**Repli** si la porte échoue : `ollama pull glm-ocr:q8_0` — mêmes poids, même quantification,
distribué par la bibliothèque officielle Ollama et étiqueté `vision`, projecteur inclus. Il
faut alors aligner `Ollama__InvoiceImportVisionModel=glm-ocr:q8_0` dans `deploy/.env`.

Enfin, libérer les ~1,4 Go de fichiers intermédiaires des deux côtés :

```bash
docker exec factutrust-ollama rm -rf /root/.ollama/import
rm -rf /opt/factutrust/glm-ocr
```

> **Déclarer la mémoire du moteur.** Ajouter dans `deploy/.env` :
> `Ollama__EngineRamBudgetGiB=<mem_limit du service ollama, en Go>`.
> Sans cette valeur, l'API ne peut pas connaître la mémoire d'un Ollama déporté et
> **renonce** au contrôle de faisabilité mémoire (le contrôle « modèle installé » demeure).
> Avec une valeur *fausse* — par exemple la RAM de l'hôte au lieu de la limite du conteneur —
> le contrôle laisserait passer des modèles qu'Ollama ne peut pas charger.

---

## 5. Accès et premier login

| URL | Application |
|-----|-------------|
| `https://VOTRE_DOMAINE/` | Application web (ERP client) |
| `https://VOTRE_DOMAINE/admin/` | Backoffice plateforme |
| `https://VOTRE_DOMAINE/api/` | API REST |
| `https://VOTRE_DOMAINE/health/ready` | Readiness (master seulement — voir § 4) |

`/hangfire` **renvoie 404** : en Production le filtre exige un en-tête
`Authorization: Bearer` avec le rôle PlatformAdmin, qu'aucun navigateur n'envoie — le
tableau de bord était inutilisable par le proxy par construction. Le 404 est explicite et
non un effet de bord : sans lui, `/hangfire` retomberait dans la SPA et répondrait 200, ce
qui laisse croire à un opérateur qui vérifie l'exposition que quelque chose répond là.
Accès opérateur par tunnel SSH vers `api:8080` en cas de besoin.

**Premier login backoffice** avec `Bootstrap__PlatformAdmin__*`, puis, dans l'ordre :

1. changer le mot de passe ;
2. **vider `Bootstrap__PlatformAdmin__Password` dans `deploy/.env`** et `ftc up -d api`.
   Le semeur est idempotent-*skip* : une fois l'utilisateur créé il ne réapplique jamais
   le mot de passe, donc la valeur reste un secret en clair **et périmé** sur le disque ;
3. vérifier que le **nouveau** mot de passe fonctionne encore avant de partir.

---

## 6. Premier dossier et migrations tenant

Les dossiers se créent **depuis le backoffice** : l'inscription self-service est fermée en
production (`Features:PublicRegistration:*` = `false` côté back **et** front).

Avec `TenantProvisioning__Strategy=Migrate` et **178 migrations tenant**, compter
**plusieurs minutes** pour le premier dossier — la requête HTTP peut expirer au proxy
pendant que le travail se poursuit côté serveur. Suivre `TenantProvision.Step=*` dans les
journaux.

Après chaque **livraison ultérieure** portant des migrations tenant :

```http
POST /api/platform/migrations/tenants/apply-migrations     # jeton PlatformAdmin
GET  /api/platform/migrations/tenants/migrations-status
```

Confirmer que **chaque** dossier est à jour : un échec partiel laisse la flotte à des
versions de schéma différentes. Entre le déploiement et la migration,
`TenantMigrationGuard` renvoie 503 `TENANT_MIGRATION_FAILED` aux dossiers en retard —
*fail-closed* et correct, mais **c'est une panne pour eux** : la fenêtre se compte en
minutes, pas en heures.

Documentation : [`docs/backend-tenant-migrations.md`](../docs/backend-tenant-migrations.md)
— plusieurs migrations y ont un **ordre imposé** (`WidenProductBarcode_Tenant` doit
précéder le déploiement du binaire).

### Passer plus tard à `TemplateClone`

`TemplateClone` transforme des minutes en secondes à la création d'un dossier. Il exige
que le `.bak` du template soit visible **à la fois** de l'API (`File.Exists`) et de SQL
Server (`BACKUP/RESTORE TO DISK`) : c'est le rôle du volume `tenant-provisioning`, monté
au même chemin dans les deux conteneurs.

⚠️ **Le job Hangfire hebdomadaire `tenant-template-maintenance` (dimanche 02:00 UTC)
appelle `EnsureTenantTemplateAsync` SANS regarder `TenantProvisioning:Strategy`, et
relance l'exception.** Sans le volume partagé, il échoue donc **chaque semaine même en
stratégie `Migrate`** : 178 migrations, erreur SQL 3201, 10 relances, base orpheline.
Déclencher ce job **à la main** et le voir **réussir** est le préalable à toute bascule.

---

## 7. Vérification après déploiement

Les points les plus susceptibles de casser sur Linux derrière un proxy.

| Test | Condition de succès |
|---|---|
| `curl -sI http://DOMAINE/` puis suivre | **exactement une** 301 vers https, pas de boucle |
| **IP cliente réelle** : 6 logins en échec depuis une IP, puis 1 depuis une **autre** IP | la 1ʳᵉ est bloquée au 6ᵉ, la 2ᵉ passe **immédiatement**. Si les deux sont bloquées, `real_ip` ne marche pas et **toute la limitation de débit est un seau global** |
| **Image produit** : téléverser puis `curl -I <url>` | `Content-Type: image/*` — **et surtout pas `text/html`** |
| **PDF facture** avec accents (et arabe si concerné) | glyphes corrects, aucun carré vide |
| **OCR** : facture scannée | texte extrait ; pas d'avertissement `OcrStartupCheck` au boot |
| **Chat IA** | les jetons arrivent **au fil de l'eau**, pas d'un bloc |
| **Export PowerPoint** | le fichier descend (teste aussi le montage du PFX) |
| **Upload** 10 Mo → accepté ; 11 Mo → **413 propre** | les limites applicatives sont à 10 Mo, pas aux 50 Mo de Nginx |
| **Lien profond** `/admin/tenants` en accès direct + F5 | 200, pas 404 |
| **Isolation** : deux dossiers, aucun croisement de données | non négociable |
| **E-mail** : réinitialisation de mot de passe | reçu, **et lien vers le domaine public** |
| `/hangfire` | **404** — et surtout pas 200 |
| Tables `hangfire` et jobs récurrents | **11** et **15** — zéro = premier démarrage non rattrapé (§ 4) |
| `curl -sI https://DOMAINE/admin` | `Location:` **relatif** (`/admin/`), pas `http://…` |
| bundle haché | **une seule** en-tête `Cache-Control`, avec `immutable` |
| `docker port factutrust-nginx` + scan externe | 22/80/443 et **rien d'autre** |

---

## 8. Sauvegardes

```bash
bash deploy/scripts/backup.sh
```

Cron quotidien à **02:00 locale** — surtout pas 02:00 UTC le dimanche, qui percuterait
`tenant-template-maintenance` :

```cron
0 2 * * * deploy BACKUP_OFFSITE_CMD='rclone copy "$1" distant:factutrust/' bash /opt/factutrust/src/deploy/scripts/backup.sh
```

Le script sauvegarde master et chaque base de dossier, extrait et compresse les `.bak`,
purge le conteneur, archive `api-wwwroot` et `api-appdata`, copie le PFX, relève la taille
de chaque base face au plafond Express de 10 Go, et **échoue** si la copie hors site échoue.

**Sauvegarder ensemble, et stocker le mot de passe du PFX ailleurs que les archives :**
bases SQL + `dataprotection.pfx` + son mot de passe + `deploy/.env`.

Les sauvegardes hebdomadaires Hostinger ne suffisent pas en production : jusqu'à 7 jours
de perte, restauration de VM entière, aucune garantie de cohérence transactionnelle SQL.

### Épreuve de restauration — à faire AVANT la mise en production, puis chaque trimestre

Sur un hôte jetable :

1. `git clone` du même tag ;
2. restaurer `deploy/.env` et `dataprotection.pfx` **avant** le premier `up` ;
3. `up -d sqlserver` ; `RESTORE DATABASE` master et chaque dossier ;
4. `up -d api` ; porte § 4 propre, **0 migration en attente** ;
5. **se connecter en utilisateur d'un dossier et charger des données.** C'est le seul test
   qui prouve que la chaîne DataProtection a survécu — `/health/ready` ne vous le dira pas ;
6. vérifier que les images produit s'affichent (prouve `api-wwwroot`).

**Une sauvegarde non restaurée est une hypothèse, pas une sauvegarde.**

---

## 9. Mise à jour (livraison)

**Toute livraison passe par `deploy/scripts/deploy.sh`**, lancé depuis le poste par
`deploy/scripts/Deploy-Hostinger.ps1` — directement ou depuis Visual Studio (ci-dessous).
`release.sh` est **désactivé** : il faisait un `git pull` sur l'arbre en service, ne sauvegardait
rien avant les migrations et publiait les fronts avant l'API.

### Ce que fait un déploiement

| Étape | Détail |
|---|---|
| 1. Contrôles | verrou, pile entièrement en service, disque, cible **descendante** de la version en service et **fusionnée** dans `origin/main`, **aucun changement d'infrastructure** (compose, Dockerfiles, Nginx → livraison manuelle) |
| 2. Delta | images à reconstruire (API / front tenant / back-office, selon les fichiers modifiés), migrations EF ajoutées |
| 3. Préparation | clone de la cible dans `src-next`, réinjection de `.env` et du PFX, scripts en LF, compose valide |
| 4. Construction | seulement les images concernées ; la production continue de tourner |
| 5. Sauvegarde | **toutes** les bases (garde-fou de comptage de `backup.sh`) |
| 6. Archivage | image API en service exportée (`docker save`) et volumes statiques archivés dans `/opt/factutrust/rollback/` — la purge nocturne Hostinger efface les anciennes images |
| 7. Bascule | `src` → `src-old`, `src-next` → `src`, redémarrage de l'**API seule** |
| 8. Porte GO/NO-GO | 0 `FATAL`, migration et semis confirmés, nouvelles migrations master **présentes en base**, refresh bidon → **401**, drapeaux en `Production`, 0 `ERR`/`FTL`, bonne image en service |
| 9. Fronts | publiés **après** l'API |
| 10. Internet | `/`, `/admin/`, `/health/ready` → 200, `/api/auth/me` → 401, `/hangfire` → 404 |

**Un échec aux étapes 7 à 10 déclenche le retour automatique** à la version précédente
(arbre, image API, volumes statiques). **Limite** : une migration de base déjà appliquée n'est
pas défaite ; la sauvegarde de l'étape 5 est alors le point de reprise.

Le script serveur tourne **détaché** (`nohup`) : une coupure SSH ou la fermeture de Visual
Studio n'interrompt pas un déploiement. Journal : `/opt/factutrust/logs/deploy-<sha>-<date>.log` ;
historique : `/opt/factutrust/deploys.log`.

### Migrations

Si la version ajoute des migrations EF, le déploiement réel **refuse** de partir sans
`-AcceptMigrations`. Ce n'est pas une formalité : avant de l'ajouter, revoir les migrations et
**pré-contrôler leurs conditions d'échec sur les données de production** (collisions, doublons,
index uniques). Les migrations tenant s'appliquent au premier accès de chaque dossier.

### Depuis un terminal

```powershell
.\deploy\scripts\Deploy-Hostinger.ps1 -DryRun            # à blanc : rien ne bascule
.\deploy\scripts\Deploy-Hostinger.ps1                    # déploie origin/main
.\deploy\scripts\Deploy-Hostinger.ps1 -AcceptMigrations  # idem, migrations revues
.\deploy\scripts\Deploy-Hostinger.ps1 -Ref origin/ma-branche -DryRun -AllowUnmerged  # tester une PR
```

Le lanceur refuse de partir si `instafact.shop` ne pointe pas sur le serveur visé
(`187.124.214.123`, utilisateur `deploy`), ou si l'empreinte SSH de l'hôte a changé.

### Depuis Visual Studio

*Outils → Outils externes… → Ajouter*, deux fois :

| Champ | « Hostinger — à blanc » | « Hostinger — déployer » |
|---|---|---|
| Commande | `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` | idem |
| Arguments | `-NoProfile -ExecutionPolicy Bypass -File "$(SolutionDir)..\..\deploy\scripts\Deploy-Hostinger.ps1" -DryRun` | `-NoProfile -ExecutionPolicy Bypass -File "$(SolutionDir)..\..\deploy\scripts\Deploy-Hostinger.ps1"` |
| Répertoire initial | `$(SolutionDir)` | `$(SolutionDir)` |
| Utiliser la fenêtre Sortie | ☑ | ☑ |
| Demander les arguments | ☐ | ☑ — pour ajouter `-AcceptMigrations` **délibérément** |

Les deux entrées apparaissent dans le menu *Outils* ; la sortie défile dans la fenêtre
**Sortie**. `-ExecutionPolicy Bypass` ne vaut que pour ce processus et ne modifie pas la
stratégie du poste. **Toujours lancer « à blanc » avant « déployer ».**

> La page *Publier* de Visual Studio (Azure, dossier, FTP, IIS, registre Docker) ne convient
> pas à cette pile : aucune de ses cibles ne sait sauvegarder, contrôler les migrations,
> construire les fronts Angular ni revenir en arrière.

> **Fenêtre de bascule des statiques** : les navigateurs restés ouverts peuvent prendre des 404
> sur des bundles hachés (l'application ne gère pas `ChunkLoadError`) et devront rafraîchir une
> fois. À annoncer.

**Retour arrière manuel**, si le retour automatique ne suffit pas : **jamais `down -v`** (cela
détruirait `sqlserver-data`, `api-wwwroot`, `api-appdata`). Restaurer l'arbre (`src-old`),
recharger l'image exportée (`docker load < /opt/factutrust/rollback/<sha>-<date>/api.tar.gz`),
restaurer les volumes statiques depuis leurs archives, puis les bases si une migration l'exige.

---

## 10. Drapeaux fonctionnels à arbitrer

| Sujet | État | Décision |
|---|---|---|
| **Vitrine publique / Turnstile** | `Features:Storefront:Enabled=true`, `OrderSubmissionRequiresCaptcha=true`, secret vide ⇒ **toute commande publique est refusée** sans même contacter Cloudflare | fournir `Features__Storefront__TurnstileSecretKey` + `__TurnstileAllowedHostnames__0`, **ou** `Features__Storefront__Enabled=false`. Voir [`docs/runbooks/storefront-turnstile.md`](../docs/runbooks/storefront-turnstile.md) |
| **Trésorerie prévisionnelle** | back `true`, front `false` ⇒ module invisible | activer le drapeau front impose un **rebuild** de la SPA |
| **Code-barres** | back `true`, front `false` | rampe volontaire, voir `docs/runbooks/barcode-cutover.md` |
| **WhatsApp** | `false` des deux côtés | l'image est construite avec `PUPPETEER_SKIP_DOWNLOAD=1` : activer exige d'ajouter Chromium |
| **Vérification d'e-mail** | `RequireConfirmedEmail=false`, `BlockLoginIfUnverified=false` | un compte non vérifié peut se connecter |

La direction dangereuse est **front ON / back OFF** (503 sur tout le module). L'état livré
est dans le bon sens partout.

---

## 11. Dépannage

| Symptôme | Cause probable / action |
|----------|------|
| L'API boucle au démarrage | `SignatureSettings__SecretKey` ou `JwtSettings__SecretKey` absente/trop courte ; ou `dataprotection.pfx` est un **répertoire** (init-secrets non joué avant le premier `up`) |
| Aucun job de fond ne s'exécute, `Invalid object name 'hangfire.Hash'` en boucle | Premier démarrage sur base vide : redémarrer l'API une fois (§ 4) |
| API « healthy » mais login en 500 | migration master avalée — **relire la porte § 4**, `ftc logs api \| grep FATAL:` |
| `ERR_TOO_MANY_REDIRECTS` | une redirection http→https est active **dans Nginx** : la conf VPS ne doit pas en contenir, elle appartient à Traefik |
| Images produit cassées, requête en **200 `text/html`** | le bloc `location ^~ /uploads/` manque dans la configuration Nginx active |
| Chat IA figé puis livré d'un bloc | `proxy_buffering off` absent sur `/api/`, ou `text/event-stream` ajouté à `gzip_types` |
| Tous les utilisateurs limités ensemble | `set_real_ip_from` faux : l'API voit l'IP de Traefik pour tout le monde |
| Page blanche | volume statique vide — rejouer `*-static-init` et vérifier son contenu |
| `502` sur `/api` | API pas *healthy* : `ftc exec api curl -fsS http://localhost:8080/health/ready` |
| Certificat absent | DNS non propagé au moment de la demande ACME, ou `acme.json` non persisté (quota Let's Encrypt : 5/semaine) |
| Création de dossier très lente | normal en `Migrate` (178 migrations) — voir § 6 |
| `tenant-template-maintenance` rouge chaque dimanche | volume `tenant-provisioning` absent ou `chown` non fait — § 4 étape 1 |
| Sauvegarde en échec sur Express | `WITH COMPRESSION` : non supporté. La version courante du script ne l'utilise plus. |
| IA indisponible | `ftc exec ollama ollama list` — relancer `pull-ollama-models.sh` |
| OCR indisponible | tessdata inclus dans l'image ; vérifier l'avertissement `OcrStartupCheckHostedService` au boot |
| `TENANT_MIGRATION_FAILED` | appliquer les migrations tenant (§ 6) |

---

## 12. Topologie alternative — Nginx en frontal

Sans Traefik (ou si sa configuration ne peut pas être étendue), le stack sait tenir le
frontal lui-même : omettre `-f deploy/docker-compose.vps.yml`, ce qui rétablit la
publication de 80/443 et le montage de `deploy/nginx/conf.d` + `deploy/nginx/certs`.

Vous reprenez alors à votre charge :

```bash
apt install -y certbot
ftc stop nginx
certbot certonly --standalone -d VOTRE_DOMAINE
cp /etc/letsencrypt/live/VOTRE_DOMAINE/{fullchain,privkey}.pem deploy/nginx/certs/
ftc up -d nginx
```

⚠️ Dans cette topologie, `deploy/nginx/conf.d/factutrust.conf` **n'a pas** les correctifs
de la configuration VPS : pas de relais `/uploads/`, pas de `real_ip`. Le bloc
`/.well-known/acme-challenge/` y référence `/var/www/certbot`, **jamais monté** dans le
conteneur — le renouvellement par webroot ne peut donc pas fonctionner en l'état, d'où le
`--standalone` avec coupure. Ces correctifs sont à reporter avant tout usage en production.

---

## 13. Fichiers de référence

| Fichier | Description |
|---------|-------------|
| [`docker-compose.yml`](docker-compose.yml) | Stack de base |
| [`docker-compose.vps.yml`](docker-compose.vps.yml) | Overlay Traefik (VPS Hostinger) |
| [`nginx/templates/default.conf.template`](nginx/templates/default.conf.template) | Nginx derrière Traefik |
| [`nginx/conf.d/factutrust.conf`](nginx/conf.d/factutrust.conf) | Nginx frontal autonome (§ 12) |
| [`.env.example`](.env.example) | Variables d'environnement |
| [`Dockerfile.api`](Dockerfile.api) | Image API |
| [`scripts/`](scripts/) | init-secrets, release, backup, smoke, pull-ollama-models |

## 14. Validation locale avant déploiement

```powershell
powershell -File scripts\verify-all.ps1 -ContinueOnError
```

Le script reproduit les étapes de `.github/workflows/ci.yml` (hors job Playwright, qui exige
SQL Server et l'API démarrée). Par défaut il sort à la **première** étape en échec : avec une
ligne de base de tests backend rouges, il n'atteint alors jamais les étapes frontend.
`-ContinueOnError` joue toutes les étapes et rend un récapitulatif complet — c'est aussi plus
fidèle, la CI lançant ses 4 jobs **en parallèle**.

Ajouter `-CleanInstall` pour un `npm ci --legacy-peer-deps` avant les étapes Angular : la CI
repart d'un `node_modules` vide, et c'est précisément cet écart qui a déjà fait échouer l'étape
`npm ci` en CI alors que tout passait en local.

**Capturer la liste des noms de tests en échec AVANT toute modification** et la comparer
après : un compteur ne distingue pas un échec préexistant d'une régression.

💡 Le faire systématiquement : un run CI complet coûte **~47 minutes facturées** (le job backend
tourne sur `windows-latest`, facturé ×2), soit ~42 runs par mois dans le quota d'un dépôt privé
en plan Free.

Répéter ensuite la pile de production en local — le lab VMware ne suffit pas, il bascule
`TenantMigrations__ApplyOnStartup` et `Features__AccountingFirms__Enabled` :

```bash
docker run --rm mcr.microsoft.com/dotnet/sdk:8.0 dotnet --version   # >= 8.0.424 (global.json)
bash deploy/scripts/init-secrets.sh
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml logs -f api             # porte GO/NO-GO du § 4
```

> ### Sous Windows, ne lancez pas `init-secrets.sh` depuis Git Bash
> C'est un script Linux, et MSYS ne peut pas satisfaire ses deux besoins a la fois :
> sans `MSYS_NO_PATHCONV=1`, le `-subj "/CN=..."` d'openssl est reecrit en chemin
> Windows (`C:/Program Files/Git/CN=...`) ; avec, ce sont les chemins de fichiers
> `/c/Solution/...` que l'openssl natif ne comprend plus. Le script echoue proprement
> dans les deux cas (`set -euo pipefail`), mais il echoue.
>
> Le faire tourner dans un conteneur Linux — plus fidele a la production, de surcroit :
>
> ```bash
> docker run --rm -v "C:/chemin/vers/le/depot:/repo" -w /repo alpine:3.19 >   sh -c 'apk add --no-cache bash openssl >/dev/null && bash deploy/scripts/init-secrets.sh'
> ```
