#!/usr/bin/env sh
# Pull the default small model into the Ollama Docker volume.
# Usage: ./scripts/pull-ollama-model.sh [model_name]
set -e
cd "$(dirname "$0")/.."
MODEL="${1:-qwen3:0.6b}"
docker compose exec ollama ollama pull "$MODEL"
