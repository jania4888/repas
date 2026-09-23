#!/usr/bin/env bash
# FactuTrust — deploiement controle sur le VPS Hostinger.
#
# S'execute SUR LE SERVEUR, en tant que `deploy`, dans /opt/factutrust. Normalement lance par
# deploy/scripts/Deploy-Hostinger.ps1 (poste Windows / Visual Studio), qui extrait CE fichier de la
# version cible elle-meme : c'est toujours le script de la version deployee qui s'execute.
#
# Usage :
#   deploy.sh <sha> [--dry-run] [--build-all] [--accept-migrations] [--allow-unmerged]
#
#   --dry-run            tout jusqu'a la construction des images, puis retour a l'etat initial :
#                        aucune sauvegarde, aucune bascule, production intacte
#   --build-all          reconstruit les trois images meme si leur code n'a pas change
#   --accept-migrations  obligatoire (hors --dry-run) si le delta ajoute des migrations EF
#   --allow-unmerged     autorise une cible hors d'origin/main, en --dry-run UNIQUEMENT
#
# Deroulement d'un deploiement reel, arret au premier echec :
#    1. controles : verrou, utilisateur, pile entierement en service, disque, cible descendante
#       de la version en service ET presente sur origin/main, AUCUN changement d'infrastructure ;
#    2. analyse du delta : images a reconstruire, migrations master et tenant ;
#    3. clone de la cible dans src-next, reinjection de .env et du PFX, controles ;
#    4. construction des seules images concernees (la production continue de tourner) ;
#    5. sauvegarde de TOUTES les bases (garde-fou de comptage de backup.sh) ;
#    6. archivage de quoi revenir en arriere : image API exportee et volumes statiques. La purge
#       nocturne Hostinger (docker image prune -af --filter until=24h) efface les anciennes images ;
#    7. bascule des repertoires (src -> src-old) et redemarrage de l'API seule ;
#    8. PORTE : 0 FATAL, migration et semis confirmes, nouvelles migrations master presentes en
#       base, refresh bidon -> 401, drapeaux en Production, 0 ERR/FTL, bonne image en service ;
#    9. publication des fronts APRES l'API (un front neuf face a une API ancienne peut casser) ;
#   10. controles depuis Internet.
#   Un echec aux etapes 7 a 10 declenche un retour automatique a la version precedente.
#
# Limite assumee : une migration de base deja appliquee n'est PAS defaite par le retour arriere.
# La sauvegarde de l'etape 5 est alors le point de reprise des donnees.
#
# Codes de sortie : 0 succes (ou rien a faire), 1 abandon avant bascule (production intacte),
#                   2 echec apres bascule, retour arriere effectue.

set -uo pipefail

ROOT=/opt/factutrust
COMPOSE_FILES=(-f deploy/docker-compose.yml -f deploy/docker-compose.vps.yml)
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519_deploykey -o BatchMode=yes"

TGT_ARG=""; DRY=0; BUILD_ALL=0; ACCEPT_MIG=0; ALLOW_UNMERGED=0
SWITCHED=0; API_RESTARTED=0; WEB_PUBLISHED=0; ADMIN_PUBLISHED=0
CUR=""; CUR_SHORT="?"; TGT=""; TGT_SHORT="?"; T0=""
RUN_API_ID=""; RB_DIR=""; BACKUP_DIR=""; MASTER_MIGS=""; TENANT_MIGS=""
TS=$(date -u +%Y%m%d-%H%M%S)
# Images d'avant la construction, protegees par un NOM et non par un identifiant : avec le
# magasin d'images containerd de Docker, une image disparait des qu'elle perd sa derniere
# etiquette. Deplacer :latest vers une candidate rendait l'ancien identifiant introuvable
# ("No such image"), et une restauration par identifiant echouait donc en silence.
declare -A OLD_REF=()

say()  { printf '%s\n' "$*"; }
step() { printf '\n==== %s ====\n' "$*"; }
ok()   { printf '  [OK]    %s\n' "$*"; }
ko()   { printf '  [ECHEC] %s\n' "$*"; }

record() {
  printf '%s\t%s\t%s -> %s\n' "$(date -u +%FT%TZ)" "$1" "$CUR_SHORT" "$TGT_SHORT" >> "$ROOT/deploys.log"
}

