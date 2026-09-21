#!/usr/bin/env bash
# Sauvegarde SQL Server + volumes applicatifs + certificat DataProtection.
# Usage :
#   bash deploy/scripts/backup.sh
# Planifier via cron quotidien sur le VPS (02:00 LOCALE : surtout pas 02:00 UTC le
# dimanche, qui percuterait le job Hangfire `tenant-template-maintenance`).
#
# CE QU'IL FAUT SAUVEGARDER, ET POURQUOI LES TROIS SONT INSÉPARABLES
# ------------------------------------------------------------------
# Le trousseau DataProtection est persisté DANS la base master
# (PersistKeysToDbContext) ; le certificat ne fait que le chiffrer au repos. L'ensemble
# récupérable est donc exactement :
#     sauvegarde de FactuTrust_Master  +  dataprotection.pfx  +  le mot de passe du PFX
# Master sans le PFX, ou PFX sans son mot de passe : les chaînes de connexion tenant,
# les secrets TOTP et les clés IA sont du chiffré, DÉFINITIVEMENT.
# Ce script copie les deux premiers. Le troisième doit vivre dans un gestionnaire de
# secrets, SÉPARÉ de ces archives — sinon un seul dépôt compromis livre le clair.
#
# DIFFÉRENCES AVEC LA VERSION PRÉCÉDENTE
# ---------------------------------------
#  * plus de WITH COMPRESSION : non supporté par SQL Server Express, la sauvegarde
#    échouait à chaque passage. La compression se fait maintenant par gzip côté hôte ;
#  * écriture dans un volume dédié (sqlserver-backups) au lieu du répertoire de données,
#    et purge des .bak DANS le conteneur après copie réussie : l'ancienne version
#    n'effaçait jamais rien et faisait grossir sqlserver-data sans fin ;
#  * copie des seuls *.bak au lieu de tout /var/opt/mssql/data (qui embarquait les
#    .mdf/.ldf vivants, volumineux et incohérents) ;
#  * mot de passe SA passé par SQLCMDPASSWORD et non en argument -P visible dans `ps` ;
#  * relevé de la taille de chaque base, confronté au plafond Express de 10 Go ;
#  * étape hors site, et sortie non nulle si elle échoue.
#
# VARIABLES
#   BACKUP_ROOT             destination locale            (défaut /opt/factutrust/backups)
#   BACKUP_RETENTION_DAYS   purge locale                  (défaut 14 ; 0 = ne purge rien)
#   BACKUP_OFFSITE_CMD      commande hors site ; reçoit le répertoire en $1
#                           ex. BACKUP_OFFSITE_CMD='rclone copy "$1" distant:factutrust/'
#   COMPOSE_FILE / COMPOSE_EXTRA_FILE   fichiers compose à utiliser
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"
COMPOSE_FILE="${COMPOSE_FILE:-${DEPLOY_DIR}/docker-compose.yml}"
COMPOSE_EXTRA_FILE="${COMPOSE_EXTRA_FILE:-}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/factutrust/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d_%H%M%S)"
DEST="${BACKUP_ROOT}/${STAMP}"

# Répertoire des .bak DANS le conteneur SQL Server (volume sqlserver-backups).
CONTAINER_BACKUP_DIR="/var/opt/mssql/backups"

compose_args=(-f "${COMPOSE_FILE}")
[[ -n "${COMPOSE_EXTRA_FILE}" ]] && compose_args+=(-f "${COMPOSE_EXTRA_FILE}")

compose() { docker compose "${compose_args[@]}" "$@"; }

# Lecture ciblée de .env : un `source` casse dès qu'une valeur contient une espace,
# un « # » ou une apostrophe — ce qui arrive avec des mots de passe générés.
read_env() {
  # Le `|| true` en fin de pipeline est indispensable : sans lui, une cle absente fait
  # echouer le pipeline sous `set -o pipefail` et le script sort AVANT le message
  # d'erreur explicite prevu plus bas.
  grep -E "^$1=" "${ENV_FILE}" 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '\r' || true
}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERREUR : ${ENV_FILE} introuvable." >&2
  exit 1
