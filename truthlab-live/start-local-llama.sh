#!/usr/bin/env bash
# Free CPU inference: official llama.cpp + Qwen2.5 0.5B Instruct GGUF.
# Runs inside one GitHub Actions job, never exposing a public model endpoint.
set -euo pipefail
MODEL_DIR="${TRUTHLAB_MODEL_DIR:-${RUNNER_TEMP:-/tmp}/truthlab-model}"
mkdir -p "$MODEL_DIR"
MODEL="$MODEL_DIR/qwen2.5-0.5b-instruct-q4_k_m.gguf"
MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
MODEL_SHA256="74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db"
LLAMA_RELEASE="b11430"
ARCHIVE="$MODEL_DIR/llama.tar.gz"
RELEASE_URL="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_RELEASE/llama-$LLAMA_RELEASE-bin-ubuntu-x64.tar.gz"

if [[ ! -s "$MODEL" ]] || ! echo "$MODEL_SHA256  $MODEL" | sha256sum -c --status; then
  echo "Fetching open model weights and verifying pinned SHA256..."
  curl --fail --location --retry 3 --connect-timeout 20 --max-time 360 "$MODEL_URL" -o "$MODEL.part"
  echo "$MODEL_SHA256  $MODEL.part" | sha256sum -c
  mv "$MODEL.part" "$MODEL"
fi
echo "Fetching official llama.cpp CPU executable..."
curl --fail --location --retry 3 --connect-timeout 20 --max-time 120 "$RELEASE_URL" -o "$ARCHIVE"
mkdir -p "$MODEL_DIR/llama"
tar -xzf "$ARCHIVE" -C "$MODEL_DIR/llama"
LLAMA_BIN="$(find "$MODEL_DIR/llama" -type f -name llama-server -print -quit)"
if [[ -z "$LLAMA_BIN" ]]; then echo "llama-server executable not found"; exit 1; fi
chmod +x "$LLAMA_BIN"
LIB_DIR="$(dirname "$LLAMA_BIN")"
echo "Launching Qwen inference on 127.0.0.1 (not exposed to internet)."
LD_LIBRARY_PATH="$LIB_DIR:${LD_LIBRARY_PATH:-}" "$LLAMA_BIN" --model "$MODEL" --host 127.0.0.1 --port 8080 --ctx-size 4096 --threads 4 --parallel 1 --alias qwen-local > "$MODEL_DIR/llama.log" 2>&1 &
pid=$!
echo "$pid" > "$MODEL_DIR/server.pid"
for i in $(seq 1 100); do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/health | grep -q '"status":"ok"'; then
    echo "TRUTHLAB_LOCAL_MODEL_READY llama.cpp Qwen2.5 0.5B"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Local inference process exited unexpectedly."
    tail -n 60 "$MODEL_DIR/llama.log"
    exit 1
  fi
  sleep 2
done
echo "Local inference failed readiness health check."
tail -n 60 "$MODEL_DIR/llama.log"
exit 1
