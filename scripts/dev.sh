#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"
ENV_FILE="$ROOT_DIR/.env"

# Compose command with optional --env-file
compose_cmd() {
  if [ -f "$ENV_FILE" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}
PLAYWRIGHT_OUTPUT_DIRS=(
  "$ROOT_DIR/output/playwright"
  "$ROOT_DIR/apps/web/output/playwright"
  "$ROOT_DIR/apps/web/test-results"
)

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"
  local delay="${4:-2}"

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready at $url"
      return 0
    fi
    sleep "$delay"
  done

  echo "Timed out waiting for $name at $url" >&2
  return 1
}

wait_for_service_health() {
  local service="$1"
  local attempts="${2:-60}"
  local delay="${3:-2}"
  local container_id=""
  local status=""

  for ((i = 1; i <= attempts; i++)); do
    container_id="$(compose_cmd ps -q "$service" 2>/dev/null | tr -d '\n')"
    if [ -n "$container_id" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || true)"
      if [ "$status" = "healthy" ] || [ "$status" = "none" ]; then
        echo "$service healthcheck is $status"
        return 0
      fi
    fi
    sleep "$delay"
  done

  echo "Timed out waiting for $service healthcheck (last status: ${status:-unknown})" >&2
  return 1
}

cleanup_playwright_outputs() {
  local dir
  for dir in "${PLAYWRIGHT_OUTPUT_DIRS[@]}"; do
    mkdir -p "$dir"
    find "$dir" -mindepth 1 -delete
  done
}

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not found" >&2
  exit 1
fi

echo "Stopping old compose containers..."
compose_cmd down --remove-orphans

echo "Cleaning local Playwright artifacts..."
cleanup_playwright_outputs

echo "Starting full local stack via docker compose..."
compose_cmd up --build -d --remove-orphans

wait_for_http "API" "http://localhost:8000/health"
wait_for_http "Web" "http://localhost:3000"
wait_for_service_health "api"
wait_for_service_health "web"

echo
echo "QIHANG local stack is ready:"
echo "  Web:   http://localhost:3000"
echo "  API:   http://localhost:8000/health"
echo "  MinIO: http://localhost:9001"
echo
compose_cmd ps