fi

SA_PASSWORD="$(read_env MSSQL_SA_PASSWORD)"
if [[ -z "${SA_PASSWORD}" ]]; then
  echo "ERREUR : MSSQL_SA_PASSWORD absent de ${ENV_FILE}." >&2
  exit 1
fi

mkdir -p "${DEST}/sql"
echo "Sauvegarde vers ${DEST}"

# sqlcmd lit SQLCMDPASSWORD dans l'environnement : le mot de passe n'apparaît donc pas
# dans la table des processus du conteneur.
sqlcmd_q() {
  compose exec -T -e "SQLCMDPASSWORD=${SA_PASSWORD}" sqlserver \
    /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C "$@"
}

# --- 0. Le répertoire de sauvegarde doit exister et appartenir à mssql -------------
compose exec -T -u 0 sqlserver mkdir -p "${CONTAINER_BACKUP_DIR}"
compose exec -T -u 0 sqlserver chown mssql:root "${CONTAINER_BACKUP_DIR}"

# --- 1. Inventaire des bases -------------------------------------------------------
DATABASES="$(sqlcmd_q -h -1 -W -Q \
  "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name LIKE 'FactuTrust[_]%' AND state = 0 ORDER BY name")"

if [[ -z "${DATABASES//[[:space:]]/}" ]]; then
  echo "ERREUR : aucune base FactuTrust_* trouvée. Sauvegarde interrompue." >&2
  exit 1
fi

# --- 2. Sauvegarde de chaque base ---------------------------------------------------
# Pas de WITH COMPRESSION : Express ne le supporte pas et la commande échouerait
# (« Backup compression is not supported on this edition of SQL Server »). CHECKSUM
# détecte une corruption au moment de l'écriture plutôt qu'au moment du besoin.
BACKED_UP=0
while IFS= read -r db; do
  db="$(echo "${db}" | tr -d '[:space:]')"
  [[ -z "${db}" ]] && continue
  echo "  -> ${db}"
  sqlcmd_q -b -Q \
    "BACKUP DATABASE [${db}] TO DISK='${CONTAINER_BACKUP_DIR}/${db}_${STAMP}.bak' WITH INIT, CHECKSUM, STATS=25"
  BACKED_UP=$((BACKED_UP + 1))
done <<< "${DATABASES}"

echo "${BACKED_UP} base(s) sauvegardée(s)."

if ! grep -q 'FactuTrust_Master' <<< "${DATABASES}"; then
  echo "ERREUR : FactuTrust_Master absente de la sauvegarde. C'est la base qui porte le" >&2
  echo "         trousseau DataProtection et le catalogue des dossiers." >&2
  exit 1
fi

# --- 3. Extraction vers l'hôte, puis purge DANS le conteneur ------------------------
# Uniquement les .bak de CE passage : l'ancienne version copiait tout le répertoire de
# données, fichiers .mdf/.ldf vivants compris.
compose cp "sqlserver:${CONTAINER_BACKUP_DIR}/." "${DEST}/sql/"
find "${DEST}/sql" -type f ! -name "*_${STAMP}.bak" -delete

COPIED="$(find "${DEST}/sql" -name "*_${STAMP}.bak" | wc -l)"
if [[ "${COPIED}" -ne "${BACKED_UP}" ]]; then
  echo "ERREUR : ${COPIED} fichier(s) copié(s) pour ${BACKED_UP} base(s) sauvegardée(s)." >&2
  echo "         Les .bak sont CONSERVÉS dans le conteneur pour investigation." >&2
  exit 1
fi

# La copie est vérifiée : on peut libérer le volume du conteneur.
compose exec -T sqlserver sh -c "rm -f ${CONTAINER_BACKUP_DIR}/*.bak"

