#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --project backend --frozen
uv run --project backend ruff check backend
uv run --project backend pytest backend/tests -q
npm --prefix frontend ci
npm --prefix frontend run format:check
npm --prefix frontend test
npm --prefix frontend run build
python3 scripts/check_public_tree.py
