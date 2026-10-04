#!/usr/bin/env bash
# Release : rebuild images, refresh static assets, restart API, smoke test.
# Usage (depuis la racine du dépôt) :
#   bash deploy/scripts/release.sh
#
# REMPLACE par deploy/scripts/deploy.sh (lance via deploy/scripts/Deploy-Hostinger.ps1).
# Ce script fait un `git pull` sur l'arbre EN SERVICE (aucun retour arriere possible), ne
# sauvegarde rien avant les migrations, publie les fronts AVANT l'API, et ne juge la reussite
# que sur /health/ready, qui repond Healthy sur une base a moitie migree.
set -euo pipefail

if [[ "${FORCE_LEGACY_RELEASE:-0}" != 1 ]]; then
  echo "release.sh est remplace par deploy/scripts/deploy.sh (via Deploy-Hostinger.ps1)." >&2
  echo "Il ne sauvegarde rien, publie les fronts avant l'API et ne permet aucun retour arriere." >&2
  echo "Pour l'executer malgre tout, en connaissance de cause : FORCE_LEGACY_RELEASE=1." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
# Overlay optionnel. SUR LE VPS HOSTINGER IL EST OBLIGATOIRE :
#   COMPOSE_EXTRA_FILE=deploy/docker-compose.vps.yml
# Sans lui, la livraison recree un nginx qui tente de publier 80/443 (deja detenus par
# Traefik) et qui perd le montage de son template de configuration.
COMPOSE_EXTRA_FILE="${COMPOSE_EXTRA_FILE:-}"
SMOKE_URL="${SMOKE_URL:-}"

cd "${REPO_ROOT}"

compose_args=(-f "${COMPOSE_FILE}")
[[ -n "${COMPOSE_EXTRA_FILE}" ]] && compose_args+=(-f "${COMPOSE_EXTRA_FILE}")
compose() { docker compose "${compose_args[@]}" "$@"; }

if [[ ! -f deploy/.env ]]; then
  echo "Missing deploy/.env — run: bash deploy/scripts/init-secrets.sh"
  exit 1
fi

echo "=== Pull latest (optional) ==="
git pull --ff-only 2>/dev/null || echo "Skip git pull (not a git repo or offline)"

echo "=== Rebuild static frontends ==="
compose build web-static-init admin-static-init
compose run --rm web-static-init
compose run --rm admin-static-init

echo "=== Rebuild & restart API ==="
compose build api
compose up -d sqlserver ollama api

echo "Waiting for API health..."
for i in $(seq 1 60); do
  if compose exec -T api curl -fsS http://localhost:8080/health/ready >/dev/null 2>&1; then
    echo "API ready."
    break
  fi
  sleep 5
  if [[ "${i}" -eq 60 ]]; then
    echo "API health timeout — check logs: docker compose ${compose_args[*]} logs api"
    exit 1
  fi
done

# Modeles Ollama : verification seule (aucun pull), non bloquante mais visible. Un modele de
# vision absent ou sans projecteur = import de facture par photo et import de releves bancaires
# en panne, que /health/ready ne voit pas (le controle "ollama-bank-statement-vision" n'est
# visible que dans /api/platform/ops/health).
echo "=== Verification des modeles Ollama (VERIFY_ONLY_MODE=1) ==="
if VERIFY_ONLY_MODE=1 COMPOSE_FILE="${COMPOSE_FILE}" COMPOSE_EXTRA_FILE="${COMPOSE_EXTRA_FILE}" \
   bash deploy/scripts/pull-ollama-models.sh; then
  OLLAMA_MODELS_STATUS="ok"
else
  OLLAMA_MODELS_STATUS="ECHEC (voir ci-dessus ; installation manuelle : deploy/README.md section 4)"
fi

echo "=== Restart nginx ==="
compose up -d nginx

# Le defaut etait https://localhost, que smoke-test.sh interroge sans -k : contre le
# certificat du frontal il echoue TOUJOURS, et le `|| true` transformait cet echec en
# bruit de fond permanent. On exige desormais une URL explicite.
if [[ -z "${SMOKE_URL}" ]]; then
  echo ""
  echo "SMOKE_URL non defini : test de fumee IGNORE."
  echo "  Relancer : SMOKE_URL=https://votre-domaine bash deploy/scripts/smoke-test.sh https://votre-domaine"
  SMOKE_STATUS="ignore"
else
  echo "=== Smoke test (${SMOKE_URL}) ==="
  if bash deploy/scripts/smoke-test.sh "${SMOKE_URL}"; then
    SMOKE_STATUS="ok"
  else
    SMOKE_STATUS="ECHEC"
  fi
fi

echo ""
echo "=== A FAIRE MAINTENANT ==="
echo ""
echo "1. PORTE GO/NO-GO — une migration master en echec est journalisee puis AVALEE en"
echo "   Production, et /health/ready (un simple SELECT 1) repond Healthy malgre tout."
echo "   La seule porte fiable est le journal :"
echo ""
echo "     docker compose ${compose_args[*]} logs api | grep -E \"FATAL: Error during database migration|FATAL: Database seeding failed\""
echo ""
echo "   Sortie VIDE = feu vert. Sinon : restaurer, ne pas redemarrer."
echo ""
echo "2. Si cette livraison porte des migrations EF tenant :"
echo "     POST /api/platform/migrations/tenants/apply-migrations"
echo "     GET  /api/platform/migrations/tenants/migrations-status   # CHAQUE dossier a jour"
echo "   Voir docs/backend-tenant-migrations.md (certaines migrations ont un ordre impose)."
echo ""
echo "3. Test de fumee : ${SMOKE_STATUS}"
echo "4. Modeles Ollama : ${OLLAMA_MODELS_STATUS}"

[[ "${SMOKE_STATUS}" == "ECHEC" ]] && exit 1
exit 0