compose_in() { # repertoire, puis arguments de docker compose
  local d="$1"; shift
  (cd "$ROOT/$d" && docker compose "${COMPOSE_FILES[@]}" "$@" </dev/null)
}

sql() { # requete sur la base master ; le mot de passe ne passe pas en ligne de commande
  SQLCMDPASSWORD="$SA_PASSWORD" docker exec -e SQLCMDPASSWORD factutrust-sqlserver \
    /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -h -1 -W -b -d FactuTrust_Master \
    -Q "SET NOCOUNT ON; $1" </dev/null
}

wait_healthy() { # conteneur, delai maximal en secondes
  local c="$1" max="$2" s i
  for ((i = 0; i <= max; i += 5)); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)
    [ "$s" = healthy ] && { ok "$c : healthy apres ${i} s"; return 0; }
    [ "$s" = unhealthy ] && { ko "$c : unhealthy"; return 1; }
    sleep 5
  done
  ko "$c : toujours pas healthy apres ${max} s"
  return 1
}

protect_tags() { # SERVICES... : nomme les images :latest actuelles avant de les remplacer
  local s img
  for s in "$@"; do
    img="factutrust-$s"
    if docker image inspect "$img:latest" >/dev/null 2>&1; then
      docker tag "$img:latest" "$img:pre-deploy-$TS" || die "protection de $img:latest impossible"
      OLD_REF[$img]="$img:pre-deploy-$TS"
    else
      OLD_REF[$img]=""
    fi
  done
}

restore_tags() { # remet :latest sur les images protegees, et le VERIFIE ; 1 si un echec
  local img ref fail=0
  for img in "${!OLD_REF[@]}"; do
    ref="${OLD_REF[$img]}"
    if [ -n "$ref" ]; then
      if docker tag "$ref" "$img:latest" 2>/dev/null \
         && [ "$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null)" = "$(docker image inspect -f '{{.Id}}' "$img:latest" 2>/dev/null)" ]; then
        docker image rm "$ref" >/dev/null 2>&1   # retire le nom de protection ; l'image reste sous :latest
        ok "$img:latest restaure"
      else
        ko "$img:latest NON restaure : l'image precedente reste disponible sous $ref"
        fail=1
      fi
    else
      docker image rm "$img:latest" >/dev/null 2>&1 || true
      ok "$img:latest retire (il n'existait pas avant la construction)"
    fi
  done
  OLD_REF=()
  return $fail
}

cleanup_preparation() {
  restore_tags
  [ -f "$ROOT/src-next/.deploy-staging" ] && rm -rf "$ROOT/src-next"
}

restore_volume() { # volume statique a restaurer depuis l'archive de retour arriere
  local v="$1"
  if docker run --rm -v "factutrust_$v:/d" -v "$RB_DIR:/rb:ro" alpine:latest \
       sh -c "find /d -mindepth 1 -delete && tar xzf /rb/$v.tar.gz -C /d" </dev/null >/dev/null 2>&1; then
    ok "$v restaure"
  else
    ko "$v : restauration impossible, archive : $RB_DIR/$v.tar.gz"
  fi
}

rollback() {
  trap - INT TERM
  step "RETOUR ARRIERE AUTOMATIQUE VERS $CUR_SHORT"
  [ "$WEB_PUBLISHED" = 1 ] && [ -f "$RB_DIR/web-static.tar.gz" ] && restore_volume web-static
  [ "$ADMIN_PUBLISHED" = 1 ] && [ -f "$RB_DIR/admin-static.tar.gz" ] && restore_volume admin-static
  if [ -d "$ROOT/src-old" ]; then
    [ -d "$ROOT/src" ] && mv "$ROOT/src" "$ROOT/src-echec-$TGT_SHORT-$TS"
    mv "$ROOT/src-old" "$ROOT/src" && ok "arbre $CUR_SHORT remis en service (l'arbre en echec est conserve sous src-echec-$TGT_SHORT-$TS)"
  fi
  restore_tags || ko "etiquettes non restaurees : ne PAS relancer docker compose up avant verification"
  if [ "$API_RESTARTED" = 1 ]; then
    compose_in src up -d --no-deps --force-recreate api >/dev/null 2>&1
    wait_healthy factutrust-api 360 || ko "L'API precedente ne redemarre pas : INTERVENTION MANUELLE REQUISE"
  fi
  record "RETOUR_ARRIERE"
  say ""
  say "RETOUR ARRIERE EFFECTUE : $CUR_SHORT est de nouveau en service."
  say "ATTENTION : les migrations de base deja appliquees ne sont PAS defaites."
  [ -n "$BACKUP_DIR" ] && say "Point de reprise des donnees si necessaire : $BACKUP_DIR"
}

