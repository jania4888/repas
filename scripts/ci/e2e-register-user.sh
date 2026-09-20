#!/usr/bin/env bash
# Inscription idempotente d'un utilisateur tenant pour les smoke tests Playwright en CI.
# Nécessite Features:PublicRegistration:CompanyEnabled=true (appsettings Development / CI).
# Si l'inscription publique est désactivée, provisionner via POST /api/platform/tenants/companies.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_FILE="${ROOT}/api-e2e.log"
API_BASE="${E2E_API_BASE:-https://localhost:7001}"
EMAIL="${FACTUTRUST_TEST_EMAIL:-ci-e2e-smoke@factutrust.local}"
PASSWORD="${FACTUTRUST_TEST_PASSWORD:-Ci_E2e_Smoke_Pw1!Xy}"
MAX_ATTEMPTS="${E2E_API_WAIT_MAX_ATTEMPTS:-60}"
SLEEP_SECONDS="${E2E_API_WAIT_SLEEP_SECONDS:-2}"

echo "Waiting for backend at ${API_BASE}/swagger..."
ready=0
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if curl -fsSk "${API_BASE}/swagger" >/dev/null 2>&1; then
    ready=1
    echo "Backend ready (attempt ${attempt}/${MAX_ATTEMPTS})."
    break
  fi
  echo "  attempt ${attempt}/${MAX_ATTEMPTS} — backend not ready"
  sleep "$SLEEP_SECONDS"
done

if [ "$ready" -ne 1 ]; then
  echo "Backend did not become ready in time." >&2
  exit 1
fi

payload=$(cat <<EOF
{
  "email": "${EMAIL}",
  "password": "${PASSWORD}",
  "confirmPassword": "${PASSWORD}",
  "firstName": "CI",
  "lastName": "Smoke",
  "companyName": "CI Smoke Test SARL",
  "nif": "1234567/A/B/C/000",
  "taxRegime": 0,
  "street": "1 rue CI",
  "city": "Tunis",
  "postalCode": "1000",
  "governorate": "Tunis",
  "companyEmail": "contact-ci-smoke@factutrust.local",
  "phone": "71123456",
  "warehouseName": "Entrepôt CI"
}
EOF
)

echo "Registering CI test user ${EMAIL}..."
http_code=$(curl -sSk -o /tmp/e2e-register-response.json -w "%{http_code}" \
  -X POST "${API_BASE}/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "$payload")

echo "Register response HTTP ${http_code}"
cat /tmp/e2e-register-response.json || true
echo

case "$http_code" in
  201|200)
    echo "CI test user registered."
    ;;
  400|409|422)
    echo "Registration returned ${http_code} — attempting login to verify existing user..."
    login_payload=$(cat <<EOF
{"email":"${EMAIL}","password":"${PASSWORD}","rememberMe":false}
EOF
)
    login_code=$(curl -sSk -o /tmp/e2e-login-response.json -w "%{http_code}" \
      -X POST "${API_BASE}/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "$login_payload")
    if [ "$login_code" = "200" ]; then
      echo "Existing CI test user can log in."
      exit 0
    fi
    echo "Login failed with HTTP ${login_code}:" >&2
    cat /tmp/e2e-login-response.json >&2 || true
    exit 1
    ;;
  *)
    echo "Unexpected registration status ${http_code}." >&2
    if [ -f "$LOG_FILE" ]; then
      echo "--- Last 80 lines of api-e2e.log ---" >&2
      tail -n 80 "$LOG_FILE" >&2 || true
    fi
    exit 1
    ;;
esac
