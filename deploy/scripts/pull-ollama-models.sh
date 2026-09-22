#!/usr/bin/env bash
# Télécharge les modèles Ollama requis par FactuTrust (appsettings Ollama section).
# Usage :
#   bash deploy/scripts/pull-ollama-models.sh
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
# Doivent correspondre EXACTEMENT a la section Ollama de appsettings.Production.json :
#   DefaultModel             = qwen2.5:3b-instruct
#   InvoiceImportModel       = qwen2.5:7b-instruct
#   InvoiceImportVisionModel = hf.co/ggml-org/GLM-OCR-GGUF:Q8_0   (voir VERIFY_ONLY)
# Ce script telechargeait "llava", que l'application ne demande nulle part :
# l'import de facture par photo echouait faute du modele de vision attendu.
MODELS=(
  "qwen2.5:3b-instruct"
  "qwen2.5:7b-instruct"
)

# Modeles VERIFIES mais NON telecharges par ce script.
# "ollama pull hf.co/..." echoue sur ce serveur : Ollama refuse la redirection vers le CDN
# Xet de Hugging Face ("blocked redirect to a different host"). Le modele de vision
# s'installe donc par la procedure manuelle (telechargement des DEUX fichiers - poids et
# projecteur mmproj -, "docker cp", puis "ollama create"), decrite dans deploy/README.md.
# Il reste verifie ici : son absence doit faire echouer le provisionnement, sans quoi
# l'import de facture par photo retombe en panne silencieusement.
VERIFY_ONLY=(
  "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0"
)

echo "Pulling Ollama models into factutrust-ollama container..."
for model in "${MODELS[@]}"; do
  echo "--- ${model} ---"
  docker compose -f "${COMPOSE_FILE}" exec -T ollama ollama pull "${model}"
done

# Verification : sans elle le script ne peut pas echouer utilement (un pull rate en
# silence se traduit plus tard par une fonction IA "qui ne marche pas", sans piste).
echo ""
echo "=== Verification ==="
INSTALLED="$(docker compose -f "${COMPOSE_FILE}" exec -T ollama ollama list || true)"
MISSING=0
for model in "${MODELS[@]}" "${VERIFY_ONLY[@]}"; do
  if grep -qF "${model}" <<< "${INSTALLED}"; then
    echo "[OK]       ${model}"
  else
    echo "[MANQUANT] ${model}"
    MISSING=1
  fi
done

if [[ "${MISSING}" -ne 0 ]]; then
  echo ""
  echo "ECHEC : au moins un modele attendu par l'application est absent."
  exit 1
fi

echo ""
echo "Tous les modeles attendus par l'application sont presents."
echo "Rappel : inference CPU seule sur ce VPS (pas de GPU). Premier jeton en plusieurs"
echo "secondes, et l'import de facture par qwen2.5:7b frole son budget de 180 s."