die() {
  ko "$*"
  if [ "$SWITCHED" = 1 ]; then rollback; exit 2; fi
  cleanup_preparation
  say ""
  say "DEPLOIEMENT ABANDONNE AVANT TOUTE BASCULE : la production n'a pas ete modifiee."
  [ -n "$CUR" ] && record "ABANDON"
  exit 1
}

on_signal() {
  ko "interruption recue"
  if [ "$SWITCHED" = 1 ]; then rollback; exit 2; fi
  cleanup_preparation
  exit 1
}
trap on_signal INT TERM

for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --build-all) BUILD_ALL=1 ;;
    --accept-migrations) ACCEPT_MIG=1 ;;
    --allow-unmerged) ALLOW_UNMERGED=1 ;;
    -*) die "option inconnue : $a" ;;
    *) TGT_ARG="$a" ;;
  esac
done

# ---------------------------------------------------------------------------------------------
MODE=""; [ "$DRY" = 1 ] && MODE=" (MODE A BLANC)"
step "1. CONTROLES PREALABLES$MODE"
[ "$(whoami)" = deploy ] || die "a executer en tant que 'deploy' (utilisateur courant : $(whoami))"
cd "$ROOT" 2>/dev/null || die "$ROOT introuvable"
mkdir -p "$ROOT/logs"
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || die "un autre deploiement est deja en cours (verrou $ROOT/.deploy.lock)"
[ -n "$TGT_ARG" ] || die "version cible manquante. Usage : deploy.sh <sha> [--dry-run] [...]"
[ -d src/.git ] || die "$ROOT/src n'est pas un depot git"
git -C src fetch -q origin || die "git fetch impossible (cle de deploiement GitHub ?)"

CUR=$(git -C src rev-parse HEAD); CUR_SHORT=${CUR:0:7}
TGT=$(git -C src rev-parse --verify -q "${TGT_ARG}^{commit}") || die "version cible introuvable : $TGT_ARG"
TGT_SHORT=${TGT:0:7}
say "  en service : $CUR_SHORT  $(git -C src log -1 --format=%s "$CUR")"
say "  cible      : $TGT_SHORT  $(git -C src log -1 --format=%s "$TGT")"
if [ "$CUR" = "$TGT" ]; then
  say ""; say "La version cible est deja en service : rien a faire."; exit 0
fi
git -C src merge-base --is-ancestor "$CUR" "$TGT" \
  || die "la cible ne descend pas de la version en service : revenir en arriere n'est pas un deploiement (migrations non reversibles)"
ok "la cible descend de la version en service"
if git -C src merge-base --is-ancestor "$TGT" origin/main; then
  ok "la cible est sur origin/main"
elif [ "$DRY" = 1 ] && [ "$ALLOW_UNMERGED" = 1 ]; then
  say "  [ATTENTION] cible hors d'origin/main : toleree en mode a blanc uniquement"
else
  die "la cible n'est pas sur origin/main : seul du code fusionne peut etre deploye"
fi

INFRA=$(git -C src diff --name-only "$CUR" "$TGT" -- deploy/docker-compose.yml deploy/docker-compose.vps.yml 'deploy/Dockerfile*' deploy/nginx)
[ -z "$INFRA" ] || die "changement d'infrastructure, deploiement MANUEL requis (voir deploy/README.md) : $(printf '%s ' $INFRA)"
ok "aucun changement d'infrastructure (compose, Dockerfiles, Nginx)"

for c in factutrust-sqlserver factutrust-ollama factutrust-api factutrust-nginx; do
  st=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" 2>/dev/null) || st=absent
  case "$st" in
    running/healthy|running/-) ok "$c : $st" ;;
    *) die "$c : $st. La production doit etre entierement en service avant un deploiement" ;;
  esac
done

