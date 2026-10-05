#!/usr/bin/env bash
# Smoke tests after deploy (HTTP or HTTPS base URL).
# Usage :
#   bash deploy/scripts/smoke-test.sh http://localhost
#   bash deploy/scripts/smoke-test.sh https://votre-domaine.tn
#   FACTUTRUST_ADMIN_TOKEN=<jeton plateforme> bash deploy/scripts/smoke-test.sh https://votre-domaine.tn
#     -> verifie en plus le controle "ollama-bank-statement-vision" (GLM-OCR pour les releves)
#        dans /api/platform/ops/health, reserve aux administrateurs plateforme.
set -euo pipefail

BASE_URL="${1:-http://localhost}"
BASE_URL="${BASE_URL%/}"
ADMIN_TOKEN="${FACTUTRUST_ADMIN_TOKEN:-}"

echo "Smoke testing FactuTrust at ${BASE_URL}"

curl -fsS "${BASE_URL}/health" >/dev/null
echo "[OK] GET /health"

curl -fsS "${BASE_URL}/health/ready" >/dev/null
echo "[OK] GET /health/ready"

# Controle de sante du modele vision des releves bancaires (GLM-OCR). Il n'est PAS dans
# /health/ready (tag "ai" seulement : Ollama arrete ne doit pas faire redemarrer l'API) ;
# il n'est visible que dans /api/platform/ops/health, qui exige un jeton d'administration.
#   Healthy   : moteur joignable, GLM-OCR installe et chargeable
#   Degraded  : moteur joignable, GLM-OCR absent / sans memoire -> repli texte annonce
#   Unhealthy : moteur IA injoignable -> l'import de releves annonce l'IA indisponible
if [[ -n "${ADMIN_TOKEN}" ]]; then
  OPS_JSON="$(curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" "${BASE_URL}/api/platform/ops/health" || true)"
  if [[ -z "${OPS_JSON}" ]]; then
    echo "[WARN] GET /api/platform/ops/health : pas de reponse avec le jeton fourni (jeton expire ou sans droit SecurityRead ?)"
  elif grep -q '"name":"ollama-bank-statement-vision"' <<< "${OPS_JSON}"; then
    VISION_STATUS="$(grep -o '"name":"ollama-bank-statement-vision","status":"[A-Za-z]*"' <<< "${OPS_JSON}" | sed 's/.*"status":"\([A-Za-z]*\)"/\1/' | head -1)"
    case "${VISION_STATUS}" in
      Healthy)  echo "[OK] ollama-bank-statement-vision : Healthy (GLM-OCR pret pour les releves)" ;;
      Degraded) echo "[WARN] ollama-bank-statement-vision : Degraded (modele vision des releves absent ou sans memoire : repli texte ; voir deploy/README.md section 4)" ;;
      *)        echo "[WARN] ollama-bank-statement-vision : ${VISION_STATUS:-inconnu} (moteur IA injoignable : l'import de releves annoncera l'IA indisponible)" ;;
    esac
  else
    echo "[WARN] /api/platform/ops/health ne liste pas le controle ollama-bank-statement-vision (API anterieure ?)"
  fi
else
  echo "[WARN] FACTUTRUST_ADMIN_TOKEN non fourni : controle ollama-bank-statement-vision (GLM-OCR releves) non verifie"
fi

curl -fsS "${BASE_URL}/" | grep -qi '<html\|app-root' \
  && echo "[OK] GET / (web SPA)" \
  || { echo "[FAIL] GET / (web SPA)"; exit 1; }

curl -fsS "${BASE_URL}/admin/" | grep -qi '<html\|app-root' \
  && echo "[OK] GET /admin/ (backoffice SPA)" \
  || { echo "[FAIL] GET /admin/ (backoffice SPA)"; exit 1; }

# API should respond (401/404 acceptable for unauthenticated probe)
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/platform/ops/health" || true)"
if [[ "${HTTP_CODE}" =~ ^[45][0-9]{2}$ ]]; then
  echo "[OK] GET /api/ reachable (HTTP ${HTTP_CODE})"
else
  echo "[WARN] GET /api/platform/ops/health returned HTTP ${HTTP_CODE}"
fi

echo ""
echo "All smoke checks passed."
