#!/bin/bash
set -euo pipefail
LOG=/var/tmp/ollama-model-pull.log

echo "=== $(date -Is) stop lab ollama briefly; pull on host network ===" | tee "$LOG"
docker stop factutrust-ollama >/dev/null
docker rm -f ollama-puller >/dev/null 2>&1 || true

docker run -d --name ollama-puller --network=host \
  -v factutrust_ollama-models:/root/.ollama \
  ollama/ollama:latest

# wait for API
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "=== pulling qwen2.5:3b-instruct ===" | tee -a "$LOG"
docker exec ollama-puller ollama pull qwen2.5:3b-instruct 2>&1 | tee -a "$LOG"
echo "EXIT:$?" | tee -a "$LOG"
docker exec ollama-puller ollama list 2>&1 | tee -a "$LOG"

docker stop ollama-puller >/dev/null
docker rm ollama-puller >/dev/null
docker start factutrust-ollama >/dev/null
sleep 3
docker exec factutrust-ollama ollama list 2>&1 | tee -a "$LOG"
echo "=== $(date -Is) done ===" | tee -a "$LOG"