FREE=$(df --output=avail -BG / | tail -1 | tr -dc 0-9)
[ "${FREE:-0}" -ge 10 ] || die "espace disque insuffisant : ${FREE:-?} Go libres, 10 requis"
ok "disque : $FREE Go libres"

SA_PASSWORD=$(grep -m1 '^MSSQL_SA_PASSWORD=' src/deploy/.env | cut -d= -f2-)
DOMAIN=$(grep -m1 '^FACTUTRUST_DOMAIN=' src/deploy/.env | cut -d= -f2-)
[ -n "$SA_PASSWORD" ] || die "MSSQL_SA_PASSWORD absent de src/deploy/.env"
[ -n "$DOMAIN" ] || die "FACTUTRUST_DOMAIN absent de src/deploy/.env"
ok "secrets lisibles, domaine : $DOMAIN"

# ---------------------------------------------------------------------------------------------
step "2. ANALYSE DU DELTA $CUR_SHORT..$TGT_SHORT"
CHANGED=$(git -C src diff --name-only "$CUR" "$TGT")
say "  $(printf '%s\n' "$CHANGED" | grep -c .) fichier(s) modifie(s)"
NEED_API=0; NEED_WEB=0; NEED_ADMIN=0
printf '%s\n' "$CHANGED" | grep -E '^src/Backend/' | grep -qvE '^src/Backend/tests/' && NEED_API=1
printf '%s\n' "$CHANGED" | grep -qE '^(src/Frontend/factutrust-web/|docs/utilisateur/|docs/screenshots/)' && NEED_WEB=1
printf '%s\n' "$CHANGED" | grep -qE '^src/Frontend/factutrust-backoffice/' && NEED_ADMIN=1
if [ "$BUILD_ALL" = 1 ]; then NEED_API=1; NEED_WEB=1; NEED_ADMIN=1; fi
label() { [ "$1" = 1 ] && printf 'a reconstruire' || printf 'inchange'; }
say "  API : $(label $NEED_API) | front tenant : $(label $NEED_WEB) | back-office : $(label $NEED_ADMIN)"

# Invariant du retour arriere de l'API : :latest doit designer l'image qui tourne. Sinon, l'image
# en service n'a peut-etre plus aucun nom (magasin containerd) et ne pourrait ni etre exportee ni
# etre remise en service. Exige seulement si l'API est reconstruite.
RUN_API_ID=$(docker inspect -f '{{.Image}}' factutrust-api)
if [ "$NEED_API" = 1 ]; then
  if [ "$RUN_API_ID" = "$(docker image inspect -f '{{.Id}}' factutrust-api:latest 2>/dev/null)" ]; then
    ok "factutrust-api:latest designe bien l'image en service"
  elif [ "$DRY" = 1 ]; then
    say "  [ATTENTION] factutrust-api:latest ne designe pas l'image en service : un deploiement reel serait refuse"
  else
    die "factutrust-api:latest ne designe pas l'image en service : le retour arriere n'aurait pas d'image valide. Recreer le conteneur api depuis :latest (deploy/README.md, section 9) avant de deployer"
  fi
fi

mig_ids() { # master | tenant : identifiants des migrations AJOUTEES par le delta
  local f
  for f in $(git -C src diff --name-only --diff-filter=A "$CUR" "$TGT" -- src/Backend/FactuTrust.Infrastructure/Migrations/); do
    case "$f" in *.Designer.cs|*ModelSnapshot.cs) continue ;; esac
    case "$1:$f" in
      master:*/Migrations/Tenant/*) continue ;;
      tenant:*/Migrations/Tenant/*) ;;
      tenant:*) continue ;;
    esac
    git -C src show "$TGT:$f" | grep -oE '\[Migration\("[^"]+"\)\]' | sed -E 's/.*"([^"]+)".*/\1/'
  done
}
MASTER_MIGS=$(mig_ids master)
TENANT_MIGS=$(mig_ids tenant)
if [ -n "$MASTER_MIGS$TENANT_MIGS" ]; then
  if [ -n "$MASTER_MIGS" ]; then say "  migrations MASTER (appliquees au demarrage de l'API) :"; printf '    %s\n' $MASTER_MIGS; fi
  if [ -n "$TENANT_MIGS" ]; then say "  migrations TENANT (appliquees au premier acces de chaque dossier) :"; printf '    %s\n' $TENANT_MIGS; fi
  if [ "$DRY" = 0 ] && [ "$ACCEPT_MIG" = 0 ]; then
    die "ce delta ajoute des migrations. Les revoir et les pre-controler sur les donnees de production, puis relancer avec --accept-migrations"
  fi
