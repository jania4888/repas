#!/usr/bin/env bash
# Telecharge et VERIFIE les modeles Ollama requis par FactuTrust (section Ollama des appsettings).
# Usage :
#   bash deploy/scripts/pull-ollama-models.sh                      # pull + verification
#   VERIFY_ONLY_MODE=1 bash deploy/scripts/pull-ollama-models.sh   # verification seule, aucun pull
#                                                                  # (appele par release.sh / deploy.sh)
# Variables :
#   COMPOSE_FILE        (defaut deploy/docker-compose.yml)
#   COMPOSE_EXTRA_FILE  overlay optionnel (deploy/docker-compose.vps.yml sur le VPS)
#   ENV_FILE            (defaut deploy/.env) : les cles Ollama__* y sont lues si presentes
#   VERIFY_ONLY_MODE=1  ne telecharge rien, verifie seulement ; code de sortie 1 si un modele manque
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
COMPOSE_EXTRA_FILE="${COMPOSE_EXTRA_FILE:-}"
ENV_FILE="${ENV_FILE:-deploy/.env}"
VERIFY_ONLY_MODE="${VERIFY_ONLY_MODE:-0}"

compose_args=(-f "${COMPOSE_FILE}")
[[ -n "${COMPOSE_EXTRA_FILE}" ]] && compose_args+=(-f "${COMPOSE_EXTRA_FILE}")
ollama_exec() { docker compose "${compose_args[@]}" exec -T ollama ollama "$@"; }

# Lit `CLE=valeur` dans deploy/.env (sans guillemets ni retour chariot) ; vide si absente.
env_value() {
  local key="$1" raw
  [[ -f "${ENV_FILE}" ]] || return 0
  raw="$(grep -m1 "^${key}=" "${ENV_FILE}" | cut -d= -f2- | tr -d '\r' || true)"
  raw="${raw%\"}"; raw="${raw#\"}"; raw="${raw%\'}"; raw="${raw#\'}"
  printf '%s' "${raw}"
}

# Defauts = section Ollama de appsettings.Production.json. Les cles de deploy/.env, si elles
# existent, PRIMENT : c'est ce que l'API lit reellement (variables d'environnement du conteneur).
#   DefaultModel                    = qwen2.5:3b-instruct   (assistant)
#   InvoiceImportModel              = qwen2.5:7b-instruct   (import de facture, repli texte des releves)
#   InvoiceImportVisionModel        = hf.co/ggml-org/GLM-OCR-GGUF:Q8_0   (vision facture)
#   BankStatementImportVisionModel  = hf.co/ggml-org/GLM-OCR-GGUF:Q8_0   (vision releves bancaires)
DEFAULT_MODEL="$(env_value Ollama__DefaultModel)";                       DEFAULT_MODEL="${DEFAULT_MODEL:-qwen2.5:3b-instruct}"
IMPORT_MODEL="$(env_value Ollama__InvoiceImportModel)";                  IMPORT_MODEL="${IMPORT_MODEL:-qwen2.5:7b-instruct}"
INVOICE_VISION_MODEL="$(env_value Ollama__InvoiceImportVisionModel)";    INVOICE_VISION_MODEL="${INVOICE_VISION_MODEL:-hf.co/ggml-org/GLM-OCR-GGUF:Q8_0}"
STATEMENT_VISION_MODEL="$(env_value Ollama__BankStatementImportVisionModel)"
# Cle vide = l'application herite du modele vision de la facture (ImportAiModelResolver).
STATEMENT_VISION_MODEL="${STATEMENT_VISION_MODEL:-${INVOICE_VISION_MODEL}}"

# Modeles telecharges par ce script (dedoublonnes).
MODELS=()
for m in "${DEFAULT_MODEL}" "${IMPORT_MODEL}"; do
  [[ " ${MODELS[*]:-} " == *" ${m} "* ]] || MODELS+=("${m}")
done

# Modeles de VISION : verifies mais JAMAIS telecharges par ce script (dedoublonnes).
# "ollama pull hf.co/..." echoue sur ce serveur : Ollama refuse la redirection vers le CDN
# Xet de Hugging Face ("blocked redirect to a different host"). Le modele de vision
# s'installe donc par la procedure manuelle (telechargement des DEUX fichiers - poids et
# projecteur mmproj -, "docker cp", puis "ollama create"), decrite dans deploy/README.md.
# Son absence doit faire echouer le provisionnement, sans quoi l'import de facture par photo
# ET l'import de releves bancaires retombent en panne silencieusement.
VISION_MODELS=()
for m in "${INVOICE_VISION_MODEL}" "${STATEMENT_VISION_MODEL}"; do
  [[ " ${VISION_MODELS[*]:-} " == *" ${m} "* ]] || VISION_MODELS+=("${m}")
done

if [[ "${VERIFY_ONLY_MODE}" == 1 ]]; then
  echo "Mode verification seule (VERIFY_ONLY_MODE=1) : aucun telechargement."
else
  echo "Pulling Ollama models into factutrust-ollama container..."
  for model in "${MODELS[@]}"; do
    echo "--- ${model} ---"
    ollama_exec pull "${model}"
  done
fi

# Verification : sans elle le script ne peut pas echouer utilement (un pull rate en
# silence se traduit plus tard par une fonction IA "qui ne marche pas", sans piste).
echo ""
echo "=== Verification (source des noms : ${ENV_FILE}, sinon defauts du script) ==="
echo "    assistant        : ${DEFAULT_MODEL}"
echo "    import / repli   : ${IMPORT_MODEL}"
echo "    vision facture   : ${INVOICE_VISION_MODEL}"
echo "    vision releves   : ${STATEMENT_VISION_MODEL}"
INSTALLED="$(ollama_exec list 2>/dev/null || true)"
if [[ -z "${INSTALLED}" ]]; then
  echo "[ECHEC]    'ollama list' ne repond pas : conteneur ollama arrete ?"
  exit 1
fi
MISSING=0
for model in "${MODELS[@]}"; do
  if grep -qF "${model}" <<< "${INSTALLED}"; then
    echo "[OK]       ${model}"
  else
    echo "[MANQUANT] ${model}"
    MISSING=1
  fi
done
# Un modele de vision doit etre installe ET annoncer la capacite " vision " : un modele cree
# sans son projecteur mmproj figure dans `ollama list` mais ignore les images (JSON invente).
for model in "${VISION_MODELS[@]}"; do
  if ! grep -qF "${model}" <<< "${INSTALLED}"; then
    echo "[MANQUANT] ${model} (modele de vision : installation manuelle, deploy/README.md section 4)"
    MISSING=1
    continue
  fi
  SHOW="$(ollama_exec show "${model}" 2>/dev/null || true)"
  if grep -qiE 'vision|projector' <<< "${SHOW}"; then
    echo "[OK]       ${model} (capacite vision annoncee)"
  else
    echo "[SANS VISION] ${model} : installe mais 'ollama show' n'annonce pas la capacite vision (projecteur mmproj absent ?)"
    MISSING=1
  fi
done

if [[ "${MISSING}" -ne 0 ]]; then
  echo ""
  echo "ECHEC : au moins un modele attendu par l'application est absent ou sans vision."
  echo "L'import de facture par photo et l'import de releves bancaires annonceront l'IA indisponible."
  exit 1
fi

echo ""
echo "Tous les modeles attendus par l'application sont presents."
echo "Rappel : inference CPU seule sur ce VPS (pas de GPU). Premier jeton en plusieurs"
echo "secondes ; une page de releve par GLM-OCR prend 1 a 3 min (budget 300 s par page)."
