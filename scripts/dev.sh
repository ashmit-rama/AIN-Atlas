#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f .env || cp .env.example .env
uv sync --project backend --frozen
npm --prefix frontend ci
npm --prefix frontend run build
cd backend
exec uv run --frozen uvicorn atlas.main:app --host 127.0.0.1 --port "${ATLAS_DEV_PORT:-8000}" --env-file ../.env