else
  ok "aucune nouvelle migration EF"
fi

# ---------------------------------------------------------------------------------------------
step "3. PREPARATION DE L'ARBRE CIBLE (src-next)"
if [ -e src-next ]; then
  [ -f src-next/.deploy-staging ] || die "src-next existe et n'a pas ete cree par ce script : le retirer a la main apres verification"
  rm -rf src-next
fi
git clone -q "$(git -C src remote get-url origin)" src-next || die "clone impossible"
touch src-next/.deploy-staging
git -C src-next checkout -q --detach "$TGT" || die "checkout de $TGT_SHORT impossible"
cp src/deploy/.env src-next/deploy/.env && chmod 600 src-next/deploy/.env || die "copie de deploy/.env impossible"
cp -a src/deploy/certs/. src-next/deploy/certs/ || die "copie des certificats impossible"
[ -f src-next/deploy/certs/dataprotection.pfx ] || die "dataprotection.pfx absent ou n'est pas un fichier"
N=$(grep -lI $'\r' src-next/deploy/scripts/*.sh 2>/dev/null | wc -l)
[ "$N" -eq 0 ] || die "$N script(s) en fins de ligne CRLF dans deploy/scripts"
compose_in src-next config --quiet >/dev/null 2>&1 || die "docker compose config invalide dans src-next"
ok "arbre $TGT_SHORT pret : .env (600) et PFX reinjectes, scripts en LF, compose valide"

# ---------------------------------------------------------------------------------------------
SERVICES=()
[ "$NEED_API" = 1 ] && SERVICES+=(api)
[ "$NEED_WEB" = 1 ] && SERVICES+=(web-static-init)
[ "$NEED_ADMIN" = 1 ] && SERVICES+=(admin-static-init)

if [ ${#SERVICES[@]} -gt 0 ]; then
  step "4. CONSTRUCTION : ${SERVICES[*]} (la production continue de tourner)"
  protect_tags "${SERVICES[@]}"
  compose_in src-next build "${SERVICES[@]}" > "$ROOT/logs/build-$TGT_SHORT-$TS.log" 2>&1 \
    || die "construction en echec, journal : $ROOT/logs/build-$TGT_SHORT-$TS.log"
  for s in "${SERVICES[@]}"; do
    docker tag "factutrust-$s:latest" "factutrust-$s:candidate-$TGT_SHORT"
    ok "factutrust-$s:candidate-$TGT_SHORT ($(docker image inspect -f '{{.Id}}' "factutrust-$s:latest" | cut -c8-19))"
  done
else
  step "4. CONSTRUCTION : rien a construire (aucun code applicatif modifie)"
fi

if [ "$DRY" = 1 ]; then
  step "FIN DU MODE A BLANC"
  if ! restore_tags; then
    [ -f "$ROOT/src-next/.deploy-staging" ] && rm -rf "$ROOT/src-next"
    say ""
    say "A BLANC : construction reussie MAIS etiquettes non restaurees. Ne lancer aucun docker compose up avant verification."
    record "A_BLANC_ETIQUETTES_KO"
    exit 1
  fi
  [ -f "$ROOT/src-next/.deploy-staging" ] && rm -rf "$ROOT/src-next"
  ok "src-next supprime : aucun conteneur touche, production intacte"
  say ""
  say "A BLANC REUSSI : $TGT_SHORT peut etre deploye."
  [ -n "$MASTER_MIGS$TENANT_MIGS" ] && say "Le deploiement reel exigera --accept-migrations."
  record "A_BLANC_OK"
  exit 0
fi

# ---------------------------------------------------------------------------------------------
if [ ${#SERVICES[@]} -gt 0 ]; then
  step "5. SAUVEGARDE DE TOUTES LES BASES"
  (cd "$ROOT/src" && bash deploy/scripts/backup.sh </dev/null) > "$ROOT/logs/backup-$TGT_SHORT-$TS.log" 2>&1 \
    || die "sauvegarde en echec, journal : $ROOT/logs/backup-$TGT_SHORT-$TS.log"
  BACKUP_DIR=$(grep -oE 'Sauvegarde vers [^ ]+' "$ROOT/logs/backup-$TGT_SHORT-$TS.log" | tail -1 | cut -d' ' -f3)
  ok "$(grep -oE '[0-9]+ base\(s\)' "$ROOT/logs/backup-$TGT_SHORT-$TS.log" | tail -1) sauvegardee(s) : $BACKUP_DIR"

  step "6. ARCHIVAGE POUR RETOUR ARRIERE"
  RB_DIR="$ROOT/rollback/$CUR_SHORT-$TS"
  mkdir -p "$RB_DIR" || die "creation de $RB_DIR impossible"
  if [ "$NEED_API" = 1 ]; then
    [ -n "${OLD_REF[factutrust-api]:-}" ] || die "l'image API en service n'a pas ete protegee avant la construction"
    docker save "${OLD_REF[factutrust-api]}" | gzip > "$RB_DIR/api.tar.gz" \
      || die "export de l'image API en service impossible"
    ok "image API $CUR_SHORT exportee (${OLD_REF[factutrust-api]})"
  fi
  for v in web-static admin-static; do
    if [ "$v" = web-static ] && [ "$NEED_WEB" != 1 ]; then continue; fi
    if [ "$v" = admin-static ] && [ "$NEED_ADMIN" != 1 ]; then continue; fi
    docker run --rm --user "$(id -u):$(id -g)" -v "factutrust_$v:/d:ro" -v "$RB_DIR:/rb" alpine:latest \
      tar czf "/rb/$v.tar.gz" -C /d . </dev/null >/dev/null 2>&1 || die "archivage du volume $v impossible"
    ok "volume $v archive"
  done
  (cd "$RB_DIR" && sha256sum -- * > SHA256SUMS)
  ok "archives de retour arriere : $RB_DIR"
fi

# ---------------------------------------------------------------------------------------------
step "7. BASCULE"
if [ -e src-old ]; then
  OLD_NAME="src-old-$(git -C src-old rev-parse --short=7 HEAD 2>/dev/null || echo inconnu)-$TS"
  mv src-old "$OLD_NAME" || die "renommage de l'ancien src-old impossible"
  say "  precedent src-old conserve sous $OLD_NAME"
fi
mv src src-old || die "bascule des repertoires impossible"
SWITCHED=1
mv src-next src || die "bascule des repertoires impossible (src-next -> src)"
rm -f src/.deploy-staging
ok "src = $TGT_SHORT, src-old = $CUR_SHORT"

gate() {
  local fail=0 L n ip code list want got
  L=$(docker logs --since "$T0" factutrust-api 2>&1)
  n=$(printf '%s\n' "$L" | grep -cE 'FATAL: Error during database migration|FATAL: Database seeding failed')
  if [ "$n" -eq 0 ]; then ok "aucun FATAL de migration ou de semis"; else ko "$n ligne(s) FATAL"; fail=1; fi
  if printf '%s\n' "$L" | grep -q 'Database migration completed successfully'; then ok "migration master terminee"; else ko "migration master non confirmee"; fail=1; fi
  if printf '%s\n' "$L" | grep -q 'Database seeding completed successfully'; then ok "semis termine"; else ko "semis non confirme"; fail=1; fi
  if [ -n "$MASTER_MIGS" ]; then
    list=$(printf "N'%s'," $MASTER_MIGS); list=${list%,}
    want=$(printf '%s\n' $MASTER_MIGS | grep -c .)
    got=$(sql "SELECT COUNT(*) FROM dbo.__EFMigrationsHistory WHERE MigrationId IN ($list)" | tr -dc 0-9)
    if [ "$got" = "$want" ]; then ok "nouvelles migrations master en base : $got / $want"; else ko "nouvelles migrations master en base : ${got:-?} / $want"; fail=1; fi
  fi
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' factutrust-api)
  code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"refreshToken":"porte-de-deploiement"}' "http://$ip:8080/api/auth/refresh")
  if [ "$code" = 401 ]; then ok "refresh bidon -> 401 (requetes sur Users fonctionnelles)"; else ko "refresh bidon -> $code, 401 attendu"; fail=1; fi
  if printf '%s\n' "$L" | grep -q 'Effective feature flags:.*Environment=Production'; then ok "drapeaux : Environment=Production"
  else ko "ligne 'Effective feature flags' absente ou hors Production"; fail=1; fi
  n=$(printf '%s\n' "$L" | grep -E '\[(ERR|FTL)\]' | grep -vc 'Savepoints are disabled')
  if [ "$n" -eq 0 ]; then ok "0 erreur ERR/FTL depuis le demarrage"
  else
    ko "$n erreur(s) ERR/FTL depuis le demarrage :"
    printf '%s\n' "$L" | grep -E '\[(ERR|FTL)\]' | grep -v 'Savepoints are disabled' | head -5 | cut -c1-200 | sed 's/^/            /'
    fail=1
  fi
  if [ "$(docker inspect -f '{{.Image}}' factutrust-api)" = "$(docker image inspect -f '{{.Id}}' factutrust-api:latest)" ]; then
    ok "l'API tourne sur l'image $TGT_SHORT"
  else ko "l'API ne tourne pas sur l'image construite"; fail=1; fi
  return $fail
}

if [ "$NEED_API" = 1 ]; then
  T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  API_RESTARTED=1
  compose_in src up -d --no-deps --force-recreate api >/dev/null 2>&1 || die "redemarrage de l'API impossible"
  wait_healthy factutrust-api 360 || die "l'API ne devient pas healthy"
  step "8. PORTE GO / NO-GO"
  gate || die "porte GO / NO-GO en echec"
else
  step "8. PORTE GO / NO-GO : API inchangee, non redemarree"
fi

# ---------------------------------------------------------------------------------------------
if [ "$NEED_WEB" = 1 ] || [ "$NEED_ADMIN" = 1 ]; then
  step "9. PUBLICATION DES FRONTS (apres l'API)"
  if [ "$NEED_WEB" = 1 ]; then
    WEB_PUBLISHED=1
    compose_in src run --rm web-static-init >/dev/null 2>&1 || die "publication du front tenant impossible"
    docker run --rm -v factutrust_web-static:/d:ro alpine:latest test -f /d/index.html </dev/null \
      || die "index.html absent du volume web-static"
    ok "front tenant publie"
  fi
  if [ "$NEED_ADMIN" = 1 ]; then
    ADMIN_PUBLISHED=1
    compose_in src run --rm admin-static-init >/dev/null 2>&1 || die "publication du back-office impossible"
    docker run --rm -v factutrust_admin-static:/d:ro alpine:latest test -f /d/index.html </dev/null \
      || die "index.html absent du volume admin-static"
    ok "back-office publie"
  fi
fi

check_url() { # chemin, code attendu ; quelques essais pour laisser Traefik suivre
  local p="$1" want="$2" code="" i
  for i in 1 2 3 4 5 6; do
    code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "https://$DOMAIN$p")
    [ "$code" = "$want" ] && { ok "$p -> $code"; return 0; }
    sleep 5
  done
  ko "$p -> $code, $want attendu"
  return 1
}

if [ ${#SERVICES[@]} -gt 0 ]; then
  step "10. CONTROLES DEPUIS INTERNET (https://$DOMAIN)"
  f=0
  check_url / 200 || f=1
  check_url /admin/ 200 || f=1
  check_url /health/ready 200 || f=1
  check_url /api/auth/me 401 || f=1
  check_url /hangfire 404 || f=1
  [ "$f" = 0 ] || die "controles depuis Internet en echec"
fi

# ---------------------------------------------------------------------------------------------
record "OK"
step "DEPLOIEMENT TERMINE : $TGT_SHORT EN SERVICE"
if [ -n "$BACKUP_DIR" ]; then say "  sauvegarde prealable : $BACKUP_DIR"
else say "  sauvegarde prealable : aucune, rien n'a ete redemarre"; fi
if [ -n "$RB_DIR" ]; then say "  retour arriere       : $RB_DIR"
else say "  retour arriere       : sans objet"; fi
[ -n "$TENANT_MIGS" ] && say "  migrations tenant    : appliquees au premier acces de chaque dossier"
say "  arbres conserves     : $(ls -d src-old* src-echec-* 2>/dev/null | tr '\n' ' ')"
say "  journal              : $ROOT/deploys.log"
exit 0