gzip -f "${DEST}"/sql/*.bak
echo "Archives compressées."

# --- 4. Certificat DataProtection ----------------------------------------------------
if [[ -f "${DEPLOY_DIR}/certs/dataprotection.pfx" ]]; then
  cp "${DEPLOY_DIR}/certs/dataprotection.pfx" "${DEST}/"
  chmod 600 "${DEST}/dataprotection.pfx"
else
  echo "AVERTISSEMENT : ${DEPLOY_DIR}/certs/dataprotection.pfx introuvable." >&2
  echo "                Sans lui, cette sauvegarde de master est INEXPLOITABLE." >&2
fi

# --- 5. Volumes applicatifs -----------------------------------------------------------
# api-wwwroot  = images produit et médias vitrine
# api-appdata  = pièces jointes comptables et exports PowerPoint
for vol in factutrust_api-wwwroot factutrust_api-appdata; do
  if docker volume inspect "${vol}" >/dev/null 2>&1; then
    docker run --rm -v "${vol}:/data:ro" -v "${DEST}:/backup" alpine \
      tar czf "/backup/${vol}.tar.gz" -C /data .
  fi
done

# --- 6. Surveillance du plafond SQL Server Express -------------------------------------
# Express refuse toute écriture au-delà de 10 Go PAR BASE. Le mur le plus probable reste
# cependant le pool mémoire (~1410 Mo pour l'instance entière, partagé par tous les
# dossiers), invisible ici : celui-ci se surveille en observabilité, pas en sauvegarde.
{
  echo "=== Taille des bases au ${STAMP} (plafond Express : 10240 Mo par base) ==="
  sqlcmd_q -W -Q "SET NOCOUNT ON;
    SELECT DB_NAME(database_id) AS base,
           CAST(SUM(size) * 8.0 / 1024 AS DECIMAL(10,1)) AS taille_mo
    FROM sys.master_files
    WHERE DB_NAME(database_id) LIKE 'FactuTrust[_]%' AND type_desc = 'ROWS'
    GROUP BY database_id
    ORDER BY 2 DESC;"
} | tee "${DEST}/tailles-bases.txt"

if grep -qE '[0-9]{5,}\.[0-9]' "${DEST}/tailles-bases.txt"; then
  echo "AVERTISSEMENT : au moins une base dépasse 10 Go — plafond Express atteint ou proche." >&2
fi

du -sh "${DEST}"
echo "Sauvegarde terminée : ${DEST}"

# --- 7. Copie hors site ------------------------------------------------------------------
# Une sauvegarde qui ne quitte pas le VPS disparaît avec lui. C'est l'étape que
# l'ancienne version se contentait de suggérer en commentaire.
if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
  echo "=== Copie hors site ==="
  if bash -c "${BACKUP_OFFSITE_CMD}" _ "${DEST}"; then
    echo "Copie hors site OK."
  else
    echo "ECHEC de la copie hors site. La sauvegarde locale existe mais N'EST PAS protégée" >&2
    echo "contre la perte du VPS." >&2
    exit 1
  fi
else
  echo "AVERTISSEMENT : BACKUP_OFFSITE_CMD non défini — aucune copie hors site." >&2
  echo "                Exemple : BACKUP_OFFSITE_CMD='rclone copy \"\$1\" distant:factutrust/'" >&2
fi

# --- 8. Purge locale ----------------------------------------------------------------------
# Rétention locale simple en jours, volontairement : une purge par générations
# (quotidiennes/hebdomadaires/mensuelles) est facile à écrire de travers, et un bug de
# purge SUPPRIME DES SAUVEGARDES. La rétention longue appartient à la cible hors site,
# dont les outils (rclone, versioning objet) la gèrent mieux et sans risque ici.
# Garde-fous : jamais le passage courant, et jamais la dernière archive restante.
if [[ "${BACKUP_RETENTION_DAYS}" -gt 0 ]]; then
  TOTAL="$(find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  if [[ "${TOTAL}" -gt 1 ]]; then
    find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d \
      -mtime "+${BACKUP_RETENTION_DAYS}" ! -path "${DEST}" -print -exec rm -rf {} +
  fi
fi

echo ""
echo "RAPPEL : une sauvegarde non restaurée est une hypothèse, pas une sauvegarde."
echo "Épreuve de restauration complète à rejouer chaque trimestre (deploy/README.md)."
